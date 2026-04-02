export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : 'Request failed');
    this.status = status;
    this.detail = detail;
  }
}

async function parsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
}

export function extractErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return extractErrorMessage(error.detail);
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    const detail = (error as { detail?: unknown }).detail;
    const message = (error as { message?: unknown }).message;
    return extractErrorMessage(detail ?? message ?? 'Request failed');
  }

  return 'Request failed';
}

export function buildBasicAuthToken(username: string, password: string): string {
  return btoa(`${username}:${password}`);
}

export async function requestJson<T>(
  input: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  const payload = await parsePayload(response);
  if (!response.ok) {
    throw new ApiError(response.status, payload);
  }

  return payload as T;
}

export async function requestWithToken<T>(
  input: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  return requestJson<T>(input, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Basic ${token}`,
    },
  });
}

export async function requestWithBearer<T>(
  input: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  return requestJson<T>(input, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
}
