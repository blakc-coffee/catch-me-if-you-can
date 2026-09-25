import type { StoredPosition } from "../../types";
import {
  TELEMETRY_FIX_REJECTIONS,
  type LocationSampleDTO,
  type UpdateTelemetryRequest,
  type UploadLocationBatchRequest,
} from "../firebase/contract";
import type { ScopedStore } from "./localStore";
import type { StorageScope } from "./scope";
import { denialFromServerReason, type TrackingDecision, type TrackingDenial } from "./trackingPolicy";

export const BATCH_SIZE = 200;
/** The server rejects older live fixes (TELEMETRY_STALE_FIX); don't send them as live position. */
export const LIVE_FIX_MAX_AGE_MS = 55_000;

export interface TelemetrySyncDeps {
  store: ScopedStore;
  currentUid(): string | null;
  uploadLocationBatch(data: UploadLocationBatchRequest): Promise<unknown>;
  updateTelemetry(data: UpdateTelemetryRequest): Promise<unknown>;
  reasonOf(error: unknown): string | null;
  now?(): number;
}

export type SyncResult =
  | { status: "synced"; uploaded: number; pending: number }
  /** Nothing was sent: not authorized now, or the signed-in account is not the scope's owner. */
  | { status: "skipped"; reason: "not-authorized" | "account-mismatch"; pending: number }
  /** The server says this account may no longer track; the caller must shut tracking down. */
  | { status: "denied"; denial: TrackingDenial; uploaded: number; pending: number };

function toDto(sample: StoredPosition): LocationSampleDTO {
  return {
    t: sample.timestamp,
    lat: sample.latitude,
    lon: sample.longitude,
    acc: sample.accuracy ?? 0,
    ...(sample.speed == null || sample.speed < 0 ? {} : { spd: sample.speed }),
    ...(sample.heading == null || sample.heading < 0 ? {} : { hdg: sample.heading }),
  };
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

export function batchId(samples: LocationSampleDTO[]): string {
  const body = JSON.stringify(samples);
  return `b_${samples[0]!.t}_${samples.at(-1)!.t}_${samples.length}_${shortHash(body)}`;
}

const NON_TERMINAL_LIVE = new Set<string>([...TELEMETRY_FIX_REJECTIONS, "RATE_LIMITED"]);

/**
 * Uploads `scope`'s queued samples, then the newest one as the live position.
 * Refuses to send anything unless tracking is authorized and the signed-in
 * account owns the scope — rechecked before every request, so an account
 * switch mid-sync cannot upload the previous account's samples. Uploaded
 * samples are removed from this scope's queue only.
 */
export async function syncLocationQueue(deps: TelemetrySyncDeps, scope: StorageScope, decision: TrackingDecision): Promise<SyncResult> {
  const owns = () => deps.currentUid() === scope.uid;
  const pending = async () => (await deps.store.loadLocations(scope)).length;
  if (decision.allowed !== true) return { status: "skipped", reason: "not-authorized", pending: await pending() };
  if (!owns()) return { status: "skipped", reason: "account-mismatch", pending: await pending() };

  const queued = await deps.store.loadLocations(scope);
  let uploaded = 0;
  for (let offset = 0; offset < queued.length; offset += BATCH_SIZE) {
    if (!owns()) return { status: "skipped", reason: "account-mismatch", pending: await pending() };
    const source = queued.slice(offset, offset + BATCH_SIZE);
    const samples = source.map(toDto);
    try {
      await deps.uploadLocationBatch({ batchId: batchId(samples), samples });
    } catch (error) {
      const denial = denialFromServerReason(deps.reasonOf(error));
      if (denial) return { status: "denied", denial, uploaded, pending: await pending() };
      throw error;
    }
    await deps.store.removeUploadedLocations(scope, source);
    uploaded += source.length;
  }

  const latest = queued.at(-1);
  const now = deps.now?.() ?? Date.now();
  if (latest && now - latest.timestamp <= LIVE_FIX_MAX_AGE_MS && owns()) {
    try {
      await deps.updateTelemetry({
        lat: latest.latitude,
        lon: latest.longitude,
        accuracyM: latest.accuracy ?? 0,
        ...(latest.speed == null || latest.speed < 0 ? {} : { speedMps: latest.speed }),
        ...(latest.heading == null || latest.heading < 0 ? {} : { headingDeg: latest.heading }),
        clientTs: latest.timestamp,
      });
    } catch (error) {
      const reason = deps.reasonOf(error);
      const denial = denialFromServerReason(reason);
      if (denial) return { status: "denied", denial, uploaded, pending: await pending() };
      if (!NON_TERMINAL_LIVE.has(reason ?? "")) throw error;
    }
  }
  return { status: "synced", uploaded, pending: await pending() };
}
