// Test helpers for the session modules (imported only by *.test.ts).
import type { StoredPosition } from "../../types";
import { ScopedStore, type KeyValueStore } from "./localStore";
import type { TrackingSessionDeps } from "./trackingSession";

/** In-memory AsyncStorage stand-in; survives "app restarts" by reusing the instance. */
export class MemoryKV implements KeyValueStore {
  readonly map = new Map<string, string>();
  async getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  async removeItem(key: string) {
    this.map.delete(key);
  }
  async getAllKeys() {
    return [...this.map.keys()];
  }
  async multiRemove(keys: readonly string[]) {
    for (const k of keys) this.map.delete(k);
  }
}

export function sample(i: number, t0 = 1_800_000_000_000): StoredPosition {
  return { latitude: 9.7549 + i * 1e-5, longitude: 76.65, accuracy: 5, altitude: null, heading: null, speed: null, timestamp: t0 + i * 15_000 };
}

export interface FakeDevice {
  kv: MemoryKV;
  store: ScopedStore;
  deps: TrackingSessionDeps;
  uid: { current: string | null };
  calls: { start: number; stopLocation: number; stopRemote: number };
  osTaskRunning: { value: boolean };
  failures: { stopLocation?: boolean; stopRemote?: boolean; startLocation?: boolean };
}

/** A fake phone: storage, an OS location task and a remote stopTracking endpoint. */
export function fakeDevice(kv = new MemoryKV()): FakeDevice {
  const store = new ScopedStore(kv);
  const uid = { current: null as string | null };
  const calls = { start: 0, stopLocation: 0, stopRemote: 0 };
  const osTaskRunning = { value: false };
  const failures: FakeDevice["failures"] = {};
  const deps: TrackingSessionDeps = {
    store,
    currentUid: () => uid.current,
    startLocationUpdates: async () => {
      calls.start += 1;
      if (failures.startLocation) return { ok: false, reason: "background-denied" };
      osTaskRunning.value = true;
      return { ok: true };
    },
    stopLocationUpdates: async () => {
      calls.stopLocation += 1;
      if (failures.stopLocation) throw new Error("native stop failed");
      osTaskRunning.value = false;
    },
    stopRemoteTracking: async () => {
      calls.stopRemote += 1;
      if (failures.stopRemote) throw new Error("network unavailable");
    },
  };
  return { kv, store, deps, uid, calls, osTaskRunning, failures };
}
