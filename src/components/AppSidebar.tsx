import { User, PlusCircle, Briefcase, Target, BarChart3, Home, TrendingUp, Shield, Wand2 } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';

const mainItems = [
  { title: 'Dashboard', url: '/', icon: Home },
  { title: 'Fund Explorer', url: '/explorer', icon: TrendingUp },
  { title: 'Investment Builder', url: '/builder', icon: Wand2 },
];

const investmentItems = [
  { title: 'Portfolio', url: '/portfolio', icon: Briefcase },
  { title: 'SIP Management', url: '/sip', icon: PlusCircle },
  { title: 'Goals', url: '/goals', icon: Target },
  { title: 'Reports', url: '/reports', icon: BarChart3 },
];

const accountItems = [{ title: 'Profile', url: '/profile', icon: User }];

export function AppSidebar() {
  const { state } = useSidebar();
  const location = useLocation();
  const currentPath = location.pathname;
  const { user, isAdmin } = useAuth();

  const isActive = (path: string) =>
    currentPath === path || (path !== '/' && currentPath.startsWith(path));

  return (
    <Sidebar variant="floating" collapsible="icon" className="border-none shadow-elegant ml-4 !top-24 !bottom-4 my-auto !h-fit max-h-[calc(100vh-7rem)] rounded-2xl">
      <SidebarContent>
        {/* Main Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <NavLink to={item.url} end>
                      <item.icon className="h-4 w-4" />
                      {state !== 'collapsed' && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Investment Management */}
        {user && (
          <SidebarGroup>
            <SidebarGroupLabel>Investment</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {investmentItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
                      <NavLink to={item.url}>
                        <item.icon className="h-4 w-4" />
                        {state !== 'collapsed' && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Account */}
        {user && (
          <SidebarGroup>
            <SidebarGroupLabel>Account</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {accountItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
                      <NavLink to={item.url}>
                        <item.icon className="h-4 w-4" />
                        {state !== 'collapsed' && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                {isAdmin && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={isActive('/admin')}>
                      <NavLink to="/admin">
                        <Shield className="h-4 w-4" />
                        {state !== 'collapsed' && <span>Admin</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}

