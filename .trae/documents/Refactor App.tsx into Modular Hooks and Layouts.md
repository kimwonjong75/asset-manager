# App.tsx Refactoring Plan

The goal is to modularize `App.tsx` into domain-specific hooks and layout components to improve maintainability while ensuring system stability.

## 1. Directory Structure Changes
- Create `src/components/layouts/`
- Create `src/hooks/usePortfolioData.ts`
- Create `src/hooks/useAssetActions.ts`
- Create `src/hooks/useMarketData.ts`

## 2. Implementation Steps

### Step 1: Create `src/hooks/usePortfolioData.ts`
This hook will act as the "Single Source of Truth" for data.
- **State Management**: `assets`, `portfolioHistory`, `sellHistory`, `watchlist`, `exchangeRates`, `isLoading`, `error`, `successMessage`.
- **Integrations**: `useGoogleDriveSync` (Auth & Sync).
- **Core Logic**: 
  - Initial data loading (`loadFromGoogleDrive`).
  - Data migration (`runMigrationIfNeeded`).
  - `saveToDrive` (Manual save).
  - `autoSave` wrapper (Triggered on data changes).

### Step 2: Create `src/hooks/useMarketData.ts`
This hook handles all external price fetching logic.
- **Dependencies**: Receives state and setters from `usePortfolioData`.
- **Logic**:
  - `handleRefreshAllPrices` (Batch update).
  - `handleRefreshSelectedPrices`.
  - `handleRefreshOnePrice`.
  - `handleRefreshWatchlistPrices`.
  - `handleExchangeRatesChange`.
- **Stability**: Ensure `autoSave` is triggered after successful price updates.

### Step 3: Create `src/hooks/useAssetActions.ts`
This hook handles user-driven asset modifications.
- **Dependencies**: Receives state and setters from `usePortfolioData`.
- **Logic**:
  - `handleAddAsset`
  - `handleEditAsset` / `handleUpdateAsset`
  - `handleDeleteAsset`
  - `handleSellAsset` / `handleConfirmSell`
  - `handleCsvFileUpload`
  - Watchlist management actions (`handleAddWatchItem`, etc.)

### Step 4: Create Layout Components
Move JSX from `App.tsx` into focused components.
- **`src/components/layouts/DashboardView.tsx`**: Charts, Stats, Summary.
- **`src/components/layouts/PortfolioView.tsx`**: `PortfolioTable`, `SellAlertControl`.
- **`src/components/layouts/AnalyticsView.tsx`**: `SellAnalyticsPage`.
- **`src/components/layouts/WatchlistView.tsx`**: `WatchlistPage`.

### Step 5: Refactor `App.tsx`
- Integrate the new hooks.
- Replace massive JSX blocks with the new layout components.
- Manage top-level routing (Tab state) and global modals (Settings, Import/Export).

## 3. Stability & Safety Checks
- **Dependency Arrays**: Carefully verify `useCallback` and `useEffect` dependencies in new hooks to prevent stale state.
- **Auto-Save**: Confirm `autoSave` is consistently called after every state mutation (CRUD, Price Update).
- **Type Safety**: Strictly define Props interfaces for new components and Hook return types.
- **No Logic Change**: This is a pure refactoring; no business logic will be altered.

## 4. Verification
- **Build Check**: Run `tsc` to ensure no type errors.
- **Runtime Check**: Verify "Add Asset", "Refresh Price", and "Switch Tabs" functionalities after refactoring.
