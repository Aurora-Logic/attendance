import { CompassIcon } from '@phosphor-icons/react';

import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ShortcutLayer, useRegisteredShortcuts, useShortcut } from '@/lib/keyboard/registry';
import { useGuideStore } from '@/lib/guide-store';
import { useUiStore } from '@/lib/ui-store';

const SCOPE_LABELS: Record<string, string> = {
  global: 'Available everywhere',
  screen: 'This screen',
  modal: 'This dialog',
  field: 'This field',
};

/** The order scopes are shown in: widest reach first, narrowest last. */
const SCOPE_ORDER = ['global', 'screen', 'modal', 'field'];

/**
 * REQ-N-04: a reference listing every active shortcut for the current screen.
 * It reads the live registry rather than a maintained list, so a shortcut
 * cannot exist without appearing here.
 *
 * A centred dialog rather than a side sheet. A shortcut reference is something
 * you consult and dismiss, not a panel you work alongside; a sheet pinned to
 * one edge pushed a two-column list into a narrow strip and made the longer
 * screen-scoped labels wrap. Centred, it can be two columns on a wide screen
 * and one on a phone.
 *
 * Ctrl+F1 is browser-reserved in places, so F1 is the documented alias
 * (PRD §6.4) and both are shown on the hint.
 */
export function ShortcutDialog() {
  const shortcuts = useRegisteredShortcuts();
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  const toggle = useUiStore((s) => s.toggleShortcuts);
  const arm = useGuideStore((s) => s.arm);

  /*
   * Armed rather than called, for the same reason the account menu arms it:
   * the run state belongs to GuideOverlay, which is a sibling of this dialog
   * rather than an ancestor. One channel in, whoever is asking.
   */
  const startPageGuide = () => {
    arm({ scope: 'page' });
  };

  useShortcut({
    id: 'global.shortcut-reference',
    keys: 'ctrl+f1',
    alias: 'f1',
    label: 'Shortcut reference',
    scope: 'global',
    run: toggle,
  });

  const byScope = new Map<string, typeof shortcuts>();
  for (const shortcut of shortcuts) {
    const list = byScope.get(shortcut.scope) ?? [];
    list.push(shortcut);
    byScope.set(shortcut.scope, list);
  }

  const groups = SCOPE_ORDER.filter((scope) => byScope.has(scope)).map((scope) => ({
    scope,
    list: (byScope.get(scope) ?? []).sort((a, b) => a.label.localeCompare(b.label)),
  }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Opened by reflex dozens of times a day, so it appears with no motion
          — the same exemption as the Go To palette, explained in index.css. */}
      <DialogContent className="surface-instant max-h-[85vh] gap-4 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>This screen</DialogTitle>
          <DialogDescription>
            Every shortcut active right now. Keys match TallyPrime wherever the browser allows it.
          </DialogDescription>
        </DialogHeader>

        {/*
          PRD §6.4 calls Ctrl+F1 "contextual help / shortcut sheet", and until
          now this dialog only did the second half. A walk through the screen
          you are already looking at is the other half, and it belongs on the
          key the specification already reserved for it rather than on new
          chrome in the header.

          It closes the sheet before starting, or the tour would spend its
          first step highlighting a control behind a dialog.
        */}
        <Button
          variant="outline"
          className="justify-start"
          onClick={() => {
            setOpen(false);
            startPageGuide();
          }}
        >
          <CompassIcon data-icon="inline-start" />
          Walk me through this screen
        </Button>

        {open ? (
          <ShortcutLayer id="modal:shortcut-reference">
            <div className="flex flex-col gap-5">
              {groups.map(({ scope, list }) => (
                <section key={scope} className="flex flex-col gap-1.5">
                  <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {SCOPE_LABELS[scope] ?? scope}
                  </h3>
                  <div className="grid gap-x-8 sm:grid-cols-2">
                    {list.map((shortcut) => (
                      <div
                        key={shortcut.id}
                        className="flex min-h-9 items-center justify-between gap-4 border-b py-1.5 last:border-b-0 sm:last:border-b"
                      >
                        <span className="min-w-0 truncate text-sm">{shortcut.label}</span>
                        <ShortcutHint keys={shortcut.keys} alias={shortcut.alias} />
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </ShortcutLayer>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
