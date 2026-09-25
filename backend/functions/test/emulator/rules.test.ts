import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { db } from "../../src/lib/firebase.js";
import type { Role } from "../../src/shared/contract.js";
import { PROJECT_ID, resetEmulators } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let env: RulesTestEnvironment;

beforeAll(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(":");
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(path.join(here, "..", "..", "..", "firestore.rules"), "utf8"), host: host!, port: Number(port) },
  });
});
afterAll(async () => env?.cleanup());

// Mirrors the shape of the existing seekerdb data.
const ALPHA = "12bbw9koSmBXoDjNWh1z";
const BRAVO = "bravoTeam000000000001";
const GHOST = "IqUkLh5EUc5Fzdr8j5Do";

beforeEach(async () => {
  await resetEmulators();
  const d = db();
  const w = d.batch();
  const user = (uid: string, role: Role, teamId: string | null) =>
    w.set(d.doc(`users/${uid}`), { name: uid, email: `${uid}@iiitkottayam.ac.in`, role, teamId, score: 0, eliminationTokens: 0, status: "active", playerId: `OP-${uid}` });
  user("s1", "seeker", ALPHA);
  user("s2", "seeker", BRAVO);
  user("h1", "hider", GHOST);
  user("surv", "surveillance", null);
  user("adm", "admin", null);
  w.set(d.doc(`teams/${ALPHA}`), { name: "Team Alpha", type: "seeker", score: 25, artifactsClaimed: 1 });
  w.set(d.doc(`teams/${BRAVO}`), { name: "Team Bravo", type: "seeker" });
  w.set(d.doc(`teams/${GHOST}`), { name: "Team Ghost", type: "hider" });
  w.set(d.doc("areas/lib"), { name: "Library", description: "Ground floor" });
  w.set(d.doc("artifacts/QR-KEY-001"), { qrCode: "QR-KEY-001", qrType: "correct", name: "Golden Key", puzzleId: "p1", isActive: true });
  w.set(d.doc("puzzles/p1"), { title: "Puzzle 1", question: "Sample question", answer: "secret" });
  w.set(d.doc("puzzles/p2"), { title: "Hider puzzle", question: "Q", answer: "x", audience: ["hider"] });
  // Mirror docs use ids with no puzzles/* doc, so the onPuzzleWritten trigger (running in the
  // Functions emulator) can never race with this setup.
  w.set(d.doc("puzzlePublic/pub1"), { title: "Puzzle 1", question: "Sample question", audience: ["seeker"], isSolved: false });
  w.set(d.doc("puzzlePublic/pub2"), { title: "Hider puzzle", question: "Q", audience: ["hider"], isSolved: false });
  w.set(d.doc(`puzzleUnlocks/${ALPHA}_pub1`), { teamId: ALPHA, puzzleId: "pub1", artifactId: "QR-KEY-001" });
  w.set(d.doc(`artifactClaims/${ALPHA}_abc`), { teamId: ALPHA, artifactId: "QR-KEY-001", claimedBy: "s1" });
  w.set(d.doc("puzzleClaims/p2"), { puzzleId: "p2", teamId: GHOST, uid: "h1" });
  w.set(d.doc("game/state"), { status: "active" });
  w.set(d.doc("seekers/s1"), { uid: "s1", teamId: ALPHA, active: true, lat: 9.75, lon: 76.65 });
  w.set(d.doc("seekers/s2"), { uid: "s2", teamId: BRAVO, active: false, lat: 9.75, lon: 76.65 });
  w.set(d.doc("seekers/s1/locationBatches/b1"), { uid: "s1", samples: [] });
  w.set(d.doc("seekers/s2/locationBatches/b2"), { uid: "s2", samples: [] });
  w.set(d.doc("broadcasts/bc1"), { seekerPositions: [] });
  w.set(d.doc("teamJoinCodes/def"), { teamId: ALPHA, active: true });
  w.set(d.doc("rateLimits/k"), { count: 1, windowStartMs: 0 });
  w.set(d.doc("artifactCodes/hash1"), { artifactId: "QR-KEY-001", teamId: ALPHA, isActive: true });
  await w.commit();
});

const TEAM: Record<string, string | null> = { s1: ALPHA, s2: BRAVO, h1: GHOST, surv: null, adm: null };

