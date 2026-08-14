import { SectionHeading } from '@/components/shared/section-heading';
import { EMPTY_VALUE } from '@/lib/format';

import { actorLabel } from './format';
import { diffRows, type AuditEntry } from './types';

/**
 * One audit entry, in full: what changed, and where it came from.
 *
 * Extracted from the sheet that used to own it because REQ-M-02 asks for
 * per-record history on four other screens, and the alternative was a second
 * renderer for the same before/after pair. Two of those would disagree the
 * first time a field was added to the diff, and one of them would be the one
 * somebody was reading during a dispute.
 *
 * The sheet chrome is not here on purpose -- the audit viewer opens this from a
 * table row and the history sheet swaps to it in place, and a component that
 * insisted on being a sheet could not do the second.
 */

export function AuditEntryDetail({ entry }: { entry: AuditEntry }) {
  const rows = diffRows(entry.before, entry.after);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SectionHeading title="What changed" />
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No field-level diff was recorded. The action itself is the record.
          </p>
        ) : (
          <dl className="flex flex-col gap-3 text-sm">
            {rows.map((row) => (
              <div key={row.field} className="flex flex-col gap-1">
                <dt className="font-mono text-xs font-medium">{row.field}</dt>
                <dd className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  <span className="text-muted-foreground break-all line-through">{row.before}</span>
                  <span className="break-all">{row.after}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <SectionHeading title="Where it came from" />
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Entity</dt>
          <dd className="break-all font-medium">
            {entry.entityType}
            {entry.entityId === null ? '' : ` ${entry.entityId}`}
          </dd>

          <dt className="text-muted-foreground">Actor</dt>
          <dd className="break-all font-medium">{entry.actor?.email ?? actorLabel(entry)}</dd>

          {entry.impersonator === null ? null : (
            <>
              <dt className="text-muted-foreground">Impersonated by</dt>
              <dd className="break-all font-medium">
                {entry.impersonator.email ?? entry.impersonator.id}
              </dd>
            </>
          )}

          <dt className="text-muted-foreground">Address</dt>
          <dd className="font-medium tabular-nums">{entry.ip ?? EMPTY_VALUE}</dd>

          <dt className="text-muted-foreground">Device</dt>
          <dd className="break-all font-medium">{entry.userAgent ?? EMPTY_VALUE}</dd>

          <dt className="text-muted-foreground">Request</dt>
          {/* The field that turns "it failed for me" into something findable in
              the server log. */}
          <dd className="font-mono text-xs break-all">{entry.requestId ?? EMPTY_VALUE}</dd>
        </dl>
      </div>
    </div>
  );
}
