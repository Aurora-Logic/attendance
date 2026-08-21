import { humaniseEnum } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ATTENDANCE_FLAGS, type AttendanceStatus } from '@vyuha/shared';

/**
 * How an attendance day says what it is (REQ-E-02, REQ-E-04).
 *
 * Colour comes from the theme's semantic tokens and nothing else. There are
 * four colour families available - success, warning, info, destructive - and
 * eight statuses, so the system is two-dimensional: the family says what kind
 * of day it is, and the treatment (filled tint against outline) separates a
 * resolved day from its partial or derived variant. PRESENT and HALF_DAY are
 * both the success family because a half day is half a present day; ON_DUTY
 * and ON_LEAVE are both information about an authorised absence from the desk.
 *
 * The `color-mix` in the light-mode text colour is not decoration. Measured
 * against a 10% tint of the same token on the light background:
 *
 *   raw token   success 3.73  warning 3.09  info 4.19  destructive 4.31
 *   mixed 20%   success 5.60  warning 5.14  info 6.51  destructive 6.82
 *
 * NFR-07 asks for WCAG AA, which is 4.5 for text this size, so the raw amber
 * and green fail and the mix is what makes them pass. Dark mode uses the token
 * directly - its values are already lifted for a dark ground and land at
 * 4.0-4.6 against the same tint, which is where shadcn's own destructive badge
 * sits.
 *
 * --primary is deliberately unused here: at oklch(0.398) on the dark
 * background it measures 1.96 against the page and 1.76 against a tint, which
 * is unreadable. It is a fill colour in this theme, not a text colour.
 */

/**
 * Exported so a second surface that carries a state — the holiday calendar —
 * composes its tones from the same six families rather than re-deriving the
 * contrast maths documented above.
 */
export type Family = 'success' | 'warning' | 'info' | 'destructive' | 'neutral' | 'quiet';
type Treatment = 'filled' | 'outline';

export const FAMILY_TEXT: Record<Family, string> = {
  success: 'text-[color-mix(in_oklch,var(--success),var(--foreground)_20%)] dark:text-success',
  warning: 'text-[color-mix(in_oklch,var(--warning),var(--foreground)_20%)] dark:text-warning',
  info: 'text-[color-mix(in_oklch,var(--info),var(--foreground)_20%)] dark:text-info',
  destructive: 'text-destructive',
  neutral: 'text-foreground',
  quiet: 'text-muted-foreground',
};

export const FAMILY_FILL: Record<Family, string> = {
  success: 'bg-success/10 dark:bg-success/20',
  warning: 'bg-warning/10 dark:bg-warning/20',
  info: 'bg-info/10 dark:bg-info/20',
  destructive: 'bg-destructive/10 dark:bg-destructive/20',
  neutral: 'bg-muted',
  quiet: 'bg-transparent',
};

export const FAMILY_BORDER: Record<Family, string> = {
  success: 'border-success/40',
  warning: 'border-warning/40',
  info: 'border-info/40',
  destructive: 'border-destructive/40',
  neutral: 'border-border',
  quiet: 'border-border border-dashed',
};

interface StatusTone {
  label: string;
  family: Family;
  treatment: Treatment;
}

export const STATUS_TONES: Record<AttendanceStatus, StatusTone> = {
  PRESENT: { label: 'Present', family: 'success', treatment: 'filled' },
  HALF_DAY: { label: 'Half day', family: 'success', treatment: 'outline' },
  ON_DUTY: { label: 'On duty', family: 'info', treatment: 'filled' },
  ON_LEAVE: { label: 'On leave', family: 'info', treatment: 'outline' },
  PENDING: { label: 'Pending', family: 'warning', treatment: 'filled' },
  ABSENT: { label: 'Absent', family: 'destructive', treatment: 'filled' },
  HOLIDAY: { label: 'Holiday', family: 'neutral', treatment: 'filled' },
  WEEKLY_OFF: { label: 'Weekly off', family: 'quiet', treatment: 'outline' },
};

export function statusLabel(status: AttendanceStatus): string {
  return STATUS_TONES[status].label;
}

/** The class pair for any surface that carries a state: a badge, a calendar cell. */
export function toneClasses(family: Family, treatment: Treatment): string {
  return cn(
    FAMILY_TEXT[family],
    treatment === 'filled' ? FAMILY_FILL[family] : cn('border', FAMILY_BORDER[family]),
  );
}

/** The class pair for a surface that carries a status: a badge, a calendar cell. */
export function statusClasses(status: AttendanceStatus): string {
  const { family, treatment } = STATUS_TONES[status];
  return toneClasses(family, treatment);
}

/**
 * REQ-E-04 flag names, spelled for a reader.
 *
 * Built from the shared enum so a flag added to the contract shows up here as
 * a type error rather than as raw snake_case on screen. Unknown flags still
 * render - `flagLabel` humanises anything not in the table - because the
 * server may ship a new one before this build does.
 */
