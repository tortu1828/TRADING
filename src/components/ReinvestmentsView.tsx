import React, { useState, useMemo } from 'react';
import {
  RotateCcw,
  Users,
  CheckCircle2,
  Check,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Clock,
  DollarSign,
  ShieldAlert,
  Search,
  ArrowUpRight,
  Sparkles,
  Info,
  Trash2,
  Filter,
  CheckCheck,
  Banknote,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { dataStore } from '../lib/dataStore';
import { useAuth } from '../context/AuthContext';
import { ReinvestmentRequest, BitacoraCategory } from '../types';
import { formatCOP, formatDateSafe, getCategoryForCapital } from '../lib/financialEngine';
import confetti from 'canvas-confetti';

type ReinvestFilter = 'ALL' | 'PENDING' | 'PREAPPROVED' | 'APPROVED' | 'NEEDS_REVIEW' | 'APPLIED' | 'REJECTED';

const isCanonicalReinvestment = (req: ReinvestmentRequest): boolean => {
  const hasIdentity =
    Boolean(req.id) &&
    Boolean(req.userUid || req.userId) &&
    Boolean(req.sourceCycleId);

  const totalIncrease = Number(req.totalIncreaseCop ?? req.reinvestAmountCop ?? 0);
  const projectedCapital = Number(req.projectedCapitalCop ?? req.newCapitalTargetCop ?? 0);

  const hasFinancialSnapshot =
    Number.isFinite(Number(req.currentCapitalSnapshotCop)) &&
    Number.isFinite(totalIncrease) &&
    Number.isFinite(projectedCapital);

  const validStatus = [
    'PENDING',
    'PREAPPROVED',
    'APPROVED',
    'NEEDS_REVIEW',
    'REJECTED',
    'APPLIED',
  ].includes(req.status || '');

  return (
    hasIdentity &&
    hasFinancialSnapshot &&
    totalIncrease > 0 &&
    projectedCapital > 0 &&
    validStatus
  );
};

export const ReinvestmentsView: React.FC = () => {
  const { currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === 'SUPERADMIN' || currentUser?.email?.toLowerCase().includes('admin');

  const [activeSubTab, setActiveSubTab] = useState<'reinvest' | 'waitlist' | 'orphans'>('reinvest');
  const [filterStatus, setFilterStatus] = useState<ReinvestFilter>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Orphan Scanner state
  const [isScanningOrphans, setIsScanningOrphans] = useState(false);
  const [orphanScanResult, setOrphanScanResult] = useState<{
    totalScanned: number;
    orphanCount: number;
    protectedCount: number;
    candidates: any[];
    protectedItems: any[];
  } | null>(null);
  const [orphanConfirmationText, setOrphanConfirmationText] = useState('');
  const [isPurgingOrphans, setIsPurgingOrphans] = useState(false);

  const reinvestments = dataStore.getReinvestments();
  const waitlist = dataStore.getInvestments();

  // Stats calculation
  const stats = useMemo(() => {
    const all = reinvestments.length;
    const pending = reinvestments.filter((r) => r.status === 'PENDING').length;
    const preapproved = reinvestments.filter((r) => r.status === 'PREAPPROVED').length;
    const approved = reinvestments.filter((r) => r.status === 'APPROVED' && !r.appliedAtCycleClosure).length;
    const needsReview = reinvestments.filter((r) => r.status === 'NEEDS_REVIEW').length;
    const applied = reinvestments.filter((r) => r.status === 'APPLIED' || (r.status === 'APPROVED' && r.appliedAtCycleClosure)).length;
    const rejected = reinvestments.filter((r) => r.status === 'REJECTED').length;

    return { all, pending, preapproved, approved, needsReview, applied, rejected };
  }, [reinvestments]);

  // Filtered reinvestments
  const filteredReinvestments = useMemo(() => {
    return reinvestments.filter((req) => {
      // Status filter
      if (filterStatus === 'PENDING' && req.status !== 'PENDING') return false;
      if (filterStatus === 'PREAPPROVED' && req.status !== 'PREAPPROVED') return false;
      if (filterStatus === 'APPROVED' && (req.status !== 'APPROVED' || req.appliedAtCycleClosure)) return false;
      if (filterStatus === 'NEEDS_REVIEW' && req.status !== 'NEEDS_REVIEW') return false;
      if (filterStatus === 'APPLIED' && !(req.status === 'APPLIED' || (req.status === 'APPROVED' && req.appliedAtCycleClosure))) return false;
      if (filterStatus === 'REJECTED' && req.status !== 'REJECTED') return false;

      // Search term filter
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim();
        const nameMatch = (req.userName || '').toLowerCase().includes(query);
        const codeMatch = (req.userCode || '').toLowerCase().includes(query);
        const cycleMatch = (req.sourceCycleId || '').toLowerCase().includes(query);
        const idMatch = (req.id || '').toLowerCase().includes(query);
        if (!nameMatch && !codeMatch && !cycleMatch && !idMatch) return false;
      }

      return true;
    });
  }, [reinvestments, filterStatus, searchTerm]);

  // Actions
  const handlePreapprove = async (req: ReinvestmentRequest) => {
    try {
      setActionLoadingId(req.id);
      await dataStore.preapproveReinvestment(
        req.id,
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      setStatusMessage({
        type: 'success',
        text: `Solicitud de ${req.userName} preaprobada. Esperando confirmación de consignación/dinero nuevo ($${formatCOP(req.cashInjectionCop || 0)}).`,
      });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `Error al preaprobar: ${err.message}` });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleConfirmCashAndApprove = async (req: ReinvestmentRequest) => {
    const cashAmount = formatCOP(req.cashInjectionCop || 0);
    const confirmPrompt = window.confirm(
      `¿Confirmas que se verificó la recepción de ${cashAmount} COP en efectivo/banco para ${req.userName}? Esta acción marcará la solicitud como APROBADA y lista para cierre.`
    );
    if (!confirmPrompt) return;

    try {
      setActionLoadingId(req.id);
      await dataStore.confirmCashAndApproveReinvestment(
        req.id,
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      setStatusMessage({
        type: 'success',
        text: `Dinero confirmado y solicitud aprobada para ${req.userName}. Se aplicará el aumento al capital durante el cierre de ciclo.`,
      });
      confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `Error al confirmar dinero: ${err.message}` });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDirectApprove = async (req: ReinvestmentRequest) => {
    try {
      setActionLoadingId(req.id);
      await dataStore.approveReinvestment(
        req.id,
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      setStatusMessage({
        type: 'success',
        text: `Solicitud de reinversión de ganancias para ${req.userName} aprobada con éxito.`,
      });
      confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `Error al aprobar: ${err.message}` });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleNeedsReview = async (req: ReinvestmentRequest) => {
    const reason = window.prompt(
      'Ingresa el motivo detallado para enviar la solicitud a revisión por el inversionista:',
      'Por favor verifica el comprobante de transferencia o ajusta los montos seleccionados.'
    );
    if (!reason || !reason.trim()) return;

    try {
      setActionLoadingId(req.id);
      await dataStore.needsReviewReinvestment(
        req.id,
        reason.trim(),
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      setStatusMessage({
        type: 'info',
        text: `Solicitud enviada a revisión. Se notificó a ${req.userName} para que reenvíe la solicitud corregida.`,
      });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `Error: ${err.message}` });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReject = async (req: ReinvestmentRequest) => {
    const reason = window.prompt('Ingresa el motivo del rechazo de la solicitud:', 'Cupo no disponible o datos no coincidentes');
    if (!reason || !reason.trim()) return;

    try {
      setActionLoadingId(req.id);
      await dataStore.rejectReinvestment(
        req.id,
        reason.trim(),
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      setStatusMessage({
        type: 'info',
        text: `Solicitud rechazada formalmente.`,
      });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `Error al rechazar: ${err.message}` });
    } finally {
      setActionLoadingId(null);
    }
  };

  // Orphan Scanner & Purge
  const handleScanOrphans = async () => {
    try {
      setIsScanningOrphans(true);
      const res = await dataStore.previewOrphanReinvestments();
      setOrphanScanResult(res);
      setStatusMessage({
        type: 'info',
        text: `Escaneo completado: ${res.totalScanned} documentos analizados. ${res.orphanCount} huérfanos candidatos a purga, ${res.protectedCount} documentos protegidos.`,
      });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `Error al escanear: ${err.message}` });
    } finally {
      setIsScanningOrphans(false);
    }
  };

  const handlePurgeOrphans = async () => {
    if (!orphanScanResult || orphanScanResult.candidates.length === 0) return;
    if (orphanConfirmationText.trim() !== 'ELIMINAR SOLICITUDES HUÉRFANAS') {
      alert('Debes escribir exactamente la frase de confirmación: ELIMINAR SOLICITUDES HUÉRFANAS');
      return;
    }

    try {
      setIsPurgingOrphans(true);
      const candidateIds = orphanScanResult.candidates.map((c: any) => c.id);
      const res = await dataStore.purgeOrphanReinvestments(candidateIds, orphanConfirmationText.trim());
      setStatusMessage({
        type: 'success',
        text: `Purga ejecutada exitosamente: ${res.purgedCount} solicitudes huérfanas eliminadas de Firestore.`,
      });
      setOrphanScanResult(null);
      setOrphanConfirmationText('');
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `Error al purgar: ${err.message}` });
    } finally {
      setIsPurgingOrphans(false);
    }
  };

  const getCategoryCanonicalBadge = (categoryOrCapital: string | number) => {
    let cat: BitacoraCategory = 'AZUL';
    if (typeof categoryOrCapital === 'number') {
      cat = getCategoryForCapital(categoryOrCapital);
    } else if (categoryOrCapital === 'VERDE' || categoryOrCapital === 'NEGRA' || categoryOrCapital === 'AZUL') {
      cat = categoryOrCapital;
    }

    if (cat === 'NEGRA') {
      return <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-200 font-black text-[10px] tracking-wide">BITÁCORA NEGRA</span>;
    }
    if (cat === 'VERDE') {
      return <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-500/40 text-emerald-300 font-bold text-[10px] tracking-wide">BITÁCORA VERDE</span>;
    }
    return <span className="px-2 py-0.5 rounded bg-blue-950 border border-blue-500/40 text-blue-300 font-bold text-[10px] tracking-wide">BITÁCORA AZUL</span>;
  };

  const getStatusBadge = (req: ReinvestmentRequest) => {
    const isApplied = req.status === 'APPLIED' || (req.status === 'APPROVED' && req.appliedAtCycleClosure);

    if (isApplied) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold font-mono">
          <CheckCheck className="w-3 h-3" />
          Aplicada en Cierre
        </span>
      );
    }
    if (req.status === 'APPROVED') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-teal-950/80 border border-teal-500/40 text-teal-300 text-[11px] font-bold font-mono">
          <Check className="w-3 h-3" />
          Aprobada (Lista)
        </span>
      );
    }
    if (req.status === 'PREAPPROVED') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-950/90 border border-indigo-500/50 text-indigo-300 text-[11px] font-bold font-mono animate-pulse">
          <Banknote className="w-3 h-3" />
          Preaprobada (Falta Dinero)
        </span>
      );
    }
    if (req.status === 'NEEDS_REVIEW') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-950/90 border border-amber-500/50 text-amber-300 text-[11px] font-bold font-mono">
          <AlertTriangle className="w-3 h-3" />
          En Revisión Inversionista
        </span>
      );
    }
    if (req.status === 'REJECTED') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-950/80 border border-rose-500/40 text-rose-300 text-[11px] font-bold font-mono">
          Rechazada
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-950/70 border border-amber-500/40 text-amber-300 text-[11px] font-bold font-mono">
        <Clock className="w-3 h-3" />
        Pendiente
      </span>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header Panel */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-100 flex items-center gap-2">
            <RotateCcw className="w-6 h-6 text-emerald-400" />
            Mesa de Control: Reinversiones & Inyecciones de Capital
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Validación de aportes, preaprobación con confirmación bancaria y aplicación atómica al cierre de ciclo.
          </p>
        </div>

        {/* Sub-tabs */}
        <div className="flex items-center gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800 flex-wrap">
          <button
            onClick={() => setActiveSubTab('reinvest')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              activeSubTab === 'reinvest'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reinversiones ({stats.pending + stats.preapproved + stats.needsReview})</span>
          </button>
          <button
            onClick={() => setActiveSubTab('waitlist')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              activeSubTab === 'waitlist'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Lista de Espera ({waitlist.length})</span>
          </button>
          {isSuperAdmin && (
            <button
              onClick={() => setActiveSubTab('orphans')}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                activeSubTab === 'orphans'
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Auditoría & Huérfanas</span>
            </button>
          )}
        </div>
      </div>

      {statusMessage && (
        <div
          className={`p-4 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 animate-in fade-in duration-200 ${
            statusMessage.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300'
              : statusMessage.type === 'error'
              ? 'bg-rose-950/70 border-rose-500/40 text-rose-300'
              : 'bg-blue-950/70 border-blue-500/40 text-blue-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{statusMessage.text}</span>
          </div>
          <button onClick={() => setStatusMessage(null)} className="text-slate-400 hover:text-slate-200 text-xs font-bold">
            ✕
          </button>
        </div>
      )}

      {/* Main Tab: Reinvestments */}
      {activeSubTab === 'reinvest' && (
        <div className="space-y-4">
          {/* Top Filter Chips Bar */}
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Filter Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none flex-wrap">
              <button
                onClick={() => setFilterStatus('ALL')}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer shrink-0 active:scale-95 ${
                  filterStatus === 'ALL'
                    ? 'bg-slate-700 text-white shadow'
                    : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                Todas ({stats.all})
              </button>
              <button
                onClick={() => setFilterStatus('PENDING')}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer shrink-0 flex items-center gap-1.5 active:scale-95 ${
                  filterStatus === 'PENDING'
                    ? 'bg-amber-600 text-white shadow'
                    : 'bg-slate-950/60 text-amber-400/80 hover:text-amber-300 border border-amber-500/20'
                }`}
              >
                Pendientes ({stats.pending})
              </button>
              <button
                onClick={() => setFilterStatus('PREAPPROVED')}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer shrink-0 flex items-center gap-1.5 active:scale-95 ${
                  filterStatus === 'PREAPPROVED'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'bg-slate-950/60 text-indigo-400/80 hover:text-indigo-300 border border-indigo-500/20'
                }`}
              >
                Preaprobadas ({stats.preapproved})
              </button>
              <button
                onClick={() => setFilterStatus('APPROVED')}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer shrink-0 flex items-center gap-1.5 active:scale-95 ${
                  filterStatus === 'APPROVED'
                    ? 'bg-teal-600 text-white shadow'
                    : 'bg-slate-950/60 text-teal-400/80 hover:text-teal-300 border border-teal-500/20'
                }`}
              >
                Aprobadas ({stats.approved})
              </button>
              <button
                onClick={() => setFilterStatus('NEEDS_REVIEW')}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer shrink-0 flex items-center gap-1.5 active:scale-95 ${
                  filterStatus === 'NEEDS_REVIEW'
                    ? 'bg-orange-600 text-white shadow'
                    : 'bg-slate-950/60 text-orange-400/80 hover:text-orange-300 border border-orange-500/20'
                }`}
              >
                En Revisión ({stats.needsReview})
              </button>
              <button
                onClick={() => setFilterStatus('APPLIED')}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer shrink-0 flex items-center gap-1.5 active:scale-95 ${
                  filterStatus === 'APPLIED'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'bg-slate-950/60 text-emerald-400/80 hover:text-emerald-300 border border-emerald-500/20'
                }`}
              >
                Aplicadas ({stats.applied})
              </button>
              <button
                onClick={() => setFilterStatus('REJECTED')}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer shrink-0 flex items-center gap-1.5 active:scale-95 ${
                  filterStatus === 'REJECTED'
                    ? 'bg-rose-600 text-white shadow'
                    : 'bg-slate-950/60 text-rose-400/80 hover:text-rose-300 border border-rose-500/20'
                }`}
              >
                Rechazadas ({stats.rejected})
              </button>
            </div>

            {/* Search Input */}
            <div className="relative min-w-[220px]">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Buscar por inversionista o código..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>

          {/* Table View Card */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
                  Listado Maestro de Solicitudes ({filteredReinvestments.length})
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Haz clic en cualquier fila para expandir el desglose financiero completo, fotografía de saldo y trazabilidad.
                </p>
              </div>
            </div>

            {filteredReinvestments.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <Info className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-xs text-slate-400 font-semibold">No hay solicitudes de reinversión o inyección de capital.</p>
              </div>
            ) : (
              <>
                {/* Desktop View: Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                        <th className="pb-3 px-3 w-8"></th>
                        <th className="pb-3 px-3">Inversionista</th>
                        <th className="pb-3 px-3">Ciclo & Fecha</th>
                        <th className="pb-3 px-3">Modalidad</th>
                        <th className="pb-3 px-3">Aumento Solicitado</th>
                        <th className="pb-3 px-3">Capital Proyectado</th>
                        <th className="pb-3 px-3">Estado</th>
                        <th className="pb-3 px-3 text-right">Acciones de Mesa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {filteredReinvestments.map((req) => {
                        const isExpanded = expandedId === req.id;
                        const isLoading = actionLoadingId === req.id;
                        const hasCash = Number(req.cashInjectionCop || 0) > 0;
                        const isApplied = req.status === 'APPLIED' || (req.status === 'APPROVED' && req.appliedAtCycleClosure);
                        const isCanonical = isCanonicalReinvestment(req);

                        return (
                          <React.Fragment key={req.id}>
                            <tr
                              onClick={() => setExpandedId((curr) => (curr === req.id ? null : req.id))}
                              className={`cursor-pointer transition select-none ${
                                isExpanded ? 'bg-slate-800/60' : 'hover:bg-slate-950/50'
                              }`}
                            >
                              <td className="py-3.5 px-3 text-slate-500">
                                {isExpanded ? <ChevronDown className="w-4 h-4 text-emerald-400" /> : <ChevronRight className="w-4 h-4" />}
                              </td>

                              <td className="py-3.5 px-3">
                                <p className="font-bold text-slate-200 text-sm">{req.userName || 'Inversionista'}</p>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-950 text-slate-400 border border-slate-800">
                                    {req.userCode || 'S/C'}
                                  </span>
                                </div>
                              </td>

                              <td className="py-3.5 px-3">
                                <span className="font-mono text-slate-300 font-bold">{req.sourceCycleId}</span>
                                <p className="text-[10px] text-slate-500 mt-0.5">
                                  {formatDateSafe(req.createdAt, true)}
                                </p>
                              </td>

                              <td className="py-3.5 px-3">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    req.modality === 'CAPITAL_INJECTION'
                                      ? 'bg-blue-950 text-blue-300 border border-blue-500/30'
                                      : 'bg-teal-950 text-teal-300 border border-teal-500/30'
                                  }`}
                                >
                                  {req.modality === 'CAPITAL_INJECTION' ? 'Inyección de Capital' : 'Reinversión de Ganancias'}
                                </span>
                              </td>

                              <td className="py-3.5 px-3">
                                <span className="font-mono font-bold text-emerald-400 text-sm">
                                  +{formatCOP(req.totalIncreaseCop || req.reinvestAmountCop || 0)}
                                </span>
                                {hasCash && (
                                  <span className="block text-[10px] text-blue-400 font-mono mt-0.5">
                                    Aporte Efectivo: {formatCOP(req.cashInjectionCop || 0)}
                                  </span>
                                )}
                              </td>

                              <td className="py-3.5 px-3">
                                <span className="font-mono font-bold text-slate-100">
                                  {formatCOP(req.projectedCapitalCop || req.newCapitalTargetCop || 0)}
                                </span>
                                <div className="mt-0.5">
                                  {getCategoryCanonicalBadge(req.projectedCategory || req.projectedCapitalCop || 0)}
                                </div>
                              </td>

                              <td className="py-3.5 px-3">
                                {getStatusBadge(req)}
                              </td>

                              <td className="py-3.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                                {isLoading ? (
                                  <span className="text-xs text-slate-400 font-mono animate-pulse">Procesando...</span>
                                ) : !isCanonical ? (
                                  <span className="text-[10px] text-amber-400 font-mono px-2 py-1 rounded bg-amber-950/60 border border-amber-500/30">
                                    Registro de prueba / requiere auditoría
                                  </span>
                                ) : (
                                  <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                    {/* PENDING State Actions */}
                                    {req.status === 'PENDING' && (
                                      <>
                                        {req.modality === 'CAPITAL_INJECTION' && hasCash ? (
                                          <button
                                            onClick={() => handlePreapprove(req)}
                                            className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold text-xs shadow-md shadow-indigo-600/20 transition cursor-pointer flex items-center gap-1"
                                            title="Preaprobar solicitud a la espera de verificar el dinero consignado"
                                          >
                                            <Banknote className="w-3.5 h-3.5" />
                                            <span>Preaprobar</span>
                                          </button>
                                        ) : (
                                          <button
                                            onClick={() => handleDirectApprove(req)}
                                            className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs shadow-md shadow-emerald-600/20 transition cursor-pointer flex items-center gap-1"
                                            title="Aprobar 100% ganancias para aplicarse en cierre de ciclo"
                                          >
                                            <Check className="w-3.5 h-3.5" />
                                            <span>Aprobar</span>
                                          </button>
                                        )}
                                        <button
                                          onClick={() => handleNeedsReview(req)}
                                          className="px-2 py-1.5 bg-slate-800 hover:bg-amber-950/60 text-amber-300 hover:text-amber-200 rounded-lg text-xs font-semibold border border-amber-500/30 transition cursor-pointer"
                                          title="Solicitar revisión y corrección al inversionista"
                                        >
                                          Revisar
                                        </button>
                                        <button
                                          onClick={() => handleReject(req)}
                                          className="px-2 py-1.5 bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 rounded-lg text-xs font-semibold border border-slate-700 transition cursor-pointer"
                                        >
                                          Rechazar
                                        </button>
                                      </>
                                    )}

                                    {/* PREAPPROVED State Actions */}
                                    {req.status === 'PREAPPROVED' && (
                                      <>
                                        <button
                                          onClick={() => handleConfirmCashAndApprove(req)}
                                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs shadow-md shadow-emerald-600/20 transition cursor-pointer flex items-center gap-1"
                                          title="Confirmar recepción bancaria y aprobar definitivamente"
                                        >
                                          <CheckCheck className="w-3.5 h-3.5" />
                                          <span>Confirmar Dinero y Aprobar</span>
                                        </button>
                                        <button
                                          onClick={() => handleNeedsReview(req)}
                                          className="px-2 py-1.5 bg-slate-800 hover:bg-amber-950/60 text-amber-300 rounded-lg text-xs font-semibold border border-amber-500/30 transition cursor-pointer"
                                        >
                                          Revisar
                                        </button>
                                        <button
                                          onClick={() => handleReject(req)}
                                          className="px-2 py-1.5 bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 rounded-lg text-xs font-semibold border border-slate-700 transition cursor-pointer"
                                        >
                                          Rechazar
                                        </button>
                                      </>
                                    )}

                                    {/* NEEDS_REVIEW State Actions (NO direct approval!) */}
                                    {req.status === 'NEEDS_REVIEW' && (
                                      <>
                                        <span className="text-[10px] text-amber-400/90 font-mono px-2 py-1 rounded bg-amber-950/50 border border-amber-500/30">
                                          Esperando respuesta usuario
                                        </span>
                                        <button
                                          onClick={() => handleReject(req)}
                                          className="px-2 py-1 bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 rounded-lg text-xs font-semibold border border-slate-700 transition cursor-pointer"
                                          title="Rechazar definitivamente"
                                        >
                                          Rechazar
                                        </button>
                                      </>
                                    )}

                                    {/* APPROVED State Actions (Pre-closure options) */}
                                    {req.status === 'APPROVED' && !isApplied && (
                                      <div className="flex items-center gap-1">
                                        <span className="text-[10px] text-teal-400 font-mono px-2 py-1 rounded bg-teal-950/50 border border-teal-500/30">
                                          Lista para Cierre
                                        </span>
                                        <button
                                          onClick={() => handleReject(req)}
                                          className="px-1.5 py-1 text-slate-500 hover:text-rose-400 text-[10px] transition cursor-pointer"
                                          title="Cancelar y rechazar aprobación previa al cierre"
                                        >
                                          Deshacer
                                        </button>
                                      </div>
                                    )}

                                    {/* APPLIED or REJECTED */}
                                    {isApplied && (
                                      <span className="text-[11px] text-slate-500 font-mono">
                                        Ciclo cerrado ✓
                                      </span>
                                    )}
                                    {req.status === 'REJECTED' && (
                                      <span className="text-[11px] text-rose-400/80 font-mono">
                                        Rechazada
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>

                            {/* Expanded Detail Panel */}
                            {isExpanded && (
                              <tr className="bg-slate-950/80 border-b border-slate-800">
                                <td colSpan={8} className="p-4 sm:p-6 space-y-4">
                                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                    {/* Column 1: Snapshot al solicitar */}
                                    <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800/80 space-y-2">
                                      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold block">
                                        1. Fotografía Inicial
                                      </span>
                                      <div className="space-y-1.5 text-xs">
                                        <div className="flex justify-between">
                                          <span className="text-slate-400">Capital Base:</span>
                                          <span className="font-mono font-bold text-slate-200">
                                            {formatCOP(req.currentCapitalSnapshotCop || 0)}
                                          </span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-slate-400">Ganancia Ciclo:</span>
                                          <span className="font-mono text-emerald-400">
                                            {formatCOP(req.cycleProfitSnapshotCop || req.availableProfitCop || 0)}
                                          </span>
                                        </div>
                                        <div className="flex justify-between border-t border-slate-800 pt-1">
                                          <span className="text-slate-400">Máx. Reinvertible:</span>
                                          <span className="font-mono text-emerald-300">
                                            {formatCOP(req.reinvestableProfitCop || 0)}
                                          </span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Column 2: Desglose Aumento */}
                                    <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800/80 space-y-2">
                                      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold block">
                                        2. Desglose del Aumento
                                      </span>
                                      <div className="space-y-1.5 text-xs">
                                        <div className="flex justify-between">
                                          <span className="text-slate-400">Ganancia Aplicada:</span>
                                          <span className="font-mono font-bold text-emerald-400">
                                            {formatCOP(req.profitAppliedCop !== undefined ? req.profitAppliedCop : req.reinvestAmountCop || 0)}
                                          </span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-slate-400">Dinero Nuevo:</span>
                                          <span className="font-mono font-bold text-blue-400">
                                            {formatCOP(req.cashInjectionCop || 0)}
                                          </span>
                                        </div>
                                        <div className="flex justify-between border-t border-slate-800 pt-1">
                                          <span className="text-slate-400">Aumento Total:</span>
                                          <span className="font-mono font-bold text-emerald-300">
                                            +{formatCOP(req.totalIncreaseCop || req.reinvestAmountCop || 0)}
                                          </span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Column 3: Proyección & Dispersión */}
                                    <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800/80 space-y-2">
                                      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold block">
                                        3. Proyección & Dispersión
                                      </span>
                                      <div className="space-y-1.5 text-xs">
                                        <div className="flex justify-between">
                                          <span className="text-slate-400">Capital Proyectado:</span>
                                          <span className="font-mono font-bold text-slate-100">
                                            {formatCOP(req.projectedCapitalCop || req.newCapitalTargetCop || 0)}
                                          </span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                          <span className="text-slate-400">Próxima Categoría:</span>
                                          {getCategoryCanonicalBadge(req.projectedCategory || req.projectedCapitalCop || 0)}
                                        </div>
                                        <div className="flex justify-between border-t border-slate-800 pt-1">
                                          <span className="text-slate-400">Saldo a Consignar:</span>
                                          <span className="font-mono font-bold text-amber-400">
                                            {formatCOP(req.profitToDisburseCop || req.withdrawAmountCop || 0)}
                                          </span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Column 4: Trazabilidad & Auditoría */}
                                    <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800/80 space-y-1.5 text-[11px]">
                                      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold block">
                                        4. Trazabilidad
                                      </span>
                                      <p className="text-slate-400">
                                        <strong className="text-slate-300">ID:</strong> <span className="font-mono text-[10px]">{req.id}</span>
                                      </p>
                                      <p className="text-slate-400">
                                        <strong className="text-slate-300">Solicitada:</strong> {formatDateSafe(req.createdAt, true)}
                                      </p>
                                      {req.resolvedAt && (
                                        <p className="text-slate-400">
                                          <strong className="text-slate-300">Resuelta:</strong> {formatDateSafe(req.resolvedAt, true)} por {req.resolvedBy || 'Admin'}
                                        </p>
                                      )}
                                      {req.cashReceivedConfirmed && (
                                        <p className="text-emerald-400 font-semibold">
                                          ✓ Dinero verificado por {req.cashReceivedByName || 'Admin'} el {formatDateSafe(req.cashReceivedAt, true)}
                                        </p>
                                      )}
                                      {(req.rejectionReason || req.notes) && (
                                        <div className="mt-1 p-2 rounded bg-slate-950 border border-slate-800 text-amber-300 text-[10px]">
                                          <strong>Nota / Motivo:</strong> {req.rejectionReason || req.notes}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile View: Cards List */}
                <div className="md:hidden space-y-3">
                  {filteredReinvestments.map((req) => {
                    const isExpanded = expandedId === req.id;
                    const isLoading = actionLoadingId === req.id;
                    const hasCash = Number(req.cashInjectionCop || 0) > 0;
                    const isApplied = req.status === 'APPLIED' || (req.status === 'APPROVED' && req.appliedAtCycleClosure);
                    const isCanonical = isCanonicalReinvestment(req);

                    return (
                      <div
                        key={req.id}
                        onClick={() => setExpandedId((curr) => (curr === req.id ? null : req.id))}
                        className={`p-4 rounded-xl border transition cursor-pointer select-none space-y-3 ${
                          isExpanded
                            ? 'bg-slate-850 border-emerald-500/50 shadow-lg shadow-emerald-500/5'
                            : 'bg-slate-950/60 hover:bg-slate-900 border-slate-800'
                        }`}
                      >
                        {/* Top: Inversionista & Toggle Chevron */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-bold text-slate-100 text-sm truncate">{req.userName || 'Inversionista'}</p>
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 shrink-0">
                                {req.userCode || 'S/C'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-xs">
                              <span className="font-mono text-slate-300 font-bold">{req.sourceCycleId}</span>
                              <span className="text-slate-600">•</span>
                              <span className="text-[11px] text-slate-500">{formatDateSafe(req.createdAt, true)}</span>
                            </div>
                          </div>
                          <div className="shrink-0 pt-0.5">
                            {isExpanded ? (
                              <div className="w-7 h-7 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                                <ChevronDown className="w-4 h-4" />
                              </div>
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center">
                                <ChevronRight className="w-4 h-4" />
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Modalidad & Estado Badges */}
                        <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
                          <span
                            className={`px-2.5 py-1 rounded text-xs font-bold leading-normal ${
                              req.modality === 'CAPITAL_INJECTION'
                                ? 'bg-blue-950 text-blue-300 border border-blue-500/30'
                                : 'bg-teal-950 text-teal-300 border border-teal-500/30'
                            }`}
                          >
                            {req.modality === 'CAPITAL_INJECTION' ? 'Inyección de Capital' : 'Reinversión de Ganancias'}
                          </span>
                          <div className="shrink-0">{getStatusBadge(req)}</div>
                        </div>

                        {/* Financial Figures 2-col Grid */}
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block mb-0.5">
                              Aumento Solicitado
                            </span>
                            <span className="font-mono font-bold text-emerald-400 text-sm block">
                              +{formatCOP(req.totalIncreaseCop || req.reinvestAmountCop || 0)}
                            </span>
                            {hasCash && (
                              <span className="block text-[10px] text-blue-400 font-mono mt-0.5">
                                Efectivo: {formatCOP(req.cashInjectionCop || 0)}
                              </span>
                            )}
                          </div>

                          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block mb-0.5">
                              Capital Proyectado
                            </span>
                            <span className="font-mono font-bold text-slate-100 text-sm block">
                              {formatCOP(req.projectedCapitalCop || req.newCapitalTargetCop || 0)}
                            </span>
                            <div className="mt-1">
                              {getCategoryCanonicalBadge(req.projectedCategory || req.projectedCapitalCop || 0)}
                            </div>
                          </div>
                        </div>

                        {/* Action Buttons Section with Touch Targets >= 44px */}
                        <div className="pt-2 border-t border-slate-800" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                              {isCanonical ? 'Acciones de Mesa' : 'Acción Requerida'}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              {isExpanded ? 'Toca para contraer ▲' : 'Toca para ver desglose ▼'}
                            </span>
                          </div>

                          {isLoading ? (
                            <div className="py-2 text-center text-xs text-slate-400 font-mono animate-pulse">
                              Procesando...
                            </div>
                          ) : !isCanonical ? (
                            <span className="text-[10px] text-amber-400 font-mono px-2 py-1.5 rounded bg-amber-950/60 border border-amber-500/30 block text-center">
                              Registro de prueba / requiere auditoría
                            </span>
                          ) : (
                            <div className="flex items-center gap-2 flex-wrap">
                              {/* PENDING State Actions */}
                              {req.status === 'PENDING' && (
                                <>
                                  {req.modality === 'CAPITAL_INJECTION' && hasCash ? (
                                    <button
                                      onClick={() => handlePreapprove(req)}
                                      className="min-h-[44px] flex-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white rounded-xl font-bold text-xs shadow-md shadow-indigo-600/20 transition cursor-pointer flex items-center justify-center gap-1.5"
                                      title="Preaprobar solicitud a la espera de verificar el dinero consignado"
                                    >
                                      <Banknote className="w-4 h-4 shrink-0" />
                                      <span>Preaprobar</span>
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => handleDirectApprove(req)}
                                      className="min-h-[44px] flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-xl font-bold text-xs shadow-md shadow-emerald-600/20 transition cursor-pointer flex items-center justify-center gap-1.5"
                                      title="Aprobar 100% ganancias para aplicarse en cierre de ciclo"
                                    >
                                      <Check className="w-4 h-4 shrink-0" />
                                      <span>Aprobar</span>
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleNeedsReview(req)}
                                    className="min-h-[44px] px-3.5 py-2 bg-slate-800 hover:bg-amber-950/60 active:scale-95 text-amber-300 hover:text-amber-200 rounded-xl text-xs font-semibold border border-amber-500/30 transition cursor-pointer flex items-center justify-center"
                                    title="Solicitar revisión y corrección al inversionista"
                                  >
                                    Revisar
                                  </button>
                                  <button
                                    onClick={() => handleReject(req)}
                                    className="min-h-[44px] px-3.5 py-2 bg-slate-800 hover:bg-rose-950/60 active:scale-95 text-slate-400 hover:text-rose-300 rounded-xl text-xs font-semibold border border-slate-700 transition cursor-pointer flex items-center justify-center"
                                  >
                                    Rechazar
                                  </button>
                                </>
                              )}

                              {/* PREAPPROVED State Actions */}
                              {req.status === 'PREAPPROVED' && (
                                <>
                                  <button
                                    onClick={() => handleConfirmCashAndApprove(req)}
                                    className="min-h-[44px] w-full px-3 py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-xl font-bold text-xs shadow-md shadow-emerald-600/20 transition cursor-pointer flex items-center justify-center gap-1.5"
                                    title="Confirmar recepción bancaria y aprobar definitivamente"
                                  >
                                    <CheckCheck className="w-4 h-4 shrink-0" />
                                    <span>Confirmar Dinero y Aprobar</span>
                                  </button>
                                  <div className="flex items-center gap-2 w-full">
                                    <button
                                      onClick={() => handleNeedsReview(req)}
                                      className="min-h-[44px] flex-1 px-3 py-2 bg-slate-800 hover:bg-amber-950/60 active:scale-95 text-amber-300 rounded-xl text-xs font-semibold border border-amber-500/30 transition cursor-pointer flex items-center justify-center"
                                    >
                                      Revisar
                                    </button>
                                    <button
                                      onClick={() => handleReject(req)}
                                      className="min-h-[44px] flex-1 px-3 py-2 bg-slate-800 hover:bg-rose-950/60 active:scale-95 text-slate-400 hover:text-rose-300 rounded-xl text-xs font-semibold border border-slate-700 transition cursor-pointer flex items-center justify-center"
                                    >
                                      Rechazar
                                    </button>
                                  </div>
                                </>
                              )}

                              {/* NEEDS_REVIEW State Actions */}
                              {req.status === 'NEEDS_REVIEW' && (
                                <div className="flex items-center justify-between gap-2 w-full">
                                  <span className="text-[10px] text-amber-400/90 font-mono px-2.5 py-2 rounded-lg bg-amber-950/50 border border-amber-500/30 flex-1 text-center">
                                    Esperando respuesta usuario
                                  </span>
                                  <button
                                    onClick={() => handleReject(req)}
                                    className="min-h-[44px] px-4 py-2 bg-slate-800 hover:bg-rose-950/60 active:scale-95 text-slate-400 hover:text-rose-300 rounded-xl text-xs font-semibold border border-slate-700 transition cursor-pointer flex items-center justify-center"
                                    title="Rechazar definitivamente"
                                  >
                                    Rechazar
                                  </button>
                                </div>
                              )}

                              {/* APPROVED State Actions */}
                              {req.status === 'APPROVED' && !isApplied && (
                                <div className="flex items-center justify-between gap-2 w-full">
                                  <span className="text-[10px] text-teal-400 font-mono px-2.5 py-2 rounded-lg bg-teal-950/50 border border-teal-500/30">
                                    Lista para Cierre
                                  </span>
                                  <button
                                    onClick={() => handleReject(req)}
                                    className="min-h-[44px] px-3.5 py-2 text-slate-400 hover:text-rose-400 text-xs transition cursor-pointer border border-slate-800 rounded-xl bg-slate-900 active:scale-95"
                                    title="Cancelar y rechazar aprobación previa al cierre"
                                  >
                                    Deshacer
                                  </button>
                                </div>
                              )}

                              {/* APPLIED */}
                              {isApplied && (
                                <span className="text-xs text-slate-400 font-mono py-1">
                                  Ciclo cerrado ✓
                                </span>
                              )}

                              {/* REJECTED */}
                              {req.status === 'REJECTED' && (
                                <span className="text-xs text-rose-400/80 font-mono py-1">
                                  Rechazada
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Mobile Expanded Detail Section */}
                        {isExpanded && (
                          <div className="pt-3 border-t border-slate-800 space-y-2.5 text-xs">
                            {/* Panel 1: Fotografía Inicial */}
                            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800/80 space-y-2">
                              <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold block">
                                1. Fotografía Inicial
                              </span>
                              <div className="space-y-1.5">
                                <div className="flex justify-between">
                                  <span className="text-slate-400">Capital Base:</span>
                                  <span className="font-mono font-bold text-slate-200">
                                    {formatCOP(req.currentCapitalSnapshotCop || 0)}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-400">Ganancia Ciclo:</span>
                                  <span className="font-mono text-emerald-400">
                                    {formatCOP(req.cycleProfitSnapshotCop || req.availableProfitCop || 0)}
                                  </span>
                                </div>
                                <div className="flex justify-between border-t border-slate-800 pt-1">
                                  <span className="text-slate-400">Máx. Reinvertible:</span>
                                  <span className="font-mono text-emerald-300">
                                    {formatCOP(req.reinvestableProfitCop || 0)}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Panel 2: Desglose del Aumento */}
                            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800/80 space-y-2">
                              <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold block">
                                2. Desglose del Aumento
                              </span>
                              <div className="space-y-1.5">
                                <div className="flex justify-between">
                                  <span className="text-slate-400">Ganancia Aplicada:</span>
                                  <span className="font-mono font-bold text-emerald-400">
                                    {formatCOP(req.profitAppliedCop !== undefined ? req.profitAppliedCop : req.reinvestAmountCop || 0)}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-400">Dinero Nuevo:</span>
                                  <span className="font-mono font-bold text-blue-400">
                                    {formatCOP(req.cashInjectionCop || 0)}
                                  </span>
                                </div>
                                <div className="flex justify-between border-t border-slate-800 pt-1">
                                  <span className="text-slate-400">Aumento Total:</span>
                                  <span className="font-mono font-bold text-emerald-300">
                                    +{formatCOP(req.totalIncreaseCop || req.reinvestAmountCop || 0)}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Panel 3: Proyección & Dispersión */}
                            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800/80 space-y-2">
                              <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold block">
                                3. Proyección & Dispersión
                              </span>
                              <div className="space-y-1.5">
                                <div className="flex justify-between">
                                  <span className="text-slate-400">Capital Proyectado:</span>
                                  <span className="font-mono font-bold text-slate-100">
                                    {formatCOP(req.projectedCapitalCop || req.newCapitalTargetCop || 0)}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-slate-400">Próxima Categoría:</span>
                                  {getCategoryCanonicalBadge(req.projectedCategory || req.projectedCapitalCop || 0)}
                                </div>
                                <div className="flex justify-between border-t border-slate-800 pt-1">
                                  <span className="text-slate-400">Saldo a Consignar:</span>
                                  <span className="font-mono font-bold text-amber-400">
                                    {formatCOP(req.profitToDisburseCop || req.withdrawAmountCop || 0)}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Panel 4: Trazabilidad */}
                            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800/80 space-y-1.5 text-[11px]">
                              <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold block">
                                4. Trazabilidad
                              </span>
                              <p className="text-slate-400">
                                <strong className="text-slate-300">ID:</strong> <span className="font-mono text-[10px]">{req.id}</span>
                              </p>
                              <p className="text-slate-400">
                                <strong className="text-slate-300">Solicitada:</strong> {formatDateSafe(req.createdAt, true)}
                              </p>
                              {req.resolvedAt && (
                                <p className="text-slate-400">
                                  <strong className="text-slate-300">Resuelta:</strong> {formatDateSafe(req.resolvedAt, true)} por {req.resolvedBy || 'Admin'}
                                </p>
                              )}
                              {req.cashReceivedConfirmed && (
                                <p className="text-emerald-400 font-semibold">
                                  ✓ Dinero verificado por {req.cashReceivedByName || 'Admin'} el {formatDateSafe(req.cashReceivedAt, true)}
                                </p>
                              )}
                              {(req.rejectionReason || req.notes) && (
                                <div className="mt-1 p-2 rounded bg-slate-950 border border-slate-800 text-amber-300 text-[10px]">
                                  <strong>Nota / Motivo:</strong> {req.rejectionReason || req.notes}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Main Tab: Waitlist */}
      {activeSubTab === 'waitlist' && (
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
                Lista de Espera para Nuevas Inyecciones de Capital ({waitlist.length})
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Orden estricto de prelación por cola FIFO (#1, #2...).
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="pb-3 px-3">Turno</th>
                  <th className="pb-3 px-3">Inversionista</th>
                  <th className="pb-3 px-3">Capital Solicitado</th>
                  <th className="pb-3 px-3">Método de Pago</th>
                  <th className="pb-3 px-3">Fecha de Registro</th>
                  <th className="pb-3 px-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {waitlist.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      No hay registros en la lista de espera.
                    </td>
                  </tr>
                ) : (
                  waitlist.map((w) => (
                    <tr key={w.id} className="hover:bg-slate-950/40 transition">
                      <td className="py-3.5 px-3">
                        <span className="w-7 h-7 rounded-lg bg-blue-950 border border-blue-500/40 text-blue-300 font-black font-mono flex items-center justify-center text-xs">
                          #{w.queuePosition || 1}
                        </span>
                      </td>
                      <td className="py-3.5 px-3">
                        <p className="font-bold text-slate-200">{w.userName}</p>
                        <span className="text-[10px] font-mono text-slate-400">{w.userCode}</span>
                      </td>
                      <td className="py-3.5 px-3 font-mono font-bold text-slate-100 text-sm">
                        {formatCOP(w.requestedAmountCop)}
                      </td>
                      <td className="py-3.5 px-3 text-slate-300">
                        {w.paymentMethod}
                      </td>
                      <td className="py-3.5 px-3 font-mono text-slate-400 text-[11px]">
                        {formatDateSafe(w.createdAt, true)}
                      </td>
                      <td className="py-3.5 px-3">
                        <span className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-500/30 text-amber-300 text-[10px] font-bold font-mono">
                          En Espera
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Main Tab: Orphan Scanner & Purge (SuperAdmin only) */}
      {activeSubTab === 'orphans' && isSuperAdmin && (
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-black text-slate-100 flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-purple-400" />
                Auditoría y Limpieza Segura de Solicitudes Huérfanas
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Herramienta conservadora de mantenimiento. Detecta solicitudes con campos $0, sin usuario válido ni valor financiero para eliminarlas sin riesgo.
              </p>
            </div>

            <button
              onClick={handleScanOrphans}
              disabled={isScanningOrphans}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-xs shadow-md shadow-purple-600/30 transition cursor-pointer flex items-center gap-2 shrink-0 disabled:opacity-50"
            >
              <Search className="w-4 h-4" />
              <span>{isScanningOrphans ? 'Analizando Firestore...' : 'Escanear Solicitudes Huérfanas'}</span>
            </button>
          </div>

          {orphanScanResult ? (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Scan Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-[10px] text-slate-500 uppercase block font-bold">Total Analizadas</span>
                  <span className="text-2xl font-black font-mono text-slate-200 mt-1 block">
                    {orphanScanResult.totalScanned}
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-purple-950/40 border border-purple-500/30">
                  <span className="text-[10px] text-purple-400 uppercase block font-bold">Huérfanas Candidatas a Purga</span>
                  <span className="text-2xl font-black font-mono text-purple-300 mt-1 block">
                    {orphanScanResult.orphanCount}
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/30">
                  <span className="text-[10px] text-emerald-400 uppercase block font-bold">Documentos Protegidos (Con Valor)</span>
                  <span className="text-2xl font-black font-mono text-emerald-300 mt-1 block">
                    {orphanScanResult.protectedCount}
                  </span>
                </div>
              </div>

              {/* Candidates List */}
              {orphanScanResult.orphanCount > 0 ? (
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Documentos Candidatos a Eliminación Definitiva ({orphanScanResult.candidates.length})
                  </h4>
                  <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 divide-y divide-slate-800/60">
                    {orphanScanResult.candidates.map((c: any) => (
                      <div key={c.id} className="p-3 text-xs flex items-center justify-between gap-4">
                        <div>
                          <p className="font-mono text-slate-300 font-bold">{c.id}</p>
                          <p className="text-[10px] text-slate-500">
                            Ciclo: {c.sourceCycleId || 'S/C'} • Usuario ID: {c.userId || 'Vacío'} • Creada: {formatDateSafe(c.createdAt)}
                          </p>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-rose-950/70 border border-rose-500/30 text-rose-300 text-[10px] font-mono">
                          {c.reason}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Purge Confirmation Box */}
                  <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/40 space-y-3">
                    <div className="flex items-center gap-2 text-rose-300 font-bold text-xs">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>Confirmación Requerida para Purga de Huérfanas</span>
                    </div>
                    <p className="text-xs text-rose-200/80">
                      Para eliminar de forma irreversible las {orphanScanResult.orphanCount} solicitudes huérfanas identificadas, escribe exactamente la frase <strong className="text-rose-100 underline">ELIMINAR SOLICITUDES HUÉRFANAS</strong> en el siguiente campo:
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <input
                        type="text"
                        placeholder="ELIMINAR SOLICITUDES HUÉRFANAS"
                        value={orphanConfirmationText}
                        onChange={(e) => setOrphanConfirmationText(e.target.value)}
                        className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-rose-500/40 text-xs text-rose-200 font-mono placeholder-slate-600 focus:outline-none focus:border-rose-400"
                      />
                      <button
                        onClick={handlePurgeOrphans}
                        disabled={isPurgingOrphans || orphanConfirmationText.trim() !== 'ELIMINAR SOLICITUDES HUÉRFANAS'}
                        className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold text-xs shadow-md shadow-rose-600/30 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>{isPurgingOrphans ? 'Purgando...' : 'Ejecutar Purga'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-6 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-center space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                  <p className="text-xs font-bold text-emerald-300">
                    No se detectaron solicitudes huérfanas. La base de datos se encuentra limpia y consistente.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="py-12 text-center text-slate-500 text-xs space-y-2">
              <ShieldAlert className="w-8 h-8 mx-auto text-slate-600" />
              <p>Presiona "Escanear Solicitudes Huérfanas" para realizar una inspección de solo lectura (Dry Run).</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
