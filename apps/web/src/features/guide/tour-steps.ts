import { PERMISSIONS, type PermissionKey } from '@vyuha/shared';

/**
 * The guided tour, as data.
 *
 * One list rather than steps declared inside each screen. A step declared in
 * `punch-page.tsx` would only exist once that route had mounted, so the run
 * could not know its own length, could not honestly say "step 4 of 13", and
 * could not skip a screen before navigating into it. One list also means the
 * whole tour is reviewable in one file.
 *
 * Every `permission` is a real key from `ROLE_PERMISSION_MATRIX`, and it is the
 * same set the sidebar and the Go To palette filter on, so the tour cannot
 * point at a screen the person would be refused. That also makes the tour's
 * length a property of the session rather than a number written down here:
 * 8 steps for Employee, 13 for Operations, 17 for HR, 21 for Admin.
 */
export interface GuideStep {
  id: string;
  /** Navigated to before the step draws. Omitted means "stay where you are". */
  route?: string;
  /** Matched as `[data-guide="…"]`. See ANCHORS below. */
  anchor: string;
  /** Used instead of `anchor` below the 768px breakpoint. */
  mobileAnchor?: string;
  title: string;
  body: string;
  /** Preferred side. The positioner may flip it to avoid a collision. */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Skipped entirely when the session does not hold it. */
  permission?: PermissionKey;
  /** Rendered as a hint chip inside the bubble. */
  shortcut?: string;
  /** Documented alias for a browser-reserved key (PRD §6.4). */
  shortcutAlias?: string;
  /** Skipped on a phone when there is no `mobileAnchor` to fall back to. */
  mobileBehaviour?: 'skip';
}

/**
 * Every anchor the registry can name.
 *
 * Deliberately small. Screen steps all point at `screen.header`, which lives on
 * the one shared `PageHeader` component every screen renders — so eighteen
 * screens cost one attribute rather than eighteen, and no screen can quietly
 * lose its anchor in a refactor without every screen losing it at once, which
 * is the kind of failure that gets noticed.
 */
export const ANCHORS = {
  navGroups: 'nav.groups',
  navBottomBar: 'nav.bottom-bar',
  headerGoto: 'header.goto',
  headerShortcuts: 'header.shortcuts',
  headerBreadcrumb: 'header.breadcrumb',
  headerAccount: 'header.account',
  screenHeader: 'screen.header',
} as const;

/**
 * Bumped when the shape of the tour changes enough that a stored resume point
 * is no longer meaningful. Adding copy does not count; removing or reordering
 * steps does.
 */
export const REGISTRY_VERSION = 1;

/** Where everything is, and how to move around. Shown to everyone. */
const SHELL_STEPS: GuideStep[] = [
  {
    id: 'shell.nav',
    anchor: ANCHORS.navGroups,
    mobileAnchor: ANCHORS.navBottomBar,
    side: 'right',
    title: 'Everything lives here',
    body: 'Grouped by what you are doing. You only see what your role allows, so this list is shorter for some people than others.',
  },
  {
    id: 'shell.goto',
    anchor: ANCHORS.headerGoto,
    side: 'bottom',
    shortcut: 'alt+g',
    title: 'Go to',
    body: 'The fast path. Press Alt+G anywhere and type the first few letters of a screen.',
  },
  {
    id: 'shell.shortcuts',
    anchor: ANCHORS.headerShortcuts,
    side: 'bottom',
    shortcut: 'ctrl+f1',
    shortcutAlias: 'f1',
    // The control is desktop-only and there is no keyboard on a phone to hint
    // at, so this is skipped rather than re-anchored to something unrelated.
    mobileBehaviour: 'skip',
    title: 'Every key, listed',
    body: 'Keys match TallyPrime wherever the browser allows it. The sheet always shows what is active on the screen you are on.',
  },
  {
    id: 'shell.breadcrumb',
    anchor: ANCHORS.headerBreadcrumb,
    side: 'bottom',
    title: 'Where you are',
    body: 'The page always names itself here, so you never have to guess which screen you landed on.',
  },
  {
    id: 'shell.account',
    anchor: ANCHORS.headerAccount,
    side: 'bottom',
    title: 'Your account',
    body: 'Theme, your profile, and the way out. This tour lives here too if you want it again.',
  },
];

/**
 * One step per screen, in sidebar order so the tour and the navigation tell
 * the same story. Each navigates first, then points at the page header — the
 * screen itself is visible behind the scrim, which is what actually teaches.
 */
