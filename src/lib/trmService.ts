/**
 * Servicio de TRM (Tasa Representativa del Mercado USD / COP)
 * Soporta consulta automática en tiempo real con proveedores públicos y fallback resiliente,
 * además de permitir modo manual / personalizado para el administrador.
 */

export interface LiveTRMResult {
  rate: number;
  source: string;
  timestamp: string;
  isLive: boolean;
  dateStr: string;
}

/**
 * Consulta la TRM oficial del mercado en tiempo real.
 * Realiza fallback en cascada a múltiples fuentes de alta disponibilidad.
 */
export async function fetchLiveTRM(): Promise<LiveTRMResult> {
  const now = new Date();
  const dateStr = now.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  // 1. Intentar proveedor principal gratuito con CORS abierto: open.er-api.com
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && data.rates && typeof data.rates.COP === 'number' && data.rates.COP > 1000) {
        const rate = Math.round(data.rates.COP * 100) / 100;
        return {
          rate,
          source: 'Mercado de Divisas en Vivo (Open Exchange / FX)',
          timestamp: new Date().toISOString(),
          isLive: true,
          dateStr,
        };
      }
    }
  } catch (err) {
    // Continuar con siguiente proveedor
  }

  // 2. Intentar proveedor secundario: exchangerate-api v4
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && data.rates && typeof data.rates.COP === 'number' && data.rates.COP > 1000) {
        const rate = Math.round(data.rates.COP * 100) / 100;
        return {
          rate,
          source: 'ExchangeRate API Global USD/COP',
          timestamp: new Date().toISOString(),
          isLive: true,
          dateStr,
        };
      }
    }
  } catch (err) {
    // Continuar con siguiente proveedor
  }

  // 3. Intentar API oficial Colombia TRM Vercel
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch('https://trm-colombia.vercel.app/api/trm/current', {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const val = data?.data?.valor || data?.valor;
      if (typeof val === 'number' && val > 1000) {
        return {
          rate: Math.round(val * 100) / 100,
          source: 'Superfinanciera de Colombia (TRM Oficial)',
          timestamp: new Date().toISOString(),
          isLive: true,
          dateStr,
        };
      }
    }
  } catch (err) {
    // Continuar al fallback seguro
  }

// Proveedores fallaron: devolver estado no disponible (prohibido fallback 4028.5)
  return {
    rate: 0,
    source: 'TRM en vivo no disponible',
    timestamp: new Date().toISOString(),
    isLive: false,
    dateStr,
  };
}
