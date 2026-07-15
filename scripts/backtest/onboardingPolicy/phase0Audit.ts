// scripts/backtest/onboardingPolicy/phase0Audit.ts
// ---------------------------------------------------------------------------
// 편입정책 검증(onboarding-policy-v1) Phase 0 데이터 게이트 — **읽기 전용 감사**.
//
// 목적: 사전등록·설정동결(Phase C) 이전에 "이 실험을 실제로 돌릴 수 있는가"만 판정한다.
// 성과·수익률은 계산하지 않는다(홀드아웃은 물론 학습구간도 여기서 실행하지 않음).
//
// 앱 런타임 코드는 수정하지 않고 순수 함수만 재사용한다(computeN/buildDonchianChannels).
// 네트워크 요청 없음 — scripts/backtest/data/cache 의 기존 캐시만 읽는다.
//
// 척도 무관(scale-free) 설계:
//   위성 예산 = 편입일 전체 포트폴리오 평가액 × 10% (사용자 지시 #3).
//   universe.json 의 weightPct 는 "전체 포트폴리오 대비 %" 이므로, 절대 평가액·수량·환율 없이도
//     · 종목 평가액 / 예산      = weightPct / 10
//     · 종목 손절위험 / 예산    = weightPct × (2N/price) / 10        ← 2N/price 는 무차원(통화 무관)
//   이 성립한다. 따라서 **수량·총자산·환율 없이 편입 가능성 판정이 가능**하다.
//   (2N/price 가 무차원이므로 프록시 통화가 달라도 비율 자체는 계산되지만, 프록시 종목은 별도 플래그.)
//
// 리스크 정의(사용자 지시 #1 — 엔진 positionRiskAtStop 과 동일):
//   riskPerUnitPct(0.5)는 **사이징** 값이다: 수량 = 예산×0.5% ÷ N.
//   2N 손절 시 실손실 = 수량×2N = 예산 × (0.5% × 2) = **예산의 1%**.
//   따라서 1유닛 상당 실손절위험 상한 = riskPerUnitPct × stopMultipleN = 1%. 0.5% 아님.

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeN } from '../../../utils/turtleEngine';
import { buildDonchianChannels } from '../../../utils/donchianChannel';
import { loadUniverse, fetchSymbolOf, isProxyBased, UniverseAsset } from '../lib/universe';
import type { SymbolSeries } from '../lib/fetchHistory';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');

// ── 동결 후보 파라미터 (Phase C 에서 config JSON 으로 확정 — 여기서는 판정 기준으로만 사용) ──
const ENTRY_LOOKBACK = 55;
const EXIT_LOOKBACK = 20;
const STOP_MULTIPLE_N = 2;
const RISK_PER_UNIT_PCT = 0.5;                                    // 사이징 값
const UNIT_STOP_RISK_LIMIT_PCT = RISK_PER_UNIT_PCT * STOP_MULTIPLE_N; // = 1.0% (실손절위험 상한)
const POSITION_VALUE_CAP_PCT = 25;
const BUDGET_SHARE_OF_TOTAL_PCT = 10;                             // 위성 예산 = 총자산의 10%
const ATR_PERIOD = 20;

/** 채널 보고서(REPORT_종목별채널.md §유니버스 repr)에 기록된 대표군 19종 — 생성 스크립트는 리포지토리에 없음. */
const REPR_UNIVERSE_19 = [
  'BTC-USD', 'XLK', 'DBC', 'IWM', '069500', 'XLE', 'QQQ', 'SPY', 'TLT',
  'FXI', 'EFA', 'EEM', 'EWJ', 'VNQ', 'IEF', 'GLD', 'LQD', 'ETH-USD', 'SLV',
];

function cacheFileOf(symbol: string): string {
  const safe = symbol.replace(/[^A-Za-z0-9_.=^-]/g, '_');
  return path.join(CACHE_DIR, `${safe}.json`);
}

