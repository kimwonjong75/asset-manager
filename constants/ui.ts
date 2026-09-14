// constants/ui.ts
// 앱 셸 표시 관련 상수 (Stage B).

/** 완료(성공) 메시지가 UpdateStatusIndicator에 머무는 시간(ms). '중...' 진행 메시지는 자동 소거하지 않는다.
 *  소거 타이머는 hooks/usePortfolioData의 setSuccessMessage 래퍼 한 곳에서만 관리한다(호출부 setTimeout 금지). */
export const SUCCESS_MESSAGE_TTL_MS = 6000;

/** '중...' 진행 메시지 안전망 수명(ms). 정상 흐름은 완료/실패 경로가 다음 메시지나 null로 즉시 대체한다 —
 *  실패 경로가 소거를 빠뜨려도 진행 문구가 영구히 남지 않게 하는 방어선일 뿐, 이 값에 기대지 말 것. */
export const PROGRESS_MESSAGE_MAX_MS = 60_000;
