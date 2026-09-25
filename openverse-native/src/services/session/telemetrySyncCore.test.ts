import { describe, expect, it } from "vitest";
import type { UpdateTelemetryRequest, UploadLocationBatchRequest } from "../firebase/contract";
import { ScopedStore } from "./localStore";
import { createScope } from "./scope";
import { syncLocationQueue, type TelemetrySyncDeps } from "./telemetrySyncCore";
import { MemoryKV, sample } from "./testSupport";

const A = createScope("uidA", "event-1");
const B = createScope("uidB", "event-1");
const NOW = 1_800_000_000_000 + 10 * 15_000;
const ALLOWED = { allowed: true } as const;

class CallableError extends Error {
  constructor(readonly details: { reason: string }) {
    super(details.reason);
  }
}

function setup(queued = 3) {
  const store = new ScopedStore(new MemoryKV());
  const uid = { current: "uidA" as string | null };
  const batches: UploadLocationBatchRequest[] = [];
  const live: UpdateTelemetryRequest[] = [];
  const errors: { batch?: string; live?: string } = {};
  const deps: TelemetrySyncDeps = {
    store,
    currentUid: () => uid.current,
    uploadLocationBatch: async (data) => {
      if (errors.batch) throw new CallableError({ reason: errors.batch });
      batches.push(data);
    },
    updateTelemetry: async (data) => {
      if (errors.live) throw new CallableError({ reason: errors.live });
      live.push(data);
    },
    reasonOf: (e) => (e instanceof CallableError ? e.details.reason : null),
    now: () => NOW,
  };
  const ready = (async () => {
    await store.activate(A, true);
    await store.appendLocations(A, Array.from({ length: queued }, (_, i) => sample(i + 8)));
  })();
  return { store, uid, batches, live, errors, deps, ready };
}

describe("syncLocationQueue", () => {
  it("uploads the offline queue, removes it, and sends the newest fix as live position", async () => {
    const t = setup();
    await t.ready;
    await expect(syncLocationQueue(t.deps, A, ALLOWED)).resolves.toEqual({ status: "synced", uploaded: 3, pending: 0 });
    expect(t.batches).toHaveLength(1);
    expect(t.batches[0]!.samples).toHaveLength(3);
    expect(t.live).toHaveLength(1);
    expect(await t.store.loadLocations(A)).toEqual([]);
  });

  it("sends nothing unless tracking is authorized", async () => {
    const t = setup();
    await t.ready;
    await expect(syncLocationQueue(t.deps, A, { allowed: false, reason: "game-ended" })).resolves.toMatchObject({ status: "skipped", reason: "not-authorized", pending: 3 });
    await expect(syncLocationQueue(t.deps, A, { allowed: null })).resolves.toMatchObject({ status: "skipped" });
    expect(t.batches).toHaveLength(0);
  });

  it("never uploads one account's samples while another account is signed in", async () => {
    const t = setup();
    await t.ready;
    t.uid.current = "uidB";
    await expect(syncLocationQueue(t.deps, A, ALLOWED)).resolves.toMatchObject({ status: "skipped", reason: "account-mismatch" });
    await expect(syncLocationQueue(t.deps, B, ALLOWED)).resolves.toMatchObject({ status: "synced", uploaded: 0 });
    expect(t.batches).toHaveLength(0);
    expect(t.live).toHaveLength(0);
  });

  it("stops mid-sync when the account changes between batches", async () => {
    const t = setup(450);
    await t.ready;
    const upload = t.deps.uploadLocationBatch;
    t.deps.uploadLocationBatch = async (data) => {
      await upload(data);
      t.uid.current = "uidB";
    };
    await expect(syncLocationQueue(t.deps, A, ALLOWED)).resolves.toMatchObject({ status: "skipped", reason: "account-mismatch" });
    expect(t.batches).toHaveLength(1);
    expect(t.live).toHaveLength(0);
  });

  it("sign-out while an upload is pending: nothing more is sent and the purged queue is not recreated", async () => {
    const t = setup(450);
    await t.ready;
    let release!: () => void;
    t.deps.uploadLocationBatch = (data) =>
      new Promise<void>((resolve) => {
        t.batches.push(data);
        release = resolve;
      });
    const sync = syncLocationQueue(t.deps, A, ALLOWED);
    await new Promise((r) => setTimeout(r, 0));
    // Sign-out happens while the first batch is in flight.
    t.uid.current = null;
    await t.store.purgeExcept({});
    release();
    await expect(sync).resolves.toMatchObject({ status: "skipped", reason: "account-mismatch", pending: 0 });
    expect(t.batches).toHaveLength(1);
    expect(t.live).toHaveLength(0);
    expect(await t.store.loadLocations(A)).toEqual([]);
    expect(await t.store.getActiveScope()).toBeNull();
  });

  it("an account switch while an upload is pending does not remove or upload anything for the new account", async () => {
    const t = setup(3);
    await t.ready;
    let release!: () => void;
    t.deps.uploadLocationBatch = (data) =>
      new Promise<void>((resolve) => {
        t.batches.push(data);
        release = resolve;
      });
    const sync = syncLocationQueue(t.deps, A, ALLOWED);
    await new Promise((r) => setTimeout(r, 0));
    t.uid.current = "uidB";
    release();
    await expect(sync).resolves.toMatchObject({ status: "skipped", reason: "account-mismatch" });
    expect(t.live).toHaveLength(0);
  });

  it("reports a terminal server reason so the caller shuts tracking down, keeping unsent samples", async () => {
    const t = setup();
    await t.ready;
    t.errors.live = "PLAYER_ELIMINATED";
    await expect(syncLocationQueue(t.deps, A, ALLOWED)).resolves.toMatchObject({ status: "denied", denial: "eliminated", uploaded: 3 });
    const t2 = setup();
    await t2.ready;
    t2.errors.batch = "ROLE_NOT_ALLOWED";
    await expect(syncLocationQueue(t2.deps, A, ALLOWED)).resolves.toMatchObject({ status: "denied", denial: "not-seeker", pending: 3 });
  });

  it("treats a rejected live fix as non-terminal", async () => {
    for (const reason of ["TELEMETRY_IMPLAUSIBLE_MOVEMENT", "TELEMETRY_STALE_FIX", "RATE_LIMITED"]) {
      const t = setup();
      await t.ready;
      t.errors.live = reason;
      await expect(syncLocationQueue(t.deps, A, ALLOWED)).resolves.toMatchObject({ status: "synced", uploaded: 3 });
    }
  });

  it("does not send an old queued sample as the live position", async () => {
    const t = setup();
    await t.ready;
    t.deps.now = () => NOW + 10 * 60_000;
    await expect(syncLocationQueue(t.deps, A, ALLOWED)).resolves.toMatchObject({ status: "synced", uploaded: 3 });
    expect(t.live).toHaveLength(0);
  });

  it("rethrows transport errors and keeps the queue for retry", async () => {
    const t = setup();
    await t.ready;
    t.deps.uploadLocationBatch = async () => {
      throw new Error("network down");
    };
    await expect(syncLocationQueue(t.deps, A, ALLOWED)).rejects.toThrow("network down");
    expect(await t.store.loadLocations(A)).toHaveLength(3);
  });
});
