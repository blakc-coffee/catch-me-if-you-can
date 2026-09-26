import { describe, expect, it } from "vitest";
import { snapshotData } from "./snapshotData";

describe("snapshotData", () => {
  it("reads a document when exists is a method or a boolean", () => {
    expect(snapshotData({ exists: () => true, data: () => ({ role: "seeker" }) })).toEqual({ role: "seeker" });
    expect(snapshotData({ exists: true, data: () => ({ status: "active" }) })).toEqual({ status: "active" });
  });

  it("returns null for a missing document and does not treat that as a failed read", () => {
    expect(snapshotData({ exists: () => false, data: () => ({ role: "seeker" }) })).toBeNull();
    expect(snapshotData({ exists: false, data: () => ({ status: "active" }) })).toBeNull();
    expect(snapshotData(null)).toBeNull();
    expect(snapshotData(undefined)).toBeNull();
  });
});
