// Worker tests: src/ modules run in Node with a mocked fetch. The frontend's
// pure-engine tests have their own config in frontend/vitest.config.ts.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
