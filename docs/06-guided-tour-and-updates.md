# 06 — Guided tour and Updates

Design for two connected surfaces:

- **Guide** — a step-by-step walkthrough that moves the person through the real
  application, highlighting the actual control it is talking about.
- **Updates** — a changelog the person can open at any time, where a new entry
  can hand off to a short Guide run for the thing that changed.

Nothing here is built yet. This document is the design and the impact
assessment, so the decision to build it is made with the cost visible.

Status: **proposed**. Open questions are in §14 and mirrored into
`OPEN-QUESTIONS.md` under "Raised during guided tour design".

---

## 1. What this is, and what it is not

**It is** product orientation: where things are, what a control does, what
changed in the last release.

**It is not**:

- Employee onboarding. PRD §1 lists "recruitment, onboarding workflows" as
  non-goal N3. That is an HR process about a new hire. This is a UI walkthrough
  about the software. They share a word and nothing else.
- A help centre, a manual, or searchable documentation.
- A blocker. The Guide never gates a screen. A person who dismisses it can do
  everything they could do before it existed.

**The one rule that shapes everything below:** the Guide points at the live
application. It does not render screenshots, mock screens, or a simulated
sidebar. If it says "this is the Punch button", it is pointing at the Punch
button that works.

---

## 2. Module boundary

CLAUDE.md §2: nothing attendance-specific goes in a shared module, and no
platform concern goes inside the attendance module.

Orientation and release notes are a **platform** concern. The same machinery
has to carry the CRM and ERP modules later without being rewritten. So:

```
apps/web/src/features/guide/       Guide UI, step registry, overlay
apps/web/src/features/updates/     Changelog data + screen
apps/web/src/components/shared/    anchored-popover (the one missing primitive)
apps/web/src/lib/guide-store.ts    Seen-state, alongside nav-preferences-store
```

The step registry contains attendance step *copy*, which is content, not logic.
No punch rule, leave rule, or shift rule is ever read by the Guide. It knows
route strings and anchor names and nothing else. That keeps the boundary clean
when a CRM tour is added as a second registry file.

---

## 3. Entry points

There are exactly four ways in, and no fifth.

| # | Entry | Who sees it | Behaviour |
|---|---|---|---|
| 1 | **First sign-in** | Anyone who has never completed or dismissed the Guide | An invitation, not an auto-start. See §4.1 |
| 2 | **Account menu → "Take the tour"** | Everyone, always | Starts from step one, every time |
| 3 | **Shortcut sheet (`Ctrl+F1` / `F1`)** | Everyone | A "Take the tour" button under the shortcut list |
| 4 | **An Updates row → "Show me"** | Anyone opening Updates | Runs a two- to four-step mini-tour for that one entry |

`Ctrl+F1` is already the PRD §6.4 contextual-help key and already opens the
shortcut sheet. The Guide joins that sheet rather than claiming a key of its
own — the Tally key table in §6.4 is authoritative and has no free slot for a
tour, so inventing one would be a spec violation.

---

## 4. The user flow, step by step

### 4.1 First sign-in, desktop

**Step 0 — the invitation.** Not the tour. A single Popover anchored to the
account avatar, with two buttons.

```
┌────────────────────────────────────────────┐
│  New here?                                 │
│                                            │
│  A two-minute walk through the screens      │
│  you have access to. You can stop at any    │
│  point and pick it up from this menu.       │
│                                            │
│              [ Not now ]  [ Start ]         │
└────────────────────────────────────────────┘
```

It appears once, roughly 800ms after the dashboard settles — not on mount,
because a bubble that arrives during the first paint reads as a rendering
glitch. "Not now" records a dismissal and it never appears again unprompted.

Why an invitation rather than an auto-start: the same account type is used by a
shop-floor employee who opens Punch and closes the tab. Seizing their screen on
the first sign-in to explain the Reports menu they cannot open is hostile. The
Guide has to be asked for.

**Step 1 — Navigation.**

- Anchor: the sidebar's first nav group
- Route: `/` (already there)
- Copy: "Everything lives here, grouped by what you are doing. You only see
  what your role allows, so this list is shorter for some people than others."

