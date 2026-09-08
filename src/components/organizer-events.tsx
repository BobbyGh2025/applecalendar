'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppStore } from '@/stores/app-store';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { Plus, Eye, BarChart3, CalendarDays, Pencil } from 'lucide-react';
import { format } from 'date-fns';

interface OrgEvent {
  id: string;
  title: string;
  status: string;
  startDate: string;
  ticketTypes: { quantity: number; soldCount: number }[];
  _count: { bookings: number; reviews: number };
}

const STATUS_COLORS: Record<string, string> = {
  PUBLISHED: 'bg-green-100 text-green-700',
  DRAFT: 'bg-gray-100 text-gray-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  CANCELLED: 'bg-red-100 text-red-700',
  COMPLETED: 'bg-blue-100 text-blue-700',
};

export function OrganizerEvents() {
  const { navigate } = useAppStore();
  const [events, setEvents] = useState<OrgEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ events: OrgEvent[] }>('/api/organizer/events');
      setEvents(data.events || []);
    } catch {
      toast.error('Failed to load events');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const getTotalSold = (ev: OrgEvent) => ev.ticketTypes.reduce((s, t) => s + (t.soldCount || 0), 0);
  const getTotalCapacity = (ev: OrgEvent) => ev.ticketTypes.reduce((s, t) => s + t.quantity, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Events</h1>
        <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => navigate('organizer-create-event')}>
          <Plus className="h-4 w-4 mr-2" /> Create Event
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      ) : events.length === 0 ? (
        <Card className="p-12 text-center">
          <CalendarDays className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No events yet</h3>
          <p className="text-muted-foreground text-sm mb-4">Create your first event to get started.</p>
          <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => navigate('organizer-create-event')}>
            <Plus className="h-4 w-4 mr-2" /> Create Event
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {events.map(ev => {
            const sold = getTotalSold(ev);
            const cap = getTotalCapacity(ev);
            return (
              <Card key={ev.id} className="overflow-hidden hover:shadow-md transition-shadow">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold line-clamp-2 flex-1">{ev.title}</h3>
                    <Badge className={STATUS_COLORS[ev.status] || ''}>{ev.status}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{format(new Date(ev.startDate), 'MMM d, yyyy')}</p>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Tickets: {sold}/{cap}</span>
                    <span className="font-medium text-emerald-600">{ev._count?.bookings || 0} bookings</span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => navigate('event-detail', ev.id)}>
                      <Eye className="h-4 w-4 mr-1" /> View
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => navigate('organizer-edit-event', ev.id)}>
                      <Pencil className="h-4 w-4 mr-1" /> Edit
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => navigate('organizer-analytics', ev.id)}>
                      <BarChart3 className="h-4 w-4 mr-1" /> Analytics
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
