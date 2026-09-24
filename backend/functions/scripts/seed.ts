/**
 * Seeds a game in the seekerdb schema (and, on the emulator, dev accounts).
 *
 *   Emulator (default):  npm run seed
 *   Production:          npm run seed -- --production --project <id> --data <private.json>
 *
 * Production seeding requires an explicit private data file (answers and join
 * codes must not come from the committed example). QR codes are written to
 * seed-output/ (git-ignored) for printing.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { makePlayerId } from "../src/lib/context.js";
import { initAdmin } from "./adminApp.js";
import { seedGame } from "./seedGame.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    production: { type: "boolean", default: false },
    project: { type: "string" },
    data: { type: "string" },
  },
});
if (args.production && (!args.project || !args.data)) {
  console.error("--production requires --project <id> and --data <private seed file>.");
  process.exit(1);
}
const projectId = args.project ?? "demo-openverse";
initAdmin({ production: Boolean(args.production), projectId });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

const dataPath = args.data ? path.resolve(args.data) : path.join(here, "seed-data.example.json");
const data = JSON.parse(readFileSync(dataPath, "utf8"));
const { artifacts } = await seedGame(db, data);

const outDir = path.join(here, "..", "seed-output");
mkdirSync(outDir, { recursive: true });
const csv = [
  "key,name,qrType,puzzleId,qrCode",
  ...artifacts.map((a) => `${a.key},"${a.name}",${a.qrType},${a.puzzleId ?? ""},${a.qrCode}`),
];
const outFile = path.join(outDir, `${projectId}-qr-codes.csv`);
writeFileSync(outFile, csv.join("\n") + "\n");

console.log(`Seeded game on ${args.production ? projectId : `emulator (${projectId})`}.`);
console.log(`QR codes (${artifacts.length}) → ${path.relative(process.cwd(), outFile)}`);
const teams = data.teams as { name: string; joinCode?: string }[];
console.log(`Team codes: ${teams.filter((t) => t.joinCode).map((t) => `${t.name}=${t.joinCode}`).join(", ")}`);

if (!args.production) {
  const DEV_PASSWORD = "openverse-dev";
  const devUsers = [
    { email: "admin@openverse.dev", role: "admin", name: "HQ Admin", teamId: null },
    { email: "surveillance@openverse.dev", role: "surveillance", name: "Overwatch", teamId: null },
    { email: "hider1@openverse.dev", role: "hider", name: "Ghost One", teamId: "ghost" },
    { email: "seeker1@openverse.dev", role: "seeker", name: "Echo Agent", teamId: "alpha" },
    { email: "seeker2@openverse.dev", role: "seeker", name: "Falcon", teamId: "bravo" },
  ] as const;
  const auth = getAuth();
  for (const u of devUsers) {
    const record = await auth
      .getUserByEmail(u.email)
      .catch(() => auth.createUser({ email: u.email, password: DEV_PASSWORD, emailVerified: true }));
    await auth.setCustomUserClaims(record.uid, { role: u.role, teamId: u.teamId });
    const ref = db.collection("users").doc(record.uid);
    const snap = await ref.get();
    const now = FieldValue.serverTimestamp();
    await ref.set(
      {
        name: u.name,
        email: u.email,
        role: u.role,
        teamId: u.teamId,
        playerId: makePlayerId(record.uid),
        status: "active",
        updatedAt: now,
        ...(snap.exists ? {} : { score: 0, eliminationTokens: 0, createdAt: now }),
      },
      { merge: true },
    );
  }
  console.log(`Dev accounts (password "${DEV_PASSWORD}"): ${devUsers.map((u) => `${u.email} [${u.role}${u.teamId ? `/${u.teamId}` : ""}]`).join(", ")}`);
}

process.exit(0);
