import { describe, expect, it } from "vitest";
import {
  QR_PAYLOAD_PATTERN,
  answerMatches,
  artifactKey,
  joinCodeKey,
  normalizeAnswer,
  normalizeJoinCode,
  splitAcceptedAnswers,
} from "../../src/lib/normalize.js";

describe("normalizeAnswer", () => {
  it.each([
    ["DHH", "dhh"],
    ["  dHh  ", "dhh"],
    ["hello   \t seeker", "hello seeker"],
    ["ｄｈｈ", "dhh"], // full-width → NFKC
    ["d​h﻿h", "dhh"], // zero-width characters stripped
    ["Port\n22", "port 22"],
  ])("%j → %j", (input, expected) => {
    expect(normalizeAnswer(input)).toBe(expected);
  });

  it("keeps meaningful punctuation", () => {
    expect(normalizeAnswer("--ALL")).toBe("--all");
  });
});

describe("answer specs", () => {
  it("split pipes, normalize, drop blanks and duplicates", () => {
    expect(splitAcceptedAnswers(" 17 | Seventeen |  | seventeen")).toEqual(["17", "seventeen"]);
  });

  it("match any accepted alternative after normalization", () => {
    expect(answerMatches("dhh|David Heinemeier Hansson", " DHH ")).toBe(true);
    expect(answerMatches("dhh|David Heinemeier Hansson", "david   heinemeier hansson")).toBe(true);
    expect(answerMatches("Secret", "SECRET")).toBe(true);
  });

  it("reject wrong, empty and whitespace-only answers, and empty specs", () => {
    expect(answerMatches("dhh", "dh")).toBe(false);
    expect(answerMatches("dhh", "")).toBe(false);
    expect(answerMatches("dhh", "   ")).toBe(false);
    expect(answerMatches("", "anything")).toBe(false);
    expect(answerMatches(" | ", "")).toBe(false);
  });
});

describe("join codes", () => {
  it("ignore case, spaces and dashes", () => {
    expect(normalizeJoinCode("alpha-dev 2026")).toBe("ALPHADEV2026");
    expect(joinCodeKey("alpha-dev-2026")).toBe(joinCodeKey("ALPHADEV2026"));
    expect(joinCodeKey("ALPHA-DEV-2026")).not.toBe(joinCodeKey("ALPHA-DEV-2027"));
  });
});

describe("QR payloads", () => {
  it("accept existing and generated codes", () => {
    for (const ok of ["QR-KEY-001", "QR-DECOY-001", "OV-a1B2_c3D4-e5F6g7", "code.v2:7"]) expect(QR_PAYLOAD_PATTERN.test(ok)).toBe(true);
  });

  it("reject anything that is not a safe doc id", () => {
    for (const bad of ["", ".", "..", "a/b", "https://example.com", "with space", "x".repeat(129)]) {
      expect(QR_PAYLOAD_PATTERN.test(bad)).toBe(false);
    }
  });

  it("key artifacts stably by hash", () => {
    expect(artifactKey("QR-KEY-001")).toMatch(/^[0-9a-f]{32}$/);
    expect(artifactKey("QR-KEY-001")).toBe(artifactKey("QR-KEY-001"));
    expect(artifactKey("QR-KEY-001")).not.toBe(artifactKey("QR-KEY-002"));
  });
});
