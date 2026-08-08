import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  DEFAULT_OPERATIONS_SETTINGS,
  type AttendanceDay,
  type OperationsSettings,
} from "@attendance/shared"

import { apiFetch, describeApiError } from "@/lib/api"
import { useSession } from "@/lib/session"
import {
  DEPARTMENTS as SEED_DEPARTMENTS,
  EMPLOYEES,
  LEAVE_BALANCES,
  seedApprovals,
  seedAttendanceDays,
  type ApprovalRequest,
  type Employee,
  type LeaveBalance,
} from "@/lib/seed"

/**
 * Screen data with one rule: API session → server truth via TanStack Query;
 * demo session (API down at sign-in) → the seed, clearly labelled. Every hook
 * returns `source` so a screen can say which world it is showing.
 */

export type DataSource = "api" | "demo"

const initialsOf = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()

// ---------------------------------------------------------------- attendance

interface ApiDayRow {
  employeeId: string
  code: string
  name: string
  department: string
  shiftName: string
  firstInAt: string | null
  lastOutAt: string | null
  status: AttendanceDay["status"]
  payableUnits: number
  halfDayReason: AttendanceDay["halfDayReason"]
  workedMinutes: number
  lateMinutes: number
  otMinutes: number
  flags: AttendanceDay["flags"]
  needsApproval: boolean
  selfieThumb: string | null
  selfieView: string | null
  syncDeltaSec: number | null
}

export function useAttendanceDays(dateISO: string) {
  const { user } = useSession()
  const enabled = user?.source === "api"

  const query = useQuery({
    queryKey: ["attendance-days", dateISO],
    enabled,
    queryFn: () =>
      apiFetch<{ date: string; rows: ApiDayRow[] }>(`/attendance/days?date=${dateISO}`),
    select: (payload): AttendanceDay[] =>
      payload.rows.map((row) => ({
        id: `${row.employeeId}_${payload.date}`,
        employeeId: row.employeeId,
        employeeCode: row.code,
        employeeName: row.name,
        department: row.department,
        date: payload.date,
        shiftName: row.shiftName,
        status: row.status,
        firstInAt: row.firstInAt,
        lastOutAt: row.lastOutAt,
        workedMinutes: row.workedMinutes,
        lateMinutes: row.lateMinutes,
        otMinutes: row.otMinutes,
        flags: row.flags,
        approvalStatus: row.needsApproval ? "PENDING" : "NOT_REQUIRED",
        halfDayReason: row.halfDayReason,
        payableUnits: row.payableUnits,
        isLocked: false,
        selfieThumb: row.selfieThumb,
        selfieView: row.selfieView,
        syncDeltaSec: row.syncDeltaSec,
      })),
  })

  if (!enabled) {
    return { rows: seedAttendanceDays(), source: "demo" as DataSource, isLoading: false }
  }
  return {
    rows: query.data ?? [],
    source: "api" as DataSource,
    isLoading: query.isLoading,
  }
}

// ---------------------------------------------------------------- approvals

interface ApiApproval {
  id: string
  kind: ApprovalRequest["kind"]
  employeeId: string
  employeeName: string
  employeeCode: string
  department: string
  subject: string
  detail: string
  dateFrom: string
  dateTo: string
  units: number
  status: "PENDING" | "APPROVED" | "REJECTED"
  level: 1 | 2
  createdAt: string
  leaveType?: string
  leavePart?: "FULL" | "FIRST_HALF" | "SECOND_HALF"
}

const toApprovalView = (approval: ApiApproval): ApprovalRequest => ({
  id: approval.id,
  kind: approval.kind,
  employeeId: approval.employeeId,
  employeeName: approval.employeeName,
  employeeCode: approval.employeeCode,
  initials: initialsOf(approval.employeeName),
  department: approval.department,
  subject: approval.subject,
  detail: approval.detail,
  dateFrom: approval.dateFrom,
  dateTo: approval.dateTo,
  units: approval.units > 0 ? `${approval.units} day(s)` : "—",
  raisedAt: approval.createdAt.slice(0, 10),
  ageDays: Math.max(
    0,
    Math.floor((Date.now() - new Date(approval.createdAt).getTime()) / 86_400_000)
  ),
  level: approval.level,
  status: approval.status,
})

