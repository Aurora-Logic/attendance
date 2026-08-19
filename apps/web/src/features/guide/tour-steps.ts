import { PERMISSIONS, type PermissionKey } from '@vyuha/shared';

/**
 * The guided tour, as data.
 *
 * Organised **per screen**, and the whole-product tour is derived from that
 * rather than the other way round. The first version was one flat list, which
 * made the common question — "what is this screen for?" — cost sixteen steps
 * to reach Approvals. A person asks that on the screen they are already
 * looking at, so the screen is the unit and the full tour is the concatenation.
 *
 * Two scopes come out of one registry:
 *
 *   Page  — the intro for this route, plus whatever furniture the route
 *           actually renders. Two to four steps. Reached from Ctrl+F1.
 *   All   — the shell, then one intro per screen the session may open.
 *           Twenty-one steps for an administrator. Reached from the account
 *           menu and from the sign-in offer.
 *
 * Every `permission` is a real key from `ROLE_PERMISSION_MATRIX`, and it is the
 * same set the sidebar and the Go To palette filter on, so the tour cannot
 * point at a screen the person would be refused.
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
  /**
   * True for a step describing a piece of the shared kit rather than a screen.
   * These appear only in the page scope: repeating "this is the table" on
   * sixteen screens is what would make the full tour unbearable.
   */
  furniture?: boolean;
}

/**
 * Every anchor the registry can name.
 *
 * Deliberately small, and deliberately on shared components rather than on
 * individual screens. `screen.header` sits on the one `PageHeader` all
 * twenty-nine screens render; `screen.table`, `screen.search` and
 * `screen.pagination` sit on the shared kit those screens are built from. So a
 * page guide gets real depth without eighteen screens each carrying their own
 * attributes to lose in a refactor.
 */
export const ANCHORS = {
  navGroups: 'nav.groups',
  navBottomBar: 'nav.bottom-bar',
  headerGoto: 'header.goto',
  headerPageGuide: 'header.page-guide',
  headerShortcuts: 'header.shortcuts',
  headerBreadcrumb: 'header.breadcrumb',
  headerAccount: 'header.account',
  screenHeader: 'screen.header',
  screenSearch: 'screen.search',
  screenTable: 'screen.table',
  screenTableCards: 'screen.table-cards',
  screenPagination: 'screen.pagination',
} as const;

/**
 * The anchors that must resolve to exactly one element wherever the shell is
 * rendered. The rest belong to screen furniture, which is legitimately absent
 * on some routes and may legitimately appear more than once on others — a
 * screen with two tables highlights the first, which is honest rather than
 * wrong.
 */
export const SHELL_ANCHORS: readonly string[] = [
  ANCHORS.navGroups,
  ANCHORS.navBottomBar,
  ANCHORS.headerGoto,
  ANCHORS.headerPageGuide,
  ANCHORS.headerShortcuts,
  ANCHORS.headerBreadcrumb,
  ANCHORS.headerAccount,
  ANCHORS.screenHeader,
];

/**
 * Bumped when the shape of the tour changes enough that a stored resume point
 * is no longer meaningful. Adding copy does not count; removing or reordering
 * steps does.
 */
export const REGISTRY_VERSION = 3;

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
    id: 'shell.page-guide',
    anchor: ANCHORS.headerPageGuide,
    side: 'bottom',
    title: 'What is this screen?',
    body: 'Walks you through whichever screen you are on — two or three steps, not the whole product. It is here on every screen, including on a phone.',
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
    title: 'Every key, and this screen explained',
    body: 'The shortcut sheet lists what is active here, and offers a walk through the screen you are on rather than the whole product.',
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
    body: 'Theme, your profile, updates, and the way out. The full tour lives here too if you want it again.',
  },
];

/**
 * One intro per screen: what it is for, in a sentence or two.
 *
 * This is the step that appears in both scopes — first in a page guide, and as
 * the screen's single entry in the whole-product tour.
 */
