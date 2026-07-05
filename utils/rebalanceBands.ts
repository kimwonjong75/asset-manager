// utils/rebalanceBands.ts
// ---------------------------------------------------------------------------
// 코어 카테고리 밴드 리밸런싱 "판정 엔진" (Phase 4a, 순수 함수).
//
// 범위(4a): **판정만** — 코어 카테고리가 목표 대비 ±band(%p)를 벗어났는지 감지한다.
//   · 주문 생성·수량 번역("무엇을 몇 주")·대표 종목 매핑·UI 저장은 전부 4b 이후.
//   · 밴드 안이면 결과 0건(침묵 — 자주 안 건드리는 게 정상, PLAN 수용기준).
//   · 코어 카테고리 tier만(D4: 코어=밴드 리밸런싱, 손절 없음. 위성=터틀). 버킷 90/10은 범위 밖(advisory).
//
// 통화/방향 규약:
//   · difference = targetValue − currentValue (KRW). **difference>0 → BUY 필요, <0 → SELL 필요.**
//   · 밴드 게이트는 **비중 편차**(currentWeight − targetWeight, %p) 기준. 금액/방향은 difference 기준.
//     (기본 시나리오: targetTotalAmount=현재총액이면 두 부호가 일치. 자본 증감 설정은 사용자 몫.)
//   · fail-closed: targetTotalAmount 또는 코어 기준값(coreCurrentValue)이 0이면 판정 안 함(0건).

import { Asset, ExchangeRates } from '../types';
import { CategoryDefinition, getCategoryName } from '../types/category';
import { RebalanceRow, sumByBucket, sumCategoryValuesForBucket, buildRebalanceRows } from './bucketRebalancing';

export const DEFAULT_REBALANCE_BAND_PCT = 5; // ±5%p 절대 밴드

export interface RebalanceBandDeviation {
  key: string;            // categoryId 문자열
  label: string;          // 카테고리 표시명
  currentValue: number;   // 현재 평가액 (KRW)
  currentWeight: number;  // 현재 비중 (% of 코어)
  targetWeight: number;   // 목표 비중 (%)
  targetValue: number;    // 목표 평가액 (KRW)
  difference: number;     // targetValue − currentValue (KRW, +BUY / −SELL)
  deviationPct: number;   // currentWeight − targetWeight (%p, signed)
  direction: 'BUY' | 'SELL';
}

export interface RebalanceBandOptions {
  bandPct?: number;       // 기본 5 (±5%p)
}

/**
 * 코어 카테고리 행(buildRebalanceRows 산출)에서 밴드 이탈만 추린다 (순수).
 * @param coreRows 코어 카테고리 tier의 RebalanceRow[] (currentWeight/targetWeight/difference 포함)
 * @param ctx 목표 총액·코어 기준값 (둘 중 하나라도 0이면 fail-closed → [])
 */
export function detectRebalanceBands(
  coreRows: RebalanceRow[],
  ctx: { targetTotalAmount: number; coreCurrentValue: number },
  opts: RebalanceBandOptions = {},
): RebalanceBandDeviation[] {
  if (!(ctx.targetTotalAmount > 0) || !(ctx.coreCurrentValue > 0)) return []; // fail-closed
  const band = opts.bandPct ?? DEFAULT_REBALANCE_BAND_PCT;
  if (!(band > 0)) return [];

  const out: RebalanceBandDeviation[] = [];
  for (const r of coreRows) {
    const deviationPct = r.currentWeight - r.targetWeight;
    if (Math.abs(deviationPct) < band) continue; // 밴드 안 → 침묵
    if (r.difference === 0) continue;             // 조정 금액 없음
    out.push({
      key: r.key,
      label: r.label,
      currentValue: r.currentValue,
      currentWeight: r.currentWeight,
      targetWeight: r.targetWeight,
      targetValue: r.targetValue,
      difference: r.difference,
      deviationPct,
      direction: r.difference > 0 ? 'BUY' : 'SELL',
    });
  }
  return out;
}

/**
 * 저장본/편집값 어느 쪽이든 목표 세트를 주입받아 코어 카테고리 밴드 이탈을 계산 (Phase 4b-3a, 순수).
 * **표시(편집 state 주입)와 생성(저장본 주입)이 이 한 경로를 공유**해 drift를 없앤다.
 * 코어 목표금액(=targetTotalAmount×CORE%)이 0이면 판정 안 함(useRebalancing 게이트 통일).
 */
export function computeCoreBands(input: {
  assets: Asset[];
  rates: ExchangeRates;
  categories: CategoryDefinition[];
  weights: Record<string, number>;        // 코어 카테고리 목표% (코어 합계=100 기준)
  bucketWeights: Record<string, number>;  // CORE/SATELLITE%
  targetTotalAmount: number;
  bandPct?: number;
}): RebalanceBandDeviation[] {
  const { assets, rates, categories, weights, bucketWeights, targetTotalAmount, bandPct } = input;
  const coreCurrentValue = sumByBucket(assets, rates).CORE;
  const coreTargetAmount = (targetTotalAmount * (bucketWeights.CORE || 0)) / 100;
  if (!(coreTargetAmount > 0)) return [];
  const coreCategoryValues = sumCategoryValuesForBucket(assets, rates, 'CORE');
  const keys = Array.from(new Set([...Object.keys(coreCategoryValues), ...Object.keys(weights)]));
  const rows = buildRebalanceRows({
    keys,
    valuesByKey: coreCategoryValues,
    targetWeights: weights,
    denominatorValue: coreCurrentValue,
    targetTotalAmount: coreTargetAmount,
    labelOf: k => getCategoryName(Number(k), categories),
  });
  return detectRebalanceBands(rows, { targetTotalAmount, coreCurrentValue }, { bandPct });
}
