/**
 * Game provisioning in the seekerdb schema, shared by the seed CLI and the
 * emulator tests. Writes teams, areas, puzzles (+ answer-free puzzlePublic
 * mirrors), artifacts keyed by their QR code, hashed team join codes and the
 * game/state doc. Each artifact has one QR code shared by every team. Codes
 * are random and stable across re-seeds (matched by `seedKey`), so printed
 * codes stay valid; rotateArtifactCode replaces one. Existing counters and
 * solve state are preserved.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { GAME_DEFAULTS } from "../src/config.js";
import { randomToken } from "../src/lib/crypto.js";
import { joinCodeKey, splitAcceptedAnswers } from "../src/lib/normalize.js";
import { resourceId } from "../src/lib/validation.js";
import { COL, GAME_DOC } from "../src/models.js";
import { newEventId } from "../src/game/admin.js";
import { mirrorPuzzle } from "../src/puzzles/mirror.js";
import { ROLES } from "../src/shared/contract.js";

export const seedDataSchema = z.strictObject({
  game: z.strictObject({
    status: z.enum(["draft", "active", "paused", "ended"]),
    /** Scopes on-device state; change it for a new event. Generated once when omitted. */
    eventId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).optional(),
    telemetryMinIntervalSec: z.number().int().min(1).max(600).default(GAME_DEFAULTS.telemetryMinIntervalSec),
    broadcastCooldownSec: z.number().int().min(1).max(86_400).default(GAME_DEFAULTS.broadcastCooldownSec),
    staleAfterSec: z.number().int().min(30).max(86_400).default(GAME_DEFAULTS.staleAfterSec),
    locationRetentionDays: z.number().int().min(1).max(365).default(GAME_DEFAULTS.locationRetentionDays),
  }),
  teams: z.array(
    z.strictObject({
      id: resourceId,
      name: z.string().min(1).max(60),
      type: z.enum(["seeker", "hider"]),
      joinCode: z.string().min(6).max(32).optional(),
    }),
  ),
  areas: z.array(z.strictObject({ id: resourceId, name: z.string().min(1).max(80), description: z.string().max(500) })),
  puzzles: z.array(
    z.strictObject({
      id: resourceId,
      title: z.string().min(1).max(120),
      question: z.string().max(4000),
      /** Pipe-separated accepted answers. Stored in the admin-only puzzles doc. */
      answer: z.string().min(1),
      points: z.number().int().min(0).max(10_000).optional(),
      tokensAwarded: z.number().int().min(0).max(10).optional(),
      hints: z.array(z.string().max(500)).max(10).optional(),
      audience: z.array(z.enum(ROLES)).min(1).optional(),
    }),
  ),
  artifacts: z.array(
    z.strictObject({
      key: z.string().regex(/^[A-Za-z0-9-]{1,40}$/),
      /** Optional fixed QR value; otherwise a random code is generated once. */
      qrCode: z.string().regex(/^[A-Za-z0-9._:-]{3,128}$/).optional(),
      name: z.string().min(1).max(80),
      description: z.string().max(500),
      areaId: resourceId.nullable().optional(),
      qrType: z.enum(["correct", "wrong"]),
      puzzleId: resourceId.optional(),
      redirectUrl: z.string().url().nullable().optional(),
      points: z.number().int().min(0).max(1000).optional(),
    }),
  ),
});

export type SeedData = z.input<typeof seedDataSchema>;

export interface SeededArtifact {
  key: string;
  qrCode: string;
  name: string;
  qrType: "correct" | "wrong";
  puzzleId: string | null;
}

/**
 * One CSV field: quoted and quote-doubled when needed, and prefixed with "'"
 * when a spreadsheet would otherwise read it as a formula.
 */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** QR values for printing: "OV-" + 16 random base64url chars. */
export function newQrCode(): string {
  return `OV-${randomToken(12)}`;
}

/**
 * Replaces an artifact's single shared QR code (e.g. after the printed code
 * leaked outside the game). The artifact is copied to a new doc keyed by a new
 * random code and the old doc is deactivated, so the old code stops working
 * for everyone. `claimKey` is carried over, so teams that already claimed the
 * artifact cannot claim it again with the new code; other teams can.
 */
export async function rotateArtifactCode(db: Firestore, artifactId: string): Promise<{ oldCode: string; newCode: string }> {
  const newCode = newQrCode();
  const oldRef = db.collection(COL.artifacts).doc(artifactId);
  const newRef = db.collection(COL.artifacts).doc(newCode);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(oldRef);
    const data = snap.data();
    if (!data || data.isActive !== true) throw new Error(`artifact ${artifactId} is missing or inactive`);
    const now = FieldValue.serverTimestamp();
    tx.create(newRef, { ...data, qrCode: newCode, claimKey: (data.claimKey as string | undefined) ?? artifactId, isActive: true, createdAt: now });
    tx.update(oldRef, { isActive: false, replacedBy: newCode, updatedAt: now });
  });
  return { oldCode: artifactId, newCode };
}

