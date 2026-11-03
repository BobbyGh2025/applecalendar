'use client';

import { useCallback, useEffect, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import { useAppStore } from '@/stores/app-store';

/**
 * Phase 6C: shared unread-notification count hook.
 *
 * - Fetches GET /api/notifications/unread-count whenever the user changes.
 * - Light 30s polling keeps the header badge fresh without websockets.
 * - Exposes refresh() so the notification centre can sync the badge
 *   immediately after mark-read / mark-all-read actions.
 *
 * The count lives in the app store so the header badge and any other
 * consumer share one value.
 */
export function useUnreadCount() {
  const user = useAppStore((s) => s.user);
  const setUnreadCount = useAppStore((s) => s.setUnreadCount);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!useAppStore.getState().user) return;
    try {
      const data = await apiFetch<{ count: number }>(
        '/api/notifications/unread-count'
      );
      useAppStore.getState().setUnreadCount(data.count ?? 0);
    } catch {
      // Badge is non-critical — silent failure keeps polling alive
    }
  }, []);

  useEffect(() => {
    setUnreadCount(0);
    if (!user) {
      return;
    }

    void refresh();
    timerRef.current = setInterval(() => void refresh(), 30_000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [user, refresh, setUnreadCount]);

  return { refresh };
}
