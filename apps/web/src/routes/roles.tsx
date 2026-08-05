import * as React from "react"
import { toast } from "sonner"
import { RotateCcw, ShieldCheck } from "lucide-react"
import {
  DEFAULT_MATRIX,
  PERMISSIONS,
  ROLES,
  ROLE_LABEL,
  SCOPE_LABEL,
  allowedScopes,
  type PermissionMatrix,
  type Role,
  type Scope,
} from "@attendance/shared"

import { ApiUnreachable, apiFetch } from "@/lib/api"
import { useSession } from "@/lib/session"
import { cn } from "@/lib/utils"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/** Reach is legible at a glance: wider grants read stronger. */
const scopeToneClass: Record<Scope, string> = {
  ALL: "text-status-present font-medium",
  OWN_BRANCH: "text-status-wfh",
  OWN_TEAM: "text-status-wfh",
  SELF: "text-muted-foreground",
  VIEW: "text-status-half-day",
  NONE: "text-muted-foreground/60",
}

export function RolesPage() {
  const { user } = useSession()
  const [matrix, setMatrix] = React.useState<PermissionMatrix>(() =>
    structuredClone(DEFAULT_MATRIX)
  )
  const [dirty, setDirty] = React.useState(false)

  // API mode: the matrix the guards actually enforce.
  React.useEffect(() => {
    if (user?.source !== "api") return
    void apiFetch<{ matrix: PermissionMatrix }>("/permissions")
      .then((payload) => setMatrix(payload.matrix))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.source])

  const persist = async () => {
    if (user?.source !== "api") {
      toast.success("Permission matrix saved", { description: "Stored locally (demo session)." })
      return
    }
    try {
      await apiFetch("/permissions", { method: "PUT", body: JSON.stringify(matrix) })
      toast.success("Permission matrix saved to the server", {
        description: "Route guards enforce the new scopes immediately.",
      })
    } catch (error) {
      toast.error(
        error instanceof ApiUnreachable ? "API unreachable — saved locally only" : String(error)
      )
    }
  }

  const setGrant = (permissionKey: string, role: Role, scope: Scope) => {
    setMatrix((prev) => ({
      ...prev,
      [permissionKey]: { ...prev[permissionKey], [role]: scope },
    }))
    setDirty(true)
  }

  const groups = React.useMemo(() => {
    const map = new Map<string, typeof PERMISSIONS>()
    for (const permission of PERMISSIONS) {
      map.set(permission.group, [...(map.get(permission.group) ?? []), permission])
    }
    return [...map.entries()]
  }, [])

  const grantCount = (role: Role) =>
    PERMISSIONS.filter((permission) => matrix[permission.key]?.[role] ?? "NONE" !== "NONE").length

  return (
    <Page>
      <PageHeader
        title="Roles & Permissions"
        description="The permission matrix is a table in the database, not a condition in code."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setMatrix(structuredClone(DEFAULT_MATRIX))
                setDirty(false)
                toast("Matrix reset to the seeded grants")
              }}
            >
              <RotateCcw />
              Reset
            </Button>
            <Button
              size="sm"
              disabled={!dirty}
              onClick={() => {
                setDirty(false)
                void persist()
              }}
            >
              Save matrix
            </Button>
          </>
        }
      />
      <PageBodyFixed>
        <Alert>
          <ShieldCheck />
          <AlertTitle>Two axes, not one</AlertTitle>
          <AlertDescription>
            A grant is the capability plus its reach. That is what lets Operations approve leave
            for their own team without granting them the company. &ldquo;Own team&rdquo; resolves
            recursively down the reporting hierarchy.
          </AlertDescription>
        </Alert>

        <div className="flex flex-wrap gap-2">
          {ROLES.map((role) => (
            <Badge key={role} variant="outline" className="gap-1">
              {ROLE_LABEL[role]}
              <span className="text-muted-foreground">
                {grantCount(role)}/{PERMISSIONS.length}
              </span>
            </Badge>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          <Table>
            <TableHeader className="bg-muted sticky top-0 z-10">
              <TableRow className="hover:bg-transparent">
                <TableHead className="bg-muted sticky left-0 z-20 min-w-[280px]">
                  Capability
                </TableHead>
                {ROLES.map((role) => (
                  <TableHead key={role} className="min-w-[150px]">
                    {ROLE_LABEL[role]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map(([group, permissions]) => (
                <React.Fragment key={group}>
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={ROLES.length + 1}
                      className="bg-muted/50 text-muted-foreground text-xs font-medium tracking-wide uppercase"
                    >
                      {group}
                    </TableCell>
                  </TableRow>
                  {permissions.map((permission) => (
                    <TableRow key={permission.key}>
                      <TableCell className="bg-background sticky left-0 z-10">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex flex-col items-start">
                              <span className="font-medium">{permission.label}</span>
                              <code className="text-muted-foreground text-xs">
                                {permission.key}
                              </code>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            {permission.description}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      {ROLES.map((role) => {
                        const scope = matrix[permission.key]?.[role] ?? "NONE"
                        return (
                          <TableCell key={role}>
                            <Select
                              value={scope}
                              onValueChange={(value) =>
                                setGrant(permission.key, role, value as Scope)
                              }
                            >
                              {/*
                                No `asChild` here. Radix renders SelectValue as
                                a Fragment when asChild is set, and the
                                data-slot attribute it forwards is invalid on a
                                Fragment — it logged a React warning on every
                                single cell of this grid.
                              */}
                              <SelectTrigger
                                size="sm"
                                className={cn("w-full", scopeToneClass[scope])}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {allowedScopes(permission.key).map((option) => (
                                  <SelectItem key={option} value={option}>
                                    {SCOPE_LABEL[option]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  ))}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      </PageBodyFixed>
    </Page>
  )
}