function readCached(symbol: string): SymbolSeries | null {
  const f = cacheFileOf(symbol);
  if (!existsSync(f)) return null;
  try {
    const s = JSON.parse(readFileSync(f, 'utf-8')) as SymbolSeries;
    return s.ok ? s : null;
  } catch {
    return null;
  }
}

interface AdmissionProbe {
  ticker: string;
  name: string;
  owner: string;
  symbol: string;
  proxy: boolean;
  weightPct: number;
  bars: number;
  lastDate: string;
  price: number | null;
  n: number | null;
  low20: number | null;
  high55: number | null;
  validClose: number;
  // scale-free 판정
  valuePctOfBudget: number | null;      // weightPct / 10
  stopRiskPctOfBudget: number | null;   // weightPct × (2N/price) / 10
  capViolation: boolean;                // > 25%
  unitRiskViolation: boolean;           // > 1%
  belowLow20: boolean;                  // 편입 즉시 청산 대상
  dataInsufficient: boolean;            // 유효봉 < 55(진입채널) 또는 < 20(청산채널)
}

function countValid(arr: (number | null)[]): number {
  let c = 0;
  for (const v of arr) if (typeof v === 'number' && Number.isFinite(v)) c++;
  return c;
}

function probe(asset: UniverseAsset): AdmissionProbe | null {
  const symbol = fetchSymbolOf(asset);
  const s = readCached(symbol);
  if (!s) return null;

  const validClose = countValid(s.close);
  const n = computeN(s.high, s.low, s.close, ATR_PERIOD);
  const ch = buildDonchianChannels(s.high, s.low, s.close, ENTRY_LOOKBACK, EXIT_LOOKBACK);
  // 현재가 = 마지막 유효 종가
  let price: number | null = null;
  for (let i = s.close.length - 1; i >= 0; i--) {
    const v = s.close[i];
    if (typeof v === 'number' && Number.isFinite(v)) { price = v; break; }
  }

  const valuePctOfBudget = (asset.weightPct / BUDGET_SHARE_OF_TOTAL_PCT) * 100;
  const stopRiskPctOfBudget =
    n != null && price != null && price > 0
      ? (asset.weightPct * ((STOP_MULTIPLE_N * n) / price) / BUDGET_SHARE_OF_TOTAL_PCT) * 100
      : null;

  return {
    ticker: asset.rawTicker,
    name: asset.name,
    owner: asset.owner,
    symbol,
    proxy: isProxyBased(asset),
    weightPct: asset.weightPct,
    bars: s.dates.length,
    lastDate: s.dates[s.dates.length - 1] ?? '—',
    price,
    n,
    low20: ch.exitLow,
    high55: ch.entryHigh,
    validClose,
    valuePctOfBudget,
    stopRiskPctOfBudget,
    capViolation: valuePctOfBudget > POSITION_VALUE_CAP_PCT,
    unitRiskViolation: stopRiskPctOfBudget != null && stopRiskPctOfBudget > UNIT_STOP_RISK_LIMIT_PCT,
    belowLow20: price != null && ch.exitLow != null && price <= ch.exitLow,
    dataInsufficient: validClose < ENTRY_LOOKBACK + 1 || n == null,
  };
}

function fmt(v: number | null, d = 2): string {
  return v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: d });
}

// ════════════════════════════════════════════════════════════════════════════
console.log('='.repeat(78));
console.log('Phase 0 데이터 게이트 — onboarding-policy-v1 (읽기 전용 감사)');
console.log('='.repeat(78));

const u = loadUniverse();
console.log(`\nuniverse.json generatedAt: ${u.generatedAt}`);

