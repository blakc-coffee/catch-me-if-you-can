import { getAuth } from "@react-native-firebase/auth";
import {
  doc,
  getDoc,
  getFirestore,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
  FieldValue,
} from "@react-native-firebase/firestore";
import type {
  CreateOrSyncProfileRequest,
  CreateOrSyncProfileResponse,
  ClaimArtifactResponse,
  SubmitPuzzleAnswerResponse,
  UpdateTelemetryRequest,
  UpdateTelemetryResponse,
  UploadLocationBatchRequest,
  UploadLocationBatchResponse,
  GetMissionStateResponse,
  StopTrackingResponse,
  DeleteLocationHistoryResponse,
} from "./contract";
import { projectToCampus } from "../geo";

export async function directCreateOrSyncProfile(
  data: CreateOrSyncProfileRequest = {}
): Promise<CreateOrSyncProfileResponse> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("UNAUTHENTICATED");

  const uid = user.uid;
  const db = getFirestore();
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef).catch(() => null);

  const displayName = data.name || user.displayName || user.email?.split("@")[0] || "Seeker";
  const playerId = "p_" + uid.slice(0, 6);

  const defaultTeam = user.email?.toLowerCase().includes("bravo") || user.email?.toLowerCase().includes("2") ? "bravo" : "alpha";

  if (!userSnap || !userSnap.exists()) {
    await setDoc(userRef, {
      uid,
      name: displayName,
      email: user.email ?? null,
      role: "seeker",
      teamId: defaultTeam,
      playerId,
      status: "active",
      score: 0,
      eliminationTokens: 0,
      artifactsClaimed: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
    });
  } else {
    const existing = userSnap.data() as Record<string, unknown> | undefined;
    const patch: Record<string, unknown> = {
      lastSeenAt: FieldValue.serverTimestamp(),
    };
    if (data.name && data.name !== existing?.name) {
      patch.name = data.name;
      patch.updatedAt = FieldValue.serverTimestamp();
    }
    if (!existing?.role) patch.role = "seeker";
    if (!existing?.status) patch.status = "active";
    if (!existing?.teamId) patch.teamId = defaultTeam;
    if (!existing?.playerId) patch.playerId = playerId;
    await updateDoc(userRef, patch);
  }

  // Ensure game/state exists so gameLoaded in App.tsx evaluates to true
  const gameRef = doc(db, "game", "state");
  const gameSnap = await getDoc(gameRef).catch(() => null);
  if (!gameSnap || !gameSnap.exists()) {
    await setDoc(
      gameRef,
      {
        eventId: "cmiyc_event_1",
        status: "active",
        telemetryMinIntervalSec: 5,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    ).catch(() => {});
  }

  // Ensure team doc exists
  const teamRef = doc(db, "teams", defaultTeam);
  const teamSnap = await getDoc(teamRef).catch(() => null);
  if (!teamSnap || !teamSnap.exists()) {
    await setDoc(
      teamRef,
      {
        id: defaultTeam,
        teamId: defaultTeam,
        name: defaultTeam === "bravo" ? "Team Bravo" : "Team Alpha",
        type: "seeker",
        score: 0,
        artifactsClaimed: 0,
        tokens: 0,
        puzzlesSolved: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    ).catch(() => {});
  }

  const currentTeamId = ((userSnap?.data() as Record<string, unknown> | undefined)?.teamId as string) || defaultTeam;

  return {
    claimsUpdated: false,
    profile: {
      uid,
      name: displayName,
      email: user.email ?? null,
      role: "seeker",
      teamId: currentTeamId,
      playerId,
      status: "active",
      score: 0,
      eliminationTokens: 0,
    },
  };
}

export async function directUpdateTelemetry(
  data: UpdateTelemetryRequest
): Promise<UpdateTelemetryResponse> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("UNAUTHENTICATED");

  const uid = user.uid;
  const db = getFirestore();

  const p = projectToCampus(data.lat, data.lon);
  const speedKmh = data.speedMps === undefined ? 0 : Math.round(data.speedMps * 3.6 * 10) / 10;
  const nowMs = Date.now();

  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef).catch(() => null);
  const userData = userSnap?.exists() ? (userSnap.data() as Record<string, unknown>) : null;

  const name = (userData?.name as string) || user.displayName || "Seeker";
  const teamId = (userData?.teamId as string) || "alpha";
  const playerId = (userData?.playerId as string) || "p_" + uid.slice(0, 6);
  const qrScannedCount = (userData?.artifactsClaimed as number) ?? 0;

  const seekerRef = doc(db, "seekers", uid);
  await setDoc(
    seekerRef,
    {
      uid,
      teamId,
      playerId,
      name,
      active: true,
      trackingEnabled: true,
      status: speedKmh >= 4 ? "IN_TRANSIT" : "ACTIVE",
      zoneId: p.zoneId,
      zoneName: p.zoneName,
      x: p.x,
      y: p.y,
      lat: data.lat,
      lon: data.lon,
      accuracyM: data.accuracyM,
      speedKmh: speedKmh ?? 0,
      headingDeg: data.headingDeg ?? null,
      battery: data.battery ?? 100,
      signal: data.signal ?? "STRONG",
      qrScannedCount,
      clientTs: data.clientTs,
      fixServerMs: nowMs,
      lastPing: nowMs, // Numeric timestamp ms: required by surveillance website listener
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    acceptedAtMs: nowMs,
    nextAllowedAtMs: nowMs + 4000,
    zoneId: p.zoneId,
    zoneName: p.zoneName,
    inBounds: p.inBounds,
  };
}

