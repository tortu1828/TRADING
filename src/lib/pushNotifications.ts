import { getMessaging, getToken, onMessage, isSupported, deleteToken } from 'firebase/messaging';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import app, { auth, db } from './firebase';

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
 * Single Canonical VAPID Public Key configured for Firebase Project trading-a473e.
 * It is exactly 87 characters, representing a valid 65-byte uncompressed NIST P-256 public key.
 */
export const CANONICAL_VAPID_KEY = 'BOcehgbuKpbimQQEUG3vvZcBY-iHk5gMcnH4bstk_ePbDJqhv27DImwWYME0JmJeYMKtP2Han_FVZvuWxsMI7VM';

/**
 * Computes a stable document ID for a token string
 */
export function getDeviceTokenId(token: string): string {
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    hash = ((hash << 5) - hash) + token.charCodeAt(i);
    hash |= 0;
  }
  const cleanPrefix = token.substring(0, 10).replace(/[^a-zA-Z0-9]/g, '');
  return `${cleanPrefix}_${Math.abs(hash)}`;
}

/**
 * Validates and cleans a VAPID public key.
 * Removes spaces, accidental trailing quotes/characters, and validates format. Does NOT arbitrarily slice or truncate characters.
 */
export function validateAndCleanVapidKey(key: string, sourceName = 'Hardcoded'): {
  cleanedKey: string;
  source: string;
  length: number;
  fingerprint: string;
  validFormat: boolean;
} {
  const cleaned = (key || '').trim().replace(/\r?\n|\r|\s/g, '');

  const length = cleaned.length;
  const fingerprint = length >= 10 
    ? `${cleaned.substring(0, 6)}...${cleaned.substring(length - 4)}` 
    : cleaned;

  const validFormat = length === 87 && /^[A-Za-z0-9_-]+$/.test(cleaned);

  return {
    cleanedKey: cleaned,
    source: sourceName,
    length,
    fingerprint,
    validFormat
  };
}

/**
 * Detects platform and browser name for push token metadata
 */
export function getDeviceMetadata() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  let browser = 'Unknown Browser';
  if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Edg')) browser = 'Edge';

  let platform = 'Web';
  if (ua.includes('iPhone') || ua.includes('iPad')) platform = 'iOS';
  else if (ua.includes('Android')) platform = 'Android';
  else if (ua.includes('Macintosh')) platform = 'macOS';
  else if (ua.includes('Windows')) platform = 'Windows';

  return { browser, platform };
}

/**
 * Registers or updates a user's FCM push token in Firestore under users/{userId}/pushTokens/{tokenId}
 */
