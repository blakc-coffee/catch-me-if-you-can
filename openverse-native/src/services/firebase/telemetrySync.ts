import type { LocationSampleDTO } from "./contract";
import { getCallableReason, updateTelemetry, uploadLocationBatch } from "./callables";
import { loadLocations, removeUploadedLocations } from "../storage";
import type { StoredPosition } from "../../types";

const BATCH_SIZE = 200;

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

function batchId(samples: LocationSampleDTO[]): string {
  const body = JSON.stringify(samples);
  return `b_${samples[0]!.t}_${samples.at(-1)!.t}_${samples.length}_${shortHash(body)}`;
}

export async function syncLocationQueue(): Promise<{ uploaded: number; pending: number }> {
  const queued = await loadLocations();
  if (queued.length === 0) return { uploaded: 0, pending: 0 };

  let uploaded = 0;
  for (let offset = 0; offset < queued.length; offset += BATCH_SIZE) {
    const source = queued.slice(offset, offset + BATCH_SIZE);
    const samples = source.map(toDto);
    await uploadLocationBatch({ batchId: batchId(samples), samples });
    await removeUploadedLocations(source);
    uploaded += source.length;
  }

  const latest = queued.at(-1)!;
  try {
    await updateTelemetry({
      lat: latest.latitude,
      lon: latest.longitude,
      accuracyM: latest.accuracy ?? 0,
      ...(latest.speed == null || latest.speed < 0 ? {} : { speedMps: latest.speed }),
      ...(latest.heading == null || latest.heading < 0 ? {} : { headingDeg: latest.heading }),
      clientTs: latest.timestamp,
    });
  } catch (error) {
    const reason = getCallableReason(error);
    if (!["RATE_LIMITED", "TELEMETRY_CLOCK_SKEW", "GAME_NOT_ACTIVE", "GAME_ENDED", "PLAYER_ELIMINATED"].includes(reason ?? "")) {
      throw error;
    }
  }

  return { uploaded, pending: (await loadLocations()).length };
}
