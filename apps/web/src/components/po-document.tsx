import * as React from "react"
import { format } from "date-fns"
import { CalendarIcon, CirclePlus, Search, Trash2, X } from "lucide-react"
import {
  formatPaise,
  gstStateCode,
  lineAmounts,
  paiseToRupees,
  poTotals,
  rupeesToPaise,
  splitGst,
  type Item,
  type PoLine,
  type Vendor,
} from "@attendance/shared"

import { cn } from "@/lib/utils"
import { useAppConfig } from "@/lib/app-config"
import { Calendar } from "@/components/ui/calendar"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"

/**
 * Type-on-the-template PO builder, after the OCC estimate design: the page IS
 * the purchase-order document — an A4-style sheet mirroring the print layout
 * (masthead → reference strip → parties → items → totals → terms → signature).
 * Every value is edited inline, right where it prints; pickers and trash
 * buttons are screen-only affordances. `editable={false}` renders the same
 * sheet as pure print — the detail page and window.print() both use it.
 *
 * The sheet is deliberately NOT tokened: it is paper, white in both app
 * themes, set in Helvetica (see the .po-document rule in index.css), exactly
 * what comes out of the printer.
 *
 * GST presentation follows the statute: vendor and company in the same state
 * (GSTIN state codes match) → CGST + SGST at half-rate each; different states
 * → IGST; either GSTIN missing → a plain GST line.
 */

export interface DocLine {
  key: string
  itemId: string
  qty: number
  unitPricePaise: number
  discountPct: number
  schedules: { dueDate: string; qty: number }[]
}

export interface PoDocumentProps {
  number: string
  orderDate: string
  statusLabel: string
  vendor: Vendor | null
  lines: DocLine[]
  terms: string
  items: Item[]
  editable?: boolean
  vendors?: Vendor[]
  onPickVendor?: (vendorId: string) => void
  onClearVendor?: () => void
  onOrderDate?: (iso: string) => void
  onTerms?: (terms: string) => void
  onPatchLine?: (key: string, patch: Partial<DocLine>) => void
  onAddLine?: () => void
  onRemoveLine?: (key: string) => void
}

// Every editable spot reads as a fillable blank: light blue fill + underline,
// dashed while empty, brighter on focus. Static print stays plain white.
const DOC_INPUT =
  "w-full min-w-0 rounded-[3px] border-0 border-b border-neutral-400 bg-sky-50 px-1.5 py-0.5 text-inherit transition-colors placeholder:text-neutral-400 placeholder-shown:border-dashed hover:bg-sky-100/80 focus:border-sky-500 focus:bg-sky-100 focus:outline-none focus:ring-0"
const DOC_NUM =
  "text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"

/** Tiny uppercase field caption, exactly like the PDF's label class. */
function Lbl({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "block text-[9px] font-medium tracking-[0.08em] text-neutral-400 uppercase",
        className
      )}
    >
      {children}
    </span>
  )
}

const selectOnFocus = (event: React.FocusEvent<HTMLInputElement>) => event.currentTarget.select()

/**
 * Print the sheet with a meaningful PDF filename. Browsers name a printed PDF
 * after `document.title`, so it is swapped to "PO-2026-0003 - Vendor - date"
 * for the duration of the print dialog and restored afterwards.
 */
export function printPoDocument(title: string) {
  const previous = document.title
  const restore = () => {
    document.title = previous
    window.removeEventListener("afterprint", restore)
  }
  window.addEventListener("afterprint", restore)
  document.title = title
  window.print()
}

const fromISO = (iso: string) => new Date(`${iso}T00:00:00`)
const printDate = (iso: string) => format(fromISO(iso), "d MMM yyyy")

