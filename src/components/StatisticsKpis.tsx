import React from 'react';
import { Wallet, TrendingUp, DollarSign, Layers, Calendar, ArrowUpRight, HelpCircle } from 'lucide-react';
import { UserStatisticsSummary } from '../types';

interface StatisticsKpisProps {
  summary: UserStatisticsSummary['kpis'];
  isCycleOpen: boolean;
  cycleTitle: string;
}

export const StatisticsKpis: React.FC<StatisticsKpisProps> = ({
  summary,
  isCycleOpen,
  cycleTitle,
}) => {
  const formatCop = (val: number) => {
    return `$${Math.round(val).toLocaleString('es-CO')}`;
  };

  const formatUsd = (val: number) => {
    return `$${Math.round(val).toLocaleString('en-US')} USD`;
  };

  const formatPercent = (val: number | null | undefined) => {
    if (val === null || val === undefined || isNaN(val)) return 'N/D';
    return `${val.toFixed(2)}%`;
  };

  const kpis = [
    {
      id: 'cycle-cap',
      title: 'Capital del Ciclo',
      description: `Capital asignado para ${cycleTitle}`,
      value: formatCop(summary.cycleCapitalCop),
      icon: <Wallet className="w-5 h-5 text-blue-400" />,
      colorClass: 'text-blue-400',
    },
    {
      id: 'curr-cap',
      title: 'Capital Actual Activo',
      description: 'Capital en operación actual',
      value: formatCop(summary.currentCapital),
      icon: <Layers className="w-5 h-5 text-cyan-400" />,
      colorClass: 'text-cyan-400',
    },
    {
      id: 'cycle-profit',
      title: 'Ganancia del Ciclo',
      description: `Utilidad neta en ${cycleTitle}`,
      value: formatCop(summary.cycleProfitCop),
      icon: <TrendingUp className="w-5 h-5 text-emerald-400" />,
      colorClass: 'text-emerald-400',
      badge: isCycleOpen ? (
        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-950 text-blue-300 border border-blue-800 animate-pulse">
          Provisional
        </span>
      ) : (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
          Cerrado
        </span>
      ),
    },
    {
      id: 'accum-profit',
      title: 'Ganancia Acumulada',
      description: 'Total del rango seleccionado',
      value: formatCop(summary.accumulatedProfitCop),
      icon: <ArrowUpRight className="w-5 h-5 text-amber-500" />,
      colorClass: 'text-amber-400',
    },
    {
      id: 'cycle-ret',
      title: 'Rentabilidad Ciclo',
      description: `Retorno sobre capital de inicio`,
      value: formatPercent(summary.cycleReturnPercent),
      icon: <TrendingUp className="w-5 h-5 text-purple-400" />,
      colorClass: 'text-purple-400',
    },
    {
      id: 'avg-ret',
      title: 'Rentabilidad Promedio por Ciclo',
      description: 'Promedio de periodos activos',
      value: formatPercent(summary.averageReturnPercent),
      icon: <TrendingUp className="w-5 h-5 text-indigo-400" />,
      colorClass: 'text-indigo-400',
    },
    {
      id: 'usd-operated',
      title: 'Volumen USD Operado',
      description: `Operado en mercado (${cycleTitle})`,
      value: formatUsd(summary.totalUsdOperated),
      icon: <DollarSign className="w-5 h-5 text-slate-400" />,
      colorClass: 'text-slate-300',
    },
    {
      id: 'ops-count',
      title: 'Operaciones del Ciclo',
      description: 'Métrica histórica no consolidada',
      value: 'N/D',
      icon: <HelpCircle className="w-5 h-5 text-slate-500" />,
      colorClass: 'text-slate-500',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map((k) => (
        <div
          key={k.id}
          id={`kpi-card-${k.id}`}
          className="flex flex-col justify-between p-4 rounded-2xl bg-[#090f1d] border border-slate-900 shadow-md shadow-black/30 hover:border-slate-800 transition-colors"
        >
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                {k.title}
              </span>
              <p className={`text-xl font-bold font-mono tracking-tight ${k.colorClass}`}>
                {k.value}
              </p>
            </div>
            <div className="p-2 rounded-xl bg-slate-950 border border-slate-900">
              {k.icon}
            </div>
          </div>
          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-950/60 text-[10px] text-slate-400 font-medium">
            <span>{k.description}</span>
            {k.badge}
          </div>
        </div>
      ))}
    </div>
  );
};
