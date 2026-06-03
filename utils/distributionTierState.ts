// utils/distributionTierState.ts
// P4.5 D1: distribution-high 알림을 매일 반복하지 않고 "단계 도달" 이벤트로 변환
//
// 원칙:
// - distribution 계산 로직은 건드리지 않음 (smartFilterLogic / riskMatrix 유지)
// - 표시 레이어 디듀프만 수행 (useAutoAlert가 알림 결과 빌드 후 호출)
// - 디듀프 단위: 자산(assetId) + 일자(YYYY-MM-DD), localStorage 영속
// - count < 3이면 해당 자산의 상태 reset
// - 단계 상승(3→4, 3→5, 4→5)은 새 'new' 이벤트
// - 같은 단계 유지(다른 날)는 'ongoing'
// - 단계 하강(5→4 등)은 'ongoing'으로 표시하되 state는 최고 단계 유지 (재경고 방지)
// - 6+ 카운트는 tier=5에 묶어 처리 → 반복 'new' 발생 안 함

export type DistributionTier = 3 | 4 | 5;
export type DistributionTierStatus = 'new' | 'ongoing';

export interface DistributionTierClassification {
  status: DistributionTierStatus;
  tier: DistributionTier;
}

export interface PersistedTierEntry {
  tier: DistributionTier;
  firstReachedDate: string; // YYYY-MM-DD
}

export type PersistedTierState = Record<string, PersistedTierEntry>;

export const DISTRIBUTION_TIER_STORAGE_KEY = 'asset-manager-dist-tier-state';
const MIN_TIER_COUNT = 3;
const TIER_5_THRESHOLD = 5;

function loadState(): PersistedTierState {
  try {
    const raw = localStorage.getItem(DISTRIBUTION_TIER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveState(state: PersistedTierState): void {
  try {
    localStorage.setItem(DISTRIBUTION_TIER_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/**
 * 자산 distribution count → tier 분류 + localStorage 상태 자동 갱신
 *
 * 반환 null: count < 3 (이벤트 없음, state도 cleared)
 * 반환 'new': 처음 도달 또는 단계 상승
 * 반환 'ongoing': 같은 단계 유지(다음 날) 또는 단계 하강
 */
export function classifyDistributionTier(
  assetId: string,
  count: number,
  today: string
): DistributionTierClassification | null {
  const state = loadState();
  const { classification, nextState, changed } = classifyDistributionTierPure(state, assetId, count, today);
  if (changed) saveState(nextState);
  return classification;
}

/**
 * 순수 함수 버전 — state 외부 주입, 테스트/백테스트에서 사용
 */
export function classifyDistributionTierPure(
  state: PersistedTierState,
  assetId: string,
  count: number,
  today: string
): {
  classification: DistributionTierClassification | null;
  nextState: PersistedTierState;
  changed: boolean;
} {
  // count < 임계: state reset
  if (count < MIN_TIER_COUNT) {
    if (state[assetId]) {
      const { [assetId]: _removed, ...rest } = state;
      return { classification: null, nextState: rest, changed: true };
    }
    return { classification: null, nextState: state, changed: false };
  }

  const currentTier: DistributionTier = count >= TIER_5_THRESHOLD ? 5 : count === 4 ? 4 : 3;
  const prev = state[assetId];

  // 처음 도달
  if (!prev) {
    const nextState = { ...state, [assetId]: { tier: currentTier, firstReachedDate: today } };
    return { classification: { status: 'new', tier: currentTier }, nextState, changed: true };
  }

  // 단계 상승 — 새 이벤트
  if (currentTier > prev.tier) {
    const nextState = { ...state, [assetId]: { tier: currentTier, firstReachedDate: today } };
    return { classification: { status: 'new', tier: currentTier }, nextState, changed: true };
  }

  // 단계 하강 — 최고 단계 기억, 표시는 ongoing
  if (currentTier < prev.tier) {
    return { classification: { status: 'ongoing', tier: prev.tier }, nextState: state, changed: false };
  }

  // 같은 단계
  if (prev.firstReachedDate === today) {
    // 오늘 처음 도달한 경우 (재실행 포함) — 'new' 유지
    return { classification: { status: 'new', tier: currentTier }, nextState: state, changed: false };
  }

  // 다른 날, 같은 단계 = 지속 중
  return { classification: { status: 'ongoing', tier: currentTier }, nextState: state, changed: false };
}
