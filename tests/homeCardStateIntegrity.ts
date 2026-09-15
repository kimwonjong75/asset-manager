// tests/homeCardStateIntegrity.ts
// ---------------------------------------------------------------------------
// 홈/차트/매매계획 표면 무결성 골든 테스트 (Stage C P2).
//   접이식 카드를 공용 Card로 옮기면서 localStorage 키 문자열이 바뀌면 사용자의 펼침 상태가
//   조용히 초기화되고, summary를 빠뜨리면 접힌 헤더에서 건수가 사라진다(신호 은폐). 에러 없이
//   깨지는 종류라 소스 파일을 직접 읽어 **명시적 문자열**로 고정한다(경로 A-vs-B 비교 금지).
//     ① storageKey 리터럴 6종이 해당 파일에 그대로 존재
//     ② GuruSignalCard / ReferenceIndicatorsSection / RiskCalculatorCard 가 Card 에 summary 전달
//     ③ 소유 파일에 이모지 없음(🐢 만 허용) + 대체된 글리프(✓✗⚠ⓘ■▾▸▴▲▼) 없음
//     ④ 오버레이가 아닌 카드 파일에 shadow- 클래스 없음(AlertPopup·MemoTooltip 오버레이 예외)
// 수동 실행: npx tsx tests/homeCardStateIntegrity.ts. 통과 시 exit 0, 실패 시 exit 1.

import { readFileSync } from 'node:fs';
import path from 'node:path';

// verify.mjs·수동 실행 모두 저장소 루트에서 실행된다(ESM이라 __dirname 없음)
const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0;
const fails: string[] = [];
function check(cond: boolean, msg: string): void {
  if (cond) pass++;
  else fails.push(`✗ ${msg}`);
}

// ① storageKey 리터럴 (Stage C 전후 동일해야 함)
const STORAGE_KEYS: Array<[file: string, key: string]> = [
  ['components/layouts/DashboardView.tsx', "'asset-manager-guru-card-open'"],
  ['components/layouts/DashboardView.tsx', "'asset-manager-profitloss-open'"],
  ['components/dashboard/ReferenceIndicatorsSection.tsx', "'asset-manager-reference-indicators-open'"],
  ['components/dashboard/RiskCalculatorCard.tsx', "'asset-manager-risk-calc-open'"],
  ['components/today/PrepareSection.tsx', "'asset-manager-today-prepare-open'"],
  ['components/today/TodayActionCenter.tsx', "'asset-manager-today-watch-open'"],
];
for (const [file, key] of STORAGE_KEYS) {
  const src = read(file);
  // DashboardView는 JSX 속성(storageKey="...")으로 넘기므로 따옴표 종류 무관하게 본문 문자열로 확인
  const bare = key.slice(1, -1);
  check(src.includes(`'${bare}'`) || src.includes(`"${bare}"`), `${file} 에 storageKey ${key} 없음`);
}

