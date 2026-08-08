import * as React from "react"
import { toast } from "sonner"
import { AlertTriangle, Info } from "lucide-react"
import type { OperationsModule, OperationsSettings } from "@attendance/shared"

import { ApiError } from "@/lib/api"
import { useOperationsSettings, useSaveOperationsSettings } from "@/lib/queries"
import { useSession } from "@/lib/session"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

/**
 * One screen per commercial module, built from a description of the fields
 * rather than five hand-written forms.
 *
 * Every control says what turning it *off* costs. A switch labelled only
 * "Block negative stock" tells somebody nothing about whether to touch it; the
 * consequence is the thing they are actually deciding about.
 */

type FieldSpec =
  | { kind: "switch"; key: string; label: string; description: string }
  | {
      kind: "number"
      key: string
      label: string
      description: string
      unit: string
      step?: number
      /** Stored in paise, edited in rupees. Nobody types paise. */
      money?: boolean
    }
  | { kind: "list"; key: string; label: string; description: string; placeholder: string }

interface ModuleSpec {
  title: string
  blurb: string
  fields: FieldSpec[]
  /** Nested one level down, e.g. credit.defaultTerms. */
  group?: string
}

const MODULES: Record<OperationsModule, ModuleSpec[]> = {
  procurement: [
    {
      title: "Approvals",
      blurb: "When a purchase needs a second pair of eyes.",
      fields: [
        {
          kind: "number",
          key: "poApprovalThresholdPaise",
          label: "Approval needed above",
          description: "Orders at or under this go straight through. Zero means every order is approved.",
          unit: "₹",
          money: true,
          step: 1000,
        },
        {
          kind: "number",
          key: "defaultVendorTermsDays",
          label: "Default vendor payment terms",
          description: "Applied to a new vendor until somebody sets their own.",
          unit: "days",
        },
      ],
    },
    {
      title: "Receiving and billing",
      blurb: "What the store may accept, and what accounts may pay.",
      fields: [
        {
          kind: "switch",
          key: "blockOverReceipt",
          label: "Refuse a receipt larger than the order",
          description:
            "Off: the store can book in more than was ordered, and the extra is paid for without anybody agreeing to it.",
        },
        {
          kind: "number",
          key: "receiptTolerancePct",
          label: "Over-receipt tolerance",
          description: "Bulk materials arrive a little over; bolts do not. Zero means exactly what was ordered.",
          unit: "%",
        },
        {
          kind: "switch",
          key: "requireThreeWayMatch",
          label: "Bill must match the order and the receipt",
          description:
            "Off: a bill can be paid for goods nobody ordered or nobody received. This is the single control that catches duplicate and inflated invoices.",
        },
        {
          kind: "number",
          key: "billTolerancePaise",
          label: "Allowed difference on a match",
          description: "Rounding on freight and taxes, not a licence to overbill.",
          unit: "₹",
          money: true,
        },
      ],
    },
  ],
  sales: [
    {
      title: "Quoting and pricing",
      blurb: "What a salesperson may promise without asking.",
      fields: [
        {
          kind: "number",
          key: "estimateValidityDays",
          label: "Estimate valid for",
          description: "After this an estimate reads as expired. Prices move; a six-month-old quote is a liability.",
          unit: "days",
        },
        {
          kind: "number",
          key: "maxDiscountPct",
          label: "Discount without approval",
          description: "Above this a manager has to agree. Set to 100 and goods can be given away.",
          unit: "%",
        },
        {
          kind: "switch",
          key: "blockBelowCost",
          label: "Refuse a price below cost",
          description: "Off: an order can be taken at a loss and nobody finds out until the month closes.",
        },
      ],
    },
    {
      title: "Documents",
      blurb: "What must be on an order, and how totals are struck.",
      fields: [
        {
          kind: "switch",
          key: "requireCustomerRef",
          label: "Customer's own order reference is required",
          description:
            "On: nothing is accepted without their PO number. Useful when customers refuse invoices that do not carry it.",
        },
        {
          kind: "number",
          key: "defaultGstRatePct",
          label: "Default GST rate",
          description: "Applied to a new item until its own rate is set.",
          unit: "%",
        },
        {
          kind: "switch",
          key: "roundInvoiceTotals",
          label: "Round invoice totals to the rupee",
          description: "As most Indian books do. Off leaves paise on the document.",
        },
      ],
    },
  ],
  inventory: [
    {
      title: "Stock discipline",
      blurb: "What the system refuses to let stock do.",
      fields: [
        {
          kind: "switch",
          key: "blockNegativeStock",
          label: "Refuse an issue that would go below zero",
          description:
            "Off: the book shows stock that is not on the rack, and every valuation built on it is wrong.",
        },
        {
          kind: "switch",
          key: "reserveOnSalesOrder",
          label: "Reserve stock against open orders",
          description: "Off: the same carton can be promised to two customers.",
        },
        {
          kind: "switch",
          key: "requireAdjustmentReason",
          label: "Every manual adjustment states a reason",
          description:
            "Off: stock can be written up or down with no trail, which is where shrinkage hides.",
        },
        {
          kind: "switch",
          key: "lowStockWarnings",
          label: "Warn below the reorder level",
          description: "Shown on the stock screen and when an order is taken.",
        },
        {
          kind: "number",
          key: "stockCountIntervalDays",
          label: "Physical count due every",
          description: "After this a location is flagged as uncounted.",
          unit: "days",
        },
      ],
    },
  ],
  dispatch: [
    {
      title: "Before it leaves",
      blurb: "The steps between an order and a lorry.",
      fields: [
        {
          kind: "switch",
          key: "requirePickList",
          label: "Nothing leaves that was not picked",
          description:
            "Off: goods go out with no record of who took them off the rack, and a shortage has nobody to ask.",
        },
        {
          kind: "switch",
          key: "requirePacking",
          label: "Nothing leaves that was not packed and counted",
          description: "The seal on the carton is the last moment anybody counts.",
        },
      ],
    },
    {
      title: "The lorry receipt",
      blurb:
        "An LR is issued in three parts and each goes somewhere else. Filing it as one scan is how the consignee copy goes missing and a claim fails months later.",
      fields: [
        {
          kind: "switch",
          key: "requireLrNumber",
          label: "LR number required on a hired lorry",
          description:
            "Off: goods leave with nothing to reference in a claim against the transporter. Own vehicles are exempt either way.",
        },
        {
          kind: "switch",
          key: "requireAllLrCopies",
          label: "All three copies on file before closing",
          description: "Consignor, consignee and transporter, scanned separately.",
        },
        {
          kind: "number",
          key: "podGraceDays",
          label: "Chase a missing delivery proof after",
          description:
            "An unacknowledged delivery becomes an unrecoverable claim: after a few weeks the transporter is not liable and the customer does not remember.",
          unit: "days",
        },
        {
          kind: "number",
          key: "ewayBillThresholdPaise",
          label: "E-way bill needed above",
          description: "Consignment value at which the number becomes mandatory.",
          unit: "₹",
          money: true,
          step: 1000,
        },
      ],
    },
    {
      title: "Who carries it",
      blurb: "Filled in once so nobody retypes a transporter's name into three spellings.",
      fields: [
        {
          kind: "list",
          key: "ownVehicleNumbers",
          label: "Our own vehicles",
          description: "One per line. Dispatches on these need no LR.",
          placeholder: "MH-12-AB-1234",
        },
        {
          kind: "list",
          key: "transporters",
          label: "Transporters we use",
          description: "One per line. Offered as choices when recording a dispatch.",
          placeholder: "VRL Logistics",
        },
      ],
    },
  ],
  credit: [
    {
      title: "Default customer terms",
      blurb: "What a new customer gets until somebody sets their own.",
      group: "defaultTerms",
      fields: [
        {
          kind: "number",
          key: "creditDays",
          label: "Credit period",
          description: "Days from invoice to due date. Zero means payment on delivery.",
          unit: "days",
        },
        {
          kind: "number",
          key: "creditLimitPaise",
          label: "Credit limit",
          description: "Ceiling on everything unpaid. Zero means no limit is enforced.",
          unit: "₹",
          money: true,
          step: 1000,
        },
        {
          kind: "number",
          key: "overdueGraceDays",
          label: "Grace before orders are held",
          description:
            "Kept apart from the credit period so a customer can be a day late without the counter stopping.",
          unit: "days",
        },
        {
          kind: "switch",
          key: "allowOverride",
          label: "A manager may release a held order",
          description:
            "Off: a held order can only be freed by changing the customer's terms, which is a bigger change than the situation usually deserves.",
        },
      ],
    },
    {
      title: "Chasing",
      blurb: "Nothing here sends anything — it decides who appears on the list.",
      fields: [
        {
          kind: "switch",
          key: "holdOrdersOnBreach",
          label: "Hold orders when the rules are breached",
          description: "Off: the overdue list is advice. On: it is a gate at the counter.",
        },
        {
          kind: "number",
          key: "chaseMinimumPaise",
          label: "Ignore overdue amounts under",
          description: "Chasing ₹40 costs more than ₹40.",
          unit: "₹",
          money: true,
        },
      ],
    },
  ],
}

