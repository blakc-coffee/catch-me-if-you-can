import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { claimArtifact } from "../../src/artifacts/claimArtifact.js";
import { assignUser } from "../../src/auth/assignUser.js";
import { createOrSyncProfile } from "../../src/auth/profile.js";
import { createBroadcast } from "../../src/broadcasts/createBroadcast.js";
import { eliminatePlayer, setGameStatus } from "../../src/game/admin.js";
import { auth, db } from "../../src/lib/firebase.js";
import { mirrorPuzzle } from "../../src/puzzles/mirror.js";
import { submitPuzzleAnswer } from "../../src/puzzles/submitPuzzleAnswer.js";
import { joinTeam } from "../../src/teams/joinTeam.js";
import { deleteLocationHistory, uploadLocationBatch } from "../../src/telemetry/locationBatches.js";
import { stopTracking, updateTelemetry } from "../../src/telemetry/updateTelemetry.js";
import type { SeededArtifact } from "../../scripts/seedGame.js";
import { CODES, docData, expectReason, makeUser, onCampus, resetEmulators, seed } from "./helpers.js";

let qr: Map<string, SeededArtifact>;
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
  it("writes the latest position with server-derived zone and server timestamp", async () => {
    const s = await seeker("alpha", "Echo");
    await expect(updateTelemetry(s, fix({ speedMps: 2 }))).resolves.toMatchObject({ zoneId: "academic_1", inBounds: true });
    const doc = await docData<Record<string, unknown>>(`seekers/${s.uid}`);
    expect(doc).toMatchObject({ active: true, teamId: "alpha", name: "Echo", zoneId: "academic_1", status: "in_transit", speedKmh: 7.2 });
    expect(doc!.lastPing).toBeInstanceOf(Timestamp);
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

  it("stopTracking hides the seeker until the next accepted update", async () => {
    await resetEmulators();
    qr = await seed({ telemetryMinIntervalSec: 1 });
    const s = await seeker();
    await updateTelemetry(s, fix());
    await expect(stopTracking(s, {})).resolves.toEqual({ trackingEnabled: false });
    expect(await docData(`seekers/${s.uid}`)).toMatchObject({ active: false, trackingEnabled: false, status: "offline" });
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

describe("claimArtifact", () => {
  it("rejects malformed and unknown codes identically", async () => {
    const s = await seeker();
    await expectReason(claimArtifact(s, { payload: "https://evil.example/qr" }), "INVALID_ARTIFACT_CODE");
    await expectReason(claimArtifact(s, { payload: "OV-does-not-exist" }), "INVALID_ARTIFACT_CODE");
    await expectReason(claimArtifact(s, { payload: ".." }), "INVALID_ARTIFACT_CODE");
  });

  it("claims once per team, atomically updating claim, unlock, team and player", async () => {
    const s = await seeker("alpha");
    const r = await claimArtifact(s, { payload: code("a11") });
    expect(r).toMatchObject({ status: "CLAIMED", name: "Artifact 11", points: 25, teamArtifactsClaimed: 1, totalArtifacts: 15, puzzle: { puzzleId: "case-01", title: "The Programmer" } });
    expect(await docData("teams/alpha")).toMatchObject({ artifactsClaimed: 1, score: 25 });
    expect(await docData(`users/${s.uid}`)).toMatchObject({ score: 25 });
    expect(await docData("puzzleUnlocks/alpha_case-01")).toMatchObject({ teamId: "alpha", artifactId: code("a11") });
  });

  it("fails duplicate claims — also from a teammate — without changing progress", async () => {
    const [a, b] = [await seeker("alpha"), await seeker("alpha")];
    await claimArtifact(a, { payload: code("a01") });
    const err = await expectReason(claimArtifact(b, { payload: ` ${code("a01")}\n` }), "ARTIFACT_ALREADY_CLAIMED");
    expect(err.details).toMatchObject({ artifactId: code("a01") });
    expect(await docData("teams/alpha")).toMatchObject({ artifactsClaimed: 1, score: 25 });
    // Another team can still claim it.
    await expect(claimArtifact(await seeker("bravo"), { payload: code("a01") })).resolves.toMatchObject({ status: "CLAIMED", teamArtifactsClaimed: 1 });
  });

  it("is idempotent under concurrent scans by the whole team", async () => {
    const team = await Promise.all([seeker(), seeker(), seeker()]);
    const results = await Promise.allSettled(team.flatMap((s) => [claimArtifact(s, { payload: code("a02") }), claimArtifact(s, { payload: code("a02") })]));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await docData("teams/alpha")).toMatchObject({ artifactsClaimed: 1, score: 25 });
  });

  it("returns DECOY with the redirect for wrong codes and awards nothing", async () => {
    const s = await seeker();
    await expect(claimArtifact(s, { payload: code("d01") })).resolves.toMatchObject({ status: "DECOY", name: "Decoy Key", redirectUrl: "https://example.com/wrong" });
    expect((await docData("teams/alpha"))?.score ?? 0).toBe(0);
  });

  it("refuses hiders, team-less seekers, eliminated players, inactive codes and ended games", async () => {
    await expectReason(claimArtifact(await hider(), { payload: code("a03") }), "ROLE_NOT_ALLOWED");
    await expectReason(claimArtifact(await makeUser("seeker"), { payload: code("a03") }), "NO_TEAM");
    const s = await seeker();
    await eliminatePlayer(await makeUser("surveillance"), { uid: s.uid });
    await expectReason(claimArtifact(s, { payload: code("a03") }), "PLAYER_ELIMINATED");
    await db().doc(`artifacts/${code("a04")}`).update({ isActive: false });
    await expectReason(claimArtifact(await seeker(), { payload: code("a04") }), "INVALID_ARTIFACT_CODE");
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
