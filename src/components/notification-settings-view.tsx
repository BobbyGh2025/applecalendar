'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAppStore } from '@/stores/app-store';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import {
  Bell,
  CalendarDays,
  CreditCard,
  Info,
  Mail,
  MessageSquare,
  RotateCcw,
  Settings,
  Wallet,
} from 'lucide-react';

/**
 * Phase 6C Task 2: customer notification preferences interface.
 *
 * - View + toggle notification type × channel preferences.
 * - userId is NEVER sent — the API derives it from the authenticated
 *   session, so a user can only ever read/modify their own preferences.
 * - Missing type+channel rows fall back to the server defaults:
 *   IN_APP enabled, EMAIL/SMS disabled (consent-safe).
 * - Email/SMS channels are mock providers in this environment — the UI
 *   says so explicitly so users are not misled about real delivery.
 */

interface PreferenceRow {
  id: string;
  type: string;
  channel: string;
  enabled: boolean;
}

const NOTIFICATION_TYPES = [
  {
    value: 'BOOKING',
    label: 'Booking updates',
    description: 'Booking confirmations, reminders and status changes.',
    icon: CalendarDays,
  },
  {
    value: 'PAYMENT',
    label: 'Payment updates',
    description: 'Payment success, failures and receipts.',
    icon: CreditCard,
  },
  {
    value: 'REFUND',
    label: 'Refund updates',
    description: 'Refund progress and completion for cancelled events.',
    icon: Wallet,
  },
  {
    value: 'EVENT_UPDATE',
    label: 'Event updates',
    description: 'Schedule changes and cancellations for events you attend.',
    icon: Bell,
  },
  {
    value: 'SYSTEM',
    label: 'System announcements',
    description: 'Platform news and account security notices.',
    icon: Info,
  },
] as const;

const CHANNELS = [
  {
    value: 'IN_APP',
    label: 'In-app',
    hint: 'Shown in your notification bell. Always available.',
    icon: Bell,
  },
  {
    value: 'EMAIL',
    label: 'Email',
    hint: 'Sent to your account email. Mock provider — no real email is sent.',
    icon: Mail,
  },
  {
    value: 'SMS',
    label: 'SMS',
    hint: 'Sent to your phone number. Mock provider — no real SMS is sent.',
    icon: MessageSquare,
  },
] as const;

/** Server-side defaults for missing preference rows (must match dispatch fallback) */
const DEFAULT_ENABLED: Record<string, boolean> = {
  IN_APP: true,
  EMAIL: false,
  SMS: false,
};

const prefKey = (type: string, channel: string) => `${type}:${channel}`;

interface PreferencesResponse {
  preferences: PreferenceRow[];
}

