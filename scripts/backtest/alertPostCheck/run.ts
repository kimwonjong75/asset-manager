// scripts/backtest/alertPostCheck/run.ts
// 실제 카톡 터틀 알림이 시작된 시점(2026-09-27 아침 요약 — 직전 완료봉 기준)부터 "알림대로 했다면"의 전 과정
// (매도 신호 → 다음 거래일 시가 매도 → 현금 대기 → 55일 재진입 신호 → 다음 거래일 시가 재매수 → 다시 청산선 …)을
// 앱과 **같은 순수함수**(utils/turtleHoldings, utils/todayTurtle)로 재현하고, 그대로 보유·실제로 한 일과 비교한다.
//
// 개인정보: 입력(JSON 백업·카톡 내보내기)과 결과는 DB/alertPostCheck/(gitignored)에만 쓴다. 이 파일엔 보유 내역이 없다.
// 성격: **가격 신호 기준 간이 추정** — 실제 카톡 수신 시각이 아니라 과거 가격으로 다시 계산한다(카톡 원문은 대조용).
// 한계(보고서에 명시): 재매수분의 2N 손절·매수금액 제한(종목 한도·유닛 사이징) 생략(재매수=판 돈 전액), 현금 이자 0,
// 수수료·세금·환전 0, 환율은 백업 시점 고정. 비율의 분모는 전체 계좌가 아니라 "신호가 난 종목들의 평가액"이다.
//
// 사용법: npx tsx scripts/backtest/alertPostCheck/run.ts "<portfolio.json>" "<KakaoTalk.txt>" [end=2026-10-23]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CLOUD_RUN_BASE_URL } from '../../../constants/api';
import { computeExitLine, evaluateLegacyHoldingsStatus, isInHoldingsScope } from '../../../utils/turtleHoldings';
import { DEFAULT_TURTLE_HOLDINGS_SETTINGS } from '../../../types/turtleHoldings';
import { isValidBar, type DailyBar } from '../../../utils/todayTurtle';
import { simulateAlertPath } from './simulate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', '..', '..', 'DB', 'alertPostCheck');
const CACHE_DIR = path.join(OUT_DIR, 'cache');
const SETTINGS = DEFAULT_TURTLE_HOLDINGS_SETTINGS;
/** 알림 시작 = 2026-09-27(일) 08:00 아침 요약. 그 시점에 확정된 마지막 봉 = 2026-09-26 이하의 마지막 봉. */
const GO_LIVE_LAST_BAR = '2026-09-26';
const FETCH_START = '2026-03-01';

type Market = 'KR' | 'US' | 'JP' | 'CRYPTO';

interface JsonAsset {
  id: string; ticker: string; exchange: string; name: string; customName?: string; quantity: number;
  currency: string; owner?: 'WONJONG' | 'YUSEON'; categoryId: number; bucket?: string; priceOriginal: number;
}
interface JsonSell {
  sellDate: string; ticker: string; name: string; sellQuantity: number; sellPriceOriginal?: number; sellPrice: number;
  originalCurrency?: string; categoryId: number; assetId: string;
}
interface JsonWatch { ticker: string; exchange?: string; name: string; currency?: string }
interface Backup {
  assets: JsonAsset[]; sellHistory: JsonSell[]; watchlist: JsonWatch[];
  exchangeRates: { USD: number; JPY: number };
}

interface Subject {
  /** name = 카톡 매니페스트가 보낸 이름(대조용, 빈 별칭이면 ""), label = 사람이 읽는 이름. */
  ticker: string; name: string; label: string; market: Market; currency: string; qty: number; inScope: boolean;
  bucket: string; actualSells: { date: string; qty: number; price: number }[];
}

function marketOf(ticker: string, exchange: string): Market {
  const e = (exchange || '').toUpperCase();
  if (e.includes('종합')) return 'CRYPTO';
  if (ticker.endsWith('.T') || e.includes('도쿄') || e.includes('TYO')) return 'JP';
  if (/^[0-9][0-9A-Z]{5}$/.test(ticker) || ticker === 'KRX-GOLD' || e.includes('KRX')) return 'KR';
  return 'US';
}

function displayName(a: { name: string; customName?: string }): string {
  return a.customName?.trim() || a.name;
}

