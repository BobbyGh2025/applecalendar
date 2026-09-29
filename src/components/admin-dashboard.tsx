'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/app-store';
import { apiFetch } from '@/lib/api';
import { Users, Calendar, Ticket, DollarSign } from 'lucide-react';
import { formatMoneyWithSymbol, DEFAULT_CURRENCY } from '@/lib/money';
import { format } from 'date-fns';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar } from 'recharts';

interface Stats {
  totalUsers: number;
  totalEvents: number;
  totalBookings: number;
  totalRevenue: number;
  recentUsers: any[];
  recentEvents: any[];
  eventsByStatus: { status: string; count: number }[];
  revenueByMonth: { month: string; revenue: number }[];
}

export function AdminDashboard() {
  const { navigate } = useAppStore();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Stats>('/api/admin?type=stats')
      .then(data => setStats(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="space-y-6"><div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-80" /><Skeleton className="h-80" /></div>;
  }

  if (!stats) return <p className="text-muted-foreground">Failed to load dashboard data.</p>;

  const statCards = [
    { label: 'Total Users', value: stats.totalUsers, icon: Users, color: 'bg-emerald-50 text-emerald-600' },
    { label: 'Total Events', value: stats.totalEvents, icon: Calendar, color: 'bg-teal-50 text-teal-600' },
    { label: 'Total Bookings', value: stats.totalBookings, icon: Ticket, color: 'bg-amber-50 text-amber-600' },
    { label: 'Total Revenue', value: formatMoneyWithSymbol(stats.totalRevenue || 0, DEFAULT_CURRENCY), icon: DollarSign, color: 'bg-rose-50 text-rose-600' },
  ];

  const statusColors: Record<string, string> = {
    PUBLISHED: 'bg-green-100 text-green-700',
    DRAFT: 'bg-gray-100 text-gray-700',
    PENDING: 'bg-yellow-100 text-yellow-700',
    CANCELLED: 'bg-red-100 text-red-700',
    COMPLETED: 'bg-blue-100 text-blue-700',
  };

  const revenueChartConfig = { revenue: { label: 'Revenue', color: '#059669' } };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin Dashboard</h1>

      {/* Stats Cards */}
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

      {/* Charts Row */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Revenue Chart */}
        <Card>
          <CardHeader><CardTitle>Revenue (Last 6 Months)</CardTitle></CardHeader>
          <CardContent>
            <ChartContainer config={revenueChartConfig} className="h-[280px] w-full">
              <LineChart data={stats.revenueByMonth || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" fontSize={12} />
                <YAxis fontSize={12} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="revenue" stroke="var(--color-revenue)" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Events by Status */}
        <Card>
          <CardHeader><CardTitle>Events by Status</CardTitle></CardHeader>
          <CardContent>
            <ChartContainer config={{ count: { label: 'Events', color: '#0d9488' } }} className="h-[280px] w-full">
              <BarChart data={stats.eventsByStatus || []} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" fontSize={12} />
                <YAxis dataKey="status" type="category" fontSize={12} width={100} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Tables Row */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Users */}
        <Card>
          <CardHeader><CardTitle>Recent Users</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(stats.recentUsers || []).map((u: any) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{u.role}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{format(new Date(u.createdAt), 'MMM d, yyyy')}</TableCell>
                    </TableRow>
                  ))}
                  {(!stats.recentUsers || stats.recentUsers.length === 0) && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No users yet</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Recent Events */}
        <Card>
          <CardHeader><CardTitle>Recent Events</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Organizer</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(stats.recentEvents || []).map((e: any) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium max-w-[120px] truncate">{e.title}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{e.organizer?.name}</TableCell>
                      <TableCell><Badge className={`text-xs ${statusColors[e.status] || ''}`}>{e.status}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{format(new Date(e.startDate), 'MMM d')}</TableCell>
                    </TableRow>
                  ))}
                  {(!stats.recentEvents || stats.recentEvents.length === 0) && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No events yet</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