export async function registerUserPushToken(userId: string, fcmToken: string): Promise<boolean> {
  if (!userId || !fcmToken) return false;
  try {
    const tokenId = getDeviceTokenId(fcmToken);
    const { browser, platform } = getDeviceMetadata();
    const tokenDocRef = doc(db, 'users', userId, 'pushTokens', tokenId);
    
    await setDoc(tokenDocRef, {
      token: fcmToken,
      platform,
      browser,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    console.log(`[Push] Token registrado exitosamente para usuario ${userId} (${tokenId})`);
    return true;
  } catch (err) {
    console.warn('[Push] No se pudo guardar el token en Firestore:', err);
    return false;
  }
}

/**
 * Removes a specific user device FCM push token from Firestore (used on Logout or token invalidation)
 */
export async function unregisterUserPushToken(userId: string, fcmToken?: string | null): Promise<boolean> {
  if (!userId) return false;
  try {
    const tokenToUnregister = fcmToken || localStorage.getItem(PUSH_TOKEN_KEY);
    if (!tokenToUnregister) return false;

    const tokenId = getDeviceTokenId(tokenToUnregister);
    const tokenDocRef = doc(db, 'users', userId, 'pushTokens', tokenId);

    await deleteDoc(tokenDocRef);
    console.log(`[Push] Token ${tokenId} desvinculado exitosamente del usuario ${userId}`);
    return true;
  } catch (err) {
    console.warn('[Push] Error al desvincular token en Firestore:', err);
    return false;
  }
}

/**
 * Helper to determine if the local device has an active Administrator session
 */
export function isCurrentDeviceAdmin(): boolean {
  try {
    // 1. Verificar Firebase Auth directo
    if (auth.currentUser) {
      const email = (auth.currentUser.email || '').toLowerCase().trim();
      if (
        email === 'elcocalombiano1828@gmail.com' ||
        email === 'juanes9802@gmail.com' ||
        auth.currentUser.uid === 'lpx4NLEEMkeh9EJFcG68oPMVdXF2' ||
        email.includes('admin') ||
        email.startsWith('admin@')
      ) {
        return true;
      }
    }

    // 2. Verificar Sesión en LocalStorage
    const sessionUser =
      localStorage.getItem('easytraders_current_user_session') ||
      localStorage.getItem('gestor_capital_current_user_v5');

    if (sessionUser) {
      const parsed = JSON.parse(sessionUser);
      if (
        parsed.role === 'ADMIN' ||
        parsed.email === 'elcocalombiano1828@gmail.com' ||
        parsed.email === 'juanes9802@gmail.com' ||
        parsed.userCode?.startsWith('ADM') ||
        parsed.id === 'admin_root_uid' ||
        parsed.id === 'usr_admin'
      ) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Memory lock object associated to the UID to prevent concurrent getToken calls
 */
let pushRegistrationInFlight: {
  uid: string;
  promise: Promise<{ success: boolean; token: string | null; error?: string }>;
} | null = null;

// Track if we have already run a forced autorepair in the current runtime session
let hasAutorepairedThisSession = false;

// Metadata keys
export const PUSH_LAST_REGISTERED_UID = 'push_last_registered_uid';
export const PUSH_LAST_TOKEN_FINGERPRINT = 'push_last_token_fingerprint';
export const PUSH_LAST_SUCCESS_AT = 'push_last_success_at';

export interface EnsurePushRegistrationResult {
  success: boolean;
  token: string | null;
  error?: string;
}

/**
 * Motor Canónico Único para aprovisionar, registrar y validar tokens Push en Firestore
 */
export async function ensurePushRegistration(options: {
  forceRepair?: boolean;
  userId?: string;
} = {}): Promise<EnsurePushRegistrationResult> {
  const currentUid = options.userId || auth.currentUser?.uid;
  if (!currentUid) {
    return { success: false, token: null, error: 'No se detectó un usuario autenticado activo.' };
  }

  // Protección de concurrencia: si hay una operación en progreso para el mismo UID, reusar promesa
  if (pushRegistrationInFlight) {
    if (pushRegistrationInFlight.uid === currentUid) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Push] Reutilizando registro en curso para el mismo UID:', currentUid);
      }
      return pushRegistrationInFlight.promise;
    }
  }

  const promise = (async (): Promise<EnsurePushRegistrationResult> => {
    try {
      if (!isPushSupported()) {
        return { success: false, token: null, error: 'Las notificaciones push no son compatibles con este navegador.' };
      }

      if (Notification.permission !== 'granted') {
        return { success: false, token: null, error: 'No se han otorgado permisos de notificación en el navegador.' };
      }

      const registration = await getActivePwaRegistration();
      if (!registration) {
        return { success: false, token: null, error: 'No se encontró una registración activa de Service Worker lista.' };
      }

      const messagingSupported = await isSupported();
      if (!messagingSupported) {
        return { success: false, token: null, error: 'FCM no es compatible con este navegador.' };
      }

      const messaging = getMessaging(app);

      // Si se fuerza una reparación excepcional o rotación
      if (options.forceRepair) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[Push] Reparación forzada. Invalidando token FCM actual...');
        }
        try {
          await deleteToken(messaging);
        } catch (delErr) {
          console.warn('[Push] Error al invalidar token FCM anterior:', delErr);
        }
        localStorage.removeItem(PUSH_TOKEN_KEY);
      }

      // Obtener token FCM canónico mediante el SDK
      const { cleanedKey } = validateAndCleanVapidKey(CANONICAL_VAPID_KEY, 'Flujo Canónico');
      let fcmToken: string | null = null;
      try {
        fcmToken = await getToken(messaging, {
          serviceWorkerRegistration: registration,
          vapidKey: cleanedKey,
        });
      } catch (tokenErr: any) {
        console.error('[Push] Error al llamar a getToken:', tokenErr);
        return {
          success: false,
          token: null,
          error: tokenErr?.message || 'Error al obtener token desde el servidor de Google (FCM).',
        };
      }

      if (!fcmToken) {
        return { success: false, token: null, error: 'El servidor de Google (FCM) devolvió un token vacío.' };
      }

      const tokenId = getDeviceTokenId(fcmToken);
      const { browser, platform } = getDeviceMetadata();
      const tokenDocRef = doc(db, 'users', currentUid, 'pushTokens', tokenId);

      // Metadatos auxiliares de localStorage
      const lastRegisteredUid = localStorage.getItem(PUSH_LAST_REGISTERED_UID);
      const lastTokenFingerprint = localStorage.getItem(PUSH_LAST_TOKEN_FINGERPRINT);
      const currentFingerprint = fcmToken.length > 20
        ? `${fcmToken.substring(0, 8)}...${fcmToken.substring(fcmToken.length - 8)}`
        : 'FCM_Token';

      let needsControlledAutorepair = false;

      // Comprobar opcionalmente si el registro existe en Firestore para detectar purgados accidentales
      // Pero solo si el usuario no ha cambiado (cambio de cuenta o usuario nuevo simplemente hace setDoc directo)
      if (lastRegisteredUid === currentUid && lastTokenFingerprint === currentFingerprint) {
        try {
          const { getDoc } = await import('firebase/firestore');
          const docSnap = await getDoc(tokenDocRef);
          if (!docSnap.exists()) {
            if (!hasAutorepairedThisSession) {
              needsControlledAutorepair = true;
            }
          }
        } catch (e) {
          console.warn('[Push] Error comprobando existencia de token en Firestore:', e);
        }
      }

      if (needsControlledAutorepair) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[Push] Registro purgado detectado en Firestore. Ejecutando autoreparación controlada...');
        }
        hasAutorepairedThisSession = true;
        try {
          await deleteToken(messaging);
        } catch (delErr) {
          console.warn('[Push] Error al invalidar token FCM en autoreparación:', delErr);
        }
        localStorage.removeItem(PUSH_TOKEN_KEY);

        // Volver a obtener token fresco
        try {
          fcmToken = await getToken(messaging, {
            serviceWorkerRegistration: registration,
            vapidKey: cleanedKey,
          });
        } catch (tokenErr: any) {
          return {
            success: false,
            token: null,
            error: tokenErr?.message || 'Error al obtener token tras autoreparación.',
          };
        }

        if (!fcmToken) {
          return { success: false, token: null, error: 'Token vacío devuelto tras autoreparación.' };
        }
      }

      // Escribir/sincronizar el token con Firestore de forma segura
      try {
        await setDoc(tokenDocRef, {
          token: fcmToken,
          platform,
          browser,
          createdAt: new Date().toISOString(), // setDoc con merge preservará el createdAt original si ya existía
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      } catch (fsErr: any) {
        console.error('[Push] Error de escritura en Firestore:', fsErr);
        return {
          success: false,
          token: null,
          error: fsErr?.message || 'Error de escritura en base de datos Firestore.',
        };
      }

      // Guardar metadata local auxiliar
      localStorage.setItem(PUSH_TOKEN_KEY, fcmToken);
      localStorage.setItem(PUSH_LAST_REGISTERED_UID, currentUid);
      localStorage.setItem(PUSH_LAST_TOKEN_FINGERPRINT, fcmToken.length > 20
        ? `${fcmToken.substring(0, 8)}...${fcmToken.substring(fcmToken.length - 8)}`
        : 'FCM_Token');
      localStorage.setItem(PUSH_LAST_SUCCESS_AT, new Date().toISOString());

      if (process.env.NODE_ENV !== 'production') {
        console.log('[Push] Registro canónico sincronizado de forma exitosa en Firestore para UID:', currentUid);
      }

      return { success: true, token: fcmToken };
    } catch (err: any) {
      console.error('[Push] Fallo en ensurePushRegistration:', err);
      return { success: false, token: null, error: err?.message || 'Error inesperado en configuración push.' };
    }
  })();

  pushRegistrationInFlight = {
    uid: currentUid,
    promise,
  };

  try {
    return await promise;
  } finally {
    if (pushRegistrationInFlight?.uid === currentUid) {
      pushRegistrationInFlight = null;
    }
  }
}

