// tests/core6V3SignalParity.ts
// 코어 6종 신호 로테이션 V3 — 신호 6종 골든·불변식. 오프라인·합성 데이터. 모든 기대값은 손계산(아래 주석 참조).
// 실행: npx tsx tests/core6V3SignalParity.ts

import { computeSignals, warmupBars } from '../scripts/backtest/core6SignalRotationV3/signals/signals';
import type { AssetBars, SignalRuleId, SignalSeries } from '../scripts/backtest/core6SignalRotationV3/types';

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected)) pass++;
  else { fail++; console.error(`  FAIL ${name}\n      기대=${String(expected)} 실제=${String(actual)}`); }
}
function checkClose(name: string, actual: number | null, expected: number, tol = 1e-9): void {
  if (actual !== null && Number.isFinite(actual) && Math.abs(actual - expected) <= tol) pass++;
  else { fail++; console.error(`  FAIL ${name}\n      기대=${expected} 실제=${String(actual)} (tol ${tol})`); }
}
function checkList(name: string, actual: number[], expected: number[]): void {
  check(name, JSON.stringify(actual), JSON.stringify(expected));
}
function trueIdx(a: boolean[]): number[] {
  const out: number[] = [];
  a.forEach((v, i) => { if (v) out.push(i); });
  return out;
}

console.log('core6 V3 신호 골든·불변식 테스트\n');

// ── 헬퍼 ────────────────────────────────────────────────────────────────
interface Row { o: number; h: number; l: number; c: number }
function mkBars(rows: Row[], extra?: { fresh?: boolean[]; source?: AssetBars['source'] }): AssetBars {
  return {
    code: '069500',
    open: rows.map(r => r.o), high: rows.map(r => r.h), low: rows.map(r => r.l), close: rows.map(r => r.c),
    fresh: extra?.fresh ?? rows.map(() => true),
    source: extra?.source ?? rows.map(() => 'actual' as const),
  };
}
function flat(n: number, c = 100): Row[] {
  return Array.from({ length: n }, () => ({ o: c, h: c, l: c, c }));
}

// ── 0. warmupBars (사양 근거) ──────────────────────────────────────────
check('warmup D10/55', warmupBars('D10/55'), 55);
check('warmup D20/55', warmupBars('D20/55'), 55);
check('warmup D55/55', warmupBars('D55/55'), 55);
check('warmup MA20', warmupBars('MA20'), 20);
check('warmup MA50', warmupBars('MA50'), 50);
check('warmup ATR3/55', warmupBars('ATR3/55'), 55);

