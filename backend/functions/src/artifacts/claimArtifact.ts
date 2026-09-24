import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { CONTENT_DEFAULTS, RATE_LIMITS } from "../config.js";
import { loadActor, loadGame, loadTeam, refs, requireGameActive, requirePlayer, type CallContext } from "../lib/context.js";
import { fail } from "../lib/errors.js";
import { db } from "../lib/firebase.js";
import { QR_PAYLOAD_PATTERN, artifactKey } from "../lib/normalize.js";
import { consumeRateLimit } from "../lib/rateLimit.js";
import { parseInput } from "../lib/validation.js";
import { COL, docIds, type ArtifactClaimDoc, type ArtifactDoc, type PuzzleDoc } from "../models.js";
import type { ClaimArtifactResponse, PuzzleDTO } from "../shared/contract.js";

const schema = z.strictObject({ payload: z.string().min(1).max(512) });

function invalidCode(): never {
  fail("not-found", "INVALID_ARTIFACT_CODE", "This QR code is not a valid artifact.");
}

/** Number of real (qrType "correct"), active artifacts in the game. */
export async function countRealArtifacts(): Promise<number> {
  const snap = await db()
    .collection(COL.artifacts)
    .where("qrType", "==", "correct")
    .where("isActive", "==", true)
    .count()
    .get();
  return snap.data().count;
}

/**
 * Validates a scanned QR payload server-side against artifacts/{qrCode} and
 * claims it for the caller's team. Decoys (qrType "wrong") return DECOY with
 * the organiser's redirectUrl and award nothing. A deterministic per-team claim
 * id plus a transactional create() makes duplicate claims fail with
 * ARTIFACT_ALREADY_CLAIMED; the claim, puzzle unlock, team counters and the
 * player's score commit atomically.
 */
export async function claimArtifact(ctx: CallContext, raw: unknown): Promise<ClaimArtifactResponse> {
  const { payload } = parseInput(schema, raw);
  const d = db();
  await consumeRateLimit(d, `artifact_${ctx.uid}`, RATE_LIMITS.claimArtifact);
  const qrCode = payload.trim();
  if (!QR_PAYLOAD_PATTERN.test(qrCode)) invalidCode();

  const artifactRef = d.collection(COL.artifacts).doc(qrCode);
  const totalArtifacts = await countRealArtifacts();

  return d.runTransaction(async (tx): Promise<ClaimArtifactResponse> => {
    const user = requirePlayer(await loadActor(d, tx, ctx.uid), ["seeker"]);
    requireGameActive(await loadGame(d, tx));
    const artifactSnap = await tx.get(artifactRef);
    const artifact = artifactSnap.data() as ArtifactDoc | undefined;
    if (!artifact || artifact.isActive !== true) invalidCode();

    if (artifact.qrType === "wrong") {
      return { status: "DECOY", artifactId: artifactSnap.id, name: artifact.name, redirectUrl: artifact.redirectUrl ?? null };
    }
    if (artifact.qrType !== "correct") invalidCode();

    const team = await loadTeam(d, tx, user.teamId);
    const claimRef = d.collection(COL.artifactClaims).doc(docIds.artifactClaim(user.teamId, artifactKey(artifactSnap.id)));
    const puzzleId = artifact.puzzleId ?? null;
    const unlockRef = puzzleId ? d.collection(COL.puzzleUnlocks).doc(docIds.puzzleUnlock(user.teamId, puzzleId)) : null;
    const [claimSnap, unlockSnap, puzzleSnap] = await Promise.all([
      tx.get(claimRef),
      unlockRef ? tx.get(unlockRef) : Promise.resolve(null),
      puzzleId ? tx.get(d.collection(COL.puzzles).doc(puzzleId)) : Promise.resolve(null),
    ]);

    if (claimSnap.exists) {
      fail("already-exists", "ARTIFACT_ALREADY_CLAIMED", "Your team already claimed this artifact.", {
        artifactId: artifactSnap.id,
        puzzleId,
      });
    }

    const points = typeof artifact.points === "number" ? artifact.points : CONTENT_DEFAULTS.artifactPoints;
    const now = FieldValue.serverTimestamp();
    const claim: Omit<ArtifactClaimDoc, "claimedAt"> = {
      teamId: user.teamId,
      artifactId: artifactSnap.id,
      puzzleId,
      claimedBy: ctx.uid,
      playerId: user.playerId,
      points,
    };
    tx.create(claimRef, { ...claim, claimedAt: now });
    if (unlockRef && unlockSnap && !unlockSnap.exists) {
      tx.create(unlockRef, { teamId: user.teamId, puzzleId, artifactId: artifactSnap.id, unlockedAt: now });
    }
    tx.update(refs.team(d, user.teamId), {
      artifactsClaimed: FieldValue.increment(1),
      score: FieldValue.increment(points),
      updatedAt: now,
    });
    tx.update(refs.user(d, ctx.uid), { score: FieldValue.increment(points), updatedAt: now });

    const puzzleDoc = puzzleSnap?.data() as PuzzleDoc | undefined;
    const puzzle: PuzzleDTO | null =
      puzzleId && puzzleDoc ? { puzzleId, title: puzzleDoc.title, question: puzzleDoc.question } : null;
    return {
      status: "CLAIMED",
      artifactId: artifactSnap.id,
      name: artifact.name,
      points,
      teamArtifactsClaimed: (team.artifactsClaimed ?? 0) + 1,
      totalArtifacts,
      puzzle,
    };
  });
}
