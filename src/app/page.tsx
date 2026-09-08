'use client';

import { useAppStore } from '@/stores/app-store';
import { Header } from '@/components/header';
import { SidebarNav } from '@/components/sidebar-nav';
import { AuthView } from '@/components/auth-view';
import { PublicDiscover } from '@/components/public-discover';
import { EventDetail } from '@/components/event-detail';
import { AdminDashboard } from '@/components/admin-dashboard';
import { AdminUsers } from '@/components/admin-users';
import { AdminEvents } from '@/components/admin-events';
import { AdminPlans } from '@/components/admin-plans';
import { AdminAds } from '@/components/admin-ads';
import { OrganizerDashboard } from '@/components/organizer-dashboard';
import { OrganizerEvents } from '@/components/organizer-events';
import { OrganizerCreateEvent } from '@/components/organizer-create-event';
import { OrganizerEditEvent } from '@/components/organizer-edit-event';
import { OrganizerAnalytics } from '@/components/organizer-analytics';
import { OrganizerAds } from '@/components/organizer-ads';
import { MyBookings } from '@/components/my-bookings';
import { MyTickets } from '@/components/my-tickets';
import { NotificationsView } from '@/components/notifications-view';
import { AnimatePresence, motion } from 'framer-motion';

function renderCurrentView() {
  const { currentView } = useAppStore.getState();
  switch (currentView) {
    case 'public-discover':
      return <PublicDiscover />;
    case 'event-detail':
      return <EventDetail />;
    case 'login':
    case 'register':
      return <AuthView defaultTab={currentView === 'register' ? 'register' : 'login'} />;
    case 'admin-dashboard':
      return <AdminDashboard />;
    case 'admin-users':
      return <AdminUsers />;
    case 'admin-events':
      return <AdminEvents />;
    case 'admin-plans':
      return <AdminPlans />;
    case 'admin-ads':
      return <AdminAds />;
    case 'organizer-dashboard':
      return <OrganizerDashboard />;
    case 'organizer-events':
      return <OrganizerEvents />;
    case 'organizer-create-event':
      return <OrganizerCreateEvent />;
    case 'organizer-edit-event':
      return <OrganizerEditEvent />;
    case 'organizer-analytics':
      return <OrganizerAnalytics />;
    case 'organizer-ads':
      return <OrganizerAds />;
    case 'my-bookings':
      return <MyBookings />;
    case 'my-tickets':
      return <MyTickets />;
    case 'notifications':
      return <NotificationsView />;
    default:
      return <PublicDiscover />;
  }
}

export default function HomePage() {
  const { currentView } = useAppStore();

  return (
    <div className='min-h-screen flex flex-col bg-background'>
      <Header />
      <div className='flex flex-1'>
        <SidebarNav />
        <main className='flex-1 md:ml-64 p-4 md:p-6 pt-16 md:pt-6'>
          <AnimatePresence mode='wait'>
            <motion.div
              key={currentView}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
            >
              {renderCurrentView()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <footer className='mt-auto border-t py-4 px-6 text-center text-sm text-muted-foreground bg-background'>
        © 2025 AppleCalendar. All rights reserved.
      </footer>
    </div>
  );
}