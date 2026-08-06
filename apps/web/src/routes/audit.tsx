import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { useAuditRows } from "@/lib/queries"
import { seedAudit, type AuditRow } from "@/lib/seed"
import { DataTable } from "@/components/data-table"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

/**
 * The audit trail's job is answering "what exactly changed?" without making
 * the reader diff two JSON blobs by eye. Each row's before/after is diffed
 * into field-level chips — `lateGraceMinutes: 15 → 20` — inline; the full
 * payloads stay one click away for forensics.
 */

interface FieldChange {
  field: string
  from: string
  to: string
}

const short = (value: unknown): string => {
  if (value === null || value === undefined) return "—"
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return text.length > 42 ? `${text.slice(0, 39)}…` : text
}

/** Shallow field diff of the before/after payloads; null when not diffable. */
function diffChanges(beforeRaw: string, afterRaw: string): FieldChange[] | null {
  let before: unknown
  let after: unknown
  try {
    before = beforeRaw ? JSON.parse(beforeRaw) : undefined
    after = afterRaw ? JSON.parse(afterRaw) : undefined
  } catch {
    return null
  }
  if (typeof before !== "object" || typeof after !== "object" || !before || !after) return null
  const beforeObj = before as Record<string, unknown>
  const afterObj = after as Record<string, unknown>
  const keys = [...new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])]
  return keys
    .filter((key) => JSON.stringify(beforeObj[key]) !== JSON.stringify(afterObj[key]))
    .map((key) => ({ field: key, from: short(beforeObj[key]), to: short(afterObj[key]) }))
}

const ACTION_VARIANT = (action: string): "success" | "warning" | "destructive" | "outline" => {
  const lower = action.toLowerCase()
  if (lower.includes("delete") || lower.includes("reject") || lower.includes("cancel"))
    return "destructive"
  if (lower.includes("create") || lower.includes("approve")) return "success"
  if (lower.includes("update") || lower.includes("edit")) return "warning"
  return "outline"
}

function ChangeChips({ row, onExpand }: { row: AuditRow; onExpand: () => void }) {
  const changes = React.useMemo(() => diffChanges(row.before, row.after), [row])
  if (!changes || changes.length === 0) {
    return (
      <Button variant="ghost" size="sm" className="text-muted-foreground -ml-2" onClick={onExpand}>
        view payload
      </Button>
    )
  }
  const shown = changes.slice(0, 3)
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((change) => (
        <span
          key={change.field}
          className="bg-muted inline-flex max-w-72 items-baseline gap-1 truncate rounded px-1.5 py-0.5 font-mono text-[11px]"
        >
          <span className="text-muted-foreground">{change.field}:</span>
          <span className="text-status-absent line-through decoration-1">{change.from}</span>
          <span className="text-muted-foreground">→</span>
          <span className="text-status-present">{change.to}</span>
        </span>
      ))}
      {changes.length > shown.length ? (
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={onExpand}>
          +{changes.length - shown.length} more
        </Button>
      ) : null}
    </div>
  )
}

