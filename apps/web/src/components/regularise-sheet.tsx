import * as React from "react"
import { format } from "date-fns"
import { CalendarIcon, Wrench } from "lucide-react"
import { toast } from "sonner"
import {
  REGULARISATION_REASONS,
  REGULARISATION_REASON_LABEL,
  type RegularisationReason,
} from "@attendance/shared"

import { ApiError } from "@/lib/api"
import { useRaiseRegularisation } from "@/lib/queries"
import { useSession } from "@/lib/session"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"

/**
 * Raise a correction for a day the machine got wrong. Approving it appends
 * punches rather than editing them, which is why the copy says "sent for
 * approval" and not "fixed" — nothing changes until a manager agrees.
 *
 * Times are plain `time` inputs: a native time picker is the one control every
 * phone keyboard already knows, and the API takes 24-hour HH:MM either way.
 */
export function RegulariseSheet({
  defaultDate,
  trigger,
}: {
  defaultDate?: string
  trigger?: React.ReactNode
}) {
  const { user } = useSession()
  const raise = useRaiseRegularisation()
  const [open, setOpen] = React.useState(false)
  const [date, setDate] = React.useState<Date>(() =>
    defaultDate ? new Date(`${defaultDate}T00:00:00`) : new Date()
  )
  const [reason, setReason] = React.useState<RegularisationReason>("MISSED_OUT")
  const [inTime, setInTime] = React.useState("")
  const [outTime, setOutTime] = React.useState("")
  const [note, setNote] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  const reset = () => {
    setInTime("")
    setOutTime("")
    setNote("")
    setError(null)
  }

  const submit = () => {
    if (!inTime && !outTime) {
      setError("Give at least one time to correct.")
      return
    }
    // No client-side ordering check: on a night shift 06:00 legitimately
    // follows 22:00, and only the server knows the employee's shift. It
    // answers with the reason if the pair is genuinely the wrong way round.
    if (note.trim().length < 5) {
      setError("Say what happened, in a few words.")
      return
    }
    setError(null)

    const body = {
      date: format(date, "yyyy-MM-dd"),
      reason,
      ...(inTime ? { inTime } : {}),
      ...(outTime ? { outTime } : {}),
      note: note.trim(),
    }

    if (user?.source !== "api") {
      toast.success("Regularisation sent for approval (demo)", {
        description: `${body.date} · ${REGULARISATION_REASON_LABEL[reason]}`,
      })
      reset()
      setOpen(false)
      return
    }

    raise.mutate(body, {
      onSuccess: () => {
        toast.success("Sent for approval", {
          description:
            "Your manager decides. Nothing on the register changes until they approve.",
        })
        reset()
        setOpen(false)
      },
      onError: (apiError) => {
        const code =
          apiError instanceof ApiError
            ? ((apiError.body as { error?: string })?.error ?? "")
            : ""
        toast.error("Could not send", {
          description:
            code === "ALREADY_PENDING"
              ? "You already have a request open for that date."
              : code === "MONTH_LOCKED"
                ? "That period is locked — ask HR to reopen it before correcting a day."
                : code === "FUTURE_DATE"
                  ? "That date has not happened yet."
                  : (apiError instanceof ApiError &&
                      (apiError.body as { detail?: string })?.detail) ||
                    "Check the date and times and try again.",
        })
      },
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <SheetTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Wrench />
            Regularise
          </Button>
        )}
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Regularise a day</SheetTitle>
          <SheetDescription>
            For a missed punch or a wrong time. Your manager approves it, and the correction is
            added to the day — the original record is kept beside it.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="reg-date">Date</FieldLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <Button id="reg-date" variant="outline" className="justify-start font-normal">
                    <CalendarIcon />
                    {format(date, "EEEE, d MMMM yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(next) => next && setDate(next)}
                    disabled={{ after: new Date() }}
                  />
                </PopoverContent>
              </Popover>
              <FieldDescription>Today or earlier.</FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="reg-reason">What went wrong</FieldLabel>
              <Select
                value={reason}
                onValueChange={(value) => setReason(value as RegularisationReason)}
              >
                <SelectTrigger id="reg-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REGULARISATION_REASONS.map((candidate) => (
                    <SelectItem key={candidate} value={candidate}>
                      {REGULARISATION_REASON_LABEL[candidate]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="reg-in">In time</FieldLabel>
                <Input
                  id="reg-in"
                  type="time"
                  value={inTime}
                  onChange={(event) => setInTime(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="reg-out">Out time</FieldLabel>
                <Input
                  id="reg-out"
                  type="time"
                  value={outTime}
                  onChange={(event) => setOutTime(event.target.value)}
                />
              </Field>
            </div>
            <FieldDescription>Fill only the end that needs correcting.</FieldDescription>

            <Field data-invalid={error !== null}>
              <FieldLabel htmlFor="reg-note">What happened</FieldLabel>
              <Textarea
                id="reg-note"
                rows={3}
                value={note}
                placeholder="Phone battery died before I could punch out."
                onChange={(event) => setNote(event.target.value)}
              />
              <FieldDescription>
                Your manager sees this — the more specific, the faster it clears.
              </FieldDescription>
              {error ? <FieldError errors={[{ message: error }]} /> : null}
            </Field>
          </FieldGroup>
        </div>
        <SheetFooter className="flex-row border-t">
          <SheetClose asChild>
            <Button variant="outline" className="flex-1">
              Cancel
            </Button>
          </SheetClose>
          <Button className="flex-1" onClick={submit} disabled={raise.isPending}>
            Send for approval
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
