// utils/saveQueue.ts
// ---------------------------------------------------------------------------
// Framework-free debounced save queue with a pending-save slot (P1 fix).
//
// Motivation: the previous autoSave dropped a save request that arrived while a
// save was already in-flight (`if (isSavingRef.current) return;`). This queue
// instead stashes the LATEST payload as `pending` and flushes it automatically
// once the in-flight save settles — so no user state is silently lost.
//
// Semantics (see useGoogleDriveSync + tests/saveQueueParity.ts):
//   1. request() (re)starts the debounce timer with the latest payload (coalescing).
//   2. Timer fire while a save is in-flight → store as pending (latest wins);
//      after the in-flight save settles, save pending automatically (loop until empty).
//   3. Byte-identical payload to the last SUCCESSFUL save is skipped (a failed
//      save must NOT update lastSaved).
//   4. On failure: no automatic retry of the SAME payload (no infinite loop).
//      A newer pending payload that arrived during the failed save is still
//      attempted once (it is a newer state). Otherwise the payload stays eligible
//      for the next explicit request(). State transitions to 'error'.
//   5. dispose() clears the debounce timer (unmount cleanup).
//
// No React, no DOM. Pure module usable from Node/tsx tests.

export type SaveQueueState = 'idle' | 'saving' | 'saved' | 'error';

export interface SaveQueueOptions {
  /** Debounce window in milliseconds before a requested payload is saved. */
  debounceMs: number;
  /** Performs the actual save. Resolve on success, reject on failure. */
  save: (payload: string) => Promise<void>;
  /** Optional observer notified on every state transition. */
  onStateChange?: (state: SaveQueueState) => void;
}

export interface SaveQueue {
  /** Queue a payload to be saved after the debounce window (latest wins). */
  request: (payload: string) => void;
  /** Cancel the pending debounce timer (call on unmount). */
  dispose: () => void;
  /** Current queue state. */
  getState: () => SaveQueueState;
}

export function createSaveQueue(options: SaveQueueOptions): SaveQueue {
  const { debounceMs, save, onStateChange } = options;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  // Latest payload waiting to be saved. `null` means nothing queued.
  let pending: string | null = null;
  // Last SUCCESSFULLY saved payload — used for the identical-skip guard.
  let lastSaved: string | null = null;
  let state: SaveQueueState = 'idle';
  let disposed = false;

  function setState(next: SaveQueueState): void {
    if (disposed || next === state) return;
    state = next;
    onStateChange?.(next);
  }

  function enqueue(payload: string): void {
    // Latest payload always wins the pending slot.
    pending = payload;
    if (inFlight) return;
    void runLoop();
  }

  async function runLoop(): Promise<void> {
    inFlight = true;
    try {
      while (pending !== null && !disposed) {
        const payload = pending;
        // Claim the slot before awaiting so a request() arriving during the
        // save lands in a fresh pending (and is not lost).
        pending = null;

        if (payload === lastSaved) {
          // Byte-identical to the last successful save → skip silently.
          continue;
        }

        setState('saving');
        try {
          await save(payload);
          lastSaved = payload;
          setState('saved');
        } catch {
          // Failure: do NOT update lastSaved (payload stays eligible).
          setState('error');
          // No automatic retry of the SAME payload. The while-condition only
          // continues if a NEWER payload arrived during this failed save
          // (pending !== null), which is a newer state worth one attempt.
        }
      }
    } finally {
      inFlight = false;
    }
  }

  return {
    request(payload: string): void {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        enqueue(payload);
      }, debounceMs);
    },
    dispose(): void {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    getState(): SaveQueueState {
      return state;
    },
  };
}
