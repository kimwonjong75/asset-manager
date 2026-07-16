// types/todayTurtle.ts
// ---------------------------------------------------------------------------
// "오늘의 터틀 확인" 카드 — 읽기 전용 화면 상태 · 데이터 품질 타입.
//
// 안전 설계 (타입으로 강제):
//   · 기존 SATELLITE 보유분 모델(`LegacySatelliteRow`)에는 stopPrice·nAtEntry·pyramidPrice·
//     pyramidQuantity·recommendedSellQuantity 필드가 **존재하지 않는다**. 진입 당시 N 기록이 없어
//     2N 손절가를 만들어낼 수 없고, 불타기는 검증에서 탈락했으므로 계산·표시 자체를 차단한다.
//   · 불타기 상태값이 어떤 유니온에도 없다 — 어떤 입력에서도 불타기 상태가 생성될 수 없다.
//   · 주문·수량 필드가 없다 — 이 화면은 주문을 만들지 않는다.

/** 데이터 품질 — 왜 판정할 수 없는지. */
export type TodayDataIssue =
  | 'fetch-failed'        // 조회 실패 (no-high-low 와 구분 — 원인이 다르다)
  | 'no-completed-bar'    // 완료된 일봉 없음(당일 봉만 있음)
  | 'insufficient-bars'   // 유효 완료봉 부족 (55일=56봉, 20일=21봉)
  | 'no-high-low'         // 고가/저가 미수신 — 채널 계산에 종가 폴백 금지
  | 'no-price'            // 현재가 없음
  | 'stop-record-invalid' // 저장된 stopPrice 가 무효
  | 'position-link';      // 포지션↔자산 연결 실패

/** 완료봉 판정에 쓴 시장 기준. */
export type MarketTz = 'KR' | 'US' | 'CRYPTO' | 'UNKNOWN';

export interface BarQuality {
  /** 유효 완료봉 수 (비정상 행 제외 후) */
  validCompletedBars: number;
  /** 판정에 쓴 최신 완료봉 날짜 (YYYY-MM-DD). 없으면 null */
  asOfDate: string | null;
  /** 제외된 비정상 행 수 */
  droppedRows: number;
  marketTz: MarketTz;
  /** 공급자 일봉 기준 시간대를 확인하지 못해 최신 행을 보수적으로 제외했는지 */
  conservativeDrop: boolean;
  issues: TodayDataIssue[];
}

// ── 관심종목 (55일 돌파) ──────────────────────────────────────────────────
export type WatchStatus =
  | 'breakout-confirmed'   // 55일 돌파 확인 (완료종가 기준)
  | 'waiting'              // 기다림
  | 'unavailable';         // 확인 불가

export interface WatchRow {
  kind: 'watch';
  ticker: string;
  name: string;
  status: WatchStatus;
  quality: BarQuality;
  /** 최신 완료봉 종가 (원통화). 판정 불가 시 null */
  completedClose: number | null;
  /** 55일 돌파선 = D 제외 직전 55개 완료봉 high 최댓값 */
  breakoutLine: number | null;
  /** 돌파선까지 남은 비율 (양수 = 아직 아래). waiting 에서만 */
  gapToLinePct: number | null;
  /** 장중 참고 — 장중가가 돌파선을 넘었으나 완료종가는 아님 (표시 전용, 확정 아님) */
  intradayAboveLine: boolean;
  /** 장중 현재가 (참고 표시용) */
  intradayPrice: number | null;
}

// ── 정식 터틀 포지션 (저장된 stopPrice 보유) ─────────────────────────────
export type PositionStatus =
  | 'sell-check-stop'      // 오늘 매도 확인 — 손절선 아래
  | 'sell-check-exit'      // 오늘 매도 확인 — 20일 청산선 도달
  | 'waiting'              // 기다림
  | 'waiting-exit-unknown' // 손절선 위 · 20일선 확인 불가 (부분 성공 — 기본 노출)
  | 'stop-record-error'    // 손절선 기록 오류 — 확인 필요 (stopPrice 무효. 0으로 대체 금지)
  | 'link-error'           // 포지션 연결 확인 필요 (assetId 없음/깨짐 + ticker 후보 0개 또는 2개 이상)
  | 'unavailable';         // 확인 불가

export interface PositionRow {
  kind: 'position';
  ticker: string;
  name: string;
  status: PositionStatus;
  quality: BarQuality;
  completedClose: number | null;
  /**
   * 저장된 공통 손절가 (포지션 기록의 약속값 — 새로 만들지 않음).
   * **무효(비수·비유한·≤0)면 null** — 0으로 대체하지 않는다(status='stop-record-error').
   */
  stopPrice: number | null;
  /** 20일 청산선 = D 제외 직전 20개 완료봉 low 최솟값 */
  exitLine: number | null;
}

// ── 기존 투더문 보유분 (포지션 없음) ─────────────────────────────────────
export type LegacyStatus =
  | 'exit-line-touched'    // 20일 청산선 도달 — 참고
  | 'above-exit-line'      // 청산선 위 — 기다림
  | 'unavailable';         // 확인 불가

/**
 * 기존 SATELLITE 표시 모델.
 * **stopPrice·nAtEntry·pyramidPrice·pyramidQuantity·recommendedSellQuantity 없음** — 의도적 타입 차단.
 */
export interface LegacySatelliteRow {
  kind: 'legacy';
  ticker: string;
  name: string;
  status: LegacyStatus;
  quality: BarQuality;
  completedClose: number | null;
  exitLine: number | null;
}

export type TodayRow = WatchRow | PositionRow | LegacySatelliteRow;

/** 카드 전체 모델. */
export interface TodayTurtleModel {
  rows: TodayRow[];
  /** 요약 — `utils/todayTurtle.rowSortRank` 와 동일 기준(C-5) */
  summary: {
    sellCheck: number;         // 정식 터틀 매도 확인 (rank 1)
    breakout: number;          // 55일 돌파 확인 (rank 3)
    legacyTouched: number;     // 기존 투더문 20일선 참고 (rank 2)
    dataIssues: number;        // 데이터·연결 확인 필요 (rank 0)
    intradayBreakout: number;  // 장중 돌파 중 — 종가 확인 전 (rank 4)
    waiting: number;           // 단순 기다림 (rank 5, 기본 접힘)
  };
  isLoading: boolean;
  /** 전체 실패가 아니라 일부 종목만 실패했을 때도 카드는 뜬다 */
  partialFailure: boolean;
}
