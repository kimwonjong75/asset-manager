I have refactored the codebase to extract business logic into a custom hook `hooks/usePortfolioCalculator.ts` as requested.

### 1. Created `hooks/usePortfolioCalculator.ts`
- Encapsulates all calculation logic:
  - `getValueInKRW`: Currency conversion.
  - `calculateAssetMetrics`: Enriches asset data with KRW values, returns, allocation, etc. (Extracted from `usePortfolioData.ts`).
  - `calculatePortfolioStats`: Aggregates total value, return, etc. (Extracted from `usePortfolioStats.ts`).
  - `calculateSoldAssetsStats`: Calculates stats for sold assets.
  - `calculateAlertCount`: Logic for counting sell alerts.

### 2. Refactored `DashboardView.tsx`
- Replaced inline `usePortfolioStats` usage with `usePortfolioCalculator`.
- Now uses `calculatePortfolioStats` and `calculateSoldAssetsStats` directly from the new hook.
- Logic is cleaner and decoupled from the specific `usePortfolioStats` implementation details.

### 3. Refactored `hooks/usePortfolioStats.ts`
- Updated to use `usePortfolioCalculator` internally.
- This ensures backward compatibility for other components (like `PortfolioContext`) that rely on `usePortfolioStats`, while eliminating code duplication.

### 4. Refactored `components/portfolio-table/usePortfolioData.ts`
- Replaced inline enrichment and calculation logic with `calculateAssetMetrics` and `calculatePortfolioStats` from the new hook.
- Maintains all existing functionality (sorting, filtering) but delegates the math to the shared hook.

The refactoring is complete and follows the plan to separate business logic from UI components. The critical path (data flow and calculations) remains unchanged but is now centralized.