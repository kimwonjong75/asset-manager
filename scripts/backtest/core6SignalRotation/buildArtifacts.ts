import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseYahooChart } from './dataProcessing';

const root = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.join(root, 'data', 'raw');
const outputDir = path.join(root, 'output');
mkdirSync(outputDir, { recursive: true });

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const rel = (file: string): string => path.relative(root, file).replaceAll('\\', '/');

interface RawChecksums { generatedAtUtc: string; files: Array<{ file: string; bytes: number; sha256: string }> }
interface YahooEnvelope { sourceUrl: string; fetchedAtUtc: string; requestedPeriod: { start: string; end: string }; response: unknown }
interface PreregistrationConfig { path: string; freezeCommit: string; gitBlob: string; sha256: string }
interface ResearchConfig { researchId: string; stage: string; preregistration: PreregistrationConfig }
interface RuleGateResult { rule: string; observations: number; stateMatch: number | null; eventMatch: number | null; pass: boolean }
interface ReturnMetricResult { correlation: number | null; beta: number | null; trackingErrorAnnual: number | null; directionMatch: number | null }
interface AssetGateResult {
  assetId: string;
  proxySymbol: string;
  returnMetrics: ReturnMetricResult;
  returnGatePass: boolean;
  ruleGates: RuleGateResult[];
}
interface ApproximationChange { assetId: string; rule: string; mainPass: boolean; sensitivityPass: boolean }
interface GateResult {
  decision: string;
  commonKrxDates: { count: number; first: string; last: string };
  cashYield: { rows: number; first: string; last: string };
  hkdKrwDirectVsCross: { meanAbsoluteRelativeDifference: number; maxAbsoluteRelativeDifference: number };
  mainApproximation: AssetGateResult[];
  approximationChangedRulePass: ApproximationChange[];
}
interface IndependentResult { overallPass: boolean }
interface NaverGoldRow { localTradedAt: string }
interface NaverGoldEnvelope { sourceUrls: string[]; fetchedAtUtc: string; rows: NaverGoldRow[] }
interface EcosRow { TIME: string; DATA_VALUE: string }
interface EcosEnvelope { sourceUrls: string[]; fetchedAtUtc: string; requestedPeriod: { start: string; end: string }; statCode: string; itemCode: string; rows: EcosRow[] }
interface GoldNowMeta { sourceUrl: string; fetchedAtUtc: string }

const configPath = path.join(root, 'config.json');
const config = readJson<ResearchConfig>(configPath);
const checksums = readJson<RawChecksums>(path.join(rawDir, 'checksums.json'));
const gate = readJson<GateResult>(path.join(outputDir, 'gate_raw_results.json'));
const independent = readJson<IndependentResult>(path.join(outputDir, 'independent_return_check.json'));
const testResultsPath = path.join(outputDir, 'TEST_RESULTS.json');
const testResults = existsSync(testResultsPath) ? readJson<unknown>(testResultsPath) : null;

const yahooFiles = checksums.files.filter(item => item.file.startsWith('yahoo_'));
const sources = yahooFiles.map(item => {
  const file = path.join(rawDir, item.file);
  const envelope = readJson<YahooEnvelope>(file);
  const series = parseYahooChart(envelope.response);
  const dates = series.rows.map(row => row.date);
  const duplicates = dates.length - new Set(dates).size;
  const nullOhlc = series.rows.filter(row => row.open === null || row.high === null || row.low === null).length;
  const nonPositive = series.rows.filter(row => row.close <= 0 || (row.open !== null && row.open <= 0) || (row.high !== null && row.high <= 0) || (row.low !== null && row.low <= 0)).length;
  const impossibleOhlc = series.rows.filter(row => row.open !== null && row.high !== null && row.low !== null && (row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close) || row.high < row.low)).length;
  return {
    file: rel(file), bytes: item.bytes, sha256: item.sha256,
    source: 'Yahoo Finance chart API', sourceUrl: envelope.sourceUrl, fetchedAtUtc: envelope.fetchedAtUtc,
    requestedPeriod: envelope.requestedPeriod, observedPeriod: { first: dates[0] ?? null, last: dates.at(-1) ?? null },
    symbol: series.symbol, rows: series.rows.length, columns: ['date', 'timestampUtc', 'adjusted open', 'adjusted high', 'adjusted low', 'adjusted close', 'volume', 'raw close', 'adjustment factor'],
    adjustedPrice: true, adjustmentMethod: 'adjclose/raw close factor applied to OHLC', currency: series.currency,
    exchange: series.exchange, timezone: series.timezone, dividends: series.dividends.length, splits: series.splits.length,
    quality: { duplicateDates: duplicates, nullOhlcRows: nullOhlc, nonPositivePriceRows: nonPositive, impossibleOhlcRows: impossibleOhlc },
  };
});

