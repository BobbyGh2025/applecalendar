'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useAppStore } from '@/stores/app-store';
import { apiFetch, ApiFetchError } from '@/lib/api';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Pencil,
  Trash2,
  Clock,
  User,
  Image as ImageIcon,
  Video,
  FileText,
  Star,
  Loader2,
  AlertTriangle,
  Calendar,
  Music,
  Mic,
  Users,
  ArrowLeft,
  ListChecks,
  Play,
} from 'lucide-react';

// ─── Types ───

interface SessionParticipant {
  id: string;
  name: string;
  role: string;
  image: string | null;
}

interface Session {
  id: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  date: string | null;
  sortOrder: number;
  venueName: string | null;
  participantId: string | null;
  sessionType: string;
  status: string;
  participant: SessionParticipant | null;
}

interface Participant {
  id: string;
  name: string;
  bio: string | null;
  image: string | null;
  role: string;
  title: string | null;
  organization: string | null;
  socialLinks: string | null;
  email: string | null;
  sortOrder: number;
  isFeatured: boolean;
  _count?: { sessions: number };
}

interface Media {
  id: string;
  url: string;
  type: string;
  category: string;
  caption: string | null;
  sortOrder: number;
}

// ─── Constants ───

const SESSION_TYPES = ['SESSION', 'BREAK', 'REGISTRATION', 'KEYNOTE', 'PANEL', 'WORKSHOP', 'ENTERTAINMENT'] as const;
const SESSION_STATUSES = ['SCHEDULED', 'CANCELLED'] as const;
const PARTICIPANT_ROLES = ['SPEAKER', 'ARTIST', 'PERFORMER', 'MODERATOR', 'PANELIST', 'DJ', 'HOST', 'INSTRUCTOR'] as const;
const MEDIA_TYPES = ['IMAGE', 'VIDEO', 'DOCUMENT'] as const;
const MEDIA_CATEGORIES = ['POSTER', 'COVER', 'GALLERY', 'PROMOTIONAL_VIDEO', 'DOCUMENT', 'PROGRAM'] as const;

const SESSION_TYPE_COLORS: Record<string, string> = {
  SESSION: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  BREAK: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  REGISTRATION: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  KEYNOTE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  PANEL: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  WORKSHOP: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  ENTERTAINMENT: 'bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300',
};

const PARTICIPANT_ROLE_COLORS: Record<string, string> = {
  SPEAKER: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  ARTIST: 'bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300',
  PERFORMER: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  MODERATOR: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  PANELIST: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  DJ: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  HOST: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  INSTRUCTOR: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
};

const MEDIA_TYPE_COLORS: Record<string, string> = {
  IMAGE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  VIDEO: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  DOCUMENT: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};

// ─── Error Handling ───

function handleApiError(err: unknown) {
  if (err instanceof ApiFetchError && err.isEntitlementError) {
    if (err.code === 'PLAN_LIMIT_REACHED') {
      const details = err.details as { limitName?: string } | undefined;
      const limitName = details?.limitName || 'item';
      toast.error(`You've reached the ${limitName} limit for your plan. Upgrade to add more.`);
    } else if (['ORGANIZER_NOT_OPERABLE', 'ORGANIZER_SUSPENDED', 'ORGANIZER_DEACTIVATED'].includes(err.code)) {
      toast.error('Your organizer account is not active. Contact support.');
    } else {
      toast.error(err.message);
    }
  } else if (err instanceof Error) {
    toast.error(err.message);
  } else {
    toast.error('An unexpected error occurred');
  }
}

// ─── Main Component ───

