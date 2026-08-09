import * as React from "react"
import { toast } from "sonner"
import { Check, FileCheck2, PackagePlus, Signature } from "lucide-react"
import { LR_COPIES, LR_COPY_LABEL, type LrCopy } from "@attendance/shared"

import {
  describeRefusal,
  useConsignments,
  useDispatchActions,
  usePacks,
  usePickLists,
} from "@/lib/queries"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

/**
 * Packing, the lorry, and the signature at the far end.
 *
 * Split from the picking panel because a picker's role grants none of it: the
 * person who sealed the carton should not also be the one who certifies it
 * arrived.
 */

const failed = (error: unknown) => toast.error("Refused", { description: describeRefusal(error) })

function PackCard({ soId }: { soId: string }) {
  const { picks } = usePickLists(soId)
  const { packs } = usePacks(soId)
  const { createPack } = useDispatchActions()

  const packedIds = new Set(packs.map((pack) => pack.pickListId))
  const ready = picks.filter(
    (pick) => (pick.status === "PICKED" || pick.status === "SHORT") && !packedIds.has(pick.id)
  )

  if (ready.length === 0) return null

  const seal = (pickId: string) => {
    const pick = ready.find((row) => row.id === pickId)
    if (!pick) return
    createPack.mutate(
      {
        pickListId: pick.id,
        // One carton by default, holding exactly what was picked. Splitting
        // across cartons is a warehouse decision; guessing at it here would
        // print numbers on boxes nobody packed that way.
        packages: [
          {
            sequence: 1,
            description: "Carton",
            weightKg: 0,
            contents: pick.lines
              .filter((line) => line.pickedQty > 0)
              .map((line) => ({ soLineId: line.soLineId, qty: line.pickedQty })),
          },
        ],
      },
      {
        onSuccess: ({ pack }) => toast.success(`Packed as ${pack.number}`),
        onError: failed,
      }
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pack</CardTitle>
        <CardDescription>
          Sealing a carton records what is inside it, so a missing box names the goods rather than
          just a number.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {ready.map((pick) => (
          <div key={pick.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
            <div className="text-sm">
              <p className="font-medium">{pick.number}</p>
              <p className="text-muted-foreground text-xs">
                {pick.lines.reduce((sum, line) => sum + line.pickedQty, 0)} picked
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              aria-label={`Pack ${pick.number}`}
              disabled={createPack.isPending}
              onClick={() => seal(pick.id)}
            >
              <PackagePlus />
              Pack
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function DispatchCard({ soId }: { soId: string }) {
  const { packs } = usePacks(soId)
  const { consignments } = useConsignments(soId)
  const { dispatch } = useDispatchActions()

  const dispatchedPackIds = new Set(consignments.map((row) => row.packId).filter(Boolean))
  const ready = packs.filter((pack) => !dispatchedPackIds.has(pack.id))

  const [form, setForm] = React.useState({
    packId: "",
    transporterName: "",
    ownVehicle: false,
    lrNumber: "",
    lrDate: "",
    vehicleNo: "",
    driverName: "",
    driverPhone: "",
  })

  if (ready.length === 0) return null

  const set = (key: keyof typeof form, value: string | boolean) =>
    setForm((previous) => ({ ...previous, [key]: value }))

  const send = () => {
    dispatch.mutate(
      {
        soId,
        packId: form.packId || ready[0].id,
        challanId: null,
        dispatchedAt: new Date().toISOString(),
        transporterName: form.transporterName,
        ownVehicle: form.ownVehicle,
        lrNumber: form.lrNumber,
        lrDate: form.lrDate || null,
        vehicleNo: form.vehicleNo,
        driverName: form.driverName,
        driverPhone: form.driverPhone,
        freightPaise: 0,
        freightTerms: "PAID",
        packageCount: 1,
        weightKg: 0,
      },
      {
        onSuccess: ({ consignment }) => {
          toast.success(`Dispatched as ${consignment.number}`)
          setForm((previous) => ({ ...previous, lrNumber: "", vehicleNo: "" }))
        },
        onError: failed,
      }
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dispatch</CardTitle>
        <CardDescription>
          An LR number is what a claim against the transporter references. Our own lorry issues no
          receipt, so tick that instead of inventing a number.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field>
          <FieldLabel htmlFor="dispatch-pack">Carton set</FieldLabel>
          <Select value={form.packId || ready[0].id} onValueChange={(value) => set("packId", value)}>
            <SelectTrigger id="dispatch-pack">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ready.map((pack) => (
                <SelectItem key={pack.id} value={pack.id}>
                  {pack.number}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="dispatch-vehicle">Vehicle number</FieldLabel>
          <Input
            id="dispatch-vehicle"
            value={form.vehicleNo}
            placeholder="MH-12-AB-1234"
            onChange={(event) => set("vehicleNo", event.target.value)}
          />
          <FieldDescription>
            A vehicle listed as the company's own is treated as own even if the box below is
            unticked.
          </FieldDescription>
        </Field>

        <Field orientation="horizontal">
          <Checkbox
            id="dispatch-own"
            checked={form.ownVehicle}
            onCheckedChange={(checked) => set("ownVehicle", checked === true)}
          />
          <FieldLabel htmlFor="dispatch-own">Our own vehicle (no lorry receipt)</FieldLabel>
        </Field>

        {!form.ownVehicle ? (
          <>
            <Field>
              <FieldLabel htmlFor="dispatch-transporter">Transporter</FieldLabel>
              <Input
                id="dispatch-transporter"
                value={form.transporterName}
                onChange={(event) => set("transporterName", event.target.value)}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="dispatch-lr">LR number</FieldLabel>
                <Input
                  id="dispatch-lr"
                  value={form.lrNumber}
                  onChange={(event) => set("lrNumber", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="dispatch-lr-date">LR date</FieldLabel>
                <Input
                  id="dispatch-lr-date"
                  type="date"
                  value={form.lrDate}
                  onChange={(event) => set("lrDate", event.target.value)}
                />
              </Field>
            </div>
          </>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="dispatch-driver">Driver</FieldLabel>
            <Input
              id="dispatch-driver"
              value={form.driverName}
              onChange={(event) => set("driverName", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="dispatch-driver-phone">Driver's phone</FieldLabel>
            <Input
              id="dispatch-driver-phone"
              value={form.driverPhone}
              onChange={(event) => set("driverPhone", event.target.value)}
            />
          </Field>
        </div>

        <Button onClick={send} disabled={dispatch.isPending}>
          Record dispatch
        </Button>
      </CardContent>
    </Card>
  )
}

function ConsignmentCard({ soId }: { soId: string }) {
  const { consignments } = useConsignments(soId)
  const { attachLrCopy, recordPod } = useDispatchActions()
  const [pod, setPod] = React.useState<Record<string, { receivedBy: string; remarks: string }>>({})

  if (consignments.length === 0) return null

  const attach = (id: string, copy: LrCopy) =>
    attachLrCopy.mutate(
      // A stand-in for the upload that object storage takes over: the point
      // under test is that each copy is filed separately.
      { id, copy, url: `scan://${id}/${copy}` },
      { onSuccess: () => toast.success(`${LR_COPY_LABEL[copy]} filed`), onError: failed }
    )

  const sign = (id: string) => {
    const draft = pod[id]
    if (!draft?.receivedBy?.trim()) {
      toast.error("Who signed for it?", { description: "A name, not a designation." })
      return
    }
    recordPod.mutate(
      {
        consignmentId: id,
        deliveredAt: new Date().toISOString(),
        receivedBy: draft.receivedBy.trim(),
        condition: "OK",
        shortages: [],
        attachments: [],
        remarks: draft.remarks ?? "",
      },
      { onSuccess: () => toast.success("Delivery recorded"), onError: failed }
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>On the way</CardTitle>
        <CardDescription>
          A lorry receipt is issued in three parts and each goes somewhere else. Filing it as one
          scan is how the consignee copy goes missing and a claim fails months later.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {consignments.map((consignment) => (
          <div key={consignment.id} className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{consignment.number}</span>
              {consignment.ownVehicle ? (
                <Badge variant="outline">Own vehicle</Badge>
              ) : (
                <Badge variant="secondary">LR {consignment.lrNumber}</Badge>
              )}
              {consignment.pod ? (
                <Badge variant="outline">Signed by {consignment.pod.receivedBy}</Badge>
              ) : (
                <Badge variant="destructive">Not signed for</Badge>
              )}
            </div>

            {!consignment.ownVehicle ? (
              <div className="flex flex-wrap gap-2">
                {LR_COPIES.map((copy) => {
                  const held = consignment.lr.held.includes(copy)
                  return (
                    <Button
                      key={copy}
                      size="sm"
                      variant={held ? "outline" : "secondary"}
                      aria-label={`${held ? "Replace" : "Attach"} ${LR_COPY_LABEL[copy]} for ${consignment.number}`}
                      disabled={attachLrCopy.isPending}
                      onClick={() => attach(consignment.id, copy)}
                    >
                      {held ? <Check /> : <FileCheck2 />}
                      {LR_COPY_LABEL[copy]}
                    </Button>
                  )
                })}
              </div>
            ) : null}

            {!consignment.pod ? (
              <div className="flex flex-col gap-2">
                <Input
                  id={`pod-name-${consignment.id}`}
                  placeholder="Who signed for it?"
                  value={pod[consignment.id]?.receivedBy ?? ""}
                  onChange={(event) =>
                    setPod((previous) => ({
                      ...previous,
                      [consignment.id]: {
                        receivedBy: event.target.value,
                        remarks: previous[consignment.id]?.remarks ?? "",
                      },
                    }))
                  }
                />
                <Textarea
                  id={`pod-remarks-${consignment.id}`}
                  rows={2}
                  placeholder="Anything worth recording about the delivery"
                  value={pod[consignment.id]?.remarks ?? ""}
                  onChange={(event) =>
                    setPod((previous) => ({
                      ...previous,
                      [consignment.id]: {
                        receivedBy: previous[consignment.id]?.receivedBy ?? "",
                        remarks: event.target.value,
                      },
                    }))
                  }
                />
                <Button
                  size="sm"
                  aria-label={`Record delivery of ${consignment.number}`}
                  disabled={recordPod.isPending}
                  onClick={() => sign(consignment.id)}
                >
                  <Signature />
                  Record delivery
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function DispatchPanel({ soId }: { soId: string }) {
  return (
    <>
      <PackCard soId={soId} />
      <DispatchCard soId={soId} />
      <ConsignmentCard soId={soId} />
    </>
  )
}