/**
 * Automatically requests notification permissions at startup or login.
 * STRICT RULE: Only requested if a valid user account is currently logged in.
 * Visitors and applicants without an account MUST NOT be prompted for notifications.
 */
export async function ensureAutoNotificationPermission(userId?: string): Promise<void> {
  if (!isPushSupported()) return;

  const currentUid = userId || auth.currentUser?.uid;
  if (!currentUid) return;

  if (Notification.permission === 'granted') {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Push Boot] Autorregistro silencioso en background...');
    }
    ensurePushRegistration({ forceRepair: false, userId: currentUid }).catch((err) => {
      console.warn('[Push Boot] Error en autorregistro silencioso:', err);
    });
  } else if (Notification.permission === 'default') {
    requestNotificationPermission().catch(() => {});
  }
}

let isForegroundListenerRegistered = false;

/**
 * Registra idempotentemente el listener de mensajes FCM en primer plano
 */
export async function initializeForegroundMessaging(): Promise<boolean> {
  if (isForegroundListenerRegistered) return true;
  try {
    const messagingSupported = await isSupported();
    if (!messagingSupported) return false;

    const messaging = getMessaging(app);
    onMessage(messaging, (payload) => {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Push Client] Mensaje FCM en primer plano recibido:', payload);
      }
      const title = payload.notification?.title || payload.data?.title || 'Easy Traders';
      const body = payload.notification?.body || payload.data?.body || 'Nueva actualización';
      
      sendBrowserPushNotification(
        title,
        {
          body,
          icon: '/favicon.png',
          tag: payload.data?.tag || payload.data?.notifId,
          data: payload.data,
          url: payload.data?.url || '/',
        }
      );
    });

    isForegroundListenerRegistered = true;
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Push Client] Listener foreground onMessage registrado exitosamente.');
    }
    return true;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Push Client] Error registrando listener foreground:', err);
    }
    return false;
  }
}

