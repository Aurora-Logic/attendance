import type { AttendanceDay, DayStatus, PunchFlag } from "@attendance/shared"

/**
 * Phase-0/1 stand-in for the API. Every shape here matches the real schema, so
 * wiring TanStack Query in later phases replaces this file and nothing else.
 *
 * Deterministic pseudo-random so the demo looks identical on every reload — a
 * shifting table makes UI review impossible.
 */
function seeded(n: number) {
  const x = Math.sin(n) * 10_000
  return x - Math.floor(x)
}

const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`

export const BRANCHES = [
  { id: "ho", name: "Mumbai HO", state: "MH" },
  { id: "pune", name: "Pune Plant", state: "MH" },
  { id: "blr", name: "Bengaluru Office", state: "KA" },
]

export const DEPARTMENTS = ["Operations", "Production", "Finance", "HR", "Quality"]

const FIRST = [
  "Aarav", "Diya", "Vihaan", "Ananya", "Kabir", "Ishaan", "Meera", "Rohan",
  "Saanvi", "Arjun", "Riya", "Aditya", "Neha", "Karan", "Pooja", "Siddharth",
  "Tanvi", "Manav", "Aisha", "Farhan", "Nikhil", "Shreya", "Vikram", "Lakshmi",
  "Rahul", "Divya", "Yash", "Kavya", "Omkar", "Sneha",
]
const LAST = [
  "Sharma", "Patel", "Reddy", "Iyer", "Singh", "Nair", "Joshi", "Desai",
  "Kulkarni", "Menon", "Bose", "Rao", "Gupta", "Verma", "Shah",
]

export interface Employee {
  id: string
  code: string
  name: string
  initials: string
  department: string
  designation: string
  branchId: string
  shift: string
  manager: string
  status: "PROBATION" | "CONFIRMED" | "NOTICE" | "EXITED"
  doj: string
  isFieldEmployee: boolean
  email: string
  /** Present on live-API rows; seeded rows only carry the display name. */
  shiftId?: string
}

const DESIGNATIONS = ["Operator", "Senior Operator", "Supervisor", "Executive", "Manager"]

export const EMPLOYEES: Employee[] = FIRST.map((first, index) => {
  const r = seeded(index + 1)
  const last = LAST[index % LAST.length]
  const name = `${first} ${last}`
  const statuses: Employee["status"][] = ["CONFIRMED", "CONFIRMED", "CONFIRMED", "PROBATION", "NOTICE"]
  return {
    id: `emp_${index + 1}`,
    code: `DLT${String(index + 1).padStart(4, "0")}`,
    name,
    initials: `${first[0]}${last[0]}`,
    department: DEPARTMENTS[index % DEPARTMENTS.length],
    designation: DESIGNATIONS[Math.floor(r * DESIGNATIONS.length)],
    branchId: BRANCHES[index % BRANCHES.length].id,
    shift: index % 6 === 0 ? "Night 22:00–06:00" : "General 09:00–18:00",
    manager: index < 3 ? "—" : `${FIRST[index % 3]} ${LAST[index % 3]}`,
    status: statuses[Math.floor(r * statuses.length)],
    doj: `20${20 + (index % 6)}-${String((index % 12) + 1).padStart(2, "0")}-1${index % 9}`,
    isFieldEmployee: r > 0.85,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
  }
})

export const TODAY = "2026-08-03"

/**
 * Cached per date. The seed is deterministic, so a fresh array each call was
 * pure waste — and worse, a new identity every render, which defeats every
 * `useMemo` and effect dependency downstream of it in demo mode.
 */
const seedDayCache = new Map<string, AttendanceDay[]>()

export function seedAttendanceDays(date = TODAY): AttendanceDay[] {
  const cached = seedDayCache.get(date)
  if (cached) return cached
  const rows = buildSeedAttendanceDays(date)
  seedDayCache.set(date, rows)
  return rows
}

function buildSeedAttendanceDays(date: string): AttendanceDay[] {
  return EMPLOYEES.map((employee, index) => {
    const r = seeded(index + 7)
    const shiftStartMin = employee.shift.startsWith("Night") ? 22 * 60 : 9 * 60

    // Status is decided first. Lateness, flags and worked hours only exist for
    // a day the employee actually attended — a row cannot be ABSENT and 40m
    // late at the same time.
    const isAbsent = r > 0.94
    const isLeave = r > 0.86 && !isAbsent
    const isOffsite = r > 0.79 && !isAbsent && !isLeave

    let status: DayStatus = "PRESENT"
    if (isAbsent) status = "ABSENT"
    else if (isLeave) status = "ON_LEAVE"
    else if (isOffsite) status = "ON_DUTY"
    else if (r < 0.1) status = "HALF_DAY"
    else if (r > 0.74 && r < 0.79) status = "WFH"

    const attended = !isAbsent && !isLeave
    const lateMinutes = attended && r > 0.6 ? Math.floor(r * 46) : 0

    const flags: PunchFlag[] = []
    if (attended) {
      if (lateMinutes > 10) flags.push("LATE")
      if (isOffsite) flags.push("OUT_OF_GEOFENCE")
      if (r > 0.45 && r < 0.49) flags.push("OFFLINE_SYNCED")
      if (r > 0.5 && r < 0.53) flags.push("MISSING_PUNCH_OUT")
      if (flags.length === 0) flags.push("ON_TIME")
    }

    const inMinutes = shiftStartMin + lateMinutes
    // Vary worked time so the column is not a wall of identical values.
    const workedMinutes = !attended
      ? 0
      : status === "HALF_DAY"
        ? 200 + Math.floor(r * 40)
        : 465 + Math.floor(r * 60)
    const needsApproval = flags.some((flag) => flag !== "ON_TIME")

    return {
      id: `ad_${index + 1}`,
      employeeId: employee.id,
      employeeCode: employee.code,
      employeeName: employee.name,
      department: employee.department,
      date,
      shiftName: employee.shift,
      status,
      firstInAt: isAbsent || isLeave ? null : clock(inMinutes),
      lastOutAt: isAbsent || isLeave ? null : clock(inMinutes + workedMinutes + 60),
      workedMinutes,
      lateMinutes,
      otMinutes: r > 0.62 && !isAbsent && !isLeave ? Math.floor(r * 75) : 0,
      flags,
      approvalStatus: needsApproval ? "PENDING" : "NOT_REQUIRED",
      halfDayReason: status === "HALF_DAY" ? "WORKED_HOURS" : null,
      payableUnits: isAbsent ? 0 : status === "HALF_DAY" ? 0.5 : 1,
      isLocked: false,
    }
  })
}

/* ---------------------------------------------------------------- approvals */

export type RequestKind = "LEAVE" | "REGULARISATION" | "OVERTIME" | "COMP_OFF"

export interface ApprovalRequest {
  id: string
  kind: RequestKind
  employeeId: string
  employeeName: string
  employeeCode: string
  initials: string
  department: string
  subject: string
  detail: string
  dateFrom: string
  dateTo: string
  units: string
  raisedAt: string
  ageDays: number
  level: 1 | 2
  status: "PENDING" | "APPROVED" | "REJECTED"
}

const LEAVE_SUBJECTS = ["Casual Leave", "Sick Leave", "Earned Leave", "Comp-Off"]
const REG_SUBJECTS = [
  "Missed punch-out",
  "Out of geofence — client visit",
  "Work from home",
  "On duty — vendor audit",
  "Wrong punch type",
]

export function seedApprovals(): ApprovalRequest[] {
  const kinds: RequestKind[] = ["LEAVE", "REGULARISATION", "OVERTIME", "COMP_OFF"]
  return Array.from({ length: 26 }, (_, index) => {
    const r = seeded(index + 31)
    const employee = EMPLOYEES[index % EMPLOYEES.length]
    const kind = kinds[Math.floor(r * kinds.length)]
    const day = 1 + Math.floor(r * 26)
    const ageDays = Math.floor(r * 5)
    return {
      id: `req_${index + 1}`,
      kind,
      employeeId: employee.id,
      employeeName: employee.name,
      employeeCode: employee.code,
      initials: employee.initials,
      department: employee.department,
      subject:
        kind === "LEAVE"
          ? LEAVE_SUBJECTS[Math.floor(r * LEAVE_SUBJECTS.length)]
          : kind === "REGULARISATION"
            ? REG_SUBJECTS[Math.floor(r * REG_SUBJECTS.length)]
            : kind === "OVERTIME"
              ? "Overtime claim"
              : "Comp-off credit",
      detail:
        kind === "REGULARISATION"
          ? "Punched in at the client site; geofence radius is 200 m from Mumbai HO."
          : kind === "LEAVE"
            ? "Family function out of town. Handover shared with the shift supervisor."
            : "Extended shift to close the month-end dispatch.",
      dateFrom: `2026-08-${String(day).padStart(2, "0")}`,
      dateTo: `2026-08-${String(Math.min(day + Math.floor(r * 2), 28)).padStart(2, "0")}`,
      units: kind === "OVERTIME" ? `${1 + Math.floor(r * 3)}h 30m` : `${1 + Math.floor(r * 2)} day(s)`,
      raisedAt: `2026-08-${String(Math.max(day - 1, 1)).padStart(2, "0")}`,
      ageDays,
      level: ageDays >= 2 ? 2 : 1,
      status: "PENDING",
    }
  })
}

/* -------------------------------------------------------------------- leave */

export interface LeaveBalance {
  code: string
  name: string
  entitled: number
  availed: number
  balance: number
  isPaid: boolean
}

export const LEAVE_BALANCES: LeaveBalance[] = [
  { code: "CL", name: "Casual Leave", entitled: 12, availed: 5, balance: 7, isPaid: true },
  { code: "SL", name: "Sick Leave", entitled: 12, availed: 3, balance: 9, isPaid: true },
  { code: "EL", name: "Earned Leave", entitled: 18, availed: 6.5, balance: 11.5, isPaid: true },
  { code: "CO", name: "Comp-Off", entitled: 4, availed: 1, balance: 3, isPaid: true },
  { code: "LOP", name: "Loss of Pay", entitled: 0, availed: 2, balance: 0, isPaid: false },
]

export interface LeaveLedgerRow {
  id: string
  date: string
  type: string
  txnType: "OPENING" | "ACCRUAL" | "AVAIL" | "ADJUST" | "LAPSE" | "COMP_OFF_CREDIT"
  units: number
  balanceAfter: number
  remarks: string
}

export function seedLeaveLedger(): LeaveLedgerRow[] {
  const rows: Array<Omit<LeaveLedgerRow, "id" | "balanceAfter">> = [
    { date: "2026-01-01", type: "EL", txnType: "OPENING", units: 6, remarks: "Carry forward from 2025" },
    { date: "2026-01-31", type: "EL", txnType: "ACCRUAL", units: 1.5, remarks: "Monthly accrual" },
    { date: "2026-02-28", type: "EL", txnType: "ACCRUAL", units: 1.5, remarks: "Monthly accrual" },
    { date: "2026-03-14", type: "EL", txnType: "AVAIL", units: -2, remarks: "REQ-1043 approved by HR" },
    { date: "2026-03-31", type: "EL", txnType: "ACCRUAL", units: 1.5, remarks: "Monthly accrual" },
    { date: "2026-04-22", type: "CO", txnType: "COMP_OFF_CREDIT", units: 1, remarks: "Holiday working 26 Jan" },
    { date: "2026-04-30", type: "EL", txnType: "ACCRUAL", units: 1.5, remarks: "Monthly accrual" },
    { date: "2026-05-18", type: "EL", txnType: "AVAIL", units: -4.5, remarks: "REQ-1188 approved by HR" },
    { date: "2026-06-30", type: "EL", txnType: "ACCRUAL", units: 1.5, remarks: "Monthly accrual" },
    { date: "2026-07-31", type: "EL", txnType: "ACCRUAL", units: 1.5, remarks: "Monthly accrual" },
  ]
  let running = 0
  return rows.map((row, index) => {
    running += row.units
    return { ...row, id: `led_${index + 1}`, balanceAfter: Number(running.toFixed(1)) }
  })
}

/* ------------------------------------------------------------------ payroll */

export interface PayrollRun {
  id: string
  period: string
  branch: string
  runType: "REGULAR" | "ADJUSTMENT" | "FNF"
  status: "DRAFT" | "CALCULATED" | "APPROVED" | "RELEASED"
  employees: number
  grossPaise: number
  deductionsPaise: number
  netPaise: number
  attendanceLocked: boolean
  version: number
}

export const PAYROLL_RUNS: PayrollRun[] = [
  {
    id: "run_2026_07",
    period: "July 2026",
    branch: "All branches",
    runType: "REGULAR",
    status: "RELEASED",
    employees: 30,
    grossPaise: 428_50_000,
    deductionsPaise: 61_20_000,
    netPaise: 367_30_000,
    attendanceLocked: true,
    version: 1,
  },
  {
    id: "run_2026_06_adj",
    period: "June 2026",
    branch: "Pune Plant",
    runType: "ADJUSTMENT",
    status: "RELEASED",
    employees: 4,
    grossPaise: 18_40_000,
    deductionsPaise: 2_10_000,
    netPaise: 16_30_000,
    attendanceLocked: true,
    version: 2,
  },
  {
    id: "run_2026_06",
    period: "June 2026",
    branch: "All branches",
    runType: "REGULAR",
    status: "RELEASED",
    employees: 29,
    grossPaise: 411_80_000,
    deductionsPaise: 58_90_000,
    netPaise: 352_90_000,
    attendanceLocked: true,
    version: 1,
  },
  {
    id: "run_2026_08",
    period: "August 2026",
    branch: "All branches",
    runType: "REGULAR",
    status: "DRAFT",
    employees: 30,
    grossPaise: 0,
    deductionsPaise: 0,
    netPaise: 0,
    attendanceLocked: false,
    version: 1,
  },
]

/* ------------------------------------------------------------------- audit */

export interface AuditRow {
  id: string
  at: string
  actor: string
  action: string
  entity: string
  entityId: string
  ip: string
  before: string
  after: string
}

export function seedAudit(): AuditRow[] {
  const actions = [
    ["settings.update", "settings", "late_grace_minutes"],
    ["leave.approve", "leave_requests", "REQ-1204"],
    ["employee.update", "employees", "DLT0012"],
    ["payroll.lock", "attendance_month_locks", "2026-07"],
    ["punch.regularise", "punches", "PCH-88213"],
    ["role.grant", "user_roles", "USR-31"],
  ]
  return Array.from({ length: 24 }, (_, index) => {
    const r = seeded(index + 91)
    const [action, entity, entityId] = actions[index % actions.length]
    return {
      id: `aud_${index + 1}`,
      at: `2026-08-${String(1 + (index % 3)).padStart(2, "0")} ${clock(540 + Math.floor(r * 480))}`,
      actor: EMPLOYEES[index % 4].name,
      action,
      entity,
      entityId,
      ip: `10.20.${Math.floor(r * 250)}.${index + 3}`,
      before: action === "settings.update" ? '{"value":10}' : '{"status":"PENDING"}',
      after: action === "settings.update" ? '{"value":15}' : '{"status":"APPROVED"}',
    }
  })
}

/* ----------------------------------------------------------------- reports */

export interface ReportDef {
  key: string
  title: string
  description: string
  sheets: string[]
  phase: number
}

export const REPORTS: ReportDef[] = [
  {
    key: "daily-register",
    title: "Daily attendance register",
    description: "Who is in, who is late, who is absent — as at the selected date.",
    sheets: ["Register"],
    phase: 6,
  },
  {
    key: "muster-roll",
    title: "Monthly muster roll",
    description: "The classic employees × days grid, colour-coded with a legend.",
    sheets: ["Summary", "Muster Roll", "Late & Early", "Exceptions", "Leave Taken"],
    phase: 6,
  },
  {
    key: "late-early",
    title: "Late-coming & early-going",
    description: "Every late mark and early exit with minutes and approval state.",
    sheets: ["Late", "Early"],
    phase: 6,
  },
  {
    key: "absent-lop",
    title: "Absenteeism & LOP",
    description: "Unapproved absents converted to loss-of-pay days.",
    sheets: ["Absent", "LOP"],
    phase: 6,
  },
  {
    key: "overtime",
    title: "Overtime",
    description: "Approved overtime minutes by employee and shift multiplier.",
    sheets: ["Overtime"],
    phase: 6,
  },
  {
    key: "leave-balance",
    title: "Leave balance & availed",
    description: "Opening, accrued, availed, closing — reconciled to the ledger.",
    sheets: ["Balance", "Availed", "Ledger"],
    phase: 6,
  },
  {
    key: "exceptions",
    title: "Missing punch & exceptions",
    description: "Every unresolved exception with its age and owner.",
    sheets: ["Exceptions"],
    phase: 6,
  },
  {
    key: "turnaround",
    title: "Regularisation & approval turnaround",
    description: "Time from raise to decision, by approver and level.",
    sheets: ["Turnaround"],
    phase: 6,
  },
  {
    key: "salary-register",
    title: "Salary register",
    description: "Component-wise register with SUM totals, plus a bank upload sheet.",
    sheets: ["Register", "Bank Upload"],
    phase: 7,
  },
  {
    key: "headcount",
    title: "Headcount & attrition",
    description: "Joiners, leavers and rolling attrition by department.",
    sheets: ["Headcount", "Movement"],
    phase: 6,
  },
]

export interface ExportJob {
  id: string
  report: string
  filename: string
  rows: number
  status: "QUEUED" | "RUNNING" | "READY" | "FAILED"
  progress: number
  requestedAt: string
}

export const EXPORT_JOBS: ExportJob[] = [
  {
    id: "exp_3",
    report: "Monthly muster roll",
    filename: "Delta_MusterRoll_All_2026-07.xlsx",
    rows: 930,
    status: "READY",
    progress: 100,
    requestedAt: "09:14",
  },
  {
    id: "exp_2",
    report: "Salary register",
    filename: "Delta_SalaryRegister_All_2026-07.xlsx",
    rows: 30,
    status: "READY",
    progress: 100,
    requestedAt: "09:02",
  },
  {
    id: "exp_1",
    report: "Leave balance & availed",
    filename: "Delta_LeaveBalance_All_2026-08.xlsx",
    rows: 6420,
    status: "RUNNING",
    progress: 62,
    requestedAt: "09:31",
  },
]

/* ------------------------------------------------------------------ charts */

export const WEEK_TREND = [
  { day: "Mon", present: 24, absent: 2, leave: 4 },
  { day: "Tue", present: 26, absent: 1, leave: 3 },
  { day: "Wed", present: 23, absent: 3, leave: 4 },
  { day: "Thu", present: 27, absent: 1, leave: 2 },
  { day: "Fri", present: 25, absent: 2, leave: 3 },
  { day: "Sat", present: 14, absent: 1, leave: 2 },
]

export const LATE_TREND = [
  { week: "W27", lateMinutes: 412 },
  { week: "W28", lateMinutes: 388 },
  { week: "W29", lateMinutes: 455 },
  { week: "W30", lateMinutes: 301 },
  { week: "W31", lateMinutes: 344 },
  { week: "W32", lateMinutes: 268 },
]

/** Arrival spread relative to shift start — where the workforce actually lands. */
export const ARRIVAL_HISTOGRAM = [
  { bucket: "15m+ early", count: 3, fill: "var(--status-present)" },
  { bucket: "5–15m early", count: 9, fill: "var(--status-present)" },
  { bucket: "0–5m early", count: 7, fill: "var(--status-wfh)" },
  { bucket: "In grace", count: 6, fill: "var(--status-wfh)" },
  { bucket: "Late 15–30m", count: 4, fill: "var(--status-half-day)" },
  { bucket: "Late 30m+", count: 1, fill: "var(--status-absent)" },
]

export const OT_BY_DEPARTMENT = [
  { department: "Production", hours: 148, fill: "var(--chart-1)" },
  { department: "Operations", hours: 96, fill: "var(--chart-2)" },
  { department: "Quality", hours: 54, fill: "var(--chart-3)" },
  { department: "Finance", hours: 22, fill: "var(--chart-4)" },
  { department: "HR", hours: 11, fill: "var(--chart-5)" },
]

/** Approval turnaround, in hours, by level — feeds the §7 turnaround report. */
export const TURNAROUND_TREND = [
  { week: "W27", l1: 9, l2: 26 },
  { week: "W28", l1: 12, l2: 31 },
  { week: "W29", l1: 7, l2: 22 },
  { week: "W30", l1: 15, l2: 38 },
  { week: "W31", l1: 6, l2: 19 },
  { week: "W32", l1: 8, l2: 24 },
]

export const LEAVE_UTILISATION = [
  { type: "CL", used: 42, remaining: 58 },
  { type: "SL", used: 25, remaining: 75 },
  { type: "EL", used: 36, remaining: 64 },
  { type: "CO", used: 25, remaining: 75 },
]
