import { DEFAULT_APPEARANCE, DEFAULT_MFA_POLICY, DEVICE_BINDING_MODES, MFA_POLICIES, appearanceSchema, type Appearance } from '@vyuha/shared';
import { z } from 'zod';

/**
 * REQ-L-02 and REQ-L-03: the org-scoped policy rows the Settings screen edits.
 *
 * Two things this file is careful about.
 *
 * **It is a catalogue, not an escape hatch.** `PUT /settings` writes only keys
 * named here, validated by the schema named here. An arbitrary key/value
 * endpoint would let an administrator store `"BLOCk"` in
 * `attendance.punch_window_behaviour`, and the punch pipeline refuses to start
 * a request when a setting will not parse -- so a typo in a settings form would
 * take punching down. Unknown key is a 400.
 *
 * **It states which settings are actually in force.** Several of the fields
 * REQ-L-02 lists belong to features that ship in a later phase, and a switch
 * that visibly moves while nothing reads it is worse than no switch: it reads
 * as a control that has been turned on. `enforcedBy` carries the truth to the
 * screen, which says so next to the field.
 *
 * The `attendance.*` prefix is not a boundary violation. `settings` is a
 * platform table and this module owns reading and writing it; the prefix names
 * the module that *consumes* a row. Technical design §1 forbids
 * `platform/ -> modules/` imports, so the key strings are repeated rather than
 * imported -- `settings.catalogue.test.ts` fails if a consumer renames one.
 */

/**
 * REQ-L-02 names "geofence behaviour" beside punch window behaviour, and the
 * three outcomes are the same three. Declared here rather than in
 * `@vyuha/shared` because nothing reads it yet (see `enforcedBy`), and a
 * contract-package enum implies a contract somebody honours.
 */
export const GEOFENCE_BEHAVIOURS = ['BLOCK', 'ALLOW_WITH_REASON', 'ALLOW_AND_FLAG'] as const;
export type GeofenceBehaviour = (typeof GEOFENCE_BEHAVIOURS)[number];

const KB = 1024;

/**
 * What reads a setting today, or null when nothing does yet.
 *
 * A free string rather than an enum: it is displayed, not branched on, and the
 * moment it becomes a union somebody will be tempted to switch on it.
 */
export type SettingConsumer = string | null;

export interface SettingDescriptor {
  /** The row in `settings.key`. */
  readonly key: string;
  /** One line for the field's help text. */
  readonly help: string;
  readonly enforcedBy: SettingConsumer;
}

/**
 * Field name inside its group, to the row it is stored in.
 *
 * Keyed by the same field names the schemas below use, so
 * `settings.catalogue.test.ts` can assert the two agree rather than trusting
 * that they were edited together.
 */
export const ATTENDANCE_SETTINGS = {
  geofenceBehaviour: {
    key: 'attendance.geofence_behaviour',
    help: 'What happens to a punch outside the location radius (REQ-D-08).',
    // REQ-D-08 and 05-decisions fix this to a hard block, and the punch
    // service implements the block directly rather than reading a row.
    enforcedBy: null,
  },
  deviceBindingMode: {
    key: 'attendance.device_binding_mode',
    help: 'Whether punching from a new device warns, blocks, or is ignored (REQ-B-08).',
    enforcedBy: 'Punch',
  },
  // Owner, 21 Aug 2026: early arrival is recognised (confetti at the punch,
  // a streak on the profile) when the first IN beats shift start by this many
  // minutes; the toggle switches the whole recognition off.
  earlyArrivalEnabled: {
    key: 'attendance.early_arrival_enabled',
    help: 'Whether an early arrival is celebrated and counted toward a streak.',
    enforcedBy: 'Day engine',
  },
  earlyArrivalThresholdMinutes: {
    key: 'attendance.early_arrival_threshold_minutes',
    help: 'How many minutes before shift start counts as early.',
    enforcedBy: 'Day engine',
  },
  maxWorkMinutes: {
    key: 'attendance.max_work_minutes',
    help: 'Worked minutes are capped here, so a missing OUT cannot pay a 30-hour day (REQ-E-03).',
    enforcedBy: 'Day engine',
  },
  autoEscalationDays: {
    key: 'attendance.auto_escalation_days',
    help: 'An untouched approval escalates to HR after this many days (REQ-G-09).',
    enforcedBy: null,
  },
} as const satisfies Record<string, SettingDescriptor>;

