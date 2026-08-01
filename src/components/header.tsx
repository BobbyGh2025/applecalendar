'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MobileMenuButton } from '@/components/sidebar-nav';
import { useAppStore } from '@/stores/app-store';
import { Search, Bell, User, LogOut, CalendarDays } from 'lucide-react';

export function Header() {
  const { user, currentView, navigate, setSearchQuery, searchQuery, clearAuth } = useAppStore();

  const showSearch = currentView === 'public-discover';

  return (
    <header className="fixed top-0 left-0 right-0 h-14 bg-background/80 backdrop-blur-sm border-b z-40 flex items-center px-4 md:px-6 gap-4">
      {/* Left: Hamburger + Logo */}
      <div className="flex items-center gap-3">
        <MobileMenuButton />
        <button
          onClick={() => navigate('public-discover')}
          className="flex items-center gap-1.5 font-bold text-lg bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent hover:opacity-80 transition-opacity"
        >
          <CalendarDays className="h-5 w-5 text-emerald-500" />
          <span className="hidden sm:inline">ApoCalendar</span>
        </button>
      </div>

      {/* Center: Search (only on discover) */}
      {showSearch && (
        <div className="hidden md:flex flex-1 max-w-md mx-auto relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      )}

      {/* Right: Actions */}
      <div className="flex items-center gap-2 ml-auto">
        {user ? (
          <>
            {/* Notification Bell */}
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              onClick={() => navigate('notifications')}
            >
              <Bell className="h-5 w-5" />
            </Button>

            {/* User Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-9 w-9 rounded-full">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-emerald-600 text-white text-sm font-semibold">
                      {user.name?.charAt(0).toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">{user.name}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('my-bookings')}>
                  <User className="h-4 w-4 mr-2" /> My Bookings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('notifications')}>
                  <Bell className="h-4 w-4 mr-2" /> Notifications
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={clearAuth} className="text-red-600">
                  <LogOut className="h-4 w-4 mr-2" /> Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('login')}>Login</Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => navigate('register')}>Register</Button>
          </div>
        )}
      </div>
    </header>
  );
}
