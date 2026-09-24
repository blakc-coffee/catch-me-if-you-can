import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { appendLocations } from "./storage";
import type { StoredPosition } from "../types";

export const LOCATION_TASK_NAME = "openverse-background-location";

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

  await appendLocations(samples);
});
