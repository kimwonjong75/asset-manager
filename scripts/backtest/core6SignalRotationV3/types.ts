// scripts/backtest/core6SignalRotationV3/types.ts
// 코어 6종 신호 로테이션 V3 — 모듈 간 공용 계약. 사전등록: docs/backtest/PREREG_코어6종_신호로테이션_V3.md
// 이 파일은 데이터(data/)·신호(signals/)·포트폴리오(portfolio/) 모듈이 공유한다. 바꾸면 세 모듈이 같이 깨진다.

export type AssetCode = '069500' | '379800' | '283580' | '385560' | '464470' | '411060';

export const ASSET_CODES: readonly AssetCode[] = ['069500', '379800', '283580', '385560', '464470', '411060'];

/** 사전등록 §2 목표비중(합 1.0). */
export const TARGET_WEIGHTS: Readonly<Record<AssetCode, number>> = {
  '069500': 0.17,
  '379800': 0.17,
  '283580': 0.16,
  '385560': 0.125,
  '464470': 0.125,
  '411060': 0.25,
};

export type BarSource = 'actual' | 'synthetic' | 'absent';

/** 공통 KRX 세션 달력에 정렬된 한 자산의 총수익(TR) 조정 OHLC. 배열 길이는 Panel.dates와 같다. */
export interface AssetBars {
  code: AssetCode;
  open: (number | null)[];
  high: (number | null)[];
  low: (number | null)[];
  close: (number | null)[];
  /** false = 그 세션에 새 봉이 없어 직전 값을 이월한 행(MA·ATR·Donchian의 새 봉·워밍업·이벤트로 세지 않는다). */
  fresh: boolean[];
  /** absent = 상장 전/미사용(가격 null). synthetic = 464470 상장 전 합성 구간(O=H=L=C). */
  source: BarSource[];
}

export interface Panel {
  /** 'YYYY-MM-DD' KRX 세션 오름차순. */
  dates: string[];
  assets: Record<AssetCode, AssetBars>;
}

export type SignalRuleId = 'D10/55' | 'D20/55' | 'D55/55' | 'MA20' | 'MA50' | 'ATR3/55';
export const SIGNAL_RULES: readonly SignalRuleId[] = ['D10/55', 'D20/55', 'D55/55', 'MA20', 'MA50', 'ATR3/55'];

/**
 * 한 자산·한 규칙의 일별 신호 시계열. **비중과 무관**해야 한다(사전등록 §16-11).
 * 인덱스 i는 Panel.dates와 같고, 모든 값은 i일 **종가 확정 후** 상태다. 체결은 i+1 시가(포트폴리오 모듈 책임).
 */
export interface SignalSeries {
  rule: SignalRuleId;
  code: AssetCode;
  /** 필요한 완료봉 워밍업이 끝나 신호 판정이 유효한가. false인 날은 active를 신뢰하지 않는다. */
  valid: boolean[];
  /** i일 종가 기준 보유 허용 상태(true=active). 최초 상태는 active, 매도 신호가 나면 false, 재진입 신호가 나면 true. */
  active: boolean[];
  /** i일 종가에 active→inactive로 바뀌는 매도 신호가 발생. */
  sellEvent: boolean[];
  /** i일 종가에 inactive→active로 바뀌는 재진입 신호가 발생. */
  reentryEvent: boolean[];
  /** ATR20(Wilder, 조정 단위). 불타기의 N과 ATR 규칙에 쓴다. 유효하지 않으면 null. */
  atr20: (number | null)[];
}
