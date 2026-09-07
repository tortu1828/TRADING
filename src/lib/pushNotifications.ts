import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import app from './firebase';

export interface PushNotificationPayload {
  title?: string;
  body: string;
  icon?: string;
  tag?: string;
  url?: string;
  data?: Record<string, any>;
}

// Memory & LocalStorage keys for Push Tokens
const PUSH_TOKEN_KEY = 'gestor_push_fcm_token';
const PUSH_PERMISSION_KEY = 'gestor_push_permission_status';

/**
 * Automatically requests notification permissions at startup or login.
 * If permission is 'default', it attempts immediately and sets a one-time interaction listener.
 */
export async function ensureAutoNotificationPermission(): Promise<void> {
  if (!isPushSupported()) return;

  if (Notification.permission === 'default') {
    // Try requesting immediately
    try {
      const res = await requestNotificationPermission();
      if (res.granted) return;
    } catch {
      // Browser may require user gesture
    }

    // Attach one-time interaction listener so the very first tap/click prompts the user
    const triggerOnGesture = async () => {
      window.removeEventListener('click', triggerOnGesture);
      window.removeEventListener('touchstart', triggerOnGesture);
      if (Notification.permission === 'default') {
        await requestNotificationPermission();
      }
    };

    window.addEventListener('click', triggerOnGesture, { once: true });
    window.addEventListener('touchstart', triggerOnGesture, { once: true });
  } else if (Notification.permission === 'granted') {
    // Re-verify service worker registration & messaging in background
    requestNotificationPermission().catch(() => {});
  }
}

/**
 * Checks if Native Browser Notifications are supported
 */
export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * Gets current notification permission state: 'granted' | 'denied' | 'default'
 */
export function getNotificationPermissionState(): NotificationPermission {
  if (!isPushSupported()) return 'denied';
  return Notification.permission;
}

/**
 * Requests notification permissions from the browser and initializes FCM Service Worker if supported
 */
export async function requestNotificationPermission(): Promise<{
  granted: boolean;
  token: string | null;
  error?: string;
}> {
  if (!isPushSupported()) {
    return {
      granted: false,
      token: null,
      error: 'Las notificaciones no son compatibles con este navegador.',
    };
  }

  try {
    const permission = await Notification.requestPermission();
    localStorage.setItem(PUSH_PERMISSION_KEY, permission);

    if (permission !== 'granted') {
      return {
        granted: false,
        token: null,
        error: 'Permiso de notificaciones denegado por el usuario.',
      };
    }

    // Register Service Worker for background push notifications
    let fcmToken: string | null = null;
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        console.log('[Push] Service Worker registrado exitosamente:', registration.scope);

        // Try getting Messaging instance
        const messagingSupported = await isSupported();
        if (messagingSupported) {
          const messaging = getMessaging(app);
          
          // Request FCM token (works when VAPID key is configured or with default senderId)
          try {
            fcmToken = await getToken(messaging, {
              serviceWorkerRegistration: registration,
            });
            if (fcmToken) {
              localStorage.setItem(PUSH_TOKEN_KEY, fcmToken);
              console.log('[Push] Token de FCM obtenido:', fcmToken);
            }
          } catch (tokenErr) {
            console.warn('[Push] FCM Token no generado (se usarán Web Notifications nativas):', tokenErr);
          }

          // Foreground messaging listener
          onMessage(messaging, (payload) => {
            console.log('[Push] Mensaje en primer plano:', payload);
            sendBrowserPushNotification(
              payload.notification?.title || payload.data?.title || 'Gestor de Capital',
              {
                body: payload.notification?.body || payload.data?.body || '',
                icon: '/favicon.png',
                data: payload.data,
              }
            );
          });
        }
      } catch (swErr) {
        console.warn('[Push] Error registrando Service Worker (fallback a notificaciones estándar):', swErr);
      }
    }

    return {
      granted: true,
      token: fcmToken,
    };
  } catch (err: any) {
    console.error('[Push] Error al solicitar permisos:', err);
    return {
      granted: false,
      token: null,
      error: err.message || 'Error al habilitar notificaciones.',
    };
  }
}

