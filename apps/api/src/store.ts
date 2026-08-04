import bcrypt from "bcryptjs"
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  DEFAULT_MATRIX,
  type AttendanceSettings,
  type PermissionMatrix,
  type PunchFlag,
  type PunchType,
  type Role,
  type ShiftSpec,
} from "@attendance/shared"

/**
 * In-memory store. The Prisma schema in prisma/schema.prisma is the real data
 * model; this stands in for it until Postgres can run on the dev machine
 * (Docker is not installed there). Every route goes through this module, so
 * swapping it for Prisma repositories changes nothing above it.
 */

export interface StoredUser {
  id: string
  name: string
  email: string
  passwordHash: string
  role: Role
  employeeId: string
}

export interface StoredEmployee {
  id: string
  code: string
  name: string
  email: string
  department: string
  branchId: string
  shiftId: string
  managerId: string | null
  isFieldEmployee: boolean
}

export interface StoredBranch {
  id: string
  name: string
  lat: number
  lng: number
}

export interface StoredPunch {
  id: string
  employeeId: string
  type: PunchType
  /** Business date, not the calendar date of the timestamp. */
  businessDate: string
  offsetMin: number
  at: string
  lat: number
  lng: number
  accuracyM: number
  dayPart: "FULL" | "FIRST_HALF" | "SECOND_HALF"
  flags: PunchFlag[]
  idempotencyKey: string
}

export interface StoredApproval {
  id: string
  kind: "LEAVE" | "REGULARISATION" | "OVERTIME" | "COMP_OFF"
  employeeId: string
  subject: string
  detail: string
  dateFrom: string
  dateTo: string
  units: number
  leaveType?: string
  leavePart?: "FULL" | "FIRST_HALF" | "SECOND_HALF"
  status: "PENDING" | "APPROVED" | "REJECTED"
  decidedBy?: string
  remarks?: string
}

export interface LedgerRow {
  id: string
  employeeId: string
  type: string
  txnType: "OPENING" | "ACCRUAL" | "AVAIL" | "ADJUST" | "COMP_OFF_CREDIT"
  units: number
  date: string
  remarks: string
}

export interface Branding {
  companyName: string
  /** Data URL; object storage takes over in Phase 3. */
  logoDataUrl: string | null
}

export interface Store {
  users: StoredUser[]
  employees: StoredEmployee[]
  branches: StoredBranch[]
  shifts: ShiftSpec[]
  punches: StoredPunch[]
  approvals: StoredApproval[]
  ledger: LedgerRow[]
  holidays: Record<string, string>
  settings: AttendanceSettings
  matrix: PermissionMatrix
  branding: Branding
  nextId: number
}

export const id = (store: Store, prefix: string) => `${prefix}_${store.nextId++}`

export function seedStore(): Store {
  const hash = (password: string) => bcrypt.hashSync(password, 4)

  const shifts: ShiftSpec[] = [
    { id: "gen", name: "General", short: "G", startMin: 540, endMin: 1080, breakMin: 60 },
    { id: "night", name: "Night", short: "N", startMin: 1320, endMin: 360, breakMin: 30 },
  ]

  const employees: StoredEmployee[] = [
    { id: "e1", code: "DLT0001", name: "Virag Jain", email: "virag@delta.dev", department: "Operations", branchId: "b1", shiftId: "gen", managerId: null, isFieldEmployee: false },
    { id: "e2", code: "DLT0002", name: "Priya Nair", email: "priya@delta.dev", department: "HR", branchId: "b1", shiftId: "gen", managerId: "e1", isFieldEmployee: false },
    { id: "e3", code: "DLT0003", name: "Rohan Desai", email: "rohan@delta.dev", department: "Operations", branchId: "b1", shiftId: "gen", managerId: "e1", isFieldEmployee: false },
    { id: "e4", code: "DLT0004", name: "Kabir Singh", email: "kabir@delta.dev", department: "Operations", branchId: "b1", shiftId: "gen", managerId: "e3", isFieldEmployee: false },
    { id: "e5", code: "DLT0005", name: "Meera Joshi", email: "meera@delta.dev", department: "Sales", branchId: "b1", shiftId: "gen", managerId: "e3", isFieldEmployee: true },
    { id: "e6", code: "DLT0006", name: "Aditya Rao", email: "aditya@delta.dev", department: "Production", branchId: "b1", shiftId: "night", managerId: "e3", isFieldEmployee: false },
  ]

  return {
    users: [
      { id: "u1", name: "Virag Jain", email: "admin@delta.dev", passwordHash: hash("Admin@123"), role: "ADMIN", employeeId: "e1" },
      { id: "u2", name: "Priya Nair", email: "hr@delta.dev", passwordHash: hash("Hr@12345"), role: "HR", employeeId: "e2" },
      { id: "u3", name: "Rohan Desai", email: "ops@delta.dev", passwordHash: hash("Ops@1234"), role: "OPERATIONS", employeeId: "e3" },
      { id: "u4", name: "Kabir Singh", email: "employee@delta.dev", passwordHash: hash("Emp@1234"), role: "EMPLOYEE", employeeId: "e4" },
    ],
    employees,
    branches: [{ id: "b1", name: "Mumbai HO", lat: 19.076, lng: 72.8777 }],
    shifts,
    punches: [],
    approvals: [],
    ledger: [
      { id: "l1", employeeId: "e4", type: "CL", txnType: "OPENING", units: 7, date: "2026-01-01", remarks: "Opening balance" },
      { id: "l2", employeeId: "e4", type: "EL", txnType: "OPENING", units: 11.5, date: "2026-01-01", remarks: "Opening balance" },
    ],
    holidays: { "2026-08-15": "Independence Day" },
    settings: { ...DEFAULT_ATTENDANCE_SETTINGS },
    matrix: structuredClone(DEFAULT_MATRIX),
    branding: { companyName: "Delta Attendance", logoDataUrl: null },
    nextId: 1,
  }
}
