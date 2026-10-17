// tests/core6V3RunParity.ts
// 코어 6종 신호 로테이션 V3 — 실행기(run/*) 골든·가드 테스트. 오프라인·합성 패널(실제 패널/CD91 파일을 읽지 않는다).
// 사전등록: docs/backtest/PREREG_코어6종_신호로테이션_V3.md §7·§13·§17·§19, V2 §7.2·§11.
// 기대값은 손계산 숫자이며 구현 함수의 출력을 정답으로 쓰지 않는다.

import { strict as assert } from 'assert';
import { mkdtempSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  eligibility,
  proxySensitive,
  quarterShare,
  rankCandidates,
  runDevelopment,
} from '../scripts/backtest/core6SignalRotationV3/run/devRun';
import type { RankInput } from '../scripts/backtest/core6SignalRotationV3/run/devRun';
import {
  DEV_END_DATE,
  THRESHOLDS,
  VAL_START_DATE,
  cashRateArray,
  computeSignalCache,
  metricsFromEquity,
  panelWeights,
  ruleStartIndex,
  truncatePanel,
  includedAssets,
} from '../scripts/backtest/core6SignalRotationV3/run/common';
import type { CdRow } from '../scripts/backtest/core6SignalRotationV3/run/common';
import {
  cashLinearityError,
  renormalizeToPanel,
  runExplorer,
  validateWeights,
  weightSet,
} from '../scripts/backtest/core6SignalRotationV3/run/explorer';
import { computeHashes, buildLock } from '../scripts/backtest/core6SignalRotationV3/run/selectionLock';
import type { SelectionLock } from '../scripts/backtest/core6SignalRotationV3/run/selectionLock';
import { runValidation, validationEventPass, validationPerformance } from '../scripts/backtest/core6SignalRotationV3/run/runValidation';
import { ASSET_CODES, TARGET_WEIGHTS } from '../scripts/backtest/core6SignalRotationV3/types';
import type { AssetBars, AssetCode, Panel } from '../scripts/backtest/core6SignalRotationV3/types';

