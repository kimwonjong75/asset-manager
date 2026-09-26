// scripts/backtest/portfolioTurtle/run.ts
// CLI 드라이버 — 보유자산 CSV → 유니버스 로드 → 12개 시작일 × 15개 조합(+ 비용/이자 민감도) 실행 →
// 집계(+LOO) → DB/portfolioTurtle/(로컬, 개인정보) 저장 + 콘솔 요약(집계만, 위원회 안전).
//
// 사용법: npx tsx scripts/backtest/portfolioTurtle/run.ts "<CSV 경로>"

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadPortfolioData, resolveMonthStartCalIdx, PortfolioSecurity } from './data';
import { buildInitialHoldings, simulatePortfolio, InitialHoldingsResult, PortfolioRunResult } from './engine';
import {
  StartRunEntry, summarizeCombo, periodConsistency, periodAbsoluteConsistency, meanRMultiple,
  incrementalContributions, maxContributorConcentration, pnlByAssetClass, median,
} from './metrics';
import { configHash } from './configHash';
import { parseConfig, ComboConfig, ExitRuleId, ScopeId, SizingVariantConfig } from './configTypes';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Advisor 강건성 점검(2026-09-25): `--equal-weight` 이면 CSV 현재비중 대신 균등 초기비중을 쓴다.
// 현재비중을 과거 시작일에 적용하면 많이 오른 종목이 처음부터 크게 보유된 것처럼 계산되는 사후편향이 있어
// B&H가 부풀려질 수 있다 — 균등비중은 그 편향이 없는 중립 대조군. 산출물은 별도 폴더에 저장한다.
const EQUAL_WEIGHT = process.argv.includes('--equal-weight');
const DB_DIR = path.join(__dirname, '..', '..', '..', 'DB', EQUAL_WEIGHT ? 'portfolioTurtle_equalWeight' : 'portfolioTurtle');

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('사용법: npx tsx scripts/backtest/portfolioTurtle/run.ts "<CSV 경로>"');
  process.exit(1);
}

const { hash, config } = configHash();
const C = parseConfig(config);
console.log('='.repeat(100));
console.log('portfolio-turtle-v1 — 공유 현금 포트폴리오 터틀 사이클 vs B&H   [EXPLORATORY]');
console.log('='.repeat(100));
console.log(`설정 해시: ${hash}`);

// Advisor 사후 탐색(2026-09-25): `--posthoc` 이면 동결 설정 밖의 조합 2개를 **뒤에 덧붙인다**(해시·기존 조합 불변).
// 결과를 본 뒤 추가한 조합이므로 확증이 아니라 탐색용(EXPLORATORY)으로만 해석한다.
if (process.argv.includes('--posthoc')) {
  C.comboList.push(
    { id: 'W4G_COREEXCL', exitRule: 'W4', sizing: 'G', positionCapPct: 10, drawdownScaling: false, scope: 'S-CORE-EXCL' },
    { id: 'W4G_CAP5', exitRule: 'W4', sizing: 'G', positionCapPct: 5, drawdownScaling: false, scope: 'S-ALL' },
  );
  console.log('\n[--posthoc] 사후 탐색 조합 추가: W4G_COREEXCL, W4G_CAP5 (EXPLORATORY)');
}

// Advisor 강건성 점검 후속(2026-09-26): `--lucas`면 루카스 강의식 불타기(2R=4N 간격) 조합을 **뒤에 덧붙인다**
// (해시·기존 조합 불변, --posthoc과 동일 관례). config.json에는 sizing 'L'(1배)·'LH'(0.5배)가 없으므로
// 여기서 코드로 SizingVariantConfig를 구성한다(sizing.ts/engine.ts는 'lucas' 분기를 추가만 했다).
const LUCAS = process.argv.includes('--lucas');
const LUCAS_SIZING: Record<'L' | 'LH', SizingVariantConfig> = {
  L: { riskPerUnitPct: 1, maxUnits: 4, positionCapPct: 10, pyramid: 'lucas', lucasSizeMultiplier: 1 },
  LH: { riskPerUnitPct: 1, maxUnits: 4, positionCapPct: 10, pyramid: 'lucas', lucasSizeMultiplier: 0.5 },
};
if (LUCAS) {
  C.comboList.push(
    { id: 'W1L', exitRule: 'W1', sizing: 'L', positionCapPct: 10, drawdownScaling: false, scope: 'S-ALL' },
    { id: 'W1L_H', exitRule: 'W1', sizing: 'LH', positionCapPct: 10, drawdownScaling: false, scope: 'S-ALL' },
    { id: 'W4L', exitRule: 'W4', sizing: 'L', positionCapPct: 10, drawdownScaling: false, scope: 'S-ALL' },
    { id: 'W1L_COREEXCL', exitRule: 'W1', sizing: 'L', positionCapPct: 10, drawdownScaling: false, scope: 'S-CORE-EXCL' },
  );
  console.log('\n[--lucas] 루카스 강의식 불타기 조합 추가: W1L, W1L_H, W4L, W1L_COREEXCL (EXPLORATORY)');
}

