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

import { useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"

import { ApiError, ApiUnreachable, apiFetch } from "@/lib/api"
import { enqueuePunch, flushQueue, queuedCount } from "@/lib/offline-queue"
import { useAttendanceDays } from "@/lib/queries"
import { captureSelfie, type SelfieDerivatives } from "@/lib/selfie"
import { useAppConfig } from "@/lib/app-config"
import { useSession } from "@/lib/session"

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
    ring: "border-status-present/50",
    label: "Early",
    badge: "success",
  },
  ON_TIME: {
    clock: "text-status-wfh",
    ring: "border-status-wfh/50",
    label: "On time",
    badge: "info",
  },
  LATE: {
    clock: "text-status-absent",
    ring: "border-status-absent/50",
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
  const { user } = useSession()
  const now = useServerClock()
  const queryClient = useQueryClient()

  // ---- live camera -------------------------------------------------------
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const [cameraState, setCameraState] = React.useState<"starting" | "live" | "denied">("starting")
  const [lastShot, setLastShot] = React.useState<SelfieDerivatives | null>(null)

  React.useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((mediaStream) => {
        if (cancelled) {
          mediaStream.getTracks().forEach((track) => track.stop())
          return
        }
        stream = mediaStream
        if (videoRef.current) videoRef.current.srcObject = mediaStream
        setCameraState("live")
      })
      .catch(() => setCameraState("denied"))
    return () => {
      cancelled = true
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  // ---- offline queue -----------------------------------------------------
  const [pendingSync, setPendingSync] = React.useState(0)
  const refreshQueueCount = React.useCallback(() => {
    void queuedCount().then(setPendingSync).catch(() => {})
  }, [])
  React.useEffect(refreshQueueCount, [refreshQueueCount])

  const syncNow = React.useCallback(async () => {
    const { sent, kept } = await flushQueue((body) =>
      apiFetch("/punches", { method: "POST", body: JSON.stringify(body) })
    )
    refreshQueueCount()
    void queryClient.invalidateQueries({ queryKey: ["attendance-days"] })
    if (sent > 0) {
      toast.success(`${sent} queued punch${sent === 1 ? "" : "es"} synced`, {
        description: "Flagged OFFLINE_SYNCED with the delay visible to HR.",
      })
    }
    if (kept > 0) toast.warning(`${kept} still queued — connection not back yet`)
  }, [refreshQueueCount, queryClient])

  React.useEffect(() => {
    const onOnline = () => {
      if (user?.source === "api") void syncNow()
    }
    window.addEventListener("online", onOnline)
    return () => window.removeEventListener("online", onOnline)
  }, [syncNow, user?.source])

  // ---- today's real day (API mode) ---------------------------------------
  const todayISO = format(new Date(), "yyyy-MM-dd")
  const { rows: todayRows, source: daySource } = useAttendanceDays(todayISO)
  const ownDay =
    daySource === "api"
      ? todayRows.find((row) => row.employeeId === user?.employeeId)
      : undefined
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

  const [posting, setPosting] = React.useState(false)

  /**
   * With an API session this is a real POST /punches — idempotency key, GPS,
   * server-side window/geofence evaluation. The demo fallback keeps the local
   * behaviour so the screen still demonstrates without the API.
   */
  const handlePunch = async () => {
    const stamp = `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`

    if (user?.source !== "api") {
      if (cameraState === "live" && videoRef.current && user) {
        try {
          setLastShot(
            captureSelfie(
              videoRef.current,
              { name: user.name, at: now, lat: DEVICE.lat, lng: DEVICE.lng },
              settings
            )
          )
        } catch {
          /* capture is best-effort in demo mode */
        }
      }
      setPunchedIn((prev) => !prev)
      toast[punctuality === "LATE" ? "warning" : "success"](
        punchedIn ? "Punched out (demo)" : "Punched in (demo)",
        { description: `${stamp} · ${mood.label.toLowerCase()} · start the API for real punches` }
      )
      return
    }

    setPosting(true)
    // Capture happens at punch time — in-app only, gallery has no path in.
    let selfie: SelfieDerivatives | null = null
    if (cameraState === "live" && videoRef.current) {
      try {
        selfie = captureSelfie(
          videoRef.current,
          { name: user.name, at: now, lat: DEVICE.lat, lng: DEVICE.lng },
          settings
        )
        setLastShot(selfie)
      } catch {
        selfie = null
      }
    }
    const at = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}T${two(now.getHours())}:${two(now.getMinutes())}`
    const punchPayload = {
      employeeId: user.employeeId,
      type: punchedIn ? "OUT" : "IN",
      at,
      lat: DEVICE.lat,
      lng: DEVICE.lng,
      accuracyM: 12,
      dayPart,
      idempotencyKey: crypto.randomUUID(),
      ...(selfie ? { selfieThumb: selfie.thumb, selfieView: selfie.view } : {}),
    }
    try {
      const result = await apiFetch<{
        punch: { flags: string[]; businessDate: string }
        needsApproval: boolean
        evaluation: { explanation: string }
        idempotent?: boolean
      }>("/punches", { method: "POST", body: JSON.stringify(punchPayload) })
      setPunchedIn((prev) => !prev)
      void queryClient.invalidateQueries({ queryKey: ["attendance-days"] })
      const flagged = result.punch.flags.filter((flag) => flag !== "ON_TIME")
      if (result.needsApproval) {
        toast.warning(punchedIn ? "Punched out — flagged" : "Punched in — flagged", {
          description: `${flagged.join(", ")} · sent for L1 approval. ${result.evaluation.explanation}`,
        })
      } else {
        toast.success(punchedIn ? "Punched out" : "Punched in", {
          description: `${stamp} server time · on time · ${result.punch.businessDate}`,
        })
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        toast.warning("Duplicate punch", {
          description: `Within the ${settings.minPunchGapMinutes}-minute gap — the first punch stands.`,
        })
      } else if (error instanceof ApiError && error.status === 422) {
        toast.error("Punch refused: outside the window", {
          description: "The hard block is ON in Settings. Turn it off to record-and-flag instead.",
        })
      } else if (error instanceof ApiUnreachable) {
        // The real §3 queue: IndexedDB, selfie included, replayed on reconnect.
        await enqueuePunch({
          id: punchPayload.idempotencyKey as string,
          body: punchPayload,
          queuedAt: new Date().toISOString(),
        })
        refreshQueueCount()
        setPunchedIn((prev) => !prev)
        toast.warning("Offline — punch queued on this device", {
          description: "It will sync automatically when the connection returns.",
        })
      } else {
        toast.error("Punch failed", { description: String(error) })
      }
    } finally {
      setPosting(false)
    }
  }

  return (
    <Page>
      <PageHeader
        title="Punch"
        description="Server time is authoritative — the device clock is never trusted."
        actions={
          <>
            <Badge variant={user?.source === "api" ? "info" : "outline"} className="h-7 px-3">
              {user?.source === "api" ? "Live API" : "Demo mode"}
            </Badge>
            <Badge variant={punchedIn ? "success" : "outline"} className="h-7 px-3">
              {punchedIn ? "Currently in" : "Not punched in"}
            </Badge>
          </>
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
                  <div className="bg-muted relative min-h-44 flex-1 overflow-hidden rounded-lg border">
                    {/* Mirrored preview, un-mirrored capture — like every phone camera. */}
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="absolute inset-0 size-full -scale-x-100 object-cover"
                    />
                    {cameraState !== "live" ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
                        <Camera className="text-muted-foreground size-8" />
                        <p className="text-sm font-medium">
                          {cameraState === "starting" ? "Starting camera…" : "Camera unavailable"}
                        </p>
                        <p className="text-muted-foreground max-w-xs text-xs">
                          {cameraState === "denied"
                            ? "Allow camera access to punch with a selfie. Gallery upload is never an option."
                            : "In-app capture only — the stamped selfie stores two small WebP derivatives."}
                        </p>
                      </div>
                    ) : null}
                    {lastShot ? (
                      <img
                        src={lastShot.thumb}
                        alt="Last punch selfie"
                        className="absolute right-2 bottom-2 size-14 rounded-md border-2 border-white/80 object-cover shadow-sm"
                      />
                    ) : null}
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
                    <Button size="lg" className="w-full" disabled={posting} onClick={() => void handlePunch()}>
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
                    value={
                      pendingSync > 0
                        ? `${pendingSync} punch${pendingSync === 1 ? "" : "es"} waiting to sync`
                        : "Nothing pending — punches sync on reconnect"
                    }
                    tone={pendingSync > 0 ? "warning" : "outline"}
                    action={
                      pendingSync > 0 ? (
                        <Button variant="outline" size="sm" onClick={() => void syncNow()}>
                          Sync now
                        </Button>
                      ) : undefined
                    }
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
                  {ownDay?.firstInAt ? (
                    <ol className="flex flex-col">
                      {[
                        {
                          at: ownDay.firstInAt,
                          label: "Punch in",
                          detail: ownDay.flags.filter((flag) => flag !== "ON_TIME").join(", ") || "On time",
                          tone: ownDay.lateMinutes > settings.lateGraceMinutes ? "warning" : "success",
                        },
                        ...(ownDay.lastOutAt
                          ? [{ at: ownDay.lastOutAt, label: "Punch out", detail: `Worked ${Math.floor(ownDay.workedMinutes / 60)}h ${String(ownDay.workedMinutes % 60).padStart(2, "0")}m`, tone: "muted" as const }]
                          : []),
                      ].map((entry, index, list) => (
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
                            {index < list.length - 1 ? <span className="bg-border w-px flex-1" /> : null}
                          </div>
                          <div className="flex-1 pb-4">
                            <p className="flex items-center gap-2 text-sm font-medium">
                              <span className="tabular-nums">{entry.at}</span>
                              <span className="text-muted-foreground font-normal">{entry.label}</span>
                            </p>
                            <p className="text-muted-foreground text-xs">{entry.detail}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : daySource === "api" ? (
                    <p className="text-muted-foreground text-sm">
                      No punches yet today. Your first punch in starts the day.
                    </p>
                  ) : TODAY_PUNCHES.length === 0 ? (
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
