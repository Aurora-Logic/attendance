import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AttendanceStatus } from '@vyuha/shared';

import { FAMILY_BORDER, FAMILY_TEXT, NEEDS_REVIEW, STATUS_TONES, flagLabel, statusClasses } from './status';

/**
 * The two things that render a status: the pill and the flag row.
 *
 * Split from `status.ts` only because the tokens and the label lookup are
 * needed by the calendar, which is not a badge. Fast refresh also insists a
 * module export either components or constants, not both.
 */

export function AttendanceStatusBadge({
  status,
  className,
}: {
  status: AttendanceStatus;
  className?: string;
}) {
  return (
    // The badge's own variants cover primary, secondary and destructive only,
    // which is three of the eight states this product has. `variant="ghost"`
    // takes its shape and typography and leaves the colour to the tokens in
    // status.ts rather than to a second, competing palette.
    <Badge variant="ghost" className={cn(statusClasses(status), className)}>
      {STATUS_TONES[status].label}
    </Badge>
  );
}

export function AttendanceFlags({ flags, className }: { flags: string[]; className?: string }) {
  if (flags.length === 0) return null;

  return (
    <span className={cn('flex flex-wrap items-center gap-1', className)}>
      {flags.map((flag) => (
        <Badge
          key={flag}
          variant="ghost"
          // A flag that needs somebody to act reads in the destructive family;
          // one that merely describes the day stays quiet, so a row of six
          // flags still shows which one matters.
          className={cn(
            'border',
            NEEDS_REVIEW.has(flag)
              ? cn(FAMILY_TEXT.destructive, FAMILY_BORDER.destructive)
              : cn(FAMILY_TEXT.quiet, FAMILY_BORDER.neutral),
          )}
        >
          {flagLabel(flag)}
        </Badge>
      ))}
    </span>
  );
}
