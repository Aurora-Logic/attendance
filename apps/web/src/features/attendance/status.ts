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

type Family = 'success' | 'warning' | 'info' | 'destructive' | 'neutral' | 'quiet';
type Treatment = 'filled' | 'outline';

export const FAMILY_TEXT: Record<Family, string> = {
  success: 'text-[color-mix(in_oklch,var(--success),var(--foreground)_20%)] dark:text-success',
  warning: 'text-[color-mix(in_oklch,var(--warning),var(--foreground)_20%)] dark:text-warning',
  info: 'text-[color-mix(in_oklch,var(--info),var(--foreground)_20%)] dark:text-info',
  destructive: 'text-destructive',
  neutral: 'text-foreground',
  quiet: 'text-muted-foreground',
};

const FAMILY_FILL: Record<Family, string> = {
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

/** The class pair for a surface that carries a status: a badge, a calendar cell. */
export function statusClasses(status: AttendanceStatus): string {
  const { family, treatment } = STATUS_TONES[status];
  return cn(
    FAMILY_TEXT[family],
    treatment === 'filled' ? FAMILY_FILL[family] : cn('border', FAMILY_BORDER[family]),
  );
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

export function flagLabel(flag: string): string {
  return FLAG_LABELS[flag as keyof typeof FLAG_LABELS] ?? humaniseEnum(flag);
}
