// tests/ownerBulkParity.ts
// ---------------------------------------------------------------------------
// 계정(owner) 축 + 일괄 변경 parity — 순수 로직 절대값 고정.
//   · owner 추론/백필(mapToNewAssetStructure): 기존 값 보존(??), '유선' 이름 자동 태깅
//   · 계정 뷰 필터(matchesOwnerFilter) / 전략 대상 제외(isStrategyManaged)
//   · 일괄 패치(applyBulkAssetPatch): 선택만 변경·참조 보존·changedCount
//   · 터틀 후보 일괄 등록(buildTurtleCandidateRegistration): 유선 스킵·watchlist 등록/갱신/no-op
// 수동 실행: npm run test:owner (tsx). 통과 시 exit 0.

import { Asset, Currency, WatchlistItem } from '../types';
import {
  inferOwnerFromText,
  matchesOwnerFilter,
  isStrategyManaged,
  filterStrategyAssets,
  getAssetOwner,
} from '../types/owner';
import { mapToNewAssetStructure } from '../utils/portfolioCalculations';
import { applyBulkAssetPatch, buildTurtleCandidateRegistration } from '../utils/bulkAssetOps';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

function makeAsset(over: Partial<Asset> & { id: string }): Asset {
  return {
    categoryId: 2, ticker: 'VOO', exchange: 'NASDAQ', name: 'VOO', quantity: 10,
    purchasePrice: 100, purchaseDate: '2025-01-01', currency: Currency.USD,
    currentPrice: 120, priceOriginal: 120, highestPrice: 130,
    ...over,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. inferOwnerFromText — '유선' 포함 텍스트 → YUSEON, 아니면 WONJONG
// ════════════════════════════════════════════════════════════════════════════
{
  check('name에 유선', inferOwnerFromText(undefined, '유선 미국주식', undefined), 'YUSEON');
  check('customName에 유선', inferOwnerFromText('유선SPY', 'SPY', undefined), 'YUSEON');
  check('memo에 유선', inferOwnerFromText(undefined, 'SPY', '유선 계좌'), 'YUSEON');
  check('유선 없음', inferOwnerFromText('내 SPY', 'SPY', '장기'), 'WONJONG');
  check('전부 undefined', inferOwnerFromText(undefined, undefined, undefined), 'WONJONG');
}

// ════════════════════════════════════════════════════════════════════════════
// 2. mapToNewAssetStructure owner 백필 — 기존 값 보존(??), 미지정만 이름 추론
// ════════════════════════════════════════════════════════════════════════════
{
  // 미지정 + '유선' 이름 → YUSEON 자동 태깅
  const a = mapToNewAssetStructure(makeAsset({ id: 'o1', customName: '유선 나스닥' }));
  check('미지정+유선 이름 → YUSEON', a.owner, 'YUSEON');

  // 미지정 + 일반 이름 → WONJONG
  const b = mapToNewAssetStructure(makeAsset({ id: 'o2' }));
  check('미지정+일반 이름 → WONJONG', b.owner, 'WONJONG');

  // 기존 값 보존 — 이름에 '유선'이 있어도 명시된 WONJONG 유지 (?? 덮어쓰기 금지)
  const c = mapToNewAssetStructure(makeAsset({ id: 'o3', customName: '유선 나스닥', owner: 'WONJONG' }));
  check('명시 WONJONG 보존(유선 이름 무시)', c.owner, 'WONJONG');

  // 기존 YUSEON 보존
  const d = mapToNewAssetStructure(makeAsset({ id: 'o4', owner: 'YUSEON' }));
  check('명시 YUSEON 보존', d.owner, 'YUSEON');

  // 멱등성 — 재실행해도 값 불변
  const e = mapToNewAssetStructure(a);
  check('백필 멱등(YUSEON 유지)', e.owner, 'YUSEON');
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 계정 뷰 필터 + 전략 대상 판정
// ════════════════════════════════════════════════════════════════════════════
{
  const mine = makeAsset({ id: 'f1', owner: 'WONJONG' });
  const family = makeAsset({ id: 'f2', owner: 'YUSEON' });
  const legacy = makeAsset({ id: 'f3' }); // 미지정=원종

  check('ALL 필터: 원종 통과', matchesOwnerFilter(mine, 'ALL'), true);
  check('ALL 필터: 유선 통과', matchesOwnerFilter(family, 'ALL'), true);
  check('WONJONG 필터: 미지정 통과(기본=원종)', matchesOwnerFilter(legacy, 'WONJONG'), true);
  check('WONJONG 필터: 유선 차단', matchesOwnerFilter(family, 'WONJONG'), false);
  check('YUSEON 필터: 유선만', matchesOwnerFilter(family, 'YUSEON'), true);
  check('YUSEON 필터: 미지정 차단', matchesOwnerFilter(legacy, 'YUSEON'), false);

  check('전략 대상: 원종 true', isStrategyManaged(mine), true);
  check('전략 대상: 미지정 true', isStrategyManaged(legacy), true);
  check('전략 대상: 유선 false', isStrategyManaged(family), false);
  check('filterStrategyAssets 유선 제거', filterStrategyAssets([mine, family, legacy]).map(a => a.id), ['f1', 'f3']);
  check('getAssetOwner 미지정=WONJONG', getAssetOwner(legacy), 'WONJONG');
}

// ════════════════════════════════════════════════════════════════════════════
// 4. applyBulkAssetPatch — 선택만 변경, 이미 같은 값이면 참조 보존, changedCount
// ════════════════════════════════════════════════════════════════════════════
{
  const a1 = makeAsset({ id: 'b1', bucket: 'CORE' });
  const a2 = makeAsset({ id: 'b2', bucket: 'SATELLITE' });
  const a3 = makeAsset({ id: 'b3' }); // 미선택

  // 버킷 일괄 → SATELLITE: a1만 실제 변경(a2는 이미 SATELLITE)
  const r1 = applyBulkAssetPatch([a1, a2, a3], new Set(['b1', 'b2']), { bucket: 'SATELLITE' });
  check('버킷 변경 changedCount', r1.changedCount, 1);
  check('a1 버킷 변경', r1.assets[0].bucket, 'SATELLITE');
  check('a2 참조 보존(이미 같은 값)', r1.assets[1] === a2, true);
  check('미선택 a3 참조 보존', r1.assets[2] === a3, true);
  check('원본 불변', a1.bucket, 'CORE');

  // 계정 일괄 → YUSEON: 미지정(a3 기본 WONJONG)도 변경 대상
  const r2 = applyBulkAssetPatch([a1, a3], new Set(['b1', 'b3']), { owner: 'YUSEON' });
  check('계정 변경 changedCount', r2.changedCount, 2);
  check('a1 owner', r2.assets[0].owner, 'YUSEON');
  check('a3 owner(미지정→YUSEON)', r2.assets[1].owner, 'YUSEON');
  check('계정 변경 시 버킷 불변', r2.assets[0].bucket, 'CORE');

  // 복합 패치 (owner+bucket)
  const r3 = applyBulkAssetPatch([a1], new Set(['b1']), { owner: 'YUSEON', bucket: 'SATELLITE' });
  check('복합 패치 owner', r3.assets[0].owner, 'YUSEON');
  check('복합 패치 bucket', r3.assets[0].bucket, 'SATELLITE');

  // 전부 이미 같은 값 → changedCount 0
  const r4 = applyBulkAssetPatch([a2], new Set(['b2']), { bucket: 'SATELLITE' });
  check('무변경 changedCount 0', r4.changedCount, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. buildTurtleCandidateRegistration — 유선 스킵 + watchlist 등록/갱신/no-op
// ════════════════════════════════════════════════════════════════════════════
{
  const mine = makeAsset({ id: 't1', ticker: 'TQQQ', name: 'TQQQ', bucket: 'CORE' });
  const family = makeAsset({ id: 't2', ticker: 'SOXL', name: 'SOXL', customName: '유선 SOXL', owner: 'YUSEON' });
  const existing = makeAsset({ id: 't3', ticker: 'BITX', name: 'BITX', bucket: 'CORE' });
  const already = makeAsset({ id: 't4', ticker: 'UPRO', name: 'UPRO', bucket: 'SATELLITE' });
  const noPrice = makeAsset({ id: 't5', ticker: 'NEWX', name: 'NEWX', priceOriginal: 0 });

  const watchlist: WatchlistItem[] = [
    { id: 'w1', ticker: 'BITX', exchange: 'NASDAQ', name: 'BITX', categoryId: 2 },                          // 후보 아님 → 갱신 대상
    { id: 'w2', ticker: 'UPRO', exchange: 'NASDAQ', name: 'UPRO', categoryId: 2, isTurtleCandidate: true }, // 이미 후보 → no-op
  ];

  const makeId = (seq: number) => `bt-test-${seq}`;
  const r = buildTurtleCandidateRegistration(
    [mine, family, existing, already, noPrice],
    new Set(['t1', 't2', 't3', 't4', 't5']),
    { makeId },
    watchlist,
  );

  check('등록 수(유선 제외 4)', r.registeredCount, 4);
  check('유선 스킵 목록', r.skippedFamily, ['유선 SOXL']);

  // assets: 대상만 SATELLITE 전환, 유선/이미 SATELLITE는 불변
  check('t1 버킷 SATELLITE 전환', r.assets[0].bucket, 'SATELLITE');
  check('유선 t2 버킷 불변(CORE 기본)', r.assets[1].bucket ?? 'CORE', 'CORE');
  check('이미 SATELLITE t4 참조 보존', r.assets[3] === already, true);

  // watchlist: 신규 2건(TQQQ, NEWX) + BITX 후보 갱신 + UPRO no-op
  check('watchlist 길이(2+신규2)', r.watchlist.length, 4);
  check('기존 BITX 후보 갱신', r.watchlist.find(w => w.ticker === 'BITX')?.isTurtleCandidate, true);
  check('이미 후보 UPRO 유지', r.watchlist.find(w => w.ticker === 'UPRO')?.isTurtleCandidate, true);
  const newTqqq = r.watchlist.find(w => w.ticker === 'TQQQ');
  check('신규 TQQQ 등록+후보', newTqqq?.isTurtleCandidate, true);
  check('신규 TQQQ 메타(categoryId)', newTqqq?.categoryId, 2);
  check('신규 TQQQ priceOriginal 복사', newTqqq?.priceOriginal, 120);
  check('신규 TQQQ id=makeId', newTqqq?.id?.startsWith('bt-test-'), true);
  const newNoPrice = r.watchlist.find(w => w.ticker === 'NEWX');
  check('가격 0 → priceOriginal undefined', newNoPrice?.priceOriginal, undefined);
  check('유선 SOXL watchlist 미등록', r.watchlist.some(w => w.ticker === 'SOXL'), false);

  // 원본 불변
  check('원본 watchlist 불변', watchlist.length, 2);
  check('원본 asset 버킷 불변', mine.bucket, 'CORE');

  // 전원 유선 선택 → 등록 0 + 스킵 보고
  const r2 = buildTurtleCandidateRegistration([family], new Set(['t2']), { makeId }, watchlist);
  check('전원 유선: 등록 0', r2.registeredCount, 0);
  check('전원 유선: watchlist 불변', r2.watchlist === watchlist, true);
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ ownerBulk parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ ownerBulk parity 전체 통과 (${pass} 단언)`);
