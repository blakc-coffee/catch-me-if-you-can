import { TELEMETRY_LIMITS } from "../config.js";
import { CAMPUS_BOUNDS, haversineMeters } from "../lib/geo.js";
import type { TELEMETRY_FIX_REJECTIONS } from "../shared/contract.js";

export type FixRejection = (typeof TELEMETRY_FIX_REJECTIONS)[number];

export interface Fix {
  lat: number;
  lon: number;
  accuracyM: number;
  /** Device epoch ms when the fix was taken. */
  clientTs: number;
}

/** The seeker's last accepted live fix, plus the server time it was accepted. */
export interface AcceptedFix extends Fix {
  serverMs: number;
}

type Limits = typeof TELEMETRY_LIMITS;

export function inCampusBounds(lat: number, lon: number): boolean {
  const b = CAMPUS_BOUNDS;
  return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
}

/**
 * Checks that need no stored state: timestamp freshness, accuracy and campus
 * bounds. Invalid fixes are rejected, never clamped or reinterpreted.
 */
export function checkFix(fix: Fix, nowMs: number, limits: Limits = TELEMETRY_LIMITS): FixRejection | null {
  if (fix.clientTs > nowMs + limits.maxFutureSkewMs) return "TELEMETRY_FUTURE_FIX";
  if (fix.clientTs < nowMs - limits.maxFixAgeMs) return "TELEMETRY_STALE_FIX";
  if (fix.accuracyM > limits.maxAccuracyM) return "TELEMETRY_LOW_ACCURACY";
  if (!inCampusBounds(fix.lat, fix.lon)) return "TELEMETRY_OUT_OF_BOUNDS";
  return null;
}

/**
 * Compares a fix with the last accepted one. With no previous fix (the
 * seeker's first live position) only checkFix applies.
 *
 * Elapsed time is the smaller of the device-reported interval and the
 * server-observed interval (plus a small grace), so backdating the previous
 * fix or post-dating the new one cannot buy extra travel distance.
 */
export function checkMovement(
  prev: AcceptedFix | null,
  fix: Fix,
  nowMs: number,
  limits: Limits = TELEMETRY_LIMITS,
): FixRejection | null {
  if (!prev) return null;
  const clientDeltaMs = fix.clientTs - prev.clientTs;
  if (clientDeltaMs <= 0) return "TELEMETRY_NON_MONOTONIC";
  const serverDeltaMs = Math.max(0, nowMs - prev.serverMs) + limits.timingGraceMs;
  const elapsedS = Math.min(clientDeltaMs, serverDeltaMs) / 1000;
  const jitterM = Math.min(prev.accuracyM + fix.accuracyM, limits.maxJitterM);
  const distanceM = haversineMeters(prev.lat, prev.lon, fix.lat, fix.lon);
  return distanceM > limits.maxSpeedMps * elapsedS + jitterM ? "TELEMETRY_IMPLAUSIBLE_MOVEMENT" : null;
}
