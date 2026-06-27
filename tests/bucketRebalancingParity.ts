// tests/bucketRebalancingParity.ts
// ---------------------------------------------------------------------------
// 전략 버킷 2단 리밸런싱 순수 계산 골든 테스트.
//   · getAssetBucket: 미지정=코어 / 명시값 존중
//   · assetValueKRW / sumByBucket / sumCategoryValuesForBucket: 평가액 환산·버킷·카테고리 집계
//   · buildRebalanceRows: 현재비중·목표금액·편차 수식 (① 버킷 tier ② 코어 카테고리 tier)
//   · 코어 tier는 코어 합계 기준 비중 + 코어 목표금액(=총목표×코어비중) 기준 목표금액
//   · 0 분모 가드 / sumRows 합계
// 시나리오: 코어 82% / 투더문 18% → 목표 코어 85 / 투더문 15 (Codex 예시 +3/-3 재현)
// 수동 실행: npm run test:bucket (tsx). 통과 시 exit 0.

import { Asset, Currency, ExchangeRates } from '../types';
import { BucketId, getAssetBucket } from '../types/bucket';
import {
  assetValueKRW,
  sumByBucket,
  sumCategoryValuesForBucket,
  buildRebalanceRows,
  sumRows,
} from '../utils/bucketRebalancing';

let pass = 0;
const fails: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkClose(name: string, actual: number, expected: number, eps = 1e-6): void {
  if (Math.abs(actual - expected) <= eps) pass++;
  else fails.push(`✗ ${name}: got ${actual}, expected ${expected}`);
}

// ── Asset 빌더 (계산에 쓰이는 4개 필드만 의미 있음, 나머지는 형식상 기본값) ──
function mkAsset(p: {
  id: string;
  categoryId: number;
  currency: Currency;
  currentPrice: number;
  quantity: number;
  bucket?: BucketId;
}): Asset {
  return {
    id: p.id,
    categoryId: p.categoryId,
    ticker: p.id,
    exchange: '',
    name: p.id,
    quantity: p.quantity,
    purchasePrice: p.currentPrice,
    purchaseDate: '2024-01-01',
    currency: p.currency,
    currentPrice: p.currentPrice,
    priceOriginal: p.currentPrice,
    highestPrice: p.currentPrice,
    bucket: p.bucket,
  };
}

const rates: ExchangeRates = { USD: 1000, JPY: 10 };

// 코어 82,000 (한국주식 40,000 + 한국채권 42,000)
const c1 = mkAsset({ id: 'c1', categoryId: 1, currency: Currency.KRW, currentPrice: 1, quantity: 40000, bucket: 'CORE' });
const c2 = mkAsset({ id: 'c2', categoryId: 5, currency: Currency.KRW, currentPrice: 1, quantity: 42000, bucket: 'CORE' });
// 투더문 18,000 (미국주식 USD 12,000 + 암호화폐 KRW 6,000) — 종류 혼합
const s1 = mkAsset({ id: 's1', categoryId: 2, currency: Currency.USD, currentPrice: 6, quantity: 2, bucket: 'SATELLITE' });
const s2 = mkAsset({ id: 's2', categoryId: 8, currency: Currency.KRW, currentPrice: 1, quantity: 6000, bucket: 'SATELLITE' });
// 레거시(bucket 미지정) → 코어로 간주
const legacy = mkAsset({ id: 'leg', categoryId: 1, currency: Currency.KRW, currentPrice: 1, quantity: 0 });

const assets = [c1, c2, s1, s2];

// ════════════════════════════════════════════════════════════════════════════
// 1. getAssetBucket
// ════════════════════════════════════════════════════════════════════════════
check('getAssetBucket 미지정=코어', getAssetBucket(legacy), 'CORE');
check('getAssetBucket 명시 위성', getAssetBucket(s1), 'SATELLITE');
check('getAssetBucket 명시 코어', getAssetBucket(c1), 'CORE');

// ════════════════════════════════════════════════════════════════════════════
// 2. assetValueKRW (KRW=1, 외화=환율)
// ════════════════════════════════════════════════════════════════════════════
check('assetValueKRW KRW', assetValueKRW(c1, rates), 40000);
check('assetValueKRW USD(×1000)', assetValueKRW(s1, rates), 12000);

