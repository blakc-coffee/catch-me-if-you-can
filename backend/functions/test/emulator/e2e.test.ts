/**
 * End-to-end through the Functions emulator with the client SDK: proves the
 * deployed callable wrappers enforce auth, surface typed `details.reason`, and
 * that the puzzle-mirror trigger runs.
 */
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signOut, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, doc, getDoc, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions, type FunctionsError } from "firebase/functions";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db as adminDb } from "../../src/lib/firebase.js";
import { CALLABLES, FUNCTIONS_REGION, type ErrorReason } from "../../src/shared/contract.js";
import type { SeededArtifact } from "../../scripts/seedGame.js";
import { CODES, PROJECT_ID, onCampus, resetEmulators, seed } from "./helpers.js";

let app: FirebaseApp;
let clientAuth: Auth;
let fns: Functions;
let qr: Map<string, SeededArtifact>;

beforeAll(() => {
  app = initializeApp({ projectId: PROJECT_ID, apiKey: "demo-api-key", authDomain: `${PROJECT_ID}.firebaseapp.com` }, "e2e");
  clientAuth = getAuth(app);
  connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  fns = getFunctions(app, FUNCTIONS_REGION);
  connectFunctionsEmulator(fns, "127.0.0.1", 5001);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(":");
  connectFirestoreEmulator(getFirestore(app), host!, Number(port));
});
afterAll(async () => app && deleteApp(app));

beforeEach(async () => {
  await signOut(clientAuth);
  await resetEmulators();
  qr = await seed();
});

const call = <Req, Res>(name: keyof typeof CALLABLES) => httpsCallable<Req, Res>(fns, CALLABLES[name], { timeout: 30_000 });

async function expectCallReason(p: Promise<unknown>, reason: ErrorReason): Promise<FunctionsError> {
  try {
    await p;
  } catch (e) {
    const err = e as FunctionsError;
    expect(err.details).toMatchObject({ reason });
    return err;
  }
  throw new Error(`expected ${reason}`);
}

describe("callable endpoints", () => {
  // One test per callable: the first call to each spins up an emulator worker (cold start).
  it.each(Object.keys(CALLABLES) as (keyof typeof CALLABLES)[])("%s rejects unauthenticated calls", async (name) => {
    const err = await expectCallReason(call(name)({}), "UNAUTHENTICATED");
    expect(err.code).toBe("functions/unauthenticated");
  });

  it("runs the seeker flow: profile → join team → telemetry → scan → solve", async () => {
    const { user } = await createUserWithEmailAndPassword(clientAuth, "e2e-seeker@test.dev", "password123");

    const profile = await call<{ name: string }, { profile: { role: string; teamId: string | null }; claimsUpdated: boolean }>("createOrSyncProfile")({ name: "E2E" });
    expect(profile.data).toMatchObject({ profile: { role: "seeker", teamId: null }, claimsUpdated: true });

    await expectCallReason(call("claimArtifact")({ payload: qr.get("a11")!.qrCode }), "NO_TEAM");
    await expectCallReason(call("joinTeam")({ joinCode: "WRONG-CODE" }), "INVALID_JOIN_CODE");
    await expect(call("joinTeam")({ joinCode: CODES.alpha })).resolves.toMatchObject({ data: { role: "seeker", team: { teamId: "alpha" } } });
    expect((await user.getIdTokenResult(true)).claims).toMatchObject({ role: "seeker", teamId: "alpha" });

    await expect(call("updateTelemetry")({ ...onCampus, accuracyM: 5, clientTs: Date.now() })).resolves.toMatchObject({ data: { zoneId: "academic_1" } });
    await expect(call("claimArtifact")({ payload: qr.get("d01")!.qrCode })).resolves.toMatchObject({ data: { status: "DECOY" } });
    await expect(call("claimArtifact")({ payload: qr.get("a11")!.qrCode })).resolves.toMatchObject({
      data: { status: "CLAIMED", teamArtifactsClaimed: 1, puzzle: { puzzleId: "case-01" } },
    });
    await expectCallReason(call("claimArtifact")({ payload: qr.get("a11")!.qrCode }), "ARTIFACT_ALREADY_CLAIMED");

    // The team unlock lets the seeker read the answer-free puzzle text; the answer doc stays private.
    const db = getFirestore(app);
    const pub = (await getDoc(doc(db, "puzzlePublic", "case-01"))).data()!;
    expect(pub).toMatchObject({ title: "The Programmer" });
    expect(Object.keys(pub)).not.toContain("answer");
    await expect(getDoc(doc(db, "puzzles", "case-01"))).rejects.toThrow();

    await expect(call("submitPuzzleAnswer")({ puzzleId: "case-01", answer: "DHH" })).resolves.toMatchObject({ data: { status: "SOLVED", tokensAwarded: 1 } });
    expect((await getDoc(doc(db, "users", user.uid))).data()).toMatchObject({ score: 75, eliminationTokens: 1, teamId: "alpha" });
    expect((await getDoc(doc(db, "teams", "alpha"))).data()).toMatchObject({ score: 75, tokens: 1 });
  });

  it("surfaces validation and size errors with typed reasons", async () => {
    await createUserWithEmailAndPassword(clientAuth, "e2e-v@test.dev", "password123");
    await call("createOrSyncProfile")({});
    await expectCallReason(call("createOrSyncProfile")({ role: "admin" }), "INVALID_ARGUMENT");
    await expectCallReason(call("joinTeam")({ joinCode: "x".repeat(20_000) }), "PAYLOAD_TOO_LARGE");
    await expectCallReason(call("createBroadcast")({}), "ROLE_NOT_ALLOWED");
  });

  it("mirrors admin edits of puzzles into puzzlePublic via the trigger (without the answer)", async () => {
    await adminDb().doc("puzzles/trig-1").set({ title: "Trigger", question: "Q?", answer: "a" });
    let pub: Record<string, unknown> | undefined;
    for (let i = 0; i < 40 && !pub; i++) {
      await new Promise((r) => setTimeout(r, 250));
      pub = (await adminDb().doc("puzzlePublic/trig-1").get()).data();
    }
    expect(pub).toMatchObject({ title: "Trigger", question: "Q?", audience: ["seeker"], isSolved: false });
    expect(Object.keys(pub!)).not.toContain("answer");
  });
});
