import { safeEqualHex, sha256Hex } from "./crypto.js";

const ZERO_WIDTH = /[​-‍⁠﻿]/g;

/**
 * Canonical form used to compare answers: Unicode NFKC, zero-width chars
 * removed, lower-cased, trimmed, and internal whitespace collapsed.
 */
export function normalizeAnswer(input: string): string {
  return input.normalize("NFKC").replace(ZERO_WIDTH, "").toLowerCase().trim().replace(/\s+/g, " ");
}

/** Splits an answer spec of pipe-delimited accepted answers ("a | b"). */
export function splitAcceptedAnswers(spec: string): string[] {
  return [...new Set(spec.split("|").map(normalizeAnswer).filter((a) => a.length > 0))];
}

/**
 * Compares a submission with the puzzle's answer spec (puzzles/{id}.answer,
 * server-side only). Hash + timing-safe compare against every accepted answer
 * keeps timing independent of which (if any) alternative matched.
 */
export function answerMatches(answerSpec: string, submitted: string): boolean {
  const normalized = normalizeAnswer(submitted);
  if (!normalized) return false;
  const candidate = sha256Hex(normalized);
  let matched = false;
  for (const accepted of splitAcceptedAnswers(answerSpec)) {
    matched = safeEqualHex(sha256Hex(accepted), candidate) || matched;
  }
  return matched;
}

/** Join codes are case-insensitive and ignore spaces/dashes: "alpha-dev 7q4m" == "ALPHADEV7Q4M". */
export function normalizeJoinCode(input: string): string {
  return input.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function joinCodeKey(code: string): string {
  return sha256Hex(`joincode:${normalizeJoinCode(code)}`);
}

/**
 * QR payloads are artifact doc ids (existing schema, e.g. "QR-KEY-001").
 * Anything that could not be a Firestore doc id is rejected before lookup.
 * Printed codes for a real event should be long and random (see the seed script).
 */
export const QR_PAYLOAD_PATTERN = /^(?!\.\.?$)[A-Za-z0-9._:-]{1,128}$/;

/** Stable key for an artifact inside composite claim ids (qrCode may contain "_"). */
export function artifactKey(qrCode: string): string {
  return sha256Hex(`artifact:${qrCode}`).slice(0, 32);
}
