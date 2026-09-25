// Strings that must never ship in the app: puzzle answers and answer-specific
// clues belong to the server (admin-only `puzzles`), never the bundle.
// Word-bounded so unrelated identifiers (e.g. Hermes' "BDHHermes") don't match.
export const FORBIDDEN = [
  { label: "case-01 answer", pattern: /(?<![A-Za-z])DHH(?![A-Za-z])/i },
  { label: "acceptedAnswer field", pattern: /acceptedAnswer/ },
  { label: "case-01 clue", pattern: /optimizing for programmer happiness/i },
  { label: "case-01 clue", pattern: /Convention over Configuration/i },
  { label: "case-01 clue", pattern: /opinionated Linux distribution/i },
  { label: "case-01 clue", pattern: /commonly referred to by three initials/i },
];

export function findForbidden(text) {
  return FORBIDDEN.filter(({ pattern }) => pattern.test(text)).map(({ label, pattern }) => `${label} (${pattern})`);
}
