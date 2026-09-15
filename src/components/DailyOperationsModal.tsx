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
  Users,
  User,
  Search,
  UserCheck,
  Percent,
  Bell,
  Send,
  Edit3,
  Check,
  Lock,
} from 'lucide-react';
import { BitacoraCategory, CategoryGroupInfo, DailyGroupOperation, MonthlyCycle, UserProfile } from '../types';
import { dataStore } from '../lib/dataStore';
import { formatCOP, formatUSD, formatTRM, calculateUserMonthlyResult } from '../lib/financialEngine';

interface DailyOperationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: CategoryGroupInfo | null;
  cycle: MonthlyCycle;
  adminUid?: string;
  adminName?: string;
  initialTargetUser?: UserProfile | null;
}

export const DailyOperationsModal: React.FC<DailyOperationsModalProps> = ({
  isOpen,
  onClose,
  group,
  cycle,
  adminUid = 'admin_root_uid',
  adminName = 'Administrador Principal',
  initialTargetUser = null,
}) => {
  const [activeTab, setActiveTab] = useState<'OPERATIONS' | 'INVESTORS'>('OPERATIONS');
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [amountUsd, setAmountUsd] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(initialTargetUser?.id || null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isNotifying, setIsNotifying] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [investorSearchQuery, setInvestorSearchQuery] = useState<string>('');

  React.useEffect(() => {
    if (initialTargetUser) {
      setSelectedUserId(initialTargetUser.id);
    }
  }, [initialTargetUser]);

  // Editing operation state
  const [editingOpId, setEditingOpId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState<string>('');
  const [editAmountUsd, setEditAmountUsd] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');

  if (!isOpen || !group) return null;

  const trm = cycle.trmApplied || 4020;
  const isClosed = cycle.status === 'CLOSED';
  const operations = dataStore.getDailyOperations(cycle.cycleId, group.category, group.groupCapitalCop);

  // Separación de operaciones activas vs consolidadas
  const activeOps = operations.filter((op) => op.status !== 'CONSOLIDATED');
  const consolidatedOps = operations.filter((op) => op.status === 'CONSOLIDATED');
  const activeUsd = activeOps.reduce((sum, op) => sum + op.amountUsd, 0);
  const consolidatedUsd = consolidatedOps.reduce((sum, op) => sum + op.amountUsd, 0);

  const totalUsdAccumulated = operations.reduce((sum, op) => sum + op.amountUsd, 0);
  const totalGrossCopPerUser = totalUsdAccumulated * trm;

  // Obtener usuarios reales del grupo (quienes tienen este capital exacto en esta categoría)
  const usersInGroup: UserProfile[] = group.users && group.users.length > 0
    ? group.users
    : dataStore.getActiveUsers().filter((u) => u.currentCapital === group.groupCapitalCop);

  // Totales consolidados del grupo
  const groupTotalGrossCop = totalGrossCopPerUser * usersInGroup.length;
  const groupTotalUsd = totalUsdAccumulated * usersInGroup.length;

  // Promedios y sumas por usuario
  const avgUserPct = usersInGroup.length > 0
    ? usersInGroup.reduce((acc, u) => {
        const raw = u.userPercentage !== undefined ? u.userPercentage : 75;
        return acc + (raw > 1 ? raw / 100 : raw);
      }, 0) / usersInGroup.length
    : 0.75;
  const avgAdminPct = usersInGroup.length > 0
    ? usersInGroup.reduce((acc, u) => {
        const raw = u.adminPercentage !== undefined ? u.adminPercentage : 25;
        return acc + (raw > 1 ? raw / 100 : raw);
      }, 0) / usersInGroup.length
    : 0.25;

  const avgClientProfitCop = totalGrossCopPerUser * avgUserPct;
  const avgAdminCommissionCop = totalGrossCopPerUser * avgAdminPct;
  const avgClientProfitUsd = totalUsdAccumulated * avgUserPct;
  const avgAdminCommissionUsd = totalUsdAccumulated * avgAdminPct;

  const totalGroupClientProfitCop = usersInGroup.reduce((sum, u) => {
    const raw = u.userPercentage !== undefined ? u.userPercentage : 75;
    const ratio = raw > 1 ? raw / 100 : raw;
    return sum + (totalGrossCopPerUser * ratio);
  }, 0);

  const totalGroupAdminCommissionCop = usersInGroup.reduce((sum, u) => {
    const raw = u.adminPercentage !== undefined ? u.adminPercentage : 25;
    const ratio = raw > 1 ? raw / 100 : raw;
    return sum + (totalGrossCopPerUser * ratio);
  }, 0);

  // Filtrar inversionistas en la pestaña de verificación
  const filteredUsers = usersInGroup.filter((u) => {
    if (!investorSearchQuery.trim()) return true;
    const q = investorSearchQuery.toLowerCase();
    return (
      u.fullName.toLowerCase().includes(q) ||
      u.userCode.toLowerCase().includes(q) ||
      (u.documentId && u.documentId.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q))
    );
  });

  const handleConsolidateSession = () => {
    setError(null);
    setSuccessMsg(null);
    if (activeUsd === 0) {
      setError('No hay operaciones activas pendientes en la sesión actual para consolidar.');
      return;
    }
    if (
      !window.confirm(
        `¿Confirmas CERRAR Y CONSOLIDAR las operaciones activas de hoy ($${formatUSD(activeUsd)})?\n\n` +
          `• Se guardarán permanentemente en el Cierre Mensual ($${formatUSD(
            totalUsdAccumulated
          )} acumulados hasta la fecha).\n` +
          `• El mostrador operativo diario volverá a $0.00 USD para iniciar una nueva sesión.`
      )
    ) {
      return;
    }

    try {
      const res = dataStore.consolidateDailyOperations(
        cycle.cycleId,
        group.category,
        group.groupCapitalCop,
        adminUid,
        adminName
      );
      setSuccessMsg(res.message);
      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (err: any) {
      setError(err.message || 'Error al consolidar la sesión diaria.');
    }
  };

  const handleStartEdit = (op: DailyGroupOperation) => {
    setEditingOpId(op.id);
    setEditDate(op.date);
    setEditAmountUsd(op.amountUsd.toString());
    setEditNotes(op.notes || '');
  };

  const handleSaveEdit = (opId: string) => {
    setError(null);
    setSuccessMsg(null);
    const parsedUsd = parseFloat(editAmountUsd);
    if (isNaN(parsedUsd) || parsedUsd <= 0) {
      setError('Por favor ingresa un monto operado en USD válido mayor a 0.');
      return;
    }
    if (!editDate) {
      setError('Por favor selecciona una fecha válida.');
      return;
    }

    try {
      const res = dataStore.updateDailyOperation(
        opId,
        editDate,
        parsedUsd,
        editNotes.trim(),
        adminUid,
        adminName
      );
      setEditingOpId(null);
      setSuccessMsg(res.message);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err.message || 'Error al actualizar la operación.');
    }
  };

  const handleCancelEdit = () => {
    setEditingOpId(null);
  };

  const handleNotifyGroup = (operationAmountUsd?: number, opDate?: string, operationId?: string, opNotes?: string, targetOp?: DailyGroupOperation) => {
    setError(null);
    setSuccessMsg(null);

    const singleOp = targetOp || (operationId ? operations.find((o) => o.id === operationId) : undefined);

    if (operationAmountUsd !== undefined && operationId) {
      try {
        setIsNotifying(true);
        const res = dataStore.sendDailyGroupNotification(
          cycle.cycleId,
          group.category,
          group.groupCapitalCop,
          operationAmountUsd,
          opDate || date,
          opNotes || notes,
          adminUid,
          adminName,
          operationId,
          singleOp
        );
        setSuccessMsg(res.message);
        setTimeout(() => setSuccessMsg(null), 5000);
      } catch (err: any) {
        setError(err.message || 'Error al enviar notificaciones.');
      } finally {
        setIsNotifying(false);
      }
      return;
    }

    const activeOps = operations.filter((op) => op.status !== 'CONSOLIDATED');
    if (activeOps.length === 0) {
      setError('No hay operaciones activas pendientes por notificar para este grupo.');
      return;
    }

    try {
      setIsNotifying(true);
      let totalSent = 0;
      activeOps.forEach((op) => {
        const res = dataStore.sendDailyGroupNotification(
          cycle.cycleId,
          group.category,
          group.groupCapitalCop,
          op.amountUsd,
          op.date || date,
          op.notes || notes,
          adminUid,
          adminName,
          op.id,
          op
        );
        totalSent += res.sentCount;
      });
      setSuccessMsg(`✓ Se enviaron ${totalSent} notificaciones individuales a los inversionistas de este grupo.`);
      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (err: any) {
      setError(err.message || 'Error al enviar notificaciones.');
    } finally {
      setIsNotifying(false);
    }
  };

  const handleAddOperation = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const parsedUsd = parseFloat(amountUsd);
    if (isNaN(parsedUsd)) {
      setError('Por favor ingresa un monto en USD válido.');
      return;
    }

    if (!date) {
      setError('Por favor selecciona una fecha válida.');
      return;
    }

    const chosenUser = selectedUserId
      ? usersInGroup.find((u) => u.id === selectedUserId) || null
      : null;

    try {
      setIsSubmitting(true);
      const res = await dataStore.addDailyOperationAsync(
        cycle.cycleId,
        group.category,
        group.groupCapitalCop,
        date,
        parsedUsd,
        notes.trim() || undefined,
        adminUid,
        adminName,
        chosenUser
      );

      setSuccessMsg(`✓ ${res.message}`);
      setAmountUsd('');
      setNotes('');
      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (err: any) {
      console.error('Error al registrar operación diaria en servidor:', err);
      setError(err.message || 'Error al registrar la operación diaria en Firestore.');
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
    <div className="fixed inset-0 z-50 flex justify-center items-start p-2 sm:p-4 bg-slate-950/85 backdrop-blur-sm overflow-y-auto overscroll-contain">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden my-2 sm:my-8 animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-start justify-between gap-3 bg-slate-950/80">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${theme.badge}`}>
                {group.category} • {formatCOP(group.groupCapitalCop)}
              </span>
              <span className="text-xs text-slate-300 bg-slate-800/80 px-2.5 py-0.5 rounded-full font-mono font-bold flex items-center gap-1">
                <Users className="w-3 h-3 text-blue-400" />
                {usersInGroup.length} {usersInGroup.length === 1 ? 'inversionista' : 'inversionistas en el grupo'}
              </span>
            </div>
            <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-400 shrink-0" />
              <span>Bitácora de Operaciones & Verificación</span>
            </h2>
            <p className="text-xs text-slate-400">
              Ciclo: <span className="text-slate-200 font-semibold">{cycle.name}</span> • TRM aplicada:{' '}
              <span className="text-blue-300 font-mono font-semibold">{formatTRM(trm)} COP</span>
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {!isClosed && (
              <>
                <button
                  onClick={handleConsolidateSession}
                  disabled={activeUsd === 0}
                  className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold flex items-center gap-1.5 transition shadow-lg shadow-emerald-500/20 cursor-pointer active:scale-95"
                  title={`Cerrar la sesión de hoy (${formatUSD(activeUsd)}) y acumular lo operado en el Cierre Mensual`}
                >
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  <span>Cerrar Día ({formatUSD(activeUsd)})</span>
                </button>
                <button
                  onClick={handleResetBalance}
                  disabled={operations.length === 0 && totalUsdAccumulated === 0}
                  className="min-h-[38px] px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-300 hover:text-red-300 hover:border-red-500/50 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold flex items-center gap-1.5 transition cursor-pointer active:scale-95"
                  title="Reiniciar a $0 las operaciones y saldos de este grupo"
                >
                  <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                  <span>Reiniciar Todo</span>
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Live Aggregates Ribbon */}
        <div className="p-3 sm:p-4 bg-slate-950/60 border-b border-slate-800 grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
          <div className="p-3 rounded-xl bg-slate-900/90 border border-blue-500/30">
            <span className="text-[10px] text-blue-400 uppercase font-semibold block flex items-center justify-between">
              <span>Sesión Activa</span>
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
            </span>
            <p className="text-base sm:text-lg font-black text-blue-300 font-mono mt-0.5">
              {formatUSD(activeUsd)}
            </p>
            <p className="text-[10px] text-slate-400">{activeOps.length} ops en sesión</p>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Total Acumulado</span>
            <p className="text-base sm:text-lg font-black text-slate-100 font-mono mt-0.5">
              {formatUSD(totalUsdAccumulated)}
            </p>
            <p className="text-[10px] text-emerald-400 font-mono">{consolidatedOps.length} ops consolidadas</p>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Bruto COP (c/u)</span>
            <p className="text-base sm:text-lg font-black text-blue-400 font-mono mt-0.5">
              {formatCOP(totalGrossCopPerUser)}
            </p>
            <p className="text-[10px] text-slate-500">A TRM ${trm}</p>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/90 border border-emerald-500/30">
            <span className="text-[10px] text-emerald-400 uppercase font-semibold block flex items-center justify-between">
              <span>Ganancia Cliente</span>
              <span className="text-[9px] font-mono opacity-80 font-bold">({(avgUserPct * 100).toFixed(0)}%)</span>
            </span>
            <p className="text-base sm:text-lg font-black text-emerald-300 font-mono mt-0.5">
              {formatCOP(avgClientProfitCop)}
            </p>
            <p className="text-[10px] text-emerald-500/80 font-mono">{formatUSD(avgClientProfitUsd)}</p>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/90 border border-amber-500/30 col-span-2 sm:col-span-1">
            <span className="text-[10px] text-amber-400 uppercase font-semibold block flex items-center justify-between">
              <span>Comisión Admin</span>
              <span className="text-[9px] font-mono opacity-80 font-bold">({(avgAdminPct * 100).toFixed(0)}%)</span>
            </span>
            <p className="text-base sm:text-lg font-black text-amber-300 font-mono mt-0.5">
              {formatCOP(avgAdminCommissionCop)}
            </p>
            <p className="text-[10px] text-amber-500/80 font-mono">{formatUSD(avgAdminCommissionUsd)}</p>
          </div>
        </div>

        {/* Informative Group Distribution Banner */}
        <div className="px-5 py-2.5 bg-blue-950/40 border-b border-blue-500/20 flex flex-wrap items-center justify-between gap-2 text-xs text-blue-200">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0" />
            <span>
              <strong>Regla del Grupo:</strong> Las operaciones registradas ({formatUSD(totalUsdAccumulated)}) se aplican a <strong>cada uno</strong> de los {usersInGroup.length} inversionistas con capital de {formatCOP(group.groupCapitalCop)}.
            </span>
          </div>
          <div className="text-[11px] font-mono text-blue-300 bg-blue-900/40 px-2 py-0.5 rounded border border-blue-500/30">
            Total Grupo: {formatCOP(groupTotalGrossCop)} ({formatUSD(groupTotalUsd)})
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-950/90 px-3 sm:px-5 pt-2 overflow-x-auto scrollbar-none gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('OPERATIONS')}
            className={`pb-2.5 px-3 sm:px-4 text-xs font-bold transition border-b-2 flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 ${
              activeTab === 'OPERATIONS'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-4 h-4 shrink-0" />
            <span>1. Operaciones del Ciclo ({operations.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('INVESTORS')}
            className={`pb-2.5 px-3 sm:px-4 text-xs font-bold transition border-b-2 flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 ${
              activeTab === 'INVESTORS'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserCheck className="w-4 h-4 shrink-0" />
            <span>2. Inversionistas ({usersInGroup.length})</span>
          </button>
        </div>

        {/* Feedback alerts */}
        {error && (
          <div className="mx-3 sm:mx-5 mt-4 p-3 rounded-xl bg-red-950/80 border border-red-500/40 text-red-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="mx-3 sm:mx-5 mt-4 p-3 rounded-xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* TAB 1: OPERATIONS */}
        {activeTab === 'OPERATIONS' && (
          <div>
            {/* Add Operation Form */}
            {!isClosed && (
              <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-900/50">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-1.5">
                  <Plus className="w-4 h-4 text-blue-400" />
                  Registrar Nueva Operación / Trade Diario
                </h3>

                <form onSubmit={handleAddOperation} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="text-[11px] text-slate-400 font-medium block mb-1">
                        Destinatario del Trade
                      </label>
                      <select
                        value={selectedUserId || 'ALL_GROUP'}
                        onChange={(e) => setSelectedUserId(e.target.value === 'ALL_GROUP' ? null : e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
                      >
                        <option value="ALL_GROUP">
                          👥 Todo el Grupo ({usersInGroup.length} inversionistas)
                        </option>
                        {usersInGroup.map((u) => (
                          <option key={u.id} value={u.id}>
                            👤 Solo {u.fullName} ({u.userCode})
                          </option>
                        ))}
                      </select>
                    </div>

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
                          placeholder="Ej: 123"
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

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                    <p className="text-[11px] text-slate-400">
                      {selectedUserId ? (
                        <>
                          ⚡ Operación individual asignada a:{' '}
                          <strong className="text-blue-300">
                            {usersInGroup.find((u) => u.id === selectedUserId)?.fullName || selectedUserId}
                          </strong>. Se enviará notificación push de inmediato a su perfil.
                        </>
                      ) : (
                        <>
                          Al guardar, este valor se aplicará de inmediato a los{' '}
                          <strong className="text-slate-200">{usersInGroup.length} inversionistas</strong> del grupo con capital {formatCOP(group.groupCapitalCop)}.
                        </>
                      )}
                    </p>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="min-h-[44px] w-full sm:w-auto px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-lg shadow-blue-500/20 disabled:opacity-50 shrink-0 cursor-pointer active:scale-95"
                    >
                      <Plus className="w-4 h-4" />
                      {isSubmitting ? 'Guardando...' : 'Agregar a Bitácora'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Operations Ledger Table */}
            <div className="p-3 sm:p-5 max-h-96 overflow-y-auto">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-400" />
                  Historial de Operaciones del Ciclo ({operations.length})
                </h3>
                <span className="text-[11px] text-slate-400 font-mono">
                  Orden cronológico
                </span>
              </div>

              {operations.length === 0 ? (
                <div className="text-center py-8 border border-dashed border-slate-800 rounded-xl">
                  <Clock className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                  <p className="text-xs text-slate-400">Aún no se han registrado operaciones para este grupo en este ciclo.</p>
                  <p className="text-[11px] text-slate-500 mt-1">Utiliza el formulario superior para registrar cada trade diario.</p>
                </div>
              ) : (
                <div className="border border-slate-800 rounded-xl overflow-x-auto">
                  <table className="w-full text-xs text-left min-w-[700px]">
                    <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 font-mono uppercase text-[10px]">
                      <tr>
                        <th className="py-2.5 px-3">Fecha</th>
                        <th className="py-2.5 px-3">Destinatario</th>
                        <th className="py-2.5 px-3">Estado</th>
                        <th className="py-2.5 px-3">Operado (USD)</th>
                        <th className="py-2.5 px-3">Equivalente COP (c/u)</th>
                        <th className="py-2.5 px-3">Total Grupo ({usersInGroup.length} pers)</th>
                        <th className="py-2.5 px-3">Sesión / Detalle</th>
                        {!isClosed && <th className="py-2.5 px-3 text-right">Acciones</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {operations.map((op, idx) => {
                        const isEditingThis = editingOpId === op.id;
                        return (
                          <tr key={op.id} className="hover:bg-slate-800/30 transition">
                            {isEditingThis ? (
                              <>
                                <td className="py-2.5 px-3">
                                  <input
                                    type="date"
                                    value={editDate}
                                    onChange={(e) => setEditDate(e.target.value)}
                                    className="bg-slate-950 border border-blue-500 rounded px-2 py-1 text-xs text-white font-mono focus:outline-none"
                                  />
                                </td>
                                <td className="py-2.5 px-3 font-sans text-[11px] text-slate-400">
                                  {op.userName ? op.userName : 'Todo el Grupo'}
                                </td>
                                <td className="py-2.5 px-3">
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-500/30">
                                    Editando
                                  </span>
                                </td>
                                <td className="py-2.5 px-3">
                                  <input
                                    type="number"
                                    step="any"
                                    min="0.01"
                                    value={editAmountUsd}
                                    onChange={(e) => setEditAmountUsd(e.target.value)}
                                    className="bg-slate-950 border border-blue-500 rounded px-2 py-1 text-xs text-emerald-300 font-bold font-mono w-28 focus:outline-none"
                                  />
                                </td>
                                <td className="py-2.5 px-3 text-blue-300">
                                  {formatCOP((parseFloat(editAmountUsd) || 0) * trm)}
                                </td>
                                <td className="py-2.5 px-3 text-slate-300">
                                  {formatCOP((parseFloat(editAmountUsd) || 0) * trm * usersInGroup.length)}
                                </td>
                                <td className="py-2.5 px-3">
                                  <input
                                    type="text"
                                    value={editNotes}
                                    onChange={(e) => setEditNotes(e.target.value)}
                                    placeholder="Detalle..."
                                    className="bg-slate-950 border border-blue-500 rounded px-2 py-1 text-xs text-white w-full focus:outline-none font-sans"
                                  />
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleSaveEdit(op.id)}
                                      className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition cursor-pointer flex items-center gap-1"
                                      title="Guardar cambios"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={handleCancelEdit}
                                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                                      title="Cancelar edición"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="py-2.5 px-3 text-slate-300 font-semibold flex items-center gap-1.5">
                                  <span className="w-5 h-5 rounded-full bg-slate-800 text-[10px] text-slate-400 flex items-center justify-center shrink-0">
                                    {idx + 1}
                                  </span>
                                  {op.date}
                                </td>
                                <td className="py-2.5 px-3 font-sans">
                                  {op.userName ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-950 text-blue-300 text-[10px] font-semibold border border-blue-500/30">
                                      <User className="w-2.5 h-2.5 text-blue-400" />
                                      {op.userName}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-semibold">
                                      <Users className="w-2.5 h-2.5 text-slate-400" />
                                      Todo el grupo
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3">
                                  {op.status === 'CONSOLIDATED' ? (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 w-fit">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                      Consolidado
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-950 text-blue-300 border border-blue-500/30 flex items-center gap-1 w-fit">
                                      <Clock className="w-3 h-3 text-blue-400" />
                                      Activa
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 font-bold text-emerald-400">
                                  {formatUSD(op.amountUsd)}
                                </td>
                                <td className="py-2.5 px-3 text-blue-300">
                                  {formatCOP(op.amountUsd * trm)}
                                </td>
                                <td className="py-2.5 px-3 text-slate-300">
                                  {formatCOP(op.amountUsd * trm * usersInGroup.length)}
                                </td>
                                <td className="py-2.5 px-3 font-sans text-slate-400 max-w-xs truncate">
                                  {op.notes || <span className="text-slate-600 italic">Sin detalle</span>}
                                </td>
                                {!isClosed && (
                                  <td className="py-2.5 px-3 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => handleStartEdit(op)}
                                        className="p-1.5 rounded-lg bg-amber-950/60 border border-amber-500/30 text-amber-300 hover:bg-amber-900/80 hover:text-white transition cursor-pointer"
                                        title="Editar este registro de operación"
                                      >
                                        <Edit3 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleNotifyGroup(op.amountUsd, op.date, op.id, op.notes, op)}
                                        disabled={isNotifying}
                                        className="p-1.5 rounded-lg bg-blue-950/60 border border-blue-500/30 text-blue-300 hover:bg-blue-900/80 hover:text-white transition cursor-pointer"
                                        title={`Notificar este trade (${formatUSD(op.amountUsd)}) al grupo`}
                                      >
                                        <Bell className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteOperation(op.id)}
                                        disabled={deletingId === op.id}
                                        className="p-1.5 rounded-lg bg-red-950/40 border border-red-500/30 text-red-400 hover:bg-red-900/60 hover:text-red-200 transition cursor-pointer"
                                        title="Eliminar operación"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                )}
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: INVESTORS VERIFICATION TABLE */}
        {activeTab === 'INVESTORS' && (
          <div className="p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-emerald-400" />
                  Inversionistas que reciben los {formatUSD(totalUsdAccumulated)} de este grupo ({usersInGroup.length})
                </h3>
                <p className="text-[11px] text-slate-400">
                  Verificación de la aplicación de rendimiento individual y comisiones por cada cliente.
                </p>
              </div>

              <div className="flex items-center gap-2">
                {!isClosed && totalUsdAccumulated > 0 && (
                  <button
                    onClick={() => handleNotifyGroup()}
                    disabled={isNotifying}
                    className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-blue-600/30 transition disabled:opacity-50 cursor-pointer"
                    title="Notificar a los inversionistas de este grupo sobre la operación acumulada"
                  >
                    <Bell className="w-3.5 h-3.5" />
                    <span>{isNotifying ? 'Enviando...' : `Notificar a ${usersInGroup.length} Inversionistas`}</span>
                  </button>
                )}

                {/* Search input */}
                <div className="relative w-full sm:w-56">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Buscar inversionista..."
                    value={investorSearchQuery}
                    onChange={(e) => setInvestorSearchQuery(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Investors Table */}
            {filteredUsers.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-slate-800 rounded-xl text-slate-500 text-xs">
                No se encontraron inversionistas con ese término de búsqueda.
              </div>
            ) : (
              <div className="border border-slate-800 rounded-xl overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-xs text-left border-collapse min-w-[620px]">
                  <thead className="bg-slate-950/90 text-slate-400 border-b border-slate-800 font-mono uppercase text-[10px] sticky top-0 z-10">
                    <tr>
                      <th className="py-2.5 px-3">Inversionista</th>
                      <th className="py-2.5 px-3">Capital Base</th>
                      <th className="py-2.5 px-3">USD Aplicado</th>
                      <th className="py-2.5 px-3">Ganancia Cliente</th>
                      <th className="py-2.5 px-3">Comisión Admin</th>
                      <th className="py-2.5 px-3 text-center">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {filteredUsers.map((user, idx) => {
                      const rawUserPct = user.userPercentage !== undefined ? user.userPercentage : 75;
                      const rawAdminPct = user.adminPercentage !== undefined ? user.adminPercentage : 25;
                      const userPct = rawUserPct <= 1 ? rawUserPct * 100 : rawUserPct;
                      const adminPct = rawAdminPct <= 1 ? rawAdminPct * 100 : rawAdminPct;

                      const calc = calculateUserMonthlyResult(
                        totalUsdAccumulated,
                        trm,
                        userPct,
                        adminPct
                      );

                      return (
                        <tr key={user.id} className="hover:bg-slate-800/30 transition">
                          {/* User info */}
                          <td className="py-2.5 px-3 font-sans">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-md bg-blue-950 text-blue-300 font-bold text-[10px] flex items-center justify-center border border-blue-500/30">
                                {idx + 1}
                              </div>
                              <div>
                                <span className="font-bold text-slate-200 block text-xs">
                                  {user.fullName}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {user.userCode} {user.documentId ? `• CC ${user.documentId}` : ''}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Capital */}
                          <td className="py-2.5 px-3 text-slate-300 font-semibold">
                            {formatCOP(user.currentCapital)}
                          </td>

                          {/* USD Operado Aplicado */}
                          <td className="py-2.5 px-3 font-bold text-blue-400">
                            {formatUSD(totalUsdAccumulated)}
                            <span className="block text-[10px] text-slate-500 font-normal">
                              {formatCOP(calc.grossCop)}
                            </span>
                          </td>

                          {/* Ganancia Cliente */}
                          <td className="py-2.5 px-3 font-bold text-emerald-400">
                            {formatCOP(calc.userProfitCop)}
                            <span className="block text-[10px] text-emerald-500/80 font-normal">
                              {formatUSD(calc.userProfitUsd)}
                            </span>
                          </td>

                          {/* Comisión Admin */}
                          <td className="py-2.5 px-3 font-bold text-amber-400">
                            {formatCOP(calc.adminCommissionCop)}
                            <span className="block text-[10px] text-amber-500/80 font-normal">
                              {formatUSD(calc.adminCommissionUsd)}
                            </span>
                          </td>

                          {/* Estado */}
                          <td className="py-2.5 px-3 text-center font-sans">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 text-[10px] font-bold border border-emerald-500/30">
                              <CheckCircle2 className="w-3 h-3" /> Aplicado
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Summary Footer for Investors */}
            <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-slate-400 font-mono">
                <span>Total de este grupo:</span>
                <span className="text-slate-200 font-bold">{usersInGroup.length} Inversionistas</span>
              </div>
              <div className="flex items-center gap-4 font-mono">
                <div>
                  <span className="text-[10px] text-slate-500 block">Total Ganancia Clientes:</span>
                  <span className="text-emerald-400 font-bold">{formatCOP(totalGroupClientProfitCop)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Total Comisión Admin:</span>
                  <span className="text-amber-400 font-bold">{formatCOP(totalGroupAdminCommissionCop)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/90 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Todos los cambios se calculan y guardan en Firestore en tiempo real para todos los dispositivos.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
