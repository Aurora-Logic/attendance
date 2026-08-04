import * as React from "react"
import { toast } from "sonner"
import { RotateCcw } from "lucide-react"
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  LATE_PENALTY,
  LATE_PERIOD,
  SETTINGS_SCOPES,
  estimateSelfieStorage,
  evaluateLate,
  type AttendanceSettings,
} from "@attendance/shared"

import { Page, PageBody, PageHeader } from "@/components/page-shell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type Setter = <K extends keyof AttendanceSettings>(key: K, value: AttendanceSettings[K]) => void

function NumberField({
  id,
  label,
  description,
  unit,
  value,
  onChange,
  step = 1,
}: {
  id: string
  label: string
  description: string
  unit: string
  value: number
  onChange: (value: number) => void
  step?: number
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id={id}
          type="number"
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <InputGroupAddon align="inline-end">{unit}</InputGroupAddon>
      </InputGroup>
      <FieldDescription>{description}</FieldDescription>
    </Field>
  )
}

function SwitchField({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <Field orientation="horizontal">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
    </Field>
  )
}

/** Live preview so the effect of the late rule is visible while editing it. */
function LatePreview({ settings }: { settings: AttendanceSettings }) {
  const rows = [
    { minutes: settings.lateGraceMinutes, priors: 0 },
    { minutes: settings.lateGraceMinutes + 5, priors: 0 },
    { minutes: settings.lateGraceMinutes + 5, priors: settings.lateMarksAllowed - 1 },
    { minutes: settings.lateGraceMinutes + 20, priors: settings.lateMarksAllowed },
    { minutes: settings.lateGraceMinutes + 20, priors: settings.lateMarksAllowed + 3 },
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle>What this rule does</CardTitle>
        <CardDescription>
          Recomputed from the values above using the same function the nightly job runs.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rows.map((row, index) => {
          const result = evaluateLate(row.minutes, Math.max(row.priors, 0), settings)
          return (
            <div
              key={index}
              className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <span className="text-muted-foreground w-40 shrink-0 tabular-nums">
                +{row.minutes}m · {Math.max(row.priors, 0)} prior
              </span>
              <Badge
                variant={
                  result.penalty === "NONE"
                    ? result.isLate
                      ? "secondary"
                      : "outline"
                    : "destructive"
                }
              >
                {result.penalty === "NONE" ? (result.isLate ? "LATE" : "ON TIME") : result.penalty}
              </Badge>
              <span className="text-muted-foreground">{result.explanation}</span>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

/**
 * Compression is a storage decision, so the storage figure is shown next to the
 * knobs rather than left for someone to discover at 200 GB.
 */
function StoragePreview({ settings }: { settings: AttendanceSettings }) {
  const [headcount, setHeadcount] = React.useState(500)
  const estimate = estimateSelfieStorage(settings, headcount)

  return (
    <Card>
      <CardHeader>
        <CardTitle>What this costs to store</CardTitle>
        <CardDescription>
          Two derivatives are kept per punch — a thumbnail for lists and a full-view image that
          opens on click. Any punch on any date stays viewable; the original is discarded.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field className="max-w-xs">
          <FieldLabel htmlFor="storage-headcount">Estimate for</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="storage-headcount"
              type="number"
              step={50}
              value={headcount}
              onChange={(event) => setHeadcount(Math.max(Number(event.target.value), 1))}
            />
            <InputGroupAddon align="inline-end">employees</InputGroupAddon>
          </InputGroup>
          <FieldDescription>At 2 punches a day over 26 working days.</FieldDescription>
        </Field>

        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { label: "Thumbnail", value: `${estimate.thumbKb} KB`, hint: "per punch" },
            { label: "Full view", value: `${estimate.viewKb} KB`, hint: "opens on click" },
            {
              label: "Per month",
              value: `${estimate.monthlyGb} GB`,
              hint: `${estimate.imagesPerMonth.toLocaleString("en-IN")} images`,
            },
            {
              label: "Held at once",
              value: `${estimate.retainedGb} GB`,
              hint: `${settings.selfieRetentionMonths}-month retention`,
            },
          ].map((tile) => (
            <div key={tile.label} className="rounded-md border px-3 py-2.5">
              <p className="text-muted-foreground text-xs">{tile.label}</p>
              <p className="text-lg font-semibold tabular-nums">{tile.value}</p>
              <p className="text-muted-foreground text-xs">{tile.hint}</p>
            </div>
          ))}
        </div>

        {settings.selfieKeepOriginal ? (
          <Alert variant="destructive">
            <AlertTitle>Originals are being retained</AlertTitle>
            <AlertDescription>
              This is roughly 40× the storage of the derivatives and nothing in the system reads
              the original. Turn it off unless you have a specific evidentiary reason.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function SettingsPage() {
  const [settings, setSettings] = React.useState<AttendanceSettings>(
    DEFAULT_ATTENDANCE_SETTINGS
  )
  const set: Setter = (key, value) => setSettings((prev) => ({ ...prev, [key]: value }))

  return (
    <Page>
      <PageHeader
        title="Settings"
        description="Every rule is data. Nothing here is compiled into the app."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSettings(DEFAULT_ATTENDANCE_SETTINGS)
                toast("Reset to system defaults")
              }}
            >
              <RotateCcw />
              Reset
            </Button>
            <Button size="sm" onClick={() => toast.success("Settings saved")}>
              Save changes
            </Button>
          </>
        }
      />
      <PageBody>
        <Tabs defaultValue="late" className="gap-4">
          <TabsList className="w-fit max-w-full justify-start overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsTrigger value="late">Late & early</TabsTrigger>
            <TabsTrigger value="windows">Punch windows</TabsTrigger>
            <TabsTrigger value="day">Day computation</TabsTrigger>
            <TabsTrigger value="capture">Capture</TabsTrigger>
            <TabsTrigger value="approvals">Approvals & OT</TabsTrigger>
          </TabsList>

          <TabsContent value="late" className="flex flex-col gap-4">
            <Alert>
              <AlertTitle>Resolution order</AlertTitle>
              <AlertDescription>
                A value set here is the company default. It is overridden, in order, by{" "}
                {SETTINGS_SCOPES.map((scope) => scope.toLowerCase()).join(" ← ")} — the most
                specific scope wins.
              </AlertDescription>
            </Alert>

            <Card>
              <CardHeader>
                <CardTitle>Late policy</CardTitle>
                <CardDescription>
                  How many late marks are forgiven, and what the next one costs.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldSet>
                  <FieldGroup className="sm:grid sm:grid-cols-2 sm:gap-4">
                    <NumberField
                      id="late-grace"
                      label="Grace period"
                      unit="min"
                      description="A punch this many minutes after shift start is still on time. Beyond it, the day gets a late mark."
                      value={settings.lateGraceMinutes}
                      onChange={(value) => set("lateGraceMinutes", value)}
                    />
                    <NumberField
                      id="late-allowed"
                      label="Late marks allowed"
                      unit="marks"
                      description="Forgiven before any penalty applies. Set to 0 to penalise the first late."
                      value={settings.lateMarksAllowed}
                      onChange={(value) => set("lateMarksAllowed", value)}
                    />
                    <Field>
                      <FieldLabel htmlFor="late-period">Allowance resets every</FieldLabel>
                      <Select
                        value={settings.latePeriod}
                        onValueChange={(value) =>
                          set("latePeriod", value as AttendanceSettings["latePeriod"])
                        }
                      >
                        <SelectTrigger id="late-period">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LATE_PERIOD.map((period) => (
                            <SelectItem key={period} value={period}>
                              {period === "MONTH" ? "Month" : "Week"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        The counter zeroes at the start of each period.
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="late-penalty">Penalty past the allowance</FieldLabel>
                      <Select
                        value={settings.latePenalty}
                        onValueChange={(value) =>
                          set("latePenalty", value as AttendanceSettings["latePenalty"])
                        }
                      >
                        <SelectTrigger id="late-penalty">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LATE_PENALTY.map((penalty) => (
                            <SelectItem key={penalty} value={penalty}>
                              {penalty === "NONE" ? "No penalty" : penalty.replace("_", " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        What the day becomes once the allowance is used up.
                      </FieldDescription>
                    </Field>
                  </FieldGroup>

                  <SwitchField
                    id="late-repeats"
                    label="Penalise every subsequent late"
                    description="On: every late past the allowance is penalised. Off: only the first breach is."
                    checked={settings.latePenaltyRepeats}
                    onChange={(checked) => set("latePenaltyRepeats", checked)}
                  />
                </FieldSet>
              </CardContent>
            </Card>

            <LatePreview settings={settings} />

            <Card>
              <CardHeader>
                <CardTitle>Early exit</CardTitle>
                <CardDescription>Mirrors the late rule at the other end of the shift.</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup className="sm:grid sm:grid-cols-3 sm:gap-4">
                  <NumberField
                    id="early-grace"
                    label="Grace period"
                    unit="min"
                    description="Leaving this early is not flagged."
                    value={settings.earlyExitGraceMinutes}
                    onChange={(value) => set("earlyExitGraceMinutes", value)}
                  />
                  <NumberField
                    id="early-allowed"
                    label="Early exits allowed"
                    unit="marks"
                    description="Forgiven per period."
                    value={settings.earlyExitMarksAllowed}
                    onChange={(value) => set("earlyExitMarksAllowed", value)}
                  />
                  <Field>
                    <FieldLabel htmlFor="early-penalty">Penalty</FieldLabel>
                    <Select
                      value={settings.earlyExitPenalty}
                      onValueChange={(value) =>
                        set("earlyExitPenalty", value as AttendanceSettings["earlyExitPenalty"])
                      }
                    >
                      <SelectTrigger id="early-penalty">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LATE_PENALTY.map((penalty) => (
                          <SelectItem key={penalty} value={penalty}>
                            {penalty === "NONE" ? "No penalty" : penalty.replace("_", " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>Applied past the allowance.</FieldDescription>
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="windows">
            <Card>
              <CardHeader>
                <CardTitle>Punch windows</CardTitle>
                <CardDescription>
                  Inside the window a punch is ON_TIME. Outside it the punch is still recorded and
                  routed to L1 — blocking it would turn a present employee into an absent one.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldSet>
                  <FieldGroup className="sm:grid sm:grid-cols-2 sm:gap-4">
                    <NumberField
                      id="in-before"
                      label="Punch-in window before shift start"
                      unit="min"
                      description="Earliest an in-punch is accepted as on time."
                      value={settings.punchInWindowBeforeMin}
                      onChange={(value) => set("punchInWindowBeforeMin", value)}
                    />
                    <NumberField
                      id="in-after"
                      label="Punch-in window after shift start"
                      unit="min"
                      description="Latest an in-punch is accepted as on time."
                      value={settings.punchInWindowAfterMin}
                      onChange={(value) => set("punchInWindowAfterMin", value)}
                    />
                    <NumberField
                      id="out-before"
                      label="Punch-out window before shift end"
                      unit="min"
                      description="Earliest an out-punch is accepted as on time."
                      value={settings.punchOutWindowBeforeMin}
                      onChange={(value) => set("punchOutWindowBeforeMin", value)}
                    />
                    <NumberField
                      id="out-after"
                      label="Punch-out window after shift end"
                      unit="min"
                      description="Latest an out-punch is accepted as on time."
                      value={settings.punchOutWindowAfterMin}
                      onChange={(value) => set("punchOutWindowAfterMin", value)}
                    />
                  </FieldGroup>
                  <SwitchField
                    id="hard-block"
                    label="Hard block outside the window"
                    description="Off by design. Turning this on rejects the punch outright and will create payroll disputes."
                    checked={settings.hardBlockOutsideWindow}
                    onChange={(checked) => set("hardBlockOutsideWindow", checked)}
                  />
                  <NumberField
                    id="min-gap"
                    label="Minimum gap between punches"
                    unit="min"
                    description="Suppresses double-taps and retries."
                    value={settings.minPunchGapMinutes}
                    onChange={(value) => set("minPunchGapMinutes", value)}
                  />
                </FieldSet>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="day">
            <Card>
              <CardHeader>
                <CardTitle>Day computation</CardTitle>
                <CardDescription>
                  Drives <code className="text-xs">attendance_days.payable_units</code>, the single
                  number payroll multiplies.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup className="sm:grid sm:grid-cols-2 sm:gap-4">
                  <NumberField
                    id="half-hours"
                    label="Half-day minimum hours"
                    unit="hrs"
                    step={0.5}
                    description="At or above this but below full day → HALF_DAY (0.5 payable)."
                    value={settings.halfDayMinHours}
                    onChange={(value) => set("halfDayMinHours", value)}
                  />
                  <NumberField
                    id="full-hours"
                    label="Full-day minimum hours"
                    unit="hrs"
                    step={0.5}
                    description="At or above this → PRESENT (1.0 payable)."
                    value={settings.fullDayMinHours}
                    onChange={(value) => set("fullDayMinHours", value)}
                  />
                  <NumberField
                    id="geofence"
                    label="Geofence radius"
                    unit="m"
                    step={10}
                    description="Per branch. Outside → OUT_OF_GEOFENCE, flagged not blocked. Field employees are exempt."
                    value={settings.geofenceRadiusM}
                    onChange={(value) => set("geofenceRadiusM", value)}
                  />
                </FieldGroup>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="capture" className="flex flex-col gap-4">
            <StoragePreview settings={settings} />

            <Card>
              <CardHeader>
                <CardTitle>Selfie capture & retention</CardTitle>
                <CardDescription>
                  Images live in object storage, never the database. Consent is recorded separately
                  per employee.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldSet>
                  <FieldGroup className="sm:grid sm:grid-cols-2 sm:gap-4">
                    <NumberField
                      id="thumb-px"
                      label="Thumbnail size"
                      unit="px"
                      step={20}
                      description="Long edge of the grid thumbnail shown in registers and lists."
                      value={settings.selfieThumbMaxPx}
                      onChange={(value) => set("selfieThumbMaxPx", value)}
                    />
                    <NumberField
                      id="thumb-q"
                      label="Thumbnail quality"
                      unit="%"
                      step={5}
                      description="WebP quality. Below 35 the face stops being recognisable."
                      value={settings.selfieThumbQuality}
                      onChange={(value) => set("selfieThumbQuality", value)}
                    />
                    <NumberField
                      id="view-px"
                      label="Full-view size"
                      unit="px"
                      step={40}
                      description="Long edge of the image that opens when a punch is clicked. This is the one that has to stay legible."
                      value={settings.selfieViewMaxPx}
                      onChange={(value) => set("selfieViewMaxPx", value)}
                    />
                    <NumberField
                      id="view-q"
                      label="Full-view quality"
                      unit="%"
                      step={5}
                      description="WebP quality for the openable image. 50–60 keeps a face clear at a fraction of the original."
                      value={settings.selfieViewQuality}
                      onChange={(value) => set("selfieViewQuality", value)}
                    />
                    <NumberField
                      id="retention"
                      label="Retention"
                      unit="months"
                      description="Purge job deletes stored selfies older than this."
                      value={settings.selfieRetentionMonths}
                      onChange={(value) => set("selfieRetentionMonths", value)}
                    />
                  </FieldGroup>
                  <SwitchField
                    id="keep-original"
                    label="Keep the camera original"
                    description="Off by default. A phone selfie is 2–4 MB — roughly 40× the stored derivatives — and nothing in the system reads it."
                    checked={settings.selfieKeepOriginal}
                    onChange={(checked) => set("selfieKeepOriginal", checked)}
                  />
                  <SwitchField
                    id="face"
                    label="Require face detection"
                    description="Blocks capture on-device when no face is present, and re-verifies server-side after upload."
                    checked={settings.requireFaceDetection}
                    onChange={(checked) => set("requireFaceDetection", checked)}
                  />
                  <Field>
                    <FieldLabel htmlFor="tz">Company timezone</FieldLabel>
                    <Input
                      id="tz"
                      value={settings.timezone}
                      onChange={(event) => set("timezone", event.target.value)}
                    />
                    <FieldDescription>
                      Storage is always UTC. This is the render timezone only.
                    </FieldDescription>
                  </Field>
                </FieldSet>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="approvals">
            <Card>
              <CardHeader>
                <CardTitle>Approvals & overtime</CardTitle>
                <CardDescription>
                  L1 is the reporting manager, L2 is HR. Both are configurable per request type.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldSet>
                  <FieldGroup className="sm:grid sm:grid-cols-2 sm:gap-4">
                    <NumberField
                      id="escalate"
                      label="Escalate to L2 after"
                      unit="days"
                      description="L1 inaction past this hands the request to HR."
                      value={settings.approvalEscalateAfterDays}
                      onChange={(value) => set("approvalEscalateAfterDays", value)}
                    />
                    <NumberField
                      id="ot-min"
                      label="Minimum overtime"
                      unit="min"
                      description="Extra time below this is not claimable."
                      value={settings.otMinMinutes}
                      onChange={(value) => set("otMinMinutes", value)}
                    />
                    <NumberField
                      id="ot-mult"
                      label="Overtime multiplier"
                      unit="×"
                      step={0.25}
                      description="Applied to the per-hour rate for approved overtime only."
                      value={settings.otMultiplier}
                      onChange={(value) => set("otMultiplier", value)}
                    />
                  </FieldGroup>
                  <SwitchField
                    id="auto-approve"
                    label="Auto-approve on escalation"
                    description="Off by default. On, an unactioned request approves itself at the escalation deadline."
                    checked={settings.autoApproveOnEscalation}
                    onChange={(checked) => set("autoApproveOnEscalation", checked)}
                  />
                  <SwitchField
                    id="ot-enabled"
                    label="Overtime enabled"
                    description="Turns the overtime claim path on or off company-wide."
                    checked={settings.otEnabled}
                    onChange={(checked) => set("otEnabled", checked)}
                  />
                </FieldSet>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageBody>
    </Page>
  )
}
