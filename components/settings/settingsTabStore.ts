// components/settings/settingsTabStore.ts
// 설정 하위 탭의 "마지막으로 본 탭" 기억(이 브라우저 전용 편의 — 동기화 안 함).
// 다른 화면의 "설정에서 켜기" 링크는 openSettingsTab(...)으로 원하는 탭을 지정해 이동한다.
// localStorage는 사생활 모드 등에서 throw할 수 있어 전부 try/catch — 실패하면 기본 탭.

import { resolveSettingsTab, type SettingsTabId } from '../../utils/settingsTabs';

const KEY = 'asset-manager-settings-tab';

export function readSettingsTab(): SettingsTabId {
  try {
    return resolveSettingsTab(localStorage.getItem(KEY));
  } catch {
    return resolveSettingsTab(null);
  }
}

export function writeSettingsTab(id: SettingsTabId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* 저장 실패는 무시 — 다음 방문에 기본 탭으로 열릴 뿐 */
  }
}

/** 설정 탭으로 이동하면서 특정 하위 탭을 연다. */
export function openSettingsTab(setActiveTab: (tab: 'settings') => void, id: SettingsTabId): void {
  writeSettingsTab(id);
  setActiveTab('settings');
}
