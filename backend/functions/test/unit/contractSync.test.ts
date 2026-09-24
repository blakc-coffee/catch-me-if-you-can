import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..", "..");
const source = path.join(root, "backend", "functions", "src", "shared", "contract.ts");
const nativeCopy = path.join(root, "openverse-native", "src", "services", "firebase", "contract.ts");
const lf = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("client contract copy", () => {
  it("openverse-native matches the backend contract (run `npm run sync:contract`)", () => {
    const copy = lf(nativeCopy);
    expect(copy.slice(copy.indexOf("/**"))).toBe(lf(source).slice(lf(source).indexOf("/**")));
  });
});
