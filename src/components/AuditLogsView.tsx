import React, { useState } from 'react';
import {
  History,
  Search,
  Filter,
  ShieldCheck,
  Calendar,
  User,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  FileText,
} from 'lucide-react';
import { dataStore } from '../lib/dataStore';
import { AuditLog } from '../types';

export const AuditLogsView: React.FC = () => {
  const [search, setSearch] = useState('');
  const [selectedAction, setSelectedAction] = useState<string>('ALL');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const logs = dataStore.getAuditLogs();

  const filteredLogs = logs.filter((log) => {
    if (selectedAction !== 'ALL' && log.action !== selectedAction) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        log.performedByName.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q) ||
        (log.reason && log.reason.toLowerCase().includes(q)) ||
        (log.cycleId && log.cycleId.toLowerCase().includes(q))
      );
    }
    return true;
  });

  // Reset to page 1 when filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [search, selectedAction, itemsPerPage]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / itemsPerPage));
  const validCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (validCurrentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, filteredLogs.length);
  const paginatedLogs = filteredLogs.slice(startIndex, endIndex);

  const toggleExpand = (id: string) => {
    setExpandedLogId(expandedLogId === id ? null : id);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-100 flex items-center gap-2">
            <History className="w-6 h-6 text-amber-400" />
            Bitácora de Auditoría & Trazabilidad
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Registro inmutable de todas las acciones financieras, correcciones, envíos y cierres de ciclos
          </p>
        </div>

        <span className="text-xs font-mono px-3 py-1 bg-slate-950 border border-slate-800 text-slate-300 rounded-xl self-start sm:self-auto">
          {filteredLogs.length} eventos auditados
        </span>
      </div>

      {/* Filter Bar */}
      <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por motivo, ciclo, administrador o acción..."
            className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="text-xs text-slate-400 shrink-0 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> Acción:
          </span>
          {[
            { id: 'ALL', label: 'Todas' },
            { id: 'GROUP_CALCULATED', label: 'Cálculo Grupo' },
            { id: 'CALCULATION_CORRECTED', label: 'Corrección' },
            { id: 'NOTIFICATIONS_DISPATCHED', label: 'Notificaciones' },
            { id: 'CYCLE_CLOSED', label: 'Cierre Ciclo' },
            { id: 'TRM_UPDATED', label: 'Cambio TRM' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setSelectedAction(item.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer shrink-0 ${
                selectedAction === item.id
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/30'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Audit Timeline */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-3">
        {filteredLogs.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-xs">
            No se encontraron registros de auditoría para este filtro.
          </div>
        ) : (
          paginatedLogs.map((log) => {
            const isExpanded = expandedLogId === log.id;
            return (
              <div
                key={log.id}
                className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${
                        log.action === 'CALCULATION_CORRECTED'
                          ? 'bg-amber-400 shadow-sm shadow-amber-400/50'
                          : log.action === 'CYCLE_CLOSED'
                          ? 'bg-emerald-400'
                          : log.action === 'NOTIFICATIONS_DISPATCHED'
                          ? 'bg-blue-400'
                          : 'bg-indigo-400'
                      }`}
                    />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-xs font-mono text-slate-100">{log.action}</span>
                        {log.cycleId && (
                          <span className="text-[10px] px-2 py-0.2 rounded bg-slate-800 text-slate-300 font-mono">
                            Ciclo: {log.cycleId}
                          </span>
                        )}
                        {log.reason && (
                          <span className="text-xs text-amber-300 bg-amber-950/40 border border-amber-500/20 px-2 py-0.5 rounded">
                            Motivo: &quot;{log.reason}&quot;
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Ejecutado por <strong className="text-slate-200">{log.performedByName}</strong>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 text-xs text-slate-500">
                    <span className="font-mono text-[11px]">
                      {new Date(log.timestamp).toLocaleString('es-CO', {
                        dateStyle: 'medium',
                        timeStyle: 'medium',
                      })}
                    </span>
                    <button
                      onClick={() => toggleExpand(log.id)}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                      title="Ver carga de datos (Payload)"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Expanded Payload */}
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-2 text-xs font-mono">
                    <div className="flex items-center gap-2 text-slate-400 text-[11px] font-semibold">
                      <FileText className="w-3.5 h-3.5 text-blue-400" />
                      <span>Detalles del Evento (Audit Payload):</span>
                    </div>
                    <pre className="p-3 bg-slate-900 border border-slate-800 rounded-lg text-slate-300 overflow-x-auto text-[11px] leading-relaxed">
                      {JSON.stringify(log.details || {}, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Pagination Bar */}
        {filteredLogs.length > 0 && (
          <div className="pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
            <div className="flex items-center gap-3">
              <span>
                Mostrando <strong className="text-slate-200 font-mono">{startIndex + 1}</strong> -{' '}
                <strong className="text-slate-200 font-mono">{endIndex}</strong> de{' '}
                <strong className="text-slate-200 font-mono">{filteredLogs.length}</strong> eventos
              </span>
              <div className="flex items-center gap-1.5 ml-2">
                <span className="text-[11px] text-slate-500">Por página:</span>
                <select
                  value={itemsPerPage}
                  onChange={(e) => setItemsPerPage(Number(e.target.value))}
                  className="bg-slate-950 border border-slate-800 text-slate-200 font-mono text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={validCurrentPage === 1}
                className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                title="Página Anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="px-3 py-1 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 font-mono font-bold">
                {validCurrentPage} / {totalPages}
              </span>

              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={validCurrentPage === totalPages}
                className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                title="Página Siguiente"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
