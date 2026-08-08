import { FileCode2 } from "lucide-react"

import { useAppConfig } from "@/lib/app-config"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"

/**
 * Tally is the accounting side's system of record, so this screen only names
 * things that already exist there — we never create masters. The preview shows
 * the exact voucher shape a run will produce, because a wrong ledger name is
 * the failure everyone hits and it is invisible until import time.
 */
export function TallySettings() {
  const { settings, setSetting: set, branding } = useAppConfig()
  const company = settings.tallyCompanyName || branding.companyName

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <FileCode2 />
        <AlertTitle>Names must match Tally exactly</AlertTitle>
        <AlertDescription>
          Spelling, spacing, ampersands and case all count. Create the ledgers in Tally first —
          Settings → Guide → Tally integration walks through it — then copy the names here.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Ledger mapping</CardTitle>
          <CardDescription>
            Where a released payroll run posts: the expense side is debited by the month's total
            gross, the payable side credited.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="tally-company">Tally company name</FieldLabel>
              <Input
                id="tally-company"
                value={settings.tallyCompanyName}
                placeholder={branding.companyName}
                onChange={(event) => set("tallyCompanyName", event.target.value)}
              />
              <FieldDescription>
                Leave blank to use the branding name ({branding.companyName}). This company must be
                open in Tally when you import.
              </FieldDescription>
            </Field>
            <FieldGroup className="sm:grid sm:grid-cols-2 sm:gap-4">
              <Field>
                <FieldLabel htmlFor="tally-expense">Salary expense ledger</FieldLabel>
                <Input
                  id="tally-expense"
                  value={settings.tallySalaryExpenseLedger}
                  onChange={(event) => set("tallySalaryExpenseLedger", event.target.value)}
                />
                <FieldDescription>Under Indirect Expenses. Debited.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="tally-payable">Salary payable ledger</FieldLabel>
                <Input
                  id="tally-payable"
                  value={settings.tallySalaryPayableLedger}
                  disabled={settings.tallyPerEmployeeLedgers}
                  onChange={(event) => set("tallySalaryPayableLedger", event.target.value)}
                />
                <FieldDescription>
                  Under Current Liabilities. Credited — unless per-employee ledgers are on.
                </FieldDescription>
              </Field>
            </FieldGroup>
            <Field orientation="horizontal">
              <Switch
                id="tally-per-employee"
                checked={settings.tallyPerEmployeeLedgers}
                onCheckedChange={(checked) => set("tallyPerEmployeeLedgers", checked)}
              />
              <FieldContent>
                <FieldLabel htmlFor="tally-per-employee">One payable ledger per employee</FieldLabel>
                <FieldDescription>
                  Credits each employee's own ledger, named “Name (CODE)”, instead of a single
                  control account. Those ledgers must already exist under Sundry Creditors.
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What a run will post</CardTitle>
          <CardDescription>
            One Journal voucher dated the month's last day. The export is refused if the two sides
            do not balance.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
            <span className="text-muted-foreground w-14 shrink-0 font-mono text-xs">Company</span>
            <span className="font-medium">{company || "— set a name —"}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
            <span className="text-muted-foreground w-14 shrink-0 font-mono text-xs">Dr</span>
            <span className="font-medium">{settings.tallySalaryExpenseLedger}</span>
            <span className="text-muted-foreground">total gross for the month</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
            <span className="text-muted-foreground w-14 shrink-0 font-mono text-xs">Cr</span>
            <span className="font-medium">
              {settings.tallyPerEmployeeLedgers
                ? "each employee's ledger — “Name (CODE)”"
                : settings.tallySalaryPayableLedger}
            </span>
            <span className="text-muted-foreground">
              {settings.tallyPerEmployeeLedgers ? "their own gross" : "same total"}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
