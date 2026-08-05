import * as React from "react"
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  attendanceSettingsSchema,
  type AttendanceSettings,
  type ShiftSpec,
} from "@attendance/shared"

/**
 * App-wide configuration: attendance settings, roster rules, branding.
 * One provider so an edit in Settings is live on Punch, Roster and the
 * Register immediately — the same shape the API's /settings responses take,
 * so Phase-3 wiring replaces the storage, not the consumers.
 */

export interface WeeklyOffPattern {
  id: string
  name: string
  /** 0 = Sunday. */
  fixedDays: number[]
  /** 1-based Saturday occurrences that are also off. */
  alternateSaturdays: number[]
}

export interface RotationConfig {
  enabled: boolean
  department: string
  /** Shift ids, advanced one step per ISO week. */
  cycle: string[]
}

export interface RosterRule {
  id: string
  label: string
  detail: string
  enabled: boolean
}

export interface Branding {
  companyName: string
  branchLabel: string
  /** Data URL for now; object storage takes over in Phase 3. */
  logoDataUrl: string | null
  /** Printed on document mastheads (PO today; estimates/invoices later). */
  address: string
  gstin: string
  phone: string
  email: string
}

export interface RosterConfig {
  shifts: ShiftSpec[]
  patterns: WeeklyOffPattern[]
  /** department → pattern id; anything unlisted uses the first pattern. */
  departmentPatterns: Record<string, string>
  rotation: RotationConfig
  rules: RosterRule[]
  /** dateISO → holiday name (kept for the local/demo path). */
  holidays: Record<string, string>
  /** dateISO → declared half working day name. */
  halfDays: Record<string, string>
}

export const DEFAULT_SHIFTS: ShiftSpec[] = [
  { id: "gen", name: "General", short: "G", startMin: 540, endMin: 1080, breakMin: 60 },
  { id: "morn", name: "Morning", short: "M", startMin: 360, endMin: 840, breakMin: 30 },
  { id: "eve", name: "Evening", short: "E", startMin: 840, endMin: 1320, breakMin: 30 },
  { id: "night", name: "Night", short: "N", startMin: 1320, endMin: 360, breakMin: 30 },
]

export const DEFAULT_PATTERNS: WeeklyOffPattern[] = [
  { id: "sun", name: "Sunday off", fixedDays: [0], alternateSaturdays: [] },
  { id: "sun-alt-sat", name: "Sunday + 2nd/4th Saturday", fixedDays: [0], alternateSaturdays: [2, 4] },
  { id: "sun-sat", name: "Sunday + Saturday", fixedDays: [0, 6], alternateSaturdays: [] },
]

export const DEFAULT_ROSTER_RULES: RosterRule[] = [
  { id: "weekly-off", label: "Apply weekly-off patterns", detail: "Per-department pattern, editable below.", enabled: true },
  { id: "holidays", label: "Apply the holiday calendar", detail: "Declared holidays override every cell in the column.", enabled: true },
  { id: "rotation", label: "Rotate shifts weekly", detail: "The rotation department cycles one step per ISO week.", enabled: true },
  { id: "default-shift", label: "Fall back to the default shift", detail: "Anyone outside a rotation gets their assigned shift.", enabled: true },
]

const DEFAULT_ROSTER: RosterConfig = {
  shifts: DEFAULT_SHIFTS,
  patterns: DEFAULT_PATTERNS,
  departmentPatterns: { Finance: "sun-alt-sat", HR: "sun-alt-sat" },
  rotation: { enabled: true, department: "Production", cycle: ["morn", "eve", "night"] },
  rules: DEFAULT_ROSTER_RULES,
  holidays: { "2026-08-15": "Independence Day", "2026-08-26": "Ganesh Chaturthi" },
  halfDays: { "2026-08-25": "Ganesh Chaturthi eve" },
}

const DEFAULT_BRANDING: Branding = {
  companyName: "Delta Attendance",
  branchLabel: "Mumbai HO",
  logoDataUrl: null,
  address: "",
  gstin: "",
  phone: "",
  email: "",
}

interface AppConfigValue {
  settings: AttendanceSettings
  setSetting: <K extends keyof AttendanceSettings>(key: K, value: AttendanceSettings[K]) => void
  resetSettings: () => void

  roster: RosterConfig
  setRoster: React.Dispatch<React.SetStateAction<RosterConfig>>
  declareDay: (dateISO: string, name: string, type: "HOLIDAY" | "HALF_DAY") => void
  clearDay: (dateISO: string) => void

  branding: Branding
  setBranding: React.Dispatch<React.SetStateAction<Branding>>
}

const AppConfigContext = React.createContext<AppConfigValue | null>(null)

const STORAGE_KEY = "attendance.config.v1"

export function AppConfigProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = React.useState<AttendanceSettings>(DEFAULT_ATTENDANCE_SETTINGS)
  const [roster, setRoster] = React.useState<RosterConfig>(DEFAULT_ROSTER)
  const [branding, setBranding] = React.useState<Branding>(DEFAULT_BRANDING)

  // Survive a refresh — the running store until the API takes over.
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw)
      if (saved.settings) setSettings(attendanceSettingsSchema.parse(saved.settings))
      if (saved.roster) setRoster({ ...DEFAULT_ROSTER, ...saved.roster, halfDays: saved.roster.halfDays ?? {} })
      if (saved.branding) setBranding({ ...DEFAULT_BRANDING, ...saved.branding })
    } catch {
      // A corrupt blob must never brick the app — fall back to defaults.
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, roster, branding }))
  }, [settings, roster, branding])

  const value = React.useMemo<AppConfigValue>(
    () => ({
      settings,
      setSetting: (key, entry) => setSettings((prev) => ({ ...prev, [key]: entry })),
      resetSettings: () => setSettings(DEFAULT_ATTENDANCE_SETTINGS),
      roster,
      setRoster,
      declareDay: (dateISO, name, type) =>
        setRoster((prev) => {
          // A date is one thing or the other — declaring clears the other map.
          const holidays = { ...prev.holidays }
          const halfDays = { ...prev.halfDays }
          delete holidays[dateISO]
          delete halfDays[dateISO]
          if (type === "HOLIDAY") holidays[dateISO] = name
          else halfDays[dateISO] = name
          return { ...prev, holidays, halfDays }
        }),
      clearDay: (dateISO) =>
        setRoster((prev) => {
          const holidays = { ...prev.holidays }
          const halfDays = { ...prev.halfDays }
          delete holidays[dateISO]
          delete halfDays[dateISO]
          return { ...prev, holidays, halfDays }
        }),
      branding,
      setBranding,
    }),
    [settings, roster, branding]
  )

  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>
}

export function useAppConfig() {
  const context = React.useContext(AppConfigContext)
  if (!context) throw new Error("useAppConfig must be used inside AppConfigProvider")
  return context
}