export async function seedGame(db: Firestore, raw: SeedData): Promise<{ artifacts: SeededArtifact[]; retired: number }> {
  const data = seedDataSchema.parse(raw);
  const puzzleIds = new Set(data.puzzles.map((p) => p.id));
  for (const a of data.artifacts) {
    if (a.puzzleId && !puzzleIds.has(a.puzzleId)) throw new Error(`artifact ${a.key} links unknown puzzle ${a.puzzleId}`);
  }
  for (const p of data.puzzles) {
    if (splitAcceptedAnswers(p.answer).length === 0) throw new Error(`puzzle ${p.id} has no usable answer`);
  }
  const now = FieldValue.serverTimestamp();

  // game/state: create, or update settings while keeping lastBroadcastAt.
  const gameRef = db.collection(COL.game).doc(GAME_DOC);
  const game = await gameRef.get();
  const eventId = data.game.eventId ?? (game.get("eventId") as string | undefined) ?? newEventId();
  await gameRef.set({ ...data.game, eventId, updatedAt: now, ...(game.exists ? {} : { lastBroadcastAt: null }) }, { merge: true });

  const writer = db.bulkWriter();
  for (const t of data.teams) {
    void writer.set(db.collection(COL.teams).doc(t.id), { name: t.name, type: t.type, createdAt: now }, { merge: true });
  }
  for (const a of data.areas) {
    void writer.set(db.collection(COL.areas).doc(a.id), { name: a.name, description: a.description, createdAt: now }, { merge: true });
  }
  for (const p of data.puzzles) {
    void writer.set(
      db.collection(COL.puzzles).doc(p.id),
      {
        title: p.title,
        question: p.question,
        answer: p.answer,
        createdAt: now,
        // Optional fields removed from the seed file are removed from the doc too.
        points: p.points ?? FieldValue.delete(),
        tokensAwarded: p.tokensAwarded ?? FieldValue.delete(),
        hints: p.hints ?? FieldValue.delete(),
        audience: p.audience ?? FieldValue.delete(),
      },
      { merge: true },
    );
  }
  await writer.close();

  // Team join codes: replace any existing codes for these teams.
  const teamIds = data.teams.map((t) => t.id);
  const oldCodes = await db.collection(COL.teamJoinCodes).get();
  const codeWriter = db.bulkWriter();
  for (const c of oldCodes.docs) if (teamIds.includes(c.get("teamId"))) void codeWriter.delete(c.ref);
  await codeWriter.close();
  const newCodes = db.bulkWriter();
  for (const t of data.teams) {
    if (t.joinCode) void newCodes.set(db.collection(COL.teamJoinCodes).doc(joinCodeKey(t.joinCode)), { teamId: t.id, active: true });
  }
  await newCodes.close();

  // Artifacts keyed by QR code; reuse the code previously generated for the same seedKey.
  const existing = new Map<string, string>();
  const seeded = (await db.collection(COL.artifacts).where("seedKey", "!=", null).get()).docs;
  for (const doc of seeded) {
    // Rotated-out codes stay as inactive docs; only the current code is reused.
    if (doc.get("isActive") === true) existing.set(String(doc.get("seedKey")), doc.id);
  }
  const artifacts: SeededArtifact[] = [];
  const artifactWriter = db.bulkWriter();
  for (const a of data.artifacts) {
    const qrCode = a.qrCode ?? existing.get(a.key) ?? newQrCode();
    artifacts.push({ key: a.key, qrCode, name: a.name, qrType: a.qrType, puzzleId: a.puzzleId ?? null });
    void artifactWriter.set(
      db.collection(COL.artifacts).doc(qrCode),
      {
        qrCode,
        qrType: a.qrType,
        name: a.name,
        description: a.description,
        areaId: a.areaId ?? null,
        puzzleId: a.puzzleId ?? null,
        redirectUrl: a.redirectUrl ?? null,
        isActive: true,
        seedKey: a.key,
        createdAt: now,
        points: a.points ?? FieldValue.delete(),
      },
      { merge: true },
    );
  }
  // Seed-managed artifacts no longer in the file (or whose key now maps to a
  // different code) are retired, so their printed codes stop working.
  const current = new Map(artifacts.map((a) => [a.key, a.qrCode]));
  let retired = 0;
  for (const doc of seeded) {
    if (doc.get("isActive") !== true || current.get(String(doc.get("seedKey"))) === doc.id) continue;
    retired += 1;
    void artifactWriter.update(doc.ref, { isActive: false, retiredAt: now });
  }
  await artifactWriter.close();

  for (const p of data.puzzles) {
    await mirrorPuzzle(db, p.id, (await db.collection(COL.puzzles).doc(p.id).get()).data());
  }
  return { artifacts, retired };
}
