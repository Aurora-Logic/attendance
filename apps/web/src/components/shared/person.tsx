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
  'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
  'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
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
