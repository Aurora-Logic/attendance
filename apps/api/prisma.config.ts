import { defineConfig } from "prisma/config"

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
