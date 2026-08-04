import { ChevronsUpDown, Clock, LogOut, UserRound } from "lucide-react"
import { NavLink } from "react-router"

import { NAV_GROUPS } from "@/lib/nav"
import { ROLE_LABEL, useSession } from "@/lib/session"
import { ROLES } from "@attendance/shared"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"

export function AppSidebar() {
  const session = useSession()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <NavLink to="/">
                <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Clock className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Delta Attendance</span>
                  <span className="text-muted-foreground truncate text-xs">
                    Mumbai HO
                  </span>
                </div>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group) => {
          // Entries the signed-in role has no grant for are not rendered. The
          // check is against the permission matrix, never a role name.
          const items = group.items.filter(
            (item) => !item.permission || session.can(item.permission)
          )
          if (items.length === 0) return null

          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild tooltip={item.title}>
                        <NavLink to={item.url} end={item.url === "/"}>
                          {({ isActive }) => (
                            <>
                              <item.icon data-active={isActive} />
                              <span>{item.title}</span>
                            </>
                          )}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )
        })}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg">
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg">{session.initials}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{session.name}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {ROLE_LABEL[session.role]}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <span className="block text-sm font-medium">{session.name}</span>
                  <span className="text-muted-foreground block text-xs">{session.email}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {/* Until Phase 1 auth, switching role here proves the matrix
                    actually drives what is visible. */}
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  View as role
                </DropdownMenuLabel>
                {ROLES.map((role) => (
                  <DropdownMenuItem key={role} onClick={() => session.setRole(role)}>
                    <UserRound />
                    {ROLE_LABEL[role]}
                    {role === session.role ? (
                      <span className="text-muted-foreground ml-auto text-xs">current</span>
                    ) : null}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
