import * as React from "react"
import { format } from "date-fns"
import { CalendarIcon, CirclePlus, Search, Trash2, X } from "lucide-react"
import {
  formatPaise,
  lineAmounts,
  paiseToRupees,
  poTotals,
  rupeesToPaise,
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

/**
 * Type-on-the-template PO builder, after the OCC estimate design: the page IS
 * the purchase-order document — an A4-style sheet mirroring the print layout
 * (masthead → reference strip → parties → items → totals → terms → signature).
 * Every value is edited inline, right where it prints; pickers and trash
 * buttons are screen-only affordances. `editable={false}` renders the same
 * sheet as pure print — the detail page and window.print() both use it.
 *
 * The sheet is deliberately NOT tokened: it is paper, white in both app
 * themes, exactly what comes out of the printer.
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
  "text-right font-mono tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"

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

const fromISO = (iso: string) => new Date(`${iso}T00:00:00`)
const printDate = (iso: string) => format(fromISO(iso), "d MMM yyyy")

// Items grid — one shared column template so header and rows stay ruled.
const ITEM_GRID = "sm:grid-cols-[34px_minmax(0,1fr)_80px_104px_56px_56px_96px_36px]"

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
    return <p className="font-mono text-xs font-bold">{printDate(value)}</p>
  }
  return (
    // date-picker is popover + calendar — there is no registry component.
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            DOC_INPUT,
            "flex items-center gap-1.5 text-left font-mono text-xs font-bold"
          )}
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

  return (
    <div className="po-document mx-auto w-full max-w-[860px] border border-neutral-800 bg-white text-[13px] leading-relaxed text-neutral-900 shadow-xl">
      {/* Masthead */}
      <div className="flex items-stretch border-b border-neutral-800">
        <div className="min-w-0 flex-1 px-4 py-3 sm:px-5">
          {branding.logoDataUrl ? (
            <img src={branding.logoDataUrl} alt="" className="mb-1 h-8 w-auto" />
          ) : null}
          <p className="text-base font-bold tracking-tight sm:text-lg">{branding.companyName}</p>
          <p className="mt-0.5 text-[10px] leading-snug text-neutral-500">{branding.branchLabel}</p>
        </div>
        <div className="flex w-32 shrink-0 flex-col items-end justify-center border-l border-neutral-800 px-3 text-right sm:w-44 sm:px-5">
          <p className="text-sm font-bold tracking-[0.2em] sm:text-lg">PURCHASE ORDER</p>
          <p className="mt-0.5 text-[8px] tracking-[0.1em] text-neutral-400 uppercase">
            Subject to terms below
          </p>
        </div>
      </div>

      {/* Reference strip */}
      <div className="grid grid-cols-3 border-b border-neutral-800">
        <div className="border-r border-neutral-200 px-4 py-2">
          <Lbl>PO No.</Lbl>
          <p className="font-mono text-xs font-bold">{number}</p>
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
                <span className="font-mono text-[11px] font-semibold text-neutral-800">
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
          <p className="mt-0.5 text-xs text-neutral-600">{branding.branchLabel}</p>
          {vendor ? (
            <p className="mt-2 text-xs text-neutral-600">
              <span className="text-[10px] text-neutral-400">Payment </span>
              Net {vendor.paymentTermsDays} days
            </p>
          ) : null}
        </div>
      </div>

      {/* Items — ruled table, edit in place */}
      <div className="border-b border-neutral-800">
        <div
          className={cn(
            "hidden gap-x-2 border-b border-neutral-800 bg-neutral-100 px-3 py-1.5 text-[9px] font-semibold tracking-wider text-neutral-500 uppercase sm:grid",
            ITEM_GRID
          )}
        >
          <span>#</span>
          <span>Item / HSN / delivery</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Rate ₹</span>
          <span className="text-right">Disc %</span>
          <span className="text-right">GST %</span>
          <span className="text-right">Amount</span>
          <span />
        </div>

        {lines.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-neutral-400">
            {editable ? "No lines yet — add one below." : "No lines."}
          </p>
        ) : null}

        {lines.map((line, index) => {
          const item = items.find((candidate) => candidate.id === line.itemId)
          const amounts = line.itemId ? lineAmounts(asPoLine(line)) : null
          const scheduled = line.schedules.reduce((sum, tranche) => sum + tranche.qty, 0)
          const mismatch =
            line.schedules.length > 0 && Math.abs(scheduled - line.qty) > 1e-9
          return (
            <div key={line.key} className="border-b border-neutral-200 last:border-b-0">
              <div className={cn("px-3 py-2 sm:grid sm:items-start sm:gap-x-2", ITEM_GRID)}>
                <span className="hidden pt-0.5 font-mono text-[10px] text-neutral-400 sm:block">
                  {String(index + 1).padStart(2, "0")}
                </span>

                {/* Item + HSN + delivery schedule */}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    {item ? (
                      <span className="font-medium">{item.name}</span>
                    ) : (
                      <span className="text-neutral-400">
                        {editable ? "Pick an item →" : "—"}
                      </span>
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
                      <span className="font-mono">{item.hsn || "—"}</span>
                      <span className="text-neutral-300"> · </span>
                      {item.code}
                    </p>
                  ) : null}

                  {/* Delivery tranches — print as text, edit as chips. */}
                  {editable ? (
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
                                  candidateIndex === trancheIndex
                                    ? { ...candidate, dueDate }
                                    : candidate
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
                              {
                                dueDate: orderDate,
                                qty: Math.max(line.qty - scheduled, 0),
                              },
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
                  ) : line.schedules.length > 0 ? (
                    <p className="mt-0.5 text-[10px] text-neutral-500">
                      <span className="text-neutral-400 uppercase">Delivery </span>
                      {line.schedules
                        .map((tranche) => `${tranche.qty} by ${printDate(tranche.dueDate)}`)
                        .join(" · ")}
                    </p>
                  ) : null}
                </div>

                {/* Numbers — labelled grid on phones, table cells on sm+ */}
                <div className="mt-2 grid grid-cols-4 gap-x-3 sm:mt-0 sm:contents">
                  <div>
                    <Lbl className="sm:hidden">Qty</Lbl>
                    {editable ? (
                      <input
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        value={line.qty}
                        onFocus={selectOnFocus}
                        aria-label={`Line ${index + 1} quantity`}
                        onChange={(event) => {
                          const qty = Number(event.target.value)
                          onPatchLine?.(line.key, {
                            qty,
                            // A single-tranche schedule follows the line qty.
                            schedules:
                              line.schedules.length === 1
                                ? [{ ...line.schedules[0], qty }]
                                : line.schedules,
                          })
                        }}
                        className={cn(DOC_INPUT, DOC_NUM, "text-xs")}
                      />
                    ) : (
                      <p className="text-right font-mono text-xs tabular-nums">{line.qty}</p>
                    )}
                    {item ? (
                      <p className="text-right text-[9px] text-neutral-400">{item.unit}</p>
                    ) : null}
                  </div>
                  <div>
                    <Lbl className="sm:hidden">Rate ₹</Lbl>
                    {editable ? (
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        inputMode="decimal"
                        value={paiseToRupees(line.unitPricePaise)}
                        onFocus={selectOnFocus}
                        aria-label={`Line ${index + 1} rate`}
                        onChange={(event) =>
                          onPatchLine?.(line.key, {
                            unitPricePaise: rupeesToPaise(Number(event.target.value)),
                          })
                        }
                        className={cn(DOC_INPUT, DOC_NUM, "text-xs")}
                      />
                    ) : (
                      <p className="text-right font-mono text-xs tabular-nums">
                        {paiseToRupees(line.unitPricePaise).toFixed(2)}
                      </p>
                    )}
                  </div>
                  <div>
                    <Lbl className="sm:hidden">Disc %</Lbl>
                    {editable ? (
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.5"
                        inputMode="decimal"
                        value={line.discountPct}
                        onFocus={selectOnFocus}
                        aria-label={`Line ${index + 1} discount`}
                        onChange={(event) =>
                          onPatchLine?.(line.key, { discountPct: Number(event.target.value) })
                        }
                        className={cn(DOC_INPUT, DOC_NUM, "text-xs")}
                      />
                    ) : (
                      <p className="text-right font-mono text-xs tabular-nums">
                        {line.discountPct || "—"}
                      </p>
                    )}
                  </div>
                  <div>
                    <Lbl className="sm:hidden">GST %</Lbl>
                    <p className="pt-0.5 text-right font-mono text-xs tabular-nums">
                      {item ? item.gstRatePct : "—"}
                    </p>
                  </div>
                </div>

                {/* Amount */}
                <div className="mt-1.5 flex items-baseline justify-between border-t border-dashed border-neutral-200 pt-1 sm:mt-0 sm:block sm:border-0 sm:pt-0.5 sm:text-right">
                  <Lbl className="sm:hidden">Amount</Lbl>
                  <span className="font-mono text-xs font-semibold tabular-nums">
                    {amounts ? formatPaise(amounts.totalPaise) : "—"}
                  </span>
                </div>

                {/* Row actions */}
                <div className="hidden justify-end pt-0.5 sm:flex">
                  {editable ? (
                    <button
                      type="button"
                      title="Remove this line"
                      className="rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-600"
                      onClick={() => onRemoveLine?.(line.key)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          )
        })}

        {editable ? (
          <button
            type="button"
            onClick={onAddLine}
            className="flex w-full items-center justify-center gap-1.5 border-t border-dashed border-neutral-300 py-2.5 text-xs font-medium text-neutral-400 transition hover:bg-sky-50 hover:text-neutral-700"
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
            <span className="font-mono font-semibold">{totalQty}</span>
          </p>
        </div>
        <div className="px-4 py-3 sm:px-5">
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between">
              <dt className="text-neutral-500">Subtotal</dt>
              <dd className="font-mono tabular-nums">{formatPaise(totals.subtotalPaise)}</dd>
            </div>
            {totals.discountPaise > 0 ? (
              <div className="flex justify-between">
                <dt className="text-neutral-500">Discount</dt>
                <dd className="font-mono tabular-nums">− {formatPaise(totals.discountPaise)}</dd>
              </div>
            ) : null}
            {totals.taxBreakup.map((bucket) => (
              <div key={bucket.ratePct} className="flex justify-between">
                <dt className="text-neutral-500">
                  GST {bucket.ratePct}% <span className="text-neutral-400">on {formatPaise(bucket.taxablePaise)}</span>
                </dt>
                <dd className="font-mono tabular-nums">{formatPaise(bucket.taxPaise)}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between border-t border-neutral-800 pt-1.5">
              <dt className="text-sm font-bold">
                Total <span className="text-[10px] font-normal text-neutral-400">INR</span>
              </dt>
              <dd className="font-mono text-base font-bold tabular-nums">
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

      {/* Signature */}
      <div className="border-t border-neutral-800 px-4 py-3 text-right sm:px-5">
        <p className="text-xs font-semibold">for {branding.companyName}</p>
        <p className="mt-8 text-[10px] tracking-wide text-neutral-400 uppercase">
          Authorised Signatory
        </p>
      </div>
    </div>
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
          className="inline-flex items-center gap-1 rounded-[3px] border-b border-neutral-400 bg-sky-50 px-1 py-0.5 font-mono text-[10px] hover:bg-sky-100"
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