// P0(2026-09-26) 후속: `--riskcap`이면 전체 위험 한도 24% vs 12%를 W1L(있으면) 또는 W1G 조합으로 비교
// 실행한다(--posthoc/--lucas와 동일 관례 — 동결 config·해시·기존 조합은 건드리지 않고 뒤에 덧붙인다).
// `--equal-weight`와 함께 쓰면 균등비중 비교도 같은 실행에서 얻는다.
const RISKCAP = process.argv.includes('--riskcap');

const t0 = Date.now();
const data = loadPortfolioData(csvPath);
if (EQUAL_WEIGHT) {
  for (const sec of data.securities) sec.weightPct = 1 / data.securities.length;
  console.log('\n[--equal-weight] 초기비중을 균등(1/N)으로 대체 — 사후편향 대조군');
}
console.log(`\nCSV ${data.csvRowCount}행 → 고유 ${data.csvUniqueCount}종, 데이터 확보 ${data.securities.length}종, 누락 ${data.missing.length}종`);
if (data.missing.length) for (const m of data.missing) console.log(`   ✗ ${m.ticker}: ${m.detail}`);
console.log(`총 예산(CSV 합계): 약 ${(data.totalBudgetKRW / 1e8).toFixed(2)}억원 · 캘린더 ${data.calendar.length}일 · 로드 ${Date.now() - t0}ms`);

// ── 적용범위(S-CORE-EXCL) 분류 — 로컬 파일에만 목록 남김 ──
const scopeCounts = new Map<string, number>();
for (const sec of data.securities) scopeCounts.set(sec.scopeClass, (scopeCounts.get(sec.scopeClass) ?? 0) + 1);
console.log(`\n적용범위 분류: SATELLITE_TURTLE=${scopeCounts.get('SATELLITE_TURTLE') ?? 0} · CORE_EXCL_BH=${scopeCounts.get('CORE_EXCL_BH') ?? 0}`);

const tradableAll = (): boolean => true;
const tradableCoreExcl = (secByTicker: Map<string, PortfolioSecurity>) => (ticker: string): boolean => {
  const s = secByTicker.get(ticker);
  return s ? s.scopeClass === 'SATELLITE_TURTLE' : false;
};
const secByTicker = new Map(data.securities.map(s => [s.ticker, s]));
const scopePredicates: Record<ScopeId, (ticker: string) => boolean> = {
  'S-ALL': tradableAll,
  'S-CORE-EXCL': tradableCoreExcl(secByTicker),
};

// ── 시작일 해석 ──
interface StartDate { yyyyMm: string; calIdx: number; dateISO: string }
const startDates: StartDate[] = [];
for (const ym of C.startDates.list) {
  const idx = resolveMonthStartCalIdx(data.calendar, ym);
  if (idx < 0) { console.log(`   ⚠ 시작일 ${ym} — 캘린더에서 찾지 못함(건너뜀)`); continue; }
  startDates.push({ yyyyMm: ym, calIdx: idx, dateISO: data.calendar[idx] });
}
console.log(`시작일 ${startDates.length}개: ${startDates.map(s => s.dateISO).join(', ')}`);

// ── 초기 보유 구성 캐시 (start × scope) ──
const initialCache = new Map<string, InitialHoldingsResult>();
function getInitial(startYyyyMm: string, scope: ScopeId): InitialHoldingsResult {
  const key = `${startYyyyMm}|${scope}`;
  let v = initialCache.get(key);
  if (!v) {
    const sd = startDates.find(s => s.yyyyMm === startYyyyMm)!;
    v = buildInitialHoldings(data.securities, data.fx, sd.calIdx, data.totalBudgetKRW, scopePredicates[scope]);
    initialCache.set(key, v);
  }
  return v;
}

