/**
 * Notificación de avance durante la salida: una por km ("Km 3 · 17:05"), que reemplaza a la anterior
 * en la pantalla bloqueada y en el centro de notificaciones. Se borra al terminar.
 * (Una notificación que se actualice cada segundo, como las "Actividades en vivo", solo existe para apps nativas.)
 */

const TAG = 'fit20-live';
const KEY = 'fit20:km-notify';

export const kmNotifySupported = (): boolean => typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
export const kmNotifyPermission = (): NotificationPermission | 'unsupported' => (kmNotifySupported() ? Notification.permission : 'unsupported');

export function kmNotifyEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1' && kmNotifyPermission() === 'granted';
  } catch {
    return false;
  }
}

/** Activa (pidiendo permiso si hace falta; tiene que ser dentro de un toque) o desactiva. Devuelve el estado final. */
export async function setKmNotify(on: boolean): Promise<boolean> {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* nada */
  }
  if (!on || !kmNotifySupported()) return false;
  if (Notification.permission === 'default') await Notification.requestPermission();
  return Notification.permission === 'granted';
}

async function reg(): Promise<ServiceWorkerRegistration | null> {
  if (!kmNotifySupported()) return null;
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

export async function showProgress(title: string, body: string): Promise<boolean> {
  if (kmNotifyPermission() !== 'granted') return false;
  const r = await reg();
  if (!r) return false;
  try {
    await r.showNotification(title, {
      body,
      tag: TAG,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      silent: false,
      data: { url: '/running/en-curso' },
      ...({ renotify: true } as object), // que avise cada km aunque reemplace a la anterior
    });
    return true;
  } catch {
    return false;
  }
}

export async function clearProgress(): Promise<void> {
  const r = await reg();
  if (!r) return;
  try {
    (await r.getNotifications({ tag: TAG })).forEach((n) => n.close());
  } catch {
    /* nada */
  }
}
