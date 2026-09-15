// Service Worker importable para Firebase Cloud Messaging (FCM) y PWA
// Se ejecuta importado por /sw.js generado por Workbox

const SW_PUSH_VERSION = "push-bg-test-1";

// Listener para verificar versión del Service Worker desde la PWA en desarrollo
self.addEventListener('message', (event) => {
  if (event.data?.type === 'GET_SW_VERSION') {
    event.source?.postMessage({
      type: 'SW_VERSION',
      version: SW_PUSH_VERSION,
    });
  }
});

// 1. Manejar clic en la notificación push (Registrado ANTES de inicializar FCM para no ser sobreescrito)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  let targetUrl = '/';
  const data = event.notification?.data || {};

  if (data.url) {
    targetUrl = data.url;
  } else if (data.FCM_MSG?.data?.url) {
    targetUrl = data.FCM_MSG.data.url;
  } else if (data.FCM_MSG?.fcmOptions?.link) {
    targetUrl = data.FCM_MSG.fcmOptions.link;
  } else if (data.actionUrl) {
    targetUrl = data.actionUrl;
  }

  // Validar y sanitizar URL para restringir al mismo origen
  try {
    const parsed = new URL(targetUrl, self.location.origin);
    if (parsed.origin !== self.location.origin) {
      targetUrl = '/';
    } else {
      targetUrl = parsed.pathname + parsed.search + parsed.hash;
    }
  } catch {
    targetUrl = '/';
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          if ('navigate' in client && targetUrl !== '/') {
            client.navigate(targetUrl);
          }
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// 2. Cargar SDKs Compat de Firebase
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// 3. Configuración de Firebase para el Service Worker
const firebaseConfig = {
  apiKey: "AIzaSyCuDd0HyWMlcUedTMAb3c4Sfjdb4qNkvIc",
  authDomain: "trading-a473e.firebaseapp.com",
  projectId: "trading-a473e",
  storageBucket: "trading-a473e.firebasestorage.app",
  messagingSenderId: "777989829280",
  appId: "1:777989829280:web:fbc3a266cfe2399cf68fc5"
};

// 4. Inicializar Firebase en el Service Worker
if (firebase.apps.length === 0) {
  firebase.initializeApp(firebaseConfig);
}

const messaging = firebase.messaging();

// 5. Manejar notificaciones en segundo plano para mensajes de solo datos (Data-only fallback)
// NOTA: Si el payload incluye 'notification', FCM y el navegador generan la notificación nativa
// automáticamente. Evitamos duplicados omitiendo showNotification manual cuando payload.notification existe.
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Mensaje FCM en segundo plano recibido:', payload);

  if (payload.notification) {
    // Evitar duplicados si existiera objeto notification legacy
    return;
  }

  const title = payload.data?.title || 'Easy Traders';
  const options = {
    body: payload.data?.body || 'Nueva actualización',
    icon: '/favicon.png',
    badge: '/apple-touch-icon.png',
    tag: payload.data?.tag || payload.data?.notifId || `notif_${Date.now()}`,
    renotify: true,
    data: {
      url: payload.data?.url || '/',
      notifId: payload.data?.notifId || '',
      type: payload.data?.type || 'GENERAL',
    },
  };

  return self.registration.showNotification(title, options);
});
