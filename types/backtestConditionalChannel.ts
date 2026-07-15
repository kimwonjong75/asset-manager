// types/backtestConditionalChannel.ts
// ---------------------------------------------------------------------------
// 조건부 돌파 채널 가설 검증(PROMPT_3) 전용 타입 정의 — 연구 전용, 앱 런타임과 완전 분리.
//
// 가설: "대형주 또는 업종·카테고리 대장주는 20일 신고가 돌파 진입이 유리하고,
//        그 밖의 종목은 55일 신고가 돌파 진입이 유리한가?"
//
// 설계 원칙:
//   · 이 파일의 어떤 타입도 앱의 Asset/Portfolio/Turtle 런타임 타입에 의존하지 않는다.
//     (연구 산출물은 point-in-time 전체시장 패널을 다루므로 개인 보유 모델과 별개다.)
//   · point-in-time(날짜별 유효값) 원칙을 타입 수준에서 강제한다 — 시가총액·업종 분류·
//     그룹 플래그는 모두 effectiveDate/effectiveStart~End를 가진다. "현재값 소급 금지"를
//     타입이 구조적으로 방지한다.
//   · Phase 0 데이터 게이트(§3의 8개 하드스톱)를 통과하기 전에는 어떤 성과 추정치도
//     생성하지 않는다. DataAuditResult가 그 게이트의 기계 판독 산출물이다.
//   · `any` 금지. 모든 필드는 명시 타입.
//
// 관련 문서:
//   · docs/backtest/PROMPT_3_조건부채널검증.md   — 권위 있는 사양(모든 규칙의 원전)
//   · docs/backtest/PREREG_조건부채널검증.md      — 방법론 동결 사양
//   · docs/backtest/DATA_GAP_조건부채널검증.md    — Phase 0 강제 중단 보고서(현 환경)
//   · scripts/backtest/conditionalChannel/          — 실행기·감사·설정
// ---------------------------------------------------------------------------

// ===========================================================================
// 0. 공통 스칼라 별칭 (의미 명확화용 — 런타임 강제는 아니지만 문서적 계약)
// ===========================================================================

/** ISO 날짜 문자열 'YYYY-MM-DD' (거래일 또는 달력일). */
export type IsoDate = string;

/** ISO-8601 타임스탬프 'YYYY-MM-DDTHH:mm:ss.sssZ' (추출 시각 등 감사용). */
export type IsoTimestamp = string;

/** 대상 시장. 미국과 한국을 각각 독립 분석하고 사전 지정 원칙으로만 합산한다(§5). */
export type Market = 'US' | 'KR';

/** 원장 통화. 시장별 현지 통화 원장을 1차로 하고 통합 KRW 원장은 보조(§10). */
export type LedgerCurrency = 'USD' | 'KRW';

// ===========================================================================
// 1. 종목 식별과 상장 정보 (§3 종목 식별자 / 상장 정보)
// ===========================================================================

/**
 * 1차 투자 가능 종목 유형(§5). 보통주만 1차 대상이며 나머지는 제외 대상이다.
 * 제외 사유 추적을 위해 유형 자체는 열거로 보존한다.
 */
export type SecurityType =
  | 'COMMON_STOCK'   // 1차 대상: 미국 보통주, KOSPI/KOSDAQ 보통주
  | 'PREFERRED_STOCK'
  | 'ETF'
  | 'ETN'
  | 'REIT'
  | 'SPAC'
  | 'FUND'
  | 'BOND'
  | 'FUTURE'
  | 'OPTION'
  | 'CRYPTO'
  | 'OTHER';

/** 거래정지 기간(§3 거래정지 기간·§9 갭/거래정지 처리). */
export interface TradingHaltPeriod {
  start: IsoDate;
  end: IsoDate | null; // null = 아직 재개 안 됨(또는 이 구간 이후 상장폐지로 종료)
  reason: string;      // 감사용 사유 문자열(제공자 원문 또는 정규화 코드)
}

/**
 * 종목 식별 정보. 티커 변경과 재상장을 구분하는 안정적 영구 식별자가 핵심(§3).
 * 티커는 시간에 따라 바뀔 수 있으므로 securityId가 조인 키다.
 */
export interface SecurityIdentity {
  securityId: string;          // 안정적 영구 식별자(제공자 PERMNO/gvkey 등). 티커 변경·재상장 관통.
  symbol: string;              // 현재/기준 티커 (시점에 따라 변할 수 있음 → symbolHistory 참조)
  symbolHistory: SymbolHistoryEntry[]; // 티커 변경 이력(point-in-time 조인용)
  market: Market;
  exchange: string;            // 거래소 코드(예: 'XNAS', 'XNYS', 'XKRX', 'XKOS')
  securityType: SecurityType;
  listingDate: IsoDate;        // 상장일
  delistingDate: IsoDate | null; // 상장폐지일(없으면 null = 현재 상장 중)
  delistingReason: string | null; // 상장폐지 사유(합병/부도/자진 등). 대가 처리(§9-10)에 사용.
  tradingHalts: TradingHaltPeriod[]; // 거래정지 기간 목록
}

