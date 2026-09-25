import { defineConfig } from "vitest/config";

// Runs inside `firebase emulators:exec` (see backend/package.json "test:emulator").
// Files share one emulator, so they run serially.
export default defineConfig({
  test: {
    include: ["test/emulator/**/*.test.ts"],
    environment: "node",
    setupFiles: ["test/emulator/setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
