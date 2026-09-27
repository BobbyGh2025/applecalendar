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
import {
  ArrowLeft, MapPin, CalendarDays, Clock, Globe, Star, Users, Ticket,
  Minus, Plus, Loader2, Tag, User, MessageSquarePlus,
  Image as ImageIcon, Video, FileText, Play, Mic, Music,
  AlertCircle, CheckCircle2, XCircle, ExternalLink,
} from 'lucide-react';

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
  description?: string | null;
  price: number;
  quantity: number;
  soldCount: number;
  currency: string;
  minPerOrder: number;
  maxPerOrder: number;
  saleStart: string | null;
  saleEnd: string | null;
  isActive: boolean;
}

interface EventSession {
  id: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  date: string | null;
  sessionType: string;
  status?: string;
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
  _count?: { sessions: number };
}

interface EventMediaItem {
  id: string;
  url: string;
  type: string;
  category: string;
  caption: string | null;
  sortOrder: number;
}

interface VenueRelation {
  id: string;
  name: string;
  slug?: string;
  address: string;
  city: string;
  state: string | null;
  country: string;
  lat: number | null;
  lng: number | null;
  capacity: number | null;
  website: string | null;
  googleMapsUrl: string | null;
  coverImage?: string | null;
  isPublic?: boolean;
}

interface Event {
  id: string;
  title: string;
  slug?: string;
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
  isBookable?: boolean;
  capacity: number;
  currency: string;
  status: string;
  timezone?: string;
  isFeatured?: boolean;
  ageRestriction?: string | null;
  category: { id: string; name: string; slug: string; icon?: string | null; color?: string | null };
  tags: { id: string; tag?: { id: string; name: string; slug: string }; name?: string }[];
  ticketTypes: TicketType[];
  reviews: Review[];
  organizer: { id: string; name: string; avatar?: string | null; bio?: string | null };
  venue?: VenueRelation | null;
  _count: { reviews: number; bookings: number };
  sessions?: EventSession[];
  participants?: EventParticipant[];
  media?: EventMediaItem[];
}

/** Session type display labels */
const SESSION_TYPE_LABELS: Record<string, string> = {
  SESSION: 'Session',
  BREAK: 'Break',
  REGISTRATION: 'Registration',
  KEYNOTE: 'Keynote',
  PANEL: 'Panel',
  WORKSHOP: 'Workshop',
  ENTERTAINMENT: 'Entertainment',
};

