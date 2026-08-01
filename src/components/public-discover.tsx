'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useAppStore } from '@/stores/app-store';
import { apiFetch } from '@/lib/api';
import { Search, MapPin, CalendarDays, TrendingUp, Star, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface Category {
  id: string;
  name: string;
  slug: string;
}

interface TicketType {
  id: string;
  name: string;
  price: number;
  quantity: number;
  soldCount: number;
}

interface Event {
  id: string;
  title: string;
  slug: string;
  coverImage: string | null;
  startDate: string;
  endDate: string;
  startTime: string | null;
  venueName: string | null;
  venueCity: string | null;
  isVirtual: boolean;
  isPaid: boolean;
  capacity: number;
  shortDescription: string | null;
  category: Category;
  ticketTypes: TicketType[];
  _count: { reviews: number; bookings: number };
}

const DATE_FILTERS = ['all', 'this-week', 'this-month', 'next-month'];
const DATE_LABELS: Record<string, string> = {
  'all': 'All',
  'this-week': 'This Week',
  'this-month': 'This Month',
  'next-month': 'Next Month',
};

export function PublicDiscover() {
  const { navigate, searchQuery, setSearchQuery, selectedCategory, setSelectedCategory, selectedDateFilter, setSelectedDateFilter } = useAppStore();
  const [events, setEvents] = useState<Event[]>([]);
  const [featuredEvents, setFeaturedEvents] = useState<Event[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchCategories = useCallback(async () => {
    try {
      const data = await apiFetch<{ categories: Category[] }>('/api/categories');
      setCategories(data.categories || []);
    } catch {
      // silent
    }
  }, []);

  const fetchFeatured = useCallback(async () => {
    setFeaturedLoading(true);
    try {
      const data = await apiFetch<{ events: Event[]; total: number }>('/api/events?featured=true&limit=6');
      setFeaturedEvents(data.events || []);
    } catch {
      // silent
    } finally {
      setFeaturedLoading(false);
    }
  }, []);

  const fetchEvents = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(p),
        limit: '12',
        featured: 'false',
      });
      if (searchQuery) params.set('search', searchQuery);
      if (selectedCategory) params.set('category', selectedCategory);
      if (selectedDateFilter && selectedDateFilter !== 'all') params.set('date', selectedDateFilter);
      const data = await apiFetch<{ events: Event[]; total: number; page: number; totalPages: number }>(`/api/events?${params.toString()}`);
      setEvents(data.events || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch {
      toast.error('Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedCategory, selectedDateFilter]);

  useEffect(() => { fetchCategories(); fetchFeatured(); }, [fetchCategories, fetchFeatured]);
  useEffect(() => { setPage(1); fetchEvents(1); }, [fetchEvents]);
  useEffect(() => { fetchEvents(page); }, [page]);

  const getMinPrice = (ev: Event) => {
    if (!ev.isPaid) return 0;
    const prices = ev.ticketTypes.filter(t => t.price > 0).map(t => t.price);
    return prices.length ? Math.min(...prices) : 0;
  };

  const getTotalSold = (ev: Event) => ev.ticketTypes.reduce((s, t) => s + (t.soldCount || 0), 0);
  const getCapacity = (ev: Event) => ev.capacity || ev.ticketTypes.reduce((s, t) => s + t.quantity, 0);

  const EventCardSkeleton = () => (
    <Card className="overflow-hidden">
      <Skeleton className="h-48 w-full" />
      <CardContent className="p-4 space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-20" />
        <div className="space-y-1"><Skeleton className="h-2 w-full" /><Skeleton className="h-2 w-16" /></div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <section className="relative rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-600 p-6 md:p-12 text-white overflow-hidden">
        <div className="relative z-10 max-w-2xl">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">Discover Amazing Events</h1>
          <p className="text-emerald-100 mb-6 text-lg">Find and book tickets to the best events happening around you.</p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Search events..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-12 bg-white/95 text-foreground border-0 shadow-lg placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <div className="absolute top-0 right-0 w-1/2 h-full opacity-10">
          <CalendarDays className="h-full w-full" />
        </div>
      </section>

      {/* Date Filter Pills */}
      <div className="flex flex-wrap gap-2">
        {DATE_FILTERS.map(f => (
          <Button
            key={f}
            variant={selectedDateFilter === f ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedDateFilter(f)}
            className={selectedDateFilter === f ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
          >
            {DATE_LABELS[f]}
          </Button>
        ))}
      </div>

      {/* Category Pills */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={!selectedCategory ? 'default' : 'outline'}
          size="sm"
          onClick={() => setSelectedCategory(null)}
          className={!selectedCategory ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
        >
          All Categories
        </Button>
        {categories.map(cat => (
          <Button
            key={cat.id}
            variant={selectedCategory === cat.slug ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedCategory(cat.slug)}
            className={selectedCategory === cat.slug ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
          >
            {cat.name}
          </Button>
        ))}
      </div>

      {/* Featured Events */}
      {!searchQuery && selectedDateFilter === 'all' && !selectedCategory && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-5 w-5 text-emerald-500" />
            <h2 className="text-xl font-semibold">Featured Events</h2>
          </div>
          <ScrollArea className="w-full">
            <div className="flex gap-4 pb-4">
              {featuredLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i} className="min-w-[280px] max-w-[280px] overflow-hidden flex-shrink-0">
                    <Skeleton className="h-36 w-full" />
                    <CardContent className="p-4 space-y-2">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-5 w-full" />
                      <Skeleton className="h-4 w-28" />
                    </CardContent>
                  </Card>
                ))
              ) : featuredEvents.length === 0 ? null : (
                featuredEvents.map(ev => (
                  <Card
                    key={ev.id}
                    className="min-w-[280px] max-w-[280px] overflow-hidden flex-shrink-0 cursor-pointer hover:shadow-lg transition-shadow group"
                    onClick={() => navigate('event-detail', ev.id)}
                  >
                    <div className="relative h-36 overflow-hidden">
                      {ev.coverImage ? (
                        <img src={ev.coverImage} alt={ev.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center">
                          <CalendarDays className="h-10 w-10 text-emerald-300" />
                        </div>
                      )}
                      <Badge className="absolute top-2 right-2 bg-emerald-600">Featured</Badge>
                    </div>
                    <CardContent className="p-4">
                      <Badge variant="secondary" className="text-xs mb-2">{ev.category?.name}</Badge>
                      <h3 className="font-semibold text-sm line-clamp-2 mb-1">{ev.title}</h3>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <CalendarDays className="h-3 w-3" />
                        {format(new Date(ev.startDate), 'MMM d, yyyy')}
                      </div>
                      <p className="mt-2 font-semibold text-emerald-600 text-sm">
                        {ev.isPaid ? `$${getMinPrice(ev).toFixed(2)}` : 'Free'}
                      </p>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </section>
      )}

      {/* Events Grid */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">
            {searchQuery ? `Results for "${searchQuery}"` : 'Upcoming Events'}
            {!loading && <span className="text-muted-foreground font-normal ml-2">({total})</span>}
          </h2>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => <EventCardSkeleton key={i} />)}
          </div>
        ) : events.length === 0 ? (
          <Card className="p-12 text-center">
            <CalendarDays className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No events found</h3>
            <p className="text-muted-foreground text-sm">Try adjusting your search or filters</p>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {events.map(ev => {
                const sold = getTotalSold(ev);
                const cap = getCapacity(ev);
                const pct = cap > 0 ? Math.min((sold / cap) * 100, 100) : 0;
                return (
                  <Card
                    key={ev.id}
                    className="overflow-hidden cursor-pointer hover:shadow-lg transition-shadow group"
                    onClick={() => navigate('event-detail', ev.id)}
                  >
                    <div className="relative h-48 overflow-hidden">
                      {ev.coverImage ? (
                        <img src={ev.coverImage} alt={ev.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center">
                          <CalendarDays className="h-12 w-12 text-emerald-300" />
                        </div>
                      )}
                      <Badge className="absolute top-2 left-2 bg-emerald-600/90 text-white">{ev.category?.name}</Badge>
                      {ev.isVirtual && (
                        <Badge variant="secondary" className="absolute top-2 right-2">Virtual</Badge>
                      )}
                    </div>
                    <CardContent className="p-4 space-y-3">
                      <h3 className="font-semibold line-clamp-2 group-hover:text-emerald-600 transition-colors">{ev.title}</h3>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <CalendarDays className="h-4 w-4 flex-shrink-0" />
                        <span>{format(new Date(ev.startDate), 'MMM d, yyyy')}</span>
                        {ev.startTime && <span>· {ev.startTime}</span>}
                      </div>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        {ev.isVirtual ? (
                          <span className="flex items-center gap-1">🌐 Online Event</span>
                        ) : (
                          <>
                            <MapPin className="h-4 w-4 flex-shrink-0" />
                            <span className="truncate">{ev.venueName}{ev.venueCity ? `, ${ev.venueCity}` : ''}</span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-emerald-600">
                          {ev.isPaid ? `$${getMinPrice(ev).toFixed(2)}` : 'Free'}
                        </span>
                        {ev._count?.reviews > 0 && (
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                            <span>{ev._count.reviews}</span>
                          </div>
                        )}
                      </div>
                      {cap > 0 && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{sold} tickets sold</span>
                            <span>{Math.round(pct)}%</span>
                          </div>
                          <Progress value={pct} className="h-1.5" />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center mt-8 gap-2">
                <Button variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <span className="flex items-center px-4 text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
