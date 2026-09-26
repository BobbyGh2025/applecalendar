'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAppStore } from '@/stores/app-store';
import { apiFetch, ApiFetchError } from '@/lib/api';
import { toast } from 'sonner';
import {
  MapPin,
  Plus,
  Pencil,
  Trash2,
  Building2,
  Users,
  X,
  Check,
  Loader2,
  Globe,
  Mail,
  Phone,
} from 'lucide-react';

interface Venue {
  id: string;
  name: string;
  description: string | null;
  address: string;
  city: string;
  state: string | null;
  country: string;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  capacity: number | null;
  amenities: string[];
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  isPublic: boolean;
  isActive: boolean;
  _count: { events: number };
  createdAt: string;
}

interface VenueForm {
  name: string;
  description: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  lat: string;
  lng: string;
  capacity: string;
  amenities: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  website: string;
  isPublic: boolean;
}

const emptyForm: VenueForm = {
  name: '',
  description: '',
  address: '',
  city: '',
  state: '',
  country: 'GH',
  postalCode: '',
  lat: '',
  lng: '',
  capacity: '',
  amenities: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  website: '',
  isPublic: false,
};

function venueToForm(v: Venue): VenueForm {
  return {
    name: v.name,
    description: v.description || '',
    address: v.address,
    city: v.city,
    state: v.state || '',
    country: v.country || 'GH',
    postalCode: v.postalCode || '',
    lat: v.lat != null ? String(v.lat) : '',
    lng: v.lng != null ? String(v.lng) : '',
    capacity: v.capacity != null ? String(v.capacity) : '',
    amenities: v.amenities?.join(', ') || '',
    contactName: v.contactName || '',
    contactEmail: v.contactEmail || '',
    contactPhone: v.contactPhone || '',
    website: v.website || '',
    isPublic: v.isPublic,
  };
}