export const PHOTO_SETTINGS = {
  retentionMonths: {
    key: 'attendance.photo_retention_months',
    help: 'How long a punch photo is kept before the purge job removes it (REQ-L-03).',
    // The punch pipeline stamps `files.expires_at` on the photo and its
    // thumbnail from this row; the purge job sweeps that column nightly.
    enforcedBy: 'Punch photo pipeline',
  },
  minBytes: {
    key: 'attendance.photo_min_bytes',
    help: 'Smallest acceptable stored photo. Below this the stamp is not legible.',
    enforcedBy: 'Punch photo pipeline',
  },
  maxBytes: {
    key: 'attendance.photo_max_bytes',
    help: 'Largest stored photo, before re-encoding at a lower quality band.',
    enforcedBy: 'Punch photo pipeline',
  },
} as const satisfies Record<string, SettingDescriptor>;

/**
 * Bounds, not preferences. Each one is the range outside which the consuming
 * feature would misbehave rather than merely be configured oddly.
 */
export const attendancePolicySchema = z.object({
  geofenceBehaviour: z.enum(GEOFENCE_BEHAVIOURS),
  deviceBindingMode: z.enum(DEVICE_BINDING_MODES),
  // The day engine's own guard is `positive().max(24h)`; 60 minutes is the
  // floor below which every full day would be truncated to nothing.
  maxWorkMinutes: z.number().int().min(60).max(24 * 60),
  earlyArrivalEnabled: z.boolean(),
  earlyArrivalThresholdMinutes: z.number().int().min(5).max(240),
  autoEscalationDays: z.number().int().min(1).max(30),
});

export type AttendancePolicy = z.infer<typeof attendancePolicySchema>;

const photoByteBudget = z.number().int().min(1 * KB).max(2_048 * KB);

/**
 * Unrefined, so `.partial()` is still available for the patch body. The
 * cross-field rule below belongs to the *merged* result rather than to the
 * patch: sending only `maxBytes` can invert the band just as easily as sending
 * both, and a rule checked on the patch alone would miss it.
 */
export const photoPolicyObject = z.object({
  // Floor of 3, not 1: a regularization window can reach 90 days
  // (`regularizationWindowDays` above), so a one-month retention would purge
  // a photo while the punch it evidences is still disputable. Three months
  // is the smallest value that cannot outrun the longest dispute window.
  retentionMonths: z.number().int().min(3).max(120),
  minBytes: photoByteBudget,
  maxBytes: photoByteBudget,
});

export const photoPolicySchema = photoPolicyObject.refine(
  (value) => value.minBytes <= value.maxBytes,
  {
    // An inverted band makes `resolvePunchSettings` throw on every punch, so
    // it is refused at the edit rather than discovered at the camera.
    message: 'The smallest photo size must not exceed the largest.',
    path: ['minBytes'],
  },
);

export type PhotoPolicy = z.infer<typeof photoPolicyObject>;

/**
 * The value used when no row exists. Every one of these is the default the
 * consuming code already applies, or the default written down in the PRD --
 * none is invented here, because a settings screen that reports a different
 * default from the one in force is worse than no screen.
 */
export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = {
  // REQ-D-08 and 05-decisions: hard block.
  geofenceBehaviour: 'BLOCK',
  // REQ-B-08: warn.
  deviceBindingMode: 'WARN',
  // `DEFAULT_MAX_WORK_MINUTES` in the day engine.
  maxWorkMinutes: 16 * 60,
  // Owner, 21 Aug 2026: on, fifteen minutes.
  earlyArrivalEnabled: true,
  earlyArrivalThresholdMinutes: 15,
  // REQ-G-09.
  autoEscalationDays: 3,
};

export const DEFAULT_PHOTO_POLICY: PhotoPolicy = {
  // REQ-L-03.
  retentionMonths: 12,
  // REQ-D-03a's 80-150 KB band, matching `DEFAULT_PUNCH_SETTINGS`.
  minBytes: 80 * KB,
  maxBytes: 150 * KB,
};

/**
 * REQ-B-09. Owner, 22 Aug 2026: two-step sign-in is required for Admin and
 * Accounts unless Settings says otherwise; anybody may turn it on.
 */