export function OrganizerEventContent() {
  const { selectedEventId, goBack } = useAppStore();
  const [activeTab, setActiveTab] = useState('program');
  const [eventName, setEventName] = useState('');

  // Sessions state
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  // Participants state
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(true);

  // Media state
  const [media, setMedia] = useState<Media[]>([]);
  const [mediaLoading, setMediaLoading] = useState(true);

  // Dialogs
  const [sessionDialog, setSessionDialog] = useState<{ open: boolean; edit?: Session }>({ open: false });
  const [participantDialog, setParticipantDialog] = useState<{ open: boolean; edit?: Participant }>({ open: false });
  const [mediaDialog, setMediaDialog] = useState<{ open: boolean; edit?: Media }>({ open: false });
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; type: 'session' | 'participant' | 'media'; id: string; name: string }>({
    open: false, type: 'session', id: '', name: '',
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ─── Load Data ───

  const loadSessions = useCallback(async () => {
    if (!selectedEventId) return;
    setSessionsLoading(true);
    try {
      const data = await apiFetch<{ sessions: Session[] }>(`/api/events/${selectedEventId}/sessions`);
      setSessions(data.sessions);
    } catch (err) {
      handleApiError(err);
    } finally {
      setSessionsLoading(false);
    }
  }, [selectedEventId]);

  const loadParticipants = useCallback(async () => {
    if (!selectedEventId) return;
    setParticipantsLoading(true);
    try {
      const data = await apiFetch<{ participants: Participant[] }>(`/api/events/${selectedEventId}/participants`);
      setParticipants(data.participants);
    } catch (err) {
      handleApiError(err);
    } finally {
      setParticipantsLoading(false);
    }
  }, [selectedEventId]);

  const loadMedia = useCallback(async () => {
    if (!selectedEventId) return;
    setMediaLoading(true);
    try {
      const data = await apiFetch<{ media: Media[] }>(`/api/events/${selectedEventId}/media`);
      setMedia(data.media);
    } catch (err) {
      handleApiError(err);
    } finally {
      setMediaLoading(false);
    }
  }, [selectedEventId]);

  useEffect(() => {
    if (!selectedEventId) return;
    // Load event name
    apiFetch<{ event: { title: string } }>(`/api/events/${selectedEventId}`)
      .then(data => setEventName(data.event.title))
      .catch(() => {});
    loadSessions();
    loadParticipants();
    loadMedia();
  }, [selectedEventId, loadSessions, loadParticipants, loadMedia]);

  // ─── Session CRUD ───

  const [sessionForm, setSessionForm] = useState({
    title: '',
    description: '',
    startTime: '',
    endTime: '',
    date: '',
    sessionType: 'SESSION',
    venueName: '',
    participantId: 'none',
    sortOrder: '0',
    status: 'SCHEDULED',
  });

  const openSessionDialog = (edit?: Session) => {
    if (edit) {
      setSessionForm({
        title: edit.title,
        description: edit.description || '',
        startTime: edit.startTime,
        endTime: edit.endTime,
        date: edit.date ? new Date(edit.date).toISOString().split('T')[0] : '',
        sessionType: edit.sessionType,
        venueName: edit.venueName || '',
        participantId: edit.participantId || 'none',
        sortOrder: String(edit.sortOrder),
        status: edit.status,
      });
    } else {
      setSessionForm({
        title: '',
        description: '',
        startTime: '',
        endTime: '',
        date: '',
        sessionType: 'SESSION',
        venueName: '',
        participantId: 'none',
        sortOrder: '0',
        status: 'SCHEDULED',
      });
    }
    setSessionDialog({ open: true, edit });
  };

  const saveSession = async () => {
    if (!sessionForm.title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!sessionForm.startTime || !sessionForm.endTime) {
      toast.error('Start and end time are required');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        title: sessionForm.title,
        description: sessionForm.description || undefined,
        startTime: sessionForm.startTime,
        endTime: sessionForm.endTime,
        date: sessionForm.date || undefined,
        sessionType: sessionForm.sessionType,
        venueName: sessionForm.venueName || undefined,
        participantId: sessionForm.participantId === 'none' ? undefined : sessionForm.participantId,
        sortOrder: parseInt(sessionForm.sortOrder) || 0,
        status: sessionForm.status,
      };

      if (sessionDialog.edit) {
        await apiFetch(`/api/events/${selectedEventId}/sessions/${sessionDialog.edit.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        toast.success('Session updated');
      } else {
        await apiFetch(`/api/events/${selectedEventId}/sessions`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast.success('Session created');
      }
      setSessionDialog({ open: false });
      loadSessions();
    } catch (err) {
      handleApiError(err);
    } finally {
      setSaving(false);
    }
  };

  // ─── Participant CRUD ───

  const [participantForm, setParticipantForm] = useState({
    name: '',
    role: 'SPEAKER',
    bio: '',
    image: '',
    title: '',
    organization: '',
    socialLinks: '',
    email: '',
    sortOrder: '0',
    isFeatured: false,
  });

  const openParticipantDialog = (edit?: Participant) => {
    if (edit) {
      setParticipantForm({
        name: edit.name,
        role: edit.role,
        bio: edit.bio || '',
        image: edit.image || '',
        title: edit.title || '',
        organization: edit.organization || '',
        socialLinks: edit.socialLinks || '',
        email: edit.email || '',
        sortOrder: String(edit.sortOrder),
        isFeatured: edit.isFeatured,
      });
    } else {
      setParticipantForm({
        name: '',
        role: 'SPEAKER',
        bio: '',
        image: '',
        title: '',
        organization: '',
        socialLinks: '',
        email: '',
        sortOrder: '0',
        isFeatured: false,
      });
    }
    setParticipantDialog({ open: true, edit });
  };

  const saveParticipant = async () => {
    if (!participantForm.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: participantForm.name,
        role: participantForm.role,
        bio: participantForm.bio || undefined,
        image: participantForm.image || undefined,
        title: participantForm.title || undefined,
        organization: participantForm.organization || undefined,
        socialLinks: participantForm.socialLinks || undefined,
        email: participantForm.email || undefined,
        sortOrder: parseInt(participantForm.sortOrder) || 0,
        isFeatured: participantForm.isFeatured,
      };

      if (participantDialog.edit) {
        await apiFetch(`/api/events/${selectedEventId}/participants/${participantDialog.edit.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        toast.success('Participant updated');
      } else {
        await apiFetch(`/api/events/${selectedEventId}/participants`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast.success('Participant created');
      }
      setParticipantDialog({ open: false });
      loadParticipants();
    } catch (err) {
      handleApiError(err);
    } finally {
      setSaving(false);
    }
  };

  // ─── Media CRUD ───

  const [mediaForm, setMediaForm] = useState({
    url: '',
    type: 'IMAGE',
    category: 'GALLERY',
    caption: '',
    sortOrder: '0',
  });

  const openMediaDialog = (edit?: Media) => {
    if (edit) {
      setMediaForm({
        url: edit.url,
        type: edit.type,
        category: edit.category,
        caption: edit.caption || '',
        sortOrder: String(edit.sortOrder),
      });
    } else {
      setMediaForm({
        url: '',
        type: 'IMAGE',
        category: 'GALLERY',
        caption: '',
        sortOrder: '0',
      });
    }
    setMediaDialog({ open: true, edit });
  };

  const saveMedia = async () => {
    if (!mediaForm.url.trim()) {
      toast.error('URL is required');
      return;
    }
    try {
      new URL(mediaForm.url);
    } catch {
      toast.error('Please enter a valid URL');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        url: mediaForm.url,
        type: mediaForm.type,
        category: mediaForm.category,
        caption: mediaForm.caption || undefined,
        sortOrder: parseInt(mediaForm.sortOrder) || 0,
      };

      if (mediaDialog.edit) {
        await apiFetch(`/api/events/${selectedEventId}/media/${mediaDialog.edit.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        toast.success('Media updated');
      } else {
        await apiFetch(`/api/events/${selectedEventId}/media`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast.success('Media added');
      }
      setMediaDialog({ open: false });
      loadMedia();
    } catch (err) {
      handleApiError(err);
    } finally {
      setSaving(false);
    }
  };

  // ─── Delete Handler ───

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      const { type, id } = deleteDialog;
      if (type === 'session') {
        await apiFetch(`/api/events/${selectedEventId}/sessions/${id}`, { method: 'DELETE' });
        toast.success('Session deleted');
        loadSessions();
      } else if (type === 'participant') {
        await apiFetch(`/api/events/${selectedEventId}/participants/${id}`, { method: 'DELETE' });
        toast.success('Participant deleted');
        loadParticipants();
        loadSessions(); // sessions may have been detached
      } else {
        await apiFetch(`/api/events/${selectedEventId}/media/${id}`, { method: 'DELETE' });
        toast.success('Media deleted');
        loadMedia();
      }
      setDeleteDialog({ open: false, type: 'session', id: '', name: '' });
    } catch (err) {
      handleApiError(err);
    } finally {
      setDeleting(false);
    }
  };

  // ─── Render ───

  if (!selectedEventId) {
    return (
      <div className="text-center py-20">
        <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h2 className="text-xl font-semibold mb-2">No event selected</h2>
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
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={goBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-bold">Event Content</h1>
        {eventName && <p className="text-muted-foreground">{eventName}</p>}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="program" className="gap-2">
            <ListChecks className="h-4 w-4 hidden sm:inline-block" />
            Program
          </TabsTrigger>
          <TabsTrigger value="participants" className="gap-2">
            <Users className="h-4 w-4 hidden sm:inline-block" />
            Participants
          </TabsTrigger>
          <TabsTrigger value="media" className="gap-2">
            <ImageIcon className="h-4 w-4 hidden sm:inline-block" />
            Media
          </TabsTrigger>
        </TabsList>

        {/* ─── Program Tab ─── */}
        <TabsContent value="program" className="space-y-4 mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Calendar className="h-5 w-5 text-emerald-600" />
              Sessions ({sessions.length})
            </h2>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => openSessionDialog()}
            >
              <Plus className="mr-2 h-4 w-4" /> Add Session
            </Button>
          </div>

          {sessionsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Clock className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
                <p>No sessions yet. Add your first session to build the event program.</p>
              </CardContent>
            </Card>
          ) : (
            <AnimatePresence>
              <div className="space-y-3">
                {sessions.map((session) => (
                  <motion.div
                    key={session.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Card className="overflow-hidden">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1 flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-medium">{session.title}</h3>
                              <Badge className={SESSION_TYPE_COLORS[session.sessionType] || ''}>
                                {session.sessionType}
                              </Badge>
                              <Badge variant={session.status === 'SCHEDULED' ? 'outline' : 'destructive'} className="text-xs">
                                {session.status}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3.5 w-3.5" />
                                {session.startTime} - {session.endTime}
                              </span>
                              {session.date && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3.5 w-3.5" />
                                  {new Date(session.date).toLocaleDateString()}
                                </span>
                              )}
                              {session.venueName && (
                                <span>{session.venueName}</span>
                              )}
                            </div>
                            {session.participant && (
                              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                <User className="h-3.5 w-3.5" />
                                <span>{session.participant.name}</span>
                                <Badge variant="outline" className="text-xs py-0">
                                  {session.participant.role}
                                </Badge>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openSessionDialog(session)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                              onClick={() => setDeleteDialog({ open: true, type: 'session', id: session.id, name: session.title })}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </AnimatePresence>
          )}
        </TabsContent>

        {/* ─── Participants Tab ─── */}
        <TabsContent value="participants" className="space-y-4 mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Users className="h-5 w-5 text-emerald-600" />
              Participants ({participants.length})
            </h2>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => openParticipantDialog()}
            >
              <Plus className="mr-2 h-4 w-4" /> Add Participant
            </Button>
          </div>

          {participantsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-lg" />
              ))}
            </div>
          ) : participants.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <User className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
                <p>No participants yet. Add speakers, artists, and other participants.</p>
              </CardContent>
            </Card>
          ) : (
            <AnimatePresence>
              <div className="space-y-3">
                {participants.map((p) => (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Card className="overflow-hidden">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            {p.image ? (
                              <img src={p.image} alt={p.name} className="h-10 w-10 rounded-full object-cover shrink-0" />
                            ) : (
                              <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center shrink-0">
                                <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
                                  {p.name.charAt(0).toUpperCase()}
                                </span>
                              </div>
                            )}
                            <div className="space-y-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-medium">{p.name}</h3>
                                <Badge className={PARTICIPANT_ROLE_COLORS[p.role] || ''}>
                                  {p.role}
                                </Badge>
                                {p.isFeatured && (
                                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                                )}
                              </div>
                              {(p.title || p.organization) && (
                                <p className="text-sm text-muted-foreground">
                                  {[p.title, p.organization].filter(Boolean).join(' at ')}
                                </p>
                              )}
                              {p._count && p._count.sessions > 0 && (
                                <p className="text-xs text-muted-foreground">
                                  {p._count.sessions} session{p._count.sessions !== 1 ? 's' : ''}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openParticipantDialog(p)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                              onClick={() => setDeleteDialog({ open: true, type: 'participant', id: p.id, name: p.name })}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </AnimatePresence>
          )}
        </TabsContent>

        {/* ─── Media Tab ─── */}
        <TabsContent value="media" className="space-y-4 mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-emerald-600" />
              Media ({media.length})
            </h2>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => openMediaDialog()}
            >
              <Plus className="mr-2 h-4 w-4" /> Add Media
            </Button>
          </div>

          {mediaLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-40 w-full rounded-lg" />
              ))}
            </div>
          ) : media.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <ImageIcon className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
                <p>No media yet. Add images, videos, and documents.</p>
              </CardContent>
            </Card>
          ) : (
            <AnimatePresence>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {media.map((m) => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Card className="overflow-hidden group">
                      <div className="relative h-32 bg-muted flex items-center justify-center">
                        {m.type === 'IMAGE' ? (
                          <img src={m.url} alt={m.caption || 'Media'} className="w-full h-full object-cover" />
                        ) : m.type === 'VIDEO' ? (
                          <div className="relative w-full h-full bg-zinc-900 flex items-center justify-center">
                            <Video className="h-8 w-8 text-zinc-400" />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="h-10 w-10 rounded-full bg-white/20 flex items-center justify-center">
                                <Play className="h-5 w-5 text-white ml-0.5" />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <FileText className="h-8 w-8 text-muted-foreground" />
                        )}
                        {/* Hover overlay with actions */}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                          <Button
                            variant="secondary"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openMediaDialog(m)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="secondary"
                            size="icon"
                            className="h-8 w-8 text-red-500"
                            onClick={() => setDeleteDialog({ open: true, type: 'media', id: m.id, name: m.caption || m.url })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <CardContent className="p-2">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Badge className={`${MEDIA_TYPE_COLORS[m.type] || ''} text-xs`} >
                            {m.type}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {m.category}
                          </Badge>
                        </div>
                        {m.caption && (
                          <p className="text-xs text-muted-foreground truncate">{m.caption}</p>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </AnimatePresence>
          )}
        </TabsContent>
      </Tabs>

      {/* ─── Session Dialog ─── */}
      <Dialog open={sessionDialog.open} onOpenChange={(open) => setSessionDialog({ open })}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{sessionDialog.edit ? 'Edit Session' : 'Add Session'}</DialogTitle>
            <DialogDescription>
              {sessionDialog.edit ? 'Update session details.' : 'Add a new session to the event program.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input
                value={sessionForm.title}
                onChange={(e) => setSessionForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Session title"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={sessionForm.description}
                onChange={(e) => setSessionForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Session description"
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Time *</Label>
                <Input
                  type="time"
                  value={sessionForm.startTime}
                  onChange={(e) => setSessionForm(f => ({ ...f, startTime: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>End Time *</Label>
                <Input
                  type="time"
                  value={sessionForm.endTime}
                  onChange={(e) => setSessionForm(f => ({ ...f, endTime: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={sessionForm.date}
                  onChange={(e) => setSessionForm(f => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Session Type</Label>
                <Select value={sessionForm.sessionType} onValueChange={(v) => setSessionForm(f => ({ ...f, sessionType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SESSION_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Venue Name</Label>
                <Input
                  value={sessionForm.venueName}
                  onChange={(e) => setSessionForm(f => ({ ...f, venueName: e.target.value }))}
                  placeholder="e.g., Main Stage"
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={sessionForm.status} onValueChange={(v) => setSessionForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SESSION_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Assigned Participant</Label>
                <Select value={sessionForm.participantId} onValueChange={(v) => setSessionForm(f => ({ ...f, participantId: v }))}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {participants.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name} ({p.role})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  min="0"
                  value={sessionForm.sortOrder}
                  onChange={(e) => setSessionForm(f => ({ ...f, sortOrder: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSessionDialog({ open: false })}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={saveSession} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {sessionDialog.edit ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Participant Dialog ─── */}
      <Dialog open={participantDialog.open} onOpenChange={(open) => setParticipantDialog({ open })}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{participantDialog.edit ? 'Edit Participant' : 'Add Participant'}</DialogTitle>
            <DialogDescription>
              {participantDialog.edit ? 'Update participant details.' : 'Add a speaker, artist, or other participant.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input
                value={participantForm.name}
                onChange={(e) => setParticipantForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Full name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={participantForm.role} onValueChange={(v) => setParticipantForm(f => ({ ...f, role: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PARTICIPANT_ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  min="0"
                  value={participantForm.sortOrder}
                  onChange={(e) => setParticipantForm(f => ({ ...f, sortOrder: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Bio</Label>
              <Textarea
                value={participantForm.bio}
                onChange={(e) => setParticipantForm(f => ({ ...f, bio: e.target.value }))}
                placeholder="Short biography"
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Image URL</Label>
                <Input
                  value={participantForm.image}
                  onChange={(e) => setParticipantForm(f => ({ ...f, image: e.target.value }))}
                  placeholder="https://..."
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={participantForm.email}
                  onChange={(e) => setParticipantForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="email@example.com"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Job Title</Label>
                <Input
                  value={participantForm.title}
                  onChange={(e) => setParticipantForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g., CEO"
                />
              </div>
              <div className="space-y-2">
                <Label>Organization</Label>
                <Input
                  value={participantForm.organization}
                  onChange={(e) => setParticipantForm(f => ({ ...f, organization: e.target.value }))}
                  placeholder="e.g., Acme Inc."
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Social Links (JSON)</Label>
              <Textarea
                value={participantForm.socialLinks}
                onChange={(e) => setParticipantForm(f => ({ ...f, socialLinks: e.target.value }))}
                placeholder='{"twitter": "...", "linkedin": "..."}'
                rows={2}
                className="font-mono text-sm"
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={participantForm.isFeatured}
                onCheckedChange={(checked) => setParticipantForm(f => ({ ...f, isFeatured: checked }))}
              />
              <Label>Featured (headliner / keynote)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setParticipantDialog({ open: false })}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={saveParticipant} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {participantDialog.edit ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Media Dialog ─── */}
      <Dialog open={mediaDialog.open} onOpenChange={(open) => setMediaDialog({ open })}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{mediaDialog.edit ? 'Edit Media' : 'Add Media'}</DialogTitle>
            <DialogDescription>
              {mediaDialog.edit ? 'Update media details.' : 'Add an image, video, or document.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>URL *</Label>
              <Input
                value={mediaForm.url}
                onChange={(e) => setMediaForm(f => ({ ...f, url: e.target.value }))}
                placeholder="https://example.com/image.jpg"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={mediaForm.type} onValueChange={(v) => setMediaForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MEDIA_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={mediaForm.category} onValueChange={(v) => setMediaForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MEDIA_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Caption</Label>
              <Input
                value={mediaForm.caption}
                onChange={(e) => setMediaForm(f => ({ ...f, caption: e.target.value }))}
                placeholder="Image/video caption"
              />
            </div>
            <div className="space-y-2">
              <Label>Sort Order</Label>
              <Input
                type="number"
                min="0"
                value={mediaForm.sortOrder}
                onChange={(e) => setMediaForm(f => ({ ...f, sortOrder: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMediaDialog({ open: false })}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={saveMedia} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mediaDialog.edit ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Confirmation Dialog ─── */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ ...deleteDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Delete</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteDialog.name}&quot;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false, type: 'session', id: '', name: '' })}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
