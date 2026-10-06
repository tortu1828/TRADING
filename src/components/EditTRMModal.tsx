import React, { useEffect, useState } from 'react';
import {
  Activity,
  RefreshCw,
  X,
} from 'lucide-react';

import { dataStore } from '../lib/dataStore';
import { formatTRM } from '../lib/financialEngine';
import { fetchLiveTRM } from '../lib/trmService';
import type { LiveTRMResult } from '../lib/trmService';

interface EditTRMModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EditTRMModal: React.FC<EditTRMModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [liveData, setLiveData] =
    useState<LiveTRMResult | null>(null);

  const [isFetchingLive, setIsFetchingLive] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const handleRefreshLive = async () => {
    setIsFetchingLive(true);
    setError(null);

    try {
      const result =
        await fetchLiveTRM();

      const source =
        String(
          result.sourceLabel ||
          result.source ||
          ''
        )
          .trim()
          .toLowerCase();

      const rawSource =
        String(result.source || '')
          .trim()
          .toLowerCase();

      const authoritative =
        source === 'dolar-colombia.com' ||
        rawSource === 'dolar_colombia';

      if (
        !authoritative ||
        !Number.isFinite(result.rate) ||
        result.rate <= 1000 ||
        result.rate >= 10000
      ) {
        throw new Error(
          'TRM_SOURCE_INVALID: La fuente recibida no es Dolar-Colombia.'
        );
      }

      const sync =
        dataStore.syncAutomaticTRM(
          result.rate,
          result.sourceLabel ||
            result.source
        );

      if (!sync.applied) {
        throw new Error(
          'TRM_SOURCE_INVALID: La tasa autom?tica fue rechazada.'
        );
      }

      setLiveData(result);

    } catch (err: any) {
      setLiveData(null);

      setError(
        err?.message ||
        'No fue posible consultar la TRM autom?tica.'
      );

    } finally {
      setIsFetchingLive(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void handleRefreshLive();
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const config =
    dataStore.getConfig();

  const cachedRate =
    Number(config.trmMarketRate);

  const cachedSource =
    String(config.trmSource || '')
      .trim()
      .toLowerCase();

  const cachedValid =
    Number.isFinite(cachedRate) &&
    cachedRate > 1000 &&
    cachedRate < 10000 &&
    (
      cachedSource === 'dolar-colombia.com' ||
      cachedSource === 'dolar_colombia'
    );

  const displayedRate =
    liveData?.rate ??
    (
      cachedValid
        ? cachedRate
        : null
    );

  const displayedSource =
    liveData?.sourceLabel ||
    (
      cachedValid
        ? 'Dolar-Colombia.com'
        : 'TRM no disponible'
    );

  const displayedTimestamp =
    liveData?.capturedAt ||
    (
      cachedValid
        ? config.trmLastSyncedAt
        : ''
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-700/80 bg-[#0b1120] p-6 text-slate-100 shadow-2xl">

        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
            <Activity className="h-5 w-5" />
          </div>

          <div>
            <h2 className="text-base font-bold">
              TRM autom?tica
            </h2>

            <p className="text-xs text-slate-400">
              Fuente ?nica: Dolar-Colombia.com
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            TRM actual
          </div>

          <div className="mt-2 font-mono text-3xl font-black text-emerald-300">
            {displayedRate !== null
              ? `$${formatTRM(displayedRate)} COP`
              : 'TRM no disponible'}
          </div>

          <div className="mt-3 space-y-1 text-xs text-slate-400">
            <p>
              Fuente:{' '}
              <strong className="text-slate-200">
                {displayedSource}
              </strong>
            </p>

            {displayedTimestamp && (
              <p>
                ?ltima consulta:{' '}
                {new Date(
                  displayedTimestamp
                ).toLocaleString('es-CO')}
              </p>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-950/30 p-3 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="mt-4 rounded-xl border border-blue-500/20 bg-blue-950/20 p-4 text-xs leading-relaxed text-slate-300">
          <p>
            Cada operaci?n diaria consulta nuevamente la TRM
            en el servidor desde
            <strong className="text-blue-300">
              {' '}Dolar-Colombia.com
            </strong>.
          </p>

          <p className="mt-2">
            La ?nica TRM manual permitida es la
            <strong className="text-amber-300">
              {' '}TRM definitiva de cierre
            </strong>.
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            void handleRefreshLive()
          }
          disabled={isFetchingLive}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw
            className={`h-4 w-4 ${
              isFetchingLive
                ? 'animate-spin'
                : ''
            }`}
          />

          {isFetchingLive
            ? 'Consultando Dolar-Colombia...'
            : 'Actualizar TRM autom?tica'}
        </button>
      </div>
    </div>
  );
};
