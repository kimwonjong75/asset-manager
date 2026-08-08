// tests/symbolSearchParity.ts
// ---------------------------------------------------------------------------
// 종목 검색(services/symbolListService) 회귀 테스트 — 네트워크/DOM 없이 스텁으로 검증.
//
// 고정 대상(핵심은 §3 — 실제로 "자산추가 종목검색이 안 되던" 원인):
//   · **빈 목록은 유효한 캐시가 아니다.** 서버가 빈/이상 응답을 준 순간을 캐시하면
//     TTL(24h) 동안 모든 검색 모달이 "검색 결과가 없습니다"만 표시(원인 표시 없음).
//     → ① 빈 응답은 캐시 금지 + throw  ② 이미 오염된 캐시는 읽는 즉시 폐기 후 재fetch(자가 복구)
//   · 정상 캐시는 재fetch 하지 않음(키스트로크마다 서버 호출 금지)
//   · 특수종목(KRX 금현물)은 목록 로드 없이 즉시 반환
//   · 검색 점수 순서: 정확 티커 > 티커 접두 > 이름 접두 > 이름 부분 > 티커 부분
//
// 수동 실행: npm run test:symbolsearch. 통과 시 exit 0.

import type { SymbolSearchResult } from '../types';
import { EVICTABLE_CACHE_KEYS } from '../utils/safeStorage';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

// symbolListService 내부 상수와 동일해야 한다(비공개 상수라 여기서 재현).
const LS_KEY = 'asset-manager-symbol-index-v1';
const TTL = 24 * 60 * 60 * 1000;

// ── 스텁: localStorage / fetch ──────────────────────────────────────────────
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string): void { this.map.set(k, String(v)); }
  removeItem(k: string): void { this.map.delete(k); }
  has(k: string): boolean { return this.map.has(k); }
}
const store = new MemoryStorage();

const FIXTURE: SymbolSearchResult[] = [
  { ticker: '005930', name: '삼성전자', exchange: 'KRX (코스피/코스닥)' },
  { ticker: '009150', name: '삼성전기', exchange: 'KRX (코스피/코스닥)' },
  { ticker: 'AAPL', name: 'Apple Inc', exchange: 'NASDAQ' },
  { ticker: 'IOSX', name: 'Corgi AAPL 2x Daily ETF', exchange: 'NASDAQ' },
  { ticker: 'MSFT', name: 'Microsoft Corp', exchange: 'NASDAQ' },
];

let fetchCount = 0;
let nextOk = true;
let nextStatus = 200;
let nextPayload: unknown = { updatedAt: 1, count: FIXTURE.length, symbols: FIXTURE };

