// Refuse to run anywhere but the emulator: these tests wipe the database.
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error("Emulator tests must run under `firebase emulators:exec` (npm run test:emulator in backend/).");
}
process.env.GCLOUD_PROJECT = "demo-openverse";