function DocDate({
  value,
  onChange,
  editable,
}: {
  value: string
  onChange?: (iso: string) => void
  editable: boolean
}) {
  const [open, setOpen] = React.useState(false)
  if (!editable || !onChange) {
    return <p className="text-xs font-bold tabular-nums">{printDate(value)}</p>
  }
  return (
    // date-picker is popover + calendar — there is no registry component.
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(DOC_INPUT, "flex items-center gap-1.5 text-left text-xs font-bold")}
        >
          <CalendarIcon className="size-3.5 text-neutral-400" />
          {printDate(value)}
        </button>
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

/** Compact picker chip — popover + command, the documented combobox shape. */
function PickerChip<T extends { id: string }>({
  options,
  placeholder,
  searchPlaceholder,
  optionLabel,
  optionSublabel,
  onPick,
  className,
}: {
  options: T[]
  placeholder: React.ReactNode
  searchPlaceholder: string
  optionLabel: (option: T) => string
  optionSublabel?: (option: T) => string
  onPick: (option: T) => void
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded border border-blue-300 bg-blue-50 px-2 text-[11px] font-medium text-blue-700 hover:bg-blue-100",
            className
          )}
        >
          {placeholder}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>Nothing found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={`${optionLabel(option)} ${optionSublabel?.(option) ?? ""}`}
                  onSelect={() => {
                    onPick(option)
                    setOpen(false)
                  }}
                >
                  <div className="flex flex-col">
                    <span>{optionLabel(option)}</span>
                    {optionSublabel ? (
                      <span className="text-muted-foreground text-xs">{optionSublabel(option)}</span>
                    ) : null}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function DocScheduleDate({
  value,
  onChange,
}: {
  value: string
  onChange: (iso: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-[3px] border-b border-neutral-400 bg-sky-50 px-1 py-0.5 text-[10px] tabular-nums hover:bg-sky-100"
        >
          <CalendarIcon className="size-3 text-neutral-400" />
          {printDate(value)}
        </button>
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

/** Delivery tranche chips (edit) or a plain printed line (read/print). */
function DeliverySchedule({
  line,
  orderDate,
  editable,
  onPatchLine,
}: {
  line: DocLine
  orderDate: string
  editable: boolean
  onPatchLine?: (key: string, patch: Partial<DocLine>) => void
}) {
  const scheduled = line.schedules.reduce((sum, tranche) => sum + tranche.qty, 0)
  const mismatch = line.schedules.length > 0 && Math.abs(scheduled - line.qty) > 1e-9

  if (!editable) {
    if (line.schedules.length === 0) return null
    return (
      <p className="mt-0.5 text-[10px] text-neutral-500">
        <span className="text-neutral-400 uppercase">Delivery </span>
        {line.schedules
          .map((tranche) => `${tranche.qty} by ${printDate(tranche.dueDate)}`)
          .join(" · ")}
      </p>
    )
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <span className="text-[9px] text-neutral-400 uppercase">Delivery</span>
      {line.schedules.map((tranche, trancheIndex) => (
        <span
          key={trancheIndex}
          className="inline-flex items-center gap-1 rounded border border-neutral-200 bg-neutral-50 px-1 py-0.5"
        >
          <input
            type="number"
            min={0}
            step="any"
            aria-label={`Tranche ${trancheIndex + 1} quantity`}
            value={tranche.qty}
            onFocus={selectOnFocus}
            onChange={(event) =>
              onPatchLine?.(line.key, {
                schedules: line.schedules.map((candidate, candidateIndex) =>
                  candidateIndex === trancheIndex
                    ? { ...candidate, qty: Number(event.target.value) }
                    : candidate
                ),
              })
            }
            className={cn(DOC_INPUT, DOC_NUM, "w-14 text-[11px]")}
          />
          <DocScheduleDate
            value={tranche.dueDate}
            onChange={(dueDate) =>
              onPatchLine?.(line.key, {
                schedules: line.schedules.map((candidate, candidateIndex) =>
                  candidateIndex === trancheIndex ? { ...candidate, dueDate } : candidate
                ),
              })
            }
          />
          <button
            type="button"
            aria-label={`Remove tranche ${trancheIndex + 1}`}
            className="rounded p-0.5 text-neutral-300 hover:bg-red-50 hover:text-red-600"
            onClick={() =>
              onPatchLine?.(line.key, {
                schedules: line.schedules.filter(
                  (_candidate, candidateIndex) => candidateIndex !== trancheIndex
                ),
              })
            }
          >
            <Trash2 className="size-3" />
          </button>
        </span>
      ))}
      <button
        type="button"
        className="inline-flex items-center gap-0.5 rounded border border-dashed border-neutral-300 px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-sky-50 hover:text-neutral-700"
        onClick={() =>
          onPatchLine?.(line.key, {
            schedules: [
              ...line.schedules,
              { dueDate: orderDate, qty: Math.max(line.qty - scheduled, 0) },
            ],
          })
        }
      >
        <CirclePlus className="size-3" /> Tranche
      </button>
      {mismatch ? (
        <span className="text-[10px] text-red-600">
          tranches {scheduled} ≠ qty {line.qty}
        </span>
      ) : null}
    </div>
  )
}

const CELL = "border border-neutral-400 px-2 py-1.5 align-top"

export function PoDocument({
  number,
  orderDate,
  statusLabel,
  vendor,
  lines,
  terms,
  items,
  editable = false,
  vendors = [],
  onPickVendor,
  onClearVendor,
  onOrderDate,
  onTerms,
  onPatchLine,
  onAddLine,
  onRemoveLine,
}: PoDocumentProps) {
  const { branding } = useAppConfig()

  // Display options: discount column follows the data unless toggled, and the
  // signature block is on by default. Screen-only — the bar never prints.
  const anyDiscount = lines.some((line) => line.discountPct > 0)
  const [discountChoice, setDiscountChoice] = React.useState<boolean | null>(null)
  const showDiscount = discountChoice ?? anyDiscount
  const [showSignature, setShowSignature] = React.useState(true)

  const asPoLine = (line: DocLine): PoLine => ({
    id: line.key,
    itemId: line.itemId,
    qty: line.qty,
    unitPricePaise: line.unitPricePaise,
    gstRatePct: items.find((item) => item.id === line.itemId)?.gstRatePct ?? 18,
    discountPct: line.discountPct,
  })

  const totals = poTotals(lines.filter((line) => line.itemId && line.qty > 0).map(asPoLine))
  const totalQty = lines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0)

  // Same state → CGST + SGST; different states → IGST; unknown → plain GST.
  const companyState = gstStateCode(branding.gstin)
  const vendorState = gstStateCode(vendor?.gstin)
  const gstMode =
    companyState && vendorState ? (companyState === vendorState ? "SPLIT" : "IGST") : "GST"

  const itemFor = (itemId: string) => items.find((candidate) => candidate.id === itemId)

  const numberCell = (
    line: DocLine,
    field: "qty" | "unitPricePaise" | "discountPct",
    ariaLabel: string
  ) => {
    if (!editable) {
      const value =
        field === "qty"
          ? line.qty
          : field === "unitPricePaise"
            ? paiseToRupees(line.unitPricePaise).toFixed(2)
            : line.discountPct || "—"
      return <p className="text-right text-xs tabular-nums">{value}</p>
    }
    return (
      <input
        type="number"
        min={0}
        step={field === "qty" ? "any" : field === "unitPricePaise" ? "0.01" : "0.5"}
        max={field === "discountPct" ? 100 : undefined}
        inputMode="decimal"
        aria-label={ariaLabel}
        value={
          field === "qty"
            ? line.qty
            : field === "unitPricePaise"
              ? paiseToRupees(line.unitPricePaise)
              : line.discountPct
        }
        onFocus={selectOnFocus}
        onChange={(event) => {
          const numeric = Number(event.target.value)
          if (field === "qty") {
            onPatchLine?.(line.key, {
              qty: numeric,
              // A single-tranche schedule follows the line qty.
              schedules:
                line.schedules.length === 1
                  ? [{ ...line.schedules[0], qty: numeric }]
                  : line.schedules,
            })
          } else if (field === "unitPricePaise") {
            onPatchLine?.(line.key, { unitPricePaise: rupeesToPaise(numeric) })
          } else {
            onPatchLine?.(line.key, { discountPct: numeric })
          }
        }}
        className={cn(DOC_INPUT, DOC_NUM, "text-xs")}
      />
    )
  }

  const itemNameBlock = (line: DocLine) => {
    const item = itemFor(line.itemId)
    return (
      <>
        <div className="flex items-center gap-1.5">
          {item ? (
            <span className="font-medium">{item.name}</span>
          ) : (
            <span className="text-neutral-400">{editable ? "Pick an item →" : "—"}</span>
          )}
          {editable ? (
            <PickerChip
              options={items}
              placeholder={<Search className="size-3.5" />}
              searchPlaceholder="Search item or code…"
              optionLabel={(candidate) => candidate.name}
              optionSublabel={(candidate) => `${candidate.code} · ${candidate.unit}`}
              onPick={(candidate) =>
                onPatchLine?.(line.key, {
                  itemId: candidate.id,
                  unitPricePaise: candidate.lastPricePaise,
                })
              }
              className="h-6 w-8 justify-center border-dashed border-neutral-400 bg-white p-0 text-neutral-500 hover:border-solid hover:bg-neutral-100 hover:text-neutral-800"
            />
          ) : null}
        </div>
        {item ? (
          <p className="text-[10px] text-neutral-500">
            <span className="text-neutral-400">HSN </span>
            <span className="tabular-nums">{item.hsn || "—"}</span>
            <span className="text-neutral-300"> · </span>
            {item.code}
          </p>
        ) : null}
        <DeliverySchedule
          line={line}
          orderDate={orderDate}
          editable={editable}
          onPatchLine={onPatchLine}
        />
      </>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[860px]">
      {/* Display options — screen only, never printed. */}
      <div className="text-muted-foreground mb-2 flex flex-wrap items-center justify-end gap-x-5 gap-y-2 text-xs print:hidden">
        <label className="flex cursor-pointer items-center gap-2">
          <Switch
            checked={showDiscount}
            onCheckedChange={(value) => setDiscountChoice(value)}
            aria-label="Show discount column"
          />
          Discount column
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <Switch
            checked={showSignature}
            onCheckedChange={setShowSignature}
            aria-label="Show signature block"
          />
          Signature
        </label>
      </div>

      <div className="po-document w-full border border-neutral-800 bg-white text-[13px] leading-relaxed text-neutral-900 shadow-xl">
        {/* Masthead — company block left, evenly-centred title cell right. */}
        <div className="flex items-stretch border-b border-neutral-800">
          <div className="min-w-0 flex-1 px-4 py-3 sm:px-5">
            {branding.logoDataUrl ? (
              <img src={branding.logoDataUrl} alt="" className="mb-1.5 h-9 w-auto" />
            ) : null}
            <p className="text-base font-bold tracking-tight sm:text-lg">{branding.companyName}</p>
            <p className="mt-0.5 text-[10px] leading-snug text-neutral-500">
              {branding.address || branding.branchLabel}
              {branding.gstin ? (
                <>
                  <br />
                  GSTIN{" "}
                  <span className="font-semibold text-neutral-800 tabular-nums">
                    {branding.gstin}
                  </span>
                </>
              ) : null}
              {branding.phone || branding.email ? (
                <>
                  <br />
                  {[branding.phone, branding.email].filter(Boolean).join(" · ")}
                </>
              ) : null}
            </p>
          </div>
          <div className="flex w-32 shrink-0 items-center justify-center border-l border-neutral-800 px-3 text-center sm:w-44">
            {/* -mr cancels the trailing letter-space so the title centres truly. */}
            <p className="-mr-[0.12em] text-sm leading-snug font-bold tracking-[0.12em] sm:text-base">
              PURCHASE
              <br />
              ORDER
            </p>
          </div>
        </div>

        {/* Reference strip */}
        <div className="grid grid-cols-3 border-b border-neutral-800">
          <div className="border-r border-neutral-200 px-4 py-2">
            <Lbl>PO No.</Lbl>
            <p className="text-xs font-bold tabular-nums">{number}</p>
          </div>
          <div className="border-r border-neutral-200 px-4 py-2">
            <Lbl>Order date</Lbl>
            <DocDate value={orderDate} onChange={onOrderDate} editable={editable} />
          </div>
          <div className="px-4 py-2">
            <Lbl>Status</Lbl>
            <p className="text-xs font-bold">{statusLabel}</p>
          </div>
        </div>

        {/* Parties */}
        <div className="grid grid-cols-1 border-b border-neutral-800 sm:grid-cols-2">
          <div className="border-b border-neutral-800 px-4 py-3 sm:border-r sm:border-b-0 sm:px-5">
            <div className="flex items-center justify-between gap-2">
              <Lbl>Order to</Lbl>
              {!editable ? null : vendor ? (
                <button
                  type="button"
                  onClick={onClearVendor}
                  className="inline-flex items-center gap-1 rounded border border-neutral-300 px-1.5 py-0.5 text-[9px] font-medium text-neutral-500 hover:bg-neutral-100"
                  title="Pick a different vendor"
                >
                  <X className="size-2.5" /> Change
                </button>
              ) : (
                <PickerChip
                  options={vendors}
                  placeholder={
                    <>
                      <Search className="size-3" /> Pick vendor
                    </>
                  }
                  searchPlaceholder="Search vendor, code, GSTIN…"
                  optionLabel={(candidate) => candidate.name}
                  optionSublabel={(candidate) =>
                    [candidate.code, candidate.gstin].filter(Boolean).join(" · ")
                  }
                  onPick={(candidate) => onPickVendor?.(candidate.id)}
                />
              )}
            </div>
            {vendor ? (
              <>
                <p className="mt-1 text-[15px] font-bold">{vendor.name}</p>
                {vendor.contact ? (
                  <p className="mt-0.5 text-xs text-neutral-600">{vendor.contact}</p>
                ) : null}
                {(vendor.address || vendor.city || vendor.state) && (
                  <p className="mt-0.5 text-xs text-neutral-600">
                    {[vendor.address, vendor.city, vendor.state].filter(Boolean).join(", ")}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-neutral-600">
                  <span className="text-[10px] text-neutral-400">GSTIN </span>
                  <span className="text-[11px] font-semibold text-neutral-800 tabular-nums">
                    {vendor.gstin ?? "Unregistered"}
                  </span>
                </p>
                {(vendor.phone || vendor.email) && (
                  <p className="mt-0.5 text-[11px] text-neutral-600">
                    {[vendor.phone, vendor.email].filter(Boolean).join(" · ")}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-1 text-xs text-neutral-400">
                {editable ? "Pick a vendor — their details print here." : "—"}
              </p>
            )}
          </div>

          <div className="px-4 py-3 sm:px-5">
            <Lbl>Deliver to</Lbl>
            <p className="mt-1 text-[15px] font-bold">{branding.companyName}</p>
            <p className="mt-0.5 text-xs text-neutral-600">
              {branding.address || branding.branchLabel}
            </p>
            {branding.gstin ? (
              <p className="mt-0.5 text-xs text-neutral-600">
                <span className="text-[10px] text-neutral-400">GSTIN </span>
                <span className="text-[11px] font-semibold text-neutral-800 tabular-nums">
                  {branding.gstin}
                </span>
              </p>
            ) : null}
            {vendor ? (
              <p className="mt-2 text-xs text-neutral-600">
                <span className="text-[10px] text-neutral-400">Payment </span>
                Net {vendor.paymentTermsDays} days
              </p>
            ) : null}
          </div>
        </div>

        {/* Items — classic fully-ruled grid on sm+, stacked cards on phones. */}
        <div className="border-b border-neutral-800">
          <div className="max-sm:hidden">
            <table className="w-full border-collapse text-[12px]" style={{ borderStyle: "hidden" }}>
              <thead>
                <tr className="bg-neutral-100 text-[9px] font-semibold tracking-wider text-neutral-500 uppercase">
                  <th className={cn(CELL, "w-9 text-left")}>#</th>
                  <th className={cn(CELL, "text-left")}>Item / HSN / Delivery</th>
                  <th className={cn(CELL, "w-20 text-right")}>Qty</th>
                  <th className={cn(CELL, "w-28 text-right")}>Rate ₹</th>
                  {showDiscount ? <th className={cn(CELL, "w-16 text-right")}>Disc %</th> : null}
                  <th className={cn(CELL, "w-16 text-right")}>GST %</th>
                  <th className={cn(CELL, "w-28 text-right")}>Amount</th>
                  {editable ? <th className={cn(CELL, "w-9 print:hidden")} /> : null}
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td
                      colSpan={editable ? 8 : 7}
                      className={cn(CELL, "py-6 text-center text-xs text-neutral-400")}
                    >
                      {editable ? "No lines yet — add one below." : "No lines."}
                    </td>
                  </tr>
                ) : (
                  lines.map((line, index) => {
                    const item = itemFor(line.itemId)
                    const amounts = line.itemId ? lineAmounts(asPoLine(line)) : null
                    return (
                      <tr key={line.key}>
                        <td className={cn(CELL, "text-[10px] text-neutral-400 tabular-nums")}>
                          {String(index + 1).padStart(2, "0")}
                        </td>
                        <td className={CELL}>{itemNameBlock(line)}</td>
                        <td className={cn(CELL, "text-right")}>
                          {numberCell(line, "qty", `Line ${index + 1} quantity`)}
                          {item ? (
                            <p className="text-right text-[9px] text-neutral-400">{item.unit}</p>
                          ) : null}
                        </td>
                        <td className={CELL}>
                          {numberCell(line, "unitPricePaise", `Line ${index + 1} rate`)}
                        </td>
                        {showDiscount ? (
                          <td className={CELL}>
                            {numberCell(line, "discountPct", `Line ${index + 1} discount`)}
                          </td>
                        ) : null}
                        <td className={cn(CELL, "pt-2 text-right text-xs tabular-nums")}>
                          {item ? item.gstRatePct : "—"}
                        </td>
                        <td className={cn(CELL, "pt-2 text-right text-xs font-semibold tabular-nums")}>
                          {amounts ? formatPaise(amounts.totalPaise) : "—"}
                        </td>
                        {editable ? (
                          <td className={cn(CELL, "text-center print:hidden")}>
                            <button
                              type="button"
                              title="Remove this line"
                              className="rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-600"
                              onClick={() => onRemoveLine?.(line.key)}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Phones: one block per line. */}
          <div className="divide-y divide-neutral-200 sm:hidden">
            {lines.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-neutral-400">
                {editable ? "No lines yet — add one below." : "No lines."}
              </p>
            ) : (
              lines.map((line, index) => {
                const item = itemFor(line.itemId)
                const amounts = line.itemId ? lineAmounts(asPoLine(line)) : null
                return (
                  <div key={line.key} className="px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">{itemNameBlock(line)}</div>
                      {editable ? (
                        <button
                          type="button"
                          aria-label={`Remove line ${index + 1}`}
                          className="rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-600"
                          onClick={() => onRemoveLine?.(line.key)}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      ) : null}
                    </div>
                    <div className={cn("mt-2 grid gap-x-3", showDiscount ? "grid-cols-4" : "grid-cols-3")}>
                      <div>
                        <Lbl>Qty{item ? ` (${item.unit})` : ""}</Lbl>
                        {numberCell(line, "qty", `Line ${index + 1} quantity`)}
                      </div>
                      <div>
                        <Lbl>Rate ₹</Lbl>
                        {numberCell(line, "unitPricePaise", `Line ${index + 1} rate`)}
                      </div>
                      {showDiscount ? (
                        <div>
                          <Lbl>Disc %</Lbl>
                          {numberCell(line, "discountPct", `Line ${index + 1} discount`)}
                        </div>
                      ) : null}
                      <div>
                        <Lbl>GST %</Lbl>
                        <p className="pt-0.5 text-right text-xs tabular-nums">
                          {item ? item.gstRatePct : "—"}
                        </p>
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-baseline justify-between border-t border-dashed border-neutral-200 pt-1">
                      <Lbl>Amount</Lbl>
                      <span className="text-xs font-semibold tabular-nums">
                        {amounts ? formatPaise(amounts.totalPaise) : "—"}
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {editable ? (
            <button
              type="button"
              onClick={onAddLine}
              className="flex w-full items-center justify-center gap-1.5 border-t border-dashed border-neutral-300 py-2.5 text-xs font-medium text-neutral-400 transition hover:bg-sky-50 hover:text-neutral-700 print:hidden"
            >
              <CirclePlus className="size-3.5" /> Add line
            </button>
          ) : null}
        </div>

        {/* Totals */}
        <div className="grid grid-cols-1 border-b border-neutral-800 sm:grid-cols-2">
          <div className="border-b border-neutral-200 px-4 py-3 sm:border-r sm:border-b-0 sm:px-5">
            <Lbl>Summary</Lbl>
            <p className="mt-1 text-xs text-neutral-600">
              {lines.length} line{lines.length === 1 ? "" : "s"} · total qty{" "}
              <span className="font-semibold tabular-nums">{totalQty}</span>
            </p>
          </div>
          <div className="px-4 py-3 sm:px-5">
            <dl className="space-y-1 text-xs">
              <div className="flex justify-between">
                <dt className="text-neutral-500">Subtotal</dt>
                <dd className="tabular-nums">{formatPaise(totals.subtotalPaise)}</dd>
              </div>
              {totals.discountPaise > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-neutral-500">Discount</dt>
                  <dd className="tabular-nums">− {formatPaise(totals.discountPaise)}</dd>
                </div>
              ) : null}
              {totals.taxBreakup.map((bucket) => {
                if (gstMode === "SPLIT") {
                  const { cgstPaise, sgstPaise } = splitGst(bucket.taxablePaise, bucket.ratePct)
                  return (
                    <React.Fragment key={bucket.ratePct}>
                      <div className="flex justify-between">
                        <dt className="text-neutral-500">
                          CGST {bucket.ratePct / 2}%{" "}
                          <span className="text-neutral-400">
                            on {formatPaise(bucket.taxablePaise)}
                          </span>
                        </dt>
                        <dd className="tabular-nums">{formatPaise(cgstPaise)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-neutral-500">SGST {bucket.ratePct / 2}%</dt>
                        <dd className="tabular-nums">{formatPaise(sgstPaise)}</dd>
                      </div>
                    </React.Fragment>
                  )
                }
                return (
                  <div key={bucket.ratePct} className="flex justify-between">
                    <dt className="text-neutral-500">
                      {gstMode === "IGST" ? "IGST" : "GST"} {bucket.ratePct}%{" "}
                      <span className="text-neutral-400">
                        on {formatPaise(bucket.taxablePaise)}
                      </span>
                    </dt>
                    <dd className="tabular-nums">{formatPaise(bucket.taxPaise)}</dd>
                  </div>
                )
              })}
              {/* Classic double rule above the grand total. */}
              <div className="flex items-baseline justify-between border-t-[3px] border-neutral-800 pt-1.5 [border-top-style:double]">
                <dt className="text-sm font-bold">
                  Total <span className="text-[10px] font-normal text-neutral-400">INR</span>
                </dt>
                <dd className="text-base font-bold tabular-nums">
                  {formatPaise(totals.totalPaise)}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Terms */}
        <div className="px-4 py-3 sm:px-5">
          <Lbl>Terms &amp; conditions</Lbl>
          {editable ? (
            <textarea
              value={terms}
              rows={2}
              placeholder="Delivery point, freight, quality terms…"
              onChange={(event) => onTerms?.(event.target.value)}
              className={cn(DOC_INPUT, "mt-1 resize-none text-xs text-neutral-700")}
            />
          ) : (
            <p className="mt-1 text-xs whitespace-pre-wrap text-neutral-700">{terms || "—"}</p>
          )}
        </div>

        {/* Signature — classic two-sided block. */}
        {showSignature ? (
          <div className="flex items-end justify-between gap-6 border-t border-neutral-800 px-4 pt-4 pb-3 sm:px-5">
            <div>
              <p className="mt-10 border-t border-neutral-300 pt-1 text-[10px] tracking-wide text-neutral-400 uppercase">
                Prepared by
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold">for {branding.companyName}</p>
              <p className="mt-10 border-t border-neutral-300 pt-1 text-[10px] tracking-wide text-neutral-400 uppercase">
                Authorised Signatory
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
