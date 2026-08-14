'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { QrCode, Download, Ticket, CalendarDays } from 'lucide-react';
import { format } from 'date-fns';

interface TicketData {
  id: string;
  qrCode: string;
  status: string;
  checkedInAt: string | null;
  ticketType: { name: string };
  booking: {
    id: string;
    event: {
      id: string;
      title: string;
      startDate: string;
      venueName: string | null;
      isVirtual: boolean;
    };
  };
}

export function MyTickets() {
  const [tickets, setTickets] = useState<TicketData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ bookings: any[] }>('/api/bookings')
      .then(data => {
        const allTickets: TicketData[] = [];
        (data.bookings || []).forEach((b: any) => {
          if (b.status === 'CONFIRMED' && b.tickets) {
            b.tickets.forEach((t: any) => {
              allTickets.push({ ...t, booking: b });
            });
          }
        });
        setTickets(allTickets);
      })
      .catch(() => toast.error('Failed to load tickets'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">My Tickets</h1>
        <div className="grid sm:grid-cols-2 gap-6">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64" />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My Tickets</h1>

      {tickets.length === 0 ? (
        <Card className="p-12 text-center">
          <QrCode className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No tickets yet</h3>
          <p className="text-muted-foreground text-sm">Your confirmed tickets will appear here.</p>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-6">
          {tickets.map(t => (
            <Card key={t.id} className="overflow-hidden">
              <div className="bg-gradient-to-r from-emerald-600 to-teal-600 p-4 text-white">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Ticket className="h-5 w-5" />
                    <span className="font-semibold">AppleCalendar</span>
                  </div>
                  <Badge variant="secondary" className="bg-white/20 text-white border-0">{t.status}</Badge>
                </div>
              </div>
              <CardContent className="p-6 space-y-4">
                <div>
                  <h3 className="font-bold text-lg">{t.booking?.event?.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t.booking?.event?.startDate ? format(new Date(t.booking.event.startDate), 'EEE, MMM d, yyyy') : ''}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t.booking?.event?.isVirtual ? '🌐 Virtual Event' : t.booking?.event?.venueName || ''}
                  </p>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t.ticketType?.name || 'General'}</span>
                </div>
                {/* QR Code Styled Div */}
                <div className="border-2 border-dashed border-emerald-300 rounded-lg p-4 text-center bg-emerald-50/50">
                  <QrCode className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
                  <p className="font-mono text-xs text-emerald-700 break-all select-all">{t.qrCode}</p>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => toast.info('PDF download coming soon!')}
                >
                  <Download className="h-4 w-4 mr-2" /> Download Ticket
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
