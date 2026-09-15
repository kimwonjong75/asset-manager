// tests/portfolioEmptyStateParity.ts
// ---------------------------------------------------------------------------
// 포트폴리오 표 빈 상태 원인·버튼 골든 (Stage D1). 원인 우선순위와 "세션 필터만 해제 / 저장 설정은 개별 버튼"
// 규약을 명시 문자열로 고정한다.
// 수동 실행: npx tsx tests/portfolioEmptyStateParity.ts
// ---------------------------------------------------------------------------

import { describePortfolioEmptyState, type PortfolioEmptyInput } from '../utils/portfolioEmptyState';

let pass = 0;
const fails: string[] = [];
function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${label}\n    기대 ${e}\n    실제 ${a}`);
}

const BASE: PortfolioEmptyInput = {
  visibleCount: 0,
  totalAssetCount: 10,
  failedOnly: false,
  searchActive: false,
  categoryActive: false,
  smartFilterCount: 0,
  planlessSatellite: false,
  pinnedOnly: false,
  alertsOnly: false,
  lowValueActive: false,
  lowValueThreshold: 100000,
  accountViewActive: false,
  accountLabel: '유선',
};
const run = (patch: Partial<PortfolioEmptyInput>) => describePortfolioEmptyState({ ...BASE, ...patch });
const kinds = (patch: Partial<PortfolioEmptyInput>) => run(patch)?.actions.map(a => a.kind);

// 보이는 행이 있으면 null
check('행 있음 → null', run({ visibleCount: 3, searchActive: true }), null);

// 자산 없음 — 모든 필터보다 우선
check('자산 없음', run({ totalAssetCount: 0, searchActive: true, lowValueActive: true }), {
  cause: 'noAssets', message: '아직 등록된 자산이 없습니다. 자산을 추가하면 여기에 표시됩니다.', actions: [],
});

// 실패만 보기 — 세션 필터보다 우선
check('실패만', run({ failedOnly: true, searchActive: true }), {
  cause: 'failedOnly',
  message: '업데이트에 실패한 종목만 보는 중인데, 지금 조건에 맞는 종목이 없습니다.',
  actions: [{ kind: 'showAllFailed', label: '전체 보기' }],
});
check('실패만 + 소액·계정 → 개별 버튼 추가', kinds({ failedOnly: true, lowValueActive: true, accountViewActive: true }), ['showAllFailed', 'disableLowValue', 'accountAll']);

// 검색/카테고리/스마트필터/프리셋
check('검색', run({ searchActive: true }), {
  cause: 'sessionFilters', message: '검색어 조건에 맞는 자산이 없습니다.', actions: [{ kind: 'clearSessionFilters', label: '필터 해제' }],
});
check('카테고리+스마트필터 문구', run({ categoryActive: true, smartFilterCount: 2 })?.message, '카테고리·필터 조건에 맞는 자산이 없습니다.');
check('계획 없는 투더문 프리셋 → sessionFilters', run({ planlessSatellite: true })?.cause, 'sessionFilters');
check('검색+카테고리+필터 문구', run({ searchActive: true, categoryActive: true, smartFilterCount: 1 })?.message, '검색어·카테고리·필터 조건에 맞는 자산이 없습니다.');
check('필터 + 중요만 → sessionFilters 우선', run({ smartFilterCount: 1, pinnedOnly: true })?.cause, 'sessionFilters');
check('필터 + 소액 숨김 → 해제 + 소액 끄기', kinds({ smartFilterCount: 1, lowValueActive: true }), ['clearSessionFilters', 'disableLowValue']);

// 중요만
check('중요만', run({ pinnedOnly: true }), {
  cause: 'pinnedOnly', message: '중요 표시(별)한 종목이 없습니다.', actions: [{ kind: 'clearSessionFilters', label: '필터 해제' }],
});
check('중요만 + 경보만 → pinnedOnly 우선', run({ pinnedOnly: true, alertsOnly: true })?.cause, 'pinnedOnly');

// 경보 종목만
check('경보만', run({ alertsOnly: true }), {
  cause: 'alertsOnly', message: '최고가 경보선에 닿은 종목이 없습니다.', actions: [{ kind: 'clearSessionFilters', label: '필터 해제' }],
});
check('경보만 + 계정 → 버튼 2', kinds({ alertsOnly: true, accountViewActive: true }), ['clearSessionFilters', 'accountAll']);

// 소액 숨김 (저장 설정 — 세션 해제 버튼 없음)
check('소액 숨김', run({ lowValueActive: true }), {
  cause: 'lowValue',
  message: '평가액 100,000원 미만 소액 자산이 숨겨져 있습니다.',
  actions: [{ kind: 'disableLowValue', label: '소액 숨김 끄기' }],
});
check('소액 숨김 + 계정 → 버튼 2(중복 없음)', kinds({ lowValueActive: true, accountViewActive: true }), ['disableLowValue', 'accountAll']);

// 계정 뷰
check('계정 뷰', run({ accountViewActive: true }), {
  cause: 'accountView', message: "'유선' 계정에 해당하는 자산이 없습니다.", actions: [{ kind: 'accountAll', label: '통합 보기로' }],
});

// 방어 폴백
check('필터 없이 빔 → 폴백', run({}), { cause: 'noAssets', message: '표시할 자산이 없습니다.', actions: [] });

if (fails.length > 0) {
  console.error(`portfolioEmptyStateParity: ${fails.length}건 실패 / ${pass}건 통과`);
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log(`portfolioEmptyStateParity: ${pass}건 통과`);
