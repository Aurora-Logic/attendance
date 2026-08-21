import { FlagPennantIcon, SunHorizonIcon } from '@phosphor-icons/react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { AttendanceStatus } from '@vyuha/shared';

import { FAMILY_TEXT, NEEDS_REVIEW, STATUS_TONES, flagLabel, statusClasses } from './status';

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

  // Owner, 21 Aug 2026: a flag is an icon with its meaning in a tooltip, so a
  // row of six flags is six marks and not six pills. The pennant is the one
  // glyph reserved for flags in this product; nothing else wears it. The
  // trigger is a focusable button, so the tooltip also opens from the
  // keyboard and on a tap, not only on hover.
  return (
    <TooltipProvider>
      <span className={cn('flex flex-wrap items-center gap-0.5', className)}>
        {flags.map((flag) => (
          <Tooltip key={flag}>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={flagLabel(flag)}
                  className={cn(
                    'size-6 pointer-coarse:size-8',
                    NEEDS_REVIEW.has(flag) ? FAMILY_TEXT.destructive : FAMILY_TEXT.quiet,
                  )}
                />
              }
            >
              <FlagPennantIcon weight={NEEDS_REVIEW.has(flag) ? 'fill' : 'regular'} />
            </TooltipTrigger>
            <TooltipContent>{flagLabel(flag)}</TooltipContent>
          </Tooltip>
        ))}
      </span>
    </TooltipProvider>
  );
}

/** Owner, 21 Aug 2026: consecutive early working days, worn on the profile and the team muster. */
export function EarlyStreakBadge({ streak, className }: { streak: number; className?: string }) {
  if (streak <= 0) return null;
  return (
    <Badge variant="ghost" className={cn('border tabular-nums', FAMILY_TEXT.quiet, className)} aria-label={`Early-arrival streak, ${String(streak)} ${streak === 1 ? 'day' : 'days'}`}>
      <SunHorizonIcon aria-hidden />
      {streak} {streak === 1 ? 'day early' : 'days early'}
    </Badge>
  );
}