function as(uid: string, role: Role, teamId: string | null = TEAM[uid] ?? null): Firestore {
  return env.authenticatedContext(uid, {
    email: `${uid}@iiitkottayam.ac.in`,
    email_verified: true,
    role,
    teamId,
  }).firestore() as unknown as Firestore;
}
function anon(): Firestore {
  return env.unauthenticatedContext().firestore() as unknown as Firestore;
}

describe("unauthenticated users", () => {
  it("are rejected everywhere", async () => {
    const f = anon();
    for (const p of ["users/s1", `teams/${ALPHA}`, "areas/lib", "artifacts/QR-KEY-001", "puzzles/p1", "puzzlePublic/p1", "game/state", "seekers/s1", "broadcasts/bc1"]) {
      await assertFails(getDoc(doc(f, p)));
    }
    await assertFails(setDoc(doc(f, "users/x"), { role: "admin" }));
  });
});

describe("identity enforcement", () => {
  it("rejects unverified and non-institutional accounts", async () => {
    const unverified = env.authenticatedContext("s1", { email: "s1@iiitkottayam.ac.in", email_verified: false }).firestore();
    const external = env.authenticatedContext("s1", { email: "s1@gmail.com", email_verified: true }).firestore();
    await assertFails(getDoc(doc(unverified, "game/state")));
    await assertFails(getDoc(doc(external, "game/state")));
  });

  it("uses the users document instead of forged role and team claims", async () => {
    await assertFails(getDoc(doc(as("s1", "admin"), "puzzles/p1")));
    await assertSucceeds(getDoc(doc(as("adm", "seeker", ALPHA), "puzzles/p1")));
  });
});

describe("users", () => {
  it("owner and staff can read; other players cannot", async () => {
    await assertSucceeds(getDoc(doc(as("s1", "seeker"), "users/s1")));
    await assertFails(getDoc(doc(as("s1", "seeker"), "users/s2")));
    await assertSucceeds(getDoc(doc(as("surv", "surveillance"), "users/s1")));
    await assertSucceeds(getDoc(doc(as("adm", "admin"), "users/s1")));
  });

  it("players may rename themselves but never change role, team, score, tokens or status", async () => {
    const f = as("s1", "seeker");
    await assertSucceeds(updateDoc(doc(f, "users/s1"), { name: "Echo Agent" }));
    await assertFails(updateDoc(doc(f, "users/s1"), { name: "x" })); // too short
    await assertFails(updateDoc(doc(f, "users/s1"), { role: "admin" }));
    await assertFails(updateDoc(doc(f, "users/s1"), { teamId: BRAVO }));
    await assertFails(updateDoc(doc(f, "users/s1"), { score: 9999 }));
    await assertFails(updateDoc(doc(f, "users/s1"), { eliminationTokens: 50 }));
    await assertFails(updateDoc(doc(f, "users/s1"), { status: "suspended", name: "Echo" }));
    await assertFails(setDoc(doc(f, "users/s1"), { name: "s1", role: "admin" }));
    await assertFails(setDoc(doc(f, "users/new"), { name: "new", role: "seeker" }));
    await assertFails(deleteDoc(doc(f, "users/s1")));
  });

  it("role and team assignment goes through functions, even for admins", async () => {
    await assertFails(updateDoc(doc(as("adm", "admin"), "users/s1"), { role: "admin" }));
    await assertFails(updateDoc(doc(as("adm", "admin"), "users/s1"), { teamId: BRAVO }));
    await assertSucceeds(updateDoc(doc(as("adm", "admin"), "users/s1"), { name: "Renamed" }));
  });
});

