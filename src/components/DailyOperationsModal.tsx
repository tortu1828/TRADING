import React, { useState } from 'react';
import {
  X,
  Plus,
  Trash2,
  Calendar,
  DollarSign,
  TrendingUp,
  Clock,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  FileText,
  Activity,
  Layers,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import { BitacoraCategory, CategoryGroupInfo, DailyGroupOperation, MonthlyCycle } from '../types';
import { dataStore } from '../lib/dataStore';
import { formatCOP, formatUSD, formatTRM } from '../lib/financialEngine';

interface DailyOperationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: CategoryGroupInfo | null;
  cycle: MonthlyCycle;
  adminUid?: string;
  adminName?: string;
}

export const DailyOperationsModal: React.FC<DailyOperationsModalProps> = ({
  isOpen,
  onClose,
  group,
  cycle,
  adminUid = 'admin_root_uid',
  adminName = 'Administrador Principal',
}) => {
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [amountUsd, setAmountUsd] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (!isOpen || !group) return null;

  const trm = cycle.trmApplied || 4020;
  const isClosed = cycle.status === 'CLOSED';
  const operations = dataStore.getDailyOperations(cycle.cycleId, group.category, group.groupCapitalCop);
  const totalUsdAccumulated = operations.reduce((sum, op) => sum + op.amountUsd, 0);
  const totalGrossCop = totalUsdAccumulated * trm;
  const clientProfitCop = totalGrossCop * 0.75;
  const adminCommissionCop = totalGrossCop * 0.25;

  const handleAddOperation = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const parsedUsd = parseFloat(amountUsd);
    if (isNaN(parsedUsd) || parsedUsd <= 0) {
      setError('Por favor ingresa un monto en USD válido mayor a 0.');
      return;
    }

    if (!date) {
      setError('Por favor selecciona una fecha válida.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = dataStore.addDailyOperation(
        cycle.cycleId,
        group.category,
        group.groupCapitalCop,
        date,
        parsedUsd,
        notes.trim() || undefined,
        adminUid,
        adminName
      );

      setSuccessMsg(res.message);
      setAmountUsd('');
      setNotes('');
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err.message || 'Error al registrar la operación diaria.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteOperation = (opId: string) => {
    setError(null);
    setSuccessMsg(null);
    try {
      setDeletingId(opId);
      const res = dataStore.deleteDailyOperation(opId, adminUid, adminName);
      setSuccessMsg(res.message);
      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (err: any) {
      setError(err.message || 'Error al eliminar la operación.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleResetBalance = () => {
    setError(null);
    setSuccessMsg(null);
    if (
      !window.confirm(
        `¿Estás seguro de REINICIAR EL SALDO a $0? Se eliminarán todas las operaciones registradas para este grupo (${group.category} - ${formatCOP(
          group.groupCapitalCop
        )}) en este ciclo.`
      )
    ) {
      return;
    }

    try {
      const res = dataStore.resetDailyOperations(
        cycle.cycleId,
        group.category,
        group.groupCapitalCop,
        adminUid,
        adminName
      );
      setSuccessMsg(res.message);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err.message || 'Error al reiniciar el saldo.');
    }
  };

  const getCategoryTheme = (cat: BitacoraCategory) => {
    switch (cat) {
      case 'AZUL':
        return {
          border: 'border-blue-500/40',
          badge: 'bg-blue-950 text-blue-300 border-blue-500/30',
          pill: 'text-blue-400',
        };
      case 'VERDE':
        return {
          border: 'border-emerald-500/40',
          badge: 'bg-emerald-950 text-emerald-300 border-emerald-500/30',
          pill: 'text-emerald-400',
        };
      case 'NEGRA':
        return {
          border: 'border-slate-700',
          badge: 'bg-slate-900 text-slate-200 border-slate-700',
          pill: 'text-slate-300',
        };
    }
  };

  const theme = getCategoryTheme(group.category);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden my-8 animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-start justify-between bg-slate-950/60">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${theme.badge}`}>
                {group.category} • {formatCOP(group.groupCapitalCop)}
              </span>
              <span className="text-xs text-slate-400 font-mono">
                {group.users.length} {group.users.length === 1 ? 'inversionista' : 'inversionistas'}
              </span>
            </div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-400" />
              Bitácora de Operaciones Diarias
            </h2>
            <p className="text-xs text-slate-400">
              Ciclo: <span className="text-slate-200 font-semibold">{cycle.name}</span> • TRM aplicada:{' '}
              <span className="text-blue-300 font-mono font-semibold">{formatTRM(trm)} COP</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isClosed && (
              <button
                onClick={handleResetBalance}
                disabled={operations.length === 0 && totalUsdAccumulated === 0}
                className="px-3 py-1.5 rounded-xl bg-red-950/60 border border-red-500/40 text-red-300 hover:text-red-100 hover:bg-red-900/60 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                title="Reiniciar a $0 las operaciones y saldos de este grupo"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reiniciar Saldo</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Live Aggregates Ribbon */}
        <div className="p-4 bg-slate-950/40 border-b border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Total Operado</span>
            <p className="text-lg font-black text-slate-100 font-mono mt-0.5">
              {formatUSD(totalUsdAccumulated)}
            </p>
            <p className="text-[10px] text-slate-500">{operations.length} operaciones sumadas</p>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Generado COP</span>
            <p className="text-lg font-black text-blue-400 font-mono mt-0.5">
              {formatCOP(totalGrossCop)}
            </p>
            <p className="text-[10px] text-slate-500">A TRM ${trm}</p>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/90 border border-emerald-500/30">
            <span className="text-[10px] text-emerald-400 uppercase font-semibold block">Ganancia Cliente</span>
            <p className="text-lg font-black text-emerald-300 font-mono mt-0.5">
              {formatCOP(clientProfitCop)}
            </p>
            <p className="text-[10px] text-emerald-500/80 font-mono">{formatUSD(totalUsdAccumulated * 0.75)}</p>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/90 border border-amber-500/30">
            <span className="text-[10px] text-amber-400 uppercase font-semibold block">Comisión Mesa</span>
            <p className="text-lg font-black text-amber-300 font-mono mt-0.5">
              {formatCOP(adminCommissionCop)}
            </p>
            <p className="text-[10px] text-amber-500/80 font-mono">{formatUSD(totalUsdAccumulated * 0.25)}</p>
          </div>
        </div>

        {/* Feedback alerts */}
        {error && (
          <div className="mx-5 mt-4 p-3 rounded-xl bg-red-950/80 border border-red-500/40 text-red-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="mx-5 mt-4 p-3 rounded-xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Add Operation Form */}
        {!isClosed && (
          <div className="p-5 border-b border-slate-800 bg-slate-900/50">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-1.5">
              <Plus className="w-4 h-4 text-blue-400" />
              Registrar Nueva Operación / Trade
            </h3>

            <form onSubmit={handleAddOperation} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] text-slate-400 font-medium block mb-1">
                    Fecha de Operación
                  </label>
                  <div className="relative">
                    <Calendar className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 font-mono focus:border-blue-500 focus:outline-none"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 font-medium block mb-1">
                    Monto Operado (USD)
                  </label>
                  <div className="relative">
                    <DollarSign className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                    <input
                      type="number"
                      step="any"
                      min="0.01"
                      placeholder="Ej: 120"
                      value={amountUsd}
                      onChange={(e) => setAmountUsd(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 font-mono focus:border-blue-500 focus:outline-none"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 font-medium block mb-1">
                    Detalle / Sesión de Mercado
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: Sesión NY - Oro / XAUUSD"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <p className="text-[11px] text-slate-500 italic">
                  El sistema acumulará automáticamente este valor al total del ciclo y actualizará la liquidación de todos los inversionistas del grupo.
                </p>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-lg shadow-blue-500/20 disabled:opacity-50 shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  {isSubmitting ? 'Guardando...' : 'Agregar a Bitácora'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Operations Ledger Table */}
        <div className="p-5 max-h-72 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-400" />
              Historial de Operaciones del Ciclo ({operations.length})
            </h3>
            <span className="text-[11px] text-slate-400 font-mono">
              Orden cronológico ascendente
            </span>
          </div>

          {operations.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-slate-800 rounded-xl">
              <Clock className="w-8 h-8 mx-auto text-slate-600 mb-2" />
              <p className="text-xs text-slate-400">Aún no se han registrado operaciones para este grupo en este ciclo.</p>
              <p className="text-[11px] text-slate-500 mt-1">Utiliza el formulario superior para registrar cada trade diario.</p>
            </div>
          ) : (
            <div className="border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 font-mono uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Fecha</th>
                    <th className="py-2.5 px-3">Operado (USD)</th>
                    <th className="py-2.5 px-3">Equivalente COP</th>
                    <th className="py-2.5 px-3">Sesión / Detalle</th>
                    {!isClosed && <th className="py-2.5 px-3 text-right">Acción</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {operations.map((op, idx) => (
                    <tr key={op.id} className="hover:bg-slate-800/30 transition">
                      <td className="py-2.5 px-3 text-slate-300 font-semibold flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-slate-800 text-[10px] text-slate-400 flex items-center justify-center">
                          {idx + 1}
                        </span>
                        {op.date}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-emerald-400">
                        {formatUSD(op.amountUsd)}
                      </td>
                      <td className="py-2.5 px-3 text-blue-300">
                        {formatCOP(op.amountUsd * trm)}
                      </td>
                      <td className="py-2.5 px-3 font-sans text-slate-400 max-w-xs truncate">
                        {op.notes || <span className="text-slate-600 italic">Sin detalle</span>}
                      </td>
                      {!isClosed && (
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => handleDeleteOperation(op.id)}
                            disabled={deletingId === op.id}
                            className="p-1 rounded text-red-400 hover:bg-red-950/50 hover:text-red-300 transition"
                            title="Eliminar operación"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/70 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Todos los cambios recalculan en tiempo real las ganancias de los inversionistas y la comisión de mesa.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
