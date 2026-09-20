import { useAppStore } from '@/stores/app-store';

let globalController: AbortController | null = null;

/** Create a new AbortController and abort the previous one */
export function createRequestController(): AbortController {
  if (globalController) globalController.abort();
  globalController = new AbortController();
  return globalController;
}

/**
 * Structured API error with machine-readable code and optional details.
 * Used for entitlement/subscription errors that the UI can handle specifically.
 */
export class ApiFetchError extends Error {
  code: string;
  details?: unknown;
  statusCode: number;

  constructor(message: string, code: string, statusCode: number, details?: unknown) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.name = 'ApiFetchError';
  }

  /** Check if this is an entitlement/subscription error */
  get isEntitlementError(): boolean {
    return [
      'ORGANIZER_SUSPENDED',
      'ORGANIZER_DEACTIVATED',
      'ORGANIZER_NOT_OPERABLE',
      'SUBSCRIPTION_REQUIRED',
      'SUBSCRIPTION_EXPIRED',
      'FEATURE_NOT_AVAILABLE',
      'PLAN_LIMIT_REACHED',
    ].includes(this.code);
  }
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
  if (!res.ok) {
    // Handle structured API error responses: { success: false, error: { code, message, details } }
    if (data?.error?.code && data?.error?.message) {
      throw new ApiFetchError(
        data.error.message,
        data.error.code,
        res.status,
        data.error.details,
      );
    }
    // Fallback for older error formats
    throw new Error(data.error || 'Request failed');
  }
  return data as T;
}
