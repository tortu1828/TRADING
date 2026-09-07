// Service Worker de Firebase Cloud Messaging (FCM) para Notificaciones Push en Segundo Plano
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// Configuración de Firebase para el Service Worker
const firebaseConfig = {
  apiKey: "AIzaSyCuDd0HyWMlcUedTMAb3c4Sfjdb4qNkvIc",
  authDomain: "trading-a473e.firebaseapp.com",
  projectId: "trading-a473e",
  storageBucket: "trading-a473e.firebasestorage.app",
  messagingSenderId: "777989829280",
  appId: "1:777989829280:web:e4eb66aa1d7cf78ff68fc5"
};

// Inicializar Firebase en el Service Worker
if (firebase.apps.length === 0) {
  firebase.initializeApp(firebaseConfig);
}

const messaging = firebase.messaging();

// Manejar notificaciones cuando la app o pestaña está en segundo plano o cerrada
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Notificación Push recibida en segundo plano:', payload);

  const notificationTitle = payload.notification?.title || payload.data?.title || 'Gestor de Capital';
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.body || 'Nueva actualización de tu ciclo de capital.',
    icon: '/favicon.png',
    badge: '/apple-touch-icon.png',
    data: payload.data || {},
    tag: payload.data?.cycleId ? `cycle_${payload.data.cycleId}` : 'general_notif',
    renotify: true,
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Manejar clic en la notificación push
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
