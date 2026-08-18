import {
  AddressBookIcon,
  BooksIcon,
  CalendarBlankIcon,
  CalendarDotsIcon,
  ChartBarIcon,
  ClipboardTextIcon,
  ClockCounterClockwiseIcon,
  ClockIcon,
  DownloadSimpleIcon,
  FingerprintIcon,
  GearIcon,
  HandshakeIcon,
  type Icon,
  LockIcon,
  PackageIcon,
  PlugIcon,
  ReceiptIcon,
  TagIcon,
  BuildingsIcon,
  ChartLineUpIcon,
  ScrollIcon,
  TrashIcon,
  ShieldCheckIcon,
  SquaresFourIcon,
  TreePalmIcon,
  UmbrellaIcon,
  UsersIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react';

import { PERMISSIONS, type PermissionKey } from '@vyuha/shared';

export interface NavItem {
  to: string;
  label: string;
  /**
   * Shorter name for the phone's bottom bar, where a tab gets a fifth of
   * 360px. Falls back to `label`. "My attend..." tells the reader nothing the
   * icon had not already said, so the tab gets a word that fits instead.
   */
  shortLabel?: string;
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
 * A module owns a sidebar; the workspace owns everything else (REQ-O-01).
 *
 * Adding CRM is an entry in `MODULES` rather than an edit to the sidebar
 * component, which is the point: `09` §6 says a module registers itself, and a
 * component that grew a branch per module is how the nineteen-item sidebar
 * happened in the first place.
 */
export interface ModuleDef {
  id: string;
  label: string;
  icon: Icon;
  /** Where `Ctrl+G` lands when this module is chosen. */
  home: string;
  /** Undefined means every signed-in account sees it. */
  permission?: PermissionKey;
  groups: NavGroup[];
}

/**
 * PRD §6.1 navigation model. Alt+G is the faster path and is advertised in the
 * UI, but the sidebar remains the discoverable one.
 *
 * This is the Attendance module's sidebar. It is no longer the whole
 * navigation: REQ-O-02 pulled the workspace destinations into `ADMIN_GROUPS`
 * and REQ-O-03 moved Approvals to the top bar, because one audit log and one
 * approvals inbox serve every module and neither belongs inside one of them.
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
        shortLabel: 'Attendance',
        icon: CalendarDotsIcon,
        permission: PERMISSIONS.ATTENDANCE_VIEW_SELF,
        phase: 1,
        reqs: 'REQ-E-01, E-02',
      },
      {
        to: '/my-leave',
        label: 'My leave',
        shortLabel: 'Leave',
        icon: TreePalmIcon,
        permission: PERMISSIONS.LEAVE_APPLY_SELF,
        phase: 2,
        reqs: 'REQ-G-03, G-06',
      },
      {
        to: '/approvals',
        label: 'Approvals',
        shortLabel: 'Approvals',
        icon: ClipboardTextIcon,
        permission: PERMISSIONS.LEAVE_APPROVE_TEAM,
        phase: 2,
        reqs: 'REQ-I-03',
      },
      {
        to: '/team-attendance',
        label: 'Team attendance',
        shortLabel: 'Team',
        icon: UsersThreeIcon,
        permission: PERMISSIONS.ATTENDANCE_VIEW_TEAM,
        phase: 1,
        reqs: 'REQ-E-02, J-01',
      },
      {
        to: '/regularizations',
        label: 'Corrections',
        shortLabel: 'Fix',
        icon: ClockCounterClockwiseIcon,
        // The raise key, not the approve key: this screen is what a person
        // opens about their own days, and every Employee holds it. The
        // approver's surface is a band on /approvals.
        permission: PERMISSIONS.REGULARIZATION_RAISE,
        phase: 2,
        reqs: 'REQ-F-01…F-05',
      },
      {
        to: '/team-leave',
        label: 'Team leave',
        shortLabel: 'Away',
        icon: UmbrellaIcon,
        // The same key Approvals takes: the screen exists to be read *before*
        // a decision, so whoever can decide must be able to reach it. The
        // server scopes what is in it (OPEN-QUESTIONS records that PRD §6.1's
        // Work group now lists six items rather than five).
        permission: PERMISSIONS.LEAVE_APPROVE_TEAM,
        phase: 2,
        reqs: 'REQ-G-12',
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
    ],
  },
  {
    label: 'Reports',
    items: [
      {
        to: '/analytics',
        label: 'Analytics',
        icon: ChartLineUpIcon,
        // The team key, not view.all: a manager should see the shape of their
        // own team. The server's scope predicate decides what the numbers are
        // built from, so the same screen answers for a team or the whole
        // organisation without knowing which it is looking at.
        permission: PERMISSIONS.ATTENDANCE_VIEW_TEAM,
        phase: 4,
        reqs: 'REQ-K-01, REQ-J-01',
      },
      {
        to: '/reports',
        label: 'Reports',
        icon: ChartBarIcon,
        permission: PERMISSIONS.REPORT_VIEW,
        phase: 3,
        reqs: 'REQ-J-01',
      },
    ],
  },
];


/**
 * The destinations REQ-O-02 pulls out of every module sidebar.
 *
 * There is one audit log for the whole system, one recycle bin and one set of
 * roles -- CRM will not get copies of them. Reached from the organisation name
 * in the header rather than from a module, because that is what they belong to.
 *
 * "Attendance setup" is the P6a-1 default recorded in `OPEN-QUESTIONS.md`:
 * REQ-O-02's own list leaves 13 destinations against REQ-O-04's cap of 11, and
 * these three are configuration somebody visits when a policy changes rather
 * than work they do during a day. Reverse it by moving them back and raising
 * the cap.
 */
export const ADMIN_GROUPS: NavGroup[] = [
  {
    label: 'Organisation',
    items: [
      {
        to: '/organisation',
        label: 'Organisation',
        shortLabel: 'Org',
        icon: BuildingsIcon,
        // employee.view, not a manage key: the three masters are what an
        // employee list filters by, so anybody who can read the register needs
        // to be able to see them. The screen splits the write keys the way the
        // server does - departments and designations on employee.manage,
        // locations on settings.manage, because a location carries the geofence
        // and the IP allowlist (OPEN-QUESTIONS P1-1).
        permission: PERMISSIONS.EMPLOYEE_VIEW,
        phase: 1,
        reqs: 'REQ-A-01, REQ-A-02',
      },
    ],
  },
  {
    label: 'Attendance setup',
    items: [
      {
        to: '/shifts',
        label: 'Shifts and rosters',
        shortLabel: 'Shifts',
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
      {
        to: '/period-lock',

        label: 'Period lock',
        shortLabel: 'Lock',
        icon: LockIcon,
        permission: PERMISSIONS.ATTENDANCE_LOCK,
        phase: 3,
        reqs: 'REQ-E-09',
      },
    ],
  },
  {
    label: 'Workspace',
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
        shortLabel: 'Roles',
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
        shortLabel: 'Audit',
        icon: ScrollIcon,
        permission: PERMISSIONS.AUDIT_VIEW,
        phase: 4,
        reqs: 'REQ-M-02',
      },
      {
        to: '/recycle-bin',
        label: 'Recycle bin',
        shortLabel: 'Recycle',
        icon: TrashIcon,
        // REQ-M-04 forbids a hard delete, so everything removed anywhere in the
        // product is recoverable from here. Gated on employee.manage because
        // that is the broadest of the master-management keys; the screen itself
        // filters to the kinds the viewer may actually restore.
        permission: PERMISSIONS.EMPLOYEE_MANAGE,
        phase: 4,
        reqs: 'REQ-M-04, REQ-B-09a',
      },
      {
        to: '/downloads',

        label: 'Downloads',
        icon: DownloadSimpleIcon,
        permission: PERMISSIONS.REPORT_EXPORT,
        phase: 3,
        reqs: 'REQ-J-03',
      },
    ],
  },
];

/**
 * REQ-O-03. One inbox across every approvable thing, so it sits above the
 * modules rather than inside one -- a CRM discount and a leave request land in
 * the same place, and `01` already promised that.
 */
export const TOP_BAR_ITEMS: NavItem[] = [
      {
        to: '/approvals',
        label: 'Approvals',
        icon: ClipboardTextIcon,
        permission: PERMISSIONS.LEAVE_APPROVE_TEAM,
        phase: 2,
        reqs: 'REQ-I-03',
      },
];

/**
 * Named rather than inlined in `MODULES` so `findModuleForPath` has a typed
 * fallback without an index into the array — a route no module owns (the
 * workspace screens, /profile, a bad URL) still needs a sidebar behind it.
 */
const ATTENDANCE_MODULE: ModuleDef = {
  id: 'attendance',
  label: 'Attendance',
  icon: CalendarDotsIcon,
  home: '/',
  groups: NAV_GROUPS,
};

/** REQ-O-01. One entry per module; the sidebar renders only the current one. */
export const MODULES: ModuleDef[] = [
  ATTENDANCE_MODULE,
  {
    id: 'masters',
    label: 'Masters',
    icon: BooksIcon,
    home: '/masters/parties',
    // 08 SS2.2's key: financial-adjacent data, not for every signed-in eye.
    permission: PERMISSIONS.MASTERS_TALLY_VIEW,
    groups: [
      {
        label: 'Masters',
        items: [
          {
            to: '/masters/parties',
            label: 'Parties',
            icon: BooksIcon,
            permission: PERMISSIONS.MASTERS_TALLY_VIEW,
            phase: 6,
            reqs: 'REQ-R-01, REQ-R-04',
          },
          {
            to: '/masters/items',
            label: 'Stock items',
            shortLabel: 'Items',
            icon: PackageIcon,
            permission: PERMISSIONS.MASTERS_TALLY_VIEW,
            phase: 6,
            reqs: 'REQ-R-02',
          },
          {
            to: '/masters/price-lists',
            label: 'Price lists',
            shortLabel: 'Prices',
            icon: TagIcon,
            permission: PERMISSIONS.MASTERS_TALLY_VIEW,
            phase: 6,
            reqs: 'REQ-R-03',
          },
        ],
      },
      {
        label: 'Books',
        items: [
          {
            to: '/masters/vouchers',
            label: 'Vouchers',
            icon: ReceiptIcon,
            // Money moving, not a master: 08 §2.2's receivables key.
            permission: PERMISSIONS.RECEIVABLES_VIEW,
            phase: 6,
            reqs: 'REQ-S-01, REQ-Y-06',
          },
        ],
      },
    ],
  },
  {
    id: 'crm',
    label: 'CRM',
    icon: HandshakeIcon,
    home: '/crm/contacts',
    // 08 §2.2 gives view.self to everyone who holds view.all, so the narrower
    // key is the module gate: whoever may see any contact may open the module.
    permission: PERMISSIONS.CRM_CONTACT_VIEW_SELF,
    groups: [
      {
        label: 'People',
        items: [
          {
            to: '/crm/contacts',
            label: 'Contacts',
            icon: AddressBookIcon,
            permission: PERMISSIONS.CRM_CONTACT_VIEW_SELF,
            phase: 7,
            reqs: 'REQ-U-01, REQ-U-08',
          },
          {
            to: '/crm/companies',
            label: 'Companies',
            icon: BuildingsIcon,
            permission: PERMISSIONS.CRM_CONTACT_VIEW_SELF,
            phase: 7,
            reqs: 'REQ-U-02, REQ-U-03',
          },
        ],
      },
    ],
  },
];

/**
 * The module that owns a route, so the sidebar can render that module's
 * groups rather than always attendance's (REQ-O-01 — without this, a second
 * module's screens exist in the palette and nowhere a mouse can find them).
 *
 * Prefix matching covers detail routes: /employees/42 belongs to whichever
 * module owns /employees. Routes no module claims — the workspace screens,
 * /profile, an unknown URL — fall back to attendance, which keeps the sidebar
 * stable instead of blanking it on every administrative page.
 */
export function findModuleForPath(pathname: string): ModuleDef {
  return (
    MODULES.find((module) =>
      module.groups.some((group) =>
        group.items.some(
          (item) => item.to === pathname || (item.to !== '/' && pathname.startsWith(`${item.to}/`)),
        ),
      ),
    ) ?? ATTENDANCE_MODULE
  );
}

/** Every destination that has a name, wherever it is reached from. */
export const ALL_NAV_ITEMS: NavItem[] = [
  // Every module's destinations, not only attendance's: the breadcrumb and
  // the palette must name a screen whichever module owns it.
  ...MODULES.flatMap((m) => m.groups.flatMap((g) => g.items)),
  ...ADMIN_GROUPS.flatMap((g) => g.items),
  ...TOP_BAR_ITEMS,
];

export function findNavItem(pathname: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((item) => item.to === pathname);
}

/**
 * The sidebar group a route sits under, so the breadcrumb has a parent to show.
 * A trail of one is not a trail — without this every page would render its own
 * name and nothing else.
 */
export function findNavGroup(pathname: string): string | undefined {
  return [...MODULES.flatMap((m) => m.groups), ...ADMIN_GROUPS].find((group) =>
    group.items.some((item) => item.to === pathname),
  )?.label;
}

export interface Crumb {
  label: string;
  to?: string;
}

/**
 * Routes that carry a name but deliberately sit outside the sidebar.
 *
 * /profile is permanent: PRD §6.1 fixes the sidebar to Work, Records, Reports
 * and Setup, and a personal account page belongs to none of them, so it is
 * reached from the user menu in the header instead. It still needs a name here
 * or the breadcrumb would announce the page as "Not found".
 *
 * /patterns is gated on DEV for the same reason the route itself is: naming it
 * unconditionally would leave a production build showing "Shell patterns" in
 * the header above a body that says there is no screen at this address. The
 * label and the route have to appear and disappear together.
 */
const OFF_NAV_LABELS: Record<string, string> = {
  '/profile': 'Profile',
  /* REQ-O-02's landing screen. Reached from the sidebar footer rather than
     being a destination inside a module, so it needs a name here for the same
     reason the three below do -- without it the header announced the page as
     "Not found" above a screen that was rendering perfectly. */
  '/administration': 'Administration',
  /* Same reasoning as /profile: PRD §6.1 fixes the sidebar to Work, Records,
     Reports and Setup, and a changelog belongs to none of them. Reached from
     the account menu; named here so the breadcrumb does not call it
     "Not found". */
  '/updates': 'Updates',
  /* REQ-K-02's list, reached from the bell rather than from the navigation.
     Named here for the same reason the two above are: the breadcrumb would
     otherwise announce the page as "Not found". */
  '/notifications': 'Notifications',
  ...(import.meta.env.DEV ? { '/patterns': 'Shell patterns' } : {}),
};

/**
 * The trail for a route, derived here rather than passed up from the screen.
 * The header renders it, so a screen cannot forget to declare who it is, and
 * two screens cannot describe the same route differently.
 */
/**
 * Routes that are reached from a nav item rather than being one.
 *
 * Kept as a table beside the nav rather than inside the breadcrumb function, so
 * adding a detail screen is one row here instead of a branch somebody has to
 * find.
 */
const DETAIL_ROUTES: readonly { pattern: RegExp; parent: string; label: string }[] = [
  { pattern: /^\/employees\/[^/]+$/u, parent: '/employees', label: 'Employee' },
  { pattern: /^\/masters\/vouchers\/[^/]+$/u, parent: '/masters/vouchers', label: 'Voucher' },
  { pattern: /^\/crm\/contacts\/[^/]+$/u, parent: '/crm/contacts', label: 'Contact' },
  { pattern: /^\/crm\/companies\/[^/]+$/u, parent: '/crm/companies', label: 'Company' },
];

export function findBreadcrumbs(pathname: string): [Crumb, ...Crumb[]] {
  const offNav = OFF_NAV_LABELS[pathname];
  if (offNav) return [{ label: offNav }];

  // A detail route hangs off a nav item without being one. Matching only exact
  // paths made every one of them render "Not found" in the header while the
  // screen below it worked perfectly.
  //
  // The last crumb cannot be the person's name: this function is pure over the
  // pathname and has never seen the record. The screen states the name itself.
  const detail = DETAIL_ROUTES.find((route) => route.pattern.test(pathname));
  if (detail) {
    const parent = findNavItem(detail.parent);
    const group = findNavGroup(detail.parent);
    const crumbs: Crumb[] = [];
    if (group && group !== parent?.label) crumbs.push({ label: group });
    if (parent) crumbs.push({ label: parent.label, to: detail.parent });
    crumbs.push({ label: detail.label });
    return crumbs as [Crumb, ...Crumb[]];
  }

  const item = findNavItem(pathname);
  if (!item) return [{ label: 'Not found' }];

  const group = findNavGroup(pathname);
  // "Reports" sits in a group also called Reports. A parent that repeats its
  // child is noise, so it is dropped rather than rendered.
  return group && group !== item.label
    ? [{ label: group }, { label: item.label }]
    : [{ label: item.label }];
}
