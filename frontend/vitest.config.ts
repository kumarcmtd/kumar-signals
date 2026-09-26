// Test runner config, kept separate from vite.config.ts on purpose: the app's
// Vite config loads the PWA plugin and the React transform, neither of which
// the engine tests need. Every test here is pure logic run in Node.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
