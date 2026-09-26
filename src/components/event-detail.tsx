'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/stores/app-store';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { ArrowLeft, MapPin, CalendarDays, Clock, Globe, Star, Users, Ticket, Minus, Plus, Loader2, Tag, User, MessageSquarePlus, Image as ImageIcon, Video, FileText, Play, Mic, Music } from 'lucide-react';

interface Review {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
  user: { id: string; name: string; avatar?: string | null };
}

interface TicketType {
  id: string;
  name: string;
  price: number;
  quantity: number;
  soldCount: number;
}

interface EventSession {
  id: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  date: string | null;
  sessionType: string;
  status: string;
  venueName: string | null;
  participant: { id: string; name: string; role: string; image: string | null } | null;
}

interface EventParticipant {
  id: string;
  name: string;
  bio: string | null;
  image: string | null;
  role: string;
  title: string | null;
  organization: string | null;
  isFeatured: boolean;
}

interface EventMediaItem {
  id: string;
  url: string;
  type: string;
  category: string;
  caption: string | null;
}

interface Event {
  id: string;
  title: string;
  description: string;
  shortDescription: string | null;
  coverImage: string | null;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  venueName: string | null;
  venueAddress: string | null;
  venueCity: string | null;
  venueState: string | null;
  venueCountry: string | null;
  isVirtual: boolean;
  virtualUrl: string | null;
  isPaid: boolean;
  capacity: number;
  currency: string;
  category: { id: string; name: string; slug: string };
  tags: { id: string; name: string }[];
  ticketTypes: TicketType[];
  reviews: Review[];
  organizer: { id: string; name: string; avatar?: string | null; bio?: string | null };
  _count: { reviews: number; bookings: number };
  sessions?: EventSession[];
  participants?: EventParticipant[];
  media?: EventMediaItem[];
}

