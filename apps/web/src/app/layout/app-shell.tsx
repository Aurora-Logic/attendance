import {
  InfoIcon,
  KeyboardIcon,
  MagnifyingGlassIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from '@phosphor-icons/react';
import { Outlet, useLocation } from 'react-router';

import { BreadcrumbTrail } from '@/components/shared/breadcrumb-trail';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { useTheme } from '@/components/theme-provider';
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
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/toast';
import { ShortcutLayer } from '@/lib/keyboard/registry';
import { findBreadcrumbs } from '@/lib/nav';
import { useSessionStore } from '@/lib/session/session-store';
import { useUiStore } from '@/lib/ui-store';
import { SYSTEM_ROLES, type SystemRoleName } from '@vyuha/shared';

import { MobileBottomNav } from '@/components/shared/mobile-bottom-nav';

import { GoToPalette } from '../goto-palette';
import { ShortcutDialog } from '../shortcut-dialog';
import { AppSidebar } from './app-sidebar';

function ThemeMenu() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label="Change theme" />}
      >
        <SunIcon className="dark:hidden" />
        <MoonIcon className="hidden dark:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* The label lives inside the radio group: Base UI reads its group
            context and throws outright if a label is rendered loose in the
            popup, which takes the whole menu down with it. */}
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

            <ThemeMenu />
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
