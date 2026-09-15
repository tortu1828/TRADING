import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { UserStatisticsSummary } from '../types';

interface StatisticsChartsProps {
  data: UserStatisticsSummary['charts'];
}

export const StatisticsCharts: React.FC<StatisticsChartsProps> = ({ data }) => {
  // Format monetary values for Tooltip
  const formatCop = (value: number) => {
    return `$${Math.round(value).toLocaleString('es-CO')} COP`;
  };

  const formatUsd = (value: number) => {
    return `$${Math.round(value).toLocaleString('en-US')} USD`;
  };

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl bg-[#090f1d] border border-slate-900">
        <p className="text-sm font-semibold text-slate-400">Sin datos para graficar en este periodo</p>
        <p className="text-xs text-slate-500 mt-1">Carga o realiza operaciones en este ciclo para habilitar las visualizaciones.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* 1. GANANCIA POR CICLO */}
      <div className="p-4 rounded-2xl bg-[#090f1d] border border-slate-900 shadow-lg shadow-black/30">
        <div className="mb-4">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
            Ganancia Neta por Ciclo
          </span>
          <span className="text-[10px] text-slate-500 font-medium">
            Rendimiento neto acreditado (Pesos COP)
          </span>
        </div>
        <div className="h-64 sm:h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#0f172a" vertical={false} />
              <XAxis
                dataKey="cycleTitle"
                stroke="#475569"
                fontSize={10}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#475569"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(val) => `$${(val / 1000000).toFixed(1)}M`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#020617',
                  border: '1px solid #1e293b',
                  borderRadius: '12px',
                }}
                labelStyle={{ fontSize: '11px', fontWeight: 'bold', color: '#94a3b8' }}
                itemStyle={{ fontSize: '11px', color: '#f59e0b' }}
                formatter={(value: any) => [formatCop(value), 'Ganancia COP']}
                cursor={{ fill: '#0f172a', opacity: 0.4 }}
              />
              <Bar dataKey="userProfitCop" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 2. CAPITAL OPERATIVO POR CICLO (Step Area Chart) */}
      <div className="p-4 rounded-2xl bg-[#090f1d] border border-slate-900 shadow-lg shadow-black/30">
        <div className="mb-4">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
            Evolución de Capital
          </span>
          <span className="text-[10px] text-slate-500 font-medium">
            Capital inicial de operación (Escalones discretos)
          </span>
        </div>
        <div className="h-64 sm:h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#0f172a" vertical={false} />
              <XAxis
                dataKey="cycleTitle"
                stroke="#475569"
                fontSize={10}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#475569"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(val) => `$${(val / 1000000).toFixed(0)}M`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#020617',
                  border: '1px solid #1e293b',
                  borderRadius: '12px',
                }}
                labelStyle={{ fontSize: '11px', fontWeight: 'bold', color: '#94a3b8' }}
                itemStyle={{ fontSize: '11px', color: '#3b82f6' }}
                formatter={(value: any) => [formatCop(value), 'Capital COP']}
              />
              <Area
                type="step"
                dataKey="cycleCapitalCop"
                stroke="#3b82f6"
                strokeWidth={2}
                fillOpacity={0.15}
                fill="url(#colorCapital)"
              />
              <defs>
                <linearGradient id="colorCapital" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                </linearGradient>
              </defs>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 3. USD OPERADO POR CICLO (Line Chart) */}
      <div className="p-4 rounded-2xl bg-[#090f1d] border border-slate-900 shadow-lg shadow-black/30">
        <div className="mb-4">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
            Volumen de Trading
          </span>
          <span className="text-[10px] text-slate-500 font-medium">
            Volumen total operado en USD
          </span>
        </div>
        <div className="h-64 sm:h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#0f172a" vertical={false} />
              <XAxis
                dataKey="cycleTitle"
                stroke="#475569"
                fontSize={10}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#475569"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#020617',
                  border: '1px solid #1e293b',
                  borderRadius: '12px',
                }}
                labelStyle={{ fontSize: '11px', fontWeight: 'bold', color: '#94a3b8' }}
                itemStyle={{ fontSize: '11px', color: '#10b981' }}
                formatter={(value: any) => [formatUsd(value), 'Volumen USD']}
              />
              <Line
                type="monotone"
                dataKey="totalUsdOperated"
                stroke="#10b981"
                strokeWidth={2.5}
                dot={{ r: 4, strokeWidth: 1 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
