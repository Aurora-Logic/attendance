import { Link } from "react-router"
import { BookOpen } from "lucide-react"

import { useAppConfig } from "@/lib/app-config"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * How-to guide. Written per task rather than per screen, because that is how
 * the question arrives ("how do I make Friday a half day?"), and each entry
 * says what the system will *do* — the rule, not just the clicks.
 */

interface GuideEntry {
  id: string
  title: string
  who: string
  steps: string[]
  /** The consequence — what changes downstream once the task is done. */
  effect?: string
}

const SECTIONS: Array<{ heading: string; entries: GuideEntry[] }> = [
  {
    heading: "Calendar",
    entries: [
      {
        id: "half-day",
        title: "Make any date a half working day",
        who: "Admin",
        steps: [
          "Open Roster.",
          "Click the date number in the grid header — every column header is a button.",
          "Type a name (e.g. “Festival eve”) and choose Half day.",
          "The whole column turns HD immediately and the register recomputes.",
        ],
        effect:
          "A declared half day halves the expectation, not the pay. With an 8-hour full day, anyone working 4 hours or more earns a full 1.0 payable day; below 2 hours it is still absent. Overtime starts after the shortened day. The late-mark rule is unchanged.",
      },
      {
        id: "holiday",
        title: "Declare a holiday",
        who: "Admin",
        steps: [
          "Open Roster and click the date in the grid header.",
          "Name it and choose Holiday.",
          "To undo, click the same date and Remove.",
        ],
        effect:
          "A holiday is paid for everyone with no punches required. Anyone who does punch is routed as a comp-off claim rather than treated as an error.",
      },
    ],
  },
  {
    heading: "People",
    entries: [
      {
        id: "departments",
        title: "Create or close a department",
        who: "Admin · HR",
        steps: [
          "Settings → Departments.",
          "Enter a short unique code (MAINT) and a name (Maintenance), then Add.",
          "Rename with the pencil; close one with the switch.",
        ],
        effect:
          "Closing is a soft state, never a delete: existing employees keep the department and it stays in reports — it just stops being offered on new forms. Codes are unique per company; a duplicate is refused.",
      },
      {
        id: "employee",
        title: "Add an employee",
        who: "Admin · HR",
        steps: [
          "Employees → Add employee.",
          "Code, name, work email, department, branch.",
          "Turn on “Field employee” for anyone who works outside the office.",
        ],
        effect:
          "A field employee is exempt from the geofence check, so their punches away from the branch are not flagged.",
      },
    ],
  },
  {
    heading: "Attendance rules",
    entries: [
      {
        id: "late",
        title: "Change the late policy",
        who: "Admin",
        steps: [
          "Settings → Late & early.",
          "Grace: how many minutes past shift start still count as on time.",
          "Allowance: how many late marks are forgiven each period.",
          "Penalty: what the next late converts the day into.",
          "Read “What this rule does” below the fields before saving — it recomputes live.",
        ],
        effect:
          "One function evaluates this rule everywhere: the punch screen preview, the nightly job and the register all agree by construction.",
      },
      {
        id: "windows",
        title: "Understand windows vs grace",
        who: "Everyone",
        steps: [
          "The window decides whether a punch needs approval.",
          "The grace decides whether the day takes a late mark.",
          "They are separate thresholds: a punch can be outside the window yet inside the grace — flagged for a manager, but no mark against the employee.",
        ],
        effect:
          "A punch outside the window is always recorded and flagged, never rejected. Rejecting turns a present employee into an absent one. The hard block exists as an off-by-default toggle in Settings → Punch windows.",
      },
      {
        id: "roster",
        title: "Change shifts, weekly offs or the rotation",
        who: "Admin",
        steps: [
          "Settings → Roster & shifts.",
          "Shifts: times, codes. An end before the start means the shift crosses midnight.",
          "Weekly-off patterns: fixed days plus which Saturdays are off, then map a pattern to each department.",
          "Rotation: pick the department and the shift cycle.",
        ],
        effect:
          "The roster grid is generated from these rules, never copied from last month, so it regenerates the moment anything here changes.",
      },
    ],
  },
  {
    heading: "Leave & approvals",
    entries: [
      {
        id: "apply",
        title: "Apply for leave",
        who: "Everyone",
        steps: [
          "Leave → Apply for leave.",
          "Pick the type, the dates and (for a single day) full or half.",
          "The panel shows exactly how many days it will cost before you submit.",
        ],
        effect:
          "Weekly offs and holidays inside the range are free unless the sandwich rule is on, in which case a day sitting between two leave days is charged. The cost shown is computed by the same function the server uses.",
      },
      {
        id: "approve",
        title: "Approve or reject",
        who: "Manager · HR · Admin",
        steps: [
          "Approvals shows everything waiting on you.",
          "Tick several and use the bulk buttons, or act on a single row.",
          "A reason is required on bulk decisions.",
        ],
        effect:
          "Managers reach their own reports only. Nobody can decide their own request, whatever their role. Approving leave writes the ledger entry that moves the balance.",
      },
    ],
  },
  {
    heading: "Company",
    entries: [
      {
        id: "branding",
        title: "White-label the app",
        who: "Admin only",
        steps: [
          "Settings → Branding.",
          "Company name, branch label and a logo under 200 KB.",
          "The preview shows the sidebar exactly as it will render.",
        ],
        effect:
          "The name and logo appear on the sidebar, the login screen and printed documents.",
      },
      {
        id: "permissions",
        title: "Change who can do what",
        who: "Admin only",
        steps: [
          "Roles & Permissions.",
          "Each cell is a capability for a role, set to a reach: All, Own branch, Own team, Own only, View, or none.",
          "Save writes it to the server.",
        ],
        effect:
          "The API enforces the same matrix the UI reads, so a hidden menu is also a blocked endpoint. There are no role-name checks anywhere in the code.",
      },
    ],
  },
  {
    heading: "Tally integration",
    entries: [
      {
        id: "tally-setup",
        title: "Set Tally up to receive salary vouchers",
        who: "Admin · your accountant",
        steps: [
          "In Tally Prime, open the company you keep books in and note its name exactly — spelling, spacing and case all matter.",
          "Create the two ledgers if they do not exist: Gateway of Tally → Create → Ledger. One expense ledger under Indirect Expenses (e.g. Salary & Wages), one liability ledger under Current Liabilities (e.g. Salary Payable).",
          "If you want a separate payable ledger per employee, create those under Sundry Creditors named exactly “Name (CODE)” — for example “Kabir Singh (DLT0004)”.",
          "Back here: Settings → Tally. Type the company name and the two ledger names, and choose control ledger or per-employee. Save changes.",
        ],
        effect:
          "The system now knows where the money lands. Nothing is created inside Tally by us — masters stay under your accountant's control.",
      },
      {
        id: "tally-export",
        title: "Post a month's salary to Tally",
        who: "Admin · HR (payroll.manage)",
        steps: [
          "Payroll → lock the month, then run it. A run is immutable; corrections are a new version.",
          "On the run's row press Tally XML. A voucher file downloads.",
          "In Tally Prime: Gateway of Tally → Import → Vouchers, pick the file, and import.",
          "Alternatively, if your Tally has ODBC/HTTP enabled (F1 → Settings → Connectivity, port 9000), the same file can be POSTed straight to http://localhost:9000.",
        ],
        effect:
          "One Journal voucher dated the last day of the month: the expense ledger is debited by the total gross, the payable side credited. The file is refused rather than written if the two sides do not balance, so your books cannot be corrupted by a bad export.",
      },
      {
        id: "tally-troubleshoot",
        title: "When Tally rejects the import",
        who: "Admin",
        steps: [
          "“Ledger does not exist” — the ledger name in Settings differs from Tally, usually by an ampersand, extra space or case. Copy it from Tally exactly.",
          "“Company not found” — the company name in Settings must match the loaded company, and that company must be open in Tally at import time.",
          "Voucher lands in the wrong period — check the run's month; the voucher is always dated the month's last day.",
          "Nothing downloads with a 422 — the month's total was zero, so there is no voucher to write.",
        ],
        effect:
          "Every export is written to the audit log with who exported which run, so a disputed posting can always be traced.",
      },
    ],
  },
]

