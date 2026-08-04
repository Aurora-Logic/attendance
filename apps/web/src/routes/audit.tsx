import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { seedAudit, type AuditRow } from "@/lib/seed"
import { DataTable } from "@/components/data-table"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"

const columns: ColumnDef<AuditRow>[] = [
  {
    accessorKey: "at",
    header: "When",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.at}</span>,
  },
  { accessorKey: "actor", header: "Who" },
  {
    accessorKey: "action",
    header: "Action",
    cell: ({ row }) => <Badge variant="outline">{row.original.action}</Badge>,
  },
  {
    accessorKey: "entity",
    header: "Entity",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-mono text-xs">{row.original.entity}</span>
        <span className="text-muted-foreground text-xs">{row.original.entityId}</span>
      </div>
    ),
  },
  {
    id: "change",
    header: "Change",
    cell: ({ row }) => (
      <HoverCard>
        <HoverCardTrigger asChild>
          <Badge variant="secondary" className="cursor-default">
            before → after
          </Badge>
        </HoverCardTrigger>
        <HoverCardContent className="w-80">
          <div className="flex flex-col gap-2 text-xs">
            <div>
              <p className="text-muted-foreground mb-1">Before</p>
              <pre className="bg-muted overflow-x-auto rounded p-2">{row.original.before}</pre>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">After</p>
              <pre className="bg-muted overflow-x-auto rounded p-2">{row.original.after}</pre>
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>
    ),
  },
  {
    accessorKey: "ip",
    header: "IP",
    cell: ({ row }) => <span className="text-muted-foreground font-mono text-xs">{row.original.ip}</span>,
  },
]

export function AuditPage() {
  const rows = React.useMemo(() => seedAudit(), [])

  return (
    <Page>
      <PageHeader
        title="Audit Log"
        description="Append-only. Attendance and payroll rows are never hard-deleted — corrections write a new version with a reason."
      />
      <PageBodyFixed>
        <Alert>
          <AlertTitle>Immutable by construction</AlertTitle>
          <AlertDescription>
            Every create, update, approve and delete is captured with actor, before, after,
            timestamp and IP. There is no UI to edit or remove a row here, and no API either.
          </AlertDescription>
        </Alert>
        <DataTable
          columns={columns}
          data={rows}
          searchColumn="actor"
          searchPlaceholder="Search by actor…"
          emptyTitle="No audit entries"
          emptyDescription="Nothing has changed in this window."
        />
      </PageBodyFixed>
    </Page>
  )
}
