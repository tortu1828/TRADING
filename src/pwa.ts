import { registerSW } from 'virtual:pwa-register';

/**
 * Registra centralizadamente el Service Worker de la PWA (/sw.js)
 * al arrancar la aplicación (bootstrap).
 */
export function initPwaServiceWorker() {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          if (process.env.NODE_ENV !== 'production') {
            console.log('[PWA] Nueva versión disponible.');
          }
        },
        onOfflineReady() {
          if (process.env.NODE_ENV !== 'production') {
            console.log('[PWA] Aplicación lista para funcionar offline.');
          }
        },
        onRegisterError(error) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[PWA] Error en registro central de Service Worker:', error);
          }
        },
      });
      return updateSW;
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[PWA] No se pudo invocar registerSW:', err);
      }
    }
  }
}
