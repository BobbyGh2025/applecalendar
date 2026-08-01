import { useAppStore } from '@/stores/app-store';

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const token = useAppStore.getState().token;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data as T;
}