export function useApprovals() {
  const { user } = useSession()
  const enabled = user?.source === "api"

  const query = useQuery({
    queryKey: ["approvals"],
    enabled,
    queryFn: () => apiFetch<{ approvals: ApiApproval[] }>("/approvals"),
    select: (payload) => payload.approvals.map(toApprovalView),
  })

  if (!enabled) {
    return { requests: null, source: "demo" as DataSource, isLoading: false }
  }
  return { requests: query.data ?? [], source: "api" as DataSource, isLoading: query.isLoading }
}

export function useDecideApprovals() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { ids: string[]; action: "APPROVE" | "REJECT"; remarks: string }) => {
      const results = await Promise.allSettled(
        input.ids.map((approvalId) =>
          apiFetch(`/approvals/${approvalId}/decide`, {
            method: "POST",
            body: JSON.stringify({ action: input.action, remarks: input.remarks }),
          })
        )
      )
      // Report WHY things failed, deduped — "usually scope" was a guess that
      // hid session expiry behind a misleading message.
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      )
      const reasons = [...new Set(rejected.map((result) => describeApiError(result.reason)))]
      return { done: input.ids.length - rejected.length, failed: rejected.length, reasons }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["approvals"] })
      void queryClient.invalidateQueries({ queryKey: ["attendance-days"] })
      void queryClient.invalidateQueries({ queryKey: ["leave-balances"] })
    },
  })
}

// ---------------------------------------------------------------- employees

interface ApiEmployee {
  id: string
  code: string
  name: string
  email: string
  department: string
  branchId: string
  shiftId: string
  shiftName: string
  managerId: string | null
  managerName: string | null
  isFieldEmployee: boolean
}

export function useEmployeesList() {
  const { user } = useSession()
  const enabled = user?.source === "api" && user.role !== "EMPLOYEE"

  const query = useQuery({
    queryKey: ["employees"],
    enabled,
    queryFn: () => apiFetch<{ employees: ApiEmployee[] }>("/employees"),
    select: (payload): Employee[] =>
      payload.employees.map((employee) => ({
        id: employee.id,
        code: employee.code,
        name: employee.name,
        initials: initialsOf(employee.name),
        department: employee.department,
        designation: "—",
        branchId: employee.branchId,
        shift: employee.shiftName,
        manager: employee.managerName ?? "—",
        status: "CONFIRMED",
        doj: "—",
        isFieldEmployee: employee.isFieldEmployee,
        email: employee.email,
        shiftId: employee.shiftId,
      })),
  })

  if (user?.source !== "api") {
    return { employees: EMPLOYEES, source: "demo" as DataSource, isLoading: false }
  }
  return {
    employees: query.data ?? [],
    source: "api" as DataSource,
    isLoading: query.isLoading,
  }
}

export function useCreateEmployee() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      code: string
      name: string
      email: string
      department: string
      branchId: string
      shiftId: string
      isFieldEmployee: boolean
    }) => apiFetch("/employees", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["employees"] }),
  })
}

