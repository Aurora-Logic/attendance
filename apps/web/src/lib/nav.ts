import {
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  Clock,
  Download,
  Fingerprint,
  LayoutDashboard,
  Lock,
  type LucideIcon,
  Palmtree,
  Plug,
  ScrollText,
  Settings,
  ShieldCheck,
  SquareChartGantt,
  Users,
} from 'lucide-react';

import { PERMISSIONS, type PermissionKey } from '@vyuha/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Sidebar items are permission-filtered (PRD §6.1). Undefined means always. */
  permission?: PermissionKey;
  /** Phase the screen ships in, shown on the placeholder until it is built. */
  phase: number;
  /** REQ IDs the screen implements, per the PRD §5 screen inventory. */
  reqs: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * PRD §6.1 navigation model. Alt+G is the faster path and is advertised in the
 * UI, but the sidebar remains the discoverable one.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Work',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, phase: 4, reqs: 'REQ-K-01' },
      {
        to: '/punch',
        label: 'Punch',
        icon: Fingerprint,
        permission: PERMISSIONS.PUNCH_SELF,
        phase: 1,
        reqs: 'REQ-D-01…D-13',
      },
      {
        to: '/my-attendance',
        label: 'My attendance',
        icon: CalendarDays,
        permission: PERMISSIONS.ATTENDANCE_VIEW_SELF,
        phase: 1,
        reqs: 'REQ-E-01, E-02',
      },
      {
        to: '/my-leave',
        label: 'My leave',
        icon: Palmtree,
        permission: PERMISSIONS.LEAVE_APPLY_SELF,
        phase: 2,
        reqs: 'REQ-G-03, G-06',
      },
      {
        to: '/approvals',
        label: 'Approvals',
        icon: ClipboardCheck,
        permission: PERMISSIONS.LEAVE_APPROVE_TEAM,
        phase: 2,
        reqs: 'REQ-I-03',
      },
    ],
  },
  {
    label: 'Records',
    items: [
      {
        to: '/employees',
        label: 'Employees',
        icon: Users,
        permission: PERMISSIONS.EMPLOYEE_VIEW,
        phase: 1,
        reqs: 'REQ-A-03, A-06',
      },
      {
        to: '/shifts',
        label: 'Shifts and rosters',
        icon: Clock,
        permission: PERMISSIONS.SHIFT_MANAGE,
        phase: 1,
        reqs: 'REQ-C-01…C-05',
      },
      {
        to: '/leave-types',
        label: 'Leave types',
        icon: CalendarRange,
        permission: PERMISSIONS.LEAVE_POLICY_MANAGE,
        phase: 2,
        reqs: 'REQ-G-01, G-03',
      },
      {
        to: '/holidays',
        label: 'Holidays',
        icon: CalendarDays,
        permission: PERMISSIONS.HOLIDAY_MANAGE,
        phase: 2,
        reqs: 'REQ-H-01…H-04',
      },
    ],
  },
  {
    label: 'Reports',
    items: [
      {
        to: '/reports',
        label: 'Reports',
        icon: SquareChartGantt,
        permission: PERMISSIONS.REPORT_VIEW,
        phase: 3,
        reqs: 'REQ-J-01',
      },
      {
        to: '/downloads',
        label: 'Downloads',
        icon: Download,
        permission: PERMISSIONS.REPORT_EXPORT,
        phase: 3,
        reqs: 'REQ-J-03',
      },
      {
        to: '/period-lock',
        label: 'Period lock',
        icon: Lock,
        permission: PERMISSIONS.ATTENDANCE_LOCK,
        phase: 3,
        reqs: 'REQ-E-09',
      },
    ],
  },
  {
    label: 'Setup',
    items: [
      {
        to: '/settings',
        label: 'Settings',
        icon: Settings,
        permission: PERMISSIONS.SETTINGS_MANAGE,
        phase: 4,
        reqs: 'REQ-L-01…L-05',
      },
      {
        to: '/roles',
        label: 'Roles and permissions',
        icon: ShieldCheck,
        permission: PERMISSIONS.ROLES_MANAGE,
        phase: 4,
        reqs: 'REQ-B-07',
      },
      {
        to: '/integrations',
        label: 'Integrations',
        icon: Plug,
        permission: PERMISSIONS.INTEGRATION_MANAGE,
        phase: 6,
        reqs: 'Technical design §14',
      },
      {
        to: '/audit',
        label: 'Audit log',
        icon: ScrollText,
        permission: PERMISSIONS.AUDIT_VIEW,
        phase: 4,
        reqs: 'REQ-M-02',
      },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export function findNavItem(pathname: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((item) => item.to === pathname);
}
