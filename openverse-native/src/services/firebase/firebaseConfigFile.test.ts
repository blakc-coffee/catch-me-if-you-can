import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("React Native Firebase configuration", () => {
  it("keeps localhost intact for USB-device emulator testing", () => {
    const config = JSON.parse(readFileSync(path.join(root, "firebase.json"), "utf8"));

    expect(config["react-native"]?.android_bypass_emulator_url_remap).toBe(true);
  });
});
