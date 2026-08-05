import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import * as z from "zod"
import type { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, CircleAlert, IndianRupee, Layers, PackagePlus } from "lucide-react"
import {
  formatPaise,
  stockMovements,
  stockPositions,
  type Item,
  type StockPosition,
} from "@attendance/shared"

import { todayISO, useProcurement } from "@/lib/procurement"
import { useSales } from "@/lib/sales"
import { useSession } from "@/lib/session"
import { DataTable } from "@/components/data-table"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/**
 * Stock is a projection: GRNs in, challans out, adjustments for counted
 * corrections — computed by the same shared functions the API serves. There
 * is no stock table to go stale.
 */

const adjustmentFormSchema = z.object({
  itemId: z.string().min(1, "Pick an item."),
  qty: z
    .number({ error: "Enter a quantity." })
    .refine((value) => value !== 0, "Zero adjusts nothing."),
  reason: z.string().min(3, "A reason is required — this is the audit trail."),
})
type AdjustmentForm = z.infer<typeof adjustmentFormSchema>

interface StockRow extends StockPosition {
  item: Item
}

export function StockPage() {
  const { items, pos, grns, stockAdjustments, adjustStock } = useProcurement()
  const { salesOrders, challans } = useSales()
  const { can, user } = useSession()
  const [adjustOpen, setAdjustOpen] = React.useState(false)
  const [movementItem, setMovementItem] = React.useState<Item | null>(null)

  const movements = React.useMemo(
    () => stockMovements(pos, grns, salesOrders, challans, stockAdjustments),
    [pos, grns, salesOrders, challans, stockAdjustments]
  )

  const rows = React.useMemo<StockRow[]>(() => {
    const positions = stockPositions(items, movements)
    return items
      .filter((item) => item.active)
      .map((item) => ({
        ...(positions.find((position) => position.itemId === item.id) ?? {
          itemId: item.id,
          onHandQty: 0,
          avgCostPaise: null,
          valuePaise: 0,
          belowReorder: false,
        }),
        item,
      }))
  }, [items, movements])

  const totalValue = rows.reduce((sum, row) => sum + row.valuePaise, 0)
  const belowReorder = rows.filter((row) => row.belowReorder)

  const form = useForm<AdjustmentForm>({
    resolver: zodResolver(adjustmentFormSchema),
    defaultValues: { itemId: "", qty: 0, reason: "" },
  })

  const columns = React.useMemo<ColumnDef<StockRow>[]>(
    () => [
      {
        id: "name",
        accessorFn: (row) => row.item.name,
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Item
            <ArrowUpDown />
          </Button>
        ),
        meta: { label: "Item" },
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.item.name}</span>
            <span className="text-muted-foreground text-xs">
              {[row.original.item.code, row.original.item.brand].filter(Boolean).join(" · ")}
            </span>
          </div>
        ),
      },
      {
        id: "onHand",
        accessorFn: (row) => row.onHandQty,
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            On hand
            <ArrowUpDown />
          </Button>
        ),
        meta: { label: "On hand" },
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.onHandQty} {row.original.item.unit}
          </span>
        ),
      },
      {
        id: "avgCost",
        header: "Avg cost",
        meta: { label: "Average cost" },
        cell: ({ row }) =>
          row.original.avgCostPaise === null ? "—" : formatPaise(row.original.avgCostPaise),
      },
      {
        id: "value",
        accessorFn: (row) => row.valuePaise,
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Value
            <ArrowUpDown />
          </Button>
        ),
        meta: { label: "Stock value" },
        cell: ({ row }) => (
          <span className="tabular-nums">{formatPaise(row.original.valuePaise)}</span>
        ),
      },
      {
        id: "reorder",
        header: "Reorder",
        meta: { label: "Reorder" },
        cell: ({ row }) =>
          row.original.belowReorder ? (
            <Badge variant="destructive">Below {row.original.item.reorderLevel}</Badge>
          ) : row.original.item.reorderLevel > 0 ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              min {row.original.item.reorderLevel}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ],
    []
  )

  const itemMovements = movementItem
    ? movements.filter((movement) => movement.itemId === movementItem.id).reverse()
    : []

  return (
    <Page>
      <PageHeader
        title="Stock"
        description="A projection of GRNs in, challans out and counted adjustments — never a stale table."
        actions={
          can("procurement.manage") ? (
            <Button size="sm" onClick={() => setAdjustOpen(true)}>
              <PackagePlus />
              Adjustment
            </Button>
          ) : null
        }
      />
      <PageBodyFixed>
        <div className="grid shrink-0 gap-4 sm:grid-cols-3">
          <StatCard
            icon={<IndianRupee className="text-muted-foreground size-4" />}
            label="Stock value"
            value={formatPaise(totalValue)}
          />
          <StatCard
            icon={<Layers className="text-muted-foreground size-4" />}
            label="Active items"
            value={String(rows.length)}
          />
          <StatCard
            icon={<CircleAlert className="text-muted-foreground size-4" />}
            label="Below reorder"
            value={String(belowReorder.length)}
          />
        </div>
        <DataTable
          columns={columns}
          data={rows}
          searchColumn="name"
          searchPlaceholder="Search item…"
          emptyTitle="No stock yet"
          emptyDescription="Receive material against a PO and it appears here."
          onRowClick={(row) => setMovementItem(row.item)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{row.item.name}</span>
                {row.belowReorder ? <Badge variant="destructive">Reorder</Badge> : null}
              </div>
              <span className="text-muted-foreground text-xs tabular-nums">
                {row.onHandQty} {row.item.unit}
                {row.avgCostPaise !== null ? ` · avg ${formatPaise(row.avgCostPaise)}` : ""} ·{" "}
                {formatPaise(row.valuePaise)}
              </span>
            </div>
          )}
        />
      </PageBodyFixed>

      {/* Movement history — the audit trail behind the number. */}
      <Sheet open={Boolean(movementItem)} onOpenChange={(open) => !open && setMovementItem(null)}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{movementItem?.name}</SheetTitle>
            <SheetDescription>Every movement, newest first.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {itemMovements.length === 0 ? (
              <p className="text-muted-foreground text-sm">No movements yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {itemMovements.map((movement, index) => (
                  <div key={index} className="rounded-md border px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className={movement.qty > 0 ? "text-success font-medium" : "font-medium"}>
                        {movement.qty > 0 ? "+" : ""}
                        {movement.qty} {movementItem?.unit}
                      </span>
                      <span className="text-muted-foreground text-xs">{movement.date}</span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {movement.kind === "GRN_IN"
                        ? `Received · ${movement.ref}`
                        : movement.kind === "DISPATCH_OUT"
                          ? `Dispatched · ${movement.ref}`
                          : `Adjustment — ${movement.ref}`}
                      {movement.unitCostPaise !== null
                        ? ` · @ ${formatPaise(movement.unitCostPaise)}`
                        : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Stock adjustment</DialogTitle>
            <DialogDescription>
              Append-only, with the reason on record — corrections never rewrite history.
            </DialogDescription>
          </DialogHeader>
          <form
            id="adjustment-form"
            onSubmit={form.handleSubmit((values) => {
              adjustStock({ ...values, date: todayISO() }, user?.email ?? "")
              toast.success("Adjustment recorded")
              form.reset()
              setAdjustOpen(false)
            })}
          >
            <FieldGroup>
              <Controller
                name="itemId"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="adj-item">Item</FieldLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="adj-item" aria-invalid={fieldState.invalid}>
                        <SelectValue placeholder="Select item" />
                      </SelectTrigger>
                      <SelectContent>
                        {items
                          .filter((item) => item.active)
                          .map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
              <Controller
                name="qty"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="adj-qty">Quantity (+ found / − shrinkage)</FieldLabel>
                    <Input
                      {...field}
                      onChange={(event) => field.onChange(event.target.valueAsNumber)}
                      id="adj-qty"
                      type="number"
                      step="any"
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
              <Controller
                name="reason"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="adj-reason">Reason</FieldLabel>
                    <Input
                      {...field}
                      id="adj-reason"
                      placeholder="Annual count, damage, return…"
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldDescription>Shown in the item's movement history.</FieldDescription>
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
            </FieldGroup>
          </form>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit" form="adjustment-form">
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  )
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  )
}
