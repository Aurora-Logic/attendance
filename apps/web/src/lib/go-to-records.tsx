import { AddressBookIcon, BooksIcon, BuildingsIcon, CheckSquareIcon, ReceiptIcon, UserIcon, type Icon } from '@phosphor-icons/react';

import type { GoToRecord } from '@vyuha/shared';

/**
 * What the palette knows about each record type the server can return
 * (REQ-O-05).
 *
 * One entry per type: where it opens, what icon it wears, which group heading
 * it sits under. This is the client half of the server's source registry, and
 * it is a lookup table rather than a switch inside the palette so that adding
 * a module's records is a row here plus a source there — never an edit to the
 * palette component.
 *
 * A type with no row is dropped by `kindOf`, deliberately: the server may
 * learn a new record type before this bundle redeploys, and an entry the
 * client cannot route is a dead row in the list.
 */

export interface GoToRecordKind {
  /** Palette group heading — plural, since the group holds many. */
  readonly group: string;
  readonly icon: Icon;
  readonly route: (record: GoToRecord) => string;
}

const GO_TO_RECORD_KINDS: Record<string, GoToRecordKind> = {
  employee: {
    group: 'Employees',
    icon: UserIcon,
    route: (record) => `/employees/${record.id}`,
  },
  party: {
    group: 'Parties',
    // No party detail screen exists yet, so a selection opens the register
    // filtered to the name -- one row, in context, with the same figures a
    // detail screen would show. Becomes /masters/parties/:id when that
    // screen ships.
    icon: BooksIcon,
    // Capped at the list query's own max: a 200-char Tally name would
    // otherwise 400 the very screen the palette promised.
    route: (record) => `/masters/parties?q=${encodeURIComponent(record.title.slice(0, 80))}`,
  },
  voucher: {
    group: 'Vouchers',
    icon: ReceiptIcon,
    // 09 §6: typing a voucher number opens that voucher.
    route: (record) => `/masters/vouchers/${record.id}`,
  },
  contact: {
    group: 'Contacts',
    icon: AddressBookIcon,
    route: (record) => `/crm/contacts/${record.id}`,
  },
  company: {
    group: 'Companies',
    icon: BuildingsIcon,
    route: (record) => `/crm/companies/${record.id}`,
  },
  task: {
    group: 'Tasks',
    icon: CheckSquareIcon,
    route: (record) => `/tasks/${record.id}`,
  },
};

export function kindOf(record: GoToRecord): GoToRecordKind | null {
  return GO_TO_RECORD_KINDS[record.type] ?? null;
}
