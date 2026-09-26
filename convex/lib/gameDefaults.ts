import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export const DEFAULT_EVENT_ID = "default";

const DEFAULT_GAME = {
  status: "active" as const,
  eventId: DEFAULT_EVENT_ID,
  telemetryMinIntervalSec: 10,
  broadcastCooldownSec: 600,
  staleAfterSec: 120,
  locationRetentionDays: 7,
  lastBroadcastAtMs: null as number | null,
};

export async function ensureGameState(ctx: MutationCtx): Promise<Doc<"gameState">> {
  const existing = await ctx.db
    .query("gameState")
    .withIndex("by_key", (q) => q.eq("key", "state"))
    .unique();
  if (existing) return existing;

  const now = Date.now();
  const id = await ctx.db.insert("gameState", {
    key: "state",
    ...DEFAULT_GAME,
    updatedAt: now,
  });
  const created = await ctx.db.get("gameState", id);
  if (!created) throw new Error("Failed to create game state");
  return created;
}

export async function ensureTeam(
  ctx: MutationCtx,
  externalId: string,
  name?: string,
): Promise<Doc<"teams">> {
  const existing = await ctx.db
    .query("teams")
    .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
    .unique();
  if (existing) return existing;

  const now = Date.now();
  const id = await ctx.db.insert("teams", {
    externalId,
    name: name ?? (externalId === "bravo" ? "Team Bravo" : "Team Alpha"),
    type: "seeker",
    score: 0,
    tokens: 0,
    artifactsClaimed: 0,
    puzzlesSolved: 0,
    createdAt: now,
    updatedAt: now,
  });
  const created = await ctx.db.get("teams", id);
  if (!created) throw new Error("Failed to create team");
  return created;
}
