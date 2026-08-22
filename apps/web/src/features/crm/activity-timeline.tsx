import { useState } from 'react';
import {
  ChatTextIcon,
  EnvelopeSimpleIcon,
  NotePencilIcon,
  PhoneIcon,
  PulseIcon,
  UsersIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { actionErrorCopy } from '@/features/leave/api-error-copy';
import { formatRelativeAge } from '@/lib/format';
import { CRM_ACTIVITY_KINDS, CRM_ACTIVITY_KIND_LABELS, type CrmActivityKind, type CrmActivitySubject } from '@vyuha/shared';

import type { Activity } from './types';
import { useActivities, useLogActivity } from './use-activities';

/**
 * REQ-U-07 as the reader sees it: one list per record — the calls and notes
 * people logged and the events the record went through, newest first, each
 * with who and when — and a composer above it. Rendered inside the contact,
 * company and deal sheets, under the form, so the record and its history
 * are one surface.
 */

const KIND_ICONS: Record<Activity['kind'], typeof PhoneIcon> = {
  call: PhoneIcon,
  meeting: UsersIcon,
  note: NotePencilIcon,
  email: EnvelopeSimpleIcon,
  system: PulseIcon,
};

export function ActivityTimeline({
  subject,
  canLog,
}: {
  subject: { type: CrmActivitySubject; id: string };
  canLog: boolean;
}) {
  const query = useActivities(subject);
  const log = useLogActivity();
  const [kind, setKind] = useState<CrmActivityKind>('call');
  const [body, setBody] = useState('');
  const entries = query.data?.pages.flatMap((p) => p.data) ?? [];
  const copy = actionErrorCopy(log.error, 'Logging the activity');

  function submit() {
    if (body.trim() === '' || log.isPending) return;
    log.mutate(
      { subjectType: subject.type, subjectId: subject.id, kind, body },
      {
        onSuccess: () => {
          toast.add({ type: 'success', title: `${CRM_ACTIVITY_KIND_LABELS[kind]} logged` });
          setBody('');
        },
      },
    );
  }

  return (
    <section aria-label="Activity" className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <ChatTextIcon className="text-muted-foreground" />
        Activity
      </h3>

      {canLog ? (
        <div className="flex flex-col gap-2">
          {log.isError ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>{copy.title}</AlertTitle>
              <AlertDescription>{copy.description}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex gap-2">
            <Field className="w-32 shrink-0">
              <FieldLabel htmlFor="activity-kind" className="sr-only">
                Kind
              </FieldLabel>
              <Select
                value={kind}
                onValueChange={(next: string | null) => {
                  const parsed = CRM_ACTIVITY_KINDS.find((k) => k === next);
                  if (parsed) setKind(parsed);
                }}
              >
                <SelectTrigger id="activity-kind" aria-label="Activity kind" className="w-full">
                  <SelectValue>{(value: CrmActivityKind) => CRM_ACTIVITY_KIND_LABELS[value]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CRM_ACTIVITY_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {CRM_ACTIVITY_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor="activity-body" className="sr-only">
                What happened
              </FieldLabel>
              <Textarea
                id="activity-body"
                rows={2}
                placeholder="What happened?"
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                }}
                onKeyDown={(event) => {
                  // Ctrl+Enter logs from the box; Ctrl+A stays the sheet's save.
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" disabled={log.isPending || body.trim() === ''} onClick={submit}>
              {log.isPending ? <Spinner data-icon="inline-start" /> : <PulseIcon data-icon="inline-start" />}
              Log
            </Button>
          </div>
        </div>
      ) : null}

      {query.isPending ? (
        <div role="status" aria-busy="true" aria-label="Loading activity" className="flex flex-col gap-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      ) : null}
      {query.isError ? (
        <p className="text-muted-foreground text-sm">Could not load the activity: {query.error.message}</p>
      ) : null}
      {query.isSuccess && entries.length === 0 ? <p className="text-muted-foreground text-sm">Nothing logged yet.</p> : null}

      {entries.length > 0 ? (
        <ol className="divide-y border">
          {entries.map((entry) => {
            const Icon = KIND_ICONS[entry.kind];
            return (
              <li key={entry.id} className="flex gap-3 px-3 py-2 text-sm">
                <Icon className="text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className={entry.kind === 'system' ? 'text-muted-foreground' : 'font-medium'}>{entry.title}</span>
                    <span className="text-muted-foreground text-xs tabular-nums" title={entry.occurredAt}>
                      {formatRelativeAge(entry.occurredAt)}
                      {entry.actorName === null ? '' : ` · ${entry.actorName}`}
                    </span>
                  </div>
                  {entry.body === null ? null : <p className="mt-0.5 whitespace-pre-wrap break-words">{entry.body}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
      {query.hasNextPage ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {query.isFetchingNextPage ? <Spinner data-icon="inline-start" /> : null}
          Earlier
        </Button>
      ) : null}
    </section>
  );
}
