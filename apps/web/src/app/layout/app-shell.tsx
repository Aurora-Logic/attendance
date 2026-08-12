import { Keyboard, Monitor, Moon, Search, Sun } from 'lucide-react';
import { Outlet, useLocation } from 'react-router';

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
import { Separator } from '@/components/ui/separator';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { ShortcutLayer } from '@/lib/keyboard/registry';
import { useSessionStore } from '@/lib/session/session-store';
import { useUiStore } from '@/lib/ui-store';
import { SYSTEM_ROLES, type SystemRoleName } from '@vyuha/shared';

import { GoToPalette } from '../goto-palette';
import { ShortcutSheet } from '../shortcut-sheet';
import { AppSidebar } from './app-sidebar';

function ThemeMenu() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label="Change theme" />}
      >
        <Sun className="dark:hidden" />
        <Moon className="hidden dark:block" />
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
            <Sun />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon />
            Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor />
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
        render={<Button variant="outline" size="sm" className="hidden sm:inline-flex" />}
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
      <AppSidebar />

      <SidebarInset className="min-w-0">
        <header className="bg-background sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />

          <Button
            variant="outline"
            size="sm"
            className="text-muted-foreground gap-2 font-normal"
            onClick={toggleGoto}
          >
            <Search />
            <span className="hidden sm:inline">Go to</span>
            {/* The hint chip is desktop-only: there is no keyboard to hint at
                on a phone, and at 360px it was pushing the header 4px wide. */}
            <ShortcutHint keys="alt+g" className="hidden sm:inline-flex" />
          </Button>

          <div className="flex-1" />

          {isPreview ? <PreviewRoleMenu /> : null}

          <Button
            variant="ghost"
            size="icon"
            aria-label="Keyboard shortcuts"
            className="hidden sm:inline-flex"
            onClick={toggleShortcuts}
          >
            <Keyboard />
          </Button>

          <ThemeMenu />
        </header>

        {isPreview ? (
          <div className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Preview mode. No API is running, so this session is not real and no data is loaded.
          </div>
        ) : null}

        {/*
          A new screen pushes a new shortcut scope, so a screen's shortcuts
          unregister cleanly on navigation and cannot leak into the next one.
        */}
        <ShortcutLayer id={`screen:${location.pathname}`}>
          <main className="flex min-w-0 flex-1 flex-col gap-5 p-4 md:p-6">
            <Outlet />
          </main>
        </ShortcutLayer>
      </SidebarInset>

      <GoToPalette />
      <ShortcutSheet />
      <Toaster position="bottom-right" />
    </SidebarProvider>
  );
}
