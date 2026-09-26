import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { PermissionsAndroid, Platform } from "react-native";
import { watcherNeedsRestart } from "./locationKeepalive";
import { onBackgroundSamples } from "./session/sessionRuntime";
import type { StoredPosition } from "../types";

export const LOCATION_TASK_NAME = "openverse-background-location";

export type TrackingPermissionResult =
  | { ok: true }
  | { ok: false; reason: "foreground-denied" | "background-denied" | "notification-denied" | "unavailable" };

let foregroundSubscription: Location.LocationSubscription | null = null;
/** True only after the user has started tracking and it has not been stopped. */
let trackingWanted = false;
let lastSampleAtMs = 0;
let op: Promise<unknown> = Promise.resolve();

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = op.then(fn, fn);
  op = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function noteLocationSample(timestamp: number): void {
  if (Number.isFinite(timestamp)) lastSampleAtMs = Math.max(lastSampleAtMs, timestamp);
}

export async function isTracking(): Promise<boolean> {
  const bg = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME).catch(() => false);
  return bg || foregroundSubscription !== null;
}

function toSample(loc: Location.LocationObject): StoredPosition {
  return {
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    accuracy: loc.coords.accuracy,
    altitude: loc.coords.altitude,
    heading: loc.coords.heading,
    speed: loc.coords.speed,
    timestamp: loc.timestamp,
  };
}

async function startForegroundWatch(): Promise<void> {
  if (foregroundSubscription) {
    try {
      foregroundSubscription.remove();
    } catch {
      // The native watcher may already have been removed by a permission change.
    }
    foregroundSubscription = null;
  }
  try {
    foregroundSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
        distanceInterval: 5,
      },
      (loc) => {
        noteLocationSample(loc.timestamp);
        void onBackgroundSamples([toSample(loc)]).catch((err) => console.warn("Foreground sample handling warning:", err));
      },
    );
    // A fresh watcher is not stale until it has had time to deliver a fix.
    noteLocationSample(Date.now());
  } catch (err) {
    foregroundSubscription = null;
    console.warn("watchPositionAsync warning:", err);
  }
}

async function startBackgroundTaskIfGranted(): Promise<void> {
  const bgPerm = await Location.getBackgroundPermissionsAsync().catch(() => null);
  if (bgPerm?.status !== Location.PermissionStatus.GRANTED) return;
  const taskAvailable = await TaskManager.isAvailableAsync().catch(() => false);
  if (!taskAvailable) return;
  const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME).catch(() => false);
  if (alreadyRegistered) return;
  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    distanceInterval: 10,
    timeInterval: 15000,
    deferredUpdatesDistance: 25,
    deferredUpdatesInterval: 30000,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: "Openverse mission active",
      notificationBody: "Recording your location for the current mission.",
    },
  });
}

async function stopWatchers(): Promise<void> {
  if (foregroundSubscription) {
    try {
      foregroundSubscription.remove();
    } catch {
      // Already removed.
    }
    foregroundSubscription = null;
  }
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME).catch(() => false);
    if (registered) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  } catch (err) {
    console.warn("stopLocationUpdates warning:", err);
  }
}

/**
 * Requests permissions, then starts tracking. The background-permission UI
 * pauses the activity and drops any watcher started beforehand, so the
 * foreground watcher is rebuilt after that prompt returns — granting
 * permission must leave tracking running.
 */
export async function startLocationUpdates(): Promise<TrackingPermissionResult> {
  return exclusive(async () => {
    const foreground = await Location.requestForegroundPermissionsAsync().catch(() => null);
    if (foreground?.status !== Location.PermissionStatus.GRANTED) {
      trackingWanted = false;
      return { ok: false, reason: "foreground-denied" };
    }
    trackingWanted = true;
    await startForegroundWatch();

    if (Platform.OS === "android" && Number(Platform.Version) >= 33) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => undefined);
    }
    if (!trackingWanted) {
      await stopWatchers();
      return { ok: false, reason: "unavailable" };
    }

    // Awaited so we know the grant/denial before deciding the watcher is healthy.
    await Location.requestBackgroundPermissionsAsync().catch(() => undefined);
    if (!trackingWanted) {
      await stopWatchers();
      return { ok: false, reason: "unavailable" };
    }

    await startForegroundWatch();
    try {
      await startBackgroundTaskIfGranted();
    } catch (bgError) {
      console.warn("Background location task not started (falling back to foreground tracking):", bgError);
    }
    if (!foregroundSubscription) return { ok: false, reason: "unavailable" };
    return { ok: true };
  });
}

/**
 * Restarts watchers that a permission dialog or process restart killed,
 * without prompting again. `adopt` continues a session the user already
 * started (active scope still collecting) after the JS runtime was recreated.
 */
export async function resumeLocationUpdates(options?: { adopt?: boolean }): Promise<boolean> {
  return exclusive(async () => {
    if (options?.adopt) trackingWanted = true;
    if (!trackingWanted) return false;
    const foreground = await Location.getForegroundPermissionsAsync().catch(() => null);
    if (foreground?.status !== Location.PermissionStatus.GRANTED) return false;
    if (watcherNeedsRestart({ hasSubscription: foregroundSubscription !== null, lastSampleAtMs, nowMs: Date.now() })) {
      await startForegroundWatch();
    }
    try {
      await startBackgroundTaskIfGranted();
    } catch (bgError) {
      console.warn("Background location resume failed:", bgError);
    }
    return foregroundSubscription !== null;
  });
}

/** Stops both foreground watcher and background OS task. */
export async function stopLocationUpdates(): Promise<void> {
  return exclusive(async () => {
    trackingWanted = false;
    lastSampleAtMs = 0;
    await stopWatchers();
  });
}
