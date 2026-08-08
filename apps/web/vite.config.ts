import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // A production bundle that baked the default localhost API cannot reach its
  // backend from any device but the build machine, and the symptom — every
  // screen quietly falling back to demo data — looks like working software.
  // Fail the build instead of shipping that.
  if (mode === "production") {
    const env = loadEnv(
      mode,
      path.resolve(import.meta.dirname, "../.."),
      "VITE_",
    );
    const apiUrl = env.VITE_API_URL;
    if (!apiUrl || apiUrl.includes("localhost")) {
      throw new Error(
        `VITE_API_URL must point at the deployed API for a production build (got ${apiUrl ?? "nothing"}). ` +
          `Use a full origin such as https://api.example.com, or a same-origin path such as /api behind a proxy.`,
      );
    }
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      // §1: installable PWA — the same build runs the gate kiosk and personal
      // phones. The service worker is production-only (it fights Vite HMR in
      // dev); the offline PUNCH queue is IndexedDB and does not depend on it.
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icon.svg", "favicon.svg"],
        manifest: {
          name: "Delta Attendance",
          short_name: "Attendance",
          description: "Punch, leave and payslips",
          display: "standalone",
          start_url: "/punch",
          background_color: "#ffffff",
          theme_color: "#0a0a0a",
          icons: [
            {
              src: "/icon.svg",
              sizes: "any",
              type: "image/svg+xml",
              purpose: "any",
            },
          ],
        },
        workbox: {
          // Precache the shell, not the whole app. exceljs is ~900KB and is
          // dynamically imported precisely so a phone that never exports a
          // workbook never downloads it — precaching it would undo that on
          // every install. Same for the chart vendor chunk: four routes need
          // it, the kiosk needs none of them.
          globIgnores: ["**/exceljs*.js", "**/charts-*.js", "**/*.map"],
          // A workbook chunk that slips past the ignore list must not blow the
          // precache budget silently.
          maximumFileSizeToCacheInBytes: 600 * 1024,
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              // Lazy route chunks: serve from cache when present, refresh in the
              // background. A route visited once keeps working offline.
              urlPattern: ({ request }: { request: Request }) =>
                request.destination === "script",
              handler: "StaleWhileRevalidate",
              options: { cacheName: "route-chunks" },
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          // recharts drags in d3 and a redux store — ~1.1MB that only the four
          // analytics screens need. Keeping it in its own chunk means the punch
          // kiosk and the register never parse it.
          manualChunks: (moduleId: string) => {
            if (moduleId.includes("node_modules")) {
              if (
                /[\\/]node_modules[\\/](recharts|d3-|victory|@reduxjs)/.test(
                  moduleId,
                )
              )
                return "charts";
              if (/[\\/]node_modules[\\/]exceljs/.test(moduleId))
                return "exceljs";
            }
            return undefined;
          },
        },
      },
      // The entry chunk is the budget that matters; warn early if it creeps.
      chunkSizeWarningLimit: 700,
    },
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
  };
});
