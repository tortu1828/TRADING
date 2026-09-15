import React from 'react';
import { Calendar, Filter } from 'lucide-react';
import { StatisticsRange } from '../types';

interface StatisticsFiltersProps {
  selectedRange: StatisticsRange;
  onRangeChange: (range: StatisticsRange) => void;
  cycles: { cycleId: string; status: string }[];
  selectedCycleId: string;
  onCycleChange: (cycleId: string) => void;
}

export const StatisticsFilters: React.FC<StatisticsFiltersProps> = ({
  selectedRange,
  onRangeChange,
  cycles,
  selectedCycleId,
  onCycleChange,
}) => {
  // Format cycle ID for display (e.g. 2026-09 -> Septiembre 2026)
  const formatCycleDisplay = (id: string) => {
    const parts = id.split('-');
    if (parts.length !== 2) return id;
    const [year, month] = parts;
    const months = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    const mIdx = parseInt(month, 10) - 1;
    return mIdx >= 0 && mIdx < 12 ? `${months[mIdx]} ${year}` : id;
  };

  return (
    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 rounded-2xl bg-[#090f1d] border border-slate-900 shadow-md shadow-black/40">
      {/* Selector de Ciclo para KPI */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full md:w-auto">
        <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase tracking-wider">
          <Calendar className="w-4 h-4 text-amber-500" />
          <span>Ciclo de Análisis:</span>
        </div>
        <select
          id="cycle-select"
          value={selectedCycleId}
          onChange={(e) => onCycleChange(e.target.value)}
          className="w-full sm:w-56 px-3 py-2 text-xs font-medium rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-amber-500 transition cursor-pointer"
        >
          {cycles.map((c) => (
            <option key={c.cycleId} value={c.cycleId}>
              {formatCycleDisplay(c.cycleId)} {c.status === 'OPEN' ? '(En Curso)' : '(Cerrado)'}
            </option>
          ))}
        </select>
      </div>

      {/* Rango de Gráficos */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full md:w-auto border-t md:border-t-0 border-slate-800 pt-3 md:pt-0">
        <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase tracking-wider">
          <Filter className="w-4 h-4 text-blue-400" />
          <span>Rango Gráficos:</span>
        </div>
        <div className="flex flex-wrap gap-1.5 w-full sm:w-auto">
          {(['current', '3', '6', '12', 'all'] as StatisticsRange[]).map((range) => {
            const labels: Record<StatisticsRange, string> = {
              current: 'Ciclo Actual',
              '3': 'Últimos 3',
              '6': 'Últimos 6',
              '12': 'Últimos 12',
              all: 'Histórico',
            };
            const isActive = selectedRange === range;
            return (
              <button
                key={range}
                type="button"
                id={`range-btn-${range}`}
                onClick={() => onRangeChange(range)}
                className={`px-3 py-1.5 text-xs font-bold rounded-xl transition cursor-pointer ${
                  isActive
                    ? 'bg-gradient-to-r from-amber-500 to-yellow-600 text-slate-950 shadow-md shadow-amber-500/10'
                    : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                {labels[range]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
