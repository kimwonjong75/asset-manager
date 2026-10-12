import { strict as assert } from 'assert';
import { readFileSync } from 'fs';

interface DiagnosticPayload {
  strategyPerformanceComputed: boolean;
  sourcePeriod: { commonKrxDates: number };
  results: Array<{
    assetId: string;
    lags: Array<{
      shift: number;
      futureDataUsed: boolean;
      metrics: { daily: { observations: number; correlation: number | null } };
    }>;
  }>;
}

const payload = JSON.parse(readFileSync(
  'scripts/backtest/core6SignalRotationV2Design/output/exploratory_metrics.json',
  'utf8',
)) as DiagnosticPayload;

assert.equal(payload.strategyPerformanceComputed, false);
assert.equal(payload.sourcePeriod.commonKrxDates, 751);
assert.equal(payload.results.length, 6);
for (const asset of payload.results) {
  assert.deepEqual(asset.lags.map(row => row.shift), [-2, -1, 0, 1, 2]);
  assert.ok(asset.lags.every(row => row.metrics.daily.observations > 700));
}
for (const assetId of ['069500', '385560']) {
  const asset = payload.results.find(row => row.assetId === assetId);
  assert.equal(asset?.lags.find(row => row.shift === 0)?.metrics.daily.correlation, 1);
}
for (const assetId of ['379800', '283580', '464470']) {
  const asset = payload.results.find(row => row.assetId === assetId);
  assert.equal(asset?.lags.find(row => row.shift === 0)?.futureDataUsed, false);
  assert.equal(asset?.lags.find(row => row.shift === 1)?.futureDataUsed, true);
}

console.log('core6 V2 proxy diagnostic parity: PASS');
