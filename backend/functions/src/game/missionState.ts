import { z } from "zod";
import { RATE_LIMITS } from "../config.js";
import { countRealArtifacts } from "../artifacts/claimArtifact.js";
import { loadActor, loadGame, loadTeam, requireRole, type CallContext } from "../lib/context.js";
import { fail } from "../lib/errors.js";
import { db } from "../lib/firebase.js";
import { consumeRateLimit } from "../lib/rateLimit.js";
import { parseInput } from "../lib/validation.js";
import { COL, type PuzzlePublicDoc, type PuzzleUnlockDoc } from "../models.js";
import { DEFAULT_EVENT_ID, type GetMissionStateResponse, type MissionPuzzleDTO } from "../shared/contract.js";
import { toTeamDTO } from "../teams/joinTeam.js";

function toMissionPuzzle(puzzleId: string, pub: PuzzlePublicDoc, teamId: string, unlockedAtMs: number | null): MissionPuzzleDTO {
  return {
    puzzleId,
    title: pub.title,
    question: pub.question,
    unlockedAtMs,
    solved: pub.isSolved === true,
    solvedByYourTeam: pub.isSolved === true && pub.solvedBy?.teamId === teamId,
  };
}

/**
 * Read-only mission snapshot for the caller's team. Seekers see the puzzles
 * their team unlocked by claiming artifacts; hiders see puzzles addressed to
 * hiders. Built from answer-free puzzlePublic mirrors only.
 */
export async function getMissionState(ctx: CallContext, raw: unknown): Promise<GetMissionStateResponse> {
  parseInput(z.strictObject({}), raw ?? {});
  const d = db();
  const user = await loadActor(d, d, ctx.uid);
  requireRole(user.role, ["seeker", "hider"]);
  if (!user.teamId) fail("failed-precondition", "NO_TEAM", "You are not on a team yet.");
  const teamId = user.teamId;
  await consumeRateLimit(d, `mission_${ctx.uid}`, RATE_LIMITS.missionState);

  const [game, team, totalArtifacts] = await Promise.all([loadGame(d, d), loadTeam(d, d, teamId), countRealArtifacts()]);

  let puzzles: MissionPuzzleDTO[];
  if (user.role === "seeker") {
    const unlocks = (await d.collection(COL.puzzleUnlocks).where("teamId", "==", teamId).get()).docs
      .map((doc) => doc.data() as PuzzleUnlockDoc)
      .sort((a, b) => (a.unlockedAt?.toMillis() ?? 0) - (b.unlockedAt?.toMillis() ?? 0));
    const refs = unlocks.map((u) => d.collection(COL.puzzlePublic).doc(u.puzzleId));
    const snaps = refs.length > 0 ? await d.getAll(...refs) : [];
    puzzles = snaps.flatMap((snap, i) => {
      const pub = snap.data() as PuzzlePublicDoc | undefined;
      if (!pub || !(pub.audience ?? ["seeker"]).includes("seeker")) return [];
      return [toMissionPuzzle(snap.id, pub, teamId, unlocks[i]!.unlockedAt?.toMillis() ?? null)];
    });
  } else {
    const snaps = await d.collection(COL.puzzlePublic).where("audience", "array-contains", "hider").get();
    puzzles = snaps.docs
      .map((snap) => toMissionPuzzle(snap.id, snap.data() as PuzzlePublicDoc, teamId, null))
      .sort((a, b) => a.puzzleId.localeCompare(b.puzzleId));
  }

  return {
    eventId: game?.eventId ?? DEFAULT_EVENT_ID,
    gameStatus: game?.status ?? "draft",
    team: toTeamDTO(teamId, team),
    totalArtifacts,
    puzzles,
  };
}
