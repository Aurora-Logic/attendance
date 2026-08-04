import {
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  Fingerprint,
  LayoutDashboard,
  Plane,
  ScanFace,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

export interface NavItem {
  title: string
  url: string
  icon: LucideIcon
  /** Which build phase delivers this screen. */
  phase: number
  /**
   * Capability required to see this entry. Resolved through the permission
   * matrix, never through a role name — see lib/session.tsx.
   */
  permission?: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Attendance",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard, phase: 0 },
      { title: "Punch", url: "/punch", icon: ScanFace, phase: 3, permission: "punch.self" },
      {
        title: "Daily Register",
        url: "/attendance",
        icon: Fingerprint,
        phase: 3,
        permission: "reports.view",
      },
      {
        title: "Roster",
        url: "/roster",
        icon: CalendarDays,
        phase: 2,
        permission: "roster.manage",
      },
      {
        title: "Approvals",
        url: "/approvals",
        icon: ClipboardCheck,
        phase: 3.5,
        permission: "attendance.approve",
      },
    ],
  },
  {
    label: "People",
    items: [
      {
        title: "Employees",
        url: "/employees",
        icon: Users,
        phase: 1,
        permission: "employee.manage",
      },
      { title: "Leave", url: "/leave", icon: Plane, phase: 5 },
    ],
  },
  {
    label: "Output",
    items: [
      {
        title: "Reports",
        url: "/reports",
        icon: BarChart3,
        phase: 6,
        permission: "reports.view",
      },
      {
        title: "Payroll",
        url: "/payroll",
        icon: Wallet,
        phase: 7,
        permission: "payroll.manage",
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        title: "Roles & Permissions",
        url: "/roles",
        icon: ShieldCheck,
        phase: 1,
        // Admin is the only role granted config.manage at ALL scope, so this
        // entry disappears for everyone else without a role check anywhere.
        permission: "config.manage",
      },
      { title: "Settings", url: "/settings", icon: Settings, phase: 8, permission: "config.manage" },
      { title: "Audit Log", url: "/audit", icon: ScrollText, phase: 8, permission: "audit.view" },
    ],
  },
]