const FLAG_LABELS: Record<(typeof ATTENDANCE_FLAGS)[number], string> = {
  late: 'Late',
  early_exit: 'Early exit',
  missing_punch: 'Missing punch',
  outside_geofence: 'Outside geofence',
  outside_window: 'Outside window',
  offline_sync: 'Offline sync',
  device_mismatch: 'Device mismatch',
  manual_override: 'Manual override',
  low_gps_accuracy: 'Low GPS accuracy',
  no_location: 'No location',
  mock_location: 'Mock location',
  clock_skew: 'Clock skew',
};

/** Flags that mean somebody has to look, rather than merely describing the day. */
export const NEEDS_REVIEW = new Set<string>([
  'outside_geofence',
  'outside_window',
  'device_mismatch',
  'mock_location',
  'no_location',
  'clock_skew',
  'manual_override',
]);

/**
 * Owner, 22 Aug 2026: every flag has a colour of its own, from the theme's
 * `--flag-*` tokens. A flag is an identity, not a state, so it does not
 * borrow the status colours; the label always sits beside the glyph, so
 * nobody has to tell twelve hues apart unaided. Unknown flags stay quiet.
 */
const FLAG_TONE: Record<(typeof ATTENDANCE_FLAGS)[number], string> = {
  late: 'late',
  early_exit: 'early-exit',
  missing_punch: 'missing-punch',
  outside_geofence: 'outside-geofence',
  outside_window: 'outside-window',
  offline_sync: 'offline-sync',
  device_mismatch: 'device-mismatch',
  manual_override: 'manual-override',
  low_gps_accuracy: 'low-gps-accuracy',
  no_location: 'no-location',
  mock_location: 'mock-location',
  clock_skew: 'clock-skew',
};

/** Tailwind classes for a flag's hue: text, border and soft fill. Spelled out so the scanner can see them. */
const FLAG_CLASSES: Record<string, { text: string; border: string; fill: string }> = {
  late: { text: 'text-flag-late', border: 'border-flag-late/40', fill: 'bg-flag-late/10' },
  'early-exit': { text: 'text-flag-early-exit', border: 'border-flag-early-exit/40', fill: 'bg-flag-early-exit/10' },
  'missing-punch': { text: 'text-flag-missing-punch', border: 'border-flag-missing-punch/40', fill: 'bg-flag-missing-punch/10' },
  'outside-geofence': { text: 'text-flag-outside-geofence', border: 'border-flag-outside-geofence/40', fill: 'bg-flag-outside-geofence/10' },
  'outside-window': { text: 'text-flag-outside-window', border: 'border-flag-outside-window/40', fill: 'bg-flag-outside-window/10' },
  'offline-sync': { text: 'text-flag-offline-sync', border: 'border-flag-offline-sync/40', fill: 'bg-flag-offline-sync/10' },
  'device-mismatch': { text: 'text-flag-device-mismatch', border: 'border-flag-device-mismatch/40', fill: 'bg-flag-device-mismatch/10' },
  'manual-override': { text: 'text-flag-manual-override', border: 'border-flag-manual-override/40', fill: 'bg-flag-manual-override/10' },
  'low-gps-accuracy': { text: 'text-flag-low-gps-accuracy', border: 'border-flag-low-gps-accuracy/40', fill: 'bg-flag-low-gps-accuracy/10' },
  'no-location': { text: 'text-flag-no-location', border: 'border-flag-no-location/40', fill: 'bg-flag-no-location/10' },
  'mock-location': { text: 'text-flag-mock-location', border: 'border-flag-mock-location/40', fill: 'bg-flag-mock-location/10' },
  'clock-skew': { text: 'text-flag-clock-skew', border: 'border-flag-clock-skew/40', fill: 'bg-flag-clock-skew/10' },
};

export function flagClasses(flag: string): { text: string; border: string; fill: string } {
  const tone = FLAG_TONE[flag as keyof typeof FLAG_TONE];
  const classes = tone === undefined ? undefined : FLAG_CLASSES[tone];
  return classes ?? { text: FAMILY_TEXT.quiet, border: FAMILY_BORDER.neutral, fill: FAMILY_FILL.quiet };
}

/** The CSS variable behind a flag's hue, for charts that paint by identity. */
export function flagColourVar(flag: string): string {
  const tone = FLAG_TONE[flag as keyof typeof FLAG_TONE];
  return tone === undefined ? 'var(--muted-foreground)' : `var(--flag-${tone})`;
}

export function flagLabel(flag: string): string {
  return FLAG_LABELS[flag as keyof typeof FLAG_LABELS] ?? humaniseEnum(flag);
}
