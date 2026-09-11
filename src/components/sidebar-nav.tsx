'use client';

import { useAppStore, AppView, UserRole } from '@/stores/app-store';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  CalendarDays,
  Ticket,
  QrCode,
  Bell,
  LayoutDashboard,
  CalendarPlus,
  PlusCircle,
  BarChart3,
  Megaphone,
  ScanLine,
  Users,
  CreditCard,
  LogOut,
  Menu,
  UserCircle,
  Lock,
  Building2,
  UserCog,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface NavItem {
  view: AppView;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: Record<UserRole, NavItem[]> = {
  PUBLIC: [
    { view: 'public-discover', label: 'Discover Events', icon: CalendarDays },
    { view: 'my-bookings', label: 'My Bookings', icon: Ticket },
    { view: 'my-tickets', label: 'My Tickets', icon: QrCode },
    { view: 'notifications', label: 'Notifications', icon: Bell },
    { view: 'user-profile', label: 'Profile', icon: UserCircle },
    { view: 'change-password', label: 'Change Password', icon: Lock },
  ],
  ORGANIZER: [
    { view: 'public-discover', label: 'Discover Events', icon: CalendarDays },
    { view: 'organizer-dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { view: 'organizer-events', label: 'My Events', icon: CalendarPlus },
    { view: 'organizer-create-event', label: 'Create Event', icon: PlusCircle },
    { view: 'organizer-analytics', label: 'Analytics', icon: BarChart3 },
    { view: 'my-bookings', label: 'My Bookings', icon: Ticket },
    { view: 'my-tickets', label: 'My Tickets', icon: QrCode },
    { view: 'notifications', label: 'Notifications', icon: Bell },
    { view: 'organizer-ads', label: 'Advertisements', icon: Megaphone },
    { view: 'organizer-profile', label: 'Org Profile', icon: Building2 },
    { view: 'organizer-staff', label: 'Staff', icon: UserCog },
    { view: 'user-profile', label: 'Profile', icon: UserCircle },
    { view: 'change-password', label: 'Change Password', icon: Lock },
  ],
  STAFF: [
    { view: 'public-discover', label: 'Discover Events', icon: CalendarDays },
    { view: 'my-tickets', label: 'Check Tickets', icon: ScanLine },
    { view: 'notifications', label: 'Notifications', icon: Bell },
    { view: 'user-profile', label: 'Profile', icon: UserCircle },
    { view: 'change-password', label: 'Change Password', icon: Lock },
  ],
  SUPER_ADMIN: [
    { view: 'admin-dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { view: 'admin-users', label: 'Users', icon: Users },
    { view: 'admin-events', label: 'Events', icon: CalendarDays },
    { view: 'admin-plans', label: 'Plans', icon: CreditCard },
    { view: 'admin-ads', label: 'Advertisements', icon: Megaphone },
    { view: 'notifications', label: 'Notifications', icon: Bell },
    { view: 'user-profile', label: 'Profile', icon: UserCircle },
    { view: 'change-password', label: 'Change Password', icon: Lock },
  ],
};

function NavContent({ onClose }: { onClose?: () => void }) {
  const { user, currentView, navigate, clearAuth, setSidebarOpen } = useAppStore();
  const role = user?.role || 'PUBLIC';
  const items = NAV_ITEMS[role] || NAV_ITEMS.PUBLIC;

  const handleNav = (view: AppView) => {
    navigate(view);
    setSidebarOpen(false);
    onClose?.();
  };

  const handleLogout = () => {
    clearAuth();
    setSidebarOpen(false);
    onClose?.();
  };

  return (
    <div className="flex flex-col h-full">
      {/* User Info */}
      <div className="p-4 flex items-center gap-3">
        <Avatar className="h-10 w-10">
          <AvatarFallback className="bg-emerald-600 text-white text-sm font-semibold">
            {user?.name?.charAt(0).toUpperCase() || 'G'}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate text-white">{user?.name || 'Guest'}</p>
          <p className="text-xs text-zinc-400 truncate">{user?.email || 'Sign in to continue'}</p>
        </div>
      </div>

      <Separator className="bg-zinc-700" />

      {/* Nav Items */}
      <ScrollArea className="flex-1 py-2">
        <nav className="space-y-1 px-2">
          {items.map(item => {
            const isActive = currentView === item.view;
            return (
              <button
                key={item.view}
                onClick={() => handleNav(item.view)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left ${
                  isActive
                    ? 'bg-emerald-600 text-white'
                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                }`}
              >
                <item.icon className={`h-5 w-5 flex-shrink-0 ${isActive ? 'text-white' : 'text-zinc-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </ScrollArea>

      <Separator className="bg-zinc-700" />

      {/* Logout */}
      {user && (
        <div className="p-2">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <LogOut className="h-5 w-5 text-zinc-400" />
            <span>Logout</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function SidebarNav() {
  const { sidebarOpen, setSidebarOpen } = useAppStore();

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex fixed left-0 top-0 bottom-0 w-64 bg-zinc-900 flex-col z-30">
        <div className="p-4">
          <h2 className="text-lg font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            AppleCalendar
          </h2>
        </div>
        <div className="flex-1 flex flex-col overflow-hidden">
          <NavContent />
        </div>
      </aside>

      {/* Mobile Sheet */}
      <div className="md:hidden">
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-72 p-0 bg-zinc-900 border-zinc-700">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="p-4">
              <h2 className="text-lg font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
                AppleCalendar
              </h2>
            </div>
            <div className="flex-1 flex flex-col overflow-hidden h-[calc(100%-4rem)]">
              <NavContent onClose={() => setSidebarOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

export function MobileMenuButton() {
  const { setSidebarOpen } = useAppStore();
  return (
    <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSidebarOpen(true)}>
      <Menu className="h-5 w-5" />
    </Button>
  );
}