/**
 * Obtiene de forma segura la registración activa del Service Worker PWA
 * sin provocar un cuelgue o bloqueo infinito si el SW tarda en responder.
 */
export async function getActivePwaRegistration(timeoutMs = 5000): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  try {
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[Push] Timeout esperando navigator.serviceWorker.ready');
        }
        resolve(null);
      }, timeoutMs);
    });

    const readyPromise = navigator.serviceWorker.ready.then((reg) => {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Push] Service Worker PWA activo detectado:', reg.scope, reg.active?.scriptURL);
      }
      return reg;
    });

    const registration = await Promise.race([readyPromise, timeoutPromise]);
    return registration;
  } catch (err) {
    console.warn('[Push] Error al consultar Service Worker ready:', err);
    return null;
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
      error: 'Las notificaciones no son compatibles con este navegador o dispositivo.',
    };
  }

  try {
    // Compatibility with Promise and legacy callbacks for WebKit / Safari macOS
    let permission: NotificationPermission;
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = await new Promise<NotificationPermission>((resolve) => {
        Notification.requestPermission((p) => resolve(p));
      });
    }

    localStorage.setItem(PUSH_PERMISSION_KEY, permission);

    if (permission === 'denied') {
      return {
        granted: false,
        token: null,
        error: 'Permiso denegado. En macOS, ve a Ajustes del Sistema > Notificaciones > Gestor de Capital (o Safari/Chrome) para habilitar las alertas.',
      };
    }

    if (permission !== 'granted') {
      return {
        granted: false,
        token: null,
        error: 'No se otorgaron permisos de notificación.',
      };
    }

    // 1. Inicializar listener de primer plano independientemente
    initializeForegroundMessaging().catch(() => {});

    // 2. Sincronizar el registro canónico en Firestore y obtener el token real
    const result = await ensurePushRegistration({ forceRepair: false });
    if (!result.success) {
      return {
        granted: true, // El permiso sí está otorgado, pero falló la configuración técnica
        token: null,
        error: result.error || 'No pudimos terminar la configuración. Intenta nuevamente.',
      };
    }

    return {
      granted: true,
      token: result.token,
    };
  } catch (err: any) {
    console.error('[Push] Error al solicitar permisos:', err);
    return {
      granted: false,
      token: null,
      error: err?.message || 'Error al habilitar notificaciones.',
    };
  }
}

