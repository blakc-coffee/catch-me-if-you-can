import { FieldValue, type Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { LIMITS } from "../config.js";
import { loadActor, refs, requireGameActive, requireRole, type CallContext } from "../lib/context.js";
import { randomToken } from "../lib/crypto.js";
import { fail } from "../lib/errors.js";
import { db } from "../lib/firebase.js";
import { parseInput } from "../lib/validation.js";
import { COL, type BroadcastDoc, type BroadcastPosition, type GameDoc, type SeekerDoc } from "../models.js";
import type { CreateBroadcastResponse } from "../shared/contract.js";

/**
 * SURVEILLANCE/ADMIN: publishes a snapshot of live seeker positions to hiders.
 * Positions come from the current seekers/* documents read inside the same
 * transaction that enforces the game's broadcast cooldown, so clients can
 * neither fabricate positions nor bypass the interval.
 */
export async function createBroadcast(ctx: CallContext, raw: unknown): Promise<CreateBroadcastResponse> {
  parseInput(z.strictObject({}), raw ?? {});
  const d = db();
  const actor = await loadActor(d, d, ctx.uid);
  requireRole(actor.role, ["surveillance", "admin"]);

  const gameRef = refs.game(d);
  const seekersQuery = d.collection(COL.seekers).where("active", "==", true).limit(1000);

  return d.runTransaction(async (tx) => {
    const nowMs = Date.now();
    const game = requireGameActive((await tx.get(gameRef)).data() as GameDoc | undefined);

    const cooldownMs = game.broadcastCooldownSec * 1000;
    const last = game.lastBroadcastAt?.toMillis() ?? 0;
    if (last && nowMs - last < cooldownMs) {
      fail("resource-exhausted", "BROADCAST_COOLDOWN", "Broadcast cooldown active.", { retryAfterMs: last + cooldownMs - nowMs });
    }

    const staleBefore = nowMs - game.staleAfterSec * 1000;
    const positions: BroadcastPosition[] = [];
    for (const s of (await tx.get(seekersQuery)).docs) {
      const seeker = s.data() as SeekerDoc;
      const pingMs = (seeker.lastPing as Timestamp | null)?.toMillis() ?? 0;
      if (pingMs < staleBefore || seeker.x === null || seeker.y === null) continue;
      positions.push({
        playerId: seeker.playerId,
        name: seeker.name,
        teamId: seeker.teamId,
        zoneId: seeker.zoneId,
        zoneName: seeker.zoneName,
        x: seeker.x,
        y: seeker.y,
        lastPingMs: pingMs,
      });
    }
    positions.sort((a, b) => a.playerId.localeCompare(b.playerId));

    const broadcastId = `bc-${nowMs}-${randomToken(4)}`;
    const doc: Omit<BroadcastDoc, "createdAt"> = {
      serverEpochMs: nowMs,
      operatorUid: ctx.uid,
      operator: actor.playerId,
      totalActiveSeekers: positions.length,
      seekerPositions: positions.slice(0, LIMITS.maxBroadcastPositions),
    };
    const now = FieldValue.serverTimestamp();
    tx.create(d.collection(COL.broadcasts).doc(broadcastId), { ...doc, createdAt: now });
    tx.update(gameRef, { lastBroadcastAt: now, updatedAt: now });

    return { broadcastId, totalActiveSeekers: positions.length, nextBroadcastAtMs: nowMs + cooldownMs };
  });
}
