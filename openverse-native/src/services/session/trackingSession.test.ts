import { describe, expect, it } from "vitest";
import { createScope } from "./scope";
import { MemoryKV, fakeDevice, sample, type FakeDevice } from "./testSupport";
import { evaluateTracking, type TrackingDecision } from "./trackingPolicy";
import {
  createBackgroundGate,
  enforceAuthorization,
  handleAuthChange,
  shutdownTracking,
  startTracking,
  stopTrackingByUser,
  type BackgroundAuthorization,
} from "./trackingSession";

const A = createScope("uidA", "event-1");
const B = createScope("uidB", "event-1");
const seeker = { role: "seeker", status: "active", teamId: "alpha" };
const live = { status: "active", eventId: "event-1" };
const ALLOWED: TrackingDecision = { allowed: true };
const deny = (reason: Parameters<typeof evaluateTracking>[0]) => evaluateTracking(reason);

/** Signs in as uidA and starts tracking with two queued samples. */
async function trackingAsA(): Promise<FakeDevice> {
  const d = fakeDevice();
  d.uid.current = "uidA";
  await handleAuthChange(d.deps, "uidA");
  expect(await startTracking(d.deps, A, ALLOWED)).toEqual({ ok: true });
  await d.store.appendLocations(A, [sample(1), sample(2)]);
  return d;
}

async function expectStopped(d: FakeDevice) {
  expect(d.osTaskRunning.value).toBe(false);
  expect((await d.store.getActiveScope())?.collecting ?? false).toBe(false);
  // A still-running OS task can no longer record.
  expect(await d.store.appendLocations(A, [sample(99)])).toBe(false);
}

describe("evaluateTracking", () => {
  it("allows only an active seeker on a team in an active game", () => {
    expect(evaluateTracking({ uid: "uidA", profile: seeker, game: live })).toEqual({ allowed: true });
    const cases: [Parameters<typeof evaluateTracking>[0], string][] = [
      [{ uid: null, profile: seeker, game: live }, "signed-out"],
      [{ uid: "uidA", profile: null, game: live }, "profile-missing"],
      [{ uid: "uidA", profile: { ...seeker, status: "suspended" }, game: live }, "suspended"],
      [{ uid: "uidA", profile: { ...seeker, status: "eliminated" }, game: live }, "eliminated"],
      [{ uid: "uidA", profile: { ...seeker, role: "hider" }, game: live }, "not-seeker"],
      [{ uid: "uidA", profile: { ...seeker, teamId: null }, game: live }, "no-team"],
      [{ uid: "uidA", profile: seeker, game: null }, "game-missing"],
      [{ uid: "uidA", profile: seeker, game: { status: "paused" } }, "game-paused"],
      [{ uid: "uidA", profile: seeker, game: { status: "ended" } }, "game-ended"],
      [{ uid: "uidA", profile: seeker, game: { status: "draft" } }, "game-not-active"],
    ];
    for (const [input, reason] of cases) expect(evaluateTracking(input)).toEqual({ allowed: false, reason });
  });

  it("is undecided while documents are loading, but denies as soon as one is definitive", () => {
    expect(evaluateTracking({ uid: "uidA", profile: undefined, game: live })).toEqual({ allowed: null });
    expect(evaluateTracking({ uid: "uidA", profile: seeker, game: undefined })).toEqual({ allowed: null });
    expect(evaluateTracking({ uid: "uidA", profile: { ...seeker, status: "eliminated" }, game: undefined })).toMatchObject({ allowed: false });
  });
});

describe("startTracking", () => {
  it("refuses unless authorized right now as the scope's owner", async () => {
    const d = fakeDevice();
    d.uid.current = "uidA";
    expect(await startTracking(d.deps, A, { allowed: null })).toEqual({ ok: false, reason: "authorization-unknown" });
    expect(await startTracking(d.deps, A, deny({ uid: "uidA", profile: seeker, game: { status: "ended" } }))).toEqual({ ok: false, reason: "game-ended" });
    expect(await startTracking(d.deps, B, ALLOWED)).toEqual({ ok: false, reason: "account-changed" });
    expect(d.calls.start).toBe(0);
    expect(await d.store.getActiveScope()).toBeNull();
  });

  it("does not leave collection enabled when the OS task cannot start", async () => {
    const d = fakeDevice();
    d.uid.current = "uidA";
    d.failures.startLocation = true;
    expect(await startTracking(d.deps, A, ALLOWED)).toMatchObject({ ok: false });
    expect(await d.store.appendLocations(A, [sample(1)])).toBe(false);
  });
});