/** 티커 변경 이력 항목 — 특정 구간에 유효했던 티커. */
export interface SymbolHistoryEntry {
  symbol: string;
  effectiveStart: IsoDate;
  effectiveEnd: IsoDate | null; // null = 현재까지 유효
}

// ===========================================================================
// 2. 가격과 기업행위 (§3 가격 / 기업행위, §9 신호가 규칙)
// ===========================================================================

/**
 * 분할 조정된 일별 OHLCV 바. 신호가에는 split-adjusted OHLC를 쓰고 현금배당은
 * 별도 현금흐름으로 반영한다(§9-9). 미래 배당까지 반영한 총수익 조정가를
 * 신호에 조용히 쓰지 않는다 → adjustmentMethod로 조정 근거를 명시한다.
 */
export interface OhlcvBar {
  date: IsoDate;   // 해당 종목의 실제 거래일(합집합 달력 carry-forward 금지, §9-1)
  open: number;    // split-adjusted
  high: number;    // split-adjusted
  low: number;     // split-adjusted
  close: number;   // split-adjusted
  volume: number;  // split-adjusted 거래량(또는 원시 거래량 — adjustmentMethod에 명시)
  currency: LedgerCurrency; // 종목 통화(§3 가격: 통화 필수)
}

/** 가격 조정 방식. 신호가/손익 연속성 검증(§15)에 필요한 조정 근거 태그. */
export type PriceAdjustmentMethod =
  | 'SPLIT_ONLY'          // 분할만 조정, 배당은 별도 현금흐름(1차 신호가 규칙 §9-9)
  | 'SPLIT_AND_DIVIDEND'  // 총수익 조정(신호가에는 금지 — 보조 진단용으로만)
  | 'UNADJUSTED'          // 미조정 원시가(금지 — 감사에서 flag)
  | 'UNKNOWN';

/** 기업행위 유형(§3 기업행위). */
export type CorporateActionType =
  | 'SPLIT'               // 액면분할/병합(ratio로 방향 표현)
  | 'MERGER'              // 합병·인수
  | 'CASH_DIVIDEND'       // 현금배당
  | 'DELISTING'           // 상장폐지(대가/수익률 포함)
  | 'TICKER_CHANGE'       // 티커 변경
  | 'SPINOFF';            // 분사

/**
 * 기업행위 레코드. 분할 전후 신호·손익 연속성(§15), 상장폐지·합병 대가 반영(§9-10)에 사용.
 * 상장폐지 수익을 대량으로 0/최종종가로 임의 대체하는 것은 하드스톱(§3)이므로,
 * delistingReturn/proceeds는 실제 값이거나 명시적 null(불명)이어야 한다.
 */
export interface CorporateActionRecord {
  securityId: string;
  type: CorporateActionType;
  exDate: IsoDate;              // 권리락/효력 발생일
  // SPLIT/MERGER 비율: newShares / oldShares (예: 2:1 분할 = 2, 1:2 병합 = 0.5)
  ratio: number | null;
  // CASH_DIVIDEND: 주당 배당금(종목 통화). 별도 현금흐름으로 반영.
  cashDividendPerShare: number | null;
  // DELISTING: 상장폐지 대가(주당 현금) 또는 최종 청산 수익률.
  //   둘 중 실제로 확인된 것을 채우고, 불명이면 null(임의 대체 금지 — 하드스톱 회피).
  delistingProceedsPerShare: number | null;
  delistingReturn: number | null; // 상장폐지 시점 최종 수익률(예: -1 = 전액 손실). 확인값만.
  currency: LedgerCurrency;
  note: string | null;         // 감사 메모(제공자 원문 등)
}

// ===========================================================================
// 3. 규모·분류와 그룹 플래그 (§3 규모/분류, §6 그룹 정의 — 미래 정보 금지)
// ===========================================================================

/**
 * point-in-time 시가총액 레코드(§3 규모, §6-1 대형주).
 * 총시가총액 = 그 시점 종가 × 그 시점 발행주식수. effectiveDate가 핵심 —
 * 현재 시가총액을 과거에 소급하면 하드스톱(§3)에 걸린다.
 */
