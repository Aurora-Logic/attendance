import * as React from "react"
import { toast } from "sonner"
import { AlertTriangle, FileWarning, PackageCheck, Truck } from "lucide-react"
import { FULFILMENT_STAGES, LR_COPY_LABEL, type FulfilmentStage, type LrCopy } from "@attendance/shared"

import {
  describeRefusal,
  useFulfilmentActions,
  useFulfilmentBoard,
  usePickableLines,
  usePickLists,
  type FulfilmentOrderRow,
} from "@/lib/queries"
import { useSales } from "@/lib/sales"
import { DispatchPanel } from "@/components/fulfilment-dispatch"
import { useSession } from "@/lib/session"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
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
import { Input } from "@/components/ui/input"
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * The dispatch board.
 *
 * What somebody stands in front of in the morning, so it opens with what is
 * stuck rather than a list of rows: deliveries nobody has signed for, and
 * lorry receipts with a copy missing. Both become unrecoverable with time —
 * after a few weeks the transporter is not liable and the customer does not
 * remember — so they are the first thing on the screen, not a tab.
 */

const STAGE_LABEL: Record<FulfilmentStage, string> = {
  ORDERED: "Not started",
  PICKING: "Picking",
  PACKED: "Packed",
  DISPATCHED: "On the way",
  DELIVERED: "Delivered",
  EXCEPTION: "Problem",
}

const STAGE_TONE: Record<FulfilmentStage, "outline" | "secondary" | "default" | "destructive"> = {
  ORDERED: "outline",
  PICKING: "secondary",
  PACKED: "secondary",
  DISPATCHED: "default",
  DELIVERED: "outline",
  EXCEPTION: "destructive",
}