// ── 1. Donchian 경로 A (61봉) ──────────────────────────────────────────
// idx0..54: h102 l98 c100 (idx20 저가=90, idx45 저가=97).  idx55: h102 l98 c100.
// idx56: h100 l97.5 c97.8 / idx57: h98 l96 c96.5 / idx58: h99 l96 c98 / idx59: h104 l98 c103 / idx60: h103.5 l94.5 c95
function donchianPath(): Row[] {
  const rows: Row[] = Array.from({ length: 56 }, () => ({ o: 100, h: 102, l: 98, c: 100 }));
  rows[20] = { o: 100, h: 102, l: 90, c: 100 };
  rows[45] = { o: 100, h: 102, l: 97, c: 100 };
  rows.push({ o: 100, h: 100, l: 97.5, c: 97.8 });   // 56
  rows.push({ o: 97.8, h: 98, l: 96, c: 96.5 });     // 57
  rows.push({ o: 96.5, h: 99, l: 96, c: 98 });       // 58
  rows.push({ o: 98, h: 104, l: 98, c: 103 });       // 59
  rows.push({ o: 103, h: 103.5, l: 94.5, c: 95 });   // 60
  return rows;
}
{
  const bars = mkBars(donchianPath());
  const d10 = computeSignals(bars, 'D10/55');
  const d20 = computeSignals(bars, 'D20/55');
  const d55 = computeSignals(bars, 'D55/55');

  // D10: idx56 close 97.8 <= min(low idx46..55)=98 -> 매도. (현재 봉 저가 97.5를 포함했다면 97.8<=97.5 거짓이라 매도가 사라진다 = 현재 봉 제외 보호)
  //      idx59 close 103 >= max(high idx4..58)=102 -> 재진입. idx60 close 95 <= min(low idx50..59)=96 -> 매도.
  checkList('D10 sell', trueIdx(d10.sellEvent), [56, 60]);
  checkList('D10 reentry', trueIdx(d10.reentryEvent), [59]);
  // D20: idx56 close 97.8 > min(low idx36..55)=97(idx45) -> 매도 아님. idx57 close 96.5 <= min(low idx37..56)=97 -> 매도.
  checkList('D20 sell', trueIdx(d20.sellEvent), [57, 60]);
  checkList('D20 reentry', trueIdx(d20.reentryEvent), [59]);
  // D55: 창에 idx20 저가 90이 들어 있어 이 경로에서는 매도 없음.
  checkList('D55 sell', trueIdx(d55.sellEvent), []);
  checkList('D55 reentry', trueIdx(d55.reentryEvent), []);

  for (const s of [d10, d20, d55]) {
    check(`${s.rule} valid[54]`, s.valid[54], false);
    check(`${s.rule} valid[55]`, s.valid[55], true);
    check(`${s.rule} valid 개수`, s.valid.filter(Boolean).length, 6);
    check(`${s.rule} 워밍업 active=true`, s.active.slice(0, 55).every(Boolean), true);
    check(`${s.rule} 워밍업 이벤트 없음`, s.sellEvent.slice(0, 55).some(Boolean) || s.reentryEvent.slice(0, 55).some(Boolean), false);
    check(`${s.rule} 길이`, s.active.length, 61);
    check(`${s.rule} atr20[19]`, s.atr20[19], null);
    checkClose(`${s.rule} atr20[20]`, s.atr20[20], 4.4);   // TR1..19=4, TR20=max(12,2,10)=12(idx20 저가 90) -> (19*4+12)/20
  }
  // active: 상태기계 (i일 종가 처리 후)
  checkList('D10 active=false 구간', d10.active.map((a, i) => (!a ? i : -1)).filter(i => i >= 0), [56, 57, 58, 60]);
  checkList('D20 active=false 구간', d20.active.map((a, i) => (!a ? i : -1)).filter(i => i >= 0), [57, 58, 60]);
  // 같은 날 매도·재진입 동시 없음
  for (const s of [d10, d20, d55]) {
    check(`${s.rule} 동시 이벤트 없음`, s.sellEvent.some((v, i) => v && s.reentryEvent[i]), false);
  }
  // 재현성
  check('같은 입력 2회 동일(D10)', JSON.stringify(computeSignals(bars, 'D10/55')), JSON.stringify(d10));
}

// ── 2. MA20 (교차 조건) ────────────────────────────────────────────────
// 종가: idx0..20=100, 21=110, 22=120, 23=90, 24=95, 25=105, 26=106 (o=h=l=c)
//  idx20: SMA=100, 직전종가100 > 직전SMA100 거짓 -> 매도 아님(교차는 엄격 부등호)
//  idx23: SMA(4..23)=101, close 90<=101, 직전 120 > 직전SMA 101.5 -> 매도
//  idx24: SMA=100.75, close 95 < SMA -> 재진입 아님
//  idx25: SMA=101, close 105>=101, 직전 95 < 직전SMA 100.75 -> 재진입
{
  const closes = [...Array(21).fill(100), 110, 120, 90, 95, 105, 106] as number[];
  const bars = mkBars(closes.map(c => ({ o: c, h: c, l: c, c })));
  const s = computeSignals(bars, 'MA20');
  checkList('MA20 sell', trueIdx(s.sellEvent), [23]);
  checkList('MA20 reentry', trueIdx(s.reentryEvent), [25]);
  check('MA20 valid[19]', s.valid[19], false);
  check('MA20 valid[20]', s.valid[20], true);
  check('MA20 valid 개수', s.valid.filter(Boolean).length, 7);
  checkList('MA20 inactive 구간', s.active.map((a, i) => (!a ? i : -1)).filter(i => i >= 0), [23, 24]);
}
// 시작 시점에 이미 SMA 아래: 교차가 없으므로 매도 이벤트 없음(사양 그대로) — active 유지.
{
  const closes = [...Array(10).fill(100), ...Array(11).fill(90), 90, 100, 100] as number[];
  // idx0..9=100, 10..20=90, 21=90, 22=100, 23=100
  const s = computeSignals(mkBars(closes.map(c => ({ o: c, h: c, l: c, c }))), 'MA20');
  // idx20: SMA(1..20)=(9*100+11*90)/20=94.5, close 90<=94.5, 직전종가 90 > 직전SMA 95 거짓 -> 매도 아님
  check('MA20 시작부터 SMA 아래: 이벤트 0', s.sellEvent.some(Boolean) || s.reentryEvent.some(Boolean), false);
  check('MA20 시작부터 SMA 아래: active 유지', s.active.every(Boolean), true);
  check('MA20 valid[20]', s.valid[20], true);
}

