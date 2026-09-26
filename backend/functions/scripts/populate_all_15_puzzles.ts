import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { initAdmin } from "./adminApp.js";

const projectId = "cmiyc-d170c";
initAdmin({ production: true, projectId });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

export const ALL_PUZZLES = [
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
  {
    id: "ch-06",
    title: "CASE 07: Hexadecimal Cipher",
    question: "Translate the hexadecimal byte string into ASCII text:\n\n> 0x43 0x4D 0x49\n\nWhat word is spelled?",
    answer: "cmi",
    points: 50,
    tokensAwarded: 1,
    audience: ["seeker", "hider"],
  },
  {
    id: "ch-07",
    title: "CASE 08: DNS Protocol",
    question: "Which standard DNS resource record type maps a domain name directly to an IPv4 address?",
    answer: "a|a record",
    points: 50,
    tokensAwarded: 1,
    audience: ["seeker", "hider"],
  },
  {
    id: "ch-08",
    title: "CASE 09: Binary Nibble",
    question: "A byte contains 8 bits. How many bits are in a single computer nibble (half-byte)?",
    answer: "4|four",
    points: 50,
    tokensAwarded: 1,
    audience: ["seeker", "hider"],
  },
  {
    id: "ch-09",
    title: "CASE 10: Git Branching",
    question: "In Git, what standard command creates or switches branches, or restores working tree files? (e.g. `git ???`)",
    answer: "checkout|switch",
    points: 50,
    tokensAwarded: 1,
    audience: ["seeker", "hider"],
  },
  {
    id: "ch-10",
    title: "CASE 11: Caesar Shift",
    question: "Decrypt the ciphertext `FDWFK` which was encrypted using a Caesar cipher with a shift of +3.",
    answer: "catch",
    points: 50,
    tokensAwarded: 1,
    audience: ["seeker", "hider"],
  },
  {
    id: "ch-11",
    title: "CASE 12: Zero Indexing",
    question: "In standard C, Java, and Python array indexing, what is the integer index of the very first element?",
    answer: "0|zero",
    points: 50,
    tokensAwarded: 1,
    audience: ["seeker", "hider"],
  },
  {
    id: "ch-12",
    title: "CASE 13: Subnet Notation",
    question: "What CIDR prefix length corresponds to the classic Class C subnet mask `255.255.255.0`? (Enter as 24 or /24)",
    answer: "24|/24",
    points: 50,
    tokensAwarded: 1,
    audience: ["seeker", "hider"],
  },
  {
    id: "ch-13",
    title: "CASE 14: Collision Hash",
    question: "Which 128-bit cryptographic hash algorithm created by Ron Rivest in 1991 is now broken due to hash collision vulnerabilities?",
    answer: "md5",
    points: 50,
    tokensAwarded: 1,
    audience: ["seeker", "hider"],
  },
  {
    id: "ch-14",
    title: "CASE 15: Binary Prefixes",
    question: "How many bytes are in exactly one standard Kibibyte (1 KiB)?",
    answer: "1024",
    points: 50,
    tokensAwarded: 1,
    audience: ["seeker", "hider"],
  },
];

async function main() {
  console.log("1. Writing all 15 puzzles to Firestore (cmiyc-d170c)...");
  for (const p of ALL_PUZZLES) {
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
    console.log(`   ✓ Puzzle doc: ${p.id} -> ${p.title}`);
  }

  console.log("\n2. Checking existing claims for team alpha...");
  const alphaClaims = await db.collection("artifactClaims").where("teamId", "==", "alpha").get();
  console.log(`   Team alpha has ${alphaClaims.size} artifact claims.`);

  // Unlock corresponding puzzles up to alphaClaims.size
  console.log("\n3. Unlocking case files for team alpha up to the number of claimed artifacts...");
  const puzzleIds = ALL_PUZZLES.map((p) => p.id);
  const countToUnlock = Math.min(alphaClaims.size, puzzleIds.length);
  for (let i = 0; i < countToUnlock; i++) {
    const pid = puzzleIds[i];
    await db.collection("puzzleUnlocks").doc(`alpha_${pid}`).set(
      {
        teamId: "alpha",
        puzzleId: pid,
        unlockedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.log(`   ✓ Unlocked ${pid} for alpha (Case ${i + 1} of ${countToUnlock})`);
  }

  console.log("\nFinished successfully!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error populating puzzles:", err);
  process.exit(1);
});
