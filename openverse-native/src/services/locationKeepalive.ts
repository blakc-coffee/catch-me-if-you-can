/** Foreground fixes are expected about every 5s; allow a few misses before rebuilding the watcher. */
export const LOCATION_SAMPLE_STALE_MS = 45_000;

/**
 * Android drops an in-flight location watcher when a permission dialog pauses
 * the activity, but the JS subscription object can stay non-null. Treat a
 * missing subscription, or silence longer than `staleMs`, as "not actually tracking".
 */
export function watcherNeedsRestart(input: {
  hasSubscription: boolean;
  lastSampleAtMs: number;
  nowMs: number;
  staleMs?: number;
}): boolean {
  if (!input.hasSubscription) return true;
  return input.nowMs - input.lastSampleAtMs > (input.staleMs ?? LOCATION_SAMPLE_STALE_MS);
}
