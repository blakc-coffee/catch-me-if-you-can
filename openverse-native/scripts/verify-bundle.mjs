// Builds the production Android bundle (emulators off) and fails if any
// forbidden answer/clue string is inside it.
//
//   npm run verify:bundle                 # export to a temp dir, then scan
//   npm run verify:bundle -- --dir <out>  # scan an existing `expo export` output
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findForbidden } from "./forbidden-strings.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dirArg = process.argv.indexOf("--dir");
let outDir = dirArg > 0 ? path.resolve(process.argv[dirArg + 1]) : null;
const temporary = !outDir;

if (!outDir) {
  outDir = mkdtempSync(path.join(tmpdir(), "openverse-bundle-"));
  const result = spawnSync("npx", ["expo", "export", "--platform", "android", "--output-dir", outDir], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, NODE_ENV: "production", EXPO_PUBLIC_USE_FIREBASE_EMULATORS: "false" },
  });
  if (result.status !== 0) {
    console.error("expo export failed");
    process.exit(result.status ?? 1);
  }
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else yield full;
  }
}

let scanned = 0;
const problems = [];
for (const file of files(outDir)) {
  if (!/\.(hbc|js|json|map)$/.test(file)) continue;
  scanned += 1;
  // latin1 keeps every byte, so strings inside Hermes bytecode are searchable.
  for (const hit of findForbidden(readFileSync(file).toString("latin1"))) problems.push(`${path.relative(outDir, file)}: ${hit}`);
}
if (temporary) rmSync(outDir, { recursive: true, force: true });

if (scanned === 0) {
  console.error("No bundle files found to scan.");
  process.exit(1);
}
if (problems.length > 0) {
  console.error(`Forbidden strings found in the production bundle:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`Bundle clean: ${scanned} file(s) scanned, no puzzle answers or answer clues.`);
