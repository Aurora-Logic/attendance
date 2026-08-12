import {
  InfoIcon,
  KeyboardIcon,
  MagnifyingGlassIcon,
  MonitorIcon,
  MoonIcon,
  SignOutIcon,
  SunIcon,
  UserCircleIcon,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { BreadcrumbTrail } from '@/components/shared/breadcrumb-trail';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { useTheme } from '@/components/theme-provider';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/toast';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useIsMobile } from '@/hooks/use-mobile';
import { ShortcutLayer } from '@/lib/keyboard/registry';
import { findBreadcrumbs } from '@/lib/nav';
import { useSessionStore } from '@/lib/session/session-store';
import { useLogout, useMe } from '@/lib/session/use-session';
import { useUiStore } from '@/lib/ui-store';
import { employeeDisplayName, SYSTEM_ROLES, type SystemRoleName } from '@vyuha/shared';

import { MobileBottomNav } from '@/components/shared/mobile-bottom-nav';

import { GoToPalette } from '../goto-palette';
import { ShortcutDialog } from '../shortcut-dialog';
import { AppSidebar } from './app-sidebar';

/**
 * Theme choice, as a section of the account menu rather than a control of its
 * own. It was a second icon button sitting beside the avatar, which is a lot
 * of permanent header real estate for something a person sets once and then
 * leaves alone; it belongs with the other things that are about them rather
 * than about the page.
 *
 * The label lives inside the radio group: Base UI reads its group context and
 * throws outright if a label is rendered loose in the popup, which takes the
 * whole menu down with it.
 */
function ThemeSection() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenuRadioGroup
      value={theme}
      onValueChange={(v) => {
        setTheme(v as 'light' | 'dark' | 'system');
      }}
    >
      <DropdownMenuLabel>Theme</DropdownMenuLabel>
      <DropdownMenuRadioItem value="light">
        <SunIcon />
        Light
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="dark">
        <MoonIcon />
        Dark
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="system">
        <MonitorIcon />
        System
      </DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  );
}

/**
 * Two letters for the avatar. Falls back to the first character of whatever
 * name we have rather than rendering an empty circle, because an employee
 * record is only guaranteed a first name (the contract makes lastName
 * nullable) and a signed-in user may have no employee record at all.
 */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const first = words[0]?.charAt(0) ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

/**
 * The same three choices as ThemeSection, laid out for a phone.
 *
 * A ToggleGroup rather than three buttons with hand-managed pressed state:
 * three mutually exclusive options is exactly what it is for, and it carries
 * the radio semantics and arrow-key movement for free.
 *
 * The guard on an empty selection matters — Base UI reports the group value as
 * an array and will hand back an empty one if the pressed item is pressed
 * again. There is no such thing as "no theme", so that deselect is ignored.
 */
