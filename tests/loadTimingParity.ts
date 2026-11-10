// tests/loadTimingParity.ts
// 시작 계측(utils/loadTiming) — 첫 발생 우선, 확정 조건, 10회 캡, 확정 후 no-op, 저장소 예외 무해.
class MemoryStorage {
  map = new Map<string, string>();
  throwOnSet = false;
  throwOnGet = false;
  getItem(k: string): string | null {
    if (this.throwOnGet) throw new Error('get blocked');
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    if (this.throwOnSet) throw new Error('quota');
    this.map.set(k, String(v));
  }
  removeItem(k: string): void { this.map.delete(k); }
}
const store = new MemoryStorage();
let clock = 0;
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = store;
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true });

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

const T = await import('../utils/loadTiming');
const KEY = 'asset-manager-load-timing-v1';
check('저장 키', T.LOAD_TIMING_STORAGE_KEY, KEY);

// 1. 첫 발생 우선 + 반올림 + 요청 누적 + 확정(price-refresh-end 변형)
T.__resetLoadTimingForTest();
clock = 100.4; T.markLoadStage('app-mount');
clock = 250.6; T.markLoadStage('app-mount'); // 무시
T.recordLoadRequest('price', { tickers: 20, ms: 1000.4, ok: true });
T.recordLoadRequest('price', { tickers: 5, ms: 500, ok: false });
T.recordLoadRequest('history', { tickers: 100, ms: 4000, ok: true });
clock = 300; T.markLoadStage('price-refresh-end');
check('확정 전에는 저장 없음(enriched-end 미기록)', T.readLoadTimingRuns().length, 0);
clock = 400; T.markLoadStage('enriched-end');
{
  const runs = T.readLoadTimingRuns();
  check('1회 확정', runs.length, 1);
  check('app-mount는 첫 값(100)', runs[0].marks['app-mount'], 100);
  check('price-refresh-end=300', runs[0].marks['price-refresh-end'], 300);
  check('enriched-end=400', runs[0].marks['enriched-end'], 400);
  check('price 누적', runs[0].requests.price, { requests: 2, tickers: 25, totalMs: 1500, failures: 1 });
  check('history 누적', runs[0].requests.history, { requests: 1, tickers: 100, totalMs: 4000, failures: 0 });
  check('at은 ISO 문자열', typeof runs[0].at === 'string' && runs[0].at.endsWith('Z'), true);
}

// 2. 확정 후 no-op
T.markLoadStage('backfill-start');
T.recordLoadRequest('fx', { tickers: 1, ms: 10, ok: true });
T.markLoadStage('enriched-end');
check('확정 후 추가 기록 없음', T.readLoadTimingRuns().length, 1);

// 3. price-refresh-skipped 변형 + enriched 먼저
T.__resetLoadTimingForTest();
clock = 10; T.markLoadStage('enriched-end');
check('enriched만으로는 확정 안 됨', T.readLoadTimingRuns().length, 1);
clock = 20; T.markLoadStage('price-refresh-skipped');
check('skipped + enriched-end → 확정', T.readLoadTimingRuns().length, 2);
check('두 번째 run의 skipped=20', T.readLoadTimingRuns()[1].marks['price-refresh-skipped'], 20);

// 4. 10회 캡 (오래된 것부터 제거)
for (let i = 0; i < 12; i++) {
  T.__resetLoadTimingForTest();
  clock = 1000 + i; T.markLoadStage('price-refresh-end');
  T.markLoadStage('enriched-end');
}
{
  const runs = T.readLoadTimingRuns();
  check('최근 10회만 보관', runs.length, 10);
  check('가장 오래된 보관분 enriched-end=1002', runs[0].marks['enriched-end'], 1002);
  check('가장 최근 enriched-end=1011', runs[9].marks['enriched-end'], 1011);
}

// 5. 저장소가 throw 해도 호출은 throw 하지 않는다
{
  let threw = false;
  try {
    store.throwOnSet = true;
    T.__resetLoadTimingForTest();
    T.markLoadStage('price-refresh-end');
    T.markLoadStage('enriched-end');
    store.throwOnSet = false; store.throwOnGet = true;
    T.__resetLoadTimingForTest();
    T.markLoadStage('price-refresh-end');
    T.markLoadStage('enriched-end');
    T.readLoadTimingRuns();
  } catch { threw = true; }
  store.throwOnGet = false;
  check('저장소 예외 무해', threw, false);
  store.throwOnGet = true;
  check('get 실패 시 read는 빈 배열', T.readLoadTimingRuns(), []);
  store.throwOnGet = false;
}

if (fails.length > 0) {
  console.error(`\n❌ 시작 계측 테스트 실패 (${fails.length}건 / 통과 ${pass}건)\n`);
  fails.forEach(x => console.error('  ' + x));
  process.exit(1);
}
console.log(`✅ 시작 계측 테스트 통과 — ${pass}건 단언`);
