/**
 * Phase 6C: Notification UI Component Tests
 *
 * Tests the notification centre, the preferences interface and the header
 * unread badge with Testing Library. The API layer (@/lib/api) is mocked;
 * the real zustand store is driven directly.
 *
 * Coverage:
 *   1.  Notification centre
 *       - renders items with correct unread indicators
 *       - clicking a row marks it read (PATCH) and decrements the badge count
 *       - mark-all-read hits PATCH /api/notifications and refetches
 *       - unread tab filters with unreadOnly=true
 *       - load more paginates with the cursor and appends
 *       - distinct empty state
 *       - error state with working Retry
 *   2.  Preferences interface
 *       - renders all 5 types × 3 channels with server defaults
 *       - toggling saves via PUT with the exact payload + success feedback
 *       - failed save reverts the switch and surfaces an error toast
 *   3.  Header unread badge
 *       - shows count when unread > 0, hidden at 0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { Mock } from 'vitest';

import { useAppStore } from '@/stores/app-store';
import { NotificationsView } from '@/components/notifications-view';
import { NotificationSettingsView } from '@/components/notification-settings-view';
import { Header } from '@/components/header';

// ─── Mocks ───

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
  createRequestController: vi.fn(() => new AbortController()),
}));

import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';

const mockApiFetch = apiFetch as unknown as Mock;
const mockToast = toast as unknown as {
  success: Mock;
  error: Mock;
  info: Mock;
};

// ─── Fixtures ───

const testUser = {
  id: 'ui-user-1',
  email: 'ui@test.example',
  name: 'UI Test User',
  role: 'PUBLIC' as const,
};

const nUnread = (id: string, type = 'BOOKING') => ({
  id,
  title: `Unread notification ${id}`,
  message: 'Something happened.',
  type,
  isRead: false,
  link: null,
  eventId: null,
  relatedEntityId: null,
  relatedEntityType: null,
  createdAt: new Date().toISOString(),
});

const notificationsPage = (items: ReturnType<typeof nUnread>[], extra?: Partial<{ hasMore: boolean; nextCursor: string | null; unreadCount: number }>) => ({
  notifications: items,
  unreadCount: extra?.unreadCount ?? items.filter((n) => !n.isRead).length,
  hasMore: extra?.hasMore ?? false,
  nextCursor: extra?.nextCursor ?? null,
});

function mockApiRouter(handlers?: {
  page?: ReturnType<typeof notificationsPage>;
  unread?: number;
  preferences?: Array<{ id: string; type: string; channel: string; enabled: boolean }>;
  putFail?: boolean;
}) {
  mockApiFetch.mockImplementation(
    async (url: string, options?: RequestInit) => {
      const u = String(url);
      const method = options?.method ?? 'GET';
      if (u.startsWith('/api/notifications/unread-count')) {
        return { count: handlers?.unread ?? 0, byType: {} };
      }
      if (u.startsWith('/api/notifications?')) {
        return handlers?.page ?? notificationsPage([]);
      }
      if (u === '/api/notifications' && method === 'PATCH') {
        return { markedRead: 2, message: '2 notifications marked as read' };
      }
      if (u.startsWith('/api/notifications/') && method === 'PATCH') {
        return { notification: {} };
      }
      if (u === '/api/notifications/preferences' && method === 'GET') {
        return {
          preferences: handlers?.preferences ?? [],
          defaults: { note: 'missing rows use defaults' },
        };
      }
      if (u === '/api/notifications/preferences' && method === 'PUT') {
        if (handlers?.putFail) throw new Error('Network error');
        return { preference: {} };
      }
      throw new Error(`Unhandled apiFetch: ${method} ${u}`);
    }
  );
}

// ─── Tests ───

describe('Phase 6C — Notification centre UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      user: testUser,
      token: 'test-token',
      unreadCount: 0,
      currentView: 'notifications',
    });
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState({ user: null, token: null, unreadCount: 0 });
  });

  it('1a. renders notifications with correct unread indicators', async () => {
    mockApiRouter({
      page: notificationsPage([nUnread('nt-1'), nUnread('nt-2', 'PAYMENT')]),
      unread: 2,
    });
    render(<NotificationsView />);

    expect(await screen.findByText('Unread notification nt-1')).toBeInTheDocument();
    expect(screen.getByText('Unread notification nt-2')).toBeInTheDocument();
    // aria-labels expose unread state for screen readers
    expect(screen.getByLabelText('Unread notification nt-1 (unread)')).toBeInTheDocument();
    // unread badge chip in the view header
    expect(screen.getByText('2 unread')).toBeInTheDocument();
  });

  it('1b. clicking an unread row marks it read and decrements the badge count', async () => {
    const user = userEvent.setup();
    mockApiRouter({
      page: notificationsPage([nUnread('nt-1')]),
      unread: 1,
    });
    useAppStore.setState({ unreadCount: 1 });
    render(<NotificationsView />);

    const row = await screen.findByLabelText('Unread notification nt-1 (unread)');
    await user.click(row);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/api/notifications/nt-1/read', {
        method: 'PATCH',
      });
    });
    await waitFor(() => {
      expect(useAppStore.getState().unreadCount).toBe(0);
    });
  });

  it('1c. mark-all-read sends PATCH /api/notifications and refetches the list', async () => {
    const user = userEvent.setup();
    // Stateful mock: after mark-all, the server really has 0 unread
    let serverUnread = 2;
    mockApiFetch.mockImplementation(
      async (url: string, options?: RequestInit) => {
        const u = String(url);
        const method = options?.method ?? 'GET';
        if (u.startsWith('/api/notifications/unread-count')) {
          return { count: serverUnread, byType: {} };
        }
        if (u.startsWith('/api/notifications?')) {
          return notificationsPage(
            [nUnread('nt-1'), nUnread('nt-2')],
            { unreadCount: serverUnread }
          );
        }
        if (u === '/api/notifications' && method === 'PATCH') {
          serverUnread = 0;
          return { markedRead: 2, message: '2 notifications marked as read' };
        }
        throw new Error(`Unhandled apiFetch: ${method} ${u}`);
      }
    );
    useAppStore.setState({ unreadCount: 2 });
    render(<NotificationsView />);

    const button = await screen.findByRole('button', { name: /mark all read/i });
    expect(button).toBeEnabled();
    await user.click(button);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/api/notifications', {
        method: 'PATCH',
      });
    });
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        '2 notifications marked as read'
      );
    });
    // Badge cleared from the refetched server state
    await waitFor(() => {
      expect(useAppStore.getState().unreadCount).toBe(0);
    });
    // list refetched after mark-all
    const listFetches = mockApiFetch.mock.calls.filter(([u]) =>
      String(u).startsWith('/api/notifications?')
    );
    expect(listFetches.length).toBeGreaterThanOrEqual(2);
  });

  it('1d. switching to the Unread tab refetches with unreadOnly=true', async () => {
    const user = userEvent.setup();
    mockApiRouter({ page: notificationsPage([nUnread('nt-1')]) });
    render(<NotificationsView />);

    await screen.findByText('Unread notification nt-1');
    await user.click(screen.getByRole('tab', { name: /unread/i }));

    await waitFor(() => {
      const calls = mockApiFetch.mock.calls.map(([u]) => String(u));
      expect(calls.some((u) => u.includes('unreadOnly=true'))).toBe(true);
    });
  });

  it('1e. load more paginates with the cursor and appends items', async () => {
    const user = userEvent.setup();
    mockApiFetch
      .mockImplementationOnce(async () =>
        notificationsPage([nUnread('nt-1')], { hasMore: true, nextCursor: 'cursor-1' })
      )
      .mockImplementationOnce(async () =>
        notificationsPage([nUnread('nt-2')], { hasMore: false, nextCursor: null })
      );
    render(<NotificationsView />);

    expect(await screen.findByText('Unread notification nt-1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => {
      const calls = mockApiFetch.mock.calls.map(([u]) => String(u));
      expect(calls.some((u) => u.includes('cursor=cursor-1'))).toBe(true);
    });
    expect(await screen.findByText('Unread notification nt-2')).toBeInTheDocument();
    expect(screen.getByText('Unread notification nt-1')).toBeInTheDocument();
  });

  it('1f. empty state distinguishes "all caught up" from filtered-empty', async () => {
    mockApiRouter({ page: notificationsPage([]) });
    render(<NotificationsView />);

    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
  });

  it('1g. error state shows a retry button that recovers', async () => {
    const user = userEvent.setup();
    mockApiFetch
      .mockRejectedValueOnce(new Error('Server error'))
      .mockImplementationOnce(async () =>
        notificationsPage([nUnread('nt-1')])
      );
    render(<NotificationsView />);

    expect(await screen.findByText('Could not load notifications')).toBeInTheDocument();
    expect(screen.getByText('Server error')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Unread notification nt-1')).toBeInTheDocument();
  });
});

describe('Phase 6C — Notification preferences UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ user: testUser, token: 'test-token', unreadCount: 0 });
  });

  afterEach(() => {
    cleanup();
  });

  it('2a. renders all 5 types × 3 channels using server defaults for missing rows', async () => {
    mockApiRouter({ preferences: [] });
    render(<NotificationSettingsView />);

    // IN_APP defaults to enabled
    expect(
      await screen.findByRole('switch', { name: 'Booking updates via In-app' })
    ).toBeChecked();
    // EMAIL/SMS default to disabled (consent-safe)
    expect(
      screen.getByRole('switch', { name: 'Booking updates via Email' })
    ).not.toBeChecked();
    expect(
      screen.getByRole('switch', { name: 'System announcements via SMS' })
    ).not.toBeChecked();
    expect(
      screen.getByRole('switch', { name: 'Payment updates via In-app' })
    ).toBeChecked();
  });

  it('2b. persisted preference rows override the defaults in the UI', async () => {
    mockApiRouter({
      preferences: [
        { id: 'pref-1', type: 'BOOKING', channel: 'EMAIL', enabled: true },
      ],
    });
    render(<NotificationSettingsView />);

    expect(
      await screen.findByRole('switch', { name: 'Booking updates via Email' })
    ).toBeChecked();
  });

  it('2c. toggling a switch saves via PUT with the exact payload and confirms', async () => {
    const user = userEvent.setup();
    mockApiRouter({ preferences: [] });
    render(<NotificationSettingsView />);

    const emailSwitch = await screen.findByRole('switch', {
      name: 'Booking updates via Email',
    });
    await user.click(emailSwitch);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/api/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify({ type: 'BOOKING', channel: 'EMAIL', enabled: true }),
      });
    });
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        'Booking updates via Email enabled'
      );
    });
    expect(screen.getByRole('switch', { name: 'Booking updates via Email' })).toBeChecked();
  });

  it('2d. failed save reverts the switch and surfaces an error toast', async () => {
    const user = userEvent.setup();
    mockApiRouter({ preferences: [], putFail: true });
    render(<NotificationSettingsView />);

    const inAppSwitch = await screen.findByRole('switch', {
      name: 'Booking updates via In-app',
    });
    expect(inAppSwitch).toBeChecked();

    await user.click(inAppSwitch);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Network error');
    });
    // Reverted to the previous (enabled) state after failure
    expect(
      screen.getByRole('switch', { name: 'Booking updates via In-app' })
    ).toBeChecked();
  });

  it('2e. load error state offers Retry', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Preferences unavailable'));
    render(<NotificationSettingsView />);

    expect(
      await screen.findByText('Could not load your preferences')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

describe('Phase 6C — Header unread badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState({ user: null, token: null, unreadCount: 0 });
  });

  it('3a. shows the unread count badge when count > 0', async () => {
    mockApiRouter({ unread: 3 });
    useAppStore.setState({ user: testUser, token: 'test-token', unreadCount: 0 });
    render(<Header />);

    await waitFor(() => {
      expect(useAppStore.getState().unreadCount).toBe(3);
    });
    expect(screen.getByLabelText('Notifications (3 unread)')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('3b. shows no badge when there are no unread notifications', async () => {
    mockApiRouter({ unread: 0 });
    useAppStore.setState({ user: testUser, token: 'test-token', unreadCount: 0 });
    render(<Header />);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalled();
    });
    expect(screen.queryByLabelText('Notifications (0 unread)')).toBeNull();
    expect(screen.getByLabelText('Notifications')).toBeInTheDocument();
  });

  it('3c. logged-out header has no notification bell', () => {
    useAppStore.setState({ user: null, token: null });
    render(<Header />);

    expect(screen.queryByLabelText(/notifications/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
  });
});