/** Participant role display labels */
const ROLE_LABELS: Record<string, string> = {
  SPEAKER: 'Speaker',
  ARTIST: 'Artist',
  PERFORMER: 'Performer',
  MODERATOR: 'Moderator',
  PANELIST: 'Panelist',
  DJ: 'DJ',
  HOST: 'Host',
  INSTRUCTOR: 'Instructor',
};

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

  // Phase 4F: Use single API response — event already includes sessions/participants/media
  // No separate N+1 fetches needed

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
        // Phase 4F: Set document title for SEO
        if (data.event.title) {
          document.title = `${data.event.title} — AppleCalendar`;
        }
      })
      .catch(() => toast.error('Failed to load event'))
      .finally(() => setLoading(false));
  }, [selectedEventId, user?.id]);

  // Cleanup: restore document title on unmount
  useEffect(() => {
    return () => { document.title = 'AppleCalendar — Discover Amazing Events'; };
  }, []);

  useEffect(() => {
    if (!event?.category?.slug) return;
    apiFetch<{ events: any[] }>(`/api/events?category=${event.category.slug}&limit=4&featured=false`)
      .then(data => setRelatedEvents(data.events.filter((e: any) => e.id !== event.id).slice(0, 3)))
      .catch(() => {});
  }, [event?.category?.slug]);

  // Derived data from single API response
  const sessions = event?.sessions || [];
  const participants = event?.participants || [];
  const media = event?.media || [];

  // Phase 4F: Bookability check
  const canBook = event?.status === 'PUBLISHED' && event.isBookable !== false;
  const isCancelled = event?.status === 'CANCELLED';
  const isCompleted = event?.status === 'COMPLETED';

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
      const data = await apiFetch<{ event: Event }>(`/api/events/${selectedEventId}`);
      setEvent(data.event);
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit review');
    } finally {
      setSubmittingReview(false);
    }
  };

  // Session date grouping
  const sessionsByDate = sessions.reduce<Record<string, EventSession[]>>((acc, session) => {
    const dateKey = session.date ? format(new Date(session.date), 'yyyy-MM-dd') : 'no-date';
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(session);
    return acc;
  }, {});

  // Media grouping by category
  const posterMedia = media.filter(m => m.category === 'POSTER' || m.category === 'COVER');
  const galleryMedia = media.filter(m => m.category === 'GALLERY');
  const videoMedia = media.filter(m => m.category === 'PROMOTIONAL_VIDEO' || m.type === 'VIDEO');
  const otherMedia = media.filter(m =>
    !['POSTER', 'COVER', 'GALLERY', 'PROMOTIONAL_VIDEO'].includes(m.category) && m.type !== 'VIDEO'
  );

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
        <p className="text-muted-foreground text-sm mb-4">This event may not exist or is not publicly available.</p>
        <Button variant="outline" onClick={goBack}>Go Back</Button>
      </div>
    );
  }

  // Get tag name (handles both {tag: {name}} and {name} shapes)
  const getTagName = (tag: any): string => tag.tag?.name || tag.name || '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Back button */}
      <Button variant="ghost" size="sm" onClick={goBack} className="gap-2" aria-label="Go back to events">
        <ArrowLeft className="h-4 w-4" /> Back
      </Button>

      {/* Phase 4F: Event Status Banner */}
      {isCancelled && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800" role="alert">
          <XCircle className="h-6 w-6 text-red-500 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-red-700 dark:text-red-300">This event has been cancelled</h3>
            <p className="text-sm text-red-600 dark:text-red-400">Bookings are no longer available for this event.</p>
          </div>
        </div>
      )}
      {isCompleted && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
          <CheckCircle2 className="h-6 w-6 text-blue-500 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-blue-700 dark:text-blue-300">This event has taken place</h3>
            <p className="text-sm text-blue-600 dark:text-blue-400">You can still view event details and leave a review.</p>
          </div>
        </div>
      )}

      {/* Hero Image */}
      <div className="relative h-64 md:h-80 lg:h-96 rounded-xl overflow-hidden">
        {event.coverImage ? (
          <img src={event.coverImage} alt={`${event.title} event cover`} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-emerald-200 to-teal-200 flex items-center justify-center">
            <CalendarDays className="h-16 w-16 text-emerald-300" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-4 left-6 right-6 text-white">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge className="bg-emerald-600">{event.category?.name}</Badge>
            {event.isFeatured && <Badge className="bg-amber-500">Featured</Badge>}
            {event.isVirtual && <Badge className="bg-cyan-600">Virtual</Badge>}
          </div>
          <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold">{event.title}</h1>
          {event.shortDescription && (
            <p className="text-white/80 text-sm md:text-base mt-1 line-clamp-2">{event.shortDescription}</p>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="md:col-span-2 space-y-6">
          {/* Date / Location / Type Info Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600" aria-hidden="true">
                  <CalendarDays className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Date</p>
                  <p className="font-medium">{format(new Date(event.startDate), 'EEEE, MMM d, yyyy')}</p>
                  {event.endDate && event.endDate !== event.startDate && (
                    <p className="text-sm text-muted-foreground">to {format(new Date(event.endDate), 'EEE, MMM d, yyyy')}</p>
                  )}
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-teal-50 text-teal-600" aria-hidden="true">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Time</p>
                  <p className="font-medium">{event.startTime || 'TBD'} {event.endTime ? `- ${event.endTime}` : ''}</p>
                  {event.timezone && event.timezone !== 'UTC' && (
                    <p className="text-xs text-muted-foreground">{event.timezone}</p>
                  )}
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${event.isVirtual ? 'bg-cyan-50 text-cyan-600' : 'bg-amber-50 text-amber-600'}`} aria-hidden="true">
                  {event.isVirtual ? <Globe className="h-5 w-5" /> : <MapPin className="h-5 w-5" />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground">{event.isVirtual ? 'Virtual Event' : 'Location'}</p>
                  {event.isVirtual ? (
                    event.virtualUrl ? (
                      <a
                        href={event.virtualUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-cyan-600 hover:underline inline-flex items-center gap-1"
                      >
                        Join Online <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <p className="font-medium text-cyan-600">Online</p>
                    )
                  ) : event.venue ? (
                    <div>
                      <p className="font-medium">{event.venue.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {event.venue.address}{event.venue.city ? `, ${event.venue.city}` : ''}{event.venue.state ? `, ${event.venue.state}` : ''}
                      </p>
                      {(event.venue.googleMapsUrl || (event.venue.lat != null && event.venue.lng != null)) && (
                        <a
                          href={event.venue.googleMapsUrl || `https://www.google.com/maps?q=${event.venue.lat},${event.venue.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-emerald-600 hover:underline inline-flex items-center gap-1 mt-0.5"
                        >
                          <Globe className="h-3 w-3" /> View on Google Maps
                        </a>
                      )}
                      {event.venue.website && (
                        <a
                          href={event.venue.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-emerald-600 hover:underline inline-flex items-center gap-1 mt-0.5 ml-2"
                        >
                          <ExternalLink className="h-3 w-3" /> Venue Website
                        </a>
                      )}
                    </div>
                  ) : (
                    <div>
                      <p className="font-medium">{event.venueName || 'Location TBD'}</p>
                      {event.venueCity && (
                        <p className="text-xs text-muted-foreground">{event.venueCity}{event.venueState ? `, ${event.venueState}` : ''}{event.venueCountry ? `, ${event.venueCountry}` : ''}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-50 text-purple-600" aria-hidden="true">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Capacity</p>
                  <p className="font-medium">{event.capacity || 'Unlimited'}{event.capacity ? ' attendees' : ''}</p>
                  {event.ageRestriction && (
                    <p className="text-xs text-muted-foreground">{event.ageRestriction}</p>
                  )}
                </div>
              </div>
            </Card>
          </div>

          {/* Tags */}
          {event.tags?.length > 0 && (
            <div className="flex flex-wrap gap-2" role="list" aria-label="Event tags">
              {event.tags.map((tag, i) => (
                <Badge key={tag.id || i} variant="outline" className="gap-1" role="listitem">
                  <Tag className="h-3 w-3" /> {getTagName(tag)}
                </Badge>
              ))}
            </div>
          )}

          {/* Description */}
          <Card>
            <CardHeader><CardTitle>About This Event</CardTitle></CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none text-muted-foreground whitespace-pre-wrap">{event.description}</div>
            </CardContent>
          </Card>

          {/* Program / Sessions */}
          {sessions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                  Program
                  <span className="text-sm font-normal text-muted-foreground">({sessions.length} sessions)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {Object.entries(sessionsByDate).map(([dateKey, dateSessions]) => (
                    <div key={dateKey}>
                      {dateKey !== 'no-date' && (
                        <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                          <CalendarDays className="h-4 w-4" />
                          {format(new Date(dateKey), 'EEEE, MMMM d')}
                        </h3>
                      )}
                      <div className="space-y-3">
                        {dateSessions.map(session => (
                          <div key={session.id} className="flex items-start gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors">
                            <div className="text-center min-w-[60px]">
                              <p className="text-sm font-semibold">{session.startTime}</p>
                              <p className="text-xs text-muted-foreground">{session.endTime}</p>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="font-medium text-sm">{session.title}</h4>
                                <Badge variant="outline" className="text-xs">
                                  {SESSION_TYPE_LABELS[session.sessionType] || session.sessionType}
                                </Badge>
                              </div>
                              {session.description && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{session.description}</p>
                              )}
                              {session.participant && (
                                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                                  <Mic className="h-3 w-3" aria-hidden="true" /> {session.participant.name}
                                  <span className="text-muted-foreground/60">({ROLE_LABELS[session.participant.role] || session.participant.role})</span>
                                </p>
                              )}
                              {session.venueName && (
                                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                                  <MapPin className="h-3 w-3" aria-hidden="true" /> {session.venueName}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
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
                  <Users className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                  Speakers & Participants
                  <span className="text-sm font-normal text-muted-foreground">({participants.length})</span>
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
                          {p.isFeatured && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="Featured" />}
                        </div>
                        <Badge variant="outline" className="text-xs mt-0.5">
                          {ROLE_LABELS[p.role] || p.role}
                        </Badge>
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
                  <ImageIcon className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                  Gallery & Media
                  <span className="text-sm font-normal text-muted-foreground">({media.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Promotional Videos */}
                {videoMedia.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-medium mb-2">Videos</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {videoMedia.map(m => (
                        <div key={m.id} className="relative rounded-lg overflow-hidden border aspect-video">
                          <div className="w-full h-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                            <Video className="h-8 w-8 text-zinc-400" />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="h-10 w-10 rounded-full bg-black/30 flex items-center justify-center">
                                <Play className="h-5 w-5 text-white ml-0.5" />
                              </div>
                            </div>
                          </div>
                          {m.caption && (
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                              <p className="text-xs text-white truncate">{m.caption}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Image Gallery */}
                {(galleryMedia.length > 0 || posterMedia.length > 0) && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Photos</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[...posterMedia, ...galleryMedia].map(m => (
                        <div key={m.id} className="relative rounded-lg overflow-hidden border aspect-video">
                          <img src={m.url} alt={m.caption || 'Event gallery image'} className="w-full h-full object-cover" />
                          {m.caption && (
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                              <p className="text-xs text-white truncate">{m.caption}</p>
                            </div>
                          )}
                          {m.category !== 'GALLERY' && (
                            <Badge variant="secondary" className="absolute top-1 left-1 text-[10px]">{m.category}</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Other media (documents, programs) */}
                {otherMedia.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-sm font-medium mb-2">Documents</h4>
                    <div className="flex flex-wrap gap-2">
                      {otherMedia.map(m => (
                        <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 p-2 rounded-lg border hover:bg-accent transition-colors">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{m.caption || m.category}</span>
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Reviews */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Star className="h-5 w-5 fill-amber-400 text-amber-400" aria-hidden="true" />
                  Reviews ({event.reviews?.length || 0})
                  {avgRating > 0 && (
                    <span className="text-sm font-normal text-muted-foreground">
                      {avgRating.toFixed(1)} average
                    </span>
                  )}
                </span>
                {user && !userHasReviewed && !isCancelled && (
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
                        <div className="flex" aria-label={`${review.rating} out of 5 stars`}>
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
          {/* Price / Ticket Card */}
          <Card className="sticky top-20">
            <CardContent className="p-6 space-y-4">
              {event.isPaid ? (
                <div>
                  <p className="text-sm text-muted-foreground">Starting from</p>
                  <p className="text-3xl font-bold text-emerald-600">
                    {event.currency === 'GHS' ? '₵' : '$'}{Math.min(...event.ticketTypes.filter(t => t.price > 0).map(t => t.price), 0).toFixed(2)}
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
                  const isSoldOut = available <= 0;
                  // Check sale window
                  const now = new Date();
                  const saleStarted = !tt.saleStart || new Date(tt.saleStart) <= now;
                  const saleEnded = tt.saleEnd && new Date(tt.saleEnd) < now;
                  const isOnSale = tt.isActive && saleStarted && !saleEnded;

                  return (
                    <div key={tt.id} className="border rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{tt.name}</span>
                        <span className={`font-bold ${tt.price > 0 ? 'text-emerald-600' : ''}`}>
                          {tt.price > 0 ? `${event.currency === 'GHS' ? '₵' : '$'}${tt.price.toFixed(2)}` : 'Free'}
                        </span>
                      </div>
                      {tt.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{tt.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {isSoldOut ? 'Sold out' : saleEnded ? 'Sale ended' : !saleStarted ? 'Coming soon' : `${available} available`}
                      </p>
                      <Button
                        size="sm"
                        className="w-full bg-emerald-600 hover:bg-emerald-700"
                        disabled={!canBook || isSoldOut || !isOnSale}
                        onClick={() => handleBook(tt)}
                        aria-label={isSoldOut ? `${tt.name} sold out` : canBook ? `Book ${tt.name}` : 'Booking unavailable'}
                      >
                        {isSoldOut ? 'Sold Out' : !canBook ? (isCancelled ? 'Event Cancelled' : isCompleted ? 'Event Ended' : 'Unavailable') : saleEnded ? 'Sale Ended' : !saleStarted ? 'Coming Soon' : event.isPaid ? 'Book Now' : 'Register Free'}
                      </Button>
                    </div>
                  );
                })}
                {(!event.ticketTypes || event.ticketTypes.length === 0) && (
                  <p className="text-sm text-muted-foreground">No ticket information available yet.</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Organizer Card */}
          {event.organizer && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  {event.organizer.avatar ? (
                    <img src={event.organizer.avatar} alt={event.organizer.name} className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center">
                      <User className="h-5 w-5 text-emerald-600" />
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-sm">{event.organizer.name}</p>
                    <p className="text-xs text-muted-foreground">Organizer</p>
                  </div>
                </div>
                {event.organizer.bio && (
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-3">{event.organizer.bio}</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Phase 4F: SEO-relevant structured event summary for accessibility */}
          <div className="sr-only" aria-label="Event summary">
            <p>{event.title} — {format(new Date(event.startDate), 'MMMM d, yyyy')}{event.startTime ? ` at ${event.startTime}` : ''}</p>
            {event.venue?.name && <p>Location: {event.venue.name}, {event.venue.city}</p>}
            {event.isPaid ? <p>Ticket prices starting from {event.currency} {Math.min(...event.ticketTypes.filter(t => t.price > 0).map(t => t.price), 0).toFixed(2)}</p> : <p>Free admission</p>}
          </div>
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
              <span className="font-medium">{selectedTicket && selectedTicket.price > 0 ? `${event.currency === 'GHS' ? '₵' : '$'}${selectedTicket.price.toFixed(2)}` : 'Free'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Quantity</span>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQuantity(q => Math.max(1, q - 1))} aria-label="Decrease quantity"><Minus className="h-4 w-4" /></Button>
                <span className="w-8 text-center font-medium">{quantity}</span>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQuantity(q => Math.min(selectedTicket ? selectedTicket.quantity - selectedTicket.soldCount : 10, q + 1))} aria-label="Increase quantity"><Plus className="h-4 w-4" /></Button>
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between text-lg font-bold">
              <span>Total</span>
              <span className="text-emerald-600">{selectedTicket && selectedTicket.price > 0 ? `${event.currency === 'GHS' ? '₵' : '$'}${(selectedTicket.price * quantity).toFixed(2)}` : 'Free'}</span>
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
              <div className="flex gap-1" role="radiogroup" aria-label="Rating">
                {Array.from({ length: 5 }).map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setReviewRating(i + 1)}
                    className="p-1"
                    role="radio"
                    aria-checked={i < reviewRating}
                    aria-label={`${i + 1} star${i > 0 ? 's' : ''}`}
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
