// scripts/backtest/conditionalChannel/pipeline/types.ts
// ---------------------------------------------------------------------------
// KR-size 파이프라인 전용 타입 — 원시 marcap 데이터, 처리 결과, 매니페스트.
// 앱 런타임 타입에 의존하지 않는다. `any` 금지.
// ---------------------------------------------------------------------------

import type {
  IsoDate,
  IsoTimestamp,
  LedgerCurrency,
  Market,
  MonthlyGroupFlags,
  PositionGroup,
} from '../../../../types/backtestConditionalChannel';

// ===========================================================================
// 1. 원시 marcap 스키마 (parquet → JSON 변환 후 구조)
// ===========================================================================

/** marcap 단일 행 — Python에서 변환된 JSON 구조 (원시, 미조정). */
export interface MarcapRawBar {
  date: IsoDate;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  stocks: number | null;        // 발행주식수 (null이면 결측)
  marketcap: number | null;     // Marcap = Close × Stocks (KRW)
  market_field: string | null;  // 'KOSPI' | 'KOSDAQ' | 'KONEX' | 'ETF' 등
}

/** 처리된(분할 조정) 바 — MarcapRawBar에 adj_* 필드 추가. */
export interface MarcapAdjustedBar extends MarcapRawBar {
  adj_factor: number;   // 누적 조정 배수 (최신 기준 1.0, 과거로 갈수록 < 1.0 for splits)
  adj_open: number;
  adj_high: number;
  adj_low: number;
  adj_close: number;
  adj_volume: number;
}

/** Python ingest가 생성하는 종목별 JSON 파일 구조. */
export interface SecurityJsonFile {
  code: string;
  name: string;
  bars: MarcapAdjustedBar[];
  split_events: SplitEventRaw[];
}

// ===========================================================================
// 2. 기업행위 처리 결과 (Python → TypeScript 경계)
// ===========================================================================

/** Python apply_corporate_actions.py가 감지한 원시 이벤트. */
export interface SplitEventRaw {
  code: string;
  name: string;
  event_date: IsoDate;
  prev_date: IsoDate;
  stocks_before: number;
  stocks_after: number;
  ratio: number;
  close_before: number;
  close_after: number;
  price_ratio: number | null;
  price_consistency: number | null;
  event_type: SplitEventType;
  classifiable: boolean;
}

export type SplitEventType =
  | 'SPLIT'
  | 'REVERSE_SPLIT'
  | 'BONUS_ISSUE_SUSPECTED'
  | 'SHARE_INCREASE_NO_PRICE_BREAK'
  | 'SHARE_DECREASE_NO_PRICE_BREAK'
  | 'SPLIT_OR_BONUS_UNKNOWN'
  | 'REVERSE_SPLIT_OR_BUYBACK_UNKNOWN';

// ===========================================================================
// 3. 종목 메타 (보통주 분류 결과)
// ===========================================================================

export type KrSecurityType =
  | 'COMMON_STOCK'     // KOSPI/KOSDAQ 보통주
  | 'PREFERRED_STOCK'  // 우선주
  | 'ETF_ETN'          // ETF/ETN
  | 'KONEX'            // KONEX 시장
  | 'SPAC'             // 기업인수목적회사
  | 'UNKNOWN';         // 분류 불가

export interface SecurityMeta {
  type: KrSecurityType;
  name: string;
  market: string;
}

// ===========================================================================
// 4. 월말 스냅샷 (build_month_end_universe.py 출력)
// ===========================================================================

export interface MonthEndSecurityRecord {
  code: string;
  name: string;
  sec_type: KrSecurityType;
  investable: boolean;
  close: number | null;
  stocks: number | null;
  marketcap: number | null;
  market_field: string | null;
  unclassifiable: boolean;
  rank: number | null;
  percentile: number | null;
  large: boolean;
  group: PositionGroup | null;  // null이면 unclassifiable
}

export interface MonthEndSnapshot {
  month_end: IsoDate;
  effective_month: string;       // 'YYYY-MM' — 이 스냅샷이 적용되는 달
  total_count: number;
  investable_count: number;
  classifiable_count: number;
  large_count: number;
  securities: MonthEndSecurityRecord[];
}

// ===========================================================================
// 5. 데이터 파이프라인 매니페스트 (build_manifest.py 출력)
// ===========================================================================

export interface GateResult {
  gate: string;
  passed: boolean;
  detail: string;
  [key: string]: unknown;        // 게이트별 추가 필드
}

export interface DataPipelineManifest {
  hypothesisId: string;
  generatedAt: IsoTimestamp;
  schemaVersion: number;
  dataGateVerdict: {
    prelock: 'PASS' | 'FAIL';
    lockbox: 'PASS' | 'FAIL';
    lockboxBlockReason: string | null;
  };
  gates: GateResult[];
  rawFiles: Record<string, string>;         // filename → SHA-256
  processedFiles: Record<string, string>;   // relative path → SHA-256
  recreateCommands: string[];
  licenseNote: string;
}

// ===========================================================================
// 6. 파이프라인 로드 결과 (dataLoader.ts 반환형)
// ===========================================================================

/** 시뮬레이터에 전달하는 형태로 변환된 KR-size 데이터셋. */
export interface KrSizeDataset {
  market: Market;
  currency: LedgerCurrency;
  /** 종목코드 → 분할조정 SecurityBars (시뮬레이터 호환) */
  securitiesByCode: Map<string, KrSecurityBars>;
  /** effectiveMonth → MonthlyGroupFlags[] */
  monthlyFlags: Map<string, MonthlyGroupFlags[]>;
  /** 전체 기업행위 이벤트 */
  corporateActions: SplitEventRaw[];
  /** 파이프라인 매니페스트 */
  manifest: DataPipelineManifest;
  /** 로드 시각 */
  loadedAt: IsoTimestamp;
}

/** simulator.ts의 SecurityBars 호환 KR 확장형. */
export interface KrSecurityBars {
  securityId: string;   // = code
  symbol: string;       // = code (KR에서는 코드가 안정 식별자)
  name: string;
  market: Market;
  currency: LedgerCurrency;
  dates: IsoDate[];
  open: number[];       // split-adjusted
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
  adjFactors: number[]; // 각 행의 누적 조정 배수
}

// ===========================================================================
// 7. 데이터 감사 결과 (dataQualityKrSize.ts 반환형)
// ===========================================================================

export type KrSizeAuditVerdict =
  | 'PASS_PRELOCK'           // prelock 실행 가능 (G1-G10 모두 통과)
  | 'PASS_PRELOCK_KRX_WAIT'  // prelock 실행 가능, 단 lockbox는 KRX 교차검증 대기
  | 'FAIL';                  // prelock도 불가

export interface KrSizeDataAuditResult {
  hypothesisId: 'conditional-channel-kr-size-v1';
  auditedAt: IsoTimestamp;
  manifestPath: string;
  manifest: DataPipelineManifest | null;  // manifest.json 미존재 시 null
  gates: GateResult[];
  verdict: KrSizeAuditVerdict;
  failedGates: string[];
  waitingGates: string[];
  prelockAllowed: boolean;
  lockboxAllowed: boolean;
  auditScopeNote: string;
}
