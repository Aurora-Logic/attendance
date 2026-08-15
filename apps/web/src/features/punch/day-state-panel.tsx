import {
  CalendarCheckIcon,
  CalendarXIcon,
  CheckCircleIcon,
  ConfettiIcon,
  UmbrellaIcon,
  WarningCircleIcon,
  type Icon,
} from '@phosphor-icons/react';

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

import type { PunchDayKind, PunchDayState } from './day-state';

/**
 * The day, said plainly, when there is nothing to punch.
 *
 * A holiday is not a failure, and it must not be drawn like one. The screen
 * previously showed the whole punch apparatus — camera, reason box, a disabled
 * button — on a day nobody was expected to work, which reads as something
 * broken rather than as a day off.
 *
 * `no-shift` is the exception and is drawn as a fault, because it is one: a
 * working day with nobody rostered is somebody's oversight, not a rest day.
 */
const ICONS: Record<PunchDayKind, Icon> = {
  holiday: ConfettiIcon,
  'weekly-off': CalendarCheckIcon,
  'on-leave': UmbrellaIcon,
  'no-shift': CalendarXIcon,
  done: CheckCircleIcon,
  ready: CheckCircleIcon,
  'in-progress': CheckCircleIcon,
};

export function DayStatePanel({ state }: { state: PunchDayState }) {
  const Illustration = state.kind === 'no-shift' ? WarningCircleIcon : ICONS[state.kind];

  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia
          variant="icon"
          // Larger than the icon an empty list gets. This is the answer to the
          // question the person opened the screen to ask, not a decoration on
          // the side of something else.
          className={
            state.kind === 'no-shift'
              ? 'text-destructive [&_svg]:size-8'
              : 'text-muted-foreground [&_svg]:size-8'
          }
        >
          <Illustration weight="duotone" />
        </EmptyMedia>
        <EmptyTitle>{state.title}</EmptyTitle>
        <EmptyDescription>{state.detail}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