// ② 접힌 헤더 summary 전달
for (const file of [
  'components/dashboard/GuruSignalCard.tsx',
  'components/dashboard/ReferenceIndicatorsSection.tsx',
  'components/dashboard/RiskCalculatorCard.tsx',
]) {
  const src = read(file);
  check(/<Card\b/.test(src), `${file} 가 공용 Card 를 쓰지 않음`);
  check(/\bsummary=\{/.test(src), `${file} 가 Card 에 summary 를 넘기지 않음`);
}
// 과열 건수와 신호 건수 문구가 summary 쪽에 남아 있는지(접힘 시 은폐 금지)
check(read('components/dashboard/ReferenceIndicatorsSection.tsx').includes('과열 {riskTieredCount}'), '참고 지표 summary 에 "과열 N" 없음');
{
  const guru = read('components/dashboard/GuruSignalCard.tsx');
  check(guru.includes('`신호 ${distinctAssets}종목`') && guru.includes("'신호 없음'"), '구루 카드 summary 에 "신호 N종목/신호 없음" 없음');
}

// ③④ 소유 파일
const OWNED_COMPONENTS = [
  'components/layouts/DashboardView.tsx',
  'components/dashboard/GuruSignalCard.tsx',
  'components/dashboard/ProfitLossChart.tsx',
  'components/dashboard/ReferenceIndicatorsSection.tsx',
  'components/dashboard/RiskCalculatorCard.tsx',
  'components/dashboard/RiskMatrixPanel.tsx',
  'components/dashboard/MarketOverviewBar.tsx',
  'components/dashboard/MarketOverviewCharts.tsx',
  'components/dashboard/TodayTurtleCard.tsx',
  'components/dashboard/SoldAssetsStats.tsx',
  'components/dashboard/AllocationChart.tsx',
  'components/dashboard/CategorySummaryTable.tsx',
  'components/dashboard/RebalancingTable.tsx',
  'components/dashboard/HomeSnapshotCard.tsx',
  'components/dashboard/DashboardControls.tsx',
  'components/today/NeedsCheckSection.tsx',
  'components/today/PendingOrdersSection.tsx',
  'components/today/PlanlessHoldingsSection.tsx',
  'components/today/PrepareSection.tsx',
  'components/today/TierRowList.tsx',
  'components/today/TodayActionCenter.tsx',
  'components/today/TodaySection.tsx',
  'components/today/UrgentSection.tsx',
  'components/today/WatchSection.tsx',
  'components/trade-plan/TradePlanCard.tsx',
  'components/trade-plan/TradePlanSection.tsx',
  'components/trade-plan/TradePlanEditor.tsx',
  'components/trade-plan/TradePlanIntro.tsx',
  'components/trade-plan/KakaoStatusChip.tsx',
  'components/execution/ExecutionView.tsx',
  'components/execution/WhyNoOrderPanel.tsx',
  'components/common/AlertPopup.tsx',
  'components/common/PositionSizingCalculator.tsx',
  'components/common/MemoTooltip.tsx',
  'components/stock-review/StockReviewAccordion.tsx',
  'components/stock-review/StockReviewPanel.tsx',
  'components/AssetTrendChart.tsx',
  'components/MarketDistributionBanner.tsx',
  'components/StatCard.tsx',
  'components/SellAnalyticsPage.tsx',
];
const EMOJI_SCAN = [...OWNED_COMPONENTS, 'constants/briefingDescriptions.ts'];
const OVERLAY_EXEMPT = new Set(['components/common/AlertPopup.tsx', 'components/common/MemoTooltip.tsx']);

const TURTLE = '\u{1F422}';
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
// Stage C에서 lucide로 대체한 글리프 — 주석이 아닌 곳에 다시 들어오면 실패
const REPLACED_GLYPHS = ['✓', '✗', '⚠', 'ⓘ', '■', '▾', '▸', '▴', '▲', '▼'];

for (const file of EMOJI_SCAN) {
  const lines = read(file).split('\n');
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    const emojis = (line.match(EMOJI_RE) ?? []).filter(ch => ch !== TURTLE);
    check(emojis.length === 0, `${file}:${i + 1} 이모지 사용 (${emojis.join('')}) — lucide 아이콘 또는 문구로 대체`);
    const glyphs = REPLACED_GLYPHS.filter(g => line.includes(g));
    check(glyphs.length === 0, `${file}:${i + 1} 대체 대상 글리프 (${glyphs.join('')})`);
  });
}

for (const file of OWNED_COMPONENTS) {
  if (OVERLAY_EXEMPT.has(file)) continue;
  const hits = read(file).match(/\bshadow-[a-z0-9]+/g) ?? [];
  check(hits.length === 0, `${file} 카드에 그림자 클래스 (${hits.join(', ')}) — 그림자는 오버레이 전용`);
}

if (fails.length > 0) {
  console.error(`homeCardStateIntegrity: ${fails.length}건 실패 / ${pass}건 통과`);
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log(`homeCardStateIntegrity: ${pass}건 통과`);
