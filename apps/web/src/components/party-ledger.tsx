import * as React from "react"
import { toast } from "sonner"
import { IndianRupee, Plus } from "lucide-react"
import {
  AGEING_BUCKETS,
  PAYMENT_MODES,
  ageingBucket,
  formatPaise,
  outstandingPaise,
  rupeesToPaise,
  type PaymentEntry,
} from "@attendance/shared"

import { todayISO } from "@/lib/procurement"
import { Page, PageBody, PageHeader } from "@/components/page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/**
 * Receivables and payables are the same machine pointed in opposite
 * directions: parties with open documents, ageing buckets, and append-only
 * payment entries allocated oldest-due-first. One component, two screens.
 */

export interface LedgerDoc {
  id: string
  number: string
  partyId: string
  dueDate: string
  status: string
  lines: Parameters<typeof outstandingPaise>[0]["lines"]
}

export function PartyLedgerPage({
  title,
  description,
  partyNoun,
  actionLabel,
  parties,
  docs,
  payments,
  canRecord,
  onRecord,
}: {
  title: string
  description: string
  partyNoun: string
  actionLabel: string
  parties: Array<{ id: string; name: string }>
  docs: LedgerDoc[]
  payments: PaymentEntry[]
  canRecord: boolean
  onRecord: (
    input: Omit<PaymentEntry, "id" | "allocations" | "recordedBy">
  ) => PaymentEntry | null
}) {
  const [open, setOpen] = React.useState(false)
  const [partyId, setPartyId] = React.useState("")
  const [amountRupees, setAmountRupees] = React.useState(0)
  const [mode, setMode] = React.useState<(typeof PAYMENT_MODES)[number]>("BANK")
  const [reference, setReference] = React.useState("")
  const today = todayISO()

  const rows = parties
    .map((party) => {
      const own = docs.filter((doc) => doc.partyId === party.id)
      const outstandingDocs = own
        .map((doc) => ({ doc, outstanding: outstandingPaise(doc, payments) }))
        .filter((entry) => entry.outstanding > 0)
      const total = outstandingDocs.reduce((sum, entry) => sum + entry.outstanding, 0)
      const buckets = Object.fromEntries(AGEING_BUCKETS.map((bucket) => [bucket, 0])) as Record<
        string,
        number
      >
      for (const entry of outstandingDocs) {
        buckets[ageingBucket(entry.doc.dueDate, today)] += entry.outstanding
      }
      return { party, total, buckets, docCount: outstandingDocs.length }
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total)

  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0)
  const overdue = rows.reduce(
    (sum, row) => sum + row.total - row.buckets.CURRENT,
    0
  )

  return (
    <Page>
      <PageHeader
        title={title}
        description={description}
        actions={
          canRecord ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus />
              {actionLabel}
            </Button>
          ) : null
        }
      />
      <PageBody>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total outstanding</CardTitle>
              <IndianRupee className="text-muted-foreground size-4" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tracking-tight">{formatPaise(grandTotal)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Past due</CardTitle>
              <IndianRupee className="text-muted-foreground size-4" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tracking-tight">{formatPaise(overdue)}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Ageing by {partyNoun}</CardTitle>
            <CardDescription>Outstanding split by how far past due it is.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing outstanding — all settled.</p>
            ) : (
              rows.map((row) => (
                <div key={row.party.id} className="rounded-md border px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{row.party.name}</span>
                    <span className="text-sm font-semibold tabular-nums">
                      {formatPaise(row.total)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {AGEING_BUCKETS.filter((bucket) => row.buckets[bucket] > 0).map((bucket) => (
                      <Badge
                        key={bucket}
                        variant={
                          bucket === "CURRENT"
                            ? "secondary"
                            : bucket === "1-30"
                              ? "warning"
                              : "destructive"
                        }
                      >
                        {bucket === "CURRENT" ? "Current" : bucket}:{" "}
                        {formatPaise(row.buckets[bucket])}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment history</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {payments.length === 0 ? (
              <p className="text-muted-foreground text-sm">No entries yet.</p>
            ) : (
              [...payments].reverse().map((payment) => (
                <div key={payment.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {parties.find((party) => party.id === payment.partyId)?.name ?? "—"}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {payment.date} · {payment.mode}
                      {payment.reference ? ` · ${payment.reference}` : ""} ·{" "}
                      {payment.allocations.length} doc
                      {payment.allocations.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">
                    {formatPaise(payment.amountPaise)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </PageBody>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{actionLabel}</DialogTitle>
            <DialogDescription>
              Allocated to open documents oldest-due-first, automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="pay-party">{partyNoun}</FieldLabel>
              <Select value={partyId} onValueChange={setPartyId}>
                <SelectTrigger id="pay-party">
                  <SelectValue placeholder={`Select ${partyNoun}`} />
                </SelectTrigger>
                <SelectContent>
                  {parties.map((party) => (
                    <SelectItem key={party.id} value={party.id}>
                      {party.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="pay-amount">Amount (₹)</FieldLabel>
                <Input
                  id="pay-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={amountRupees}
                  onChange={(event) => setAmountRupees(Number(event.target.value))}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="pay-mode">Mode</FieldLabel>
                <Select value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
                  <SelectTrigger id="pay-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_MODES.map((paymentMode) => (
                      <SelectItem key={paymentMode} value={paymentMode}>
                        {paymentMode}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="pay-ref">Reference</FieldLabel>
              <Input
                id="pay-ref"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="UTR / cheque no."
              />
              <FieldDescription>Shown in the history and on the allocation.</FieldDescription>
            </Field>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => {
                if (!partyId || amountRupees <= 0) {
                  toast.error(`Pick a ${partyNoun} and a positive amount.`)
                  return
                }
                const partyOutstanding = rows.find((row) => row.party.id === partyId)?.total ?? 0
                if (rupeesToPaise(amountRupees) > partyOutstanding) {
                  toast.error(
                    `Amount exceeds outstanding (${formatPaise(partyOutstanding)}) — advances land with the accounting wave.`
                  )
                  return
                }
                const saved = onRecord({
                  partyId,
                  date: todayISO(),
                  amountPaise: rupeesToPaise(amountRupees),
                  mode,
                  reference,
                  remarks: "",
                })
                if (saved) {
                  toast.success(
                    `${formatPaise(saved.amountPaise)} allocated across ${saved.allocations.length} document${saved.allocations.length === 1 ? "" : "s"}`
                  )
                  setOpen(false)
                  setPartyId("")
                  setAmountRupees(0)
                  setReference("")
                } else {
                  toast.error(`Nothing outstanding for this ${partyNoun}.`)
                }
              }}
            >
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
