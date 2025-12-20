# Infinite Loop Fix Plan

The analysis of `useGoogleDriveSync.ts` and `usePortfolioData.ts` reveals the root cause of the infinite loop.

## Root Cause
1. **Unstable `options` dependency**:
   - `usePortfolioData.ts` passes `onError` and `onSuccessMessage` (which are state setter functions) to `useGoogleDriveSync`.
   - `useGoogleDriveSync` includes `options` in the dependency array of `loadFromGoogleDrive` (`[options]`).
   - Although state setters are stable, if `options` object itself is recreated on every render in `usePortfolioData`, it triggers `loadFromGoogleDrive` recreation.
   - However, even if `options` is stable, the main issue is `useEffect` in `usePortfolioData`.

2. **Circular Dependency in `useEffect`**:
   - `usePortfolioData.ts`:
     ```typescript
     useEffect(() => {
       if (isInitializing) return;
       if (isSignedIn) {
         setHasAutoUpdated(false);
         loadFromGoogleDrive();
       } else {
         // ...
       }
     }, [isInitializing, isSignedIn, loadFromGoogleDrive]);
     ```
   - `loadFromGoogleDrive` (in `usePortfolioData`) calls `hookLoadFromGoogleDrive` and then `setAssets`.
   - `setAssets` triggers a re-render.
   - On re-render, if `loadFromGoogleDrive` is recreated, the effect runs again.
   - `loadFromGoogleDrive` depends on `hookLoadFromGoogleDrive`.
   - `hookLoadFromGoogleDrive` (in `useGoogleDriveSync`) depends on `options`.
   - If `options` changes, `hookLoadFromGoogleDrive` changes -> `loadFromGoogleDrive` changes -> `useEffect` runs -> `setAssets` -> re-render.

3. **Infinite Migration Loop**:
   - `loadFromGoogleDrive` runs `runMigrationIfNeeded`.
   - This logs "Migration started...".
   - If this cycle repeats, you see the logs flooding.

## Fix Strategy

### 1. Stabilize `useGoogleDriveSync`
- Remove `options` from the dependency array of `loadFromGoogleDrive` and `autoSave`.
- Use `useRef` for `options` to access the latest callbacks without adding them to dependencies.

### 2. Fix `usePortfolioData.ts`
- Remove `loadFromGoogleDrive` from the `useEffect` dependency array.
- Instead, use a flag or check `isSignedIn` transition to ensure `loadFromGoogleDrive` runs only once when the user signs in.
- Alternatively, keep `loadFromGoogleDrive` in deps but ensure it's strictly stable. Given the complexity, removing it from deps and handling the trigger logic carefully is safer.

## Implementation Steps

1. **Modify `hooks/useGoogleDriveSync.ts`**:
   - Wrap `options` in a `useRef` to keep it up-to-date without triggering effect re-runs.
   - Update `handleSignIn`, `handleSignOut`, `loadFromGoogleDrive`, `autoSave` to use `optionsRef.current`.
   - Remove `options` from their dependency arrays.

2. **Modify `hooks/usePortfolioData.ts`**:
   - Refactor the `useEffect` responsible for initial loading.
   - Create a `hasLoaded` ref or state to prevent re-fetching after a successful load, OR simply ensure the effect only runs when `isSignedIn` changes from `false` to `true`.

## Verification
- Confirm the "Migration" logs stop repeating.
- Confirm the network requests stop flooding.
- Verify that data still loads correctly upon sign-in.
