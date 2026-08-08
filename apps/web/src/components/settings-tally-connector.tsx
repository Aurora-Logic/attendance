import * as React from "react"
import { toast } from "sonner"
import {
  AlertTriangle,
  Check,
  CircleDot,
  Database,
  PlugZap,
  RefreshCw,
  ScrollText,
} from "lucide-react"

import {
  useReviewTallyConflict,
  useTallyConflicts,
  useTallyStatus,
} from "@/lib/queries"
import { useSession } from "@/lib/session"
import { readConnector, sinceLabel } from "@/lib/tally-connector"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * The connector's health, in the terms of the person who has to do something
 * about it.
 *
 * Two faults look identical from a distance and need opposite responses: the
 * connector being down (go and look at that PC) and Tally being closed (wait
 * until morning). Everything on this screen exists to keep them apart.
 */

const ENTITY_LABEL: Record<string, string> = {
  customer: "Customers",
  vendor: "Vendors",
  item: "Stock items",
  stockGroup: "Stock groups",
  ledger: "Ledgers",
}

const TONE_STYLES = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-destructive",
} as const

export function TallyConnectorSettings() {
  const { status, isLoading, enabled } = useTallyStatus()
  const { conflicts, isLoading: conflictsLoading } = useTallyConflicts()
  const { scopeFor } = useSession()
  const review = useReviewTallyConflict()
  const canManage = ["ALL", "OWN_BRANCH"].includes(scopeFor("sales.manage"))
  const [expanded, setExpanded] = React.useState<string | null>(null)

  if (!enabled) {
    return (
      <Alert>
        <PlugZap />
        <AlertTitle>Connector status needs a live server</AlertTitle>
        <AlertDescription>
          You are signed in to the demo data. Connect to the API to see whether the Tally connector
          is running.
        </AlertDescription>
      </Alert>
    )
  }

  if (isLoading || !status) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  const reading = readConnector(status.agent)
  const unreviewed = conflicts.filter((row) => row.reviewedAt === null)
  const entities = Object.entries(status.records.byEntity).sort((a, b) => b[1] - a[1])

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleDot className={`size-4 ${TONE_STYLES[reading.tone]}`} aria-hidden />
            {reading.headline}
          </CardTitle>
          <CardDescription>{reading.detail}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <figure className="rounded-lg border px-3 py-2">
            <figcaption className="text-muted-foreground text-xs">Connector version</figcaption>
            <p className="font-medium tabular-nums">{status.agent.agentVersion || "—"}</p>
          </figure>
          <figure className="rounded-lg border px-3 py-2">
            <figcaption className="text-muted-foreground text-xs">Waiting to be sent</figcaption>
            <p className="font-medium tabular-nums">{status.agent.queuedRecords}</p>
          </figure>
          <figure className="rounded-lg border px-3 py-2">
            <figcaption className="text-muted-foreground text-xs">Masters mirrored</figcaption>
            <p className="font-medium tabular-nums">{status.records.total}</p>
          </figure>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-4" aria-hidden />
            What has come across
          </CardTitle>
          <CardDescription>
            Masters read from Tally. Attendance and payroll are not part of this and never sync.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entities.length === 0 ? (
            <Empty className="border-0 py-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RefreshCw />
                </EmptyMedia>
                <EmptyTitle>Nothing yet</EmptyTitle>
                <EmptyDescription>
                  Masters appear here within a minute of the connector's first successful run.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {entities.map(([entity, count]) => (
                <div
                  key={entity}
                  className="flex items-center justify-between rounded-lg border px-3 py-2"
                >
                  <span className="text-sm">{ENTITY_LABEL[entity] ?? entity}</span>
                  <span className="font-medium tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="size-4" aria-hidden />
            Conflicts
            {unreviewed.length > 0 ? (
              <Badge variant="destructive">{unreviewed.length} to check</Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            When the same master is edited in both places between two syncs, the later edit wins and
            the other copy is kept here in full. A one-sided edit is never a conflict, which is what
            keeps this list short enough to read.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {conflictsLoading ? (
            <Skeleton className="h-20 w-full rounded-lg" />
          ) : conflicts.length === 0 ? (
            <Empty className="border-0 py-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Check />
                </EmptyMedia>
                <EmptyTitle>Nothing overwritten</EmptyTitle>
                <EmptyDescription>
                  No master has been edited in both places between syncs.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-2">
              {conflicts.slice(0, 50).map((conflict) => {
                const isOpen = expanded === conflict.id
                return (
                  <Item key={conflict.id} variant="outline" className="items-start">
                    <ItemContent>
                      <ItemTitle className="flex flex-wrap items-center gap-2">
                        {conflict.name || conflict.tallyGuid}
                        <Badge variant="secondary">
                          {ENTITY_LABEL[conflict.entity] ?? conflict.entity}
                        </Badge>
                        {conflict.reviewedAt ? (
                          <Badge variant="outline">Checked</Badge>
                        ) : (
                          <Badge variant="destructive">Not checked</Badge>
                        )}
                      </ItemTitle>
                      <ItemDescription>
                        {conflict.reason} The {conflict.winner === "tally" ? "Tally" : "app"} copy
                        was kept.
                      </ItemDescription>
                      {isOpen ? (
                        <pre className="bg-muted mt-2 max-w-full overflow-x-auto rounded-md p-3 text-xs">
                          {JSON.stringify(conflict.discarded, null, 2)}
                        </pre>
                      ) : null}
                    </ItemContent>
                    <ItemActions className="flex-col items-end gap-1 sm:flex-row sm:items-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpanded(isOpen ? null : conflict.id)}
                      >
                        {isOpen ? "Hide" : "What was replaced"}
                      </Button>
                      {conflict.reviewedAt === null && canManage ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={review.isPending}
                          onClick={() =>
                            review.mutate(conflict.id, {
                              onSuccess: () => toast.success(`Marked ${conflict.name} as checked`),
                              onError: () => toast.error("Could not mark it as checked"),
                            })
                          }
                        >
                          Mark checked
                        </Button>
                      ) : null}
                    </ItemActions>
                  </Item>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {status.agent.state === "stale" ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Masters on these screens are out of date</AlertTitle>
          <AlertDescription>
            Nothing has come from Tally for {sinceLabel(status.agent.staleForMs)}. Anything created
            in Tally since then is not here yet. Settings → Guide has the steps for restarting the
            connector.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