// ════════════════════════════════════════════════════════════════════════════
// 3. sumByBucket / sumCategoryValuesForBucket
// ════════════════════════════════════════════════════════════════════════════
check('sumByBucket', sumByBucket(assets, rates), { CORE: 82000, SATELLITE: 18000, total: 100000 });
check('코어 카테고리 합산', sumCategoryValuesForBucket(assets, rates, 'CORE'), { '1': 40000, '5': 42000 });
check('위성 카테고리 합산(혼합)', sumCategoryValuesForBucket(assets, rates, 'SATELLITE'), { '2': 12000, '8': 6000 });

// ════════════════════════════════════════════════════════════════════════════
// 4. ① 버킷 tier — 코어 82→목표85(+3,000) / 투더문 18→목표15(-3,000)
// ════════════════════════════════════════════════════════════════════════════
const buckets = sumByBucket(assets, rates);
const bucketRows = buildRebalanceRows({
  keys: ['CORE', 'SATELLITE'],
  valuesByKey: { CORE: buckets.CORE, SATELLITE: buckets.SATELLITE },
  targetWeights: { CORE: 85, SATELLITE: 15 },
  denominatorValue: buckets.total,
  targetTotalAmount: 100000,
  labelOf: (k) => k,
});
const coreBucketRow = bucketRows.find(r => r.key === 'CORE')!;
const satBucketRow = bucketRows.find(r => r.key === 'SATELLITE')!;
checkClose('버킷 코어 현재비중', coreBucketRow.currentWeight, 82);
checkClose('버킷 코어 목표금액', coreBucketRow.targetValue, 85000);
checkClose('버킷 코어 편차 +3,000', coreBucketRow.difference, 3000);
checkClose('버킷 투더문 현재비중', satBucketRow.currentWeight, 18);
checkClose('버킷 투더문 목표금액', satBucketRow.targetValue, 15000);
checkClose('버킷 투더문 편차 -3,000', satBucketRow.difference, -3000);

// ════════════════════════════════════════════════════════════════════════════
// 5. ② 코어 카테고리 tier — 코어 합계(82,000) 기준 비중 + 코어 목표금액(85,000) 기준 목표
// ════════════════════════════════════════════════════════════════════════════
const coreTargetAmount = (100000 * 85) / 100; // 85,000
const coreValues = sumCategoryValuesForBucket(assets, rates, 'CORE');
const coreRows = buildRebalanceRows({
  keys: ['1', '5'],
  valuesByKey: coreValues,
  targetWeights: { '1': 50, '5': 50 },
  denominatorValue: buckets.CORE,
  targetTotalAmount: coreTargetAmount,
  labelOf: (k) => k,
});
const r1 = coreRows.find(r => r.key === '1')!;
const r5 = coreRows.find(r => r.key === '5')!;
checkClose('코어tier 한국주식 현재비중(=40000/82000)', r1.currentWeight, (40000 / 82000) * 100);
checkClose('코어tier 한국주식 목표금액(85000×50%)', r1.targetValue, 42500);
checkClose('코어tier 한국주식 편차(+2,500)', r1.difference, 2500);
checkClose('코어tier 한국채권 목표금액', r5.targetValue, 42500);
checkClose('코어tier 한국채권 편차(+500)', r5.difference, 500);
// 코어 tier 목표금액 합 = 코어 목표금액 (총액 아님)
checkClose('코어tier 목표금액 합 = 코어목표금액', r1.targetValue + r5.targetValue, coreTargetAmount);

// ════════════════════════════════════════════════════════════════════════════
// 6. 0 분모 가드 + sumRows 합계
// ════════════════════════════════════════════════════════════════════════════
const zeroDenom = buildRebalanceRows({
  keys: ['CORE'],
  valuesByKey: { CORE: 0 },
  targetWeights: { CORE: 100 },
  denominatorValue: 0,
  targetTotalAmount: 0,
  labelOf: (k) => k,
});
check('0 분모 → 현재비중 0', zeroDenom[0].currentWeight, 0);

const totals = sumRows(bucketRows);
checkClose('sumRows 목표비중 합', totals.totalTargetWeight, 100);
checkClose('sumRows 목표금액 합', totals.totalTargetValue, 100000);
checkClose('sumRows 편차 합(≈0)', totals.totalDifference, 0);

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ bucketRebalancing parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  console.error(`\n통과 ${pass} / 실패 ${fails.length}`);
  process.exit(1);
} else {
  console.log(`✅ bucketRebalancing parity 전체 통과 (${pass} 단언)`);
}
