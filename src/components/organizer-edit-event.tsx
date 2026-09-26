'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import {
  Loader2,
  Plus,
  Trash2,
  Globe,
  MapPin,
  DollarSign,
  Info,
  Clock,
  Send,
  XCircle,
  Save,
  AlertTriangle,
  Calendar,
  Users,
  Image as ImageIcon,
  Building2,
} from 'lucide-react';

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
  id?: string;
  name: string;
  price: string;
  quantity: string;
  isNew?: boolean;
  toDelete?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  PUBLISHED: 'bg-green-100 text-green-700',
  DRAFT: 'bg-gray-100 text-gray-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  CANCELLED: 'bg-red-100 text-red-700',
  COMPLETED: 'bg-blue-100 text-blue-700',
  REJECTED: 'bg-red-100 text-red-700',
};

export function OrganizerEditEvent() {
  const { selectedEventId, navigate, user } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [eventStatus, setEventStatus] = useState<string>('DRAFT');
  const [statusDialog, setStatusDialog] = useState<{ open: boolean; target: string }>({
    open: false,
    target: '',
  });

  const [form, setForm] = useState({
    title: '',
    description: '',
    shortDescription: '',
    categoryId: '',
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

  const [ticketTypes, setTicketTypes] = useState<TicketTypeForm[]>([]);

  // Load event data and categories
  useEffect(() => {
    if (!selectedEventId) return;
    setLoading(true);
    Promise.all([
      apiFetch<{
        event: {
          title: string;
          description: string;
          shortDescription: string | null;
          coverImage: string | null;
          startDate: string;
          endDate: string | null;
          startTime: string | null;
          endTime: string | null;
          timezone: string;
          venueId: string | null;
          venueName: string | null;
          venueAddress: string | null;
          venueCity: string | null;
          venueState: string | null;
          venueCountry: string | null;
          venueLat: number | null;
          venueLng: number | null;
          isVirtual: boolean;
          virtualUrl: string | null;
          isPaid: boolean;
          currency: string;
          capacity: number | null;
          status: string;
          categoryId: string | null;
          category: { id: string; name: string; slug: string } | null;
          tags: { tag: { name: string } }[];
          ticketTypes: {
            id: string;
            name: string;
            price: number;
            quantity: number;
            soldCount: number;
          }[];
        };
      }>(`/api/events/${selectedEventId}`),
      apiFetch<{ categories: Category[] }>('/api/categories'),
      apiFetch<{ venues: VenueOption[] }>('/api/organizer/venues').catch(() => ({ venues: [] })),
    ])
      .then(([eventData, catData, venueData]) => {
        const e = eventData.event;
        if (venueData?.venues) setVenues(venueData.venues);
        setForm({
          title: e.title,
          description: e.description,
          shortDescription: e.shortDescription || '',
          categoryId: e.category?.id || '',
          coverImage: e.coverImage || '',
          startDate: e.startDate ? new Date(e.startDate).toISOString().split('T')[0] : '',
          endDate: e.endDate ? new Date(e.endDate).toISOString().split('T')[0] : '',
          startTime: e.startTime || '',
          endTime: e.endTime || '',
          timezone: e.timezone || 'UTC',
          venueId: e.venueId || '',
          venueName: e.venueName || '',
          venueAddress: e.venueAddress || '',
          venueCity: e.venueCity || '',
          venueState: e.venueState || '',
          venueCountry: e.venueCountry || '',
          venueLat: e.venueLat != null ? String(e.venueLat) : '',
          venueLng: e.venueLng != null ? String(e.venueLng) : '',
          isVirtual: e.isVirtual,
          virtualUrl: e.virtualUrl || '',
          isPaid: e.isPaid,
          currency: e.currency || 'USD',
          capacity: e.capacity ? String(e.capacity) : '',
          tags: e.tags?.map((t: { tag: { name: string } }) => t.tag.name).join(', ') || '',
        });
        setEventStatus(e.status);
        setTicketTypes(
          e.ticketTypes.map((tt) => ({
            id: tt.id,
            name: tt.name,
            price: String(tt.price),
            quantity: String(tt.quantity),
          }))
        );
        setCategories(catData.categories || []);
      })
      .catch(() => toast.error('Failed to load event'))
      .finally(() => setLoading(false));
  }, [selectedEventId]);

  const updateForm = (key: string, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const addTicketType = () =>
    setTicketTypes((prev) => [
      ...prev,
      { name: '', price: '0', quantity: '50', isNew: true },
    ]);
  const removeTicketType = (i: number) => {
    const tt = ticketTypes[i];
    if (tt.isNew) {
      setTicketTypes((prev) => prev.filter((_, idx) => idx !== i));
    } else {
      // Mark existing for deletion
      setTicketTypes((prev) =>
        prev.map((t, idx) => (idx === i ? { ...t, toDelete: true } : t))
      );
    }
  };
  const restoreTicketType = (i: number) => {
    setTicketTypes((prev) =>
      prev.map((t, idx) => (idx === i ? { ...t, toDelete: false } : t))
    );
  };
  const updateTicketType = (i: number, key: keyof TicketTypeForm, value: string) => {
    setTicketTypes((prev) =>
      prev.map((t, idx) => (idx === i ? { ...t, [key]: value } : t))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.startDate) {
      toast.error('Please fill in required fields (title, date)');
      return;
    }
    if (form.isVirtual && !form.virtualUrl) {
      toast.error('Please provide a virtual event URL');
      return;
    }

    setSaving(true);
    try {
      // Build PATCH body (only send changed fields)
      const body: Record<string, unknown> = {
        title: form.title,
        description: form.description,
        shortDescription: form.shortDescription || undefined,
        coverImage: form.coverImage || undefined,
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
        categoryId: form.categoryId || undefined,
        tags: form.tags
          ? form.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
          : [],
      };

      await apiFetch(`/api/events/${selectedEventId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });

      // Handle ticket type changes
      // Delete marked ticket types
      for (const tt of ticketTypes.filter((t) => t.toDelete && t.id)) {
        await apiFetch(
          `/api/events/${selectedEventId}/ticket-types/${tt.id}`,
          { method: 'DELETE' }
        );
      }

      // Add new ticket types
      for (const tt of ticketTypes.filter((t) => t.isNew)) {
        await apiFetch(`/api/events/${selectedEventId}/ticket-types`, {
          method: 'POST',
          body: JSON.stringify({
            name: tt.name,
            price: parseFloat(tt.price) || 0,
            quantity: parseInt(tt.quantity) || 50,
            currency: form.currency,
          }),
        });
      }

      // Update existing ticket types (changed values)
      for (const tt of ticketTypes.filter((t) => t.id && !t.isNew && !t.toDelete)) {
        await apiFetch(
          `/api/events/${selectedEventId}/ticket-types/${tt.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              name: tt.name,
              price: parseFloat(tt.price),
              quantity: parseInt(tt.quantity),
            }),
          }
        );
      }

      toast.success('Event updated successfully!');
      navigate('organizer-events');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update event';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  // Status transition handlers
  const handleStatusChange = async (targetStatus: string) => {
    setStatusDialog({ open: false, target: '' });
    setSaving(true);
    try {
      await apiFetch(`/api/events/${selectedEventId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: targetStatus }),
      });
      setEventStatus(targetStatus);
      toast.success(`Event status changed to ${targetStatus}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to change status';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-3xl">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded-xl" />
        <div className="h-48 bg-muted animate-pulse rounded-xl" />
      </div>
    );
  }

  // Determine available status transitions based on current status
  const getStatusActions = () => {
    if (!user) return [];
    const actions: { target: string; label: string; icon: React.ReactNode; variant: string }[] = [];

    if (user.role === 'ORGANIZER' || user.role === 'SUPER_ADMIN') {
      if (eventStatus === 'DRAFT') {
        actions.push({
          target: 'PENDING',
          label: 'Submit for Review',
          icon: <Send className="h-4 w-4" />,
          variant: 'default',
        });
      }
      if (eventStatus === 'PENDING') {
        actions.push({
          target: 'DRAFT',
          label: 'Withdraw from Review',
          icon: <XCircle className="h-4 w-4" />,
          variant: 'outline',
        });
      }
      if (eventStatus === 'PUBLISHED') {
        actions.push({
          target: 'CANCELLED',
          label: 'Cancel Event',
          icon: <XCircle className="h-4 w-4" />,
          variant: 'destructive',
        });
      }
    }

    // SUPER_ADMIN can additionally publish and reject directly
    if (user.role === 'SUPER_ADMIN') {
      if (eventStatus === 'PENDING') {
        actions.push({
          target: 'PUBLISHED',
          label: 'Approve & Publish',
          icon: <Send className="h-4 w-4" />,
          variant: 'default',
        });
        actions.push({
          target: 'REJECTED',
          label: 'Reject Event',
          icon: <XCircle className="h-4 w-4" />,
          variant: 'destructive',
        });
      }
      if (eventStatus === 'DRAFT') {
        actions.push({
          target: 'PUBLISHED',
          label: 'Publish Directly',
          icon: <Send className="h-4 w-4" />,
          variant: 'default',
        });
      }
    }

    return actions;
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Edit Event</h1>
        <Badge className={STATUS_COLORS[eventStatus] || ''}>{eventStatus}</Badge>
      </div>

      {/* Status Workflow Actions */}
      {getStatusActions().length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Event Status</CardTitle>
            <CardDescription>Change the event status to control visibility</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {getStatusActions().map((action) => (
                <Button
                  key={action.target}
                  type="button"
                  variant={action.variant === 'destructive' ? 'destructive' : action.variant === 'default' ? 'default' : 'outline'}
                  className={action.variant === 'default' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                  onClick={() =>
                    setStatusDialog({ open: true, target: action.target })
                  }
                  disabled={saving}
                >
                  {action.icon}
                  <span className="ml-2">{action.label}</span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-emerald-500" /> Basic Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              placeholder="Event title"
              value={form.title}
              onChange={(e) => updateForm('title', e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="shortDesc">Short Description</Label>
            <Input
              id="shortDesc"
              placeholder="Brief summary (1-2 sentences)"
              value={form.shortDescription}
              onChange={(e) => updateForm('shortDescription', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="desc">Full Description</Label>
            <Textarea
              id="desc"
              placeholder="Detailed event description..."
              rows={5}
              value={form.description}
              onChange={(e) => updateForm('description', e.target.value)}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={form.categoryId}
                onValueChange={(v) => updateForm('categoryId', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="coverImg">Cover Image URL</Label>
              <Input
                id="coverImg"
                placeholder="https://..."
                value={form.coverImage}
                onChange={(e) => updateForm('coverImage', e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tags">Tags (comma-separated)</Label>
            <Input
              id="tags"
              placeholder="music, tech, networking"
              value={form.tags}
              onChange={(e) => updateForm('tags', e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Date & Time */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-teal-500" /> Date & Time
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date *</Label>
              <Input
                id="startDate"
                type="date"
                value={form.startDate}
                onChange={(e) => updateForm('startDate', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={form.endDate}
                onChange={(e) => updateForm('endDate', e.target.value)}
              />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startTime">Start Time</Label>
              <Input
                id="startTime"
                type="time"
                value={form.startTime}
                onChange={(e) => updateForm('startTime', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endTime">End Time</Label>
              <Input
                id="endTime"
                type="time"
                value={form.endTime}
                onChange={(e) => updateForm('endTime', e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Timezone</Label>
            <Select
              value={form.timezone}
              onValueChange={(v) => updateForm('timezone', v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
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
            {form.isVirtual ? (
              <Globe className="h-5 w-5 text-cyan-500" />
            ) : (
              <MapPin className="h-5 w-5 text-amber-500" />
            )}
            {form.isVirtual ? 'Virtual Event' : 'Venue'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              checked={form.isVirtual}
              onCheckedChange={(v) => updateForm('isVirtual', v)}
            />
            <Label>This is a virtual/online event</Label>
          </div>
          {form.isVirtual ? (
            <div className="space-y-2">
              <Label htmlFor="virtualUrl">Virtual Event URL *</Label>
              <Input
                id="virtualUrl"
                placeholder="https://zoom.us/..."
                value={form.virtualUrl}
                onChange={(e) => updateForm('virtualUrl', e.target.value)}
              />
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
                <div className="space-y-2">
                  <Label htmlFor="venueName">Venue Name</Label>
                  <Input
                    id="venueName"
                    placeholder="Convention Center"
                    value={form.venueName}
                    onChange={(e) => updateForm('venueName', e.target.value)}
                    disabled={!!form.venueId}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="venueAddr">Address</Label>
                  <Input
                    id="venueAddr"
                    placeholder="123 Main St"
                    value={form.venueAddress}
                    onChange={(e) => updateForm('venueAddress', e.target.value)}
                    disabled={!!form.venueId}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="venueCity">City</Label>
                  <Input
                    id="venueCity"
                    placeholder="New York"
                    value={form.venueCity}
                    onChange={(e) => updateForm('venueCity', e.target.value)}
                    disabled={!!form.venueId}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="venueState">State</Label>
                  <Input
                    id="venueState"
                    placeholder="NY"
                    value={form.venueState}
                    onChange={(e) => updateForm('venueState', e.target.value)}
                    disabled={!!form.venueId}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="venueCountry">Country</Label>
                  <Input
                    id="venueCountry"
                    placeholder="United States"
                    value={form.venueCountry}
                    onChange={(e) => updateForm('venueCountry', e.target.value)}
                    disabled={!!form.venueId}
                  />
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Ticketing */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-emerald-500" /> Ticketing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              checked={form.isPaid}
              onCheckedChange={(v) => updateForm('isPaid', v)}
            />
            <Label>This is a paid event</Label>
          </div>
          {form.isPaid && (
            <>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Select
                    value={form.currency}
                    onValueChange={(v) => updateForm('currency', v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD ($)</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="capacity">Total Capacity</Label>
                  <Input
                    id="capacity"
                    type="number"
                    placeholder="100"
                    value={form.capacity}
                    onChange={(e) => updateForm('capacity', e.target.value)}
                  />
                </div>
              </div>
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Ticket Types</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addTicketType}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Add Type
                  </Button>
                </div>
                {ticketTypes.map((tt, i) => (
                  <div
                    key={tt.id || i}
                    className={`grid grid-cols-[1fr_100px_100px_40px] gap-2 items-end ${tt.toDelete ? 'opacity-50' : ''}`}
                  >
                    <div className="space-y-1">
                      {i === 0 && <Label className="text-xs">Name</Label>}
                      <Input
                        placeholder="VIP, General..."
                        value={tt.name}
                        onChange={(e) => updateTicketType(i, 'name', e.target.value)}
                        disabled={tt.toDelete}
                      />
                    </div>
                    <div className="space-y-1">
                      {i === 0 && <Label className="text-xs">Price</Label>}
                      <Input
                        type="number"
                        placeholder="0"
                        value={tt.price}
                        onChange={(e) => updateTicketType(i, 'price', e.target.value)}
                        disabled={tt.toDelete}
                      />
                    </div>
                    <div className="space-y-1">
                      {i === 0 && <Label className="text-xs">Qty</Label>}
                      <Input
                        type="number"
                        placeholder="50"
                        value={tt.quantity}
                        onChange={(e) => updateTicketType(i, 'quantity', e.target.value)}
                        disabled={tt.toDelete}
                      />
                    </div>
                    {tt.toDelete ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-emerald-500"
                        onClick={() => restoreTicketType(i)}
                      >
                        <AlertTriangle className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-red-500"
                        onClick={() => removeTicketType(i)}
                        disabled={ticketTypes.filter((t) => !t.toDelete).length <= 1}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Manage Event Content */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-500" /> Manage Event Content
          </CardTitle>
          <CardDescription>Manage sessions, participants, and media for this event</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-3 gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-auto py-4 flex-col gap-2"
              onClick={() => navigate('organizer-event-content')}
            >
              <Calendar className="h-6 w-6 text-emerald-600" />
              <span className="font-medium">Program</span>
              <span className="text-xs text-muted-foreground">Sessions & Schedule</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-auto py-4 flex-col gap-2"
              onClick={() => navigate('organizer-event-content')}
            >
              <Users className="h-6 w-6 text-emerald-600" />
              <span className="font-medium">Participants</span>
              <span className="text-xs text-muted-foreground">Speakers & Artists</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-auto py-4 flex-col gap-2"
              onClick={() => navigate('organizer-event-content')}
            >
              <ImageIcon className="h-6 w-6 text-emerald-600" />
              <span className="font-medium">Media</span>
              <span className="text-xs text-muted-foreground">Images & Videos</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate('organizer-events')}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="bg-emerald-600 hover:bg-emerald-700"
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save Changes
        </Button>
      </div>

      {/* Status Change Confirmation Dialog */}
      <Dialog
        open={statusDialog.open}
        onOpenChange={(open) => setStatusDialog({ open, target: statusDialog.target })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Status Change</DialogTitle>
            <DialogDescription>
              Are you sure you want to change the event status from{' '}
              <Badge className={STATUS_COLORS[eventStatus]}>{eventStatus}</Badge> to{' '}
              <Badge className={STATUS_COLORS[statusDialog.target]}>
                {statusDialog.target}
              </Badge>
              ?
              {statusDialog.target === 'CANCELLED' &&
                ' This will make the event unavailable for booking.'}
              {statusDialog.target === 'PENDING' &&
                ' This will submit the event for admin review.'}
              {statusDialog.target === 'PUBLISHED' &&
                ' This will make the event publicly visible.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setStatusDialog({ open: false, target: '' })}
            >
              Cancel
            </Button>
            <Button
              className={
                statusDialog.target === 'CANCELLED' || statusDialog.target === 'REJECTED'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }
              onClick={() => handleStatusChange(statusDialog.target)}
              disabled={saving}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
