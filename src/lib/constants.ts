/**
 * ============================================================================
 * CONFIGURACIÓN CENTRAL DE DOMINIOS Y CONSTANTES DE RED
 * ============================================================================
 * Fuente única de verdad para el dominio canónico público de EasyTraders24.
 * 
 * Reglas de Arquitectura:
 * 1. Dominio canónico de producción: https://easytraders24.app (siempre HTTPS).
 * 2. En entorno de ejecución en navegador (cliente): se prioriza window.location.origin
 *    para garantizar total compatibilidad con desarrollo local (localhost), previews
 *    y despliegues sin romper el origen activo.
 * 3. En entornos sin objeto window (SSR, workers, fallbacks): se recurre al dominio canónico.
 */

/**
 * Dominio canónico público oficial de la plataforma EasyTraders24.
 * Exclusivamente con protocolo HTTPS.
 */
export const CANONICAL_PUBLIC_DOMAIN =
  (import.meta.env.VITE_APP_URL as string) || 'https://easytraders24.app';

/**
 * Retorna el origen / URL base canónico de la aplicación.
 * 
 * Prioriza `window.location.origin` si está disponible en el navegador para respetar
 * desarrollo local (localhost:3000), URLs de preview de Cloud Run y el dominio en producción.
 * Si window no está disponible, retorna `CANONICAL_PUBLIC_DOMAIN`.
 */
export function getAppBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return CANONICAL_PUBLIC_DOMAIN;
}
