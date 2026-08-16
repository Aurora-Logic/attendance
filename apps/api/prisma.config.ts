import { defineConfig } from "prisma/config"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  if (process.env.DATABASE_URL) return

  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(__dirname, ".env"),
    path.resolve(__dirname, "../../.env"),
  ]

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8")
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const eqIdx = trimmed.indexOf("=")
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim()
          let val = trimmed.slice(eqIdx + 1).trim()
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1)
          }
          if (!(key in process.env) || !process.env[key]) {
            process.env[key] = val
          }
        }
      }
      if (process.env.DATABASE_URL) break
    }
  }
}

loadEnv()

// DATABASE_URL comes from .env (see .env.example at the repo root).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Host port 5433 — the dev Mac runs its own Postgres on 5432.
    url: process.env.DATABASE_URL ?? "postgresql://attendance:attendance@localhost:5433/attendance",
  },
})

