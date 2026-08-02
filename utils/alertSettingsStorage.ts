// utils/alertSettingsStorage.ts
// ---------------------------------------------------------------------------
// 알림 규칙 설정(AlertSettings)의 **영속 계층** — localStorage 읽기/쓰기 + Drive 복원 반영.
//
// 알림 규칙 설정은 Drive 페이로드의 `alertSettings` 키로도 동기화된다(PC를 바꿔도 유지).
// 경로가 3개(로컬 로드 / Drive 로드 / 백업 복원)이므로 키·이벤트·병합을 여기 하나로 모은다.
//   · localStorage 키 : ALERT_SETTINGS_STORAGE_KEY
//   · 복원 이벤트     : ALERT_SETTINGS_RESTORED_EVENT — useAutoAlert가 구독해 state 동기화
//     (tableLayout의 'table-layout-restored'와 동일한 기존 패턴)
//
// 병합 규칙 자체는 순수 함수 `mergeAlertSettings`에 위임한다(테스트 대상).
// 이 모듈만 부수효과(localStorage/window)를 갖는다.

import type { AlertSettings } from '../types/alertRules';
import { mergeAlertSettings } from './mergeAlertSettings';
import { setItemSafe } from './safeStorage';

export const ALERT_SETTINGS_STORAGE_KEY = 'asset-manager-alert-settings';
export const ALERT_SETTINGS_RESTORED_EVENT = 'alert-settings-restored';

/** localStorage에서 AlertSettings 로드 (신규 규칙/필드 자동 병합). 없으면 기본값. */
export function loadAlertSettings(): AlertSettings {
  try {
    const stored = localStorage.getItem(ALERT_SETTINGS_STORAGE_KEY);
    if (stored) return mergeAlertSettings(JSON.parse(stored));
  } catch { /* ignore */ }
  return mergeAlertSettings(undefined);
}

/** localStorage에 AlertSettings 저장 (용량 초과는 setItemSafe가 흡수 — throw 없음). */
export function saveAlertSettings(settings: AlertSettings): void {
  try {
    setItemSafe(ALERT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

/** Drive 페이로드에 저장된 원본(JSON) 문자열 — autoSave가 페이로드에 실을 값. 없으면 undefined. */
export function readStoredAlertSettings(): AlertSettings | undefined {
  try {
    const stored = localStorage.getItem(ALERT_SETTINGS_STORAGE_KEY);
    if (!stored) return undefined;
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as AlertSettings) : undefined;
  } catch { /* ignore */ }
  return undefined;
}

/**
 * Drive 로드/백업 복원이 가져온 alertSettings를 localStorage에 반영하고 훅에 알린다.
 * 값이 없거나 객체가 아니면 **아무것도 하지 않는다** — 구 페이로드(필드 없음)가
 * 로컬 설정을 초기화하는 사고를 막기 위함.
 * @returns 반영한 병합 결과 / 반영하지 않았으면 null
 */
export function applyRestoredAlertSettings(raw: unknown): AlertSettings | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const merged = mergeAlertSettings(raw);
  saveAlertSettings(merged);
  try {
    window.dispatchEvent(new CustomEvent(ALERT_SETTINGS_RESTORED_EVENT, { detail: merged }));
  } catch { /* ignore */ }
  return merged;
}
