import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      // The workspace package's entry is TypeScript source; aliasing straight
      // to it lets vitest transform it like local code.
      "@attendance/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  test: {
    environment: "node",
  },
})
