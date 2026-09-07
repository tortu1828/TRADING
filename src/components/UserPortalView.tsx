import React, { useState } from 'react';
import {
  RotateCcw,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Info,
  Clock,
  BarChart2,
  TrendingUp,
  Wallet,
  Home,
  DollarSign,
  ArrowRight,
  ShieldCheck,
  Building2,
  FileCheck2,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { useAuth } from '../context/AuthContext';
import { dataStore } from '../lib/dataStore';
import { formatCOP, formatUSD, formatTRM, getCategoryForCapital } from '../lib/financialEngine';
import confetti from 'canvas-confetti';

interface UserPortalViewProps {
  activeSection?: string;
  onNavigate?: (tab: string) => void;
}

export const UserPortalView: React.FC<UserPortalViewProps> = ({
  activeSection,
  onNavigate,
}) => {
  const { currentUser } = useAuth();
  const activeCycle = dataStore.getActiveCycle();
  const allCycles = dataStore.getCycles();

  // Internal tab state synchronized with activeSection
  const getTabFromSection = (section?: string): 'summary' | 'history' | 'reinvestment' | 'withdrawals' => {
    if (section === 'portal_history' || section === 'history') return 'history';
    if (section === 'portal_reinvestment' || section === 'reinvestment') return 'reinvestment';
    if (section === 'portal_withdrawals' || section === 'withdrawals') return 'withdrawals';
    return 'summary';
  };

  const [currentTab, setCurrentTab] = useState<'summary' | 'history' | 'reinvestment' | 'withdrawals'>(
    getTabFromSection(activeSection)
  );

  React.useEffect(() => {
    if (activeSection) {
      setCurrentTab(getTabFromSection(activeSection));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [activeSection]);

  const handleTabChange = (tab: 'summary' | 'history' | 'reinvestment' | 'withdrawals') => {
    setCurrentTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (onNavigate) {
      if (tab === 'summary') onNavigate('portal');
      else if (tab === 'history') onNavigate('portal_history');
      else if (tab === 'reinvestment') onNavigate('portal_reinvestment');
      else if (tab === 'withdrawals') onNavigate('portal_withdrawals');
    }
  };

  const [selectedCycleId, setSelectedCycleId] = useState<string>(
    activeCycle ? activeCycle.cycleId : '2026-08'
  );
  const currentCycle = dataStore.getCycleById(selectedCycleId) || activeCycle;

  // Reinvestment Form State
  const [reinvestAmount, setReinvestAmount] = useState<string>('');
  const [reinvestSubmitted, setReinvestSubmitted] = useState<boolean>(false);
  const [reinvestError, setReinvestError] = useState<string | null>(null);

  if (!currentUser) {
    return (
      <div className="p-8 text-center text-slate-400">
        <p>No has seleccionado un usuario para visualizar.</p>
      </div>
    );
  }

  const userResult = dataStore.getUserResultForUser(currentUser.id, selectedCycleId);
  const allUserHistoricalResults = dataStore.getUserResults().filter(
    (r) => r.userId === currentUser.id
  );

  // User Reinvestments and Disbursements
  const userReinvestments = dataStore.getReinvestments().filter(
    (r) => r.userId === currentUser.id
  );
  const userDisbursements = dataStore.getDisbursements().filter(
    (d) => d.userId === currentUser.id
  );

  // Reference TRM for USD calculations
  const referenceTrm =
    userResult?.trmUsed || currentCycle?.trmApplied || activeCycle?.trmApplied || 4028.5;
  const capitalEquivalentUsd = Math.round(currentUser.currentCapital / referenceTrm);

  const numReinvest = parseFloat(reinvestAmount) || 0;
  const simulatedNewCapital = currentUser.currentCapital + numReinvest;
  const simulatedNewCapitalUsd = Math.round(simulatedNewCapital / referenceTrm);

  // User Performance Chart Data
  const userPerformanceData = allUserHistoricalResults.map((r) => ({
    cycle: r.cycleId,
    profitCOP_k: Math.round(r.userProfitCop / 1000),
    profitCOP: r.userProfitCop,
    usdOperated: r.totalUsdOperated,
  }));

  // Aggregated stats for history
  const totalAccumulatedProfitCop = allUserHistoricalResults.reduce(
    (sum, r) => sum + r.userProfitCop,
    0
  );
  const totalAccumulatedUsdOperated = allUserHistoricalResults.reduce(
    (sum, r) => sum + r.totalUsdOperated,
    0
  );
  const avgMonthlyProfitCop =
    allUserHistoricalResults.length > 0
      ? Math.round(totalAccumulatedProfitCop / allUserHistoricalResults.length)
      : 0;

  const handleRequestReinvestment = (e: React.FormEvent) => {
    e.preventDefault();
    setReinvestError(null);
    if (numReinvest <= 0) {
      setReinvestError('Ingresa un monto de reinversión válido mayor a cero.');
      return;
    }

    try {
      dataStore.createReinvestmentRequest(
        currentUser.id,
        selectedCycleId,
        numReinvest,
        0,
        `Reinversión solicitada por portal de inversionista (${currentUser.userCode})`
      );

      setReinvestSubmitted(true);
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.6 },
      });
      setTimeout(() => {
        setReinvestSubmitted(false);
        setReinvestAmount('');
      }, 2500);
    } catch (err: any) {
      setReinvestError(err.message || 'Error al enviar la solicitud.');
    }
  };

  const isCyclePending = !userResult;

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* 1. Profile Header Banner */}
      <div className="p-4 sm:p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-blue-950/60 border border-blue-500/40 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-full bg-gradient-to-l from-emerald-500/5 to-transparent pointer-events-none" />

        <div className="flex items-center gap-3.5 sm:gap-4">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white font-bold text-lg sm:text-xl shadow-lg shadow-blue-600/30 border border-blue-400/30 shrink-0">
            {currentUser.fullName.charAt(0)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg sm:text-xl font-extrabold text-slate-100 truncate">
                {currentUser.fullName}
              </h2>
              <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-blue-950 text-blue-300 border border-blue-500/40">
                {currentUser.userCode}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
              <span>Capital:</span>
              <strong className="text-slate-100 font-mono font-bold">
                {formatCOP(currentUser.currentCapital)}
              </strong>
              <span className="text-slate-600">•</span>
              <span>Equivalente:</span>
              <strong className="text-blue-300 font-mono font-bold">
                ${capitalEquivalentUsd.toLocaleString('es-CO')} USD
              </strong>
            </p>
          </div>
        </div>

        {/* Action Controls - Period Selector */}
        <div className="flex items-center gap-3 self-start md:self-auto w-full sm:w-auto">
          <div className="flex items-center gap-2 bg-slate-950 px-3 py-2 rounded-xl border border-slate-800 w-full sm:w-auto shadow-inner">
            <Calendar className="w-4 h-4 text-blue-400 shrink-0" />
            <span className="text-xs text-slate-400 shrink-0">Período:</span>
            <select
              value={selectedCycleId}
              onChange={(e) => setSelectedCycleId(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-100 focus:outline-none cursor-pointer w-full"
            >
              {allCycles.map((c) => (
                <option key={c.cycleId} value={c.cycleId} className="bg-slate-900 text-slate-100">
                  {c.name} ({c.status})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 2. Top Navigation Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-900/90 backdrop-blur-md rounded-xl border border-slate-800/90 overflow-x-auto">
        <button
          onClick={() => handleTabChange('summary')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
            currentTab === 'summary'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <Home className="w-4 h-4" />
          <span>Inicio & Resumen</span>
        </button>

        <button
          onClick={() => handleTabChange('history')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
            currentTab === 'history'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Historial de Ciclos</span>
          {allUserHistoricalResults.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-300 font-mono">
              {allUserHistoricalResults.length}
            </span>
          )}
        </button>

        <button
          onClick={() => handleTabChange('reinvestment')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
            currentTab === 'reinvestment'
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <RotateCcw className="w-4 h-4 text-emerald-400" />
          <span>Solicitar Reinversión</span>
        </button>

        <button
          onClick={() => handleTabChange('withdrawals')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
            currentTab === 'withdrawals'
              ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <Wallet className="w-4 h-4 text-amber-400" />
          <span>Historial de Retiros</span>
          {userDisbursements.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-300 font-mono">
              {userDisbursements.length}
            </span>
          )}
        </button>
      </div>

      {/* ========================================================================= */}
      {/* VIEW 1: SUMMARY (Inicio & Resumen) */}
      {/* ========================================================================= */}
      {currentTab === 'summary' && (
        <div className="space-y-6">
          {/* Main Result of the Selected Month */}
          {isCyclePending ? (
            <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-3 shadow-xl">
              <Clock className="w-12 h-12 mx-auto text-amber-400/80 animate-pulse" />
              <h3 className="text-base font-bold text-slate-200">
                Liquidación en proceso para {currentCycle?.name || selectedCycleId}
              </h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                Tu capital ({formatCOP(currentUser.currentCapital)}) se encuentra pendiente por liquidar en la mesa de operaciones. En cuanto el administrador complete la liquidación mensual, se acreditará tu rendimiento.
              </p>
            </div>
          ) : (
            <div className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-blue-500/40 shadow-2xl space-y-6 relative overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 flex-wrap gap-2">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-blue-400 font-mono">
                    Liquidación Oficial de Rendimientos
                  </span>
                  <h3 className="text-base sm:text-lg font-black text-slate-100">
                    Período Liquidado: {currentCycle?.name || selectedCycleId}
                  </h3>
                </div>
                <span className="text-xs px-3 py-1 rounded-full bg-emerald-950 border border-emerald-500/40 text-emerald-300 font-mono font-bold shadow-sm shadow-emerald-500/20">
                  ✓ Liquidado Oficial
                </span>
              </div>

              {/* Highlights Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Total USD Operado */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 shadow-sm">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold">Total USD Operado</span>
                  <p className="text-xl sm:text-2xl font-black text-slate-100 font-mono mt-1">
                    {formatUSD(userResult.totalUsdOperated)}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1">Valor mensual íntegro asignado</p>
                </div>

                {/* TRM Aplicada */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 shadow-sm">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold">TRM Liquidación</span>
                  <p className="text-xl sm:text-2xl font-black text-blue-400 font-mono mt-1">
                    {formatTRM(userResult.trmUsed)} COP
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1">Tasa inmutable del período</p>
                </div>

                {/* Total Convertido COP */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 shadow-sm">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold">Total Generado (100%)</span>
                  <p className="text-xl sm:text-2xl font-black text-slate-200 font-mono mt-1">
                    {formatCOP(userResult.totalGrossCop)}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1">USD operado × TRM fija</p>
                </div>

                {/* TU GANANCIA NETA */}
                <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-950/90 to-slate-950 border border-emerald-500/60 shadow-xl shadow-emerald-500/10">
                  <div className="flex items-center justify-between text-emerald-400">
                    <span className="text-[11px] uppercase font-bold tracking-wider">Tu Ganancia Neta</span>
                  </div>
                  <p className="text-xl sm:text-2xl font-black text-emerald-300 font-mono mt-1">
                    {formatCOP(userResult.userProfitCop)}
                  </p>
                  <p className="text-[10px] text-emerald-400/90 font-mono mt-1">
                    Equivalente: {formatUSD(userResult.userProfitUsd).replace('$', '$')} USD
                  </p>
                </div>
              </div>

              {/* Step-by-Step Transparency Roadmap */}
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <Info className="w-4 h-4 text-blue-400" />
                  Flujo de Liquidación y Transparencia
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono">
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <span className="text-slate-500 text-[10px] uppercase font-bold">1. Operación del Mes</span>
                    <p className="text-slate-100 font-bold">{formatUSD(userResult.totalUsdOperated)}</p>
                    <p className="text-[10px] text-slate-400">Total operado en el período</p>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <span className="text-slate-500 text-[10px] uppercase font-bold">2. Conversión a COP</span>
                    <p className="text-blue-300 font-bold">{formatCOP(userResult.totalGrossCop)}</p>
                    <p className="text-[10px] text-slate-400">TRM: {formatTRM(userResult.trmUsed)}</p>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <span className="text-slate-500 text-[10px] uppercase font-bold">3. Tu Ganancia</span>
                    <p className="text-emerald-400 font-bold">{formatCOP(userResult.userProfitCop)}</p>
                    <p className="text-[10px] text-slate-400">Rendimiento neto acreditado</p>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <span className="text-slate-500 text-[10px] uppercase font-bold">4. Comisión de Administración</span>
                    <p className="text-amber-400 font-bold">{formatCOP(userResult.adminCommissionCop)}</p>
                    <p className="text-[10px] text-slate-400">Honorarios de administración</p>
                  </div>
                </div>
              </div>

              {/* Daily Operations Ledger Breakdown */}
              {(() => {
                const userCategory = getCategoryForCapital(currentUser.currentCapital);
                const groupDailyOps = dataStore.getDailyOperations(
                  selectedCycleId,
                  userCategory,
                  currentUser.currentCapital
                );
                if (groupDailyOps.length === 0) return null;

                return (
                  <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-blue-400" />
                        Operaciones Diarias del Ciclo ({groupDailyOps.length} operaciones)
                      </h4>
                      <span className="text-[11px] text-slate-400 font-mono">
                        Total Operado:{' '}
                        <strong className="text-emerald-400">
                          {formatUSD(groupDailyOps.reduce((s, o) => s + o.amountUsd, 0))}
                        </strong>
                      </span>
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-slate-800/80">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-slate-900 text-slate-400 text-[10px] uppercase font-mono border-b border-slate-800">
                          <tr>
                            <th className="py-2.5 px-3"># / Fecha</th>
                            <th className="py-2.5 px-3">Operación (USD)</th>
                            <th className="py-2.5 px-3">Equivalente (COP)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50 font-mono text-[11px]">
                          {groupDailyOps.map((op, idx) => (
                            <tr key={op.id} className="hover:bg-slate-900/40">
                              <td className="py-2 px-3 text-slate-300">
                                <span className="text-slate-500 mr-1.5">{idx + 1}.</span>
                                {op.date}
                              </td>
                              <td className="py-2 px-3 font-bold text-emerald-400">
                                {formatUSD(op.amountUsd)}
                              </td>
                              <td className="py-2 px-3 text-blue-300">
                                {formatCOP(op.amountUsd * userResult.trmUsed)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Quick Action Navigation Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => handleTabChange('history')}
              className="p-4 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-blue-500/50 transition cursor-pointer text-left flex items-center justify-between group shadow-lg"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-200">Historial de Ciclos</h4>
                  <p className="text-[11px] text-slate-400">Ver todos tus cierres liquidados</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-blue-400 group-hover:translate-x-1 transition" />
            </button>

            <button
              onClick={() => handleTabChange('reinvestment')}
              className="p-4 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-emerald-500/50 transition cursor-pointer text-left flex items-center justify-between group shadow-lg"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 group-hover:bg-emerald-600 group-hover:text-white transition">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-200">Solicitar Reinversión</h4>
                  <p className="text-[11px] text-slate-400">Sumar utilidades al capital</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 group-hover:translate-x-1 transition" />
            </button>

            <button
              onClick={() => handleTabChange('withdrawals')}
              className="p-4 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-amber-500/50 transition cursor-pointer text-left flex items-center justify-between group shadow-lg"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 group-hover:bg-amber-600 group-hover:text-white transition">
                  <Wallet className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-200">Historial de Retiros</h4>
                  <p className="text-[11px] text-slate-400">Desembolsos y transferencias</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-amber-400 group-hover:translate-x-1 transition" />
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 2: HISTORY (Historial de Ciclos) */}
      {/* ========================================================================= */}
      {currentTab === 'history' && (
        <div className="space-y-6">
          {/* Historical Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
              <span className="text-[11px] text-slate-400 uppercase font-semibold">Total Ganancias Acumuladas</span>
              <p className="text-xl sm:text-2xl font-black text-emerald-400 font-mono mt-1">
                {formatCOP(totalAccumulatedProfitCop)}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">En todos los ciclos liquidados</p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
              <span className="text-[11px] text-slate-400 uppercase font-semibold">Total USD Operado</span>
              <p className="text-xl sm:text-2xl font-black text-slate-100 font-mono mt-1">
                {formatUSD(totalAccumulatedUsdOperated)}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">Monto acumulado operado</p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
              <span className="text-[11px] text-slate-400 uppercase font-semibold">Promedio por Ciclo</span>
              <p className="text-xl sm:text-2xl font-black text-blue-400 font-mono mt-1">
                {formatCOP(avgMonthlyProfitCop)}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">Rendimiento neto promedio</p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
              <span className="text-[11px] text-slate-400 uppercase font-semibold">Ciclos Cerrados</span>
              <p className="text-xl sm:text-2xl font-black text-amber-400 font-mono mt-1">
                {allUserHistoricalResults.length}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">Períodos auditados</p>
            </div>
          </div>

          {/* Performance Chart */}
          {userPerformanceData.length > 0 && (
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
              <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <BarChart2 className="w-5 h-5 text-blue-400" />
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">Curva de Rendimiento Histórico</h3>
                    <p className="text-[11px] text-slate-400">Evolución de ganancias mensuales acreditadas</p>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/80 px-2.5 py-1 rounded border border-emerald-500/30">
                  {userPerformanceData.length} CICLOS
                </span>
              </div>

              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={userPerformanceData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="histProfitGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="cycle" stroke="#64748b" fontSize={11} tickLine={false} />
                    <YAxis stroke="#64748b" fontSize={11} tickLine={false} unit="k" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        borderColor: '#334155',
                        borderRadius: '0.75rem',
                        fontSize: '12px',
                      }}
                      formatter={(val: any) => [`$${(val * 1000).toLocaleString('es-CO')} COP`, 'Ganancia']}
                    />
                    <Area
                      type="monotone"
                      dataKey="profitCOP_k"
                      stroke="#10b981"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#histProfitGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Full Historical Cycles List */}
          <div className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-base font-bold text-slate-100">Historial Detallado de Ciclos</h3>
                  <p className="text-xs text-slate-400">Todos los períodos oficiales con registro de TRM y rendimiento</p>
                </div>
              </div>
              <span className="text-xs text-slate-400 font-mono">{allUserHistoricalResults.length} registros</span>
            </div>

            {allUserHistoricalResults.length === 0 ? (
              <div className="p-8 text-center text-slate-500 font-sans text-xs">
                No hay historial de ciclos cerrado aún para este usuario.
              </div>
            ) : (
              <>
                {/* Mobile Cards for History */}
                <div className="block sm:hidden divide-y divide-slate-800/60">
                  {allUserHistoricalResults.map((r) => (
                    <div key={r.id} className="py-3.5 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-100 text-sm">{r.cycleId}</span>
                        <span className="font-mono font-bold text-emerald-400 text-sm">
                          {formatCOP(r.userProfitCop)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                        <span>Operado: {formatUSD(r.totalUsdOperated)}</span>
                        <span>TRM: {formatTRM(r.trmUsed)}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Equivalente: {formatUSD(r.userProfitUsd)} USD</span>
                        <span className="text-emerald-400 font-mono text-[10px]">✓ Liquidado</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop Table for History */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                        <th className="pb-3 px-3">Ciclo</th>
                        <th className="pb-3 px-3">Operado USD</th>
                        <th className="pb-3 px-3">TRM Aplicada</th>
                        <th className="pb-3 px-3">Ganancia COP</th>
                        <th className="pb-3 px-3">Ganancia USD</th>
                        <th className="pb-3 px-3 text-right">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {allUserHistoricalResults.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-950/40 transition">
                          <td className="py-3 px-3 font-bold text-slate-200">{r.cycleId}</td>
                          <td className="py-3 px-3 text-slate-300">{formatUSD(r.totalUsdOperated)}</td>
                          <td className="py-3 px-3 text-slate-400">{formatTRM(r.trmUsed)}</td>
                          <td className="py-3 px-3 font-bold text-emerald-400">{formatCOP(r.userProfitCop)}</td>
                          <td className="py-3 px-3 text-blue-300">{formatUSD(r.userProfitUsd)} USD</td>
                          <td className="py-3 px-3 text-right">
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/30">
                              ✓ Liquidado
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 3: REINVESTMENT (Solicitar Reinversión) */}
      {/* ========================================================================= */}
      {currentTab === 'reinvestment' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Formulario de Reinversión */}
            <div className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5">
              <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-600/30 to-teal-600/30 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-100">Solicitar Reinversión de Capital</h3>
                  <p className="text-xs text-slate-400">Reinvierte tus utilidades o suma capital adicional para el próximo ciclo</p>
                </div>
              </div>

              {/* Current Status Overview */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 grid grid-cols-2 gap-3 text-xs font-mono">
                <div>
                  <span className="text-slate-400 block text-[11px]">Capital Actual:</span>
                  <span className="text-slate-200 font-bold text-sm">{formatCOP(currentUser.currentCapital)}</span>
                  <p className="text-[10px] text-blue-400 font-sans mt-0.5">
                    ${capitalEquivalentUsd.toLocaleString('es-CO')} USD
                  </p>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Ganancia Neta Ciclo:</span>
                  <span className="text-emerald-400 font-bold text-sm">
                    {userResult ? formatCOP(userResult.userProfitCop) : '$0 COP'}
                  </span>
                  <p className="text-[10px] text-slate-400 font-sans mt-0.5">
                    {userResult ? `${formatUSD(userResult.userProfitUsd)} USD` : '$0 USD'}
                  </p>
                </div>
              </div>

              {reinvestSubmitted ? (
                <div className="p-5 rounded-2xl bg-emerald-950/70 border border-emerald-500/50 text-emerald-300 text-xs flex items-center gap-3">
                  <CheckCircle2 className="w-7 h-7 text-emerald-400 shrink-0" />
                  <div>
                    <p className="font-bold text-sm text-emerald-200">¡Solicitud de reinversión radicada!</p>
                    <p className="text-[11px] text-emerald-300/90 mt-1">
                      El administrador procesará tu solicitud formal para su acreditación en el siguiente ciclo operativo.
                    </p>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleRequestReinvestment} className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-xs text-emerald-200 leading-relaxed">
                    Con tus ganancias del mes puedes reinvertir o sumar capital adicional a tu fondo operativo. Toda reinversión se efectúa mediante solicitud formal al administrador para su aplicación en el siguiente ciclo.
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-slate-300">
                        Monto a Reinvertir (COP)
                      </label>
                      {numReinvest > 0 && (
                        <span className="text-[11px] text-slate-400 font-mono">
                          {formatCOP(numReinvest)}
                        </span>
                      )}
                    </div>

                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-mono font-bold">$</span>
                      <input
                        type="number"
                        step="50000"
                        min="50000"
                        value={reinvestAmount}
                        onChange={(e) => setReinvestAmount(e.target.value)}
                        placeholder={userResult ? userResult.userProfitCop.toString() : '500000'}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-8 pr-4 py-2.5 text-slate-100 font-mono text-sm focus:outline-none focus:border-emerald-500"
                        required
                      />
                    </div>

                    {userResult && userResult.userProfitCop > 0 && (
                      <button
                        type="button"
                        onClick={() => setReinvestAmount(userResult.userProfitCop.toString())}
                        className="text-[11px] text-emerald-400 hover:text-emerald-300 hover:underline mt-2 font-mono cursor-pointer flex items-center gap-1"
                      >
                        <span>⚡ Reinvertir el 100% de mis ganancias de este mes ({formatCOP(userResult.userProfitCop)})</span>
                      </button>
                    )}
                  </div>

                  {/* Capital projection preview */}
                  {numReinvest > 0 && (
                    <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-2">
                      <div className="flex justify-between text-slate-400">
                        <span>Capital Actual:</span>
                        <span className="font-mono text-slate-200">{formatCOP(currentUser.currentCapital)}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Monto a Sumar:</span>
                        <span className="font-mono text-emerald-400 font-bold">+{formatCOP(numReinvest)}</span>
                      </div>
                      <div className="flex justify-between text-slate-100 font-bold pt-2 border-t border-slate-800">
                        <span>Nuevo Capital Proyectado:</span>
                        <span className="font-mono text-emerald-300">
                          {formatCOP(simulatedNewCapital)} (${simulatedNewCapitalUsd.toLocaleString('es-CO')} USD)
                        </span>
                      </div>
                    </div>
                  )}

                  {reinvestError && (
                    <div className="p-3 rounded-lg bg-red-950/60 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{reinvestError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs shadow-lg shadow-emerald-600/30 transition cursor-pointer flex items-center justify-center gap-2"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Radicar Solicitud de Reinversión</span>
                  </button>
                </form>
              )}
            </div>

            {/* Historial de Solicitudes de Reinversión */}
            <div className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <FileCheck2 className="w-5 h-5 text-emerald-400" />
                  <div>
                    <h3 className="text-base font-bold text-slate-100">Mis Solicitudes de Reinversión</h3>
                    <p className="text-xs text-slate-400">Estado de radicaciones ante el administrador</p>
                  </div>
                </div>
                <span className="text-xs text-slate-400 font-mono">{userReinvestments.length} solicitudes</span>
              </div>

              {userReinvestments.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs">
                  Aún no tienes solicitudes de reinversión radicadas.
                </div>
              ) : (
                <div className="space-y-3">
                  {userReinvestments.map((req) => (
                    <div
                      key={req.id}
                      className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-200">
                          {formatCOP(req.reinvestAmountCop)}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            req.status === 'APPROVED'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                              : req.status === 'PENDING'
                              ? 'bg-amber-950 text-amber-300 border border-amber-500/30'
                              : 'bg-red-950 text-red-300 border border-red-500/30'
                          }`}
                        >
                          {req.status === 'APPROVED'
                            ? 'APROBADA'
                            : req.status === 'PENDING'
                            ? 'PENDIENTE'
                            : 'RECHAZADA'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                        <span>Ciclo: {req.sourceCycleId}</span>
                        <span>Nuevo Capital: {formatCOP(req.newCapitalTargetCop)}</span>
                      </div>
                      {req.notes && (
                        <p className="text-[10px] text-slate-500 pt-1 border-t border-slate-900">
                          {req.notes}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 4: WITHDRAWALS (Historial de Retiros) */}
      {/* ========================================================================= */}
      {currentTab === 'withdrawals' && (
        <div className="space-y-6">
          {/* Institutional Policy Notice */}
          <div className="p-4 sm:p-5 rounded-2xl bg-amber-950/20 border border-amber-500/40 text-xs text-amber-200/90 leading-relaxed shadow-lg flex items-start gap-3.5">
            <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-bold text-slate-100 text-sm">Política Institucional de Desembolsos</h4>
              <p className="text-slate-300">
                Los retiros y desembolsos son liquidados y aprobados directamente por el administrador en cada Cierre Mensual. De acuerdo a la normativa institucional y bancaria:
              </p>
              <ul className="list-disc list-inside space-y-0.5 text-slate-300 mt-1">
                <li>
                  Montos hasta <strong>$10.000.000 COP</strong> se tramitan vía transferencia bancaria oficial (Bancolombia, Davivienda, Nequi).
                </li>
                <li>
                  Montos superiores a <strong>$10.000.000 COP</strong> se entregan obligatoriamente en <strong>efectivo o cheque de gerencia</strong> en la sede principal de tesorería para garantizar la seguridad de los fondos.
                </li>
              </ul>
            </div>
          </div>

          {/* User Disbursements List */}
          <div className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Wallet className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="text-base font-bold text-slate-100">Historial de Retiros y Desembolsos</h3>
                  <p className="text-xs text-slate-400">Todos los pagos tramitados y entregados por la administración</p>
                </div>
              </div>
              <span className="text-xs text-slate-400 font-mono">{userDisbursements.length} registros</span>
            </div>

            {userDisbursements.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <Building2 className="w-10 h-10 mx-auto text-slate-600" />
                <h4 className="text-sm font-semibold text-slate-300">No tienes retiros registrados en este momento</h4>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Tus utilidades permanecen integradas a tu cuenta. Los desembolsos son gestionados y acordados directamente con el administrador durante la fase de liquidación mensual.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {userDisbursements.map((d) => (
                  <div
                    key={d.id}
                    className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5 text-xs shadow-md"
                  >
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-slate-100 font-mono text-base">
                          {formatCOP(d.amountCop)}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            d.method === 'EFECTIVO'
                              ? 'bg-amber-950 text-amber-300 border border-amber-500/30'
                              : 'bg-blue-950 text-blue-300 border border-blue-500/30'
                          }`}
                        >
                          {d.method === 'EFECTIVO' ? 'Efectivo en Taquilla' : 'Transferencia Bancaria'}
                        </span>
                      </div>

                      <span
                        className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                          d.status === 'PAID'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                            : d.status === 'APPROVED'
                            ? 'bg-blue-950 text-blue-300 border border-blue-500/40'
                            : d.status === 'PENDING'
                            ? 'bg-amber-950 text-amber-300 border border-amber-500/40'
                            : 'bg-red-950 text-red-300 border border-red-500/40'
                        }`}
                      >
                        {d.status === 'PAID'
                          ? '✓ PAGADO / ENTREGADO'
                          : d.status === 'APPROVED'
                          ? 'APROBADO POR TESORERÍA'
                          : d.status === 'PENDING'
                          ? 'EN PROCESO DE PAGO'
                          : 'RECHAZADO'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-400 font-mono pt-1">
                      <div>
                        <span className="text-slate-500">Ciclo de Origen: </span>
                        <span className="text-slate-300 font-bold">{d.sourceCycleId}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Fecha: </span>
                        <span className="text-slate-300">{d.createdAt.slice(0, 10)}</span>
                      </div>
                      {d.method === 'TRANSFERENCIA' && (
                        <>
                          <div>
                            <span className="text-slate-500">Banco: </span>
                            <span className="text-slate-300">{d.bankName || 'Bancolombia'}</span>
                          </div>
                          <div>
                            <span className="text-slate-500">Cuenta: </span>
                            <span className="text-slate-300">{d.accountNumber || 'Cuenta Registrada'}</span>
                          </div>
                        </>
                      )}
                      {d.method === 'EFECTIVO' && (
                        <div className="sm:col-span-2">
                          <span className="text-slate-500">Lugar de Entrega: </span>
                          <span className="text-amber-300">{d.cashOffice || 'Sede Principal de Tesorería'}</span>
                        </div>
                      )}
                    </div>

                    {d.notes && (
                      <div className="pt-2 border-t border-slate-900 text-[11px] text-slate-400">
                        <span className="text-slate-500">Observación: </span>
                        <span>{d.notes}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