function PickPanel({ order, onClose }: { order: FulfilmentOrderRow; onClose: () => void }) {
  const { lines } = usePickableLines(order.soId)
  const { picks } = usePickLists(order.soId)
  const { createPick, updatePick } = useFulfilmentActions()
  const { user } = useSession()

  const [requested, setRequested] = React.useState<Record<string, string>>({})
  const [picked, setPicked] = React.useState<Record<string, string>>({})
  const [reason, setReason] = React.useState<Record<string, string>>({})

  const open = picks.filter((pick) => pick.status !== "CANCELLED")
  const active = open.find((pick) => pick.status === "PENDING" || pick.status === "PICKING")

  const raise = () => {
    const chosen = lines
      .map((line) => ({ soLineId: line.soLineId, requestedQty: Number(requested[line.soLineId] ?? 0) }))
      .filter((line) => line.requestedQty > 0)
    if (chosen.length === 0) {
      toast.error("Nothing to pick", { description: "Enter a quantity on at least one line." })
      return
    }
    createPick.mutate(
      { soId: order.soId, assignedTo: user?.employeeId ?? null, lines: chosen },
      {
        onSuccess: ({ pick }) => {
          setRequested({})
          toast.success(`Pick list ${pick.number} raised`)
        },
        // The rules' own words, not "HTTP 422".
        onError: (error) => toast.error("Refused", { description: describeRefusal(error) }),
      }
    )
  }

  const complete = () => {
    if (!active) return
    const patched = active.lines.map((line) => ({
      soLineId: line.soLineId,
      pickedQty: Number(picked[line.soLineId] ?? line.requestedQty),
      shortReason: reason[line.soLineId] ?? line.shortReason,
    }))
    const short = patched.some(
      (line, index) => line.pickedQty < active.lines[index].requestedQty
    )
    updatePick.mutate(
      { id: active.id, status: short ? "SHORT" : "PICKED", lines: patched },
      {
        onSuccess: () => {
          toast.success(short ? "Marked short" : "Picked")
          onClose()
        },
        onError: (error) => toast.error("Refused", { description: describeRefusal(error) }),
      }
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {active ? (
        <Card>
          <CardHeader>
            <CardTitle>{active.number}</CardTitle>
            <CardDescription>
              Enter what you actually found. A line short of its request needs a reason — otherwise
              it becomes an argument at month end that nobody can settle.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {active.lines.map((line) => {
              const value = picked[line.soLineId] ?? String(line.requestedQty)
              const isShort = Number(value) < line.requestedQty
              return (
                <div key={line.soLineId} className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">
                      {line.itemId} · asked for {line.requestedQty}
                    </span>
                    <Input
                      id={`picked-${line.soLineId}`}
                      className="w-24"
                      type="number"
                      min={0}
                      value={value}
                      onChange={(event) =>
                        setPicked((previous) => ({ ...previous, [line.soLineId]: event.target.value }))
                      }
                    />
                  </div>
                  {isShort ? (
                    <Input
                      id={`reason-${line.soLineId}`}
                      placeholder="Why short? Stock, damage, wrong item…"
                      value={reason[line.soLineId] ?? ""}
                      onChange={(event) =>
                        setReason((previous) => ({ ...previous, [line.soLineId]: event.target.value }))
                      }
                    />
                  ) : null}
                </div>
              )
            })}
            <Button onClick={complete} disabled={updatePick.isPending}>
              <PackageCheck />
              Finish this list
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Raise a pick list</CardTitle>
            <CardDescription>
              Only what is left is offered: already dispatched, or claimed by another open list, is
              taken off.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {lines.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing on this order.</p>
            ) : (
              lines.map((line) => (
                <div key={line.soLineId} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{line.itemId}</p>
                    <p className="text-muted-foreground text-xs">
                      {line.pickableQty} of {line.orderedQty} still to pick
                    </p>
                  </div>
                  <Input
                    id={`request-${line.soLineId}`}
                    className="w-24"
                    type="number"
                    min={0}
                    max={line.pickableQty}
                    disabled={line.pickableQty === 0}
                    value={requested[line.soLineId] ?? ""}
                    placeholder="0"
                    onChange={(event) =>
                      setRequested((previous) => ({ ...previous, [line.soLineId]: event.target.value }))
                    }
                  />
                </div>
              ))
            )}
            <Button onClick={raise} disabled={createPick.isPending || lines.length === 0}>
              Raise pick list
            </Button>
          </CardContent>
        </Card>
      )}

      {open.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Lists on this order</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {open.map((pick) => (
              <div key={pick.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                <span>{pick.number}</span>
                <Badge variant={pick.status === "SHORT" ? "destructive" : "secondary"}>
                  {pick.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

export function FulfilmentPage() {
  const { board, isLoading, enabled } = useFulfilmentBoard()
  const { customers } = useSales()
  const { scopeFor } = useSession()
  const canDispatch = ["ALL", "OWN_BRANCH"].includes(scopeFor("dispatch.manage"))
  const [selected, setSelected] = React.useState<FulfilmentOrderRow | null>(null)

  const nameOf = (customerId: string) =>
    customers.find((customer) => customer.id === customerId)?.name ?? customerId

  const byStage = React.useMemo(() => {
    const grouped = new Map<FulfilmentStage, FulfilmentOrderRow[]>()
    for (const stage of FULFILMENT_STAGES) grouped.set(stage, [])
    for (const order of board.orders) grouped.get(order.stage)?.push(order)
    return grouped
  }, [board.orders])

  return (
    <Page>
      <PageHeader
        title="Dispatch board"
        description="Where every open order is, from the rack to a signature at the customer's gate."
      />
      <PageBodyFixed>
        <div className="flex flex-col gap-4">
          {!enabled ? (
            <Alert>
              <Truck />
              <AlertTitle>The board needs a live server</AlertTitle>
              <AlertDescription>
                You are signed in to the demo data, so there is nothing to dispatch.
              </AlertDescription>
            </Alert>
          ) : isLoading ? (
            <>
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-64 w-full rounded-xl" />
            </>
          ) : (
            <>
              {board.podOverdue.length > 0 ? (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>
                    {board.podOverdue.length} delivery
                    {board.podOverdue.length === 1 ? "" : "ies"} nobody has signed for
                  </AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pl-4">
                      {board.podOverdue.slice(0, 5).map((row) => (
                        <li key={row.consignmentId}>
                          {row.number} — {row.daysOut} days out
                        </li>
                      ))}
                    </ul>
                    After a few weeks the transporter is not liable and the customer does not
                    remember.
                  </AlertDescription>
                </Alert>
              ) : null}

              {board.missingLrCopies.length > 0 ? (
                <Alert>
                  <FileWarning />
                  <AlertTitle>
                    {board.missingLrCopies.length} lorry receipt
                    {board.missingLrCopies.length === 1 ? "" : "s"} missing a copy
                  </AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pl-4">
                      {board.missingLrCopies.slice(0, 5).map((row) => (
                        <li key={row.consignmentId}>
                          {row.number} — no{" "}
                          {row.missing.map((copy) => LR_COPY_LABEL[copy as LrCopy]).join(", ")}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}

              {board.orders.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Truck />
                    </EmptyMedia>
                    <EmptyTitle>Nothing to dispatch</EmptyTitle>
                    <EmptyDescription>
                      Orders appear here as soon as one is open. Raise one from Sales Orders.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                FULFILMENT_STAGES.filter((stage) => (byStage.get(stage)?.length ?? 0) > 0).map(
                  (stage) => (
                    <Card key={stage}>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          {STAGE_LABEL[stage]}
                          <Badge variant={STAGE_TONE[stage]}>{byStage.get(stage)?.length}</Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-2">
                        {byStage.get(stage)?.map((order) => (
                          <Item key={order.soId} variant="outline" className="items-start">
                            <ItemContent>
                              <ItemTitle>
                                {order.number} · {nameOf(order.customerId)}
                              </ItemTitle>
                              <ItemDescription>{order.summary}</ItemDescription>
                            </ItemContent>
                            <ItemActions>
                              <Button
                                variant="outline"
                                size="sm"
                                // Named for the order it belongs to: a row of
                                // identical "Pick" buttons tells a screen
                                // reader nothing about which one it is on.
                                aria-label={`Pick ${order.number}`}
                                onClick={() => setSelected(order)}
                              >
                                Pick
                              </Button>
                            </ItemActions>
                          </Item>
                        ))}
                      </CardContent>
                    </Card>
                  )
                )
              )}
            </>
          )}
        </div>

        <Sheet open={selected !== null} onOpenChange={(next) => !next && setSelected(null)}>
          <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
            <SheetHeader>
              <SheetTitle>{selected?.number}</SheetTitle>
              <SheetDescription>
                {selected ? nameOf(selected.customerId) : ""} · {selected?.summary}
              </SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-8">
              {selected ? (
                <div className="flex flex-col gap-4">
                  <PickPanel order={selected} onClose={() => setSelected(null)} />
                  {/* Only for those who may dispatch: the person who sealed the
                      carton should not be the one certifying it arrived. */}
                  {canDispatch ? <DispatchPanel soId={selected.soId} /> : null}
                </div>
              ) : null}
            </div>
          </SheetContent>
        </Sheet>
      </PageBodyFixed>
    </Page>
  )
}