**Step 2 — Go to.**

- Anchor: the "Go to" button in the header
- Bubble carries a live `<ShortcutHint keys="alt+g" />` chip
- Copy: "The fast path. Press Alt+G anywhere and type the first few letters of
  a screen."
- **Interactive:** pressing `Alt+G` while this step is showing opens the
  palette for real and advances the step. The Guide does not fake the keypress
  and does not block it.

**Step 3 — Shortcuts.**

- Anchor: the keyboard icon in the header
- Copy: "Every key on this screen, listed. The keys match TallyPrime wherever
  the browser allows it."

**Step 4 — Where you are.**

- Anchor: the breadcrumb trail
- Copy: "The page always names itself here."

**Step 5 — Your account.**

- Anchor: the avatar button
- Copy: "Theme, your profile, and the way out. The tour lives here too if you
  want it again."

**Step 6 — Updates.**

- Anchor: the "Updates" row inside the account menu — so the Guide **opens the
  menu** for this step and holds it open
- Copy: "What changed, and when. A dot appears here when there is something you
  have not read."

Steps 1–6 are the everyone tour. What follows is filtered by permission, and a
person with no matching permission goes straight to the closing card.

**Step 7+ — the role-shaped remainder.** Each block is included only if the
signed-in permission set grants it.

| Block | Gate | Steps |
|---|---|---|
| Your day | `punch.self` | Punch → the capture and consent notice → the half-day choice on an IN → My attendance → My leave |
| Your team | `attendance.view_team` | Team attendance → Approvals (if `leave.approve_team`) |
| Reporting | `report.view` | Reports → Downloads, and why an export is a job rather than a wait |
| Setting it up | `settings.manage` | Employees → Shifts → Leave types and Holidays → Settings tabs → Roles → Period lock → Audit log |

Each block's first step **navigates**. The Guide calls `navigate('/punch')`,
waits for the anchor to exist, then draws. See §6 for what happens when it does
not appear.

**Closing card.** Not anchored to anything — a centred Dialog.

```
┌────────────────────────────────────────────┐
│  That is the tour                          │
│                                            │
│  You saw 14 of 14 steps.                    │
│  Alt+G gets you anywhere. Ctrl+F1 lists     │
│  every key. The tour is in your account     │
│  menu whenever you want it again.           │
│                                            │
│                             [ Done ]        │
└────────────────────────────────────────────┘
```

### 4.2 First sign-in, phone

Same registry, three differences, all driven by `useIsMobile()` — the hook the
shell already uses to swap the account dropdown for a Sheet.

1. **The bubble is a bottom Sheet, not a Popover.** A 288px popover pinned near
   a control at 360px covers the control it is describing. The Sheet sits at
   the bottom, under the thumb, and the highlight stays visible above it.
2. **Sidebar steps are replaced, not skipped.** Step 1 anchors to the bottom
   navigation bar instead, with its own copy: "Four destinations plus More.
   Long-press More to choose which four." A step declares `mobileAnchor` to opt
   into this; without one it declares `mobile: 'skip'`.
3. **The scrim is lighter and the page still scrolls.** A phone tour that locks
   scroll cannot show a control below the fold.

Touch targets in the Sheet footer are the standard 44px minimum. Back, Skip and
Next sit in one row: Skip on the left, Back and Next paired on the right.

### 4.3 Resume

The Guide records the last completed step id, not an index — a step inserted
later must not move somebody two steps backwards.

If a run is abandoned (Esc, a reload, or a click on Skip) and the person starts
it again within seven days, the invitation reads:

```
  Pick up where you left off?
  You stopped at "Team attendance", step 9 of 14.

              [ Start over ]  [ Continue ]
```

If the recorded step id no longer exists in the registry, resume is silently
discarded and the run starts at step one. A version bump on the registry does
the same.

### 4.4 A new release lands

1. A release is added to `changelog.ts` with a version, a date and its entries.
2. On the next load, the client compares the newest release version against
   `lastSeenVersion` in the Guide store.
