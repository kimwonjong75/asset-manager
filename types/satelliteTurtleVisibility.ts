// types/satelliteTurtleVisibility.ts
// ---------------------------------------------------------------------------
// 단일 플래그 — 옛 위성(90/10) 터틀의 **후보 평가·자동 검토·자동 생성**을 끈다.
//
// 배경: "보유종목 터틀"(계획서 PLAN_터틀중심_앱재정비_260925 §6 P2)이 `WatchlistItem.isTurtleCandidate`를
// "다시 살 때 감시" 표식으로 재사용한다(매도 후 자동 등록 + 사용자 수동 🐢 등록 공용). 옛 위성 실행 큐
// 생성기(`hooks/turtleMarketSnapshot.ts` turtleCandidateItems)도 같은 필드를 진입 후보 판정에 쓰므로,
// 두 기능을 동시에 켜 두면 위성 엔진이 "보유종목 터틀" 감시 종목을 자기 예산(satelliteBudgetKRW)으로
// 오인해 위성 진입 주문 프리뷰를 만들 수 있다(사이징 분모가 다르다 — 위성=satelliteBudgetKRW, 보유종목
// =관리자산). "보유종목 터틀" 도입 후에는 옛 위성 평가를 꺼서 이 충돌을 없앤다.
//
// 이 파일이 유일한 정책 지점이다(types/turtleLock.ts와 동일 패턴) — 되돌리려면 아래 상수 하나만
// true로 바꾸면 된다. 코드는 삭제하지 않는다: `hooks/turtleMarketSnapshot.ts`의 `turtleCandidateItems`와
// `hooks/useTurtleActionReview.ts`가 이 값을 확인해 대상 0건으로 조용히 비활성화될 뿐이다.
// 실 계좌 안전에는 영향이 없다 — 위성 주문 실행 자체가 이미 `types/turtleLock.ts`(OBSERVE_ONLY)로
// 별도 잠겨 있어, 이 플래그는 "제안 프리뷰·자동 검토 배지"만 끈다.

/** 옛 위성 터틀 후보 평가·자동 검토·자동 생성 활성 여부. false = "보유종목 터틀" 도입 이후 비활성. */
export const SATELLITE_TURTLE_EVALUATION_ENABLED = false;

/** 비활성 사유(사용자 표시용 — 필요해지면 화면에 노출). */
export const SATELLITE_TURTLE_HIDDEN_REASON =
  '"보유종목 터틀" 도입 이후 옛 위성(투더문) 터틀 후보 평가는 꺼져 있습니다(설정에서 되돌릴 수 있는 코드 보존 상태).';
