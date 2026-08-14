import { useState } from 'react';

import { OrgLogoDialog } from '@/components/shared/org-logo-dialog';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useBranding } from '@/lib/branding/use-branding';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS } from '@vyuha/shared';

/**
 * Until the branding read lands. Not a placeholder for the *organisation* —
 * it is the product name, which is what the sidebar said before any of this
 * and what it falls back to if the endpoint is unreachable.
 */
const FALLBACK_NAME = 'Vyuha';
const ORG_TAGLINE = 'Attendance';

/**
 * The sidebar brand.
 *
 * Built on SidebarMenuButton rather than a hand-padded div, which is what
 * makes it line up with the navigation below it. The previous version set its
 * own px-2/py-1.5 around a 28px square while every nav row is a 32px button
 * with 8px padding and a 16px icon, so the mark sat off-centre from the icon
 * column — visible the moment the sidebar collapsed. Sharing the component
 * means the alignment is structural and cannot drift again.
 *
 * The name and the logo now come from the server (REQ-L-01, P0-7) rather than
 * from a constant and localStorage respectively, so an organisation that has
 * set neither still reads correctly and one that has set both is seen that way
 * by everybody rather than only by whoever uploaded the file.
 *
 * Clicking it opens the logo upload for anyone who can manage settings; for
 * everyone else it is inert text, not a button that does nothing.
 */
export function OrgBrand() {
  const branding = useBranding();
  const canManage = usePermission(PERMISSIONS.SETTINGS_MANAGE);
  const [dialogOpen, setDialogOpen] = useState(false);

  const name = branding.data?.name ?? FALLBACK_NAME;
  const logoUrl = branding.data?.logoUrl ?? null;
  const monogram = name.charAt(0).toUpperCase();

  const mark = logoUrl ? (
    <img
      src={logoUrl}
      alt=""
      width={32}
      height={32}
      className="size-8 shrink-0 object-contain"
    />
  ) : (
    <span
      aria-hidden
      className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center text-sm font-semibold"
    >
      {monogram}
    </span>
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          // Base UI needs telling when the rendered element is not a button;
          // a static brand is a div and must not claim button semantics.
          {...(canManage
            ? {
                onClick: () => {
                  setDialogOpen(true);
                },
                tooltip: 'Change organisation logo',
                'aria-label': `${name}. Change organisation logo`,
              }
            : { render: <div />, tabIndex: -1 })}
          className={canManage ? undefined : 'pointer-events-none'}
        >
          {mark}
          <span className="flex min-w-0 flex-col text-left leading-tight">
            <span className="truncate text-sm font-semibold">{name}</span>
            <span className="text-muted-foreground truncate text-xs">{ORG_TAGLINE}</span>
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>

      {canManage ? (
        <OrgLogoDialog open={dialogOpen} onOpenChange={setDialogOpen} monogram={monogram} />
      ) : null}
    </SidebarMenu>
  );
}
