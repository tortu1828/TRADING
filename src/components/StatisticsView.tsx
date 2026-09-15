import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { dataStore } from '../lib/dataStore';
import { StatisticsRange, UserCycleStatistic, UserStatisticsSummary } from '../types';
import { StatisticsFilters } from './StatisticsFilters';
import { StatisticsKpis } from './StatisticsKpis';
import { StatisticsCharts } from './StatisticsCharts';
import { TrendingUp, BarChart3, ShieldAlert } from 'lucide-react';

interface StatisticsViewProps {
  targetUserUid?: string; // Prop opcional para que el Admin consulte a un inversionista específico
}

export const StatisticsView: React.FC<StatisticsViewProps> = ({ targetUserUid }) => {
  const { currentUser: authUser, isSuperAdmin } = useAuth();
  
  // Determinar el UID objetivo a consultar: SOLO un administrador puede inspeccionar a otro usuario
  const targetUid = (isSuperAdmin && targetUserUid) ? targetUserUid : (authUser?.uid || '');
  
  // Estado para forzar actualización reactiva con dataStore
  const [, setTick] = useState<number>(0);
  useEffect(() => {
    const unsub = dataStore.subscribe(() => {
      setTick((t) => t + 1);
    });
    return () => unsub();
  }, []);

  // Obtener perfil del usuario consultado
  const userProfile = useMemo(() => {
    if (!targetUid) return null;
    return dataStore.getUserById(targetUid);
  }, [targetUid]);

  // Obtener todos los ciclos disponibles ordenados cronológicamente
  const allCycles = useMemo(() => {
    return [...dataStore.getCycles()].sort((a, b) => a.cycleId.localeCompare(b.cycleId));
  }, []);

  // Obtener el ciclo activo actual
  const activeCycle = useMemo(() => {
    return dataStore.getActiveCycle();
  }, []);

  // ID del ciclo seleccionado para detalle KPI
  const [selectedCycleId, setSelectedCycleId] = useState<string>(() => {
    return activeCycle?.cycleId || allCycles[allCycles.length - 1]?.cycleId || '';
  });

  // Filtro de rango temporal para gráficos
  const [selectedRange, setSelectedRange] = useState<StatisticsRange>('6');

  // Asegurar que si cambia el ciclo activo o carga de ciclos, se inicialice correctamente
  useEffect(() => {
    if (!selectedCycleId && allCycles.length > 0) {
      setSelectedCycleId(activeCycle?.cycleId || allCycles[allCycles.length - 1]?.cycleId);
    }
  }, [allCycles, activeCycle, selectedCycleId]);

  // Obtener todos los resultados del usuario en memoria para procesar estadísticas
  const userResultsRaw = useMemo(() => {
    if (!targetUid) return [];
    // Filtrar los resultados asociados al UID objetivo de las colecciones sincronizadas
    return dataStore.getAllUserResults()
      .filter((r) => r.userUid === targetUid || r.userId === targetUid)
      .sort((a, b) => a.cycleId.localeCompare(b.cycleId));
  }, [targetUid]);

  // Mapear los nombres de ciclos para visualización amigable en gráficas
  const getCycleTitle = (id: string) => {
    const parts = id.split('-');
    if (parts.length !== 2) return id;
    const [year, month] = parts;
    const shortMonths = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const idx = parseInt(month, 10) - 1;
    return idx >= 0 && idx < 12 ? `${shortMonths[idx]} ${year.substring(2)}` : id;
  };

  // 1. CALCULAR HISTORIAL COMPLETO DE ESTADÍSTICAS DEL INVERSIONISTA
  const processedStatistics = useMemo<UserCycleStatistic[]>(() => {
    if (userResultsRaw.length === 0) return [];

    return userResultsRaw.map((res, index) => {
      const cycleObj = dataStore.getCycleById(res.cycleId);
      
      // Determinar Capital Siguiente de forma autoritativa (Ciclo N+1)
      let nextCapital: number | 'N/D' = 'N/D';
      if (index < userResultsRaw.length - 1) {
        nextCapital = userResultsRaw[index + 1].cycleCapitalCop;
      } else {
        // En el último ciclo no existe ciclo N+1 posterior; no se infiere de proyecciones
        nextCapital = 'N/D';
      }

      const returnPercent = (res.cycleCapitalCop && res.cycleCapitalCop > 0)
        ? ((res.userProfitCop || 0) / res.cycleCapitalCop) * 100
        : null;

      return {
        cycleId: res.cycleId,
        cycleTitle: getCycleTitle(res.cycleId),
        status: (cycleObj?.status as 'OPEN' | 'CLOSED' | 'REOPENED') || 'CLOSED',
        cycleCapitalCop: res.cycleCapitalCop || 0,
        userProfitCop: res.userProfitCop || 0,
        userProfitUsd: res.userProfitUsd || 0,
        totalUsdOperated: res.totalUsdOperated || 0,
        trmUsed: res.trmUsed || 0,
        cycleCategory: res.cycleCategory || 'AZUL',
        groupCapitalCop: res.groupCapitalCop || 0,
        userPercentage: res.userPercentage || 75,
        adminPercentage: res.adminPercentage || 25,
        nextCapitalCop: nextCapital,
        returnPercent: returnPercent,
      };
    });
  }, [userResultsRaw, targetUid]);

  // 2. FILTRAR HISTORIAL SEGÚN EL RANGO SELECCIONADO PARA LAS GRÁFICAS
  const filteredChartsData = useMemo(() => {
    if (processedStatistics.length === 0) return [];

    if (selectedRange === 'current') {
      const activeStats = processedStatistics.find((s) => s.cycleId === activeCycle?.cycleId);
      return activeStats ? [activeStats] : [];
    }

    if (selectedRange === 'all') {
      return processedStatistics;
    }

    const count = parseInt(selectedRange, 10);
    return processedStatistics.slice(-count);
  }, [processedStatistics, selectedRange, activeCycle]);

  // 3. CALCULAR LOS KPIS PARA EL CICLO SELECCIONADO Y ACUMULADOS
  const statsSummary = useMemo<UserStatisticsSummary['kpis'] | null>(() => {
    if (processedStatistics.length === 0 || !selectedCycleId) return null;

    // Estadísticas del ciclo específico seleccionado
    const selectedStat = processedStatistics.find((s) => s.cycleId === selectedCycleId);
    const fallbackCapital = userProfile?.currentCapital || 0;

    const cycleCapitalCop = selectedStat ? selectedStat.cycleCapitalCop : fallbackCapital;
    const cycleProfitCop = selectedStat ? selectedStat.userProfitCop : 0;
    const cycleReturnPercent = (cycleCapitalCop && cycleCapitalCop > 0)
      ? (cycleProfitCop / cycleCapitalCop) * 100
      : null;
    const cycleUsdOperated = selectedStat ? selectedStat.totalUsdOperated : 0;

    // Ganancia Acumulada calculada estrictamente sobre el rango de los gráficos filtrados
    const accumulatedProfitCop = filteredChartsData.reduce((sum, s) => sum + s.userProfitCop, 0);

    // Rentabilidades promedio por ciclo dentro del rango seleccionado (estrictamente ciclos con cycleCapitalCop > 0)
    const validReturnCycles = filteredChartsData.filter((s) => s.cycleCapitalCop && s.cycleCapitalCop > 0);
    const averageReturnPercent = validReturnCycles.length > 0
      ? validReturnCycles.reduce((sum, s) => sum + (s.userProfitCop / s.cycleCapitalCop * 100), 0) / validReturnCycles.length
      : null;

    // Conteo de ciclos con capital activo
    const cyclesOperatedCount = processedStatistics.filter((s) => s.cycleCapitalCop > 0).length;

    return {
      cycleCapitalCop,
      currentCapital: userProfile?.currentCapital || 0,
      cycleProfitCop,
      accumulatedProfitCop,
      cycleReturnPercent,
      averageReturnPercent,
      totalUsdOperated: cycleUsdOperated,
      cyclesOperatedCount,
    };
  }, [processedStatistics, selectedCycleId, filteredChartsData, userProfile]);

  // Determinar si el ciclo seleccionado actualmente para el detalle de KPI está ABIERTO
  const isSelectedCycleOpen = useMemo(() => {
    const cycleObj = dataStore.getCycleById(selectedCycleId);
    return cycleObj ? cycleObj.status === 'OPEN' || cycleObj.status === 'REOPENED' : false;
  }, [selectedCycleId]);

  const selectedCycleTitle = useMemo(() => {
    return getCycleTitle(selectedCycleId);
  }, [selectedCycleId]);

  // Caso: Inversionista no tiene historial registrado aún
  if (processedStatistics.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30">
            <BarChart3 className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-100">Estadísticas de Inversión</h1>
            <p className="text-xs text-slate-400">Analiza el rendimiento histórico y evolución de tus fondos</p>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl bg-[#090f1d] border border-slate-900 shadow-md">
          <ShieldAlert className="w-10 h-10 text-slate-500 mb-3" />
          <p className="text-sm font-bold text-slate-300">Aún no se registran liquidaciones operativas</p>
          <p className="text-xs text-slate-500 max-w-sm mt-1">
            Los datos estadísticos y gráficos de rentabilidad se activarán automáticamente una vez comience el ciclo de operaciones y se asigne tu capital base.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-600 text-slate-950 shadow-md">
          <BarChart3 className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">
            {targetUserUid ? `Estadísticas de ${userProfile?.fullName || 'Inversionista'}` : 'Mis Estadísticas de Inversión'}
          </h1>
          <p className="text-xs text-slate-400">
            {targetUserUid ? `Código de Cliente: ${userProfile?.userCode || 'N/D'}` : 'Visualización unificada del comportamiento de tu capital'}
          </p>
        </div>
      </div>

      {/* Filtros */}
      <StatisticsFilters
        selectedRange={selectedRange}
        onRangeChange={setSelectedRange}
        cycles={allCycles}
        selectedCycleId={selectedCycleId}
        onCycleChange={setSelectedCycleId}
      />

      {/* KPI Cards */}
      {statsSummary && (
        <StatisticsKpis
          summary={statsSummary}
          isCycleOpen={isSelectedCycleOpen}
          cycleTitle={selectedCycleTitle}
        />
      )}

      {/* Gráficos */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 px-1">
          <TrendingUp className="w-4 h-4 text-amber-500" />
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Tendencias y Evolución Histórica ({selectedRange === 'all' ? 'Completa' : `Últimos ${selectedRange} Ciclos`})
          </h2>
        </div>
        <StatisticsCharts data={filteredChartsData} />
      </div>

      {/* Pie de página con Advertencia Legal/Provisional */}
      {isSelectedCycleOpen && (
        <div className="p-3.5 rounded-xl border border-blue-900/40 bg-blue-950/20 text-[11px] text-blue-400 flex items-start gap-2.5">
          <span className="flex-shrink-0 px-2 py-0.5 rounded-md bg-blue-900/60 text-blue-300 font-bold uppercase tracking-wider text-[9px] mt-0.5">
            Nota
          </span>
          <p>
            Estás visualizando datos del **Ciclo Actual en curso ({selectedCycleTitle})**. Los rendimientos y volúmenes mostrados son provisionales y continuarán actualizándose dinámicamente con las operaciones diarias del fondo hasta el cierre definitivo del ciclo.
          </p>
        </div>
      )}
    </div>
  );
};
