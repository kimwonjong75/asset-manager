// utils/smartFilterPresets.ts
// ---------------------------------------------------------------------------
// 포트폴리오 표 "빠른 보기" 프리셋 4종 (순수 함수, Stage D1).
//   · 프리셋은 기존 필터를 **대체**한다(사용자 확정): 스마트 필터 전체 + 경보 종목만 + 계획 없는 투더문
//     3개 축을 한꺼번에 프리셋 값으로 덮어쓴다. 합치지 않는다.
//   · 활성 판정은 저장 상태가 아니라 **현재 상태와 프리셋 출력의 일치**로 파생한다(따로 id 를 들고 있지 않음 →
//     사용자가 칩을 손으로 바꾸면 프리셋 강조가 자연히 꺼진다).
//   · '계획 없는 투더문'은 새 판정 로직이 아니다 — utils/tradePlan.isEligibleForBulkPlan
//     (홈 derived.planlessSatellites · 일괄 계획 마법사와 같은 기준)을 그대로 쓴다.
//   · 알림 규칙의 "매도 감지"와 헷갈리지 않도록 경보 프리셋 이름은 '최고가 경보선 도달'.
// ---------------------------------------------------------------------------

import type { Asset } from '../types';
import { EMPTY_SMART_FILTER, type SmartFilterKey, type SmartFilterState } from '../types/smartFilter';
import { isEligibleForBulkPlan } from './tradePlan';

export type TablePresetId = 'loss' | 'drawdown20' | 'alertLine' | 'planlessSatellite';

export interface TablePresetDef {
  id: TablePresetId;
  label: string;
  description: string;
}

export const TABLE_PRESETS: readonly TablePresetDef[] = [
  { id: 'loss', label: '손실 중', description: '현재 수익률이 마이너스인 종목' },
  { id: 'drawdown20', label: '고점 대비 −20%', description: '52주 최고가보다 20% 이상 내려온 종목' },
  { id: 'alertLine', label: '최고가 경보선 도달', description: '최고가 대비 하락률이 저장된 경보 기준(종목별 설정 우선)에 닿은 종목' },
  { id: 'planlessSatellite', label: '계획 없는 투더문', description: '투더문(위성) 보유 종목 중 매매 계획이 없는 종목 — 홈의 "계획 없는 투더문"과 같은 기준' },
];

export interface SmartFilterThresholds {
  dropFromHighThreshold: number;
  lossThreshold: number;
  maShortPeriod: number;
  maLongPeriod: number;
}

/** 프리셋이 표에 적용하는 값 — 3개 축 전부(대체 의미) */
export interface TablePresetOutput {
  activeFilters: Set<SmartFilterKey>;
  thresholds: SmartFilterThresholds;
  filterAlerts: boolean;
  planlessSatellite: boolean;
}

/** 표의 현재 필터 상태(프리셋 판정 입력) */
export interface TableFilterSnapshot {
  smartFilter: SmartFilterState;
  filterAlerts: boolean;
  planlessSatellite: boolean;
}

const BASE_THRESHOLDS: SmartFilterThresholds = {
  dropFromHighThreshold: EMPTY_SMART_FILTER.dropFromHighThreshold,
  lossThreshold: EMPTY_SMART_FILTER.lossThreshold,
  maShortPeriod: EMPTY_SMART_FILTER.maShortPeriod,
  maLongPeriod: EMPTY_SMART_FILTER.maLongPeriod,
};

export const DRAWDOWN_PRESET_THRESHOLD = 20;

export function buildTablePreset(id: TablePresetId): TablePresetOutput {
  switch (id) {
    case 'loss':
      return { activeFilters: new Set<SmartFilterKey>(['PROFIT_NEGATIVE']), thresholds: { ...BASE_THRESHOLDS }, filterAlerts: false, planlessSatellite: false };
    case 'drawdown20':
      return {
        activeFilters: new Set<SmartFilterKey>(['DROP_FROM_HIGH']),
        thresholds: { ...BASE_THRESHOLDS, dropFromHighThreshold: DRAWDOWN_PRESET_THRESHOLD },
        filterAlerts: false,
        planlessSatellite: false,
      };
    case 'alertLine':
      return { activeFilters: new Set<SmartFilterKey>(), thresholds: { ...BASE_THRESHOLDS }, filterAlerts: true, planlessSatellite: false };
    case 'planlessSatellite':
      return { activeFilters: new Set<SmartFilterKey>(), thresholds: { ...BASE_THRESHOLDS }, filterAlerts: false, planlessSatellite: true };
  }
}

/** 프리셋 적용 결과 — 기존 스마트 필터를 버리고 프리셋 값으로 교체한 새 스냅샷 */
export function applyTablePreset(id: TablePresetId): TableFilterSnapshot {
  const p = buildTablePreset(id);
  return {
    smartFilter: { ...EMPTY_SMART_FILTER, ...p.thresholds, activeFilters: new Set(p.activeFilters) },
    filterAlerts: p.filterAlerts,
    planlessSatellite: p.planlessSatellite,
  };
}

/** 모든 필터 축을 끈 스냅샷(활성 프리셋을 다시 눌렀을 때) */
export function clearedTableFilters(): TableFilterSnapshot {
  return { smartFilter: { ...EMPTY_SMART_FILTER, activeFilters: new Set() }, filterAlerts: false, planlessSatellite: false };
}

function sameKeySet(a: Set<SmartFilterKey>, b: Set<SmartFilterKey>): boolean {
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

/** 현재 상태가 어느 프리셋과 정확히 일치하는지 (없으면 null) */
export function detectActiveTablePreset(state: TableFilterSnapshot): TablePresetId | null {
  for (const def of TABLE_PRESETS) {
    const p = buildTablePreset(def.id);
    if (state.filterAlerts !== p.filterAlerts) continue;
    if (state.planlessSatellite !== p.planlessSatellite) continue;
    if (!sameKeySet(state.smartFilter.activeFilters, p.activeFilters)) continue;
    if (p.activeFilters.has('DROP_FROM_HIGH') && state.smartFilter.dropFromHighThreshold !== p.thresholds.dropFromHighThreshold) continue;
    return def.id;
  }
  return null;
}

/** 프리셋 칩 클릭 — 활성 프리셋이면 전부 해제, 아니면 해당 프리셋으로 교체 */
export function toggleTablePreset(state: TableFilterSnapshot, id: TablePresetId): TableFilterSnapshot {
  return detectActiveTablePreset(state) === id ? clearedTableFilters() : applyTablePreset(id);
}

/** '계획 없는 투더문' 축 판정 — isEligibleForBulkPlan 그대로(새 로직 없음) */
export function matchesPlanlessSatellite(asset: Asset): boolean {
  return isEligibleForBulkPlan(asset);
}
