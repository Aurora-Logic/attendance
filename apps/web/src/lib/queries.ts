import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { AttendanceDay } from "@attendance/shared"

import { apiFetch } from "@/lib/api"
import { useSession } from "@/lib/session"
import {
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
      const failed = results.filter((result) => result.status === "rejected").length
      return { done: input.ids.length - failed, failed }
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

export function useMyLeaveRequests(): MyLeaveRequestView[] | null {
  const { user } = useSession()
  const enabled = user?.source === "api"

  const query = useQuery({
    queryKey: ["my-leave", user?.employeeId],
    enabled,
    queryFn: () => apiFetch<{ approvals: ApiApproval[] }>("/approvals"),
    select: (payload) =>
      payload.approvals
        .filter(
          (approval) => approval.kind === "LEAVE" && approval.employeeId === user!.employeeId
        )
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
