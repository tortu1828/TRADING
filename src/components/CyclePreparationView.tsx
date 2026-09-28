import React, { useState, useEffect, useMemo } from 'react';
import {
  Rocket,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowUpRight,
  ShieldCheck,
  DollarSign,
  UserCheck,
  RefreshCw,
  X,
  Lock,
  AlertCircle,
  FileText,
  Search,
  ChevronRight,
  Coins,
  ShieldAlert,
  Check,
  Sparkles,
  Plus,
} from 'lucide-react';
import { dataStore } from '../lib/dataStore';
import { firestoreService } from '../lib/firestoreService';
import { useAuth } from '../context/AuthContext';
import { MonthlyCycle, ReinvestmentRequest, UserProfile } from '../types';

export interface ResolvedPreparationAmounts {
  baseCapitalCop: number;
  profitAppliedCop: number;
  cashRequiredCop: number;
  cashConfirmedCop: number;
  securedCapitalCop: number;
  projectedCapitalCop: number;
  isReady: boolean;
  isInvalidZeroCapital: boolean;
}

export const resolvePreparationAmounts = (
  req: ReinvestmentRequest,
  user?: UserProfile | null
): ResolvedPreparationAmounts => {
  // 1. Capital Base
  const baseCapitalCop =
    req.currentCapitalSnapshotCop ??
    req.baseCapital ??
    user?.currentCapital ??
    0;

  // 2. Ganancia Reinvertida
  const profitAppliedCop =
    req.profitAppliedCop ??
    req.reinvestAmountCop ??
    0;

  // 3. Aporte Externo Requerido
  const cashRequiredCop = req.cashInjectionCop ?? 0;

  // 4. Aporte Confirmado
  const isConfirmed = req.externalFundingStatus === 'CONFIRMED';
  const cashConfirmedCop = isConfirmed
    ? (req.confirmedAmountCop ?? req.cashReceivedAmountCop ?? cashRequiredCop)
    : 0;

  // 5. Capital Asegurado
  const securedCapitalCop =
    req.securedNextCapitalCop ??
    (baseCapitalCop + profitAppliedCop);

  // 6. Capital Proyectado
  const projectedCapitalCop =
    req.projectedNextCapitalCop ??
    req.projectedCapitalCop ??
    (securedCapitalCop + cashRequiredCop);

  // 7. Condición de usuario listo (Sección 13)
  const administrativelyReady = req.status === 'APPROVED' || req.status === 'PREAPPROVED';
  const fundingReady =
    req.externalFundingStatus === 'NOT_REQUIRED' ||
    req.externalFundingStatus === 'CONFIRMED' ||
    !req.externalFundingStatus;

  const isReady = administrativelyReady && fundingReady && securedCapitalCop > 0;
  const isInvalidZeroCapital = securedCapitalCop <= 0 && ((user?.currentCapital || 0) > 0 || baseCapitalCop > 0);

  return {
    baseCapitalCop,
    profitAppliedCop,
    cashRequiredCop,
    cashConfirmedCop,
    securedCapitalCop,
    projectedCapitalCop,
    isReady,
    isInvalidZeroCapital,
  };
};

interface CyclePreparationViewProps {
  currentCycle?: MonthlyCycle | null;
  currentUser: UserProfile | null;
  onRefresh?: () => void;
}

