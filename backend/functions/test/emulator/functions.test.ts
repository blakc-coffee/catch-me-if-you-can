import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claimArtifact } from "../../src/artifacts/claimArtifact.js";
import { assignUser } from "../../src/auth/assignUser.js";
import { createOrSyncProfile } from "../../src/auth/profile.js";
import { createBroadcast } from "../../src/broadcasts/createBroadcast.js";
import { eliminatePlayer, setGameStatus } from "../../src/game/admin.js";
import { getMissionState } from "../../src/game/missionState.js";
import { auth, db } from "../../src/lib/firebase.js";
import { raceHooks } from "../../src/lib/raceHooks.js";
import { mirrorPuzzle } from "../../src/puzzles/mirror.js";
import { submitPuzzleAnswer } from "../../src/puzzles/submitPuzzleAnswer.js";
import { joinTeam } from "../../src/teams/joinTeam.js";
import { deleteLocationHistory, uploadLocationBatch } from "../../src/telemetry/locationBatches.js";
import { stopTracking, updateTelemetry } from "../../src/telemetry/updateTelemetry.js";
import { rotateArtifactCode, seedGame, type SeededArtifact } from "../../scripts/seedGame.js";
import { CODES, docData, expectReason, makeUser, onCampus, resetEmulators, seed, seedData } from "./helpers.js";

let qr: Map<string, SeededArtifact>;
/** The artifact's single QR code, shared by every team. */
const code = (key: string) => qr.get(key)!.qrCode;
const fix = (extra: Record<string, unknown> = {}) => ({ ...onCampus, accuracyM: 6, battery: 80, signal: "GOOD", clientTs: Date.now(), ...extra });
const seeker = (team = "alpha", name?: string) => makeUser("seeker", team, name);
const hider = (team = "ghost", name?: string) => makeUser("hider", team, name);

beforeEach(async () => {
  await resetEmulators();
  qr = await seed();
});

describe("compatibility with existing seekerdb documents", () => {
  it("backfills server fields on admin-provisioned users without changing name, role or team", async () => {
    const rec = await auth().createUser({ email: "seeker1@example.com" });
    await auth().setCustomUserClaims(rec.uid, { role: "seeker" });
    const now = Timestamp.now();
    await db().doc(`users/${rec.uid}`).set({ name: "Seeker One", email: "seeker1@example.com", role: "seeker", teamId: "alpha", createdAt: now, updatedAt: now });

    const res = await createOrSyncProfile({ uid: rec.uid, email: "seeker1@example.com", emailVerified: true, signInProvider: "password" }, {});
    expect(res.profile).toMatchObject({ name: "Seeker One", role: "seeker", teamId: "alpha", status: "active", score: 0, eliminationTokens: 0 });
    expect(res.claimsUpdated).toBe(true);
    expect((await auth().getUser(rec.uid)).customClaims).toEqual({ role: "seeker", teamId: "alpha" });
    expect(await docData(`users/${rec.uid}`)).toMatchObject({ name: "Seeker One", role: "seeker", teamId: "alpha", playerId: res.profile.playerId });
  });

  it("claims an artifact keyed by its printed QR code and solves a plaintext-answer puzzle", async () => {
    const now = Timestamp.now();
    await db().doc("puzzles/croJmpXUZnLSYZCYKEH7").set({ title: "Puzzle 1", question: "Sample question", answer: "Secret", createdAt: now });
    await mirrorPuzzle(db(), "croJmpXUZnLSYZCYKEH7", (await db().doc("puzzles/croJmpXUZnLSYZCYKEH7").get()).data());
    await db().doc("artifacts/QR-KEY-001").set({ qrCode: "QR-KEY-001", qrType: "correct", name: "Golden Key", description: "The real artifact", areaId: "academic-1", puzzleId: "croJmpXUZnLSYZCYKEH7", redirectUrl: null, isActive: true, createdAt: now });
    await db().doc("artifacts/QR-DECOY-001").set({ qrCode: "QR-DECOY-001", qrType: "wrong", name: "Decoy Key", description: "A decoy artifact", areaId: "academic-1", puzzleId: null, redirectUrl: "https://example.com/wrong", isActive: true, createdAt: now });

    const s = await seeker();
    await expect(claimArtifact(s, { payload: "QR-DECOY-001" })).resolves.toEqual({ status: "DECOY", artifactId: "QR-DECOY-001", name: "Decoy Key", redirectUrl: "https://example.com/wrong" });
    const claimed = await claimArtifact(s, { payload: "QR-KEY-001" });
    expect(claimed).toMatchObject({ status: "CLAIMED", points: 25, puzzle: { puzzleId: "croJmpXUZnLSYZCYKEH7", title: "Puzzle 1", question: "Sample question" } });
    await expect(submitPuzzleAnswer(s, { puzzleId: "croJmpXUZnLSYZCYKEH7", answer: " SECRET " })).resolves.toMatchObject({ status: "SOLVED", pointsAwarded: 100, tokensAwarded: 1 });
    const pub = await docData<Record<string, unknown>>("puzzlePublic/croJmpXUZnLSYZCYKEH7");
    expect(pub).toMatchObject({ isSolved: true, title: "Puzzle 1" });
    expect(Object.keys(pub!)).not.toContain("answer");
  });

  it("treats an unknown role string as seeker, never more", async () => {
    const rec = await auth().createUser({ email: "odd@example.com" });
    await db().doc(`users/${rec.uid}`).set({ name: "Odd", email: "odd@example.com", role: "superuser", teamId: null });
    const res = await createOrSyncProfile({ uid: rec.uid, email: "odd@example.com", emailVerified: true, signInProvider: "password" }, {});
    expect(res.profile.role).toBe("seeker");
    expect((await auth().getUser(rec.uid)).customClaims).toMatchObject({ role: "seeker" });
  });
});

