import { defineConfig } from "prisma/config"

// DATABASE_URL comes from .env (see .env.example at the repo root).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://attendance:attendance@localhost:5432/attendance",
  },
})
