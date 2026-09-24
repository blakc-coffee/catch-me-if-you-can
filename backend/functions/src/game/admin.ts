import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { GAME_DEFAULTS, RATE_LIMITS } from "../config.js";
import { loadActor, read, refs, requireRole, type CallContext } from "../lib/context.js";
import { fail } from "../lib/errors.js";
import { db } from "../lib/firebase.js";
import { consumeRateLimit } from "../lib/rateLimit.js";
import { parseInput, uidSchema } from "../lib/validation.js";
import { COL, type SeekerDoc, type UserDoc } from "../models.js";
import type { EliminatePlayerResponse, SetGameStatusResponse } from "../shared/contract.js";

const statusSchema = z.strictObject({ status: z.enum(["draft", "active", "paused", "ended"]) });
const eliminateSchema = z.strictObject({ uid: uidSchema });

/**
 * ADMIN-only game lifecycle (creates game/state with defaults on first use).
 * Ending the game deactivates every seeker's live telemetry; apps watching
 * game/state stop their background location task when they see "ended".
 */
export async function setGameStatus(ctx: CallContext, raw: unknown): Promise<SetGameStatusResponse> {
  const { status } = parseInput(statusSchema, raw);
  const d = db();
  const actor = await loadActor(d, d, ctx.uid);
  requireRole(actor.role, ["admin"]);
  await consumeRateLimit(d, `admin_${ctx.uid}`, RATE_LIMITS.adminAction);

  await d.runTransaction(async (tx) => {
    const snap = await tx.get(refs.game(d));
    const now = FieldValue.serverTimestamp();
    if (snap.exists) tx.update(snap.ref, { status, updatedAt: now });
    else tx.create(snap.ref, { ...GAME_DEFAULTS, status, lastBroadcastAt: null, updatedAt: now });
  });

  let seekersDeactivated = 0;
  if (status === "ended") {
    const active = await d.collection(COL.seekers).where("active", "==", true).get();
    const writer = d.bulkWriter();
    const now = FieldValue.serverTimestamp();
    for (const s of active.docs) {
      void writer.update(s.ref, { active: false, trackingEnabled: false, status: "offline", updatedAt: now });
    }
    await writer.close();
    seekersDeactivated = active.size;
  }
  return { status, seekersDeactivated };
}

/** SURVEILLANCE/ADMIN: eliminates a player. Idempotent. */
export async function eliminatePlayer(ctx: CallContext, raw: unknown): Promise<EliminatePlayerResponse> {
  const { uid } = parseInput(eliminateSchema, raw);
  const d = db();
  const actor = await loadActor(d, d, ctx.uid);
  requireRole(actor.role, ["surveillance", "admin"]);
  await consumeRateLimit(d, `admin_${ctx.uid}`, RATE_LIMITS.adminAction);

  await d.runTransaction(async (tx) => {
    const user = await read<UserDoc>(tx, refs.user(d, uid));
    if (!user) fail("not-found", "USER_NOT_FOUND", "User has no profile.");
    const seeker = await read<SeekerDoc>(tx, refs.seeker(d, uid));
    if (user.status === "eliminated") return;
    const now = FieldValue.serverTimestamp();
    tx.update(refs.user(d, uid), { status: "eliminated", updatedAt: now });
    if (seeker) tx.update(refs.seeker(d, uid), { active: false, trackingEnabled: false, status: "eliminated", updatedAt: now });
  });
  return { uid, status: "eliminated" };
}