export interface PointInTimeMarketCap {
  securityId: string;
  effectiveDate: IsoDate;       // 이 시가총액이 유효한 시점(보통 월말 m)
  sharesOutstanding: number;    // 그 시점 발행주식수
  closePrice: number;           // 그 시점 종가(종목 통화)
  marketCap: number;            // = sharesOutstanding × closePrice (종목 통화)
  currency: LedgerCurrency;
  isPointInTime: boolean;       // true여야 확증 사용 가능. false면 EXPLORATORY로만.
}

/**
 * point-in-time 업종 분류 레코드(§3 분류, §6-2 대장주).
 * GICS/WICS 또는 제공자의 일관 표준 분류. 유효 시작·종료일과 분류 스킴/버전을 명시.
 * 앱의 개인 자산 카테고리나 현재 업종을 과거에 소급하지 않는다(§6-2 금지).
 */
export interface PointInTimeSectorClassification {
  securityId: string;
  schemeName: string;           // 분류 스킴명(예: 'GICS', 'WICS')
  schemeVersion: string;        // 스킴 버전/개정(예: '2018', 'v3'). 재분류 추적용.
  sectorCode: string;           // 업종 코드
  sectorName: string;           // 업종명
  effectiveStart: IsoDate;      // 이 분류가 유효해진 날
  effectiveEnd: IsoDate | null; // null = 현재까지 유효
  isPointInTime: boolean;       // true여야 확증 사용 가능.
}

/** 그룹 소속(§6). 그룹 A = large OR leader, 그룹 B = 정확한 여집합. */
export type PositionGroup = 'A' | 'B';

/**
 * 월별 그룹 플래그(§6). 매월 말 m에 알 수 있었던 값으로 m+1월 그룹을 정한다.
 * large/leader는 §6-1·§6-2로 산출된 boolean이며, group은 A = large||leader.
 */
export interface MonthlyGroupFlags {
  securityId: string;
  market: Market;
  asOfMonthEnd: IsoDate;        // 산출 기준 월말 m
  effectiveMonth: string;       // 적용 월 m+1 (예: '2020-04'). 진입 시 이 플래그를 동결.
  investable: boolean;          // §5 1차 투자 가능 종목군 통과 여부
  marketCap: number | null;     // 산출에 쓰인 총시가총액(감사용)
  marketCapPercentile: number | null; // 국가 내 시가총액 백분위(0~100)
  large: boolean;               // §6-1: 80백분위 이상(상위 20%)
  sectorCode: string | null;    // §6-2 판정에 쓰인 업종 코드
  sectorRankByMarketCap: number | null; // 업종 내 시총 순위(1 = 대장주)
  sectorInvestableCount: number | null; // 그 달 해당 업종 투자 가능 종목 수(≥5여야 leader 후보)
  leader: boolean;              // §6-2: 업종(투자가능 ≥5) 총시총 1위
  group: PositionGroup;         // A = large || leader, B = !large && !leader. ⚠ unclassifiable=true면 이 값은 무의미(A/B 분석에서 제외).
  /**
   * 해당 월에 point-in-time 총시가총액을 해석할 수 없어 대형주·대장주 판정 자체가 불가능한 종목(§6).
   * true면 그룹 A/B 확증 분석에서 **제외**한다 — group을 'B'로 흡수하면 B가 "미분류 잔여 버킷"으로
   * 오염되어 편향이 생기므로 금지. large/leader는 항상 false이며, group 값은 참고용(무의미)이다.
   * false면 정상적으로 A/B 중 하나로 분류된 종목이다.
   */
  unclassifiable: boolean;
  tieBreakNote: string | null;  // 80백분위 동률 처리 등 기록(§6-1: securityId 오름차순 tie-break)
}

// ===========================================================================
// 4. 전략 설정 (§7 채널 / §8 전략 / §10 위험 / §11 비용 / §12 통계)
// ===========================================================================

/** 채널 파라미터(진입/청산 룩백). 1차 실험은 청산을 20일로 고정(§7). */
export interface ChannelSpec {
  entryLookback: number; // 진입 신고가 돌파 채널(현재 바 제외, §9-2). 예: 20 또는 55.
  exitLookback: number;  // 청산 채널(현재 바 제외 이전 N일 저가). 1차 = 20 고정.
}

/**
 * 그룹별 채널 배정(§8). 네 전략(ALL_20/ALL_55/ADAPTIVE/REVERSE)을 이 형태로 표현.
 * groupA/groupB 각각의 진입 룩백이 전략을 정의한다(청산은 모두 20).
 */
export interface StrategyChannelAssignment {
  groupA: ChannelSpec;
  groupB: ChannelSpec;
}

/** 사전 정의된 네 비교 전략 ID(§8). */
export type StrategyId = 'ALL_20' | 'ALL_55' | 'ADAPTIVE' | 'REVERSE';

