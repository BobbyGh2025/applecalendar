'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/stores/app-store';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import {
  Bell,
  CalendarDays,
  CheckCheck,
  CreditCard,
  Info,
  Loader2,
  RefreshCw,
  Settings2,
  Ticket,
  Wallet,
} from 'lucide-react';

/**
 * Phase 6C Task 3: notification centre.
 *
 * - Unread indicators (header badge via shared store count + per-row dot)
 * - Mark individual notifications as read (row click or explicit button)
 * - Mark all as read
 * - Cursor pagination (load more) + read-state and type filtering
 * - Event and related-entity navigation (Event → detail, Booking/Payment/
 *   Refund → my bookings)
 * - Distinct empty / loading / error states, responsive on mobile + desktop
 *
 * All requests carry the session token via apiFetch — the API only ever
 * returns and mutates the authenticated user's own notifications.
 */

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  link: string | null;
  eventId: string | null;
  relatedEntityId: string | null;
  relatedEntityType: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
  hasMore: boolean;
  nextCursor: string | null;
}

const PAGE_SIZE = 20;

const typeIcons: Record<string, typeof Bell> = {
  BOOKING: Ticket,
  PAYMENT: CreditCard,
  REFUND: Wallet,
  EVENT_UPDATE: CalendarDays,
  SYSTEM: Info,
  INFO: Bell,
};

const typeColors: Record<string, string> = {
  BOOKING: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950',
  PAYMENT: 'text-amber-600 bg-amber-50 dark:bg-amber-950',
  REFUND: 'text-rose-600 bg-rose-50 dark:bg-rose-950',
  EVENT_UPDATE: 'text-teal-600 bg-teal-50 dark:bg-teal-950',
  SYSTEM: 'text-slate-600 bg-slate-100 dark:bg-slate-900',
  INFO: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950',
};

const TYPE_FILTERS = [
  { value: 'ALL', label: 'All types' },
  { value: 'BOOKING', label: 'Bookings' },
  { value: 'PAYMENT', label: 'Payments' },
  { value: 'REFUND', label: 'Refunds' },
  { value: 'EVENT_UPDATE', label: 'Event updates' },
  { value: 'SYSTEM', label: 'System' },
  { value: 'INFO', label: 'General' },
];

