import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { formatSpec } from '@/lib/keyboard/combo';
import { cn } from '@/lib/utils';

interface ShortcutHintProps {
  /** The TallyPrime key, e.g. "alt+g". */
  keys: string;
  /** Documented fallback for a browser-reserved key. Both are shown. */
  alias?: string;
  className?: string;
}

/**
 * PRD §6.4: "Every control with a shortcut renders a small hint chip showing
 * the key." A control with a registered shortcut and no visible hint is a
 * review failure (technical design §9), so this is the only sanctioned way to
 * display one.
 */
export function ShortcutHint({ keys, alias, className }: ShortcutHintProps) {
  const primary = formatSpec(keys);
  const fallback = alias ? formatSpec(alias) : null;

  return (
    <KbdGroup className={cn('shrink-0', className)}>
      {primary.map((part) => (
        <Kbd key={`primary-${part}`}>{part}</Kbd>
      ))}
      {fallback ? (
        <>
          <span className="text-muted-foreground text-xs">or</span>
          {fallback.map((part) => (
            <Kbd key={`alias-${part}`}>{part}</Kbd>
          ))}
        </>
      ) : null}
    </KbdGroup>
  );
}
