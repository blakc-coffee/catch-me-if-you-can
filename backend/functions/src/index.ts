/**
 * OpenVerse Cloud Functions (v2) for the seekerdb schema. Every callable
 * requires Firebase Auth, validates its payload, re-checks role/team from
 * Firestore, and is the only path by which game state (scores, tokens, claims,
 * roles, telemetry, broadcasts) changes.
 */
import { setGlobalOptions } from "firebase-functions/v2";
import { REGION } from "./config.js";

setGlobalOptions({ region: REGION });

export { assignUser, createOrSyncProfile } from "./auth/index.js";
export { joinTeam } from "./teams/index.js";
export { eliminatePlayer, setGameStatus } from "./game/index.js";
export { deleteLocationHistory, stopTracking, updateTelemetry, uploadLocationBatch } from "./telemetry/index.js";
export { claimArtifact } from "./artifacts/index.js";
export { onPuzzleWritten, submitPuzzleAnswer } from "./puzzles/index.js";
export { createBroadcast } from "./broadcasts/index.js";
