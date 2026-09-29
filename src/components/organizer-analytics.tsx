'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/app-store';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { Eye, MousePointerClick, Ticket, DollarSign, BarChart3 } from 'lucide-react';
import { formatMoneyWithSymbol, DEFAULT_CURRENCY } from '@/lib/money';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';

interface OrgEvent {
  id: string;
  title: string;
}

interface Analytics {
  daily: { date: string; views: number; clicks: number; bookings: number; revenue: number }[];
  totals: { totalViews: number; totalClicks: number; totalBookings: number; totalRevenue: number };
  ticketSummary: any[];
}

export function OrganizerAnalytics() {
  const { selectedEventId } = useAppStore();
  const [events, setEvents] = useState<OrgEvent[]>([]);
  const [selectedId, setSelectedId] = useState(selectedEventId || '');
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ events: OrgEvent[] }>('/api/organizer/events')
      .then(d => { setEvents(d.events || []); if (d.events?.[0] && !selectedEventId) setSelectedId(d.events[0].id); })
      .catch(() => {})
      .finally(() => setEventsLoading(false));
  }, []);

  const fetchAnalytics = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    try {
      const data = await apiFetch<Analytics>(`/api/organizer/events/${selectedId}/analytics`);
      setAnalytics(data);
    } catch {
      toast.error('Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  const statCards = analytics ? [
    { label: 'Total Views', value: analytics.totals.totalViews, icon: Eye, color: 'bg-emerald-50 text-emerald-600' },
    { label: 'Total Clicks', value: analytics.totals.totalClicks, icon: MousePointerClick, color: 'bg-teal-50 text-teal-600' },
    { label: 'Total Bookings', value: analytics.totals.totalBookings, icon: Ticket, color: 'bg-amber-50 text-amber-600' },
    { label: 'Total Revenue', value: formatMoneyWithSymbol(analytics.totals.totalRevenue || 0, DEFAULT_CURRENCY), icon: DollarSign, color: 'bg-rose-50 text-rose-600' },
  ] : [];

  if (eventsLoading) {
    return <div className="space-y-6"><Skeleton className="h-10 w-60" /><div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-full sm:w-64"><SelectValue placeholder="Select event" /></SelectTrigger>
          <SelectContent>
            {events.map(ev => <SelectItem key={ev.id} value={ev.id}>{ev.title}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {!selectedId ? (
        <Card className="p-12 text-center">
          <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">Select an event</h3>
          <p className="text-muted-foreground text-sm">Choose an event to view its analytics.</p>
        </Card>
      ) : loading ? (
        <div className="space-y-6"><div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
      ) : analytics ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {statCards.map(sc => (
              <Card key={sc.label}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={`p-3 rounded-xl ${sc.color}`}><sc.icon className="h-6 w-6" /></div>
                  <div>
                    <p className="text-sm text-muted-foreground">{sc.label}</p>
                    <p className="text-2xl font-bold">{sc.value}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle>Views (30 days)</CardTitle></CardHeader>
              <CardContent>
                <ChartContainer config={{ views: { label: 'Views', color: '#059669' } }} className="h-[280px] w-full">
                  <LineChart data={analytics.daily}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" fontSize={10} tickFormatter={v => v.split('-').slice(1).join('/')} />
                    <YAxis fontSize={12} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line type="monotone" dataKey="views" stroke="var(--color-views)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Bookings (30 days)</CardTitle></CardHeader>
              <CardContent>
                <ChartContainer config={{ bookings: { label: 'Bookings', color: '#0d9488' } }} className="h-[280px] w-full">
                  <BarChart data={analytics.daily}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" fontSize={10} tickFormatter={v => v.split('-').slice(1).join('/')} />
                    <YAxis fontSize={12} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="bookings" fill="var(--color-bookings)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>Revenue (30 days)</CardTitle></CardHeader>
              <CardContent>
                <ChartContainer config={{ revenue: { label: 'Revenue', color: '#059669' } }} className="h-[280px] w-full">
                  <AreaChart data={analytics.daily}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" fontSize={10} tickFormatter={v => v.split('-').slice(1).join('/')} />
                    <YAxis fontSize={12} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area type="monotone" dataKey="revenue" stroke="var(--color-revenue)" fill="var(--color-revenue)" fillOpacity={0.2} strokeWidth={2} />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
