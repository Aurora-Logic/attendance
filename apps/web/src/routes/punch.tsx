import * as React from "react"
import { toast } from "sonner"
import {
  Camera,
  CheckCircle2,
  Clock,
  ExternalLink,
  LogIn,
  LogOut,
  MapPin,
  ShieldCheck,
  TriangleAlert,
  WifiOff,
} from "lucide-react"
import { evaluateLate, type LateEvaluation } from "@attendance/shared"

import { checkGeofence, mapsLinkFor, type LatLng } from "@/lib/geo"
import { cn } from "@/lib/utils"
import { Page, PageBody, PageHeader } from "@/components/page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

import { useAppConfig } from "@/lib/app-config"

const SHIFT_START_MINUTES = 9 * 60
const SHIFT_END_MINUTES = 18 * 60

const BRANCH: LatLng = { lat: 19.076, lng: 72.8777 }
const DEVICE: LatLng = { lat: 19.0771, lng: 72.8781 }

const TODAY_PUNCHES: Array<{
  at: string
  label: string
  detail: string
  tone: "success" | "warning" | "muted"
}> = [
  { at: "08:56", label: "Punch in", detail: "On time · inside geofence · face OK", tone: "success" },
  { at: "13:04", label: "Break out", detail: "Lunch", tone: "muted" },
  { at: "13:41", label: "Break in", detail: "37 min break", tone: "muted" },
]

