import { defineConfig } from "tsup"

/**
 * Production build. `tsx` is a dev dependency and a runtime transpiler — fine
 * for `pnpm dev`, wrong for a container that should start in milliseconds and
 * install with --prod. This emits plain ESM that node runs directly.
 *
 * @attendance/shared is bundled in (it is workspace source, not a published
 * package); everything with a real node_modules entry stays external.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: ["@attendance/shared"],
  // bullmq and its Redis client resolve their own optional deps at runtime.
  external: ["bullmq", "ioredis", "@prisma/client", "@prisma/adapter-pg", "exceljs"],
})
