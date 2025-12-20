## Changes to Implement
1. Update `CategorySummaryTable.tsx`
- Add prop: `exchangeRates: ExchangeRates`
- Compute totals using exchange rates:
  - For each asset: `rate = currency === KRW ? 1 : exchangeRates[currency] || 0`
  - `currentValueKRW = asset.currentPrice * asset.quantity * rate`
  - `purchaseValueKRW = asset.purchasePrice * asset.quantity * rate`
- Replace the existing fallback(1450) logic with the above rate-based computation.

2. Keep `App.tsx` passing `exchangeRates` to `CategorySummaryTable`
- Already passing; validate types compile.

3. README minor phrasing
- Clarify that the return header shows status via text label(▲/▼), not a separate icon component.

## Verification
- Type check for `CategorySummaryTable` props and usages
- Ensure dashboard summary numbers match AllocationChart
- Quick run through portfolio with USD/JPY assets to confirm KRW totals update when `ExchangeRateInput` changes

## Outcome
- Documentation and implementation match: `CategorySummaryTable` uses provided `exchangeRates` consistently; README wording accurately reflects UI.