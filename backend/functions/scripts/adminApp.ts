/**
 * Initialises the Admin SDK for CLI scripts.
 *
 *  - Emulator (default): points at the local Auth/Firestore emulators.
 *  - Production (--production --project <id>): uses Application Default
 *    Credentials if GOOGLE_APPLICATION_CREDENTIALS is set; otherwise it derives
 *    a short-lived ADC file from your `firebase login` session. No
 *    service-account key files are needed or created.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applicationDefault, initializeApp, type App } from "firebase-admin/app";

export interface AdminTarget {
  production: boolean;
  projectId: string;
}

/** backend/ — where firebase-tools is installed. */
const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Writes an Application Default Credentials file (type authorized_user) from
 * the Firebase CLI login, because the Firestore Admin SDK accepts only ADC or
 * certificate credentials. The file is owner-only in the OS temp dir and is
 * removed when the process exits.
 */
function adcFromFirebaseCli(projectId: string): string {
  const configPath = path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");
  if (!existsSync(configPath)) throw new Error("Not logged in: run `npx firebase login` first.");
  const token = JSON.parse(readFileSync(configPath, "utf8"))?.tokens?.refresh_token;
  if (!token) throw new Error("Firebase CLI has no refresh token: run `npx firebase login`.");
  // The CLI's public OAuth client (the same one `firebase login` used).
  const require = createRequire(import.meta.url);
  const api = require(require.resolve("firebase-tools/lib/api.js", { paths: [backendDir] }));

  const dir = mkdtempSync(path.join(os.tmpdir(), "openverse-adc-"));
  const file = path.join(dir, "adc.json");
  writeFileSync(
    file,
    JSON.stringify({
      type: "authorized_user",
      client_id: api.clientId(),
      client_secret: api.clientSecret(),
      refresh_token: token,
      quota_project_id: projectId,
    }),
    { mode: 0o600 },
  );
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return file;
}

export function initAdmin(target: AdminTarget): App {
  if (!target.production) {
    process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
    process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
    process.env.GCLOUD_PROJECT = target.projectId;
    return initializeApp({ projectId: target.projectId });
  }
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Emulator env vars are set; unset them before targeting production.");
  }
  process.env.GCLOUD_PROJECT = target.projectId;
  process.env.GOOGLE_APPLICATION_CREDENTIALS ??= adcFromFirebaseCli(target.projectId);
  return initializeApp({ projectId: target.projectId, credential: applicationDefault() });
}
