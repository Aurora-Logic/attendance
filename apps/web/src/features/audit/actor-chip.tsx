import { PersonChip } from '@/components/shared/person';

import type { AuditEntry } from './types';


/**
 * Who did it, with a face when it was a person and without one when it wasn't.
 *
 * The trail records two kinds of actor and they should not look alike. A
 * nightly accrual, an escalation sweep and a retention purge all write entries
 * with no user attached; giving those an initials avatar would invent a
 * colleague called System and make an unattended job look like somebody's
 * decision. That distinction is the whole reason this is not just
 * `PersonChip`.
 */
export function ActorChip({ entry }: { entry: AuditEntry }) {
  if (entry.actor === null) {
    return <span className="text-muted-foreground italic">System</span>;
  }
  // Falls back the same way `actorLabel` does: an account with no employee
  // record still acts, and its email is the honest name for it.
  return <PersonChip name={entry.actor.name ?? entry.actor.email ?? entry.actor.id} />;
}