/**
 * Emits a native Browser Push Notification (compatible with macOS PWA, Safari, Chrome, and Mobile)
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

    // 1. Mostrar mediante ServiceWorkerRegistration (esencial para macOS PWA en Dock y móviles)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((registration) => {
          registration.showNotification(title, notifOptions);
        })
        .catch(() => {
          try {
            const notif = new Notification(title, notifOptions as NotificationOptions);
            notif.onclick = () => {
              window.focus();
              if (options.url) window.location.href = options.url;
              notif.close();
            };
          } catch {}
        });
    } else {
      // 2. Fallback estándar si no hay Service Worker activo
      try {
        const notif = new Notification(title, notifOptions as NotificationOptions);
        notif.onclick = () => {
          window.focus();
          if (options.url) window.location.href = options.url;
          notif.close();
        };
      } catch {}
    }

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
export function playNotificationAudio() {
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

export const playPushNotificationSound = playNotificationAudio;

/**
 * Sends a Push Notification when a Monthly Cycle report is dispatched to a user.
 * STRICT RULE: Administrators MUST NEVER receive monthly closure push notifications.
 * Only genuine investors logged into their own accounts receive this alert.
 */
export function notifyCycleClosureToUser(params: {
  userId?: string;
  userName: string;
  userProfitCop: number;
  totalUsdOperated: number;
  cycleName: string;
}): boolean {
  // 1. Silenciar terminantemente si el usuario actual en el dispositivo es Administrador
  try {
    const authUser =
      localStorage.getItem('easytraders_current_user_session') ||
      localStorage.getItem('gestor_capital_current_user_v5');
    if (authUser) {
      const parsed = JSON.parse(authUser);
      if (
        parsed.role === 'ADMIN' ||
        parsed.email === 'elcocalombiano1828@gmail.com' ||
        parsed.email === 'juanes9802@gmail.com' ||
        parsed.userCode?.startsWith('ADM') ||
        parsed.id === 'admin_root_uid' ||
        parsed.id === 'usr_admin'
      ) {
        // Al Administrador NO le llegan notificaciones de operación mensual ni reportes
        return false;
      }
      // Si se especifica el ID del usuario, solo mostrar si coincide con el usuario activo en este navegador
      if (params.userId && parsed.id !== params.userId && parsed.userCode !== params.userId && parsed.uid !== params.userId) {
        return false;
      }
    }
  } catch {
    // En caso de duda, no enviar push
  }

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
 * STRICT RULE: Only triggered and sounded on devices where an ADMINISTRATOR is currently logged in.
 */
export function notifyNewApplicationToAdmin(params: {
  applicantName: string;
  requestedCapitalCop: number;
  queuePosition: number;
  phone?: string;
  city?: string;
  bank?: string;
}): boolean {
  // Solo proceder si el dispositivo actual tiene una sesión activa de Administrador
  if (!isCurrentDeviceAdmin()) {
    return false;
  }

  const formattedCapital = `$${params.requestedCapitalCop.toLocaleString('es-CO')} COP`;
  const title = `📥 Nueva Solicitud de Admisión: ${params.applicantName} (Turno #${params.queuePosition})`;
  const extraDetails = [params.city, params.bank, params.phone ? `Tel: ${params.phone}` : ''].filter(Boolean).join(' • ');
  const body = `${params.applicantName} ha solicitado ingresar con un capital de ${formattedCapital}.${extraDetails ? ` (${extraDetails})` : ''} Revisa la sección de Admisiones para gestionar.`;

  // 1. Reproducir sonido de alerta
  playNotificationAudio();

  // 2. Disparar evento en vivo dentro de la aplicación para toast interactivo
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('easytraders:in-app-notification', {
        detail: {
          title,
          body,
          applicantName: params.applicantName,
          amountCop: params.requestedCapitalCop,
          queuePosition: params.queuePosition,
          phone: params.phone,
          city: params.city,
          bank: params.bank,
          type: 'INVESTMENT_REQUEST',
          timestamp: new Date().toISOString(),
        },
      })
    );
  }

  // 3. Notificación nativa del navegador / PWA
  return sendBrowserPushNotification(title, {
    body,
    icon: '/favicon.png',
    tag: `app_sub_${params.queuePosition}_${Date.now()}`,
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

/**
 * Sends a Push Notification and In-App Alert to Admins when a Reinvestment to Capital is requested
 * STRICT RULE: Only triggered and sounded on devices where an ADMINISTRATOR is currently logged in.
 */
export function notifyNewReinvestmentToAdmin(params: {
  userName: string;
  userCode: string;
  newCapitalTargetCop: number;
}): boolean {
  // Solo proceder si el dispositivo actual tiene una sesión activa de Administrador
  if (!isCurrentDeviceAdmin()) {
    return false;
  }

  const formattedAmount = `$${params.newCapitalTargetCop.toLocaleString('es-CO')} COP`;
  const title = `🔄 Solicitud de Reinversión a Capital: ${params.userName}`;
  const body = `${params.userName} (${params.userCode}) ha solicitado reinvertir utilidades al capital por valor de ${formattedAmount}.`;

  playNotificationAudio();

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('easytraders:in-app-notification', {
        detail: {
          title,
          body,
          applicantName: params.userName,
          amountCop: params.newCapitalTargetCop,
          type: 'REINVESTMENT',
          timestamp: new Date().toISOString(),
        },
      })
    );
  }

  return sendBrowserPushNotification(title, {
    body,
    icon: '/favicon.png',
    tag: `reinv_${params.userCode}_${Date.now()}`,
    data: {
      type: 'REINVESTMENT',
      userCode: params.userCode,
    },
  });
}

