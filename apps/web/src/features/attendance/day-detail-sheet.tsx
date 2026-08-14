import { useState, type ReactNode } from 'react';

import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  RecordHistoryButton,
  RecordHistorySheet,
} from '@/features/audit/record-history-sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { EMPTY_VALUE, formatDate } from '@/lib/format';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS } from '@vyuha/shared';

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
  // REQ-M-02. A derived day is the one record in this product that a person
  // can find changed underneath them — an override, a lock, a nightly
  // recompute — so "who did this to my day" is the question it most needs to
  // be able to answer.
  const canReadTrail = usePermission(PERMISSIONS.AUDIT_VIEW);
  const [historyOpen, setHistoryOpen] = useState(false);

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

            {canReadTrail ? (
              <SheetFooter className="shrink-0 flex-row justify-end border-t">
                <RecordHistoryButton
                  onClick={() => {
                    setHistoryOpen(true);
                  }}
                />
              </SheetFooter>
            ) : null}
          </>
        ) : null}
      </SheetContent>

      {/* Opens over this sheet rather than replacing it, so closing it returns
          to the day rather than to the table. It is one surface deep, not two:
          the history sheet swaps its own body between the list and an entry
          instead of stacking a third. */}
      <RecordHistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        entityType="attendance_days"
        entityId={day?.id ?? null}
        title={day === null ? '' : formatDate(day.date)}
        description={
          day === null
            ? ''
            : `${day.employee.name} — every override, lock and recompute recorded against this day.`
        }
      />
    </Sheet>
  );
}
