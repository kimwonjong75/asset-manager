// scripts/backtest/conditionalChannel/run-kr-size.ts
// ---------------------------------------------------------------------------
// conditional-channel-kr-size-v1 — CLI 드라이버.
//
//   실행:
//     npm run backtest:kr-size -- --phase=data-audit
//     npm run backtest:kr-size -- --phase=prelock
//     npm run backtest:kr-size -- --phase=lockbox        (KRX 교차검증 완료 후만)
//     npm run backtest:kr-size -- --phase=prelock --krx-key=<서비스키>
//
// · data-audit: manifest.json 읽기 → 파일 기반 게이트 평가 → 요약 출력
// · prelock: 게이트 확인 → 데이터 로드 → 개발·검증(2010-2022) 시뮬레이션
//            → 거래 로그·그룹 커버리지·미분류 사유·기업행위 처리 로그 생성
// · lockbox: G11(KRX 교차검증) PASS 후에만 2023-2025 잠금 표본 실행
//
// 주의: 성과 지표(CAGR·Sharpe·MDD)는 아직 미구현. 이 드라이버는 거래 로그까지만 생성.
//       성과 집계(statistics.ts 연결)는 Phase 2 구현 시 추가한다.
//
// 이 파일은 CLI 드라이버이므로 console.* 사용 허용. 다른 순수 모듈에서는 금지.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  buildManifestMissingResult,
  formatAuditSummary,
  runKrSizeDataAudit,
  checkDevValPeriodCoverage,
} from './dataQualityKrSize';
import {
  checkManifest,
  DataLoadError,
  loadKrSizeDataset,
  checkDataIntegrity,
} from './pipeline/dataLoader';
import { runKrxCrossCheck } from './pipeline/krxAdapter';
import type { DataPipelineManifest, MonthEndSnapshot } from './pipeline/types';
import { calculateKrSizePerformance } from './pipeline/performanceKrSize';
import { simulatePortfolio } from './simulator';
import type { PortfolioSecurity, PortfolioSimConfig } from './simulator';
import { KR_SELL_TAX_SCHEDULE } from './pipeline/corporateActions';
import type {
  CorporateActionRecord,
  CostModelParams,
  CostTier,
  IsoDate,
  StrategyId,
} from '../../../types/backtestConditionalChannel';

// ===========================================================================
// 0. 설정
// ===========================================================================

type Phase = 'data-audit' | 'prelock' | 'lockbox';

const PROCESSED_DIR = 'scripts/backtest/data/conditionalChannel/kr/processed/';
const MANIFEST_PATH = join(PROCESSED_DIR, 'manifest.json');
const OUTPUT_DIR    = 'scripts/backtest/data/conditionalChannel/kr/output/';
const KRX_EVIDENCE_PATH = join(PROCESSED_DIR, 'krx_crosscheck.json');

// 사전등록 설정에서 가져온 표본 경계 (개발·검증 겹침 없음)
const DEV_START   = '2010-01-01';
const DEV_END     = '2019-12-31';  // 개발 구간 끝 (겹침 수정: 2022→2019)
const VAL_START   = '2020-01-01';
const VAL_END     = '2022-12-31';
const LOCK_START  = '2023-01-01';
const LOCK_END    = '2025-12-31';

// ===========================================================================
// 1. 인수 파싱
// ===========================================================================

interface CliArgs {
  phase: Phase;
  krxKey: string | null;
}

function parseArgs(argv: readonly string[]): CliArgs | null {
  let phase: Phase | null = null;
  let krxKey: string | null = null;

  for (const arg of argv) {
    const m = /^--phase=(.+)$/.exec(arg);
    if (m) {
      const v = m[1];
      if (v === 'data-audit' || v === 'prelock' || v === 'lockbox') {
        phase = v;
      }
    }
    const k = /^--krx-key=(.+)$/.exec(arg);
    if (k) krxKey = k[1];
  }

  if (!phase) return null;
  return { phase, krxKey };
}

