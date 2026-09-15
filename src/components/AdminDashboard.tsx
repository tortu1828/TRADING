import React, { useState } from 'react';
import {
  TrendingUp,
  DollarSign,
  Users,
  Coins,
  ShieldCheck,
  ArrowUpRight,
  RotateCcw,
  History,
  BarChart3,
  Activity,
  Zap,
  Layers,
  ChevronRight,
  Clock,
  CheckCircle2,
  Bell,
  Sparkles,
  X,
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
import { dataStore } from '../lib/dataStore';
import { formatCOP, formatUSD, formatTRM } from '../lib/financialEngine';
import { firestoreService } from '../lib/firestoreService';

interface AdminDashboardProps {
  onNavigate: (tab: string) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onNavigate }) => {
  const activeCycle = dataStore.getActiveCycle();
  const allUsers = dataStore.getActiveUsers();
  const allCycles = dataStore.getCycles();
  const categoryGroups = dataStore.getCategoryGroups(activeCycle.cycleId);
  const reinvestments = dataStore.getReinvestments().filter((r) => r.status === 'PENDING');
  const investments = dataStore.getInvestments().filter((i) => i.status === 'PENDING');
  const recentLogs = dataStore.getAuditLogs().slice(0, 4);

  const [chartMetric, setChartMetric] = useState<'cop' | 'usd'>('cop');

  // Broadcast Notification States
  const [isBroadcastModalOpen, setIsBroadcastModalOpen] = useState(false);
  const [broadcastStep, setBroadcastStep] = useState<1 | 2 | 3>(1);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [personalizeGreeting, setPersonalizeGreeting] = useState(false);
  const [clientRequestId, setClientRequestId] = useState('');
  const [broadcastResult, setBroadcastResult] = useState<{
    success: boolean;
    status: string;
    broadcastId: string;
    targetUsersCount: number;
    createdNotificationsCount: number;
    notificationsAlreadyExistedCount: number;
    targetsUnavailableCount: number;
    message: string;
  } | null>(null);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);
  const [isSendingBroadcast, setIsSendingBroadcast] = useState(false);

  const handleOpenBroadcastModal = () => {
    setBroadcastTitle('');
    setBroadcastMessage('');
    setPersonalizeGreeting(false);
    setClientRequestId(`req_${Date.now()}_${Math.floor(Math.random() * 1000000)}`);
    setBroadcastResult(null);
    setBroadcastError(null);
    setBroadcastStep(1);
    setIsBroadcastModalOpen(true);
  };

  const handleSendBroadcast = async () => {
    const titleClean = broadcastTitle.trim();
    const msgClean = broadcastMessage.trim();

    if (titleClean.length < 3 || titleClean.length > 80) {
      setBroadcastError('El título debe tener entre 3 y 80 caracteres.');
      return;
    }
    if (msgClean.length < 5 || msgClean.length > 500) {
      setBroadcastError('El mensaje debe tener entre 5 y 500 caracteres.');
      return;
    }

    setBroadcastError(null);
    setIsSendingBroadcast(true);

    try {
      const res = await firestoreService.adminSendBroadcastNotification({
        title: titleClean,
        message: msgClean,
        personalizeGreeting,
        clientRequestId,
      });

      setBroadcastResult(res);
      setBroadcastStep(3);
    } catch (err: any) {
      console.error('[AdminDashboard] Error enviando broadcast:', err);
      setBroadcastError(err.message || 'Ocurrió un error inesperado al enviar la notificación global.');
    } finally {
      setIsSendingBroadcast(false);
    }
  };

  // Totales por bitácora
  const azulUsers = allUsers.filter((u) => u.category === 'AZUL');
  const azulCapital = azulUsers.reduce((sum, u) => sum + u.currentCapital, 0);

  const verdeUsers = allUsers.filter((u) => u.category === 'VERDE');
  const verdeCapital = verdeUsers.reduce((sum, u) => sum + u.currentCapital, 0);

  const negraUsers = allUsers.filter((u) => u.category === 'NEGRA');
  const negraCapital = negraUsers.reduce((sum, u) => sum + u.currentCapital, 0);

  const totalCapital = azulCapital + verdeCapital + negraCapital || 1;
  const azulPct = Math.round((azulCapital / totalCapital) * 100);
  const verdePct = Math.round((verdeCapital / totalCapital) * 100);
  const negraPct = 100 - azulPct - verdePct;

  // Monthly performance dataset for Recharts
  const chartData = allCycles.map((c) => ({
    name: c.name.split(' ')[0],
    grossUsd: c.totalGrossUsd,
    profitCOP_M: Number((c.totalUsersProfitCop / 1_000_000).toFixed(1)),
    adminCOP_M: Number((c.totalAdminCommissionCop / 1_000_000).toFixed(1)),
    totalGrossCOP_M: Number((c.totalGrossCop / 1_000_000).toFixed(1)),
  }));

  const totalPendingRequests = reinvestments.length + investments.length;
  const closureProgressPct =
    activeCycle.totalGroupsCount > 0
      ? Math.round((activeCycle.calculatedGroupsCount / activeCycle.totalGroupsCount) * 100)
      : 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header Bar - Clean & Concise */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-extrabold text-slate-100 tracking-tight">
              Resumen General
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
              {activeCycle.name}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            TRM del ciclo: <span className="font-mono font-bold text-slate-300">{formatTRM(activeCycle.trmApplied)} COP</span> • Cierre al {closureProgressPct}% ({activeCycle.calculatedGroupsCount}/{activeCycle.totalGroupsCount} grupos)
          </p>
        </div>

        <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 sm:gap-2.5 w-full sm:w-auto">
          <button
            onClick={handleOpenBroadcastModal}
            className="min-h-[44px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-95 border border-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
          >
            <Bell className="w-3.5 h-3.5 text-amber-400 animate-pulse shrink-0" />
            <span className="truncate">Notificación Global</span>
          </button>

          <button
            onClick={() => onNavigate('finance')}
            className="min-h-[44px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-95 border border-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
          >
            <Coins className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>Finanzas</span>
          </button>

          <button
            onClick={() => onNavigate('monthly_closure')}
            className="col-span-2 sm:col-span-1 min-h-[44px] flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-bold shadow-md shadow-blue-600/20 transition cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5 shrink-0" />
            <span>Cierre Mensual</span>
            <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
          </button>
        </div>
      </div>

      {/* 4 Core KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Capital Administrado */}
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Capital Administrado</span>
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
              <Coins className="w-3.5 h-3.5" />
            </div>
          </div>
          <div>
            <p className="text-xl sm:text-2xl font-black text-slate-100 font-mono tracking-tight">
              {formatCOP(activeCycle.totalManagedCapital)}
            </p>
            <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-slate-500" />
              <span>{activeCycle.totalUsersActive} Inversionistas activos</span>
            </p>
          </div>
        </div>

        {/* Card 2: Total Operado USD & COP */}
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Rendimiento Generado</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <DollarSign className="w-3.5 h-3.5" />
            </div>
          </div>
          <div>
            <p className="text-xl sm:text-2xl font-black text-emerald-400 font-mono tracking-tight">
              {formatCOP(activeCycle.totalGrossCop)}
            </p>
            <p className="text-xs text-slate-400 mt-1.5 font-mono">
              {formatUSD(activeCycle.totalGrossUsd)} operados en mercado
            </p>
          </div>
        </div>

        {/* Card 3: Ganancia Inversionistas */}
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Para Inversionistas</span>
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
              <TrendingUp className="w-3.5 h-3.5" />
            </div>
          </div>
          <div>
            <p className="text-xl sm:text-2xl font-black text-indigo-300 font-mono tracking-tight">
              {formatCOP(activeCycle.totalUsersProfitCop)}
            </p>
            <p className="text-xs text-slate-400 mt-1.5">
              Ganancia Inversionistas
            </p>
          </div>
        </div>

        {/* Card 4: Comisión Admin */}
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Comisión Admin</span>
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
              <ShieldCheck className="w-3.5 h-3.5" />
            </div>
          </div>
          <div>
            <p className="text-xl sm:text-2xl font-black text-amber-400 font-mono tracking-tight">
              {formatCOP(activeCycle.totalAdminCommissionCop)}
            </p>
            <p className="text-xs text-slate-400 mt-1.5">
              Comisión Operativa
            </p>
          </div>
        </div>
      </div>

      {/* Main Section: Clean Chart + Unified Bitácoras Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Evolución Mensual Chart */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4 border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-blue-400" />
              <div>
                <h3 className="text-sm font-bold text-slate-100">Evolución de Rendimientos</h3>
                <p className="text-[11px] text-slate-400">Histórico mensual consolidado</p>
              </div>
            </div>

            {/* Metric Toggle */}
            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-xs font-medium">
              <button
                type="button"
                onClick={() => setChartMetric('cop')}
                className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                  chartMetric === 'cop'
                    ? 'bg-blue-600 text-white font-bold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                COP ($M)
              </button>
              <button
                type="button"
                onClick={() => setChartMetric('usd')}
                className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                  chartMetric === 'usd'
                    ? 'bg-emerald-600 text-white font-bold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                USD ($)
              </button>
            </div>
          </div>

          {/* Chart Container */}
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <defs>
                  <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="usdGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  unit={chartMetric === 'cop' ? 'M' : '$'}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#090d16',
                    borderColor: '#334155',
                    borderRadius: '0.75rem',
                    fontSize: '12px',
                  }}
                  formatter={(val: any, name: any) => {
                    if (chartMetric === 'cop') {
                      return [`$${val}M COP`, name === 'profitCOP_M' ? 'Ganancia Clientes' : 'Comisión Admin'];
                    }
                    return [`$${val} USD`, 'Volumen Total'];
                  }}
                />
                {chartMetric === 'cop' ? (
                  <>
                    <Area
                      type="monotone"
                      dataKey="profitCOP_M"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#profitGrad)"
                      name="profitCOP_M"
                    />
                    <Area
                      type="monotone"
                      dataKey="adminCOP_M"
                      stroke="#f59e0b"
                      strokeWidth={1.5}
                      fillOpacity={0}
                      name="adminCOP_M"
                    />
                  </>
                ) : (
                  <Area
                    type="monotone"
                    dataKey="grossUsd"
                    stroke="#10b981"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#usdGrad)"
                    name="grossUsd"
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400 mt-3 pt-3 border-t border-slate-800/80">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500" /> Ganancia Inversionistas
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500" /> Comisión Admin
              </span>
            </div>
            <button
              onClick={() => onNavigate('finance')}
              className="text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1 cursor-pointer"
            >
              Ver desglose <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Right 1 Col: Distribución de Bitácoras (Unified & Clean) */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4 border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-slate-100">Distribución por Bitácoras</h3>
                  <p className="text-[11px] text-slate-400">Ventanas de capital activo</p>
                </div>
              </div>
              <button
                onClick={() => onNavigate('bitacoras')}
                className="text-xs text-slate-400 hover:text-white font-medium flex items-center gap-0.5 cursor-pointer"
              >
                Abrir <ChevronRight className="w-3 h-3" />
              </button>
            </div>

            {/* Proportional Stacked Bar */}
            <div className="mb-4">
              <div className="h-3 w-full bg-slate-950 rounded-full overflow-hidden flex p-0.5 gap-0.5 border border-slate-800">
                <div
                  style={{ width: `${Math.max(5, azulPct)}%` }}
                  className="bg-blue-500 rounded-l-full h-full transition-all"
                  title={`Azul: ${azulPct}%`}
                />
                <div
                  style={{ width: `${Math.max(5, verdePct)}%` }}
                  className="bg-emerald-500 h-full transition-all"
                  title={`Verde: ${verdePct}%`}
                />
                <div
                  style={{ width: `${Math.max(5, negraPct)}%` }}
                  className="bg-slate-400 rounded-r-full h-full transition-all"
                  title={`Negra: ${negraPct}%`}
                />
              </div>
            </div>

            {/* 3 Clean Bitácora Rows */}
            <div className="space-y-3">
              {/* Bitácora Azul */}
              <div
                onClick={() => onNavigate('bitacoras')}
                className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-blue-500/50 transition cursor-pointer group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    <span className="text-xs font-bold text-slate-200 group-hover:text-blue-300 transition">
                      Bitácora Azul
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">$4M - $9M</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-slate-100">
                    {formatCOP(azulCapital)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-900">
                  <span>{azulUsers.length} Inversionistas</span>
                  <span className="text-blue-400 font-mono">{categoryGroups.AZUL.length} Grupos</span>
                </div>
              </div>

              {/* Bitácora Verde */}
              <div
                onClick={() => onNavigate('bitacoras')}
                className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-emerald-500/50 transition cursor-pointer group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span className="text-xs font-bold text-slate-200 group-hover:text-emerald-300 transition">
                      Bitácora Verde
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">$10M - $50M</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-slate-100">
                    {formatCOP(verdeCapital)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-900">
                  <span>{verdeUsers.length} Inversionistas</span>
                  <span className="text-emerald-400 font-mono">{categoryGroups.VERDE.length} Grupos</span>
                </div>
              </div>

              {/* Bitácora Negra */}
              <div
                onClick={() => onNavigate('bitacoras')}
                className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-600 transition cursor-pointer group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                    <span className="text-xs font-bold text-slate-200 group-hover:text-slate-100 transition">
                      Bitácora Negra
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">&gt; $60M</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-slate-100">
                    {formatCOP(negraCapital)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-900">
                  <span>{negraUsers.length} Inversionistas</span>
                  <span className="text-slate-300 font-mono">{categoryGroups.NEGRA.length} Grupos</span>
                </div>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 mt-3 text-center">
            Haz clic en una bitácora para gestionar sus cálculos
          </p>
        </div>
      </div>

      {/* Bottom Row: Solicitudes & Auditoría (Clean 2 Columns) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Solicitudes Pendientes */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4 border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold text-slate-100">Solicitudes & Cola de Espera</h3>
                {totalPendingRequests > 0 && (
                  <span className="px-2 py-0.2 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[10px] font-bold">
                    {totalPendingRequests} pendientes
                  </span>
                )}
              </div>
              <button
                onClick={() => onNavigate('reinvestments')}
                className="text-xs text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1 cursor-pointer"
              >
                Ver todo <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>

            <div className="space-y-2.5">
              {reinvestments.length === 0 && investments.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-xs flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500/60" />
                  <span>No hay solicitudes pendientes en este momento.</span>
                </div>
              ) : (
                <>
                  {reinvestments.slice(0, 2).map((req) => (
                    <div
                      key={req.id}
                      className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                            req.modality === 'CAPITAL_INJECTION'
                              ? 'text-emerald-400 bg-emerald-950/80 border-emerald-500/20'
                              : 'text-blue-400 bg-blue-950/80 border-blue-500/20'
                          }`}>
                            {req.modality === 'CAPITAL_INJECTION' ? 'Inyección' : 'Reinversión'}
                          </span>
                          <span className="font-semibold text-slate-200">{req.userName}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 font-mono">
                          Aumento: +{formatCOP(req.totalIncreaseCop || req.reinvestAmountCop)}
                        </p>
                      </div>
                      <button
                        onClick={() => onNavigate('reinvestments')}
                        className="px-2.5 py-1 bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-500/30 rounded-lg text-xs font-semibold transition cursor-pointer"
                      >
                        Gestionar
                      </button>
                    </div>
                  ))}

                  {investments.slice(0, 2).map((inv) => (
                    <div
                      key={inv.id}
                      className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-emerald-400 uppercase bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-500/20">
                            Espera #{inv.queuePosition}
                          </span>
                          <span className="font-semibold text-slate-200">{inv.userName}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 font-mono">
                          Ingreso: {formatCOP(inv.requestedAmountCop)}
                        </p>
                      </div>
                      <button
                        onClick={() => onNavigate('reinvestments')}
                        className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-semibold transition cursor-pointer"
                      >
                        Aprobar
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Auditoría Reciente */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4 border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-slate-100">Actividad Reciente</h3>
              </div>
              <button
                onClick={() => onNavigate('audit')}
                className="text-xs text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1 cursor-pointer"
              >
                Ver auditoría <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>

            <div className="space-y-2">
              {recentLogs.map((log) => (
                <div
                  key={log.id}
                  className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60 flex items-center gap-3 text-xs"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-200 truncate">{log.action}</span>
                      <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(log.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">
                      {log.performedByName} • {log.targetEntity || log.reason || 'Operación registrada'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Envío de Notificación Global */}
      {isBroadcastModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden flex flex-col">
            
            {/* Cabecera de la Modal */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-amber-400" />
                <h2 className="font-bold text-slate-100 text-sm">Enviar Notificación Global</h2>
              </div>
              <button
                onClick={() => setIsBroadcastModalOpen(false)}
                className="text-slate-400 hover:text-slate-100 transition cursor-pointer"
                disabled={isSendingBroadcast}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Cuerpo de la Modal */}
            <div className="p-5 overflow-y-auto max-h-[70vh] space-y-4">
              {broadcastError && (
                <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/30 text-rose-300 text-xs font-semibold leading-relaxed">
                  ⚠️ {broadcastError}
                </div>
              )}

              {/* PASO 1: Formulario de Redacción */}
              {broadcastStep === 1 && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-300">Título del Aviso</label>
                    <input
                      type="text"
                      placeholder="Ej: Mantenimiento programado o Anuncio importante"
                      value={broadcastTitle}
                      onChange={(e) => setBroadcastTitle(e.target.value)}
                      maxLength={80}
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 focus:border-blue-500 text-slate-100 text-xs font-medium placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/30 transition"
                    />
                    <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono">
                      <span>Mínimo 3 caracteres</span>
                      <span>{broadcastTitle.length}/80</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-300">Mensaje</label>
                    <textarea
                      placeholder="Escribe el cuerpo de la notificación aquí..."
                      value={broadcastMessage}
                      onChange={(e) => setBroadcastMessage(e.target.value)}
                      maxLength={500}
                      rows={5}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-blue-500 text-slate-100 text-xs font-medium placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/30 transition resize-none leading-relaxed"
                    />
                    <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono">
                      <span>Mínimo 5 caracteres</span>
                      <span>{broadcastMessage.length}/500</span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/40 border border-slate-800/80 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0 pr-2">
                      <p className="text-xs font-bold text-slate-200">Personalizar con saludo</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Agrega "Hola [Nombre Inversionista]" automáticamente. Usa el nombre real, no alias.
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={personalizeGreeting}
                        onChange={(e) => setPersonalizeGreeting(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4.5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-blue-600 peer-checked:after:bg-slate-100"></div>
                    </label>
                  </div>

                  <div className="p-3.5 rounded-xl bg-blue-950/25 border border-blue-500/30 flex items-center gap-3">
                    <Users className="w-4 h-4 text-blue-400 shrink-0" />
                    <p className="text-xs text-blue-300 font-semibold leading-normal">
                      Esta notificación será enviada a <span className="font-mono text-white font-bold">{allUsers.length}</span> usuarios activos actualmente.
                    </p>
                  </div>
                </div>
              )}

              {/* PASO 2: Confirmación Doble y Previsualización */}
              {broadcastStep === 2 && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800 space-y-3">
                    <div className="flex items-center gap-2 border-b border-slate-800/80 pb-2">
                      <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Previsualización de la Notificación</span>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-200">Título:</h4>
                      <p className="text-xs text-slate-300 font-medium mt-0.5">{broadcastTitle}</p>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-200">Mensaje:</h4>
                      <p className="text-xs text-slate-300 font-medium leading-relaxed mt-0.5 font-mono">
                        {personalizeGreeting ? `Hola [Nombre del Inversionista], ${broadcastMessage}` : broadcastMessage}
                      </p>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-500/30 flex items-start gap-3">
                    <span className="text-amber-400 text-sm mt-0.5">⚠️</span>
                    <div>
                      <p className="text-xs text-amber-300 font-bold leading-normal">Confirmación de Acción Crítica</p>
                      <p className="text-[11px] text-amber-400 leading-relaxed mt-1">
                        Estás a punto de despachar este aviso general a {allUsers.length} destinatarios.
                        El envío es seguro contra fallos e idempotente.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* PASO 3: Estado Final y Resultados */}
              {broadcastStep === 3 && broadcastResult && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800 flex flex-col items-center text-center space-y-2">
                    <div className="w-10 h-10 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center border border-emerald-500/20 animate-bounce">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <h3 className="text-sm font-bold text-slate-100">Envío Procesado Exitosamente</h3>
                    <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
                      Se ha completado el fan-out de notificaciones en el servidor.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800/80 space-y-2.5 font-mono text-[11px]">
                    <div className="flex items-center justify-between text-slate-400">
                      <span>ID del Broadcast:</span>
                      <span className="font-bold text-slate-200">{broadcastResult.broadcastId}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-400 border-t border-slate-800/60 pt-2">
                      <span>Usuarios Objetivo:</span>
                      <span className="font-bold text-slate-200">{broadcastResult.targetUsersCount}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Notificaciones Creadas:</span>
                      <span className="font-bold text-emerald-400">+{broadcastResult.createdNotificationsCount}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Ya Existentes (Idempotente):</span>
                      <span className="font-bold text-blue-400">{broadcastResult.notificationsAlreadyExistedCount}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Omitidos / No Disponibles:</span>
                      <span className="font-bold text-rose-400">{broadcastResult.targetsUnavailableCount}</span>
                    </div>
                  </div>

                  <p className="text-[10px] text-slate-500 leading-relaxed text-center">
                    Nota: Las notificaciones se han guardado en Firestore. El despachador asíncrono PWA ya se encuentra procesando el envío Push FCM en segundo plano.
                  </p>
                </div>
              )}
            </div>

            {/* Pie de la Modal */}
            <div className="px-5 py-4 bg-slate-950/40 border-t border-slate-800 flex items-center justify-end gap-2.5">
              {broadcastStep === 1 && (
                <>
                  <button
                    onClick={() => setIsBroadcastModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer border border-slate-800 transition"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => setBroadcastStep(2)}
                    disabled={broadcastTitle.trim().length < 3 || broadcastMessage.trim().length < 5}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:pointer-events-none text-white text-xs font-bold cursor-pointer transition shadow-md shadow-blue-600/10"
                  >
                    Continuar
                  </button>
                </>
              )}

              {broadcastStep === 2 && (
                <>
                  <button
                    onClick={() => setBroadcastStep(1)}
                    disabled={isSendingBroadcast}
                    className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer border border-slate-800 transition"
                  >
                    Atrás
                  </button>
                  <button
                    onClick={handleSendBroadcast}
                    disabled={isSendingBroadcast}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:pointer-events-none text-white text-xs font-bold cursor-pointer transition shadow-md shadow-emerald-600/10 flex items-center gap-1.5"
                  >
                    {isSendingBroadcast ? (
                      <>
                        <span className="w-3 h-3 border-2 border-slate-100 border-t-transparent rounded-full animate-spin" />
                        <span>Enviando...</span>
                      </>
                    ) : (
                      <>
                        <span>Confirmar Envío</span>
                      </>
                    )}
                  </button>
                </>
              )}

              {broadcastStep === 3 && (
                <button
                  onClick={() => setIsBroadcastModalOpen(false)}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold cursor-pointer transition shadow-md shadow-blue-600/10"
                >
                  Entendido
                </button>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
};
