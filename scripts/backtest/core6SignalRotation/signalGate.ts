import type { OhlcRow, RuleGateMetrics, RuleId, RuleTrace, SignalEvent } from './types';

const RULES: RuleId[] = ['D10/20', 'D20/55', 'D55/55', 'MA20', 'MA50', 'ATR3/55'];

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sma(rows: OhlcRow[], index: number, period: number): number | null {
  if (index + 1 < period) return null;
  return mean(rows.slice(index - period + 1, index + 1).map(row => row.close));
}

function priorExtreme(rows: OhlcRow[], index: number, period: number, field: 'high' | 'low'): number | null {
  if (index < period) return null;
  const values = rows.slice(index - period, index).map(row => row[field]);
  if (values.some(value => value === null)) return null;
  return field === 'high'
    ? Math.max(...values as number[])
    : Math.min(...values as number[]);
}

function wilderAtr20(rows: OhlcRow[]): Array<number | null> {
  const tr = rows.map((row, index): number | null => {
    if (row.high === null || row.low === null) return null;
    if (index === 0) return row.high - row.low;
    const prevClose = rows[index - 1].close;
    return Math.max(row.high - row.low, Math.abs(row.high - prevClose), Math.abs(row.low - prevClose));
  });
  const out: Array<number | null> = Array(rows.length).fill(null);
  if (rows.length < 20 || tr.slice(0, 20).some(value => value === null)) return out;
  out[19] = mean(tr.slice(0, 20) as number[]);
  for (let i = 20; i < rows.length; i++) {
    if (tr[i] === null || out[i - 1] === null) continue;
    out[i] = (out[i - 1]! * 19 + tr[i]!) / 20;
  }
  return out;
}

function donchianTrace(rows: OhlcRow[], exitPeriod: number, entryPeriod: number, rule: RuleId): RuleTrace {
  let state: 'active' | 'inactive' = 'active';
  const states: RuleTrace['states'] = [];
  const events: SignalEvent[] = [];
  for (let i = 0; i < rows.length; i++) {
    const exitLine = priorExtreme(rows, i, exitPeriod, 'low');
    const entryLine = priorExtreme(rows, i, entryPeriod, 'high');
    if (exitLine === null || entryLine === null) {
      states.push({ date: rows[i].date, state: 'unavailable' });
      continue;
    }
    if (state === 'active' && rows[i].close <= exitLine) {
      state = 'inactive';
      events.push({ date: rows[i].date, type: 'exit' });
    } else if (state === 'inactive' && rows[i].close >= entryLine) {
      state = 'active';
      events.push({ date: rows[i].date, type: 'entry' });
    }
    states.push({ date: rows[i].date, state });
  }
  return { rule, states, events };
}

function maTrace(rows: OhlcRow[], period: number, rule: RuleId): RuleTrace {
  let state: 'active' | 'inactive' = 'active';
  const states: RuleTrace['states'] = [];
  const events: SignalEvent[] = [];
  for (let i = 0; i < rows.length; i++) {
    const currentMa = sma(rows, i, period);
    const previousMa = i > 0 ? sma(rows, i - 1, period) : null;
    if (currentMa === null || previousMa === null) {
      states.push({ date: rows[i].date, state: 'unavailable' });
      continue;
    }
    const previousClose = rows[i - 1].close;
    if (rows[i].close <= currentMa && previousClose > previousMa) {
      state = 'inactive';
      events.push({ date: rows[i].date, type: 'exit' });
    } else if (rows[i].close >= currentMa && previousClose < previousMa) {
      state = 'active';
      events.push({ date: rows[i].date, type: 'entry' });
    }
    states.push({ date: rows[i].date, state });
  }
  return { rule, states, events };
}