3. If it is newer, a **dot** appears on the avatar button and on the "Updates"
   row inside the account menu. No toast, no modal, no interruption. The person
   is working; a release note is not urgent.
4. Opening `/updates` marks everything up to the newest release as seen and
   clears the dot.

There is deliberately no "what's new" popup on sign-in. It is the single most
resented pattern in operations software, and this product's users open it
several times a day.

### 4.5 From a changelog row into a spotlight

This is the piece that ties the two surfaces together.

A changelog entry may carry a `tour` id. When it does, the row renders a "Show
me" button. Pressing it:

1. Closes the Updates screen
2. Navigates to the entry's route
3. Runs a **mini-tour** — the two to four steps registered under that id, and
   nothing else
4. Ends on a one-line closing card, not the full closing card

```
Updates                                          v0.9.0 · 12 Aug 2026

  Added   Period lock                                    REQ-E-09
          A month can now be closed so no punch or edit
          can change it after payroll input is handed off.
                                              [ Show me ]  →  spotlights the
                                                              Lock button on
                                                              /period-lock

  Changed Export runs as a job                           REQ-J-03
          Large exports no longer hold the screen. They
          appear in Downloads when ready.
                                              [ Show me ]

  Fixed   The bottom bar forgot its fourth tab on reload
```

---

## 5. The step registry

One typed array, colocated with the feature, read at render. No content in
components.

```ts
export interface GuideStep {
  id: string;
  /** Navigated to before the step draws. Omit to stay put. */
  route?: string;
  /** Matched against [data-guide="…"] in the live DOM. */
  anchor: string;
  /** Used instead of `anchor` below the 768px breakpoint. */
  mobileAnchor?: string;
  title: string;
  body: string;
  /** Preferred side; the positioner may flip it to avoid a collision. */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Skipped entirely when the session lacks it. Same set the sidebar filters on. */
  permission?: PermissionKey;
  /** Rendered as a hint chip in the bubble, e.g. 'alt+g'. */
  shortcut?: string;
  /** Pressing this key advances the step instead of only Next. */
  advanceOn?: string;
  /** What to do on a phone when there is no mobileAnchor. */
  mobile?: 'skip';
  /** Opens this overlay before drawing, e.g. the account menu. */
  requires?: 'account-menu';
}
```

Three registries export from one file: `MAIN_TOUR`, `MINI_TOURS`
(`Record<string, GuideStep[]>`), and `REGISTRY_VERSION`.

**Why a registry rather than steps declared on each screen:** a step declared
inside `punch-page.tsx` only exists once that route has mounted, so the Guide
could not know the tour's length, could not show "9 of 14", and could not skip
a block before navigating into it. One list also means the whole tour is
reviewable in one file.

---

## 6. The highlight

This is the only genuinely new UI mechanism, so it is specified precisely.

**No tour library.** driver.js, react-joyride and shepherd all inject their own
DOM and their own stylesheet. That breaks CLAUDE.md §3 rule 1 (every component
from shadcn) and the styling rule (Tailwind plus theme tokens only), and it is
a dependency that needs approval. None is needed.

**Composition, from primitives already installed:**

| Part | Built from |
|---|---|
| Bubble, desktop | `ui/popover` (Base UI) via a new `shared/anchored-popover` |
| Bubble, phone | `ui/sheet`, `side="bottom"` |
| Closing card | `ui/dialog` |
| Buttons, chips | `ui/button`, `shared/shortcut-hint` |
| Progress | `ui/progress` |
| Scrim + cutout | One `<div>`, Tailwind, theme tokens |

**The one missing primitive.** `ui/popover.tsx` forwards only
`align | alignOffset | side | sideOffset` to Base UI's `Positioner`, so it can
only anchor to a `PopoverTrigger` it wraps. The Guide has to anchor to an
element it does not own. Base UI's `Popover.Positioner` already accepts an
`anchor` prop; the wrapper simply does not pass it through.

Fix per CLAUDE.md §3 — compose, do not edit the shadcn file, because the next
`shadcn add` overwrites it:

```
components/shared/anchored-popover.tsx
```

