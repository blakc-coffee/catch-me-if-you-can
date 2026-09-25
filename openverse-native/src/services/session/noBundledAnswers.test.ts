import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findForbidden } from "../../../scripts/forbidden-strings.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* sources(full);
    else if (/\.(ts|tsx|js|json)$/.test(name) && !/\.test\.ts$|testSupport\.ts$/.test(name)) yield full;
  }
}

// The production-bundle check (npm run verify:bundle) builds and scans the
// real Android export; this is the fast source-level guard for every test run.
describe("no puzzle answers in the app", () => {
  it("app sources contain no answer or answer-specific clue", () => {
    const files = [...sources(path.join(root, "src")), path.join(root, "App.tsx"), path.join(root, "index.ts"), path.join(root, "app.json")];
    const hits = files.flatMap((f) => (findForbidden(readFileSync(f, "utf8")) as string[]).map((h) => `${path.relative(root, f)}: ${h}`));
    expect(hits).toEqual([]);
  });

  it("the detector catches the removed answer and clues", () => {
    expect(findForbidden('acceptedAnswer: "DHH"')).toHaveLength(2);
    expect(findForbidden("His framework became known for Convention over Configuration.")).toHaveLength(1);
    expect(findForbidden("BDHHermesInternal")).toEqual([]);
  });
});
