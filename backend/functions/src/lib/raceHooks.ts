/**
 * Test-only seams: emulator tests set these to change state in the window
 * between a handler's fast pre-checks and its transaction, proving the
 * transaction re-checks everything that decides the outcome. Always unset in
 * deployed functions.
 */
export const raceHooks: {
  answerBeforeAward?: () => Promise<void>;
  adminBeforeCommit?: () => Promise<void>;
} = {};