// ── G1. 거래내역 완결성 ──────────────────────────────────────────────────
console.log('\n[G1] 거래내역 완결성 (P3 복원 · Track A 과거성과의 전제)');
const rawJson = JSON.stringify(u);
const HISTORY_FIELDS = ['purchasePrice', 'purchaseDate', 'quantity', 'sellTransactions', 'units', 'fillPrice', 'fillDate'];
const present = HISTORY_FIELDS.filter(f => rawJson.includes(f));
for (const f of HISTORY_FIELDS) console.log(`   ${rawJson.includes(f) ? '있음' : '없음'}  ${f}`);
const g1Pass = present.length === HISTORY_FIELDS.length;
console.log(`   → G1 ${g1Pass ? 'PASS' : 'FAIL'} — universe.json 은 weightPct 만 보유. 체결일·체결가·수량 전무.`);

// ── G2. 종목군 ──────────────────────────────────────────────────────────
console.log('\n[G2] 종목군');
const sat = u.assets.filter(a => a.class === 'SATELLITE_TURTLE');
const satWeight = sat.reduce((s, a) => s + a.weightPct, 0);
console.log(`   현재 SATELLITE_TURTLE: ${sat.length}종 · 합계 비중 ${satWeight.toFixed(2)}% (전체 포트폴리오 대비)`);
const byOwner: Record<string, number> = {};
for (const a of sat) byOwner[a.owner] = (byOwner[a.owner] ?? 0) + a.weightPct;
for (const [o, w] of Object.entries(byOwner)) console.log(`      owner=${o}: ${w.toFixed(2)}%`);
const reprCached = REPR_UNIVERSE_19.filter(t => readCached(t) != null);
console.log(`   대표군 19종 (채널 보고서 기록): 캐시 보유 ${reprCached.length}/19`);
console.log(`      미보유: ${REPR_UNIVERSE_19.filter(t => !readCached(t)).join(', ') || '(없음)'}`);
console.log(`   과거 매도 투더문 종목: universe.json 에 매도이력 필드 자체가 없음 → 목록 확보 불가`);
console.log(`   상장폐지·합병 종목: universe.json 은 현재 보유만 수록 → 생존편향 회피 불가`);

// ── G3. 예산·리스크 구조 (scale-free) ────────────────────────────────────
console.log('\n[G3] 예산·리스크 구조 — 수정된 정의 (예산 = 총자산의 10%)');
const deployedPctOfBudget = (satWeight / BUDGET_SHARE_OF_TOTAL_PCT) * 100;
console.log(`   위성 예산       = 총자산 × ${BUDGET_SHARE_OF_TOTAL_PCT}%`);
console.log(`   기존 투더문 deployed = 총자산 × ${satWeight.toFixed(2)}%  →  예산 대비 ${deployedPctOfBudget.toFixed(1)}%`);
const remainingPct = Math.max(0, BUDGET_SHARE_OF_TOTAL_PCT - satWeight);
console.log(`   잔여예산        = max(0, ${BUDGET_SHARE_OF_TOTAL_PCT} − ${satWeight.toFixed(2)}) = ${remainingPct.toFixed(2)}% of 총자산`);
console.log(`   → 위성 비중이 이미 10%를 ${satWeight > BUDGET_SHARE_OF_TOTAL_PCT ? '초과' : '미달'} → 신규진입·불타기 ${remainingPct === 0 ? '금지 (지시 #3)' : '가능'}`);
console.log(`   1유닛 실손절위험 상한 = riskPerUnitPct(${RISK_PER_UNIT_PCT}%) × stopMultipleN(${STOP_MULTIPLE_N}) = ${UNIT_STOP_RISK_LIMIT_PCT}% of 예산`);

