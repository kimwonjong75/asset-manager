// tests/priceBatchParity.ts
// services/priceService.fetchBatchAssetPrices — 전역 중복제거 / 청크 20 / 동시성 2 / 청크 단위 1회 재시도 / 필드 매핑.
// fetch 를 스텁으로 대체 (네트워크 없음). 재시도 지연은 opts.retryDelayMs 로 0 주입.
import { Currency } from '../types';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

// ── fetch 스텁 ──────────────────────────────────────────────────────────────
interface Call { tickers: string[] }
let calls: Call[] = [];
let inFlightNow = 0;
let maxInFlight = 0;
/** 첫 티커 → 남은 실패 횟수 */
let failPlan = new Map<string, number>();
/** 티커 → 응답 항목 오버라이드 */
let itemFor: (ticker: string) => Record<string, unknown> = t => ({ ticker: t, price: 100, prev_close: 100, currency: 'USD' });

(globalThis as unknown as { fetch: unknown }).fetch = async (_url: string, init: { body: string }) => {
  const tickers: string[] = (JSON.parse(init.body).tickers as { ticker: string }[]).map(x => x.ticker);
  calls.push({ tickers });
  inFlightNow++;
  maxInFlight = Math.max(maxInFlight, inFlightNow);
  await new Promise(r => setTimeout(r, 5));
  inFlightNow--;
  const key = tickers[0];
  const remaining = failPlan.get(key) ?? 0;
  if (remaining > 0) {
    failPlan.set(key, remaining - 1);
    return { ok: false, status: 500, text: async () => '' };
  }
  const body = JSON.stringify({ results: tickers.map(t => itemFor(t)) });
  return { ok: true, status: 200, text: async () => body };
};

const { fetchBatchAssetPrices, PRICE_CHUNK_CONCURRENCY } = await import('../services/priceService');

function reset(): void {
  calls = []; inFlightNow = 0; maxInFlight = 0; failPlan = new Map();
  itemFor = t => ({ ticker: t, price: 100, prev_close: 100, currency: 'USD' });
}
const mk = (n: number, prefix = 'T') =>
  Array.from({ length: n }, (_, i) => ({ ticker: `${prefix}${i}`, exchange: 'NASDAQ', id: `${prefix}id${i}` }));

check('동시성 상수 = 2', PRICE_CHUNK_CONCURRENCY, 2);

// (a) 45 고유 티커 → 3 요청 (20/20/5)
{
  reset();
  const map = await fetchBatchAssetPrices(mk(45), { retryDelayMs: 0 });
  check('(a) 요청 수', calls.length, 3);
  check('(a) 청크 크기', calls.map(c => c.tickers.length).sort((x, y) => y - x), [20, 20, 5]);
  check('(a) 결과 45건', map.size, 45);
  check('(a) 모두 정상(비 mock)', [...map.values()].every(v => !v.isMocked), true);
}

// (b) 30 항목 중 10개 중복 티커(다른 id) → 고유 20 → 1 요청
{
  reset();
  const base = mk(20);
  const dup = Array.from({ length: 10 }, (_, i) => ({ ticker: `t${i}`, exchange: 'NASDAQ', id: `dup${i}` })); // 소문자 → 대문자 동일
  itemFor = t => ({ ticker: t, price: 1000 + Number(t.slice(1)), prev_close: 1000, currency: 'USD' });
  const map = await fetchBatchAssetPrices([...base, ...dup], { retryDelayMs: 0 });
  check('(b) 요청 1건', calls.length, 1);
  check('(b) 요청 티커 20개(대문자)', calls[0].tickers.length, 20);
  check('(b) 대문자 정규화', calls[0].tickers[3], 'T3');
  check('(b) 결과 30건', map.size, 30);
  check('(b) 원본 id 가격', map.get('Tid3')?.priceOriginal, 1003);
  check('(b) 중복 id 도 같은 가격', map.get('dup3')?.priceOriginal, 1003);
  check('(b) 모두 정상', [...map.values()].every(v => !v.isMocked), true);
}

