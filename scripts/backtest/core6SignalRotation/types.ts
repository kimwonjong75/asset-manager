export interface OhlcRow {
  date: string;
  timestampUtc: string | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
  rawClose?: number | null;
  adjustmentFactor?: number | null;
}

export interface YahooSeries {
  symbol: string;
  currency: string;
  exchange: string;
  timezone: string;
  rows: OhlcRow[];
  dividends: Array<{ date: string; amount: number; currency: string | null }>;
  splits: Array<{ date: string; numerator: number | null; denominator: number | null }>;
}

export type RuleId = 'D10/20' | 'D20/55' | 'D55/55' | 'MA20' | 'MA50' | 'ATR3/55';
export type PositionState = 'active' | 'inactive' | 'unavailable';

export interface SignalEvent {
  date: string;
  type: 'exit' | 'entry';
}

export interface RuleTrace {
  rule: RuleId;
  states: Array<{ date: string; state: PositionState }>;
  events: SignalEvent[];
  unavailableReason?: string;
}

export interface ReturnMetrics {
  observations: number;
  correlation: number | null;
  beta: number | null;
  trackingErrorAnnual: number | null;
  directionMatch: number | null;
}

export interface RuleGateMetrics {
  rule: RuleId;
  observations: number;
  stateMatch: number | null;
  actualEvents: number;
  proxyEvents: number;
  matchedEvents: number;
  eventMatch: number | null;
  pass: boolean;
  reason?: string;
}
