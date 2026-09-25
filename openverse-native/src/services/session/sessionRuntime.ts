import { Platform } from "react-native";
import { getAuth } from "@react-native-firebase/auth";
import { doc, getDocFromServer, getFirestore } from "@react-native-firebase/firestore";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { getCallableReason, stopRemoteTracking, updateTelemetry, uploadLocationBatch } from "../firebase/callables";
import { startLocationUpdates, stopLocationUpdates } from "../locationService";
import { localStore } from "../storage";
import { createScope, type StorageScope } from "./scope";
import { syncLocationQueue as syncCore, type SyncResult } from "./telemetrySyncCore";
import { eventIdOf, type GameSnapshot, type TrackingDecision } from "./trackingPolicy";
import * as session from "./trackingSession";

/** Production wiring of the tracking session to Firebase, AsyncStorage and expo-location. */
export const sessionDeps: session.TrackingSessionDeps = {
  store: localStore,
  currentUid: () => getAuth().currentUser?.uid ?? null,
  startLocationUpdates,
  stopLocationUpdates,
  stopRemoteTracking: async () => {
    await stopRemoteTracking();
  },
  log: (message, error) => console.warn(message, error),
};

/**
 * The only way to obtain a StorageScope in the app: the UID comes from the
 * authenticated Firebase user, never from a caller.
 */
export function scopeForCurrentUser(game: GameSnapshot | null | undefined): StorageScope | null {
  const uid = getAuth().currentUser?.uid;
  return uid ? createScope(uid, eventIdOf(game)) : null;
}

export const handleAuthChange = (uid: string | null) => session.handleAuthChange(sessionDeps, uid);
export const enforceAuthorization = (scope: StorageScope | null, decision: TrackingDecision) =>
  session.enforceAuthorization(sessionDeps, scope, decision);
export const startTracking = (scope: StorageScope, decision: TrackingDecision) => session.startTracking(sessionDeps, scope, decision);
export const stopTrackingByUser = () => session.stopTrackingByUser(sessionDeps);

export function syncLocationQueue(scope: StorageScope, decision: TrackingDecision): Promise<SyncResult> {
  return syncCore(
    { store: localStore, currentUid: sessionDeps.currentUid, uploadLocationBatch, updateTelemetry, reasonOf: getCallableReason },
    scope,
    decision,
  );
}

/**
 * Sign-out: stops the background task, hides the live position while still
 * signed in (skipped when offline), deletes this device's account-scoped
 * state, then signs out of Firebase and Google so the next sign-in can pick a
 * different account. Safe offline and safe to call repeatedly.
 */
export async function signOutSafely(): Promise<void> {
  await session.signOut(sessionDeps, {
    signOutProvider: async () => {
      if (Platform.OS !== "web") await GoogleSignin.signOut();
    },
    signOutFirebase: async () => {
      if (getAuth().currentUser) await getAuth().signOut();
    },
  });
}

/** Headless background-task gate (see createBackgroundGate). */
export const onBackgroundSamples = session.createBackgroundGate(sessionDeps, async (uid) => {
  const db = getFirestore();
  const [profile, game] = await Promise.all([getDocFromServer(doc(db, "users", uid)), getDocFromServer(doc(db, "game", "state"))]);
  return {
    profile: profile.exists() ? (profile.data() ?? null) : null,
    game: game.exists() ? (game.data() ?? null) : null,
  };
});
