// types/alertSensitivity.ts
// ② 민감도 프리셋 타입 — "알림 민감도 조절" 원질문의 최종 해결.
// 매수/매도를 분리해 둔감/기본/예민 3단계로 AlertSettings.rules의 filterConfig 임계값을 일괄 조정한다.
// 비파괴 원칙: 프리셋은 임계값 덮어쓰기지 규칙 삭제·enabled 변경이 아니다(구조 보존).
// 발화 변경은 의도된 것이므로 "프리셋 적용 = 특정 filterConfig 산출"을 골든 테스트(tests/alertSensitivityParity.ts)로 고정.

/** 민감도 단계 — 둔감(강한 신호만)/기본(앱 표준)/예민(작은 신호도). */
export type SensitivityLevel = 'insensitive' | 'default' | 'sensitive';

/** 프리셋 적용 단위 — 매도/매수 규칙을 독립적으로 조정(한쪽이 다른 쪽을 몰래 바꾸지 않음). */
export type SensitivityAction = 'sell' | 'buy';

/** UI 세그먼트 표시 순서(왼→오: 둔감→기본→예민). */
export const SENSITIVITY_ORDER: SensitivityLevel[] = ['insensitive', 'default', 'sensitive'];

export const SENSITIVITY_LABELS: Record<SensitivityLevel, string> = {
  insensitive: '둔감',
  default: '기본',
  sensitive: '예민',
};

/** 세그먼트 보조 설명(한 줄). */
export const SENSITIVITY_SUBLABELS: Record<SensitivityLevel, string> = {
  insensitive: '강한 신호만',
  default: '앱 표준',
  sensitive: '작은 신호도',
};

/**
 * '지금 할 행동' 초보자 포맷 — 결론 → 이유 → 행동 → 무효(되돌리기) → 데이터 신뢰도.
 * describeSensitivityPlan(action, level)이 반환하는 순수 데이터(렌더는 컴포넌트).
 */
export interface SensitivityActionPlan {
  /** 결론 — 이 단계가 무엇을 의미하는지 한 줄. */
  conclusion: string;
  /** 이유 — 어떤 임계값이 어떻게 바뀌는지. */
  reason: string;
  /** 행동 — 사용자가 이 설정으로 무엇을 하게 되는지(참고용 한계 포함). */
  action: string;
  /** 무효 — 이럴 땐 다른 단계로 되돌리라는 안내. */
  invalidation: string;
  /** 데이터 신뢰도 — OHLC 등 데이터 의존성 한계. */
  dataTrust: string;
}
