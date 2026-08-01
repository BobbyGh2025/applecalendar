'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppStore } from '@/stores/app-store';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { Bell, CalendarDays, Ticket, AlertCircle, CheckCircle, Info } from 'lucide-react';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  eventId: string | null;
  createdAt: string;
}

const typeIcons: Record<string, any> = {
  BOOKING_CONFIRMED: CheckCircle,
  BOOKING_CANCELLED: AlertCircle,
  EVENT_UPDATED: CalendarDays,
  TICKET_USED: Ticket,
  INFO: Info,
};

const typeColors: Record<string, string> = {
  BOOKING_CONFIRMED: 'text-green-500 bg-green-50',
  BOOKING_CANCELLED: 'text-red-500 bg-red-50',
  EVENT_UPDATED: 'text-amber-500 bg-amber-50',
  TICKET_USED: 'text-blue-500 bg-blue-50',
  INFO: 'text-emerald-500 bg-emerald-50',
};

export function NotificationsView() {
  const { navigate } = useAppStore();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ notifications: Notification[] }>('/api/notifications');
      setNotifications(data.notifications || []);
    } catch {
      toast.error('Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  const markAsRead = async (id: string) => {
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    } catch {
      // silent
    }
  };

  const handleClick = (n: Notification) => {
    if (!n.isRead) markAsRead(n.id);
    if (n.eventId) navigate('event-detail', n.eventId);
  };

  const formatTime = (date: string) => {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(date).toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Notifications</h1>
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Notifications</h1>

      {notifications.length === 0 ? (
        <Card className="p-12 text-center">
          <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No notifications</h3>
          <p className="text-muted-foreground text-sm">You're all caught up!</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map(n => {
            const Icon = typeIcons[n.type] || Info;
            const colorClass = typeColors[n.type] || typeColors.INFO;
            return (
              <Card
                key={n.id}
                className={`cursor-pointer hover:shadow-sm transition-shadow ${!n.isRead ? 'border-l-4 border-l-emerald-500' : 'opacity-70'}`}
                onClick={() => handleClick(n)}
              >
                <CardContent className="p-4 flex items-start gap-4">
                  <div className={`p-2 rounded-lg ${colorClass}`}><Icon className="h-5 w-5" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className={`font-medium text-sm ${!n.isRead ? '' : 'text-muted-foreground'}`}>{n.title}</h4>
                      <span className="text-xs text-muted-foreground flex-shrink-0">{formatTime(n.createdAt)}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                  </div>
                  {!n.isRead && <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0 mt-2" />}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