/** 비용 스트레스 배수(§11: 기본 비용, 비용 없음, 기본의 2배). */
export type CostTier = 'ZERO' | 'BASE' | 'DOUBLE';

/**
 * 비용 모형 파라미터(§11). 매수·매도 양쪽에 수수료·스프레드·슬리피지·시장충격.
 * 한국 매도세 등 시점에 따라 바뀐 세율은 시행일 기록 필수(오늘 세율 소급 금지, §11).
 */
export interface CostModelParams {
  market: Market;
  commissionBps: number;        // 편도 수수료(bps)
  spreadBps: number;            // 스프레드 대용치(bps) — 호가 데이터 없으면 보수적 구간별 식
  slippageBps: number;          // 슬리피지(bps)
  marketImpactBps: number;      // 시장충격(bps) — ADV 대비 주문비율에 연동 가능
  // 한국 매도세 등: 시행일별 세율. effectiveFrom 이후 적용. 오늘 세율 소급 금지.
  sellTaxSchedule: SellTaxScheduleEntry[];
  // 60거래일 중앙 거래대금의 이 비율을 넘는 체결은 수용 규모 분석에서 제한/미체결(§11).
  advParticipationCap: number;  // 예: 0.05 (= 5%)
  sourceNote: string;           // 세율·비용 출처와 시행일 근거(§11 출처·시행일 기록)
}

/** 시점별 매도세율(§11: 한국 매도세는 시행일별). */
export interface SellTaxScheduleEntry {
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
  taxBps: number;
  source: string;               // 공식 세율 출처
}

/** 포지션 사이징·위험 파라미터(§10). 1차 정책 값. */
export interface RiskParams {
  riskPerTradePct: number;      // 진입당 계좌자산 위험 %. 1차 = 0.5.
  totalRiskCapPct: number;      // 총 위험 한도 %. 1차 = 12.
  singleNameValueCapPct: number;// 단일 종목 평가액 한도 %. 1차 = 25.
  maxUnitsPerPosition: number;  // 최대 유닛. 1차 = 1(피라미딩 없음). 2차 민감도 = 2.
  atrLookback: number;          // 보호 손절 ATR 룩백. 1차 = 20.
  stopMultipleAtr: number;      // 손절 배수(진입가 − k×ATR). 설정에 정확 계산식 기록(§9-7).
  pyramidingEnabled: boolean;   // 1차 = false.
}

/** 열린 포지션 종료 처리 방식(§9-10: 세 방식 모두 민감도). */
export type OpenPositionCloseMethod =
  | 'FORCED_CLOSE'      // 1차: 마지막 공통 거래가능 종가에 비용 반영 강제 청산
  | 'MARK_TO_MARKET'    // 민감도: 미실현 평가
  | 'EXCLUDE_OPEN';     // 민감도: 미청산 거래 제외

/** 부트스트랩/순열 등 통계 설정(§12). */
export interface StatisticalPlan {
  blockBootstrapBlockDays: number; // 블록 부트스트랩 블록 길이. §12 = 60거래일.
  bootstrapIterations: number;     // 최소 10,000(§12.1).
  bootstrapSeed: number;           // 고정 시드(결정론).
  confidenceLevel: number;         // 예: 0.95.
  permutationCount: number;        // 무작위 라벨 순열. §12.3 = 1,000.
  permutationSeed: number;         // 순열 고정 시드.
  multipleComparison: 'HOLM' | 'NONE'; // 보조 검정 다중비교 보정(§12.1 = Holm).
}

/** 강건성 그리드(§12.3 사전 지정 민감도). 우수값을 새 기본값으로 채택 금지. */
export interface RobustnessGrid {
  entryLookbackShortGrid: number[]; // 예: [15, 20, 25]
  entryLookbackLongGrid: number[];  // 예: [45, 55, 65]
  largeCapPercentileGrid: number[]; // 예: [90, 80, 75] (상위 10/20/25%)
  costTiers: CostTier[];            // 예: ['ZERO', 'BASE', 'DOUBLE']
  fillDelayStressDays: number[];    // t+1 기본 대 t+2 지연(§12.3). 예: [1, 2].
  closeMethods: OpenPositionCloseMethod[]; // 종료 처리 세 방식.
}