describe("existing content collections", () => {
  it("teams and areas are readable by any signed-in user", async () => {
    await assertSucceeds(getDoc(doc(as("s1", "seeker"), `teams/${BRAVO}`)));
    await assertSucceeds(getDoc(doc(as("h1", "hider"), "areas/lib")));
  });

  it("admins manage teams but cannot touch server-owned counters", async () => {
    const f = as("adm", "admin");
    await assertSucceeds(setDoc(doc(f, "teams/new"), { name: "Team New", type: "seeker" }));
    await assertFails(setDoc(doc(f, "teams/new2"), { name: "Team New", type: "seeker", score: 100 }));
    await assertFails(setDoc(doc(f, "teams/new3"), { name: "Team New", type: "admin" }));
    await assertSucceeds(updateDoc(doc(f, `teams/${ALPHA}`), { name: "Alpha Squad" }));
    await assertFails(updateDoc(doc(f, `teams/${ALPHA}`), { score: 1000 }));
    await assertFails(updateDoc(doc(f, `teams/${ALPHA}`), { artifactsClaimed: 15 }));
    await assertFails(updateDoc(doc(as("s1", "seeker"), `teams/${ALPHA}`), { name: "Hacked" }));
  });

  it("artifact (QR) records are hidden from seekers and writable only by admins", async () => {
    await assertFails(getDoc(doc(as("s1", "seeker"), "artifacts/QR-KEY-001")));
    await assertFails(getDocs(collection(as("s1", "seeker"), "artifacts")));
    await assertFails(getDoc(doc(as("h1", "hider"), "artifacts/QR-KEY-001")));
    await assertSucceeds(getDoc(doc(as("surv", "surveillance"), "artifacts/QR-KEY-001")));
    await assertFails(setDoc(doc(as("h1", "hider"), "artifacts/QR-NEW"), { qrType: "correct" }));
    await assertSucceeds(setDoc(doc(as("adm", "admin"), "artifacts/QR-NEW"), { qrCode: "QR-NEW", qrType: "wrong", isActive: true }));
  });

  it("puzzle answers are readable by admins only", async () => {
    for (const [uid, role] of [["s1", "seeker"], ["h1", "hider"], ["surv", "surveillance"]] as const) {
      await assertFails(getDoc(doc(as(uid, role), "puzzles/p1")));
      await assertFails(getDocs(collection(as(uid, role), "puzzles")));
    }
    await assertSucceeds(getDoc(doc(as("adm", "admin"), "puzzles/p1")));
  });
});

describe("answer-free puzzle mirror", () => {
  it("seekers read a puzzle only after their team unlocked it", async () => {
    await assertSucceeds(getDoc(doc(as("s1", "seeker"), "puzzlePublic/pub1")));
    await assertFails(getDoc(doc(as("s2", "seeker"), "puzzlePublic/pub1")));
    await assertFails(getDoc(doc(as("s1", "seeker"), "puzzlePublic/pub2")));
    // A forged teamId claim still needs that team's unlock doc.
    await assertFails(getDoc(doc(as("s2", "seeker", BRAVO), "puzzlePublic/pub1")));
  });

  it("hiders read hider puzzles; staff read all; nobody writes", async () => {
    await assertSucceeds(getDoc(doc(as("h1", "hider"), "puzzlePublic/pub2")));
    await assertFails(getDoc(doc(as("h1", "hider"), "puzzlePublic/pub1")));
    await assertSucceeds(getDoc(doc(as("surv", "surveillance"), "puzzlePublic/pub1")));
    await assertFails(updateDoc(doc(as("s1", "seeker"), "puzzlePublic/pub1"), { isSolved: true }));
    await assertFails(updateDoc(doc(as("adm", "admin"), "puzzlePublic/pub1"), { isSolved: true }));
  });
});

describe("claims and unlocks", () => {
  it("are visible to the owning team and staff only", async () => {
    await assertSucceeds(getDoc(doc(as("s1", "seeker"), `artifactClaims/${ALPHA}_abc`)));
    await assertFails(getDoc(doc(as("s2", "seeker"), `artifactClaims/${ALPHA}_abc`)));
    await assertSucceeds(getDocs(query(collection(as("s1", "seeker"), "artifactClaims"), where("teamId", "==", ALPHA))));
    await assertFails(getDocs(collection(as("s1", "seeker"), "artifactClaims")));
    await assertSucceeds(getDoc(doc(as("s1", "seeker"), `puzzleUnlocks/${ALPHA}_pub1`)));
    await assertFails(getDoc(doc(as("s2", "seeker"), `puzzleUnlocks/${ALPHA}_pub1`)));
    await assertSucceeds(getDoc(doc(as("h1", "hider"), "puzzleClaims/p2")));
    await assertFails(getDoc(doc(as("s1", "seeker"), "puzzleClaims/p2")));
    await assertSucceeds(getDoc(doc(as("surv", "surveillance"), "puzzleClaims/p2")));
  });

  it("cannot be created or changed from the client", async () => {
    const f = as("s1", "seeker");
    await assertFails(setDoc(doc(f, `artifactClaims/${ALPHA}_new`), { teamId: ALPHA, artifactId: "QR-KEY-001" }));
    await assertFails(setDoc(doc(f, `puzzleUnlocks/${ALPHA}_p2`), { teamId: ALPHA, puzzleId: "p2" }));
    await assertFails(setDoc(doc(f, "puzzleClaims/p1"), { teamId: ALPHA, uid: "s1" }));
    await assertFails(setDoc(doc(as("adm", "admin"), "puzzleClaims/p1"), { teamId: ALPHA, uid: "s1" }));
  });
});

