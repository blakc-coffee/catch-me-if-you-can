// Copies the callable contract into client apps so request/response types and
// error reasons stay identical. A unit test fails if the copies drift.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = path.join(root, "backend", "functions", "src", "shared", "contract.ts");
export const HEADER =
  "// GENERATED — copy of backend/functions/src/shared/contract.ts. Do not edit here;\n" +
  "// run `npm run sync:contract` in backend/ after changing the backend contract.\n\n";
const targets = [path.join(root, "openverse-native", "src", "services", "firebase", "contract.ts")];

const body = readFileSync(source, "utf8").replace(/\r\n/g, "\n");
for (const target of targets) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, HEADER + body);
  console.log(`synced ${path.relative(root, target)}`);
}
