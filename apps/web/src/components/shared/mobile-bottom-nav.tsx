import { useMemo, useState } from 'react';
import {
  ArrowCounterClockwiseIcon,
  CheckIcon,
  DotsThreeIcon,
  SlidersHorizontalIcon,
  XIcon,
} from '@phosphor-icons/react';
import { NavLink, useLocation, useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ALL_NAV_ITEMS, type NavItem } from '@/lib/nav';
import { BOTTOM_NAV_SLOTS, useNavPreferencesStore } from '@/lib/nav-preferences-store';
import { usePermissions } from '@/lib/session/permissions';
import { cn } from '@/lib/utils';

/**
 * The phone's primary navigation (mobile-first, PRD §6.5).
 *
 * A sidebar behind a hamburger is a desktop pattern wearing a phone costume:
 * it puts every destination two taps away and none of them in reach of a
 * thumb. A bottom bar puts the four things this person actually does where
 * their thumb already is, and everything else one tap away under More.
 *
 * Which four is a preference rather than a guess. A shop-floor employee opens
 * Punch and nothing else; HR lives in Approvals and Reports. Both are the same
 * role in some deployments, so the bar is chosen per person and per device.
 *
 * This is an addition to the PRD §6.1 navigation model, which describes only
 * the sidebar. Recorded as P0-8.
 */
export function MobileBottomNav() {
  const granted = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();
  const chosen = useNavPreferencesStore((s) => s.bottomNavRoutes);

  const [moreOpen, setMoreOpen] = useState(false);
  const [customiseOpen, setCustomiseOpen] = useState(false);

  const permitted = useMemo(
    () => ALL_NAV_ITEMS.filter((item) => !item.permission || granted.has(item.permission)),
    [granted],
  );

  // A stored route the person can no longer reach is dropped rather than
  // rendered as a dead tab: permissions change, and a bar remembered from a
  // wider role must not outlive the access that justified it.
  const primary = useMemo(() => {
    const permittedRoutes = new Set(permitted.map((i) => i.to));
    const fromPreference = (chosen ?? [])
      .filter((route) => permittedRoutes.has(route))
      .map((route) => permitted.find((i) => i.to === route))
      .filter((i): i is NavItem => Boolean(i));

    if (chosen !== null) return fromPreference.slice(0, BOTTOM_NAV_SLOTS);
    return permitted.slice(0, BOTTOM_NAV_SLOTS);
  }, [chosen, permitted]);

  const primaryRoutes = new Set(primary.map((i) => i.to));
  const overflow = permitted.filter((item) => !primaryRoutes.has(item.to));

  if (permitted.length === 0) return null;

  return (
    <>
      {/*
        Fixed rather than sticky so it survives a scrolling content region, and
        padded by the safe-area inset so the home indicator on a modern phone
        does not sit on top of the tab labels.
      */}
      <nav
        aria-label="Primary"
        className="bg-background/95 supports-backdrop-filter:bg-background/80 reduced-transparency:bg-background reduced-transparency:backdrop-blur-none fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        <ul className="flex items-stretch justify-around">
          {primary.map((item) => (
            <li key={item.to} className="min-w-0 flex-1">
              <NavLink
                to={item.to}
                aria-current={location.pathname === item.to ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-1.5 text-[0.6875rem]',
                  location.pathname === item.to
                    ? 'text-primary font-medium'
                    : 'text-muted-foreground',
                )}
              >
                <item.icon aria-hidden className="size-5 shrink-0" />
                <span className="w-full truncate text-center">{item.shortLabel ?? item.label}</span>
              </NavLink>
            </li>
          ))}

          <li className="min-w-0 flex-1">
            <Button
              variant="ghost"
              aria-label="More destinations"
              aria-expanded={moreOpen}
              onClick={() => {
                setMoreOpen(true);
              }}
              // h-auto because the tab is two stacked lines, not the single
              // row the button variant sizes for.
              className="text-muted-foreground h-auto min-h-14 w-full flex-col gap-1 rounded-none px-1 py-1.5 text-[0.6875rem] font-normal"
            >
              <DotsThreeIcon aria-hidden className="size-5 shrink-0" />
              <span className="w-full truncate text-center">More</span>
            </Button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        {/* The sheet itself no longer scrolls. It is a flex column whose middle
            band scrolls, which pins the title and the action to the top and
            bottom edges instead of letting them slide away — on a phone the
            close control and the primary action are the two things that must
            never require scrolling back to find. */}
        <SheetContent side="bottom" className="max-h-[80vh] gap-0">
          <SheetHeader className="shrink-0 border-b">
            <SheetTitle>All destinations</SheetTitle>
            <SheetDescription>Everything your access allows.</SheetDescription>
          </SheetHeader>

          {/* min-h-0 is load-bearing: a flex child defaults to min-height:auto,
              which refuses to shrink below its content and would push the
              footer off the sheet instead of scrolling. */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {/* A grid of tiles rather than a single column of rows. One row per
                destination pushed the last few below the fold on a phone and
                wasted the full width on a 20px icon; two columns fit twelve
                destinations in a glance. Three from sm, where the tile can be
                wide enough for "Roles and permissions" without wrapping. */}
            <ItemGroup role="presentation" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {overflow.map((item) => (
                <Item
                  key={item.to}
                  variant="outline"
                  render={<NavLink to={item.to} />}
                  onClick={() => {
                    setMoreOpen(false);
                  }}
                  className="min-h-20 flex-col items-center justify-center gap-1.5 px-2 py-3"
                >
                  <ItemMedia>
                    <item.icon aria-hidden className="size-5" />
                  </ItemMedia>
                  <ItemContent className="flex-none">
                    {/* line-clamp-2 rather than the default 1: "Roles and
                        permissions" needs two lines in a 360px column. */}
                    <ItemTitle className="line-clamp-2 w-full justify-center text-center leading-tight">
                      {item.label}
                    </ItemTitle>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          </div>

          <SheetFooter className="shrink-0 border-t">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setMoreOpen(false);
                setCustomiseOpen(true);
              }}
            >
              <SlidersHorizontalIcon data-icon="inline-start" />
              Customise this bar
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <CustomiseSheet
        open={customiseOpen}
        onOpenChange={setCustomiseOpen}
        permitted={permitted}
        current={primary.map((i) => i.to)}
        onNavigateHome={() => {
          void navigate('/');
        }}
      />
    </>
  );
}

interface CustomiseSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  permitted: NavItem[];
  current: string[];
  onNavigateHome: () => void;
}

