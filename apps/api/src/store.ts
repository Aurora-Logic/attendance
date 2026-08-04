import bcrypt from "bcryptjs"
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  DEFAULT_MATRIX,
  type AttendanceSettings,
  type Grn,
  type Item,
  type PermissionMatrix,
  type PunchFlag,
  type PunchType,
  type PurchaseOrder,
  type Role,
  type ShiftSpec,
  type Vendor,
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
  vendors: Vendor[]
  items: Item[]
  /** Master lists behind the item form's pickers — grown inline, never typo'd. */
  brands: string[]
  categories: string[]
  pos: PurchaseOrder[]
  grns: Grn[]
  /** Per-year document sequences (PO-2026-0042); year rollover resets in Prisma. */
  seq: { po: number; grn: number }
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
    vendors: [
      { id: "v1", code: "VND001", name: "Shree Steel Traders", gstin: "27AABCS1429B1ZP", contact: "Mahesh Kulkarni", email: "sales@shreesteel.in", phone: "+91 98200 11223", address: "Kalbadevi Road", city: "Mumbai", state: "Maharashtra", paymentTermsDays: 30, leadTimeDays: 7, active: true },
      { id: "v2", code: "VND002", name: "Om Packaging Co", gstin: null, contact: "Sunita Shah", email: "om.pack@gmail.com", phone: "+91 98111 44556", address: "MIDC Phase II", city: "Pune", state: "Maharashtra", paymentTermsDays: 15, leadTimeDays: 4, active: true },
    ],
    items: [
      { id: "i1", code: "ITM001", name: "MS Sheet 2mm", brand: "Tata Steel", category: "Raw Material", unit: "KG", hsn: "7208", gstRatePct: 18, lastPricePaise: 6_500, active: true },
      { id: "i2", code: "ITM002", name: "Corrugated Box 18×12×10", brand: "", category: "Packaging", unit: "PCS", hsn: "4819", gstRatePct: 12, lastPricePaise: 3_200, active: true },
      { id: "i3", code: "ITM003", name: "Machine Oil SAE-40", brand: "Castrol", category: "Consumables", unit: "L", hsn: "2710", gstRatePct: 18, lastPricePaise: 28_000, active: true },
    ],
    brands: ["Tata Steel", "Castrol"],
    categories: ["Raw Material", "Packaging", "Consumables"],
    pos: [],
    grns: [],
    seq: { po: 0, grn: 0 },
    nextId: 1,
  }
}
