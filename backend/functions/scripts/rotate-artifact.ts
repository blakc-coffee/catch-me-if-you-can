/**
 * Rotates one artifact's shared QR code: the old code stops working for every
 * team, the new one works for every team that has not claimed the artifact.
 * The new code is written to seed-output/ (git-ignored) for reprinting.
 *
 *   Emulator:    npm run rotate-artifact -- --artifact <currentQrCode>
 *   Production:  npm run rotate-artifact -- --artifact <currentQrCode> --production --project <id>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getFirestore } from "firebase-admin/firestore";
import { initAdmin } from "./adminApp.js";
import { rotateArtifactCode } from "./seedGame.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    artifact: { type: "string" },
    production: { type: "boolean", default: false },
    project: { type: "string" },
  },
});
if (!args.artifact || (args.production && !args.project)) {
  console.error("Usage: --artifact <currentQrCode> [--production --project <id>]");
  process.exit(1);
}
const projectId = args.project ?? "demo-openverse";
initAdmin({ production: Boolean(args.production), projectId });

const { oldCode, newCode } = await rotateArtifactCode(getFirestore(), args.artifact);
const outDir = path.join(here, "..", "seed-output");
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${projectId}-rotated-${Date.now()}.csv`);
writeFileSync(outFile, `oldQrCode,newQrCode\n${oldCode},${newCode}\n`, { mode: 0o600 });
console.log(`Rotated ${oldCode}: the old code is deactivated. New code → ${path.relative(process.cwd(), outFile)}`);
process.exit(0);
