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
  type Customer,
  type Item,
  type PoLine,
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
 * The estimate sheet — the sell-side twin of PoDocument, on the same
 * type-on-the-template pattern and the same `.po-document` paper class (which
 * carries the Helvetica face and the A4 print isolation). Parties invert:
 * "Estimate for" the customer, "From" us. GST splits against the CUSTOMER's
 * state. No delivery schedules; a validity date instead.
 *
 * Shared fillable-blank primitives are duplicated from po-document.tsx for
 * now — extracting a doc-primitives module is queued for when a third
 * document family (invoices) lands and the shape is proven.
 */

export interface EstimateDocLine {
  key: string
  itemId: string
  qty: number
  unitPricePaise: number
  discountPct: number
}

export interface EstimateDocumentProps {
  number: string
  date: string
  validUntil: string | null
  statusLabel: string
  /** Document title band — "ESTIMATE" by default; "SALES ORDER" reuses the sheet. */
  title?: string
  numberLabel?: string
  /** Replaces the Valid-until cell (e.g. the customer's own PO reference). */
  thirdRef?: { label: string; value: string }
  customer: Customer | null
  lines: EstimateDocLine[]
  terms: string
  items: Item[]
  editable?: boolean
  customers?: Customer[]
  onPickCustomer?: (customerId: string) => void
  onClearCustomer?: () => void
  onDate?: (iso: string) => void
  onValidUntil?: (iso: string | null) => void
  onTerms?: (terms: string) => void
  onPatchLine?: (key: string, patch: Partial<EstimateDocLine>) => void
  onAddLine?: () => void
  onRemoveLine?: (key: string) => void
}

const DOC_INPUT =
  "w-full min-w-0 rounded-[3px] border-0 border-b border-neutral-400 bg-sky-50 px-1.5 py-0.5 text-inherit transition-colors placeholder:text-neutral-400 placeholder-shown:border-dashed hover:bg-sky-100/80 focus:border-sky-500 focus:bg-sky-100 focus:outline-none focus:ring-0"
const DOC_NUM =
  "text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
const CELL = "border border-neutral-400 px-2 py-1.5 align-top"

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
const fromISO = (iso: string) => new Date(`${iso}T00:00:00`)
const printDate = (iso: string) => format(fromISO(iso), "d MMM yyyy")

