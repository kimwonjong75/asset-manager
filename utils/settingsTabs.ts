// utils/settingsTabs.ts
// 설정 화면 하위 탭 정의 + 저장된 값 해석(순수). 설정 섹션이 한 페이지에 세로로 8개 쌓여
// 원하는 항목을 찾기 어려웠던 문제(2026-11-11)를 탭 4개로 나눠 해결한다.
// 탭 ↔ 섹션 배치는 components/SettingsPage.tsx가 이 id를 기준으로 한다.

export type SettingsTabId = 'alerts' | 'turtle' | 'display' | 'data';

export interface SettingsTabDef {
  id: SettingsTabId;
  label: string;
  /** 탭 아래 한 줄 안내 — 이 탭에 무엇이 들어 있는지 */
  hint: string;
}

export const SETTINGS_TABS: readonly SettingsTabDef[] = [
  { id: 'alerts', label: '알림', hint: '카카오톡·텔레그램 발송 연결, 투자 시그널 알림 규칙·민감도' },
  { id: 'turtle', label: '터틀 규칙', hint: '진입·청산·손절·유닛·불타기·한도·적용 범위' },
  { id: 'display', label: '화면·분류', hint: '수익률 기준·표시 옵션·글자 크기, 자산 카테고리 관리' },
  { id: 'data', label: 'AI·백업', hint: 'Gemini API 키·모델, Google Drive 백업·복원' },
];

export const DEFAULT_SETTINGS_TAB: SettingsTabId = 'alerts';

/** 저장소에서 읽은 임의 값 → 유효한 탭 id. 알 수 없는 값·null이면 기본 탭. */
export function resolveSettingsTab(raw: unknown): SettingsTabId {
  return SETTINGS_TABS.find(t => t.id === raw)?.id ?? DEFAULT_SETTINGS_TAB;
}