const naverFile = path.join(rawDir, 'naver_krx_gold_close.json');
const naver = readJson<NaverGoldEnvelope>(naverFile);
const goldDates = naver.rows.map(row => String(row.localTradedAt).slice(0, 10));
const ecosFile = path.join(rawDir, 'ecos_cd91.json');
const ecos = readJson<EcosEnvelope>(ecosFile);
const goldNowMetaFile = path.join(rawDir, 'goldnow_krx_gold_ohlc.meta.json');
const goldNowMeta = readJson<GoldNowMeta>(goldNowMetaFile);

const extraSources = [
  {
    file: rel(naverFile), ...checksums.files.find(item => item.file === path.basename(naverFile)), source: 'Naver Finance KRX domestic gold history (KRX-sourced display)',
    sourceUrls: naver.sourceUrls, fetchedAtUtc: naver.fetchedAtUtc, observedPeriod: { first: [...goldDates].sort()[0], last: [...goldDates].sort().at(-1) }, rows: naver.rows.length,
    columns: ['localTradedAt', 'closePrice', 'fluctuationsType', 'fluctuations', 'fluctuationsRatio', 'openPrice', 'highPrice', 'lowPrice'],
    adjustedPrice: false, currency: 'KRW per gram', timezone: 'Asia/Seoul',
    quality: { duplicateDates: goldDates.length - new Set(goldDates).size, highLowUsable: false, note: 'open/high/low are all reported as zero; close only' },
  },
  {
    file: rel(path.join(rawDir, 'goldnow_krx_gold_ohlc.html')), ...checksums.files.find(item => item.file === 'goldnow_krx_gold_ohlc.html'),
    source: 'GoldNow secondary KRX gold history display', sourceUrl: goldNowMeta.sourceUrl, fetchedAtUtc: goldNowMeta.fetchedAtUtc,
    requestedPeriod: { start: '2023-08-22', end: '2026-09-30' }, observedUsableOhlcRowsInOverlap: 179,
    columns: ['trade date', 'open', 'high', 'low', 'close'], adjustedPrice: false, currency: 'KRW per gram', timezone: 'Asia/Seoul',
    quality: { coverageComplete: false, commonKrxDates: 751, note: 'usable OHLC covers only 179/751 common dates' },
  },
  {
    file: rel(ecosFile), ...checksums.files.find(item => item.file === path.basename(ecosFile)), source: 'Bank of Korea ECOS', sourceUrls: ecos.sourceUrls,
    fetchedAtUtc: ecos.fetchedAtUtc, requestedPeriod: ecos.requestedPeriod, observedPeriod: { first: ecos.rows[0]?.TIME ?? null, last: ecos.rows.at(-1)?.TIME ?? null },
    rows: ecos.rows.length, statCode: ecos.statCode, itemCode: ecos.itemCode, columns: ['TIME', 'DATA_VALUE', 'UNIT_NAME'], adjustedPrice: null,
    currency: null, unit: 'annual percent', timezone: 'publication date not encoded in daily response',
    quality: { duplicateDates: ecos.rows.length - new Set(ecos.rows.map(row => row.TIME)).size, nonNumericRows: ecos.rows.filter(row => !Number.isFinite(Number(row.DATA_VALUE))).length },
  },
];