export function EventDetail() {
  const { selectedEventId, goBack, navigate, user } = useAppStore();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [bookDialog, setBookDialog] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<TicketType | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [booking, setBooking] = useState(false);
  const [relatedEvents, setRelatedEvents] = useState<any[]>([]);
  const [reviewDialog, setReviewDialog] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [userHasReviewed, setUserHasReviewed] = useState(false);
  const [sessions, setSessions] = useState<EventSession[]>([]);
  const [participants, setParticipants] = useState<EventParticipant[]>([]);
  const [media, setMedia] = useState<EventMediaItem[]>([]);

  useEffect(() => {
    if (!selectedEventId) return;
    setLoading(true);
    apiFetch<{ event: Event }>(`/api/events/${selectedEventId}`)
      .then(data => {
        setEvent(data.event);
        // Check if current user has already reviewed
        if (user && data.event.reviews) {
          setUserHasReviewed(data.event.reviews.some((r: Review) => r.user?.id === user.id));
        }
      })
      .catch(() => toast.error('Failed to load event'))
      .finally(() => setLoading(false));
    // Load sessions, participants, and media for public view
    apiFetch<{ sessions: EventSession[] }>(`/api/events/${selectedEventId}/sessions`)
      .then(data => setSessions(data.sessions))
      .catch(() => {});
    apiFetch<{ participants: EventParticipant[] }>(`/api/events/${selectedEventId}/participants`)
      .then(data => setParticipants(data.participants))
      .catch(() => {});
    apiFetch<{ media: EventMediaItem[] }>(`/api/events/${selectedEventId}/media`)
      .then(data => setMedia(data.media))
      .catch(() => {});
  }, [selectedEventId, user?.id]);

  useEffect(() => {
    if (!event?.category?.slug) return;
    apiFetch<{ events: any[] }>(`/api/events?category=${event.category.slug}&limit=3&featured=false`)
      .then(data => setRelatedEvents(data.events.filter((e: any) => e.id !== event.id).slice(0, 3)))
      .catch(() => {});
  }, [event?.category?.slug]);

  const handleBook = (ticket: TicketType) => {
    if (!user) {
      navigate('login');
      toast.error('Please login to book tickets');
      return;
    }
    setSelectedTicket(ticket);
    setQuantity(1);
    setBookDialog(true);
  };

  const confirmBooking = async () => {
    if (!selectedTicket || !selectedEventId) return;
    setBooking(true);
    try {
      await apiFetch('/api/events/' + selectedEventId + '/book', {
        method: 'POST',
        body: JSON.stringify({ ticketTypeId: selectedTicket.id, quantity }),
      });
      toast.success('Booking confirmed!');
      setBookDialog(false);
      // Refresh event data
      const data = await apiFetch<{ event: Event }>(`/api/events/${selectedEventId}`);
      setEvent(data.event);
    } catch (err: any) {
      toast.error(err.message || 'Booking failed');
    } finally {
      setBooking(false);
    }
  };

  const avgRating = event?.reviews?.length
    ? event.reviews.reduce((s, r) => s + r.rating, 0) / event.reviews.length
    : 0;

  const submitReview = async () => {
    if (!selectedEventId) return;
    setSubmittingReview(true);
    try {
      await apiFetch(`/api/events/${selectedEventId}/reviews`, {
        method: 'POST',
        body: JSON.stringify({ rating: reviewRating, comment: reviewComment || undefined }),
      });
      toast.success('Review submitted!');
      setReviewDialog(false);
      setReviewRating(5);
      setReviewComment('');
      setUserHasReviewed(true);
      // Refresh event to show new review
      const data = await apiFetch<{ event: Event }>(`/api/events/${selectedEventId}`);
      setEvent(data.event);
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit review');
    } finally {
      setSubmittingReview(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-72 w-full rounded-xl" />
        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-40 w-full" />
          </div>
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="text-center py-20">
        <CalendarDays className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h2 className="text-xl font-semibold mb-2">Event not found</h2>
        <Button variant="outline" onClick={goBack}>Go Back</Button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Back button */}
      <Button variant="ghost" size="sm" onClick={goBack} className="gap-2">
        <ArrowLeft className="h-4 w-4" /> Back
      </Button>

      {/* Hero Image */}
      <div className="relative h-64 md:h-80 rounded-xl overflow-hidden">
        {event.coverImage ? (
          <img src={event.coverImage} alt={event.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-emerald-200 to-teal-200 flex items-center justify-center">
            <CalendarDays className="h-16 w-16 text-emerald-300" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-4 left-6 right-6 text-white">
          <Badge className="mb-2 bg-emerald-600">{event.category?.name}</Badge>
          <h1 className="text-2xl md:text-4xl font-bold">{event.title}</h1>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="md:col-span-2 space-y-6">
          {/* Date / Location / Type */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
                  <CalendarDays className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Date</p>
                  <p className="font-medium">{format(new Date(event.startDate), 'EEEE, MMM d, yyyy')}</p>
                  {event.endDate && event.endDate !== event.startDate && (
                    <p className="text-sm text-muted-foreground">to {format(new Date(event.endDate), 'MMM d, yyyy')}</p>
                  )}
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-teal-50 text-teal-600">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Time</p>
                  <p className="font-medium">{event.startTime || 'TBD'} {event.endTime ? `- ${event.endTime}` : ''}</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${event.isVirtual ? 'bg-cyan-50 text-cyan-600' : 'bg-amber-50 text-amber-600'}`}>
                  {event.isVirtual ? <Globe className="h-5 w-5" /> : <MapPin className="h-5 w-5" />}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{event.isVirtual ? 'Virtual Event' : 'Location'}</p>
                  {event.isVirtual ? (
                    <p className="font-medium text-cyan-600">{event.virtualUrl || 'Online'}</p>
                  ) : (
                    <p className="font-medium">{event.venueName}{event.venueCity ? `, ${event.venueCity}` : ''}</p>
                  )}
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-50 text-purple-600">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Capacity</p>
                  <p className="font-medium">{event.capacity || 'Unlimited'} attendees</p>
                </div>
              </div>
            </Card>
          </div>

          {/* Tags */}
          {event.tags?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {event.tags.map(tag => (
                <Badge key={tag.id} variant="outline" className="gap-1">
                  <Tag className="h-3 w-3" /> {tag.name}
                </Badge>
              ))}
            </div>
          )}

          {/* Description */}
          <Card>
            <CardHeader><CardTitle>Description</CardTitle></CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none text-muted-foreground whitespace-pre-wrap">{event.description}</div>
            </CardContent>
          </Card>

          {/* Program / Sessions */}
          {sessions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-emerald-600" />
                  Program
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {sessions.map(session => (
                    <div key={session.id} className="flex items-start gap-3 p-3 rounded-lg border">
                      <div className="text-center min-w-[60px]">
                        <p className="text-sm font-semibold">{session.startTime}</p>
                        <p className="text-xs text-muted-foreground">{session.endTime}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-medium text-sm">{session.title}</h4>
                          <Badge variant="outline" className="text-xs">{session.sessionType}</Badge>
                        </div>
                        {session.participant && (
                          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <Mic className="h-3 w-3" /> {session.participant.name}
                          </p>
                        )}
                        {session.venueName && (
                          <p className="text-xs text-muted-foreground mt-0.5">{session.venueName}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Speakers & Participants */}
          {participants.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-emerald-600" />
                  Speakers & Participants
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-4">
                  {participants.map(p => (
                    <div key={p.id} className="flex items-start gap-3 p-3 rounded-lg border">
                      {p.image ? (
                        <img src={p.image} alt={p.name} className="h-12 w-12 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center shrink-0">
                          <span className="text-emerald-700 dark:text-emerald-300 font-semibold">{p.name.charAt(0).toUpperCase()}</span>
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-sm">{p.name}</h4>
                          {p.isFeatured && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />}
                        </div>
                        <Badge variant="outline" className="text-xs mt-0.5">{p.role}</Badge>
                        {p.title && (
                          <p className="text-xs text-muted-foreground mt-1">{p.title}</p>
                        )}
                        {p.organization && (
                          <p className="text-xs text-muted-foreground">{p.organization}</p>
                        )}
                        {p.bio && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.bio}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Gallery / Media */}
          {media.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="h-5 w-5 text-emerald-600" />
                  Gallery
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {media.map(m => (
                    <div key={m.id} className="relative rounded-lg overflow-hidden border aspect-video">
                      {m.type === 'IMAGE' ? (
                        <img src={m.url} alt={m.caption || 'Gallery image'} className="w-full h-full object-cover" />
                      ) : m.type === 'VIDEO' ? (
                        <div className="w-full h-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                          <Video className="h-8 w-8 text-zinc-400" />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="h-10 w-10 rounded-full bg-black/30 flex items-center justify-center">
                              <Play className="h-5 w-5 text-white ml-0.5" />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="w-full h-full bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center">
                          <FileText className="h-8 w-8 text-zinc-400" />
                        </div>
                      )}
                      {m.caption && (
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                          <p className="text-xs text-white truncate">{m.caption}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Reviews */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
                  Reviews ({event._count?.reviews || 0})
                  {avgRating > 0 && (
                    <span className="text-sm font-normal text-muted-foreground">
                      {avgRating.toFixed(1)} average
                    </span>
                  )}
                </span>
                {user && !userHasReviewed && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setReviewDialog(true)}
                    className="gap-1"
                  >
                    <MessageSquarePlus className="h-4 w-4" />
                    Write a Review
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {event.reviews?.length === 0 ? (
                <p className="text-muted-foreground text-sm">No reviews yet.</p>
              ) : (
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {event.reviews.map(review => (
                    <div key={review.id} className="border-b last:border-0 pb-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{review.user?.name}</span>
                        <div className="flex">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} className={`h-3 w-3 ${i < review.rating ? 'fill-amber-400 text-amber-400' : 'text-gray-200'}`} />
                          ))}
                        </div>
                        <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(review.createdAt))}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{review.comment}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Related Events */}
          {relatedEvents.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Related Events</CardTitle></CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {relatedEvents.map(re => (
                    <Card key={re.id} className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('event-detail', re.id)}>
                      <div className="h-32 bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center">
                        {re.coverImage ? <img src={re.coverImage} alt={re.title} className="w-full h-full object-cover" /> : <CalendarDays className="h-8 w-8 text-emerald-300" />}
                      </div>
                      <CardContent className="p-3">
                        <h4 className="font-medium text-sm line-clamp-1">{re.title}</h4>
                        <p className="text-xs text-muted-foreground mt-1">{format(new Date(re.startDate), 'MMM d, yyyy')}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Price Card */}
          <Card className="sticky top-20">
            <CardContent className="p-6 space-y-4">
              {event.isPaid ? (
                <div>
                  <p className="text-sm text-muted-foreground">Starting from</p>
                  <p className="text-3xl font-bold text-emerald-600">
                    ${Math.min(...event.ticketTypes.filter(t => t.price > 0).map(t => t.price), 0).toFixed(2)}
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-muted-foreground">This is a</p>
                  <p className="text-3xl font-bold text-emerald-600">Free Event</p>
                </div>
              )}

              <Separator />

              {/* Ticket Types */}
              <div className="space-y-3">
                <h4 className="font-semibold text-sm">Ticket Types</h4>
                {event.ticketTypes?.map(tt => {
                  const available = tt.quantity - tt.soldCount;
                  return (
                    <div key={tt.id} className="border rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{tt.name}</span>
                        <span className={`font-bold ${tt.price > 0 ? 'text-emerald-600' : ''}`}>
                          {tt.price > 0 ? `$${tt.price.toFixed(2)}` : 'Free'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{available} available</p>
                      <Button
                        size="sm"
                        className="w-full bg-emerald-600 hover:bg-emerald-700"
                        disabled={available <= 0}
                        onClick={() => handleBook(tt)}
                      >
                        {available <= 0 ? 'Sold Out' : event.isPaid ? 'Book Now' : 'Register Free'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Organizer Card */}
          {event.organizer && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center">
                    <User className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{event.organizer.name}</p>
                    <p className="text-xs text-muted-foreground">Organizer</p>
                  </div>
                </div>
                {event.organizer.bio && (
                  <p className="text-sm text-muted-foreground mt-2">{event.organizer.bio}</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Booking Dialog */}
      <Dialog open={bookDialog} onOpenChange={setBookDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Book Tickets</DialogTitle>
            <DialogDescription>{selectedTicket?.name} - {event.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <span>Price per ticket</span>
              <span className="font-medium">{selectedTicket && selectedTicket.price > 0 ? `$${selectedTicket.price.toFixed(2)}` : 'Free'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Quantity</span>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQuantity(q => Math.max(1, q - 1))}><Minus className="h-4 w-4" /></Button>
                <span className="w-8 text-center font-medium">{quantity}</span>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQuantity(q => Math.min(selectedTicket ? selectedTicket.quantity - selectedTicket.soldCount : 10, q + 1))}><Plus className="h-4 w-4" /></Button>
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between text-lg font-bold">
              <span>Total</span>
              <span className="text-emerald-600">{selectedTicket && selectedTicket.price > 0 ? `$${(selectedTicket.price * quantity).toFixed(2)}` : 'Free'}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBookDialog(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={confirmBooking} disabled={booking}>
              {booking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Booking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Dialog */}
      <Dialog open={reviewDialog} onOpenChange={setReviewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Write a Review</DialogTitle>
            <DialogDescription>Share your experience for {event.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Rating</Label>
              <div className="flex gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setReviewRating(i + 1)}
                    className="p-1"
                  >
                    <Star
                      className={`h-6 w-6 transition-colors ${
                        i < reviewRating
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-gray-200 hover:text-amber-300'
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Comment (optional)</Label>
              <Textarea
                placeholder="Share your thoughts about this event..."
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                rows={3}
                maxLength={1000}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewDialog(false)}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={submitReview}
              disabled={submittingReview}
            >
              {submittingReview && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit Review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function formatDistanceToNow(date: Date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
