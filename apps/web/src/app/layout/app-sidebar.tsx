import { GearSixIcon } from '@phosphor-icons/react';
import { NavLink, useLocation } from 'react-router';

import { OrgBrand } from '@/components/shared/org-brand';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { NAV_GROUPS, type NavItem } from '@/lib/nav';
import { usePermissions } from '@/lib/session/permissions';

function isVisible(item: NavItem, granted: ReadonlySet<string>): boolean {
  return !item.permission || granted.has(item.permission);
}

export function AppSidebar() {
  const granted = usePermissions();
  const location = useLocation();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <OrgBrand />
      </SidebarHeader>

      {/* Anchor for the guided tour's first step. On the content rather than
          on one group, because which groups exist depends on the permission
          set and a tour cannot point at a group that was filtered away. */}
      <SidebarContent data-guide="nav.groups">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => isVisible(item, granted));
          // A group whose every item is hidden by permission renders nothing
          // rather than an empty labelled section.
          if (items.length === 0) return null;

          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        render={<NavLink to={item.to} />}
                        isActive={location.pathname === item.to}
                        tooltip={item.label}
                      >
                        <item.icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      {/*
        REQ-O-02. The workspace's screens are reached from here rather than from
        a group in the module's own list -- they outlive whichever module is
        open, so they sit below the module rather than inside it.
      */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<NavLink to="/administration" />}
              isActive={location.pathname === '/administration'}
              tooltip="Administration"
            >
              <GearSixIcon />
              <span>Administration</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