const EXIT_RULE_CFG = C.exitRules;
const REENTRY_STOP_N = C.reentryStop.stopMultipleN;
const MAX_TOTAL_RISK_PCT = C.guards.maxTotalRiskPct;
const MIN_ORDER_KRW = C.guards.minOrderKRW;

function runCycleImpl(
  startYyyyMm: string, exitRuleId: ExitRuleId, combo: ComboConfig,
  costMultiplier: number, cashAnnualRatePct: number, excludeTicker?: string
): PortfolioRunResult {
  const initial = getInitial(startYyyyMm, combo.scope);
  const sizingVariant: SizingVariantConfig = combo.sizing === 'L' || combo.sizing === 'LH'
    ? LUCAS_SIZING[combo.sizing]
    : C.sizingVariants[combo.sizing];
  const baseTradable = scopePredicates[combo.scope];
  const tradable = excludeTicker ? (t: string) => t !== excludeTicker && baseTradable(t) : baseTradable;
  return simulatePortfolio({
    securities: data.securities, fx: data.fx, calendar: data.calendar, initial,
    exitRule: EXIT_RULE_CFG[exitRuleId], stopMultipleN: REENTRY_STOP_N,
    sizing: sizingVariant, positionCapPctOverride: combo.positionCapPct,
    reentryEnabled: true, tradable,
    costMultiplier, cashAnnualRatePct,
    maxTotalRiskPct: MAX_TOTAL_RISK_PCT, minOrderKRW: MIN_ORDER_KRW,
    drawdownScaling: combo.drawdownScaling, drawdownStepDown: C.drawdownScaling.stepDown, drawdownReduce: C.drawdownScaling.reduce,
  });
}

function runBh(startYyyyMm: string, scope: ScopeId): PortfolioRunResult {
  const initial = getInitial(startYyyyMm, scope);
  return simulatePortfolio({
    securities: data.securities, fx: data.fx, calendar: data.calendar, initial,
    exitRule: EXIT_RULE_CFG.W1, stopMultipleN: REENTRY_STOP_N,
    sizing: C.sizingVariants.B, positionCapPctOverride: undefined,
    reentryEnabled: false, tradable: () => false,
    costMultiplier: 1, cashAnnualRatePct: 0,
    maxTotalRiskPct: MAX_TOTAL_RISK_PCT, minOrderKRW: MIN_ORDER_KRW,
    drawdownScaling: false, drawdownStepDown: C.drawdownScaling.stepDown, drawdownReduce: C.drawdownScaling.reduce,
  });
}

function runSellOnly(startYyyyMm: string, exitRuleId: ExitRuleId, scope: ScopeId): PortfolioRunResult {
  const initial = getInitial(startYyyyMm, scope);
  return simulatePortfolio({
    securities: data.securities, fx: data.fx, calendar: data.calendar, initial,
    exitRule: EXIT_RULE_CFG[exitRuleId], stopMultipleN: REENTRY_STOP_N,
    sizing: C.sizingVariants.B, positionCapPctOverride: undefined,
    reentryEnabled: false, tradable: scopePredicates[scope],
    costMultiplier: 1, cashAnnualRatePct: 0,
    maxTotalRiskPct: MAX_TOTAL_RISK_PCT, minOrderKRW: MIN_ORDER_KRW,
    drawdownScaling: false, drawdownStepDown: C.drawdownScaling.stepDown, drawdownReduce: C.drawdownScaling.reduce,
  });
}

// ── 1) B&H·팔기만(주 실행 조건: 기본비용·현금이자0%) 캐시 ──
console.log('\n[1/4] B&H · 팔기만 실행 중...');
const t1 = Date.now();
const bhCache = new Map<string, PortfolioRunResult>(); // key = start|scope
const sellOnlyCache = new Map<string, PortfolioRunResult>(); // key = start|exitRule|scope
for (const sd of startDates) {
  for (const scope of ['S-ALL', 'S-CORE-EXCL'] as ScopeId[]) {
    bhCache.set(`${sd.yyyyMm}|${scope}`, runBh(sd.yyyyMm, scope));
  }
  for (const exitRuleId of ['W1', 'W2', 'W3', 'W4'] as ExitRuleId[]) {
    sellOnlyCache.set(`${sd.yyyyMm}|${exitRuleId}|S-ALL`, runSellOnly(sd.yyyyMm, exitRuleId, 'S-ALL'));
  }
  sellOnlyCache.set(`${sd.yyyyMm}|W1|S-CORE-EXCL`, runSellOnly(sd.yyyyMm, 'W1', 'S-CORE-EXCL'));
  // 조합 목록에 있는데 위에서 안 만든 (청산규칙|적용범위) 쌍 보충 — `--posthoc` 조합 대응(기존 조합엔 영향 없음)
  for (const combo of C.comboList) {
    const key = `${sd.yyyyMm}|${combo.exitRule}|${combo.scope}`;
    if (!sellOnlyCache.has(key)) sellOnlyCache.set(key, runSellOnly(sd.yyyyMm, combo.exitRule, combo.scope));
  }
}
console.log(`   완료 (${Date.now() - t1}ms)`);

