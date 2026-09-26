import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { initAdmin } from "./adminApp.js";

const projectId = "cmiyc-d170c";
initAdmin({ production: true, projectId });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

const PUZZLES = [
  {
    id: "case-01",
    title: "CASE 01: The Programmer",
    question: "Sherlock found a programmer, but his name was removed. He created a web framework whose philosophy includes optimizing for programmer happiness; it became known for Convention over Configuration; he later created an opinionated Linux distribution. Who is he? Enter three initials, not the full name.",
    answer: "dhh",
    points: 50,
    tokensAwarded: 1,
    audience: ["seeker", "hider"],
  },
  {
    id: "ch-01",
    title: "CASE 02: Packet Intercept",
    question: "Analyze the intercepted radio burst:\n\n> T3BlblZlcnNlIENURg==\n\nDecode the payload string.",
    answer: "openverse ctf|hello seeker|openversectf|helloseeker",
    points: 50,
    tokensAwarded: 1,
    audience: ["seeker", "hider"],
  },
  {
    id: "ch-02",
    title: "CASE 03: Bitwise Logic Gate",
    question: "Compute the bitwise XOR operation:\n\n> 0b10110101 XOR 0b11001010\n\nEnter the resulting value as an integer (base 10).",
    answer: "127",
    points: 50,
    tokensAwarded: 1,
    audience: ["seeker", "hider"],
  },
  {
    id: "ch-03",
    title: "CASE 04: HTTP Protocol Diagnostic",
    question: "What standard 3-digit HTTP status code signifies that the requested endpoint is missing or not found on the server?",
    answer: "404",
    points: 50,
    tokensAwarded: 1,
    audience: ["seeker", "hider"],
  },
  {
    id: "ch-04",
    title: "CASE 05: Default SSH Port",
    question: "Which well-known TCP port does SSH listen on by default?",
    answer: "22|port 22",
    points: 50,
    tokensAwarded: 1,
    audience: ["seeker", "hider"],
  },
  {
    id: "ch-05",
    title: "CASE 06: Sequence Break",
    question: "2, 3, 5, 7, 11, 13, ? — what is the next prime number in the sequence?",
    answer: "17|seventeen",
    points: 50,
    tokensAwarded: 1,
    audience: ["seeker", "hider"],
  },
];

const ARTIFACT_PUZZLE_MAP: Record<string, { key: string; name: string; puzzleId: string }> = {
  "OV-9lZCRosuTminZYHz": { key: "a01", name: "Artifact 01", puzzleId: "ch-01" },
  "OV-nm1hQp2QnHbijjh0": { key: "a02", name: "Artifact 02", puzzleId: "ch-02" },
  "OV-JSY3hkrM5JHm1B0S": { key: "a03", name: "Artifact 03", puzzleId: "ch-03" },
  "OV-FZEixUwsHaiUHSjK": { key: "a04", name: "Artifact 04", puzzleId: "ch-04" },
  "OV-Swk14IopdMVg_00G": { key: "a05", name: "Artifact 05", puzzleId: "ch-05" },
  "OV-kz7_6VPTWt-8WMW2": { key: "a06", name: "Artifact 06", puzzleId: "ch-01" },
  "OV-0LxQdG5expQfJqIy": { key: "a07", name: "Artifact 07", puzzleId: "ch-02" },
  "OV-00F1AsWRdvWHxLIo": { key: "a08", name: "Artifact 08", puzzleId: "ch-03" },
  "OV-GHBKtm1sRWaEb1qf": { key: "a09", name: "Artifact 09", puzzleId: "ch-04" },
  "OV-XdTJ88as24xN_tbO": { key: "a10", name: "Artifact 10", puzzleId: "ch-05" },
  "OV-397GdKBiwiNiia4l": { key: "a11", name: "Artifact 11", puzzleId: "case-01" },
  "OV-UmwA2aSU7uBquvBK": { key: "a12", name: "Artifact 12", puzzleId: "ch-01" },
  "OV-w5Ca38QwcByrb_R1": { key: "a13", name: "Artifact 13", puzzleId: "ch-02" },
  "OV-mQpPsWFBkjOh4dDR": { key: "a14", name: "Artifact 14", puzzleId: "ch-03" },
  "OV-gypxuv-Nxgcn6NKn": { key: "a15", name: "Artifact 15", puzzleId: "ch-04" },
};

async function main() {
  console.log("1. Writing puzzles to Firestore (cmiyc-d170c)...");
  for (const p of PUZZLES) {
    await db.collection("puzzles").doc(p.id).set(
      {
        ...p,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await db.collection("puzzlePublic").doc(p.id).set(
      {
        id: p.id,
        title: p.title,
        question: p.question,
        points: p.points,
        tokensAwarded: p.tokensAwarded,
        audience: p.audience,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.log(`   ✓ Puzzle doc updated: ${p.id} - ${p.title}`);
  }

  console.log("\n2. Linking artifacts to puzzles in Firestore...");
  for (const [code, info] of Object.entries(ARTIFACT_PUZZLE_MAP)) {
    await db.collection("artifacts").doc(code).set(
      {
        puzzleId: info.puzzleId,
        key: info.key,
        name: info.name,
        isActive: true,
        qrType: "correct",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.log(`   ✓ Artifact ${info.key} (${code}) -> puzzleId: ${info.puzzleId}`);
  }

  console.log("\n3. Unlocking all 6 Case Files for Team Alpha (since 6 artifacts are claimed)...");
  const puzzlesToUnlock = ["case-01", "ch-01", "ch-02", "ch-03", "ch-04", "ch-05"];
  for (const pid of puzzlesToUnlock) {
    await db.collection("puzzleUnlocks").doc(`alpha_${pid}`).set(
      {
        teamId: "alpha",
        puzzleId: pid,
        unlockedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.log(`   ✓ Unlocked ${pid} for team alpha`);
  }

  console.log("\nFinished successfully!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error linking puzzles:", err);
  process.exit(1);
});
