import { Platform } from "react-native";
import { connectAuthEmulator, getAuth } from "@react-native-firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "@react-native-firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "@react-native-firebase/functions";
import { FUNCTIONS_REGION } from "./contract";

export const useFirebaseEmulators = process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATORS === "true";

const defaultHost = Platform.OS === "android" ? "10.0.2.2" : "127.0.0.1";
export const firebaseEmulatorHost = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST ?? defaultHost;

let configured = false;

/** Must run before the first Auth, Firestore, or Functions request. */
export function configureFirebase(): void {
  if (configured || !useFirebaseEmulators || Platform.OS === "web") return;

  connectAuthEmulator(getAuth(), `http://${firebaseEmulatorHost}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(getFirestore(), firebaseEmulatorHost, 8080);
  connectFunctionsEmulator(getFunctions(undefined, FUNCTIONS_REGION), firebaseEmulatorHost, 5001);
  configured = true;
}

