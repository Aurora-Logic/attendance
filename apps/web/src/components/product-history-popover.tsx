import * as React from "react"
import { History, Info } from "lucide-react"
import { HISTORY_DOC_LABEL, formatPaise, type ProductHistory } from "@attendance/shared"

import { apiFetch } from "@/lib/api"
import { useSession } from "@/lib/session"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * What this product has done with this party before, on the line itself.
 *
 * The whole point is quoting from history in one keystroke, so the numbers a
 * person actually decides on — the last rate, the floor, the average — sit
 * above the list, and every row can be applied to the line directly.
 *
 * `Alt+S` opens it from the focused line, which is Tally's own Stock Query key
 * (work order 6.4). The icon stays for the mouse, and its tooltip says the key.
 */

interface Props {
  itemId: string
  partyId: string | null
  side?: "sales" | "purchase"
  /** Fills the line from a historical row. The reason this exists. */
  onApplyRate?: (rate: { unitPricePaise: number; discountPct: number }) => void
  /** Opened by the keyboard rather than the icon. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

type Payload = ProductHistory & { itemName: string; side: string }

export function ProductHistoryPopover({
  itemId,
  partyId,
  side = "sales",
  onApplyRate,
  open: controlledOpen,
  onOpenChange,
}: Props) {
  const { user } = useSession()
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = onOpenChange ?? setUncontrolledOpen

  const [data, setData] = React.useState<Payload | null>(null)
  const [state, setState] = React.useState<"idle" | "loading" | "error">("idle")

  // Fetched when it opens, not on every render of every line. A quotation with
  // twenty lines would otherwise fire twenty requests nobody asked for.
  React.useEffect(() => {
    if (!open || !partyId || user?.source !== "api") return
    let cancelled = false
    setState("loading")
    void apiFetch<Payload>(
      `/product-history?itemId=${encodeURIComponent(itemId)}&partyId=${encodeURIComponent(partyId)}&side=${side}`
    )
      .then((payload) => {
        if (cancelled) return
        setData(payload)
        setState("idle")
      })
      .catch(() => {
        if (!cancelled) setState("error")
      })
    return () => {
      cancelled = true
    }
  }, [open, itemId, partyId, side, user?.source])

  const summary = data?.summary

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={`Rate history for this product (Alt+S)`}
            >
              <Info className="size-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          Rate history <span className="text-muted-foreground ml-1">Alt+S</span>
        </TooltipContent>
      </Tooltip>

      <PopoverContent align="end" className="w-[26rem] p-0">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{data?.itemName ?? "Rate history"}</p>
            {data ? (
              <p className="text-muted-foreground text-xs">
                {data.scope === "PARTY"
                  ? `${summary?.documentCount} document(s) with this ${side === "purchase" ? "supplier" : "customer"}`
                  : "No history with this party — showing every party"}
              </p>
            ) : null}
          </div>
          {data?.scope === "ALL" ? <Badge variant="outline">All parties</Badge> : null}
        </div>

        {state === "loading" ? (
          <div className="flex flex-col gap-2 px-3 pb-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : state === "error" ? (
          <p className="text-muted-foreground px-3 pb-3 text-sm">
            Could not load the history. The rate on the line is unchanged.
          </p>
        ) : !summary || data.rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-3 pb-4 pt-2 text-center">
            <History className="text-muted-foreground size-5" />
            <p className="text-sm font-medium">Never traded</p>
            <p className="text-muted-foreground text-xs">
              This is the first time this product has been quoted.
            </p>
          </div>
        ) : (
          <>
            {/*
              The figures somebody actually decides on. A row of numbers
              separated by space rather than four bordered tiles — rule 1.5.
            */}
            <div className="grid grid-cols-4 gap-2 border-y px-3 py-2.5">
              {[
                { label: "Last", value: formatPaise(summary.lastRatePaise ?? 0) },
                { label: "Best", value: formatPaise(summary.bestRatePaise ?? 0) },
                { label: "Average", value: formatPaise(summary.averageRatePaise ?? 0) },
                {
                  label: "Since",
                  value:
                    summary.daysSinceLast === null
                      ? "—"
                      : summary.daysSinceLast === 0
                        ? "Today"
                        : `${summary.daysSinceLast}d`,
                },
              ].map((figure) => (
                <div key={figure.label}>
                  <p className="text-muted-foreground text-[10px] uppercase">{figure.label}</p>
                  <p className="text-sm font-semibold tabular-nums">{figure.value}</p>
                </div>
              ))}
            </div>

            <div className="max-h-64 divide-y overflow-y-auto overscroll-contain">
              {data.rows.map((row) => (
                <div
                  key={`${row.docId}-${row.date}`}
                  className="hover:bg-muted/40 flex items-center gap-2 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">
                      {HISTORY_DOC_LABEL[row.kind]} {row.docNumber}
                    </p>
                    <p className="text-muted-foreground text-[11px] tabular-nums">
                      {row.date} · {row.qty} units
                      {row.discountPct > 0 ? ` · ${row.discountPct}% off` : ""}
                      {row.marginPct !== null ? ` · ${row.marginPct}% margin` : ""}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatPaise(row.netRatePaise)}
                  </span>
                  {onApplyRate ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onApplyRate({
                          unitPricePaise: row.listRatePaise,
                          discountPct: row.discountPct,
                        })
                        setOpen(false)
                      }}
                    >
                      Apply
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
