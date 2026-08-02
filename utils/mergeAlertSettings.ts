// utils/mergeAlertSettings.ts
// ---------------------------------------------------------------------------
// 저장본(AlertSettings) ⊕ DEFAULT_ALERT_SETTINGS 병합 — **순수 함수**.
//
// 배경: 알림 규칙 설정은 원래 localStorage 전용이라 PC를 바꾸면 초기화됐다.
//   이제 Drive 페이로드(`alertSettings` 키)로도 동기화되므로, "localStorage 로드"와
//   "Drive 로드/백업 복원" 두 경로가 **동일한 병합 규칙**을 써야 한다(drift 차단).
//
// 병합 규칙(기존 useAutoAlert.loadAlertSettings 동작 보존):
//   1) 저장본에 없는 신규 기본 규칙은 뒤에 추가 (기존 커스터마이징 보존)
//   2) 기존 규칙은 기본 규칙 위에 저장본을 덮어씀 — filterConfig 신규 필드 + 구조 필드
//      (filters/action/severity 등) 모두 누락 시 backfill (잘린 페이로드 방어)
//   3) 저장본이 없거나 깨졌으면 DEFAULT의 **깊은 복사본** 반환 (모듈 상수 오염 방지)
//   4) 기본값에 없는 규칙은 보존하되 `filters`가 배열이 아니면 제외
//      ([]로 보정하면 filters.every가 항상 true라 전 종목 오발화)
//
// 순수: localStorage/window 접근 없음. 입력을 변형(mutate)하지 않는다.

import type { AlertRule, AlertSettings } from '../types/alertRules';
import { DEFAULT_ALERT_SETTINGS } from '../constants/alertRules';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** DEFAULT_ALERT_SETTINGS의 깊은 복사 — 호출부가 rules/filterConfig를 만져도 상수가 오염되지 않도록. */
function cloneDefaults(): AlertSettings {
  return {
    enableAutoPopup: DEFAULT_ALERT_SETTINGS.enableAutoPopup,
    rules: DEFAULT_ALERT_SETTINGS.rules.map(r => ({ ...r, filterConfig: { ...r.filterConfig } })),
  };
}

/**
 * 저장본(JSON.parse 결과 등 임의 값)을 현재 기본 규칙과 병합해 사용 가능한 AlertSettings를 만든다.
 * @param stored localStorage 또는 Drive 페이로드에서 읽은 값 (형식 미보장)
 */
export function mergeAlertSettings(stored: unknown): AlertSettings {
  if (!isPlainObject(stored)) return cloneDefaults();

  const enableAutoPopup = typeof stored.enableAutoPopup === 'boolean'
    ? stored.enableAutoPopup
    : DEFAULT_ALERT_SETTINGS.enableAutoPopup;

  // rules가 배열이 아니면 기본 규칙으로 폴백 (오염 방어)
  const storedRules: AlertRule[] = Array.isArray(stored.rules)
    ? (stored.rules as unknown[]).filter(
        (r): r is AlertRule => isPlainObject(r) && typeof r.id === 'string',
      )
    : DEFAULT_ALERT_SETTINGS.rules;

  // 1) 저장본에 없는 신규 기본 규칙 추가 (순서: 저장본 → 신규)
  const existingIds = new Set(storedRules.map(r => r.id));
  const combined: AlertRule[] = [
    ...storedRules,
    ...DEFAULT_ALERT_SETTINGS.rules.filter(def => !existingIds.has(def.id)),
  ];

  // 2) 저장본 값 우선으로 기본 규칙 위에 덮어씀 — filterConfig의 신규 필드뿐 아니라
  //    구조 필드(filters/action/severity/name/…)도 누락 시 기본값에서 backfill한다.
  //    ⚠ `filters`가 배열이 아니면 `matchesRule`의 `rule.filters.every(...)`가 TypeError로 터져
  //      브리핑 계산 전체가 죽는다. 페이로드가 잘린 백업/외부 편집으로도 들어올 수 있으므로 방어.
  const defaultRuleMap = new Map(DEFAULT_ALERT_SETTINGS.rules.map(r => [r.id, r]));
  const rules = combined.reduce<AlertRule[]>((acc, r) => {
    const def = defaultRuleMap.get(r.id);
    const filterConfig = {
      ...(def ? def.filterConfig : {}),
      ...(isPlainObject(r.filterConfig) ? r.filterConfig : {}),
    };

    if (!def) {
      // 기본값에 없는(구/커스텀) 규칙 — 보존하되, 평가 불가능한 형태면 제외.
      // filters를 []로 보정하면 `every`가 항상 true라 **모든 종목에 발화**하므로 절대 금지.
      if (!Array.isArray(r.filters)) return acc;
      acc.push({ ...r, filterConfig });
      return acc;
    }

    acc.push({
      ...def,
      ...r,
      filters: Array.isArray(r.filters) ? r.filters : def.filters,
      filterConfig,
    });
    return acc;
  }, []);

  return { rules, enableAutoPopup };
}
