// Asks again every 30 seconds while a page is open (the server never pushes).

export const POLL_REFRESH_MS = 30_000;

export interface PollingOptions {
  intervalMs?: number;
  /** A page in a background tab is not refreshed. */
  isHidden?: () => boolean;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Calls `refresh` every `intervalMs` (the first time after one interval, not at once) until the returned function
 * is called. The next wait starts when `refresh` has finished, so slow answers never pile up. A hidden page
 * skips the call and waits again.
 */
export function startPolling(refresh: () => Promise<void>, options: PollingOptions = {}): () => void {
  const {
    intervalMs = POLL_REFRESH_MS,
    isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden",
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = options;
  let stopped = false;
  let handle: unknown;

  const schedule = (): void => {
    if (stopped) return;
    handle = setTimer(() => {
      void tick();
    }, intervalMs);
  };

  async function tick(): Promise<void> {
    if (stopped) return;
    if (!isHidden()) {
      try {
        await refresh();
      } catch {
        // A failed refresh must not end the loop.
      }
    }
    schedule();
  }

  schedule();
  return () => {
    stopped = true;
    clearTimer(handle);
  };
}
