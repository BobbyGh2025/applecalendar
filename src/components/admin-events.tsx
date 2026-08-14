'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAppStore } from '@/stores/app-store';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { Eye, CheckCircle, XCircle, CalendarDays } from 'lucide-react';
import { format } from 'date-fns';

interface AdminEvent {
  id: string;
  title: string;
  status: string;
  startDate: string;
  category: { name: string } | null;
  organizer: { name: string } | null;
}

const STATUS_COLORS: Record<string, string> = {
  PUBLISHED: 'bg-green-100 text-green-700',
  DRAFT: 'bg-gray-100 text-gray-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  CANCELLED: 'bg-red-100 text-red-700',
  COMPLETED: 'bg-blue-100 text-blue-700',
};

export function AdminEvents() {
  const { navigate } = useAppStore();
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [targetEvent, setTargetEvent] = useState<AdminEvent | null>(null);
  const [actionType, setActionType] = useState<'approve' | 'reject'>('approve');
  const [submitting, setSubmitting] = useState(false);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: '1', limit: '50', status: 'all' });
      if (statusFilter) params.set('status', statusFilter);
      const data = await apiFetch<{ events: AdminEvent[] }>(`/api/events?${params.toString()}`);
      setEvents(data.events || []);
    } catch {
      toast.error('Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const handleModerate = async () => {
    if (!targetEvent) return;
    setSubmitting(true);
    try {
      const newStatus = actionType === 'approve' ? 'PUBLISHED' : 'CANCELLED';
      await apiFetch(`/api/admin/events/${targetEvent.id}/moderate`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
      toast.success(`Event ${actionType === 'approve' ? 'approved' : 'rejected'}`);
      setTargetEvent(null);
      fetchEvents();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Event Moderation</h1>

      <div className="flex flex-col sm:flex-row gap-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Statuses</SelectItem>
            <SelectItem value="PUBLISHED">Published</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : events.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <CalendarDays className="h-10 w-10 mx-auto mb-3" />
              <p>No events found</p>
            </div>
          ) : (
            <div className="max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Organizer</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map(ev => (
                    <TableRow key={ev.id}>
                      <TableCell className="font-medium max-w-[200px] truncate">{ev.title}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{ev.organizer?.name || '-'}</TableCell>
                      <TableCell><Badge variant="outline">{ev.category?.name || '-'}</Badge></TableCell>
                      <TableCell><Badge className={STATUS_COLORS[ev.status] || ''}>{ev.status}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{format(new Date(ev.startDate), 'MMM d, yyyy')}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="outline" size="sm" onClick={() => navigate('event-detail', ev.id)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          {ev.status === 'PENDING' && (
                            <>
                              <Button variant="outline" size="sm" className="text-green-600 hover:text-green-700" onClick={() => { setTargetEvent(ev); setActionType('approve'); }}>
                                <CheckCircle className="h-4 w-4" />
                              </Button>
                              <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => { setTargetEvent(ev); setActionType('reject'); }}>
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={targetEvent !== null} onOpenChange={o => { if (!o) setTargetEvent(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{actionType === 'approve' ? 'Approve Event' : 'Reject Event'}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to {actionType === 'approve' ? 'approve' : 'reject'} &quot;{targetEvent?.title}&quot;?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleModerate} disabled={submitting}>
              {actionType === 'approve' ? 'Approve' : 'Reject'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}