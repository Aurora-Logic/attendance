import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

/**
 * Idempotent seed: the same org/users the in-memory store carries, written to
 * the real tables so the repository swap lands on populated ground. Run with
 * `pnpm db:seed`; safe to re-run.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://attendance:attendance@localhost:5433/attendance"
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) })

async function main() {
  const company = await db.company.upsert({
    where: { id: "co_delta" },
    update: {},
    create: { id: "co_delta", name: "Delta Attendance", timezone: "Asia/Kolkata" },
  })

  const branch = await db.branch.upsert({
    where: { id: "br_ho" },
    update: {},
    create: {
      id: "br_ho",
      companyId: company.id,
      name: "Mumbai HO",
      stateCode: "MH",
      geofenceLat: 19.076,
      geofenceLng: 72.8777,
      geofenceRadiusM: 200,
    },
  })

  const shifts: Array<[string, string, string, number, number, number]> = [
    ["sh_gen", "General", "G", 540, 1080, 60],
    ["sh_night", "Night", "N", 1320, 360, 30],
  ]
  for (const [id, name, short, startMin, endMin, breakMin] of shifts) {
    await db.shift.upsert({
      where: { id },
      update: {},
      create: { id, companyId: company.id, name, short, startMin, endMin, breakMin },
    })
  }

  const employees: Array<[string, string, string, string, string | null, boolean]> = [
    ["e1", "DLT0001", "Virag Jain", "virag@delta.dev", null, false],
    ["e2", "DLT0002", "Priya Nair", "priya@delta.dev", "e1", false],
    ["e3", "DLT0003", "Rohan Desai", "rohan@delta.dev", "e1", false],
    ["e4", "DLT0004", "Kabir Singh", "kabir@delta.dev", "e3", false],
    ["e5", "DLT0005", "Meera Joshi", "meera@delta.dev", "e3", true],
    ["e6", "DLT0006", "Aditya Rao", "aditya@delta.dev", "e3", false],
  ]
  for (const [id, code, name, email, managerId, isField] of employees) {
    await db.employee.upsert({
      where: { id },
      update: { managerId },
      create: {
        id,
        companyId: company.id,
        branchId: branch.id,
        code,
        name,
        email,
        managerId,
        isFieldEmployee: isField,
        status: "CONFIRMED",
        joinedOn: new Date("2024-01-15"),
        defaultShiftId: id === "e6" ? "sh_night" : "sh_gen",
      },
    })
  }

  const users: Array<[string, string, string, "ADMIN" | "HR" | "OPERATIONS" | "EMPLOYEE", string]> = [
    ["u1", "admin@delta.dev", "Admin@123", "ADMIN", "e1"],
    ["u2", "hr@delta.dev", "Hr@12345", "HR", "e2"],
    ["u3", "ops@delta.dev", "Ops@1234", "OPERATIONS", "e3"],
    ["u4", "employee@delta.dev", "Emp@1234", "EMPLOYEE", "e4"],
  ]
  for (const [id, email, password, role, employeeId] of users) {
    await db.user.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: company.id,
        email,
        passwordHash: bcrypt.hashSync(password, 8),
        role,
        employeeId,
      },
    })
  }

  const counts = {
    companies: await db.company.count(),
    branches: await db.branch.count(),
    employees: await db.employee.count(),
    users: await db.user.count(),
    auditRows: await db.auditLog.count(),
  }
  console.log("seeded:", counts)
}

main()
  .then(() => db.$disconnect())
  .catch((error) => {
    console.error(error)
    return db.$disconnect().then(() => process.exit(1))
  })
