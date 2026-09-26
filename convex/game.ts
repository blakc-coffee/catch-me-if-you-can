import { v } from "convex/values";
import { query } from "./_generated/server";
import { getCurrentUser } from "./lib/auth";
import { fail } from "./lib/errors";
import { DEFAULT_EVENT_ID } from "./lib/gameDefaults";
import {
  gameStateSnapshotValidator,
  gameStatusValidator,
  missionPuzzleValidator,
  teamValidator,
} from "./lib/validators";

export const getGameState = query({
  args: {},
  returns: gameStateSnapshotValidator,
  handler: async (ctx) => {
    const game = await ctx.db
      .query("gameState")
      .withIndex("by_key", (q) => q.eq("key", "state"))
      .unique();

    return {
      status: game?.status ?? "active",
      eventId: game?.eventId ?? DEFAULT_EVENT_ID,
      telemetryMinIntervalSec: game?.telemetryMinIntervalSec ?? 10,
    };
  },
});

export const getMissionState = query({
  args: {},
  returns: v.object({
    eventId: v.string(),
    gameStatus: gameStatusValidator,
    team: teamValidator,
    totalArtifacts: v.number(),
    puzzles: v.array(missionPuzzleValidator),
  }),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user.role !== "seeker" && user.role !== "hider") {
      fail("ROLE_NOT_ALLOWED", "Only seekers and hiders can view mission state.");
    }
    if (!user.teamExternalId) fail("NO_TEAM", "You are not on a team yet.");

    const teamExternalId = user.teamExternalId;
    const game = await ctx.db
      .query("gameState")
      .withIndex("by_key", (q) => q.eq("key", "state"))
      .unique();

    const team = await ctx.db
      .query("teams")
      .withIndex("by_external_id", (q) => q.eq("externalId", teamExternalId))
      .unique();

    const activeArtifacts = await ctx.db
      .query("artifacts")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();
    const totalArtifacts = activeArtifacts.filter((a) => a.qrType === "correct").length || 15;

    const puzzles = [];
    if (user.role === "seeker") {
      const unlocks = await ctx.db
        .query("puzzleUnlocks")
        .withIndex("by_team", (q) => q.eq("teamExternalId", teamExternalId))
        .collect();
      unlocks.sort((a, b) => a.unlockedAtMs - b.unlockedAtMs);

      for (const unlock of unlocks) {
        const pub = await ctx.db
          .query("puzzlePublic")
          .withIndex("by_external_id", (q) => q.eq("externalId", unlock.puzzleExternalId))
          .unique();
        if (!pub || !pub.audience.includes("seeker")) continue;

        const claim = await ctx.db
          .query("puzzleClaims")
          .withIndex("by_puzzle", (q) => q.eq("puzzleExternalId", unlock.puzzleExternalId))
          .unique();

        puzzles.push({
          puzzleId: unlock.puzzleExternalId,
          title: pub.title,
          question: pub.question,
          unlockedAtMs: unlock.unlockedAtMs,
          solved: pub.isSolved,
          solvedByYourTeam: pub.isSolved && pub.solvedBy?.teamExternalId === teamExternalId,
        });
      }
    } else {
      const hiderPuzzles = await ctx.db.query("puzzlePublic").collect();
      for (const pub of hiderPuzzles.filter((p) => p.audience.includes("hider"))) {
        puzzles.push({
          puzzleId: pub.externalId,
          title: pub.title,
          question: pub.question,
          unlockedAtMs: null,
          solved: pub.isSolved,
          solvedByYourTeam: pub.isSolved && pub.solvedBy?.teamExternalId === teamExternalId,
        });
      }
      puzzles.sort((a, b) => a.puzzleId.localeCompare(b.puzzleId));
    }

    return {
      eventId: game?.eventId ?? DEFAULT_EVENT_ID,
      gameStatus: game?.status ?? "active",
      team: {
        teamId: teamExternalId,
        name: team?.name ?? "Team Alpha",
        type: team?.type ?? "seeker",
        score: team?.score ?? 0,
        tokens: team?.tokens ?? 0,
        artifactsClaimed: team?.artifactsClaimed ?? 0,
        puzzlesSolved: team?.puzzlesSolved ?? 0,
      },
      totalArtifacts,
      puzzles,
    };
  },
});
