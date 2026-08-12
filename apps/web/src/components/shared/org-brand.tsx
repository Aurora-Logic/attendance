import { useState } from 'react';

import { OrgLogoDialog } from '@/components/shared/org-logo-dialog';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useBrandingStore } from '@/lib/branding/branding-store';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS } from '@vyuha/shared';

const ORG_NAME = 'Vyuha';
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
 * Clicking it opens the logo upload for anyone who can manage settings; for
 * everyone else it is inert text, not a button that does nothing.
 */
export function OrgBrand() {
  const logoDataUrl = useBrandingStore((s) => s.logoDataUrl);
  const canManage = usePermission(PERMISSIONS.SETTINGS_MANAGE);
  const [dialogOpen, setDialogOpen] = useState(false);

  const monogram = ORG_NAME.charAt(0).toUpperCase();

  const mark = logoDataUrl ? (
    <img
      src={logoDataUrl}
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
                'aria-label': `${ORG_NAME}. Change organisation logo`,
              }
            : { render: <div />, tabIndex: -1 })}
          className={canManage ? undefined : 'pointer-events-none'}
        >
          {mark}
          <span className="flex min-w-0 flex-col text-left leading-tight">
            <span className="truncate text-sm font-semibold">{ORG_NAME}</span>
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
