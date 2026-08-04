import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import * as z from "zod"
import type { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, Plus } from "lucide-react"
import {
  ITEM_UNITS,
  formatPaise,
  paiseToRupees,
  rupeesToPaise,
  type Item,
} from "@attendance/shared"

import { useProcurement } from "@/lib/procurement"
import { useSession } from "@/lib/session"
import { ComboboxCreate } from "@/components/combobox-create"
import { DataTable } from "@/components/data-table"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"

const GST_SLABS = [0, 5, 12, 18, 28] as const

const itemFormSchema = z.object({
  code: z.string().min(3, "Item code is required."),
  name: z.string().min(2, "Name must be at least 2 characters."),
  brand: z.string(),
  category: z.string().min(1, "Pick or create a category."),
  unit: z.enum(ITEM_UNITS),
  hsn: z.string(),
  gstRatePct: z.number(),
  lastPriceRupees: z.number({ error: "Enter a price." }).min(0, "Price cannot be negative."),
  active: z.boolean(),
})
type ItemForm = z.infer<typeof itemFormSchema>

const EMPTY: ItemForm = {
  code: "",
  name: "",
  brand: "",
  category: "",
  unit: "PCS",
  hsn: "",
  gstRatePct: 18,
  lastPriceRupees: 0,
  active: true,
}

function ItemSheet({
  item,
  open,
  onOpenChange,
}: {
  item: Item | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { upsertItem, brands, categories, addBrand, addCategory } = useProcurement()
  const form = useForm<ItemForm>({ resolver: zodResolver(itemFormSchema), defaultValues: EMPTY })

  React.useEffect(() => {
    if (open)
      form.reset(
        item ? { ...item, lastPriceRupees: paiseToRupees(item.lastPricePaise) } : EMPTY
      )
  }, [open, item, form])

  const onSubmit = ({ lastPriceRupees, ...values }: ItemForm) => {
    upsertItem({ ...values, lastPricePaise: rupeesToPaise(lastPriceRupees), id: item?.id })
    toast.success(item ? "Item updated" : "Item created", { description: values.name })
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{item ? "Edit item" : "New item"}</SheetTitle>
          <SheetDescription>
            GST rate and price are copied onto PO lines at order time; editing them here never
            reprices existing orders.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <form id="item-form" onSubmit={form.handleSubmit(onSubmit)}>
            <FieldGroup>
              <div className="grid grid-cols-2 gap-4">
                <Controller
                  name="code"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="item-code">Code</FieldLabel>
                      <Input {...field} id="item-code" placeholder="ITM006" aria-invalid={fieldState.invalid} disabled={Boolean(item)} />
                      {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                    </Field>
                  )}
                />
                <Controller
                  name="hsn"
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="item-hsn">HSN / SAC</FieldLabel>
                      <Input {...field} id="item-hsn" placeholder="7208" />
                    </Field>
                  )}
                />
              </div>
              <Controller
                name="name"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="item-name">Item name</FieldLabel>
                    <Input {...field} id="item-name" aria-invalid={fieldState.invalid} />
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <Controller
                  name="brand"
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="item-brand">Brand</FieldLabel>
                      <ComboboxCreate
                        id="item-brand"
                        value={field.value ?? ""}
                        options={brands}
                        placeholder="No brand"
                        searchPlaceholder="Search or create brand…"
                        allowClear
                        onChange={field.onChange}
                        onCreate={addBrand}
                      />
                    </Field>
                  )}
                />
                <Controller
                  name="category"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="item-category">Category</FieldLabel>
                      <ComboboxCreate
                        id="item-category"
                        value={field.value ?? ""}
                        options={categories}
                        placeholder="Pick category"
                        searchPlaceholder="Search or create category…"
                        onChange={field.onChange}
                        onCreate={addCategory}
                      />
                      {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                    </Field>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Controller
                  name="unit"
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="item-unit">Unit</FieldLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="item-unit">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ITEM_UNITS.map((unit) => (
                            <SelectItem key={unit} value={unit}>
                              {unit}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Controller
                  name="gstRatePct"
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="item-gst">GST slab</FieldLabel>
                      <Select value={String(field.value)} onValueChange={(value) => field.onChange(Number(value))}>
                        <SelectTrigger id="item-gst">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {GST_SLABS.map((slab) => (
                            <SelectItem key={slab} value={String(slab)}>
                              {slab}%
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                />
                <Controller
                  name="lastPriceRupees"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="item-price">Price (₹)</FieldLabel>
                      <Input
                        {...field}
                        onChange={(event) => field.onChange(event.target.valueAsNumber)}
                        id="item-price"
                        type="number"
                        step="0.01"
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldDescription>Default rate on new PO lines.</FieldDescription>
                      {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                    </Field>
                  )}
                />
              </div>
              <Controller
                name="active"
                control={form.control}
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <Switch id="item-active" checked={field.value} onCheckedChange={field.onChange} />
                    <div className="grid gap-1">
                      <FieldLabel htmlFor="item-active">Active</FieldLabel>
                      <FieldDescription>Inactive items are hidden from the PO builder.</FieldDescription>
                    </div>
                  </Field>
                )}
              />
            </FieldGroup>
          </form>
        </div>
        <SheetFooter>
          <Button type="submit" form="item-form">
            {item ? "Save changes" : "Create item"}
          </Button>
          <SheetClose asChild>
            <Button variant="outline">Cancel</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export function ItemsPage() {
  const { items } = useProcurement()
  const { can } = useSession()
  const [editing, setEditing] = React.useState<Item | null>(null)
  const [open, setOpen] = React.useState(false)

  const columns = React.useMemo<ColumnDef<Item>[]>(
    () => [
      {
        accessorKey: "name",
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
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-muted-foreground text-xs">{row.original.code}</span>
          </div>
        ),
      },
      {
        accessorKey: "brand",
        header: "Brand",
        cell: ({ row }) => row.original.brand || "—",
      },
      { accessorKey: "category", header: "Category" },
      { accessorKey: "unit", header: "Unit" },
      {
        accessorKey: "hsn",
        header: "HSN",
        cell: ({ row }) => row.original.hsn || "—",
      },
      {
        accessorKey: "gstRatePct",
        header: "GST",
        meta: { label: "GST rate" },
        cell: ({ row }) => `${row.original.gstRatePct}%`,
      },
      {
        accessorKey: "lastPricePaise",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Price
            <ArrowUpDown />
          </Button>
        ),
        meta: { label: "Price" },
        cell: ({ row }) => formatPaise(row.original.lastPricePaise),
      },
      {
        accessorKey: "active",
        header: "Status",
        cell: ({ row }) =>
          row.original.active ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="outline">Inactive</Badge>
          ),
      },
    ],
    []
  )

  return (
    <Page>
      <PageHeader
        title="Items"
        description={`${items.filter((item) => item.active).length} active — click a row to edit`}
        actions={
          can("procurement.manage") ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null)
                setOpen(true)
              }}
            >
              <Plus />
              Add item
            </Button>
          ) : null
        }
      />
      <PageBodyFixed>
        <DataTable
          columns={columns}
          data={items}
          searchColumn="name"
          searchPlaceholder="Search item or code…"
          emptyTitle="No items yet"
          emptyDescription="Add items to put them on purchase orders."
          onRowClick={
            can("procurement.manage")
              ? (item) => {
                  setEditing(item)
                  setOpen(true)
                }
              : undefined
          }
        />
      </PageBodyFixed>
      <ItemSheet item={editing} open={open} onOpenChange={setOpen} />
    </Page>
  )
}