/** 개발/검증/잠금 표본 분할(§4-6: 60/20/20, 잠금 ≥ 3완전연도). */
export interface SampleSplit {
  // 실제 달력 경계는 real point-in-time 패널 확정 후에만 채운다.
  // 데이터 미확보 상태에서는 모두 null이고 status로 표현한다.
  developmentStart: IsoDate | null;
  developmentEnd: IsoDate | null;
  validationStart: IsoDate | null;
  validationEnd: IsoDate | null;
  lockboxStart: IsoDate | null;
  lockboxEnd: IsoDate | null;
  status: 'PENDING_DATA' | 'FROZEN'; // PENDING_DATA = point-in-time 패널 미확보로 경계 미정
  ratioDevValidationLockbox: [number, number, number]; // [0.6, 0.2, 0.2]
  minLockboxFullYears: number;       // = 3 (§4-6·§13-7 표본 하한)
}

/**
 * 사전등록 동결 설정(§4). preregistered-config.json의 TS 대응.
 * 정규화 SHA-256을 문서와 최종 보고서에 기록한다(§4-4).
 */
export interface PreregisteredConfig {
  hypothesisId: string;             // 예: 'conditional-channel-v1'
  preregistrationDate: IsoDate;     // = '2026-07-15'(§4-9)
  markets: Market[];                // ['US', 'KR']
  primaryEstimand: string;          // 'I = deltaA - deltaB' (§7)
  strategies: Record<StrategyId, StrategyChannelAssignment>;
  largeCapPercentile: number;       // §6-1 1차 = 80(상위 20%)
  leaderMinIndustrySize: number;    // §6-2 = 5
  risk: RiskParams;
  costModels: CostModelParams[];    // 시장별
  statistics: StatisticalPlan;
  robustness: RobustnessGrid;
  sampleSplit: SampleSplit;
  primaryCloseMethod: OpenPositionCloseMethod; // = 'FORCED_CLOSE'
  seed: number;                     // 마스터 결정론 시드(고정 placeholder, 예 20260715)
  status: 'PENDING_DATA' | 'FROZEN';
  notes: string;
}

// ===========================================================================
// 5. 거래·주문·포지션 로그 (§9 체결 규칙, §14 거래 로그 산출물)
// ===========================================================================

/** 청산 사유(§9). */
export type ConditionalExitReason =
  | 'CHANNEL_EXIT'     // 20일 저가 채널 하향 돌파(§9-6)
  | 'PROTECTIVE_STOP'  // ATR 보호 손절(§9-7,8)
  | 'FORCED_CLOSE'     // 데이터 종료 강제 청산(§9-10)
  | 'DELISTING'        // 상장폐지 대가로 청산(§9-10)
  | 'HALT_UNRESOLVED'; // 거래정지 미재개로 종료

/** 미체결 사유(§14: 미체결 신호 로그). */
export type UnfilledReason =
  | 'RISK_CAP'         // 총 위험 한도 초과(§10)
  | 'SINGLE_NAME_CAP'  // 단일 종목 평가액 한도 초과
  | 'ADV_CAP'          // ADV 대비 주문비율 초과로 제한/미체결(§11)
  | 'ZERO_SHARES'      // 정수 주식 내림 결과 0주
  | 'HALT_AT_FILL'     // 체결일 거래정지
  | 'NO_NEXT_BAR'      // 다음 실제 거래일 바 없음
  | 'UNCLASSIFIED_GROUP'; // 진입 월의 그룹 분류 불가(unclassifiable) — A/B 조건부 전략(ADAPTIVE/REVERSE)에서 진입 불가(§6, Bug2 수정)

/**
 * 진입 주문 신호(체결 전). 신호일 종가 확인 후 다음 실제 거래일 시가 체결(§9-4).
 */
export interface EntrySignalRecord {
  securityId: string;
  symbol: string;
  market: Market;
  strategyId: StrategyId;
  group: PositionGroup;             // 진입 시점 그룹(청산까지 동결, §6-5)
  signalDate: IsoDate;              // close[t] > H_N(t) 성립한 t (§9-2)
  breakoutChannelHigh: number;      // 돌파한 H_N(t) (현재 바 제외 이전 N일 최고가)
  signalClose: number;             // close[t] (신호 성립 종가)
  entryLookbackUsed: number;        // 이 그룹·전략에 적용된 진입 룩백
}

/**
 * 체결된 진입/청산 주문. 슬리피지·갭·비용을 반영한 실제 체결 기록(§9, §14).
 */
export interface OrderFill {
  securityId: string;
  intendedDate: IsoDate;   // 신호일 t
  fillDate: IsoDate;       // 실제 체결일(t+1 시가; 거래정지면 재개일로 이월, §9-5)
  fillPrice: number;       // 실제 체결가(시가 기준, split-adjusted)
  side: 'BUY' | 'SELL';
  quantity: number;        // 정수 주식(내림, §10)
  slippageBps: number;     // 적용된 슬리피지
  costTier: CostTier;      // 이 체결에 적용된 비용 티어
  totalCostAmount: number; // 수수료+스프레드+슬리피지+세금 합(종목 통화)
  currency: LedgerCurrency;
}

