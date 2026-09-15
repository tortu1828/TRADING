import React, { useState, useMemo, useEffect } from 'react';
import { dataStore } from '../lib/dataStore';
import { useAuth } from '../context/AuthContext';
import { StatisticsView } from './StatisticsView';
import {
  Wallet,
  Users,
  TrendingUp,
  Percent,
  DollarSign,
  Search,
  ChevronRight,
  ShieldCheck,
  Calendar,
  Layers,
  BarChart3,
  BarChart
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart as RechartsBarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';

export const AdminStatisticsPanel: React.FC = () => {
  const { isSuperAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<'general' | 'investors'>('general');

  // Estado para forzar re-renderizado reactivo
  const [, setTick] = useState<number>(0);
  useEffect(() => {
    const unsub = dataStore.subscribe(() => {
      setTick((t) => t + 1);
    });
    return () => unsub();
  }, []);

  // ----------------------------------------------------
  // DATOS GENERALES / PLATAFORMA (Resúmenes Financieros)
  // ----------------------------------------------------
  const rawSummaries = useMemo(() => {
    return [...dataStore.getFinancialSummaries()].sort((a, b) => a.cycleId.localeCompare(b.cycleId));
  }, []);

  // Formato para mostrar nombres amigables de ciclos
  const getCycleTitle = (id: string) => {
    const parts = id.split('-');
    if (parts.length !== 2) return id;
    const [year, month] = parts;
    const months = [
      'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
    ];
    const mIdx = parseInt(month, 10) - 1;
    return mIdx >= 0 && mIdx < 12 ? `${months[mIdx]} ${year}` : id;
  };

  // Convertir resúmenes a formato de gráfica
  const chartsData = useMemo(() => {
    return rawSummaries.map((s) => ({
      ...s,
      cycleTitle: getCycleTitle(s.cycleId),
      // Atributos de conversión numéricos garantizados
      totalManagedCapital: s.totalManagedCapital || 0,
      totalUsersProfitCop: s.totalUsersProfitCop || 0,
      totalAdminCommissionCop: s.totalAdminCommissionCop || 0,
      totalGrossCop: s.totalGrossCop || 0,
      totalGrossUsd: s.totalGrossUsd || 0,
    }));
  }, [rawSummaries]);

  // Selección de ciclo para KPIs globales de administración
  const [selectedCycleId, setSelectedCycleId] = useState<string>('');

  useEffect(() => {
    if (rawSummaries.length > 0 && !selectedCycleId) {
      setSelectedCycleId(rawSummaries[rawSummaries.length - 1].cycleId);
    }
  }, [rawSummaries, selectedCycleId]);

  const selectedSummary = useMemo(() => {
    if (!selectedCycleId) return null;
    return rawSummaries.find((s) => s.cycleId === selectedCycleId) || null;
  }, [selectedCycleId, rawSummaries]);

  // Format Helpers
  const formatCop = (val: number) => {
    return `$${Math.round(val).toLocaleString('es-CO')}`;
  };

  const formatUsd = (val: number) => {
    return `$${Math.round(val).toLocaleString('en-US')} USD`;
  };

  // ----------------------------------------------------
  // LISTADO DE INVERSIONISTAS (Búsqueda y Selección)
  // ----------------------------------------------------
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedUserUid, setSelectedUserUid] = useState<string | null>(null);

  // Obtener usuarios inversores activos
  const activeInvestors = useMemo(() => {
    return dataStore.getActiveUsers();
  }, []);

  // Filtrar inversionistas según la búsqueda
  const filteredInvestors = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return activeInvestors;
    return activeInvestors.filter(
      (u) =>
        u.fullName.toLowerCase().includes(q) ||
        u.userCode.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
    );
  }, [activeInvestors, searchQuery]);

  // Volver al listado de inversionistas
  const handleClearSelectedUser = () => {
    setSelectedUserUid(null);
  };

  if (!isSuperAdmin) {
    return (
      <div className="p-6 rounded-2xl bg-[#090f1d] border border-slate-950 flex flex-col items-center justify-center text-center">
        <ShieldCheck className="w-12 h-12 text-rose-500 mb-2" />
        <h3 className="text-sm font-bold text-slate-200">Acceso Restringido</h3>
        <p className="text-xs text-slate-500 mt-1">Este panel de estadísticas consolidadas es exclusivo para administradores del fondo.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Selector de Pestañas Principales */}
      <div className="flex border-b border-slate-900 bg-[#080c16] p-1 rounded-2xl max-w-sm">
        <button
          type="button"
          onClick={() => setActiveTab('general')}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition cursor-pointer ${
            activeTab === 'general'
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/10'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          General de Plataforma
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('investors')}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition cursor-pointer ${
            activeTab === 'investors'
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/10'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Inversionistas ({activeInvestors.length})
        </button>
      </div>

      {/* TAB 1: ESTADÍSTICAS GENERALES DE PLATAFORMA */}
      {activeTab === 'general' && (
        <div className="space-y-6">
          {/* Cabecera y Selector de Ciclo */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-2xl bg-[#090f1d] border border-slate-900 shadow-md">
            <div>
              <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-400" />
                <span>Balances Consolidados del Fondo</span>
              </h2>
              <p className="text-[11px] text-slate-500 font-medium">Inspecciona el comportamiento financiero global</p>
            </div>

            {rawSummaries.length > 0 && (
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Calendar className="w-4 h-4 text-amber-500" />
                <select
                  value={selectedCycleId}
                  onChange={(e) => setSelectedCycleId(e.target.value)}
                  className="w-full sm:w-52 px-3 py-1.5 text-xs font-bold rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-blue-500 transition cursor-pointer"
                >
                  {rawSummaries.map((s) => (
                    <option key={s.cycleId} value={s.cycleId}>
                      Ciclo {getCycleTitle(s.cycleId)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* KPIs Globales */}
          {selectedSummary ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* 1. Capital Administrado */}
              <div className="p-4 rounded-2xl bg-[#090f1d] border border-slate-900 shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Capital Administrado</span>
                  <Wallet className="w-4 h-4 text-blue-400" />
                </div>
                <p className="text-xl font-bold font-mono text-blue-400 mt-2">{formatCop(selectedSummary.totalManagedCapital || 0)}</p>
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-950 text-[10px] text-slate-500 font-medium">
                  <span>Inversionistas Activos:</span>
                  <span className="font-bold text-slate-300 font-mono">{selectedSummary.totalUsersActive || selectedSummary.calculatedUsersCount || 0}</span>
                </div>
              </div>

              {/* 2. Ganancia Bruta Operativa */}
              <div className="p-4 rounded-2xl bg-[#090f1d] border border-slate-900 shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Utilidad Bruta Generada</span>
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                </div>
                <p className="text-xl font-bold font-mono text-emerald-400 mt-2">{formatCop(selectedSummary.totalGrossCop || 0)}</p>
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-950 text-[10px] text-slate-500 font-medium">
                  <span>Rendimiento Promedio Estimado:</span>
                  <span className="font-bold text-slate-300 font-mono">
                    {selectedSummary.totalManagedCapital > 0
                      ? `${((selectedSummary.totalGrossCop || 0) / selectedSummary.totalManagedCapital * 100).toFixed(2)}%`
                      : '0.00%'}
                  </span>
                </div>
              </div>

              {/* 3. Distribución Inversor vs Admin */}
              <div className="p-4 rounded-2xl bg-[#090f1d] border border-slate-900 shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Comisión Administración</span>
                  <Percent className="w-4 h-4 text-amber-500" />
                </div>
                <p className="text-xl font-bold font-mono text-amber-400 mt-2">{formatCop(selectedSummary.totalAdminCommissionCop || 0)}</p>
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-950 text-[10px] text-slate-500 font-medium">
                  <span>Acreditado a Clientes:</span>
                  <span className="font-bold text-slate-300 font-mono">{formatCop(selectedSummary.totalUsersProfitCop || 0)}</span>
                </div>
              </div>

              {/* 4. Volumen USD Global */}
              <div className="p-4 rounded-2xl bg-[#090f1d] border border-slate-900 shadow-md col-span-1 sm:col-span-2 lg:col-span-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Volumen Global de Trading en USD</span>
                  <DollarSign className="w-4 h-4 text-slate-400" />
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <p className="text-xl font-bold font-mono text-slate-100">{formatUsd(selectedSummary.totalGrossUsd || 0)}</p>
                  <span className="text-[11px] text-slate-500 font-bold font-sans">
                    (Equivalente a {formatCop((selectedSummary.totalGrossUsd || 0) * (selectedSummary.totalGrossCop / (selectedSummary.totalGrossUsd || 1) || 4000))} aproximados)
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center rounded-2xl bg-[#090f1d] border border-slate-900">
              <p className="text-sm font-semibold text-slate-400">No hay resúmenes financieros cerrados disponibles</p>
              <p className="text-xs text-slate-500 mt-1">Cierra ciclos de operación en el módulo de cierre de mes para generar reportes generales.</p>
            </div>
          )}

          {/* Gráficas Consolidadas */}
          {chartsData.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Gráfica 1: Capital Administrado por Ciclo */}
              <div className="p-4 rounded-2xl bg-[#090f1d] border border-slate-900 shadow-md">
                <div className="mb-4">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Evolución de Fondos</span>
                  <span className="text-[10px] text-slate-500 font-medium">Capital administrado total por ciclo (COP)</span>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartsData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#0f172a" vertical={false} />
                      <XAxis dataKey="cycleTitle" stroke="#475569" fontSize={10} tickLine={false} />
                      <YAxis stroke="#475569" fontSize={10} tickLine={false} tickFormatter={(v) => `$${(v / 1000000).toFixed(0)}M`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#020617', border: '1px solid #1e293b', borderRadius: '12px' }}
                        labelStyle={{ fontSize: '11px', color: '#94a3b8', fontWeight: 'bold' }}
                        formatter={(val: any) => [formatCop(val), 'Capital']}
                      />
                      <Area type="monotone" dataKey="totalManagedCapital" stroke="#3b82f6" strokeWidth={2} fillOpacity={0.15} fill="url(#colorAdminCapital)" />
                      <defs>
                        <linearGradient id="colorAdminCapital" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Gráfica 2: Distribución de Ganancias (Stacked Bar) */}
              <div className="p-4 rounded-2xl bg-[#090f1d] border border-slate-900 shadow-md">
                <div className="mb-4">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Distribución de Utilidades</span>
                  <span className="text-[10px] text-slate-500 font-medium">Ganancias de inversionistas vs comisiones (COP)</span>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsBarChart data={chartsData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#0f172a" vertical={false} />
                      <XAxis dataKey="cycleTitle" stroke="#475569" fontSize={10} tickLine={false} />
                      <YAxis stroke="#475569" fontSize={10} tickLine={false} tickFormatter={(v) => `$${(v / 1000000).toFixed(0)}M`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#020617', border: '1px solid #1e293b', borderRadius: '12px' }}
                        labelStyle={{ fontSize: '11px', color: '#94a3b8', fontWeight: 'bold' }}
                      />
                      <Bar dataKey="totalUsersProfitCop" stackId="a" fill="#10b981" name="Clientes COP" />
                      <Bar dataKey="totalAdminCommissionCop" stackId="a" fill="#f59e0b" name="Comisión Admin COP" />
                    </RechartsBarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Gráfica 3: Volumen USD Global */}
              <div className="p-4 rounded-2xl bg-[#090f1d] border border-slate-900 shadow-md">
                <div className="mb-4">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Volumen Operado Global</span>
                  <span className="text-[10px] text-slate-500 font-medium">Volumen de trading consolidado (USD)</span>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartsData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#0f172a" vertical={false} />
                      <XAxis dataKey="cycleTitle" stroke="#475569" fontSize={10} tickLine={false} />
                      <YAxis stroke="#475569" fontSize={10} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#020617', border: '1px solid #1e293b', borderRadius: '12px' }}
                        labelStyle={{ fontSize: '11px', color: '#94a3b8', fontWeight: 'bold' }}
                        formatter={(val: any) => [formatUsd(val), 'Volumen USD']}
                      />
                      <Line type="monotone" dataKey="totalGrossUsd" stroke="#14b8a6" strokeWidth={2.5} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CONSULTA INDIVIDUAL DE INVERSIONISTAS */}
      {activeTab === 'investors' && (
        <div className="space-y-6">
          {!selectedUserUid ? (
            <div className="space-y-4">
              {/* Buscador de Inversionista */}
              <div className="relative">
                <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar inversionista por nombre, código de cliente o correo..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-blue-500 transition"
                />
              </div>

              {/* Listado de Inversionistas */}
              <div className="rounded-2xl bg-[#090f1d] border border-slate-900 shadow-md divide-y divide-slate-950">
                {filteredInvestors.length > 0 ? (
                  filteredInvestors.map((u) => (
                    <button
                      key={u.id || u.uid}
                      type="button"
                      id={`select-user-btn-${u.id || u.uid}`}
                      onClick={() => setSelectedUserUid(u.uid || u.id)}
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-900/40 text-left transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-blue-950/40 text-blue-400 font-mono text-[10px] font-bold border border-blue-900/30">
                          {u.userCode || 'INV'}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-200">{u.fullName}</p>
                          <p className="text-[10px] text-slate-500 font-sans">{u.email} • Bitácora {u.category || 'N/D'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 text-slate-500">
                        <span className="text-xs font-bold font-mono text-emerald-400">
                          {formatCop(u.currentCapital || 0)}
                        </span>
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="p-8 text-center text-slate-500 text-xs">
                    No se encontraron inversionistas activos que coincidan con la búsqueda.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Botón de Retorno al Listado */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-900">
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="font-bold text-slate-200">Inspeccionando Cuenta Individual</span>
                </div>
                <button
                  type="button"
                  onClick={handleClearSelectedUser}
                  className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 transition border border-slate-850 cursor-pointer"
                >
                  ← Cambiar de Inversionista
                </button>
              </div>

              {/* Inyección Directa del Módulo de Estadísticas Completo con el UID objetivo */}
              <div className="p-5 rounded-2xl bg-[#070b14] border border-slate-950/60 shadow-inner">
                <StatisticsView targetUserUid={selectedUserUid} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
