import * as React from "react"
import { useNavigate } from "react-router"
import { format } from "date-fns"
import { toast } from "sonner"
import {
  CalendarIcon,
  Check,
  ChevronsUpDown,
  Plus,
  SendHorizontal,
  Trash2,
} from "lucide-react"
import {
  formatPaise,
  lineAmounts,
  paiseToRupees,
  poTotals,
  rupeesToPaise,
  type PoLine,
} from "@attendance/shared"

import { cn } from "@/lib/utils"
import { defaultDueDate, todayISO, useProcurement, type PoDraftLine } from "@/lib/procurement"
import { useSession } from "@/lib/session"
import { Page, PageBody, PageHeader } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"

const fromISO = (iso: string) => new Date(`${iso}T00:00:00`)

function DateButton({
  id,
  value,
  onChange,
  size,
}: {
  id?: string
  value: string
  onChange: (iso: string) => void
  size?: "sm" | "default"
}) {
  const [open, setOpen] = React.useState(false)
  return (
    // date-picker is popover + calendar — there is no registry component.
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} variant="outline" size={size} className="justify-start font-normal">
          <CalendarIcon />
          {format(fromISO(value), "d MMM yyyy")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={fromISO(value)}
          defaultMonth={fromISO(value)}
          onSelect={(date) => {
            if (date) onChange(format(date, "yyyy-MM-dd"))
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

interface BuilderLine extends PoDraftLine {
  key: number
}

export function PurchaseOrderNewPage() {
  const { vendors, items, createPo, submitPo } = useProcurement()
  const { user } = useSession()
  const navigate = useNavigate()

  const activeVendors = vendors.filter((vendor) => vendor.active)
  const activeItems = items.filter((item) => item.active)

  const [vendorId, setVendorId] = React.useState("")
  const [orderDate, setOrderDate] = React.useState(todayISO())
  const [terms, setTerms] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [lines, setLines] = React.useState<BuilderLine[]>([])
  const nextKey = React.useRef(1)

  const vendor = vendors.find((candidate) => candidate.id === vendorId)

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        key: nextKey.current++,
        itemId: "",
        qty: 1,
        unitPricePaise: 0,
        discountPct: 0,
        schedules: [{ dueDate: defaultDueDate(orderDate, vendor), qty: 1 }],
      },
    ])
  }

  const patchLine = (key: number, patch: Partial<BuilderLine>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)))

  const asPoLine = (line: BuilderLine): PoLine => ({
    id: String(line.key),
    itemId: line.itemId,
    qty: line.qty,
    unitPricePaise: line.unitPricePaise,
    gstRatePct: items.find((item) => item.id === line.itemId)?.gstRatePct ?? 18,
    discountPct: line.discountPct,
  })

  const totals = poTotals(lines.filter((line) => line.itemId && line.qty > 0).map(asPoLine))

  const validate = (): string | null => {
    if (!vendorId) return "Pick a vendor."
    if (lines.length === 0) return "Add at least one line."
    for (const [index, line] of lines.entries()) {
      if (!line.itemId) return `Line ${index + 1}: pick an item.`
      if (line.qty <= 0) return `Line ${index + 1}: quantity must be positive.`
      const scheduled = line.schedules.reduce((sum, tranche) => sum + tranche.qty, 0)
      if (line.schedules.length > 0 && Math.abs(scheduled - line.qty) > 1e-9) {
        return `Line ${index + 1}: schedule adds up to ${scheduled}, but the line orders ${line.qty}.`
      }
    }
    return null
  }

  const save = (submit: boolean) => {
    const problem = validate()
    if (problem) {
      toast.error(problem)
      return
    }
    const po = createPo(
      { vendorId, orderDate, terms, notes, lines },
      user?.email ?? "unknown"
    )
    if (submit) submitPo(po.id)
    toast.success(`${po.number} ${submit ? "submitted for approval" : "saved as draft"}`)
    navigate(`/purchase-orders/${po.id}`)
  }

  return (
    <Page>
      <PageHeader
        title="New Purchase Order"
        description={vendor ? `${vendor.name} · Net ${vendor.paymentTermsDays}` : "Pick a vendor to begin"}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => save(false)}>
              Save draft
            </Button>
            <Button size="sm" onClick={() => save(true)}>
              <SendHorizontal />
              Submit for approval
            </Button>
          </>
        }
      />
      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle>Order</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field>
              <FieldLabel htmlFor="po-vendor">Vendor</FieldLabel>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger id="po-vendor">
                  <SelectValue placeholder="Select vendor" />
                </SelectTrigger>
                <SelectContent>
                  {activeVendors.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="po-date">Order date</FieldLabel>
              <DateButton id="po-date" value={orderDate} onChange={setOrderDate} />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="po-terms">Terms (printed on the PO)</FieldLabel>
              <Input
                id="po-terms"
                value={terms}
                onChange={(event) => setTerms(event.target.value)}
                placeholder="Delivery at Mumbai HO stores. Freight included."
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Lines &amp; delivery schedule</CardTitle>
            <Button variant="outline" size="sm" onClick={addLine}>
              <Plus />
              Add line
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {lines.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No lines yet. Each line can be split into delivery tranches with their own due
                dates — that is what overdue tracking and vendor on-time analytics key on.
              </p>
            ) : null}
            {lines.map((line, index) => {
              const item = items.find((candidate) => candidate.id === line.itemId)
              const amounts = line.itemId ? lineAmounts(asPoLine(line)) : null
              const scheduled = line.schedules.reduce((sum, tranche) => sum + tranche.qty, 0)
              return (
                <div key={line.key} className="rounded-md border p-3">
                  <div className="grid gap-3 md:grid-cols-[1fr_repeat(4,minmax(5rem,8rem))_auto]">
                    <Field>
                      <FieldLabel htmlFor={`line-item-${line.key}`}>Item</FieldLabel>
                      <ItemCombobox
                        id={`line-item-${line.key}`}
                        items={activeItems}
                        value={line.itemId}
                        onChange={(itemId) => {
                          const picked = items.find((candidate) => candidate.id === itemId)
                          patchLine(line.key, {
                            itemId,
                            unitPricePaise: picked?.lastPricePaise ?? 0,
                          })
                        }}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`line-qty-${line.key}`}>
                        Qty{item ? ` (${item.unit})` : ""}
                      </FieldLabel>
                      <Input
                        id={`line-qty-${line.key}`}
                        type="number"
                        min={0}
                        step="any"
                        value={line.qty}
                        onChange={(event) => {
                          const qty = Number(event.target.value)
                          patchLine(line.key, {
                            qty,
                            // A single-tranche schedule follows the line qty.
                            schedules:
                              line.schedules.length === 1
                                ? [{ ...line.schedules[0], qty }]
                                : line.schedules,
                          })
                        }}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`line-rate-${line.key}`}>Rate (₹)</FieldLabel>
                      <Input
                        id={`line-rate-${line.key}`}
                        type="number"
                        min={0}
                        step="0.01"
                        value={paiseToRupees(line.unitPricePaise)}
                        onChange={(event) =>
                          patchLine(line.key, {
                            unitPricePaise: rupeesToPaise(Number(event.target.value)),
                          })
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`line-disc-${line.key}`}>Disc %</FieldLabel>
                      <Input
                        id={`line-disc-${line.key}`}
                        type="number"
                        min={0}
                        max={100}
                        step="0.5"
                        value={line.discountPct}
                        onChange={(event) =>
                          patchLine(line.key, { discountPct: Number(event.target.value) })
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel>GST · Amount</FieldLabel>
                      <div className="flex h-9 items-center text-sm tabular-nums">
                        {item ? `${item.gstRatePct}%` : "—"}
                        <Separator orientation="vertical" className="mx-2" />
                        {amounts ? formatPaise(amounts.totalPaise) : "—"}
                      </div>
                    </Field>
                    <div className="flex items-end pb-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove line ${index + 1}`}
                        onClick={() =>
                          setLines((prev) => prev.filter((candidate) => candidate.key !== line.key))
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-end gap-3 border-t pt-3">
                    <span className="text-muted-foreground text-xs font-medium">
                      Delivery schedule
                    </span>
                    {line.schedules.map((tranche, trancheIndex) => (
                      <div key={trancheIndex} className="flex items-end gap-1.5">
                        <DateButton
                          size="sm"
                          value={tranche.dueDate}
                          onChange={(dueDate) =>
                            patchLine(line.key, {
                              schedules: line.schedules.map((candidate, candidateIndex) =>
                                candidateIndex === trancheIndex
                                  ? { ...candidate, dueDate }
                                  : candidate
                              ),
                            })
                          }
                        />
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          aria-label={`Tranche ${trancheIndex + 1} quantity`}
                          className="h-8 w-20"
                          value={tranche.qty}
                          onChange={(event) =>
                            patchLine(line.key, {
                              schedules: line.schedules.map((candidate, candidateIndex) =>
                                candidateIndex === trancheIndex
                                  ? { ...candidate, qty: Number(event.target.value) }
                                  : candidate
                              ),
                            })
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove tranche ${trancheIndex + 1}`}
                          onClick={() =>
                            patchLine(line.key, {
                              schedules: line.schedules.filter(
                                (_candidate, candidateIndex) => candidateIndex !== trancheIndex
                              ),
                            })
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        patchLine(line.key, {
                          schedules: [
                            ...line.schedules,
                            {
                              dueDate: defaultDueDate(orderDate, vendor),
                              qty: Math.max(line.qty - scheduled, 0),
                            },
                          ],
                        })
                      }
                    >
                      <Plus />
                      Tranche
                    </Button>
                    {line.schedules.length > 0 && Math.abs(scheduled - line.qty) > 1e-9 ? (
                      <span className="text-destructive text-xs">
                        Tranches add up to {scheduled}, line orders {line.qty}.
                      </span>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Notes (internal)</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Not printed on the PO document."
                rows={4}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Totals</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 text-sm">
              <TotalRow label="Subtotal" value={totals.subtotalPaise} />
              {totals.discountPaise > 0 ? (
                <TotalRow label="Discount" value={-totals.discountPaise} />
              ) : null}
              {totals.taxBreakup.map((bucket) => (
                <TotalRow
                  key={bucket.ratePct}
                  label={`GST ${bucket.ratePct}% on ${formatPaise(bucket.taxablePaise)}`}
                  value={bucket.taxPaise}
                />
              ))}
              <Separator className="my-1" />
              <div className="flex items-center justify-between text-base font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatPaise(totals.totalPaise)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </Page>
  )
}

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{formatPaise(value)}</span>
    </div>
  )
}

function ItemCombobox({
  id,
  items,
  value,
  onChange,
}: {
  id: string
  items: Array<{ id: string; code: string; name: string; unit: string }>
  value: string
  onChange: (itemId: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const selected = items.find((item) => item.id === value)
  return (
    // combobox is popover + command — there is no registry component.
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="justify-between font-normal"
        >
          {selected ? selected.name : "Select item…"}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search item or code…" />
          <CommandList>
            <CommandEmpty>No item found.</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.code} ${item.name}`}
                  onSelect={() => {
                    onChange(item.id)
                    setOpen(false)
                  }}
                >
                  <div className="flex flex-col">
                    <span>{item.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {item.code} · {item.unit}
                    </span>
                  </div>
                  <Check className={cn("ml-auto", value === item.id ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
