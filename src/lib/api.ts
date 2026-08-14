import { useAppStore } from '@/stores/app-store';

let globalController: AbortController | null = null;

/** Create a new AbortController and abort the previous one */
export function createRequestController(): AbortController {
  if (globalController) globalController.abort();
  globalController = new AbortController();
  return globalController;
}

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const store = useAppStore.getState();
  const token = store.token;
  const res = await fetch(url, {
    ...options,
    signal: options?.signal ?? globalController?.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
  });

  if (res.status === 401) {
    useAppStore.getState().clearAuth();
    useAppStore.getState().navigate('login');
    throw new Error('Session expired. Please log in again.');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data as T;
}
