// tests/tabMetaIntegrity.ts
// ---------------------------------------------------------------------------
// 앱 셸 탭 선언표(constants/tabMeta.ts TAB_META) 무결성 골든 테스트 (Stage B).
//   App.tsx 앱바는 탭별 조건을 이 표에서만 읽는다. 표가 어긋나면 기간 선택·계정뷰가 엉뚱한 탭에
//   뜨거나 사라져도 에러 없이 조용히 깨지므로, **명시적 기대값**으로 고정한다(경로 A-vs-B 비교 금지).
// 수동 실행: npx tsx tests/tabMetaIntegrity.ts. 통과 시 exit 0, 실패 시 exit 1.

import { TAB_META, MORE_MENU_TABS, getTabMeta, type AppTab } from '../constants/tabMeta';

let pass = 0;
const fails: string[] = [];
function check(cond: boolean, msg: string): void {
  if (cond) pass++;
  else fails.push(`✗ ${msg}`);
}

// ① 실제 화면 탭 전수 (UIState['activeTab'] − 별칭 today/execution) — 순서 무관, 정확히 일치
const EXPECTED_TABS: AppTab[] = ['dashboard', 'portfolio', 'watchlist', 'analytics', 'cleanup', 'guide', 'replay', 'settings'];
const actualTabs = Object.keys(TAB_META).sort();
check(JSON.stringify(actualTabs) === JSON.stringify([...EXPECTED_TABS].sort()), `TAB_META 키 불일치: ${actualTabs.join(',')}`);

// ② 탭별 골든 값 (2026-09-15 Advisor 승인표)
const GOLDEN: Record<AppTab, [title: string, mobileTitle: boolean, showAccountView: boolean, showPeriod: boolean, inMoreMenu: boolean]> = {
  dashboard: ['홈', false, false, false, false],
  portfolio: ['보유자산', true, true, true, false],
  watchlist: ['관심종목', true, false, true, false],
  analytics: ['수익 통계', true, false, false, true],
  // P3(터틀 재정비, 2026-09-26): cleanup 탭 화면이 TurtleCleanupView로 교체되며 라벨도 '터틀 정리'로.
  cleanup: ['터틀 정리', true, false, false, true],
  guide: ['투자 가이드', true, false, false, true],
  replay: ['연구실', true, false, false, true],
  settings: ['설정', true, false, false, true],
};
for (const tab of EXPECTED_TABS) {
  const m = TAB_META[tab];
  const [title, mobileTitle, showAccountView, showPeriod, inMoreMenu] = GOLDEN[tab];
  check(m.title === title, `${tab}.title = '${m.title}' (기대 '${title}')`);
  check(m.mobileTitle === mobileTitle, `${tab}.mobileTitle = ${m.mobileTitle} (기대 ${mobileTitle})`);
  check(m.showAccountView === showAccountView, `${tab}.showAccountView = ${m.showAccountView} (기대 ${showAccountView})`);
  check(m.showPeriod === showPeriod, `${tab}.showPeriod = ${m.showPeriod} (기대 ${showPeriod})`);
  check(m.inMoreMenu === inMoreMenu, `${tab}.inMoreMenu = ${m.inMoreMenu} (기대 ${inMoreMenu})`);
}

// ③ 더보기 파생 목록 — 명시값
check(
  JSON.stringify([...MORE_MENU_TABS].sort()) === JSON.stringify(['analytics', 'cleanup', 'guide', 'replay', 'settings']),
  `MORE_MENU_TABS = ${MORE_MENU_TABS.join(',')}`,
);

// ④ 별칭 탭은 홈 메타로 해석 (발송된 카톡 ?tab=today 링크 호환)
check(getTabMeta('today') === TAB_META.dashboard, "getTabMeta('today') → dashboard 메타");
check(getTabMeta('execution') === TAB_META.dashboard, "getTabMeta('execution') → dashboard 메타");
check(getTabMeta('portfolio') === TAB_META.portfolio, "getTabMeta('portfolio') → portfolio 메타");

// ⑤ 계정뷰 세그먼트는 보유자산 한 곳만 (홈은 본문 자체 세그먼트 — 중복 렌더 금지)
check(EXPECTED_TABS.filter(t => TAB_META[t].showAccountView).join(',') === 'portfolio', '계정뷰 세그먼트는 portfolio만');

if (fails.length > 0) {
  console.error(`tabMetaIntegrity: ${fails.length}건 실패 / ${pass}건 통과`);
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log(`tabMetaIntegrity: ${pass}건 통과`);
