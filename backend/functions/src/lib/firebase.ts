import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Admin SDK singletons. In Cloud Functions and the emulator the project and
 * credentials come from the environment; nothing is embedded in the repo.
 */
function app() {
  return getApps()[0] ?? initializeApp();
}

let firestore: Firestore | undefined;

export function db(): Firestore {
  if (!firestore) {
    firestore = getFirestore(app());
    firestore.settings({ ignoreUndefinedProperties: true });
  }
  return firestore;
}

export function auth() {
  return getAuth(app());
}
