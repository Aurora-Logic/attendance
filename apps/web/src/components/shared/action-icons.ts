import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  CalendarDotIcon,
  CheckIcon,
  FlagPennantIcon,
  FunnelXIcon,
  type Icon,
  PencilSimpleIcon,
  PlusIcon,
  SkipForwardIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react';

/**
 * One icon per verb, for the whole product.
 *
 * The same six or seven actions recur on every screen -- Cancel appears ten
 * times, Clear filters eleven, Try again ten -- and before this they were a
 * mixture of icon, no icon, and different icons for the same word. A person
 * learns "the circular arrow means try again" once and then reads it without
 * reading it; that only works if it is the same arrow everywhere, which is what
 * CLAUDE.md section 3 rule 4 asks for.
 *
 * Save is a check rather than a floppy disk. The floppy is a picture of a
 * storage medium nobody under thirty has handled, and this product already
 * calls the action something else: PRD section 6.4 labels Ctrl+A "Accept /
 * Save", and the Tally users this is built for know that key as Accept. The
 * icon now says what the shortcut says.
 *
 * Add a verb here rather than reaching for an icon at the call site. If a
 * screen needs a verb that is not in this table, that is worth a moment's
 * thought -- usually it is one of these wearing a different word.
 */
export const ACTION_ICONS = {
  /** Commit the draft. Ctrl+A, "Accept / Save". */
  save: CheckIcon,
  /** Abandon the draft and close. Ctrl+Q. */
  cancel: XIcon,
  /** Close a surface that was only ever being read. */
  close: XIcon,
  /** Finish with a picker and return -- nothing is committed. */
  done: CheckIcon,
  /** Create a new record. */
  create: PlusIcon,
  /** Edit an existing record. */
  edit: PencilSimpleIcon,
  /** Destroy a record. */
  remove: TrashIcon,
  /** Re-run a request that failed. */
  retry: ArrowClockwiseIcon,
  /** Drop every filter and show the unfiltered set. */
  clearFilters: FunnelXIcon,
  /** Put a draft back to its last saved state. */
  discard: ArrowCounterClockwiseIcon,
  /** Jump the period back to now -- "Today", "This month". */
  today: CalendarDotIcon,
  /** Leave a flow without completing it. */
  skip: SkipForwardIcon,
  /** Step backwards through a flow. */
  back: ArrowLeftIcon,
  /**
   * Owner, 21 Aug 2026: the one glyph that means "flagged for review". A
   * pennant rather than the plain flag, so nothing else in the product can
   * be mistaken for it; every flag surface reads it from here.
   */
  flag: FlagPennantIcon,
} as const satisfies Record<string, Icon>;

export type ActionName = keyof typeof ACTION_ICONS;
