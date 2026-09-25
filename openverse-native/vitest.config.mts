import { defineConfig } from "vitest/config";

// Unit tests cover the platform-independent session logic only (no React Native runtime).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
