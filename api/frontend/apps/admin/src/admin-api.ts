import { ApiError, requestJson, requestWithBearer } from '@shared/api';
import type { AdminSessionSummary } from '@shared/types';

export const ADMIN_API_BASE = import.meta.env.VITE_ADMIN_API_BASE ?? '/admin';
const NGINX_SAFE_UPLOAD_BYTES = 900 * 1024;
const MAX_IMAGE_DIMENSION = 1600;
const MIN_IMAGE_DIMENSION = 720;
const JPEG_QUALITY_STEPS = [0.86, 0.78, 0.7, 0.62, 0.54];

export async function adminRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  return requestWithBearer<T>(`${ADMIN_API_BASE}${path}`, token, init);
}

export async function loginAdmin(
  username: string,
  password: string,
  totpCode?: string,
): Promise<AdminSessionSummary> {
  return requestJson<AdminSessionSummary>(`${ADMIN_API_BASE}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({
      username,
      password,
      totp_code: totpCode || null,
    }),
  });
}

export async function logoutAdmin(token: string): Promise<{ message: string }> {
  return adminRequest<{ message: string }>(token, '/auth/logout', {
    method: 'POST',
  });
}

export function isUnauthorizedError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 401;
}

function renameFileWithExtension(filename: string, nextExtension: string): string {
  const baseName = filename.replace(/\.[^.]+$/, '') || 'upload';
  return `${baseName}${nextExtension}`;
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Image preview failed to load.'));
      element.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function canvasToJpegFile(
  canvas: HTMLCanvasElement,
  filename: string,
  quality: number,
): Promise<File> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), 'image/jpeg', quality);
  });
  if (!blob) {
    throw new Error('Image compression failed.');
  }
  return new File([blob], renameFileWithExtension(filename, '.jpg'), {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

async function optimizeImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) {
    return file;
  }
  if (file.size <= NGINX_SAFE_UPLOAD_BYTES) {
    return file;
  }

  const image = await loadImageElement(file);
  let scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));

  while (scale > 0) {
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Image processing is unavailable in this browser.');
    }

    // JPEG does not preserve transparency, so flatten onto white.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    for (const quality of JPEG_QUALITY_STEPS) {
      const candidate = await canvasToJpegFile(canvas, file.name, quality);
      if (candidate.size <= NGINX_SAFE_UPLOAD_BYTES) {
        return candidate;
      }
    }

    const longestSide = Math.max(width, height);
    if (longestSide <= MIN_IMAGE_DIMENSION) {
      break;
    }
    scale *= 0.82;
  }

  throw new Error('Image is too large to upload. Please use a smaller image.');
}

export async function uploadAdminPhoto(
  token: string,
  file: File,
  oldPhotoUrl?: string | null,
): Promise<{ photo_url: string; filename: string }> {
  const preparedFile = await optimizeImageForUpload(file);
  const formData = new FormData();
  formData.append('file', preparedFile);
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