describe("telemetry", () => {
  it("seekers read only their own live telemetry and history", async () => {
    await assertSucceeds(getDoc(doc(as("s1", "seeker"), "seekers/s1")));
    await assertFails(getDoc(doc(as("s2", "seeker"), "seekers/s1")));
    await assertFails(getDoc(doc(as("h1", "hider"), "seekers/s1")));
    await assertSucceeds(getDoc(doc(as("s1", "seeker"), "seekers/s1/locationBatches/b1")));
    await assertFails(getDoc(doc(as("s1", "seeker"), "seekers/s2/locationBatches/b2")));
    await assertFails(getDocs(collection(as("s1", "seeker"), "seekers/s2/locationBatches")));
  });

  it("surveillance can read active seekers only, and no history; admins read all", async () => {
    const f = as("surv", "surveillance");
    await assertSucceeds(getDoc(doc(f, "seekers/s1")));
    await assertFails(getDoc(doc(f, "seekers/s2")));
    await assertSucceeds(getDocs(query(collection(f, "seekers"), where("active", "==", true))));
    await assertFails(getDocs(collection(f, "seekers")));
    await assertFails(getDoc(doc(f, "seekers/s1/locationBatches/b1")));
    await assertSucceeds(getDoc(doc(as("adm", "admin"), "seekers/s2/locationBatches/b2")));
  });

  it("clients cannot write telemetry, history or game state", async () => {
    const f = as("s1", "seeker");
    await assertFails(setDoc(doc(f, "seekers/s1"), { lat: 0, lon: 0 }));
    await assertFails(setDoc(doc(f, "seekers/s1/locationBatches/new"), { samples: [] }));
    await assertSucceeds(getDoc(doc(f, "game/state")));
    await assertFails(updateDoc(doc(as("adm", "admin"), "game/state"), { status: "ended" }));
  });
});

describe("broadcasts", () => {
  it("hiders cannot create broadcasts, but can read them; seekers cannot", async () => {
    await assertFails(addDoc(collection(as("h1", "hider"), "broadcasts"), { seekerPositions: [] }));
    await assertFails(addDoc(collection(as("surv", "surveillance"), "broadcasts"), { seekerPositions: [] }));
    await assertSucceeds(getDoc(doc(as("h1", "hider"), "broadcasts/bc1")));
    await assertSucceeds(getDoc(doc(as("surv", "surveillance"), "broadcasts/bc1")));
    await assertFails(getDoc(doc(as("s1", "seeker"), "broadcasts/bc1")));
  });
});

describe("server-only secrets", () => {
  it("join codes and rate-limit state are unreadable by every role", async () => {
    for (const [uid, role] of [["s1", "seeker"], ["h1", "hider"], ["surv", "surveillance"], ["adm", "admin"]] as const) {
      const f = as(uid, role);
      await assertFails(getDoc(doc(f, "teamJoinCodes/def")));
      await assertFails(getDocs(collection(f, "teamJoinCodes")));
      await assertFails(getDoc(doc(f, "rateLimits/k")));
    }
  });

  it("per-team artifact codes are unreadable and unwritable by every role, including the owning team", async () => {
    for (const [uid, role] of [["s1", "seeker"], ["s2", "seeker"], ["h1", "hider"], ["surv", "surveillance"], ["adm", "admin"]] as const) {
      const f = as(uid, role);
      await assertFails(getDoc(doc(f, "artifactCodes/hash1")));
      await assertFails(getDocs(collection(f, "artifactCodes")));
      await assertFails(setDoc(doc(f, "artifactCodes/forged"), { artifactId: "QR-KEY-001", teamId: ALPHA, isActive: true }));
      await assertFails(updateDoc(doc(f, "artifactCodes/hash1"), { teamId: BRAVO }));
    }
  });
});