A thin composition over the same `@base-ui/react/popover` primitives that
forwards `anchor`. No copied source, no new dependency. It earns its place in
`shared/` because a "point at this element" popover is reusable — a field-level
validation callout wants the same thing.

**The scrim.** A single fixed element with a hole over the anchor's measured
rect:

```
position: fixed; inset: 0; z-index: 40;
top/left/width/height  = anchor rect, inflated by 4px
box-shadow: 0 0 0 9999px var(--scrim);
outline: 2px solid var(--ring);
pointer-events: none;
border-radius: 0;   /* --radius is 0; a rounded cutout on a square app is wrong */
```

Notes that matter:

- `pointer-events: none` on the scrim, with a separate full-screen click-catcher
  *behind* it at z-index 39 that advances the step. The highlighted control
  stays genuinely clickable — the tour never traps anyone.
- The rect is tracked with a `ResizeObserver` on the anchor plus a passive
  `scroll` listener on the capture phase, both throttled to `requestAnimationFrame`.
  A sticky header and a scrolling table both move things under the cutout.
- `scrollIntoView({ block: 'center' })` before measuring, with
  `behavior: 'smooth'` unless `prefers-reduced-motion` is set, in which case
  `'auto'`.
- Under `reduced-motion:`, the bubble uses the existing `.surface-instant`
  class — the same exemption the Go To palette and shortcut sheet already take.

**When the anchor is not there.** The Guide navigates, then polls for the
anchor via `MutationObserver` with a 1500ms ceiling. If it never appears:

- **Production:** the step is skipped silently, the counter adjusts, the run
  continues. A missing anchor must never strand somebody mid-tour.
- **Development:** the same skip, plus a `console.error` naming the step id and
  the anchor. A silent skip in dev is how a tour rots without anybody noticing.

---

## 7. Anchors, and the one real ongoing cost

A step finds its target through a data attribute on the real control:

```tsx
<Button data-guide="header.goto" variant="outline" size="sm" onClick={toggleGoto}>
```

One attribute. No wrapper element, no ref plumbing, no change to the component's
behaviour or layout.

**The cost is drift.** Refactor a screen, drop the attribute, and the step
vanishes with no error in production. This is the honest liability of the whole
design, and it needs the CLAUDE.md "make the class impossible" treatment rather
than discipline:

1. **A registry test.** `guide.test.ts` renders the shell and every routed
   screen under a permission set that grants everything, and asserts every
   `anchor` and `mobileAnchor` in the registry resolves to exactly one element.
   It fails in CI the moment an attribute is deleted or duplicated.
2. **A dev-time assertion** on step entry, as above.
3. **A lint-visible naming convention** — `area.control`, e.g. `header.goto`,
   `nav.group.work`, `punch.capture` — so an attribute is obviously load-bearing
   to somebody reading the JSX.

Item 1 is the one that actually works. Without it this feature quietly decays.

---

## 8. Keyboard

The Guide pushes a shortcut layer, which suspends the underlying screen's keys
exactly as a modal does — the registry already supports this:

```tsx
<ShortcutLayer id="modal:guide">
```

| Key | Action |
|---|---|
| `Enter` / `→` | Next step |
| `←` | Previous step |
| `Esc` | Stop, and record where |
| `Ctrl+Q` | Stop — the Tally "quit screen without saving" key, and it should mean the same thing here |
| The step's own `advanceOn` | Performs the real action and advances |

No new global shortcut is registered. The Guide is reached from the shortcut
sheet and the account menu, both of which already exist.

Focus moves to the bubble on each step, with `aria-live="polite"` on the body,
so the step is announced rather than only drawn. Focus returns to the element
that opened the run when it ends.

---

## 9. Updates — the screen

**Route:** `/updates`, off the sidebar, reached from the account menu.

PRD §6.1 fixes the sidebar to Work, Records, Reports and Setup. A changelog
belongs to none of them, so it takes the same treatment `/profile` already
takes: added to `OFF_NAV_LABELS` in `lib/nav.ts` so the breadcrumb can name it,
and never added to `NAV_GROUPS`. That is a one-line change to an existing map
that was built for exactly this case.

