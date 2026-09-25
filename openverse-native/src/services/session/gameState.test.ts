import { describe, expect, it } from "vitest";
import { caseHeader } from "./caseView";
import { applyClaim, initialGameState, listPuzzles, markSolved, mergeMissionPuzzles, normalizeGameState, selectPuzzle } from "./gameState";
import { ScopedStore } from "./localStore";
import { createScope } from "./scope";
import { MemoryKV } from "./testSupport";

const p1 = { puzzleId: "case-01", title: "First case", question: "Q1" };
const p2 = { puzzleId: "case-02", title: "Second case", question: "Q2" };

function twoUnlocks() {
  let s = applyClaim(initialGameState, { artifactId: "art-a", payload: "QR-A", puzzle: p1 }, 1000);
  s = applyClaim(s, { artifactId: "art-b", payload: "QR-B", puzzle: p2 }, 2000);
  return s;
}

describe("multiple unlocked puzzles", () => {
  it("keeps older puzzles when a newer one unlocks and opens the newest", () => {
    const s = twoUnlocks();
    expect(listPuzzles(s).map((p) => p.puzzleId)).toEqual(["case-01", "case-02"]);
    expect(s.activePuzzleId).toBe("case-02");
    expect(s.claimedArtifactIds).toEqual(["art-a", "art-b"]);
  });

  it("lets the seeker reopen an older puzzle, and ignores unknown ids", () => {
    const s = selectPuzzle(twoUnlocks(), "case-01");
    expect(s.activePuzzleId).toBe("case-01");
    expect(selectPuzzle(s, "not-unlocked").activePuzzleId).toBe("case-01");
    expect(selectPuzzle(s, null).activePuzzleId).toBeNull();
  });

  it("an artifact without a puzzle does not change the open case", () => {
    const s = applyClaim(twoUnlocks(), { artifactId: "art-c", payload: "QR-C", puzzle: null }, 3000);
    expect(s.activePuzzleId).toBe("case-02");
    expect(Object.keys(s.puzzles)).toHaveLength(2);
  });

  it("re-unlocking keeps the original unlock time", () => {
    const s = applyClaim(twoUnlocks(), { artifactId: "art-a", payload: "QR-A", puzzle: p1 }, 9999);
    expect(s.puzzles["case-01"]!.unlockedAtMs).toBe(1000);
  });

  it("tracks solves per puzzle", () => {
    let s = markSolved(twoUnlocks(), "case-01", true);
    s = markSolved(s, "case-02", false);
    expect(s.puzzles["case-01"]).toMatchObject({ solved: true, solvedByYourTeam: true });
    expect(s.puzzles["case-02"]).toMatchObject({ solved: true, solvedByYourTeam: false });
  });

  it("merges the server list as the authority for text and solve state, keeping local-only entries", () => {
    const s = mergeMissionPuzzles(twoUnlocks(), [
      { ...p1, title: "Renamed", unlockedAtMs: 500, solved: true, solvedByYourTeam: false },
      { puzzleId: "case-03", title: "Third", question: "Q3", unlockedAtMs: 3000, solved: false, solvedByYourTeam: false },
    ]);
    expect(listPuzzles(s).map((p) => [p.puzzleId, p.title, p.solved])).toEqual([
      ["case-01", "Renamed", true],
      ["case-02", "Second case", false],
      ["case-03", "Third", false],
    ]);
  });

  it("persists every unlocked puzzle and the open one across an app restart", async () => {
    const kv = new MemoryKV();
    const scope = createScope("uidA", "event-1");
    await new ScopedStore(kv).saveGameState(scope, selectPuzzle(twoUnlocks(), "case-01"));
    const restored = await new ScopedStore(kv).loadGameState(scope);
    expect(listPuzzles(restored).map((p) => p.puzzleId)).toEqual(["case-01", "case-02"]);
    expect(restored.activePuzzleId).toBe("case-01");
  });

  it("upgrades the previous single-puzzle shape without losing the unlocked case", () => {
    const upgraded = normalizeGameState({
      claimedArtifactIds: ["art-a"],
      solvedPuzzleIds: ["case-01"],
      lastScannedPayload: "QR-A",
      activePuzzle: p1,
      teamArtifactsClaimed: 11,
    });
    expect(upgraded.puzzles["case-01"]).toMatchObject({ title: "First case", solved: true, solvedByYourTeam: true });
    expect(upgraded.activePuzzleId).toBe("case-01");
    expect(upgraded).not.toHaveProperty("teamArtifactsClaimed");
  });

  it("drops malformed stored entries", () => {
    const s = normalizeGameState({ puzzles: { x: { puzzleId: 1 }, ok: { ...p2 } }, activePuzzleId: "x" });
    expect(Object.keys(s.puzzles)).toEqual(["case-02"]);
    expect(s.activePuzzleId).toBeNull();
    expect(normalizeGameState("garbage")).toEqual(initialGameState);
  });
});

describe("case header", () => {
  it("names the active puzzle and its real position instead of a fixed CASE 01", () => {
    const list = listPuzzles(twoUnlocks());
    expect(caseHeader(list, "case-02")).toEqual({ title: "SEEKER / CASE-02", position: "CASE 02 / 02" });
    expect(caseHeader(list, "case-01")).toEqual({ title: "SEEKER / CASE-01", position: "CASE 01 / 02" });
    expect(caseHeader(list, null)).toEqual({ title: "SEEKER / CASE FILES", position: "2 UNLOCKED" });
    expect(caseHeader([], null).position).toBe("0 UNLOCKED");
  });
});
