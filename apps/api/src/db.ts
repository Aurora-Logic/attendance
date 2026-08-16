import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
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
    path.resolve(__dirname, "../../../.env"),
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

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://attendance:attendance@localhost:5433/attendance"



/**
 * First real Prisma slice: the §8.1 audit log lives in Postgres from day one —
 * append-only rows with actor, action, entity, before/after and IP. Reads and
 * writes degrade gracefully: if the database is down the API keeps serving
 * (audit writes drop with a log line, /audit answers 503), and under vitest
 * the client is never created at all so tests stay hermetic.
 */

let client: PrismaClient | null = null
let known = { companyId: "" }

const enabled = () => process.env.NODE_ENV !== "test" && process.env.AUDIT_DB !== "0"

export function prisma(): PrismaClient | null {
  if (!enabled()) return null
  if (!client) client = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) })
  return client
}

/** The single-company row every audit row hangs off. Created on first use. */
async function companyId(db: PrismaClient): Promise<string> {
  if (known.companyId) return known.companyId
  const company = await db.company.upsert({
    where: { id: "co_delta" },
    update: {},
    create: { id: "co_delta", name: "Delta Attendance" },
  })
  known.companyId = company.id
  return company.id
}

export interface AuditEntry {
  actorId: string
  action: string
  entity: string
  entityId: string
  before?: unknown
  after?: unknown
  ip?: string
}

/** Fire-and-forget by design: an audit outage must never fail the request. */
export function recordAudit(entry: AuditEntry): void {
  const db = prisma()
  if (!db) return
  void (async () => {
    const company = await companyId(db)
    await db.auditLog.create({
      data: {
        companyId: company,
        actorId: entry.actorId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        beforeJson: entry.before === undefined ? undefined : (entry.before as object),
        afterJson: entry.after === undefined ? undefined : (entry.after as object),
        ip: entry.ip,
      },
    })
  })().catch((error) => {
    console.error("audit write failed:", (error as Error).message)
  })
}

export async function auditPage(limit = 200) {
  const db = prisma()
  if (!db) return null
  return db.auditLog.findMany({ orderBy: { at: "desc" }, take: limit })
}