/**
 * Emits a native Browser Push Notification (with optional sound)
 */
export function sendBrowserPushNotification(title: string, options: PushNotificationPayload): boolean {
  if (!isPushSupported() || Notification.permission !== 'granted') {
    console.log('[Push] Notificación en pantalla (Permiso no otorgado):', title, options);
    return false;
  }

  try {
    const notifOptions: any = {
      body: options.body,
      icon: options.icon || '/favicon.png',
      badge: '/apple-touch-icon.png',
      tag: options.tag || `gestor_notif_${Date.now()}`,
      data: options.data || {},
      renotify: true,
    };

    const notif = new Notification(title, notifOptions as NotificationOptions);

    notif.onclick = () => {
      window.focus();
      if (options.url) {
        window.location.href = options.url;
      }
      notif.close();
    };

    // Play subtle audio chime if possible
    playNotificationAudio();

    return true;
  } catch (err) {
    console.error('[Push] Error enviando notificación nativa:', err);
    return false;
  }
}

/**
 * Plays a pleasant notification audio chime using Web Audio API
 */
function playNotificationAudio() {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5 note
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5 note

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // Audio context may be blocked by autoplay policies
  }
}

/**
 * Sends a Push Notification when a Monthly Cycle report is dispatched to a user
 */
export function notifyCycleClosureToUser(params: {
  userName: string;
  userProfitCop: number;
  totalUsdOperated: number;
  cycleName: string;
}): boolean {
  const formattedProfit = `$${params.userProfitCop.toLocaleString('es-CO')} COP`;
  const formattedUsd = `$${params.totalUsdOperated.toFixed(2)} USD`;

  const title = `📈 ¡Ganancias disponibles, ${params.userName}!`;
  const body = `Ciclo ${params.cycleName}: Operaste ${formattedUsd} y tu ganancia neta es de ${formattedProfit}. ¡Consulta el desglose en tu portal!`;

  return sendBrowserPushNotification(title, {
    body,
    icon: '/favicon.png',
    tag: `closure_${params.userName}_${params.cycleName}`,
    data: {
      type: 'MONTHLY_CLOSURE',
      cycleName: params.cycleName,
      profitCop: params.userProfitCop,
    },
  });
}

/**
 * Sends a Push Notification to Admins when an Investor Application is submitted
 */
export function notifyNewApplicationToAdmin(params: {
  applicantName: string;
  requestedCapitalCop: number;
  queuePosition: number;
}): boolean {
  const formattedCapital = `$${params.requestedCapitalCop.toLocaleString('es-CO')} COP`;
  const title = `📥 Nueva Solicitud de Ingreso (# Turno ${params.queuePosition})`;
  const body = `${params.applicantName} ha solicitado unirse con ${formattedCapital}. Revisa la lista de espera para aprobar o gestionar.`;

  return sendBrowserPushNotification(title, {
    body,
    icon: '/favicon.png',
    tag: `app_sub_${params.queuePosition}`,
    data: {
      type: 'INVESTMENT_REQUEST',
      queuePosition: params.queuePosition,
    },
  });
}

/**
 * Sends a Push Notification when an Investor Application is Approved or Rejected
 */
export function notifyApplicationStatusToUser(params: {
  applicantName: string;
  status: 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
}): boolean {
  if (params.status === 'APPROVED') {
    return sendBrowserPushNotification(`🎉 ¡Solicitud Aprobada, ${params.applicantName}!`, {
      body: `Tu solicitud de incorporación fue aprobada por la administración. Ya estás habilitado para el próximo ciclo operativo.`,
      icon: '/favicon.png',
      tag: `app_approved_${params.applicantName}`,
    });
  } else {
    return sendBrowserPushNotification(`⚠️ Actualización de Solicitud`, {
      body: `Hola ${params.applicantName}, tu solicitud no pudo ser aprobada en este momento. ${params.rejectionReason || ''}`,
      icon: '/favicon.png',
      tag: `app_rejected_${params.applicantName}`,
    });
  }
}