// ── 3. MA50 ────────────────────────────────────────────────────────────
// idx0..49=100, 50=101, 51=90, 52=100.  idx51: SMA=(48*100+101+90)/50=99.82, 직전 101>직전SMA 100.02 -> 매도.
// idx52: SMA(3..52)=99.82, close 100>=99.82, 직전 90 < 99.82 -> 재진입.
{
  const closes = [...Array(50).fill(100), 101, 90, 100] as number[];
  const s = computeSignals(mkBars(closes.map(c => ({ o: c, h: c, l: c, c }))), 'MA50');
  check('MA50 valid[49]', s.valid[49], false);
  check('MA50 valid[50]', s.valid[50], true);
  checkList('MA50 sell', trueIdx(s.sellEvent), [51]);
  checkList('MA50 reentry', trueIdx(s.reentryEvent), [52]);
  checkList('MA50 inactive 구간', s.active.map((a, i) => (!a ? i : -1)).filter(i => i >= 0), [51]);
}

// ── 4. ATR3/55 ─────────────────────────────────────────────────────────
// idx0..54: o100 h101 l99 c100 (TR=2 -> ATR20=2, idx20부터).
// idx55(첫 valid): runningHigh=101, trail=101-6=95, close100 -> 유지.
// idx56: h110 l104 c108: TR=10, ATR=2.4, high=110, trail=max(95,110-7.2)=102.8
// idx57: h109 l100 c102: TR=9, ATR=2.73, cand=110-8.19=101.81 < 102.8 -> trail 래칫 유지 102.8, close102<=102.8 -> 매도
// idx58: h104 l101 c103: TR=3, ATR=2.7435. 재진입 채널 max(high idx3..57)=110 -> 103 미달
// idx59: h112 l100 c111.5: close>=110 재진입. TR=12, ATR=3.206325, 재진입일 고가로 리셋: trail=112-9.618975=102.381025 (<102.8: 리셋 확인)
// idx60: h111 l102 c102.5: TR=9.5, ATR=3.52100875, cand=101.43697375 -> trail 유지 102.381025, close 102.5 > trail -> 유지
// idx61: h103 l101 c102: TR=2, ATR=3.4449583125, trail 102.381025, close102 <= -> 매도
function atrPath(): Row[] {
  const rows: Row[] = Array.from({ length: 56 }, () => ({ o: 100, h: 101, l: 99, c: 100 }));
  rows.push({ o: 105, h: 110, l: 104, c: 108 });    // 56
  rows.push({ o: 108, h: 109, l: 100, c: 102 });    // 57
  rows.push({ o: 102, h: 104, l: 101, c: 103 });    // 58
  rows.push({ o: 103, h: 112, l: 100, c: 111.5 });  // 59
  rows.push({ o: 111, h: 111, l: 102, c: 102.5 });  // 60
  rows.push({ o: 102.5, h: 103, l: 101, c: 102 });  // 61
  return rows;
}
{
  const bars = mkBars(atrPath());
  const s = computeSignals(bars, 'ATR3/55');
  checkList('ATR sell', trueIdx(s.sellEvent), [57, 61]);
  checkList('ATR reentry', trueIdx(s.reentryEvent), [59]);
  check('ATR valid[54]', s.valid[54], false);
  check('ATR valid[55]', s.valid[55], true);
  check('ATR active[56]', s.active[56], true);
  check('ATR active[57]', s.active[57], false);
  check('ATR active[58]', s.active[58], false);
  check('ATR active[59]', s.active[59], true);
  check('ATR active[60]', s.active[60], true);
  check('ATR active[61]', s.active[61], false);
  check('ATR atr20[19]', s.atr20[19], null);
  checkClose('ATR atr20[20]', s.atr20[20], 2);
  checkClose('ATR atr20[55]', s.atr20[55], 2);
  checkClose('ATR atr20[56]', s.atr20[56], 2.4);
  checkClose('ATR atr20[57]', s.atr20[57], 2.73);
  checkClose('ATR atr20[58]', s.atr20[58], 2.7435);
  checkClose('ATR atr20[59]', s.atr20[59], 3.206325);
  checkClose('ATR atr20[60]', s.atr20[60], 3.52100875);
  checkClose('ATR atr20[61]', s.atr20[61], 3.4449583125);
  // 다른 규칙에서도 atr20이 채워지고 같은 값이다.
  const d = computeSignals(bars, 'D10/55');
  checkClose('D10 atr20[57]도 동일', d.atr20[57], 2.73);
  const m = computeSignals(bars, 'MA20');
  checkClose('MA20 atr20[57]도 동일', m.atr20[57], 2.73);
}
// 진입일 고가 기준: 워밍업 중 고가 150이 있어도 runningHigh는 첫 valid일(idx55)의 고가에서 시작 -> idx55·56에서 매도 없음.
{
  const rows = atrPath();
  rows[10] = { o: 100, h: 150, l: 99, c: 100 };
  const s = computeSignals(mkBars(rows), 'ATR3/55');
  check('ATR 워밍업 고가는 runningHigh에 안 들어감: sell[55]', s.sellEvent[55], false);
  check('ATR 워밍업 고가는 runningHigh에 안 들어감: active[55]', s.active[55], true);
  check('ATR 워밍업 고가는 runningHigh에 안 들어감: active[56]', s.active[56], true);
}

