import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { registerDeviceToken } from '@/api/client';

function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[key]) {
    return process.env[key];
  }
  return undefined;
}

function readConfig() {
  const apiKey = readEnv('VITE_FIREBASE_API_KEY') || readEnv('NEXT_PUBLIC_FIREBASE_API_KEY');
  const projectId = readEnv('VITE_FIREBASE_PROJECT_ID') || readEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID');
  const messagingSenderId =
    readEnv('VITE_FIREBASE_MESSAGING_SENDER_ID') || readEnv('NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID');
  const appId = readEnv('VITE_FIREBASE_APP_ID') || readEnv('NEXT_PUBLIC_FIREBASE_APP_ID');

  if (!apiKey || !projectId || !messagingSenderId || !appId) {
    return null;
  }

  return { apiKey, projectId, messagingSenderId, appId };
}

export async function registerDriverPushNotifications(authToken: string): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return;
  }

  const firebaseConfig = readConfig();
  const vapidKey = readEnv('VITE_FCM_VAPID_KEY') || readEnv('NEXT_PUBLIC_FCM_VAPID_KEY');
  if (!firebaseConfig || !vapidKey || !(await isSupported())) {
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return;
  }

  const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
  const messaging = getMessaging(app);
  const fcmToken = await getToken(messaging, { vapidKey });

  if (fcmToken) {
    await registerDeviceToken(authToken, fcmToken, 'ANDROID_FCM');
  }
}
