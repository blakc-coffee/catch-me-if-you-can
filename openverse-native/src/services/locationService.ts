import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

export const LOCATION_TASK_NAME = "openverse-background-location";

export type TrackingPermissionResult =
  | { ok: true }
  | { ok: false; reason: "foreground-denied" | "background-denied" | "unavailable" };

export async function isTracking(): Promise<boolean> {
  return TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
}

/** Requests permissions and starts the OS task. Use session startTracking, which checks authorization first. */
export async function startLocationUpdates(): Promise<TrackingPermissionResult> {
  if (!(await TaskManager.isAvailableAsync())) {
    return { ok: false, reason: "unavailable" };
  }

  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== Location.PermissionStatus.GRANTED) {
    return { ok: false, reason: "foreground-denied" };
  }

  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== Location.PermissionStatus.GRANTED) {
    return { ok: false, reason: "background-denied" };
  }

  if (!(await isTracking())) {
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.High,
      distanceInterval: 10,
      timeInterval: 15000,
      deferredUpdatesDistance: 25,
      deferredUpdatesInterval: 30000,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "Openverse mission active",
        notificationBody: "Recording your location for the current mission.",
        notificationColor: "#663AF3",
        killServiceOnDestroy: false
      }
    });
  }

  return { ok: true };
}

/** Stops the OS task. Use session shutdownTracking, which also stops collection and cleans up. */
export async function stopLocationUpdates(): Promise<void> {
  if (await isTracking()) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
}