/**
 * Helper exclusivo para resolver el nombre a mostrar en el saludo de la notificación de TRADE DIARIO.
 * Si existe tradeNotificationAlias (no vacío / no solo espacios), utiliza el alias.
 * De lo contrario, cae en el fallback automático del nombre real (fullName).
 */
export function resolveTradeNotificationName(user: { tradeNotificationAlias?: string | null; fullName: string }): string {
  const alias = user.tradeNotificationAlias?.trim();
  if (alias) {
    return alias;
  }
  return user.fullName;
}

/**
 * Sends a Push Notification when a Daily Trade / Operation is registered for an investor group
 */
export function notifyDailyTradeToUser(params: {
  userId: string;
  userName: string;
  tradeNotificationAlias?: string | null;
  usdOperated: number;
  userProfitCop: number;
  userProfitUsd: number;
  date: string;
  category?: string;
  operationId?: string;
}): boolean {
  const isPositive = params.usdOperated >= 0;
  const signStr = isPositive ? '+' : '-';
  const formattedUsd = `${signStr}$${Math.abs(params.usdOperated).toFixed(2)} USD`;
  const formattedProfitCop = `${isPositive ? '+' : '-'}$${Math.abs(params.userProfitCop).toLocaleString('es-CO')} COP`;

  const tradeName = resolveTradeNotificationName({
    tradeNotificationAlias: params.tradeNotificationAlias,
    fullName: params.userName,
  });

  const title = `${isPositive ? '📈' : '📉'} Operación Diaria: ${formattedUsd}`;
  const body = `Hola ${tradeName}, se operó ${formattedUsd} el ${params.date}. Tu resultado calculado para esta operación es de ${formattedProfitCop}.`;

  playNotificationAudio();

  return sendBrowserPushNotification(title, {
    body,
    icon: '/favicon.png',
    tag: params.operationId ? `daily_trade_${params.operationId}_${params.userId}` : `daily_trade_${params.userId}_${Date.now()}`,
    data: {
      type: 'DAILY_TRADE',
      userId: params.userId,
      usdOperated: params.usdOperated,
      operationId: params.operationId || '',
    },
  });
}

/**
 * Test notification helper to verify audio & native push banner
 */
export function testPushNotification(): boolean {
  playNotificationAudio();
  return sendBrowserPushNotification('🔔 Notificación de Prueba', {
    body: 'El sistema de alertas push y sonido está configurado y funcionando perfectamente.',
    icon: '/favicon.png',
    tag: `test_${Date.now()}`,
  });
}

// ==========================================
// PUSH DIAGNOSTIC ENGINE & REPAIR SYSTEM
// ==========================================

export interface PushDiagnosticInfo {
  standalone: boolean;
  permission: string;
  swControllerPresent: boolean;
  swControllerScript: string;
  swRegistrationFound: boolean;
  swRegistrationScope: string;
  swRegistrationState: string;
  swVersion: string;
  messagingSupported: boolean;
  getTokenStatus: 'NOT_STARTED' | 'RUNNING' | 'SUCCESS' | 'ERROR';
  tokenPresent: boolean;
  tokenFingerprint: string;
  firestoreStatus: 'NOT_STARTED' | 'RUNNING' | 'SUCCESS' | 'ERROR';
  lastAttemptAt: string;
  lastTokenSuccessAt: string;
  lastFirestoreSuccessAt: string;
  errorCode: string;
  errorMessage: string;
  oldTokenCleanupStatus?: 'NOT_STARTED' | 'RUNNING' | 'SUCCESS' | 'ERROR';
  oldTokenFingerprint?: string;
  newTokenFingerprint?: string;
}

