import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export interface LiveTRMResult {
  rate: number;
  rateCents: number;
  source: string;
  sourceLabel: string;
  sourceUrl: string;
  timestamp: string;
  capturedAt: string;
  effectiveDate: string;
  isLive: boolean;
  dateStr: string;
}

/**
 * ÚNICA fuente permitida:
 * Dolar-Colombia.com a través de Cloud Functions.
 *
 * El navegador NO extrae la TRM de sitios externos
 * y NO posee fallbacks financieros.
 */
export async function fetchLiveTRM(): Promise<LiveTRMResult> {
  const callable = httpsCallable<
    Record<string, never>,
    {
      success: boolean;
      rate: number;
      rateCents: number;
      source: string;
      sourceLabel: string;
      sourceUrl: string;
      capturedAt: string;
      effectiveDate: string;
      isLive: boolean;
    }
  >(
    functions,
    'getLiveTrmCallable'
  );

  const response = await callable({});

  const data = response.data;

  if (
    !data?.success ||
    !Number.isFinite(data.rate) ||
    data.rate <= 0 ||
    !Number.isInteger(data.rateCents) ||
    data.rateCents !== Math.round(data.rate * 100)
  ) {
    throw new Error(
      'TRM_SOURCE_INVALID: El backend no devolvió una TRM válida.'
    );
  }

  return {
    rate: data.rate,
    rateCents: data.rateCents,
    source: data.source,
    sourceLabel: data.sourceLabel,
    sourceUrl: data.sourceUrl,
    timestamp: data.capturedAt,
    capturedAt: data.capturedAt,
    effectiveDate: data.effectiveDate,
    isLive: data.isLive === true,
    dateStr: data.effectiveDate,
  };
}