// ── G4. 종목별 편입 가능성 probe ─────────────────────────────────────────
console.log('\n[G4] 종목별 편입 가능성 probe (P2 · 캐시 데이터 기준, 성과계산 아님)');
const probes: AdmissionProbe[] = [];
for (const a of sat) {
  const p = probe(a);
  if (!p) { console.log(`   ✗ ${a.rawTicker} (${a.name}) — 캐시 없음: ${fetchSymbolOf(a)}`); continue; }
  probes.push(p);
}
console.log('');
console.log('   종목      | 심볼    | prx | w%    | 예산대비가치% | 손절위험%예산 | 25%상한 | 1%위험 | ≤20일저 | 데이터');
console.log('   ' + '-'.repeat(105));
for (const p of probes) {
  console.log(
    `   ${p.ticker.padEnd(9)} | ${p.symbol.padEnd(7)} | ${(p.proxy ? 'Y' : ' ').padEnd(3)} | ` +
    `${p.weightPct.toFixed(2).padStart(5)} | ${fmt(p.valuePctOfBudget, 1).padStart(13)} | ${fmt(p.stopRiskPctOfBudget, 2).padStart(13)} | ` +
    `${(p.capViolation ? '위반' : 'ok').padStart(7)} | ${(p.unitRiskViolation ? '위반' : 'ok').padStart(6)} | ` +
    `${(p.belowLow20 ? '즉시청산' : '—').padStart(7)} | ${p.dataInsufficient ? '부족' : `${p.validClose}봉`}`
  );
}
const capV = probes.filter(p => p.capViolation).length;
const riskV = probes.filter(p => p.unitRiskViolation).length;
const exitNow = probes.filter(p => p.belowLow20).length;
const proxyN = probes.filter(p => p.proxy).length;
console.log('');
console.log(`   25% 종목상한 위반: ${capV}/${probes.length}`);
console.log(`   1% 1유닛 실손절위험 상한 위반: ${riskV}/${probes.length}`);
console.log(`   편입 당일 이미 20일 최저가 이탈: ${exitNow}/${probes.length}`);
console.log(`   프록시 시계열 사용(비율 왜곡 가능): ${proxyN}/${probes.length}`);
const totalStopRisk = probes.reduce((s, p) => s + (p.stopRiskPctOfBudget ?? 0), 0);
console.log(`   전 종목 동시 손절위험 합계: ${totalStopRisk.toFixed(1)}% of 예산 (한도 12%)`);

// ── G5. 비용 파라미터 ────────────────────────────────────────────────────
console.log('\n[G5] 비용 파라미터');
console.log('   수수료(KR/US 편도)     : 미확보 — 사용자 실요율 필요');
console.log('   KR 매도 거래세(시행일표): 미확보 — 출처·시행일 포함 필요');
console.log('   슬리피지               : 미확보');
console.log('   환전 스프레드          : 미확보');
console.log('   참고: 기존 채널 실험은 편도 0.1% 단일값을 썼으나 이는 그 실험의 가정이며 사용자 실요율이 아님.');

// ── 종합 ────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(78));
console.log('Phase 0 종합');
console.log('='.repeat(78));
const gates: [string, boolean, string][] = [
  ['G1 거래내역 완결성', g1Pass, 'P3 복원 · Track A 과거성과 불가'],
  ['G2-a 위성 OHLC 캐시', probes.length === sat.length, `${probes.length}/${sat.length}종 확보`],
  ['G2-b 대표군 19종 캐시', reprCached.length === 19, `${reprCached.length}/19 확보`],
  ['G2-c 과거매도 투더문 목록', false, '매도이력 부재 → Track B 종목군 동결 불가'],
  ['G2-d 상폐/합병 포함', false, '현재보유만 수록 → 생존편향 1급 한계'],
  ['G3 예산·리스크 정의', true, 'scale-free 계산 성립 (수량·총자산 불필요)'],
  ['G5 비용 파라미터', false, '전 항목 미확보'],
];
for (const [name, ok, note] of gates) console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(26)} — ${note}`);
const allPass = gates.every(g => g[1]);
console.log(`\n   → Phase 0 ${allPass ? 'PASS — 사전등록 진행 가능' : 'FAIL — 사전등록·설정동결·학습구간 실행 보류'}`);
console.log('   홀드아웃: 미실행 (Phase 0 미통과)');