const rupees = (paise: number) => Math.round(paise / 100)

function ModuleFields({
  module,
  spec,
  values,
  onChange,
  disabled,
}: {
  module: OperationsModule
  spec: ModuleSpec
  values: Record<string, unknown>
  onChange: (key: string, value: unknown, group?: string) => void
  disabled: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{spec.title}</CardTitle>
        <CardDescription>{spec.blurb}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {spec.fields.map((field) => {
            const id = `${module}-${spec.group ?? "root"}-${field.key}`
            const raw = values[field.key]

            if (field.kind === "switch")
              return (
                <Field key={field.key} orientation="horizontal">
                  <Switch
                    id={id}
                    disabled={disabled}
                    checked={Boolean(raw)}
                    onCheckedChange={(checked) => onChange(field.key, checked, spec.group)}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
                    <FieldDescription>{field.description}</FieldDescription>
                  </FieldContent>
                </Field>
              )

            if (field.kind === "list")
              return (
                <Field key={field.key}>
                  <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
                  <Textarea
                    id={id}
                    rows={3}
                    disabled={disabled}
                    placeholder={field.placeholder}
                    value={(Array.isArray(raw) ? raw : []).join("\n")}
                    onChange={(event) =>
                      onChange(
                        field.key,
                        event.target.value
                          .split("\n")
                          .map((line) => line.trim())
                          .filter((line) => line.length > 0),
                        spec.group
                      )
                    }
                  />
                  <FieldDescription>{field.description}</FieldDescription>
                </Field>
              )

            const shown = field.money ? rupees(Number(raw ?? 0)) : Number(raw ?? 0)
            return (
              <Field key={field.key}>
                <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
                <InputGroup>
                  {field.unit === "₹" ? <InputGroupAddon>₹</InputGroupAddon> : null}
                  <InputGroupInput
                    id={id}
                    type="number"
                    step={field.step ?? 1}
                    disabled={disabled}
                    value={shown}
                    onChange={(event) => {
                      const next = Number(event.target.value)
                      if (!Number.isFinite(next)) return
                      onChange(field.key, field.money ? Math.round(next * 100) : next, spec.group)
                    }}
                  />
                  {field.unit !== "₹" ? (
                    <InputGroupAddon align="inline-end">{field.unit}</InputGroupAddon>
                  ) : null}
                </InputGroup>
                <FieldDescription>{field.description}</FieldDescription>
              </Field>
            )
          })}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

export function OperationsSettingsPanel({ module }: { module: OperationsModule }) {
  const { operations, warnings, isLoading, enabled } = useOperationsSettings()
  const save = useSaveOperationsSettings()
  const { scopeFor } = useSession()
  const canWrite = ["ALL", "OWN_BRANCH"].includes(scopeFor("config.manage"))

  /**
   * The draft is local until Save. Saving on every keystroke would fire a write
   * per digit typed into a credit limit, and each one is audited.
   */
  const [draft, setDraft] = React.useState<Record<string, unknown> | null>(null)
  const stored = operations[module] as unknown as Record<string, unknown>
  const current = draft ?? stored
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(stored)

  /**
   * Cleared when the reader moves to another module — and only then.
   *
   * Watching the stored value here instead meant that any background refetch
   * (React Query refetches on window focus) replaced the settings object,
   * changed its identity, and silently threw away everything the user had
   * typed. It looked like the Save button disabling itself for no reason.
   */
  React.useEffect(() => setDraft(null), [module])

  const change = (key: string, value: unknown, group?: string) => {
    setDraft((previous) => {
      const base = previous ?? structuredClone(stored)
      if (!group) return { ...base, [key]: value }
      const nested = { ...((base[group] as Record<string, unknown>) ?? {}), [key]: value }
      return { ...base, [group]: nested }
    })
  }

  const commit = () => {
    if (!draft) return
    save.mutate({ [module]: draft } as Partial<OperationsSettings>, {
      onSuccess: (payload) => {
        setDraft(null)
        const fresh = payload.warnings.filter((warning) => !warnings.includes(warning))
        toast.success("Saved", {
          description: fresh.length > 0 ? fresh[0] : undefined,
        })
      },
      onError: (error) =>
        toast.error(
          error instanceof ApiError ? "The server refused those values." : "Could not save."
        ),
    })
  }

  if (!enabled)
    return (
      <Alert>
        <Info />
        <AlertTitle>These rules need a live server</AlertTitle>
        <AlertDescription>
          You are signed in to the demo data, so nothing saved here would stick.
        </AlertDescription>
      </Alert>
    )

  if (isLoading)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )

  return (
    <div className="flex flex-col gap-4">
      {warnings.length > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>
            {warnings.length === 1 ? "One rule contradicts another" : "Some rules contradict each other"}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {MODULES[module].map((spec) => (
        <ModuleFields
          key={spec.title}
          module={module}
          spec={spec}
          values={
            spec.group ? ((current[spec.group] as Record<string, unknown>) ?? {}) : current
          }
          onChange={change}
          disabled={!canWrite || save.isPending}
        />
      ))}

      {canWrite ? (
        /**
         * Pinned rather than at the end of a long form: on a phone the Save
         * button would otherwise sit below four cards of switches, and a
         * change made at the top is easy to walk away from.
         */
        <div className="bg-background/80 sticky bottom-0 -mx-1 flex items-center justify-end gap-3 border-t px-1 py-3 backdrop-blur">
          {dirty ? (
            <span className="text-muted-foreground mr-auto text-sm">Not saved yet.</span>
          ) : null}
          <Button variant="ghost" disabled={!dirty || save.isPending} onClick={() => setDraft(null)}>
            Discard
          </Button>
          <Button disabled={!dirty || save.isPending} onClick={commit}>
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      ) : (
        <Alert>
          <Info />
          <AlertTitle>You can see these rules but not change them</AlertTitle>
          <AlertDescription>Changing them needs permission to manage configuration.</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