export function OrganizerVenues() {
  const { navigate } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [venues, setVenues] = useState<Venue[]>([]);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<VenueForm>(emptyForm);
  const [creating, setCreating] = useState(false);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<VenueForm>(emptyForm);
  const [editing, setEditing] = useState(false);

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteName, setDeleteName] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadVenues();
  }, []);

  const loadVenues = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ venues: Venue[] }>('/api/organizer/venues');
      setVenues(data.venues || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load venues');
    } finally {
      setLoading(false);
    }
  };

  const validateForm = (form: VenueForm): string | null => {
    if (!form.name.trim()) return 'Venue name is required';
    if (!form.address.trim()) return 'Address is required';
    if (!form.city.trim()) return 'City is required';
    if (form.capacity && (isNaN(Number(form.capacity)) || Number(form.capacity) < 0 || !Number.isInteger(Number(form.capacity))))
      return 'Capacity must be a positive integer';
    if (form.lat && isNaN(Number(form.lat))) return 'Latitude must be a number';
    if (form.lng && isNaN(Number(form.lng))) return 'Longitude must be a number';
    if (form.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail))
      return 'Invalid contact email';
    if (form.website && !/^https?:\/\/.+/.test(form.website))
      return 'Website must be a valid URL starting with http:// or https://';
    return null;
  };

  const buildBody = (form: VenueForm) => ({
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    address: form.address.trim(),
    city: form.city.trim(),
    state: form.state.trim() || undefined,
    country: form.country,
    postalCode: form.postalCode.trim() || undefined,
    lat: form.lat ? Number(form.lat) : undefined,
    lng: form.lng ? Number(form.lng) : undefined,
    capacity: form.capacity ? parseInt(form.capacity) : undefined,
    amenities: form.amenities.trim()
      ? form.amenities.split(',').map((a: string) => a.trim()).filter(Boolean)
      : [],
    contactName: form.contactName.trim() || undefined,
    contactEmail: form.contactEmail.trim() || undefined,
    contactPhone: form.contactPhone.trim() || undefined,
    website: form.website.trim() || undefined,
    isPublic: form.isPublic,
  });

  const handleCreate = async () => {
    const err = validateForm(createForm);
    if (err) { toast.error(err); return; }
    setCreating(true);
    try {
      await apiFetch('/api/organizer/venues', {
        method: 'POST',
        body: JSON.stringify(buildBody(createForm)),
      });
      toast.success('Venue created successfully');
      setCreateOpen(false);
      setCreateForm(emptyForm);
      loadVenues();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create venue');
    } finally {
      setCreating(false);
    }
  };

  const handleEdit = async () => {
    if (!editId) return;
    const err = validateForm(editForm);
    if (err) { toast.error(err); return; }
    setEditing(true);
    try {
      await apiFetch(`/api/organizer/venues/${editId}`, {
        method: 'PATCH',
        body: JSON.stringify(buildBody(editForm)),
      });
      toast.success('Venue updated successfully');
      setEditOpen(false);
      setEditId(null);
      loadVenues();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update venue');
    } finally {
      setEditing(false);
    }
  };

  const openEdit = async (venue: Venue) => {
    setEditId(venue.id);
    setEditForm(venueToForm(venue));
    setEditOpen(true);
  };

  const openDelete = (venue: Venue) => {
    setDeleteId(venue.id);
    setDeleteName(venue.name);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/organizer/venues/${deleteId}`, {
        method: 'DELETE',
      });
      toast.success('Venue deleted');
      setDeleteOpen(false);
      setDeleteId(null);
      loadVenues();
    } catch (err: any) {
      if (err instanceof ApiFetchError && err.code === 'VENUE_IN_USE') {
        toast.error('Cannot delete: this venue is assigned to one or more events. Remove it from events first.');
      } else {
        toast.error(err.message || 'Failed to delete venue');
      }
    } finally {
      setDeleting(false);
    }
  };

  const renderForm = (
    form: VenueForm,
    setForm: React.Dispatch<React.SetStateAction<VenueForm>>,
    onSubmit: () => void,
    submitLabel: string,
    submitting: boolean,
  ) => (
    <div className="space-y-4">
      {/* Name & City */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Name *</Label>
          <Input
            placeholder="Convention Center"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>City *</Label>
          <Input
            placeholder="Accra"
            value={form.city}
            onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
          />
        </div>
      </div>

      {/* Address */}
      <div className="space-y-2">
        <Label>Address *</Label>
        <Input
          placeholder="123 Main St"
          value={form.address}
          onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
        />
      </div>

      {/* State, Country, Postal Code */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>State / Region</Label>
          <Input
            placeholder="Greater Accra"
            value={form.state}
            onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Country</Label>
          <Select
            value={form.country}
            onValueChange={(v) => setForm((f) => ({ ...f, country: v }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GH">Ghana</SelectItem>
              <SelectItem value="NG">Nigeria</SelectItem>
              <SelectItem value="KE">Kenya</SelectItem>
              <SelectItem value="ZA">South Africa</SelectItem>
              <SelectItem value="US">United States</SelectItem>
              <SelectItem value="GB">United Kingdom</SelectItem>
              <SelectItem value="CA">Canada</SelectItem>
              <SelectItem value="DE">Germany</SelectItem>
              <SelectItem value="FR">France</SelectItem>
              <SelectItem value="AU">Australia</SelectItem>
              <SelectItem value="IN">India</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Postal Code</Label>
          <Input
            placeholder="GA-123"
            value={form.postalCode}
            onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
          />
        </div>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea
          placeholder="Brief description of the venue..."
          rows={3}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </div>

      {/* Capacity & Amenities */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Capacity</Label>
          <Input
            type="number"
            placeholder="500"
            value={form.capacity}
            onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Amenities (comma-separated)</Label>
          <Input
            placeholder="WiFi, Parking, AV Equipment"
            value={form.amenities}
            onChange={(e) => setForm((f) => ({ ...f, amenities: e.target.value }))}
          />
        </div>
      </div>

      {/* Lat / Lng */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Latitude</Label>
          <Input
            type="number"
            step="any"
            placeholder="5.6037"
            value={form.lat}
            onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Longitude</Label>
          <Input
            type="number"
            step="any"
            placeholder="-0.1870"
            value={form.lng}
            onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
          />
        </div>
      </div>

      {/* Contact Info */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Contact Name</Label>
          <Input
            placeholder="John Doe"
            value={form.contactName}
            onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Contact Email</Label>
          <Input
            type="email"
            placeholder="contact@venue.com"
            value={form.contactEmail}
            onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Contact Phone</Label>
          <Input
            placeholder="+233 123 456 789"
            value={form.contactPhone}
            onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
          />
        </div>
      </div>

      {/* Website & isPublic */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Website</Label>
          <Input
            placeholder="https://venue.example.com"
            value={form.website}
            onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
          />
        </div>
        <div className="flex items-center gap-3 pt-8">
          <Checkbox
            checked={form.isPublic}
            onCheckedChange={(v) => setForm((f) => ({ ...f, isPublic: !!v }))}
          />
          <Label>Publicly visible</Label>
        </div>
      </div>

      <Button
        onClick={onSubmit}
        className="w-full bg-emerald-600 hover:bg-emerald-700"
        disabled={submitting}
      >
        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {submitLabel}
      </Button>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 className="h-6 w-6 text-emerald-600" />
          <h2 className="text-2xl font-bold">Venues</h2>
        </div>
        <Button
          className="bg-emerald-600 hover:bg-emerald-700"
          onClick={() => {
            setCreateForm(emptyForm);
            setCreateOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Venue
        </Button>
      </div>

      {/* Venue List */}
      <Card>
        <CardHeader>
          <CardTitle>Your Venues</CardTitle>
          <CardDescription>
            {venues.length} venue{venues.length !== 1 ? 's' : ''} registered
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {venues.map((venue) => (
              <div
                key={venue.id}
                className="flex items-center justify-between p-4 rounded-xl border bg-card"
              >
                <div className="flex items-start gap-4 min-w-0">
                  <div className="h-10 w-10 shrink-0 rounded-lg bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center">
                    <MapPin className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{venue.name}</p>
                    <p className="text-sm text-muted-foreground truncate">
                      {venue.city}{venue.state ? `, ${venue.state}` : ''}, {venue.country}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {venue.capacity != null && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Users className="h-3 w-3" />
                          {venue.capacity}
                        </Badge>
                      )}
                      <Badge
                        className={
                          venue.isActive
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                            : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200'
                        }
                      >
                        {venue.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {venue._count.events} event{venue._count.events !== 1 ? 's' : ''}
                      </Badge>
                      {venue.isPublic && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Globe className="h-3 w-3" />
                          Public
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 ml-4">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                    onClick={() => openEdit(venue)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                    onClick={() => openDelete(venue)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}

            {venues.length === 0 && (
              <div className="text-center py-12">
                <Building2 className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground">No venues yet</p>
                <p className="text-sm text-muted-foreground/70">
                  Add your first venue to get started
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-emerald-600" />
              Add New Venue
            </DialogTitle>
            <DialogDescription>
              Fill in the details for your new venue.
            </DialogDescription>
          </DialogHeader>
          {renderForm(createForm, setCreateForm, handleCreate, 'Create Venue', creating)}
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-emerald-600" />
              Edit Venue
            </DialogTitle>
            <DialogDescription>
              Update the venue details below.
            </DialogDescription>
          </DialogHeader>
          {renderForm(editForm, setEditForm, handleEdit, 'Save Changes', editing)}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Venue</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteName}&rdquo;? This action cannot be
              undone. If the venue is assigned to events, the deletion will be blocked.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