function ThemeToggleGroup() {
  const { theme, setTheme } = useTheme();

  return (
    <ToggleGroup
      variant="outline"
      className="w-full"
      value={[theme]}
      onValueChange={(value) => {
        const next = value[0];
        if (next) setTheme(next as 'light' | 'dark' | 'system');
      }}
    >
      <ToggleGroupItem value="light" className="min-h-11 flex-1">
        <SunIcon />
        Light
      </ToggleGroupItem>
      <ToggleGroupItem value="dark" className="min-h-11 flex-1">
        <MoonIcon />
        Dark
      </ToggleGroupItem>
      <ToggleGroupItem value="system" className="min-h-11 flex-1">
        <MonitorIcon />
        System
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/**
 * Who is signed in, and the way out.
 *
 * Reads `/me` directly rather than the session store: the store flattens roles
 * to a display string for the sidebar, and this menu needs the email and the
 * roles as they actually came back from the server.
 *
 * Every label here comes from the API answer. Nothing is derived from a role
 * name (PRD §2: nothing branches on a role), and nothing is remembered locally
 * — sign out clears the query cache, so the next render has nothing to leak.
 */
function UserMenu() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const logout = useLogout();
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);

  // AppShell only renders behind SessionGate, so this is a type narrowing
  // rather than a real state. Rendering nothing beats rendering "Unknown".
  if (!me) return null;

  const name = me.employee
    ? employeeDisplayName(me.employee.firstName, me.employee.lastName)
    : me.user.email;
  const roleLabel = me.roles.map((role) => role.name).join(', ') || 'No role';
  const initials = initialsOf(name);

  function goToProfile() {
    setSheetOpen(false);
    void navigate('/profile');
  }

  /*
   * On a phone this is a bottom Sheet rather than the dropdown.
   *
   * As a popover it was a ~240px column pinned to the top-right corner
   * carrying ten rows — three lines of identity, a theme label and its three
   * options, then two actions — reaching most of the way down a 360px screen
   * from the furthest point from the thumb. CLAUDE.md §3.1 asks for a Sheet on
   * small screens, and More and Customise already open that way, so this also
   * stops the phone having two different ideas of what a menu is.
   *
   * It is also shorter: the identity collapses into the header beside the
   * avatar, the three theme options become one row instead of four, and the
   * two actions share a row.
   */
  if (isMobile) {
    return (
      <>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Account menu for ${name}`}
          onClick={() => {
            setSheetOpen(true);
          }}
        >
          <Avatar size="sm">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </Button>

        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="bottom" className="gap-0">
            <SheetHeader className="flex-row items-center gap-3 border-b">
              <Avatar>
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col">
                <SheetTitle className="truncate">{name}</SheetTitle>
                {/* An account with no employee record falls back to the email
                    as its name, and printing it again underneath just reads as
                    a rendering bug. */}
                {me.user.email === name ? null : (
                  <SheetDescription className="truncate">{me.user.email}</SheetDescription>
                )}
                <SheetDescription className="truncate">{roleLabel}</SheetDescription>
              </div>
            </SheetHeader>

            <div className="flex flex-col gap-2 p-4">
              <span className="text-muted-foreground text-xs font-medium">Theme</span>
              {/* One row of three rather than three stacked rows. A set this
                  small reads faster side by side, and it costs one row of
                  height instead of four. */}
              <ThemeToggleGroup />
            </div>

            <SheetFooter className="flex-row gap-2 border-t">
              <Button variant="outline" className="flex-1" onClick={goToProfile}>
                <UserCircleIcon data-icon="inline-start" />
                Profile
              </Button>
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive flex-1"
                disabled={logout.isPending}
                onClick={() => {
                  logout.mutate();
                }}
              >
                <SignOutIcon data-icon="inline-start" />
                {logout.isPending ? 'Signing out' : 'Sign out'}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <DropdownMenu>
      {/* The avatar alone, at every width. The name and role used to sit
          beside it above lg, which made the header's right edge a different
          shape on a large screen than on a small one, and spent the widest
          part of the layout restating something the person already knows. The
          menu below states the name, the email and the roles in full, and the
          trigger's aria-label carries the name for anyone who cannot see the
          initials — so nothing is lost by not printing it. */}
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={`Account menu for ${name}`} />
        }
      >
        <Avatar size="sm">
          <AvatarFallback>{initialsOf(name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        {/* The label is inside a group for the same reason the theme label is
            inside its radio group: Base UI reads the group context and throws
            when a GroupLabel is rendered loose in the popup, which takes the
            whole menu down. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5 py-2.5">
            <span className="text-foreground truncate text-xs font-medium">{name}</span>
            {me.user.email === name ? null : <span className="truncate">{me.user.email}</span>}
            <span className="truncate">{roleLabel}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <ThemeSection />

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => {
              void navigate('/profile');
            }}
          >
            <UserCircleIcon />
            Profile
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={logout.isPending}
            onClick={() => {
              // No confirmation. Signing back in costs one form, and a
              // confirm dialog on a reversible action is friction, not safety.
              logout.mutate();
            }}
          >
            <SignOutIcon />
            {logout.isPending ? 'Signing out' : 'Sign out'}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Development only, and rendered only when the session came from the preview
 * path rather than from `/me`. It exists so the permission filtering in the
 * sidebar and the Go To palette can be seen working before the auth endpoints
 * are built. It disappears the moment a real session is present.
 */
function PreviewRoleMenu() {
  const roleLabel = useSessionStore((s) => s.roleLabel);
  const applyPreviewRole = useSessionStore((s) => s.applyPreviewRole);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="ml-auto h-7 shrink-0 text-xs" />}
      >
        Preview: {roleLabel}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>No API yet — preview a role</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {Object.values(SYSTEM_ROLES).map((role: SystemRoleName) => (
            <DropdownMenuItem
              key={role}
              onSelect={() => {
                applyPreviewRole(role);
              }}
            >
              {role}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell() {
  const location = useLocation();
  const isPreview = useSessionStore((s) => s.isPreview);
  const toggleGoto = useUiStore((s) => s.toggleGoto);
  const toggleShortcuts = useUiStore((s) => s.toggleShortcuts);

  return (
    <SidebarProvider>
      {/* First focusable element in the document, and it has to be: it used to
          sit inside SidebarInset, which renders after the sidebar, so the first
          Tab landed on the organisation brand and a keyboard user still had to
          walk the whole sidebar. Caught by a probe, not by reading.

          Padding is applied only on focus. Alongside sr-only it beat that
          utility's padding: 0 and inflated the hidden link into a real 24x16
          target while it was still invisible. */}
      <a
        href="#main-content"
        className="bg-background focus-visible:ring-ring sr-only text-sm font-medium focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:px-3 focus-visible:py-2 focus-visible:ring-2"
      >
        Skip to content
      </a>

      <AppSidebar />

      <SidebarInset className="min-w-0">

        {/* A material rather than an opaque strip: content scrolls under it and
            stays faintly legible, which keeps the page feeling continuous while
            scrolling a long muster. Falls back to solid where the browser has
            no backdrop-filter, and where the reader has asked for reduced
            transparency. */}
        <header className="bg-background/85 supports-backdrop-filter:bg-background/70 reduced-transparency:bg-background reduced-transparency:backdrop-blur-none sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b px-3 backdrop-blur-md">
          {/* Desktop only. On a phone the bottom bar is the navigation, and
              keeping a hamburger that opens a second, different nav gives the
              screen two answers to "where can I go". */}
          <SidebarTrigger className="hidden md:inline-flex" />
          {/* The 16px vertical rule that used to sit here is gone. In a 56px
              header it read as a stray half-drawn line rather than a divider,
              and the gap between the trigger and the breadcrumb already
              separates them. Deleting beats tuning a mark that was doing no
              work. */}

          {/* The page states its identity here and nowhere else, so the body
              starts straight into content. Derived from the route rather than
              passed up by the screen — a screen cannot forget to say who it
              is, and two screens cannot name the same route differently. */}
          <BreadcrumbTrail crumbs={findBreadcrumbs(location.pathname)} />

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="text-muted-foreground max-sm:size-11 max-sm:border-transparent max-sm:bg-transparent max-sm:px-0 max-sm:shadow-none gap-2 font-normal"
              onClick={toggleGoto}
            >
              <MagnifyingGlassIcon />
              <span className="hidden sm:inline">Go to</span>
              {/* The hint chip is desktop-only: there is no keyboard to hint at
                  on a phone, and at 360px it was pushing the header 4px wide. */}
              <ShortcutHint keys="alt+g" className="hidden sm:inline-flex" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              aria-label="Keyboard shortcuts"
              className="hidden sm:inline-flex"
              onClick={toggleShortcuts}
            >
              <KeyboardIcon />
            </Button>

            <UserMenu />
          </div>
        </header>

        {isPreview ? (
          // Theme tokens only. The previous amber palette values bypassed the
          // theme entirely and would not have followed a rebrand (CLAUDE.md §3
          // rule 1); the icon carries the signal the colour used to.
          <div className="text-muted-foreground bg-muted/40 flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 text-xs">
            <InfoIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="min-w-0">
              Preview mode. No API is running, so this session is not real and no data is loaded.
            </span>
            {/* The role switcher sits with the notice that explains it rather
                than in the header. Both are development-only and both vanish
                on the same condition, so the control cannot outlive its
                explanation or be left behind in production chrome. */}
            <PreviewRoleMenu />
          </div>
        ) : null}

        {/*
          A new screen pushes a new shortcut scope, so a screen's shortcuts
          unregister cleanly on navigation and cannot leak into the next one.
        */}
        <ShortcutLayer id={`screen:${location.pathname}`}>
          {/* A div, not a <main>. SidebarInset already renders the page's
              <main> landmark, and nesting a second one is invalid and leaves
              assistive technology with two competing "main content" regions.
              This is only the skip-link target inside that landmark. */}
          <div
            id="main-content"
            tabIndex={-1}
            // pb-24 clears the fixed bottom bar on a phone. Without it the last
            // row of any list sits under the bar and cannot be reached.
            className="flex min-w-0 flex-1 flex-col gap-6 p-4 pb-24 outline-none md:p-6 md:pb-6"
          >
            <Outlet />
          </div>
        </ShortcutLayer>
      </SidebarInset>

      <MobileBottomNav />

      <GoToPalette />
      <ShortcutDialog />
      {/* Base UI's viewport owns its placement (bottom-right above sm, full
          width on a phone), so there is no position prop to pass. */}
      <Toaster />
    </SidebarProvider>
  );
}
