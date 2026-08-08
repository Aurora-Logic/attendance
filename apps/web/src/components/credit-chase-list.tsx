import { PhoneCall, ShieldAlert } from "lucide-react"
import { formatPaise } from "@attendance/shared"

import { useOverdue } from "@/lib/queries"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Who to ring this morning.
 *
 * Ordered by how old the debt is rather than how large, on purpose: a small
 * invoice ninety days old is closer to being written off than a large one that
 * fell due last week.
 *
 * Nothing here sends anything. Whether an overdue account also stops the next
 * order is a company decision, so the card says which of the two it is instead
 * of leaving somebody to find out at the counter.
 */
export function CreditChaseList() {
  const { overdue, isLoading, enabled } = useOverdue()

  if (!enabled) return null
  if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />
  if (!overdue || overdue.rows.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <PhoneCall className="size-4" aria-hidden />
          Worth a call today
          <Badge variant="destructive">{formatPaise(overdue.totalOverduePaise)}</Badge>
          {overdue.holdOrdersOnBreach ? (
            <Badge variant="outline" className="gap-1">
              <ShieldAlert className="size-3" aria-hidden />
              New orders held
            </Badge>
          ) : (
            <Badge variant="outline">Advice only</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Oldest debt first, not largest — a small invoice ninety days old is closer to being
          written off than a large one that fell due last week. Anything under{" "}
          {formatPaise(overdue.chaseMinimumPaise)} is left off; chasing it costs more than it is
          worth.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {overdue.rows.slice(0, 12).map((row) => (
          <div
            key={row.customerId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{row.customerName}</p>
              <p className="text-muted-foreground text-xs">
                {row.oldestDocNumber} · {row.oldestOverdueDays} days past due
                {row.docCount > 1 ? ` · ${row.docCount} invoices` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={row.oldestOverdueDays > 60 ? "destructive" : "secondary"}>
                {row.bucket}
              </Badge>
              <span className="font-medium tabular-nums">{formatPaise(row.overduePaise)}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
