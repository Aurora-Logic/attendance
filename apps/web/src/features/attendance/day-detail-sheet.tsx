import type { ReactNode } from 'react';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { buttonVariants } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { EMPTY_VALUE, formatDate } from '@/lib/format';
import { usePermission } from '@/lib/session/permissions';
import { cn } from '@/lib/utils';
import { PERMISSIONS, type RegularizationKind } from '@vyuha/shared';

import { formatClock, formatDuration, formatWindow } from './format';
import { AttendanceFlags, AttendanceStatusBadge } from './status-badge';
import type { AttendanceDay } from './types';
import { useCanViewOvertime } from './visibility';

/**
 * One day, in full.
 *
 * PRD §6.5 makes this the destination of a row tap below 768px, which is what
 * lets the stacked mobile row carry two fields instead of nine. The same sheet
 * serves the calendar on My Attendance, so a day looks identical however it
 * was reached.
 */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-muted-foreground shrink-0 text-xs">{label}</dt>
      <dd className="min-w-0 text-right text-xs font-medium tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * Whether this day is worth offering a correction for, and which one.
 *
 * REQ-F-01 lists four kinds; the two a screen can infer are the two the day
 * itself records. A day stuck on PENDING is REQ-E-02's "IN exists, OUT
 * missing, and the shift window has closed" — the exact state the decision log
 * calls "Pending until regularized" — so the missing OUT is named. A day
 * flagged `missing_punch` with neither punch is a forgotten day.
 *
 * Null for every other day. A correction offered on a clean PRESENT day would
 * be an invitation to edit attendance that nothing went wrong with, and the
 * form is one nav item away for the cases this cannot see.
 */
function suggestedKind(day: AttendanceDay): RegularizationKind | null {
  const missingPunch = day.flags.includes('missing_punch');
  if (day.status === 'PENDING') return day.firstIn === null ? 'FORGOT_TO_PUNCH' : 'MISSING_OUT';
  if (!missingPunch) return null;
  if (day.firstIn === null && day.lastOut === null) return 'FORGOT_TO_PUNCH';
  return day.lastOut === null ? 'MISSING_OUT' : 'MISSING_IN';
}

export function DayDetailSheet({
  day,
  onOpenChange,
}: {
  /** Null closes the sheet. Passing the day itself keeps open state in one place. */
  day: AttendanceDay | null;
  onOpenChange: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  // The sheet serves both My Attendance and the muster, so the row is decided
  // by the viewer's keys rather than by which screen opened it.
  const canSeeOvertime = useCanViewOvertime();
  const canRaise = usePermission(PERMISSIONS.REGULARIZATION_RAISE);
  const kind = day === null ? null : suggestedKind(day);

  return (
    <Sheet open={day !== null} onOpenChange={onOpenChange}>
      {/* Bottom on a phone, right on a desktop: the sheet should arrive from
          the edge nearest the hand that opened it (CLAUDE.md §3 rule 1). */}
      <SheetContent side={isMobile ? 'bottom' : 'right'} className="gap-0">
        {day ? (
          <>
            <SheetHeader className="shrink-0 border-b">
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums">{formatDate(day.date)}</span>
                <AttendanceStatusBadge status={day.status} />
              </SheetTitle>
              <SheetDescription>{day.employee.name}</SheetDescription>
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <dl className="divide-border divide-y">
                <Row label="Shift">{day.shiftName ?? EMPTY_VALUE}</Row>
                <Row label="Scheduled">{formatWindow(day.scheduledIn, day.scheduledOut)}</Row>
                <Row label="First in">{formatClock(day.firstIn)}</Row>
                <Row label="Last out">{formatClock(day.lastOut)}</Row>
                <Row label="Worked">{formatDuration(day.workedMinutes)}</Row>
                {canSeeOvertime ? (
                  <Row label="Overtime">{formatDuration(day.otMinutes)}</Row>
                ) : null}
                <Row label="Late by">
                  {day.lateMinutes > 0 ? `${String(day.lateMinutes)}m` : EMPTY_VALUE}
                </Row>
              </dl>

              {day.flags.length > 0 ? (
                <>
                  <Separator className="my-4" />
                  <p className="text-muted-foreground mb-2 text-xs">Flags</p>
                  <AttendanceFlags flags={day.flags} />
                </>
              ) : null}
            </div>

            {/* REQ-F-01, offered where the problem is noticed rather than only
                on a screen somebody has to know to visit. Pinned to the sheet's
                bottom edge, which is the one place a thumb reaches without the
                hand moving, and only for a day that is actually broken.

                A link, not a button that submits: the correction needs a reason
                and a time, and the form is where those are given. It carries the
                day and the kind so nothing has to be chosen twice. */}
            {kind !== null && canRaise ? (
              <SheetFooter className="shrink-0 border-t">
                {/* `buttonVariants` on a real anchor, which is shadcn's own
                    pattern for a link that looks like a button (the Calendar
                    in this codebase does the same). `Button render={<Link/>}`
                    was the first attempt and Base UI warned about it: it
                    applies role="button" to the anchor, which announces a
                    navigation as a button and loses open-in-new-tab in
                    assistive technology. The styling still comes from the
                    shadcn component, so nothing here is hand-rolled. */}
                <Link
                  to={`/regularizations?date=${day.date}&kind=${kind}`}
                  className={cn(buttonVariants({ variant: 'default' }), 'w-full')}
                  onClick={() => {
                    onOpenChange(false);
                  }}
                >
                  <ClockCounterClockwiseIcon data-icon="inline-start" />
                  Correct this day
                </Link>
              </SheetFooter>
            ) : null}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