const SCREEN_STEPS: GuideStep[] = [
  {
    id: 'screen.punch',
    route: '/punch',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.PUNCH_SELF,
    title: 'Punch',
    body: 'In and out, with a live photo every time. The half-day choice is offered on the way in, not afterwards.',
  },
  {
    id: 'screen.my-attendance',
    route: '/my-attendance',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.ATTENDANCE_VIEW_SELF,
    title: 'My attendance',
    body: 'Your month, day by day. Open a day to see the punches behind it and raise a correction if something looks wrong.',
  },
  {
    id: 'screen.my-leave',
    route: '/my-leave',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.LEAVE_APPLY_SELF,
    title: 'My leave',
    body: 'Apply, and track where an application has reached. Balances are shown against each type before you commit to a date.',
  },
  {
    id: 'screen.team-attendance',
    route: '/team-attendance',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.ATTENDANCE_VIEW_TEAM,
    title: 'Team attendance',
    body: 'One row per person for the day, with the exceptions surfaced rather than buried.',
  },
  {
    id: 'screen.approvals',
    route: '/approvals',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.LEAVE_APPROVE_TEAM,
    title: 'Approvals',
    body: 'Everything waiting on you, in one queue. A decision always asks for a reason and always writes to the audit log.',
  },
  {
    id: 'screen.employees',
    route: '/employees',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.EMPLOYEE_VIEW,
    title: 'Employees',
    body: 'The people register. Nobody is ever deleted — a leaver is retired with a last working day, so past reports still add up.',
  },
  {
    id: 'screen.shifts',
    route: '/shifts',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.SHIFT_MANAGE,
    title: 'Shifts and rosters',
    body: 'Timings, grace, and weekly-off patterns. What you set here is what the day engine measures a punch against.',
  },
  {
    id: 'screen.leave-types',
    route: '/leave-types',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.LEAVE_POLICY_MANAGE,
    title: 'Leave types',
    body: 'Entitlement, carry-forward and notice rules per type. Changing a rule here does not rewrite leave already taken.',
  },
  {
    id: 'screen.holidays',
    route: '/holidays',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.HOLIDAY_MANAGE,
    title: 'Holidays',
    body: 'The calendar the day engine treats as non-working. No dates ship assumed, so this starts empty on purpose.',
  },
  {
    id: 'screen.reports',
    route: '/reports',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.REPORT_VIEW,
    title: 'Reports',
    body: 'The monthly muster and the summaries payroll needs. This is the hand-off point — no money is calculated here.',
  },
  {
    id: 'screen.downloads',
    route: '/downloads',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.REPORT_EXPORT,
    title: 'Downloads',
    body: 'An export runs as a job rather than holding the screen. Start it, carry on working, and collect the file here.',
  },
  {
    id: 'screen.period-lock',
    route: '/period-lock',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.ATTENDANCE_LOCK,
    title: 'Period lock',
    body: 'Close a month once its numbers have gone to payroll. After that no punch or edit can change it.',
  },
  {
    id: 'screen.settings',
    route: '/settings',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.SETTINGS_MANAGE,
    title: 'Settings',
    body: 'Organisation, attendance policy and photo rules, in four tabs behind one Save. Each field says whether anything reads it yet.',
  },
  {
    id: 'screen.roles',
    route: '/roles',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.ROLES_MANAGE,
    title: 'Roles and permissions',
    body: 'Roles are named bundles of permissions, not fixed job titles. Nothing in the product branches on a role name.',
  },
  {
    id: 'screen.integrations',
    route: '/integrations',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.INTEGRATION_MANAGE,
    title: 'Integrations',
    body: 'Where outbound connections are configured, including the TallyPrime link when it arrives.',
  },
  {
    id: 'screen.audit',
    route: '/audit',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.AUDIT_VIEW,
    title: 'Audit log',
    body: 'Every state-changing action, who did it and why. Append-only — nothing in the product can edit a row here.',
  },
];

export const MAIN_TOUR: GuideStep[] = [...SHELL_STEPS, ...SCREEN_STEPS];

/**
 * The steps this session will actually walk.
 *
 * Filtered rather than disabled: a step pointing at a screen the person cannot
 * open has nothing to say to them, and counting it would make the tour promise
 * a step that never arrives.
 */
export function resolveSteps(
  granted: ReadonlySet<PermissionKey>,
  isMobile: boolean,
): GuideStep[] {
  return MAIN_TOUR.filter((step) => {
    if (step.permission && !granted.has(step.permission)) return false;
    if (isMobile && step.mobileBehaviour === 'skip' && !step.mobileAnchor) return false;
    return true;
  });
}

/** The anchor a step wants at this width. */
export function anchorFor(step: GuideStep, isMobile: boolean): string {
  return isMobile && step.mobileAnchor ? step.mobileAnchor : step.anchor;
}