const SCREEN_INTROS: GuideStep[] = [
  {
    id: 'screen.dashboard',
    route: '/',
    anchor: ANCHORS.screenHeader,
    // No permission: everyone lands here, and a landing screen nobody can be
    // guided through is the one gap people notice first.
    title: 'Dashboard',
    body: 'Where your day starts: what is outstanding, what needs a decision, and how the month is tracking so far.',
  },
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
    id: 'screen.regularizations',
    route: '/regularizations',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.REGULARIZATION_RAISE,
    title: 'Corrections',
    body: 'Ask for a day to be put right when the punch does not match what happened. Every correction carries a reason and goes to an approver.',
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
    id: 'screen.team-leave',
    route: '/team-leave',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.LEAVE_APPROVE_TEAM,
    title: 'Team leave',
    body: 'Who is away and when, across the people reporting to you, so a decision on one application is made knowing about the others.',
  },
  {
    id: 'screen.tasks',
    route: '/tasks',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.CRM_TASK_VIEW_SELF,
    title: 'My tasks',
    body: 'What has been assigned to you and what falls due next.',
  },
  {
    id: 'screen.organisation',
    route: '/organisation',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.EMPLOYEE_VIEW,
    title: 'Organisation',
    body: 'Departments, designations and locations — the master data every employee record points at. A location also decides where a punch may be made from.',
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
    id: 'screen.recycle-bin',
    route: '/recycle-bin',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.EMPLOYEE_MANAGE,
    title: 'Recycle bin',
    body: 'Nothing in this product is hard deleted, so what was removed is recoverable from here rather than gone.',
  },
  {
    id: 'screen.analytics',
    route: '/analytics',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.ATTENDANCE_VIEW_TEAM,
    title: 'Analytics',
    body: 'Trends across the team rather than a single month: attendance, lateness and leave, read as shapes instead of rows.',
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

/**
 * The shared kit, described once and shown wherever it appears.
 *
 * Every screen in this product is built from the same handful of components,
 * so these steps do not need writing per screen — they need including only
 * when the screen in front of you actually renders them. Which is decided at
 * run time by looking, not by a list somebody has to keep in step.
 */
const FURNITURE_STEPS: GuideStep[] = [
  {
    id: 'furniture.search',
    anchor: ANCHORS.screenSearch,
    furniture: true,
    title: 'Search this screen',
    body: 'Filters the list as you type. It searches the records behind the screen, not just the rows currently shown.',
  },
  {
    id: 'furniture.table',
    anchor: ANCHORS.screenTable,
    // The desktop table and the phone's card list are both always in the DOM,
    // with CSS deciding which is visible — so the guide has to choose by width
    // rather than by presence, exactly as it does for the two navigations.
    mobileAnchor: ANCHORS.screenTableCards,
    furniture: true,
    title: 'The records',
    body: 'Sortable by column, and every row opens a detail panel. On a phone each row collapses to a card rather than scrolling sideways.',
  },
  {
    id: 'furniture.pagination',
    anchor: ANCHORS.screenPagination,
    furniture: true,
    title: 'Moving through the list',
    body: 'Page Up and Page Down work here too, so a long register can be read without reaching for the mouse.',
  },
];

/**
 * Phase 6–8: the Tally masters, CRM and the sales / purchase flow.
 *
 * Kept as its own list rather than mixed into the attendance screens above,
 * because the module boundary is real (CLAUDE.md §2) and a CRM tour should be
 * liftable without picking attendance steps out of it. The copy is drawn from
 * the REQ IDs each screen carries in `lib/nav.ts`, not invented: masters are
 * read-only because REQ-R-04 says so, a deal never reaches Tally because
 * REQ-U-05 says so, and sync state is reported rather than inferred because
 * REQ-W-06 says so.
 */
const TRADING_INTROS: GuideStep[] = [
  {
    id: 'screen.masters-parties',
    route: '/masters/parties',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.MASTERS_TALLY_VIEW,
    title: 'Parties',
    body: 'Customers and suppliers as Tally holds them, with credit limit and credit days. Read-only here — a new party is created in Tally and appears on the next pull (REQ-R-04).',
  },
  {
    id: 'screen.masters-items',
    route: '/masters/items',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.MASTERS_TALLY_VIEW,
    title: 'Stock items',
    body: 'Items pulled from Tally with their unit, group and GST rate. Also read-only, and for the same reason.',
  },
  {
    id: 'screen.masters-price-lists',
    route: '/masters/price-lists',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.MASTERS_TALLY_VIEW,
    title: 'Price lists',
    body: 'Where the company maintains them in Tally, they pull per party group and are what a document prices against.',
  },
  {
    id: 'screen.masters-vouchers',
    route: '/masters/vouchers',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.RECEIVABLES_VIEW,
    title: 'Vouchers',
    body: 'Everything backfilled from Tally, across every financial year in scope. This is the history the rest of the module reads from.',
  },
  {
    id: 'screen.crm-contacts',
    route: '/crm/contacts',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.CRM_CONTACT_VIEW_SELF,
    title: 'Contacts',
    body: 'People, with their company and owner. Creating one warns about a duplicate phone or email rather than blocking you (REQ-U-08).',
  },
  {
    id: 'screen.crm-companies',
    route: '/crm/companies',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.CRM_CONTACT_VIEW_SELF,
    title: 'Companies',
    body: 'Prospect organisations. A company becomes a Tally party only on conversion — a prospect who never buys must not become a ledger.',
  },
  {
    id: 'screen.crm-deals',
    route: '/crm/deals',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.CRM_DEAL_VIEW_SELF,
    title: 'Deals',
    body: 'The pipeline, whose stages are configurable rather than fixed. A deal has no accounting existence and is never pushed to Tally; opening a won one shows the documents raised against it.',
  },
  {
    id: 'screen.sales-estimates',
    route: '/sales/estimates',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.SALES_DOCUMENT_VIEW_SELF,
    title: 'Estimates',
    body: 'A quote, owned here and never pushed to Tally. Picking an item shows what that party was quoted and invoiced before — the reason the backfill is worth its cost (REQ-W-02).',
  },
  {
    id: 'screen.sales-orders',
    route: '/sales/orders',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.SALES_DOCUMENT_VIEW_SELF,
    title: 'Sales orders',
    body: 'Raised fresh or converted from an estimate. Every pushed document shows a sync state that is reported by the agent, never inferred — a document claiming "In Tally" that is not there is the failure that ends trust.',
  },
  {
    id: 'screen.sales-pick-queue',
    route: '/sales/pick-queue',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.SALES_DOCUMENT_VIEW_SELF,
    title: 'Pick queue',
    body: 'What is waiting to be picked. Built to work one-handed at 360px, because a picker is holding a box (REQ-AA-10).',
  },
  {
    id: 'screen.sales-awaiting-invoice',
    route: '/sales/awaiting-invoice',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.SALES_DOCUMENT_VIEW_SELF,
    title: 'Awaiting invoice',
    body: 'Picked and ready to bill. The gap between the warehouse finishing and accounts raising the invoice, made visible instead of assumed.',
  },
  {
    id: 'screen.sales-invoices',
    route: '/sales/invoices',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.SALES_DOCUMENT_VIEW_SELF,
    title: 'Invoices',
    body: 'Where invoices are raised here they push as a Sales voucher; where Tally owns them they are pull-only.',
  },
  {
    id: 'screen.sales-dispatches',
    route: '/sales/dispatches',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.SALES_DOCUMENT_VIEW_SELF,
    title: 'Dispatches',
    body: 'How each consignment leaves: local by carrier, on your own vehicle, or outstation. The flow ends at dispatch.',
  },
  {
    id: 'screen.purchase-requirements',
    route: '/purchase/requirements',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.PURCHASE_DOCUMENT_VIEW,
    title: 'Requirements',
    body: 'What is short and needs buying. Requirements are records rather than a flag on an order, because one purchase order may satisfy several and one requirement may be split across several orders.',
  },
  {
    id: 'screen.purchase-orders',
    route: '/purchase/orders',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.PURCHASE_DOCUMENT_VIEW,
    title: 'Purchase orders',
    body: 'Raised on a vendor, standalone for stock or against a sales order so the requirement carries through. Open orders are visible per vendor and per sales order.',
  },
  {
    id: 'screen.purchase-grns',
    route: '/purchase/grns',
    anchor: ANCHORS.screenHeader,
    permission: PERMISSIONS.PURCHASE_DOCUMENT_VIEW,
    title: 'Goods receipts',
    body: 'What actually arrived against what was ordered, which is where a short or excess delivery is caught.',
  },
];

/** Everything, in sidebar order. The whole-product tour. */
export const MAIN_TOUR: GuideStep[] = [...SHELL_STEPS, ...SCREEN_INTROS, ...TRADING_INTROS];

/** Every step the registry can produce, in either scope. */
export const ALL_STEPS: GuideStep[] = [
  ...SHELL_STEPS,
  ...SCREEN_INTROS,
  ...TRADING_INTROS,
  ...FURNITURE_STEPS,
];

/** The intro for a route, if it has one. */
export function introFor(route: string): GuideStep | undefined {
  return [...SCREEN_INTROS, ...TRADING_INTROS].find((step) => step.route === route);
}

/** Every route the tour knows how to introduce. */
export function guidedRoutes(): string[] {
  return [...SCREEN_INTROS, ...TRADING_INTROS]
    .map((step) => step.route)
    .filter((r): r is string => Boolean(r));
}

function permitted(step: GuideStep, granted: ReadonlySet<PermissionKey>): boolean {
  return !step.permission || granted.has(step.permission);
}

function usableAtWidth(step: GuideStep, isMobile: boolean): boolean {
  return !(isMobile && step.mobileBehaviour === 'skip' && !step.mobileAnchor);
}

/**
 * The whole-product tour, filtered to this session.
 *
 * Filtered rather than disabled: a step pointing at a screen the person cannot
 * open has nothing to say to them, and counting it would make the tour promise
 * a step that never arrives.
 */
export function resolveSteps(
  granted: ReadonlySet<PermissionKey>,
  isMobile: boolean,
): GuideStep[] {
  return MAIN_TOUR.filter((step) => permitted(step, granted) && usableAtWidth(step, isMobile));
}

/**
 * The guide for one screen: its intro, then whatever furniture it renders.
 *
 * `isPresent` is injected rather than assumed so this stays a pure function —
 * the caller passes a DOM probe in the app and a stub in a test. Furniture is
 * decided by looking at the page rather than by a per-route list, because a
 * list of "which screens have a table" is a second source of truth that would
 * quietly go stale the first time a screen gained one.
 *
 * Returns an empty array for a route with no intro — the caller offers the
 * whole tour instead of running a guide about nothing.
 */
export function resolvePageSteps(
  route: string,
  granted: ReadonlySet<PermissionKey>,
  isMobile: boolean,
  isPresent: (anchor: string) => boolean,
): GuideStep[] {
  const intro = introFor(route);
  if (!intro || !permitted(intro, granted)) return [];

  const furniture = FURNITURE_STEPS.filter(
    (step) => usableAtWidth(step, isMobile) && isPresent(step.anchor),
  );

  // The intro keeps its route so a page guide started from elsewhere still
  // navigates, but in the normal case the caller is already here.
  return [intro, ...furniture];
}

/** The anchor a step wants at this width. */
export function anchorFor(step: GuideStep, isMobile: boolean): string {
  return isMobile && step.mobileAnchor ? step.mobileAnchor : step.anchor;
}
