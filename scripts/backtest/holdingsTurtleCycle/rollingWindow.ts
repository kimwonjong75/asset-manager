// scripts/backtest/holdingsTurtleCycle/rollingWindow.ts
// 고정기간 롤링 창 비교(순수) — §재검증 과제4(a). "데이터 끝까지"가 아니라 시작일로부터 정확히
// N년 시점의 마크투마켓 결과를 비교한다(engine.ts의 opts.maxEndIdx로 창을 자른다 — 별도 로직 재구현 없음).

import { SecurityData } from './data';
import { CellResult, VariantRules, isSkip, monthlyFirstTradingDayIndices, yearsBetweenIso, simulateCell } from './engine';
import { CostTierName } from './gridRunner';

export interface RollingCell extends CellResult {
  variantId: string;
  costTier: CostTierName;
  assetClass: string;
  horizonYears: number;
  cashAnnualRatePct: number;
  /** 창 끝이 데이터 끝(조기 종료)보다 먼저 왔는지 — false면 그 종목 데이터가 N년을 채우지 못해 제외 후보. */
  windowComplete: boolean;
}

/**
 * startIdx로부터 정확히 horizonYears년 뒤(또는 그 이전 마지막 거래일)까지의 own 인덱스를 찾는다.
 * 데이터가 그 시점까지 없으면(가장 최근 시작일들) null.
 */
function findHorizonEndIdx(dates: readonly string[], startIdx: number, horizonYears: number): { idx: number; complete: boolean } | null {
  const startISO = dates[startIdx];
  let lastWithinIdx = startIdx;
  for (let i = startIdx; i < dates.length; i++) {
    if (yearsBetweenIso(startISO, dates[i]) <= horizonYears) lastWithinIdx = i;
    else return { idx: lastWithinIdx, complete: true };
  }
  // 데이터 끝까지 horizonYears에 못 미침 — 창이 완성되지 않음(부분창, 참고용으로만 반환).
  return { idx: lastWithinIdx, complete: false };
}

export function runRollingWindowForSecurity(
  sec: SecurityData,
  variants: readonly VariantRules[],
  costTiers: readonly { tier: CostTierName; mult: number }[],
  horizonsYears: readonly number[],
  cashAnnualRates: readonly number[],
  gridStartISO: string,
  gridEndISO: string,
  requireComplete = true
): RollingCell[] {
  const idxs = monthlyFirstTradingDayIndices(sec.ownDates, gridStartISO, gridEndISO);
  const out: RollingCell[] = [];
  for (const variant of variants) {
    for (const ct of costTiers) {
      for (const horizonYears of horizonsYears) {
        for (const cashRate of cashAnnualRates) {
          for (const idx of idxs) {
            const h = findHorizonEndIdx(sec.ownDates, idx, horizonYears);
            if (!h) continue;
            if (requireComplete && !h.complete) continue;
            const r = simulateCell(sec, idx, variant, ct.mult, { maxEndIdx: h.idx, cashAnnualRatePct: cashRate });
            if (isSkip(r)) continue;
            out.push({
              ...r, variantId: variant.id, costTier: ct.tier, assetClass: sec.assetClass,
              horizonYears, cashAnnualRatePct: cashRate, windowComplete: h.complete,
            });
          }
        }
      }
    }
  }
  return out;
}

export function runRollingWindow(
  securities: readonly SecurityData[],
  variants: readonly VariantRules[],
  costTiers: readonly { tier: CostTierName; mult: number }[],
  horizonsYears: readonly number[],
  cashAnnualRates: readonly number[],
  gridStartISO: string,
  gridEndISO: string,
  requireComplete = true
): RollingCell[] {
  const out: RollingCell[] = [];
  for (const sec of securities) {
    out.push(...runRollingWindowForSecurity(sec, variants, costTiers, horizonsYears, cashAnnualRates, gridStartISO, gridEndISO, requireComplete));
  }
  return out;
}
