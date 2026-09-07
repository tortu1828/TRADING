import React, { useState, useEffect } from 'react';
import {
  X,
  DollarSign,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Zap,
  Edit3,
  Globe,
  Radio,
  ArrowRight,
  TrendingUp,
  Info,
} from 'lucide-react';
import { dataStore } from '../lib/dataStore';
import { useAuth } from '../context/AuthContext';
import { formatTRM } from '../lib/financialEngine';
import { fetchLiveTRM, LiveTRMResult } from '../lib/trmService';

interface EditTRMModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EditTRMModal: React.FC<EditTRMModalProps> = ({ isOpen, onClose }) => {
  const { currentUser } = useAuth();
  const config = dataStore.getConfig();
  const activeCycle = dataStore.getActiveCycle();

  // Mode: 'AUTOMATIC' vs 'MANUAL'
  const [selectedMode, setSelectedMode] = useState<'AUTOMATIC' | 'MANUAL'>(config.trmMode || 'AUTOMATIC');
  const [manualInput, setManualInput] = useState<string>(config.trmConfigured.toString());
  const [liveData, setLiveData] = useState<LiveTRMResult | null>(null);
  const [isFetchingLive, setIsFetchingLive] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Sync or fetch live TRM on open
  useEffect(() => {
    if (isOpen) {
      setSelectedMode(config.trmMode || 'AUTOMATIC');
      setManualInput(config.trmConfigured.toString());
      setError(null);
      setSuccessMsg(null);
      handleRefreshLive();
    }
  }, [isOpen]);

  const handleRefreshLive = async () => {
    setIsFetchingLive(true);
    try {
      const res = await fetchLiveTRM();
      setLiveData(res);

      // Si el modo configurado es automático, sincronizar en el dataStore
      if (config.trmMode === 'AUTOMATIC') {
        dataStore.syncAutomaticTRM(res.rate, res.source);
      }
    } catch (err: any) {
      console.warn('Error fetching live TRM:', err);
    } finally {
      setIsFetchingLive(false);
    }
  };

  if (!isOpen) return null;

  // Acción: Activar Modo Automático
  const handleApplyAutomatic = () => {
    setError(null);
    const rateToUse = liveData?.rate || config.trmMarketRate || config.trmConfigured;
    try {
      dataStore.setTRMMode(
        'AUTOMATIC',
        rateToUse,
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      if (liveData?.source) {
        dataStore.syncAutomaticTRM(rateToUse, liveData.source, true);
      }
      setSelectedMode('AUTOMATIC');
      setSuccessMsg(`¡Modo Automático activado! TRM sincronizada a ${formatTRM(rateToUse)} COP.`);
      setTimeout(() => {
        setSuccessMsg(null);
        onClose();
      }, 1300);
    } catch (err: any) {
      setError(err.message || 'Error al activar modo automático.');
    }
  };

  // Acción: Guardar TRM Manual
  const handleSaveManual = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const num = parseFloat(manualInput.replace(/[^0-9.]/g, ''));

    if (isNaN(num) || num <= 0) {
      setError('Por favor ingresa un valor numérico válido mayor a cero.');
      return;
    }

    try {
      dataStore.updateTRM(
        num,
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      setSelectedMode('MANUAL');
      setSuccessMsg(`¡TRM Manual guardada exitosamente en ${formatTRM(num)} COP!`);
      setTimeout(() => {
        setSuccessMsg(null);
        onClose();
      }, 1300);
    } catch (err: any) {
      setError(err.message || 'Error al actualizar la TRM.');
    }
  };

  const currentRate = config.trmConfigured;
  const marketRate = liveData?.rate || config.trmMarketRate || 4028.50;
  const difference = currentRate - marketRate;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#0b1120] border border-slate-700/80 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative text-slate-100 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-slate-100">Control de TRM</h3>
              <span
                className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${
                  config.trmMode === 'AUTOMATIC'
                    ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300'
                    : 'bg-amber-950/80 border-amber-500/40 text-amber-300'
                }`}
              >
                {config.trmMode === 'AUTOMATIC' ? '⚡ Automático' : '✍️ Manual'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Tasa Representativa del Mercado USD / COP para liquidaciones de capital
            </p>
          </div>
        </div>

        {/* Success Alert */}
        {successMsg && (
          <div className="p-4 rounded-xl bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 flex items-center gap-3 mb-4 animate-in fade-in">
            <CheckCircle2 className="w-6 h-6 shrink-0 text-emerald-400" />
            <p className="text-sm font-medium">{successMsg}</p>
          </div>
        )}

        {/* Status KPI Card */}
        <div className="bg-slate-950/80 p-4 rounded-2xl border border-slate-800 space-y-3 mb-5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-medium">TRM Activa en Liquidaciones:</span>
            <div className="flex items-center gap-2">
              <span className="text-lg font-black font-mono text-amber-300">
                ${formatTRM(currentRate)} COP
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                  config.trmMode === 'AUTOMATIC'
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                }`}
              >
                {config.trmMode === 'AUTOMATIC' ? 'AUTO' : 'MANUAL'}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800/80">
            <span>Ciclo Operativo:</span>
            <span className="font-semibold text-slate-200">
              {activeCycle?.name} ({activeCycle?.status === 'OPEN' ? 'Abierto' : 'Cerrado'})
            </span>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Tasa de Mercado en Vivo:</span>
            <div className="flex items-center gap-1.5 font-mono">
              <span className="font-bold text-slate-200">${formatTRM(marketRate)} COP</span>
              {difference !== 0 && (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                    difference > 0 ? 'text-amber-400 bg-amber-500/10' : 'text-blue-400 bg-blue-500/10'
                  }`}
                >
                  {difference > 0 ? `+${formatTRM(difference)}` : `${formatTRM(difference)}`}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Mode Selector Tabs */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950 rounded-xl border border-slate-800 mb-5">
          <button
            type="button"
            onClick={() => setSelectedMode('AUTOMATIC')}
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition cursor-pointer ${
              selectedMode === 'AUTOMATIC'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-emerald-300" />
            <span>Automático (En Vivo)</span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedMode('MANUAL')}
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition cursor-pointer ${
              selectedMode === 'MANUAL'
                ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5 text-amber-300" />
            <span>Manual (Personalizado)</span>
          </button>
        </div>

        {/* Tab 1: AUTOMATIC MODE */}
        {selectedMode === 'AUTOMATIC' && (
          <div className="space-y-4">
            <div className="bg-slate-950/90 border border-emerald-500/30 rounded-2xl p-4.5 space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </span>
                  <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
                    Sincronización en Tiempo Real
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleRefreshLive}
                  disabled={isFetchingLive}
                  className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-950/60 border border-emerald-500/30 hover:bg-emerald-900/60 px-2.5 py-1 rounded-lg transition cursor-pointer disabled:opacity-50"
                  title="Consultar cotización de mercado actual"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isFetchingLive ? 'animate-spin' : ''}`} />
                  <span>{isFetchingLive ? 'Consultando...' : 'Sincronizar'}</span>
                </button>
              </div>

