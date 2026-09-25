import { describe, expect, it } from "vitest";
import { resolveAppCheckPolicy } from "../../src/config.js";

describe("App Check policy", () => {
  it("enforces sensitive callables in a deployed project by default", () => {
    expect(resolveAppCheckPolicy({})).toEqual({ sensitive: true, standard: false });
  });

  it("can enforce every callable", () => {
    expect(resolveAppCheckPolicy({ ENFORCE_APP_CHECK: "true" })).toEqual({ sensitive: true, standard: true });
  });

  it("never enforces in the Functions emulator", () => {
    expect(resolveAppCheckPolicy({ FUNCTIONS_EMULATOR: "true", ENFORCE_APP_CHECK: "true" })).toEqual({ sensitive: false, standard: false });
  });

  it("only an explicit ENFORCE_APP_CHECK=false disables it in production", () => {
    expect(resolveAppCheckPolicy({ ENFORCE_APP_CHECK: "false" })).toEqual({ sensitive: false, standard: false });
    expect(resolveAppCheckPolicy({ ENFORCE_APP_CHECK: "no" })).toEqual({ sensitive: true, standard: false });
  });
});