export async function directStopRemoteTracking(): Promise<StopTrackingResponse> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (user) {
    const db = getFirestore();
    await updateDoc(doc(db, "seekers", user.uid), {
      active: false,
      trackingEnabled: false,
      status: "offline",
      updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
  }
  return { trackingEnabled: false };
}

export async function directUploadLocationBatch(
  data: UploadLocationBatchRequest
): Promise<UploadLocationBatchResponse> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("UNAUTHENTICATED");

  const db = getFirestore();
  const batchRef = doc(db, "seekers", user.uid, "locationBatches", data.batchId);
  await setDoc(batchRef, {
    batchId: data.batchId,
    samples: data.samples,
    count: data.samples.length,
    uploadedAt: FieldValue.serverTimestamp(),
  });

  return {
    batchId: data.batchId,
    status: "STORED",
    count: data.samples.length,
  };
}

export async function directDeleteRemoteLocationHistory(): Promise<DeleteLocationHistoryResponse> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (user) {
    const db = getFirestore();
    await updateDoc(doc(db, "seekers", user.uid), {
      historyDeletedAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
  }
  return { deleted: 1 };
}

const FALLBACK_PUZZLES: Record<string, { title: string; question: string; answer: string; points: number }> = {
  "case-01": {
    title: "The Programmer",
    question: "Sherlock found a programmer whose identity was redacted. Check field intel and enter his handle.",
    answer: String.fromCharCode(100, 104, 104),
    points: 50,
  },
  "ch-01": {
    title: "ANOMALY_01: Packet Intercept",
    question: "Analyze the intercepted radio burst:\n\n> T3BlblZlcnNlIENURg==\n\nDecode the payload string.",
    answer: "openverse ctf",
    points: 50,
  },
  "ch-02": {
    title: "ANOMALY_02: Bitwise Logic Gate",
    question: "Compute the bitwise XOR operation:\n\n> 0b10110101 XOR 0b11001010\n\nEnter the resulting value as an integer (base 10).",
    answer: "127",
    points: 100,
  },
  "ch-03": {
    title: "ANOMALY_03: HTTP Protocol Diagnostic",
    question: "What standard 3-digit HTTP status code signifies that the requested endpoint is missing or not found on the server?",
    answer: "404",
    points: 50,
  },
  "ch-04": {
    title: "ANOMALY_04: Default SSH Port",
    question: "Which well-known TCP port does SSH listen on by default?",
    answer: "22",
    points: 50,
  },
  "ch-05": {
    title: "ANOMALY_05: Sequence Break",
    question: "2, 3, 5, 7, 11, 13, ? — what is the next prime number in the sequence?",
    answer: "17",
    points: 50,
  },
};

export async function directClaimArtifact(payload: string): Promise<ClaimArtifactResponse> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("UNAUTHENTICATED");

  const qrCode = payload.trim();
  const db = getFirestore();

  // Check if artifact exists in artifacts/{qrCode}
  const artifactRef = doc(db, "artifacts", qrCode);
  const artifactSnap = await getDoc(artifactRef).catch(() => null);
  const artifactData = artifactSnap?.exists() ? (artifactSnap.data() as Record<string, unknown>) : null;

  if (artifactData?.qrType === "wrong") {
    return {
      status: "DECOY",
      artifactId: qrCode,
      name: (artifactData.name as string) || "Decoy Artifact",
      redirectUrl: (artifactData.redirectUrl as string) ?? null,
    };
  }

  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef).catch(() => null);
  const userData = userSnap?.exists() ? (userSnap.data() as Record<string, unknown>) : null;
  const teamId = (userData?.teamId as string) || "alpha";

  // Check duplicate claim in artifactClaims
  const claimId = `${teamId}_${qrCode}`;
  const claimRef = doc(db, "artifactClaims", claimId);
  const claimSnap = await getDoc(claimRef).catch(() => null);
  if (claimSnap?.exists()) {
    const error: any = new Error("Your team already claimed this artifact.");
    error.details = { reason: "ARTIFACT_ALREADY_CLAIMED" };
    throw error;
  }

  const points = (artifactData?.points as number) ?? 50;
  const artifactName = (artifactData?.name as string) || `Artifact ${qrCode.slice(0, 8)}`;
  const puzzleId = (artifactData?.puzzleId as string | undefined) || (qrCode.includes("397GdKBiwiNiia4l") || qrCode.includes("e7kvo8xeqtOSlJSu") ? "case-01" : null);

  await setDoc(claimRef, {
    teamId,
    artifactId: qrCode,
    puzzleId,
    claimedBy: user.uid,
    playerId: (userData?.playerId as string) || user.uid.slice(0, 6),
    points,
    claimedAt: FieldValue.serverTimestamp(),
  });

  // Update user counters
  await updateDoc(userRef, {
    artifactsClaimed: FieldValue.increment(1),
    score: FieldValue.increment(points),
    updatedAt: FieldValue.serverTimestamp(),
  }).catch(() => {});

  // Update team counters
  const teamRef = doc(db, "teams", teamId);
  await updateDoc(teamRef, {
    artifactsClaimed: FieldValue.increment(1),
    score: FieldValue.increment(points),
    updatedAt: FieldValue.serverTimestamp(),
  }).catch(() => {});

  // Unlock puzzle if linked
  if (puzzleId) {
    const unlockRef = doc(db, "puzzleUnlocks", `${teamId}_${puzzleId}`);
    await setDoc(
      unlockRef,
      {
        teamId,
        puzzleId,
        artifactId: qrCode,
        unlockedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    ).catch(() => {});
  }

  let puzzle = null;
  if (puzzleId) {
    const pRef = doc(db, "puzzles", puzzleId);
    const pSnap = await getDoc(pRef).catch(() => null);
    if (pSnap?.exists()) {
      const pData = pSnap.data() as Record<string, unknown>;
      puzzle = {
        puzzleId,
        title: (pData.title as string) || FALLBACK_PUZZLES[puzzleId]?.title || "The Case File",
        question: (pData.question as string) || FALLBACK_PUZZLES[puzzleId]?.question || "Solve the anomaly to advance your mission.",
      };
    } else if (FALLBACK_PUZZLES[puzzleId]) {
      puzzle = {
        puzzleId,
        title: FALLBACK_PUZZLES[puzzleId].title,
        question: FALLBACK_PUZZLES[puzzleId].question,
      };
    } else {
      puzzle = {
        puzzleId,
        title: "The Case File",
        question: "Solve the anomaly to advance your mission.",
      };
    }
  }

  return {
    status: "CLAIMED",
    artifactId: qrCode,
    name: artifactName,
    points,
    teamArtifactsClaimed: ((userData?.artifactsClaimed as number) ?? 0) + 1,
    totalArtifacts: 15,
    puzzle,
  };
}

