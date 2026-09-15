// tests/smartFilterPresetsParity.ts
// ---------------------------------------------------------------------------
// 포트폴리오 표 "빠른 보기" 프리셋 4종 골든 (Stage D1). 명시 절대값으로 고정.
//   ① 프리셋별 출력(activeFilters·thresholds·filterAlerts·planlessSatellite)
//   ② 대체(replace) 의미 — 기존 스마트 필터·경보만·계획없음 축을 버리고 프리셋 값만 남김
//   ③ 활성 판정(detect)·재클릭 해제(toggle)·임계값 수정 시 비활성
//   ④ '계획 없는 투더문' = isEligibleForBulkPlan 과 동일 기준
// 수동 실행: npx tsx tests/smartFilterPresetsParity.ts
// ---------------------------------------------------------------------------

import { Currency, type Asset } from '../types';
import { EMPTY_SMART_FILTER, type SmartFilterKey } from '../types/smartFilter';
import {
  TABLE_PRESETS,
  applyTablePreset,
  buildTablePreset,
  clearedTableFilters,
  detectActiveTablePreset,
  matchesPlanlessSatellite,
  toggleTablePreset,
  type TableFilterSnapshot,
  type TablePresetOutput,
} from '../utils/smartFilterPresets';

let pass = 0;
const fails: string[] = [];
function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${label}\n    기대 ${e}\n    실제 ${a}`);
}

const plain = (o: TablePresetOutput) => ({ ...o, activeFilters: [...o.activeFilters].sort() });
const snapPlain = (s: TableFilterSnapshot) => ({
  keys: [...s.smartFilter.activeFilters].sort(),
  drop: s.smartFilter.dropFromHighThreshold,
  loss: s.smartFilter.lossThreshold,
  maS: s.smartFilter.maShortPeriod,
  maL: s.smartFilter.maLongPeriod,
  filterAlerts: s.filterAlerts,
  planless: s.planlessSatellite,
});
const BASE_T = { dropFromHighThreshold: 20, lossThreshold: 5, maShortPeriod: 20, maLongPeriod: 60 };

// ① 목록·라벨 (알림 규칙 "매도 감지"와 겹치지 않는 이름)
check('프리셋 id 순서', TABLE_PRESETS.map(p => p.id), ['loss', 'drawdown20', 'alertLine', 'planlessSatellite']);
check('프리셋 라벨', TABLE_PRESETS.map(p => p.label), ['손실 중', '고점 대비 −20%', '최고가 경보선 도달', '계획 없는 투더문']);
check('라벨에 "매도 감지" 없음', TABLE_PRESETS.some(p => p.label.includes('매도 감지')), false);

check('loss 출력', plain(buildTablePreset('loss')), { activeFilters: ['PROFIT_NEGATIVE'], thresholds: BASE_T, filterAlerts: false, planlessSatellite: false });
check('drawdown20 출력', plain(buildTablePreset('drawdown20')), { activeFilters: ['DROP_FROM_HIGH'], thresholds: { ...BASE_T, dropFromHighThreshold: 20 }, filterAlerts: false, planlessSatellite: false });
check('alertLine 출력', plain(buildTablePreset('alertLine')), { activeFilters: [], thresholds: BASE_T, filterAlerts: true, planlessSatellite: false });
check('planlessSatellite 출력', plain(buildTablePreset('planlessSatellite')), { activeFilters: [], thresholds: BASE_T, filterAlerts: false, planlessSatellite: true });

// ② 대체 의미 — 사용자가 켜둔 칩 3개 + 경보만 + 임계 35 → loss 적용 시 전부 사라짐
const busy: TableFilterSnapshot = {
  smartFilter: {
    ...EMPTY_SMART_FILTER,
    activeFilters: new Set<SmartFilterKey>(['RSI_OVERSOLD', 'DROP_FROM_HIGH', 'VOLUME_SURGE']),
    dropFromHighThreshold: 35,
    maShortPeriod: 5,
  },
  filterAlerts: true,
  planlessSatellite: true,
};
check('busy → loss 교체', snapPlain(toggleTablePreset(busy, 'loss')), { keys: ['PROFIT_NEGATIVE'], drop: 20, loss: 5, maS: 20, maL: 60, filterAlerts: false, planless: false });
check('busy → drawdown20 교체(임계 35→20)', snapPlain(toggleTablePreset(busy, 'drawdown20')), { keys: ['DROP_FROM_HIGH'], drop: 20, loss: 5, maS: 20, maL: 60, filterAlerts: false, planless: false });
check('busy → alertLine 교체', snapPlain(toggleTablePreset(busy, 'alertLine')), { keys: [], drop: 20, loss: 5, maS: 20, maL: 60, filterAlerts: true, planless: false });
check('busy → planless 교체', snapPlain(toggleTablePreset(busy, 'planlessSatellite')), { keys: [], drop: 20, loss: 5, maS: 20, maL: 60, filterAlerts: false, planless: true });
check('busy 원본 불변', [...busy.smartFilter.activeFilters].sort(), ['DROP_FROM_HIGH', 'RSI_OVERSOLD', 'VOLUME_SURGE']);
check('busy 는 프리셋 아님', detectActiveTablePreset(busy), null);

// ③ 활성 판정 · 재클릭 해제
for (const def of TABLE_PRESETS) {
  check(`${def.id} 적용 후 활성`, detectActiveTablePreset(applyTablePreset(def.id)), def.id);
  check(`${def.id} 재클릭 → 전부 해제`, snapPlain(toggleTablePreset(applyTablePreset(def.id), def.id)), snapPlain(clearedTableFilters()));
}
check('해제 상태는 프리셋 아님', detectActiveTablePreset(clearedTableFilters()), null);
{
  const s = applyTablePreset('drawdown20');
  s.smartFilter = { ...s.smartFilter, dropFromHighThreshold: 30 };
  check('drawdown 임계 30으로 수정 → 비활성', detectActiveTablePreset(s), null);
  check('비활성 상태에서 클릭 → 20으로 재적용', toggleTablePreset(s, 'drawdown20').smartFilter.dropFromHighThreshold, 20);
}
{
  const s = applyTablePreset('loss');
  s.filterAlerts = true;
  check('loss + 경보만 추가 → 비활성', detectActiveTablePreset(s), null);
}
{
  const s = applyTablePreset('loss');
  s.smartFilter = { ...s.smartFilter, activeFilters: new Set<SmartFilterKey>(['PROFIT_NEGATIVE', 'RSI_OVERSOLD']) };
  check('loss + 칩 추가 → 비활성', detectActiveTablePreset(s), null);
}
check('loss 활성 중 alertLine 클릭 → alertLine 로 교체', detectActiveTablePreset(toggleTablePreset(applyTablePreset('loss'), 'alertLine')), 'alertLine');

// ④ 계획 없는 투더문 = isEligibleForBulkPlan
const mk = (over: Partial<Asset> = {}): Asset => ({
  id: 'a', categoryId: 1, ticker: '000000', exchange: 'KRX', name: 'X', quantity: 10, purchasePrice: 100,
  purchaseDate: '2026-09-15', currency: Currency.KRW, currentPrice: 110, priceOriginal: 110, highestPrice: 120, bucket: 'SATELLITE', ...over,
});
check('투더문 보유·계획 없음 → 대상', matchesPlanlessSatellite(mk()), true);
check('코어 → 제외', matchesPlanlessSatellite(mk({ bucket: 'CORE' })), false);
check('버킷 미지정(코어 취급) → 제외', matchesPlanlessSatellite(mk({ bucket: undefined })), false);
check('유선 → 제외', matchesPlanlessSatellite(mk({ owner: 'YUSEON' })), false);
check('수량 0 → 제외', matchesPlanlessSatellite(mk({ quantity: 0 })), false);
check('시세 없음 → 제외', matchesPlanlessSatellite(mk({ priceOriginal: 0 })), false);

if (fails.length > 0) {
  console.error(`smartFilterPresetsParity: ${fails.length}건 실패 / ${pass}건 통과`);
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log(`smartFilterPresetsParity: ${pass}건 통과`);
