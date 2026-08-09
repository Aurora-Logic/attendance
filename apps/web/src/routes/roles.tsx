import * as React from "react"
import { toast } from "sonner"
import { Copy, RotateCcw, Search, ShieldCheck } from "lucide-react"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

/**
 * Role-first permissions editor. The old capability×role matrix answered
 * "who has X?" but nobody arrives with that question — they arrive with
 * "what can HR do?". One tab per role, capabilities grouped and described
 * inline, works identically on a phone. The matrix is still the data
 * underneath; only the lens changed.
 */

/** Reach is legible at a glance: wider grants read stronger. */
const SCOPE_TONE: Record<Scope, string> = {
  ALL: "bg-status-present",
  OWN_BRANCH: "bg-status-wfh",
  OWN_TEAM: "bg-status-wfh",
  SELF: "bg-muted-foreground",
  VIEW: "bg-status-half-day",
  NONE: "bg-muted-foreground/30",
}

export function RolesPage() {
  const { user } = useSession()
  const [matrix, setMatrix] = React.useState<PermissionMatrix>(() =>
    structuredClone(DEFAULT_MATRIX)
  )
  const [dirty, setDirty] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [activeRole, setActiveRole] = React.useState<Role>("HR")

  // API mode: the matrix the guards actually enforce.
  React.useEffect(() => {
    if (user?.source !== "api") return
    void apiFetch<{ matrix: PermissionMatrix }>("/permissions")
      .then((payload) => setMatrix(payload.matrix))
      .catch(() => {})
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

  const copyGrants = (from: Role, to: Role) => {
    setMatrix((prev) => {
      const next = structuredClone(prev)
      for (const permission of PERMISSIONS) {
        next[permission.key] = {
          ...next[permission.key],
          [to]: prev[permission.key]?.[from] ?? "NONE",
        }
      }
      return next
    })
    setDirty(true)
    toast(`${ROLE_LABEL[to]} now mirrors ${ROLE_LABEL[from]} — review before saving.`)
  }

  const groups = React.useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    const matches = PERMISSIONS.filter(
      (permission) =>
        !trimmed ||
        permission.label.toLowerCase().includes(trimmed) ||
        permission.key.toLowerCase().includes(trimmed) ||
        permission.group.toLowerCase().includes(trimmed)
    )
    const map = new Map<string, typeof PERMISSIONS>()
    for (const permission of matches) {
      map.set(permission.group, [...(map.get(permission.group) ?? []), permission])
    }
    return [...map.entries()]
  }, [query])

  const grantCount = (role: Role) =>
    PERMISSIONS.filter((permission) => (matrix[permission.key]?.[role] ?? "NONE") !== "NONE")
      .length

  return (
    <Page>
      <PageHeader
        title="Roles & Permissions"
        description="A grant is a capability plus its reach — the matrix is data, never a condition in code."
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
        <Tabs
          value={activeRole}
          onValueChange={(value) => setActiveRole(value as Role)}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <TabsList className="w-fit max-w-full justify-start overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {ROLES.map((role) => (
                <TabsTrigger key={role} value={role} className="gap-1.5">
                  {ROLE_LABEL[role]}
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {grantCount(role)}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
            <InputGroup className="w-full sm:ml-auto sm:max-w-56">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="Filter capabilities…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </InputGroup>
          </div>

          {ROLES.map((role) => (
            <TabsContent
              key={role}
              value={role}
              className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="gap-1">
                  <ShieldCheck className="size-3" />
                  {grantCount(role)} of {PERMISSIONS.length} capabilities granted
                </Badge>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Copy />
                      Copy grants from…
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {ROLES.filter((other) => other !== role).map((other) => (
                      <DropdownMenuItem key={other} onClick={() => copyGrants(other, role)}>
                        {ROLE_LABEL[other]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {groups.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No capability matches "{query}".
                </p>
              ) : (
                groups.map(([group, permissions]) => (
                  <section key={group} className="shrink-0">
                    <h2 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
                      {group}
                    </h2>
                    <div className="flex flex-col gap-2">
                      {permissions.map((permission) => {
                        const scope = matrix[permission.key]?.[role] ?? "NONE"
                        return (
                          <div
                            key={permission.key}
                            className={cn(
                              "flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:gap-4",
                              scope === "NONE" && "bg-muted/30"
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <p
                                className={cn(
                                  "text-sm font-medium",
                                  scope === "NONE" && "text-muted-foreground"
                                )}
                              >
                                {permission.label}
                              </p>
                              <p className="text-muted-foreground mt-0.5 text-xs">
                                {permission.description}
                              </p>
                            </div>
                            <Select
                              value={scope}
                              onValueChange={(value) =>
                                setGrant(permission.key, role, value as Scope)
                              }
                            >
                              <SelectTrigger
                                size="sm"
                                aria-label={`${permission.label} scope for ${ROLE_LABEL[role]}`}
                                className="w-full shrink-0 sm:w-40"
                              >
                                <span className={cn("size-2 shrink-0 rounded-full", SCOPE_TONE[scope])} />
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {allowedScopes(permission.key).map((option) => (
                                  <SelectItem key={option} value={option}>
                                    <span
                                      className={cn(
                                        "mr-1 inline-block size-2 rounded-full",
                                        SCOPE_TONE[option]
                                      )}
                                    />
                                    {SCOPE_LABEL[option]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                ))
              )}
            </TabsContent>
          ))}
        </Tabs>
      </PageBodyFixed>
    </Page>
  )
}
