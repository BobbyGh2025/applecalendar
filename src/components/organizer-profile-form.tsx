'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/stores/app-store';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { Building2, Loader2 } from 'lucide-react';

export function OrganizerProfileForm() {
  const { user } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [form, setForm] = useState({
    organizationName: '',
    description: '',
    logo: '',
    coverImage: '',
    website: '',
    contactEmail: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    country: '',
    twitter: '',
    linkedin: '',
    instagram: '',
  });

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ profile: any }>('/api/organizer/profile');
      setProfile(data.profile);
      if (data.profile) {
        let socialLinks: Record<string, string> = {};
        try {
          socialLinks = JSON.parse(data.profile.socialLinks || '{}');
        } catch {}
        setForm({
          organizationName: data.profile.organizationName || '',
          description: data.profile.description || '',
          logo: data.profile.logo || '',
          coverImage: data.profile.coverImage || '',
          website: data.profile.website || '',
          contactEmail: data.profile.contactEmail || '',
          phone: data.profile.phone || '',
          address: data.profile.address || '',
          city: data.profile.city || '',
          state: data.profile.state || '',
          country: data.profile.country || '',
          twitter: socialLinks.twitter || '',
          linkedin: socialLinks.linkedin || '',
          instagram: socialLinks.instagram || '',
        });
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const socialLinks: Record<string, string> = {};
      if (form.twitter) socialLinks.twitter = form.twitter;
      if (form.linkedin) socialLinks.linkedin = form.linkedin;
      if (form.instagram) socialLinks.instagram = form.instagram;

      const body: Record<string, any> = {
        organizationName: form.organizationName,
        description: form.description,
        logo: form.logo,
        coverImage: form.coverImage,
        website: form.website,
        contactEmail: form.contactEmail,
        phone: form.phone,
        address: form.address,
        city: form.city,
        state: form.state,
        country: form.country,
        socialLinks,
      };

      const data = await apiFetch<{ profile: any }>('/api/organizer/profile', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setProfile(data.profile);
      toast.success('Organization profile saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Building2 className="h-6 w-6 text-emerald-600" />
        <h2 className="text-2xl font-bold">Organization Profile</h2>
      </div>

      {profile && profile.approvalStatus === 'PENDING' && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-4">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Your organization profile is pending approval. Some features may be limited until approved.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{profile ? 'Edit Organization' : 'Create Organization'}</CardTitle>
          <CardDescription>
            {profile ? 'Update your organization details' : 'Set up your organization to start creating events'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">Basic Information</h3>

              <div className="space-y-2">
                <Label htmlFor="org-name">Organization Name *</Label>
                <Input
                  id="org-name"
                  value={form.organizationName}
                  onChange={(e) => setForm({ ...form, organizationName: e.target.value })}
                  placeholder="Your organization name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="org-desc">Description</Label>
                <Textarea
                  id="org-desc"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Describe your organization"
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="org-logo">Logo URL</Label>
                  <Input
                    id="org-logo"
                    value={form.logo}
                    onChange={(e) => setForm({ ...form, logo: e.target.value })}
                    placeholder="https://example.com/logo.png"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-cover">Cover Image URL</Label>
                  <Input
                    id="org-cover"
                    value={form.coverImage}
                    onChange={(e) => setForm({ ...form, coverImage: e.target.value })}
                    placeholder="https://example.com/cover.jpg"
                  />
                </div>
              </div>
            </div>

            {/* Contact Info */}
            <div className="space-y-4">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">Contact Information</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="org-website">Website</Label>
                  <Input
                    id="org-website"
                    value={form.website}
                    onChange={(e) => setForm({ ...form, website: e.target.value })}
                    placeholder="https://your-org.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-email">Contact Email</Label>
                  <Input
                    id="org-email"
                    type="email"
                    value={form.contactEmail}
                    onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                    placeholder="contact@your-org.com"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="org-phone">Phone</Label>
                <Input
                  id="org-phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+1-555-000-0000"
                />
              </div>
            </div>

            {/* Address */}
            <div className="space-y-4">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">Address</h3>

              <div className="space-y-2">
                <Label htmlFor="org-address">Street Address</Label>
                <Input
                  id="org-address"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="123 Main St"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="org-city">City</Label>
                  <Input
                    id="org-city"
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    placeholder="New York"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-state">State</Label>
                  <Input
                    id="org-state"
                    value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                    placeholder="NY"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-country">Country</Label>
                  <Input
                    id="org-country"
                    value={form.country}
                    onChange={(e) => setForm({ ...form, country: e.target.value })}
                    placeholder="US"
                  />
                </div>
              </div>
            </div>

            {/* Social Links */}
            <div className="space-y-4">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">Social Links</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="org-twitter">Twitter</Label>
                  <Input
                    id="org-twitter"
                    value={form.twitter}
                    onChange={(e) => setForm({ ...form, twitter: e.target.value })}
                    placeholder="@handle"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-linkedin">LinkedIn</Label>
                  <Input
                    id="org-linkedin"
                    value={form.linkedin}
                    onChange={(e) => setForm({ ...form, linkedin: e.target.value })}
                    placeholder="company/name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-instagram">Instagram</Label>
                  <Input
                    id="org-instagram"
                    value={form.instagram}
                    onChange={(e) => setForm({ ...form, instagram: e.target.value })}
                    placeholder="@handle"
                  />
                </div>
              </div>
            </div>

            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {profile ? 'Save Changes' : 'Create Organization Profile'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
