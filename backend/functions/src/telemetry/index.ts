import { callable } from "../lib/callable.js";
import * as batches from "./locationBatches.js";
import * as live from "./updateTelemetry.js";

export const updateTelemetry = callable("updateTelemetry", live.updateTelemetry, { maxInstances: 50 });
export const stopTracking = callable("stopTracking", live.stopTracking);
export const uploadLocationBatch = callable("uploadLocationBatch", batches.uploadLocationBatch, { maxInstances: 20 });
export const deleteLocationHistory = callable("deleteLocationHistory", batches.deleteLocationHistory, { timeoutSeconds: 120 });
