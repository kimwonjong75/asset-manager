import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const gatePath = path.join(root, 'output', 'gate_raw_results.json');

interface Pair { date: string; actual: number; proxy: number }
interface StoredMetric {
  observations: number;
  correlation: number | null;
  beta: number | null;
  trackingErrorAnnual: number | null;
  directionMatch: number | null;
}
interface AssetResult {
  assetId: string;
  returnMetrics: StoredMetric;
  pairedCloses: Pair[];
}
interface GateFile { mainApproximation: AssetResult[] }

function recalc(pairs: Pair[]): StoredMetric {
  const actualReturns: number[] = [];
  const proxyReturns: number[] = [];
  for (let i = 1; i < pairs.length; i++) {
    actualReturns.push((pairs[i].actual - pairs[i - 1].actual) / pairs[i - 1].actual);
    proxyReturns.push((pairs[i].proxy - pairs[i - 1].proxy) / pairs[i - 1].proxy);
  }
  const n = actualReturns.length;
  if (n < 2) return { observations: n, correlation: null, beta: null, trackingErrorAnnual: null, directionMatch: null };
  let sumA = 0;
  let sumP = 0;
  for (let i = 0; i < n; i++) { sumA += actualReturns[i]; sumP += proxyReturns[i]; }
  const ma = sumA / n;
  const mp = sumP / n;
  let cross = 0;
  let ssA = 0;
  let ssP = 0;
  const active: number[] = [];
  let sameDirection = 0;
  for (let i = 0; i < n; i++) {
    const da = actualReturns[i] - ma;
    const dp = proxyReturns[i] - mp;
    cross += da * dp;
    ssA += da * da;
    ssP += dp * dp;
    active.push(actualReturns[i] - proxyReturns[i]);
    if (Math.sign(actualReturns[i]) === Math.sign(proxyReturns[i])) sameDirection++;
  }
  const meanActive = active.reduce((sum, value) => sum + value, 0) / n;
  const activeVariance = active.reduce((sum, value) => sum + (value - meanActive) ** 2, 0) / (n - 1);
  return {
    observations: n,
    correlation: ssA > 0 && ssP > 0 ? cross / Math.sqrt(ssA * ssP) : null,
    beta: ssP > 0 ? cross / ssP : null,
    trackingErrorAnnual: Math.sqrt(activeVariance) * Math.sqrt(252),
    directionMatch: sameDirection / n,
  };
}

function close(a: number | null, b: number | null, tolerance = 1e-12): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= tolerance;
}

const gate = JSON.parse(readFileSync(gatePath, 'utf8')) as GateFile;
const checks = gate.mainApproximation.map(asset => {
  const independent = recalc(asset.pairedCloses);
  const fields: Array<keyof StoredMetric> = ['observations', 'correlation', 'beta', 'trackingErrorAnnual', 'directionMatch'];
  const differences = fields.filter(field => {
    const left = independent[field];
    const right = asset.returnMetrics[field];
    return typeof left === 'number' && typeof right === 'number' ? !close(left, right) : left !== right;
  });
  return { assetId: asset.assetId, pass: differences.length === 0, differences, independent, primary: asset.returnMetrics };
});

const result = {
  generatedAtUtc: new Date().toISOString(),
  calculationPath: 'standalone loop implementation; does not import primary metric functions',
  allPass: checks.every(check => check.pass),
  checks,
};
writeFileSync(path.join(root, 'output', 'independent_return_check.json'), JSON.stringify(result, null, 2));
if (!result.allPass) throw new Error('Independent return-metric cross-check failed');
console.log('Independent return-metric cross-check: PASS');
