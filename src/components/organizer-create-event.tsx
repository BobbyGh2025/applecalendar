'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useAppStore } from '@/stores/app-store';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Globe, MapPin, DollarSign, Tag, Info, Clock, Building2 } from 'lucide-react';
import { parseMoneyOrThrow, DEFAULT_CURRENCY } from '@/lib/money';

interface Category {
  id: string;
  name: string;
  slug: string;
}

interface VenueOption {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string | null;
  country: string;
  lat: number | null;
  lng: number | null;
}

interface TicketTypeForm {
  name: string;
  price: string;
  quantity: string;
}

export function OrganizerCreateEvent() {
  const { navigate } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [venues, setVenues] = useState<VenueOption[]>([]);

  const [form, setForm] = useState({
    title: '',
    description: '',
    shortDescription: '',
    categorySlug: '',
    coverImage: '',
    startDate: '',
    endDate: '',
    startTime: '',
    endTime: '',
    timezone: 'UTC',
    venueId: '',
    venueName: '',
    venueAddress: '',
    venueCity: '',
    venueState: '',
    venueCountry: '',
    venueLat: '',
    venueLng: '',
    isVirtual: false,
    virtualUrl: '',
    isPaid: false,
    currency: 'USD',
    capacity: '',
    tags: '',
  });

  const [ticketTypes, setTicketTypes] = useState<TicketTypeForm[]>([
    { name: 'General Admission', price: '0', quantity: '100' },
  ]);

  useEffect(() => {
    apiFetch<{ categories: Category[] }>('/api/categories')
      .then(d => setCategories(d.categories || []))
      .catch(() => {});
    apiFetch<{ venues: VenueOption[] }>('/api/organizer/venues')
      .then(d => setVenues(d.venues || []))
      .catch(() => {});
  }, []);

  const updateForm = (key: string, value: string | boolean) => setForm(prev => ({ ...prev, [key]: value }));

  const addTicketType = () => setTicketTypes(prev => [...prev, { name: '', price: '0', quantity: '50' }]);
  const removeTicketType = (i: number) => {
    if (ticketTypes.length <= 1) return;
    setTicketTypes(prev => prev.filter((_, idx) => idx !== i));
  };
  const updateTicketType = (i: number, key: keyof TicketTypeForm, value: string) => {
    setTicketTypes(prev => prev.map((t, idx) => idx === i ? { ...t, [key]: value } : t));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.startDate || !form.categorySlug) {
      toast.error('Please fill in required fields (title, date, category)');
      return;
    }
    if (form.isVirtual && !form.virtualUrl) {
      toast.error('Please provide a virtual event URL');
      return;
    }
    if (form.isPaid) {
      for (const tt of ticketTypes) {
        if (!tt.name || !tt.price || !tt.quantity) {
          toast.error('Please fill in all ticket type fields');
          return;
        }
      }
    }

    setLoading(true);
    try {
      const body: any = {
        title: form.title,
        description: form.description,
        shortDescription: form.shortDescription,
        categorySlug: form.categorySlug,
        coverImage: form.coverImage,
        startDate: form.startDate,
        endDate: form.endDate || undefined,
        startTime: form.startTime || undefined,
        endTime: form.endTime || undefined,
        timezone: form.timezone,
        venueId: form.venueId || undefined,
        venueName: form.isVirtual ? undefined : form.venueName,
        venueAddress: form.isVirtual ? undefined : form.venueAddress,
        venueCity: form.isVirtual ? undefined : form.venueCity,
        venueState: form.isVirtual ? undefined : form.venueState,
        venueCountry: form.isVirtual ? undefined : form.venueCountry,
        venueLat: form.isVirtual ? undefined : (form.venueLat ? Number(form.venueLat) : undefined),
        venueLng: form.isVirtual ? undefined : (form.venueLng ? Number(form.venueLng) : undefined),
        isVirtual: form.isVirtual,
        virtualUrl: form.isVirtual ? form.virtualUrl : undefined,
        isPaid: form.isPaid,
        currency: form.currency,
        capacity: form.capacity ? parseInt(form.capacity) : undefined,
        tags: form.tags ? form.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [],
        ticketTypes: form.isPaid
          ? ticketTypes.map(tt => ({ name: tt.name, price: parseMoneyOrThrow(tt.price, form.currency || DEFAULT_CURRENCY), quantity: parseInt(tt.quantity) }))
          : [{ name: 'Free', price: 0, quantity: form.capacity ? parseInt(form.capacity) : 100 }],
      };
      await apiFetch('/api/events', { method: 'POST', body: JSON.stringify(body) });
      toast.success('Event created successfully!');
      navigate('organizer-events');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create event');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold">Create Event</h1>

      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Info className="h-5 w-5 text-emerald-500" /> Basic Information</CardTitle>
          <CardDescription>Fill in the basic details for your event</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input id="title" placeholder="Event title" value={form.title} onChange={e => updateForm('title', e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="shortDesc">Short Description</Label>
            <Input id="shortDesc" placeholder="Brief summary (1-2 sentences)" value={form.shortDescription} onChange={e => updateForm('shortDescription', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="desc">Full Description</Label>
            <Textarea id="desc" placeholder="Detailed event description..." rows={5} value={form.description} onChange={e => updateForm('description', e.target.value)} />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Category *</Label>
              <Select value={form.categorySlug} onValueChange={v => updateForm('categorySlug', v)}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c.id} value={c.slug}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="coverImg">Cover Image URL</Label>
              <Input id="coverImg" placeholder="https://..." value={form.coverImage} onChange={e => updateForm('coverImage', e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tags">Tags (comma-separated)</Label>
            <Input id="tags" placeholder="music, tech, networking" value={form.tags} onChange={e => updateForm('tags', e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* Date & Time */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5 text-teal-500" /> Date & Time</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date *</Label>
              <Input id="startDate" type="date" value={form.startDate} onChange={e => updateForm('startDate', e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End Date</Label>
              <Input id="endDate" type="date" value={form.endDate} onChange={e => updateForm('endDate', e.target.value)} />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startTime">Start Time</Label>
              <Input id="startTime" type="time" value={form.startTime} onChange={e => updateForm('startTime', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endTime">End Time</Label>
              <Input id="endTime" type="time" value={form.endTime} onChange={e => updateForm('endTime', e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Timezone</Label>
            <Select value={form.timezone} onValueChange={v => updateForm('timezone', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="UTC">UTC</SelectItem>
                <SelectItem value="America/New_York">Eastern (ET)</SelectItem>
                <SelectItem value="America/Chicago">Central (CT)</SelectItem>
                <SelectItem value="America/Denver">Mountain (MT)</SelectItem>
                <SelectItem value="America/Los_Angeles">Pacific (PT)</SelectItem>
                <SelectItem value="Europe/London">London (GMT)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Venue */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {form.isVirtual ? <Globe className="h-5 w-5 text-cyan-500" /> : <MapPin className="h-5 w-5 text-amber-500" />}
            {form.isVirtual ? 'Virtual Event' : 'Venue'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch checked={form.isVirtual} onCheckedChange={v => updateForm('isVirtual', v)} />
            <Label>This is a virtual/online event</Label>
          </div>
          {form.isVirtual ? (
            <div className="space-y-2">
              <Label htmlFor="virtualUrl">Virtual Event URL *</Label>
              <Input id="virtualUrl" placeholder="https://zoom.us/..." value={form.virtualUrl} onChange={e => updateForm('virtualUrl', e.target.value)} />
            </div>
          ) : (
            <>
              {/* Venue Selector */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1"><Building2 className="h-4 w-4" /> Select Venue</Label>
                <Select
                  value={form.venueId || '__none__'}
                  onValueChange={(v) => {
                    if (v === '__none__') {
                      setForm(prev => ({ ...prev, venueId: '', venueName: '', venueAddress: '', venueCity: '', venueState: '', venueCountry: '', venueLat: '', venueLng: '' }));
                    } else {
                      const venue = venues.find(vn => vn.id === v);
                      if (venue) {
                        setForm(prev => ({
                          ...prev,
                          venueId: venue.id,
                          venueName: venue.name,
                          venueAddress: venue.address,
                          venueCity: venue.city,
                          venueState: venue.state || '',
                          venueCountry: venue.country,
                          venueLat: venue.lat != null ? String(venue.lat) : '',
                          venueLng: venue.lng != null ? String(venue.lng) : '',
                        }));
                      }
                    }
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="No venue selected" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No venue (custom)</SelectItem>
                    {venues.map(v => <SelectItem key={v.id} value={v.id}>{v.name} — {v.city}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Inline Venue Fields */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2"><Label htmlFor="venueName">Venue Name</Label><Input id="venueName" placeholder="Convention Center" value={form.venueName} onChange={e => updateForm('venueName', e.target.value)} disabled={!!form.venueId} /></div>
                <div className="space-y-2"><Label htmlFor="venueAddr">Address</Label><Input id="venueAddr" placeholder="123 Main St" value={form.venueAddress} onChange={e => updateForm('venueAddress', e.target.value)} disabled={!!form.venueId} /></div>
                <div className="space-y-2"><Label htmlFor="venueCity">City</Label><Input id="venueCity" placeholder="New York" value={form.venueCity} onChange={e => updateForm('venueCity', e.target.value)} disabled={!!form.venueId} /></div>
                <div className="space-y-2"><Label htmlFor="venueState">State</Label><Input id="venueState" placeholder="NY" value={form.venueState} onChange={e => updateForm('venueState', e.target.value)} disabled={!!form.venueId} /></div>
                <div className="space-y-2 sm:col-span-2"><Label htmlFor="venueCountry">Country</Label><Input id="venueCountry" placeholder="United States" value={form.venueCountry} onChange={e => updateForm('venueCountry', e.target.value)} disabled={!!form.venueId} /></div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Ticketing */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-emerald-500" /> Ticketing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch checked={form.isPaid} onCheckedChange={v => updateForm('isPaid', v)} />
            <Label>This is a paid event</Label>
          </div>
          {form.isPaid && (
            <>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Select value={form.currency} onValueChange={v => updateForm('currency', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD ($)</SelectItem>
                      <SelectItem value="EUR">EUR (&euro;)</SelectItem>
                      <SelectItem value="GBP">GBP (&pound;)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="capacity">Total Capacity</Label>
                  <Input id="capacity" type="number" placeholder="100" value={form.capacity} onChange={e => updateForm('capacity', e.target.value)} />
                </div>
              </div>
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Ticket Types</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addTicketType}><Plus className="h-4 w-4 mr-1" /> Add Type</Button>
                </div>
                {ticketTypes.map((tt, i) => (
                  <div key={i} className="grid grid-cols-[1fr_100px_100px_40px] gap-2 items-end">
                    <div className="space-y-1">
                      {i === 0 && <Label className="text-xs">Name</Label>}
                      <Input placeholder="VIP, General..." value={tt.name} onChange={e => updateTicketType(i, 'name', e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      {i === 0 && <Label className="text-xs">Price</Label>}
                      <Input type="number" placeholder="0" value={tt.price} onChange={e => updateTicketType(i, 'price', e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      {i === 0 && <Label className="text-xs">Qty</Label>}
                      <Input type="number" placeholder="50" value={tt.quantity} onChange={e => updateTicketType(i, 'quantity', e.target.value)} />
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="text-red-500" onClick={() => removeTicketType(i)} disabled={ticketTypes.length <= 1}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-4">
        <Button type="button" variant="outline" onClick={() => navigate('organizer-events')}>Cancel</Button>
        <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create Event
        </Button>
      </div>
    </form>
  );
}
