import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { VitePWA } from "vite-plugin-pwa"

// https://vite.dev/config/
export default defineConfig({
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
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
})
