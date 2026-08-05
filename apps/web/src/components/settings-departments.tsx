import * as React from "react"
import { toast } from "sonner"
import { Check, Pencil, Plus, X } from "lucide-react"

import { ApiError } from "@/lib/api"
import {
  useCreateDepartment,
  useDepartments,
  useUpdateDepartment,
  type DepartmentRow,
} from "@/lib/queries"
import { useSession } from "@/lib/session"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"

/**
 * Departments are a Postgres master with a unique code per company. Closing one
 * is a soft state, never a delete — an ex-department's employees and history
 * stay reportable.
 */
export function DepartmentsSettings() {
  const { departments, source, isLoading } = useDepartments()
  const { scopeFor } = useSession()
  const createDepartment = useCreateDepartment()
  const updateDepartment = useUpdateDepartment()
  const canWrite = ["ALL", "OWN_BRANCH"].includes(scopeFor("employee.manage"))

  const [code, setCode] = React.useState("")
  const [name, setName] = React.useState("")
  const [editing, setEditing] = React.useState<string | null>(null)
  const [draftName, setDraftName] = React.useState("")

  const add = () => {
    if (code.trim().length < 2 || name.trim().length < 2) return
    createDepartment.mutate(
      { code: code.trim().toUpperCase(), name: name.trim() },
      {
        onSuccess: ({ department }) => {
          toast.success("Department created", { description: `${department.code} · ${department.name}` })
          setCode("")
          setName("")
        },
        onError: (error) =>
          toast.error(
            error instanceof ApiError && error.status === 409
              ? "That code or name already exists"
              : "Could not create the department",
            {
              description:
                error instanceof ApiError && error.status === 403
                  ? "Your role lacks employee.manage at write scope."
                  : undefined,
            }
          ),
      }
    )
  }

  const rename = (department: DepartmentRow) => {
    if (draftName.trim().length < 2) return
    updateDepartment.mutate(
      { id: department.id, name: draftName.trim() },
      {
        onSuccess: () => {
          toast.success("Department renamed")
          setEditing(null)
        },
        onError: () => toast.error("Rename failed"),
      }
    )
  }

  const toggleActive = (department: DepartmentRow, isActive: boolean) =>
    updateDepartment.mutate(
      { id: department.id, isActive },
      {
        onSuccess: () =>
          toast.success(isActive ? "Department reopened" : "Department closed", {
            description: isActive
              ? undefined
              : "Existing employees and history keep it — it just stops being offered on new forms.",
          }),
      }
    )

  return (
    <div className="flex flex-col gap-4">
      {source === "demo" ? (
        <Alert>
          <AlertTitle>Preview list</AlertTitle>
          <AlertDescription>
            Sign in with the API running to manage the real department master — this list is the
            seed.
          </AlertDescription>
        </Alert>
      ) : null}

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a department</CardTitle>
            <CardDescription>
              The code is short and unique — it appears on imports, filters and reports.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <Field className="w-28">
                <FieldLabel htmlFor="dept-code">Code</FieldLabel>
                <Input
                  id="dept-code"
                  value={code}
                  maxLength={8}
                  placeholder="MAINT"
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  onKeyDown={(event) => event.key === "Enter" && add()}
                />
              </Field>
              <Field className="min-w-56 flex-1">
                <FieldLabel htmlFor="dept-name">Name</FieldLabel>
                <Input
                  id="dept-name"
                  value={name}
                  placeholder="Maintenance"
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && add()}
                />
                <FieldDescription>
                  Shown on the employee form, the roster grouping and every report filter.
                </FieldDescription>
              </Field>
              <Button
                size="sm"
                className="mb-6"
                disabled={source === "demo" || createDepartment.isPending}
                onClick={add}
              >
                <Plus />
                Add
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="gap-0 py-0">
        <CardHeader className="py-4">
          <CardTitle className="text-base">Departments</CardTitle>
          <CardDescription>
            {departments.filter((department) => department.isActive).length} open ·{" "}
            {departments.length} total
          </CardDescription>
        </CardHeader>
        <div className="divide-y border-t">
          {isLoading
            ? Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="px-4 py-3">
                  <Skeleton className="h-6 w-full" />
                </div>
              ))
            : departments.map((department) => (
                <div key={department.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Badge variant="outline" className="w-16 justify-center font-mono">
                    {department.code}
                  </Badge>

                  {editing === department.id ? (
                    <div className="flex flex-1 items-center gap-2">
                      <Input
                        value={draftName}
                        autoFocus
                        className="h-8 max-w-64"
                        onChange={(event) => setDraftName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") rename(department)
                          if (event.key === "Escape") setEditing(null)
                        }}
                      />
                      <Button size="icon-sm" variant="outline" onClick={() => rename(department)}>
                        <Check />
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => setEditing(null)}>
                        <X />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span
                        className={
                          department.isActive
                            ? "flex-1 text-sm font-medium"
                            : "text-muted-foreground flex-1 text-sm font-medium line-through"
                        }
                      >
                        {department.name}
                      </span>
                      {canWrite && source === "api" ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Rename ${department.name}`}
                          onClick={() => {
                            setEditing(department.id)
                            setDraftName(department.name)
                          }}
                        >
                          <Pencil />
                        </Button>
                      ) : null}
                    </>
                  )}

                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground hidden text-xs sm:inline">
                      {department.isActive ? "Open" : "Closed"}
                    </span>
                    <Switch
                      checked={department.isActive}
                      disabled={!canWrite || source === "demo"}
                      aria-label={`${department.isActive ? "Close" : "Reopen"} ${department.name}`}
                      onCheckedChange={(checked) => toggleActive(department, checked)}
                    />
                  </div>
                </div>
              ))}
        </div>
      </Card>
    </div>
  )
}