export function NotificationsView() {
  const navigate = useAppStore((s) => s.navigate);
  const user = useAppStore((s) => s.user);
  const unreadCount = useAppStore((s) => s.unreadCount);
  const setUnreadCount = useAppStore((s) => s.setUnreadCount);

  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [markingOne, setMarkingOne] = useState<string | null>(null);

  // Filters
  const [readFilter, setReadFilter] = useState<'all' | 'unread'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  // Keep the latest filter values accessible to the fetch callback
  const filterRef = useRef({ readFilter, typeFilter });
  filterRef.current = { readFilter, typeFilter };

  const buildUrl = useCallback(
    (opts: { cursor?: string | null }) => {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      if (filterRef.current.readFilter === 'unread') params.set('unreadOnly', 'true');
      if (filterRef.current.typeFilter !== 'ALL') {
        params.set('type', filterRef.current.typeFilter);
      }
      if (opts.cursor) params.set('cursor', opts.cursor);
      return `/api/notifications?${params.toString()}`;
    },
    []
  );

  const fetchNotifications = useCallback(
    async (opts?: { append?: boolean }) => {
      const append = opts?.append ?? false;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError(null);
      }
      try {
        const data = await apiFetch<NotificationsResponse>(
          buildUrl({ cursor: append ? cursor : null })
        );
        setItems((prev) =>
          append ? [...prev, ...(data.notifications ?? [])] : data.notifications ?? []
        );
        setHasMore(data.hasMore ?? false);
        setCursor(data.nextCursor ?? null);
        setUnreadCount(data.unreadCount ?? 0);
      } catch (err) {
        if (!append) {
          setError(
            err instanceof Error ? err.message : 'Failed to load notifications'
          );
        } else {
          toast.error('Could not load more notifications');
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [buildUrl, cursor, setUnreadCount]
  );

  // Refetch when filters change (reset list)
  useEffect(() => {
    void fetchNotifications();
  }, [readFilter, typeFilter]);

  const markAsRead = useCallback(
    async (id: string, opts?: { silent?: boolean }) => {
      const target = items.find((n) => n.id === id);
      if (!target || target.isRead) return false;
      setMarkingOne(id);
      try {
        await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
        setItems((prev) =>
          prev.map((n) =>
            n.id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n
          )
        );
        setUnreadCount(Math.max(0, useAppStore.getState().unreadCount - 1));
        return true;
      } catch {
        if (!opts?.silent) toast.error('Could not mark notification as read');
        return false;
      } finally {
        setMarkingOne(null);
      }
    },
    [items, setUnreadCount]
  );

  const markAllAsRead = useCallback(async () => {
    if (unreadCount === 0) {
      toast.info('No unread notifications');
      return;
    }
    setMarkingAll(true);
    try {
      const data = await apiFetch<{ markedRead: number }>('/api/notifications', {
        method: 'PATCH',
      });
      toast.success(
        `${data.markedRead} notification${data.markedRead === 1 ? '' : 's'} marked as read`
      );
      setUnreadCount(0);
      // Refetch: with the unread filter active the list may change entirely
      await fetchNotifications();
    } catch {
      toast.error('Could not mark all notifications as read');
    } finally {
      setMarkingAll(false);
    }
  }, [fetchNotifications, setUnreadCount, unreadCount]);

  const handleClick = useCallback(
    (n: Notification) => {
      void markAsRead(n.id, { silent: true });
      // Event navigation: direct eventId reference wins
      if (n.eventId) {
        navigate('event-detail', n.eventId);
        return;
      }
      // Related-entity navigation for non-event records
      if (
        n.relatedEntityType === 'Booking' ||
        n.relatedEntityType === 'Payment' ||
        n.relatedEntityType === 'Refund'
      ) {
        navigate('my-bookings');
        return;
      }
      // Fallback: parse deep links like /events/{id}
      if (n.link?.startsWith('/events/')) {
        const eventId = n.link.split('/')[2];
        if (eventId) navigate('event-detail', eventId);
      }
    },
    [markAsRead, navigate]
  );

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

  const unreadInView = items.filter((n) => !n.isRead).length;

  if (!user) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Notifications</h1>
        <Card className="p-8 text-center">
          <Bell className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Log in to see your notifications.
          </p>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <h1 className="text-2xl font-bold">Notifications</h1>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Notifications</h1>
        <Alert variant="destructive">
          <Bell className="h-4 w-4" />
          <AlertTitle>Could not load notifications</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => void fetchNotifications()}>
          <RefreshCw className="mr-2 h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Notifications</h1>
          {unreadCount > 0 && (
            <Badge className="bg-emerald-600 text-white">
              {unreadCount} unread
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchNotifications()}
            aria-label="Refresh notifications"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only sm:ml-2">Refresh</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('notification-settings')}
            aria-label="Notification settings"
          >
            <Settings2 className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only sm:ml-2">Settings</span>
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => void markAllAsRead()}
            disabled={markingAll || unreadCount === 0}
          >
            {markingAll ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCheck className="mr-2 h-4 w-4" />
            )}
            Mark all read
          </Button>
        </div>
      </div>

      {/* Filters: read state + type */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={readFilter}
          onValueChange={(v) => setReadFilter(v as 'all' | 'unread')}
        >
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unread">
              Unread
              {unreadInView > 0 && (
                <span className="ml-1.5 rounded-full bg-emerald-600 px-1.5 text-xs text-white">
                  {unreadInView}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v)}
        >
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by type">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            {TYPE_FILTERS.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {items.length === 0 ? (
        <Card className="p-12 text-center">
          <Bell className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-medium">
            {readFilter === 'unread' || typeFilter !== 'ALL'
              ? 'Nothing here'
              : 'No notifications'}
          </h3>
          <p className="text-sm text-muted-foreground">
            {readFilter === 'unread' || typeFilter !== 'ALL'
              ? 'No notifications match the current filter.'
              : "You're all caught up! Activity about your bookings, payments and events will appear here."}
          </p>
        </Card>
      ) : (
        <>
          <ul className="space-y-2" aria-label="Notification list">
            {items.map((n) => {
              const Icon = typeIcons[n.type] ?? Info;
              const colorClass = typeColors[n.type] ?? typeColors.INFO;
              const isMarking = markingOne === n.id;
              return (
                <Card
                  key={n.id}
                  className={`cursor-pointer transition-shadow hover:shadow-sm ${
                    !n.isRead ? 'border-l-4 border-l-emerald-500' : 'opacity-70'
                  }`}
                  onClick={() => handleClick(n)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${n.title}${n.isRead ? '' : ' (unread)'}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleClick(n);
                    }
                  }}
                >
                  <CardContent className="flex items-start gap-4 p-4">
                    <div className={`rounded-lg p-2 ${colorClass}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h4
                          className={`text-sm font-medium ${
                            !n.isRead ? '' : 'text-muted-foreground'
                          }`}
                        >
                          {n.title}
                        </h4>
                        <span className="flex-shrink-0 text-xs text-muted-foreground">
                          {formatTime(n.createdAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                        {n.message}
                      </p>
                    </div>
                    {!n.isRead && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-shrink-0"
                        disabled={isMarking}
                        aria-label={`Mark "${n.title}" as read`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void markAsRead(n.id);
                        }}
                      >
                        {isMarking ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCheck className="h-4 w-4" />
                        )}
                        <span className="sr-only sm:not-sr-only sm:ml-1.5">
                          Mark read
                        </span>
                      </Button>
                    )}
                    {!n.isRead && (
                      <div
                        className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-emerald-500"
                        aria-hidden="true"
                      />
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </ul>

          {hasMore && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => void fetchNotifications({ append: true })}
                disabled={loadingMore}
              >
                {loadingMore && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
