import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpsError } from "firebase-functions/v2/https";
import { expect } from "vitest";
import { createOrSyncProfile, syncClaims } from "../../src/auth/profile.js";
import type { CallContext } from "../../src/lib/context.js";
import { auth, db } from "../../src/lib/firebase.js";
import type { ErrorReason, Role } from "../../src/shared/contract.js";
import { seedGame, type SeedData, type SeededArtifact } from "../../scripts/seedGame.js";

export const PROJECT_ID = "demo-openverse";
const here = path.dirname(fileURLToPath(import.meta.url));

export const seedData: SeedData = JSON.parse(
  readFileSync(path.join(here, "..", "..", "scripts", "seed-data.example.json"), "utf8"),
);
export const CODES = { alpha: "ALPHA-DEV-2026", bravo: "BRAVO-DEV-2026", ghost: "GHOST-DEV-2026", shade: "SHADE-DEV-2026" } as const;

export async function resetEmulators(): Promise<void> {
  const fs = process.env.FIRESTORE_EMULATOR_HOST!;
  const au = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
  const r1 = await fetch(`http://${fs}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const r2 = await fetch(`http://${au}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
  if (!r1.ok || !r2.ok) throw new Error(`emulator reset failed: ${r1.status} ${r2.status}`);
}

/** Seeds the example game; returns artifacts by seed key (a01…a15, d01, d02). */
export async function seed(game: Partial<SeedData["game"]> = {}): Promise<Map<string, SeededArtifact>> {
  const { artifacts } = await seedGame(db(), { ...seedData, game: { ...seedData.game, ...game } });
  return new Map(artifacts.map((a) => [a.key, a]));
}

let counter = 0;

/**
 * Creates an Auth user + profile and places them the way an admin would
 * (role + team in the users doc, mirrored to claims).
 */
export async function makeUser(role: Role, teamId: string | null = null, name?: string): Promise<CallContext> {
  counter += 1;
  const email = `${role}${counter}-${Date.now()}@iiitkottayam.ac.in`;
  const record = await auth().createUser({ email, password: "password123", emailVerified: true });
  const ctx: CallContext = { uid: record.uid, email, emailVerified: true, signInProvider: "password" };
  await createOrSyncProfile(ctx, { name: name ?? `${role} ${counter}` });
  if (role !== "seeker" || teamId) {
    await db().collection("users").doc(record.uid).update({ role, teamId });
    await syncClaims(record.uid, role, teamId);
  }
  return ctx;
}

export async function expectReason(p: Promise<unknown>, reason: ErrorReason): Promise<HttpsError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(HttpsError);
    expect((err as HttpsError).details).toMatchObject({ reason });
    return err as HttpsError;
  }
  throw new Error(`expected rejection with ${reason}, but call succeeded`);
}

export const onCampus = { lat: 9.754904, lon: 76.649988 }; // Academic Block 1

export async function docData<T = Record<string, unknown>>(p: string): Promise<T | undefined> {
  return (await db().doc(p).get()).data() as T | undefined;
}
