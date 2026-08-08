import { defineConfig } from "tsup"

/**
 * The Windows deliverable is one file.
 *
 * Everything — the shared domain code and zod with it — is bundled into a
 * single CommonJS script, so installing the connector on a shop-floor PC is
 * "copy one file, install Node, run it". No npm install, no node_modules, no
 * package registry reachable from a machine that may not have general internet
 * access at all.
 */
export default defineConfig({
  entry: { "tally-agent": "src/main.ts" },
  format: ["cjs"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  noExternal: [/.*/],
  banner: { js: "#!/usr/bin/env node" },
})