**Data:** a typed module, not an API.

```ts
export interface ChangelogEntry {
  kind: 'added' | 'changed' | 'fixed';
  title: string;
  body: string;
  reqs?: string[];      // REQ-E-09 — already in every commit message
  route?: string;       // "Take me there"
  tour?: string;        // "Show me" — a MINI_TOURS key
  permission?: PermissionKey;   // hidden from people who cannot use it
}

export interface Release {
  version: string;
  date: string;         // ISO
  entries: ChangelogEntry[];
}
```

**Why not an API:** it changes when the code changes, it ships with the code,
and it is the same in every environment. A table, a migration and an endpoint
would buy nothing and would let production and the bundle disagree.

**Layout**, following PRD §6.2 and the no-box-in-box rule: page header, then
one release per section — version and date as a `SectionHeading`, entries as
rows separated by dividers, `kind` as a `Badge`. No cards. Long histories
paginate with the existing `record-pagination`, newest first.

**Empty state:** `ui/empty`, "No updates yet."

**Permission filtering:** an entry gated on a permission the person lacks is
hidden. Announcing a Roles change to somebody who cannot open Roles is noise,
and pointing "Show me" at a screen they will be refused is worse.

---

## 10. Persistence

**Now: `localStorage`, via `zustand/persist`** — the same shape and the same
reasoning as `nav-preferences-store.ts`, which already sits beside it.

```ts
interface GuideState {
  completedAt: string | null;
  dismissedAt: string | null;
  lastStepId: string | null;
  registryVersion: number | null;
  seenVersion: string | null;      // newest Updates release read
  completedMiniTours: string[];
}
```

Key: `vyuha.guide`.

Cost of being wrong: a tour offers itself a second time on a new browser. That
is the whole downside, and it does not justify a table.

**Later, if wanted:** move to a `user_preferences` row on the server so it
follows the person across devices. The store is the only seam; nothing else
changes. That is a migration plus one endpoint, and it is not needed to ship.

---

## 11. Copy

PRD §6.6 governs, without exception: plain, active, sentence case. No
exclamation marks, no emojis, no apologising interface. CLAUDE.md §3 rule 2
forbids emojis everywhere including seed data, and changelog entries are seed
data in every sense that matters.

Concretely, for the tour:

- Say what the control does, not that it exists. "Press Alt+G anywhere and type
  the first few letters of a screen" — not "This is the Go To button."
- Two sentences maximum per step. A third sentence means the step should be two
  steps or the UI needs a better label.
- Never "simply", "just", "easy", or "don't worry".
- The button says `Next`, not `Next →`. Icons come from the icon set, not from
  characters.

---

## 12. Files, and everything this touches

**New — 11 files, entirely additive:**

```
apps/web/src/features/guide/
  guide-overlay.tsx        The scrim, cutout, bubble, and the run loop
  guide-bubble.tsx         Popover above 768px, Sheet below
  guide-invitation.tsx     The first-sign-in offer
  tour-steps.ts            MAIN_TOUR, MINI_TOURS, REGISTRY_VERSION
  use-guide-run.ts         Navigate, wait for anchor, measure, advance
  guide.test.ts            Every anchor resolves to exactly one element
  index.ts

apps/web/src/features/updates/
  updates-page.tsx
  changelog.ts
  index.ts

apps/web/src/components/shared/anchored-popover.tsx
apps/web/src/lib/guide-store.ts
```

**Modified — 4 files, 6 lines of logic between them:**

| File | Change |
|---|---|
| `App.tsx` | One `<Route path="updates">`; wrap `<Outlet>` region with `<GuideProvider>` |
| `app/layout/app-shell.tsx` | Mount `<GuideOverlay />` beside `<GoToPalette />`; add two rows to the account menu (Updates, Take the tour) and the unread dot |
| `lib/nav.ts` | One line: `'/updates': 'Updates'` in `OFF_NAV_LABELS` |
| `app/shortcut-dialog.tsx` | A "Take the tour" button in the footer |

