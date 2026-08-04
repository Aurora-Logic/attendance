import * as React from "react"
import { toast } from "sonner"
import { Check, X } from "lucide-react"
import { DEFAULT_ATTENDANCE_SETTINGS } from "@attendance/shared"

import { seedApprovals, type ApprovalRequest, type RequestKind } from "@/lib/seed"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

const KIND_LABEL: Record<RequestKind, string> = {
  LEAVE: "Leave",
  REGULARISATION: "Regularisation",
  OVERTIME: "Overtime",
  COMP_OFF: "Comp-off",
}

const TABS: Array<{ value: RequestKind | "ALL"; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "LEAVE", label: "Leave" },
  { value: "REGULARISATION", label: "Regularisation" },
  { value: "OVERTIME", label: "Overtime" },
  { value: "COMP_OFF", label: "Comp-off" },
]

/** Bulk approve always carries a reason — §10, and it is what the audit log stores. */
function BulkDecision({
  count,
  intent,
  onConfirm,
}: {
  count: number
  intent: "APPROVE" | "REJECT"
  onConfirm: (remarks: string) => void
}) {
  const [remarks, setRemarks] = React.useState("")
  const isApprove = intent === "APPROVE"

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={isApprove ? "default" : "outline"} size="sm">
          {isApprove ? <Check /> : <X />}
          {isApprove ? "Approve" : "Reject"} {count}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isApprove ? "Approve" : "Reject"} {count} request{count === 1 ? "" : "s"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Each decision is written to the approval trail with your name, the timestamp and this
            reason. Approvals cannot be edited afterwards — only superseded.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor="bulk-remarks">Reason</FieldLabel>
          <Textarea
            id="bulk-remarks"
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
            placeholder={
              isApprove
                ? "Verified against the client visit log."
                : "Insufficient evidence for the out-of-geofence punch."
            }
          />
          <FieldDescription>Appears on the employee&rsquo;s notification.</FieldDescription>
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => onConfirm(remarks)}>
            {isApprove ? "Approve" : "Reject"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function ApprovalsPage() {
  const [requests, setRequests] = React.useState<ApprovalRequest[]>(() => seedApprovals())
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [tab, setTab] = React.useState<RequestKind | "ALL">("ALL")

  const pending = requests.filter((request) => request.status === "PENDING")
  const visible = tab === "ALL" ? pending : pending.filter((request) => request.kind === tab)
  const visibleSelected = visible.filter((request) => selected.has(request.id))

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const decide = (intent: "APPROVE" | "REJECT", ids: string[], remarks: string) => {
    setRequests((prev) =>
      prev.map((request) =>
        ids.includes(request.id)
          ? { ...request, status: intent === "APPROVE" ? "APPROVED" : "REJECTED" }
          : request
      )
    )
    setSelected(new Set())
    toast.success(`${ids.length} request${ids.length === 1 ? "" : "s"} ${intent.toLowerCase()}d`, {
      description: remarks || "No reason given",
    })
  }

  const allVisibleSelected = visible.length > 0 && visibleSelected.length === visible.length

  return (
    <Page>
      <PageHeader
        title="Approvals"
        description={`L1 is the reporting manager, L2 is HR. Unactioned requests escalate after ${DEFAULT_ATTENDANCE_SETTINGS.approvalEscalateAfterDays} days.`}
      />
      <PageBodyFixed>
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as RequestKind | "ALL")}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <TabsList className="shrink-0 w-fit max-w-full justify-start overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map((entry) => {
              const count =
                entry.value === "ALL"
                  ? pending.length
                  : pending.filter((request) => request.kind === entry.value).length
              return (
                <TabsTrigger key={entry.value} value={entry.value}>
                  {entry.label}
                  <Badge variant="secondary">{count}</Badge>
                </TabsTrigger>
              )
            })}
          </TabsList>

          <TabsContent value={tab} className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border px-3 py-2">
              <Checkbox
                id="select-all"
                checked={allVisibleSelected}
                onCheckedChange={(checked) =>
                  setSelected(checked ? new Set(visible.map((request) => request.id)) : new Set())
                }
                aria-label="Select all visible"
              />
              <label htmlFor="select-all" className="text-sm font-medium">
                {visibleSelected.length > 0
                  ? `${visibleSelected.length} selected`
                  : `${visible.length} pending`}
              </label>
              {visibleSelected.length > 0 ? (
                <ButtonGroup className="ml-auto">
                  <BulkDecision
                    count={visibleSelected.length}
                    intent="REJECT"
                    onConfirm={(remarks) =>
                      decide("REJECT", visibleSelected.map((r) => r.id), remarks)
                    }
                  />
                  <BulkDecision
                    count={visibleSelected.length}
                    intent="APPROVE"
                    onConfirm={(remarks) =>
                      decide("APPROVE", visibleSelected.map((r) => r.id), remarks)
                    }
                  />
                </ButtonGroup>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
              {visible.length === 0 ? (
                <Empty className="h-full border-0">
                  <EmptyHeader>
                    <EmptyTitle>Inbox zero</EmptyTitle>
                    <EmptyDescription>
                      Nothing is waiting on you in this category.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="divide-y">
                  {visible.map((request) => (
                    <div
                      key={request.id}
                      className="hover:bg-muted/40 flex items-start gap-3 px-3 py-3 transition-colors"
                    >
                      <Checkbox
                        className="mt-1"
                        checked={selected.has(request.id)}
                        onCheckedChange={() => toggle(request.id)}
                        aria-label={`Select ${request.employeeName}`}
                      />
                      <Avatar className="mt-0.5 size-8 shrink-0">
                        <AvatarFallback className="text-xs">{request.initials}</AvatarFallback>
                      </Avatar>

                      {/*
                        Two lines, not four. Line one is the request — the thing
                        being decided. Line two is who and when. The free-text
                        reason moves behind a tooltip: it matters for a handful
                        of rows, and inline it made all 26 unscannable.
                      */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium">{request.subject}</span>
                          <Badge variant="outline">{KIND_LABEL[request.kind]}</Badge>
                          {request.level === 2 ? (
                            <Badge variant="destructive">L2</Badge>
                          ) : null}
                        </div>
                        <p className="text-muted-foreground mt-0.5 truncate text-sm">
                          {request.employeeName}
                          <span className="mx-1.5 opacity-50">·</span>
                          {request.dateFrom}
                          {request.dateTo !== request.dateFrom ? ` → ${request.dateTo}` : ""}
                          <span className="mx-1.5 opacity-50">·</span>
                          {request.units}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge
                              variant={request.ageDays >= 2 ? "destructive" : "secondary"}
                              className="cursor-default"
                            >
                              {request.ageDays}d
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p className="font-medium">
                              {request.employeeCode} · {request.department}
                            </p>
                            <p>{request.detail}</p>
                          </TooltipContent>
                        </Tooltip>
                        <ButtonGroup>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            aria-label={`Reject ${request.subject}`}
                            onClick={() => decide("REJECT", [request.id], "Rejected inline")}
                          >
                            <X />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            aria-label={`Approve ${request.subject}`}
                            onClick={() => decide("APPROVE", [request.id], "Approved inline")}
                          >
                            <Check />
                          </Button>
                        </ButtonGroup>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </PageBodyFixed>
    </Page>
  )
}
