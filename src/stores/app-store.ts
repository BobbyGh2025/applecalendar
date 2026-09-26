import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type UserRole = 'SUPER_ADMIN' | 'ORGANIZER' | 'STAFF' | 'PUBLIC';

export type AppView =
  | 'public-discover'
  | 'event-detail'
  | 'login'
  | 'register'
  | 'my-bookings'
  | 'my-tickets'
  | 'admin-dashboard'
  | 'admin-users'
  | 'admin-events'
  | 'admin-plans'
  | 'admin-ads'
  | 'admin-organizers'
  | 'organizer-dashboard'
  | 'organizer-events'
  | 'organizer-create-event'
  | 'organizer-edit-event'
  | 'organizer-analytics'
  | 'organizer-ads'
  | 'organizer-profile'
  | 'organizer-staff'
  | 'organizer-event-content'
  | 'notifications'
  | 'user-profile'
  | 'change-password'
  | 'forgot-password'
  | 'reset-password';

interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatar?: string | null;
  bio?: string | null;
  phone?: string | null;
}

interface AppState {
  // Auth
  user: User | null;
  token: string | null;
  setAuth: (user: User, token: string) => void;
  clearAuth: () => void;

  // Navigation
  currentView: AppView;
  selectedEventId: string | null;
  navigate: (view: AppView, eventId?: string) => void;
  goBack: () => void;
  navigationHistory: AppView[];

  // UI
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedCategory: string | null;
  setSelectedCategory: (category: string | null) => void;
  selectedDateFilter: string;
  setSelectedDateFilter: (filter: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Auth
      user: null,
      token: null,
      setAuth: (user, token) => set({ user, token }),
      clearAuth: () => set({ user: null, token: null, currentView: 'public-discover' }),

      // Navigation
      currentView: 'public-discover',
      selectedEventId: null,
      navigationHistory: [],
      navigate: (view, eventId) => {
        const prev = get().currentView;
        set({
          currentView: view,
          selectedEventId: eventId ?? get().selectedEventId,
          navigationHistory: [...get().navigationHistory.slice(-19), prev],
        });
      },
      goBack: () => {
        const history = get().navigationHistory;
        if (history.length > 0) {
          const prev = history[history.length - 1];
          set({ currentView: prev, navigationHistory: history.slice(0, -1) });
        }
      },

      // UI
      sidebarOpen: false,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      searchQuery: '',
      setSearchQuery: (query) => set({ searchQuery: query }),
      selectedCategory: null,
      setSelectedCategory: (category) => set({ selectedCategory: category }),
      selectedDateFilter: 'all',
      setSelectedDateFilter: (filter) => set({ selectedDateFilter: filter }),
    }),
    {
      name: 'applecalendar-store',
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
);
