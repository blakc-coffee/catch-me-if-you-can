import { Platform } from "react-native";
import { getApp } from "@react-native-firebase/app";
import { initializeAppCheck, ReactNativeFirebaseAppCheckProvider } from "@react-native-firebase/app-check";
import { connectAuthEmulator, getAuth } from "@react-native-firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "@react-native-firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "@react-native-firebase/functions";
import { FUNCTIONS_REGION } from "./contract";

export const useFirebaseEmulators = process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATORS === "true";

const defaultHost = Platform.OS === "android" ? "10.0.2.2" : "127.0.0.1";
const firebaseEmulatorHost = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST ?? defaultHost;

let configured = false;

/**
 * App Check attests that callable requests come from this app on a genuine
 * device (Play Integrity). The backend requires it for location, artifact and
 * answer callables in production. Development and emulator builds use the
 * debug provider; register the printed debug token (or
 * EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN) in Firebase Console to call a real
 * project from them. Release builds always use Play Integrity.
 */
function configureAppCheck(): void {
  try {
    const debug = __DEV__ || useFirebaseEmulators;
    const debugToken = debug ? process.env.EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN : undefined;
    const provider = new ReactNativeFirebaseAppCheckProvider();
    provider.configure({
      android: { provider: debug ? "debug" : "playIntegrity", ...(debugToken ? { debugToken } : {}) },
      apple: { provider: debug ? "debug" : "appAttestWithDeviceCheckFallback", ...(debugToken ? { debugToken } : {}) },
    });
    initializeAppCheck(getApp(), { provider, isTokenAutoRefreshEnabled: true });
  } catch (err) {
    console.warn("App Check initialization skipped/failed safely:", err);
  }
}

/** Must run before the first Auth, Firestore, or Functions request. */
export function configureFirebase(): void {
  if (configured || Platform.OS === "web") return;
  configured = true;
  configureAppCheck();
  if (!useFirebaseEmulators) return;

  connectAuthEmulator(getAuth(), `http://${firebaseEmulatorHost}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(getFirestore(), firebaseEmulatorHost, 8080);
  connectFunctionsEmulator(getFunctions(undefined, FUNCTIONS_REGION), firebaseEmulatorHost, 5001);
}