describe("profiles, roles and teams", () => {
  it("new sign-ups become team-less seekers with server-owned fields", async () => {
    const rec = await auth().createUser({ email: "new@test.dev" });
    const ctx = { uid: rec.uid, email: "new@test.dev", emailVerified: true, signInProvider: "password" };
    const r = await createOrSyncProfile(ctx, { name: "Nova" });
    expect(r.profile).toMatchObject({ role: "seeker", teamId: null, score: 0, eliminationTokens: 0, status: "active", name: "Nova" });
    expect((await auth().getUser(rec.uid)).customClaims).toEqual({ role: "seeker", teamId: null });
    await expect(createOrSyncProfile(ctx, { name: "Nova Two" })).resolves.toMatchObject({ claimsUpdated: false, profile: { name: "Nova Two" } });
  });

  it("re-syncs a tampered or stale claim from the users doc", async () => {
    const s = await seeker();
    await auth().setCustomUserClaims(s.uid, { role: "admin", teamId: "ghost" });
    await expect(createOrSyncProfile(s, {})).resolves.toMatchObject({ claimsUpdated: true });
    expect((await auth().getUser(s.uid)).customClaims).toMatchObject({ role: "seeker", teamId: "alpha" });
  });

  it("joinTeam uses hashed, rate-limited codes and sets role from the team type", async () => {
    const u = await makeUser("seeker");
    await expectReason(joinTeam(u, { joinCode: "NOPE-NOPE" }), "INVALID_JOIN_CODE");
    await expect(joinTeam(u, { joinCode: "ghost dev 2026" })).resolves.toMatchObject({ role: "hider", team: { teamId: "ghost", type: "hider" } });
    expect((await auth().getUser(u.uid)).customClaims).toMatchObject({ role: "hider", teamId: "ghost" });
    await expectReason(joinTeam(await makeUser("surveillance"), { joinCode: CODES.alpha }), "ROLE_NOT_ALLOWED");

    const brute = await makeUser("seeker");
    for (let i = 0; i < 10; i++) await expectReason(joinTeam(brute, { joinCode: `WRONG-${i}-CODE` }), "INVALID_JOIN_CODE");
    await expectReason(joinTeam(brute, { joinCode: CODES.alpha }), "RATE_LIMITED");
  });

  it("only admins assign roles/teams, and roles must match the team type", async () => {
    const admin = await makeUser("admin");
    const s = await makeUser("seeker");
    await expectReason(assignUser(s, { uid: s.uid, role: "admin" }), "ROLE_NOT_ALLOWED");
    await expectReason(assignUser(admin, { uid: admin.uid, role: "seeker" }), "CANNOT_CHANGE_OWN_ROLE");
    await expectReason(assignUser(admin, { uid: s.uid, teamId: "ghost" }), "TEAM_ROLE_MISMATCH");
    await expectReason(assignUser(admin, { uid: s.uid, teamId: "no-such-team" }), "TEAM_NOT_FOUND");
    await expect(assignUser(admin, { uid: s.uid, teamId: "bravo" })).resolves.toEqual({ uid: s.uid, role: "seeker", teamId: "bravo" });
    await expect(assignUser(admin, { uid: s.uid, role: "hider", teamId: "shade" })).resolves.toMatchObject({ role: "hider", teamId: "shade" });
    expect((await auth().getUser(s.uid)).customClaims).toMatchObject({ role: "hider", teamId: "shade" });
  });
});