export function useUpdateEmployee() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string
      name?: string
      email?: string
      department?: string
      branchId?: string
      shiftId?: string
      managerId?: string | null
      isFieldEmployee?: boolean
    }) => apiFetch(`/employees/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["employees"] })
      void queryClient.invalidateQueries({ queryKey: ["attendance-days"] })
    },
  })
}

// ---------------------------------------------------------------- leave

export function useLeaveBalances() {
  const { user } = useSession()
  const enabled = user?.source === "api"

  const query = useQuery({
    queryKey: ["leave-balances", user?.employeeId],
    enabled,
    queryFn: () =>
      apiFetch<{ balances: Record<string, number> }>(`/leave/balances/${user!.employeeId}`),
    select: (payload): LeaveBalance[] =>
      // Quota metadata (names, entitlements) is policy config — Phase 5 moves
      // it server-side. Balances themselves are the ledger's projection.
      LEAVE_BALANCES.map((meta) => {
        const balance = payload.balances[meta.code] ?? (meta.code === "LOP" ? 0 : 0)
        if (meta.code === "LOP") {
          return { ...meta, balance: 0, availed: Math.abs(Math.min(balance, 0)) }
        }
        return {
          ...meta,
          balance,
          availed: Math.max(meta.entitled - balance, 0),
        }
      }),
  })

  if (!enabled) {
    return { balances: LEAVE_BALANCES, source: "demo" as DataSource, isLoading: false }
  }
  return {
    balances: query.data ?? LEAVE_BALANCES,
    source: "api" as DataSource,
    isLoading: query.isLoading,
  }
}

export function useApplyLeave() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      type: string
      from: string
      to: string
      part: "FULL" | "FIRST_HALF" | "SECOND_HALF"
      reason: string
    }) =>
      apiFetch<{ approval: ApiApproval; units: number }>("/leave/apply", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["approvals"] })
      void queryClient.invalidateQueries({ queryKey: ["my-leave"] })
    },
  })
}

export interface MyLeaveRequestView {
  id: string
  type: string
  from: string
  to: string
  part: string
  units: number
  reason: string
  status: "PENDING" | "APPROVED" | "REJECTED"
}

export function useRaiseRegularisation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      date: string
      reason: string
      inTime?: string
      outTime?: string
      note: string
    }) =>
      apiFetch<{ approval: ApiApproval }>("/regularisations", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["approvals"] })
      void queryClient.invalidateQueries({ queryKey: ["attendance-days"] })
    },
  })
}

export function useClaimOvertime() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { date: string; note?: string }) =>
      apiFetch<{ approval: ApiApproval; otMinutes: number }>("/overtime/claims", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["approvals"] }),
  })
}

export function useClaimCompOff() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { date: string; note?: string }) =>
      apiFetch<{ approval: ApiApproval; credit: number }>("/comp-off/claims", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["approvals"] })
      void queryClient.invalidateQueries({ queryKey: ["leave-balances"] })
    },
  })
}

export interface NotificationRow {
  id: string
  kind: "APPROVAL_RAISED" | "APPROVAL_DECIDED" | "APPROVAL_ESCALATED" | "PUNCH_FLAGGED" | "COMP_OFF_EXPIRING"
  title: string
  body: string
  href: string
  createdAt: string
  readAt: string | null
}

/**
 * The bell's feed. Polled rather than pushed: a websocket for a handful of
 * approval notices is infrastructure this system does not need yet, and a
 * 60-second poll is well inside how fast anyone acts on one.
 */
export function useNotifications() {
  const { user } = useSession()
  const enabled = user?.source === "api"
  const query = useQuery({
    queryKey: ["notifications"],
    enabled,
    retry: false,
    refetchInterval: enabled ? 60_000 : false,
    queryFn: () =>
      apiFetch<{ notifications: NotificationRow[]; unread: number }>("/notifications"),
  })
  return {
    notifications: query.data?.notifications ?? [],
    unread: query.data?.unread ?? 0,
    enabled,
  }
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids?: string[]) =>
      apiFetch<{ marked: number }>("/notifications/read", {
        method: "POST",
        body: JSON.stringify(ids ? { ids } : {}),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  })
}

export function useMyLeaveRequests(): MyLeaveRequestView[] | null {
  const { user } = useSession()
  const enabled = user?.source === "api"

  const query = useQuery({
    queryKey: ["my-leave", user?.employeeId],
    enabled,
    // Server-scoped: one employee's own leave, not the whole company's
    // approvals filtered in the browser.
    queryFn: () => apiFetch<{ requests: ApiApproval[] }>("/me/requests?kind=LEAVE"),
    select: (payload) =>
      payload.requests
        .map((approval) => ({
          id: approval.id,
          type: approval.leaveType ?? approval.subject,
          from: approval.dateFrom,
          to: approval.dateTo,
          part: approval.leavePart ?? "FULL",
          units: approval.units,
          reason: approval.detail,
          status: approval.status,
        })),
  })

  return enabled ? (query.data ?? []) : null
}

// ---------------------------------------------------------------- audit

interface ApiAuditRow {
  id: string
  at: string
  actor: string
  action: string
  entity: string
  entityId: string
  before: unknown
  after: unknown
  ip: string | null
}

/** §8.1 served from Postgres — the first screen backed by the real database. */
export function useAuditRows() {
  const { user } = useSession()
  const enabled = user?.source === "api"

  const query = useQuery({
    queryKey: ["audit"],
    enabled,
    retry: false,
    queryFn: () => apiFetch<{ rows: ApiAuditRow[] }>("/audit"),
    select: (payload) =>
      payload.rows.map((row) => ({
        id: row.id,
        at: new Date(row.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "medium" }),
        actor: row.actor,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        before: row.before === null ? "—" : JSON.stringify(row.before, null, 1),
        after: row.after === null ? "—" : JSON.stringify(row.after, null, 1),
        ip: row.ip ?? "—",
      })),
  })

  if (!enabled) return { rows: null, source: "demo" as DataSource, isLoading: false }
  return {
    rows: query.isError ? null : (query.data ?? []),
    source: "api" as DataSource,
    isLoading: query.isLoading,
  }
}

// ---------------------------------------------------------------- fallbacks

/** Demo approvals list, memo-free (deterministic seed). */
export const demoApprovals = seedApprovals

// ---------------------------------------------------------------- departments

export interface DepartmentRow {
  id: string
  code: string
  name: string
  isActive: boolean
  sortOrder: number
}

/**
 * Departments are a Postgres master. Without an API session the seed list
 * stands in, shaped identically so forms and filters do not branch.
 */
export function useDepartments() {
  const { user } = useSession()
  const enabled = user?.source === "api"

  const query = useQuery({
    queryKey: ["departments"],
    enabled,
    retry: false,
    queryFn: () => apiFetch<{ departments: DepartmentRow[] }>("/departments"),
    select: (payload) => payload.departments,
  })

  if (!enabled || query.isError) {
    return {
      departments: SEED_DEPARTMENTS.map((name, index) => ({
        id: `seed_${index}`,
        code: name.slice(0, 4).toUpperCase(),
        name,
        isActive: true,
        sortOrder: index,
      })),
      source: "demo" as DataSource,
      isLoading: false,
    }
  }
  return {
    departments: query.data ?? [],
    source: "api" as DataSource,
    isLoading: query.isLoading,
  }
}

export interface ShiftRow {
  id: string
  name: string
  short: string
  startMin: number
  endMin: number
  breakMin: number
}

/** Shift specs come from the API; demo mirrors the server seed. */
export function useShifts() {
  const { user } = useSession()
  const enabled = user?.source === "api"

  const query = useQuery({
    queryKey: ["shifts"],
    enabled,
    retry: false,
    queryFn: () => apiFetch<{ shifts: ShiftRow[] }>("/shifts"),
    select: (payload) => payload.shifts,
  })

  if (!enabled || query.isError) {
    return {
      shifts: [
        { id: "gen", name: "General", short: "G", startMin: 540, endMin: 1080, breakMin: 60 },
        { id: "night", name: "Night", short: "N", startMin: 1320, endMin: 360, breakMin: 30 },
      ] satisfies ShiftRow[],
      source: "demo" as DataSource,
      isLoading: false,
    }
  }
  return { shifts: query.data ?? [], source: "api" as DataSource, isLoading: query.isLoading }
}

export function useCreateDepartment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { code: string; name: string }) =>
      apiFetch<{ department: DepartmentRow }>("/departments", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["departments"] }),
  })
}

export function useUpdateDepartment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: {
      id: string
      name?: string
      code?: string
      isActive?: boolean
    }) =>
      apiFetch<{ department: DepartmentRow }>(`/departments/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["departments"] }),
  })
}

