import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon } from '@phosphor-icons/react';

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';

/**
 * A value the reader is meant to take away with them, and the control that
 * takes it.
 *
 * The shadcn composition for this is InputGroup with an inline-end
 * InputGroupButton, which is what this is; the part worth writing once is what
 * happens when the copy does not work. `navigator.clipboard` is absent outside
 * a secure context and can be refused by permission policy, and a Copy button
 * that quietly does nothing is worse than no button at all when the thing being
 * copied is the only way somebody gets an account. So the field is a real,
 * selectable, read-only input: the copy is the convenience, and the text on
 * screen is the guarantee.
 *
 * The outcome is announced rather than only drawn, because "did that work" is
 * the whole question and a swapped icon does not answer it for a screen reader.
 *
 * No `pointer-coarse:h-11` on the button: `InputGroupButton` already grows an
 * invisible `::after` on touch, so its reach is 44px while its paint stays 24px.
 */

const RESET_AFTER_MS = 2500;

interface CopyFieldProps {
  value: string;
  /** The accessible name of the field and of the copy button. */
  label: string;
  id?: string;
}

type Outcome = 'copied' | 'failed';

export function CopyField({ value, label, id }: CopyFieldProps) {
  /**
   * The outcome *and what it was about*.
   *
   * Storing which value was copied is what makes a new link reset the tick
   * without an effect: a tick left standing over a link that has just been
   * replaced would say the clipboard holds the one on screen, and it does not.
   */
  const [attempt, setAttempt] = useState<{ value: string; outcome: Outcome } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const outcome: Outcome | 'idle' =
    attempt !== null && attempt.value === value ? attempt.outcome : 'idle';

  useEffect(() => {
    if (outcome !== 'copied') return undefined;
    const timer = window.setTimeout(() => {
      setAttempt(null);
    }, RESET_AFTER_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [outcome]);

  async function copy() {
    try {
      // No guard on `navigator.clipboard` itself. TypeScript declares it
      // non-optional and it is genuinely absent over plain http, so reading it
      // throws a TypeError -- which this catch handles alongside a refused
      // permission, and which a `!== undefined` check would only make the
      // linter complain about.
      await navigator.clipboard.writeText(value);
      setAttempt({ value, outcome: 'copied' });
    } catch {
      // Not swallowed: the reader is told, and the text is selected so the
      // keyboard can finish the job. There is nothing here worth retrying.
      setAttempt({ value, outcome: 'failed' });
      input.current?.select();
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <InputGroup>
        <InputGroupInput
          ref={input}
          id={id}
          aria-label={label}
          value={value}
          readOnly
          // Selecting on focus makes the manual path one gesture, and it is the
          // path anybody without a clipboard permission is on.
          onFocus={(event) => {
            event.currentTarget.select();
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={outcome === 'copied' ? `${label} copied` : `Copy ${label.toLowerCase()}`}
            onClick={() => {
              void copy();
            }}
          >
            {outcome === 'copied' ? <CheckIcon /> : <CopyIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>

      {/* Always present, so the announcement is an update to a live region
          rather than a region appearing with text already in it — which some
          screen readers do not read out at all. */}
      <p className="text-muted-foreground text-xs" role="status" aria-live="polite">
        {outcome === 'copied'
          ? 'Copied.'
          : outcome === 'failed'
            ? 'This browser would not let the page write to the clipboard. The link is selected — copy it by hand.'
            : ''}
      </p>
    </div>
  );
}