describe("updateTelemetry", () => {
  /** Stores an accepted live fix `secondsAgo` in the past, as updateTelemetry would have. */
  async function priorFix(uid: string, secondsAgo: number, at: { lat: number; lon: number } = onCampus, clientSecondsAgo = secondsAgo) {
    const ms = Date.now() - secondsAgo * 1000;
    await db().doc(`seekers/${uid}`).set({
      uid, teamId: "alpha", playerId: "OP-TEST", name: "Prior", active: true, trackingEnabled: true, status: "active",
      lat: at.lat, lon: at.lon, accuracyM: 6, clientTs: Date.now() - clientSecondsAgo * 1000, fixServerMs: ms,
      lastPing: Timestamp.fromMillis(ms), updatedAt: Timestamp.fromMillis(ms),
    });
  }
  const sports = { lat: 9.754, lon: 76.649392 };
  const dining = { lat: 9.755678, lon: 76.650101 };
  /** `meters` north of onCampus. */
  const north = (meters: number) => ({ lat: onCampus.lat + meters / 111_195, lon: onCampus.lon });

  it("accepts the first fix and writes the latest position with server-derived zone and server timestamp", async () => {
    const s = await seeker("alpha", "Echo");
    await expect(updateTelemetry(s, fix({ speedMps: 2 }))).resolves.toMatchObject({ zoneId: "academic_1", inBounds: true });
    const doc = await docData<Record<string, unknown>>(`seekers/${s.uid}`);
    expect(doc).toMatchObject({ active: true, teamId: "alpha", name: "Echo", zoneId: "academic_1", status: "in_transit", speedKmh: 7.2 });
    expect(doc!.lastPing).toBeInstanceOf(Timestamp);
    expect(Math.abs((doc!.fixServerMs as number) - Date.now())).toBeLessThan(10_000);
  });

  it("accepts ordinary movement from the previous accepted fix", async () => {
    const s = await seeker();
    await priorFix(s.uid, 30);
    await expect(updateTelemetry(s, fix(north(150)))).resolves.toMatchObject({ inBounds: true });
    expect(await docData(`seekers/${s.uid}`)).toMatchObject({ lat: north(150).lat });
  });

  it("rejects an impossible jump and keeps the previous position", async () => {
    const s = await seeker();
    await priorFix(s.uid, 10, sports);
    await expectReason(updateTelemetry(s, fix(dining)), "TELEMETRY_IMPLAUSIBLE_MOVEMENT");
    expect(await docData(`seekers/${s.uid}`)).toMatchObject({ lat: sports.lat, lon: sports.lon });
  });

  it("rejects a jump hidden behind a backdated previous fix and a future-dated new fix", async () => {
    const s = await seeker();
    // Previous fix claimed to be 55 s old but reached the server 10 s ago; the new
    // one claims to be 25 s in the future. ~200 m would pass over a claimed 80 s.
    await priorFix(s.uid, 10, sports, 55);
    await expectReason(updateTelemetry(s, fix({ ...dining, clientTs: Date.now() + 25_000 })), "TELEMETRY_IMPLAUSIBLE_MOVEMENT");
  });

  it("rejects stale, future and non-monotonic timestamps", async () => {
    const s = await seeker();
    await expectReason(updateTelemetry(s, fix({ clientTs: Date.now() - 5 * 60_000 })), "TELEMETRY_STALE_FIX");
    await expectReason(updateTelemetry(s, fix({ clientTs: Date.now() + 5 * 60_000 })), "TELEMETRY_FUTURE_FIX");
    await priorFix(s.uid, 5);
    const prev = (await docData<{ clientTs: number }>(`seekers/${s.uid}`))!.clientTs;
    await expectReason(updateTelemetry(s, fix({ clientTs: prev })), "TELEMETRY_NON_MONOTONIC");
    const s2 = await seeker();
    await priorFix(s2.uid, 5);
    await expectReason(updateTelemetry(s2, fix({ clientTs: Date.now() - 20_000 })), "TELEMETRY_NON_MONOTONIC");
  });

  it("rejects unacceptable accuracy and out-of-campus coordinates without writing", async () => {
    const s = await seeker();
    await expectReason(updateTelemetry(s, fix({ accuracyM: 120 })), "TELEMETRY_LOW_ACCURACY");
    await expectReason(updateTelemetry(s, fix({ lat: 9.76, lon: 76.65 })), "TELEMETRY_OUT_OF_BOUNDS");
    await expectReason(updateTelemetry(s, fix({ lat: 0, lon: 0 })), "TELEMETRY_OUT_OF_BOUNDS");
    expect(await docData(`seekers/${s.uid}`)).toBeUndefined();
  });

  it("enforces role, team and throttle", async () => {
    await expectReason(updateTelemetry(await makeUser("seeker"), fix()), "NO_TEAM");
    await expectReason(updateTelemetry(await hider(), fix()), "ROLE_NOT_ALLOWED");
    const s = await seeker();
    const ok = await updateTelemetry(s, fix());
    expect(ok.nextAllowedAtMs - ok.acceptedAtMs).toBe(10_000);
    const err = await expectReason(updateTelemetry(s, fix()), "RATE_LIMITED");
    expect((err.details as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(9_000);
  });

  it("reports a terminal reason (not RATE_LIMITED) once a seeker is eliminated", async () => {
    const s = await seeker();
    await updateTelemetry(s, fix());
    await eliminatePlayer(await makeUser("surveillance"), { uid: s.uid });
    await expectReason(updateTelemetry(s, fix()), "PLAYER_ELIMINATED");
    expect(await docData(`seekers/${s.uid}`)).toMatchObject({ active: false, status: "eliminated" });
  });

  it("refuses after role loss, suspension, pause and game end", async () => {
    const admin = await makeUser("admin");
    const moved = await seeker();
    await assignUser(admin, { uid: moved.uid, role: "hider", teamId: "ghost" });
    await expectReason(updateTelemetry(moved, fix()), "ROLE_NOT_ALLOWED");

    const suspended = await seeker();
    await db().doc(`users/${suspended.uid}`).update({ status: "suspended" });
    await expectReason(updateTelemetry(suspended, fix()), "ACCOUNT_SUSPENDED");

    const s = await seeker();
    await setGameStatus(admin, { status: "paused" });
    await expectReason(updateTelemetry(s, fix()), "GAME_NOT_ACTIVE");
    await setGameStatus(admin, { status: "ended" });
    await expectReason(updateTelemetry(s, fix()), "GAME_ENDED");
    expect(await docData(`seekers/${s.uid}`)).toBeUndefined();
  });

  it("stopTracking hides the seeker until the next accepted update, keeping the movement baseline", async () => {
    await resetEmulators();
    qr = await seed({ telemetryMinIntervalSec: 1 });
    const s = await seeker();
    await updateTelemetry(s, fix());
    await expect(stopTracking(s, {})).resolves.toEqual({ trackingEnabled: false });
    expect(await docData(`seekers/${s.uid}`)).toMatchObject({ active: false, trackingEnabled: false, status: "offline" });
    await new Promise((r) => setTimeout(r, 1_100));
    await expectReason(updateTelemetry(s, fix(dining)), "TELEMETRY_IMPLAUSIBLE_MOVEMENT");
    await new Promise((r) => setTimeout(r, 1_100));
    await updateTelemetry(s, fix());
    expect(await docData(`seekers/${s.uid}`)).toMatchObject({ active: true });
  });
});

describe("uploadLocationBatch", () => {
  const samples = (n: number, offset = 0) =>
    Array.from({ length: n }, (_, i) => ({ t: Date.now() - 60_000 + i * 1000 + offset, lat: 9.7549 + i * 1e-5, lon: 76.65, acc: 5 }));

  it("stores once, dedupes retries (even reordered), and sets the TTL", async () => {
    const s = await seeker();
    const body = { batchId: "b_1700000000000_abcdef01", samples: samples(20) };
    await expect(uploadLocationBatch(s, body)).resolves.toEqual({ batchId: body.batchId, status: "STORED", count: 20 });
    await expect(uploadLocationBatch(s, body)).resolves.toMatchObject({ status: "DUPLICATE" });
    await expect(uploadLocationBatch(s, { ...body, samples: [...body.samples].reverse() })).resolves.toMatchObject({ status: "DUPLICATE" });
    const docs = await db().collection(`seekers/${s.uid}/locationBatches`).get();
    expect(docs.size).toBe(1);
    const stored = docs.docs[0]!.data();
    expect(stored).toMatchObject({ teamId: "alpha", count: 20 });
    const days = (stored.expireAt.toMillis() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
  });

  it("rejects batch-id reuse for different samples", async () => {
    const s = await seeker();
    await uploadLocationBatch(s, { batchId: "b_conflict_00000001", samples: samples(3) });
    await expectReason(uploadLocationBatch(s, { batchId: "b_conflict_00000001", samples: samples(3, 7) }), "BATCH_ID_CONFLICT");
  });

  it("handles concurrent duplicate submissions without double-storing", async () => {
    const s = await seeker();
    const body = { batchId: "b_concurrent_000001", samples: samples(50) };
    const results = await Promise.all(Array.from({ length: 5 }, () => uploadLocationBatch(s, body)));
    expect(results.filter((r) => r.status === "STORED")).toHaveLength(1);
    expect((await db().collection(`seekers/${s.uid}/locationBatches`).get()).size).toBe(1);
  });

  it("keeps accepting queued history after elimination, and lets the owner delete it", async () => {
    const s = await seeker();
    await eliminatePlayer(await makeUser("admin"), { uid: s.uid });
    await uploadLocationBatch(s, { batchId: "b_after_elim_00001", samples: samples(5) });
    await uploadLocationBatch(s, { batchId: "b_after_elim_00002", samples: samples(5, 99) });
    await expectReason(uploadLocationBatch(await hider(), { batchId: "b_hider_0000000001", samples: samples(1) }), "ROLE_NOT_ALLOWED");
    await expect(deleteLocationHistory(s, {})).resolves.toEqual({ deleted: 2 });
  });
});

describe("claimArtifact (one shared QR code per artifact)", () => {
  it("rejects malformed and unknown codes identically", async () => {
    const s = await seeker();
    await expectReason(claimArtifact(s, { payload: "https://evil.example/qr" }), "INVALID_ARTIFACT_CODE");
    await expectReason(claimArtifact(s, { payload: "OV-does-not-exist" }), "INVALID_ARTIFACT_CODE");
    await expectReason(claimArtifact(s, { payload: ".." }), "INVALID_ARTIFACT_CODE");
    expect((await db().collection("artifactClaims").get()).size).toBe(0);
  });

  it("lets every team claim the same QR once, keeping claims, unlocks and points team-scoped", async () => {
    const [alpha, bravo] = [await seeker("alpha"), await seeker("bravo")];
    // 1. alpha claims.
    await expect(claimArtifact(alpha, { payload: code("a11") })).resolves.toMatchObject({
      status: "CLAIMED", points: 25, teamArtifactsClaimed: 1, totalArtifacts: 15, puzzle: { puzzleId: "case-01", title: "The Programmer" },
    });
    // 2. bravo claims the very same code.
    await expect(claimArtifact(bravo, { payload: code("a11") })).resolves.toMatchObject({ status: "CLAIMED", teamArtifactsClaimed: 1, puzzle: { puzzleId: "case-01" } });
    // 3–4. repeats by either team are rejected without changing anything.
    const again = await expectReason(claimArtifact(alpha, { payload: code("a11") }), "ARTIFACT_ALREADY_CLAIMED");
    expect(again.details).toMatchObject({ artifactId: code("a11"), puzzleId: "case-01" });
    await expectReason(claimArtifact(bravo, { payload: ` ${code("a11")}\n` }), "ARTIFACT_ALREADY_CLAIMED");
    // 10. each team got exactly one claim, one unlock and the points once.
    expect(await docData("teams/alpha")).toMatchObject({ artifactsClaimed: 1, score: 25 });
    expect(await docData("teams/bravo")).toMatchObject({ artifactsClaimed: 1, score: 25 });
    expect(await docData(`users/${alpha.uid}`)).toMatchObject({ score: 25 });
    expect(await docData(`users/${bravo.uid}`)).toMatchObject({ score: 25 });
    expect(await docData("puzzleUnlocks/alpha_case-01")).toMatchObject({ teamId: "alpha", artifactId: code("a11") });
    expect(await docData("puzzleUnlocks/bravo_case-01")).toMatchObject({ teamId: "bravo", artifactId: code("a11") });
    expect((await db().collection("artifactClaims").where("artifactId", "==", code("a11")).get()).size).toBe(2);
  });

  it("rejects a teammate's repeat of the team's claim", async () => {
    const [a, b] = [await seeker("alpha"), await seeker("alpha")];
    await claimArtifact(a, { payload: code("a01") });
    await expectReason(claimArtifact(b, { payload: code("a01") }), "ARTIFACT_ALREADY_CLAIMED");
    expect(await docData("teams/alpha")).toMatchObject({ artifactsClaimed: 1, score: 25 });
    expect(await docData(`users/${b.uid}`)).toMatchObject({ score: 0 });
  });

  it("5. concurrent claims by one team produce exactly one success", async () => {
    const team = await Promise.all([seeker(), seeker(), seeker()]);
    const results = await Promise.allSettled(team.flatMap((s) => [claimArtifact(s, { payload: code("a02") }), claimArtifact(s, { payload: code("a02") })]));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await docData("teams/alpha")).toMatchObject({ artifactsClaimed: 1, score: 25 });
  });

  it("6. concurrent claims by different teams both succeed", async () => {
    const players = await Promise.all([seeker("alpha"), seeker("alpha"), seeker("bravo"), seeker("bravo")]);
    const results = await Promise.allSettled(players.map((s) => claimArtifact(s, { payload: code("a03") })));
    const wins = results.flatMap((r, i) => (r.status === "fulfilled" ? [i < 2 ? "alpha" : "bravo"] : []));
    expect(wins.sort()).toEqual(["alpha", "bravo"]);
    expect(await docData("teams/alpha")).toMatchObject({ artifactsClaimed: 1, score: 25 });
    expect(await docData("teams/bravo")).toMatchObject({ artifactsClaimed: 1, score: 25 });
  });

  it("7. decoys return DECOY with the redirect for every team and award nothing", async () => {
    for (const team of ["alpha", "bravo"]) {
      await expect(claimArtifact(await seeker(team), { payload: code("d01") })).resolves.toMatchObject({ status: "DECOY", name: "Decoy Key", redirectUrl: "https://example.com/wrong" });
      expect((await docData(`teams/${team}`))?.score ?? 0).toBe(0);
    }
    expect((await db().collection("artifactClaims").get()).size).toBe(0);
  });

  it("8. a rotated code replaces the old one for everyone without allowing a second claim", async () => {
    const alpha = await seeker("alpha");
    await claimArtifact(alpha, { payload: code("a06") });
    const { newCode } = await rotateArtifactCode(db(), code("a06"));
    // The old code is dead for every team.
    await expectReason(claimArtifact(await seeker("bravo"), { payload: code("a06") }), "INVALID_ARTIFACT_CODE");
    // alpha already has this artifact: the new code does not pay out twice.
    await expectReason(claimArtifact(alpha, { payload: newCode }), "ARTIFACT_ALREADY_CLAIMED");
    // bravo claims it with the new code.
    await expect(claimArtifact(await seeker("bravo"), { payload: newCode })).resolves.toMatchObject({ status: "CLAIMED" });
    expect(await docData("teams/alpha")).toMatchObject({ artifactsClaimed: 1, score: 25 });
    expect(await docData("teams/bravo")).toMatchObject({ artifactsClaimed: 1, score: 25 });
    // The total still counts the artifact once, and a re-seed keeps the new code.
    const reseeded = await seed();
    expect(reseeded.get("a06")!.qrCode).toBe(newCode);
    await expect(claimArtifact(await seeker("bravo"), { payload: code("a08") })).resolves.toMatchObject({ totalArtifacts: 15 });
  });

  it("9. inactive (revoked) artifacts are rejected for every team", async () => {
    await db().doc(`artifacts/${code("a04")}`).update({ isActive: false });
    await expectReason(claimArtifact(await seeker("alpha"), { payload: code("a04") }), "INVALID_ARTIFACT_CODE");
    await expectReason(claimArtifact(await seeker("bravo"), { payload: code("a04") }), "INVALID_ARTIFACT_CODE");
    await expect(rotateArtifactCode(db(), code("a04"))).rejects.toThrow(/inactive/);
  });

  it("refuses hiders, team-less seekers, eliminated players and ended games", async () => {
    await expectReason(claimArtifact(await hider(), { payload: code("a05") }), "ROLE_NOT_ALLOWED");
    await expectReason(claimArtifact(await makeUser("seeker"), { payload: code("a05") }), "NO_TEAM");
    const s = await seeker();
    await eliminatePlayer(await makeUser("surveillance"), { uid: s.uid });
    await expectReason(claimArtifact(s, { payload: code("a05") }), "PLAYER_ELIMINATED");
    const s2 = await seeker();
    await setGameStatus(await makeUser("admin"), { status: "ended" });
    await expectReason(claimArtifact(s2, { payload: code("a05") }), "GAME_ENDED");
  });
});

describe("submitPuzzleAnswer", () => {
  it("public puzzle mirrors and artifacts never contain answers", async () => {
    for (const snap of (await db().collection("puzzlePublic").get()).docs) {
      expect(Object.keys(snap.data())).not.toContain("answer");
    }
    expect((await db().collection("puzzlePublic").get()).size).toBe(4);
  });

  it("keeps scan-to-unlock puzzles locked until the team claims the artifact", async () => {
    const [a, b] = [await seeker("alpha"), await seeker("alpha")];
    await expectReason(submitPuzzleAnswer(a, { puzzleId: "case-01", answer: "DHH" }), "PUZZLE_LOCKED");
    await claimArtifact(b, { payload: code("a11") }); // teammate unlocks it
    await expect(submitPuzzleAnswer(a, { puzzleId: "case-01", answer: "d h h" })).resolves.toEqual({ status: "INCORRECT", puzzleId: "case-01" });
    await expect(submitPuzzleAnswer(a, { puzzleId: "case-01", answer: "  dHh " })).resolves.toMatchObject({ status: "SOLVED", pointsAwarded: 50, tokensAwarded: 1, teamTokens: 1 });
    await expect(submitPuzzleAnswer(b, { puzzleId: "case-01", answer: "dhh" })).resolves.toMatchObject({ status: "ALREADY_CLAIMED", solvedByYourTeam: true });
    expect(await docData("teams/alpha")).toMatchObject({ score: 75, tokens: 1, puzzlesSolved: 1 });
    expect(await docData("puzzlePublic/case-01")).toMatchObject({ isSolved: true, solvedBy: { uid: a.uid, teamId: "alpha", teamName: "Team Alpha" } });
  });

  it("hides puzzles outside the caller's audience", async () => {
    await expectReason(submitPuzzleAnswer(await hider(), { puzzleId: "case-01", answer: "dhh" }), "PUZZLE_NOT_FOUND");
    await expectReason(submitPuzzleAnswer(await seeker(), { puzzleId: "ch-01", answer: "hello seeker" }), "PUZZLE_NOT_FOUND");
    await expectReason(submitPuzzleAnswer(await seeker(), { puzzleId: "no-such", answer: "x" }), "PUZZLE_NOT_FOUND");
  });

  it("awards exactly one team under concurrent correct submissions", async () => {
    const players = await Promise.all([
      ...Array.from({ length: 4 }, (_, i) => hider("ghost", `Ghost ${i}`)),
      ...Array.from({ length: 4 }, (_, i) => hider("shade", `Shade ${i}`)),
    ]);
    const results = await Promise.all(players.map((p) => submitPuzzleAnswer(p, { puzzleId: "ch-03", answer: "Seventeen" })));
    expect(results.filter((r) => r.status === "SOLVED")).toHaveLength(1);
    expect(results.filter((r) => r.status === "ALREADY_CLAIMED")).toHaveLength(7);

    const claim = await docData<{ uid: string; teamId: string; tokensAwarded: number }>("puzzleClaims/ch-03");
    expect(claim).toMatchObject({ tokensAwarded: 2 });
    const [ghost, shade] = [await docData<{ tokens?: number }>("teams/ghost"), await docData<{ tokens?: number }>("teams/shade")];
    expect((ghost?.tokens ?? 0) + (shade?.tokens ?? 0)).toBe(2);
    const users = await Promise.all(players.map((p) => docData<{ eliminationTokens: number }>(`users/${p.uid}`)));
    expect(users.reduce((sum, u) => sum + u!.eliminationTokens, 0)).toBe(2);
    results.forEach((r, i) => {
      const team = i < 4 ? "ghost" : "shade";
      if (r.status === "ALREADY_CLAIMED") expect(r.solvedByYourTeam).toBe(team === claim!.teamId);
    });
  });

  it("rate limits answer guessing per puzzle", async () => {
    const h = await hider();
    for (let i = 0; i < 10; i++) await expect(submitPuzzleAnswer(h, { puzzleId: "ch-02", answer: `guess ${i}` })).resolves.toMatchObject({ status: "INCORRECT" });
    await expectReason(submitPuzzleAnswer(h, { puzzleId: "ch-02", answer: "22" }), "RATE_LIMITED");
  });
});

describe("getMissionState", () => {
  it("reports real, zeroed progress for a new seeker", async () => {
    const r = await getMissionState(await seeker("alpha"), {});
    expect(r).toMatchObject({ gameStatus: "active", totalArtifacts: 15, puzzles: [], team: { teamId: "alpha", name: "Team Alpha", score: 0, tokens: 0, artifactsClaimed: 0, puzzlesSolved: 0 } });
    expect(r.eventId).toBe((await docData<{ eventId: string }>("game/state"))!.eventId);
  });

  it("lists every puzzle the team unlocked, oldest first, without answers, and tracks solves", async () => {
    const [a, mate] = [await seeker("alpha"), await seeker("alpha")];
    await claimArtifact(a, { payload: code("a11") });
    const first = await getMissionState(mate, {});
    expect(first.team).toMatchObject({ artifactsClaimed: 1, score: 25 });
    expect(first.puzzles).toEqual([
      { puzzleId: "case-01", title: "The Programmer", question: expect.any(String), unlockedAtMs: expect.any(Number), solved: false, solvedByYourTeam: false },
    ]);
    expect(JSON.stringify(first)).not.toMatch(/dhh|answer/i);
    await submitPuzzleAnswer(a, { puzzleId: "case-01", answer: "dhh" });
    const after = await getMissionState(mate, {});
    expect(after.puzzles[0]).toMatchObject({ solved: true, solvedByYourTeam: true });
    expect(after.team).toMatchObject({ puzzlesSolved: 1, tokens: 1 });
    // Another team neither sees alpha's unlock nor alpha's progress.
    expect(await getMissionState(await seeker("bravo"), {})).toMatchObject({ puzzles: [], team: { teamId: "bravo", artifactsClaimed: 0 } });
  });

  it("shows hiders the puzzles addressed to them", async () => {
    const r = await getMissionState(await hider("ghost"), {});
    expect(r.puzzles.map((p) => p.puzzleId)).toEqual(["ch-01", "ch-02", "ch-03"]);
    expect(r.team).toMatchObject({ teamId: "ghost", type: "hider" });
  });

  it("is role-aware: no team, staff and unknown input are refused; eliminated players can still read", async () => {
    await expectReason(getMissionState(await makeUser("seeker"), {}), "NO_TEAM");
    await expectReason(getMissionState(await makeUser("surveillance"), {}), "ROLE_NOT_ALLOWED");
    await expectReason(getMissionState(await makeUser("admin"), {}), "ROLE_NOT_ALLOWED");
    await expectReason(getMissionState(await seeker(), { teamId: "bravo" }), "INVALID_ARGUMENT");
    const s = await seeker();
    await eliminatePlayer(await makeUser("admin"), { uid: s.uid });
    await expect(getMissionState(s, {})).resolves.toMatchObject({ team: { teamId: "alpha" } });
  });
});

describe("createBroadcast", () => {
  it("is restricted to surveillance and admin", async () => {
    await expectReason(createBroadcast(await hider(), {}), "ROLE_NOT_ALLOWED");
    await expectReason(createBroadcast(await seeker(), {}), "ROLE_NOT_ALLOWED");
  });

  it("snapshots current server-side positions and enforces the cooldown", async () => {
    const [a, b, stale] = [await seeker("alpha", "Alpha"), await seeker("bravo", "Bravo"), await seeker("alpha", "Stale")];
    await updateTelemetry(a, fix());
    await updateTelemetry(b, fix({ lat: 9.755678, lon: 76.650101 }));
    await updateTelemetry(stale, fix());
    await db().doc(`seekers/${stale.uid}`).update({ lastPing: Timestamp.fromMillis(Date.now() - 3_600_000) });

    const surv = await makeUser("surveillance");
    const r = await createBroadcast(surv, {});
    expect(r.totalActiveSeekers).toBe(2);
    const bc = await docData<{ seekerPositions: { name: string; zoneId: string; teamId: string }[]; createdAt: Timestamp }>(`broadcasts/${r.broadcastId}`);
    expect(bc!.createdAt).toBeInstanceOf(Timestamp);
    expect(bc!.seekerPositions.map((p) => [p.name, p.teamId, p.zoneId]).sort()).toEqual([
      ["Alpha", "alpha", "academic_1"],
      ["Bravo", "bravo", "dining"],
    ]);
    const err = await expectReason(createBroadcast(surv, {}), "BROADCAST_COOLDOWN");
    expect((err.details as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(590_000);
  });
});

describe("transactions re-check what decides the outcome", () => {
  afterEach(() => {
    delete raceHooks.answerBeforeAward;
    delete raceHooks.adminBeforeCommit;
  });

  it("a correct answer does not score if the game ends before the award commits", async () => {
    const s = await seeker("alpha");
    await claimArtifact(s, { payload: code("a11") });
    const admin = await makeUser("admin");
    raceHooks.answerBeforeAward = async () => {
      delete raceHooks.answerBeforeAward;
      await setGameStatus(admin, { status: "ended" });
    };
    await expectReason(submitPuzzleAnswer(s, { puzzleId: "case-01", answer: "dhh" }), "GAME_ENDED");
    expect(await docData("puzzleClaims/case-01")).toBeUndefined();
    const team = await docData<{ score: number; puzzlesSolved?: number }>("teams/alpha");
    expect(team?.score).toBe(25);
    expect(team?.puzzlesSolved ?? 0).toBe(0);
  });

  it("a player moved to a team without the unlock cannot score for it", async () => {
    const s = await seeker("alpha");
    await claimArtifact(s, { payload: code("a11") });
    const admin = await makeUser("admin");
    raceHooks.answerBeforeAward = async () => {
      delete raceHooks.answerBeforeAward;
      await assignUser(admin, { uid: s.uid, teamId: "bravo" });
    };
    await expectReason(submitPuzzleAnswer(s, { puzzleId: "case-01", answer: "dhh" }), "PUZZLE_LOCKED");
    expect(await docData("puzzleClaims/case-01")).toBeUndefined();
    expect((await docData("teams/bravo"))?.score ?? 0).toBe(0);
  });

  it("an answer changed by an admin mid-request is judged against the new answer", async () => {
    const s = await seeker("alpha");
    await claimArtifact(s, { payload: code("a11") });
    raceHooks.answerBeforeAward = async () => {
      delete raceHooks.answerBeforeAward;
      await db().doc("puzzles/case-01").update({ answer: "david" });
    };
    await expect(submitPuzzleAnswer(s, { puzzleId: "case-01", answer: "dhh" })).resolves.toEqual({ status: "INCORRECT", puzzleId: "case-01" });
    expect(await docData("puzzleClaims/case-01")).toBeUndefined();
  });

  it("the normal answer path still awards exactly once", async () => {
    const s = await seeker("alpha");
    await claimArtifact(s, { payload: code("a11") });
    let hookRuns = 0;
    raceHooks.answerBeforeAward = async () => {
      hookRuns += 1;
    };
    await expect(submitPuzzleAnswer(s, { puzzleId: "case-01", answer: "dhh" })).resolves.toMatchObject({ status: "SOLVED" });
    expect(hookRuns).toBe(1);
  });

  it("an admin demoted mid-request cannot change the game state", async () => {
    const admin = await makeUser("admin");
    const other = await makeUser("admin");
    raceHooks.adminBeforeCommit = async () => {
      delete raceHooks.adminBeforeCommit;
      await assignUser(other, { uid: admin.uid, role: "seeker" });
    };
    await expectReason(setGameStatus(admin, { status: "ended" }), "ROLE_NOT_ALLOWED");
    expect(await docData("game/state")).toMatchObject({ status: "active" });
  });

  it("a surveillance user demoted mid-request cannot eliminate a player", async () => {
    const surv = await makeUser("surveillance");
    const target = await seeker();
    const admin = await makeUser("admin");
    raceHooks.adminBeforeCommit = async () => {
      delete raceHooks.adminBeforeCommit;
      await assignUser(admin, { uid: surv.uid, role: "seeker" });
    };
    await expectReason(eliminatePlayer(surv, { uid: target.uid }), "ROLE_NOT_ALLOWED");
    expect(await docData(`users/${target.uid}`)).toMatchObject({ status: "active" });
  });

  it("a deactivated join code is refused", async () => {
    const codes = await db().collection("teamJoinCodes").where("teamId", "==", "alpha").get();
    await codes.docs[0]!.ref.update({ active: false });
    await expectReason(joinTeam(await makeUser("seeker"), { joinCode: CODES.alpha }), "INVALID_JOIN_CODE");
    await expect(joinTeam(await makeUser("seeker"), { joinCode: CODES.bravo })).resolves.toMatchObject({ team: { teamId: "bravo" } });
  });

  it("a rejected live fix does not use up the rate limit", async () => {
    const s = await seeker();
    const ms = Date.now() - 10_000;
    await db().doc(`seekers/${s.uid}`).set({
      uid: s.uid, teamId: "alpha", playerId: "OP-T", name: "T", active: true, trackingEnabled: true, status: "active",
      lat: 9.754, lon: 76.649392, accuracyM: 6, clientTs: ms, fixServerMs: ms, lastPing: Timestamp.fromMillis(ms), updatedAt: Timestamp.fromMillis(ms),
    });
    await expectReason(updateTelemetry(s, fix({ lat: 9.755678, lon: 76.650101 })), "TELEMETRY_IMPLAUSIBLE_MOVEMENT");
    await expectReason(updateTelemetry(s, fix({ lat: 9.755678, lon: 76.650101 })), "TELEMETRY_IMPLAUSIBLE_MOVEMENT");
    await expect(updateTelemetry(s, fix({ lat: 9.754, lon: 76.6494 }))).resolves.toMatchObject({ inBounds: true });
  });
});

describe("re-seeding reconciles the seed file", () => {
  it("retires artifacts removed from the file and removes deleted optional fields", async () => {
    const removed = code("a15");
    const data = structuredClone(seedData);
    data.artifacts = data.artifacts.filter((a) => a.key !== "a15").map((a) => (a.key === "a01" ? { ...a, points: 40 } : a));
    data.puzzles = data.puzzles.map((p) => (p.id === "case-01" ? { ...p, hints: undefined, points: undefined } : p));
    let result = await seedGame(db(), data);
    expect(result.retired).toBe(1);
    expect(await docData(`artifacts/${removed}`)).toMatchObject({ isActive: false });
    await expectReason(claimArtifact(await seeker(), { payload: removed }), "INVALID_ARTIFACT_CODE");
    expect(await docData(`artifacts/${code("a01")}`)).toMatchObject({ points: 40 });
    const puzzle = await docData<Record<string, unknown>>("puzzles/case-01");
    expect(puzzle).not.toHaveProperty("hints");
    expect(puzzle).not.toHaveProperty("points");
    expect(await docData("puzzlePublic/case-01")).toMatchObject({ hints: [], points: 100 });

    // Dropping the override removes it again; a second identical re-seed retires nothing.
    result = await seedGame(db(), { ...data, artifacts: data.artifacts.map((a) => (a.key === "a01" ? { ...a, points: undefined } : a)) });
    expect(result.retired).toBe(0);
    expect(await docData(`artifacts/${code("a01")}`)).not.toHaveProperty("points");
    await expect(claimArtifact(await seeker(), { payload: code("a01") })).resolves.toMatchObject({ points: 25 });
  });
});

describe("game lifecycle", () => {
  it("only admins change game status; ending it deactivates live telemetry", async () => {
    await expectReason(setGameStatus(await makeUser("surveillance"), { status: "ended" }), "ROLE_NOT_ALLOWED");
    const s = await seeker();
    await updateTelemetry(s, fix());
    await expect(setGameStatus(await makeUser("admin"), { status: "ended" })).resolves.toEqual({ status: "ended", seekersDeactivated: 1 });
    expect(await docData(`seekers/${s.uid}`)).toMatchObject({ active: false, trackingEnabled: false });
    await expectReason(updateTelemetry(s, fix()), "GAME_ENDED");
  });

  it("creates game/state with defaults when missing, and a missing game is not active", async () => {
    await db().doc("game/state").delete();
    await expectReason(updateTelemetry(await seeker(), fix()), "GAME_NOT_ACTIVE");
    await setGameStatus(await makeUser("admin"), { status: "active" });
    expect(await docData("game/state")).toMatchObject({ status: "active", telemetryMinIntervalSec: 10, broadcastCooldownSec: 600 });
  });

  it("a paused game rejects play but still stores history", async () => {
    await db().doc("game/state").update({ status: "paused", updatedAt: FieldValue.serverTimestamp() });
    const s = await seeker();
    await expectReason(claimArtifact(s, { payload: code("a06") }), "GAME_NOT_ACTIVE");
    await expect(uploadLocationBatch(s, { batchId: "b_paused_0000000001", samples: [{ t: Date.now() - 1000, lat: 9.75, lon: 76.65, acc: 5 }] })).resolves.toMatchObject({ status: "STORED" });
  });
});
