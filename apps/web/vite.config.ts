import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

const SW_SOURCE = path.resolve(__dirname, "./src/lib/offline/service-worker.js")
const SW_VERSION_TOKEN = "__SW_VERSION__"

/**
 * Serves `src/lib/offline/service-worker.js` at `/sw.js`, with its version
 * stamped in.
 *
 * The version is what makes the app replaceable (technical design §8). It names
 * the cache, and the worker deletes every cache whose name does not match on
 * activate — so a version that a person has to remember to bump is a version
 * that will one day be stale while the cache it names is not, and the app
 * becomes unfixable in exactly the way the requirement warns about. Deriving it
 * from the built output removes the chance to forget.
 *
 * The worker is not part of the application bundle. If it were, a build that
 * failed to compile would take the update mechanism down with it.
 */
function serviceWorker(): Plugin {
  const read = (): string => readFileSync(SW_SOURCE, "utf8")

  const render = (version: string): string => read().replaceAll(SW_VERSION_TOKEN, version)

  // In development the version is a hash of the worker's own source. Stable
  // across reloads and across dev-server restarts, so nothing is reinstalled
  // for no reason; different the moment the file is edited, so the upgrade
  // path — new worker, new cache, old cache deleted — can be driven in
  // development instead of only being reasoned about.
  const devVersion = (): string =>
    `dev-${createHash("sha256").update(read()).digest("hex").slice(0, 8)}`

  return {
    name: "vyuha:service-worker",

    configureServer(server) {
      server.watcher.add(SW_SOURCE)
      server.middlewares.use((req, res, next) => {
        if (!req.url || new URL(req.url, "http://localhost").pathname !== "/sw.js") {
          next()
          return
        }
        res.setHeader("Content-Type", "text/javascript")
        // The browser must never be handed a cached copy of the worker script
        // itself; that is the one request whose freshness decides whether an
        // update can ever arrive.
        res.setHeader("Cache-Control", "no-store")
        res.setHeader("Service-Worker-Allowed", "/")
        res.end(render(devVersion()))
      })
    },

    generateBundle(_options, bundle) {
      // Hashed over the emitted file names, which already carry a content hash
      // each. Two builds of identical source produce the same version and no
      // pointless reinstall; a single changed byte anywhere changes a chunk
      // name, and so changes this.
      const version = createHash("sha256")
        .update(Object.keys(bundle).sort().join("\n"))
        .digest("hex")
        .slice(0, 12)

      this.emitFile({ type: "asset", fileName: "sw.js", source: render(version) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