function atrTrace(rows: OhlcRow[]): RuleTrace {
  const atr = wilderAtr20(rows);
  let state: 'active' | 'inactive' = 'active';
  let highWater: number | null = null;
  const states: RuleTrace['states'] = [];
  const events: SignalEvent[] = [];
  for (let i = 0; i < rows.length; i++) {
    const entryLine = priorExtreme(rows, i, 55, 'high');
    if (rows[i].high === null || atr[i] === null || entryLine === null) {
      states.push({ date: rows[i].date, state: 'unavailable' });
      continue;
    }
    if (state === 'active') {
      highWater = Math.max(highWater ?? rows[i].high!, rows[i].high!);
      const trail = highWater - 3 * atr[i]!;
      if (rows[i].close <= trail) {
        state = 'inactive';
        highWater = null;
        events.push({ date: rows[i].date, type: 'exit' });
      }
    } else if (rows[i].close >= entryLine) {
      state = 'active';
      highWater = rows[i].high;
      events.push({ date: rows[i].date, type: 'entry' });
    }
    states.push({ date: rows[i].date, state });
  }
  return { rule: 'ATR3/55', states, events };
}

export function buildRuleTraces(rows: OhlcRow[]): RuleTrace[] {
  return [
    donchianTrace(rows, 10, 20, 'D10/20'),
    donchianTrace(rows, 20, 55, 'D20/55'),
    donchianTrace(rows, 55, 55, 'D55/55'),
    maTrace(rows, 20, 'MA20'),
    maTrace(rows, 50, 'MA50'),
    atrTrace(rows),
  ];
}

export function matchEvents(
  actual: SignalEvent[],
  proxy: SignalEvent[],
  krxDates: string[],
  window: number
): { matched: number; ratio: number } {
  if (actual.length === 0 && proxy.length === 0) return { matched: 0, ratio: 1 };
  if (actual.length === 0 || proxy.length === 0) return { matched: 0, ratio: 0 };
  const index = new Map(krxDates.map((date, i) => [date, i]));
  const used = new Set<number>();
  let matched = 0;
  for (const event of actual) {
    const ai = index.get(event.date);
    if (ai === undefined) continue;
    let best: { pi: number; distance: number } | null = null;
    for (let pi = 0; pi < proxy.length; pi++) {
      if (used.has(pi) || proxy[pi].type !== event.type) continue;
      const proxyIndex = index.get(proxy[pi].date);
      if (proxyIndex === undefined) continue;
      const distance = Math.abs(ai - proxyIndex);
      if (distance <= window && (!best || distance < best.distance)) best = { pi, distance };
    }
    if (best) {
      used.add(best.pi);
      matched++;
    }
  }
  return { matched, ratio: matched / Math.max(actual.length, proxy.length) };
}

export function compareRuleTraces(
  actual: RuleTrace[],
  proxy: RuleTrace[],
  krxDates: string[],
  warmup: number,
  thresholds: { state: number; event: number; window: number }
): RuleGateMetrics[] {
  return RULES.map(rule => {
    const a = actual.find(trace => trace.rule === rule);
    const p = proxy.find(trace => trace.rule === rule);
    if (!a || !p) throw new Error(`Missing trace ${rule}`);
    const allowed = new Set(krxDates.slice(warmup));
    const aState = new Map(a.states.filter(row => allowed.has(row.date)).map(row => [row.date, row.state]));
    const pState = new Map(p.states.filter(row => allowed.has(row.date)).map(row => [row.date, row.state]));
    const comparable = [...allowed].filter(date => {
      const as = aState.get(date);
      const ps = pState.get(date);
      return as !== undefined && ps !== undefined && as !== 'unavailable' && ps !== 'unavailable';
    });
    const actualEvents = a.events.filter(event => allowed.has(event.date));
    const proxyEvents = p.events.filter(event => allowed.has(event.date));
    const event = matchEvents(actualEvents, proxyEvents, krxDates, thresholds.window);
    const stateMatch = comparable.length === 0
      ? null
      : comparable.filter(date => aState.get(date) === pState.get(date)).length / comparable.length;
    const complete = comparable.length === allowed.size;
    const reason = comparable.length === 0
      ? 'required OHLC unavailable'
      : !complete
        ? `proxy rule inputs incomplete: ${comparable.length}/${allowed.size} comparable dates`
        : undefined;
    return {
      rule,
      observations: comparable.length,
      stateMatch,
      actualEvents: actualEvents.length,
      proxyEvents: proxyEvents.length,
      matchedEvents: event.matched,
      eventMatch: comparable.length === 0 ? null : event.ratio,
      pass: complete && stateMatch !== null && stateMatch >= thresholds.state && event.ratio >= thresholds.event,
      reason,
    };
  });
}