// ── [--riskcap] 전체 위험 한도 24% vs 12% 비교 (EXPLORATORY, 동결 config·해시 불변) ──
// P0 계획서(§6): "전체 위험 한도 24%(선택값) vs 12%(원 검증값) 차이를 백테스트로 확인".
// 동결 comboList는 건드리지 않고, 같은 조합(--lucas면 W1L, 아니면 W1G)을 maxTotalRiskPct만 바꿔
// 두 번(24%/12%) 별도로 돌린다. simulatePortfolio는 maxTotalRiskPct를 인자로 받으므로 config.json이나
// comboList를 변경할 필요가 없다(해시 불변 — --posthoc/--lucas와 동일 원칙). bhCache/sellOnlyCache가
// 채워진 뒤(위 1단계)라야 요약에 쓸 B&H/팔기만 대조값을 찾을 수 있어 이 위치에 둔다.
if (RISKCAP) {
  const riskCapComboId = LUCAS ? 'W1L' : 'W1G';
  const riskCapCombo = C.comboList.find(c => c.id === riskCapComboId);
  if (!riskCapCombo) {
    console.log(`\n[--riskcap] 조합 ${riskCapComboId} 을(를) 찾지 못해 건너뜀`);
  } else {
    console.log(`\n[--riskcap] 전체 위험 한도 24% vs 12% 비교 (조합=${riskCapComboId}, EXPLORATORY)...`);
    const sizingVariant: SizingVariantConfig = riskCapCombo.sizing === 'L' || riskCapCombo.sizing === 'LH'
      ? LUCAS_SIZING[riskCapCombo.sizing] : C.sizingVariants[riskCapCombo.sizing as 'B' | 'G' | 'A' | 'C'];
    const baseTradable = scopePredicates[riskCapCombo.scope];

    for (const riskCapPct of [24, 12]) {
      const entries: StartRunEntry[] = [];
      let totalLambdaScaleDays = 0;
      for (const sd of startDates) {
        const initial = getInitial(sd.yyyyMm, riskCapCombo.scope);
        const turtle = simulatePortfolio({
          securities: data.securities, fx: data.fx, calendar: data.calendar, initial,
          exitRule: EXIT_RULE_CFG[riskCapCombo.exitRule], stopMultipleN: REENTRY_STOP_N,
          sizing: sizingVariant, positionCapPctOverride: riskCapCombo.positionCapPct,
          reentryEnabled: true, tradable: baseTradable,
          costMultiplier: 1, cashAnnualRatePct: 0,
          maxTotalRiskPct: riskCapPct, minOrderKRW: MIN_ORDER_KRW,
          drawdownScaling: riskCapCombo.drawdownScaling, drawdownStepDown: C.drawdownScaling.stepDown, drawdownReduce: C.drawdownScaling.reduce,
        });
        totalLambdaScaleDays += turtle.lambdaScaleDays;
        const bh = bhCache.get(`${sd.yyyyMm}|${riskCapCombo.scope}`);
        const sellOnly = sellOnlyCache.get(`${sd.yyyyMm}|${riskCapCombo.exitRule}|${riskCapCombo.scope}`);
        if (bh && sellOnly) entries.push({ startYyyyMm: sd.yyyyMm, turtle, bh, sellOnly });
      }
      if (entries.length > 0) {
        const s = summarizeCombo(entries);
        console.log(
          `  위험한도=${riskCapPct}%  중앙CAGR(터틀)=${(s.medianCagrTurtle * 100).toFixed(2)}% ` +
          `MDD터틀=${(s.medianMddTurtle * 100).toFixed(1)}% 완료거래=${s.completedRoundTrips} ` +
          `λ발동일 합계=${totalLambdaScaleDays} 최대동시재매수=${s.maxConcurrentReenteredAcrossStarts}`
        );
      } else {
        console.log(`  위험한도=${riskCapPct}%  (대응하는 B&H/팔기만 캐시 없음 — 건너뜀)`);
      }
    }
  }
}

