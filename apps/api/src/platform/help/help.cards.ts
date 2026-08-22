import { PERMISSIONS, type HelpCard } from '@vyuha/shared';

/**
 * REQ-AJ-02 (proposed; `OPEN-QUESTIONS.md` P-HELP-1): every answer the help
 * panel can give.
 *
 * **Why the corpus lives in the API and not in `@vyuha/shared`.**
 * `docker/Caddyfile` serves the built SPA from `handle { root * /srv }` with
 * no auth directive and proxies only `/api/*` to the guarded API. Anything
 * the web app imports is world-readable to whoever resolves the domain, and
 * these cards name which controls are off, which settings nothing reads, and
 * what an administrator can do. So the cards are served through an
 * authenticated, permission-filtered endpoint and never bundled.
 *
 * **Why answers, not articles.** Each `answer` is one to three sentences and
 * is rendered verbatim. Nothing summarises at read time, which is what lets
 * this be ordinary deterministic code — and it is what a person asking "why
 * is this button grey" actually wants. If an answer will not fit in three
 * sentences it is two cards.
 *
 * **How to write a card.** The `question` is the sentence a person says out
 * loud, not a documentation title. The `aliases` carry the whole burden a
 * model's paraphrase tolerance would carry, so write them from how people
 * actually type — lowercase, misspelt, verb-first — and add to them from real
 * misses rather than from imagination.
 *
 * **What keeps it honest.** `help.cards.test.ts` asserts every `permission`
 * is a live key and every `tourStep` resolves in the guide registry. That is
 * aimed at the failure this repository has already had twice: A-01 deleted
 * `regularization.raise` from the catalogue outright, and
 * `changelog.test.ts` passes green over a changelog stale by 97 commits
 * because its guard catches deletion and not divergence. A card pointing at
 * something that no longer exists fails the build.
 */
