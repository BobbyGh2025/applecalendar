'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useAppStore } from '@/stores/app-store';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { Ticket, CalendarDays, ArrowRight, XCircle, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

interface Booking {
  id: string;
  bookingRef: string;
  status: string;
  totalAmount: number;
  currency: string;
  createdAt: string;
  event: {
    id: string;
    title: string;
    startDate: string;
    coverImage: string | null;
    venueName: string | null;
  };
  tickets: { id: string; status: string }[];
}

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: 'bg-green-100 text-green-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  CANCELLED: 'bg-red-100 text-red-700',
  REFUNDED: 'bg-gray-100 text-gray-700',
};

export function MyBookings() {
  const { navigate } = useAppStore();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelDialog, setCancelDialog] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const fetchBookings = async () => {
    try {
      const d = await apiFetch<{ bookings: Booking[] }>('/api/bookings');
      setBookings(d.bookings || []);
    } catch {
      toast.error('Failed to load bookings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, []);

  const handleCancel = async () => {
    if (!cancelDialog) return;
    setCancelling(true);
    try {
      await apiFetch(`/api/bookings/${cancelDialog}/cancel`, { method: 'PATCH' });
      toast.success('Booking cancelled successfully');
      setCancelDialog(null);
      await fetchBookings();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to cancel booking';
      toast.error(message);
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">My Bookings</h1>
        <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My Bookings</h1>

      {bookings.length === 0 ? (
        <Card className="p-12 text-center">
          <Ticket className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No bookings yet</h3>
          <p className="text-muted-foreground text-sm mb-4">Explore events and book your first ticket!</p>
          <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => navigate('public-discover')}>Discover Events</Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {bookings.map(b => {
            const ticketCount = b.tickets?.length || 0;
            const canCancel = b.status === 'CONFIRMED';
            return (
              <Card key={b.id} className="overflow-hidden hover:shadow-md transition-shadow">
                <CardContent className="p-4 flex flex-col sm:flex-row gap-4">
                  <div className="w-full sm:w-24 h-24 rounded-lg overflow-hidden flex-shrink-0 bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center">
                    {b.event?.coverImage ? (
                      <img src={b.event.coverImage} alt={b.event.title} className="w-full h-full object-cover" />
                    ) : (
                      <CalendarDays className="h-8 w-8 text-emerald-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold truncate">{b.event?.title}</h3>
                      <Badge className={STATUS_COLORS[b.status] || ''}>{b.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {b.event?.startDate ? format(new Date(b.event.startDate), 'MMM d, yyyy') : ''} · {ticketCount} ticket{ticketCount !== 1 ? 's' : ''}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="font-bold text-emerald-600">
                        {b.currency || 'USD'} ${(b.totalAmount || 0).toFixed(2)}
                      </span>
                      <div className="flex gap-2">
                        {canCancel && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-700"
                            onClick={() => setCancelDialog(b.id)}
                          >
                            <XCircle className="h-4 w-4 mr-1" /> Cancel
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="text-emerald-600" onClick={() => navigate('event-detail', b.event?.id)}>
                          View Event <ArrowRight className="h-4 w-4 ml-1" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Cancel Booking Confirmation Dialog */}
      <Dialog open={!!cancelDialog} onOpenChange={(open) => !open && setCancelDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Booking</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel this booking? This action will release your tickets and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialog(null)}>
              Keep Booking
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cancel Booking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
