import { describe, expect, it } from "vitest";
import { ScopedStore, type CachedSession } from "./localStore";
import { ACTIVE_SCOPE_KEY, LEGACY_KEYS, createScope, scopedKeys } from "./scope";
import { MemoryKV, sample } from "./testSupport";

const A1 = createScope("uidA", "event-1");
const A2 = createScope("uidA", "event-2");
const B1 = createScope("uidB", "event-1");
const progress = { claimedArtifactIds: ["art-1"], lastScannedPayload: null, puzzles: {}, activePuzzleId: null };

describe("storage scope", () => {
  it("rejects anything that is not a well-formed uid / event id", () => {
    for (const bad of ["", "a.b", "../x", "u/v", "x".repeat(129)]) expect(() => createScope(bad, "event-1")).toThrow();
    for (const bad of ["", "e.1", "e_1", "x".repeat(65)]) expect(() => createScope("uidA", bad)).toThrow();
  });

  it("namespaces every sensitive key by uid and event", () => {
    expect(scopedKeys(A1).locations).not.toBe(scopedKeys(B1).locations);
    expect(scopedKeys(A1).locations).not.toBe(scopedKeys(A2).locations);
    expect(scopedKeys(A1).game).toContain("uidA");
  });
});

describe("ScopedStore", () => {
  it("two sequential users on one device never see each other's progress or samples", async () => {
    const store = new ScopedStore(new MemoryKV());
    await store.activate(A1, true);
    expect(await store.appendLocations(A1, [sample(1), sample(2)])).toBe(true);
    await store.saveGameState(A1, progress);

    expect(await store.loadLocations(B1)).toEqual([]);
    expect(await store.loadGameState(B1)).toMatchObject({ claimedArtifactIds: [] });
    // B cannot append into A's active scope, nor into its own until B is activated.
    expect(await store.appendLocations(B1, [sample(3)])).toBe(false);
    await store.purgeExcept({ uid: "uidB" });
    expect(await store.loadLocations(A1)).toEqual([]);
    expect(await store.loadGameState(A1)).toMatchObject({ claimedArtifactIds: [] });
    expect(await store.getActiveScope()).toBeNull();
  });

  it("keeps two games of the same user apart", async () => {
    const store = new ScopedStore(new MemoryKV());
    await store.activate(A1, true);
    await store.appendLocations(A1, [sample(1)]);
    await store.activate(A2, true);
    await store.appendLocations(A2, [sample(2), sample(3)]);
    expect(await store.loadLocations(A1)).toHaveLength(1);
    expect(await store.loadLocations(A2)).toHaveLength(2);
    await store.purgeExcept({ scope: A2 });
    expect(await store.loadLocations(A1)).toEqual([]);
    expect(await store.loadLocations(A2)).toHaveLength(2);
  });

  it("refuses to append unless the scope is the active, collecting scope", async () => {
    const store = new ScopedStore(new MemoryKV());
    expect(await store.appendLocations(A1, [sample(1)])).toBe(false);
    await store.activate(A1, false);
    expect(await store.appendLocations(A1, [sample(1)])).toBe(false);
    await store.activate(A1, true);
    expect(await store.appendLocations(A2, [sample(1)])).toBe(false);
    expect(await store.appendLocations(A1, [sample(1)])).toBe(true);
    await store.stopCollecting();
    expect(await store.appendLocations(A1, [sample(2)])).toBe(false);
    expect(await store.loadLocations(A1)).toHaveLength(1);
  });

  it("survives an app restart for the same account (offline queue and progress)", async () => {
    const kv = new MemoryKV();
    const before = new ScopedStore(kv);
    await before.activate(A1, true);
    for (let i = 0; i < 5; i++) await before.appendLocations(A1, [sample(i)]);
    await before.saveGameState(A1, progress);

    const after = new ScopedStore(kv);
    expect(await after.getActiveScope()).toEqual({ uid: "uidA", eventId: "event-1", collecting: true });
    expect(await after.loadLocations(A1)).toHaveLength(5);
    expect(await after.loadGameState(A1)).toMatchObject({ claimedArtifactIds: ["art-1"] });
    expect(await after.appendLocations(A1, [sample(5)])).toBe(true);
  });

  it("restores only the same account and event session during an offline cold start", async () => {
    const kv = new MemoryKV();
    const store = new ScopedStore(kv);
    const cached: CachedSession = {
      profile: { role: "seeker", status: "active", teamId: "alpha" },
      game: { status: "active", eventId: "event-1" },
      mission: {
        eventId: "event-1",
        gameStatus: "active" as const,
        team: { teamId: "alpha", name: "Alpha", type: "seeker", score: 10, tokens: 1, artifactsClaimed: 2, puzzlesSolved: 0 },
        totalArtifacts: 15,
        puzzles: [],
      },
      cachedAtMs: 123,
    };
    await store.saveSession(A1, cached);
    expect(await new ScopedStore(kv).loadSessionForUid("uidA")).toEqual({ scope: A1, value: cached });
    expect(await store.loadSessionForUid("uidB")).toBeNull();
    await expect(store.saveSession(A2, cached)).rejects.toThrow(/event/i);
  });

  it("removes exactly the uploaded samples, keeps samples appended meanwhile, and never touches another account", async () => {
    const kv = new MemoryKV();
    const store = new ScopedStore(kv);
    // Identical sample in two accounts' queues (same device, same place, same time).
    await store.activate(B1, true);
    await store.appendLocations(B1, [sample(1)]);
    await store.activate(A1, true);
    await store.appendLocations(A1, [sample(1), sample(2)]);
    const uploaded = await store.loadLocations(A1);
    await store.appendLocations(A1, [sample(3)]); // arrives during the upload
    await store.removeUploadedLocations(A1, uploaded);
    expect(await store.loadLocations(A1)).toEqual([sample(3)]);
    expect(await store.loadLocations(B1)).toEqual([sample(1)]);
  });

  it("serializes concurrent appends without losing samples", async () => {
    const store = new ScopedStore(new MemoryKV());
    await store.activate(A1, true);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.appendLocations(A1, [sample(i)])));
    expect(await store.loadLocations(A1)).toHaveLength(20);
  });

  it("deletes legacy installation-global keys instead of assigning them to the signed-in user", async () => {
    const kv = new MemoryKV();
    await kv.setItem("openverse.locations.v1", JSON.stringify([sample(1), sample(2)]));
    await kv.setItem("openverse.game.v1", JSON.stringify(progress));
    await kv.setItem("unrelated.app.key", "keep");
    const store = new ScopedStore(kv);
    await store.purgeExcept({ uid: "uidA" });
    for (const key of LEGACY_KEYS) expect(kv.map.has(key)).toBe(false);
    expect(kv.map.get("unrelated.app.key")).toBe("keep");
    expect(await store.loadLocations(A1)).toEqual([]);
    expect(await store.loadGameState(A1)).toMatchObject({ claimedArtifactIds: [] });
  });

  it("clears everything sensitive on sign-out, idempotently", async () => {
    const kv = new MemoryKV();
    const store = new ScopedStore(kv);
    await store.activate(A1, true);
    await store.appendLocations(A1, [sample(1)]);
    await store.saveGameState(A1, progress);
    expect(await store.purgeExcept({})).toBe(3);
    expect(kv.map.size).toBe(0);
    expect(await store.purgeExcept({})).toBe(0);
    expect(kv.map.has(ACTIVE_SCOPE_KEY)).toBe(false);
  });

  it("history deletion clears only the scope's queue", async () => {
    const store = new ScopedStore(new MemoryKV());
    await store.activate(A1, true);
    await store.appendLocations(A1, [sample(1)]);
    await store.saveGameState(A1, progress);
    await store.clearLocations(A1);
    expect(await store.loadLocations(A1)).toEqual([]);
    expect(await store.loadGameState(A1)).toMatchObject({ claimedArtifactIds: ["art-1"] });
    expect(await store.appendLocations(A1, [sample(2)])).toBe(true);
  });

  it("ignores a tampered active-scope record", async () => {
    const kv = new MemoryKV();
    await kv.setItem(ACTIVE_SCOPE_KEY, JSON.stringify({ uid: "../x", eventId: "event-1", collecting: true }));
    expect(await new ScopedStore(kv).getActiveScope()).toBeNull();
    await kv.setItem(ACTIVE_SCOPE_KEY, "{not json");
    expect(await new ScopedStore(kv).getActiveScope()).toBeNull();
  });
});