// ── 2) 15개 조합 × 12 시작일 (기본비용·현금이자0%) ──
console.log('[2/4] 주 조합(15개) × 시작일(12개) 실행 중...');
const t2 = Date.now();
const primaryEntries = new Map<string, StartRunEntry[]>(); // key = comboId
for (const combo of C.comboList) {
  const entries: StartRunEntry[] = [];
  for (const sd of startDates) {
    const turtle = runCycleImpl(sd.yyyyMm, combo.exitRule, combo, 1, 0);
    const bh = bhCache.get(`${sd.yyyyMm}|${combo.scope}`)!;
    const sellOnly = sellOnlyCache.get(`${sd.yyyyMm}|${combo.exitRule}|${combo.scope}`)!;
    entries.push({ startYyyyMm: sd.yyyyMm, turtle, bh, sellOnly });
  }
  primaryEntries.set(combo.id, entries);
}
console.log(`   완료 (${Date.now() - t2}ms)`);

// ── 3) 민감도(비용 2배 / 현금이자 2.5%) — sensitivitySweep 12개 조합 ──
console.log('[3/4] 민감도(비용 2배·현금이자 2.5%) 실행 중...');
const t3 = Date.now();
const SENSITIVITY_COMBO_IDS = ['W1B', 'W1G', 'W2B', 'W2G', 'W3B', 'W3G', 'W4B', 'W4G', 'W1A', 'W1C', 'W1G_CAP5', 'W1G_CAP15'];
const costDoubleEntries = new Map<string, StartRunEntry[]>();
const cashInterestEntries = new Map<string, StartRunEntry[]>();
for (const comboId of SENSITIVITY_COMBO_IDS) {
  const combo = C.comboList.find(c => c.id === comboId)!;
  const eCost: StartRunEntry[] = [], eCash: StartRunEntry[] = [];
  for (const sd of startDates) {
    const bh = bhCache.get(`${sd.yyyyMm}|${combo.scope}`)!;
    const sellOnly = sellOnlyCache.get(`${sd.yyyyMm}|${combo.exitRule}|${combo.scope}`)!;
    eCost.push({ startYyyyMm: sd.yyyyMm, turtle: runCycleImpl(sd.yyyyMm, combo.exitRule, combo, 2, 0), bh, sellOnly });
    eCash.push({ startYyyyMm: sd.yyyyMm, turtle: runCycleImpl(sd.yyyyMm, combo.exitRule, combo, 1, 2.5), bh, sellOnly });
  }
  costDoubleEntries.set(comboId, eCost);
  cashInterestEntries.set(comboId, eCash);
}
console.log(`   완료 (${Date.now() - t3}ms)`);