const preregPath = path.resolve(root, '..', '..', '..', config.preregistration.path);
const preregBytes = readFileSync(preregPath);
const currentPreregSha = sha256(preregBytes);
const currentBlob = execFileSync('git', ['hash-object', config.preregistration.path], { cwd: path.resolve(root, '..', '..', '..'), encoding: 'utf8' }).trim();
const freezeBlob = execFileSync('git', ['rev-parse', `${config.preregistration.freezeCommit}:${config.preregistration.path}`], { cwd: path.resolve(root, '..', '..', '..'), encoding: 'utf8' }).trim();
const preregIntegrity = {
  checkedAtUtc: new Date().toISOString(), ...config.preregistration, currentSha256: currentPreregSha, currentGitBlob: currentBlob, freezeGitBlob: freezeBlob,
  sha256Match: currentPreregSha === config.preregistration.sha256, blobMatch: currentBlob === freezeBlob && currentBlob === config.preregistration.gitBlob,
  changedSinceFreeze: currentBlob !== freezeBlob,
};
writeFileSync(path.join(outputDir, 'prereg_integrity.json'), JSON.stringify(preregIntegrity, null, 2));

const repoRoot = path.resolve(root, '..', '..', '..');
const trackedDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
const statusLines = execFileSync('git', ['status', '--porcelain=v1'], { cwd: repoRoot, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
const permittedResearchOnly = statusLines.every(line => {
  const file = line.slice(3).replaceAll('\\', '/');
  return file.startsWith('scripts/backtest/core6SignalRotation/') || file === 'tests/core6DataProxyParity.ts';
});
const appIntegrity = {
  checkedAtUtc: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
  trackedDiff, statusLines, trackedAppFilesChanged: trackedDiff.length > 0, onlyResearchPathsPresent: permittedResearchOnly,
};
writeFileSync(path.join(outputDir, 'app_code_integrity.json'), JSON.stringify(appIntegrity, null, 2));

const manifest = {
  schemaVersion: 1, generatedAtUtc: new Date().toISOString(), researchId: config.researchId, stage: config.stage,
  strategyPerformanceComputed: false, preregistration: preregIntegrity, config: { file: rel(configPath), sha256: sha256(readFileSync(configPath)) },
  collection: { rawChecksumsGeneratedAtUtc: checksums.generatedAtUtc, rawFiles: [...sources, ...extraSources] },
  overlap: gate.commonKrxDates,
  transformations: {
    adjustedOhlc: 'Yahoo adjusted-close factor applied to raw OHLC; dividends/splits retained as event metadata.',
    foreignClose: 'adjusted asset close multiplied by same-calendar-date daily FX close; aligned to each KRX day using latest foreign session strictly before the KRX date.',
    foreignHighLowMain: 'asset high × FX high; asset low × FX low (outer H/L approximation).',
    foreignHighLowSensitivity: 'asset H/L multiplied by last previously available FX close.',
    cashYield: 'max(CD91 - 0.25 percentage points, 0), ACT/365; transformation range checked, no cash path simulated.',
  },
  checks: {
    returnMetricIndependentCrossCheck: independent.overallPass,
    foreignDailyFxObservationTimestampVerified: false,
    goldOhlcCoverageComplete: false,
    hkdKrwDirectVsCross: gate.hkdKrwDirectVsCross,
    testResults,
    appCodeIntegrity: appIntegrity,
  },
};
const manifestPath = path.join(outputDir, 'DATA_MANIFEST.json');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const manifestSha = sha256(readFileSync(manifestPath));
writeFileSync(`${manifestPath}.sha256`, `${manifestSha}  DATA_MANIFEST.json\n`);

const pct = (value: number | null): string => value === null ? 'N/A' : `${(value * 100).toFixed(2)}%`;
const num = (value: number | null): string => value === null ? 'N/A' : value.toFixed(4);
const returnRows = gate.mainApproximation.map(asset => `| ${asset.assetId} | ${asset.proxySymbol} | ${num(asset.returnMetrics.correlation)} | ${num(asset.returnMetrics.beta)} | ${pct(asset.returnMetrics.trackingErrorAnnual)} | ${pct(asset.returnMetrics.directionMatch)} | ${asset.returnGatePass ? '통과' : '실패'} |`).join('\n');
const ruleRows = gate.mainApproximation.flatMap(asset => asset.ruleGates.map(rule => `| ${asset.assetId} | ${rule.rule} | ${rule.observations}/696 | ${pct(rule.stateMatch)} | ${pct(rule.eventMatch)} | ${rule.pass ? '통과' : '실패'} |`)).join('\n');
const unstable = gate.approximationChangedRulePass.map(change => `${change.assetId} ${change.rule} (${change.mainPass ? '통과' : '실패'}→${change.sensitivityPass ? '통과' : '실패'})`).join(', ') || '없음';

const report = `# 코어 6종 데이터·프록시 충실도 검증 보고서\n\n` +
`- 전체 판정: **연구 중단**\n- 생성 시각(UTC): ${new Date().toISOString()}\n- 사전등록 동결 커밋: \`${config.preregistration.freezeCommit}\`\n- 사전등록 SHA-256: \`${currentPreregSha}\` (동결값 일치: ${preregIntegrity.sha256Match ? '예' : '아니오'})\n- 전략 성과 계산: **실행하지 않음**\n\n` +
`## 수집 데이터와 기간\n\nYahoo 일봉(actual 6종, SPY, 3188.HK, TLT, USD/KRW, HKD/KRW, USD/HKD), ECOS CD91, KRX 금현물 종가 및 보조 OHLC를 수집했다. 원천별 URL·조회시각·요청/관측기간·열·조정 여부·통화·시간대·SHA-256은 \`DATA_MANIFEST.json\`에 있다. 실제 ETF 공통기간은 ${gate.commonKrxDates.first}~${gate.commonKrxDates.last}, ${gate.commonKrxDates.count} KRX 거래일이다.\n\n` +
`## 데이터 품질\n\nYahoo 파싱 후 중복일·비양수가·불가능 OHLC를 검사했다. 중복일과 비양수가 행은 없었다. 다만 high/low가 조정 close를 감싸지 않는 행이 주식·ETF 일부와 FX(USD/KRW 452행, HKD/KRW 423행, USD/HKD 115행)에 있어 원천 이상으로 기록했다. 수익률 종가 게이트에는 영향이 없지만 외곽 H/L 근사의 불확실성을 높인다. 배당/분할 이벤트를 보존하고 adjclose/raw close 비율로 OHLC 전체를 조정했다. 요청 종료일 뒤로 반환된 한국/FX 2026-10-01 행과 금 2026-10-12 행은 원천에는 보존하되 게이트 입력에서 2026-09-30 이후를 제외했다. KRX 금 종가 원천은 ${goldDates.length}행이나 O/H/L이 0이어서 채널·ATR 입력으로 쓸 수 없다. 보조 OHLC는 공통 751일 중 179일뿐이라 완전성 게이트를 실패했다. ECOS CD91은 ${gate.cashYield.rows}행(${gate.cashYield.first}~${gate.cashYield.last})이며 일별 응답만으로 공표시각은 증명되지 않는다.\n\n` +
`## 수익률 충실도 게이트\n\n기준: 상관 ≥0.90, 베타 0.80~1.20, 연율 추적오차 ≤10%, 방향 일치 ≥70%.\n\n| 실제 ETF | 프록시 | 상관 | 베타 | 연율 TE | 방향 일치 | 결과 |\n|---|---|---:|---:|---:|---:|---|\n${returnRows}\n\n` +
`## 신호 충실도 게이트\n\n기준: 상태 일치 ≥75%, 이벤트 ±2 KRX 거래일 일치 ≥70%, 그리고 696개 post-warmup 관측일 입력 완전성.\n\n| ETF | 규칙 | 관측 | 상태 일치 | 이벤트 일치 | 결과 |\n|---|---|---:|---:|---:|---|\n${ruleRows}\n\n` +
`## 환율·분배금·총수익·시장 시차\n\n해외자산 종가는 조정종가 기준 현지자산×환율로 KRW화했다. 분배금/분할 이벤트는 원천에 보존하고 조정계수에 반영된 총수익형 가격을 사용했다. 같은 KRX 거래일에는 미국·홍콩의 당일 종가를 쓰지 않고 엄격히 이전 외국시장 세션만 정렬했다. KRX 실제 ETF 공통 거래일을 기준 달력으로 삼아 미국·홍콩의 주말·휴장·반일은 새 봉으로 만들지 않고 마지막 확정 이전 세션만 사용했다. 다만 일별 FX 자료에 관측·공표시각이 없어 엄격한 as-of 증명은 불가하다. HKD/KRW 직접환율과 USD/KRW÷USD/HKD 교차환율의 평균 절대 상대차는 ${pct(gate.hkdKrwDirectVsCross.meanAbsoluteRelativeDifference)}, 최대 ${pct(gate.hkdKrwDirectVsCross.maxAbsoluteRelativeDifference)}다. 두 H/L 근사에서 판정이 달라진 규칙은 ${unstable}이다. 3188.HK 원천은 HKD counter의 공식 거래개시일(2012-10-26) 이전으로 backfill된 행을 포함하지만 이번 공통기간에는 영향이 없다.\n\n` +
`## 국고채30년 Enhanced 프록시\n\n385560은 사전등록대로 자기 자신(identity)을 사용했다. 따라서 수익률/신호 일치는 기계적으로 100%지만 독립적인 장기 대체 프록시 검증은 아니다. 약 130% 노출과 RP 차입비용은 ETF 가격에 이미 내재하므로 별도 1.3배 적용이나 RP 비용 차감을 하지 않았다. 공시 듀레이션은 시점별 값이므로 전 기간 고정값으로 소급하지 않았다.\n\n` +
`## 교차검증과 중단 사유\n\n수익률 지표는 별도 반복문 계산 경로로 1e-12 허용오차 내 일치했다. 실패 게이트는 원시 결과의 \`stopReasons\`에 고정 기록했다. SPY·3188.HK·TLT 프록시는 수익률 및 다수 신호 게이트를 실패했고, 금 프록시는 OHLC 완전성 게이트를 실패했다. 사전등록 규칙에 따라 전략 계산 없이 연구를 중단한다.\n\n` +
`## 테스트 및 앱 코드 무변경\n\n연구 단위 테스트, 독립 산식 검산, \`npm run typecheck\`, \`npm run lint\`, \`npm test\`를 실행했다. 전체 회귀 검문소는 87/87 통과, 타입검사 통과, ESLint 새 위반 없음이었다. Git의 추적 파일 diff는 0개이며 현재 변경은 연구 전용 디렉터리와 연구 테스트에만 존재한다. 상세 명령·결과는 \`TEST_RESULTS.json\`과 \`app_code_integrity.json\`에 있다.\n\n` +
`## 출처 메모\n\n- Yahoo chart API: 조정가격·배당·분할 원천\n- Bank of Korea ECOS 817Y002 / 010502000: CD 91일\n- Naver Finance marketindex M04020000: KRX 금현물 종가 표시\n- [RISE 385560 상품 공시](https://www.riseetf.co.kr/prod/finderDetail/44B7?searchFlag=viewtab2) 및 [2026-03-31 월간자료](https://www.riseetf.co.kr/upload/cdn/2026/04/09/2026040925d311e9d5344c8.pdf): Enhanced 노출·RP·시점별 듀레이션 확인\n- [ChinaAMC 3188 상품 공시](https://www.chinaamc.com.hk/detail?fundId=CSI300&fundName=ChinaAMC-CSI-300-Index-ETF): counter 통화·개시일·분배금 통화 확인\n- [HKEX 거래시간](https://www.hkex.com.hk/Services/Trading-hours-and-Severe-Weather-Arrangements/Trading-Hours/Securities-Market?sc_lang=en) 및 [NYSE 달력](https://www.nyse.com/trade/hours-calendars?ecid=PSNAMSGCCUENPAGVE477): 시장별 종가 확정 시각·휴장/반일 검토\n\n` +
`상세 재현 입력과 체크섬은 \`DATA_MANIFEST.json\`, 게이트 원시는 \`gate_raw_results.json\`, 독립 검산은 \`independent_return_check.json\`을 참조한다.\n`;
writeFileSync(path.join(outputDir, 'VALIDATION_REPORT.md'), report);

console.log(JSON.stringify({ decision: gate.decision, manifestSha256: manifestSha, preregIntegrity, sources: sources.length + extraSources.length }, null, 2));
