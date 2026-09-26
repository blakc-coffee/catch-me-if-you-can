import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { PermissionsAndroid, Platform } from "react-native";
import { onBackgroundSamples } from "./session/sessionRuntime";
import type { StoredPosition } from "../types";

export const LOCATION_TASK_NAME = "openverse-background-location";

export type TrackingPermissionResult =
  | { ok: true }
  | { ok: false; reason: "foreground-denied" | "background-denied" | "notification-denied" | "unavailable" };

let foregroundSubscription: Location.LocationSubscription | null = null;

export async function isTracking(): Promise<boolean> {
  const bg = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME).catch(() => false);
  return bg || foregroundSubscription !== null;
}

/** Requests permissions and starts tracking. Starts foreground watcher immediately, then registers background task safely. */
export async function startLocationUpdates(): Promise<TrackingPermissionResult> {
  // 1. Request foreground permission first
  const foreground = await Location.requestForegroundPermissionsAsync().catch(() => null);
  if (foreground?.status !== Location.PermissionStatus.GRANTED) {
    return { ok: false, reason: "foreground-denied" };
  }

  // 2. Start foreground watcher so coordinates flow immediately while the app is open
  if (!foregroundSubscription) {
    try {
      foregroundSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 5,
        },
        (loc) => {
          const sample: StoredPosition = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            accuracy: loc.coords.accuracy,
            altitude: loc.coords.altitude,
            heading: loc.coords.heading,
            speed: loc.coords.speed,
            timestamp: loc.timestamp,
          };
          void onBackgroundSamples([sample]).catch((err) =>
            console.warn("Foreground sample handling warning:", err)
          );
        }
      );
    } catch (err) {
      console.warn("watchPositionAsync warning:", err);
    }
  }

  // 3. Request notifications permission for Android 13+
  if (Platform.OS === "android" && Number(Platform.Version) >= 33) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => undefined);
  }

  // 4. Safely check background permission before starting OS background task
  try {
    const bgPerm = await Location.getBackgroundPermissionsAsync().catch(() => null);
    if (bgPerm?.status === Location.PermissionStatus.GRANTED) {
      const taskAvailable = await TaskManager.isAvailableAsync().catch(() => false);
      if (taskAvailable) {
        const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME).catch(() => false);
        if (!alreadyRegistered) {
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
      }
    } else {
      void Location.requestBackgroundPermissionsAsync().catch(() => undefined);
    }
  } catch (bgError) {
    console.warn("Background location task not started (falling back to foreground tracking):", bgError);
  }

  return { ok: true };
}

/** Stops both foreground watcher and background OS task. */
export async function stopLocationUpdates(): Promise<void> {
  if (foregroundSubscription) {
    try {
      foregroundSubscription.remove();
    } catch {}
    foregroundSubscription = null;
  }

  try {
    const registered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME).catch(() => false);
    if (registered) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
  } catch (err) {
    console.warn("stopLocationUpdates warning:", err);
  }
}
