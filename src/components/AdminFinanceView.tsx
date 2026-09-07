import React, { useState, useEffect } from 'react';
import {
  DollarSign,
  Coins,
  TrendingUp,
  ArrowUpRight,
  Layers,
  Calendar,
  Users,
  PieChart as PieChartIcon,
  Download,
  Copy,
  Check,
  RefreshCw,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Building2,
  Wallet,
  Landmark,
  CircleDollarSign,
  BarChart3,
  Percent,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle2,
  X,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  Cell,
  PieChart,
  Pie,
} from 'recharts';
import confetti from 'canvas-confetti';
import { useAuth } from '../context/AuthContext';
import { dataStore } from '../lib/dataStore';
import { formatCOP, formatUSD, formatTRM } from '../lib/financialEngine';
import { BitacoraCategory } from '../types';

interface AdminFinanceViewProps {
  onNavigate?: (tab: string) => void;
}

export const AdminFinanceView: React.FC<AdminFinanceViewProps> = ({ onNavigate }) => {
  const { currentUser } = useAuth();
  const [dataVersion, setDataVersion] = useState(0);
  const [copied, setCopied] = useState(false);
  const [currencyMode, setCurrencyMode] = useState<'BOTH' | 'USD' | 'COP'>('BOTH');
  
  // Selected cycle for detailed analysis
  const cycles = dataStore.getCycles();
  const activeCycle = dataStore.getActiveCycle();
  const [selectedCycleId, setSelectedCycleId] = useState<string>(activeCycle.cycleId);

  // Status message
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Reopen Cycle Modal
  const [showReopenModal, setShowReopenModal] = useState<boolean>(false);
  const [reopenReason, setReopenReason] = useState<string>('');
  const [reopenError, setReopenError] = useState<string | null>(null);

  // Close Cycle Confirmation Modal
  const [showCloseConfirmModal, setShowCloseConfirmModal] = useState<boolean>(false);

  useEffect(() => {
    const unsub = dataStore.subscribe(() => {
      setDataVersion((v) => v + 1);
    });
    return unsub;
  }, []);

  const currentCycle = dataStore.getCycleById(selectedCycleId) || activeCycle;
  const isClosed = currentCycle.status === 'CLOSED';
  const trm = currentCycle.trmApplied;
  const allUsers = dataStore.getActiveUsers();
  const groupCalculations = dataStore.getGroupCalculations(selectedCycleId);
  const userResults = dataStore.getUserResults(selectedCycleId);
  const categoryGroups = dataStore.getCategoryGroups(selectedCycleId);

  // Financial aggregates for the selected cycle
  const totalCapitalCOP = currentCycle.totalManagedCapital;
  const totalCapitalUSD = trm > 0 ? totalCapitalCOP / trm : 0;

  const totalGrossUSD = currentCycle.totalGrossUsd;
  const totalGrossCOP = currentCycle.totalGrossCop;

  const totalClientProfitCOP = currentCycle.totalUsersProfitCop;
  const totalClientProfitUSD = trm > 0 ? totalClientProfitCOP / trm : 0;

  const totalAdminCommissionCOP = currentCycle.totalAdminCommissionCop;
  const totalAdminCommissionUSD = trm > 0 ? totalAdminCommissionCOP / trm : 0;

  const effectiveYieldPct =
    totalCapitalCOP > 0 && totalGrossCOP > 0
      ? ((totalGrossCOP / totalCapitalCOP) * 100).toFixed(2)
      : '0.00';

  // Handle Close Cycle
  const handleExecuteCloseCycle = () => {
    try {
      const res = dataStore.closeCycle(
        selectedCycleId,
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      setShowCloseConfirmModal(false);
      setStatusMessage({
        type: 'success',
        text: `¡Ciclo ${currentCycle.name} cerrado y congelado formalmente con éxito!`,
      });
      confetti({
        particleCount: 70,
        spread: 80,
        origin: { y: 0.6 },
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Error al cerrar el ciclo.',
      });
    }
  };

  // Handle Reopen Cycle
  const handleExecuteReopenCycle = (e: React.FormEvent) => {
    e.preventDefault();
    setReopenError(null);
    if (!reopenReason || reopenReason.trim().length < 5) {
      setReopenError('El motivo de reapertura es obligatorio para el registro de auditoría.');
      return;
    }

    try {
      const res = dataStore.reopenCycle(
        selectedCycleId,
        reopenReason,
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      setShowReopenModal(false);
      setReopenReason('');
      setStatusMessage({
        type: 'success',
        text: res.message,
      });
      confetti({
        particleCount: 60,
        spread: 70,
        origin: { y: 0.6 },
      });
    } catch (err: any) {
      setReopenError(err.message || 'Error al reabrir el ciclo.');
    }
  };

  // Breakdown by Bitácora
  const getBitacoraMetrics = (category: BitacoraCategory) => {
    const groups = categoryGroups[category];
    const categoryUsers = allUsers.filter((u) => u.category === category);
    const capitalCOP = categoryUsers.reduce((sum, u) => sum + u.currentCapital, 0);
    const capitalUSD = trm > 0 ? capitalCOP / trm : 0;

    const calcGroups = groups.filter((g) => g.isCalculated);
    const grossCOP = groups.reduce(
      (sum, g) => sum + (g.calculation ? g.calculation.totalCopPerUser * g.users.length : 0),
      0
    );
    const grossUSD = groups.reduce(
      (sum, g) => sum + (g.calculation ? g.calculation.totalUsdApplied * g.users.length : 0),
      0
    );

    const clientProfitCOP = groups.reduce((sum, g) => sum + g.totalUsersProfitCop, 0);
    const clientProfitUSD = trm > 0 ? clientProfitCOP / trm : 0;

    const adminCommissionCOP = groups.reduce((sum, g) => sum + g.totalAdminCommissionCop, 0);
    const adminCommissionUSD = trm > 0 ? adminCommissionCOP / trm : 0;

    return {
      category,
      capitalCOP,
      capitalUSD,
      grossCOP,
      grossUSD,
      clientProfitCOP,
      clientProfitUSD,
      adminCommissionCOP,
      adminCommissionUSD,
      usersCount: categoryUsers.length,
      groupsCount: groups.length,
      calculatedGroupsCount: calcGroups.length,
      isFullyCalculated: groups.length > 0 && calcGroups.length === groups.length,
    };
  };

  const azulMetrics = getBitacoraMetrics('AZUL');
  const verdeMetrics = getBitacoraMetrics('VERDE');
  const negraMetrics = getBitacoraMetrics('NEGRA');

  // Chart data for historical cycles comparison
  const cyclesChartData = cycles.map((c) => ({
    name: c.name.split(' ')[0],
    fullName: c.name,
    trm: c.trmApplied,
    capitalCOP_M: Number((c.totalManagedCapital / 1_000_000).toFixed(1)),
    capitalUSD: Math.round(c.trmApplied > 0 ? c.totalManagedCapital / c.trmApplied : 0),
    grossUSD: c.totalGrossUsd,
    grossCOP_M: Number((c.totalGrossCop / 1_000_000).toFixed(2)),
    clientProfitCOP_M: Number((c.totalUsersProfitCop / 1_000_000).toFixed(2)),
    adminProfitCOP_M: Number((c.totalAdminCommissionCop / 1_000_000).toFixed(2)),
    clientProfitUSD: Math.round(c.trmApplied > 0 ? c.totalUsersProfitCop / c.trmApplied : 0),
    adminProfitUSD: Math.round(c.trmApplied > 0 ? c.totalAdminCommissionCop / c.trmApplied : 0),
  }));

  // Pie chart distribution data
  const profitSplitPieData = [
    { name: 'Inversionistas', value: totalClientProfitCOP || 75, color: '#10b981' },
    { name: 'Comisión Mesa Admin', value: totalAdminCommissionCOP || 25, color: '#f59e0b' },
  ];

  const bitacoraCapitalPieData = [
    { name: 'Bitácora Azul', value: azulMetrics.capitalCOP, color: '#3b82f6' },
    { name: 'Bitácora Verde', value: verdeMetrics.capitalCOP, color: '#10b981' },
    { name: 'Bitácora Negra', value: negraMetrics.capitalCOP, color: '#94a3b8' },
  ];

  // User rankings
  const topProfitUsers = [...userResults]
    .sort((a, b) => b.userProfitCop - a.userProfitCop)
    .slice(0, 5);

  // Copy executive summary to clipboard
  const handleCopySummary = () => {
    const text = `
📊 RESUMEN EJECUTIVO FINANCIERO - ${currentCycle.name.toUpperCase()}
==================================================
TRM Aplicada: ${formatTRM(trm)}
Rendimiento Efectivo: ~${effectiveYieldPct}%

💼 CAPITAL TOTAL GESTIONADO:
- En COP: ${formatCOP(totalCapitalCOP)}
- En USD: ${formatUSD(totalCapitalUSD)}

📈 RENDIMIENTO BRUTO GENERADO (TRADING):
- En USD Operado: ${formatUSD(totalGrossUSD)}
- En COP Bruto: ${formatCOP(totalGrossCOP)}

👥 DISTRIBUCIÓN INVERSIONISTAS:
- En COP: ${formatCOP(totalClientProfitCOP)}
- En USD Equivalente: ${formatUSD(totalClientProfitUSD)}

👑 COMISIÓN ADMIN / MESA:
- En COP: ${formatCOP(totalAdminCommissionCOP)}
- En USD Equivalente: ${formatUSD(totalAdminCommissionUSD)}

--------------------------------------------------
DESGLOSE POR BITÁCORAS:
• Azul (${azulMetrics.usersCount} users): ${formatCOP(azulMetrics.capitalCOP)} (${formatUSD(azulMetrics.capitalUSD)}) | Ganancia: ${formatCOP(azulMetrics.clientProfitCOP)}
• Verde (${verdeMetrics.usersCount} users): ${formatCOP(verdeMetrics.capitalCOP)} (${formatUSD(verdeMetrics.capitalUSD)}) | Ganancia: ${formatCOP(verdeMetrics.clientProfitCOP)}
• Negra (${negraMetrics.usersCount} users): ${formatCOP(negraMetrics.capitalCOP)} (${formatUSD(negraMetrics.capitalUSD)}) | Ganancia: ${formatCOP(negraMetrics.clientProfitCOP)}
==================================================
Generado por Gestor de Capital V2.1
`.trim();

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Alert Status Banner */}
      {statusMessage && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between gap-3 text-xs font-medium ${
            statusMessage.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300 shadow-lg shadow-emerald-500/10'
              : statusMessage.type === 'error'
              ? 'bg-red-950/70 border-red-500/50 text-red-300 shadow-lg shadow-red-500/10'
              : 'bg-blue-950/70 border-blue-500/50 text-blue-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
            {statusMessage.type === 'error' && <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />}
            <span>{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-slate-400 hover:text-slate-200 cursor-pointer p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Header with Cycle Selector, Action Buttons & Currency Mode Switcher */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950/60 border border-slate-800 shadow-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0 shadow-lg shadow-indigo-600/20">
            <Landmark className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-black text-slate-100 tracking-tight">
                Módulo Financiero & Tesorería
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-950 border border-indigo-500/40 text-indigo-300 font-mono font-bold">
                USD & COP DUAL
              </span>
              {isClosed ? (
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-red-950/80 border border-red-500/40 text-red-300 font-mono font-bold flex items-center gap-1">
                  <Lock className="w-3 h-3" /> CERRADO
                </span>
              ) : (
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-mono font-bold flex items-center gap-1">
                  <Unlock className="w-3 h-3" /> ABIERTO
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Consolidación financiera integral, conversiones por TRM y distribución de utilidades 75/25
            </p>
          </div>
        </div>

        {/* Controls: Cycle Selector, Close Cycle Button & Currency Mode */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Cycle Selector */}
          <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs text-slate-400">Ciclo:</span>
            <select
              value={selectedCycleId}
              onChange={(e) => setSelectedCycleId(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-200 focus:outline-none cursor-pointer"
            >
              {cycles.map((c) => (
                <option key={c.cycleId} value={c.cycleId} className="bg-slate-900 text-slate-200">
                  {c.name} {c.status === 'OPEN' ? '(Abierto)' : '(Cerrado)'}
                </option>
              ))}
            </select>
          </div>

          {/* Currency Display Mode Filter */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setCurrencyMode('BOTH')}
              className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                currencyMode === 'BOTH' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              USD + COP
            </button>
            <button
              onClick={() => setCurrencyMode('USD')}
              className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                currencyMode === 'USD' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Solo USD
            </button>
            <button
              onClick={() => setCurrencyMode('COP')}
              className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                currencyMode === 'COP' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Solo COP
            </button>
          </div>

          {/* Copy Report Button */}
          <button
            onClick={handleCopySummary}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition cursor-pointer shadow-sm"
            title="Copiar resumen financiero al portapapeles"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-bold">¡Copiado!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>Copiar Informe</span>
              </>
            )}
          </button>

          {/* CERRAR CICLO / REABRIR CICLO BOTÓN PRINCIPAL */}
          {!isClosed ? (
            <button
              onClick={() => setShowCloseConfirmModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white rounded-xl text-xs font-extrabold shadow-lg shadow-red-600/30 transition cursor-pointer shrink-0 border border-red-400/30"
              title="Cerrar y congelar este ciclo formalmente"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Cerrar Ciclo</span>
            </button>
          ) : (
            <button
              onClick={() => setShowReopenModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-extrabold rounded-xl text-xs shadow-lg shadow-amber-600/20 transition cursor-pointer shrink-0"
              title="Reabrir ciclo para correcciones"
            >
              <Unlock className="w-3.5 h-3.5" />
              <span>Reabrir Ciclo</span>
            </button>
          )}
        </div>
      </div>

      {/* Cycle Status & Liquidation Banner Bar */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs shadow-md">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <CircleDollarSign className="w-4 h-4 text-emerald-400" />
            <span className="text-slate-400">TRM Oficial del Ciclo:</span>
            <span className="font-mono font-black text-emerald-400 bg-emerald-950/80 px-2.5 py-0.5 rounded-md border border-emerald-500/30">
              1 USD = {formatTRM(trm)}
            </span>
          </div>
          <span className="text-slate-600 hidden sm:inline">•</span>
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-300">
            <span>Rendimiento Estimado: <strong className="text-emerald-400">~{effectiveYieldPct}%</strong></span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onNavigate && (
            <button
              onClick={() => onNavigate('monthly_closure')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 text-xs font-semibold transition cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5 text-blue-400" />
              <span>Mesa de Operaciones (Bitácoras)</span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
            </button>
          )}

          {!isClosed ? (
            <button
              onClick={() => setShowCloseConfirmModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950/80 hover:bg-red-900 text-red-200 border border-red-500/40 text-xs font-bold transition cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5 text-red-400" />
              <span>Cierre Definitivo de Ciclo</span>
            </button>
          ) : (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-950 text-slate-400 border border-slate-800 text-xs font-mono">
              <Lock className="w-3.5 h-3.5 text-red-400" />
              Ciclo Congelado
            </span>
          )}
        </div>
      </div>

      {/* Primary Financial KPI Cards (Dual Currency) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Managed Capital */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800/80 shadow-xl relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Capital Total Gestionado
            </span>
            <div className="w-8 h-8 rounded-lg bg-blue-950 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Building2 className="w-4 h-4" />
            </div>
          </div>

          <div className="mt-3 space-y-1">
            {(currencyMode === 'BOTH' || currencyMode === 'COP') && (
              <p className="text-xl font-black text-slate-100 font-mono">
                {formatCOP(totalCapitalCOP)}
              </p>
            )}
            {(currencyMode === 'BOTH' || currencyMode === 'USD') && (
              <p className="text-sm font-bold text-blue-400 font-mono flex items-center gap-1">
                <span>≈ {formatUSD(totalCapitalUSD)}</span>
                <span className="text-[10px] text-slate-500">USD</span>
              </p>
            )}
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
            <span>{currentCycle.totalUsersActive} inversionistas activos</span>
            <span className="font-mono text-slate-300">Base AUM</span>
          </div>
        </div>

        {/* Card 2: Total Gross Yield (USD Operado & COP) */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800/80 shadow-xl relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Rendimiento Bruto Operado
            </span>
            <div className="w-8 h-8 rounded-lg bg-indigo-950 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>

          <div className="mt-3 space-y-1">
            {(currencyMode === 'BOTH' || currencyMode === 'USD') && (
              <p className="text-xl font-black text-indigo-400 font-mono">
                {formatUSD(totalGrossUSD)}
              </p>
            )}
            {(currencyMode === 'BOTH' || currencyMode === 'COP') && (
              <p className="text-sm font-bold text-slate-200 font-mono flex items-center gap-1">
                <span>≈ {formatCOP(totalGrossCOP)}</span>
                <span className="text-[10px] text-slate-500">COP</span>
              </p>
            )}
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
            <span>Utilidad Total de Trading</span>
            <span className="font-mono text-indigo-400 font-bold">100% Gross</span>
          </div>
        </div>

        {/* Card 3: Investor Distribution */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800/80 shadow-xl relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Ganancia Clientes
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-950 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Users className="w-4 h-4" />
            </div>
          </div>

          <div className="mt-3 space-y-1">
            {(currencyMode === 'BOTH' || currencyMode === 'COP') && (
              <p className="text-xl font-black text-emerald-400 font-mono">
                {formatCOP(totalClientProfitCOP)}
              </p>
            )}
            {(currencyMode === 'BOTH' || currencyMode === 'USD') && (
              <p className="text-sm font-bold text-emerald-300 font-mono flex items-center gap-1">
                <span>≈ {formatUSD(totalClientProfitUSD)}</span>
                <span className="text-[10px] text-slate-500">USD</span>
              </p>
            )}
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
            <span>Pago neto a cuentas</span>
            <span className="font-mono text-emerald-400 font-bold">75.0% Split</span>
          </div>
        </div>

        {/* Card 4: Admin Commission */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800/80 shadow-xl relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Comisión Mesa Admin
            </span>
            <div className="w-8 h-8 rounded-lg bg-amber-950 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Wallet className="w-4 h-4" />
            </div>
          </div>

          <div className="mt-3 space-y-1">
            {(currencyMode === 'BOTH' || currencyMode === 'COP') && (
              <p className="text-xl font-black text-amber-400 font-mono">
                {formatCOP(totalAdminCommissionCOP)}
              </p>
            )}
            {(currencyMode === 'BOTH' || currencyMode === 'USD') && (
              <p className="text-sm font-bold text-amber-300 font-mono flex items-center gap-1">
                <span>≈ {formatUSD(totalAdminCommissionUSD)}</span>
                <span className="text-[10px] text-slate-500">USD</span>
              </p>
            )}
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
            <span>Ingreso neto administración</span>
            <span className="font-mono text-amber-400 font-bold">25.0% Split</span>
          </div>
        </div>
      </div>

      {/* Bitácoras Detailed Financial Matrix (USD & COP) */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden">
        <div className="p-4 sm:p-5 bg-slate-950 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Layers className="w-5 h-5 text-indigo-400" />
            <div>
              <h3 className="text-sm font-extrabold text-slate-100 uppercase tracking-wider">
                Matriz Financiera por Bitácoras de Inversión
              </h3>
              <p className="text-[11px] text-slate-400">
                Desglose monetario paralelo en Pesos Colombianos (COP) y Dólares (USD)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
            <span>3 Bitácoras Activas</span>
            <span>•</span>
            <span className="text-emerald-400">Regla V2.1</span>
          </div>
        </div>

        {/* Mobile Cards View for Bitácoras Matrix (block md:hidden) */}
        <div className="block md:hidden divide-y divide-slate-800/60">
          {/* Bitácora Azul Card */}
          <div className="p-4 space-y-3 bg-slate-900/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-500 shadow-sm" />
                <div>
                  <h4 className="font-bold text-slate-100 text-sm">Bitácora Azul</h4>
                  <p className="text-[10px] text-slate-400">$4.000.000 a &lt;$10.000.000 COP</p>
                </div>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                  azulMetrics.isFullyCalculated
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                    : 'bg-amber-950 text-amber-300 border border-amber-500/30'
                }`}
              >
                {azulMetrics.calculatedGroupsCount}/{azulMetrics.groupsCount} Calc
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
                <span className="text-[10px] text-slate-500 uppercase block font-semibold">Capital Gestionado</span>
                <span className="font-mono font-bold text-slate-100 text-xs mt-0.5 block">{formatCOP(azulMetrics.capitalCOP)}</span>
                <span className="text-[10px] font-mono text-slate-400">{formatUSD(azulMetrics.capitalUSD)} USD</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
                <span className="text-[10px] text-slate-500 uppercase block font-semibold">Bruto Operado</span>
                <span className="font-mono font-bold text-indigo-400 text-xs mt-0.5 block">{formatUSD(azulMetrics.grossUSD)}</span>
                <span className="text-[10px] font-mono text-slate-400">{formatCOP(azulMetrics.grossCOP)}</span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Ganancia Clientes:</span>
                <span className="font-mono font-bold text-emerald-400">{formatCOP(azulMetrics.clientProfitCOP)}</span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
                <span className="text-slate-400">Comisión Admin:</span>
                <span className="font-mono font-bold text-amber-400">{formatCOP(azulMetrics.adminCommissionCOP)}</span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
                <span>Inversionistas: {azulMetrics.usersCount} usuarios</span>
                <span>{azulMetrics.groupsCount} grupos</span>
              </div>
            </div>
          </div>

          {/* Bitácora Verde Card */}
          <div className="p-4 space-y-3 bg-slate-900/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-sm" />
                <div>
                  <h4 className="font-bold text-slate-100 text-sm">Bitácora Verde</h4>
                  <p className="text-[10px] text-slate-400">$10.000.000 a &lt;$60.000.000 COP</p>
                </div>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                  verdeMetrics.isFullyCalculated
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                    : 'bg-amber-950 text-amber-300 border border-amber-500/30'
                }`}
              >
                {verdeMetrics.calculatedGroupsCount}/{verdeMetrics.groupsCount} Calc
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
                <span className="text-[10px] text-slate-500 uppercase block font-semibold">Capital Gestionado</span>
                <span className="font-mono font-bold text-slate-100 text-xs mt-0.5 block">{formatCOP(verdeMetrics.capitalCOP)}</span>
                <span className="text-[10px] font-mono text-slate-400">{formatUSD(verdeMetrics.capitalUSD)} USD</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
                <span className="text-[10px] text-slate-500 uppercase block font-semibold">Bruto Operado</span>
                <span className="font-mono font-bold text-indigo-400 text-xs mt-0.5 block">{formatUSD(verdeMetrics.grossUSD)}</span>
                <span className="text-[10px] font-mono text-slate-400">{formatCOP(verdeMetrics.grossCOP)}</span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Ganancia Clientes:</span>
                <span className="font-mono font-bold text-emerald-400">{formatCOP(verdeMetrics.clientProfitCOP)}</span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
                <span className="text-slate-400">Comisión Admin:</span>
                <span className="font-mono font-bold text-amber-400">{formatCOP(verdeMetrics.adminCommissionCOP)}</span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
                <span>Inversionistas: {verdeMetrics.usersCount} usuarios</span>
                <span>{verdeMetrics.groupsCount} grupos</span>
              </div>
            </div>
          </div>

          {/* Bitácora Negra Card */}
          <div className="p-4 space-y-3 bg-slate-900/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-slate-300 shadow-sm" />
                <div>
                  <h4 className="font-bold text-slate-100 text-sm">Bitácora Negra / Whale</h4>
                  <p className="text-[10px] text-slate-400">$60.000.000 a $4.000.000.000 COP</p>
                </div>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                  negraMetrics.isFullyCalculated
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                    : 'bg-amber-950 text-amber-300 border border-amber-500/30'
                }`}
              >
                {negraMetrics.calculatedGroupsCount}/{negraMetrics.groupsCount} Calc
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
                <span className="text-[10px] text-slate-500 uppercase block font-semibold">Capital Gestionado</span>
                <span className="font-mono font-bold text-slate-100 text-xs mt-0.5 block">{formatCOP(negraMetrics.capitalCOP)}</span>
                <span className="text-[10px] font-mono text-slate-400">{formatUSD(negraMetrics.capitalUSD)} USD</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
                <span className="text-[10px] text-slate-500 uppercase block font-semibold">Bruto Operado</span>
                <span className="font-mono font-bold text-indigo-400 text-xs mt-0.5 block">{formatUSD(negraMetrics.grossUSD)}</span>
                <span className="text-[10px] font-mono text-slate-400">{formatCOP(negraMetrics.grossCOP)}</span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Ganancia Clientes:</span>
                <span className="font-mono font-bold text-emerald-400">{formatCOP(negraMetrics.clientProfitCOP)}</span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
                <span className="text-slate-400">Comisión Admin:</span>
                <span className="font-mono font-bold text-amber-400">{formatCOP(negraMetrics.adminCommissionCOP)}</span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
                <span>Inversionistas: {negraMetrics.usersCount} usuarios</span>
                <span>{negraMetrics.groupsCount} grupos</span>
              </div>
            </div>
          </div>

          {/* Consolidated Total Card */}
          <div className="p-4 bg-slate-950 border-t border-slate-800 space-y-2">
            <div className="flex items-center justify-between font-bold">
              <span className="text-xs uppercase text-slate-400">Total Consolidado</span>
              <span className="text-xs text-emerald-400 font-mono">100% Cuadrado</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs pt-1">
              <div>
                <span className="text-[10px] text-slate-500 uppercase">Capital Total</span>
                <p className="font-bold text-slate-100 font-mono text-xs">{formatCOP(totalCapitalCOP)}</p>
                <p className="text-[10px] text-blue-400 font-mono">{formatUSD(totalCapitalUSD)} USD</p>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 uppercase">Ganancia Clientes</span>
                <p className="font-bold text-emerald-400 font-mono text-xs">{formatCOP(totalClientProfitCOP)}</p>
                <p className="text-[10px] text-emerald-500/80 font-mono">{formatUSD(totalClientProfitUSD)} USD</p>
              </div>
            </div>
          </div>
        </div>

        {/* Desktop Table View (hidden md:block) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/70 text-slate-400 uppercase font-semibold text-[11px] tracking-wider">
                <th className="py-3 px-4">Bitácora / Rango</th>
                <th className="py-3 px-4">Inversionistas</th>
                <th className="py-3 px-4">Capital Gestionado</th>
                <th className="py-3 px-4">Bruto Operado (USD / COP)</th>
                <th className="py-3 px-4">Ganancia Clientes</th>
                <th className="py-3 px-4">Comisión Admin</th>
                <th className="py-3 px-4 text-right">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono">
              {/* Bitacora Azul */}
              <tr className="hover:bg-slate-850/50 transition">
                <td className="py-4 px-4 font-sans">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-blue-500 shadow-sm" />
                    <div>
                      <p className="font-bold text-slate-100 text-sm">Bitácora Azul</p>
                      <p className="text-[11px] text-slate-400">$4.000.000 a &lt;$10.000.000 COP</p>
                    </div>
                  </div>
                </td>
                <td className="py-4 px-4">
                  <span className="px-2 py-0.5 rounded-md bg-blue-950 border border-blue-500/30 text-blue-300 font-bold text-xs">
                    {azulMetrics.usersCount} usuarios
                  </span>
                  <p className="text-[10px] text-slate-500 mt-0.5">{azulMetrics.groupsCount} grupos de capital</p>
                </td>
                <td className="py-4 px-4">
                  <p className="font-bold text-slate-200">{formatCOP(azulMetrics.capitalCOP)}</p>
                  <p className="text-[11px] text-slate-400">{formatUSD(azulMetrics.capitalUSD)} USD</p>
                </td>
                <td className="py-4 px-4">
                  <p className="font-bold text-indigo-400">{formatUSD(azulMetrics.grossUSD)}</p>
                  <p className="text-[11px] text-slate-400">{formatCOP(azulMetrics.grossCOP)}</p>
                </td>
                <td className="py-4 px-4">
                  <p className="font-bold text-emerald-400">{formatCOP(azulMetrics.clientProfitCOP)}</p>
                  <p className="text-[11px] text-emerald-500/80">{formatUSD(azulMetrics.clientProfitUSD)} USD</p>
                </td>
                <td className="py-4 px-4">
                  <p className="font-bold text-amber-400">{formatCOP(azulMetrics.adminCommissionCOP)}</p>
                  <p className="text-[11px] text-amber-500/80">{formatUSD(azulMetrics.adminCommissionUSD)} USD</p>
                </td>
                <td className="py-4 px-4 text-right font-sans">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-mono font-bold ${
                      azulMetrics.isFullyCalculated
                        ? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300'
                        : 'bg-amber-950/80 border border-amber-500/40 text-amber-300'
                    }`}
                  >
                    {azulMetrics.calculatedGroupsCount} / {azulMetrics.groupsCount} Calc
                  </span>
                </td>
              </tr>

              {/* Bitacora Verde */}
              <tr className="hover:bg-slate-850/50 transition">
                <td className="py-4 px-4 font-sans">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-sm" />
                    <div>
                      <p className="font-bold text-slate-100 text-sm">Bitácora Verde</p>
                      <p className="text-[11px] text-slate-400">$10.000.000 a &lt;$60.000.000 COP</p>
                    </div>
                  </div>
                </td>
                <td className="py-4 px-4">
                  <span className="px-2 py-0.5 rounded-md bg-emerald-950 border border-emerald-500/30 text-emerald-300 font-bold text-xs">
                    {verdeMetrics.usersCount} usuarios
                  </span>
                  <p className="text-[10px] text-slate-500 mt-0.5">{verdeMetrics.groupsCount} grupos de capital</p>
                </td>
                <td className="py-4 px-4">
                  <p className="font-bold text-slate-200">{formatCOP(verdeMetrics.capitalCOP)}</p>
                  <p className="text-[11px] text-slate-400">{formatUSD(verdeMetrics.capitalUSD)} USD</p>
                </td>
                <td className="py-4 px-4">
                  <p className="font-bold text-indigo-400">{formatUSD(verdeMetrics.grossUSD)}</p>
                  <p className="text-[11px] text-slate-400">{formatCOP(verdeMetrics.grossCOP)}</p>
                </td>
                <td className="py-4 px-4">
                  <p className="font-bold text-emerald-400">{formatCOP(verdeMetrics.clientProfitCOP)}</p>
                  <p className="text-[11px] text-emerald-500/80">{formatUSD(verdeMetrics.clientProfitUSD)} USD</p>
                </td>
                <td className="py-4 px-4">
                  <p className="font-bold text-amber-400">{formatCOP(verdeMetrics.adminCommissionCOP)}</p>
                  <p className="text-[11px] text-amber-500/80">{formatUSD(verdeMetrics.adminCommissionUSD)} USD</p>
                </td>
                <td className="py-4 px-4 text-right font-sans">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-mono font-bold ${
                      verdeMetrics.isFullyCalculated
                        ? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300'
                        : 'bg-amber-950/80 border border-amber-500/40 text-amber-300'
                    }`}
                  >
                    {verdeMetrics.calculatedGroupsCount} / {verdeMetrics.groupsCount} Calc
                  </span>
                </td>
              </tr>

              {/* Bitacora Negra */}
              <tr className="hover:bg-slate-850/50 transition">
                <td className="py-4 px-4 font-sans">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-slate-300 shadow-sm" />
                    <div>
                      <p className="font-bold text-slate-100 text-sm">Bitácora Negra / Whale</p>
                      <p className="text-[11px] text-slate-400">$60.000.000 a $4.000.000.000 COP</p>
                    </div>
                  </div>
                </td>
                <td className="py-4 px-4">
                  <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-600 text-slate-300 font-bold text-xs">
                    {negraMetrics.usersCount} usuarios
                  </span>
                  <p className="text-[10px] text-slate-500 mt-0.5">{negraMetrics.groupsCount} grupos de capital</p>
                </td>
                <td className="py-4 px-4">
                  <p className="font-bold text-slate-200">{formatCOP(negraMetrics.capitalCOP)}</p>
                  <p className="text-[11px] text-slate-400">{formatUSD(negraMetrics.capitalUSD)} USD</p>
                </td>
                <td className="py-4 px-4">
                  <p className="font-bold text-indigo-400">{formatUSD(negraMetrics.grossUSD)}</p>
                  <p className="text-[11px] text-slate-400">{formatCOP(negraMetrics.grossCOP)}</p>
                </td>
                <td className="py-4 px-4">
                  <p className="font-bold text-emerald-400">{formatCOP(negraMetrics.clientProfitCOP)}</p>
                  <p className="text-[11px] text-emerald-500/80">{formatUSD(negraMetrics.clientProfitUSD)} USD</p>
                </td>
                <td className="py-4 px-4">
                  <p className="font-bold text-amber-400">{formatCOP(negraMetrics.adminCommissionCOP)}</p>
                  <p className="text-[11px] text-amber-500/80">{formatUSD(negraMetrics.adminCommissionUSD)} USD</p>
                </td>
                <td className="py-4 px-4 text-right font-sans">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-mono font-bold ${
                      negraMetrics.isFullyCalculated
                        ? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300'
                        : 'bg-amber-950/80 border border-amber-500/40 text-amber-300'
                    }`}
                  >
                    {negraMetrics.calculatedGroupsCount} / {negraMetrics.groupsCount} Calc
                  </span>
                </td>
              </tr>
            </tbody>

            {/* Total Footer Row */}
            <tfoot className="bg-slate-950 border-t-2 border-slate-800 font-mono font-bold text-slate-100">
              <tr>
                <td className="py-3.5 px-4 font-sans uppercase text-xs">Total Consolidado</td>
                <td className="py-3.5 px-4">{allUsers.length} Inversionistas</td>
                <td className="py-3.5 px-4">
                  <p className="text-slate-100">{formatCOP(totalCapitalCOP)}</p>
                  <p className="text-xs text-blue-400 font-normal">{formatUSD(totalCapitalUSD)}</p>
                </td>
                <td className="py-3.5 px-4">
                  <p className="text-indigo-400">{formatUSD(totalGrossUSD)}</p>
                  <p className="text-xs text-slate-400 font-normal">{formatCOP(totalGrossCOP)}</p>
                </td>
                <td className="py-3.5 px-4">
                  <p className="text-emerald-400">{formatCOP(totalClientProfitCOP)}</p>
                  <p className="text-xs text-emerald-500/80 font-normal">{formatUSD(totalClientProfitUSD)}</p>
                </td>
                <td className="py-3.5 px-4">
                  <p className="text-amber-400">{formatCOP(totalAdminCommissionCOP)}</p>
                  <p className="text-xs text-amber-500/80 font-normal">{formatUSD(totalAdminCommissionUSD)}</p>
                </td>
                <td className="py-3.5 px-4 text-right text-emerald-400">100% Cuadrado</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Charts & Graphs Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Historical Evolution Bar / Area Chart */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-400" />
              <div>
                <h3 className="text-sm font-extrabold text-slate-100 uppercase tracking-wider">
                  Evolución Histórica de Rendimientos (COP & USD)
                </h3>
                <p className="text-[11px] text-slate-400">Comparativa mensual de utilidades repartidas</p>
              </div>
            </div>
            <span className="text-xs font-mono text-slate-500">Últimos ciclos</span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cyclesChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#020617',
                    borderColor: '#334155',
                    borderRadius: '12px',
                    fontSize: '12px',
                  }}
                  formatter={(value: any, name: string) => {
                    if (name === 'Ganancia Clientes (M COP)') return [`$${value}M COP`, name];
                    if (name === 'Comisión Admin (M COP)') return [`$${value}M COP`, name];
                    if (name === 'Operado USD') return [`$${value} USD`, name];
                    return [value, name];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                <Bar dataKey="clientProfitCOP_M" name="Ganancia Clientes (M COP)" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="adminProfitCOP_M" name="Comisión Admin (M COP)" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Profit Split Pie Chart */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2">
              <PieChartIcon className="w-5 h-5 text-emerald-400" />
              <div>
                <h3 className="text-sm font-extrabold text-slate-100 uppercase tracking-wider">
                  Distribución de Utilidades
                </h3>
                <p className="text-[11px] text-slate-400">Mesa de Operaciones</p>
              </div>
            </div>

            <div className="h-44 w-full mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={profitSplitPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {profitSplitPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#020617',
                      borderColor: '#334155',
                      borderRadius: '12px',
                      fontSize: '12px',
                    }}
                    formatter={(val: any) => [formatCOP(Number(val)), 'Total']}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-800 text-xs font-mono">
            <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/20">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-slate-300">Inversionistas</span>
              </div>
              <span className="font-bold text-emerald-400">{formatCOP(totalClientProfitCOP)}</span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-amber-950/40 border border-amber-500/20">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-slate-300">Admin Mesa</span>
              </div>
              <span className="font-bold text-amber-400">{formatCOP(totalAdminCommissionCOP)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL: Confirm Close Cycle */}
      {showCloseConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-red-950/80 border border-red-500/50 flex items-center justify-center text-red-400">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-100">
                    Cierre Definitivo del Ciclo
                  </h3>
                  <p className="text-xs text-slate-400 font-mono">{currentCycle.name}</p>
                </div>
              </div>
              <button
                onClick={() => setShowCloseConfirmModal(false)}
                className="text-slate-400 hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-red-950/40 border border-red-500/30 text-xs text-red-200 space-y-2">
              <div className="flex items-center gap-2 font-bold text-red-300">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Advertencia de Auditoría y Congelamiento</span>
              </div>
              <p className="leading-relaxed">
                Al cerrar el ciclo, se congelan todos los cálculos financieros, se formaliza la distribución 75/25 y se bloquean modificaciones de capital hasta una reapertura auditada.
              </p>
            </div>

            {/* Financial Summary Breakdown */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5 text-xs font-mono">
              <div className="flex justify-between text-slate-400">
                <span>Capital Total Gestionado:</span>
                <span className="text-slate-100 font-bold">{formatCOP(totalCapitalCOP)}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Rendimiento Bruto Operado:</span>
                <span className="text-indigo-400 font-bold">{formatUSD(totalGrossUSD)} ({formatCOP(totalGrossCOP)})</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Ganancia Neta Inversionistas:</span>
                <span className="text-emerald-400 font-bold">{formatCOP(totalClientProfitCOP)}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Comisión Mesa Admin:</span>
                <span className="text-amber-400 font-bold">{formatCOP(totalAdminCommissionCOP)}</span>
              </div>
              <div className="flex justify-between text-slate-400 pt-2 border-t border-slate-800">
                <span>Tasa TRM Aplicada:</span>
                <span className="text-slate-200 font-bold">{formatTRM(trm)}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCloseConfirmModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecuteCloseCycle}
                className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white rounded-xl text-xs font-extrabold shadow-lg shadow-red-600/30 transition cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Confirmar y Cerrar Ciclo</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Reopen Cycle */}
      {showReopenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-amber-950/80 border border-amber-500/50 flex items-center justify-center text-amber-400">
                  <Unlock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-100">
                    Reabrir Ciclo Congelado
                  </h3>
                  <p className="text-xs text-slate-400 font-mono">{currentCycle.name}</p>
                </div>
              </div>
              <button
                onClick={() => setShowReopenModal(false)}
                className="text-slate-400 hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleExecuteReopenCycle} className="space-y-4">
              <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200">
                Para reabrir este ciclo financiero cerrado se requiere justificación obligatoria para la bitácora de auditoría.
              </div>

              {reopenError && (
                <div className="p-3 rounded-lg bg-red-950/80 border border-red-500/50 text-red-200 text-xs">
                  {reopenError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Motivo de reapertura (Auditoría obligatoria):
                </label>
                <textarea
                  rows={3}
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  placeholder="Ej: Corrección autorizada del rendimiento en Grupo 3 de Bitácora Verde..."
                  className="w-full p-3 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-amber-500 resize-none font-mono"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowReopenModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-2 px-5 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 rounded-xl text-xs font-extrabold shadow-lg shadow-amber-600/30 transition cursor-pointer"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  <span>Reabrir Ciclo</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
