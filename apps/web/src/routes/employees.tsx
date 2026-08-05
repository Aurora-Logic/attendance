import * as React from "react"
import { useNavigate } from "react-router"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import * as z from "zod"
import type { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, Plus, Upload } from "lucide-react"

import { ApiError } from "@/lib/api"
import { useCreateEmployee, useDepartments, useEmployeesList } from "@/lib/queries"
import { useSession } from "@/lib/session"
import { BRANCHES, type Employee } from "@/lib/seed"
import { DataTable } from "@/components/data-table"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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
  SheetTrigger,
} from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"

const statusTone: Record<Employee["status"], "default" | "secondary" | "outline" | "destructive"> = {
  CONFIRMED: "default",
  PROBATION: "secondary",
  NOTICE: "destructive",
  EXITED: "outline",
}

const employeeSchema = z.object({
  code: z.string().min(3, "Employee code is required."),
  name: z.string().min(2, "Name must be at least 2 characters."),
  email: z.email("Enter a valid email address."),
  department: z.string().min(1, "Pick a department."),
  branchId: z.string().min(1, "Pick a branch."),
  isFieldEmployee: z.boolean(),
})
type EmployeeForm = z.infer<typeof employeeSchema>

/**
 * Forms compose `field` with RHF's Controller. The registry no longer ships a
 * `form` component — see DECISIONS.md F5.
 */
function EmployeeSheet() {
  const { user } = useSession()
  const [open, setOpen] = React.useState(false)
  const createEmployee = useCreateEmployee()
  const { departments } = useDepartments()
  const form = useForm<EmployeeForm>({
    resolver: zodResolver(employeeSchema),
    defaultValues: {
      code: "",
      name: "",
      email: "",
      department: "",
      branchId: "",
      isFieldEmployee: false,
    },
  })

  const onSubmit = (values: EmployeeForm) => {
    if (user?.source === "api") {
      createEmployee.mutate(
        { ...values, shiftId: "gen" },
        {
          onSuccess: () => {
            toast.success("Employee created", { description: `${values.name} · ${values.code}` })
            form.reset()
            setOpen(false)
          },
          onError: (error) =>
            toast.error("Could not create employee", {
              description:
                error instanceof ApiError && error.status === 403
                  ? "Your role lacks employee.manage at write scope."
                  : String(error),
            }),
        }
      )
      return
    }
    toast.success("Employee created (demo)", { description: `${values.name} · ${values.code}` })
    form.reset()
    setOpen(false)
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm">
          <Plus />
          Add employee
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>New employee</SheetTitle>
          <SheetDescription>
            Creates the employee and their login. Salary structure is set separately.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <form id="employee-form" onSubmit={form.handleSubmit(onSubmit)}>
            <FieldGroup>
              <Controller
                name="code"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="employee-code">Employee code</FieldLabel>
                    <Input
                      {...field}
                      id="employee-code"
                      placeholder="DLT0031"
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldDescription>Unique within the company.</FieldDescription>
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
              <Controller
                name="name"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="employee-name">Full name</FieldLabel>
                    <Input {...field} id="employee-name" aria-invalid={fieldState.invalid} />
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
              <Controller
                name="email"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="employee-email">Work email</FieldLabel>
                    <Input
                      {...field}
                      id="employee-email"
                      type="email"
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldDescription>Used for the login and payslip delivery.</FieldDescription>
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
              <Controller
                name="department"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="employee-dept">Department</FieldLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="employee-dept" aria-invalid={fieldState.invalid}>
                        <SelectValue placeholder="Select department" />
                      </SelectTrigger>
                      <SelectContent>
                        {departments
                          .filter((department) => department.isActive)
                          .map((department) => (
                            <SelectItem key={department.id} value={department.name}>
                              {department.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
              <Controller
                name="branchId"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="employee-branch">Branch</FieldLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="employee-branch" aria-invalid={fieldState.invalid}>
                        <SelectValue placeholder="Select branch" />
                      </SelectTrigger>
                      <SelectContent>
                        {BRANCHES.map((branch) => (
                          <SelectItem key={branch.id} value={branch.id}>
                            {branch.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>Sets the geofence centre and holiday calendar.</FieldDescription>
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
              <Controller
                name="isFieldEmployee"
                control={form.control}
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <Switch
                      id="employee-field"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                    <div className="grid gap-1">
                      <FieldLabel htmlFor="employee-field">Field employee</FieldLabel>
                      <FieldDescription>
                        Exempt from the geofence check — punches outside the radius are not flagged.
                      </FieldDescription>
                    </div>
                  </Field>
                )}
              />
            </FieldGroup>
          </form>
        </div>
        <SheetFooter>
          <Button type="submit" form="employee-form">
            Create employee
          </Button>
          <SheetClose asChild>
            <Button variant="outline">Cancel</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

const columns: ColumnDef<Employee>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Employee
        <ArrowUpDown />
      </Button>
    ),
    cell: ({ row }) => (
      <div className="flex items-center gap-3">
        <Avatar className="size-8">
          <AvatarFallback className="text-xs">{row.original.initials}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col">
          <span className="font-medium">{row.original.name}</span>
          <span className="text-muted-foreground text-xs">{row.original.code}</span>
        </div>
      </div>
    ),
  },
  { accessorKey: "department", header: "Department" },
  { accessorKey: "designation", header: "Designation" },
  {
    accessorKey: "branchId",
    header: "Branch",
    cell: ({ row }) => BRANCHES.find((b) => b.id === row.original.branchId)?.name ?? "—",
  },
  {
    accessorKey: "shift",
    header: "Shift",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">{row.original.shift}</span>
    ),
  },
  { accessorKey: "manager", header: "Reports to" },
  { accessorKey: "doj", header: "Joined" },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={statusTone[row.original.status]}>{row.original.status}</Badge>
    ),
  },
  {
    id: "field",
    header: "Field",
    cell: ({ row }) =>
      row.original.isFieldEmployee ? (
        <Badge variant="outline">Exempt</Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
]

export function EmployeesPage() {
  const navigate = useNavigate()
  const { employees, source, isLoading } = useEmployeesList()

  return (
    <Page>
      <PageHeader
        title="Employees"
        description={
          source === "api"
            ? `${employees.length} on the live roll — new joiners persist to the API`
            : `${employees.length} seeded · sign in with the API running for the live roll`
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => toast("Import template downloaded")}>
              <Upload />
              Bulk import
            </Button>
            <EmployeeSheet />
          </>
        }
      />
      <PageBodyFixed>
        <DataTable
          columns={columns}
          isLoading={isLoading}
          data={employees}
          searchColumn="name"
          searchPlaceholder="Search name or code…"
          emptyTitle="No employees match"
          emptyDescription="Clear the search or pick a different branch."
          onRowClick={(employee) => navigate(`/employees/${employee.id}`)}
        />
      </PageBodyFixed>
    </Page>
  )
}