// ── 5. forward-fill(fresh=false) 행은 새 봉이 아니다 ───────────────────
// 원 경로의 지정 위치 뒤에 직전 값 이월 행(fresh=false)을 끼워 넣고, 신선한 행의 결과가 원 경로와 같은지 본다.
function withStale(rows: Row[], afterIdx: number[]): { bars: AssetBars; map: number[]; staleIdx: number[] } {
  const out: Row[] = [];
  const fresh: boolean[] = [];
  const map: number[] = [];
  const staleIdx: number[] = [];
  rows.forEach((r, i) => {
    map.push(out.length);
    out.push(r); fresh.push(true);
    if (afterIdx.includes(i)) {
      staleIdx.push(out.length);
      out.push({ ...r }); fresh.push(false);
      staleIdx.push(out.length);
      out.push({ ...r }); fresh.push(false);
    }
  });
  return { bars: mkBars(out, { fresh }), map, staleIdx };
}
const STALE_AFTER = [5, 30, 54, 55, 56, 57, 58];
for (const [rule, rows] of [
  ['D10/55', donchianPath()], ['D20/55', donchianPath()], ['D55/55', donchianPath()],
  ['ATR3/55', atrPath()],
] as [SignalRuleId, Row[]][]) {
  const base = computeSignals(mkBars(rows), rule);
  const w = withStale(rows, STALE_AFTER);
  const s = computeSignals(w.bars, rule);
  let same = true;
  base.sellEvent.forEach((v, i) => {
    const j = w.map[i];
    if (s.sellEvent[j] !== v || s.reentryEvent[j] !== base.reentryEvent[i] || s.valid[j] !== base.valid[i] || s.active[j] !== base.active[i]) same = false;
    if (base.atr20[i] !== s.atr20[j]) same = false;
  });
  check(`${rule} stale 삽입 후에도 신선한 행 결과 동일(워밍업·이벤트·ATR)`, same, true);
  // 이월 행: 이벤트 없음, 직전 신선 행의 active/valid/atr 이월
  let carry = true;
  w.staleIdx.forEach(j => {
    if (s.sellEvent[j] || s.reentryEvent[j]) carry = false;
    if (s.active[j] !== s.active[j - 1] || s.valid[j] !== s.valid[j - 1] || s.atr20[j] !== s.atr20[j - 1]) carry = false;
  });
  check(`${rule} stale 행은 이벤트 없음·상태 이월`, carry, true);
}

