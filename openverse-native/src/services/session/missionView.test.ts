import { describe, expect, it } from "vitest";
import type { GetMissionStateResponse } from "../firebase/contract";
import { applyClaim, initialGameState, markSolved } from "./gameState";
import { summarizeMission } from "./missionView";

function mission(over: Partial<GetMissionStateResponse> = {}, team: Partial<GetMissionStateResponse["team"]> = {}): GetMissionStateResponse {
  return {
    eventId: "event-1",
    gameStatus: "active",
    totalArtifacts: 15,
    puzzles: [],
    ...over,
    team: { teamId: "alpha", name: "Team Alpha", type: "seeker", score: 0, tokens: 0, artifactsClaimed: 0, puzzlesSolved: 0, ...team },
  };
}

describe("mission summary", () => {
  it("shows real zero progress for a new account, never a starting offset", () => {
    expect(summarizeMission({ status: "ready", data: mission() }, initialGameState)).toEqual({
      status: "ready",
      eventId: "event-1",
      teamName: "Team Alpha",
      claimed: 0,
      total: 15,
      score: 0,
      tokens: 0,
      unlocked: 0,
      solved: 0,
      objective: { kind: "scan" },
    });
  });

  it("shows no numbers at all until the server has answered", () => {
    expect(summarizeMission({ status: "loading" }, initialGameState)).toEqual({ status: "loading" });
    expect(summarizeMission({ status: "no-team" }, initialGameState)).toEqual({ status: "no-team" });
    expect(summarizeMission({ status: "error" }, initialGameState)).toEqual({ status: "error" });
  });

  it("uses the server's team counts and total", () => {
    const s = summarizeMission({ status: "ready", data: mission({ totalArtifacts: 12 }, { artifactsClaimed: 3, score: 175, tokens: 2 }) }, initialGameState);
    expect(s).toMatchObject({ claimed: 3, total: 12, score: 175, tokens: 2 });
  });

  it("derives the objective from real state: open case, then scan, then complete", () => {
    const unlocked = applyClaim(initialGameState, { artifactId: "a", payload: "QR-A", puzzle: { puzzleId: "case-01", title: "The Programmer", question: "?" } }, 1);
    expect(summarizeMission({ status: "ready", data: mission() }, unlocked)).toMatchObject({
      objective: { kind: "solve", puzzleId: "case-01", title: "The Programmer" },
      unlocked: 1,
      solved: 0,
    });
    const solved = markSolved(unlocked, "case-01", true);
    expect(summarizeMission({ status: "ready", data: mission() }, solved)).toMatchObject({ objective: { kind: "scan" }, solved: 1 });
    expect(summarizeMission({ status: "ready", data: mission({ totalArtifacts: 2 }, { artifactsClaimed: 2 }) }, solved)).toMatchObject({ objective: { kind: "complete" } });
  });

  it("reports a paused or ended game instead of an objective", () => {
    expect(summarizeMission({ status: "ready", data: mission({ gameStatus: "paused" }) }, initialGameState)).toMatchObject({ objective: { kind: "waiting", gameStatus: "paused" } });
  });
});
