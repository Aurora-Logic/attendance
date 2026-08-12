import {
  DEFAULT_PUNCH_WINDOW_BEHAVIOUR,
  DEVICE_BINDING_MODES,
  PUNCH_WINDOW_BEHAVIOURS,
  type DeviceBindingMode,
  type PunchWindowBehaviour,
} from '@vyuha/shared';
import { z } from 'zod';

/**
 * The punch policy an administrator can change without a deploy (REQ-K-01:
 * "changing a policy setting immediately alters punch behaviour without a
 * redeploy"). Rows in the platform `settings` table, keyed here.
 *
 * The defaults are the answers in `05-decisions.md`, not invented ones:
 * out-of-window punches are allowed with a typed reason, device binding warns
 * rather than enforces, and the photo band is REQ-D-03a's 80-150 KB.
 *
 * A malformed value throws rather than falling back. A settings row that says
 * `"BLOCk"` and silently behaves as ALLOW_WITH_REASON is a control that has
 * been turned off without anybody being told.
 */

export const PUNCH_SETTING_KEYS = {
  windowBehaviour: 'attendance.punch_window_behaviour',
  deviceBindingMode: 'attendance.device_binding_mode',
  photoMinBytes: 'attendance.photo_min_bytes',
  photoMaxBytes: 'attendance.photo_max_bytes',
} as const;

export type PunchSettingKey = (typeof PUNCH_SETTING_KEYS)[keyof typeof PUNCH_SETTING_KEYS];

export interface PunchSettings {
  readonly windowBehaviour: PunchWindowBehaviour;
  readonly deviceBindingMode: DeviceBindingMode;
  /** REQ-D-03a: the band the stored photo should land in. */
  readonly photoMinBytes: number;
  readonly photoMaxBytes: number;
}

const KB = 1024;

export const DEFAULT_PUNCH_SETTINGS: PunchSettings = {
  windowBehaviour: DEFAULT_PUNCH_WINDOW_BEHAVIOUR,
  deviceBindingMode: 'WARN',
  photoMinBytes: 80 * KB,
  photoMaxBytes: 150 * KB,
};

// 20 KB is below anything a legible 1280px stamped photo can be; 2 MB is above
// anything worth storing 26,000 times a month.
const byteBudget = z.number().int().min(1 * KB).max(2_048 * KB);

/**
 * Generic over the schema rather than over the key: a lookup table of schemas
 * indexed by key gives every read the union of all four value types, and the
 * caller then has to narrow a value it already knows the shape of.
 */
function read<TSchema extends z.ZodType>(
  values: ReadonlyMap<string, unknown>,
  key: PunchSettingKey,
  schema: TSchema,
): z.infer<TSchema> | undefined {
  if (!values.has(key)) return undefined;

  const parsed = schema.safeParse(values.get(key));
  if (!parsed.success) {
    throw new Error(`Setting "${key}" is not a valid value: ${JSON.stringify(values.get(key))}.`);
  }
  return parsed.data;
}

/**
 * `values` is whatever the `settings` table holds for this organisation, keyed
 * by setting key. Absent keys take the default above; present ones must parse.
 */
export function resolvePunchSettings(values: ReadonlyMap<string, unknown>): PunchSettings {
  const photoMinBytes =
    read(values, PUNCH_SETTING_KEYS.photoMinBytes, byteBudget) ??
    DEFAULT_PUNCH_SETTINGS.photoMinBytes;
  const photoMaxBytes =
    read(values, PUNCH_SETTING_KEYS.photoMaxBytes, byteBudget) ??
    DEFAULT_PUNCH_SETTINGS.photoMaxBytes;

  if (photoMinBytes > photoMaxBytes) {
    throw new Error(
      `Photo size band is inverted: "${PUNCH_SETTING_KEYS.photoMinBytes}" (${String(photoMinBytes)}) ` +
        `exceeds "${PUNCH_SETTING_KEYS.photoMaxBytes}" (${String(photoMaxBytes)}).`,
    );
  }

  return {
    windowBehaviour:
      read(values, PUNCH_SETTING_KEYS.windowBehaviour, z.enum(PUNCH_WINDOW_BEHAVIOURS)) ??
      DEFAULT_PUNCH_SETTINGS.windowBehaviour,
    deviceBindingMode:
      read(values, PUNCH_SETTING_KEYS.deviceBindingMode, z.enum(DEVICE_BINDING_MODES)) ??
      DEFAULT_PUNCH_SETTINGS.deviceBindingMode,
    photoMinBytes,
    photoMaxBytes,
  };
}