export const HELP_CARDS: readonly HelpCard[] = [
  // ---------------------------------------------------------------- punch --
  {
    id: 'punch.outside-geofence',
    question: "Why can't I punch from here?",
    aliases: [
      'outside geofence',
      'punch blocked location',
      'too far from office',
      'cant punch from home',
      'not in range',
      'location out of range',
    ],
    answer:
      'Your punch has to be inside your office location\'s radius, which is 100 metres unless an administrator changed it. Punching from outside is refused rather than flagged, so move closer to the office and try again.',
    route: '/punch',
    permission: PERMISSIONS.PUNCH_SELF,
    tourStep: 'screen.punch',
    errorCodes: ['PUNCH_OUTSIDE_GEOFENCE'],
    topic: 'punch',
  },
  {
    id: 'punch.location-required',
    question: 'It says location is required and will not let me punch',
    aliases: [
      'location required',
      'no gps',
      'gps not working',
      'allow location',
      'location permission',
      'waiting for location',
    ],
    answer:
      'The punch screen waits for a real GPS fix before it will submit, and there is no longer an option to punch without one by giving a reason. Allow location for this site in your browser settings, then step outside or near a window if the fix will not arrive.',
    route: '/punch',
    permission: PERMISSIONS.PUNCH_SELF,
    tourStep: 'screen.punch',
    errorCodes: ['PUNCH_LOCATION_REQUIRED'],
    topic: 'punch',
  },
  {
    id: 'punch.geofence-not-configured',
    question: 'Punching says the office has no coordinates set',
    aliases: [
      'geofence not configured',
      'office location not set',
      'no coordinates',
      'location has no centre',
      'employee cannot punch at all',
    ],
    answer:
      'The employee\'s location has no latitude and longitude, so there is no radius to check and every punch there is refused. An administrator sets the coordinates on the location in Organisation; until then nobody assigned to it can punch.',
    route: '/organisation',
    permission: PERMISSIONS.SETTINGS_MANAGE,
    tourStep: 'screen.organisation',
    errorCodes: ['PUNCH_GEOFENCE_NOT_CONFIGURED'],
    topic: 'punch',
  },
  {
    id: 'punch.out-of-order',
    question: 'It says my punch is out of order',
    aliases: [
      'out of order',
      'already punched in',
      'cant punch out',
      'punch twice',
      'double punch',
    ],
    answer:
      'Punches alternate: an IN has to follow an OUT and an OUT has to follow an IN. If you believe one is missing, an administrator can record the missing punch for you from Approvals.',
    route: '/punch',
    permission: PERMISSIONS.PUNCH_SELF,
    tourStep: 'screen.punch',
    errorCodes: ['PUNCH_OUT_OF_ORDER'],
    topic: 'punch',
  },
  {
    id: 'punch.outside-window',
    question: 'I punched outside my shift hours — was it accepted?',
    aliases: [
      'outside window',
      'punched late',
      'punch after hours',
      'late punch accepted',
      'out of window',
    ],
    answer:
      'Yes. A late or out-of-window punch is always recorded, then flagged and sent to Approvals for an administrator to look at. You do not need to do anything; the note field on the punch screen is optional and goes to whoever reviews it.',
    route: '/punch',
    permission: PERMISSIONS.PUNCH_SELF,
    tourStep: 'screen.punch',
    errorCodes: ['PUNCH_OUTSIDE_WINDOW'],
    topic: 'punch',
  },
  {
    id: 'punch.consent-required',
    question: 'It is asking me to accept something before I can punch',
    aliases: [
      'consent required',
      'accept notice',
      'photo consent',
      'privacy notice punch',
      'agree before punch',
    ],
    answer:
      'Punching captures a photo and your location, so you are asked once to accept the notice that says what is kept and for how long. The acceptance is recorded against the version of the notice you saw, and you will be asked again only if that notice changes.',
    route: '/punch',
    permission: PERMISSIONS.PUNCH_SELF,
    tourStep: 'screen.punch',
    errorCodes: ['CONSENT_REQUIRED'],
    topic: 'punch',
  },
  {
    id: 'punch.offline',
    question: 'I punched with no signal — did it count?',
    aliases: [
      'offline punch',
      'no internet punch',
      'punch queued',
      'no network',
      'punch not showing',
      'offline sync',
    ],
    answer:
      'The punch is stored on your phone and sent when the connection returns, keeping the time you actually pressed it. It arrives carrying an offline sync flag so the day shows where it came from.',
    route: '/punch',
    permission: PERMISSIONS.PUNCH_SELF,
    tourStep: 'screen.punch',
    errorCodes: ['PUNCH_QUEUED_TOO_OLD'],
    topic: 'punch',
  },
  {
    id: 'punch.early-arrival',
    question: 'What is the early arrival streak?',
    aliases: [
      'early streak',
      'confetti',
      'early arrival',
      'why did confetti appear',
      'streak badge',
      'came early',
    ],
    answer:
      'If your first IN is ahead of your shift start by your organisation\'s threshold, the day counts as an early arrival and your streak grows. A worked day that is not early resets it; days off carry it forward.',
    route: '/punch',
    permission: PERMISSIONS.PUNCH_SELF,
    tourStep: 'screen.punch',
    errorCodes: [],
    topic: 'punch',
  },
  {
    id: 'punch.mock-location',
    question: 'It says my location looks faked',
    aliases: ['mock location', 'fake gps', 'location spoof', 'mock gps detected'],
    answer:
      'The device reported that its position came from a mock location provider, which is refused. Turn off any GPS-spoofing or developer location option and punch again.',
    route: '/punch',
    permission: PERMISSIONS.PUNCH_SELF,
    tourStep: 'screen.punch',
    errorCodes: ['PUNCH_MOCK_LOCATION'],
    topic: 'punch',
  },
  {
    id: 'punch.photo',
    question: 'The punch photo will not go through',
    aliases: [
      'photo required',
      'camera not working',
      'photo invalid',
      'cant take photo',
      'camera blocked',
    ],
    answer:
      'A punch needs a photo taken by the camera on the screen, and an image that is not a real photo is rejected. Allow camera access for this site, and if the button will not press, wait for the preview to show a frame first.',
    route: '/punch',
    permission: PERMISSIONS.PUNCH_SELF,
    tourStep: 'screen.punch',
    errorCodes: ['PUNCH_PHOTO_REQUIRED', 'PUNCH_PHOTO_INVALID'],
    topic: 'punch',
  },
  {
    id: 'punch.device-not-bound',
    question: 'It says this device is not allowed to punch',
    aliases: ['device not bound', 'new phone punch', 'device mismatch', 'changed phone'],
    answer:
      'Your organisation binds punching to a registered device, and this one is not the registered one. An administrator can clear the binding so your new phone can register itself on the next punch.',
    route: '/punch',
    permission: PERMISSIONS.PUNCH_SELF,
    tourStep: 'screen.punch',
    errorCodes: ['PUNCH_DEVICE_NOT_BOUND'],
    topic: 'punch',
  },

  // ----------------------------------------------------------- attendance --
  {
    id: 'attendance.flags',
    question: 'What do the flags on a day mean?',
    aliases: [
      'flag meaning',
      'what is late flag',
      'clock skew',
      'low gps accuracy',
      'pennant icon',
      'flags list',
      'what does this flag mean',
    ],
    answer:
      'A flag describes something about how a punch was made — late, early exit, missing punch, outside geofence, outside window, offline sync, device mismatch, manual override, low GPS accuracy, no location, mock location or clock skew. Flags are independent of the day\'s status, so one day can carry several, and only some of them ask an administrator to look.',
    route: '/my-attendance',
    permission: PERMISSIONS.ATTENDANCE_VIEW_SELF,
    tourStep: 'screen.my-attendance',
    errorCodes: [],
    topic: 'attendance',
  },
  {
    id: 'attendance.statuses',
    question: 'What are the day statuses?',
    aliases: [
      'status meaning',
      'what is pending status',
      'absent but i punched',
      'half day meaning',
      'on duty',
      'weekly off',
    ],
    answer:
      'A day is one of Holiday, Weekly off, On leave, Present, Half day, On duty, Pending or Absent. Pending means the day has not been computed yet — usually because it is still in progress or a punch is missing — and it becomes a final status once the day closes.',
    route: '/my-attendance',
    permission: PERMISSIONS.ATTENDANCE_VIEW_SELF,
    tourStep: 'screen.my-attendance',
    errorCodes: [],
    topic: 'attendance',
  },
  {
    id: 'attendance.corrections-removed',
    question: 'Where did Corrections go?',
    aliases: [
      'regularization',
      'regularisation',
      'correct this day',
      'correction request',
      'raise a correction',
      'on duty request',
      'fix my attendance',
    ],
    answer:
      'Corrections and on-duty requests were removed on 21 August 2026. If a day is wrong, ask an administrator to record the missing punch or set the day directly; corrections you had already raised are still decidable in Approvals until they are cleared.',
    route: '/my-attendance',
    permission: PERMISSIONS.ATTENDANCE_VIEW_SELF,
    tourStep: 'screen.my-attendance',
    errorCodes: [],
    topic: 'attendance',
  },
  {
    id: 'attendance.admin-recorded',
    question: 'My day says "recorded by admin" — what does that mean?',
    aliases: [
      'recorded by admin',
      'admin entry',
      'who added this punch',
      'admin recorded attendance',
      'manual punch',
    ],
    answer:
      'An administrator recorded that IN or OUT on your behalf, with a reason and the time it should count as. It has no photo or location because it was not punched on a device, and it counts in your day exactly like your own punches do.',
    route: '/my-attendance',
    permission: PERMISSIONS.ATTENDANCE_VIEW_SELF,
    tourStep: 'screen.my-attendance',
    errorCodes: [],
    topic: 'attendance',
  },
  {
    id: 'attendance.record-for-someone',
    question: 'How do I record attendance for someone who could not punch?',
    aliases: [
      'record attendance',
      'add punch for employee',
      'manual entry',
      'punch on behalf',
      'employee forgot to punch',
    ],
    answer:
      'Open Approvals and use Record attendance: pick the employee, choose IN or OUT, set the date and time, and give a reason. The reason is required because it stands in place of the photo and location a real punch would have carried.',
    route: '/approvals',
    permission: PERMISSIONS.ATTENDANCE_EDIT,
    tourStep: 'screen.approvals',
    errorCodes: [],
    topic: 'attendance',
  },
  {
    id: 'attendance.period-locked',
    question: 'Why can I not change this day?',
    aliases: [
      'period locked',
      'month locked',
      'cannot edit attendance',
      'locked period',
      'past month closed',
    ],
    answer:
      'The period containing that day has been locked, which freezes attendance so payroll inputs cannot move under whoever already used them. Someone holding the unlock permission has to reopen the period before anything in it can change.',
    route: '/period-lock',
    permission: PERMISSIONS.ATTENDANCE_VIEW_SELF,
    tourStep: 'screen.period-lock',
    errorCodes: ['PERIOD_LOCKED', 'PERIOD_ALREADY_LOCKED', 'PERIOD_NOT_LOCKED'],
    topic: 'attendance',
  },

  // ---------------------------------------------------------------- leave --
  {
    id: 'leave.insufficient-balance',
    question: 'It says I do not have enough leave balance',
    aliases: [
      'insufficient balance',
      'no leave left',
      'balance too low',
      'not enough leave',
      'leave balance',
    ],
    answer:
      'The days you asked for exceed what that leave type has left for you, and your organisation does not allow this type to go negative that far. Check the balance on My leave, or apply under a different type.',
    route: '/my-leave',
    permission: PERMISSIONS.LEAVE_APPLY_SELF,
    tourStep: 'screen.my-leave',
    errorCodes: ['LEAVE_INSUFFICIENT_BALANCE', 'LEAVE_NEGATIVE_LIMIT_EXCEEDED'],
    topic: 'leave',
  },
  {
    id: 'leave.overlaps',
    question: 'It says my leave overlaps something',
    aliases: ['overlaps existing', 'already applied', 'duplicate leave', 'clash with leave'],
    answer:
      'You already have a leave request covering one or more of those dates, whether it is pending or approved. Cancel or amend the existing request before applying again for the same days.',
    route: '/my-leave',
    permission: PERMISSIONS.LEAVE_APPLY_SELF,
    tourStep: 'screen.my-leave',
    errorCodes: ['LEAVE_OVERLAPS_EXISTING'],
    topic: 'leave',
  },
  {
    id: 'leave.notice-period',
    question: 'It says I applied too late for this leave',
    aliases: ['notice period', 'too short notice', 'apply in advance', 'minimum notice'],
    answer:
      'That leave type requires a minimum number of days between applying and the first day off, and this request is inside it. Ask an administrator if it has to be taken at short notice — they can record the leave for you.',
    route: '/my-leave',
    permission: PERMISSIONS.LEAVE_APPLY_SELF,
    tourStep: 'screen.my-leave',
    errorCodes: ['LEAVE_NOTICE_PERIOD'],
    topic: 'leave',
  },
  {
    id: 'leave.attachment',
    question: 'It is asking me to attach a document to my leave',
    aliases: ['attachment required', 'medical certificate', 'upload proof', 'attach file leave'],
    answer:
      'That leave type requires supporting proof past a certain length, most often a medical certificate. Attach the file on the request before submitting it.',
    route: '/my-leave',
    permission: PERMISSIONS.LEAVE_APPLY_SELF,
    tourStep: 'screen.my-leave',
    errorCodes: ['LEAVE_ATTACHMENT_REQUIRED'],
    topic: 'leave',
  },

  // ------------------------------------------------------------ approvals --
  {
    id: 'approvals.own-request',
    question: 'Why can I not approve my own request?',
    aliases: [
      'approve own',
      'approver is requester',
      'cant approve myself',
      'my own leave approve',
    ],
    answer:
      'Nobody decides their own request, whatever permissions they hold. Someone else with the approving permission has to action it.',
    route: '/approvals',
    permission: null,
    tourStep: 'screen.approvals',
    errorCodes: ['APPROVER_IS_REQUESTER'],
    topic: 'approvals',
  },
  {
    id: 'approvals.already-actioned',
    question: 'It says this request was already decided',
    aliases: ['already actioned', 'someone else approved', 'already approved', 'stale request'],
    answer:
      'Another approver decided it between the page loading and your click. Refresh the inbox to see who decided it and how.',
    route: '/approvals',
    permission: null,
    tourStep: 'screen.approvals',
    errorCodes: ['APPROVAL_ALREADY_ACTIONED'],
    topic: 'approvals',
  },
  {
    id: 'approvals.flagged-punch',
    question: 'There is a flagged punch in my inbox — what do I do with it?',
    aliases: [
      'flagged punch',
      'punch flag review',
      'accept flag',
      'keep flagged',
      'mark half day',
      'late punch approval',
    ],
    answer:
      'A late or out-of-window punch raises one request so somebody decides what it meant. Accept stops the day engine raising the flag, Keep flagged leaves it on the record, Mark half day sets the day, and Add note records why — every one of them is audited and the punch row shows who decided.',
    route: '/approvals',
    permission: PERMISSIONS.ATTENDANCE_EDIT,
    tourStep: 'screen.approvals',
    errorCodes: [],
    topic: 'approvals',
  },

  // -------------------------------------------------------------- reports --
  {
    id: 'reports.compare',
    question: 'How do I compare this against last year?',
    aliases: [
      'compare periods',
      'vs last year',
      'financial year comparison',
      'previous period',
      'year on year',
      'fy comparison',
    ],
    answer:
      'The comparison control sets the period — year, quarter or month — and what to compare against: nothing, the previous period, or the same period last financial year. The financial year runs April to March, partial periods are compared like for like, and the choice follows into the table, the chart and the export.',
    route: '/reports',
    permission: PERMISSIONS.REPORT_VIEW,
    tourStep: 'screen.reports',
    errorCodes: [],
    topic: 'reports',
  },
  {
    id: 'reports.chart-row-cap',
    question: 'Why does the chart show fewer rows than the table?',
    aliases: ['200 rows', 'chart cap', 'chart missing rows', 'chart truncated'],
    answer:
      'A chart reads the filtered set up to 200 rows, sorted by whatever the report is about, and says so when there are more. The table is the complete answer; the chart is the shape of it.',
    route: '/reports',
    permission: PERMISSIONS.REPORT_VIEW,
    tourStep: 'screen.reports',
    errorCodes: [],
    topic: 'reports',
  },
  {
    id: 'reports.drill',
    question: 'Can I click a bar to filter the table?',
    aliases: ['click chart', 'drill down', 'chart filter', 'bar click', 'donut slice'],
    answer:
      'Yes — clicking a bar or a donut slice applies that value as the matching filter and lands you on the table. Segments whose report has no matching filter are not clickable, and Other never drills because it is not one value.',
    route: '/reports',
    permission: PERMISSIONS.REPORT_VIEW,
    tourStep: 'screen.reports',
    errorCodes: [],
    topic: 'reports',
  },
  {
    id: 'reports.pdf',
    question: 'How do I get a PDF of a report?',
    aliases: ['pdf export', 'print report', 'save as pdf', 'download pdf'],
    answer:
      'Use Print in the report\'s export menu and save as PDF from the print dialog. The sidebar, header and navigation are stripped from the printed page so only the report itself comes out.',
    route: '/reports',
    permission: PERMISSIONS.REPORT_EXPORT,
    tourStep: 'screen.reports',
    errorCodes: [],
    topic: 'reports',
  },

  // --------------------------------------------------------------- people --
  {
    id: 'people.credentials',
    question: 'Why can I not set a password for an employee?',
    aliases: [
      'reset password',
      'set credentials',
      'give employee login',
      'password button disabled',
      'create account for employee',
    ],
    answer:
      'Setting someone\'s password is taking their account over, so it needs the roles permission rather than the employee permission. You also cannot give an account permissions you do not hold yourself.',
    route: '/employees',
    permission: PERMISSIONS.EMPLOYEE_MANAGE,
    tourStep: 'screen.employees',
    errorCodes: ['FORBIDDEN'],
    topic: 'people',
  },
  {
    id: 'people.employee-code',
    question: 'Why can I not change an employee code?',
    aliases: ['employee code immutable', 'change code', 'edit employee code'],
    answer:
      'An employee code is referenced by attendance, leave and every export already handed to payroll, so it is fixed once created. Create a new employee if the identity itself has changed.',
    route: '/employees',
    permission: PERMISSIONS.EMPLOYEE_MANAGE,
    tourStep: 'screen.employees',
    errorCodes: ['EMPLOYEE_CODE_IMMUTABLE'],
    topic: 'people',
  },
  {
    id: 'people.deleted',
    question: 'I deleted something by mistake — can I get it back?',
    aliases: ['recycle bin', 'restore deleted', 'undo delete', 'deleted record', 'recover'],
    answer:
      'Deleted records go to the Recycle bin rather than disappearing, and can be restored from there. Punches and audit entries are never deleted at all — they are appended to, so a correction is a new record rather than an edit.',
    route: '/recycle-bin',
    permission: PERMISSIONS.EMPLOYEE_MANAGE,
    tourStep: 'screen.recycle-bin',
    errorCodes: ['RECORD_NOT_DELETED', 'RECORD_IN_USE'],
    topic: 'people',
  },
  {
    id: 'people.reporting-cycle',
    question: 'It says there is a reporting cycle',
    aliases: ['reporting cycle', 'manager loop', 'reports to loop', 'circular manager'],
    answer:
      'The manager you picked already reports to this employee, directly or through a chain, and a loop would leave both without an approver. Pick someone outside that chain.',
    route: '/employees',
    permission: PERMISSIONS.EMPLOYEE_MANAGE,
    tourStep: 'screen.employees',
    errorCodes: ['REPORTING_CYCLE'],
    topic: 'people',
  },

  // ------------------------------------------------------------ documents --
  {
    id: 'documents.credit-blocked',
    question: 'It says the customer is credit blocked',
    aliases: ['credit blocked', 'credit limit', 'customer on hold', 'credit hold'],
    answer:
      'The party is past the credit limit or terms held against them, so the document cannot proceed on its own. Someone holding the credit override permission has to release it deliberately.',
    route: '/sales/orders',
    permission: PERMISSIONS.SALES_DOCUMENT_VIEW_SELF,
    tourStep: 'screen.sales-orders',
    errorCodes: ['CREDIT_BLOCKED'],
    topic: 'documents',
  },
  {
    id: 'documents.alter',
    question: 'Why can I not edit this document?',
    aliases: ['cant edit document', 'alter document', 'document locked', 'edit invoice'],
    answer:
      'Changing a document after it exists needs the alter permission, which is separate from being allowed to create one. A document already pushed to Tally is also constrained by what Tally will accept back.',
    route: '/sales/orders',
    permission: PERMISSIONS.SALES_DOCUMENT_VIEW_SELF,
    tourStep: 'screen.sales-orders',
    errorCodes: ['FORBIDDEN'],
    topic: 'documents',
  },
  {
    id: 'documents.draft-restored',
    question: 'My document came back after the connection dropped',
    aliases: ['draft restored', 'lost document', 'connection dropped', 'unsaved document'],
    answer:
      'A document being created is backed up in the browser as you type, so a dropped connection restores it rather than losing it. The backup clears once the document saves.',
    route: '/sales/orders',
    permission: PERMISSIONS.SALES_DOCUMENT_CREATE,
    tourStep: 'screen.sales-orders',
    errorCodes: [],
    topic: 'documents',
  },

  // ---------------------------------------------------------------- tally --
  {
    id: 'tally.masters-read-only',
    question: 'Why can I not create a customer or an item here?',
    aliases: [
      'create party',
      'add customer',
      'add item',
      'masters read only',
      'new ledger',
      'cant add party',
    ],
    answer:
      'Parties, items and price lists are created in TallyPrime and mirrored here, because Tally is the system of record for masters. Create it in Tally and it appears here on the next sync.',
    route: '/masters/parties',
    permission: PERMISSIONS.MASTERS_TALLY_VIEW,
    tourStep: 'screen.masters-parties',
    errorCodes: [],
    topic: 'tally',
  },
  {
    id: 'tally.not-in-tally',
    question: 'My document has not appeared in Tally',
    aliases: [
      'not synced',
      'sync failed',
      'not in tally',
      'push failed',
      'sync pending',
      'tally missing document',
    ],
    answer:
      'Documents are pushed to Tally as vouchers and the result is recorded against the document, so check its sync state first. A failure is listed as a sync exception with the reason Tally gave, and resolving an exception records the decision — it does not retry the push on its own.',
    route: '/integrations',
    permission: PERMISSIONS.INTEGRATION_MANAGE,
    tourStep: 'screen.integrations',
    errorCodes: [],
    topic: 'tally',
  },

  // -------------------------------------------------------------- account --
  {
    id: 'account.window-closed',
    question: 'It will not let me sign in right now',
    aliases: [
      'access window closed',
      'cant login at night',
      'sign in closed',
      'locked out at night',
      'login blocked time',
      'reopens at',
    ],
    answer:
      'Your organisation closes sign-in outside its working hours, and the message says when it reopens. Only accounts holding the out-of-hours permission can sign in during the closed window.',
    route: null,
    permission: null,
    tourStep: null,
    errorCodes: ['ACCESS_WINDOW_CLOSED'],
    topic: 'account',
  },
  {
    id: 'account.locked',
    question: 'My account is locked',
    aliases: [
      'account locked',
      'too many attempts',
      'locked out',
      'wrong password many times',
      'unlock account',
    ],
    answer:
      'Too many failed sign-in attempts lock the account for a period rather than forever. Wait it out, or ask an administrator to reset your password.',
    route: null,
    permission: null,
    tourStep: null,
    errorCodes: ['ACCOUNT_LOCKED', 'INVALID_CREDENTIALS'],
    topic: 'account',
  },
  {
    id: 'account.totp',
    question: 'It is asking for a code from my authenticator',
    aliases: ['totp', 'two factor', '2fa', 'authenticator code', 'mfa'],
    answer:
      'Your account has two-factor authentication enabled, so a six-digit code from your authenticator app is needed after the password. If the code keeps failing, check that your phone\'s clock is set automatically.',
    route: null,
    permission: null,
    tourStep: null,
    errorCodes: ['TOTP_REQUIRED', 'TOTP_INVALID'],
    topic: 'account',
  },
  {
    id: 'account.session-expired',
    question: 'I keep getting signed out',
    aliases: ['session expired', 'signed out', 'token expired', 'logged out automatically'],
    answer:
      'Sessions expire and are renewed quietly while you are working, so being signed out usually means the renewal was refused — most often because the session was revoked elsewhere or the device was offline too long. Sign in again.',
    route: null,
    permission: null,
    tourStep: null,
    errorCodes: ['TOKEN_EXPIRED', 'TOKEN_INVALID', 'REFRESH_TOKEN_REUSED'],
    topic: 'account',
  },
  {
    id: 'account.permissions',
    question: 'Why can I not see a screen someone else can?',
    aliases: [
      'missing screen',
      'no access',
      'forbidden',
      'cant see menu',
      'permission denied',
      'screen missing from sidebar',
      'out of scope',
    ],
    answer:
      'The sidebar shows only what your roles permit, so a screen you cannot open does not appear at all. An administrator changes this by editing your roles; scope also matters, because some permissions cover only yourself or only your team.',
    route: '/profile',
    permission: null,
    tourStep: 'shell.nav',
    errorCodes: ['FORBIDDEN', 'OUT_OF_SCOPE'],
    topic: 'account',
  },
  {
    id: 'account.keyboard',
    question: 'What are the keyboard shortcuts?',
    aliases: [
      'shortcuts',
      'hotkeys',
      'keyboard',
      'tally keys',
      'alt g',
      'keyboard shortcuts list',
    ],
    answer:
      'Ctrl+F1 — or F1 where the browser takes Ctrl+F1 — lists every shortcut active on the screen you are looking at, read from the live registry. Keys match TallyPrime wherever a browser allows it: Alt+G to go anywhere, Esc to close, Ctrl+A to save.',
    route: null,
    permission: null,
    tourStep: 'shell.shortcuts',
    errorCodes: [],
    topic: 'account',
  },
  {
    id: 'account.tour',
    question: 'Can something walk me through this screen?',
    aliases: [
      'guided tour',
      'show me around',
      'walk me through',
      'tour',
      'how does this screen work',
      'orientation',
    ],
    answer:
      'Ctrl+F1 has "Walk me through this screen", which highlights the real controls on the screen you are on. The account menu has the full tour if you would rather start from the beginning.',
    route: null,
    permission: null,
    tourStep: 'shell.page-guide',
    errorCodes: [],
    topic: 'account',
  },
  {
    id: 'account.rate-limited',
    question: 'It says I am doing that too often',
    aliases: ['rate limited', 'too many requests', 'slow down', 'try again later'],
    answer:
      'Some actions are limited by how often they can be repeated, which is what stops a password from being guessed. Wait a few minutes and try again.',
    route: null,
    permission: null,
    tourStep: null,
    errorCodes: ['RATE_LIMITED'],
    topic: 'account',
  },
];