const DIAG_GET_TOKEN_STATUS = 'gestor_push_diag_get_token_status';
const DIAG_FIRESTORE_STATUS = 'gestor_push_diag_firestore_status';
const DIAG_LAST_ATTEMPT_AT = 'gestor_push_diag_last_attempt_at';
const DIAG_LAST_TOKEN_SUCCESS_AT = 'gestor_push_diag_last_token_success_at';
const DIAG_LAST_FIRESTORE_SUCCESS_AT = 'gestor_push_diag_last_firestore_success_at';
const DIAG_ERROR_CODE = 'gestor_push_diag_error_code';
const DIAG_ERROR_MESSAGE = 'gestor_push_diag_error_message';
const DIAG_TOKEN_FINGERPRINT = 'gestor_push_diag_token_fingerprint';

let isRepairInFlight = false;

/**
 * Queries the active Service Worker version by sending a Message event and awaiting a response.
 */
export async function queryServiceWorkerVersion(): Promise<string> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
    return 'Sin SW controlador';
  }

  return new Promise<string>((resolve) => {
    const timeout = setTimeout(() => {
      resolve('Timeout (SW no responde)');
    }, 2000);

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SW_VERSION') {
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('message', onMessage);
        resolve(event.data.version || 'Desconocida');
      }
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    navigator.serviceWorker.controller.postMessage({ type: 'GET_SW_VERSION' });
  });
}

/**
 * Extracts the current state of PWA, Service Worker, FCM, and Storage for troubleshooting.
 */
export async function getPushDiagnostics(): Promise<PushDiagnosticInfo> {
  const isStandalone = typeof window !== 'undefined' && (
    (window.navigator as any).standalone || 
    window.matchMedia('(display-mode: standalone)').matches
  );

  const permission = typeof window !== 'undefined' ? Notification.permission : 'default';
  const swControllerPresent = typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;
  const swControllerScript = (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller?.scriptURL) || 'Ninguno';
  
  let swRegistrationFound = false;
  let swRegistrationScope = 'Ninguno';
  let swRegistrationState = 'Inactivo';

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        swRegistrationFound = true;
        swRegistrationScope = reg.scope;
        swRegistrationState = reg.active?.state || 'waiting/installing';
      }
    } catch (e) {
      console.warn('Error reading SW registration for diagnostic:', e);
    }
  }

  const swVersion = await queryServiceWorkerVersion();
  let messagingSupported = false;
  try {
    messagingSupported = await isSupported();
  } catch {}

  const localToken = localStorage.getItem(PUSH_TOKEN_KEY);
  const tokenPresent = !!localToken;
  const tokenFingerprint = localStorage.getItem(DIAG_TOKEN_FINGERPRINT) || (localToken ? `${localToken.substring(0, 8)}...${localToken.substring(localToken.length - 8)}` : '');

  const getTokenStatus = (localStorage.getItem(DIAG_GET_TOKEN_STATUS) || 'NOT_STARTED') as any;
  const firestoreStatus = (localStorage.getItem(DIAG_FIRESTORE_STATUS) || 'NOT_STARTED') as any;
  const oldTokenCleanupStatus = (localStorage.getItem('gestor_push_diag_old_cleanup') || 'NOT_STARTED') as any;
  const oldTokenFingerprint = localStorage.getItem('gestor_push_diag_old_fingerprint') || 'Ninguno';
  const newTokenFingerprint = localStorage.getItem('gestor_push_diag_new_fingerprint') || 'Ninguno';

  return {
    standalone: isStandalone,
    permission,
    swControllerPresent,
    swControllerScript,
    swRegistrationFound,
    swRegistrationScope,
    swRegistrationState,
    swVersion,
    messagingSupported,
    getTokenStatus,
    tokenPresent,
    tokenFingerprint,
    firestoreStatus,
    lastAttemptAt: localStorage.getItem(DIAG_LAST_ATTEMPT_AT) || 'Nunca',
    lastTokenSuccessAt: localStorage.getItem(DIAG_LAST_TOKEN_SUCCESS_AT) || 'Nunca',
    lastFirestoreSuccessAt: localStorage.getItem(DIAG_LAST_FIRESTORE_SUCCESS_AT) || 'Nunca',
    errorCode: localStorage.getItem(DIAG_ERROR_CODE) || '',
    errorMessage: localStorage.getItem(DIAG_ERROR_MESSAGE) || '',
    oldTokenCleanupStatus,
    oldTokenFingerprint,
    newTokenFingerprint,
  };
}