/**
 * 한 포지션(진입~청산)의 완전한 거래 레코드(§14 거래 로그).
 * 진입 그룹을 청산까지 고정(§6-5). 손절가·슬리피지·청산 사유를 모두 보존.
 */
export interface ConditionalTradeRecord {
  tradeId: string;
  securityId: string;
  symbol: string;
  market: Market;
  strategyId: StrategyId;
  group: PositionGroup;             // 진입 시점 동결
  entrySignal: EntrySignalRecord;
  entryFill: OrderFill;
  stopPrice: number;                // 진입 시 확정 보호 손절가(진입가 − k×ATR20)
  atrAtEntry: number;               // 진입 시점 ATR20(손절 산출 근거)
  exitFill: OrderFill | null;       // null = 아직 열림(강제 청산 전)
  exitReason: ConditionalExitReason | null;
  exitStopHitPrice: number | null;  // 손절 체결 시 실제 통과 가격(§9-8 보수적 순서)
  netReturn: number | null;         // 비용 차감 수익률(청산 후)
  rMultiple: number | null;         // R 배수(위험 대비)
  holdingDays: number | null;       // 보유일(종목 거래일 기준)
  ledgerCurrency: LedgerCurrency;
}

/** 체결되지 못한 신호 로그(§14). */
export interface UnfilledSignalRecord {
  securityId: string;
  symbol: string;
  market: Market;
  strategyId: StrategyId;
  signalDate: IsoDate;
  reason: UnfilledReason;
  note: string | null;
}

/** 제외 종목과 사유(§14 제외 목록). */
export interface ExclusionRecord {
  securityId: string;
  symbol: string;
  market: Market;
  reason: string; // 예: 'ETF', 'REIT', 'preferred', 'SPAC', 'insufficient-history'
}

// ===========================================================================
// 6. 데이터 매니페스트 (§3·§14 필수 최소 필드)
// ===========================================================================

/**
 * 데이터 소스 매니페스트 항목(§3·§14). 소스별로 제공자·엔드포인트·추출 시각·
 * 데이터 버전·기간·시장·행 수·결측률·중복률·조정 방식·라이선스 제약·체크섬을 기록.
 * 라이선스상 커밋 불가한 원천은 파일을 커밋하지 말고 재생성 방법·체크섬만 남긴다(§3).
 * 자격증명·개인정보는 절대 기록하지 않는다(§3).
 */
export interface DataSourceManifestEntry {
  sourceId: string;                 // 논리적 소스 식별자(예: 'yahoo-v8-chart')
  provider: string;                 // 제공자명(예: 'Yahoo Finance')
  endpoint: string;                 // 테이블/엔드포인트(예: '/v8/finance/chart')
  capability: DataCapability;       // 이 소스가 제공하는 데이터 종류
  availability: 'AVAILABLE' | 'NOT_AVAILABLE'; // 현재 이 저장소에서 도달 가능한가
  reason: string | null;            // NOT_AVAILABLE인 경우 사유(§14 reason 필드)
  extractedAt: IsoTimestamp | null; // 추출 시각(NOT_AVAILABLE이면 null)
  dataVersion: string | null;       // 데이터 버전/스냅샷 태그
  period: { start: IsoDate; end: IsoDate } | null; // 커버 기간
  market: Market | 'BOTH' | null;
  rowCount: number | null;
  missingRate: number | null;       // 결측률(0~1)
  duplicateRate: number | null;     // 중복 바 비율(0~1)
  adjustmentMethod: PriceAdjustmentMethod | null; // 가격 조정 방식
  licenseConstraint: string | null; // 라이선스 제약(커밋 가능 여부 등)
  fileChecksum: string | null;      // 파일 체크섬(SHA-256 등). 원천 미커밋 시 재생성 대조용.
  isPointInTime: boolean;           // point-in-time 데이터인가(현재값 소급이면 false).
}

/** 소스가 제공하는 데이터 종류(§3 필드 표). */
export type DataCapability =
  | 'OHLCV_ADJUSTED'         // 분할/배당 조정 OHLCV
  | 'CORPORATE_ACTIONS'      // 기업행위(분할/배당/합병/상장폐지)
  | 'POINT_IN_TIME_MARKETCAP'// 역사적 시가총액/발행주식수
  | 'POINT_IN_TIME_SECTOR'   // 역사적 업종 분류(GICS/WICS 등)
  | 'DELISTED_UNIVERSE'      // 상장폐지 포함 전체 종목군
  | 'FULL_MARKET_TICKERS'    // 전체 시장 티커 목록(point-in-time)
  | 'FX_HISTORY'             // 거래일별 FX
  | 'COST_SCHEDULE';         // 시장·연도별 수수료·세금

