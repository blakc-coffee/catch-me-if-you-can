import type { GameState, StoredPosition } from "../../types";
import type { GetMissionStateResponse } from "../firebase/contract";
import { initialGameState, normalizeGameState } from "./gameState";
import type { GameSnapshot, ProfileSnapshot } from "./trackingPolicy";
import {
  ACTIVE_SCOPE_KEY,
  KEY_PREFIX,
  LEGACY_KEYS,
  createScope,
  isValidEventId,
  isValidUid,
  lastScopeKey,
  keyBelongsToScope,
  sameScope,
  scopedKeys,
  userPrefix,
  type ActiveScopeRecord,
  type StorageScope,
} from "./scope";

export type CachedSession = {
  profile: ProfileSnapshot;
  game: GameSnapshot;
  mission: GetMissionStateResponse;
  cachedAtMs: number;
};

/** The subset of AsyncStorage this module uses (injectable for tests). */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

export const MAX_LOCATION_SAMPLES = 500;

export { initialGameState };

function parseArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

const sampleKey = (sample: StoredPosition) => `${sample.timestamp}:${sample.latitude}:${sample.longitude}`;

/**
 * Scoped, serialized access to sensitive on-device state. Every key lives
 * under one (uid, eventId) scope, so compare/remove logic can only ever touch
 * the given scope's samples. Read-modify-write operations run one at a time.
 */
