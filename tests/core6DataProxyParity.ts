import { strict as assert } from 'assert';
import { alignLatestPriorSession, computeReturnMetrics, foreignProxyInKrw, hkdKrwCross } from '../scripts/backtest/core6SignalRotation/dataProcessing';
import { buildRuleTraces, compareRuleTraces, matchEvents } from '../scripts/backtest/core6SignalRotation/signalGate';
import type { OhlcRow, YahooSeries } from '../scripts/backtest/core6SignalRotation/types';

function rows(values: number[], startDay = 1): OhlcRow[] {
  return values.map((close, index) => ({
    date: `2026-01-${String(index + startDay).padStart(2, '0')}`,
    timestampUtc: null,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1,
  }));
}

console.log('core6 data/proxy parity');

{
  const a = rows([100, 101, 99, 102, 103]);
  const metrics = computeReturnMetrics(a, a.map(row => ({ ...row })));
  assert.equal(metrics.correlation, 1);
  assert.equal(metrics.beta, 1);
  assert.ok((metrics.trackingErrorAnnual ?? 1) < 1e-12);
  assert.equal(metrics.directionMatch, 1);
}

{
  assert.equal(hkdKrwCross(1400, 7.8), 1400 / 7.8);
  assert.throws(() => hkdKrwCross(1400, 0));
}

{
  const proxy = rows([10, 11, 12], 1);
  const aligned = alignLatestPriorSession(proxy, ['2026-01-02', '2026-01-03', '2026-01-04']);
  assert.deepEqual(aligned.map(row => row.close), [10, 11, 12]);
  assert.deepEqual(aligned.map(row => row.date), ['2026-01-02', '2026-01-03', '2026-01-04']);
}

{
  const base: YahooSeries = {
    symbol: 'X', currency: 'USD', exchange: 'X', timezone: 'UTC',
    rows: rows([10, 11]), dividends: [], splits: [],
  };
  const fx: YahooSeries = {
    symbol: 'FX', currency: 'KRW', exchange: 'CCY', timezone: 'UTC',
    rows: rows([1000, 1100]), dividends: [], splits: [],
  };
  const outer = foreignProxyInKrw(base, fx, 'outer-hl');
  const fixed = foreignProxyInKrw(base, fx, 'fixed-fx-hl');
  assert.equal(outer[1].close, 12100);
  assert.equal(fixed[1].high, base.rows[1].high! * 1000);
}

{
  const calendar = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'];
  assert.deepEqual(matchEvents([], [], calendar, 2), { matched: 0, ratio: 1 });
  assert.deepEqual(matchEvents([{ date: '2026-01-01', type: 'exit' }], [], calendar, 2), { matched: 0, ratio: 0 });
  const matched = matchEvents(
    [{ date: '2026-01-01', type: 'exit' }, { date: '2026-01-04', type: 'entry' }],
    [{ date: '2026-01-02', type: 'exit' }, { date: '2026-01-03', type: 'entry' }],
    calendar,
    1
  );
  assert.deepEqual(matched, { matched: 2, ratio: 1 });
}

{
  const trend = Array.from({ length: 90 }, (_, i) => 100 + i + (i % 7 === 0 ? -3 : 0));
  const complete = rows(trend);
  const incomplete = complete.map((row, i) => i < 70 ? { ...row, high: null, low: null } : row);
  const dates = complete.map(row => row.date);
  const gates = compareRuleTraces(
    buildRuleTraces(complete), buildRuleTraces(incomplete), dates, 55,
    { state: 0.75, event: 0.7, window: 2 }
  );
  assert.equal(gates.find(gate => gate.rule === 'MA20')?.pass, true);
  assert.equal(gates.find(gate => gate.rule === 'D20/55')?.pass, false);
  assert.match(gates.find(gate => gate.rule === 'D20/55')?.reason ?? '', /incomplete|unavailable/);
}

console.log('core6 data/proxy parity: PASS');