/** 전체 데이터 매니페스트(§14). */
export interface DataManifest {
  hypothesisId: string;
  generatedAt: IsoTimestamp;
  sources: DataSourceManifestEntry[];
  // 원자료·캐시 디렉토리(커밋 금지, §14). 재생성 명령·스키마·행 수·체크섬만 문서화.
  rawDataDir: string;               // 예: 'scripts/backtest/data/conditionalChannel/'
  recreateInstructions: string;     // 재생성 방법(외부 소스 확보 후)
}

// ===========================================================================
// 7. 데이터 가능성 감사와 게이트 판정 (§3 하드스톱 8개, §16 data-audit)
// ===========================================================================

/**
 * §3의 8개 강제 중단(하드스톱) 조건. 하나라도 met=true면 1차 확증 백테스트를
 * 실행하지 않고 DATA_GAP 보고서만 작성한다.
 */
export type HardStopConditionId =
  | 'RETROACTIVE_TICKER_LIST'    // 현재 종목 목록을 과거 전체 기간에 소급해야 함
  | 'RETROACTIVE_MARKETCAP_SECTOR' // 현재 시가총액/업종을 과거 분류에 대신 써야 함
  | 'NO_POINT_IN_TIME_UNIVERSE'  // 상장폐지·합병 포함 point-in-time 종목군을 만들 수 없음
  | 'UNRELIABLE_ADJUSTMENTS'     // 분할조정/거래정지/중복바/통화오류를 신뢰성 있게 처리 불가
  | 'ARBITRARY_DELISTING_FILL'   // 상장폐지 수익을 대량 0/최종종가로 임의 대체해야 함
  | 'LOOKAHEAD_OR_SURVIVORSHIP'  // 룩어헤드 또는 생존편향을 제거할 수 없음
  | 'LOCKBOX_UNDER_3Y'           // 잠금 표본이 3년 미만
  | 'INSUFFICIENT_GROUP_SIZE';   // 핵심 그룹이 시장별 <30종목 또는 잠금 <100청산거래

/** 개별 하드스톱 조건 평가 결과. */
export interface HardStopCondition {
  id: HardStopConditionId;
  description: string;   // 조건 서술(한국어, §3 원문 대응)
  met: boolean;         // true = 이 조건 충족 → 게이트 실패에 기여
  evidence: string;     // 판정 근거(어떤 소스·감사에서 왜 이 결론인가)
}

/** 게이트 종합 판정. */
export type DataGateVerdict =
  | 'PASS'    // 8개 조건 모두 met=false → 확증 백테스트 진행 가능
  | 'FAIL';   // 하나라도 met=true → 강제 중단, DATA_GAP 보고서만

/**
 * 데이터 가능성 감사 결과(§3, §16 data-audit 산출물).
 * runDataAudit()의 반환형. verdict=FAIL이면 prelock/lockbox는 성과 추정치를
 * 생성하지 않고 비정상 종료(§16).
 */
export interface DataAuditResult {
  hypothesisId: string;
  auditedAt: IsoTimestamp;
  manifest: DataManifest;
  conditions: HardStopCondition[];  // 8개 전부(met true/false 무관)
  metConditionIds: HardStopConditionId[]; // met=true인 조건 id 목록
  verdict: DataGateVerdict;         // metConditionIds.length === 0 ? PASS : FAIL
  // 확증 진행을 위해 필요한 외부 입력 요약(§3·§14 DATA_GAP).
  requiredExternalInputs: string[];
  // 이 감사가 어떤 소스 집합을 대상으로 했는지(정적 능력 감사임을 명시).
  auditScopeNote: string;
}

// ===========================================================================
// 8. 판정과 증거 등급 (§13 판정 규칙, §17 증거 등급)
// ===========================================================================

/** 최종 판정(§13). */
export type ConditionalChannelVerdict =
  | 'SUPPORTED_FOR_PAPER_PILOT' // 10개 채택 게이트를 모두 통과(§13)
  | 'NOT_SUPPORTED'             // 가설 반대 방향 + 충분한 신뢰 데이터
  | 'INCONCLUSIVE';             // 데이터 부족/오염/낮은 검정력/설정 민감성/모순

/**
 * 증거 등급(§2·§17). 사전등록일(2026-07-15) 기준으로 SEALED_PSEUDO_OOS와
 * PROSPECTIVE_HOLDOUT을 구분한다(§4-9).
 */