interface KrxSampleBundle {
  samples: Array<{ code: string; date: IsoDate }>;
  marcapData: Map<string, Map<string, { close: number; stocks: number }>>;
}

async function buildKrxSampleBundle(): Promise<KrxSampleBundle> {
  const monthEndDir = join(PROCESSED_DIR, 'month_end');
  const available = (await readdir(monthEndDir))
    .filter((name) => /^\d{4}-\d{2}\.json$/.test(name) && name <= '2022-12.json')
    .sort();
  const preferred = ['2018-06.json', '2019-06.json', '2020-06.json', '2021-06.json', '2022-06.json'];
  const ordered = [
    ...preferred.filter((name) => available.includes(name)),
    ...available.filter((name) => !preferred.includes(name)).reverse(),
  ];

  const samples: Array<{ code: string; date: IsoDate }> = [];
  const marcapData = new Map<string, Map<string, { close: number; stocks: number }>>();
  const seen = new Set<string>();

  for (const filename of ordered) {
    if (samples.length >= 10) break;
    const snapshot = JSON.parse(
      await readFile(join(monthEndDir, filename), 'utf-8')
    ) as MonthEndSnapshot;
    const candidates = snapshot.securities
      .filter((security) =>
        security.investable &&
        (security.market_field === 'KOSPI' || security.market_field === 'KOSDAQ') &&
        security.close !== null && security.close > 0 &&
        security.stocks !== null && security.stocks > 0
      )
      .sort((left, right) => left.code.localeCompare(right.code));

    for (const market of ['KOSPI', 'KOSDAQ']) {
      const security = candidates.find((candidate) => candidate.market_field === market);
      if (!security || security.close === null || security.stocks === null) continue;
      const key = `${security.code}:${snapshot.month_end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      samples.push({ code: security.code, date: snapshot.month_end });
      const byDate = marcapData.get(security.code) ?? new Map<string, { close: number; stocks: number }>();
      byDate.set(snapshot.month_end, { close: security.close, stocks: security.stocks });
      marcapData.set(security.code, byDate);
    }
  }

  return { samples: samples.slice(0, 10), marcapData };
}

async function runAndPersistKrxCrossCheck(
  serviceKey: string,
  manifest: DataPipelineManifest
): Promise<DataPipelineManifest> {
  const bundle = await buildKrxSampleBundle();
  const result = await runKrxCrossCheck(serviceKey, bundle.samples, bundle.marcapData);
  const evidenceText = JSON.stringify(result, null, 2);
  await writeFile(KRX_EVIDENCE_PATH, evidenceText, 'utf-8');

  const gates = manifest.gates.map((gate) => gate.gate === 'G11_KRX_CROSSCHECK'
    ? {
        gate: 'G11_KRX_CROSSCHECK',
        passed: result.status === 'PASS',
        status: result.status,
        sample_count: result.records.length,
        failed_count: result.failedRecords.length,
        checked_at: result.checkedAt,
        detail: result.note,
      }
    : gate);
  const prelockOnly = gates.filter((gate) =>
    gate.gate !== 'G8_DELISTING_COVERAGE' && gate.gate !== 'G11_KRX_CROSSCHECK'
  );
  const prelockPassed = prelockOnly.every((gate) => gate.passed);
  const lockboxPassed = gates.every((gate) => gate.passed);
  const updated: DataPipelineManifest = {
    ...manifest,
    generatedAt: new Date().toISOString() as DataPipelineManifest['generatedAt'],
    gates,
    processedFiles: {
      ...manifest.processedFiles,
      'krx_crosscheck.json': createHash('sha256').update(evidenceText).digest('hex'),
    },
    dataGateVerdict: {
      prelock: prelockPassed ? 'PASS' : 'FAIL',
      lockbox: lockboxPassed ? 'PASS' : 'FAIL',
      lockboxBlockReason: lockboxPassed
        ? null
        : gates.filter((gate) => !gate.passed).map((gate) => gate.gate).join(', '),
    },
  };
  await writeFile(MANIFEST_PATH, JSON.stringify(updated, null, 2), 'utf-8');
  console.log(`KRX 교차검증 결과: ${result.status} (${result.records.length}건, 실패 ${result.failedRecords.length}건)`);
  return updated;
}

// ===========================================================================
// 2. data-audit 단계
// ===========================================================================

async function runDataAuditPhase(krxKey: string | null): Promise<number> {
  console.log('='.repeat(80));
  console.log('conditional-channel-kr-size-v1 — 데이터 품질 감사');
  console.log('='.repeat(80));

  // manifest.json 읽기
  let rawManifest: string;
  try {
    rawManifest = await readFile(MANIFEST_PATH, 'utf-8');
  } catch {
    const result = buildManifestMissingResult(MANIFEST_PATH);
    console.log(formatAuditSummary(result));
    return 1;
  }

  let manifest: DataPipelineManifest;
  try {
    manifest = JSON.parse(rawManifest) as DataPipelineManifest;
  } catch (e) {
    console.error(`manifest.json 파싱 실패: ${String(e)}`);
    return 1;
  }

  if (krxKey) {
    console.log('KRX 공식 데이터 10표본 교차검증을 실행합니다...');
    manifest = await runAndPersistKrxCrossCheck(krxKey, manifest);
  }

  const result = runKrSizeDataAudit(manifest, MANIFEST_PATH);
  console.log(formatAuditSummary(result));

  return result.prelockAllowed ? 0 : 1;
}

// ===========================================================================
// 3. prelock 단계
// ===========================================================================

async function runPrelockPhase(): Promise<number> {
  console.log('='.repeat(80));
  console.log('conditional-channel-kr-size-v1 — prelock (개발·검증 시뮬레이션)');
  console.log('='.repeat(80));
  console.log('');

  // 3a. 매니페스트 확인
  let manifest: DataPipelineManifest;
  try {
    manifest = await checkManifest(PROCESSED_DIR);
  } catch (e) {
    if (e instanceof DataLoadError) {
      console.error(`⛔ ${e.message}`);
    } else {
      console.error(`⛔ 예상치 못한 오류: ${String(e)}`);
    }
    return 1;
  }

  // 3b. 데이터 감사
  const auditResult = runKrSizeDataAudit(manifest, MANIFEST_PATH);
  console.log(formatAuditSummary(auditResult));

  if (!auditResult.prelockAllowed) {
    console.error(`⛔ prelock 불가 — 게이트 실패: ${auditResult.failedGates.join(', ')}`);
    return 1;
  }

  if (auditResult.waitingGates.length > 0) {
    console.log(`⚠  KRX 교차검증 대기 중 (lockbox 차단됨): ${auditResult.waitingGates.join(', ')}`);
  }

  // 3c. 개발·검증 기간 연속성 확인
  const periodCheck = checkDevValPeriodCoverage(manifest, DEV_START, DEV_END, VAL_START, VAL_END);
  console.log(`개발·검증 기간 확인: ${periodCheck.passed ? '✓' : '✗'} ${periodCheck.detail}`);
  if (!periodCheck.passed) {
    console.error('⛔ 개발·검증 기간 데이터 불연속 — 인제스트 재실행 필요');
    return 1;
  }

  // 3d. 데이터 로드 (개발 2010-2019 + 검증 2020-2022)
  // DEV_END(2019-12-31)~VAL_END(2022-12-31)까지 로드한다.
  console.log(`\n데이터 로드 중 (${DEV_START} ~ ${VAL_END}) [개발+검증]...`);
  let dataset;
  try {
    dataset = await loadKrSizeDataset({
      processedDir: PROCESSED_DIR,
      fromDate: DEV_START,
      toDate: VAL_END,
    });
  } catch (e) {
    console.error(`⛔ 데이터 로드 실패: ${String(e)}`);
    return 1;
  }

  // 3e. 데이터 정합성 확인
  const integrity = checkDataIntegrity(dataset);
  console.log(`데이터 정합성: ${integrity.passed ? '✓' : '⚠'} ${integrity.note}`);
  if (!integrity.passed) {
    console.warn(`⚠ 불일치 종목(최대 20개): ${integrity.missingSecurities.join(', ')}`);
    // 경고만 — 불일치 종목을 건너뛰고 진행
  }

  // 3f. 시뮬레이션 실행 (개발 DEV_START~DEV_END, 검증 VAL_START~VAL_END)
  // Phase 2 이전: 그룹 커버리지 집계만 실행. 실제 신호 계산은 simulator.ts 연결 후.
  console.log('\n개발·검증 시뮬레이션 실행 중...');
  const simResult = runSimulation(dataset, DEV_START, VAL_END);

  // 3g. 출력 저장
  await mkdir(OUTPUT_DIR, { recursive: true });
  const logPath = join(OUTPUT_DIR, 'prelock_results.json');
  await writeFile(
    logPath,
    JSON.stringify(
      {
        hypothesisId: 'conditional-channel-kr-size-v1',
        phase: 'prelock',
        simulationPeriods: {
          development: { start: DEV_START, end: DEV_END },
          validation: { start: VAL_START, end: VAL_END },
        },
        generatedAt: new Date().toISOString(),
        securitiesLoaded: dataset.securitiesByCode.size,
        monthsLoaded: dataset.monthlyFlags.size,
        ...simResult,
      },
      null,
      2
    ),
    'utf-8'
  );

  // 3h. 결과 요약
  console.log('\n개발·검증 시뮬레이션 결과:');
  console.log(`  처리 종목 수:    ${dataset.securitiesByCode.size}`);
  console.log(`  로드된 월 수:    ${dataset.monthlyFlags.size}`);
  console.log(`  미분류(UNCLASSIFIABLE): ${simResult.unclassifiableCount}`);
  console.log(`  기업행위 처리:   ${simResult.corpActionCount}`);
  console.log(`  임시 상장종료 처리: ${simResult.provisionalDelistingCount}`);
  for (const result of simResult.development) {
    console.log(
      `  DEV ${result.strategyId}/${result.costTier}: 거래 ${result.tradeCount}, ` +
      `CAGR ${result.metrics.cagrPct?.toFixed(2) ?? 'NA'}%, ` +
      `Sharpe ${result.metrics.sharpe?.toFixed(2) ?? 'NA'}, ` +
      `MDD ${result.metrics.maxDrawdownPct.toFixed(2)}%`
    );
  }
  for (const result of simResult.validation) {
    console.log(
      `  VAL ${result.strategyId}/${result.costTier}: 거래 ${result.tradeCount}, ` +
      `CAGR ${result.metrics.cagrPct?.toFixed(2) ?? 'NA'}%, ` +
      `Sharpe ${result.metrics.sharpe?.toFixed(2) ?? 'NA'}, ` +
      `MDD ${result.metrics.maxDrawdownPct.toFixed(2)}%`
    );
  }
  for (const estimate of simResult.developmentInteraction) {
    console.log(
      `  DEV interaction/${estimate.costTier}: ΔA ${estimate.deltaA?.toFixed(3) ?? 'NA'}R, ` +
      `ΔB ${estimate.deltaB?.toFixed(3) ?? 'NA'}R, I ${estimate.interaction?.toFixed(3) ?? 'NA'}R`
    );
  }
  for (const estimate of simResult.validationInteraction) {
    console.log(
      `  VAL interaction/${estimate.costTier}: ΔA ${estimate.deltaA?.toFixed(3) ?? 'NA'}R, ` +
      `ΔB ${estimate.deltaB?.toFixed(3) ?? 'NA'}R, I ${estimate.interaction?.toFixed(3) ?? 'NA'}R`
    );
  }
  console.log(`  성과 결과 저장:  ${logPath}`);
  console.log('');
  console.log('⚠ G8 미완료로 상장종료 종목은 최종 실거래 종가 임시 청산 — prelock 탐색용 결과다.');
  console.log('⚠ 2023-2025 lockbox는 KRX 교차검증 완료 후에만 열 수 있다.');
  console.log('='.repeat(80));

  return 0;
}

// ===========================================================================
// 4. lockbox 단계 (G11 PASS 후에만)
// ===========================================================================

async function runLockboxPhase(): Promise<number> {
  console.log('='.repeat(80));
  console.log('conditional-channel-kr-size-v1 — lockbox 잠금 표본 실행');
  console.log('='.repeat(80));

  // 매니페스트 확인
  let manifest: DataPipelineManifest;
  try {
    manifest = await checkManifest(PROCESSED_DIR);
  } catch (e) {
    console.error(`⛔ ${String(e)}`);
    return 1;
  }

  const auditResult = runKrSizeDataAudit(manifest, MANIFEST_PATH);

  if (!auditResult.lockboxAllowed) {
    console.error('⛔ lockbox 실행 거부 — 다음 조건이 미충족:');
    if (auditResult.waitingGates.length > 0) {
      console.error(
        `  · KRX 공식 교차검증 미완료: ${auditResult.waitingGates.join(', ')}`
      );
      console.error(
        '  → data.go.kr 서비스키를 발급하고:\n' +
          '    npm run backtest:kr-size -- --phase=data-audit --krx-key=<서비스키>\n' +
          '    교차검증 PASS 확인 후 lockbox를 재실행하세요.'
      );
    }
    if (auditResult.failedGates.length > 0) {
      console.error(`  · 데이터 게이트 실패: ${auditResult.failedGates.join(', ')}`);
    }
    console.log('');
    console.log('잠금 표본(2023-01-01~2025-12-31)을 한 번 열면 되돌릴 수 없다.');
    console.log('이 차단은 사전등록 무결성을 보호하기 위한 것이다.');
    console.log('='.repeat(80));
    return 1;
  }

  // 성과 파이프라인(CAGR/Sharpe/MDD) 미구현 — 게이트는 통과하더라도 실행 불가
  console.error('⛔ [STUB] lockbox 실행 경로는 성과 파이프라인(Phase 2) 구현 후 활성화됩니다.');
  console.error('   현재는 거래 신호·성과 집계 코드가 없어 잠금 표본을 실행할 수 없습니다.');
  console.error('   simulator.ts 연결 + statistics.ts 배선 + CAGR/Sharpe/MDD 집계 완료 후 재실행하세요.');
  console.log('='.repeat(80));
  return 2;
}

// ===========================================================================
// 5. 시뮬레이션 실행 (stub — 실제 엔진 연결은 이 함수에서 수행)
// ===========================================================================

interface StrategyRunResult {
  strategyId: StrategyId;
  costTier: CostTier;
  tradeCount: number;
  unfilledSignals: number;
  exclusions: number;
  groupTradeCount: { A: number; B: number };
  groupMeanR: { A: number | null; B: number | null };
  metrics: ReturnType<typeof calculateKrSizePerformance>;
}

interface InteractionEstimate {
  costTier: CostTier;
  deltaA: number | null;
  deltaB: number | null;
  interaction: number | null;
}

interface SimulationResult {
  development: StrategyRunResult[];
  validation: StrategyRunResult[];
  developmentInteraction: InteractionEstimate[];
  validationInteraction: InteractionEstimate[];
  unclassifiableCount: number;
  corpActionCount: number;
  groupCoverage: { A: number; B: number; unclassifiable: number };
  provisionalDelistingCount: number;
  note: string;
}

function slicePortfolioSecurities(
  dataset: import('./pipeline/types').KrSizeDataset,
  toDate: IsoDate
): PortfolioSecurity[] {
  const flagsBySecurity = new Map<string, import('../../../types/backtestConditionalChannel').MonthlyGroupFlags[]>();
  for (const flags of dataset.monthlyFlags.values()) {
    for (const flag of flags) {
      const list = flagsBySecurity.get(flag.securityId) ?? [];
      list.push(flag);
      flagsBySecurity.set(flag.securityId, list);
    }
  }
  const result: PortfolioSecurity[] = [];
  for (const [securityId, bars] of dataset.securitiesByCode) {
    const end = bars.dates.findIndex((date) => date > toDate);
    const count = end === -1 ? bars.dates.length : end;
    if (count === 0) continue;
    result.push({
      bars: {
        securityId: bars.securityId,
        symbol: bars.symbol,
        market: bars.market,
        currency: bars.currency,
        dates: bars.dates.slice(0, count),
        open: bars.open.slice(0, count),
        high: bars.high.slice(0, count),
        low: bars.low.slice(0, count),
        close: bars.close.slice(0, count),
        volume: bars.volume.slice(0, count),
      },
      monthlyFlags: (flagsBySecurity.get(securityId) ?? []).filter((flag) => flag.asOfMonthEnd <= toDate),
    });
  }
  return result;
}

function buildProvisionalDelistings(
  securities: readonly PortfolioSecurity[],
  _periodEnd: IsoDate
): CorporateActionRecord[] {
  const lastMarketDate = securities.reduce<IsoDate | null>((latest, security) => {
    const date = security.bars.dates[security.bars.dates.length - 1];
    return latest === null || date > latest ? date : latest;
  }, null);
  return securities.flatMap((security): CorporateActionRecord[] => {
    const lastIndex = security.bars.dates.length - 1;
    const lastDate = security.bars.dates[lastIndex];
    if (lastMarketDate === null || lastDate >= lastMarketDate) return [];
    return [{
      securityId: security.bars.securityId,
      type: 'DELISTING',
      exDate: lastDate,
      ratio: null,
      cashDividendPerShare: null,
      delistingProceedsPerShare: security.bars.close[lastIndex],
      delistingReturn: null,
      currency: security.bars.currency,
      note: 'PRELOCK_PROVISIONAL_LAST_TRADED_CLOSE; G8 blocks lockbox',
    }];
  });
}

function krCostParams(): CostModelParams {
  return {
    market: 'KR',
    commissionBps: 10,
    spreadBps: 10,
    slippageBps: 5,
    marketImpactBps: 5,
    sellTaxSchedule: KR_SELL_TAX_SCHEDULE.map((entry) => ({ ...entry })),
    advParticipationCap: 0.05,
    sourceNote: 'conditional-channel-kr-size-v1 preregistered cost model',
  };
}

function lookbackFor(strategyId: StrategyId, group: 'A' | 'B'): number {
  if (strategyId === 'ALL_20') return 20;
  if (strategyId === 'ALL_55') return 55;
  if (strategyId === 'ADAPTIVE') return group === 'A' ? 20 : 55;
  return group === 'A' ? 55 : 20;
}

function runPeriod(
  securities: readonly PortfolioSecurity[],
  startDate: IsoDate,
  endDate: IsoDate,
  corporateActions: readonly CorporateActionRecord[]
): StrategyRunResult[] {
  const initialEquity = 100_000_000;
  const strategies: StrategyId[] = ['ALL_20', 'ALL_55', 'ADAPTIVE', 'REVERSE'];
  const costTiers: CostTier[] = ['BASE', 'DOUBLE'];
  const results: StrategyRunResult[] = [];
  for (const strategyId of strategies) {
    for (const costTier of costTiers) {
      const config: PortfolioSimConfig = {
        strategyId,
        signalStartDate: startDate,
        signalEndDate: endDate,
        entryLookback: (group) => lookbackFor(strategyId, group),
        exitLookback: 20,
        atrLookback: 20,
        stopMultiple: 2,
        commonStartBars: 55,
        fillDelayDays: 1,
        initialEquity,
        riskPerTradePct: 0.5,
        totalRiskCapPct: 12,
        singleNameValueCapPct: 25,
        costTierByMarket: () => krCostParams(),
        costTier,
        slippageFrac: 0.0005,
        closeMethod: 'FORCED_CLOSE',
        advCap: 0.05,
      };
      const output = simulatePortfolio(securities, config, corporateActions);
      const groupR = (group: 'A' | 'B'): number[] => output.trades
        .filter((trade) => trade.group === group && trade.rMultiple !== null)
        .map((trade) => trade.rMultiple as number);
      const groupA = groupR('A');
      const groupB = groupR('B');
      results.push({
        strategyId,
        costTier,
        tradeCount: output.trades.length,
        unfilledSignals: output.unfilled.length,
        exclusions: output.exclusions.length,
        groupTradeCount: { A: groupA.length, B: groupB.length },
        groupMeanR: {
          A: groupA.length > 0 ? groupA.reduce((sum, value) => sum + value, 0) / groupA.length : null,
          B: groupB.length > 0 ? groupB.reduce((sum, value) => sum + value, 0) / groupB.length : null,
        },
        metrics: calculateKrSizePerformance(output.equityCurve, output.trades, startDate, endDate, initialEquity),
      });
    }
  }
  return results;
}

function estimateInteractions(results: readonly StrategyRunResult[]): InteractionEstimate[] {
  return (['BASE', 'DOUBLE'] as const).map((costTier) => {
    const short = results.find((result) => result.strategyId === 'ALL_20' && result.costTier === costTier);
    const long = results.find((result) => result.strategyId === 'ALL_55' && result.costTier === costTier);
    const deltaA = short?.groupMeanR.A !== null && short?.groupMeanR.A !== undefined &&
      long?.groupMeanR.A !== null && long?.groupMeanR.A !== undefined
      ? short.groupMeanR.A - long.groupMeanR.A
      : null;
    const deltaB = short?.groupMeanR.B !== null && short?.groupMeanR.B !== undefined &&
      long?.groupMeanR.B !== null && long?.groupMeanR.B !== undefined
      ? short.groupMeanR.B - long.groupMeanR.B
      : null;
    return {
      costTier,
      deltaA,
      deltaB,
      interaction: deltaA !== null && deltaB !== null ? deltaA - deltaB : null,
    };
  });
}

function runSimulation(
  dataset: import('./pipeline/types').KrSizeDataset,
  _fromDate: string,
  _toDate: string
): SimulationResult {
  let groupA = 0;
  let groupB = 0;
  let unclassifiable = 0;
  for (const flags of dataset.monthlyFlags.values()) {
    for (const flag of flags) {
      if (flag.unclassifiable) unclassifiable++;
      else if (flag.group === 'A') groupA++;
      else groupB++;
    }
  }
  const developmentSecurities = slicePortfolioSecurities(dataset, DEV_END);
  const validationSecurities = slicePortfolioSecurities(dataset, VAL_END);
  const developmentDelistings = buildProvisionalDelistings(developmentSecurities, DEV_END);
  const validationDelistings = buildProvisionalDelistings(validationSecurities, VAL_END);
  const development = runPeriod(developmentSecurities, DEV_START, DEV_END, developmentDelistings);
  const validation = runPeriod(validationSecurities, VAL_START, VAL_END, validationDelistings);
  return {
    development,
    validation,
    developmentInteraction: estimateInteractions(development),
    validationInteraction: estimateInteractions(validation),
    unclassifiableCount: unclassifiable,
    corpActionCount: dataset.corporateActions.length,
    groupCoverage: { A: groupA, B: groupB, unclassifiable },
    provisionalDelistingCount: validationDelistings.length,
    note: '실제 OHLCV 시뮬레이션. interaction은 ALL_20과 ALL_55의 그룹별 평균 R 차이로 계산한 비짝지은 기술통계다. ' +
      'G8 미완료 동안 상장종료 종목은 최종 실거래 종가로 임시 청산하므로 prelock 탐색용이다.',
  };
}

// ===========================================================================
// 6. main
// ===========================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error('사용법: --phase=data-audit | prelock | lockbox [--krx-key=<서비스키>]');
    process.exit(2);
  }

  let exitCode: number;
  if (args.phase === 'data-audit') {
    exitCode = await runDataAuditPhase(args.krxKey);
  } else if (args.phase === 'prelock') {
    exitCode = await runPrelockPhase();
  } else {
    exitCode = await runLockboxPhase();
  }

  process.exit(exitCode);
}

main().catch((e) => {
  console.error('예상치 못한 오류:', e);
  process.exit(3);
});