export const SECURITY_SETTINGS = {
  mfaPolicy: {
    key: 'security.mfa_policy',
    help: 'Which roles must sign in with an authenticator app (REQ-B-09).',
    enforcedBy: 'Sign-in',
  },
} as const satisfies Record<string, SettingDescriptor>;

export const securityPolicySchema = z.object({
  mfaPolicy: z.enum(MFA_POLICIES),
});
export type SecurityPolicy = z.infer<typeof securityPolicySchema>;
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = { mfaPolicy: DEFAULT_MFA_POLICY };

/**
 * Owner, 22 Aug 2026: the accent and the base are the workspace's, light
 * and dark each person's. Read by every signed-in client through the
 * branding endpoint, which is how the shell colours itself before the
 * settings screen is ever opened.
 */
export const APPEARANCE_SETTINGS = {
  accentHue: { key: 'appearance.accent_hue', help: 'The accent hue, 0-360, at the theme\'s fixed lightness.', enforcedBy: 'Shell' },
  accentChroma: { key: 'appearance.accent_chroma', help: 'How saturated the accent is.', enforcedBy: 'Shell' },
  base: { key: 'appearance.base', help: 'The temperature of the neutrals: stone, cool or warm.', enforcedBy: 'Shell' },
  density: { key: 'appearance.density', help: 'Comfortable or compact spacing; type size does not change.', enforcedBy: 'Shell' },
} as const satisfies Record<string, SettingDescriptor>;

export const appearancePolicySchema = appearanceSchema;
export type AppearancePolicy = Appearance;
export const DEFAULT_APPEARANCE_POLICY: AppearancePolicy = DEFAULT_APPEARANCE;

/** Every key this module is allowed to write, in one flat set. */
export const WRITABLE_SETTING_KEYS: ReadonlySet<string> = new Set([
  ...Object.values(ATTENDANCE_SETTINGS).map((descriptor) => descriptor.key),
  ...Object.values(PHOTO_SETTINGS).map((descriptor) => descriptor.key),
  ...Object.values(SECURITY_SETTINGS).map((descriptor) => descriptor.key),
  ...Object.values(APPEARANCE_SETTINGS).map((descriptor) => descriptor.key),
]);

/**
 * Reads one group out of whatever rows the organisation has.
 *
 * A row that will not parse is *not* an error here, and that is deliberate.
 * This is the read path for a settings screen; refusing to render the screen
 * because one row is corrupt would remove the only place the corrupt row can
 * be fixed. The consuming feature still refuses the value at the point of use,
 * which is where refusing is useful.
 */
export function resolveGroup<TSchema extends z.ZodType>(
  schema: TSchema,
  descriptors: Record<string, SettingDescriptor>,
  fallback: z.infer<TSchema>,
  rows: ReadonlyMap<string, unknown>,
): { value: z.infer<TSchema>; unreadable: readonly string[] } {
  const candidate: Record<string, unknown> = { ...(fallback as object) };
  const unreadable: string[] = [];

  for (const [field, descriptor] of Object.entries(descriptors)) {
    if (!rows.has(descriptor.key)) continue;
    candidate[field] = rows.get(descriptor.key);
  }

  const parsed = schema.safeParse(candidate);
  if (parsed.success) return { value: parsed.data, unreadable };

  // One bad row must not discard the six good ones beside it, so the fields
  // that failed fall back individually and are named to the caller.
  const repaired: Record<string, unknown> = { ...(fallback as object) };
  for (const [field, descriptor] of Object.entries(descriptors)) {
    if (!rows.has(descriptor.key)) continue;
    const attempt = schema.safeParse({ ...repaired, [field]: rows.get(descriptor.key) });
    if (attempt.success) repaired[field] = rows.get(descriptor.key);
    else unreadable.push(descriptor.key);
  }

  const settled = schema.safeParse(repaired);
  if (settled.success) return { value: settled.data, unreadable };

  // Unreachable unless a default itself stopped parsing, which the catalogue
  // test exists to prevent. Reported rather than silently swallowed.
  throw new Error(
    `Settings defaults no longer satisfy their own schema: ${JSON.stringify(z.treeifyError(settled.error))}`,
  );
}