// ── 4) LOO(최대 증분기여 종목 1개 제거) — G/A/C 6개 조합 ──
console.log('[4/4] LOO(최대 증분기여 종목 제거) 실행 중...');
const t4 = Date.now();
const LOO_COMBO_IDS = ['W1G', 'W2G', 'W3G', 'W4G', 'W1A', 'W1C', ...(LUCAS ? ['W1L', 'W1L_H', 'W4L', 'W1L_COREEXCL'] : [])];
const BASELINE_FOR: Record<string, string> = {
  W1G: 'W1B', W2G: 'W2B', W3G: 'W3B', W4G: 'W4B', W1A: 'W1B', W1C: 'W1B',
  ...(LUCAS ? { W1L: 'W1B', W1L_H: 'W1B', W4L: 'W4B', W1L_COREEXCL: 'W1B_COREEXCL' } : {}),
};
interface LooResult {
  comboId: string; maxContributorTicker: string; shareOfTotal: number;
  beforeExcessRatio: number; afterExcessRatio: number; directionUnchanged: boolean;
}
const looResults: LooResult[] = [];
for (const comboId of LOO_COMBO_IDS) {
  const variantEntries = primaryEntries.get(comboId)!;
  const baselineEntries = primaryEntries.get(BASELINE_FOR[comboId])!;
  const contribs = incrementalContributions(variantEntries, baselineEntries);
  const conc = maxContributorConcentration(contribs);
  if (!conc || !conc.ticker) {
    looResults.push({ comboId, maxContributorTicker: '(없음)', shareOfTotal: 0, beforeExcessRatio: 0, afterExcessRatio: 0, directionUnchanged: true });
    continue;
  }
  const combo = C.comboList.find(c => c.id === comboId)!;
  const excludedEntries: StartRunEntry[] = [];
  for (const sd of startDates) {
    const turtle = runCycleImpl(sd.yyyyMm, combo.exitRule, combo, 1, 0, conc.ticker);
    const bh = bhCache.get(`${sd.yyyyMm}|${combo.scope}`)!;
    const sellOnly = sellOnlyCache.get(`${sd.yyyyMm}|${combo.exitRule}|${combo.scope}`)!;
    excludedEntries.push({ startYyyyMm: sd.yyyyMm, turtle, bh, sellOnly });
  }
  const ratioOf = (entries: StartRunEntry[]): number => median(entries.map(e => e.bh.finalEquityKRW > 0 ? e.turtle.finalEquityKRW / e.bh.finalEquityKRW : 0));
  const beforeExcess = ratioOf(variantEntries) - ratioOf(baselineEntries);
  const afterExcess = ratioOf(excludedEntries) - ratioOf(baselineEntries);
  looResults.push({
    comboId, maxContributorTicker: conc.ticker, shareOfTotal: conc.shareOfTotal,
    beforeExcessRatio: beforeExcess, afterExcessRatio: afterExcess,
    directionUnchanged: (beforeExcess > 0) === (afterExcess > 0),
  });
}
console.log(`   완료 (${Date.now() - t4}ms)`);

// ── 집계 ──
const comboSummaries: Record<string, ReturnType<typeof summarizeCombo>> = {};
const comboPeriodConsistency: Record<string, ReturnType<typeof periodConsistency>> = {};
const comboPeriodAbsolute: Record<string, ReturnType<typeof periodAbsoluteConsistency>> = {};
const comboMeanR: Record<string, ReturnType<typeof meanRMultiple>> = {};
for (const [id, entries] of primaryEntries) {
  comboSummaries[id] = summarizeCombo(entries);
  comboPeriodConsistency[id] = periodConsistency(entries);
  comboPeriodAbsolute[id] = periodAbsoluteConsistency(entries);
  comboMeanR[id] = meanRMultiple(entries);
}
const costDoubleSummaries: Record<string, ReturnType<typeof summarizeCombo>> = {};
const cashInterestSummaries: Record<string, ReturnType<typeof summarizeCombo>> = {};
for (const id of SENSITIVITY_COMBO_IDS) {
  costDoubleSummaries[id] = summarizeCombo(costDoubleEntries.get(id)!);
  cashInterestSummaries[id] = summarizeCombo(cashInterestEntries.get(id)!);
}

// ── 판정기준(§⑥ 1~7) 프로그램적 평가 — 8·9는 비교형이라 리포트에서 서술 ──
interface AdoptionEval {
  comboId: string;
  crit1_trades30: boolean;
  crit2_baseCagrPos: boolean;
  crit3_doubleCostCagrPos: boolean | null;
  crit4_period2of3: boolean;
  crit5_looDirectionUnchanged: boolean | null;
  crit6_maxContributorUnder50: boolean | null;
  crit7_zeroInvariantViolations: boolean;
  allApplicablePass: boolean;
}
const adoptionEval: AdoptionEval[] = C.comboList.map(combo => {
  const s = comboSummaries[combo.id];
  const pa = comboPeriodAbsolute[combo.id];
  const period2of3 = Object.values(pa).filter(v => v.meanCagr > 0).length >= 2;
  const loo = looResults.find(l => l.comboId === combo.id) ?? null;
  const doubleSummary = costDoubleSummaries[combo.id];
  const crit1 = s.completedRoundTrips >= 30;
  const crit2 = s.medianCagrTurtle > 0;
  const crit3 = doubleSummary ? doubleSummary.medianCagrTurtle > 0 : null;
  const crit5 = loo ? loo.directionUnchanged : null;
  const crit6 = loo ? loo.shareOfTotal <= 0.5 : null;
  const crit7 = s.totalInvariantViolations === 0;
  const applicable = [crit1, crit2, crit3 ?? true, period2of3, crit5 ?? true, crit6 ?? true, crit7];
  return {
    comboId: combo.id, crit1_trades30: crit1, crit2_baseCagrPos: crit2, crit3_doubleCostCagrPos: crit3,
    crit4_period2of3: period2of3, crit5_looDirectionUnchanged: crit5, crit6_maxContributorUnder50: crit6,
    crit7_zeroInvariantViolations: crit7, allApplicablePass: applicable.every(Boolean),
  };
});