(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = store;
(globalThis as unknown as { fetch: unknown }).fetch = async () => {
  fetchCount++;
  return { ok: nextOk, status: nextStatus, json: async () => nextPayload };
};

// 스텁을 심은 뒤 로드해야 모듈이 실제 네트워크를 건드리지 않는다.
const { searchSymbols, searchLocalSymbols, clearSymbolIndexCache } =
  await import('../services/symbolListService');

/** 각 케이스 시작 상태를 동일하게 — 메모리+localStorage 캐시 비우고 서버 응답 정상으로 복원. */
function reset(): void {
  clearSymbolIndexCache();
  nextOk = true;
  nextStatus = 200;
  nextPayload = { updatedAt: 1, count: FIXTURE.length, symbols: FIXTURE };
  fetchCount = 0;
}

const tickers = (rows: SymbolSearchResult[]) => rows.map(r => r.ticker);

async function expectThrow(name: string, fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    fails.push(`✗ ${name}: throw 되어야 하는데 정상 반환됨`);
    return '';
  } catch (e) {
    pass++;
    return e instanceof Error ? e.message : String(e);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 1. 검색 점수/정렬 (순수 함수)
// ════════════════════════════════════════════════════════════════════════════
{
  check('정확 티커가 최상위, 이름 부분일치가 뒤',
    tickers(searchLocalSymbols('AAPL', FIXTURE)), ['AAPL', 'IOSX']);
  check('이름 접두 일치 — 원래 순서 유지(동점 안정 정렬)',
    tickers(searchLocalSymbols('삼성', FIXTURE)), ['005930', '009150']);
  check('티커 접두 일치', tickers(searchLocalSymbols('0059', FIXTURE)), ['005930']);
  check('limit 적용', searchLocalSymbols('a', FIXTURE, 2).length, 2);
  check('빈 쿼리 → 빈 결과', searchLocalSymbols('   ', FIXTURE), []);
  check('무매칭 → 빈 결과', searchLocalSymbols('zzzz', FIXTURE), []);
  check('입력 배열 불변', tickers(FIXTURE), ['005930', '009150', 'AAPL', 'IOSX', 'MSFT']);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 정상 경로 — 1회 fetch 후 캐시 재사용
// ════════════════════════════════════════════════════════════════════════════
{
  reset();
  check('첫 검색 결과', tickers(await searchSymbols('삼성')), ['005930', '009150']);
  check('첫 검색 fetch 1회', fetchCount, 1);
  check('목록이 localStorage 에 캐시됨', store.has(LS_KEY), true);

  await searchSymbols('AAPL');
  check('두 번째 검색은 재fetch 없음', fetchCount, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. [핵심 회귀] 빈 목록 오염 — 캐시 금지 + 자가 복구
//    (버그 재현: 빈 배열이 캐시되면 24h 동안 모든 검색이 조용히 0건이었다)
// ════════════════════════════════════════════════════════════════════════════
{
  // 3-a. 이미 오염된 캐시(빈 배열)를 읽으면 폐기하고 다시 받아온다
  reset();
  store.setItem(LS_KEY, JSON.stringify({ savedAt: Date.now(), symbols: [] }));
  check('오염 캐시(빈 배열)에서도 결과가 나온다', tickers(await searchSymbols('삼성')), ['005930', '009150']);
  check('오염 캐시는 폐기되고 재fetch', fetchCount, 1);
  check('정상 목록으로 캐시가 덮여짐',
    JSON.parse(store.getItem(LS_KEY) || '{}').symbols.length, FIXTURE.length);

  // 3-b. 서버가 빈 목록을 주면 캐시하지 않고 사유를 알린다
  reset();
  nextPayload = { updatedAt: 1, count: 0, symbols: [] };
  const msg = await expectThrow('빈 서버 응답 → throw', () => searchSymbols('삼성'));
  check('빈 응답 사유 메시지 노출', msg.includes('비어 있습니다'), true);
  check('빈 응답은 캐시하지 않음', store.has(LS_KEY), false);

  // 3-c. 서버가 복구되면 다음 검색이 곧바로 성공(오염 잔재 없음)
  nextPayload = { updatedAt: 1, count: FIXTURE.length, symbols: FIXTURE };
  check('서버 복구 후 즉시 정상', tickers(await searchSymbols('삼성')), ['005930', '009150']);

  // 3-d. 배열이 아닌/깨진 응답도 동일 취급
  reset();
  nextPayload = { symbols: null };
  await expectThrow('symbols 가 배열이 아니면 throw', () => searchSymbols('삼성'));
  check('배열 아닌 응답도 캐시하지 않음', store.has(LS_KEY), false);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 캐시 폐기 조건 — TTL 만료 / 형식 파손 / 수동 초기화
// ════════════════════════════════════════════════════════════════════════════
{
  reset();
  store.setItem(LS_KEY, JSON.stringify({ savedAt: Date.now() - TTL - 1000, symbols: FIXTURE }));
  await searchSymbols('삼성');
  check('TTL 만료 캐시 → 재fetch', fetchCount, 1);

  reset();
  store.setItem(LS_KEY, '{깨진 JSON');
  await searchSymbols('삼성');
  check('JSON 파손 캐시 → 재fetch', fetchCount, 1);

  reset();
  store.setItem(LS_KEY, JSON.stringify({ savedAt: Date.now(), symbols: ['문자열', 123] }));
  check('원소 형식 불량 캐시 → 재fetch 후 정상 결과',
    tickers(await searchSymbols('삼성')), ['005930', '009150']);
  check('원소 형식 불량 캐시 → 재fetch 1회', fetchCount, 1);

  reset();
  await searchSymbols('삼성');
  clearSymbolIndexCache();
  check('수동 초기화 → localStorage 에서도 제거', store.has(LS_KEY), false);
  await searchSymbols('삼성');
  check('수동 초기화 후 재fetch', fetchCount, 2);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. HTTP 실패 — 사유를 알리고 캐시 오염 없음
// ════════════════════════════════════════════════════════════════════════════
{
  reset();
  nextOk = false;
  nextStatus = 503;
  const msg = await expectThrow('HTTP 실패 → throw', () => searchSymbols('삼성'));
  check('상태코드가 사유에 포함', msg.includes('503'), true);
  check('HTTP 실패는 캐시하지 않음', store.has(LS_KEY), false);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 특수종목(KRX 금현물) — 목록 로드 없이 즉시 반환
// ════════════════════════════════════════════════════════════════════════════
{
  reset();
  check('"금" → KRX 금현물', tickers(await searchSymbols('금')), ['KRX-GOLD']);
  check('특수종목은 목록 fetch 불필요', fetchCount, 0);
  check('서버가 죽어 있어도 특수종목은 검색됨', await (async () => {
    nextOk = false; nextStatus = 500;
    return tickers(await searchSymbols('골드'));
  })(), ['KRX-GOLD']);
}

// ════════════════════════════════════════════════════════════════════════════
// 7. 축출 목록과 캐시 키가 어긋나지 않는지 (safeStorage 와 동기화 확인)
// ════════════════════════════════════════════════════════════════════════════
{
  check('symbol-index 키가 축출 대상에 등록되어 있음', EVICTABLE_CACHE_KEYS.includes(LS_KEY), true);
}

// ════════════════════════════════════════════════════════════════════════════
// 8. 로그인 후 백그라운드 프리페치 착수 조건 (순수 게이트)
//    미로그인/로딩중/이미 시도 중 하나라도 걸리면 1.3MB 요청을 내지 않는다.
// ════════════════════════════════════════════════════════════════════════════
{
  const { shouldPrefetchSymbols, PREFETCH_IDLE_DELAY_MS } = await import('../hooks/useSymbolListPrefetch');
  const gate = (isSignedIn: boolean, isLoading: boolean, attempted: boolean) =>
    shouldPrefetchSymbols({ isSignedIn, isLoading, attempted });

  check('로그인 + 로딩완료 + 미시도 → 착수', gate(true, false, false), true);
  check('미로그인 → 착수 안 함', gate(false, false, false), false);
  check('시세 로딩 중 → 착수 안 함(초기 로딩과 경쟁 금지)', gate(true, true, false), false);
  check('이미 시도함 → 착수 안 함(세션당 1회)', gate(true, false, true), false);
  check('미로그인 + 로딩중 → 착수 안 함', gate(false, true, false), false);
  check('미로그인 + 이미 시도 → 착수 안 함', gate(false, false, true), false);
  check('로딩중 + 이미 시도 → 착수 안 함', gate(true, true, true), false);
  check('전부 불충족 → 착수 안 함', gate(false, true, true), false);
  check('유휴 지연이 0이 아님(시세 배치와 간격 확보)', PREFETCH_IDLE_DELAY_MS > 0, true);
}

// ── 결과 ────────────────────────────────────────────────────────────────────
if (fails.length > 0) {
  console.error(`\n❌ 종목 검색 회귀 테스트 실패 (${fails.length}건 / 통과 ${pass}건)\n`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ 종목 검색 회귀 테스트 통과 — ${pass}건 단언`);
