import type { DailyBar } from '../utils/todayTurtle';

export interface HoldingPolicy {
  mode: 'hold' | 'exit-at-cost' | 'turtle-after-cost';
  /** 전체 예상 매도 비용률(%). 빈 값과 사용자가 확인한 0%는 다르다. */
  sellCostPct?: number;
  confirmedUnitCostKRW?: number;
  pyramidingEnabled?: boolean;
  requiresCostConfirmation?: boolean;
  startedOn?: string;
  cycleId?: string;
  armedOn?: string;
}

export interface HoldingPolicyEvaluation {
  phase: 'hold' | 'waiting' | 'exit-ready' | 'armed-today' | 'active' | 'unavailable';
  remainingPrincipalKRW: number | null;
  netProceedsKRW: number | null;
  armedOn?: string;
  reason: string;
}

export interface HoldingPolicyCloseInput {
  policy: HoldingPolicy;
  remainingPrincipalKRW: number | null;
  quantity: number;
  close: number | null;
  fxRate: number | null;
  sessionDate: string | null;
  expectedSession: string | null;
}

export interface HoldingPolicyHistoryInput extends Omit<HoldingPolicyCloseInput, 'close' | 'fxRate' | 'sessionDate'> {
  bars: readonly DailyBar[];
  fxForDate: (date: string) => number | null;
}

export interface HoldingPolicyActivation {
  assetId: string;
  cycleId: string;
  armedOn: string;
}
