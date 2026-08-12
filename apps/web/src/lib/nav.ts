import {
  CalendarBlankIcon,
  CalendarDotsIcon,
  ChartBarIcon,
  ClipboardTextIcon,
  ClockIcon,
  DownloadSimpleIcon,
  FingerprintIcon,
  GearIcon,
  type Icon,
  LockIcon,
  PlugIcon,
  ScrollIcon,
  ShieldCheckIcon,
  SquaresFourIcon,
  TreePalmIcon,
  UsersIcon,
} from '@phosphor-icons/react';

import { PERMISSIONS, type PermissionKey } from '@vyuha/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: Icon;
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
      { to: '/', label: 'Dashboard', icon: SquaresFourIcon, phase: 4, reqs: 'REQ-K-01' },
      {
        to: '/punch',
        label: 'Punch',
        icon: FingerprintIcon,
        permission: PERMISSIONS.PUNCH_SELF,
        phase: 1,
        reqs: 'REQ-D-01…D-13',
      },
      {
        to: '/my-attendance',
        label: 'My attendance',
        icon: CalendarDotsIcon,
        permission: PERMISSIONS.ATTENDANCE_VIEW_SELF,
        phase: 1,
        reqs: 'REQ-E-01, E-02',
      },
      {
        to: '/my-leave',
        label: 'My leave',
        icon: TreePalmIcon,
        permission: PERMISSIONS.LEAVE_APPLY_SELF,
        phase: 2,
        reqs: 'REQ-G-03, G-06',
      },
      {
        to: '/approvals',
        label: 'Approvals',
        icon: ClipboardTextIcon,
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
        icon: UsersIcon,
        permission: PERMISSIONS.EMPLOYEE_VIEW,
        phase: 1,
        reqs: 'REQ-A-03, A-06',
      },
      {
        to: '/shifts',
        label: 'Shifts and rosters',
        icon: ClockIcon,
        permission: PERMISSIONS.SHIFT_MANAGE,
        phase: 1,
        reqs: 'REQ-C-01…C-05',
      },
      {
        to: '/leave-types',
        label: 'Leave types',
        icon: CalendarBlankIcon,
        permission: PERMISSIONS.LEAVE_POLICY_MANAGE,
        phase: 2,
        reqs: 'REQ-G-01, G-03',
      },
      {
        to: '/holidays',
        label: 'Holidays',
        icon: CalendarDotsIcon,
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
        icon: ChartBarIcon,
        permission: PERMISSIONS.REPORT_VIEW,
        phase: 3,
        reqs: 'REQ-J-01',
      },
      {
        to: '/downloads',
        label: 'Downloads',
        icon: DownloadSimpleIcon,
        permission: PERMISSIONS.REPORT_EXPORT,
        phase: 3,
        reqs: 'REQ-J-03',
      },
      {
        to: '/period-lock',
        label: 'Period lock',
        icon: LockIcon,
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
        icon: GearIcon,
        permission: PERMISSIONS.SETTINGS_MANAGE,
        phase: 4,
        reqs: 'REQ-L-01…L-05',
      },
      {
        to: '/roles',
        label: 'Roles and permissions',
        icon: ShieldCheckIcon,
        permission: PERMISSIONS.ROLES_MANAGE,
        phase: 4,
        reqs: 'REQ-B-07',
      },
      {
        to: '/integrations',
        label: 'Integrations',
        icon: PlugIcon,
        permission: PERMISSIONS.INTEGRATION_MANAGE,
        phase: 6,
        reqs: 'Technical design §14',
      },
      {
        to: '/audit',
        label: 'Audit log',
        icon: ScrollIcon,
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

/**
 * The sidebar group a route sits under, so the breadcrumb has a parent to show.
 * A trail of one is not a trail — without this every page would render its own
 * name and nothing else.
 */
export function findNavGroup(pathname: string): string | undefined {
  return NAV_GROUPS.find((group) => group.items.some((item) => item.to === pathname))?.label;
}

export interface Crumb {
  label: string;
  to?: string;
}

/**
 * Routes that carry a name but deliberately sit outside the sidebar.
 *
 * Gated on DEV for the same reason the route itself is: /patterns is mounted
 * only in development, so naming it unconditionally would leave a production
 * build showing "Shell patterns" in the header above a body that says there is
 * no screen at this address. The label and the route have to appear and
 * disappear together.
 */
const OFF_NAV_LABELS: Record<string, string> = import.meta.env.DEV
  ? { '/patterns': 'Shell patterns' }
  : {};

/**
 * The trail for a route, derived here rather than passed up from the screen.
 * The header renders it, so a screen cannot forget to declare who it is, and
 * two screens cannot describe the same route differently.
 */
export function findBreadcrumbs(pathname: string): [Crumb, ...Crumb[]] {
  const offNav = OFF_NAV_LABELS[pathname];
  if (offNav) return [{ label: offNav }];

  const item = findNavItem(pathname);
  if (!item) return [{ label: 'Not found' }];

  const group = findNavGroup(pathname);
  // "Reports" sits in a group also called Reports. A parent that repeats its
  // child is noise, so it is dropped rather than rendered.
  return group && group !== item.label
    ? [{ label: group }, { label: item.label }]
    : [{ label: item.label }];
}
