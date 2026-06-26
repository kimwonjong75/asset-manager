// types/signalReplay.ts
// 신호 리플레이 — "현재/선택 규칙 버전을 과거 시점 데이터에 대입한 재현" 타입.
// (그날 실제 발송된 팝업의 복원이 아님 — UI/문서 면책 명시.)
//
// 진단 결과는 기존 5A/5B 인프라를 그대로 재사용한다(새 엔진 금지):
//   · 구루: RuleDiagnostic (utils/guruDiagnostics.diagnoseAssetRules)
//   · 알림: AlertRuleDiagnostic (utils/alertDiagnostics.diagnoseAssetAlerts)
// 1차(P1~P3)는 라이브 신호/KnowledgeBase를 건드리지 않는다. RuleOverride/RuleVersion 도
// 1차에선 리플레이 화면 안(state)·localStorage(P2 사례)에만 존재하며 Drive 동기화 대상이 아니다.

import type { RuleDiagnostic, ConditionOperator } from './knowledge';
import type { AlertRuleDiagnostic } from './alertDiagnostics';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';

/** replay = 선택일 이후 가림(기본), review = 복기(이후 공개). 신호 계산은 모드와 무관(항상 룩어헤드 0). */
export type ReplayMode = 'replay' | 'review';

/** 신호 직후 성과 — 초보 친화 라벨(매수/매도 방향은 뷰에서 강조 구분). */
export interface SignalOutcome {
  /** N거래일 후 수익률 (%) — 데이터 없으면 null */
  ret5: number | null;
  ret20: number | null;
  ret60: number | null;
  /** [신호일, +60거래일] 구간 신호 후 최대 상승률 (%) */
  maxRise: number | null;
  /** [신호일, +60거래일] 구간 신호 후 최대 하락률 (%, 음수) */
  maxDrop: number | null;
}

/** 차트 마커 — 일자×방향 단위 1개(카운트 포함). */
export interface ReplayMarker {
  date: string;            // YYYY-MM-DD
  kind: 'buy' | 'sell';
  guruCount: number;       // 발화한 구루 규칙 수
  alertCount: number;      // 발화한 가격기반 알림 규칙 수
}

/** 차트용 OHLC 포인트(윈도 전체 — review 모드에서 미래 공개, replay 모드에서 asOf 이후 가림). */
export interface ReplayChartPoint {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
}

/** 한 거래일을 asOf로 둔 재현 결과 (룩어헤드 0). */
export interface ReplayDay {
  date: string;
  close: number;
  previousClose: number | null;
  changePct: number | null;
  enriched: EnrichedIndicatorData;        // 그 시점까지 데이터로만 산출
  guruDiagnostics: RuleDiagnostic[];       // diagnoseAssetRules 그대로 (발화=eligible&&matched, 미발화 사유 포함)
  alertDiagnostics: AlertRuleDiagnostic[]; // diagnoseAssetAlerts 그대로 (전 필터 tri-state + dataQuality)
  /** 구루 규칙별 leaf 근접도(통과 경계까지 거리) — RuleDiagnostic.leaves 순서와 1:1 정렬. */
  guruLeafDistances: Record<string, (number | null)[]>;
  outcome: SignalOutcome;                  // 미래 종가 기반(신호 계산엔 미사용) — 복기 성과
}

export interface ReplayTimeline {
  ticker: string;
  name: string;
  days: ReplayDay[];               // 윈도 내 각 거래일(각 날짜를 asOf로 평가)
  chartPoints: ReplayChartPoint[]; // 윈도 시작 ~ 최신(미래 포함)
  markers: ReplayMarker[];
  signalDates: string[];           // 마커가 있는 날(이전/다음 신호 네비)
}

// ── 보완 루프(P3 샌드박스 / P2 사례) — 1차는 리플레이 화면·localStorage 한정 ──

/** leaf 단위 비파괴 오버라이드. 키 = (ruleId, leafId). 임계값(value)·방향(operator)·사용여부(enabled) 조정. */
export interface RuleOverride {
  ruleId: string;
  leafId: string;
  operator?: ConditionOperator;
  value?: number | number[] | string | string[];
  enabled?: boolean; // false면 해당 조건 leaf를 평가에서 제외
  appliedAt?: string;
  note?: string;
}

/** 영구반영(P4, 2차) 직전 스냅샷 — 1차에선 타입만 정의(미사용). */
export interface RuleVersion {
  id: string;
  createdAt: string;
  note?: string;
  overrides: RuleOverride[];
}

export type ReplayCaseRole = 'research' | 'holdout';

export type SignalVerdictKind =
  | 'good'        // 적절함
  | 'too-early'   // 너무 빠름
  | 'too-late'    // 너무 늦음
  | 'false'       // 잘못된 신호
  | 'missed-buy'  // 놓친 매수 지점(미발화일 태깅)
  | 'missed-sell';// 놓친 매도 지점

/** 신호 사용자 판정 — 구루 신호 개선의 핵심 학습 데이터. localStorage 저장. */
export interface SignalVerdict {
  ticker: string;
  date: string;
  ruleId?: string;          // 특정 규칙에 대한 판정(없으면 그 날짜 전반)
  kind: SignalVerdictKind;
  memo?: string;
  createdAt: string;
}

/** 검증 사례 — 종목·기간·당시 규칙 스냅샷/해시·오버라이드·신호일·판정·메모. localStorage 저장(Drive 미동기화). */
export interface VerificationCase {
  id: string;
  ticker: string;
  name: string;
  exchange: string;
  categoryId: number;
  caseRole: ReplayCaseRole;
  anchorDate: string;
  windowTradingDays: number;
  rulesetHash: string;                                  // 당시 유효규칙 동일성 비교용
  ruleSnapshot: { ruleId: string; conditionJson: string; leafIds: string[] }[]; // 당시 규칙 원본 보존(시드 변해도 재현)
  overridesSnapshot: RuleOverride[];
  perRuleResults: { ruleId: string; action: string; signalDates: string[] }[];
  verdicts: SignalVerdict[];
  memo: string;
  resultMetrics?: { signalCount: number; avgRet20: number | null };
  createdAt: string;
  reRunAt?: string;
}
