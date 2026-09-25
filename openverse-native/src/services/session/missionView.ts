import type { GetMissionStateResponse } from "../firebase/contract";
import type { GameState } from "../../types";
import { listPuzzles } from "./gameState";

/** What the mission screen can show. Progress numbers only ever come from the server. */
export type MissionSummary =
  | { status: "loading" }
  | { status: "no-team" }
  | { status: "error" }
  | {
      status: "ready";
      eventId: string;
      teamName: string;
      claimed: number;
      total: number;
      score: number;
      tokens: number;
      unlocked: number;
      solved: number;
      objective: Objective;
    };

export type Objective =
  | { kind: "solve"; puzzleId: string; title: string }
  | { kind: "scan" }
  | { kind: "complete" }
  | { kind: "waiting"; gameStatus: string };

export type MissionLoad =
  | { status: "loading" }
  | { status: "no-team" }
  | { status: "error" }
  | { status: "ready"; data: GetMissionStateResponse };

/**
 * The backend has no objective documents, so the objective is derived from
 * real state: an open (unsolved) case file first, otherwise scan the next
 * artifact, otherwise done.
 */
export function deriveObjective(mission: GetMissionStateResponse, game: GameState): Objective {
  if (mission.gameStatus !== "active") return { kind: "waiting", gameStatus: mission.gameStatus };
  const open = listPuzzles(game).find((p) => !p.solved);
  if (open) return { kind: "solve", puzzleId: open.puzzleId, title: open.title };
  if (mission.totalArtifacts > 0 && mission.team.artifactsClaimed >= mission.totalArtifacts) return { kind: "complete" };
  return { kind: "scan" };
}

export function summarizeMission(load: MissionLoad, game: GameState): MissionSummary {
  if (load.status !== "ready") return load;
  const m = load.data;
  const puzzles = listPuzzles(game);
  return {
    status: "ready",
    eventId: m.eventId,
    teamName: m.team.name,
    claimed: m.team.artifactsClaimed,
    total: m.totalArtifacts,
    score: m.team.score,
    tokens: m.team.tokens,
    unlocked: puzzles.length,
    solved: puzzles.filter((p) => p.solvedByYourTeam).length,
    objective: deriveObjective(m, game),
  };
}
