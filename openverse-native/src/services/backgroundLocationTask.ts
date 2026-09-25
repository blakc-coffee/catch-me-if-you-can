import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { LOCATION_TASK_NAME } from "./locationService";
import { onBackgroundSamples } from "./session/sessionRuntime";
import type { StoredPosition } from "../types";

export { LOCATION_TASK_NAME };

// Samples are stored only into the persisted active scope while it is
// collecting and owned by the signed-in user; otherwise the task stops itself.
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error || !data) return;

  const { locations } = data as { locations: Location.LocationObject[] };
  const samples: StoredPosition[] = locations.map(({ coords, timestamp }) => ({
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy,
    altitude: coords.altitude,
    heading: coords.heading,
    speed: coords.speed,
    timestamp
  }));

  await onBackgroundSamples(samples);
});
