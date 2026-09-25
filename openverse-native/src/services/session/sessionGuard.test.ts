import { describe, expect, it } from "vitest";
import { SessionGuard } from "./sessionGuard";

describe("SessionGuard", () => {
  it("accepts a result only for the account/event generation that started it", () => {
    const guard = new SessionGuard();
    guard.enter("uidA/event-1");
    const token = guard.capture();
    expect(guard.isCurrent(token)).toBe(true);
    guard.enter("uidA/event-2");
    expect(guard.isCurrent(token)).toBe(false);
  });

  it("invalidates pending work immediately during an account transition", () => {
    const guard = new SessionGuard();
    guard.enter("uidA/event-1");
    const token = guard.capture();
    guard.invalidate();
    expect(guard.isCurrent(token)).toBe(false);
  });
});