// ── 시세 조회(전용 캐시 — 공용 backtest 캐시는 건드리지 않는다) ─────────────────────
interface RawEntry { data?: Record<string, number>; open?: Record<string, number>; high?: Record<string, number>; low?: Record<string, number>; error?: string }

async function postJson(url: string, body: unknown): Promise<Record<string, RawEntry>> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return JSON.parse(text.replace(/\bNaN\b/g, 'null')) as Record<string, RawEntry>;
}

async function loadSeries(subjects: Subject[], end: string): Promise<Map<string, RawEntry>> {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const out = new Map<string, RawEntry>();
  const need: Subject[] = [];
  for (const s of subjects) {
    const f = path.join(CACHE_DIR, `${s.ticker.replace(/[^A-Za-z0-9_.-]/g, '_')}_${end}.json`);
    if (existsSync(f)) out.set(s.ticker, JSON.parse(readFileSync(f, 'utf-8')) as RawEntry);
    else need.push(s);
  }
  const save = (ticker: string, entry: RawEntry) => {
    out.set(ticker, entry);
    writeFileSync(path.join(CACHE_DIR, `${ticker.replace(/[^A-Za-z0-9_.-]/g, '_')}_${end}.json`), JSON.stringify(entry));
  };
  const crypto = need.filter(s => s.market === 'CRYPTO');
  if (crypto.length) {
    const data = await postJson(`${CLOUD_RUN_BASE_URL}/upbit/history`, { symbols: crypto.map(s => s.ticker), start_date: FETCH_START, end_date: end });
    for (const s of crypto) {
      const entry = data[`KRW-${s.ticker}`] ?? data[s.ticker];
      if (entry) save(s.ticker, entry);
    }
  }
  const rest = need.filter(s => s.market !== 'CRYPTO');
  for (let i = 0; i < rest.length; i += 8) {
    const chunk = rest.slice(i, i + 8);
    const data = await postJson(`${CLOUD_RUN_BASE_URL}/history`, { tickers: chunk.map(s => s.ticker), start_date: FETCH_START, end_date: end });
    for (const s of chunk) {
      const entry = data[s.ticker] ?? data[s.ticker.toUpperCase()];
      if (entry) save(s.ticker, entry);
    }
  }
  return out;
}

function toBars(raw: RawEntry | undefined, end: string): DailyBar[] {
  if (!raw?.data || !raw.open || !raw.high || !raw.low) return [];
  const bars: DailyBar[] = [];
  for (const d of Object.keys(raw.data).sort()) {
    if (d > end) continue;
    const o = raw.open[d], h = raw.high[d], l = raw.low[d], c = raw.data[d];
    if (!isValidBar(o, h, l, c)) continue;
    bars.push({ date: d, open: o, high: h, low: l, close: c });
  }
  return bars;
}

// ── "알림대로 했다면" 전 과정 시뮬레이션 — simulate.ts(순수, 테스트 공유)로 분리 ─────────────────
const simulate = (bars: DailyBar[], qty: number, execDelay = 1) =>
  simulateAlertPath(bars, qty, { settings: SETTINGS, startOnOrBefore: GO_LIVE_LAST_BAR, execDelay });

// ── 카톡 알림 파싱(검증용: 재현 신호가 실제 발송과 같은지) ─────────────────────────
interface KakaoSell { date: string; name: string; line: number; close: number; qty: number }

function parseKakao(file: string, since: string): { immediate: KakaoSell[]; mentioned: { date: string; names: string[] }[] } {
  const lines = readFileSync(file, 'utf-8').split(/\r?\n/);
  const dateRe = /^-+ (\d{4})년 (\d{1,2})월 (\d{1,2})일 .+ -+$/;
  const sellRe = /^\[[^\]]+\] \[(?:오전|오후) \d{1,2}:\d{2}\] 🔵 \[팔 때\] (.*?) — 20일 최저가 ([\d,.$]+)원? 이하로 마감 \(종가 ([\d,.$]+)원?\)/;
  const qtyRe = /^보유 ([\d.]+)주/;
  const listRe = /^\[[^\]]+\] \[(?:오전|오후) \d{1,2}:\d{2}\] 📋 \[(밤사이 보류분 \d+건|일 발송 상한 초과)\] (.*)$/;
  const num = (s: string) => Number(s.replace(/[,$]/g, ''));
  let cur: string | null = null;
  const immediate: KakaoSell[] = [];
  const mentioned: { date: string; names: string[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const d = lines[i].match(dateRe);
    if (d) { cur = `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}`; continue; }
    if (!cur || cur < since) continue;
    const m = lines[i].match(sellRe);
    if (m) {
      const q = (lines[i + 1] ?? '').match(qtyRe);
      immediate.push({ date: cur, name: m[1].trim(), line: num(m[2]), close: num(m[3]), qty: q ? Number(q[1]) : NaN });
      continue;
    }
    const l = lines[i].match(listRe);
    if (l) {
      const names = l[2].replace(/ 외 \d+건$/, '').split(', ').map(s => s.replace(/ 팔 때$/, '').trim());
      mentioned.push({ date: cur, names });
    }
  }
  return { immediate, mentioned };
}