export const CyclePreparationView: React.FC<CyclePreparationViewProps> = ({
  currentCycle,
  currentUser,
  onRefresh,
}) => {
  const { isSuperAdmin: authIsSuperAdmin } = useAuth();
  const isSuperAdmin = authIsSuperAdmin || currentUser?.role === 'SUPERADMIN' || currentUser?.role === 'ADMIN';

  const [config, setConfig] = useState(dataStore.getConfig());
  const [cycles, setCycles] = useState<MonthlyCycle[]>([]);
  const preparingCycleId = config?.preparingCycleId || null;
  const [selectedCycleId, setSelectedCycleId] = useState<string>(preparingCycleId || currentCycle?.id || '');
  const [reinvestments, setReinvestments] = useState<ReinvestmentRequest[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'CONFIRMED' | 'NOT_REQUIRED'>('ALL');

  // Modals state
  const [selectedReqForConfirm, setSelectedReqForConfirm] = useState<ReinvestmentRequest | null>(null);
  const [confirmBankRef, setConfirmBankRef] = useState('');
  const [confirmNotes, setConfirmNotes] = useState('');
  const [isSubmittingConfirm, setIsSubmittingConfirm] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const [showStartModal, setShowStartModal] = useState(false);
  const [isStartingCycle, setIsStartingCycle] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Genesis creation modal state
  const [showGenesisModal, setShowGenesisModal] = useState(false);
  const [genesisName, setGenesisName] = useState('Ciclo Génesis');
  const [isCreatingGenesis, setIsCreatingGenesis] = useState(false);
  const [genesisError, setGenesisError] = useState<string | null>(null);

  const hasAnyRealCycle = cycles && cycles.length > 0;
  const canCreateGenesis =
    isSuperAdmin &&
    !hasAnyRealCycle &&
    !config?.preparingCycleId &&
    !config?.operationalCycleId;

  // Sync dataStore state
  useEffect(() => {
    const unsub = dataStore.subscribe(() => {
      setCycles(dataStore.getCycles());
      setReinvestments(dataStore.getReinvestments());
      setUsers(dataStore.getUsers());
      setConfig(dataStore.getConfig());
    });
    setCycles(dataStore.getCycles());
    setReinvestments(dataStore.getReinvestments());
    setUsers(dataStore.getUsers());
    setConfig(dataStore.getConfig());
    return unsub;
  }, []);

  // Sync selectedCycleId when preparingCycleId changes
  useEffect(() => {
    if (preparingCycleId) {
      setSelectedCycleId(preparingCycleId);
    } else if (currentCycle?.id) {
      setSelectedCycleId(currentCycle.id);
    }
  }, [preparingCycleId, currentCycle?.id]);

  const userMap = useMemo(() => {
    const map: Record<string, UserProfile> = {};
    users.forEach((u) => {
      if (u.id) map[u.id] = u;
      if (u.uid) map[u.uid] = u;
    });
    return map;
  }, [users]);

  const preparingCycle = useMemo(() => {
    if (!preparingCycleId) return null;
    return (
      cycles.find((c) => c.id === preparingCycleId || c.cycleId === preparingCycleId) ||
      (currentCycle?.id === preparingCycleId ? currentCycle : null)
    );
  }, [cycles, preparingCycleId, currentCycle]);

  const activeTargetCycle = useMemo(() => {
    if (selectedCycleId) {
      const found = cycles.find((c) => c.id === selectedCycleId || c.cycleId === selectedCycleId);
      if (found) return found;
    }
    return preparingCycle || currentCycle || null;
  }, [cycles, selectedCycleId, preparingCycle, currentCycle]);

  const isCycleStarted = activeTargetCycle?.operationalStatus === 'STARTED';

  // Filtrar solicitudes relevantes para el ciclo seleccionado
  const cycleReinvestments = useMemo(() => {
    if (!selectedCycleId) return [];
    return reinvestments.filter((r) => {
      return (
        r.targetCycleId === selectedCycleId ||
        r.cycleId === selectedCycleId ||
        (r.status === 'APPROVED' && (!r.targetCycleId || r.targetCycleId === selectedCycleId))
      );
    });
  }, [reinvestments, selectedCycleId]);

  // KPIs de Preparación usando resolvePreparationAmounts único
  const kpis = useMemo(() => {
    let totalProcessed = 0;
    let pendingCount = 0;
    let pendingAmountCop = 0;
    let confirmedCount = 0;
    let confirmedAmountCop = 0;
    let totalSecuredCapitalCop = 0;
    let totalProjectedCapitalCop = 0;
    let readyUsersCount = 0;

    cycleReinvestments.forEach((r) => {
      totalProcessed += 1;
      const user = userMap[r.userId] || userMap[r.userUid || ''];
      const amounts = resolvePreparationAmounts(r, user);

      totalSecuredCapitalCop += amounts.securedCapitalCop;
      totalProjectedCapitalCop += amounts.projectedCapitalCop;

      if (r.externalFundingStatus === 'PENDING') {
        pendingCount += 1;
        pendingAmountCop += amounts.cashRequiredCop;
      } else if (r.externalFundingStatus === 'CONFIRMED') {
        confirmedCount += 1;
        confirmedAmountCop += amounts.cashConfirmedCop;
      }

      if (amounts.isReady) {
        readyUsersCount += 1;
      }
    });

    return {
      totalProcessed,
      pendingCount,
      pendingAmountCop,
      confirmedCount,
      confirmedAmountCop,
      totalSecuredCapitalCop,
      totalProjectedCapitalCop,
      readyUsersCount,
    };
  }, [cycleReinvestments, userMap]);

  // KPIs calculados exclusivamente para el ciclo en preparación (preparingCycleId)
  const preparingCycleReinvestments = useMemo(() => {
    if (!preparingCycleId) return [];
    return reinvestments.filter((r) => {
      return (
        r.targetCycleId === preparingCycleId ||
        r.cycleId === preparingCycleId ||
        (r.status === 'APPROVED' && (!r.targetCycleId || r.targetCycleId === preparingCycleId))
      );
    });
  }, [reinvestments, preparingCycleId]);

  const preparingKpis = useMemo(() => {
    let totalProcessed = 0;
    let pendingCount = 0;
    let pendingAmountCop = 0;
    let confirmedCount = 0;
    let confirmedAmountCop = 0;
    let totalSecuredCapitalCop = 0;
    let totalProjectedCapitalCop = 0;
    let readyUsersCount = 0;

    preparingCycleReinvestments.forEach((r) => {
      totalProcessed += 1;
      const user = userMap[r.userId] || userMap[r.userUid || ''];
      const amounts = resolvePreparationAmounts(r, user);

      totalSecuredCapitalCop += amounts.securedCapitalCop;
      totalProjectedCapitalCop += amounts.projectedCapitalCop;

      if (r.externalFundingStatus === 'PENDING') {
        pendingCount += 1;
        pendingAmountCop += amounts.cashRequiredCop;
      } else if (r.externalFundingStatus === 'CONFIRMED') {
        confirmedCount += 1;
        confirmedAmountCop += amounts.cashConfirmedCop;
      }

      if (amounts.isReady) {
        readyUsersCount += 1;
      }
    });

    return {
      totalProcessed,
      pendingCount,
      pendingAmountCop,
      confirmedCount,
      confirmedAmountCop,
      totalSecuredCapitalCop,
      totalProjectedCapitalCop,
      readyUsersCount,
    };
  }, [preparingCycleReinvestments, userMap]);

  // Lista filtrada para tabla y tarjetas móviles
  const filteredList = useMemo(() => {
    return cycleReinvestments.filter((r) => {
      const matchesSearch =
        r.userCode?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.userName?.toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchesSearch) return false;

      if (statusFilter === 'PENDING') return r.externalFundingStatus === 'PENDING';
      if (statusFilter === 'CONFIRMED') return r.externalFundingStatus === 'CONFIRMED';
      if (statusFilter === 'NOT_REQUIRED') {
        return !r.externalFundingStatus || r.externalFundingStatus === 'NOT_REQUIRED';
      }
      return true;
    });
  }, [cycleReinvestments, searchTerm, statusFilter]);

  // Formateador COP
  const formatCOP = (val: number | undefined) => {
    if (val === undefined || val === null || isNaN(val)) return '$0';
    return `$${Math.round(val).toLocaleString('es-CO')}`;
  };

  // Manejador Confirmar Aporte Externo
  const handleConfirmContribution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReqForConfirm) return;
    setConfirmError(null);
    setIsSubmittingConfirm(true);

    try {
      const res = await firestoreService.adminConfirmExternalContributionCallable({
        requestId: selectedReqForConfirm.id,
        confirmedAmountCop: selectedReqForConfirm.cashInjectionCop || 0,
        bankReference: confirmBankRef.trim() || undefined,
        notes: confirmNotes.trim() || undefined,
      });

      setNotification({
        type: 'success',
        message: `Aporte de ${formatCOP(selectedReqForConfirm.cashInjectionCop)} confirmado exitosamente para ${selectedReqForConfirm.userName}.`,
      });

      setSelectedReqForConfirm(null);
      setConfirmBankRef('');
      setConfirmNotes('');
      if (onRefresh) onRefresh();
    } catch (err: any) {
      console.error('Error confirmando aporte externo:', err);
      setConfirmError(err.message || 'Error al confirmar aporte externo en el servidor.');
    } finally {
      setIsSubmittingConfirm(false);
    }
  };

  // Manejador Crear Ciclo Inicial (Génesis)
  const handleCreateGenesisCycle = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = genesisName.trim();
    if (cleanName.length < 3 || cleanName.length > 60) {
      setGenesisError('El nombre del ciclo debe tener entre 3 y 60 caracteres.');
      return;
    }

    setGenesisError(null);
    setIsCreatingGenesis(true);

    try {
      const clientRequestId = crypto.randomUUID();
      const res = await firestoreService.adminCreateGenesisCycleCallable({
        name: cleanName,
        clientRequestId,
      });

      setShowGenesisModal(false);
      setGenesisName('Ciclo Génesis');
      setNotification({
        type: 'success',
        message: `Ciclo inicial creado correctamente. ID: ${res.cycleId}`,
      });

      if (onRefresh) onRefresh();
    } catch (err: any) {
      console.error('Error creando ciclo génesis:', err);
      setGenesisError(err.message || 'Error al crear ciclo inicial en el servidor.');
    } finally {
      setIsCreatingGenesis(false);
    }
  };

  // Manejador Iniciar Ciclo Operativo
  const handleStartCycle = async () => {
    if (!preparingCycleId) {
      setStartError('No existe ningún ciclo en preparación configurado en el sistema.');
      return;
    }

    if (cycles.length > 0 && !cycles.some((c) => c.id === preparingCycleId || c.cycleId === preparingCycleId)) {
      setStartError(`El ciclo en preparación (${preparingCycleId}) no se encuentra cargado localmente.`);
      return;
    }

    setStartError(null);
    setIsStartingCycle(true);

    try {
      const clientRequestId = crypto.randomUUID();
      const res = await firestoreService.adminStartCycleCallable({
        cycleId: preparingCycleId,
        clientRequestId,
      });

      setShowStartModal(false);
      setNotification({
        type: 'success',
        message: `¡Ciclo ${preparingCycle?.name || preparingCycleId} iniciado operativamente! Capital administrado: ${formatCOP(
          res.initialManagedCapitalCop
        )} con ${res.initialActiveUsersCount} inversionistas activos.`,
      });

      if (onRefresh) onRefresh();
    } catch (err: any) {
      console.error('Error iniciando ciclo operativo:', err);
      setStartError(err.message || 'Error al iniciar el ciclo operativo en el servidor.');
    } finally {
      setIsStartingCycle(false);
    }
  };

  // Renderizador de Badge de Estado de Fondeo e Integridad
  const renderFundingBadge = (req: ReinvestmentRequest, amounts: ResolvedPreparationAmounts) => {
    const status = req.externalFundingStatus;
    const reqStatus = req.status;

    if (amounts.securedCapitalCop <= 0) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-950/80 text-rose-300 border border-rose-500/40">
          <AlertTriangle className="w-3 h-3 text-rose-400" />
          REVISAR CAPITAL
        </span>
      );
    }

    if (reqStatus === 'APPLIED') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-500/40">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          APLICADO
        </span>
      );
    }

    if (status === 'CONFIRMED') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-950/80 text-blue-300 border border-blue-500/40">
          <CheckCircle2 className="w-3 h-3 text-blue-400" />
          APORTE CONFIRMADO
        </span>
      );
    }

    if (status === 'PENDING') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-950/80 text-amber-300 border border-amber-500/40 animate-pulse">
          <Clock className="w-3 h-3 text-amber-400" />
          APORTE PENDIENTE
        </span>
      );
    }

    if (status === 'NOT_RECEIVED') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-950/80 text-rose-300 border border-rose-500/40">
          <X className="w-3 h-3 text-rose-400" />
          NO RECIBIDO
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
        <Check className="w-3 h-3 text-slate-400" />
        LISTO (NO REQUERIDO)
      </span>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Notificaciones locales */}
      {notification && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between gap-3 text-xs font-medium ${
            notification.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300'
              : notification.type === 'error'
              ? 'bg-rose-950/70 border-rose-500/50 text-rose-300'
              : 'bg-blue-950/70 border-blue-500/50 text-blue-300'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-5 h-5 shrink-0 text-rose-400" />
            )}
            <span>{notification.message}</span>
          </div>
          <button
            onClick={() => setNotification(null)}
            className="p-1 rounded-lg hover:bg-black/20 text-current opacity-80 hover:opacity-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* BANNER: Ciclo Ya Iniciado (Section 27) */}
      {isCycleStarted && (
        <div className="p-5 rounded-2xl bg-gradient-to-r from-blue-950/90 via-slate-900 to-indigo-950/80 border border-blue-500/50 shadow-2xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/20 border border-blue-400/40 flex items-center justify-center text-blue-300 shrink-0 shadow-inner">
                <Rocket className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase font-black tracking-widest px-2.5 py-0.5 rounded bg-blue-500 text-slate-950">
                    OPERATIVO
                  </span>
                  <h3 className="text-lg font-black text-slate-100 tracking-tight">
                    CICLO OPERATIVO INICIADO: {activeTargetCycle.name}
                  </h3>
                </div>
                <p className="text-xs text-slate-300 mt-1">
                  Este ciclo ya congeló sus capitales definitivos e inició su operación formal. El trading se encuentra habilitado bajo la bitácora autoritativa.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 text-right bg-slate-950/60 p-3 rounded-xl border border-slate-800 self-stretch sm:self-auto justify-between sm:justify-end">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">Capital Inicial</span>
                <span className="text-sm font-black text-emerald-400 font-mono">
                  {formatCOP(activeTargetCycle.initialManagedCapitalCop || kpis.totalSecuredCapitalCop)}
                </span>
              </div>
              <div className="border-l border-slate-800 pl-3">
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">Inversionistas</span>
                <span className="text-sm font-black text-blue-300 font-mono">
                  {activeTargetCycle.initialActiveUsersCount || kpis.readyUsersCount} activos
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Encabezado Principal y Selector de Ciclo Objetivo */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Rocket className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-100 tracking-tight">
                Preparación e Inicio del Ciclo Operativo
              </h2>
              <p className="text-xs text-slate-400">
                Auditoría de aportes externos, capitales proyectados y congelamiento pre-operativo.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Selector de Ciclo */}
          {cycles.length > 0 && (
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 shadow-sm">
              <span className="text-xs text-slate-400 font-semibold">Ciclo:</span>
              <select
                value={selectedCycleId}
                onChange={(e) => setSelectedCycleId(e.target.value)}
                className="bg-transparent text-slate-100 text-xs font-bold font-mono focus:outline-none cursor-pointer"
              >
                {cycles.map((c) => (
                  <option key={c.id} value={c.id} className="bg-slate-900 text-slate-100">
                    {c.name} ({c.operationalStatus === 'STARTED' ? 'INICIADO' : 'PREPARANDO'})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* BOTÓN: Iniciar Ciclo Operativo / Crear Ciclo Inicial */}
          {canCreateGenesis ? (
            <button
              type="button"
              onClick={() => {
                setGenesisName('Ciclo Génesis');
                setGenesisError(null);
                setShowGenesisModal(true);
              }}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-black shadow-lg shadow-emerald-600/30 transition flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Crear Ciclo Inicial
            </button>
          ) : !preparingCycleId ? (
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-slate-400 text-xs font-medium">
              <AlertCircle className="w-4 h-4 text-slate-500 shrink-0" />
              <span>No hay ningún ciclo en preparación disponible para iniciar.</span>
            </div>
          ) : preparingCycle?.operationalStatus === 'STARTED' ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs font-bold">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Ciclo Iniciado ({preparingCycle.name})</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (!preparingCycleId) return;
                setStartError(null);
                setShowStartModal(true);
              }}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-black shadow-lg shadow-blue-600/30 transition flex items-center gap-2 cursor-pointer"
            >
              <Rocket className="w-4 h-4" />
              INICIAR CICLO OPERATIVO
            </button>
          )}
        </div>
      </div>

      {/* BLOQUE INICIALIZACIÓN GÉNESIS (Si no existe ciclo inicial) */}
      {!hasAnyRealCycle && !preparingCycleId && (
        <div className="p-8 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-slate-800 text-center space-y-4 shadow-xl">
          <div className="w-14 h-14 rounded-2xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto">
            <Sparkles className="w-7 h-7" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-lg font-black text-slate-100">
              Todavía no existe un ciclo inicial.
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Cree el ciclo inicial (Génesis) para comenzar las operaciones del fondo, habilitar la configuración de inversionistas y preparar el primer ciclo operativo.
            </p>
          </div>
          {isSuperAdmin && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  setGenesisName('Ciclo Génesis');
                  setGenesisError(null);
                  setShowGenesisModal(true);
                }}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-black shadow-lg shadow-emerald-600/30 transition inline-flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Crear Ciclo Inicial
              </button>
            </div>
          )}
        </div>
      )}

      {/* TARJETAS DE KPIS DE PREPARACIÓN (Section 17) */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {/* KPI 1: Solicitudes Procesadas */}
        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
            <FileText className="w-3.5 h-3.5 text-slate-500" />
            Solicitudes
          </span>
          <div className="mt-2">
            <span className="text-xl font-black text-slate-100 font-mono">{kpis.totalProcessed}</span>
            <span className="text-[10px] text-slate-500 block">Total evaluadas</span>
          </div>
        </div>

        {/* KPI 2: Aportes Pendientes */}
        <div className={`p-3.5 rounded-xl border shadow-sm flex flex-col justify-between ${
          kpis.pendingCount > 0
            ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
            : 'bg-slate-900 border-slate-800 text-slate-400'
        }`}>
          <span className="text-[11px] font-semibold flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            Aportes Pendientes
          </span>
          <div className="mt-2">
            <span className="text-xl font-black font-mono text-amber-300">{kpis.pendingCount}</span>
            <span className="text-[10px] font-mono text-amber-400/80 block">{formatCOP(kpis.pendingAmountCop)}</span>
          </div>
        </div>

        {/* KPI 3: Aportes Confirmados */}
        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
            Aportes Confirmados
          </span>
          <div className="mt-2">
            <span className="text-xl font-black text-blue-300 font-mono">{kpis.confirmedCount}</span>
            <span className="text-[10px] font-mono text-blue-400/80 block">{formatCOP(kpis.confirmedAmountCop)}</span>
          </div>
        </div>

        {/* KPI 4: Capital Asegurado Total */}
        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            Capital Asegurado
          </span>
          <div className="mt-2">
            <span className="text-lg font-black text-emerald-300 font-mono">{formatCOP(kpis.totalSecuredCapitalCop)}</span>
            <span className="text-[10px] text-emerald-400/70 block">Garantizado en cuenta</span>
          </div>
        </div>

        {/* KPI 5: Capital Proyectado Total */}
        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
            <Coins className="w-3.5 h-3.5 text-indigo-400" />
            Capital Proyectado
          </span>
          <div className="mt-2">
            <span className="text-lg font-black text-indigo-300 font-mono">{formatCOP(kpis.totalProjectedCapitalCop)}</span>
            <span className="text-[10px] text-indigo-400/70 block">Con aportes incluidos</span>
          </div>
        </div>

        {/* KPI 6: Usuarios Listos */}
        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
            <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
            Usuarios Listos
          </span>
          <div className="mt-2">
            <span className="text-xl font-black text-slate-100 font-mono">{kpis.readyUsersCount}</span>
            <span className="text-[10px] text-slate-500 block">Listos para operar</span>
          </div>
        </div>

        {/* KPI 7: Estado Operativo */}
        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
            <Rocket className="w-3.5 h-3.5 text-blue-400" />
            Estado Ciclo
          </span>
          <div className="mt-2">
            <span
              className={`text-xs font-black uppercase px-2 py-0.5 rounded tracking-wider inline-block ${
                isCycleStarted
                  ? 'bg-blue-950 text-blue-300 border border-blue-500/40'
                  : 'bg-amber-950 text-amber-300 border border-amber-500/40'
              }`}
            >
              {isCycleStarted ? 'INICIADO' : 'PREPARANDO'}
            </span>
            <span className="text-[10px] text-slate-500 block mt-1">
              {isCycleStarted ? 'Trading activo' : 'Trading bloqueado'}
            </span>
          </div>
        </div>
      </div>

      {/* Barra de Filtros y Búsqueda */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-xl bg-slate-900 border border-slate-800">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por código o nombre..."
            className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition whitespace-nowrap ${
              statusFilter === 'ALL'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            Todos ({cycleReinvestments.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('PENDING')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 ${
              statusFilter === 'PENDING'
                ? 'bg-amber-600 text-slate-950'
                : 'text-amber-400 hover:bg-amber-950/40'
            }`}
          >
            <Clock className="w-3 h-3" />
            Pendientes ({kpis.pendingCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('CONFIRMED')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 ${
              statusFilter === 'CONFIRMED'
                ? 'bg-blue-600 text-white'
                : 'text-blue-400 hover:bg-blue-950/40'
            }`}
          >
            <CheckCircle2 className="w-3 h-3" />
            Confirmados ({kpis.confirmedCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('NOT_REQUIRED')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition whitespace-nowrap ${
              statusFilter === 'NOT_REQUIRED'
                ? 'bg-slate-700 text-slate-100'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            Sin aporte requerido
          </button>
        </div>
      </div>

      {/* TABLA PRINCIPAL (Desktop: lg+) (Sections 18 & 19) */}
      <div className="hidden lg:block bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800 text-[10px]">
              <tr>
                <th className="py-3 px-4">Inversionista</th>
                <th className="py-3 px-3 text-right">Capital Base</th>
                <th className="py-3 px-3 text-right">Ganancia Reinv.</th>
                <th className="py-3 px-3 text-right">Aporte Requerido</th>
                <th className="py-3 px-3 text-right">Aporte Confirmado</th>
                <th className="py-3 px-3 text-right font-bold text-emerald-400">Capital Asegurado</th>
                <th className="py-3 px-3 text-right font-bold text-indigo-300">Capital Proyectado</th>
                <th className="py-3 px-3 text-center">Estado Fondeo</th>
                <th className="py-3 px-3 text-center">Estado Solicitud</th>
                <th className="py-3 px-4 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-500">
                    No se encontraron registros para los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                filteredList.map((req) => {
                  const user = userMap[req.userId] || userMap[req.userUid || ''];
                  const amounts = resolvePreparationAmounts(req, user);
                  const isPending = req.externalFundingStatus === 'PENDING';

                  return (
                    <tr key={req.id} className="hover:bg-slate-850/60 transition-colors">
                      {/* Inversionista */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-100 flex items-center gap-2">
                          <span className="font-mono text-blue-400 bg-blue-950/60 border border-blue-500/30 px-1.5 py-0.5 rounded text-[10px]">
                            {req.userCode || user?.userCode || 'INV'}
                          </span>
                          <span>{req.userName || user?.fullName || 'Usuario'}</span>
                        </div>
                      </td>

                      {/* Capital Base */}
                      <td className="py-3 px-3 text-right font-mono text-slate-400">
                        {formatCOP(amounts.baseCapitalCop)}
                      </td>

                      {/* Ganancia Reinvertida */}
                      <td className="py-3 px-3 text-right font-mono text-slate-300">
                        {formatCOP(amounts.profitAppliedCop)}
                      </td>

                      {/* Aporte Requerido */}
                      <td className="py-3 px-3 text-right font-mono">
                        {amounts.cashRequiredCop > 0 ? (
                          <span className="text-amber-300 font-semibold">{formatCOP(amounts.cashRequiredCop)}</span>
                        ) : (
                          <span className="text-slate-600">$0</span>
                        )}
                      </td>

                      {/* Aporte Confirmado */}
                      <td className="py-3 px-3 text-right font-mono">
                        {amounts.cashConfirmedCop > 0 ? (
                          <span className="text-blue-300 font-semibold">{formatCOP(amounts.cashConfirmedCop)}</span>
                        ) : (
                          <span className="text-slate-600">$0</span>
                        )}
                      </td>

                      {/* Capital Asegurado */}
                      <td className="py-3 px-3 text-right font-mono font-bold text-emerald-400 bg-emerald-950/10">
                        {formatCOP(amounts.securedCapitalCop)}
                      </td>

                      {/* Capital Proyectado */}
                      <td className="py-3 px-3 text-right font-mono font-bold text-indigo-300 bg-indigo-950/10">
                        {formatCOP(amounts.projectedCapitalCop)}
                      </td>

                      {/* Estado Fondeo */}
                      <td className="py-3 px-3 text-center">
                        {renderFundingBadge(req, amounts)}
                      </td>

                      {/* Estado Solicitud */}
                      <td className="py-3 px-3 text-center">
                        <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase bg-slate-800 text-slate-300 border border-slate-700">
                          {req.status}
                        </span>
                      </td>

                      {/* Acciones */}
                      <td className="py-3 px-4 text-center">
                        {isPending && !isCycleStarted ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedReqForConfirm(req);
                              setConfirmBankRef('');
                              setConfirmNotes('');
                              setConfirmError(null);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] shadow-sm transition flex items-center gap-1 mx-auto cursor-pointer"
                          >
                            <DollarSign className="w-3 h-3" />
                            Confirmar aporte
                          </button>
                        ) : req.externalFundingStatus === 'CONFIRMED' ? (
                          <span className="text-[11px] text-blue-400 flex items-center justify-center gap-1 font-semibold">
                            <Check className="w-3 h-3" />
                            Confirmado
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* TARJETAS MÓVILES (Screens < 1024px: 320px, 375px, 390px, 430px) (Section 28) */}
      <div className="block lg:hidden space-y-3">
        {filteredList.length === 0 ? (
          <div className="p-8 text-center text-slate-500 bg-slate-900 rounded-2xl border border-slate-800">
            No se encontraron registros para los filtros seleccionados.
          </div>
        ) : (
          filteredList.map((req) => {
            const user = userMap[req.userId] || userMap[req.userUid || ''];
            const amounts = resolvePreparationAmounts(req, user);
            const isPending = req.externalFundingStatus === 'PENDING';

            return (
              <div
                key={req.id}
                className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-md space-y-3"
              >
                {/* Header Tarjeta */}
                <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-blue-400 bg-blue-950/60 border border-blue-500/30 px-1.5 py-0.5 rounded text-[10px] font-bold">
                      {req.userCode || user?.userCode || 'INV'}
                    </span>
                    <span className="font-bold text-slate-100 text-xs">{req.userName || user?.fullName}</span>
                  </div>
                  {renderFundingBadge(req, amounts)}
                </div>

                {/* Grid de Valores */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-400 block">Capital Asegurado</span>
                    <span className="font-mono font-black text-emerald-400 text-sm">
                      {formatCOP(amounts.securedCapitalCop)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Capital Proyectado</span>
                    <span className="font-mono font-black text-indigo-300 text-sm">
                      {formatCOP(amounts.projectedCapitalCop)}
                    </span>
                  </div>
                  {amounts.cashRequiredCop > 0 && (
                    <div className="col-span-2 p-2 rounded-lg bg-amber-950/30 border border-amber-500/30 flex items-center justify-between">
                      <span className="text-[11px] text-amber-300 font-semibold flex items-center gap-1">
                        <Clock className="w-3 h-3 text-amber-400" />
                        Aporte Requerido:
                      </span>
                      <span className="font-mono font-bold text-amber-300">
                        {formatCOP(amounts.cashRequiredCop)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Acciones Móvil */}
                {isPending && !isCycleStarted && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedReqForConfirm(req);
                      setConfirmBankRef('');
                      setConfirmNotes('');
                      setConfirmError(null);
                    }}
                    className="w-full py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <DollarSign className="w-4 h-4" />
                    Confirmar Aporte Externo ({formatCOP(amounts.cashRequiredCop)})
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: CONFIRMAR APORTE EXTERNO (Sections 20 & 21) */}
      {/* ========================================================================= */}
      {selectedReqForConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl relative text-slate-100">
            <button
              onClick={() => setSelectedReqForConfirm(null)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                <DollarSign className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-100">CONFIRMAR APORTE EXTERNO</h3>
                <p className="text-xs text-slate-400">
                  {selectedReqForConfirm.userCode} — {selectedReqForConfirm.userName}
                </p>
              </div>
            </div>

            {confirmError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-950/70 border border-rose-500/50 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{confirmError}</span>
              </div>
            )}

            <form onSubmit={handleConfirmContribution} className="space-y-4">
              {/* Campo Monto Requerido (BLOQUEADO, SOLO LECTURA) */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-[11px] text-slate-400 font-semibold block">
                  Aporte Solicitado (Bloqueado)
                </span>
                <span className="text-xl font-black text-amber-300 font-mono block">
                  {formatCOP(selectedReqForConfirm.cashInjectionCop)}
                </span>
                <p className="text-[10px] text-slate-500">
                  El monto a confirmar coincide exactamente con la solicitud radicada por el inversionista. No se permiten recepciones parciales.
                </p>
              </div>

              {/* Declaración de Confirmación Explícita */}
              <div className="p-3 rounded-xl bg-blue-950/30 border border-blue-500/30 text-xs text-blue-200 leading-snug">
                <p className="font-semibold text-blue-100 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-blue-400" /> Declaración Administrativa
                </p>
                <p className="mt-1">
                  Confirmo que fueron recibidos exactamente{' '}
                  <strong className="text-blue-100 font-mono">
                    {formatCOP(selectedReqForConfirm.cashInjectionCop)} COP
                  </strong>{' '}
                  en las cuentas de la tesorería antes de la fecha límite operativa.
                </p>
              </div>

              {/* Referencia Bancaria (Opcional) */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Referencia Bancaria / Comprobante (Opcional)
                </label>
                <input
                  type="text"
                  value={confirmBankRef}
                  onChange={(e) => setConfirmBankRef(e.target.value)}
                  placeholder="ej: Transf #98234 Bancolombia"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              {/* Notas de Auditoría (Opcional) */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Notas de Auditoría (Opcional)
                </label>
                <input
                  type="text"
                  value={confirmNotes}
                  onChange={(e) => setConfirmNotes(e.target.value)}
                  placeholder="ej: Validado en extracto cuenta empresarial"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedReqForConfirm(null)}
                  disabled={isSubmittingConfirm}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingConfirm}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black shadow-lg shadow-amber-500/20 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingConfirm ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Confirmando...
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Confirmar Recepción
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: INICIAR CICLO OPERATIVO (Sections 22, 23, 24, 25, 26) */}
      {/* ========================================================================= */}
      {showStartModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative text-slate-100">
            <button
              onClick={() => setShowStartModal(false)}
              disabled={isStartingCycle}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
                <Rocket className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-100">
                  INICIAR CICLO OPERATIVO: {preparingCycle?.name || preparingCycleId || 'Ciclo en Preparación'}
                </h3>
                <p className="text-xs text-slate-400">
                  Congelamiento transaccional de capitales y habilitación de trading.
                </p>
              </div>
            </div>

            {startError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-950/70 border border-rose-500/50 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{startError}</span>
              </div>
            )}

            {!preparingCycleId ? (
              <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs space-y-2">
                <div className="flex items-center gap-2 font-bold text-amber-300">
                  <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
                  <span>No hay ciclo en preparación disponible</span>
                </div>
                <p>
                  No existe ningún ciclo en preparación configurado en el sistema (<code>settings/global_config.preparingCycleId</code>).
                </p>
              </div>
            ) : cycles.length === 0 ? (
              <div className="p-6 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center gap-3 text-xs text-slate-400">
                <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                <span>Cargando datos del ciclo en preparación...</span>
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                {/* Resumen del Capital a Congelar */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[11px] text-slate-400 block font-semibold">Capital a Congelar</span>
                    <span className="text-lg font-black text-emerald-400 font-mono">
                      {formatCOP(preparingKpis.totalSecuredCapitalCop)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block font-semibold">Inversionistas Listos</span>
                    <span className="text-lg font-black text-blue-300 font-mono">
                      {preparingKpis.readyUsersCount} usuarios
                    </span>
                  </div>
                </div>

                {/* ADVERTENCIA DE APORTES PENDIENTES (Section 23) */}
                {preparingKpis.pendingCount > 0 ? (
                  <div className="p-4 rounded-xl bg-amber-950/50 border border-amber-500/50 text-amber-200 space-y-2">
                    <div className="flex items-center gap-2 font-bold text-amber-300">
                      <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
                      <span>⚠️ Advertencia de Aportes No Confirmados</span>
                    </div>
                    <p className="text-xs text-amber-200/90 leading-relaxed">
                      Existen <strong>{preparingKpis.pendingCount} aporte(s) externo(s) sin confirmar</strong> por un total de{' '}
                      <strong className="font-mono">{formatCOP(preparingKpis.pendingAmountCop)}</strong>. Si continúa, esos montos{' '}
                      <strong>NO serán incluidos</strong> en el capital operativo de este ciclo y quedarán registrados como{' '}
                      <strong className="underline">NO RECIBIDOS</strong>. Los inversionistas iniciarán únicamente con su capital asegurado.
                    </p>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-200 text-xs">
                    <p className="font-bold flex items-center gap-1.5 text-emerald-300">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Todos los aportes están confirmados o no requeridos
                    </p>
                    <p className="mt-1 text-emerald-300/80">
                      Se congelarán los capitales definitivos y, a partir de este momento, el ciclo podrá registrar operaciones operativas.
                    </p>
                  </div>
                )}

                {/* MENSAJE DE IRREVERSIBILIDAD (Section 24) */}
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2">
                  <Lock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <p>
                    <strong className="text-slate-300">Irreversibilidad Operativa:</strong> Una vez iniciado el ciclo y registrada actividad financiera, los capitales congelados en <code className="text-blue-400">cycleUserResults</code> no pueden modificarse retroactivamente.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowStartModal(false)}
                    disabled={isStartingCycle}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"
                  >
                    Volver a revisar
                  </button>
                  <button
                    type="button"
                    onClick={handleStartCycle}
                    disabled={isStartingCycle || !preparingCycleId}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-black shadow-lg shadow-blue-600/30 transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isStartingCycle ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Iniciando ciclo...
                      </>
                    ) : (
                      <>
                        <Rocket className="w-4 h-4" />
                        {preparingKpis.pendingCount > 0
                          ? 'Iniciar con capital confirmado'
                          : 'Iniciar Ciclo Operativo'}
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: CREAR CICLO INICIAL GÉNESIS (SuperAdmin) */}
      {/* ========================================================================= */}
      {showGenesisModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl relative text-slate-100 space-y-5">
            <button
              onClick={() => !isCreatingGenesis && setShowGenesisModal(false)}
              disabled={isCreatingGenesis}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition disabled:opacity-50"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-100">
                  Crear Ciclo Inicial (Génesis)
                </h3>
                <p className="text-xs text-slate-400">
                  Inicialización del primer ciclo en estado de preparación.
                </p>
              </div>
            </div>

            {genesisError && (
              <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-500/50 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{genesisError}</span>
              </div>
            )}

            <form onSubmit={handleCreateGenesisCycle} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1.5">
                  Nombre del Ciclo <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={genesisName}
                  onChange={(e) => setGenesisName(e.target.value)}
                  placeholder="Ej: Ciclo Génesis"
                  disabled={isCreatingGenesis}
                  maxLength={60}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-xs font-semibold disabled:opacity-50"
                  autoFocus
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Entre 3 y 60 caracteres. El identificador canónico será generado por el servidor.
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-400 space-y-1">
                <p className="font-semibold text-slate-300">Información del Ciclo Génesis:</p>
                <p>• Estado inicial: <strong>PREPARING</strong> (en preparación).</p>
                <p>• La TRM no se congela al inicio; se aplicará la liquidación al momento del cierre.</p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowGenesisModal(false)}
                  disabled={isCreatingGenesis}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isCreatingGenesis || !genesisName.trim() || genesisName.trim().length < 3}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-black shadow-lg shadow-emerald-600/30 transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isCreatingGenesis ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Creando ciclo inicial...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Crear Ciclo Inicial
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