// ---------------------------------------------------------------- calendar

export type CalendarDayType = "HOLIDAY" | "HALF_DAY"

export interface CalendarDayRow {
  date: string
  name: string
  type: CalendarDayType
}

/** Declared days: holidays and half working days, keyed by ISO date. */
export function useCalendarDays() {
  const { user } = useSession()
  const enabled = user?.source === "api"

  const query = useQuery({
    queryKey: ["calendar"],
    enabled,
    retry: false,
    queryFn: () => apiFetch<{ days: CalendarDayRow[] }>("/calendar"),
    select: (payload) =>
      Object.fromEntries(payload.days.map((day) => [day.date, day])) as Record<
        string,
        CalendarDayRow
      >,
  })

  return {
    days: enabled && !query.isError ? (query.data ?? {}) : null,
    source: (enabled ? "api" : "demo") as DataSource,
  }
}

export function useSetCalendarDay() {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["calendar"] })
    void queryClient.invalidateQueries({ queryKey: ["attendance-days"] })
  }
  return {
    declare: useMutation({
      mutationFn: (body: CalendarDayRow) =>
        apiFetch<{ day: CalendarDayRow }>("/calendar", {
          method: "PUT",
          body: JSON.stringify(body),
        }),
      onSuccess: invalidate,
    }),
    clear: useMutation({
      mutationFn: (dateISO: string) =>
        apiFetch(`/calendar/${dateISO}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
  }
}

// ---------------------------------------------------------------- exports

export interface ExportJobView {
  id: string
  report: string
  status: "QUEUED" | "RUNNING" | "READY" | "FAILED"
  filename: string
  rowCount: number
  createdAt: string
  error?: string
}

/** The real §7 queue. Polls while anything is in flight, sleeps otherwise. */
export function useExportJobs() {
  const { user } = useSession()
  const enabled = user?.source === "api"

  const query = useQuery({
    queryKey: ["exports"],
    enabled,
    retry: false,
    queryFn: () => apiFetch<{ jobs: ExportJobView[] }>("/exports"),
    select: (payload) => payload.jobs,
    refetchInterval: (query) =>
      query.state.data?.jobs.some(
        (job) => job.status === "QUEUED" || job.status === "RUNNING"
      )
        ? 1_500
        : false,
  })

  return {
    jobs: enabled && !query.isError ? (query.data ?? []) : null,
    source: (enabled ? "api" : "demo") as DataSource,
  }
}

export function useEnqueueExport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { report: "daily-register"; date: string }) =>
      apiFetch<{ job: ExportJobView }>("/exports", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["exports"] }),
  })
}

// ---------------------------------------------------------------- payroll

export interface PayrollRunView {
  id: string
  month: string
  version: number
  status: "RELEASED"
  createdAt: string
  totalGrossPaise: number
  items: Array<{
    employeeId: string
    code: string
    name: string
    payableDays: number
    perDayPaise: number
    earnedPaise: number
    otMinutes: number
    otPaise: number
    grossPaise: number
  }>
}

export interface MonthLockView {
  id: string
  month: string
  lockedBy: string
  lockedAt: string
}

/** §6: locks and released runs, straight from the API. */
export function usePayroll() {
  const { user } = useSession()
  const enabled = user?.source === "api"

  const query = useQuery({
    queryKey: ["payroll"],
    enabled,
    retry: false,
    queryFn: () => apiFetch<{ locks: MonthLockView[]; runs: PayrollRunView[] }>("/payroll"),
  })

  return {
    data: enabled && !query.isError ? query.data : null,
    source: (enabled ? "api" : "demo") as DataSource,
    isLoading: enabled && query.isLoading,
  }
}

export interface SalaryRow {
  employeeId: string
  grossMonthlyPaise: number
  basis: string
  bank: {
    accountName: string
    accountNumber: string
    ifsc: string
    bankName: string
    pan: string
    uan: string
  } | null
}

/** Account numbers arrive masked from the server; nothing here unmasks them. */
export function useSalaries() {
  const { user } = useSession()
  const enabled = user?.source === "api"
  const query = useQuery({
    queryKey: ["salaries"],
    enabled,
    retry: false,
    queryFn: () => apiFetch<{ salaries: SalaryRow[] }>("/salaries"),
    select: (payload) => payload.salaries,
  })
  return {
    salaries: enabled && !query.isError ? (query.data ?? []) : [],
    source: (enabled ? "api" : "demo") as DataSource,
  }
}

export function useSaveBankDetails() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ employeeId, ...bank }: { employeeId: string } & Record<string, string>) =>
      apiFetch(`/salaries/${employeeId}/bank`, { method: "PUT", body: JSON.stringify(bank) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["salaries"] }),
  })
}

export function usePayrollActions() {
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["payroll"] })
  return {
    lockMonth: useMutation({
      mutationFn: (month: string) =>
        apiFetch<{ lock: MonthLockView }>("/payroll/locks", {
          method: "POST",
          body: JSON.stringify({ month }),
        }),
      onSuccess: invalidate,
    }),
    runPayroll: useMutation({
      mutationFn: (month: string) =>
        apiFetch<{ run: PayrollRunView }>("/payroll/runs", {
          method: "POST",
          body: JSON.stringify({ month }),
        }),
      onSuccess: invalidate,
    }),
  }
}

// ------------------------------------------------------------ tally connector

export interface TallyStatus {
  agent: {
    state: "never" | "live" | "stale"
    staleForMs: number
    lastSeenAt: string | null
    agentVersion: string
    company: string
    lastPulled: number
    lastPushed: number
    tallyReachable: boolean | null
    queuedRecords: number
  }
  records: { total: number; byEntity: Record<string, number> }
  conflicts: { total: number; unreviewed: number }
}

export interface TallyConflictRow {
  id: string
  entity: string
  tallyGuid: string
  name: string
  winner: "app" | "tally"
  reason: string
  discarded: Record<string, unknown>
  at: string
  reviewedAt: string | null
}

/**
 * Connector liveness. Polled rather than fetched once: the whole value of this
 * screen is telling somebody *now* that the sync stopped, and a figure that
 * only updates on a page reload is how a stale sync goes unnoticed for a day.
 */
export function useTallyStatus() {
  const { user } = useSession()
  const enabled = user?.source === "api"

  const query = useQuery({
    queryKey: ["tally", "status"],
    enabled,
    retry: false,
    refetchInterval: 30_000,
    queryFn: () => apiFetch<TallyStatus>("/tally/status"),
  })

  return { status: query.data ?? null, isLoading: enabled && query.isLoading, enabled }
}

export function useTallyConflicts() {
  const { user } = useSession()
  const enabled = user?.source === "api"

  const query = useQuery({
    queryKey: ["tally", "conflicts"],
    enabled,
    retry: false,
    queryFn: () => apiFetch<{ conflicts: TallyConflictRow[] }>("/tally/conflicts"),
    select: (payload) => payload.conflicts,
  })

  return { conflicts: query.data ?? [], isLoading: enabled && query.isLoading }
}

export function useReviewTallyConflict() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ conflict: TallyConflictRow }>(`/tally/conflicts/${id}/reviewed`, {
        method: "POST",
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["tally"] }),
  })
}

// ------------------------------------------------------- operations settings

interface OperationsPayload {
  operations: OperationsSettings
  /** Rules that contradict each other. Reported, never silently corrected. */
  warnings: string[]
}

/**
 * The commercial modules' rules. Separate from the attendance settings because
 * they govern different work and are edited by different people.
 */
export function useOperationsSettings() {
  const { user } = useSession()
  const enabled = user?.source === "api"

  const query = useQuery({
    queryKey: ["settings", "operations"],
    enabled,
    retry: false,
    queryFn: () => apiFetch<OperationsPayload>("/settings/operations"),
  })

  return {
    operations: query.data?.operations ?? DEFAULT_OPERATIONS_SETTINGS,
    warnings: query.data?.warnings ?? [],
    isLoading: enabled && query.isLoading,
    enabled,
  }
}

export function useSaveOperationsSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<OperationsSettings>) =>
      apiFetch<OperationsPayload>("/settings/operations", {
        method: "PUT",
        body: JSON.stringify(patch),
      }),
    onSuccess: (payload) => {
      // Seed the cache from the response so the screen reflects what the server
      // stored, not what the form hoped it would store.
      queryClient.setQueryData(["settings", "operations"], payload)
    },
  })
}
