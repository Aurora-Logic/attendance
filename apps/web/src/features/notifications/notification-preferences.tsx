import { WarningCircleIcon } from '@phosphor-icons/react';
import { Fragment } from 'react';

import {
  DELIVERABLE_NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_EVENT_DESCRIPTORS,
  NOTIFICATION_EVENT_GROUPS,
  NOTIFICATION_EVENT_TYPES,
  type NotificationChannel,
  type NotificationEventGroup,
  type NotificationEventType,
  type NotificationPreference,
} from '@vyuha/shared';

import { SectionHeading } from '@/components/shared/section-heading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';

import {
  useNotificationPreferences,
  useSaveNotificationPreference,
} from './use-notifications';

/**
 * REQ-K-04: per-user notification preferences, by event and by channel.
 *
 * On the profile screen, which is where somebody looks for "settings about
 * me". The Settings screen is org policy behind `settings.manage`, and these
 * are neither -- an employee with no permissions at all still chooses whether
 * their punch reminder emails them.
 *
 * Grouped by area rather than listed flat: thirteen events with two switches
 * each is twenty-six controls, and an ungrouped column of them is a wall.
 *
 * Each switch saves on change. There is no Save button because there is
 * nothing to compose -- one switch is one fact, the server answers with the
 * whole grid, and the control settles on what was actually stored rather than
 * on what was clicked.
 */

type PreferenceKey = `${NotificationEventType}:${NotificationChannel}`;

function keyOf(eventType: NotificationEventType, channel: NotificationChannel): PreferenceKey {
  return `${eventType}:${channel}`;
}

function EventRow({
  eventType,
  lookup,
  onToggle,
  disabled,
}: {
  eventType: NotificationEventType;
  lookup: Map<PreferenceKey, NotificationPreference>;
  onToggle: (eventType: NotificationEventType, channel: NotificationChannel, next: boolean) => void;
  disabled: boolean;
}) {
  const descriptor = NOTIFICATION_EVENT_DESCRIPTORS[eventType];

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 py-2.5">
      <div className="flex min-w-40 flex-1 flex-col gap-0.5">
        <span className="text-xs font-medium">{descriptor.label}</span>
        <span className="text-muted-foreground text-xs">{descriptor.note}</span>
      </div>
      {/* The two switches share a row at every width. Stacking them would make
          a twenty-six-control screen fifty-two rows on a phone. */}
      <div className="flex shrink-0 items-center gap-5">
        {DELIVERABLE_NOTIFICATION_CHANNELS.map((channel) => {
          const preference = lookup.get(keyOf(eventType, channel));
          const id = `notify-${eventType}-${channel}`;
          return (
            <div key={channel} className="flex items-center gap-2">
              <Switch
                id={id}
                disabled={disabled}
                checked={preference?.enabled ?? false}
                onCheckedChange={(next: boolean) => {
                  onToggle(eventType, channel, next);
                }}
              />
              <Label htmlFor={id} className="text-muted-foreground text-xs">
                {NOTIFICATION_CHANNEL_LABELS[channel]}
              </Label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function NotificationPreferences() {
  const query = useNotificationPreferences();
  const save = useSaveNotificationPreference();

  const lookup = new Map<PreferenceKey, NotificationPreference>(
    (query.data ?? []).map((preference) => [
      keyOf(preference.eventType, preference.channel),
      preference,
    ]),
  );

  function toggle(
    eventType: NotificationEventType,
    channel: NotificationChannel,
    enabled: boolean,
  ): void {
    save.mutate({ eventType, channel, enabled });
  }

  const groups: { group: NotificationEventGroup; events: NotificationEventType[] }[] =
    NOTIFICATION_EVENT_GROUPS.map((group) => ({
      group,
      events: NOTIFICATION_EVENT_TYPES.filter(
        (eventType) => NOTIFICATION_EVENT_DESCRIPTORS[eventType].group === group,
      ),
    })).filter((entry) => entry.events.length > 0);

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading
        title="Notifications"
        note="What reaches you, and where. Anything switched off here is never sent — the server checks this list on every dispatch."
      />

      {query.isPending ? (
        <div role="status" aria-busy="true" aria-label="Loading notification preferences" className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-8 w-full" />
          ))}
        </div>
      ) : query.error ? (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>Could not load your notification preferences</AlertTitle>
          <AlertDescription>{query.error.message}</AlertDescription>
        </Alert>
      ) : (
        <>
          {save.error ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>That preference was not saved</AlertTitle>
              <AlertDescription>{save.error.message}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-5">
            {groups.map(({ group, events }) => (
              <div key={group} className="flex flex-col">
                <span className="text-muted-foreground pb-1 text-xs font-medium">{group}</span>
                {events.map((eventType, index) => (
                  <Fragment key={eventType}>
                    {index > 0 ? <Separator /> : null}
                    <EventRow
                      eventType={eventType}
                      lookup={lookup}
                      onToggle={toggle}
                      disabled={save.isPending}
                    />
                  </Fragment>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