describe("sign-out and account changes", () => {
  it("sign-out while signed in: stops the task, hides the live position, deletes local state", async () => {
    const d = await trackingAsA();
    const report = await shutdownTracking(d.deps, "signed-out", "all"); // signOutSafely, before auth signOut
    expect(report.failures).toEqual([]);
    expect(d.calls.stopRemote).toBe(1);
    await expectStopped(d);
    expect(d.kv.map.size).toBe(0);
  });

  it("sign-out observed after the fact (token revoked): local cleanup only, no call as another identity", async () => {
    const d = await trackingAsA();
    d.uid.current = null;
    await handleAuthChange(d.deps, null);
    expect(d.calls.stopRemote).toBe(0);
    await expectStopped(d);
    expect(await d.store.loadLocations(A)).toEqual([]);
  });

  it("UID switch: the previous account's samples are deleted and never uploadable by the new one", async () => {
    const d = await trackingAsA();
    d.uid.current = "uidB";
    const report = await handleAuthChange(d.deps, "uidB");
    expect(report?.cause).toBe("account-changed");
    expect(d.calls.stopRemote).toBe(0);
    await expectStopped(d);
    expect(await d.store.loadLocations(A)).toEqual([]);
    expect(await d.store.getActiveScope()).toBeNull();
    // B starts fresh.
    expect(await startTracking(d.deps, B, ALLOWED)).toEqual({ ok: true });
    expect(await d.store.loadLocations(B)).toEqual([]);
  });

  it("cleanup is safe offline and when the native stop fails", async () => {
    const d = await trackingAsA();
    d.failures.stopRemote = true;
    d.failures.stopLocation = true;
    const report = await shutdownTracking(d.deps, "signed-out", "all");
    expect(report.failures).toEqual(["stop-location-updates", "stop-remote-tracking"]);
    // Collection was disabled first, so the still-running OS task cannot record.
    expect(await d.store.appendLocations(A, [sample(5)])).toBe(false);
    expect(d.kv.map.size).toBe(0);
  });

  it("repeated cleanup is idempotent", async () => {
    const d = await trackingAsA();
    for (let i = 0; i < 3; i++) {
      await expect(shutdownTracking(d.deps, "signed-out", "all")).resolves.toMatchObject({ failures: [] });
      await handleAuthChange(d.deps, null);
    }
    await expectStopped(d);
  });
});

describe("authorization loss while signed in", () => {
  it.each([
    ["game end", { uid: "uidA", profile: seeker, game: { status: "ended", eventId: "event-1" } }, "game-ended"],
    ["pause (stop-on-pause policy)", { uid: "uidA", profile: seeker, game: { status: "paused", eventId: "event-1" } }, "game-paused"],
    ["elimination", { uid: "uidA", profile: { ...seeker, status: "eliminated" }, game: live }, "eliminated"],
    ["suspension", { uid: "uidA", profile: { ...seeker, status: "suspended" }, game: live }, "suspended"],
    ["role loss", { uid: "uidA", profile: { ...seeker, role: "hider" }, game: live }, "not-seeker"],
    ["removal from team", { uid: "uidA", profile: { ...seeker, teamId: null }, game: live }, "no-team"],
  ] as const)("%s stops tracking and quarantines the queue", async (_label, input, reason) => {
    const d = await trackingAsA();
    const report = await enforceAuthorization(d.deps, A, evaluateTracking(input));
    expect(report?.cause).toBe(reason);
    expect(d.calls.stopRemote).toBe(1);
    await expectStopped(d);
    // Queue kept in A's scope (not uploadable without authorization), not handed to anyone.
    expect(await d.store.loadLocations(A)).toHaveLength(2);
    // Enforcing again is a no-op.
    expect(await enforceAuthorization(d.deps, A, evaluateTracking(input))).toBeNull();
  });

  it("does nothing while authorization is still loading", async () => {
    const d = await trackingAsA();
    expect(await enforceAuthorization(d.deps, A, { allowed: null })).toBeNull();
    expect(d.osTaskRunning.value).toBe(true);
  });

  it("a new event stops tracking for the old one and deletes the old event's data", async () => {
    const d = await trackingAsA();
    const next = createScope("uidA", "event-2");
    const report = await enforceAuthorization(d.deps, next, ALLOWED);
    expect(report).not.toBeNull();
    await expectStopped(d);
    expect(await d.store.loadLocations(A)).toEqual([]);
  });
});

