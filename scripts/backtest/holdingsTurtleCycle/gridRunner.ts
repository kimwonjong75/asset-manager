// scripts/backtest/holdingsTurtleCycle/gridRunner.ts
// 종목 × 시작일 × 변형 × 비용단계 그리드 실행 — 순수(SecurityData만 소비, I/O 없음).

import { SecurityData } from './data';
import { CellResult, VariantRules, isSkip, monthlyFirstTradingDayIndices, simulateCell } from './engine';

export type CostTierName = 'zero' | 'base' | 'double';

export interface GridCell extends CellResult {
  variantId: string;
  costTier: CostTierName;
  assetClass: string;
}

export interface SkipCount { reason: string; count: number }

export interface GridResult {
  cells: GridCell[];
  skipped: SkipCount[];
}

export function runGridForSecurity(
  sec: SecurityData,
  variants: readonly VariantRules[],
  costTiers: readonly { tier: CostTierName; mult: number }[],
  gridStartISO: string,
  gridEndISO: string
): GridResult {
  const idxs = monthlyFirstTradingDayIndices(sec.ownDates, gridStartISO, gridEndISO);
  const cells: GridCell[] = [];
  const skipCounts = new Map<string, number>();

  for (const variant of variants) {
    for (const ct of costTiers) {
      for (const idx of idxs) {
        const r = simulateCell(sec, idx, variant, ct.mult);
        if (isSkip(r)) {
          skipCounts.set(r.reason, (skipCounts.get(r.reason) ?? 0) + 1);
          continue;
        }
        cells.push({ ...r, variantId: variant.id, costTier: ct.tier, assetClass: sec.assetClass });
      }
    }
  }
  return { cells, skipped: Array.from(skipCounts, ([reason, count]) => ({ reason, count })) };
}

export function runGrid(
  securities: readonly SecurityData[],
  variants: readonly VariantRules[],
  costTiers: readonly { tier: CostTierName; mult: number }[],
  gridStartISO: string,
  gridEndISO: string
): GridResult {
  const cells: GridCell[] = [];
  const skipCounts = new Map<string, number>();
  for (const sec of securities) {
    const r = runGridForSecurity(sec, variants, costTiers, gridStartISO, gridEndISO);
    cells.push(...r.cells);
    for (const s of r.skipped) skipCounts.set(s.reason, (skipCounts.get(s.reason) ?? 0) + s.count);
  }
  return { cells, skipped: Array.from(skipCounts, ([reason, count]) => ({ reason, count })) };
}