/**
 * Triggers full repair by attempting to acquire the Service Worker registration,
 * fetching a fresh getToken from FCM (bypassing cached tokens), and updating the user document.
 */
export async function repairAndDiagnosePush(forceRotation = false): Promise<PushDiagnosticInfo> {
  if (isRepairInFlight) {
    return getPushDiagnostics();
  }
  isRepairInFlight = true;

  const nowStr = new Date().toISOString();
  localStorage.setItem(DIAG_LAST_ATTEMPT_AT, nowStr);
  localStorage.setItem(DIAG_GET_TOKEN_STATUS, 'RUNNING');
  localStorage.setItem(DIAG_FIRESTORE_STATUS, 'NOT_STARTED');
  localStorage.setItem(DIAG_ERROR_CODE, '');
  localStorage.setItem(DIAG_ERROR_MESSAGE, '');

  if (forceRotation) {
    localStorage.setItem('gestor_push_diag_old_cleanup', 'RUNNING');
  } else {
    localStorage.setItem('gestor_push_diag_old_cleanup', 'NOT_STARTED');
  }

  try {
    const activeUid = auth.currentUser?.uid;
    if (!activeUid) {
      throw { code: 'auth/user-not-authenticated', message: 'No hay una sesión activa de Firebase Auth para asociar el token.' };
    }

    // Ejecuta el motor unificado de registro push
    const result = await ensurePushRegistration({ forceRepair: forceRotation, userId: activeUid });

    if (!result.success) {
      throw { code: 'repair/failed', message: result.error || 'Ocurrió un error en el motor canónico de registro.' };
    }

    const fcmToken = result.token;
    if (!fcmToken) {
      throw { code: 'repair/empty-token', message: 'El motor devolvió un token vacío.' };
    }

    // Token success!
    localStorage.setItem(DIAG_GET_TOKEN_STATUS, 'SUCCESS');
    localStorage.setItem(DIAG_LAST_TOKEN_SUCCESS_AT, new Date().toISOString());

    // Generate fingerprint
    const fingerprint = fcmToken.length > 20 
      ? `${fcmToken.substring(0, 8)}...${fcmToken.substring(fcmToken.length - 8)}` 
      : 'FCM_Token_Válido';
    localStorage.setItem(DIAG_TOKEN_FINGERPRINT, fingerprint);
    localStorage.setItem('gestor_push_diag_new_fingerprint', fingerprint);

    // Firestore success!
    localStorage.setItem(DIAG_FIRESTORE_STATUS, 'SUCCESS');
    localStorage.setItem(DIAG_LAST_FIRESTORE_SUCCESS_AT, new Date().toISOString());

    if (forceRotation) {
      localStorage.setItem('gestor_push_diag_old_cleanup', 'SUCCESS');
    }

  } catch (err: any) {
    console.error('[Push Diagnostics] Fallo en reparación:', err);
    
    const errCode = err?.code || 'unknown-error';
    const errMsg = err?.message || 'Ocurrió un error inesperado durante el diagnóstico.';
    
    localStorage.setItem(DIAG_ERROR_CODE, errCode);
    localStorage.setItem(DIAG_ERROR_MESSAGE, errMsg);
    
    if (localStorage.getItem(DIAG_GET_TOKEN_STATUS) === 'RUNNING') {
      localStorage.setItem(DIAG_GET_TOKEN_STATUS, 'ERROR');
    }
    if (localStorage.getItem(DIAG_FIRESTORE_STATUS) === 'RUNNING') {
      localStorage.setItem(DIAG_FIRESTORE_STATUS, 'ERROR');
    }
    if (forceRotation && localStorage.getItem('gestor_push_diag_old_cleanup') === 'RUNNING') {
      localStorage.setItem('gestor_push_diag_old_cleanup', 'ERROR');
    }
  } finally {
    isRepairInFlight = false;
  }

  return getPushDiagnostics();
}