describe("app restart", () => {
  it("the same account keeps its offline queue and tracking; the background task keeps recording", async () => {
    const d = await trackingAsA();
    const restarted = fakeDevice(d.kv as MemoryKV);
    restarted.uid.current = "uidA";
    restarted.osTaskRunning.value = true;
    expect(await handleAuthChange(restarted.deps, "uidA")).toBeNull();
    expect(await enforceAuthorization(restarted.deps, A, ALLOWED)).toBeNull();
    expect(await restarted.store.loadLocations(A)).toHaveLength(2);
    const gate = createBackgroundGate(restarted.deps, async () => ({ profile: seeker, game: live }));
    expect(await gate([sample(3)])).toBe("appended");
    expect(await restarted.store.loadLocations(A)).toHaveLength(3);
  });

  it("a restart after the game ended stops tracking once state is observed", async () => {
    const d = await trackingAsA();
    const restarted = fakeDevice(d.kv as MemoryKV);
    restarted.uid.current = "uidA";
    await handleAuthChange(restarted.deps, "uidA");
    await enforceAuthorization(restarted.deps, A, evaluateTracking({ uid: "uidA", profile: seeker, game: { status: "ended" } }));
    await expectStopped(restarted);
  });
});

describe("headless background task gate", () => {
  const allowedAuth = async (): Promise<BackgroundAuthorization> => ({ profile: seeker, game: live });

  it("refuses and stops the OS task when no scope is active", async () => {
    const d = fakeDevice();
    d.uid.current = "uidA";
    d.osTaskRunning.value = true;
    expect(await createBackgroundGate(d.deps, allowedAuth)([sample(1)])).toBe("refused-no-scope");
    expect(d.osTaskRunning.value).toBe(false);
    expect(d.kv.map.size).toBe(0);
  });

  it("refuses when the signed-in account is not the scope's owner, and cleans up", async () => {
    const d = await trackingAsA();
    d.uid.current = "uidB";
    expect(await createBackgroundGate(d.deps, allowedAuth)([sample(3)])).toBe("refused-account");
    await expectStopped(d);
    expect(await d.store.loadLocations(A)).toEqual([]);
  });

  it("refuses when signed out", async () => {
    const d = await trackingAsA();
    d.uid.current = null;
    expect(await createBackgroundGate(d.deps, allowedAuth)([sample(3)])).toBe("refused-account");
    expect(d.kv.map.size).toBe(0);
  });

  it("stops on a denial observed by its periodic re-check (app not running)", async () => {
    const d = await trackingAsA();
    const gate = createBackgroundGate(d.deps, async () => ({ profile: { ...seeker, status: "eliminated" }, game: live }));
    expect(await gate([sample(3)])).toBe("refused-denied");
    await expectStopped(d);
  });

  it("keeps collecting offline when the re-check cannot reach the server", async () => {
    const d = await trackingAsA();
    const gate = createBackgroundGate(d.deps, async () => {
      throw new Error("offline");
    });
    expect(await gate([sample(3)])).toBe("appended");
    expect(await gate([sample(4)])).toBe("appended");
    expect(await d.store.loadLocations(A)).toHaveLength(4);
  });

  it("re-checks at most once per interval", async () => {
    const d = await trackingAsA();
    let checks = 0;
    let clock = 0;
    const gate = createBackgroundGate(d.deps, async () => {
      checks += 1;
      return { profile: seeker, game: live };
    }, { recheckMs: 60_000, now: () => clock });
    await gate([sample(3)]);
    clock = 30_000;
    await gate([sample(4)]);
    clock = 61_000;
    await gate([sample(5)]);
    expect(checks).toBe(2);
  });

  it("stops when the server's event is no longer the scope's event", async () => {
    const d = await trackingAsA();
    const gate = createBackgroundGate(d.deps, async () => ({ profile: seeker, game: { status: "active", eventId: "event-2" } }));
    expect(await gate([sample(3)])).toBe("refused-denied");
    await expectStopped(d);
  });
});

describe("user stop", () => {
  it("keeps the queue for later sync by the same account", async () => {
    const d = await trackingAsA();
    await stopTrackingByUser(d.deps);
    await expectStopped(d);
    expect(await d.store.loadLocations(A)).toHaveLength(2);
  });
});