function CustomiseSheet({
  open,
  onOpenChange,
  permitted,
  current,
  onNavigateHome,
}: CustomiseSheetProps) {
  const setBottomNavRoutes = useNavPreferencesStore((s) => s.setBottomNavRoutes);
  const resetBottomNav = useNavPreferencesStore((s) => s.resetBottomNav);
  const [draft, setDraft] = useState<string[]>(current);

  // Reopening after a change should show what is stored, not what was being
  // edited last time the sheet was dismissed.
  const [seededFor, setSeededFor] = useState(current.join('|'));
  if (open && seededFor !== current.join('|')) {
    setSeededFor(current.join('|'));
    setDraft(current);
  }

  const full = draft.length >= BOTTOM_NAV_SLOTS;

  function toggle(route: string, checked: boolean) {
    setDraft((prev) => {
      if (checked) return prev.includes(route) ? prev : [...prev, route];
      return prev.filter((r) => r !== route);
    });
  }

  return (
    // A bottom Sheet rather than a centred Dialog, because this opens from the
    // More sheet and replaces it: two modals on the same phone, one arriving
    // from the bottom and the next from the middle, read as two unrelated
    // surfaces. CLAUDE.md §3.1 asks for a Sheet on small screens anyway, and
    // this component never renders above md.
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[80vh] gap-0">
        <SheetHeader className="shrink-0 border-b">
          <SheetTitle>Customise the bar</SheetTitle>
          <SheetDescription>
            Pick up to {BOTTOM_NAV_SLOTS} destinations for the bottom bar. Everything else stays
            under More.
          </SheetDescription>
        </SheetHeader>

        {/* Only this band scrolls, so the title above and the three actions
            below stay put while sixteen tiles move past. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* Same grid, same tile size, same columns as the More sheet: this
              chooser and the list it edits show the same destinations, so they
              should not disagree about what a destination looks like. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {permitted.map((item) => {
              const checked = draft.includes(item.to);
              // A full bar disables the unchosen tiles rather than silently
              // ignoring the tap, so the limit is visible before it is hit.
              const disabled = !checked && full;
              return (
                <Button
                  key={item.to}
                  type="button"
                  variant={checked ? 'default' : 'outline'}
                  aria-pressed={checked}
                  disabled={disabled}
                  onClick={() => {
                    toggle(item.to, !checked);
                  }}
                  className="h-auto min-h-20 flex-col gap-1.5 px-2 py-3 text-center whitespace-normal"
                >
                  <item.icon aria-hidden className="size-5 shrink-0" />
                  <span className="w-full text-[0.75rem] leading-tight">{item.label}</span>
                </Button>
              );
            })}
          </div>
        </div>

        {/* Outside the scrolling band: this is the count against a hard limit,
            and it is worth nothing if it scrolls away while tiles are being
            tapped. It carries the divider so the fixed bottom block reads as
            one piece rather than two stacked rules. */}
        <p className="text-muted-foreground shrink-0 border-t px-4 pt-3 text-xs" aria-live="polite">
          {draft.length} of {BOTTOM_NAV_SLOTS} chosen
        </p>

        {/* SheetFooter stacks into a column, which turned three short actions
            into three full-width bars and pushed Save furthest from the thumb.
            They fit one row at 360px, so they stay in one row and share the
            width evenly. Each carries an icon, so the action is readable
            before the label is. */}
        <SheetFooter className="shrink-0 flex-row justify-end gap-2 pt-3">
          <Button
            variant="ghost"
            className="flex-1 sm:flex-none"
            onClick={() => {
              resetBottomNav();
              onOpenChange(false);
            }}
          >
            <ArrowCounterClockwiseIcon data-icon="inline-start" />
            Reset
          </Button>
          <Button
            variant="outline"
            className="flex-1 sm:flex-none"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            <XIcon data-icon="inline-start" />
            Cancel
          </Button>
          <Button
            className="flex-1 sm:flex-none"
            onClick={() => {
              setBottomNavRoutes(draft);
              onOpenChange(false);
              // If the current screen just left the bar entirely, the person is
              // standing somewhere they can no longer see; take them home.
              if (draft.length === 0) onNavigateHome();
            }}
          >
            <CheckIcon data-icon="inline-start" />
            Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
