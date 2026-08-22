import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { EMPTY_VALUE } from '@/lib/format';

/**
 * A person, anywhere the product names one: a small initials avatar in a
 * tint that is always the same for the same name, then the name. One
 * composition so an assignee in a task row, an owner on a deal card and a
 * packer on an order all read as the same kind of thing. `null` renders
 * the em dash the tables already use, so cells can pass the name straight
 * through.
 */

const PERSON_HUES = [
  'bg-tint-1/15 text-tint-1',
  'bg-tint-2/15 text-tint-2',
  'bg-tint-3/15 text-tint-3',
  'bg-tint-4/15 text-tint-4',
  'bg-tint-5/15 text-tint-5',
  'bg-tint-6/15 text-tint-6',
  'bg-tint-7/15 text-tint-7',
  'bg-tint-8/15 text-tint-8',
] as const;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : (parts[0]?.[1] ?? '');
  return `${first}${last}`.toUpperCase() || '?';
}

/** The same name always lands on the same tint, on every screen and every visit. */
function hueOf(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return PERSON_HUES[hash % PERSON_HUES.length] ?? PERSON_HUES[0];
}

export function PersonChip({ name, tiny = false, className }: { name: string | null | undefined; tiny?: boolean; className?: string }) {
  if (name === null || name === undefined || name.trim() === '') return <span className="text-muted-foreground">{EMPTY_VALUE}</span>;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 align-middle', className)}>
      <Avatar size="sm" className={cn('after:border-0', tiny && 'size-4.5')}>
        <AvatarFallback className={cn('font-medium', hueOf(name), tiny ? 'text-[0.5625rem]' : 'text-[0.6875rem]')}>{initialsOf(name)}</AvatarFallback>
      </Avatar>
      <span className="truncate">{name}</span>
    </span>
  );
}