export class ScopedStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly kv: KeyValueStore) {}

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  // ------------------------------------------------------------ active scope

  async getActiveScope(): Promise<ActiveScopeRecord | null> {
    const raw = await this.kv.getItem(ACTIVE_SCOPE_KEY);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Partial<ActiveScopeRecord>;
      if (!isValidUid(value.uid) || !isValidEventId(value.eventId)) return null;
      return { uid: value.uid, eventId: value.eventId, collecting: value.collecting === true };
    } catch {
      return null;
    }
  }

  /** Marks `scope` as the only scope the background task may record into. */
  activate(scope: StorageScope, collecting: boolean): Promise<void> {
    return this.exclusive(() =>
      this.kv.setItem(ACTIVE_SCOPE_KEY, JSON.stringify({ uid: scope.uid, eventId: scope.eventId, collecting })),
    );
  }

  /** Stops background collection while keeping the scope's queued samples. */
  stopCollecting(): Promise<void> {
    return this.exclusive(async () => {
      const active = await this.getActiveScope();
      if (active?.collecting) await this.kv.setItem(ACTIVE_SCOPE_KEY, JSON.stringify({ ...active, collecting: false }));
    });
  }

  clearActiveScope(): Promise<void> {
    return this.exclusive(() => this.kv.removeItem(ACTIVE_SCOPE_KEY));
  }

  // ------------------------------------------------------------ game progress

  async loadGameState(scope: StorageScope): Promise<GameState> {
    const raw = await this.kv.getItem(scopedKeys(scope).game);
    if (!raw) return initialGameState;
    try {
      return normalizeGameState(JSON.parse(raw));
    } catch {
      return initialGameState;
    }
  }

  saveGameState(scope: StorageScope, state: GameState): Promise<void> {
    return this.exclusive(() => this.kv.setItem(scopedKeys(scope).game, JSON.stringify(state)));
  }

  // ------------------------------------------------------------ offline startup

  saveSession(scope: StorageScope, value: CachedSession): Promise<void> {
    if (value.mission.eventId !== scope.eventId) return Promise.reject(new Error("Cached mission event does not match its storage scope."));
    return this.exclusive(async () => {
      await this.kv.setItem(scopedKeys(scope).session, JSON.stringify(value));
      await this.kv.setItem(lastScopeKey(scope.uid), JSON.stringify({ eventId: scope.eventId }));
    });
  }

  async loadSessionForUid(uid: string): Promise<{ scope: StorageScope; value: CachedSession } | null> {
    if (!isValidUid(uid)) return null;
    try {
      const marker = JSON.parse((await this.kv.getItem(lastScopeKey(uid))) ?? "null") as { eventId?: unknown } | null;
      if (!marker || !isValidEventId(marker.eventId)) return null;
      const scope = createScope(uid, marker.eventId);
      const value = JSON.parse((await this.kv.getItem(scopedKeys(scope).session)) ?? "null") as CachedSession | null;
      if (!value || typeof value !== "object" || !value.profile || !value.game || !value.mission) return null;
      if (value.mission.eventId !== scope.eventId || typeof value.cachedAtMs !== "number") return null;
      return { scope, value };
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------ location queue

  loadLocations(scope: StorageScope): Promise<StoredPosition[]> {
    return this.kv.getItem(scopedKeys(scope).locations).then((raw) => parseArray<StoredPosition>(raw));
  }

  /**
   * Appends samples only while `scope` is the active, collecting scope —
   * checked inside the same exclusive section as the write, so a concurrent
   * shutdown cannot be overtaken. Returns false when refused.
   */
  appendLocations(scope: StorageScope, incoming: StoredPosition[]): Promise<boolean> {
    return this.exclusive(async () => {
      const active = await this.getActiveScope();
      if (!active?.collecting || !sameScope(active, scope)) return false;
      const key = scopedKeys(scope).locations;
      const next = [...parseArray<StoredPosition>(await this.kv.getItem(key)), ...incoming].slice(-MAX_LOCATION_SAMPLES);
      await this.kv.setItem(key, JSON.stringify(next));
      return true;
    });
  }

  /**
   * Removes exactly the uploaded samples from this scope's queue. A queue that
   * no longer exists (purged by sign-out or an account switch while the upload
   * was in flight) is left deleted rather than recreated.
   */
  removeUploadedLocations(scope: StorageScope, uploaded: StoredPosition[]): Promise<void> {
    return this.exclusive(async () => {
      const key = scopedKeys(scope).locations;
      const raw = await this.kv.getItem(key);
      if (raw === null) return;
      const uploadedKeys = new Set(uploaded.map(sampleKey));
      const remaining = parseArray<StoredPosition>(raw).filter((s) => !uploadedKeys.has(sampleKey(s)));
      await this.kv.setItem(key, JSON.stringify(remaining));
    });
  }

  clearLocations(scope: StorageScope): Promise<void> {
    return this.exclusive(() => this.kv.removeItem(scopedKeys(scope).locations));
  }

  // ------------------------------------------------------------ cleanup

  /**
   * Deletes sensitive state that does not belong to `keep` (a scope, a UID's
   * scopes, or nothing), plus legacy installation-global keys whose owner
   * cannot be proven. The active-scope pointer is cleared unless it matches
   * `keep`. Idempotent.
   */
  purgeExcept(keep: { scope?: StorageScope; uid?: string } = {}): Promise<number> {
    return this.exclusive(async () => {
      const keys = await this.kv.getAllKeys();
      const doomed = keys.filter((key) => {
        if ((LEGACY_KEYS as readonly string[]).includes(key)) return true;
        if (!key.startsWith(KEY_PREFIX) || key === ACTIVE_SCOPE_KEY) return false;
        if (keep.scope) return key !== lastScopeKey(keep.scope.uid) && !keyBelongsToScope(key, keep.scope);
        if (keep.uid) return !key.startsWith(userPrefix(keep.uid));
        return true;
      });
      const active = await this.getActiveScope();
      const keepActive = active && (keep.scope ? sameScope(active, keep.scope) : keep.uid ? active.uid === keep.uid : false);
      if (!keepActive && keys.includes(ACTIVE_SCOPE_KEY)) doomed.push(ACTIVE_SCOPE_KEY);
      if (doomed.length > 0) await this.kv.multiRemove(doomed);
      return doomed.length;
    });
  }
}
