// tests/sellRecordsParity.ts
// ---------------------------------------------------------------------------
// `utils/sellRecords.mergeSellRecords` 골든 테스트 — 순수 함수만 호출(React/DOM 없음).
//
// 이 테스트가 지키는 것:
//   ① 매도 이력의 두 저장처(`sellHistory` / 자산 인라인 `sellTransactions`)가 하나로 합쳐진다
//   ② **`sellHistory` 우선** — 같은 id가 양쪽에 있으면 sellHistory 쪽만 남는다(기존 두 사본의 규약)
//   ③ 인라인 레코드는 소속 자산에서 assetId/ticker/name/categoryId를 물려받는다
//   ④ 반환 순서는 sellHistory 전부 → 인라인(자산 순서 → 트랜잭션 순서)
//   ⑤ 입력 배열은 변형되지 않는다(순수)
//
// 배경: 이 병합이 세 화면(수익통계·대시보드·대청소)에 흩어져 있었고 대청소만 인라인 건을
//       빠뜨려 양도세 추정이 대시보드와 어긋났다. 단일화 후의 회귀 가드.
//
// 수동 실행: npm run test:sellrecords. 통과 시 exit 0.
// ---------------------------------------------------------------------------

import { Asset, Currency, SellRecord, SellTransaction } from '../types';
import { mergeSellRecords } from '../utils/sellRecords';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

// ── 픽스처 ───────────────────────────────────────────────────────────────────
const mkAsset = (over: Partial<Asset> & { id: string }): Asset => ({
  categoryId: 2, ticker: 'T', exchange: 'NASDAQ', name: 'T', quantity: 10,
  purchasePrice: 100, purchaseDate: '2025-01-01', currency: Currency.USD,
  currentPrice: 120, priceOriginal: 120, highestPrice: 130, ...over,
});

const mkTx = (id: string, over: Partial<SellTransaction> = {}): SellTransaction => ({
  id, sellDate: '2026-02-01', sellPrice: 174_000, sellQuantity: 10, ...over,
});

const historyRecord: SellRecord = {
  id: 'h1', assetId: 'a-gone', ticker: 'GONE', name: '전량매도종목', categoryId: 2,
  sellDate: '2026-01-15', sellPrice: 100_000, sellQuantity: 5,
};

// ════════════════════════════════════════════════════════════════════════════
// 1. 빈 입력
// ════════════════════════════════════════════════════════════════════════════
check('둘 다 비면 빈 배열', mergeSellRecords([], []), []);
check('자산만 있고 매도 없음 → 빈 배열', mergeSellRecords([], [mkAsset({ id: 'a1' })]), []);
check('sellHistory만 → 그대로', mergeSellRecords([historyRecord], []), [historyRecord]);

// ════════════════════════════════════════════════════════════════════════════
// 2. 인라인 전용 건이 드러난다 + 자산 메타를 물려받는다
// ════════════════════════════════════════════════════════════════════════════
{
  const asset = mkAsset({ id: 'a1', ticker: 'AAPL', name: '애플', categoryId: 7, sellTransactions: [mkTx('t1')] });
  const merged = mergeSellRecords([], [asset]);
  check('인라인 1건 노출', merged.length, 1);
  check('인라인 assetId 채움', merged[0].assetId, 'a1');
  check('인라인 ticker 채움', merged[0].ticker, 'AAPL');
  check('인라인 name 채움', merged[0].name, '애플');
  check('인라인 categoryId 채움', merged[0].categoryId, 7);
  check('인라인 트랜잭션 필드 보존', [merged[0].id, merged[0].sellPrice, merged[0].sellQuantity], ['t1', 174_000, 10]);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. id 중복 — sellHistory가 이긴다 (인라인 쪽은 버려진다)
// ════════════════════════════════════════════════════════════════════════════
{
  const dup: SellRecord = {
    id: 'dup1', assetId: 'a1', ticker: 'AAPL', name: '이력쪽 이름', categoryId: 2,
    sellDate: '2026-02-01', sellPrice: 999, sellQuantity: 1,
  };
  const asset = mkAsset({
    id: 'a1', ticker: 'AAPL', name: '자산쪽 이름',
    sellTransactions: [mkTx('dup1', { sellPrice: 111, sellQuantity: 3 }), mkTx('t2')],
  });
  const merged = mergeSellRecords([dup], [asset]);
  check('중복 제거 후 2건', merged.length, 2);
  check('중복 id는 sellHistory 쪽 값', [merged[0].name, merged[0].sellPrice, merged[0].sellQuantity], ['이력쪽 이름', 999, 1]);
  check('중복 아닌 인라인은 살아남음', merged[1].id, 't2');
  check('중복 id가 두 번 나오지 않음', merged.filter(r => r.id === 'dup1').length, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 순서 — sellHistory 전부 → 인라인(자산 순서 → 트랜잭션 순서)
// ════════════════════════════════════════════════════════════════════════════
{
  const h2: SellRecord = { ...historyRecord, id: 'h2' };
  const a1 = mkAsset({ id: 'a1', sellTransactions: [mkTx('t1'), mkTx('t2')] });
  const a2 = mkAsset({ id: 'a2', sellTransactions: [mkTx('t3')] });
  const merged = mergeSellRecords([historyRecord, h2], [a1, a2]);
  check('병합 순서', merged.map(r => r.id), ['h1', 'h2', 't1', 't2', 't3']);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 빈 sellTransactions / 필드 없음 → 건너뛴다, 입력은 불변
// ════════════════════════════════════════════════════════════════════════════
{
  const empty = mkAsset({ id: 'a1', sellTransactions: [] });
  const none = mkAsset({ id: 'a2' });
  check('빈 배열·필드 없음 → 결과 없음', mergeSellRecords([], [empty, none]), []);

  const history: SellRecord[] = [historyRecord];
  const asset = mkAsset({ id: 'a1', sellTransactions: [mkTx('t1')] });
  mergeSellRecords(history, [asset]);
  check('입력 sellHistory 불변(길이 1)', history.length, 1);
  check('입력 자산 sellTransactions 불변(길이 1)', asset.sellTransactions!.length, 1);
  check('반환은 새 배열', mergeSellRecords(history, []) === history, false);
}

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n[sellRecordsParity] ${pass} passed, ${fails.length} failed`);
if (fails.length > 0) {
  fails.forEach(f => console.error(f));
  process.exit(1);
}
