import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import * as z from "zod"
import type { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, Plus } from "lucide-react"
import {
  estimateDisplayStatus,
  formatPaise,
  poTotals,
  type Customer,
} from "@attendance/shared"

import { todayISO } from "@/lib/procurement"
import { useSales } from "@/lib/sales"
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

const customerFormSchema = z.object({
  code: z.string().min(3, "Customer code is required."),
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
  paymentTermsDays: z.coerce.number<number>().int().min(0, "0 or more days."),
  active: z.boolean(),
})
type CustomerForm = z.infer<typeof customerFormSchema>

const EMPTY: CustomerForm = {
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
  active: true,
}

function CustomerSheet({
  customer,
  open,
  onOpenChange,
}: {
  customer: Customer | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { upsertCustomer } = useSales()
  const form = useForm<z.input<typeof customerFormSchema>, unknown, CustomerForm>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: EMPTY,
  })

  React.useEffect(() => {
    if (open) form.reset(customer ? { ...customer, gstin: customer.gstin ?? "" } : EMPTY)
  }, [open, customer, form])

  const onSubmit = (values: CustomerForm) => {
    upsertCustomer({ ...values, gstin: values.gstin || null, id: customer?.id })
    toast.success(customer ? "Customer updated" : "Customer created", { description: values.name })
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{customer ? "Edit customer" : "New customer"}</SheetTitle>
          <SheetDescription>
            The GSTIN state code decides CGST+SGST vs IGST on every estimate for this customer.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <form id="customer-form" onSubmit={form.handleSubmit(onSubmit)}>
            <FieldGroup>
              <div className="grid grid-cols-2 gap-4">
                <Controller
                  name="code"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="customer-code">Code</FieldLabel>
                      <Input {...field} id="customer-code" placeholder="CST003" aria-invalid={fieldState.invalid} disabled={Boolean(customer)} />
                      {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                    </Field>
                  )}
                />
                <Controller
                  name="gstin"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="customer-gstin">GSTIN</FieldLabel>
                      <Input {...field} id="customer-gstin" placeholder="Optional" aria-invalid={fieldState.invalid} />
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
                    <FieldLabel htmlFor="customer-name">Customer name</FieldLabel>
                    <Input {...field} id="customer-name" aria-invalid={fieldState.invalid} />
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
                      <FieldLabel htmlFor="customer-contact">Contact person</FieldLabel>
                      <Input {...field} id="customer-contact" />
                    </Field>
                  )}
                />
                <Controller
                  name="phone"
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="customer-phone">Phone</FieldLabel>
                      <Input {...field} id="customer-phone" />
                    </Field>
                  )}
                />
              </div>
              <Controller
                name="email"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="customer-email">Email</FieldLabel>
                    <Input {...field} id="customer-email" type="email" aria-invalid={fieldState.invalid} />
                    <FieldDescription>Estimates are emailed here once Phase 3 wiring lands.</FieldDescription>
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
              <Controller
                name="address"
                control={form.control}
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="customer-address">Address</FieldLabel>
                    <Input {...field} id="customer-address" />
                  </Field>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <Controller
                  name="city"
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="customer-city">City</FieldLabel>
                      <Input {...field} id="customer-city" />
                    </Field>
                  )}
                />
                <Controller
                  name="state"
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="customer-state">State</FieldLabel>
                      <Input {...field} id="customer-state" />
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
                      <FieldLabel htmlFor="customer-terms">Payment terms (days)</FieldLabel>
                      <Input {...field} id="customer-terms" type="number" aria-invalid={fieldState.invalid} />
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
                    <Switch id="customer-active" checked={field.value} onCheckedChange={field.onChange} />
                    <div className="grid gap-1">
                      <FieldLabel htmlFor="customer-active">Active</FieldLabel>
                      <FieldDescription>Inactive customers cannot receive new estimates.</FieldDescription>
                    </div>
                  </Field>
                )}
              />
            </FieldGroup>
          </form>
        </div>
        <SheetFooter>
          <Button type="submit" form="customer-form">
            {customer ? "Save changes" : "Create customer"}
          </Button>
          <SheetClose asChild>
            <Button variant="outline">Cancel</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export function CustomersPage() {
  const { customers, estimates } = useSales()
  const { can } = useSession()
  const [editing, setEditing] = React.useState<Customer | null>(null)
  const [open, setOpen] = React.useState(false)
  const today = todayISO()

  const columns = React.useMemo<ColumnDef<Customer>[]>(
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
            Customer
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
        cell: ({ row }) => row.original.gstin ?? <Badge variant="outline">Unregistered</Badge>,
      },
      {
        accessorKey: "paymentTermsDays",
        header: "Terms",
        meta: { label: "Payment terms" },
        cell: ({ row }) => `Net ${row.original.paymentTermsDays}`,
      },
      {
        id: "quoted",
        header: "Quoted value",
        meta: { label: "Quoted value" },
        cell: ({ row }) => {
          const quoted = estimates
            .filter((estimate) => estimate.customerId === row.original.id)
            .reduce((sum, estimate) => sum + poTotals(estimate.lines).totalPaise, 0)
          return quoted ? formatPaise(quoted) : "—"
        },
      },
      {
        id: "won",
        header: "Won",
        meta: { label: "Estimates won" },
        cell: ({ row }) => {
          const own = estimates.filter((estimate) => estimate.customerId === row.original.id)
          const won = own.filter(
            (estimate) => estimateDisplayStatus(estimate, today) === "ACCEPTED"
          ).length
          return own.length ? `${won}/${own.length}` : "—"
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
    [estimates, today]
  )

  return (
    <Page>
      <PageHeader
        title="Customers"
        description={`${customers.filter((customer) => customer.active).length} active — click a row to edit`}
        actions={
          can("sales.manage") ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null)
                setOpen(true)
              }}
            >
              <Plus />
              Add customer
            </Button>
          ) : null
        }
      />
      <PageBodyFixed>
        <DataTable
          columns={columns}
          data={customers}
          searchColumn="name"
          searchPlaceholder="Search customer or code…"
          emptyTitle="No customers yet"
          emptyDescription="Add your first customer to start sending estimates."
          onRowClick={
            can("sales.manage")
              ? (customer) => {
                  setEditing(customer)
                  setOpen(true)
                }
              : undefined
          }
          renderMobileCard={(customer) => (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{customer.name}</span>
                {customer.active ? (
                  <Badge variant="success">Active</Badge>
                ) : (
                  <Badge variant="outline">Inactive</Badge>
                )}
              </div>
              <span className="text-muted-foreground text-xs">
                {customer.code} · Net {customer.paymentTermsDays}
              </span>
              {(customer.contact || customer.phone) && (
                <span className="text-muted-foreground text-xs">
                  {[customer.contact, customer.phone].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>
          )}
        />
      </PageBodyFixed>
      <CustomerSheet customer={editing} open={open} onOpenChange={setOpen} />
    </Page>
  )
}
