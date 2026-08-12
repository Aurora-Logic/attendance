import { ShortcutHint } from '@/components/shared/shortcut-hint';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ShortcutLayer, useRegisteredShortcuts, useShortcut } from '@/lib/keyboard/registry';
import { useUiStore } from '@/lib/ui-store';

const SCOPE_LABELS: Record<string, string> = {
  global: 'Available everywhere',
  screen: 'This screen',
  modal: 'This dialog',
  field: 'This field',
};

/**
 * REQ-N-04: a reference sheet listing every active shortcut for the current
 * screen. It reads the live registry rather than a maintained list, so a
 * shortcut cannot exist without appearing here.
 *
 * Ctrl+F1 is browser-reserved in places, so F1 is the documented alias
 * (PRD §6.4) and both are shown on the hint.
 */
export function ShortcutSheet() {
  const shortcuts = useRegisteredShortcuts();
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  const toggle = useUiStore((s) => s.toggleShortcuts);

  useShortcut({
    id: 'global.shortcut-sheet',
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

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Keyboard shortcuts</SheetTitle>
          <SheetDescription>
            Every shortcut currently active. Keys match TallyPrime where the browser allows it.
          </SheetDescription>
        </SheetHeader>

        {open ? (
          <ShortcutLayer id="modal:shortcut-sheet">
            <div className="flex flex-col gap-6 overflow-y-auto px-4 pb-6">
              {[...byScope.entries()].map(([scope, list]) => (
                <div key={scope} className="flex flex-col gap-2">
                  <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {SCOPE_LABELS[scope] ?? scope}
                  </h3>
                  <div className="flex flex-col">
                    {list.map((shortcut) => (
                      <div
                        key={shortcut.id}
                        className="flex min-h-11 items-center justify-between gap-4 border-b py-2 last:border-b-0"
                      >
                        <span className="text-sm">{shortcut.label}</span>
                        <ShortcutHint keys={shortcut.keys} alias={shortcut.alias} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ShortcutLayer>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
