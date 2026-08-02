// scripts/backtest/lectureSignals/configTypes.ts
// ---------------------------------------------------------------------------
// 사전등록 설정 타입 + 고정 상수(§4·§5·§6·§7). 이 값들은 계획서에서 못박힌 정의이며
// 검증표본 결과를 본 뒤 변경 금지(§5.5, §16 즉시중단 조건).
// ---------------------------------------------------------------------------

export type Market = 'KOSPI' | 'KOSDAQ';

/** 종목별 분할조정 OHLCV(+원천 거래대금·시장). amount는 무조정(원, §4.4). */
export interface SecurityBars {
  code: string;
  name: string;
  dates: readonly string[];
  adjOpen: readonly number[];
  adjHigh: readonly number[];
  adjLow: readonly number[];
  adjClose: readonly number[];
  adjVolume: readonly number[];
  amount: readonly number[]; // 원천 거래대금(원, 무조정)
  market: readonly string[]; // per-bar 'KOSPI'|'KOSDAQ'|...
  /**
   * 원시(무조정) 종가/거래량. **`S5_APP_RUNTIME_RAW`(앱 `/history` 입력 규약 재현) 전용**이며
   * 그 외 어떤 신호·팩터 계산에도 쓰지 않는다(§5.6: 원시 volume은 분할 경계에서 기계적으로
   * 급증하므로 신호 계산 금지). 합성 바(테스트) 호환을 위해 선택 필드이며, 없으면
   * `S5_APP_RUNTIME_RAW`은 판정불가(false)로 처리된다.
   */
  close?: readonly number[];
  volume?: readonly number[];
  /** date → bar index */
  dateIndex: ReadonlyMap<string, number>;
}

/** D2 급성 매도 신호 코드(S5는 세 변형: 원천 거래대금 / 조정 프록시 / 앱 런타임 원시). */
export type AcuteSignalCode =
  | 'S1_RUNUP_21D_100'
  | 'S2_RUNUP_5D_40'
  | 'S3_LIMIT_UP'
  | 'S4_GAP_BEAR_VOLUME'
  | 'S5_AMOUNT'
  | 'S5_APP_PROXY'
  | 'S5_APP_RUNTIME_RAW'
  | 'S6_CRASH_5_VOLUME_2X';

export const ACUTE_SIGNAL_CODES: readonly AcuteSignalCode[] = [
  'S1_RUNUP_21D_100',
  'S2_RUNUP_5D_40',
  'S3_LIMIT_UP',
  'S4_GAP_BEAR_VOLUME',
  'S5_AMOUNT',
  'S5_APP_PROXY',
  'S5_APP_RUNTIME_RAW',
  'S6_CRASH_5_VOLUME_2X',
];

/** S5 세 변형(3자 비교 대상). 거래대금 최대 판정 입력만 다르고 −10% 판정은 동일(adj_close). */
export const S5_VARIANTS: readonly AcuteSignalCode[] = [
  'S5_AMOUNT',
  'S5_APP_PROXY',
  'S5_APP_RUNTIME_RAW',
];

/** D1 시장 레짐 변형 코드(§6.2). */
export type RegimeVariantCode =
  | 'KR150_LEVEL'
  | 'KR150_SLOPE'
  | 'KR150_COMBINED'
  | 'KR200_LEVEL';

export const REGIME_VARIANT_CODES: readonly RegimeVariantCode[] = [
  'KR150_LEVEL',
  'KR150_SLOPE',
  'KR150_COMBINED',
  'KR200_LEVEL',
];

/** 표본 분할(§4.2). 잠금(2023-2025)은 이번 작업에서 절대 실행 금지. */
export interface SamplePeriod {
  name: 'DEV' | 'VALIDATION';
  from: string;
  to: string;
}

export const DEV_PERIOD: SamplePeriod = { name: 'DEV', from: '2010-01-01', to: '2019-12-31' };
export const VALIDATION_PERIOD: SamplePeriod = {
  name: 'VALIDATION',
  from: '2020-01-01',
  to: '2022-12-31',
};

/** 고정 상수. */
export const CONST = {
  masterSeed: 20260725,
  bootstrapIterations: 10000,
  permutationCount: 1000,
  blockDays: 60,
  confidenceLevel: 0.95,
  forwardHorizons: [20, 63, 126, 252] as const,
  d2PrimaryHorizon: 63,
  d1PrimaryHorizon: 126,
  ma150: 150,
  ma200: 200,
  slopeLag: 20,
  limitUpRegimeChangeDate: '2015-06-15',
  limitUpBefore: 0.145,
  limitUpAfter: 0.295,
  s1Lookback: 21,
  s1Threshold: 1.0,
  s2Lookback: 5,
  s2Threshold: 0.4,
  s4GapThreshold: 0.05,
  s4VolMultiple: 2,
  s5CrashThreshold: -0.1,
  s5MaxWindow: 63,
  s6CrashThreshold: -0.05,
  s6VolMultiple: 2,
  volBaselineWindow: 20,
  liquidityMainMinAmountKRW: 1_000_000_000, // 10억원(주분석)
  liquiditySensitivityKRW: [300_000_000, 3_000_000_000] as const, // 3억/30억(민감도)
  amountAvgWindow: 20,
  matchMaxControls: 5,
  matchQuantileBins: 5,
  inconclusiveMinEvents: 50,
} as const;

/** KR 매도 비용(bps) — conditionalChannel run-kr-size.ts krCostParams와 동일 스케줄. */
export const KR_VARIABLE_COST_BPS = {
  commissionBps: 10,
  spreadBps: 10,
  slippageBps: 5,
  marketImpactBps: 5,
} as const;