const assetClassPnl: Record<string, Record<string, number>> = {};
for (const id of ['W1B', 'W1G', 'W2B', 'W2G', 'W3B', 'W3G', 'W4B', 'W4G']) {
  assetClassPnl[id] = Object.fromEntries(pnlByAssetClass(primaryEntries.get(id)!));
}

// ── 산출물 저장 ──
if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });

writeFileSync(path.join(DB_DIR, 'results.json'), JSON.stringify({
  generatedAt: new Date().toISOString(), configHash: hash, csvPath,
  totalBudgetKRW: data.totalBudgetKRW, universeCount: data.securities.length, missing: data.missing,
  scopeCounts: Object.fromEntries(scopeCounts),
  startDates: startDates.map(s => ({ yyyyMm: s.yyyyMm, dateISO: s.dateISO })),
  comboSummaries, comboPeriodConsistency, comboPeriodAbsolute, comboMeanR,
  costDoubleSummaries, cashInterestSummaries, looResults, assetClassPnl, adoptionEval,
}, null, 2));

const scopeMd: string[] = ['# 적용범위(S-CORE-EXCL) 분류 — 로컬 전용(개인정보)\n'];
for (const sec of data.securities) {
  scopeMd.push(`- ${sec.ticker} (${sec.name}) [${sec.assetClass}] → ${sec.scopeClass}`);
}
writeFileSync(path.join(DB_DIR, 'scope_classification.md'), scopeMd.join('\n') + '\n');

const contribMd: string[] = ['# 조합별 종목 기여(재매수분 pnl) — 로컬 전용(개인정보)\n'];
for (const id of ['W1G', 'W2G', 'W3G', 'W4G', 'W1A', 'W1C']) {
  contribMd.push(`\n## ${id}`);
  const variantEntries = primaryEntries.get(id)!;
  const baselineEntries = primaryEntries.get(BASELINE_FOR[id])!;
  const contribs = incrementalContributions(variantEntries, baselineEntries).sort((a, b) => Math.abs(b.incrementalPnlKRW) - Math.abs(a.incrementalPnlKRW));
  for (const c of contribs.slice(0, 15)) {
    contribMd.push(`- ${c.ticker}: 증분손익 ${(c.incrementalPnlKRW / 1e4).toFixed(0)}만원`);
  }
}
writeFileSync(path.join(DB_DIR, '종목별_기여.md'), contribMd.join('\n') + '\n');

console.log(`\n로컬 산출물: DB/portfolioTurtle/{results.json, scope_classification.md, 종목별_기여.md}`);

// ── 콘솔 요약(집계만) ──
console.log('\n' + '='.repeat(100));
console.log('조합별 요약 (12개 시작일 집계, 기본비용·현금이자0%)');
console.log('='.repeat(100));
for (const combo of C.comboList) {
  const s = comboSummaries[combo.id];
  console.log(
    `${combo.id.padEnd(14)} n=${s.n} 중앙CAGR(터틀)=${(s.medianCagrTurtle * 100).toFixed(2)}% ` +
    `중앙CAGR(B&H)=${(s.medianCagrBh * 100).toFixed(2)}% 중앙CAGR(팔기만)=${(s.medianCagrSellOnly * 100).toFixed(2)}% ` +
    `MDD터틀=${(s.medianMddTurtle * 100).toFixed(1)}% MDD B&H=${(s.medianMddBh * 100).toFixed(1)}% ` +
    `Calmar터틀=${s.medianCalmarTurtle.toFixed(2)} 최종비율(터틀/BH)=${s.medianFinalRatioVsBh.toFixed(3)} ` +
    `승률=${(s.turtleWinRateVsBh * 100).toFixed(0)}% 완료거래=${s.completedRoundTrips} λ발동일=${s.totalLambdaScaleDays} ` +
    `최대동시재매수=${s.maxConcurrentReenteredAcrossStarts} 위반=${s.totalInvariantViolations} ` +
    `회복일(터틀/BH)=${s.medianRecoveryDaysTurtle ?? 'N/A'}/${s.medianRecoveryDaysBh ?? 'N/A'} 평균현금%=${(s.medianAvgCashPct * 100).toFixed(1)}`
  );
}

