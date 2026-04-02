import { ApiError, requestWithToken } from '@shared/api';

export const ADMIN_API_BASE = import.meta.env.VITE_ADMIN_API_BASE ?? '/admin';

export async function adminRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  return requestWithToken<T>(`${ADMIN_API_BASE}${path}`, token, init);
}

export function isUnauthorizedError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 401;
}

export async function uploadAdminPhoto(
  token: string,
  file: File,
  oldPhotoUrl?: string | null,
): Promise<{ photo_url: string; filename: string }> {
  const formData = new FormData();
  formData.append('file', file);
  if (oldPhotoUrl) {
    formData.append('old_photo_url', oldPhotoUrl);
  }

  return adminRequest(token, '/upload-photo', {
    method: 'POST',
    body: formData,
  });
}

export async function deleteAdminPhoto(token: string, photoUrl: string): Promise<{ message: string }> {
  return adminRequest(token, `/delete-photo?photo_url=${encodeURIComponent(photoUrl)}`, {
    method: 'DELETE',
  });
}

export function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth <= 1080;
}
