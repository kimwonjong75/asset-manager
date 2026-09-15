// utils/portfolioEmptyState.ts
// ---------------------------------------------------------------------------
// 포트폴리오 표가 비었을 때 "왜 비었는지 + 무엇을 누르면 되는지" (순수 함수, Stage D1).
//   원인 우선순위: 자산 없음 → 실패만 보기 → 검색·카테고리·스마트필터·프리셋 → 중요만 → 경보 종목만
//                 → 소액 숨김 → 계정 뷰
//   · '필터 해제'(clearSessionFilters)는 **세션 필터만** 끈다: 스마트필터·프리셋 축·중요만·실패만·경보만·검색·카테고리.
//   · 저장되는 설정(소액 숨김 localStorage, 계정 뷰)은 한꺼번에 끄지 않고 원인 문구 + 개별 버튼으로만 제시한다.
//     → 켜져 있으면 1순위 원인이 아니어도 개별 버튼을 뒤에 붙인다(사용자가 한 번에 다 풀 수 있게).
// ---------------------------------------------------------------------------

export type PortfolioEmptyCause =
  | 'noAssets'
  | 'failedOnly'
  | 'sessionFilters'
  | 'pinnedOnly'
  | 'alertsOnly'
  | 'lowValue'
  | 'accountView';

export type PortfolioEmptyActionKind = 'clearSessionFilters' | 'disableLowValue' | 'accountAll' | 'showAllFailed';

export interface PortfolioEmptyAction {
  kind: PortfolioEmptyActionKind;
  label: string;
}

export interface PortfolioEmptyState {
  cause: PortfolioEmptyCause;
  message: string;
  actions: PortfolioEmptyAction[];
}

export interface PortfolioEmptyInput {
  /** 표에 실제로 보이는 행 수 — 0 이 아니면 결과 null */
  visibleCount: number;
  /** 계정 뷰 적용 전 전체 보유 자산 수(data.assets.length) */
  totalAssetCount: number;
  failedOnly: boolean;
  searchActive: boolean;
  categoryActive: boolean;
  /** 스마트 필터 활성 키 수 */
  smartFilterCount: number;
  /** '계획 없는 투더문' 프리셋 축 */
  planlessSatellite: boolean;
  pinnedOnly: boolean;
  alertsOnly: boolean;
  /** 소액 숨김이 **실제로 적용 중**(켜짐 + 임계값>0 + 환율 준비) */
  lowValueActive: boolean;
  lowValueThreshold: number;
  /** 계정 뷰가 통합(ALL)이 아님 */
  accountViewActive: boolean;
  accountLabel: string;
}

const LABELS: Record<PortfolioEmptyActionKind, string> = {
  clearSessionFilters: '필터 해제',
  disableLowValue: '소액 숨김 끄기',
  accountAll: '통합 보기로',
  showAllFailed: '전체 보기',
};

const act = (kind: PortfolioEmptyActionKind): PortfolioEmptyAction => ({ kind, label: LABELS[kind] });

export function describePortfolioEmptyState(input: PortfolioEmptyInput): PortfolioEmptyState | null {
  if (input.visibleCount > 0) return null;

  if (input.totalAssetCount === 0) {
    return { cause: 'noAssets', message: '아직 등록된 자산이 없습니다. 자산을 추가하면 여기에 표시됩니다.', actions: [] };
  }

  // 저장 설정 개별 버튼 — 1순위 원인이 무엇이든 켜져 있으면 뒤에 붙인다
  const persisted = (skip?: PortfolioEmptyActionKind): PortfolioEmptyAction[] => [
    ...(input.lowValueActive && skip !== 'disableLowValue' ? [act('disableLowValue')] : []),
    ...(input.accountViewActive && skip !== 'accountAll' ? [act('accountAll')] : []),
  ];

  if (input.failedOnly) {
    return {
      cause: 'failedOnly',
      message: '업데이트에 실패한 종목만 보는 중인데, 지금 조건에 맞는 종목이 없습니다.',
      actions: [act('showAllFailed'), ...persisted()],
    };
  }

  if (input.searchActive || input.categoryActive || input.smartFilterCount > 0 || input.planlessSatellite) {
    const parts = [
      input.searchActive ? '검색어' : null,
      input.categoryActive ? '카테고리' : null,
      input.smartFilterCount > 0 || input.planlessSatellite ? '필터' : null,
    ].filter((p): p is string => p !== null);
    return {
      cause: 'sessionFilters',
      message: `${parts.join('·')} 조건에 맞는 자산이 없습니다.`,
      actions: [act('clearSessionFilters'), ...persisted()],
    };
  }

  if (input.pinnedOnly) {
    return { cause: 'pinnedOnly', message: '중요 표시(별)한 종목이 없습니다.', actions: [act('clearSessionFilters'), ...persisted()] };
  }

  if (input.alertsOnly) {
    return { cause: 'alertsOnly', message: '최고가 경보선에 닿은 종목이 없습니다.', actions: [act('clearSessionFilters'), ...persisted()] };
  }

  if (input.lowValueActive) {
    return {
      cause: 'lowValue',
      message: `평가액 ${input.lowValueThreshold.toLocaleString('ko-KR')}원 미만 소액 자산이 숨겨져 있습니다.`,
      actions: [act('disableLowValue'), ...persisted('disableLowValue')],
    };
  }

  if (input.accountViewActive) {
    return { cause: 'accountView', message: `'${input.accountLabel}' 계정에 해당하는 자산이 없습니다.`, actions: [act('accountAll')] };
  }

  // 방어: 필터가 하나도 없는데 비었음(계산 대기 등)
  return { cause: 'noAssets', message: '표시할 자산이 없습니다.', actions: [] };
}
