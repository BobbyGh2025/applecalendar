'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/stores/app-store';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import {
  User,
  Lock,
  Monitor,
  Save,
  Eye,
  EyeOff,
  Shield,
  Smartphone,
  Globe,
  Clock,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Mail,
  Building2,
  MapPin,
  Phone,
  Link2,
} from 'lucide-react';
import { toast } from 'sonner';
import { EmailVerificationBanner } from '@/components/email-verification-view';

// ─── Types ───

interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  phone: string | null;
  bio: string | null;
  role: string;
  isActive: boolean;
  emailVerified: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OrganizerProfile {
  id: string;
  userId: string;
  organizationName: string;
  slug: string;
  description: string | null;
  website: string | null;
  contactEmail: string;
  contactPhone: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  businessAddress: string | null;
  businessCity: string | null;
  businessState: string | null;
  businessCountry: string;
  socialLinks: string;
  verificationStatus: string;
  verifiedAt: string | null;
  isFeatured: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SessionInfo {
  id: string;
  createdAt: string;
  lastActivityAt: string;
  userAgent: string | null;
  ipAddress: string | null;
  isCurrent: boolean;
}

// ─── Helpers ───

function parseUserAgent(ua: string | null): { device: string; browser: string } {
  if (!ua) return { device: 'Unknown device', browser: 'Unknown browser' };

  let device = 'Desktop';
  if (/iPhone|iPad/.test(ua)) device = 'iOS';
  else if (/Android/.test(ua)) device = 'Android';
  else if (/Mobile|Windows Phone/.test(ua)) device = 'Mobile';

  let browser = 'Unknown';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'Safari';

  return { device, browser };
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ─── Profile Tab ───

function ProfileTab() {
  const { user, setAuth } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [avatar, setAvatar] = useState(user?.avatar ?? '');
  const [saved, setSaved] = useState(false);
  const [emailVerified, setEmailVerified] = useState<string | null>(null);

  // Fetch fresh email verification status
  useEffect(() => {
    apiFetch<{ success: boolean; user: UserProfile }>('/api/users/me')
      .then((data) => {
        if (data.success && data.user) {
          setEmailVerified(data.user.emailVerified);
        }
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setLoading(true);
    setSaved(false);
    try {
      const data = await apiFetch<{ success: boolean; user: UserProfile }>('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name: name || undefined,
          phone: phone || null,
          bio: bio || null,
          avatar: avatar || null,
        }),
      });

      if (data.success && data.user) {
        // Update the store user
        const currentToken = useAppStore.getState().token;
        const currentRefreshToken = useAppStore.getState().refreshToken;
        if (currentToken) {
          setAuth(
            {
              id: data.user.id,
              email: data.user.email,
              name: data.user.name,
              role: data.user.role as 'SUPER_ADMIN' | 'ORGANIZER' | 'STAFF' | 'PUBLIC',
              avatar: data.user.avatar,
              bio: data.user.bio,
              phone: data.user.phone,
            },
            currentToken,
            currentRefreshToken ?? undefined,
          );
        }
        setSaved(true);
        toast.success('Profile updated successfully');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Avatar & Name Header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <Avatar className="h-20 w-20">
              <AvatarImage src={avatar || undefined} alt={name} />
              <AvatarFallback className="bg-emerald-600 text-white text-2xl font-semibold">
                {name?.charAt(0).toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h3 className="text-lg font-semibold">{user?.name}</h3>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="text-xs">{user?.role}</Badge>
                {user?.role !== 'PUBLIC' && (
                  <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300">
                    <Shield className="h-3 w-3 mr-1" />
                    Verified Role
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Edit Profile</CardTitle>
          <CardDescription>Update your personal information. Email changes require verification.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Display Name</Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => { setName(e.target.value); setSaved(false); }}
                placeholder="Your name"
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-phone">Phone Number</Label>
              <Input
                id="profile-phone"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setSaved(false); }}
                placeholder="+1 (555) 000-0000"
                maxLength={30}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-avatar">Avatar URL</Label>
            <Input
              id="profile-avatar"
              value={avatar}
              onChange={(e) => { setAvatar(e.target.value); setSaved(false); }}
              placeholder="https://example.com/avatar.jpg"
              maxLength={500}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-bio">Bio</Label>
            <Textarea
              id="profile-bio"
              value={bio}
              onChange={(e) => { setBio(e.target.value); setSaved(false); }}
              placeholder="Tell us about yourself..."
              maxLength={500}
              rows={3}
            />
            <p className="text-xs text-muted-foreground text-right">{bio.length}/500</p>
          </div>

          <div className="flex items-center justify-end gap-3">
            {saved && (
              <span className="text-sm text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" /> Saved
              </span>
            )}
            <Button onClick={handleSave} disabled={loading} className="bg-emerald-600 hover:bg-emerald-700">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Account Info (read-only) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account Information</CardTitle>
          <CardDescription>Read-only account details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Email</span>
            <div className="flex items-center gap-2">
              <span className="font-medium">{user?.email}</span>
              <EmailVerificationBanner emailVerified={emailVerified} />
            </div>
          </div>
          <Separator />
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Role</span>
            <Badge variant="secondary">{user?.role}</Badge>
          </div>
          <Separator />
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Account Status</span>
            <Badge variant={user?.role ? 'default' : 'destructive'} className="bg-emerald-600">
              Active
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Password Tab ───

function PasswordTab() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  // Password strength indicators
  const hasMinLength = newPassword.length >= 8;
  const hasUppercase = /[A-Z]/.test(newPassword);
  const hasLowercase = /[a-z]/.test(newPassword);
  const hasNumber = /\d/.test(newPassword);
  const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);
  const passwordsMatch = newPassword === confirmPassword && newPassword.length > 0;
  const isFormValid = hasMinLength && hasUppercase && hasLowercase && hasNumber && hasSpecial && passwordsMatch && currentPassword.length > 0;

  const strengthCount = [hasMinLength, hasUppercase, hasLowercase, hasNumber, hasSpecial].filter(Boolean).length;
  const strengthLabel = strengthCount <= 2 ? 'Weak' : strengthCount <= 4 ? 'Fair' : 'Strong';
  const strengthColor = strengthCount <= 2 ? 'text-red-500' : strengthCount <= 4 ? 'text-amber-500' : 'text-emerald-500';

  const handleSubmit = async () => {
    if (!isFormValid) return;
    setLoading(true);
    try {
      const data = await apiFetch<{ success: boolean; message: string; sessionsRevoked: number }>(
        '/api/users/me/password',
        {
          method: 'PATCH',
          body: JSON.stringify({ currentPassword, newPassword }),
        },
      );

      if (data.success) {
        toast.success(data.message, {
          description: data.sessionsRevoked > 0
            ? `${data.sessionsRevoked} other session(s) have been revoked for security.`
            : undefined,
        });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change Password</CardTitle>
          <CardDescription>
            After changing your password, all other active sessions will be revoked for security.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current Password */}
          <div className="space-y-2">
            <Label htmlFor="current-password">Current Password</Label>
            <div className="relative">
              <Input
                id="current-password"
                type={showCurrent ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter your current password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <Separator />

          {/* New Password */}
          <div className="space-y-2">
            <Label htmlFor="new-password">New Password</Label>
            <div className="relative">
              <Input
                id="new-password"
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter a strong password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {/* Strength Indicator */}
            {newPassword.length > 0 && (
              <div className="space-y-2">
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className={`h-1.5 flex-1 rounded-full transition-colors ${
                        i <= strengthCount
                          ? strengthCount <= 2 ? 'bg-red-500' : strengthCount <= 4 ? 'bg-amber-500' : 'bg-emerald-500'
                          : 'bg-muted'
                      }`}
                    />
                  ))}
                </div>
                <p className={`text-xs ${strengthColor}`}>{strengthLabel}</p>

                {/* Requirements */}
                <div className="grid grid-cols-1 gap-1 text-xs">
                  {[
                    { met: hasMinLength, label: 'At least 8 characters' },
                    { met: hasUppercase, label: 'One uppercase letter' },
                    { met: hasLowercase, label: 'One lowercase letter' },
                    { met: hasNumber, label: 'One number' },
                    { met: hasSpecial, label: 'One special character (!@#$...)' },
                  ].map(({ met, label }) => (
                    <div key={label} className={`flex items-center gap-1.5 ${met ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                      {met ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                      {label}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Confirm New Password */}
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm New Password</Label>
            <div className="relative">
              <Input
                id="confirm-password"
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter the new password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {confirmPassword.length > 0 && !passwordsMatch && (
              <p className="text-xs text-red-500">Passwords do not match</p>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSubmit}
              disabled={!isFormValid || loading}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Lock className="h-4 w-4 mr-2" />}
              Change Password
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Sessions Tab ───

function SessionsTab() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ success: boolean; sessions: SessionInfo[] }>('/api/users/me/sessions');
      if (data.success) {
        setSessions(data.sessions);
      }
    } catch {
      toast.error('Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const handleRevoke = async (sessionId: string) => {
    setRevoking(true);
    try {
      const data = await apiFetch<{ success: boolean; message: string }>(
        `/api/users/me/sessions/${sessionId}`,
        { method: 'DELETE' },
      );
      if (data.success) {
        toast.success('Session revoked');
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke session');
    } finally {
      setRevoking(false);
      setRevokeId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active Sessions</CardTitle>
          <CardDescription>
            Devices and browsers where you&apos;re currently logged in. You can revoke any session to sign out of that device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No active sessions found.</p>
          ) : (
            <div className="space-y-3">
              {sessions.map((session) => {
                const { device, browser } = parseUserAgent(session.userAgent);
                return (
                  <div
                    key={session.id}
                    className={`flex items-center gap-4 p-4 rounded-lg border ${
                      session.isCurrent ? 'border-emerald-300 bg-emerald-50/50' : 'border-border'
                    }`}
                  >
                    {/* Device Icon */}
                    <div className={`flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${
                      session.isCurrent ? 'bg-emerald-100 text-emerald-600' : 'bg-muted text-muted-foreground'
                    }`}>
                      {device === 'iOS' || device === 'Android' || device === 'Mobile'
                        ? <Smartphone className="h-5 w-5" />
                        : <Monitor className="h-5 w-5" />}
                    </div>

                    {/* Session Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">
                          {browser} on {device}
                        </p>
                        {session.isCurrent && (
                          <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300 bg-emerald-50">
                            Current
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        {session.ipAddress && (
                          <span className="flex items-center gap-1">
                            <Globe className="h-3 w-3" />
                            {session.ipAddress}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatRelativeTime(session.lastActivityAt)}
                        </span>
                        <span className="hidden sm:inline">
                          Created {formatDate(session.createdAt)}
                        </span>
                      </div>
                    </div>

                    {/* Revoke Button */}
                    {!session.isCurrent && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRevokeId(session.id)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 flex-shrink-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revoke Confirmation Dialog */}
      <AlertDialog open={revokeId !== null} onOpenChange={(open) => !open && setRevokeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will sign out the device associated with this session. They will need to log in again to access their account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeId && handleRevoke(revokeId)}
              disabled={revoking}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {revoking ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Revoke Session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Organization Tab ───

function OrganizationTab() {
  const { user, setAuth } = useAppStore();
  const [profile, setProfile] = useState<OrganizerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);

  // Form fields
  const [orgName, setOrgName] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [contactEmail, setContactEmail] = useState(user?.email ?? '');
  const [contactPhone, setContactPhone] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [businessCity, setBusinessCity] = useState('');
  const [businessState, setBusinessState] = useState('');
  const [businessCountry, setBusinessCountry] = useState('US');
  const [twitter, setTwitter] = useState('');
  const [instagram, setInstagram] = useState('');
  const [facebook, setFacebook] = useState('');
  const [linkedin, setLinkedin] = useState('');

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ profile: OrganizerProfile | null }>('/api/organizer/profile');
      if (data.profile) {
        setProfile(data.profile);
        populateForm(data.profile);
      }
    } catch {
      // Profile may not exist yet — that's fine
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  function populateForm(p: OrganizerProfile) {
    setOrgName(p.organizationName);
    setDescription(p.description ?? '');
    setWebsite(p.website ?? '');
    setContactEmail(p.contactEmail);
    setContactPhone(p.contactPhone ?? '');
    setLogoUrl(p.logoUrl ?? '');
    setCoverImageUrl(p.coverImageUrl ?? '');
    setBusinessAddress(p.businessAddress ?? '');
    setBusinessCity(p.businessCity ?? '');
    setBusinessState(p.businessState ?? '');
    setBusinessCountry(p.businessCountry);
    try {
      const links = JSON.parse(p.socialLinks || '{}');
      setTwitter(links.twitter ?? '');
      setInstagram(links.instagram ?? '');
      setFacebook(links.facebook ?? '');
      setLinkedin(links.linkedin ?? '');
    } catch {
      // ignore
    }
  }

  function getSocialLinksJson(): string {
    const links: Record<string, string> = {};
    if (twitter) links.twitter = twitter;
    if (instagram) links.instagram = instagram;
    if (facebook) links.facebook = facebook;
    if (linkedin) links.linkedin = linkedin;
    return JSON.stringify(links);
  }

  const handleCreate = async () => {
    if (!orgName.trim()) {
      toast.error('Organization name is required');
      return;
    }
    if (!contactEmail.trim()) {
      toast.error('Contact email is required');
      return;
    }
    setSaving(true);
    try {
      const data = await apiFetch<{ profile: OrganizerProfile; role: string }>('/api/organizer/profile', {
        method: 'POST',
        body: JSON.stringify({
          organizationName: orgName,
          description: description || null,
          website: website || null,
          contactEmail,
          contactPhone: contactPhone || null,
          logoUrl: logoUrl || null,
          coverImageUrl: coverImageUrl || null,
          businessAddress: businessAddress || null,
          businessCity: businessCity || null,
          businessState: businessState || null,
          businessCountry: businessCountry || 'US',
          socialLinks: getSocialLinksJson(),
        }),
      });
      if (data.profile) {
        setProfile(data.profile);
        // Upgrade user role in store
        const currentUser = useAppStore.getState().user;
        const currentToken = useAppStore.getState().token;
        const currentRefreshToken = useAppStore.getState().refreshToken;
        if (currentUser && currentToken) {
          setAuth(
            { ...currentUser, role: 'ORGANIZER' },
            currentToken,
            currentRefreshToken ?? undefined,
          );
        }
        toast.success('Organizer profile created! Your account has been upgraded.', {
          description: 'Your profile is pending verification.',
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create organizer profile');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!orgName.trim()) {
      toast.error('Organization name is required');
      return;
    }
    if (!contactEmail.trim()) {
      toast.error('Contact email is required');
      return;
    }
    setSaving(true);
    try {
      const data = await apiFetch<{ profile: OrganizerProfile }>('/api/organizer/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          organizationName: orgName,
          description: description || null,
          website: website || null,
          contactEmail,
          contactPhone: contactPhone || null,
          logoUrl: logoUrl || null,
          coverImageUrl: coverImageUrl || null,
          businessAddress: businessAddress || null,
          businessCity: businessCity || null,
          businessState: businessState || null,
          businessCountry: businessCountry || 'US',
          socialLinks: getSocialLinksJson(),
        }),
      });
      if (data.profile) {
        setProfile(data.profile);
        setEditMode(false);
        toast.success('Organizer profile updated');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update organizer profile');
    } finally {
      setSaving(false);
    }
  };

  // Verification status badge
  const VerificationBadge = ({ status }: { status: string }) => {
    switch (status) {
      case 'VERIFIED':
        return (
          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300">
            <CheckCircle2 className="h-3 w-3 mr-1" /> Verified
          </Badge>
        );
      case 'PENDING':
        return (
          <Badge className="bg-amber-100 text-amber-700 border-amber-300">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Pending Review
          </Badge>
        );
      case 'REJECTED':
        return (
          <Badge className="bg-red-100 text-red-700 border-red-300">
            <AlertCircle className="h-3 w-3 mr-1" /> Rejected
          </Badge>
        );
      default:
        return (
          <Badge className="bg-amber-100 text-amber-700 border-amber-300">
            <AlertCircle className="h-3 w-3 mr-1" /> Unverified
          </Badge>
        );
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  // ─── Has existing profile: show profile info ───
  if (profile) {
    return (
      <div className="space-y-6">
        {/* Profile Header */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 h-14 w-14 rounded-lg bg-emerald-100 flex items-center justify-center">
                <Building2 className="h-7 w-7 text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-lg font-semibold">{profile.organizationName}</h3>
                  <VerificationBadge status={profile.verificationStatus} />
                </div>
                <p className="text-sm text-muted-foreground mt-1">/{profile.slug}</p>
                {profile.verificationStatus === 'UNVERIFIED' && (
                  <p className="text-xs text-amber-600 mt-2">
                    Your organizer profile is unverified. You can create and manage events, but some features may be limited until verified.
                  </p>
                )}
                {profile.verificationStatus === 'PENDING' && (
                  <p className="text-xs text-amber-600 mt-2">
                    Your profile is under review. You&apos;ll be notified once verified.
                  </p>
                )}
                {profile.verificationStatus === 'REJECTED' && (
                  <p className="text-xs text-red-600 mt-2">
                    Your organizer profile was rejected. Please update your information and contact support if needed.
                  </p>
                )}
              </div>
              {!editMode && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setEditMode(true); populateForm(profile); }}
                  className="flex-shrink-0"
                >
                  Edit Profile
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {editMode ? (
          /* Edit Form */
          <OrganizerForm
            orgName={orgName} setOrgName={setOrgName}
            description={description} setDescription={setDescription}
            website={website} setWebsite={setWebsite}
            contactEmail={contactEmail} setContactEmail={setContactEmail}
            contactPhone={contactPhone} setContactPhone={setContactPhone}
            logoUrl={logoUrl} setLogoUrl={setLogoUrl}
            coverImageUrl={coverImageUrl} setCoverImageUrl={setCoverImageUrl}
            businessAddress={businessAddress} setBusinessAddress={setBusinessAddress}
            businessCity={businessCity} setBusinessCity={setBusinessCity}
            businessState={businessState} setBusinessState={setBusinessState}
            businessCountry={businessCountry} setBusinessCountry={setBusinessCountry}
            twitter={twitter} setTwitter={setTwitter}
            instagram={instagram} setInstagram={setInstagram}
            facebook={facebook} setFacebook={setFacebook}
            linkedin={linkedin} setLinkedin={setLinkedin}
            saving={saving}
            onSubmit={handleUpdate}
            onCancel={() => { setEditMode(false); populateForm(profile); }}
            submitLabel="Save Changes"
          />
        ) : (
          /* Read-only profile details */
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Organization Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {profile.description && (
                  <>
                    <div className="text-sm"><span className="text-muted-foreground">Description:</span>{' '}{profile.description}</div>
                    <Separator />
                  </>
                )}
                {profile.website && (
                  <>
                    <div className="flex items-center gap-2 text-sm">
                      <Globe className="h-4 w-4 text-muted-foreground" />
                      <a href={profile.website} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline">{profile.website}</a>
                    </div>
                    <Separator />
                  </>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span>{profile.contactEmail}</span>
                </div>
                {profile.contactPhone && (
                  <>
                    <Separator />
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span>{profile.contactPhone}</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {(profile.businessAddress || profile.businessCity || profile.businessState) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Business Address</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <span>
                      {[profile.businessAddress, profile.businessCity, profile.businessState, profile.businessCountry].filter(Boolean).join(', ')}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            {(() => {
              try {
                const links = JSON.parse(profile.socialLinks || '{}');
                const hasLinks = Object.keys(links).length > 0;
                if (!hasLinks) return null;
                return (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Social Links</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {links.twitter && <SocialLinkRow icon="Twitter" url={links.twitter} label={links.twitter} />}
                      {links.instagram && <SocialLinkRow icon="Instagram" url={links.instagram} label={links.instagram} />}
                      {links.facebook && <SocialLinkRow icon="Facebook" url={links.facebook} label={links.facebook} />}
                      {links.linkedin && <SocialLinkRow icon="LinkedIn" url={links.linkedin} label={links.linkedin} />}
                    </CardContent>
                  </Card>
                );
              } catch { return null; }
            })()}
          </>
        )}
      </div>
    );
  }

  // ─── SUPER_ADMIN without a profile ───
  if (user?.role === 'SUPER_ADMIN') {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <Shield className="h-12 w-12 mx-auto text-emerald-600 mb-4" />
              <h3 className="text-lg font-semibold">Super Admin Account</h3>
              <p className="text-muted-foreground mt-2 text-sm">
                As a Super Admin, you have full platform access. You can create an organizer profile if you also want to host events.
              </p>
              <Button
                onClick={() => setEditMode(true)}
                className="bg-emerald-600 hover:bg-emerald-700 mt-4"
              >
                <Building2 className="h-4 w-4 mr-2" /> Create Organizer Profile
              </Button>
            </div>
          </CardContent>
        </Card>
        {editMode && (
          <OrganizerForm
            orgName={orgName} setOrgName={setOrgName}
            description={description} setDescription={setDescription}
            website={website} setWebsite={setWebsite}
            contactEmail={contactEmail} setContactEmail={setContactEmail}
            contactPhone={contactPhone} setContactPhone={setContactPhone}
            logoUrl={logoUrl} setLogoUrl={setLogoUrl}
            coverImageUrl={coverImageUrl} setCoverImageUrl={setCoverImageUrl}
            businessAddress={businessAddress} setBusinessAddress={setBusinessAddress}
            businessCity={businessCity} setBusinessCity={setBusinessCity}
            businessState={businessState} setBusinessState={setBusinessState}
            businessCountry={businessCountry} setBusinessCountry={setBusinessCountry}
            twitter={twitter} setTwitter={setTwitter}
            instagram={instagram} setInstagram={setInstagram}
            facebook={facebook} setFacebook={setFacebook}
            linkedin={linkedin} setLinkedin={setLinkedin}
            saving={saving}
            onSubmit={handleCreate}
            onCancel={() => setEditMode(false)}
            submitLabel="Create Profile"
          />
        )}
      </div>
    );
  }

  // ─── Not yet an organizer: show Become an Organizer ───
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-6">
            <Building2 className="h-12 w-12 mx-auto text-emerald-600 mb-4" />
            <h3 className="text-lg font-semibold">Become an Organizer</h3>
            <p className="text-muted-foreground mt-2 text-sm max-w-md mx-auto">
              Create and manage events on AppleCalendar. Set up your organization profile to get started with hosting, ticketing, and analytics.
            </p>
          </div>
        </CardContent>
      </Card>

      <OrganizerForm
        orgName={orgName} setOrgName={setOrgName}
        description={description} setDescription={setDescription}
        website={website} setWebsite={setWebsite}
        contactEmail={contactEmail} setContactEmail={setContactEmail}
        contactPhone={contactPhone} setContactPhone={setContactPhone}
        logoUrl={logoUrl} setLogoUrl={setLogoUrl}
        coverImageUrl={coverImageUrl} setCoverImageUrl={setCoverImageUrl}
        businessAddress={businessAddress} setBusinessAddress={setBusinessAddress}
        businessCity={businessCity} setBusinessCity={setBusinessCity}
        businessState={businessState} setBusinessState={setBusinessState}
        businessCountry={businessCountry} setBusinessCountry={setBusinessCountry}
        twitter={twitter} setTwitter={setTwitter}
        instagram={instagram} setInstagram={setInstagram}
        facebook={facebook} setFacebook={setFacebook}
        linkedin={linkedin} setLinkedin={setLinkedin}
        saving={saving}
        onSubmit={handleCreate}
        onCancel={undefined}
        submitLabel="Become an Organizer"
      />
    </div>
  );
}

// ─── Organizer Form Component ───

function OrganizerForm({
  orgName, setOrgName,
  description, setDescription,
  website, setWebsite,
  contactEmail, setContactEmail,
  contactPhone, setContactPhone,
  logoUrl, setLogoUrl,
  coverImageUrl, setCoverImageUrl,
  businessAddress, setBusinessAddress,
  businessCity, setBusinessCity,
  businessState, setBusinessState,
  businessCountry, setBusinessCountry,
  twitter, setTwitter,
  instagram, setInstagram,
  facebook, setFacebook,
  linkedin, setLinkedin,
  saving,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  orgName: string; setOrgName: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  website: string; setWebsite: (v: string) => void;
  contactEmail: string; setContactEmail: (v: string) => void;
  contactPhone: string; setContactPhone: (v: string) => void;
  logoUrl: string; setLogoUrl: (v: string) => void;
  coverImageUrl: string; setCoverImageUrl: (v: string) => void;
  businessAddress: string; setBusinessAddress: (v: string) => void;
  businessCity: string; setBusinessCity: (v: string) => void;
  businessState: string; setBusinessState: (v: string) => void;
  businessCountry: string; setBusinessCountry: (v: string) => void;
  twitter: string; setTwitter: (v: string) => void;
  instagram: string; setInstagram: (v: string) => void;
  facebook: string; setFacebook: (v: string) => void;
  linkedin: string; setLinkedin: (v: string) => void;
  saving: boolean;
  onSubmit: () => void;
  onCancel: (() => void) | undefined;
  submitLabel: string;
}) {
  return (
    <>
      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organization Information</CardTitle>
          <CardDescription>Provide details about your organization.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Organization Name *</Label>
            <Input id="org-name" value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="Acme Events Inc." maxLength={200} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-desc">Description</Label>
            <Textarea id="org-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="Tell us about your organization..." maxLength={500} rows={3} />
            <p className="text-xs text-muted-foreground text-right">{description.length}/500</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-website">Website</Label>
            <Input id="org-website" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://example.com" maxLength={500} />
          </div>
        </CardContent>
      </Card>

      {/* Contact Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contact Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="org-contact-email">Contact Email *</Label>
              <Input id="org-contact-email" type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="contact@example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-contact-phone">Contact Phone</Label>
              <Input id="org-contact-phone" value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="+1 (555) 000-0000" maxLength={30} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Branding */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Branding</CardTitle>
          <CardDescription>Optional logo and cover image for your organization.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-logo">Logo URL</Label>
            <Input id="org-logo" value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://example.com/logo.png" maxLength={500} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-cover">Cover Image URL</Label>
            <Input id="org-cover" value={coverImageUrl} onChange={e => setCoverImageUrl(e.target.value)} placeholder="https://example.com/cover.jpg" maxLength={500} />
          </div>
        </CardContent>
      </Card>

      {/* Business Address */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Business Address</CardTitle>
          <CardDescription>Optional. Used for verification and billing.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-address">Street Address</Label>
            <Input id="org-address" value={businessAddress} onChange={e => setBusinessAddress(e.target.value)} placeholder="123 Main St" maxLength={200} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="org-city">City</Label>
              <Input id="org-city" value={businessCity} onChange={e => setBusinessCity(e.target.value)} placeholder="New York" maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-state">State</Label>
              <Input id="org-state" value={businessState} onChange={e => setBusinessState(e.target.value)} placeholder="NY" maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-country">Country</Label>
              <Input id="org-country" value={businessCountry} onChange={e => setBusinessCountry(e.target.value)} placeholder="US" maxLength={2} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Social Links */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Social Links</CardTitle>
          <CardDescription>Optional. Help people find your organization online.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="org-twitter">Twitter / X</Label>
              <Input id="org-twitter" value={twitter} onChange={e => setTwitter(e.target.value)} placeholder="@handle" maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-instagram">Instagram</Label>
              <Input id="org-instagram" value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="@handle" maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-facebook">Facebook</Label>
              <Input id="org-facebook" value={facebook} onChange={e => setFacebook(e.target.value)} placeholder="Page URL or name" maxLength={200} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-linkedin">LinkedIn</Label>
              <Input id="org-linkedin" value={linkedin} onChange={e => setLinkedin(e.target.value)} placeholder="Company page URL" maxLength={200} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        {onCancel && (
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
        )}
        <Button onClick={onSubmit} disabled={saving || !orgName.trim() || !contactEmail.trim()} className="bg-emerald-600 hover:bg-emerald-700">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Building2 className="h-4 w-4 mr-2" />}
          {submitLabel}
        </Button>
      </div>
    </>
  );
}

// ─── Social Link Row ───

function SocialLinkRow({ icon, url, label }: { icon: string; url: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Link2 className="h-4 w-4 text-muted-foreground" />
      <span className="text-muted-foreground mr-1">{icon}:</span>
      <a href={url.startsWith('http') ? url : `https://${url}`} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline">
        {label}
      </a>
    </div>
  );
}

// ─── Main Profile View ───

export function ProfileView({ defaultTab }: { defaultTab?: string }) {
  const { user, currentView } = useAppStore();
  // If navigated via 'organizer-profile' view, default to organization tab
  const initialTab = defaultTab ?? (currentView === 'organizer-profile' ? 'organization' : 'profile');

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Account Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your profile, security, and active sessions.</p>
      </div>

      <Tabs defaultValue={initialTab} className="w-full">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="profile" className="flex-1 sm:flex-initial gap-2">
            <User className="h-4 w-4" />
            <span className="hidden sm:inline">Profile</span>
          </TabsTrigger>
          <TabsTrigger value="password" className="flex-1 sm:flex-initial gap-2">
            <Lock className="h-4 w-4" />
            <span className="hidden sm:inline">Password</span>
          </TabsTrigger>
          <TabsTrigger value="sessions" className="flex-1 sm:flex-initial gap-2">
            <Monitor className="h-4 w-4" />
            <span className="hidden sm:inline">Sessions</span>
          </TabsTrigger>
          <TabsTrigger value="organization" className="flex-1 sm:flex-initial gap-2">
            <Building2 className="h-4 w-4" />
            <span className="hidden sm:inline">Organization</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-6">
          <ProfileTab />
        </TabsContent>
        <TabsContent value="password" className="mt-6">
          <PasswordTab />
        </TabsContent>
        <TabsContent value="sessions" className="mt-6">
          <SessionsTab />
        </TabsContent>
        <TabsContent value="organization" className="mt-6">
          <OrganizationTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
