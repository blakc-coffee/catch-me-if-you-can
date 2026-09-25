/**
 * Game provisioning in the seekerdb schema, shared by the seed CLI and the
 * emulator tests. Writes teams, areas, puzzles (+ answer-free puzzlePublic
 * mirrors), artifacts keyed by their QR code, hashed team join codes and the
 * game/state doc. Artifact QR codes are random and stable across re-seeds
 * (matched by `seedKey`), so printed codes stay valid. Existing counters and
 * solve state are preserved.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { GAME_DEFAULTS } from "../src/config.js";
import { randomToken } from "../src/lib/crypto.js";
import { joinCodeKey, splitAcceptedAnswers } from "../src/lib/normalize.js";
import { resourceId } from "../src/lib/validation.js";
import { COL, GAME_DOC } from "../src/models.js";
import { mirrorPuzzle } from "../src/puzzles/mirror.js";
import { ROLES } from "../src/shared/contract.js";

export const seedDataSchema = z.strictObject({
  game: z.strictObject({
    status: z.enum(["draft", "active", "paused", "ended"]),
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

/** QR values for printing: "OV-" + 16 random base64url chars. */
export function newQrCode(): string {
  return `OV-${randomToken(12)}`;
}

export async function seedGame(db: Firestore, raw: SeedData): Promise<{ artifacts: SeededArtifact[] }> {
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
  await gameRef.set({ ...data.game, updatedAt: now, ...(game.exists ? {} : { lastBroadcastAt: null }) }, { merge: true });

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
  for (const doc of (await db.collection(COL.artifacts).where("seedKey", "!=", null).get()).docs) {
    existing.set(String(doc.get("seedKey")), doc.id);
  }
  const artifacts: SeededArtifact[] = [];
  const artifactWriter = db.bulkWriter();
  const retainedArtifactIds = new Set<string>();
  for (const a of data.artifacts) {
    const qrCode = a.qrCode ?? existing.get(a.key) ?? newQrCode();
    retainedArtifactIds.add(qrCode);
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
  for (const [seedKey, artifactId] of existing) {
    if (!data.artifacts.some((artifact) => artifact.key === seedKey) || !retainedArtifactIds.has(artifactId)) {
      void artifactWriter.delete(db.collection(COL.artifacts).doc(artifactId));
    }
  }
  await artifactWriter.close();

  for (const p of data.puzzles) {
    await mirrorPuzzle(db, p.id, (await db.collection(COL.puzzles).doc(p.id).get()).data());
  }
  return { artifacts };
}
