'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/app-store';
import { apiFetch } from '@/lib/api';
import { Calendar, Ticket, DollarSign, TrendingUp, ArrowRight, AlertTriangle, Clock, XCircle, PauseCircle, PowerOff } from 'lucide-react';
import { format } from 'date-fns';

interface DashboardData {
  myEvents: number;
  totalBookings: number;
  totalRevenue: number;
  upcomingEvents: any[];
  recentBookings: any[];
}

interface OrganizerProfile {
  id: string;
  organizationName: string;
  status: string;
  statusReason?: string | null;
}

function StatusBanner({ status, reason }: { status: string; reason?: string | null }) {
  if (status === 'ACTIVE') return null;

  const config: Record<string, { icon: typeof AlertTriangle; bg: string; border: string; text: string; message: string }> = {
    PENDING_APPROVAL: {
      icon: Clock,
      bg: 'bg-yellow-50',
      border: 'border-yellow-200',
      text: 'text-yellow-800',
      message: "Your organizer account is awaiting approval. You'll be notified once an admin reviews your application.",
    },
    REJECTED: {
      icon: XCircle,
      bg: 'bg-red-50',
      border: 'border-red-200',
      text: 'text-red-800',
      message: 'Your organizer account application has been rejected.',
    },
    SUSPENDED: {
      icon: PauseCircle,
      bg: 'bg-orange-50',
      border: 'border-orange-200',
      text: 'text-orange-800',
      message: 'Your organizer account has been suspended.',
    },
    DEACTIVATED: {
      icon: PowerOff,
      bg: 'bg-gray-50',
      border: 'border-gray-200',
      text: 'text-gray-700',
      message: 'Your organizer account has been deactivated.',
    },
  };

  const c = config[status];
  if (!c) return null;

  const Icon = c.icon;

  return (
    <Card className={`${c.bg} ${c.border} border`}>
      <CardContent className="p-4 flex items-start gap-3">
        <Icon className={`h-5 w-5 ${c.text} mt-0.5 flex-shrink-0`} />
        <div>
          <p className={`font-medium text-sm ${c.text}`}>{c.message}</p>
          {reason && (
            <p className={`text-sm mt-1 ${c.text} opacity-80`}>
              Reason: {reason}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function OrganizerDashboard() {
  const { user, navigate } = useAppStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [orgProfile, setOrgProfile] = useState<OrganizerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<DashboardData>('/api/organizer?type=dashboard').catch(() => null),
      apiFetch<OrganizerProfile>('/api/organizer/profile').catch(() => null),
    ])
      .then(([dashData, profile]) => {
        setData(dashData);
        setOrgProfile(profile);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!data) return <p className="text-muted-foreground">Failed to load dashboard.</p>;

  const statCards = [
    { label: 'My Events', value: data.myEvents, icon: Calendar, color: 'bg-emerald-50 text-emerald-600' },
    { label: 'Total Bookings', value: data.totalBookings, icon: Ticket, color: 'bg-teal-50 text-teal-600' },
    { label: 'Total Revenue', value: `$${(data.totalRevenue || 0).toLocaleString()}`, icon: DollarSign, color: 'bg-amber-50 text-amber-600' },
    { label: 'Upcoming Events', value: data.upcomingEvents?.length || 0, icon: TrendingUp, color: 'bg-rose-50 text-rose-600' },
  ];

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      {orgProfile && orgProfile.status !== 'ACTIVE' && (
        <StatusBanner status={orgProfile.status} reason={orgProfile.statusReason} />
      )}

      {/* Welcome Banner */}
      <Card className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-0">
        <CardContent className="p-6">
          <h1 className="text-2xl font-bold">Welcome back, {user?.name || 'Organizer'}! 👋</h1>
          <p className="text-emerald-100 mt-1">Here&apos;s what&apos;s happening with your events.</p>
        </CardContent>
      </Card>

      {/* Stats */}
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

      {/* Upcoming Events */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Upcoming Events</CardTitle>
          <Button variant="outline" size="sm" onClick={() => navigate('organizer-events')} className="gap-1">View All <ArrowRight className="h-4 w-4" /></Button>
        </CardHeader>
        <CardContent>
          {(data.upcomingEvents || []).length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No upcoming events</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(data.upcomingEvents || []).map((ev: any) => (
                <Card key={ev.id} className="overflow-hidden">
                  <div className="h-24 bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center">
                    <Calendar className="h-8 w-8 text-emerald-300" />
                  </div>
                  <CardContent className="p-3">
                    <h4 className="font-medium text-sm line-clamp-1">{ev.title}</h4>
                    <p className="text-xs text-muted-foreground mt-1">{format(new Date(ev.startDate), 'MMM d, yyyy')}</p>
                    <Badge variant="outline" className="mt-2 text-xs">{ev.status}</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Bookings */}
      <Card>
        <CardHeader><CardTitle>Recent Bookings</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Event</TableHead><TableHead>Booked By</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {(data.recentBookings || []).map((b: any) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium text-sm max-w-[150px] truncate">{b.event?.title}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{b.user?.name}</TableCell>
                    <TableCell className="text-sm">${(b.totalAmount || 0).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge className={
                        b.status === 'CONFIRMED' ? 'bg-green-100 text-green-700' :
                        b.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
                        b.status === 'CANCELLED' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
                      }>{b.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{format(new Date(b.createdAt), 'MMM d, yyyy')}</TableCell>
                  </TableRow>
                ))}
                {(!data.recentBookings || data.recentBookings.length === 0) && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No bookings yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