// (c) 최대 동시 요청 ≤ 2
{
  reset();
  await fetchBatchAssetPrices(mk(100), { retryDelayMs: 0 });
  check('(c) 요청 수 5', calls.length, 5);
  check('(c) 최대 동시 요청 = 2', maxInFlight, 2);
}

// (d) 한 청크가 1회 실패 후 성공 → 그 청크만 2회 요청, 전부 정상
{
  reset();
  failPlan.set('T20', 1); // 두 번째 청크의 첫 티커
  const map = await fetchBatchAssetPrices(mk(45), { retryDelayMs: 0 });
  check('(d) 총 요청 4', calls.length, 4);
  check('(d) 실패 청크 2회', calls.filter(c => c.tickers[0] === 'T20').length, 2);
  check('(d) 다른 청크 1회', calls.filter(c => c.tickers[0] === 'T0').length, 1);
  check('(d) 다른 청크 1회(3번째)', calls.filter(c => c.tickers[0] === 'T40').length, 1);
  check('(d) 전부 정상', [...map.values()].every(v => !v.isMocked), true);
}

// (e) 두 번 실패 → 해당 청크 id 만 mock, 나머지 정상
{
  reset();
  failPlan.set('T20', 2);
  const map = await fetchBatchAssetPrices(mk(45), { retryDelayMs: 0 });
  check('(e) 총 요청 4(재시도 1회까지만)', calls.length, 4);
  const mocked = [...map.entries()].filter(([, v]) => v.isMocked).map(([k]) => k).sort();
  const expected = Array.from({ length: 20 }, (_, i) => `Tid${20 + i}`).sort();
  check('(e) mock 은 실패 청크 20건', mocked, expected);
  check('(e) mock 가격 0', map.get('Tid25')?.priceOriginal, 0);
  check('(e) 정상 청크 가격 유지', map.get('Tid5')?.priceOriginal, 100);
  check('(e) 정상 청크 비 mock', map.get('Tid44')?.isMocked, false);
}

// (f) 필드 매핑 골든 (KRX 종목)
{
  reset();
  itemFor = t => ({ ticker: t, name: '삼성전자', price: 198700, prev_close: 187000, change_rate: 0.06256684491978609, currency: 'KRW', high52w: 210000 });
  const map = await fetchBatchAssetPrices([{ ticker: '005930', exchange: 'KRX', id: 'a1' }], { retryDelayMs: 0 });
  const r = map.get('a1');
  check('(f) name', r?.name, '삼성전자');
  check('(f) priceOriginal', r?.priceOriginal, 198700);
  check('(f) priceKRW(서버 미제공 → 원가)', r?.priceKRW, 198700);
  check('(f) previousClosePrice', r?.previousClosePrice, 187000);
  check('(f) changeRate(서버값)', r?.changeRate, 0.06256684491978609);
  check('(f) highestPrice', r?.highestPrice, 210000);
  check('(f) currency', r?.currency, Currency.KRW);
  check('(f) isMocked', r?.isMocked, false);
  // change_rate 미제공 → (198700-187000)/187000 계산
  itemFor = t => ({ ticker: t, price: 198700, prev_close: 187000, currency: 'KRW' });
  const map2 = await fetchBatchAssetPrices([{ ticker: '005930', exchange: 'KRX', id: 'a1' }], { retryDelayMs: 0 });
  check('(f) changeRate 계산값', map2.get('a1')?.changeRate, (198700 - 187000) / 187000);
}

if (fails.length > 0) {
  console.error(`\n❌ 시세 배치 테스트 실패 (${fails.length}건 / 통과 ${pass}건)\n`);
  fails.forEach(x => console.error('  ' + x));
  process.exit(1);
}
console.log(`✅ 시세 배치 테스트 통과 — ${pass}건 단언`);