let checks = 0;
function eq<T>(actual: T, expected: T, label: string): void {
  checks += 1;
  assert.deepStrictEqual(actual, expected, label);
}
function near(actual: number, expected: number, label: string, tol = 1e-9): void {
  checks += 1;
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: expected ${expected}, got ${actual}`);
}
function throws(fn: () => unknown, pattern: RegExp, label: string): void {
  checks += 1;
  assert.throws(fn, pattern, label);
}

// ── 합성 패널 ───────────────────────────────────────────────────────────────
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s + 1) / 4294967297;
  };
}
function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(r())) * Math.cos(2 * Math.PI * r());
}
function weekdays(start: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  while (out.length < n) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function makePanel(n: number, seed: number, absent: AssetCode[] = []): Panel {
  const dates = weekdays('2021-12-15', n);
  const rng = makeRng(seed);
  const assets = {} as Record<AssetCode, AssetBars>;
  ASSET_CODES.forEach((code, a) => {
    const isAbsent = absent.includes(code);
    const open: (number | null)[] = [];
    const high: (number | null)[] = [];
    const low: (number | null)[] = [];
    const close: (number | null)[] = [];
    let px = 100 + a * 10;
    for (let i = 0; i < n; i++) {
      if (isAbsent) {
        open.push(null);
        high.push(null);
        low.push(null);
        close.push(null);
        continue;
      }
      const drift = 0.0009 * Math.sin((i + a * 37) / 55) + 0.0001;
      const prev = px;
      px = px * Math.exp(drift + 0.011 * gauss(rng));
      const o = prev * (1 + 0.002 * gauss(rng));
      const hi = Math.max(o, px) * (1 + Math.abs(gauss(rng)) * 0.004);
      const lo = Math.min(o, px) * (1 - Math.abs(gauss(rng)) * 0.004);
      open.push(o);
      high.push(hi);
      low.push(lo);
      close.push(px);
    }
    assets[code] = {
      code,
      open,
      high,
      low,
      close,
      fresh: new Array<boolean>(n).fill(!isAbsent),
      source: new Array<'actual' | 'absent'>(n).fill(isAbsent ? 'absent' : 'actual'),
    };
  });
  return { dates, assets };
}

function clonePanel(p: Panel): Panel {
  return JSON.parse(JSON.stringify(p)) as Panel;
}

const N = 1170;
const panel = makePanel(N, 20260101);
const cd91: CdRow[] = [];
for (let y = 2021; y <= 2026; y++) for (let m = 1; m <= 12; m++) cd91.push({ date: `${y}-${String(m).padStart(2, '0')}-02`, value: 2.0 + 0.1 * (y - 2021) });

// ── 1. 단순 골든 ────────────────────────────────────────────────────────────
// CD91: 12-30:1.00, 01-04:0.10, 01-06:3.00 (퍼센트). 세션 날짜 이전(엄격 <)의 마지막 값, −0.25%p, 하한 0.
{
  const rows: CdRow[] = [
    { date: '2021-12-30', value: 1.0 },
    { date: '2022-01-04', value: 0.1 },
    { date: '2022-01-06', value: 3.0 },
  ];
  const r = cashRateArray(['2022-01-03', '2022-01-04', '2022-01-05', '2022-01-06', '2022-01-07'], rows);
  near(r[0], 0.0075, 'cash 01-03');
  near(r[1], 0.0075, 'cash 01-04 (같은 날 공표값 미사용)');
  near(r[2], 0, 'cash 01-05 (0.10−0.25 → 0)');
  near(r[3], 0, 'cash 01-06 (같은 날 미사용)');
  near(r[4], 0.0275, 'cash 01-07');
  // 마지막 세션 이후 행은 읽지 않는다.
  const r2 = cashRateArray(['2022-01-03'], [...rows, { date: '2030-01-01', value: 99 }]);
  near(r2[0], 0.0075, 'cash 미래행 무시');
  throws(() => cashRateArray(['2021-01-01'], rows), /no CD91/, 'cash 이전 값 없음');
}

// 지표: equity [110,99,121], 시작 100. MDD = 99/110−1 = −0.1. 2020-01-01→2021-01-01 = 366일.
{
  const m = metricsFromEquity([110, 99, 121], ['2020-06-01', '2020-09-01', '2021-01-01'], 100, '2020-01-01');
  near(m.mdd, -0.1, 'MDD 골든');
  near(m.cagr, Math.pow(1.21, 365.2425 / 366) - 1, 'CAGR 골든');
  near(m.finalEquity, 121, '최종');
}

// truncatePanel
{
  const t = truncatePanel(panel, DEV_END_DATE);
  eq(t.dates[t.dates.length - 1], '2024-06-28', '잘린 마지막 날짜');
  eq(t.dates.every(d => d <= DEV_END_DATE), true, '잘린 날짜 전부 ≤ 개발 종료일');
  eq(t.assets['069500'].close.length, t.dates.length, '자산 배열도 같은 길이');
}

// ── 2. 적격·정렬·동률·분기·프록시 손계산 골든 ───────────────────────────────
{
  eq(eligibility({ days: 449, sells: 12, reentries: 6, sellAssets: 3, cagrOkOffsets: 4 }, THRESHOLDS).eligible, false, '유효일 449 부적격');
  eq(eligibility({ days: 450, sells: 12, reentries: 6, sellAssets: 3, cagrOkOffsets: 3 }, THRESHOLDS).eligible, true, '경계값 적격');
  eq(eligibility({ days: 450, sells: 11, reentries: 6, sellAssets: 3, cagrOkOffsets: 4 }, THRESHOLDS).eligible, false, '매도 11 부적격');
  eq(eligibility({ days: 450, sells: 12, reentries: 5, sellAssets: 3, cagrOkOffsets: 4 }, THRESHOLDS).eligible, false, '재진입 5 부적격');
  eq(eligibility({ days: 450, sells: 12, reentries: 6, sellAssets: 2, cagrOkOffsets: 4 }, THRESHOLDS).eligible, false, '매도 자산 2 부적격');
  const e2 = eligibility({ days: 450, sells: 12, reentries: 6, sellAssets: 3, cagrOkOffsets: 2 }, THRESHOLDS);
  eq([e2.sampleOk, e2.eligible], [true, false], 'CAGR 오프셋 2개 → 표본 OK, 부적격');

  const inputs: RankInput[] = [
    { rule: 'MA20', eligible: false, medianMddReduction: 0.9, medianCalmarImprovement: 9, adverseRetention: 1, medianTurnover: 0.1 },
    { rule: 'D55/55', eligible: true, medianMddReduction: 0.3, medianCalmarImprovement: 2, adverseRetention: 0.5, medianTurnover: 2 },
    { rule: 'D20/55', eligible: true, medianMddReduction: 0.3, medianCalmarImprovement: 2, adverseRetention: 1.0, medianTurnover: 2 },
    { rule: 'D10/55', eligible: true, medianMddReduction: 0.3, medianCalmarImprovement: 2, adverseRetention: 1.0, medianTurnover: 1 },
    { rule: 'ATR3/55', eligible: true, medianMddReduction: 0.3, medianCalmarImprovement: 2, adverseRetention: 1.0, medianTurnover: 1 },
    { rule: 'MA50', eligible: true, medianMddReduction: 0.35, medianCalmarImprovement: 0.1, adverseRetention: 0, medianTurnover: 9 },
  ];
  // MDD 0.35(MA50) → 동률군 0.30: Calmar 동일 2 → 유지비율 1.0(D20,D10,ATR) > 0.5(D55) → 회전율 1(D10,ATR) < 2(D20) → ID(ATR3/55 < D10/55)
  eq(rankCandidates(inputs), ['MA50', 'ATR3/55', 'D10/55', 'D20/55', 'D55/55'], '정렬·동률 해소 골든');
  // Calmar 가 먼저: 같은 MDD 에서 Calmar 높은 쪽이 앞
  eq(
    rankCandidates([
      { rule: 'MA20', eligible: true, medianMddReduction: 0.3, medianCalmarImprovement: 1, adverseRetention: 1, medianTurnover: 1 },
      { rule: 'MA50', eligible: true, medianMddReduction: 0.3, medianCalmarImprovement: 3, adverseRetention: 0, medianTurnover: 9 },
    ]),
    ['MA50', 'MA20'],
    'Calmar 우선',
  );

  const qs = quarterShare([
    { quarter: '2022Q1', excessPnl: 100 },
    { quarter: '2022Q2', excessPnl: 50 },
    { quarter: '2022Q3', excessPnl: -30 },
    { quarter: '2022Q4', excessPnl: 50 },
  ]);
  eq(qs?.quarter, '2022Q1', '분기 최대');
  near(qs?.share ?? NaN, 0.5, '분기 비중 100/200');
  eq(quarterShare([{ quarter: 'a', excessPnl: -1 }]), null, '양의 초과손익 없음 → null');

  eq(proxySensitive(['D10/55', 'MA20'], ['D10/55', 'D20/55', 'MA20', 'MA50']), false, 'P5 상위 3개 안 → 안정');
  eq(proxySensitive(['D10/55', 'MA20'], ['D10/55', 'D20/55', 'MA50', 'MA20']), true, 'P5 4위 → 프록시 민감');
}

// ── 3. 개발 가드: 검증구간 데이터를 바꿔도 개발 결과 불변 ─────────────────────
const lowThresholds = { ...THRESHOLDS, devSells: 1, devReentries: 1, devSellAssets: 1, pyramidCampaigns: 1, pyramidFills: 0 };
const devA = runDevelopment(panel, 'P', { cd91, thresholds: lowThresholds });
{
  const valIdx = panel.dates.findIndex(d => d >= VAL_START_DATE);
  const mutated = clonePanel(panel);
  for (const code of ASSET_CODES) {
    const a = mutated.assets[code];
    for (let i = valIdx; i < N; i++) {
      for (const arr of [a.open, a.high, a.low, a.close]) arr[i] = (arr[i] as number) * (i % 2 === 0 ? 3.7 : 0.21);
    }
  }
  const mutCd: CdRow[] = cd91.map(r => (r.date >= VAL_START_DATE ? { ...r, value: 25 } : r));
  const devB = runDevelopment(mutated, 'P', { cd91: mutCd, thresholds: lowThresholds });
  eq(JSON.stringify(devB), JSON.stringify(devA), '검증구간 가격·CD91 을 바꿔도 개발 결과 비트 단위 동일');
  throws(() => runDevelopment(panel, 'P', { cd91, devEndDate: '2024-07-01' }), /개발 가드/, '개발 종료일이 검증 시작 이후면 throw');
  eq(devA.sessions, panel.dates.filter(d => d <= DEV_END_DATE).length, '개발 세션 수');
  eq(devA.status, 'SELECTED', '낮춘 임계값 합성 → 선정 경로 실행');
  eq(devA.selected.length, 2, '상위 2개');
  eq(devA.pyramid.candidates.length, 6, '2신호 × 3간격');
  // 기본 임계값은 예외 없이 동작(판단 보류든 선정이든)
  const devDefault = runDevelopment(panel, 'P', { cd91 });
  eq(['SELECTED', '판단 보류'].includes(devDefault.status), true, '기본 임계값 실행');
  // 오프셋: 각 유효 오프셋은 360일 이상
  eq(devA.rules.every(r => r.offsets.every(o => o.days >= 360)), true, '오프셋 유효일 ≥ 360');
}

// ── 4. 선택 잠금·runValidation ──────────────────────────────────────────────
{
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'core6v3lock-'));
  throws(() => runValidation('P', { lockPath: path.join(tmp, 'nope.json'), panel, panelSha256: 'SYN', cd91 }), /선택 잠금 파일이 없습니다/, '잠금 없으면 runValidation throw');

  const hashes = computeHashes(panel, 'SYN');
  const lock: SelectionLock = buildLock(devA, hashes);
  const good = path.join(tmp, 'good.json');
  writeFileSync(good, JSON.stringify(lock));
  const bad = path.join(tmp, 'bad.json');
  writeFileSync(bad, JSON.stringify({ ...lock, hashes: { ...lock.hashes, codeSha256: 'deadbeef' } }));
  throws(() => runValidation('P', { lockPath: bad, panel, panelSha256: 'SYN', cd91 }), /해시 불일치: codeSha256/, '코드 해시 불일치 throw');
  const badPanel = path.join(tmp, 'badpanel.json');
  writeFileSync(badPanel, JSON.stringify({ ...lock, hashes: { ...lock.hashes, panelSha256: 'other' } }));
  throws(() => runValidation('P', { lockPath: badPanel, panel, panelSha256: 'SYN', cd91 }), /해시 불일치: panelSha256/, '패널 해시 불일치 throw');
  throws(() => runValidation('P5', { lockPath: good, panel, panelSha256: 'SYN', cd91 }), /패널/, '패널 이름 불일치 throw');

  const res = runValidation('P', { lockPath: good, panel, panelSha256: 'SYN', cd91 });
  eq(res.events.length, 2, '검증 사건 패스 2규칙');
  eq(res.events[0].days, panel.dates.filter(d => d >= VAL_START_DATE).length, '검증 유효일');
  eq(Object.keys(res.events[0]).sort(), ['days', 'ok', 'pyramid', 'pyramidOk', 'reasons', 'reentries', 'rule', 'sellAssets', 'sells'].sort(), '사건 패스에 성과 필드 없음');
  res.events.forEach((e, i) => eq(res.performance[i] === null, !e.ok, `성과는 최소사건 충족 때만 계산(${e.rule})`));

  // 사건 미달이면 성과 함수는 throw
  const cache = computeSignalCache(panel);
  const strict = validationEventPass(panel, cache, lock.selected, cd91, { ...THRESHOLDS, valSells: 10_000 });
  eq(strict.every(e => !e.ok), true, '임계값 상향 → 사건 미달');
  throws(() => validationPerformance(panel, cache, strict[0], lock.selected[0], cd91), /최소사건 미달/, '사건 미달 시 성과 계산 거부');
}

// ── 5. 탐색기 ───────────────────────────────────────────────────────────────
{
  const w0 = panelWeights(panel);
  const cache = computeSignalCache(panel);
  const exp = runExplorer(panel, cache, w0, cd91);
  eq(exp.warning.includes('채택 판정 불가'), true, '경고 문구');
  for (const rs of devA.rules) {
    const o0 = rs.offsets.find(o => o.offset === 0);
    if (!o0) continue;
    const rowR = exp.rows.find(r => r.rule === rs.rule && r.mode === 'ROTATE');
    const rowB = exp.rows.find(r => r.rule === rs.rule && r.mode === 'BH');
    const rowC = exp.rows.find(r => r.rule === rs.rule && r.mode === 'CASH');
    if (!rowR || !rowB || !rowC || !rowR.metrics.dev || !rowB.metrics.dev || !rowC.metrics.dev) throw new Error(`탐색기 행 없음 ${rs.rule}`);
    near(rowR.metrics.dev.cagr, o0.rotate.cagr, `${rs.rule} ROTATE CAGR == devRun`);
    near(rowR.metrics.dev.mdd, o0.rotate.mdd, `${rs.rule} ROTATE MDD == devRun`);
    near(rowB.metrics.dev.cagr, o0.bh.cagr, `${rs.rule} BH CAGR == devRun`);
    near(rowB.metrics.dev.mdd, o0.bh.mdd, `${rs.rule} BH MDD == devRun`);
    near(rowC.metrics.dev.cagr, o0.cash.cagr, `${rs.rule} CASH CAGR == devRun`);
    near(rowC.metrics.dev.mdd, o0.cash.mdd, `${rs.rule} CASH MDD == devRun`);
    checks += 1;
    assert.ok(rowR.metrics.validation !== null, '검증 구간 지표 별도 표시');
  }

  // 사전 지정 세트 골든
  const s1 = weightSet('W1', TARGET_WEIGHTS);
  near(s1['069500'], 1 / 6, 'W1 동일비중');
  const s2 = weightSet('W2', TARGET_WEIGHTS);
  near(s2['411060'], 0.15, 'W2 금 15%');
  near(s2['069500'], (0.17 / 0.75) * 0.85, 'W2 주식 비례(0.17/0.75×0.85)');
  const s3 = weightSet('W3', TARGET_WEIGHTS);
  near(s3['411060'], 0.35, 'W3 금 35%');
  near(s3['283580'], (0.16 / 0.75) * 0.65, 'W3 비례');
  const s4 = weightSet('W4', TARGET_WEIGHTS);
  near(s4['385560'] + s4['464470'], 0, 'W4 채권 0');
  near(s4['411060'], 0.25 / 0.75, 'W4 금 = 0.25/0.75');
  const s5 = weightSet('W5', TARGET_WEIGHTS);
  near(s5['069500'] + s5['379800'] + s5['283580'], 0.7, 'W5 주식 70%');
  near(s5['411060'], 0.15, 'W5 금 = 30%×25/50');
  for (const s of [s1, s2, s3, s4, s5, weightSet('W0', TARGET_WEIGHTS)]) near(ASSET_CODES.reduce((a, c) => a + s[c], 0), 1, '세트 합 1');
  validateWeights(s4, panel);
  throws(() => validateWeights({ ...s4, '069500': 0.5 }, panel), /합/, '합 ≠ 1 거부');

  // 자산을 뺀 비중(0) 지원 + P5 패널에서 없는 자산 비중 거부
  const p5 = makePanel(N, 20260101, ['464470']);
  eq(includedAssets(p5).length, 5, 'P5 구성 자산 5');
  throws(() => validateWeights(weightSet('W0', TARGET_WEIGHTS), p5), /가격이 없습니다/, '없는 자산 비중>0 거부');
  const w5 = renormalizeToPanel(weightSet('W0', TARGET_WEIGHTS), p5);
  near(w5['069500'], 0.17 / 0.875, 'P5 재정규화 0.17/0.875');
  near(w5['464470'], 0, 'P5 제외 자산 0');
  const e5 = runExplorer(p5, computeSignalCache(p5), w5, cd91);
  eq(e5.rows.length > 0, true, 'P5 탐색기 실행');
  const wNoBond = weightSet('W4', TARGET_WEIGHTS); // 0 비중 자산 포함
  const eNo = runExplorer(panel, cache, wNoBond, cd91);
  eq(eNo.rows.length > 0, true, '비중 0 자산 탐색 실행');

  // CASH 선형성(§19)
  const rate = cashRateArray(panel.dates, cd91);
  const start = ruleStartIndex(cache, 'D20/55', ASSET_CODES.slice(), N);
  if (start === null) throw new Error('시작 인덱스 없음');
  for (const w of [w0, weightSet('W2', TARGET_WEIGHTS), weightSet('W5', TARGET_WEIGHTS)]) {
    const err = cashLinearityError(panel, cache, 'D20/55', w, rate, start, N - 1);
    checks += 1;
    assert.ok(err < 1e-3, `CASH 선형 검산 최대오차 ${err}`);
  }
}

console.log(`core6V3RunParity: ${checks} assertions passed`);