              <div>
                <div className="text-2xl font-black font-mono text-slate-100 flex items-baseline gap-2">
                  <span>${formatTRM(marketRate)}</span>
                  <span className="text-xs font-bold text-slate-400">COP / USD</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                  <Globe className="w-3 h-3 text-slate-500" />
                  <span>Fuente: {liveData?.source || config.trmSource || 'Mercado Oficial Bancario'}</span>
                </p>
                {config.trmLastSyncedAt && (
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Última sincronización: {new Date(config.trmLastSyncedAt).toLocaleTimeString('es-CO')} (
                    {new Date(config.trmLastSyncedAt).toLocaleDateString('es-CO')})
                  </p>
                )}
              </div>

              <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/20 text-emerald-200 text-xs flex items-start gap-2.5">
                <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span className="text-[11px] leading-relaxed">
                  Al mantener el modo automático activo, el sistema actualiza de manera continua la tasa de cambio con el mercado oficial para convertir todos los USD operados a COP en las liquidaciones mensuales.
                </span>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-xl transition cursor-pointer"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={handleApplyAutomatic}
                className="flex items-center gap-2 px-5 py-2 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-xl shadow-lg shadow-emerald-500/20 transition cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Aplicar TRM Automática</span>
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: MANUAL MODE */}
        {selectedMode === 'MANUAL' && (
          <form onSubmit={handleSaveManual} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  TRM Manual (COP por USD)
                </label>
                <button
                  type="button"
                  onClick={() => setManualInput(marketRate.toString())}
                  className="text-[11px] font-semibold text-amber-400 hover:text-amber-300 transition cursor-pointer flex items-center gap-1"
                  title="Copiar valor de mercado actual"
                >
                  <span>Pegar tasa de mercado (${formatTRM(marketRate)})</span>
                </button>
              </div>

              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-sm">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="1000"
                  max="10000"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-8 pr-4 py-2.5 text-slate-100 font-mono text-base font-bold focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition"
                  placeholder="4028.50"
                  required
                />
              </div>

              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                El valor que ingreses fijará la TRM congelada para todas las nuevas liquidaciones del ciclo activo sin verse alterada por las fluctuaciones del mercado.
              </p>
            </div>

            {/* Quick shortcuts */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="text-[11px] text-slate-500 self-center mr-1">Atajos:</span>
              {[4000, 4050, 4100, 4150, 4200].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setManualInput(val.toString())}
                  className="px-2 py-1 text-[11px] font-mono bg-slate-900 border border-slate-800 hover:border-amber-500/40 text-slate-300 hover:text-amber-300 rounded-lg transition cursor-pointer"
                >
                  ${val}
                </button>
              ))}
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-950/50 border border-red-500/30 text-red-300 flex items-center gap-2 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-800/80">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-xl transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl shadow-lg shadow-amber-500/20 transition cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Guardar TRM Manual</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