**Annotated — attribute only, no logic:** roughly 22 elements across
`app-sidebar`, `app-shell`, `mobile-bottom-nav`, and one control on each of
Punch, My attendance, My leave, Team attendance, Approvals, Reports, Downloads,
Employees, Shifts, Leave types, Holidays, Settings, Roles, Period lock, Audit.

**Not touched at all:**

- `apps/api` — no controller, service, repository, route or migration
- `packages/shared` — no contract change
- Every domain service, every query, every permission definition
- Any existing component's props, styling, layout or behaviour

**Dependencies added: none.** Base UI, zustand, react-router, the shadcn
primitives and the Phosphor icon set already cover all of it.

---

## 13. Does this impact current development?

**Short answer: no, with one qualification worth naming.**

What makes it safe:

- No migration, no schema change, no API. The whole feature is client-side.
- No shared contract changes, so nothing in `apps/api` recompiles differently.
- The four modified files take additive edits — a route, a mount, a map entry,
  a button. No existing code path changes behaviour.
- The overlay renders `null` unless a run is active, so the shipped cost when
  nobody is taking the tour is one mounted component doing nothing.
- Work can be interleaved. Nothing in flight — the employee import in
  `apps/api/src/platform/people/` — shares a file with any of this.

**The qualification, stated plainly:** the `data-guide` attributes are a
coupling between the registry and the JSX of 22 screens. It is a weak coupling —
an attribute, not a structure — but it is real, and it is the one thing here
that will decay if left unattended. A screen refactored six months from now
drops an attribute and the step disappears with no error in production. The
registry test in §7 is what converts that from a slow rot into a red CI run,
and it is not optional. If the test is skipped, do not build this.

**Sequencing recommendation:** the tour describes screens, so it is worth
writing when the screens have stopped moving. Phase 5 (polish and hardening) is
its natural home. The attributes are the exception — those are free to add
opportunistically as each screen is touched, well before the Guide exists,
because an unused data attribute costs nothing.

Updates has no such dependency and could ship on its own at any point. It is
also the half that pays off immediately, because it is the only place a release
currently gets explained to anybody.

---

## 14. Open questions

Mirrored into `OPEN-QUESTIONS.md`. Each states the default in use if it is
built before an answer arrives.

| # | Question | Default |
|---|---|---|
| G-1 | Auto-start on first sign-in, or offer and wait? | **Offer.** A shop-floor punch user should not have their first sign-in taken over. |
| G-2 | One permission-filtered tour, or a distinct tour per role? | **One registry, permission-filtered.** It cannot disagree with the sidebar, and a new role needs no new tour. |
| G-3 | Seen-state per device or per user? | **Per device (`localStorage`).** Server-side is one endpoint away if wanted. |
| G-4 | Is `/updates` as an off-sidebar route acceptable against PRD §6.1? | **Yes, same treatment as `/profile`.** Says so here rather than editing the PRD unasked. |
| G-5 | Does a release note ever need to interrupt (a breaking change, a policy change)? | **No interruption of any kind.** If a "must read" tier is wanted, that is a different design and should be said now. |
| G-6 | Which phase? It is in no phase of `03-scope-and-delivery-plan.md`. | **Phase 5**, with anchors added opportunistically from now. |
| G-7 | Who writes the changelog copy? | **Whoever closes the phase**, from the REQ IDs already in the commit messages. |

---

## 15. Definition of done

Beyond CLAUDE.md §4, which applies unchanged:

- [ ] `guide.test.ts` resolves every anchor in every registry to exactly one
      element, and fails when an attribute is removed
- [ ] Verified at 360px: the bubble is a Sheet, the highlight is visible above
      it, footer targets are 44px
- [ ] Verified with `prefers-reduced-motion: reduce`: no scroll animation, no
      bubble transition
- [ ] Verified under three permission sets — punch-only, manager, admin — that
      no step points at a control the session cannot see
- [ ] Verified that the highlighted control is genuinely clickable mid-run, and
      that `Esc` always exits
- [ ] Verified a mini-tour launched from an Updates row navigates, runs, and
      returns
- [ ] Zero new dependencies in `apps/web/package.json`
- [ ] Zero changes under `apps/api` and `packages/shared`