function matchByName(alertName: string, qty: number, subjects: Subject[]): Subject | null {
  const prefix = alertName.replace(/…$/, '').trim();
  if (prefix === '') return subjects.find(s => s.qty === qty) ?? null; // 이름 빈칸 알림 — 수량으로만 식별
  const cands = subjects.filter(s => s.name.startsWith(prefix) || s.name.replace(/^(유선&원종_|유선&원종 |원종_유선_|유선_)/, '').startsWith(prefix));
  if (cands.length === 1) return cands[0];
  return cands.find(s => s.qty === qty) ?? cands[0] ?? null;
}

// ── 메인 ───────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const [jsonPath, kakaoPath, endArg] = process.argv.slice(2);
  if (!jsonPath || !kakaoPath) {
    console.error('사용법: npx tsx scripts/backtest/alertPostCheck/run.ts "<portfolio.json>" "<KakaoTalk.txt>" [end]');
    process.exit(1);
  }
  const end = endArg ?? '2026-10-23';
  const backup = JSON.parse(readFileSync(jsonPath, 'utf-8')) as Backup;
  const fx = (cur: string) => (cur === 'USD' ? backup.exchangeRates.USD : cur === 'JPY' ? backup.exchangeRates.JPY : 1);

  // 1) 알림 시작 시점 보유 = 현재 보유 + 그 뒤 판 수량(매도기록, 앱 DB)
  const soldSince = backup.sellHistory.filter(r => r.sellDate > GO_LIVE_LAST_BAR);
  const subjects: Subject[] = backup.assets.map(a => ({
    ticker: a.ticker, name: a.customName ?? a.name, label: displayName(a), market: marketOf(a.ticker, a.exchange), currency: a.currency,
    qty: a.quantity, inScope: isInHoldingsScope({ id: a.id, categoryId: a.categoryId, owner: a.owner }, SETTINGS),
    bucket: a.bucket ?? '-', actualSells: [],
  }));
  for (const r of soldSince) {
    let s = subjects.find(x => x.ticker === r.ticker);
    if (!s) {
      const w = backup.watchlist.find(x => x.ticker === r.ticker);
      s = {
        ticker: r.ticker, name: r.name, label: r.name, market: marketOf(r.ticker, w?.exchange ?? ''),
        currency: r.originalCurrency ?? w?.currency ?? 'KRW', qty: 0, inScope: true, bucket: '(매도함)', actualSells: [],
      };
      subjects.push(s);
    }
    s.qty += r.sellQuantity;
    s.actualSells.push({ date: r.sellDate, qty: r.sellQuantity, price: r.sellPriceOriginal ?? r.sellPrice });
  }
  const inScope = subjects.filter(s => s.inScope);

  // 2) 시세
  const raw = await loadSeries(inScope, end);

  // 3) 시뮬레이션
  const rows = inScope.map(s => {
    const bars = toBars(raw.get(s.ticker), end);
    const r = simulate(bars, s.qty, 1);
    const late = simulate(bars, s.qty, 2);
    const k = fx(s.currency === 'KRW' ? 'KRW' : s.currency);
    const actualProceeds = s.actualSells.reduce((acc, x) => acc + x.qty * x.price, 0);
    const actualUnitsLeft = s.qty - s.actualSells.reduce((acc, x) => acc + x.qty, 0);
    const actualValueOrig = r.lastClose === null ? null : actualProceeds + actualUnitsLeft * r.lastClose;
    return {
      ticker: s.ticker, name: s.label, market: s.market, currency: s.currency, bucket: s.bucket, qty: s.qty, bars: bars.length,
      ...r,
      fx: k,
      holdKRW: r.holdValueOrig * k, turtleKRW: r.turtleValueOrig * k,
      diffKRW: (r.turtleValueOrig - r.holdValueOrig) * k,
      lateDiffKRW: (late.turtleValueOrig - late.holdValueOrig) * k,
      lateFirstSellPrice: late.firstSellPrice,
      actualSells: s.actualSells,
      actualKRW: actualValueOrig === null ? null : actualValueOrig * k,
      actualDiffKRW: actualValueOrig === null ? null : (actualValueOrig - r.holdValueOrig) * k,
      moveSinceFirstSellPct: r.firstSellPrice && r.lastClose ? (r.lastClose / r.firstSellPrice - 1) * 100 : null,
    };
  });

  // 4) 카톡 대조
  const kakao = parseKakao(kakaoPath, '2026-09-27');
  const check = kakao.immediate.map(k => {
    const s = matchByName(k.name, k.qty, inScope);
    if (!s) return { ...k, matched: null, ok: false, note: '종목 식별 실패' };
    const bars = toBars(raw.get(s.ticker), end);
    const idx = bars.findIndex(b => b.date === k.date);
    if (idx < 0) return { ...k, matched: s.ticker, ok: false, note: '그날 봉 없음' };
    // 카톡 날짜 D에 대해 '같은 날 봉'과 'D 이전 마지막 봉' 중 어느 쪽 값과 같은지 본다.
    const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) <= Math.max(1, b * 0.002);
    const sameIdx = bars.findIndex(b => b.date === k.date);
    let prevIdx = -1;
    for (let j = 0; j < bars.length; j++) if (bars[j].date < k.date) prevIdx = j;
    const lineAt = (j: number) => (j < 0 ? null : computeExitLine({ bars: bars.slice(0, j + 1), settings: SETTINGS }));
    const sameOk = sameIdx >= 0 && near(lineAt(sameIdx), k.line) && near(bars[sameIdx].close, k.close);
    const prevOk = prevIdx >= 0 && near(lineAt(prevIdx), k.line) && near(bars[prevIdx].close, k.close);
    const sameDaySell = sameIdx >= 0 ? evaluateLegacyHoldingsStatus(bars[sameIdx].close, lineAt(sameIdx)) === 'sell-check' : null;
    return {
      ...k, matched: s.ticker, ok: sameOk || prevOk,
      basis: sameOk ? 'same-day' : prevOk ? `prev-bar ${bars[prevIdx].date}` : 'unmatched',
      sessionOnAlertDay: sameIdx >= 0,
      stillSellOnAlertDayClose: sameDaySell,
      note: sameOk || prevOk ? '' : '값 불일치',
    };
  });

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const out = { generatedAt: new Date().toISOString(), end, goLiveLastBar: GO_LIVE_LAST_BAR, settings: { exit: SETTINGS.exitLookback, entry: SETTINGS.entryLookback }, fx: backup.exchangeRates, rows, kakaoCheck: check, kakaoMentioned: kakao.mentioned };
  writeFileSync(path.join(OUT_DIR, `result_${end}.json`), JSON.stringify(out, null, 2));

  // 콘솔 요약
  const sig = rows.filter(r => r.firstSignalDate);
  const fmt = (v: number) => `${Math.round(v / 10000).toLocaleString()}만`;
  console.log(`대상(가족 제외) ${rows.length}종 · 데이터부족 ${rows.filter(r => r.status !== 'ok').length} · 알림 시작 후 매도신호 ${sig.length}종`);
  const basisCount = check.reduce<Record<string, number>>((acc, c) => {
    const key = 'basis' in c ? (c.basis.startsWith('prev-bar') ? 'prev-bar' : c.basis) : 'unmatched';
    acc[key] = (acc[key] ?? 0) + 1; return acc;
  }, {});
  console.log(`카톡 즉시알림 ${check.length}건 — 값 기준: ${JSON.stringify(basisCount)}`);
  const holidayAlerts = check.filter(c => 'sessionOnAlertDay' in c && c.sessionOnAlertDay === false);
  console.log(`  그날 장이 없었는데 온 알림(휴장일): ${holidayAlerts.length}건 (${[...new Set(holidayAlerts.map(c => c.date))].join(', ')})`);
  const staleWrong = check.filter(c => 'stillSellOnAlertDayClose' in c && c.stillSellOnAlertDayClose === false);
  console.log(`  알림 당일 종가로는 이미 매도 신호가 아니었던 알림: ${staleWrong.length}건`);
  for (const c of staleWrong) console.log(`    · ${c.date} ${c.name || '(이름없음 KRX 금현물)'}`);
  for (const c of check.filter(x => !x.ok)) console.log(`  ✗ ${c.date} ${c.name || '(이름없음)'} → ${c.matched ?? '-'} ${c.note} kakao(line ${c.line}, close ${c.close})`);
  console.log('\n종목 | 첫신호 | 매도가(다음날 시가) | 이후 최저종가 | 재매수 | 최근종가 | 매도가 대비 | 터틀−보유(원)');
  for (const r of sig.sort((a, b) => a.diffKRW - b.diffKRW)) {
    const buy = r.events.filter(e => e.kind === 'buy').map(e => `${e.date}@${e.price}`).join(',') || '-';
    console.log(`${r.name.slice(0, 18)} (${r.ticker}) | ${r.firstSignalDate} | ${r.firstSellPrice} | ${r.minCloseAfterSell} | ${buy} | ${r.lastClose} | ${r.moveSinceFirstSellPct?.toFixed(1)}% | ${fmt(r.diffKRW)} [${r.endState}]`);
  }
  const total = sig.reduce((a, r) => a + r.diffKRW, 0);
  const lateTotal = sig.reduce((a, r) => a + r.lateDiffKRW, 0);
  const holdTotal = sig.reduce((a, r) => a + r.holdKRW, 0);
  const avoided = sig.filter(r => r.diffKRW > 0), missed = sig.filter(r => r.diffKRW < 0);
  console.log('\n[가격 신호 기준 간이 추정 — 실제 카톡 수신 시각이 아닌 과거 가격 재계산, 재매수분 2N 손절·매수금액 제한 생략]');
  console.log(`신호 종목 합계(분모 = 신호 난 종목 평가액 ${fmt(holdTotal)}, 전체 계좌 아님): 알림대로(신호 다음 거래일 시가) ${fmt(holdTotal + total)} · 차이 ${fmt(total)} (${(total / holdTotal * 100).toFixed(2)}%)`);
  console.log(`  실제 카톡처럼 하루 늦게 받은 뒤 다음 거래일 시가에 판 경우(신호 2거래일 뒤) 차이 ${fmt(lateTotal)}`);
  console.log(`  피한 하락 ${avoided.length}종 +${fmt(avoided.reduce((a, r) => a + r.diffKRW, 0))} · 놓친 상승 ${missed.length}종 ${fmt(missed.reduce((a, r) => a + r.diffKRW, 0))} · 재매수 신호 ${sig.filter(r => r.events.some(e => e.kind === 'signal-buy')).length}종`);
  const byBucket = (b: string) => sig.filter(r => r.bucket === b).reduce((a, r) => a + r.diffKRW, 0);
  console.log(`  버킷별 차이: CORE ${fmt(byBucket('CORE'))} · SATELLITE ${fmt(byBucket('SATELLITE'))} · (매도함) ${fmt(byBucket('(매도함)'))}`);
  const top3 = [...sig].sort((a, b) => Math.abs(b.diffKRW) - Math.abs(a.diffKRW)).slice(0, 3);
  console.log(`  영향 큰 3종: ${top3.map(r => `${r.name || r.ticker} ${fmt(r.diffKRW)}`).join(', ')}`);
  const acted = rows.filter(r => r.actualSells.length);
  console.log('\n실제로 판 종목:');
  for (const r of acted) console.log(`  ${r.name} (${r.ticker}) 판 날 ${r.actualSells.map(x => `${x.date}@${x.price}×${x.qty}`).join(',')} · 최근종가 ${r.lastClose} · 보유 대비 ${r.actualDiffKRW === null ? '-' : fmt(r.actualDiffKRW)}`);
  console.log(`\n저장: DB/alertPostCheck/result_${end}.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
