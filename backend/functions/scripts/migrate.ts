/**
 * One-off, idempotent migration of an existing seekerdb project to the
 * OpenVerse backend. Additive only — never rewrites existing names, roles,
 * teams or content:
 *   - creates game/state with defaults if missing (status from --game-status),
 *     and adds an eventId to an existing game/state that has none
 *   - backfills users: playerId, status, score, eliminationTokens (and teamId: null) when missing
 *   - mirrors every puzzles/{id} into answer-free puzzlePublic/{id}
 *   - syncs custom claims {role, teamId} from each users doc
 *
 *   npm run migrate -- --project cmiyc-d170c --production --dry-run
 *   npm run migrate -- --project cmiyc-d170c --production
 */
import { parseArgs } from "node:util";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { GAME_DEFAULTS } from "../src/config.js";
import { newEventId } from "../src/game/admin.js";
import { withUserDefaults } from "../src/lib/context.js";
import { COL, GAME_DOC, type PuzzleDoc, type UserDoc } from "../src/models.js";
import { mirrorPuzzle } from "../src/puzzles/mirror.js";
import { ROLES, type Role } from "../src/shared/contract.js";
import { initAdmin } from "./adminApp.js";

const { values: args } = parseArgs({
  options: {
    project: { type: "string" },
    production: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    "game-status": { type: "string", default: "active" },
  },
});
if (args.production && !args.project) {
  console.error("--production requires --project <id>.");
  process.exit(1);
}
const status = args["game-status"];
if (!["draft", "active", "paused", "ended"].includes(status!)) {
  console.error("--game-status must be draft|active|paused|ended");
  process.exit(1);
}
const dry = Boolean(args["dry-run"]);
const projectId = args.project ?? "demo-openverse";
initAdmin({ production: Boolean(args.production), projectId });
const db = getFirestore();
const auth = getAuth();
const log = (msg: string) => console.log(`${dry ? "[dry-run] " : ""}${msg}`);

// game/state
const gameRef = db.collection(COL.game).doc(GAME_DOC);
const gameSnap = await gameRef.get();
if (gameSnap.exists && gameSnap.get("eventId")) {
  log("game/state exists — unchanged");
} else if (gameSnap.exists) {
  const eventId = newEventId();
  log(`game/state exists — add eventId ${eventId}`);
  if (!dry) await gameRef.update({ eventId });
} else {
  log(`create game/state (status ${status})`);
  if (!dry) await gameRef.create({ ...GAME_DEFAULTS, status, eventId: newEventId(), lastBroadcastAt: null, updatedAt: FieldValue.serverTimestamp() });
}

// users
for (const doc of (await db.collection(COL.users).get()).docs) {
  const data = doc.data() as Partial<UserDoc>;
  const filled = withUserDefaults(doc.id, data);
  const patch: Record<string, unknown> = {};
  for (const key of ["playerId", "status", "score", "eliminationTokens"] as const) {
    if (data[key] === undefined) patch[key] = filled[key];
  }
  if (data.teamId === undefined) patch.teamId = null;
  const role: Role | null = (ROLES as readonly unknown[]).includes(data.role) ? (data.role as Role) : null;
  log(`users/${doc.id} (${data.email ?? "no email"}, role ${String(data.role)}): backfill ${Object.keys(patch).join(", ") || "nothing"}`);
  if (!dry && Object.keys(patch).length) await doc.ref.update(patch);

  if (!role) {
    log(`  ! unknown role ${JSON.stringify(data.role)} — claims not changed; fix the doc or use assignUser`);
    continue;
  }
  const record = await auth.getUser(doc.id).catch(() => null);
  if (!record) {
    log("  ! no Auth account with this uid — claims skipped");
    continue;
  }
  const claims = record.customClaims ?? {};
  const teamId = filled.teamId ?? null;
  if (claims.role === role && (claims.teamId ?? null) === teamId) continue;
  log(`  claims ${JSON.stringify({ role: claims.role, teamId: claims.teamId })} → ${JSON.stringify({ role, teamId })}`);
  if (!dry) await auth.setCustomUserClaims(doc.id, { ...claims, role, teamId });
}

// puzzles → puzzlePublic
for (const doc of (await db.collection(COL.puzzles).get()).docs) {
  log(`mirror puzzles/${doc.id} → puzzlePublic/${doc.id} (answer excluded)`);
  if (!dry) await mirrorPuzzle(db, doc.id, doc.data() as Partial<PuzzleDoc>);
}

log("done");
process.exit(0);