console.log('\n── 3구간 일관성(터틀-BH CAGR 초과분 평균, 서술용) ──');
for (const combo of C.comboList) {
  const pc = comboPeriodConsistency[combo.id];
  const positive = Object.values(pc).filter(v => v.meanExcessCagr > 0).length;
  console.log(`  ${combo.id.padEnd(14)} ${positive}/3 구간 양수 — ` + Object.entries(pc).map(([k, v]) => `${k}:${(v.meanExcessCagr * 100).toFixed(2)}%p(n${v.n})`).join(' '));
}

console.log('\n── 3구간 일관성(판정기준4 원정의 — 터틀 자체 CAGR 절대치) ──');
for (const combo of C.comboList) {
  const pa = comboPeriodAbsolute[combo.id];
  const positive = Object.values(pa).filter(v => v.meanCagr > 0).length;
  console.log(`  ${combo.id.padEnd(14)} ${positive}/3 구간 양수 — ` + Object.entries(pa).map(([k, v]) => `${k}:${(v.meanCagr * 100).toFixed(2)}%(n${v.n})`).join(' '));
}

console.log('\n── 재매수분 평균 R (완료거래 pnl÷1R) ──');
for (const combo of C.comboList) {
  const r = comboMeanR[combo.id];
  console.log(`  ${combo.id.padEnd(14)} n=${r.n} 평균R=${r.meanR.toFixed(3)}`);
}

console.log('\n── 판정기준(§⑥) 1~7 평가 ──');
for (const a of adoptionEval) {
  console.log(`  ${a.comboId.padEnd(14)} 1(거래30+)=${a.crit1_trades30} 2(기본CAGR>0)=${a.crit2_baseCagrPos} 3(2배비용CAGR>0)=${a.crit3_doubleCostCagrPos} 4(구간2/3)=${a.crit4_period2of3} 5(LOO방향유지)=${a.crit5_looDirectionUnchanged} 6(집중도<50%)=${a.crit6_maxContributorUnder50} 7(불변식0)=${a.crit7_zeroInvariantViolations} → 전체통과=${a.allApplicablePass}`);
}

console.log('\n── 민감도: 비용 2배 (기본비용 대비 median 터틀CAGR 변화) ──');
for (const id of SENSITIVITY_COMBO_IDS) {
  console.log(`  ${id.padEnd(14)} base=${(comboSummaries[id].medianCagrTurtle * 100).toFixed(2)}% double=${(costDoubleSummaries[id].medianCagrTurtle * 100).toFixed(2)}%`);
}
console.log('\n── 민감도: 현금이자 2.5% ──');
for (const id of SENSITIVITY_COMBO_IDS) {
  console.log(`  ${id.padEnd(14)} 0%=${(comboSummaries[id].medianCagrTurtle * 100).toFixed(2)}% 2.5%=${(cashInterestSummaries[id].medianCagrTurtle * 100).toFixed(2)}%`);
}

console.log('\n── LOO(최대 증분기여 종목 1개 제거) ──');
for (const l of looResults) {
  console.log(`  ${l.comboId.padEnd(8)} 최대기여종목 집중도=${(l.shareOfTotal * 100).toFixed(1)}% 제거전초과비율=${l.beforeExcessRatio.toFixed(4)} 제거후=${l.afterExcessRatio.toFixed(4)} 방향불변=${l.directionUnchanged}`);
}

console.log('\n── 자산군별 기여(재매수분 pnl 합, 만원) ──');
for (const id of ['W1B', 'W1G', 'W2B', 'W2G', 'W3B', 'W3G', 'W4B', 'W4G']) {
  console.log(`  [${id}]`);
  for (const [ac, pnl] of Object.entries(assetClassPnl[id])) console.log(`    ${ac.padEnd(10)} ${(pnl / 1e4).toFixed(0)}만원`);
}

console.log('\n' + '='.repeat(100));
console.log(`전체 소요 ${((Date.now() - t0) / 1000).toFixed(1)}초. 리포트는 docs/backtest/REPORT_2차_포트폴리오_터틀_260925.md 참고(수동 작성).`);
console.log('='.repeat(100));