export function NotificationSettingsView() {
  const navigate = useAppStore((s) => s.navigate);
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});

  const fetchPreferences = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<PreferencesResponse>(
        '/api/notifications/preferences'
      );
      const map: Record<string, boolean> = {};
      // Seed with server defaults, then overlay persisted rows
      for (const t of NOTIFICATION_TYPES) {
        for (const c of CHANNELS) {
          map[prefKey(t.value, c.value)] = DEFAULT_ENABLED[c.value];
        }
      }
      for (const row of data.preferences ?? []) {
        map[prefKey(row.type, row.channel)] = row.enabled;
      }
      setEnabledMap(map);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Failed to load preferences'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPreferences();
  }, [fetchPreferences]);

  const handleToggle = useCallback(
    async (type: string, channel: string, nextEnabled: boolean) => {
      const key = prefKey(type, channel);
      const previous = enabledMap[key];

      // Optimistic update
      setEnabledMap((prev) => ({ ...prev, [key]: nextEnabled }));
      setSavingKeys((prev) => ({ ...prev, [key]: true }));

      try {
        await apiFetch('/api/notifications/preferences', {
          method: 'PUT',
          body: JSON.stringify({ type, channel, enabled: nextEnabled }),
        });
        toast.success(
          nextEnabled
            ? `${typeToLabel(type)} via ${channelToLabel(channel)} enabled`
            : `${typeToLabel(type)} via ${channelToLabel(channel)} disabled`
        );
      } catch (error) {
        // Revert on failure
        setEnabledMap((prev) => ({ ...prev, [key]: previous }));
        toast.error(
          error instanceof Error
            ? error.message
            : 'Failed to save preference — please try again'
        );
      } finally {
        setSavingKeys((prev) => ({ ...prev, [key]: false }));
      }
    },
    [enabledMap]
  );

  const rows = useMemo(() => NOTIFICATION_TYPES, []);

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold">Notification Settings</h1>
          <p className="text-sm text-muted-foreground">
            Choose what you are notified about and how.
          </p>
        </header>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold">Notification Settings</h1>
        </header>
        <Alert variant="destructive">
          <Settings className="h-4 w-4" />
          <AlertTitle>Could not load your preferences</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => void fetchPreferences()}>
          <RotateCcw className="mr-2 h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Notification Settings</h1>
        <p className="text-sm text-muted-foreground">
          Choose what you are notified about and how. In-app notifications can
          be toggled per type; email and SMS stay off until you enable them.
        </p>
      </header>

      <Alert>
        <Settings className="h-4 w-4" />
        <AlertTitle>About delivery channels</AlertTitle>
        <AlertDescription>
          In-app notifications appear in your notification centre. Email and
          SMS use mock providers in this environment — enabling them records
          your consent but no real messages are sent. Disabling in-app for a
          type hides those notifications from your feed.
        </AlertDescription>
      </Alert>

      {/* Channel legend (desktop grid headers double as legend on mobile) */}
      <div className="grid gap-3 sm:grid-cols-3">
        {CHANNELS.map((c) => (
          <div
            key={c.value}
            className="flex items-start gap-3 rounded-lg border p-3"
          >
            <c.icon className="mt-0.5 h-4 w-4 text-emerald-600" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{c.label}</p>
              <p className="text-xs text-muted-foreground">{c.hint}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {rows.map((type) => (
          <Card key={type.value}>
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600 dark:bg-emerald-950">
                  <type.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">{type.label}</h2>
                  <p className="text-xs text-muted-foreground">
                    {type.description}
                  </p>
                </div>
              </div>

              <div
                className="mt-4 grid gap-4 border-t pt-4 sm:grid-cols-3"
                role="group"
                aria-label={`${type.label} channels`}
              >
                {CHANNELS.map((channel) => {
                  const key = prefKey(type.value, channel.value);
                  const isEnabled = enabledMap[key] ?? DEFAULT_ENABLED[channel.value];
                  const isSaving = savingKeys[key] ?? false;
                  const switchId = `pref-${type.value}-${channel.value}`;
                  return (
                    <div
                      key={channel.value}
                      className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 sm:flex-col sm:items-start sm:justify-start"
                    >
                      <div className="flex items-center gap-2 sm:flex-col sm:items-start sm:gap-1">
                        <Label
                          htmlFor={switchId}
                          className="text-sm font-medium"
                        >
                          {channel.label}
                        </Label>
                        <span className="text-xs text-muted-foreground sm:hidden">
                          {channel.hint}
                        </span>
                      </div>
                      <Switch
                        id={switchId}
                        checked={isEnabled}
                        disabled={isSaving}
                        onCheckedChange={(checked) =>
                          void handleToggle(type.value, channel.value, checked)
                        }
                        aria-label={`${type.label} via ${channel.label}`}
                      />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="outline" onClick={() => navigate('notifications')}>
          Back to notifications
        </Button>
      </div>
    </div>
  );
}

function typeToLabel(type: string): string {
  return NOTIFICATION_TYPES.find((t) => t.value === type)?.label ?? type;
}

function channelToLabel(channel: string): string {
  return CHANNELS.find((c) => c.value === channel)?.label ?? channel;
}