// ── 6. absent / 결측 ───────────────────────────────────────────────────
{
  const rows = donchianPath();
  const lead = 5;
  const absentRows: Row[] = Array.from({ length: lead }, () => ({ o: 0, h: 0, l: 0, c: 0 }));
  const bars = mkBars([...absentRows, ...rows]);
  for (let i = 0; i < lead; i++) {
    bars.open[i] = null; bars.high[i] = null; bars.low[i] = null; bars.close[i] = null;
    bars.fresh[i] = false; bars.source[i] = 'absent';
  }
  const s = computeSignals(bars, 'D10/55');
  const base = computeSignals(mkBars(rows), 'D10/55');
  check('absent 구간 valid=false', s.valid.slice(0, lead).some(Boolean), false);
  check('absent 구간 active=true', s.active.slice(0, lead).every(Boolean), true);
  check('absent 구간 atr20=null', s.atr20.slice(0, lead).every(v => v === null), true);
  checkList('absent 뒤 sell 인덱스 평행이동', trueIdx(s.sellEvent), trueIdx(base.sellEvent).map(i => i + lead));
  checkList('absent 뒤 reentry 인덱스 평행이동', trueIdx(s.reentryEvent), trueIdx(base.reentryEvent).map(i => i + lead));
  check('absent 뒤 valid 시작', s.valid.findIndex(Boolean), 55 + lead);

  // fresh=true 이지만 absent 표시인 행도 완료봉으로 세지 않는다.
  const bars2 = mkBars([...absentRows, ...rows]);
  for (let i = 0; i < lead; i++) bars2.source[i] = 'absent';
  const s2 = computeSignals(bars2, 'D10/55');
  check('absent+fresh=true 도 valid 시작 동일', s2.valid.findIndex(Boolean), 55 + lead);
}

// ── 7. 합성 구간(O=H=L=C)에서도 같은 공식 ───────────────────────────────
// 종가 100+0.5*i (i=0..55, idx55=127.5) 후 idx56=90.
{
  const rows: Row[] = Array.from({ length: 56 }, (_, i) => { const c = 100 + 0.5 * i; return { o: c, h: c, l: c, c }; });
  rows.push({ o: 90, h: 90, l: 90, c: 90 });
  const bars = mkBars(rows, { source: rows.map(() => 'synthetic' as const) });
  const s = computeSignals(bars, 'D10/55');
  checkList('synthetic D10 sell', trueIdx(s.sellEvent), [56]);   // idx55: 127.5 > min(low idx45..54)=122.5 이므로 매도 아님
  const a = computeSignals(bars, 'ATR3/55');
  // TR=0.5 상수 -> ATR20=0.5(idx20..55). idx56 TR=37.5 -> ATR=(19*0.5+37.5)/20=2.35.
  checkClose('synthetic ATR20 idx55', a.atr20[55], 0.5);
  checkClose('synthetic ATR20 idx56', a.atr20[56], 2.35);
  // idx55: runningHigh=127.5, trail=126, close 127.5 > 126. idx56: trail=max(126, 127.5-7.05)=126, close 90 <= 126 -> 매도
  checkList('synthetic ATR sell', trueIdx(a.sellEvent), [56]);
}

// ── 8. 입력 검증 ───────────────────────────────────────────────────────
{
  const bars = mkBars(flat(5));
  bars.fresh = bars.fresh.slice(0, 4);
  let threw = false;
  try { computeSignals(bars, 'MA20'); } catch { threw = true; }
  check('배열 길이 불일치는 throw', threw, true);
}

// 모든 규칙이 SignalSeries 계약 필드를 채운다.
{
  const s: SignalSeries = computeSignals(mkBars(flat(80)), 'MA50');
  check('계약: rule', s.rule, 'MA50');
  check('계약: code', s.code, '069500');
  check('계약: 배열 길이 5종', [s.valid, s.active, s.sellEvent, s.reentryEvent, s.atr20].every(a => a.length === 80), true);
}

console.log(`\n통과 ${pass} / 실패 ${fail}`);
if (fail > 0) process.exit(1);