export async function directSubmitPuzzleAnswer(
  puzzleId: string,
  answer: string
): Promise<SubmitPuzzleAnswerResponse> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("UNAUTHENTICATED");

  const db = getFirestore();
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef).catch(() => null);
  const userData = userSnap?.exists() ? (userSnap.data() as Record<string, unknown>) : null;
  const teamId = (userData?.teamId as string) || "alpha";

  // Check puzzle in Firestore
  const puzzleRef = doc(db, "puzzles", puzzleId);
  const puzzleSnap = await getDoc(puzzleRef).catch(() => null);
  const puzzleData = puzzleSnap?.exists() ? (puzzleSnap.data() as Record<string, unknown>) : null;

  // Normalized answer check from puzzle data or fallback catalog
  let expected = (puzzleData?.answer as string) || "";
  if (!expected && FALLBACK_PUZZLES[puzzleId]) {
    expected = FALLBACK_PUZZLES[puzzleId].answer;
  }

  const cleanInput = answer.trim().toLowerCase();
  const cleanExpected = expected.toLowerCase().split("|").map((s) => s.trim());

  const correct = cleanExpected.includes(cleanInput);
  if (!correct) {
    return { status: "INCORRECT", puzzleId };
  }

  const points = (puzzleData?.points as number) ?? FALLBACK_PUZZLES[puzzleId]?.points ?? 50;
  const tokens = (puzzleData?.tokensAwarded as number) ?? 1;

  const claimRef = doc(db, "puzzleClaims", puzzleId);
  await setDoc(
    claimRef,
    {
      puzzleId,
      uid: user.uid,
      playerId: (userData?.playerId as string) || user.uid.slice(0, 6),
      teamId,
      points,
      tokensAwarded: tokens,
      claimedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await updateDoc(userRef, {
    score: FieldValue.increment(points),
    eliminationTokens: FieldValue.increment(tokens),
    updatedAt: FieldValue.serverTimestamp(),
  }).catch(() => {});

  const teamRef = doc(db, "teams", teamId);
  await updateDoc(teamRef, {
    score: FieldValue.increment(points),
    tokens: FieldValue.increment(tokens),
    puzzlesSolved: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  }).catch(() => {});

  return {
    status: "SOLVED",
    puzzleId,
    pointsAwarded: points,
    tokensAwarded: tokens,
    teamTokens: 1,
  };
}

export async function directGetMissionState(): Promise<GetMissionStateResponse> {
  const auth = getAuth();
  const user = auth.currentUser;
  const uid = user?.uid;
  const db = getFirestore();

  let teamId = "alpha";
  let teamName = "Team Alpha";
  let artifactsClaimed = 0;
  let score = 0;

  if (uid) {
    const userSnap = await getDoc(doc(db, "users", uid)).catch(() => null);
    if (userSnap?.exists()) {
      const u = userSnap.data() as Record<string, unknown>;
      teamId = (u.teamId as string) || "alpha";
    }
    const teamSnap = await getDoc(doc(db, "teams", teamId)).catch(() => null);
    if (teamSnap?.exists()) {
      const t = teamSnap.data() as Record<string, unknown>;
      teamName = (t.name as string) || "Team Alpha";
      artifactsClaimed = (t.artifactsClaimed as number) || 0;
      score = (t.score as number) || 0;
    }
  }

  const puzzles: GetMissionStateResponse["puzzles"] = [];
  try {
    const unlocksSnap = await getDocs(
      query(collection(db, "puzzleUnlocks"), where("teamId", "==", teamId))
    ).catch(() => null);

    if (unlocksSnap && !unlocksSnap.empty) {
      for (const uDoc of unlocksSnap.docs) {
        const uData = uDoc.data();
        const pid = uData.puzzleId;
        if (!pid) continue;

        const claimSnap = await getDoc(doc(db, "puzzleClaims", pid)).catch(() => null);
        const isSolved = Boolean(claimSnap?.exists());
        const solvedByOurTeam = isSolved && (claimSnap?.data() as Record<string, unknown>)?.teamId === teamId;

        let title = FALLBACK_PUZZLES[pid]?.title || "The Case File";
        let question = FALLBACK_PUZZLES[pid]?.question || "Solve the anomaly to advance your mission.";

        const pSnap = await getDoc(doc(db, "puzzles", pid)).catch(() => null);
        if (pSnap?.exists()) {
          const pd = pSnap.data() as Record<string, unknown>;
          title = (pd.title as string) || title;
          question = (pd.question as string) || question;
        }

        puzzles.push({
          puzzleId: pid,
          title,
          question,
          unlockedAtMs: (uData.unlockedAt as any)?.toMillis?.() ?? Date.now(),
          solved: isSolved,
          solvedByYourTeam: solvedByOurTeam,
        });
      }
    }
  } catch (err) {
    console.warn("Could not load mission puzzles:", err);
  }

  return {
    eventId: "cmiyc_event_1",
    gameStatus: "active",
    team: {
      teamId,
      name: teamName,
      type: "seeker",
      score,
      artifactsClaimed,
      tokens: 0,
      puzzlesSolved: puzzles.filter((p) => p.solvedByYourTeam).length,
    },
    totalArtifacts: 15,
    puzzles,
  };
}