function useServerClock() {
  const [now, setNow] = React.useState(() => new Date())
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

const two = (n: number) => String(n).padStart(2, "0")

type Punctuality = "EARLY" | "ON_TIME" | "LATE"

/** Early is green, on time blue, late red — the clock itself carries the verdict. */
const PUNCTUALITY: Record<
  Punctuality,
  { clock: string; ring: string; label: string; badge: "success" | "info" | "destructive" }
> = {
  EARLY: {
    clock: "text-status-present",
    ring: "ring-status-present/35",
    label: "Early",
    badge: "success",
  },
  ON_TIME: {
    clock: "text-status-wfh",
    ring: "ring-status-wfh/35",
    label: "On time",
    badge: "info",
  },
  LATE: {
    clock: "text-status-absent",
    ring: "ring-status-absent/35",
    label: "Late",
    badge: "destructive",
  },
}

function CaptureCheck({
  icon: Icon,
  label,
  value,
  tone,
  action,
}: {
  icon: React.ElementType
  label: string
  value: string
  tone: "success" | "info" | "warning" | "outline"
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5">
      <Icon className="text-muted-foreground size-4 shrink-0" />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-medium">{label}</span>
        <span className="text-muted-foreground truncate text-xs">{value}</span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {action}
        <Badge variant={tone}>OK</Badge>
      </div>
    </div>
  )
}

export function PunchPage() {
  // Live settings: change the grace in Settings and this screen follows.
  const { settings } = useAppConfig()
  const now = useServerClock()
  const [dayPart, setDayPart] = React.useState("FULL")
  const [punchedIn, setPunchedIn] = React.useState(false)
  const [priorLateMarks] = React.useState(1)

  const minutesNow = now.getHours() * 60 + now.getMinutes()
  const minutesFromStart = minutesNow - SHIFT_START_MINUTES

  const evaluation: LateEvaluation = evaluateLate(
    Math.max(minutesFromStart, 0),
    priorLateMarks,
    settings
  )

  const punctuality: Punctuality =
    minutesFromStart < 0 ? "EARLY" : evaluation.isLate ? "LATE" : "ON_TIME"
  const mood = PUNCTUALITY[punctuality]

  const shiftProgress = Math.min(
    Math.max((minutesFromStart / (SHIFT_END_MINUTES - SHIFT_START_MINUTES)) * 100, 0),
    100
  )
  const allowanceUsed = Math.min(
    (priorLateMarks / Math.max(settings.lateMarksAllowed, 1)) * 100,
    100
  )
  const geo = checkGeofence(DEVICE, BRANCH, settings.geofenceRadiusM, 12)

  const offsetLabel =
    minutesFromStart < 0
      ? `${Math.abs(minutesFromStart)} min before shift start`
      : minutesFromStart === 0
        ? "Exactly at shift start"
        : `${minutesFromStart} min after shift start`

  const handlePunch = () => {
    setPunchedIn((prev) => !prev)
    toast[punctuality === "LATE" ? "warning" : "success"](
      punchedIn ? "Punched out" : "Punched in",
      {
        description: `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())} server time · ${mood.label.toLowerCase()}`,
      }
    )
  }

  return (
    <Page>
      <PageHeader
        title="Punch"
        description="Server time is authoritative — the device clock is never trusted."
        actions={
          <Badge variant={punchedIn ? "success" : "outline"} className="h-7 px-3">
            {punchedIn ? "Currently in" : "Not punched in"}
          </Badge>
        }
      />
      <PageBody>
        {/* No max-width or centring — the grid starts flush with the page
            heading, so the left gutter matches the top one. */}
        <div className="flex h-full w-full flex-col gap-4">
          <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            {/* ---- action column ---- */}
            {/* A ring rather than a 2px border, so this card keeps the same
                1px outline as every other card and the punctuality colour
                reads as emphasis instead of a different component. */}
            <Card className={cn("flex flex-col", mood.ring)}>
              <CardContent className="flex flex-1 flex-col gap-5 pt-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                      <Clock className="size-3.5" />
                      Server time · Asia/Kolkata
                    </p>
                    <p
                      className={cn(
                        "font-mono text-6xl leading-none font-semibold tabular-nums transition-colors sm:text-7xl",
                        mood.clock
                      )}
                    >
                      {two(now.getHours())}:{two(now.getMinutes())}
                      <span className="text-3xl opacity-60 sm:text-4xl">
                        :{two(now.getSeconds())}
                      </span>
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant={mood.badge}>{mood.label}</Badge>
                      <span className="text-muted-foreground text-sm">{offsetLabel}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">General shift</p>
                    <p className="text-muted-foreground text-sm">09:00 – 18:00</p>
                    <p className="text-muted-foreground text-sm">Mumbai HO</p>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Progress value={shiftProgress} />
                  <div className="text-muted-foreground flex justify-between text-xs tabular-nums">
                    <span>09:00</span>
                    <span>{Math.round(shiftProgress)}% elapsed</span>
                    <span>18:00</span>
                  </div>
                </div>

                <Separator />

                {/* Camera fills the remaining height rather than leaving a gap. */}
                <div className="grid flex-1 gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
                  <div className="bg-muted flex min-h-44 flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center">
                    <Camera className="text-muted-foreground size-8" />
                    <p className="text-sm font-medium">Camera preview</p>
                    <p className="text-muted-foreground max-w-xs text-xs">
                      In-app capture only. Gallery upload is blocked, and the selfie is stamped
                      server-side with date, time, name and location.
                    </p>
                  </div>

                  <div className="flex flex-col justify-between gap-3">
                    <div className="flex flex-col gap-2">
                      <p className="text-sm font-medium">Day part</p>
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        value={dayPart}
                        onValueChange={(value) => value && setDayPart(value)}
                        className="w-full"
                      >
                        <ToggleGroupItem value="FULL" className="flex-1">
                          Full
                        </ToggleGroupItem>
                        <ToggleGroupItem value="FIRST_HALF" className="flex-1">
                          1st
                        </ToggleGroupItem>
                        <ToggleGroupItem value="SECOND_HALF" className="flex-1">
                          2nd
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </div>
                    {/* Width is layout; height stays a registry token. */}
                    <Button size="lg" className="w-full" onClick={handlePunch}>
                      {punchedIn ? <LogOut /> : <LogIn />}
                      {punchedIn ? "Punch out" : "Punch in"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ---- status column ---- */}
            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardDescription className="flex items-center gap-1.5">
                    {punctuality === "LATE" ? (
                      <TriangleAlert className="size-3.5" />
                    ) : (
                      <CheckCircle2 className="size-3.5" />
                    )}
                    If you punch now
                  </CardDescription>
                  <CardTitle className={cn("text-xl", mood.clock)}>
                    {punctuality === "EARLY"
                      ? "Counted early"
                      : punctuality === "ON_TIME"
                        ? "Counted on time"
                        : `Late by ${evaluation.minutesLate} min`}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {evaluation.penalty !== "NONE" ? (
                    <Badge variant="destructive">Day becomes {evaluation.penalty}</Badge>
                  ) : null}
                  <p className="text-muted-foreground text-sm">{evaluation.explanation}</p>

                  <Separator />

                  <div className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-medium">Late allowance</span>
                      <span className="text-sm tabular-nums">
                        {priorLateMarks} of {settings.lateMarksAllowed} used
                      </span>
                    </div>
                    <Progress value={allowanceUsed} />
                  </div>

                  <div className="flex flex-col gap-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Grace</span>
                      <span className="font-medium tabular-nums">
                        {settings.lateGraceMinutes} min
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Resets every</span>
                      <span className="font-medium capitalize">
                        {settings.latePeriod.toLowerCase()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Past allowance</span>
                      <Badge variant="destructive">{settings.latePenalty}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="py-0">
                <CardContent className="divide-y p-0">
                  <CaptureCheck
                    icon={MapPin}
                    label="Geofence"
                    value={geo.explanation}
                    tone={geo.inside ? "success" : geo.uncertain ? "warning" : "outline"}
                    action={
                      <Button variant="ghost" size="icon-sm" asChild aria-label="Open in Maps">
                        <a href={mapsLinkFor(DEVICE)} target="_blank" rel="noreferrer">
                          <ExternalLink />
                        </a>
                      </Button>
                    }
                  />
                  <CaptureCheck
                    icon={ShieldCheck}
                    label="Face detection"
                    value={settings.requireFaceDetection ? "On-device, re-verified server-side" : "Disabled"}
                    tone="info"
                  />
                  <CaptureCheck
                    icon={WifiOff}
                    label="Offline queue"
                    value="Nothing pending — punches sync on reconnect"
                    tone="outline"
                  />
                </CardContent>
              </Card>

              {/* Fills the remaining column height instead of leaving a gap. */}
              <Card className="flex min-h-0 flex-1 flex-col">
                <CardHeader>
                  <CardTitle className="text-base">Today</CardTitle>
                  <CardDescription>Append-only — corrections add a row</CardDescription>
                </CardHeader>
                <CardContent className="min-h-0 flex-1 overflow-y-auto">
                  {TODAY_PUNCHES.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      No punches yet today. Your first punch in starts the day.
                    </p>
                  ) : (
                    <ol className="flex flex-col">
                      {TODAY_PUNCHES.map((entry, index) => (
                        <li key={entry.at} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <span
                              className={cn(
                                "mt-1.5 size-2 shrink-0 rounded-full",
                                entry.tone === "success"
                                  ? "bg-status-present"
                                  : entry.tone === "warning"
                                    ? "bg-status-half-day"
                                    : "bg-muted-foreground"
                              )}
                            />
                            {index < TODAY_PUNCHES.length - 1 ? (
                              <span className="bg-border w-px flex-1" />
                            ) : null}
                          </div>
                          <div className="flex-1 pb-4">
                            <p className="flex items-center gap-2 text-sm font-medium">
                              <span className="tabular-nums">{entry.at}</span>
                              <span className="text-muted-foreground font-normal">
                                {entry.label}
                              </span>
                            </p>
                            <p className="text-muted-foreground text-xs">{entry.detail}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