function DocDate({
  value,
  placeholder = "Pick date",
  clearable = false,
  onChange,
  editable,
}: {
  value: string | null
  placeholder?: string
  clearable?: boolean
  onChange?: (iso: string | null) => void
  editable: boolean
}) {
  const [open, setOpen] = React.useState(false)
  if (!editable || !onChange) {
    return <p className="text-xs font-bold tabular-nums">{value ? printDate(value) : "—"}</p>
  }
  return (
    // date-picker is popover + calendar — there is no registry component.
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(DOC_INPUT, "flex items-center gap-1.5 text-left text-xs font-bold")}
          >
            <CalendarIcon className="size-3.5 text-neutral-400" />
            {value ? printDate(value) : <span className="font-normal text-neutral-400">{placeholder}</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value ? fromISO(value) : undefined}
            defaultMonth={value ? fromISO(value) : new Date()}
            onSelect={(date) => {
              if (date) onChange(format(date, "yyyy-MM-dd"))
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
      {clearable && value ? (
        <button
          type="button"
          aria-label="Clear date"
          className="rounded p-0.5 text-neutral-300 hover:text-neutral-600"
          onClick={() => onChange(null)}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  )
}

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

export function EstimateDocument({
  number,
  date,
  validUntil,
  statusLabel,
  title = "ESTIMATE",
  numberLabel = "Estimate No.",
  thirdRef,
  customer,
  lines,
  terms,
  items,
  editable = false,
  customers = [],
  onPickCustomer,
  onClearCustomer,
  onDate,
  onValidUntil,
  onTerms,
  onPatchLine,
  onAddLine,
  onRemoveLine,
}: EstimateDocumentProps) {
  const { branding } = useAppConfig()

  const anyDiscount = lines.some((line) => line.discountPct > 0)
  const [discountChoice, setDiscountChoice] = React.useState<boolean | null>(null)
  const showDiscount = discountChoice ?? anyDiscount
  const [showSignature, setShowSignature] = React.useState(true)

  const asPoLine = (line: EstimateDocLine): PoLine => ({
    id: line.key,
    itemId: line.itemId,
    qty: line.qty,
    unitPricePaise: line.unitPricePaise,
    gstRatePct: items.find((item) => item.id === line.itemId)?.gstRatePct ?? 18,
    discountPct: line.discountPct,
  })

  const totals = poTotals(lines.filter((line) => line.itemId && line.qty > 0).map(asPoLine))
  const totalQty = lines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0)

  // GST splits against the CUSTOMER's state — we are the supplier here.
  const companyState = gstStateCode(branding.gstin)
  const customerState = gstStateCode(customer?.gstin)
  const gstMode =
    companyState && customerState ? (companyState === customerState ? "SPLIT" : "IGST") : "GST"

  const itemFor = (itemId: string) => items.find((candidate) => candidate.id === itemId)

  const numberCell = (
    line: EstimateDocLine,
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
          if (field === "qty") onPatchLine?.(line.key, { qty: numeric })
          else if (field === "unitPricePaise")
            onPatchLine?.(line.key, { unitPricePaise: rupeesToPaise(numeric) })
          else onPatchLine?.(line.key, { discountPct: numeric })
        }}
        className={cn(DOC_INPUT, DOC_NUM, "text-xs")}
      />
    )
  }

  const itemNameBlock = (line: EstimateDocLine) => {
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
                  unitPricePaise: candidate.salePricePaise || candidate.lastPricePaise,
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
        {/* Masthead */}
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
            <p className="-mr-[0.12em] text-sm leading-snug font-bold tracking-[0.12em] sm:text-base">
              {title.split(" ").map((word, index) => (
                <React.Fragment key={index}>
                  {index > 0 ? <br /> : null}
                  {word}
                </React.Fragment>
              ))}
            </p>
          </div>
        </div>

        {/* Reference strip */}
        <div className="grid grid-cols-2 border-b border-neutral-800 sm:grid-cols-4">
          <div className="border-r border-neutral-200 px-4 py-2">
            <Lbl>Estimate No.</Lbl>
            <p className="text-xs font-bold tabular-nums">{number}</p>
          </div>
          <div className="border-neutral-200 px-4 py-2 sm:border-r">
            <Lbl>Date</Lbl>
            <DocDate value={date} onChange={(iso) => iso && onDate?.(iso)} editable={editable} />
          </div>
          <div className="border-r border-neutral-200 px-4 py-2">
            <Lbl>Valid until</Lbl>
            <DocDate
              value={validUntil}
              placeholder="No expiry"
              clearable
              onChange={onValidUntil}
              editable={editable}
            />
          </div>
          <div className="px-4 py-2">
            <Lbl>Status</Lbl>
            <p className="text-xs font-bold">{statusLabel}</p>
          </div>
        </div>

        {/* Parties — inverted from the PO: the customer receives this. */}
        <div className="grid grid-cols-1 border-b border-neutral-800 sm:grid-cols-2">
          <div className="border-b border-neutral-800 px-4 py-3 sm:border-r sm:border-b-0 sm:px-5">
            <div className="flex items-center justify-between gap-2">
              <Lbl>Estimate for</Lbl>
              {!editable ? null : customer ? (
                <button
                  type="button"
                  onClick={onClearCustomer}
                  className="inline-flex items-center gap-1 rounded border border-neutral-300 px-1.5 py-0.5 text-[9px] font-medium text-neutral-500 hover:bg-neutral-100"
                  title="Pick a different customer"
                >
                  <X className="size-2.5" /> Change
                </button>
              ) : (
                <PickerChip
                  options={customers}
                  placeholder={
                    <>
                      <Search className="size-3" /> Pick customer
                    </>
                  }
                  searchPlaceholder="Search customer, code, GSTIN…"
                  optionLabel={(candidate) => candidate.name}
                  optionSublabel={(candidate) =>
                    [candidate.code, candidate.gstin].filter(Boolean).join(" · ")
                  }
                  onPick={(candidate) => onPickCustomer?.(candidate.id)}
                />
              )}
            </div>
            {customer ? (
              <>
                <p className="mt-1 text-[15px] font-bold">{customer.name}</p>
                {customer.contact ? (
                  <p className="mt-0.5 text-xs text-neutral-600">{customer.contact}</p>
                ) : null}
                {(customer.address || customer.city || customer.state) && (
                  <p className="mt-0.5 text-xs text-neutral-600">
                    {[customer.address, customer.city, customer.state].filter(Boolean).join(", ")}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-neutral-600">
                  <span className="text-[10px] text-neutral-400">GSTIN </span>
                  <span className="text-[11px] font-semibold text-neutral-800 tabular-nums">
                    {customer.gstin ?? "Unregistered"}
                  </span>
                </p>
                {(customer.phone || customer.email) && (
                  <p className="mt-0.5 text-[11px] text-neutral-600">
                    {[customer.phone, customer.email].filter(Boolean).join(" · ")}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-1 text-xs text-neutral-400">
                {editable ? "Pick a customer — their details print here." : "—"}
              </p>
            )}
          </div>

          <div className="px-4 py-3 sm:px-5">
            <Lbl>From</Lbl>
            <p className="mt-1 text-[15px] font-bold">{branding.companyName}</p>
            <p className="mt-0.5 text-xs text-neutral-600">
              {branding.address || branding.branchLabel}
            </p>
            {customer ? (
              <p className="mt-2 text-xs text-neutral-600">
                <span className="text-[10px] text-neutral-400">Payment </span>
                Net {customer.paymentTermsDays} days
              </p>
            ) : null}
          </div>
        </div>

        {/* Items — same classic fully-ruled grid as the PO. */}
        <div className="border-b border-neutral-800">
          <div className="max-sm:hidden">
            <table className="w-full border-collapse text-[12px]" style={{ borderStyle: "hidden" }}>
              <thead>
                <tr className="bg-neutral-100 text-[9px] font-semibold tracking-wider text-neutral-500 uppercase">
                  <th className={cn(CELL, "w-9 text-left")}>#</th>
                  <th className={cn(CELL, "text-left")}>Item / HSN</th>
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
              placeholder="Validity, delivery, payment, warranty…"
              onChange={(event) => onTerms?.(event.target.value)}
              className={cn(DOC_INPUT, "mt-1 resize-none text-xs text-neutral-700")}
            />
          ) : (
            <p className="mt-1 text-xs whitespace-pre-wrap text-neutral-700">{terms || "—"}</p>
          )}
        </div>

        {/* Signature */}
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
