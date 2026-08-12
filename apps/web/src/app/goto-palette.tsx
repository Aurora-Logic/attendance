import { useNavigate } from 'react-router';

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { ShortcutLayer, useShortcut } from '@/lib/keyboard/registry';
import { NAV_GROUPS } from '@/lib/nav';
import { usePermissions } from '@/lib/session/permissions';
import { useUiStore } from '@/lib/ui-store';

/**
 * REQ-N-01 / technical design §9: Alt+G is the primary navigation, matching
 * Tally's model. Fuzzy search across screens, permission-filtered,
 * arrow-navigable, Enter to execute.
 *
 * Employees, reports, and create-actions join this list as those features
 * arrive; the palette is built before them so nothing has to be retrofitted.
 *
 * Note that `CommandDialog` renders its children straight into the dialog and
 * does not supply the cmdk root itself, so the explicit `<Command>` below is
 * load-bearing. Without it cmdk throws while reading its store, React unmounts
 * the entire app, and the symptom is a blank page rather than a broken dialog.
 */
export function GoToPalette() {
  const navigate = useNavigate();
  const granted = usePermissions();
  const open = useUiStore((s) => s.gotoOpen);
  const setOpen = useUiStore((s) => s.setGotoOpen);
  const toggle = useUiStore((s) => s.toggleGoto);

  useShortcut({
    id: 'global.goto',
    keys: 'alt+g',
    label: 'Go To',
    scope: 'global',
    run: toggle,
  });

  const groups = NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => !item.permission || granted.has(item.permission)),
  })).filter((group) => group.items.length > 0);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Go To"
      description="Jump to any screen or report"
    >
      <ShortcutLayer id="modal:goto">
        <Command>
          <CommandInput placeholder="Go to a screen or report" />
          <CommandList>
            <CommandEmpty>Nothing matches that.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.label} heading={group.label}>
                {group.items.map((item) => (
                  <CommandItem
                    key={item.to}
                    value={`${group.label} ${item.label}`}
                    onSelect={() => {
                      setOpen(false);
                      void navigate(item.to);
                    }}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </ShortcutLayer>
    </CommandDialog>
  );
}
