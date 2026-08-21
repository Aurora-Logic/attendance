import { CheckIcon, CircleHalfIcon, FlagPennantIcon, NotePencilIcon } from '@phosphor-icons/react';
import type { PunchFlagReviewAction } from '@vyuha/shared';

/**
 * Owner, 21 Aug 2026: the four admin verbs on a flagged punch. The note is
 * required where the employee reads it as a verdict (keep, note) and optional
 * where the flag simply goes away. In its own module so the dialog file
 * exports only a component (fast refresh).
 */
export const FLAG_REVIEW_COPY: Record<
  PunchFlagReviewAction,
  { title: string; verb: string; icon: typeof CheckIcon; noteLabel: string; noteRequired: boolean }
> = {
  ACCEPT: { title: 'Accept this punch', verb: 'Accept', icon: CheckIcon, noteLabel: 'Note (optional)', noteRequired: false },
  KEEP: { title: 'Keep this punch flagged', verb: 'Keep flagged', icon: FlagPennantIcon, noteLabel: 'Why it stays flagged', noteRequired: true },
  HALF_DAY: { title: 'Mark the day as a half day', verb: 'Mark half day', icon: CircleHalfIcon, noteLabel: 'Note (optional)', noteRequired: false },
  NOTE: { title: 'Add a note', verb: 'Add note', icon: NotePencilIcon, noteLabel: 'Note', noteRequired: true },
};
