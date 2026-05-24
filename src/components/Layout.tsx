import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { useAuth } from '@/hooks/useAuth';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogIn, LogOut, Shield, TrendingUp } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

const getPageTitle = (pathname: string) => {
  if (pathname === '/') return 'Dashboard';
  if (pathname === '/explorer') return 'Fund Explorer';
  if (pathname === '/sip') return 'SIP Tracker';
  if (pathname === '/portfolio') return 'Portfolio';
  if (pathname === '/goals') return 'Goals';
  if (pathname === '/reports') return 'Reports';
  if (pathname === '/admin') return 'Admin Panel';
  if (pathname.startsWith('/fund/')) return 'Fund Details';
  if (pathname === '/profile') return 'Profile';
  return '';
};

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { user, isAdmin, signInWithGoogle, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const pageTitle = getPageTitle(location.pathname);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />

        <div className="flex-1 flex flex-col min-h-0 pt-24">
          {/* Header */}
          <header className="fixed top-4 left-4 right-4 h-16 flex items-center justify-between px-6 rounded-2xl bg-card/60 backdrop-blur-md border border-white/10 shadow-sm z-50">
            <div className="flex items-center gap-4">
              <SidebarTrigger className="text-foreground" />
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="h-5 w-5 text-white" />
                </div>
                <h2 className="font-bold text-xl tracking-tight text-foreground hidden sm:block">
                  FundGuru
                </h2>
              </div>
              <div className="h-5 w-px bg-border mx-2 hidden sm:block" />
              <div className="flex-1">
                <h1 className="text-lg font-medium tracking-tight text-muted-foreground">{pageTitle}</h1>
              </div>
            </div>

            {/* Auth Status & Theme */}
            <div className="flex items-center gap-3">
              <ThemeToggle />
              {user ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={user.photoURL || undefined} alt={user.displayName || 'User'} />
                        <AvatarFallback>
                          {user.displayName?.charAt(0)?.toUpperCase() || user.email?.charAt(0)?.toUpperCase() || 'U'}
                        </AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium">{user.displayName}</p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {isAdmin && (
                      <DropdownMenuItem onClick={() => navigate('/admin')} className="cursor-pointer">
                        <Shield className="mr-2 h-4 w-4" />
                        Admin Panel
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={signOut} className="cursor-pointer">
                      <LogOut className="mr-2 h-4 w-4" />
                      Sign Out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button variant="ghost" size="sm" onClick={signInWithGoogle} className="gap-1.5 text-muted-foreground">
                  <LogIn className="h-4 w-4" />
                  Sign In
                </Button>
              )}
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 overflow-auto p-4 md:p-8 pt-4">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}

