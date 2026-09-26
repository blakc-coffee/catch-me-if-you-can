import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { LOCATION_TASK_NAME, noteLocationSample } from "./locationService";
import { onBackgroundSamples } from "./session/sessionRuntime";
import type { StoredPosition } from "../types";

// Samples are stored only into the persisted active scope while it is
// collecting and owned by the signed-in user; otherwise the task stops itself.
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error || !data) return;

  try {
    const rawLocations = (data as any)?.locations;
    if (!rawLocations || !Array.isArray(rawLocations) || rawLocations.length === 0) return;

    const samples: StoredPosition[] = (rawLocations as Location.LocationObject[]).map(({ coords, timestamp }) => ({
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
      altitude: coords.altitude,
      heading: coords.heading,
      speed: coords.speed,
      timestamp,
    }));
    for (const sample of samples) noteLocationSample(sample.timestamp);

    await onBackgroundSamples(samples);
  } catch (err) {
    console.warn("Background location task handled exception:", err);
  }
});