export function GuideSettings() {
  const { settings } = useAppConfig()

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <BookOpen />
        <AlertTitle>How this system is meant to be driven</AlertTitle>
        <AlertDescription>
          Every rule below is data, not code — change it here and the punch screen, the register
          and the nightly recomputation all follow. Nothing is hardcoded.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your current rules, in a sentence</CardTitle>
          <CardDescription>The live values, so the guide matches your setup</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            A punch is on time up to{" "}
            <Badge variant="secondary">{settings.lateGraceMinutes} min</Badge> past shift start.{" "}
            <Badge variant="secondary">{settings.lateMarksAllowed}</Badge> late marks are forgiven
            each {settings.latePeriod.toLowerCase()}; the next one makes the day{" "}
            <Badge variant="destructive">{settings.latePenalty}</Badge>. A full day is{" "}
            <Badge variant="secondary">{settings.fullDayMinHours}h</Badge> — on a declared half
            working day, <Badge variant="secondary">{settings.fullDayMinHours / 2}h</Badge>.
          </p>
        </CardContent>
      </Card>

      {SECTIONS.map((section) => (
        <Card key={section.heading}>
          <CardHeader>
            <CardTitle className="text-base">{section.heading}</CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible>
              {section.entries.map((entry) => (
                <AccordionItem key={entry.id} value={entry.id}>
                  <AccordionTrigger>
                    <span className="flex flex-1 items-center gap-2 text-left">
                      {entry.title}
                      <Badge variant="outline" className="ml-auto shrink-0">
                        {entry.who}
                      </Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <ol className="text-muted-foreground flex list-decimal flex-col gap-1.5 pl-4 text-sm">
                      {entry.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                    {entry.effect ? (
                      <p className="bg-muted/50 mt-3 rounded-md px-3 py-2 text-sm">
                        <span className="font-medium">What it does: </span>
                        {entry.effect}
                      </p>
                    ) : null}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      ))}

      <p className="text-muted-foreground text-sm">
        Still stuck? Every screen states which rule produced a number —{" "}
        <Link to="/attendance" className="underline underline-offset-2">
          the register
        </Link>{" "}
        explains each day, and{" "}
        <Link to="/audit" className="underline underline-offset-2">
          the audit log
        </Link>{" "}
        records who changed what.
      </p>
    </div>
  )
}