export function AuditPage() {
  const { rows: apiRows, source, isLoading } = useAuditRows()
  const seedRows = React.useMemo(() => seedAudit(), [])
  const allRows = (source === "api" && apiRows ? apiRows : seedRows) as AuditRow[]

  const [entityFilter, setEntityFilter] = React.useState("ALL")
  const [actionFilter, setActionFilter] = React.useState("ALL")
  const [expanded, setExpanded] = React.useState<AuditRow | null>(null)

  const entities = React.useMemo(
    () => [...new Set(allRows.map((row) => row.entity))].sort(),
    [allRows]
  )
  const actions = React.useMemo(
    () => [...new Set(allRows.map((row) => row.action))].sort(),
    [allRows]
  )
  const rows = allRows.filter(
    (row) =>
      (entityFilter === "ALL" || row.entity === entityFilter) &&
      (actionFilter === "ALL" || row.action === actionFilter)
  )

  const columns = React.useMemo<ColumnDef<AuditRow>[]>(
    () => [
      {
        accessorKey: "at",
        header: "When",
        cell: ({ row }) => (
          <span className="font-mono text-xs whitespace-nowrap">{row.original.at}</span>
        ),
      },
      { accessorKey: "actor", header: "Who" },
      {
        accessorKey: "action",
        header: "Action",
        cell: ({ row }) => (
          <Badge variant={ACTION_VARIANT(row.original.action)}>{row.original.action}</Badge>
        ),
      },
      {
        accessorKey: "entity",
        header: "Entity",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-mono text-xs">{row.original.entity}</span>
            <span className="text-muted-foreground font-mono text-xs">{row.original.entityId}</span>
          </div>
        ),
      },
      {
        id: "change",
        header: "What changed",
        meta: { label: "What changed" },
        cell: ({ row }) => (
          <ChangeChips row={row.original} onExpand={() => setExpanded(row.original)} />
        ),
      },
      {
        accessorKey: "ip",
        header: "IP",
        cell: ({ row }) => (
          <span className="text-muted-foreground font-mono text-xs">{row.original.ip}</span>
        ),
      },
    ],
    []
  )

  const expandedChanges = expanded ? diffChanges(expanded.before, expanded.after) : null

  return (
    <Page>
      <PageHeader
        title="Audit Log"
        description={
          source === "api" && apiRows
            ? "Append-only rows served from Postgres — every change diffed field by field."
            : "Append-only. Seeded preview — audit rows stream from Postgres on an API session."
        }
      />
      <PageBodyFixed>
        <DataTable
          columns={columns}
          isLoading={isLoading}
          data={rows}
          searchColumn="actor"
          searchPlaceholder="Search by actor…"
          emptyTitle="No audit entries"
          emptyDescription="Nothing has changed in this window, or the filters exclude everything."
          toolbar={
            <>
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger size="sm" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All entities</SelectItem>
                  {entities.map((entity) => (
                    <SelectItem key={entity} value={entity}>
                      {entity}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger size="sm" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All actions</SelectItem>
                  {actions.map((action) => (
                    <SelectItem key={action} value={action}>
                      {action}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          }
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1.5" onClick={() => setExpanded(row)}>
              <div className="flex items-center justify-between gap-2">
                <Badge variant={ACTION_VARIANT(row.action)}>{row.action}</Badge>
                <span className="text-muted-foreground font-mono text-xs">{row.at}</span>
              </div>
              <span className="text-sm">
                {row.actor} · <span className="font-mono text-xs">{row.entity}</span>
              </span>
              <ChangeChips row={row} onExpand={() => setExpanded(row)} />
            </div>
          )}
        />
      </PageBodyFixed>

      {/* Forensics: every changed field plus the raw payloads. */}
      <Sheet open={Boolean(expanded)} onOpenChange={(open) => !open && setExpanded(null)}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>
              {expanded?.action} · <span className="font-mono">{expanded?.entity}</span>
            </SheetTitle>
            <SheetDescription>
              {expanded?.actor} · {expanded?.at} · {expanded?.entityId}
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
            {expandedChanges && expandedChanges.length > 0 ? (
              <div>
                <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
                  Changed fields ({expandedChanges.length})
                </p>
                <div className="flex flex-col gap-1.5">
                  {expandedChanges.map((change) => (
                    <div key={change.field} className="rounded-md border px-3 py-2 font-mono text-xs">
                      <p className="text-muted-foreground">{change.field}</p>
                      <p className="text-status-absent line-through decoration-1">{change.from}</p>
                      <p className="text-status-present">{change.to}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div>
              <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
                Before
              </p>
              <pre className="bg-muted overflow-x-auto rounded p-2 text-xs">
                {expanded?.before || "—"}
              </pre>
            </div>
            <div>
              <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
                After
              </p>
              <pre className="bg-muted overflow-x-auto rounded p-2 text-xs">
                {expanded?.after || "—"}
              </pre>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </Page>
  )
}
