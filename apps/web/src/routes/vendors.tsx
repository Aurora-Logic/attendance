import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import * as z from "zod"
import type { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, Plus } from "lucide-react"
import { formatPaise, poTotals, vendorPerformance, type Vendor } from "@attendance/shared"

import { useProcurement, todayISO } from "@/lib/procurement"
import { useSession } from "@/lib/session"
import { DataTable } from "@/components/data-table"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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

const vendorFormSchema = z.object({
  code: z.string().min(3, "Vendor code is required."),
  name: z.string().min(2, "Name must be at least 2 characters."),
  gstin: z
    .string()
    .regex(/^[0-9A-Z]{15}$/, "GSTIN is 15 characters (or leave blank).")
    .or(z.literal("")),
  contact: z.string(),
  email: z.email("Enter a valid email address.").or(z.literal("")),
  phone: z.string(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  paymentTermsDays: z.number({ error: "Enter days." }).int().min(0, "0 or more days."),
  leadTimeDays: z.number({ error: "Enter days." }).int().min(0, "0 or more days."),
  active: z.boolean(),
})
type VendorForm = z.infer<typeof vendorFormSchema>

const EMPTY: VendorForm = {
  code: "",
  name: "",
  gstin: "",
  contact: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  paymentTermsDays: 30,
  leadTimeDays: 7,
  active: true,
}

function VendorSheet({
  vendor,
  open,
  onOpenChange,
}: {
  vendor: Vendor | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { upsertVendor } = useProcurement()
  const form = useForm<VendorForm>({ resolver: zodResolver(vendorFormSchema), defaultValues: EMPTY })

  React.useEffect(() => {
    if (open) form.reset(vendor ? { ...vendor, gstin: vendor.gstin ?? "" } : EMPTY)
  }, [open, vendor, form])

  const onSubmit = (values: VendorForm) => {
    upsertVendor({ ...values, gstin: values.gstin || null, id: vendor?.id })
    toast.success(vendor ? "Vendor updated" : "Vendor created", { description: values.name })
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{vendor ? "Edit vendor" : "New vendor"}</SheetTitle>
          <SheetDescription>
            Lead time seeds the default delivery date on every PO for this vendor.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <form id="vendor-form" onSubmit={form.handleSubmit(onSubmit)}>
            <FieldGroup>
              <div className="grid grid-cols-2 gap-4">
                <Controller
                  name="code"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="vendor-code">Code</FieldLabel>
                      <Input {...field} id="vendor-code" placeholder="VND004" aria-invalid={fieldState.invalid} disabled={Boolean(vendor)} />
                      {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                    </Field>
                  )}
                />
                <Controller
                  name="gstin"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="vendor-gstin">GSTIN</FieldLabel>
                      <Input {...field} id="vendor-gstin" placeholder="Optional" aria-invalid={fieldState.invalid} />
                      {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                    </Field>
                  )}
                />
              </div>
              <Controller
                name="name"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="vendor-name">Vendor name</FieldLabel>
                    <Input {...field} id="vendor-name" aria-invalid={fieldState.invalid} />
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <Controller
                  name="contact"
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="vendor-contact">Contact person</FieldLabel>
                      <Input {...field} id="vendor-contact" />
                    </Field>
                  )}
                />
                <Controller
                  name="phone"
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="vendor-phone">Phone</FieldLabel>
                      <Input {...field} id="vendor-phone" />
                    </Field>
                  )}
                />
              </div>
              <Controller
                name="email"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="vendor-email">Email</FieldLabel>
                    <Input {...field} id="vendor-email" type="email" aria-invalid={fieldState.invalid} />
                    <FieldDescription>POs are emailed here once Phase 3 wiring lands.</FieldDescription>
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
              <Controller
                name="address"
                control={form.control}
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="vendor-address">Address</FieldLabel>
                    <Input {...field} id="vendor-address" />
                  </Field>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <Controller
                  name="city"
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="vendor-city">City</FieldLabel>
                      <Input {...field} id="vendor-city" />
                    </Field>
                  )}
                />
                <Controller
                  name="state"
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="vendor-state">State</FieldLabel>
                      <Input {...field} id="vendor-state" />
                    </Field>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Controller
                  name="paymentTermsDays"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="vendor-terms">Payment terms (days)</FieldLabel>
                      <Input
                        {...field}
                        onChange={(event) => field.onChange(event.target.valueAsNumber)}
                        id="vendor-terms"
                        type="number"
                        aria-invalid={fieldState.invalid}
                      />
                      {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                    </Field>
                  )}
                />
                <Controller
                  name="leadTimeDays"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="vendor-lead">Lead time (days)</FieldLabel>
                      <Input
                        {...field}
                        onChange={(event) => field.onChange(event.target.valueAsNumber)}
                        id="vendor-lead"
                        type="number"
                        aria-invalid={fieldState.invalid}
                      />
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
                    <Switch id="vendor-active" checked={field.value} onCheckedChange={field.onChange} />
                    <div className="grid gap-1">
                      <FieldLabel htmlFor="vendor-active">Active</FieldLabel>
                      <FieldDescription>Inactive vendors cannot be put on new POs.</FieldDescription>
                    </div>
                  </Field>
                )}
              />
            </FieldGroup>
          </form>
        </div>
        <SheetFooter>
          <Button type="submit" form="vendor-form">
            {vendor ? "Save changes" : "Create vendor"}
          </Button>
          <SheetClose asChild>
            <Button variant="outline">Cancel</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export function VendorsPage() {
  const { vendors, pos, grns } = useProcurement()
  const { can } = useSession()
  const [editing, setEditing] = React.useState<Vendor | null>(null)
  const [open, setOpen] = React.useState(false)

  const today = todayISO()
  const columns = React.useMemo<ColumnDef<Vendor>[]>(
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
            Vendor
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
        id: "contact",
        header: "Contact",
        meta: { label: "Contact" },
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span>{row.original.contact || "—"}</span>
            <span className="text-muted-foreground text-xs">{row.original.phone}</span>
          </div>
        ),
      },
      {
        id: "location",
        header: "Location",
        meta: { label: "Location" },
        cell: ({ row }) =>
          [row.original.city, row.original.state].filter(Boolean).join(", ") || "—",
      },
      {
        accessorKey: "gstin",
        header: "GSTIN",
        cell: ({ row }) =>
          row.original.gstin ?? <Badge variant="outline">Unregistered</Badge>,
      },
      {
        accessorKey: "paymentTermsDays",
        header: "Terms",
        meta: { label: "Payment terms" },
        cell: ({ row }) => `Net ${row.original.paymentTermsDays}`,
      },
      {
        accessorKey: "leadTimeDays",
        header: "Lead time",
        meta: { label: "Lead time" },
        cell: ({ row }) => `${row.original.leadTimeDays} d`,
      },
      {
        id: "spend",
        header: "Committed spend",
        meta: { label: "Committed spend" },
        cell: ({ row }) => {
          const spend = pos
            .filter(
              (po) =>
                po.vendorId === row.original.id &&
                (po.status === "APPROVED" || po.status === "CLOSED")
            )
            .reduce((sum, po) => sum + poTotals(po.lines).totalPaise, 0)
          return spend ? formatPaise(spend) : "—"
        },
      },
      {
        id: "onTime",
        header: "On-time",
        meta: { label: "On-time delivery" },
        cell: ({ row }) => {
          const rate = vendorPerformance(row.original.id, pos, grns, today).onTimeRate
          return rate === null ? "—" : `${rate}%`
        },
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
    [pos, grns, today]
  )

  return (
    <Page>
      <PageHeader
        title="Vendors"
        description={`${vendors.filter((vendor) => vendor.active).length} active — click a row to edit`}
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
              Add vendor
            </Button>
          ) : null
        }
      />
      <PageBodyFixed>
        <DataTable
          columns={columns}
          data={vendors}
          searchColumn="name"
          searchPlaceholder="Search vendor or code…"
          emptyTitle="No vendors yet"
          emptyDescription="Add your first vendor to start raising purchase orders."
          onRowClick={
            can("procurement.manage")
              ? (vendor) => {
                  setEditing(vendor)
                  setOpen(true)
                }
              : undefined
          }
        />
      </PageBodyFixed>
      <VendorSheet vendor={editing} open={open} onOpenChange={setOpen} />
    </Page>
  )
}
