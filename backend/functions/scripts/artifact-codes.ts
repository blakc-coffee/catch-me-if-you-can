/**
 * Issues per-team artifact QR codes for artifacts that already exist (e.g. the
 * seekerdb artifacts created before per-team codes). Every active artifact —
 * real and decoy — gets one code per seeker team; pairs that already have an
 * active code keep it. New codes are written to seed-output/ (git-ignored);
 * Firestore stores only their hashes, so that file is the only copy.
 *
 *   Emulator:    npm run artifact-codes
 *   Production:  npm run artifact-codes -- --production --project <id> --dry-run
 *                npm run artifact-codes -- --production --project <id> [--rotate]
 *
 * --rotate deactivates every existing code and issues new ones (reprint all).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getFirestore } from "firebase-admin/firestore";
import { COL } from "../src/models.js";
import { initAdmin } from "./adminApp.js";
import { provisionArtifactCodes } from "./seedGame.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    production: { type: "boolean", default: false },
    project: { type: "string" },
    rotate: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});
if (args.production && !args.project) {
  console.error("--production requires --project <id>.");
  process.exit(1);
}
const projectId = args.project ?? "demo-openverse";
const dryRun = Boolean(args["dry-run"]);
initAdmin({ production: Boolean(args.production), projectId });
const db = getFirestore();

const artifacts = (await db.collection(COL.artifacts).where("isActive", "==", true).get()).docs;
const teams = (await db.collection(COL.teams).where("type", "==", "seeker").get()).docs.map((d) => d.id);
const { issued, kept, deactivated } = await provisionArtifactCodes(
  db,
  artifacts.map((a) => a.id),
  teams,
  { rotate: Boolean(args.rotate), dryRun },
);

const prefix = dryRun ? "[dry-run] " : "";
console.log(`${prefix}${artifacts.length} active artifacts × ${teams.length} seeker teams: ${issued.length} new, ${kept} kept, ${deactivated} deactivated.`);
if (!dryRun && issued.length > 0) {
  const byId = new Map(artifacts.map((a) => [a.id, a.data()]));
  const rows = issued.map((c) => {
    const a = byId.get(c.artifactId) ?? {};
    return `${c.artifactId},"${String(a.name ?? "")}",${String(a.qrType ?? "")},${c.teamId},${c.code}`;
  });
  const outDir = path.join(here, "..", "seed-output");
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${projectId}-artifact-codes-${Date.now()}.csv`);
  writeFileSync(outFile, ["artifactId,name,qrType,teamId,code", ...rows].join("\n") + "\n", { mode: 0o600 });
  console.log(`Codes → ${path.relative(process.cwd(), outFile)} (print, then store offline; this is the only copy)`);
}
process.exit(0);