export type EvidenceGrade =
  | 'EXPLORATORY'               // 기존 종목·기간 재분할 등 탐색적(§2)
  | 'PREREGISTERED_REPLICATION' // 결과 보기 전 규칙 동결한 사전등록 복제(§2)
  | 'SEALED_PSEUDO_OOS'         // 사전등록일 이전 데이터의 마지막 20% 잠금(§4-9)
  | 'PROSPECTIVE_HOLDOUT';      // 2026-07-15 이후 새로 발생한 데이터에만(§4-9)

/** §13의 10개 채택 게이트 조건 id. */
export type AdoptionGateId =
  | 'CI_LOWER_ABOVE_ZERO'       // 1. 잠금 50:50 합산 I의 95% CI 하한 > 0
  | 'DELTA_SIGNS'               // 2. ΔA > 0, ΔB < 0
  | 'BOTH_MARKETS_POSITIVE_I'   // 3. 미국·한국 I 점추정 모두 양수
  | 'ADAPTIVE_BEATS_BASELINES'  // 4. ADAPTIVE가 ALL_20·ALL_55 대비 CAGR +1.0%p·Sharpe +0.10
  | 'MDD_NOT_WORSE'             // 5. ADAPTIVE MDD가 더 나은 기준선 대비 2.0%p 초과 악화 없음
  | 'ROBUST_TO_DOUBLE_COST'     // 6. 비용 2배에서도 I>0 & ADAPTIVE 열등 아님
  | 'GROUP_SIZE_ADEQUATE'       // 7. A·B 시장별 ≥30종목, 잠금 ≥100청산거래
  | 'LEAVE_ONE_OUT_STABLE'      // 8. 최대기여 종목·업종·연도 제거해도 I 부호 양수 유지
  | 'BEATS_REVERSE_AND_PERM'    // 9. ADAPTIVE > REVERSE & 무작위 라벨 95백분위 초과
  | 'CLEAN_DATA_QA';            // 10. 룩어헤드·생존편향·기업행위·중복바·휴장압축·통화오류 없음

/** 개별 채택 게이트 평가(§13·§17-5: PASS/FAIL/NA + 근거). */
export interface AdoptionGateResult {
  id: AdoptionGateId;
  description: string;
  status: 'PASS' | 'FAIL' | 'NA';
  evidence: string;
}

// ===========================================================================
// 9. 성과 요약 (§12.2 반드시 보고할 지표, §14 요약 JSON)
// ===========================================================================

/** 전략×시장×그룹×기간별 성과 요약(§12.2). 시뮬레이터/통계 모듈이 채운다. */
export interface PerformanceSummary {
  strategyId: StrategyId;
  market: Market | 'COMBINED_50_50';
  group: PositionGroup | 'ALL';
  costTier: CostTier;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  tradeCount: number;
  winRate: number;
  cagr: number;
  annualizedVol: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  calmar: number;
  avgR: number;
  medianR: number;
  profitFactor: number;
  avgHoldingDays: number;
  exposure: number;
  turnover: number;
}

/** 점추정+구간 통계(ΔA, ΔB, I 등의 §12.2 보고 형식). */
export interface EstimateWithInterval {
  pointEstimate: number;
  ciLower: number;
  ciUpper: number;
  pValue: number;
  confidenceLevel: number;
  bootstrapIterations: number;
  seed: number;
}

/** 1차 상호작용 추정 결과 묶음(§7). */
export interface InteractionEstimate {
  market: Market | 'COMBINED_50_50';
  deltaA: EstimateWithInterval; // mean(R20,A − R55,A)
  deltaB: EstimateWithInterval; // mean(R20,B − R55,B)
  interactionI: EstimateWithInterval; // I = ΔA − ΔB
  evidenceGrade: EvidenceGrade;
  configHash: string;           // 설정 JSON 정규화 SHA-256(§4-4·§17-3)
}

/**
 * 최종 보고서 헤더(§17 첫 화면). 판정·한 문장 답·증거 등급·핵심 표·채택 게이트.
 * 데이터 게이트 실패 시 verdict=INCONCLUSIVE, 성과 필드는 비고 사유로 채운다.
 */
export interface ConditionalChannelReportHeader {
  verdict: ConditionalChannelVerdict;
  oneSentenceAnswer: string;        // §17-2
  evidenceGrade: EvidenceGrade;
  dataAsOf: IsoDate | null;
  configHash: string;               // §17-3
  interaction: InteractionEstimate[]; // §17-4 핵심 표
  adoptionGates: AdoptionGateResult[]; // §17-5 10개 게이트
  keyLimitationsAndNextActions: string; // §17-6
  dataGate: DataAuditResult;        // Phase 0 감사 결과(게이트 실패면 여기서 근거)
}
