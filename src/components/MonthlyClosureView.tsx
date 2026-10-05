import React, { useState } from 'react';
import {
  CalendarDays,
  DollarSign,
  Users,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Unlock,
  Bell,
  RefreshCw,
  Info,
  Layers,
  Search,
  Eye,
  Edit3,
  X,
  ArrowRight,
  TrendingUp,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  User,
  Zap,
  Sparkles,
  Percent,
  Play,
  FileText,
  Activity,
  FileSpreadsheet,
  RotateCcw,
  SlidersHorizontal,
  Rocket,
} from 'lucide-react';
import { dataStore } from '../lib/dataStore';
import { firestoreService } from '../lib/firestoreService';
import { useAuth } from '../context/AuthContext';
import {
  BitacoraCategory,
  CategoryGroupInfo,
  UserProfile,
  CycleUserResult,
  CycleGroupCalculation,
} from '../types';
import { formatCOP, formatUSD, formatTRM } from '../lib/financialEngine';
import { fetchLiveTRM, LiveTRMResult } from '../lib/trmService';
import { DailyOperationsModal } from './DailyOperationsModal';
import { ExcelBitacoraImportModal } from './ExcelBitacoraImportModal';
import { CycleReportViewer } from './CycleReportViewer';
import { CyclePreparationView } from './CyclePreparationView';
import confetti from 'canvas-confetti';

interface MonthlyClosureViewProps {
  onNavigate?: (tab: string) => void;
}

export const MonthlyClosureView: React.FC<MonthlyClosureViewProps> = ({ onNavigate }) => {
  const { currentUser, isSuperAdmin } = useAuth();
  const activeCycle = dataStore.getActiveCycle();
  const allCycles = dataStore.getCycles();
  const activeUsers = dataStore.getActiveUsers();
  const globalConfig = dataStore.getConfig();
  const preparingCycleId = globalConfig?.preparingCycleId || null;
  const preparationCycle = preparingCycleId ? (dataStore.getCycleById(preparingCycleId) || null) : null;

  // Sub-pestañas: Cierre del ciclo vs Preparación del Próximo Ciclo vs Informes Oficiales (exclusivo SuperAdmin)
  const [activeSubTab, setActiveSubTab] = useState<'closure' | 'preparation' | 'reports'>('closure');

  const [selectedCycleId, setSelectedCycleId] = useState<string>(activeCycle.cycleId);
  const currentCycle = dataStore.getCycleById(selectedCycleId) || activeCycle;
  const isClosed = currentCycle.status === 'CLOSED';
  const usesFrozenCycleSnapshot =
    currentCycle.status === 'CLOSED' ||
    currentCycle.status === 'REOPENED';

  // Excel Bitacora Import Modal State
  const [showExcelImportModal, setShowExcelImportModal] = useState<boolean>(false);
  const [excelImportCategory, setExcelImportCategory] = useState<BitacoraCategory | undefined>(undefined);

  // Group inputs state for USD entered by the admin for each group
  const [usdInputs, setUsdInputs] = useState<Record<string, string>>({});
  const [calculatingKey, setCalculatingKey] = useState<string | null>(null);

  // Group Detail / Correction Modal
  const [selectedGroupForDetail, setSelectedGroupForDetail] = useState<CategoryGroupInfo | null>(null);
  const [correctionUsd, setCorrectionUsd] = useState<string>('');
  const [correctionReason, setCorrectionReason] = useState<string>('');
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  // Daily Operations Modal State
  const [selectedGroupForDailyOps, setSelectedGroupForDailyOps] = useState<CategoryGroupInfo | null>(null);

  // Send Notifications Confirmation Modal
  const [showNotifyModal, setShowNotifyModal] = useState<boolean>(false);
  const [notifyError, setNotifyError] = useState<string | null>(null);
  const [notifySuccess, setNotifySuccess] = useState<boolean>(false);

  // Reopen Modal
  const [showReopenModal, setShowReopenModal] = useState<boolean>(false);
  const [reopenReason, setReopenReason] = useState<string>('');
  const [reopenError, setReopenError] = useState<string | null>(null);

  // General Notification alert banner
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // TRM definitiva de cierre: obligatoria para ciclos modernos.
  const [closingTrmInput, setClosingTrmInput] = useState<string>('');
  const parsedClosingTrmInput = Number(closingTrmInput.replace(',', '.'));
  const hasValidClosingTrm =
    Number.isFinite(parsedClosingTrmInput) && parsedClosingTrmInput > 0;

  // TRM Adjustment Modal
  const [showTrmModal, setShowTrmModal] = useState<boolean>(false);
  const [newTrmInput, setNewTrmInput] = useState<string>(
    currentCycle.trmApplied != null ? String(currentCycle.trmApplied) : ''
  );
  const [trmReason, setTrmReason] = useState<string>('Ajuste oficial de TRM para liquidación del período');
  const [trmError, setTrmError] = useState<string | null>(null);
  const [liveTrmResult, setLiveTrmResult] = useState<LiveTRMResult | null>(null);
  const [isFetchingTrm, setIsFetchingTrm] = useState<boolean>(false);
  const [isUpdatingTrm, setIsUpdatingTrm] = useState<boolean>(false);

  const fetchMarketTrm = async () => {
    setIsFetchingTrm(true);
    try {
      const res = await fetchLiveTRM();
      setLiveTrmResult(res);
      setNewTrmInput(res.rate != null ? String(res.rate) : '');
      if (dataStore.getConfig().trmMode === 'AUTOMATIC') {
        dataStore.syncAutomaticTRM(res.rate, res.source);
      }
    } catch (e) {
      console.warn('Error fetching live TRM:', e);
    } finally {
      setIsFetchingTrm(false);
    }
  };

  // Active Bitacora Window selection: 'AZUL' | 'VERDE' | 'NEGRA' | 'ALL'
  const [activeBitacoraWindow, setActiveBitacoraWindow] = useState<'ALL' | BitacoraCategory>('AZUL');
  // View mode: 'TABBED' (single window view) or 'GRID' (multi-window mosaic view)
  const [windowLayoutMode, setWindowLayoutMode] = useState<'TABBED' | 'GRID'>('TABBED');
  // Search & Filter state per window
  const [windowSearchQuery, setWindowSearchQuery] = useState<string>('');
  const [windowStatusFilter, setWindowStatusFilter] = useState<'ALL' | 'PENDING' | 'CALCULATED'>('ALL');

  // Collapsed state for category cards
  const [collapsedCategories, setCollapsedCategories] = useState<Record<BitacoraCategory, boolean>>({
    AZUL: false,
    VERDE: false,
    NEGRA: false,
  });

  // Expanded state for individual capital groups to reveal users list
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const toggleGroupExpand = (key: string) => {
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const categoryGroups = dataStore.getCategoryGroups(selectedCycleId);
  const rawUserResults = dataStore.getUserResults(selectedCycleId);

  // Separación estricta entre Ciclo Activo y Ciclo Cerrado (Secciones 2, 3 y 4):
  // Si el ciclo está CERRADO: snapshot histórico inmutable (no filtrar usuarios que hoy no existan).
  // Si el ciclo está ACTIVO: filtrar estrictamente a usuarios que actualmente forman parte del ciclo activo.
  // Usuarios elegibles activos para el ciclo operativo actual (USER con status ACTIVE)
  const eligibleActiveUsers = activeUsers.filter(
    (u) =>
      u.status === 'ACTIVE' &&
      (
        u.role === 'USER' ||
        u.participatesInTrading === true
      )
  );
  const eligibleActiveUids = new Set(eligibleActiveUsers.map((u) => u.uid || u.id));

  const userResults = usesFrozenCycleSnapshot
    ? rawUserResults
    : rawUserResults.filter((r) => {
        const uid = r.userUid || r.userId;
        return eligibleActiveUids.has(uid);
      });

  const totalActiveUsers = usesFrozenCycleSnapshot
    ? (
        currentCycle.initialActiveUsersCount ||
        currentCycle.totalUsersActive ||
        rawUserResults.length
      )
    : eligibleActiveUsers.length;

  // calculatedEligibleUids: Set de UIDs únicos para evitar que duplicados sumen más de 100%
  const calculatedEligibleUids = new Set(
    userResults.map((r) => r.userUid || r.userId).filter(Boolean)
  );

  const calculatedUsersCount = isClosed
    ? (currentCycle.calculatedUsersCount || userResults.length)
    : calculatedEligibleUids.size;

  // Cálculo de progreso exacto sin parches de Math.min(100, ...)
  const progressPercentage = totalActiveUsers === 0
    ? 0
    : (calculatedEligibleUids.size / totalActiveUsers) * 100;

  const is100Percent = totalActiveUsers > 0 && calculatedEligibleUids.size >= totalActiveUsers;

  const missingUsers = isClosed
    ? []
    : eligibleActiveUsers.filter((u) => !calculatedEligibleUids.has(u.uid || u.id));

  // Top KPI calculations:
  // Si está CERRADO usa los agregados históricos o el consolidado snapshot.
  // Si está ACTIVO calcula estrictamente sobre los usuarios actualmente elegibles.
  const totalManagedCapital = isClosed
    ? (currentCycle.totalManagedCapital || userResults.reduce((sum, r) => sum + (r.cycleCapitalCop || r.groupCapitalCop || 0), 0))
    : eligibleActiveUsers.reduce((sum, u) => sum + (u.currentCapital || 0), 0);
  const totalUsdOperated = isClosed
    ? (currentCycle.totalGrossUsd || userResults.reduce((sum, r) => sum + (r.totalUsdOperated || 0), 0))
    : userResults.reduce((sum, r) => sum + (r.totalUsdOperated || 0), 0);
  const totalGrossCop = isClosed
    ? (currentCycle.totalGrossCop || userResults.reduce((sum, r) => sum + (r.totalGrossCop || 0), 0))
    : userResults.reduce((sum, r) => sum + (r.totalGrossCop || 0), 0);
  const totalUserProfitCop = isClosed
    ? (currentCycle.totalUsersProfitCop || userResults.reduce((sum, r) => sum + (r.userProfitCop || 0), 0))
    : userResults.reduce((sum, r) => sum + (r.userProfitCop || 0), 0);
  const totalAdminCommissionCop = isClosed
    ? (currentCycle.totalAdminCommissionCop || userResults.reduce((sum, r) => sum + (r.adminCommissionCop || 0), 0))
    : userResults.reduce((sum, r) => sum + (r.adminCommissionCop || 0), 0);

  // Solicitudes de Reinversión e Inyección asociadas al ciclo
  const cycleReinvestments = dataStore.getReinvestments().filter((r) => r.sourceCycleId === selectedCycleId);
  const pendingRequestsCount = cycleReinvestments.filter((r) => r.status === 'PENDING').length;
  const needsReviewRequestsCount = cycleReinvestments.filter((r) => r.status === 'NEEDS_REVIEW').length;
  const approvedRequestsCount = cycleReinvestments.filter((r) => r.status === 'APPROVED').length;
  const rejectedRequestsCount = cycleReinvestments.filter((r) => r.status === 'REJECTED').length;
  const appliedRequestsCount = cycleReinvestments.filter((r) => r.status === 'APPLIED').length;
  const hasUnresolvedRequests = pendingRequestsCount > 0 || needsReviewRequestsCount > 0;
  const isClosing = currentCycle.isClosing === true;

  const totalGroups = currentCycle.totalGroupsCount || (categoryGroups.AZUL.length + categoryGroups.VERDE.length + categoryGroups.NEGRA.length);
  const calculatedGroups = currentCycle.calculatedGroupsCount || (
    categoryGroups.AZUL.filter((g) => g.isCalculated).length +
    categoryGroups.VERDE.filter((g) => g.isCalculated).length +
    categoryGroups.NEGRA.filter((g) => g.isCalculated).length
  );

  const handleSaveTrm = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrmError(null);
    const parsed = parseFloat(newTrmInput.replace(/[^0-9.]/g, ''));
    if (isNaN(parsed) || parsed <= 0) {
      setTrmError('Ingresa un valor numérico de TRM válido mayor a cero.');
      return;
    }

    setIsUpdatingTrm(true);
    const clientRequestId = `trm_${selectedCycleId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      // 1. Invocar Cloud Function autoritativa (SUPERADMIN)
      const res = await firestoreService.adminUpdateCycleTrm({
        cycleId: selectedCycleId,
        newTrm: parsed,
        clientRequestId,
        reason: trmReason.trim() || 'Ajuste oficial de TRM para liquidación del período',
      });

      // 2. Sincronizar espejo en memoria local (DataStore)
      dataStore.updateCycleTrm(
        selectedCycleId,
        parsed,
        trmReason,
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );

      let msg = res.message || `TRM actualizada exitosamente a $${parsed.toLocaleString('es-CO')} COP.`;
      if (res.needsReviewCount && res.needsReviewCount > 0) {
        msg += ` ⚠️ Atención: ${res.needsReviewCount} solicitud(es) de reinversión/inyección pasaron a estado "Requiere Revisión (NEEDS_REVIEW)" debido al ajuste. Por favor verifícalas antes del cierre.`;
      }

      setStatusMessage({
        type: res.needsReviewCount && res.needsReviewCount > 0 ? 'info' : 'success',
        text: msg,
      });
      setShowTrmModal(false);
    } catch (err: any) {
      console.error('[MonthlyClosureView] Error actualizando TRM:', err);
      setTrmError(err.message || 'Error al actualizar y recalcular la TRM en el servidor.');
    } finally {
      setIsUpdatingTrm(false);
    }
  };

  // Quick preset shortcuts for USD amount based on capital
  const getSuggestedUsdForCapital = (capitalCop: number): number => {
    // 5% monthly return target in COP converted to USD
    const targetCop = capitalCop * 0.05;
    const trm = currentCycle.trmApplied || 0;
    return trm > 0 ? Math.round(targetCop / trm) : 0;
  };

  // Batch calculate all pending groups in a specific bitacora window
  const handleBatchCalculateCategory = (category: BitacoraCategory) => {
    if (isClosed) return;
    const groupsToCalc = categoryGroups[category].filter((g) => !g.isCalculated);
    if (groupsToCalc.length === 0) {
      setStatusMessage({
        type: 'info',
        text: `Todos los grupos de la Ventana Bitácora ${category} ya están calculados.`,
      });
      return;
    }

    try {
      groupsToCalc.forEach((g) => {
        const usdVal = getSuggestedUsdForCapital(g.groupCapitalCop);
        dataStore.calculateGroup(
          selectedCycleId,
          g.category,
          g.groupCapitalCop,
          usdVal,
          currentUser?.uid || 'admin_uid',
          currentUser?.fullName || 'Administrador Principal'
        );
      });
      confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
      setStatusMessage({
        type: 'success',
        text: `¡Ventana Bitácora ${category} liquidada con éxito! Se procesaron ${groupsToCalc.length} grupos con rendimiento sugerido (5%).`,
      });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Error al liquidar la ventana de bitácora' });
    }
  };

  // Handle single group calculation
  const handleCalculateGroup = (group: CategoryGroupInfo, explicitUsd?: number) => {
    const key = `${group.category}_${group.groupCapitalCop}`;
    const inputVal = explicitUsd !== undefined
      ? String(explicitUsd)
      : usdInputs[key] || (group.calculation?.totalUsdApplied != null ? String(group.calculation.totalUsdApplied) : '');
    const num = parseFloat(inputVal);

    if (isNaN(num) || num <= 0) {
      setStatusMessage({
        type: 'error',
        text: `Ingresa un monto USD válido para el grupo $${group.groupCapitalCop.toLocaleString('es-CO')} COP.`,
      });
      return;
    }

    setCalculatingKey(key);
    setStatusMessage(null);

    try {
      const res = dataStore.calculateGroup(
        selectedCycleId,
        group.category,
        group.groupCapitalCop,
        num,
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );

      setStatusMessage({
        type: 'success',
        text: res.message,
      });

      confetti({
        particleCount: 25,
        spread: 45,
        origin: { y: 0.7 },
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Error al calcular el grupo.',
      });
    } finally {
      setCalculatingKey(null);
    }
  };

  // Batch Auto-fill & Calculate All Groups with suggested 5% ROI
  const handleBatchAutoCalculate = () => {
    if (isClosed) return;
    setStatusMessage(null);

    let count = 0;
    const allGroups = [
      ...categoryGroups.AZUL,
      ...categoryGroups.VERDE,
      ...categoryGroups.NEGRA,
    ];

    try {
      for (const grp of allGroups) {
        if (!grp.isCalculated) {
          const suggested = getSuggestedUsdForCapital(grp.groupCapitalCop);
          dataStore.calculateGroup(
            selectedCycleId,
            grp.category,
            grp.groupCapitalCop,
            suggested,
            currentUser?.uid || 'admin_root_uid',
            currentUser?.fullName || 'Administrador Principal'
          );
          count++;
        }
      }

      setStatusMessage({
        type: 'success',
        text: `¡Mesa de Operaciones ejecutada con éxito! Se liquidaron ${count} grupos pendientes con rendimiento del 5%.`,
      });

      confetti({
        particleCount: 70,
        spread: 80,
        origin: { y: 0.6 },
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Error en ejecución por lote.',
      });
    }
  };

  // Handle Group Correction
  const handleApplyCorrection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroupForDetail) return;
    setCorrectionError(null);

    const newUsd = parseFloat(correctionUsd);
    if (isNaN(newUsd) || newUsd <= 0) {
      setCorrectionError('Ingresa un valor numérico en USD válido.');
      return;
    }

    if (!correctionReason || correctionReason.trim().length < 5) {
      setCorrectionError('Es obligatorio ingresar un motivo claro de la corrección (mínimo 5 caracteres).');
      return;
    }

    try {
      const res = dataStore.correctGroupCalculation(
        selectedCycleId,
        selectedGroupForDetail.category,
        selectedGroupForDetail.groupCapitalCop,
        newUsd,
        correctionReason,
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );

      setStatusMessage({
        type: 'success',
        text: res.message,
      });

      setSelectedGroupForDetail(null);
      setCorrectionReason('');
      setCorrectionUsd('');
    } catch (err: any) {
      setCorrectionError(err.message || 'Error al corregir el cálculo.');
    }
  };

  // Handle Send Notifications
  const handleSendNotifications = () => {
    setNotifyError(null);
    try {
      const res = dataStore.sendCycleNotifications(
        selectedCycleId,
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );

      setNotifySuccess(true);
      confetti({
        particleCount: 80,
        spread: 90,
        origin: { y: 0.6 },
      });

      setTimeout(() => {
        setNotifySuccess(false);
        setShowNotifyModal(false);
        setStatusMessage({
          type: 'success',
          text: res.message,
        });
      }, 1500);
    } catch (err: any) {
      setNotifyError(err.message || 'Error al enviar notificaciones.');
    }
  };

  // Handle Close Cycle
  const handleCloseCycle = async () => {
    const parsedClosingTrm = Number(closingTrmInput.replace(',', '.'));
    const canonicalCycleId = currentCycle?.cycleId;

    if (!canonicalCycleId) {
      setStatusMessage({
        type: 'error',
        text: 'No se pudo resolver el identificador canónico del ciclo a cerrar.',
      });
      return;
    }

    if (!Number.isFinite(parsedClosingTrm) || parsedClosingTrm <= 0) {
      setStatusMessage({
        type: 'error',
        text: 'Ingresa una TRM definitiva de cierre válida y mayor a cero antes de cerrar el ciclo.',
      });
      return;
    }
    if (isClosing) {
      alert('El ciclo ya se encuentra en proceso de cierre transaccional.');
      return;
    }

    if (hasUnresolvedRequests) {
      alert(`No puedes cerrar el ciclo todavía.\n\nExisten solicitudes asociadas al ciclo que requieren decisión administrativa previa:\n• Pendientes: ${pendingRequestsCount}\n• En Revisión: ${needsReviewRequestsCount}\n\nPor favor aprueba, rechaza o resuelve todas las solicitudes antes de cerrar.`);
      return;
    }

    if (window.confirm(`\u00bfEst\u00e1s seguro de congelar y CERRAR formalmente el ciclo ${currentCycle.name}?\n\n\u2022 Solicitudes Aprobadas que se aplicar\u00e1n a capital: ${approvedRequestsCount}\n\u2022 Solicitudes Rechazadas: ${rejectedRequestsCount}\n\nEsta acci\u00f3n ejecutar\u00e1 el Pre-Flight financiero, bloquear\u00e1 cualquier edici\u00f3n posterior y generar\u00e1 autom\u00e1ticamente una notificaci\u00f3n personalizada de cierre para cada inversionista usando la TRM definitiva ingresada.`)) {
      try {
        const res = await dataStore.closeCycle(
          canonicalCycleId,
          currentUser?.uid || 'admin_root_uid',
          currentUser?.fullName || 'Administrador Principal',
          parsedClosingTrm
        );
        setStatusMessage({
          type: 'success',
          text: res.message,
        });
      } catch (err: any) {
        setStatusMessage({
          type: 'error',
          text: err.message,
        });
      }
    }
  };

  // Handle Unlock Cycle (SuperAdmin recovery for orphaned closure lock)
  const handleUnlockCycle = async () => {
    if (!currentCycle) return;
    
    const attemptId = currentCycle.closureAttemptId || '';
    const startedAt = currentCycle.closingStartedAt || 'Desconocido';
    const startedBy = currentCycle.closingByName || currentCycle.closingByUid || 'Administrador';

    const confirmText = prompt(
      `⚠️ RECUPERACIÓN EXCLUSIVA DE SUPERADMIN\n\n` +
      `Estás a punto de forzar la liberación del lock de cierre huérfano para el ciclo ${currentCycle.name}.\n\n` +
      `Detalles del Lock Activo:\n` +
      `• Attempt ID: ${attemptId || 'Sin ID registrado'}\n` +
      `• Iniciado el: ${startedAt}\n` +
      `• Iniciado por: ${startedBy}\n\n` +
      `Para autorizar el desbloqueo, escribe exactamente 'DESBLOQUEAR CIERRE':`
    );

    if (confirmText !== 'DESBLOQUEAR CIERRE') {
      if (confirmText !== null) {
        alert('Confirmación incorrecta. La operación de desbloqueo fue cancelada.');
      }
      return;
    }

    const reason = prompt('Ingresa el motivo obligatorio para la auditoría de desbloqueo (mínimo 5 caracteres):', 'Liberación manual por interrupción de cierre');
    if (!reason || reason.trim().length < 5) {
      alert('Se requiere un motivo justificado de al menos 5 caracteres.');
      return;
    }

    try {
      const res = await dataStore.unlockCycle(
        selectedCycleId,
        attemptId,
        'DESBLOQUEAR CIERRE',
        reason.trim(),
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'SuperAdmin Principal'
      );
      setStatusMessage({
        type: 'success',
        text: res.message,
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Error al liberar el lock de cierre.',
      });
    }
  };

  // Handle Reopen Cycle
  const handleReopenCycle = async (e: React.FormEvent) => {
    e.preventDefault();
    setReopenError(null);
    if (!reopenReason || reopenReason.trim().length < 5) {
      setReopenError('El motivo de reapertura es obligatorio para auditoría.');
      return;
    }

    try {
      const res = await dataStore.reopenCycle(
        selectedCycleId,
        reopenReason,
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      setShowReopenModal(false);
      setReopenReason('');
      setStatusMessage({
        type: 'success',
        text: res.message,
      });
    } catch (err: any) {
      setReopenError(err.message);
    }
  };

  // Handle Update TRM
  const handleUpdateTrm = (e: React.FormEvent) => {
    e.preventDefault();
    setTrmError(null);
    const parsedTrm = parseFloat(newTrmInput.replace(/[^0-9.]/g, ''));
    if (isNaN(parsedTrm) || parsedTrm <= 0) {
      setTrmError('Por favor ingresa una TRM válida mayor a cero.');
      return;
    }

    try {
      const res = dataStore.updateCycleTrm(
        selectedCycleId,
        parsedTrm,
        trmReason || 'Ajuste administrativo de TRM',
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      setShowTrmModal(false);
      setTrmReason('');
      setStatusMessage({
        type: 'success',
        text: res.message,
      });
      confetti({
        particleCount: 30,
        spread: 50,
        origin: { y: 0.6 },
      });
    } catch (err: any) {
      setTrmError(err.message || 'Error al actualizar la TRM.');
    }
  };

  const handleResetGroupBalance = (group: CategoryGroupInfo) => {
    if (
      !window.confirm(
        `¿Estás seguro de REINICIAR EL SALDO a $0? Se eliminarán todas las operaciones y liquidaciones registradas para este grupo (${group.category} - ${formatCOP(
          group.groupCapitalCop
        )}) en este ciclo.`
      )
    ) {
      return;
    }

    try {
      const res = dataStore.resetDailyOperations(
        selectedCycleId,
        group.category,
        group.groupCapitalCop,
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      setSelectedGroupForDetail(null);
      setStatusMessage({
        type: 'success',
        text: res.message,
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Error al reiniciar el saldo.',
      });
    }
  };

  const toggleCategory = (cat: BitacoraCategory) => {
    setCollapsedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Sub-navegación: Cierre del Ciclo vs Informes Oficiales */}
      <div className="flex items-center gap-2 border-b border-slate-800/80 pb-3">
        <button
          type="button"
          onClick={() => setActiveSubTab('closure')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'closure'
              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-850'
          }`}
        >
          <Lock className="w-3.5 h-3.5" />
          Cierre del Ciclo
        </button>

        {isSuperAdmin && (
          <button
            type="button"
            onClick={() => setActiveSubTab('preparation')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === 'preparation'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-850'
            }`}
          >
            <Rocket className="w-3.5 h-3.5" />
            Preparación del Próximo Ciclo
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-slate-950 text-blue-300 ml-1 border border-blue-500/20">
              SuperAdmin
            </span>
          </button>
        )}

        {isSuperAdmin && (
          <button
            type="button"
            onClick={() => setActiveSubTab('reports')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === 'reports'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-850'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Informes Oficiales
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-slate-950 text-amber-300 ml-1 border border-amber-500/20">
              SuperAdmin
            </span>
          </button>
        )}
      </div>

      {activeSubTab === 'preparation' ? (
        <CyclePreparationView
          currentCycle={preparationCycle}
          currentUser={currentUser}
          onRefresh={() => {
            if (activeCycle) setSelectedCycleId(activeCycle.cycleId);
          }}
        />
      ) : activeSubTab === 'reports' ? (
        <CycleReportViewer />
      ) : (
        <>
      {/* Alert Status Banner */}
      {statusMessage && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between gap-3 text-xs font-medium ${
            statusMessage.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300 shadow-lg shadow-emerald-500/10'
              : statusMessage.type === 'error'
              ? 'bg-red-950/70 border-red-500/50 text-red-300 shadow-lg shadow-red-500/10'
              : 'bg-blue-950/70 border-blue-500/50 text-blue-300 shadow-lg shadow-blue-500/10'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
            ) : statusMessage.type === 'error' ? (
              <AlertTriangle className="w-5 h-5 shrink-0 text-red-400" />
            ) : (
              <Info className="w-5 h-5 shrink-0 text-blue-400" />
            )}
            <span className="whitespace-pre-line">{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="p-1 rounded-lg hover:bg-black/20 text-current opacity-80 hover:opacity-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Lock Status Banner (isClosing === true) */}
      {isClosing && (
        <div className="p-4 rounded-2xl bg-amber-950/80 border border-amber-500/60 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 shrink-0">
              <Lock className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h4 className="text-sm font-extrabold text-amber-200">
                🔒 Cierre Transaccional en Proceso (Lock Atómico Activo)
              </h4>
              <p className="text-xs text-amber-300/80 mt-0.5">
                El ciclo {currentCycle.name} está siendo procesado en el servidor. Las radicaciones y cálculos están bloqueados.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleUnlockCycle}
            className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-xs shadow-md transition cursor-pointer shrink-0"
            title="Liberar el lock si una transacción anterior quedó interrumpida o bloqueada"
          >
            🔓 Liberar Lock Huérfano (Recovery)
          </button>
        </div>
      )}

      {/* Top Header Bar from Mockup */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-2 border-b border-slate-800/80">
        <div>
          <h1 className="text-2xl font-black text-slate-100 tracking-tight flex items-center gap-2">
            Panel del Administrador
          </h1>
        </div>

        <div className="flex flex-col sm:flex-row lg:flex-wrap items-stretch sm:items-center gap-2.5 w-full lg:w-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full lg:w-auto">
            {/* Excel Import Button */}
            <button
              type="button"
              onClick={() => {
                setExcelImportCategory(undefined);
                setShowExcelImportModal(true);
              }}
              className="min-h-[40px] flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 hover:text-blue-200 border border-blue-500/40 text-xs font-bold shadow-sm transition cursor-pointer"
              title="Importar y migrar archivo Excel de bitácoras y usuarios"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span>Importar Excel</span>
            </button>

            {/* Active Cycle Selector */}
            <div className="min-h-[40px] flex items-center justify-between sm:justify-start gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs">
              <span className="text-slate-400 shrink-0">Ciclo Activo:</span>
              <select
                value={selectedCycleId}
                onChange={(e) => setSelectedCycleId(e.target.value)}
                className="bg-transparent font-bold text-slate-200 focus:outline-none cursor-pointer font-mono"
              >
                {allCycles.map((c) => (
                  <option key={c.cycleId} value={c.cycleId} className="bg-slate-900 text-slate-100">
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Configured TRM */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-3 py-2 sm:py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs w-full lg:w-auto">
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-slate-400">TRM Configurada:</span>
              <span className="text-blue-400 font-bold font-mono">{formatTRM(currentCycle.trmApplied)} COP</span>
              <span
                className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${
                  dataStore.getConfig().trmMode === 'AUTOMATIC'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                    : 'bg-amber-950 text-amber-300 border border-amber-500/30'
                }`}
              >
                {dataStore.getConfig().trmMode === 'AUTOMATIC' ? 'AUTO' : 'MANUAL'}
              </span>
            </div>
            {!isClosed && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate('bitacoras')}
                    className="min-h-[36px] text-[11px] font-bold text-blue-300 hover:text-blue-200 transition cursor-pointer flex items-center justify-center gap-1 border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 px-2.5 py-1 rounded-lg"
                    title="Ir a gestionar las bitácoras y registrar trades diarios"
                  >
                    <SlidersHorizontal className="w-3 h-3 shrink-0" />
                    <span>Bitácoras Diarias</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setNewTrmInput(
                      currentCycle.trmApplied != null ? String(currentCycle.trmApplied) : ''
                    );
                    setShowTrmModal(true);
                    fetchMarketTrm();
                  }}
                  className="min-h-[36px] text-[11px] font-bold text-amber-400 hover:text-amber-300 transition cursor-pointer flex items-center justify-center gap-1 border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1 rounded-lg"
                  title="Ajustar o sincronizar TRM del ciclo"
                >
                  <Edit3 className="w-3 h-3 shrink-0" />
                  <span>Ajustar TRM</span>
                </button>
              </div>
            )}
          </div>

          {/* Reopen Button if Closed */}
          {isClosed && (
            <button
              onClick={() => setShowReopenModal(true)}
              className="min-h-[40px] flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600/30 border border-amber-500/50 hover:bg-amber-600/50 text-amber-200 text-xs font-bold transition cursor-pointer w-full lg:w-auto"
            >
              <Unlock className="w-3.5 h-3.5" />
              <span>Reabrir</span>
            </button>
          )}
        </div>
      </div>

      {/* 6 KPI Cards Grid Matching Reference */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 w-full max-w-full">
        {/* Card 1: Capital Administrado */}
        <div className="p-3 sm:p-4 rounded-2xl bg-slate-900/95 border border-slate-800 shadow-md flex flex-col justify-between relative overflow-hidden group hover:border-slate-700 transition min-w-0">
          <div className="flex items-center justify-between mb-1.5 sm:mb-2">
            <span className="text-[10px] sm:text-[11px] font-semibold text-slate-400 truncate">Capital Total</span>
            <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0">
              <FileText className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xs sm:text-base font-black text-slate-100 font-mono tracking-tight truncate">
              {formatCOP(totalManagedCapital)}
            </p>
            <span className="text-[9px] sm:text-[10px] text-slate-500 font-mono truncate block">{totalActiveUsers} Inversionistas</span>
          </div>
        </div>

        {/* Card 2: Total Operado (USD) */}
        <div className="p-3 sm:p-4 rounded-2xl bg-slate-900/95 border border-slate-800 shadow-md flex flex-col justify-between relative overflow-hidden group hover:border-slate-700 transition min-w-0">
          <div className="flex items-center justify-between mb-1.5 sm:mb-2">
            <span className="text-[10px] sm:text-[11px] font-semibold text-slate-400 truncate">Operado (USD)</span>
            <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
              <DollarSign className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xs sm:text-base font-black text-slate-100 font-mono tracking-tight truncate">
              {formatUSD(totalUsdOperated)}
            </p>
            <span className="text-[9px] sm:text-[10px] text-slate-500 font-mono truncate block">Volumen global</span>
          </div>
        </div>

        {/* Card 3: Total Generado (COP) */}
        <div className="p-3 sm:p-4 rounded-2xl bg-slate-900/95 border border-slate-800 shadow-md flex flex-col justify-between relative overflow-hidden group hover:border-slate-700 transition min-w-0">
          <div className="flex items-center justify-between mb-1.5 sm:mb-2">
            <span className="text-[10px] sm:text-[11px] font-semibold text-slate-400 truncate">Generado (COP)</span>
            <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0">
              <TrendingUp className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xs sm:text-base font-black text-slate-100 font-mono tracking-tight truncate">
              {formatCOP(totalGrossCop)}
            </p>
            <span className="text-[9px] sm:text-[10px] text-slate-500 font-mono truncate block">Total Generado</span>
          </div>
        </div>

        {/* Card 4: Ganancia Usuarios */}
        <div className="p-3 sm:p-4 rounded-2xl bg-slate-900/95 border border-slate-800 shadow-md flex flex-col justify-between relative overflow-hidden group hover:border-slate-700 transition min-w-0">
          <div className="flex items-center justify-between mb-1.5 sm:mb-2">
            <span className="text-[10px] sm:text-[11px] font-semibold text-slate-400 truncate">Ganancia Users</span>
            <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
              <TrendingUp className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xs sm:text-base font-black text-emerald-400 font-mono tracking-tight truncate">
              {formatCOP(totalUserProfitCop)}
            </p>
            <span className="text-[9px] sm:text-[10px] text-emerald-500/70 font-mono truncate block">Inversionistas</span>
          </div>
        </div>

        {/* Card 5: Comisión Administrador */}
        <div className="p-3 sm:p-4 rounded-2xl bg-slate-900/95 border border-slate-800 shadow-md flex flex-col justify-between relative overflow-hidden group hover:border-slate-700 transition min-w-0">
          <div className="flex items-center justify-between mb-1.5 sm:mb-2">
            <span className="text-[10px] sm:text-[11px] font-semibold text-slate-400 truncate">Comisión Admin</span>
            <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0">
              <DollarSign className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xs sm:text-base font-black text-amber-400 font-mono tracking-tight truncate">
              {formatCOP(totalAdminCommissionCop)}
            </p>
            <span className="text-[9px] sm:text-[10px] text-amber-500/70 font-mono truncate block">Admin</span>
          </div>
        </div>

        {/* Card 6: Progreso General */}
        <div className="p-3 sm:p-4 rounded-2xl bg-slate-900/95 border border-slate-800 shadow-md flex flex-col justify-between relative overflow-hidden group hover:border-slate-700 transition min-w-0">
          <div className="flex items-center justify-between mb-1.5 sm:mb-2">
            <span className="text-[10px] sm:text-[11px] font-semibold text-slate-400 truncate">Progreso</span>
            <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xs sm:text-base font-black text-slate-100 font-mono tracking-tight truncate">
              {Math.round(progressPercentage)}%
            </p>
            <span className="text-[9px] sm:text-[10px] text-slate-500 font-mono truncate block">
              {calculatedUsersCount}/{totalActiveUsers} users
            </span>
          </div>
        </div>
      </div>

      {/* Progress & Verification Bar */}
      <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Progreso de Liquidación del Ciclo
            </span>
            <span
              className={`text-[11px] font-mono px-2 py-0.5 rounded font-bold ${
                is100Percent
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                  : 'bg-amber-950 text-amber-300 border border-amber-500/40'
              }`}
            >
              {is100Percent ? '100% COMPLETO ✓' : `${Math.round(progressPercentage)}% PROCESADO`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Notificaciones a Clientes:</span>
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-semibold font-mono ${
                currentCycle.notificationsSent
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}
            >
              {currentCycle.notificationsSent ? 'Despachadas ✓' : 'Pendientes de Enviar'}
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
          <div
            className={`h-full transition-all duration-500 ${
              is100Percent ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : 'bg-blue-600'
            }`}
            style={{ width: `${progressPercentage}%` }}
          />
        </div>

        {!is100Percent && missingUsers.length > 0 && (
          <div className="mt-2.5 p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/30 text-amber-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                Faltan <strong>{missingUsers.length}</strong> usuarios por calcular antes de enviar notificaciones o congelar el ciclo.
              </span>
            </div>
            <span className="text-[11px] font-mono text-amber-400/80">Revisa las bitácoras abajo ↓</span>
          </div>
        )}
      </div>

      {/* Selector y Control de Ventanas de Bitácoras */}
      <div className="p-4 sm:p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Layers className="w-5 h-5 text-blue-400" />
            <div>
              <h3 className="text-base font-extrabold text-slate-100 flex items-center gap-2">
                Bitácoras por Categoría
              </h3>
              <p className="text-xs text-slate-400">
                Liquidación mensual por grupos de capital exacto
              </p>
            </div>
          </div>

          {/* Category Range Legend Badges from Mockup */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
            <span className="px-2.5 py-1 rounded-lg bg-blue-950/70 border border-blue-500/30 text-blue-300">
              🔵 AZUL: $2.000.000 - $9.999.999
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-emerald-950/70 border border-emerald-500/30 text-emerald-300">
              🟢 VERDE: $10.000.000 - $59.999.999
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-600/40 text-slate-300">
              ⚫ NEGRA / WHALE: $60.000.000+
            </span>
          </div>
        </div>

        {/* Window Tabs Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {/* Ventana Azul Tab */}
          {(() => {
            const groups = categoryGroups['AZUL'];
            const usersCount = groups.reduce((sum, g) => sum + g.users.length, 0);
            const totalCap = groups.reduce((sum, g) => sum + g.users.reduce((uSum, u) => uSum + u.currentCapital, 0), 0);
            const calcCount = groups.filter((g) => g.isCalculated).length;
            const isSelected = activeBitacoraWindow === 'AZUL' && windowLayoutMode === 'TABBED';

            return (
              <button
                type="button"
                onClick={() => {
                  setActiveBitacoraWindow('AZUL');
                  setWindowLayoutMode('TABBED');
                }}
                className={`p-3.5 rounded-xl border text-left transition relative overflow-hidden cursor-pointer ${
                  isSelected
                    ? 'bg-blue-950/80 border-blue-500 text-blue-100 shadow-lg shadow-blue-500/20 ring-1 ring-blue-500'
                    : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:bg-slate-850 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    <span className="font-extrabold text-xs">Bitácora Azul</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-950 border border-blue-500/30 text-blue-300">
                    {calcCount}/{groups.length} Calcs
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 font-mono">{formatCOP(totalCap)}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{usersCount} inversionistas • $4M a $9M COP</p>
              </button>
            );
          })()}

          {/* Ventana Verde Tab */}
          {(() => {
            const groups = categoryGroups['VERDE'];
            const usersCount = groups.reduce((sum, g) => sum + g.users.length, 0);
            const totalCap = groups.reduce((sum, g) => sum + g.users.reduce((uSum, u) => uSum + u.currentCapital, 0), 0);
            const calcCount = groups.filter((g) => g.isCalculated).length;
            const isSelected = activeBitacoraWindow === 'VERDE' && windowLayoutMode === 'TABBED';

            return (
              <button
                type="button"
                onClick={() => {
                  setActiveBitacoraWindow('VERDE');
                  setWindowLayoutMode('TABBED');
                }}
                className={`p-3.5 rounded-xl border text-left transition relative overflow-hidden cursor-pointer ${
                  isSelected
                    ? 'bg-emerald-950/80 border-emerald-500 text-emerald-100 shadow-lg shadow-emerald-500/20 ring-1 ring-emerald-500'
                    : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:bg-slate-850 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span className="font-extrabold text-xs">Bitácora Verde</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-500/30 text-emerald-300">
                    {calcCount}/{groups.length} Calcs
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 font-mono">{formatCOP(totalCap)}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{usersCount} inversionistas • $10M a $50M COP</p>
              </button>
            );
          })()}

          {/* Ventana Negra Tab */}
          {(() => {
            const groups = categoryGroups['NEGRA'];
            const usersCount = groups.reduce((sum, g) => sum + g.users.length, 0);
            const totalCap = groups.reduce((sum, g) => sum + g.users.reduce((uSum, u) => uSum + u.currentCapital, 0), 0);
            const calcCount = groups.filter((g) => g.isCalculated).length;
            const isSelected = activeBitacoraWindow === 'NEGRA' && windowLayoutMode === 'TABBED';

            return (
              <button
                type="button"
                onClick={() => {
                  setActiveBitacoraWindow('NEGRA');
                  setWindowLayoutMode('TABBED');
                }}
                className={`p-3.5 rounded-xl border text-left transition relative overflow-hidden cursor-pointer ${
                  isSelected
                    ? 'bg-slate-800 border-slate-400 text-slate-100 shadow-lg shadow-slate-500/20 ring-1 ring-slate-400'
                    : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:bg-slate-850 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                    <span className="font-extrabold text-xs">Bitácora Negra</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 border border-slate-600 text-slate-300">
                    {calcCount}/{groups.length} Calcs
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 font-mono">{formatCOP(totalCap)}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{usersCount} inversionistas • &gt; $60M COP</p>
              </button>
            );
          })()}

          {/* Todas las Ventanas Tab */}
          {(() => {
            const isSelected = activeBitacoraWindow === 'ALL' || windowLayoutMode === 'GRID';
            return (
              <button
                type="button"
                onClick={() => {
                  setActiveBitacoraWindow('ALL');
                  setWindowLayoutMode('GRID');
                }}
                className={`p-3.5 rounded-xl border text-left transition relative overflow-hidden cursor-pointer ${
                  isSelected
                    ? 'bg-indigo-950/80 border-indigo-500 text-indigo-100 shadow-lg shadow-indigo-500/20 ring-1 ring-indigo-500'
                    : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:bg-slate-850 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="font-extrabold text-xs">Modo Mosaico (Todas)</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
                    Mosaico
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 font-mono">{formatCOP(totalManagedCapital)}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Visión unificada de las 3 bitácoras</p>
              </button>
            );
          })()}
        </div>

        {/* Global Window Filter / Search Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <div className="relative w-full sm:w-80">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filtrar grupos por monto o inversionista..."
              value={windowSearchQuery}
              onChange={(e) => setWindowSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            {windowSearchQuery && (
              <button
                onClick={() => setWindowSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <span className="text-xs text-slate-400">Estado de grupos:</span>
            <div className="flex items-center bg-slate-950 p-0.5 rounded-xl border border-slate-800 text-xs">
              <button
                onClick={() => setWindowStatusFilter('ALL')}
                className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                  windowStatusFilter === 'ALL' ? 'bg-slate-800 text-slate-100 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Todos
              </button>
              <button
                onClick={() => setWindowStatusFilter('PENDING')}
                className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                  windowStatusFilter === 'PENDING' ? 'bg-amber-950 text-amber-300 font-bold border border-amber-500/30' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Pendientes
              </button>
              <button
                onClick={() => setWindowStatusFilter('CALCULATED')}
                className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                  windowStatusFilter === 'CALCULATED' ? 'bg-emerald-950 text-emerald-300 font-bold border border-emerald-500/30' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Calculados
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Render Bitácora Windows */}
      {((activeBitacoraWindow === 'ALL' || windowLayoutMode === 'GRID')
        ? (['AZUL', 'VERDE', 'NEGRA'] as BitacoraCategory[])
        : [activeBitacoraWindow as BitacoraCategory]
      ).map((category) => {
        let groups = categoryGroups[category];

        // Filter groups by search query
        if (windowSearchQuery.trim()) {
          const q = windowSearchQuery.toLowerCase();
          groups = groups.filter(
            (g) =>
              String(g.groupCapitalCop).includes(q) ||
              g.users.some((u) => u.fullName.toLowerCase().includes(q) || u.userCode.toLowerCase().includes(q))
          );
        }

        // Filter groups by status
        if (windowStatusFilter === 'PENDING') {
          groups = groups.filter((g) => !g.isCalculated);
        } else if (windowStatusFilter === 'CALCULATED') {
          groups = groups.filter((g) => g.isCalculated);
        }

        const isCollapsed = collapsedCategories[category];
        const allCategoryGroups = categoryGroups[category];
        const totalUsersInWindow = allCategoryGroups.reduce((sum, g) => sum + g.users.length, 0);
        const totalCapitalInWindow = allCategoryGroups.reduce(
          (sum, g) => sum + g.users.reduce((uSum, u) => uSum + u.currentCapital, 0),
          0
        );
        const calculatedGroupsInWindow = allCategoryGroups.filter((g) => g.isCalculated).length;
        const totalCopGeneratedInWindow = allCategoryGroups.reduce(
          (sum, g) => sum + (g.calculation ? g.calculation.totalCopPerUser * g.users.length : 0),
          0
        );
        const totalUsersProfitInWindow = allCategoryGroups.reduce((sum, g) => sum + g.totalUsersProfitCop, 0);
        const totalAdminCommissionInWindow = allCategoryGroups.reduce((sum, g) => sum + g.totalAdminCommissionCop, 0);
        const windowProgressPercent =
          allCategoryGroups.length > 0
            ? Math.round((calculatedGroupsInWindow / allCategoryGroups.length) * 100)
            : 0;

        const catStyles = {
          AZUL: {
            title: 'Ventana Bitácora Azul',
            range: '$4.000.000 hasta menos de $10.000.000 COP',
            tag: 'TIER_BLUE_DESK',
            accent: 'blue',
            border: 'border-blue-500/40',
            bg: 'bg-slate-900',
            windowTopBg: 'bg-gradient-to-r from-slate-950 via-blue-950/40 to-slate-950 border-b border-blue-500/30',
            badgeBg: 'bg-blue-950 border-blue-500/40 text-blue-300',
            glow: 'shadow-blue-500/10',
            dot: 'bg-blue-500',
          },
          VERDE: {
            title: 'Ventana Bitácora Verde',
            range: '$10.000.000 hasta menos de $60.000.000 COP',
            tag: 'TIER_GREEN_DESK',
            accent: 'emerald',
            border: 'border-emerald-500/40',
            bg: 'bg-slate-900',
            windowTopBg: 'bg-gradient-to-r from-slate-950 via-emerald-950/40 to-slate-950 border-b border-emerald-500/30',
            badgeBg: 'bg-emerald-950 border-emerald-500/40 text-emerald-300',
            glow: 'shadow-emerald-500/10',
            dot: 'bg-emerald-500',
          },
          NEGRA: {
            title: 'Ventana Bitácora Negra',
            range: '$60.000.000 hasta $4.000.000.000 COP',
            tag: 'TIER_BLACK_WHALE_DESK',
            accent: 'slate',
            border: 'border-slate-700',
            bg: 'bg-slate-900',
            windowTopBg: 'bg-gradient-to-r from-slate-950 via-slate-800/40 to-slate-950 border-b border-slate-700',
            badgeBg: 'bg-slate-800 border-slate-600 text-slate-300',
            glow: 'shadow-slate-500/10',
            dot: 'bg-slate-400',
          },
        }[category];

        return (
          <div
            key={category}
            className={`rounded-2xl ${catStyles.bg} border ${catStyles.border} shadow-2xl ${catStyles.glow} overflow-hidden transition`}
          >
            {/* Window Frame Bar (macOS / Terminal Style) */}
            <div className={`p-4 sm:p-5 ${catStyles.windowTopBg} flex flex-col sm:flex-row sm:items-center justify-between gap-3 select-none`}>
              {/* Traffic Light Dots & Window Title */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="w-3 h-3 rounded-full bg-red-500/90 border border-red-600 shadow-sm" />
                  <div className="w-3 h-3 rounded-full bg-amber-500/90 border border-amber-600 shadow-sm" />
                  <div className="w-3 h-3 rounded-full bg-emerald-500/90 border border-emerald-600 shadow-sm" />
                </div>

                <div className="h-4 w-px bg-slate-800 mx-1 hidden sm:block" />

                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`w-2.5 h-2.5 rounded-full ${catStyles.dot} animate-pulse`} />
                  <h3 className="text-sm font-extrabold text-slate-100 tracking-tight flex items-center gap-2">
                    {catStyles.title}
                  </h3>
                  <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-mono font-bold border ${catStyles.badgeBg}`}>
                    {catStyles.range}
                  </span>
                  <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider hidden md:inline">
                    [{catStyles.tag}]
                  </span>
                </div>
              </div>

              {/* Window Actions & Progress Badge */}
              <div className="flex items-center gap-2.5 flex-wrap justify-between sm:justify-end">
                {/* Per-window Import Excel Button */}
                <button
                  type="button"
                  onClick={() => {
                    setExcelImportCategory(category);
                    setShowExcelImportModal(true);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-700 hover:border-blue-500 text-slate-300 hover:text-blue-300 text-[11px] font-semibold transition cursor-pointer"
                  title={`Importar archivo Excel para ${catStyles.title}`}
                >
                  <FileSpreadsheet className="w-3 h-3 text-blue-400" />
                  <span>Importar {category}</span>
                </button>

                {/* Window Batch Calculate Button */}
                {!isClosed && calculatedGroupsInWindow < allCategoryGroups.length && (
                  <button
                    onClick={() => handleBatchCalculateCategory(category)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-[11px] font-bold shadow-md shadow-emerald-600/30 transition cursor-pointer"
                    title={`Calcula automáticamente los grupos pendientes de esta ventana con rendimiento sugerido (5%)`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>⚡ Liquidar Ventana (5%)</span>
                  </button>
                )}

                {/* Progress Pill */}
                <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono">
                  <span className="text-slate-400">Progreso:</span>
                  <span
                    className={`font-bold ${
                      windowProgressPercent === 100 ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {calculatedGroupsInWindow} / {allCategoryGroups.length} ({windowProgressPercent}%)
                  </span>
                </div>

                {/* Minimize / Maximize Window Toggle */}
                <button
                  onClick={() => toggleCategory(category)}
                  className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition cursor-pointer"
                  title={isCollapsed ? 'Desplegar ventana' : 'Minimizar ventana'}
                >
                  {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Window Content Body */}
            {!isCollapsed && (
              <div className="p-4 sm:p-6 space-y-5">
                {/* Window Summary Financial Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Inversionistas</span>
                    <p className="text-sm font-extrabold text-slate-100 font-mono mt-0.5">
                      {totalUsersInWindow} <span className="text-xs font-normal text-slate-400">usuarios</span>
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Capital Ventana</span>
                    <p className="text-sm font-extrabold text-slate-100 font-mono mt-0.5">
                      {formatCOP(totalCapitalInWindow)}
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Total COP Generado</span>
                    <p className="text-sm font-extrabold text-blue-400 font-mono mt-0.5">
                      {formatCOP(totalCopGeneratedInWindow)}
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Ganancia Clientes</span>
                    <p className="text-sm font-extrabold text-emerald-400 font-mono mt-0.5">
                      {formatCOP(totalUsersProfitInWindow)}
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Comisión Admin</span>
                    <p className="text-sm font-extrabold text-amber-400 font-mono mt-0.5">
                      {formatCOP(totalAdminCommissionInWindow)}
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 flex flex-col justify-center">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Estado de Ventana</span>
                    <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800 mt-1">
                      <div
                        className={`h-full transition-all duration-300 ${
                          windowProgressPercent === 100 ? 'bg-emerald-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${windowProgressPercent}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Groups Table / Empty state inside the window */}
                {groups.length === 0 ? (
                  <div className="p-8 rounded-xl bg-slate-950/40 border border-slate-800 text-center space-y-2">
                    <p className="text-xs text-slate-400">
                      {windowSearchQuery || windowStatusFilter !== 'ALL'
                        ? 'No se encontraron grupos que coincidan con los filtros aplicados en esta ventana.'
                        : 'No hay inversionistas activos con capitales correspondientes a esta ventana.'}
                    </p>
                    {(windowSearchQuery || windowStatusFilter !== 'ALL') && (
                      <button
                        onClick={() => {
                          setWindowSearchQuery('');
                          setWindowStatusFilter('ALL');
                        }}
                        className="text-xs text-blue-400 hover:underline font-bold"
                      >
                        Restablecer filtros de ventana
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Mobile View: Clean Group Cards (block lg:hidden) */}
                    <div className="block lg:hidden space-y-3.5">
                      {groups.map((group) => {
                        const key = `${group.category}_${group.groupCapitalCop}`;
                        const isCalc = group.isCalculated;
                        const isExpanded = !!expandedGroups[key];
                        const currentUsdInput =
                          usdInputs[key] ??
                          (group.calculation?.totalUsdApplied != null
                            ? String(group.calculation.totalUsdApplied)
                            : '');
                        const isBusy = calculatingKey === key;
                        const suggested5Pct = getSuggestedUsdForCapital(group.groupCapitalCop);

                        return (
                          <div
                            key={key}
                            className={`p-4 rounded-2xl bg-slate-950/80 border transition space-y-3.5 ${
                              isCalc
                                ? 'border-emerald-500/40 bg-emerald-950/10'
                                : 'border-slate-800 hover:border-slate-700'
                            }`}
                          >
                            {/* Card Top: Capital & Status */}
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-black text-base text-slate-100">
                                  {formatCOP(group.groupCapitalCop)}
                                </span>
                              </div>

                              {isCalc ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-300 font-bold text-[10px] font-mono border border-emerald-500/40">
                                  <CheckCircle2 className="w-3 h-3" /> Calculado ✓
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-950/80 text-amber-300 font-semibold text-[10px] font-mono border border-amber-500/40">
                                  Pendiente
                                </span>
                              )}
                            </div>

                            {/* Users toggle & Daily operations badge */}
                            <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-900">
                              <button
                                type="button"
                                onClick={() => toggleGroupExpand(key)}
                                className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 font-semibold cursor-pointer"
                              >
                                <Users className="w-3.5 h-3.5" />
                                <span>{group.users.length} {group.users.length === 1 ? 'Inversionista' : 'Inversionistas'}</span>
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>

                              <button
                                type="button"
                                onClick={() => setSelectedGroupForDailyOps(group)}
                                className="flex items-center gap-1 text-[11px] text-blue-400 bg-blue-950/60 px-2 py-0.5 rounded-lg border border-blue-500/20 font-mono"
                              >
                                <Activity className="w-3 h-3 text-blue-400" />
                                <span>
                                  {group.dailyOperations && group.dailyOperations.length > 0
                                    ? `${group.dailyOperations.length} ops (${formatUSD(group.totalUsdApplied)})`
                                    : '+ Operaciones'}
                                </span>
                              </button>
                            </div>

                            {/* Expanded user list */}
                            {isExpanded && (
                              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-xs">
                                <div className="text-[10px] uppercase font-bold text-slate-400">Inversionistas vinculados ({group.users.length}):</div>
                                <div className="space-y-2">
                                  {group.users.map((u) => {
                                    const rawUserPct = u.userPercentage !== undefined ? u.userPercentage : 75;
                                    const rawAdminPct = u.adminPercentage !== undefined ? u.adminPercentage : 25;
                                    const userPct = rawUserPct > 1 ? rawUserPct / 100 : rawUserPct;
                                    const adminPct = rawAdminPct > 1 ? rawAdminPct / 100 : rawAdminPct;
                                    const appliedUsd = group.calculation?.totalUsdApplied || group.totalUsdApplied || 0;
                                    const grossCop = appliedUsd * (currentCycle.trmApplied || 0);
                                    const clientProfitCop = grossCop * userPct;
                                    const adminCommissionCop = grossCop * adminPct;

                                    return (
                                      <div key={u.id} className="p-2 rounded-lg bg-slate-950 border border-slate-800/80 text-[11px] font-mono space-y-1">
                                        <div className="flex items-center justify-between">
                                          <span className="text-slate-200 font-bold truncate max-w-[170px]">{u.fullName}</span>
                                          <span className="text-blue-400 font-bold">{formatUSD(appliedUsd)}</span>
                                        </div>
                                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                                          <span>{u.userCode}</span>
                                          <span>Base: {formatCOP(u.currentCapital)}</span>
                                        </div>
                                        {isCalc && (
                                          <div className="flex items-center justify-between text-[10px] pt-1 border-t border-slate-800">
                                            <span className="text-emerald-400 font-semibold">G. Cliente: {formatCOP(clientProfitCop)}</span>
                                            <span className="text-amber-400 font-semibold">Com. Admin: {formatCOP(adminCommissionCop)}</span>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* USD Input & Calculate/Detail Actions */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                              <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-700/80 rounded-xl px-3 py-1.5">
                                <span className="text-slate-400 font-mono text-xs font-bold">$ USD:</span>
                                <input
                                  type="number"
                                  step="1"
                                  disabled={isClosed}
                                  placeholder={`ej: ${suggested5Pct}`}
                                  value={currentUsdInput}
                                  onChange={(e) =>
                                    setUsdInputs((prev) => ({ ...prev, [key]: e.target.value }))
                                  }
                                  className="w-full bg-transparent text-slate-100 font-bold font-mono text-sm focus:outline-none"
                                />
                              </div>

                              <div className="flex items-center gap-2">
                                {isCalc ? (
                                  <button
                                    onClick={() => {
                                      setSelectedGroupForDetail(group);
                                      setCorrectionUsd(
                                        group.calculation?.totalUsdApplied != null
                                          ? String(group.calculation.totalUsdApplied)
                                          : ''
                                      );
                                    }}
                                    className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition border border-slate-700 cursor-pointer"
                                  >
                                    <Eye className="w-3.5 h-3.5 text-blue-400" />
                                    <span>Ver Detalle</span>
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleCalculateGroup(group)}
                                    disabled={isClosed || isBusy}
                                    className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-md shadow-blue-600/30 cursor-pointer"
                                  >
                                    {isBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                                    <span>Calcular</span>
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Calculated Metrics Breakdown */}
                            {isCalc && (
                              <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-slate-900/90 border border-slate-800/90 text-xs font-mono">
                                <div>
                                  <span className="text-[9px] text-slate-500 uppercase block">Total COP</span>
                                  <span className="font-bold text-slate-200 text-[11px] block mt-0.5">
                                    {formatCOP(group.totalCopPerUser)}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[9px] text-emerald-400 uppercase block">Inversionistas</span>
                                  <span className="font-bold text-emerald-400 text-[11px] block mt-0.5">
                                    {formatCOP(group.totalUsersProfitCop)}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[9px] text-amber-400 uppercase block">Comisión Admin</span>
                                  <span className="font-bold text-amber-400 text-[11px] block mt-0.5">
                                    {formatCOP(group.totalAdminCommissionCop)}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Desktop View: Full Table (hidden lg:block) */}
                    <div className="hidden lg:block overflow-x-auto rounded-xl border border-slate-800/90 bg-slate-950/60">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-800 bg-slate-950 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                            <th className="py-3 px-3">Capital del Grupo</th>
                            <th className="py-3 px-3">Inversionistas</th>
                            <th className="py-3 px-3">USD Operado (c/u)</th>
                            <th className="py-3 px-3">Resultado Total COP</th>
                            <th className="py-3 px-3">Ganancia Clientes</th>
                            <th className="py-3 px-3">Comisión Admin</th>
                            <th className="py-3 px-3">Estado</th>
                            <th className="py-3 px-3 text-right">Acción</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 font-mono">
                          {groups.map((group) => {
                            const key = `${group.category}_${group.groupCapitalCop}`;
                            const isCalc = group.isCalculated;
                            const isExpanded = !!expandedGroups[key];
                            const currentUsdInput =
                              usdInputs[key] ??
                              (group.calculation?.totalUsdApplied != null
                                ? String(group.calculation.totalUsdApplied)
                                : '');
                            const isBusy = calculatingKey === key;
                            const suggested5Pct = getSuggestedUsdForCapital(group.groupCapitalCop);

                            // Estimated Yield % based on current input or calculated value
                            const activeUsdNum = parseFloat(currentUsdInput) || (group.calculation?.totalUsdApplied || 0);
                            const activeCopValue = activeUsdNum * (currentCycle.trmApplied || 0);
                            const estimatedRoi = group.groupCapitalCop > 0 ? ((activeCopValue / group.groupCapitalCop) * 100).toFixed(1) : '0';

                            return (
                              <React.Fragment key={key}>
                                <tr className={`hover:bg-slate-900/80 transition ${isCalc ? 'bg-emerald-950/10' : ''} ${isExpanded ? 'bg-slate-850/60' : ''}`}>
                                  {/* Capital with Expand Button and Operations Counter */}
                                  <td className="py-3.5 px-3">
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => toggleGroupExpand(key)}
                                        className="p-1 rounded bg-slate-950 border border-slate-800 hover:border-slate-600 text-slate-400 hover:text-white transition cursor-pointer"
                                        title={isExpanded ? 'Ocultar inversionistas de este grupo' : 'Ver inversionistas de este grupo'}
                                      >
                                        {isExpanded ? (
                                          <ChevronDown className="w-3.5 h-3.5 text-blue-400" />
                                        ) : (
                                          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                                        )}
                                      </button>
                                      <div>
                                        <span
                                          onClick={() => toggleGroupExpand(key)}
                                          className="font-bold text-slate-100 text-sm cursor-pointer hover:text-blue-400 transition block"
                                        >
                                          {formatCOP(group.groupCapitalCop)}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => setSelectedGroupForDailyOps(group)}
                                          className="mt-0.5 flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 font-mono font-medium hover:underline transition"
                                          title="Ver bitácora de operaciones diarias del grupo"
                                        >
                                          <Activity className="w-3 h-3 text-blue-400 shrink-0" />
                                          <span>
                                            {group.dailyOperations && group.dailyOperations.length > 0
                                              ? `${group.dailyOperations.length} trades (${formatUSD(group.totalUsdApplied)})`
                                              : '+ Bitácora Diaria'}
                                          </span>
                                        </button>
                                      </div>
                                    </div>
                                  </td>

                                  {/* Users count and preview (Clickable) */}
                                  <td className="py-3.5 px-3 font-sans">
                                    <button
                                      type="button"
                                      onClick={() => toggleGroupExpand(key)}
                                      className="text-left group/u cursor-pointer"
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className="font-mono font-bold text-blue-400 bg-blue-950/80 group-hover/u:bg-blue-900 px-2 py-0.5 rounded text-xs border border-blue-500/20 transition flex items-center gap-1">
                                          <Users className="w-3 h-3" />
                                          {group.users.length} {group.users.length === 1 ? 'usuario' : 'usuarios'}
                                        </span>
                                        <span className="text-[10px] text-blue-400/80 group-hover/u:text-blue-300 underline underline-offset-2">
                                          {isExpanded ? 'Ocultar' : 'Ver nombres'}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1 mt-1 text-[11px] text-slate-400">
                                        <span className="truncate max-w-[160px]">
                                          {group.users.map((u) => u.fullName.split(' ')[0]).join(', ')}
                                        </span>
                                      </div>
                                    </button>
                                  </td>

                                  {/* USD Input */}
                                  <td className="py-3.5 px-3">
                                    <div className="flex items-center gap-1">
                                      <span className="text-slate-500 font-mono">$</span>
                                      <input
                                        type="number"
                                        step="1"
                                        disabled={isClosed}
                                        placeholder="ej: 400"
                                        value={currentUsdInput}
                                        onChange={(e) =>
                                          setUsdInputs((prev) => ({ ...prev, [key]: e.target.value }))
                                        }
                                        className="w-24 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-100 font-bold text-xs focus:outline-none focus:border-blue-500 disabled:opacity-60"
                                      />
                                    </div>
                                  </td>

                                  {/* Total COP per user */}
                                  <td className="py-3.5 px-3 text-slate-200">
                                    {isCalc ? formatCOP(group.totalCopPerUser) : '—'}
                                  </td>

                                  {/* User Profit */}
                                  <td className="py-3.5 px-3 font-semibold text-emerald-400">
                                    {isCalc ? formatCOP(group.totalUsersProfitCop) : '—'}
                                  </td>

                                  {/* Admin Commission */}
                                  <td className="py-3.5 px-3 font-semibold text-amber-400">
                                    {isCalc ? formatCOP(group.totalAdminCommissionCop) : '—'}
                                  </td>

                                  {/* Status Badge */}
                                  <td className="py-3.5 px-3 font-sans">
                                    {isCalc ? (
                                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-bold text-[11px] font-mono shadow-sm">
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        Calculado ✓
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-950/60 border border-amber-500/40 text-amber-300 font-semibold text-[11px] font-mono">
                                        Pendiente
                                      </span>
                                    )}
                                  </td>

                                  {/* Action Buttons */}
                                  <td className="py-3.5 px-3 text-right font-sans">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => setSelectedGroupForDailyOps(group)}
                                        className="px-2.5 py-1.5 bg-blue-950/70 hover:bg-blue-900/90 text-blue-300 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer border border-blue-500/30"
                                        title="Registrar o gestionar operaciones diarias de este grupo"
                                      >
                                        <Activity className="w-3.5 h-3.5 text-blue-400" />
                                        <span className="hidden sm:inline">Bitácora Diaria</span>
                                      </button>

                                      {isCalc ? (
                                        <button
                                          onClick={() => {
                                            setSelectedGroupForDetail(group);
                                            setCorrectionUsd(
                                              group.calculation?.totalUsdApplied != null
                                                ? String(group.calculation.totalUsdApplied)
                                                : ''
                                            );
                                          }}
                                          className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer border border-slate-700"
                                        >
                                          <Eye className="w-3.5 h-3.5 text-blue-400" />
                                          <span>Detalle</span>
                                        </button>
                                      ) : (
                                        <button
                                          onClick={() => handleCalculateGroup(group)}
                                          disabled={isClosed || isBusy}
                                          className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white rounded-lg text-xs font-bold shadow-md shadow-blue-600/30 flex items-center gap-1 transition cursor-pointer"
                                        >
                                          {isBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                                          <span>Calcular</span>
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>

                                {/* Expanded Users Drawer Row */}
                                {isExpanded && (
                                  <tr className="bg-slate-950/90 border-y border-blue-500/20">
                                    <td colSpan={8} className="p-4 sm:p-5 font-sans">
                                      <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-4 space-y-3 shadow-inner">
                                        {/* Drawer Header */}
                                        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                                          <div className="flex items-center gap-2">
                                            <Users className="w-4 h-4 text-blue-400" />
                                            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-200">
                                              Inversionistas en este Grupo de Capital ({formatCOP(group.groupCapitalCop)})
                                            </span>
                                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-950 border border-blue-500/30 text-blue-300 font-mono font-bold">
                                              {group.users.length} {group.users.length === 1 ? 'persona' : 'personas'}
                                            </span>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => toggleGroupExpand(key)}
                                            className="text-slate-400 hover:text-slate-200 text-xs flex items-center gap-1 font-mono cursor-pointer"
                                          >
                                            <span>Cerrar</span>
                                            <ChevronUp className="w-3.5 h-3.5" />
                                          </button>
                                        </div>

                                        {/* User Cards Grid */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                          {group.users.map((user) => {
                                            const rawUserPct = user.userPercentage !== undefined ? user.userPercentage : 75;
                                            const userPct = rawUserPct > 1 ? rawUserPct / 100 : rawUserPct;
                                            const rawAdminPct = user.adminPercentage !== undefined ? user.adminPercentage : 25;
                                            const adminPct = rawAdminPct > 1 ? rawAdminPct / 100 : rawAdminPct;
                                            const appliedUsd = group.calculation?.totalUsdApplied || group.totalUsdApplied || 0;
                                            const grossCop = appliedUsd * (currentCycle.trmApplied || 0);
                                            const clientProfitCop = grossCop * userPct;
                                            const adminCommissionCop = grossCop * adminPct;
                                            const clientProfitUsd = appliedUsd * userPct;
                                            const adminCommissionUsd = appliedUsd * adminPct;

                                            return (
                                              <div
                                                key={user.id}
                                                className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/90 hover:border-slate-700 transition flex flex-col justify-between gap-3 shadow-sm"
                                              >
                                                <div className="flex items-start justify-between gap-2">
                                                  <div className="flex items-center gap-2.5">
                                                    <div className="w-8 h-8 rounded-lg bg-blue-950 border border-blue-500/30 text-blue-300 font-extrabold text-xs flex items-center justify-center shrink-0">
                                                      {user.fullName.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div>
                                                      <h4 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                                                        {user.fullName}
                                                      </h4>
                                                      <p className="text-[11px] text-slate-400 font-mono">
                                                        {user.userCode} {user.documentId ? `• CC ${user.documentId}` : ''}
                                                      </p>
                                                    </div>
                                                  </div>
                                                  {isCalc && (
                                                    <span className="px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold font-mono">
                                                      ✓ {formatUSD(appliedUsd)}
                                                    </span>
                                                  )}
                                                </div>

                                                {/* Financial Breakdown per User */}
                                                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/70 text-xs font-mono">
                                                  <div>
                                                    <span className="text-[10px] text-slate-500 block">Capital Base:</span>
                                                    <span className="text-slate-300 font-bold">
                                                      {formatCOP(user.currentCapital)}
                                                    </span>
                                                  </div>
                                                  <div>
                                                    <span className="text-[10px] text-slate-500 block">USD Aplicado:</span>
                                                    <span className="text-blue-400 font-bold">
                                                      {formatUSD(appliedUsd)}
                                                    </span>
                                                  </div>
                                                  <div>
                                                    <span className="text-[10px] text-emerald-400 block font-semibold">
                                                      Ganancia Cliente:
                                                    </span>
                                                    <span className="text-emerald-300 font-bold block">
                                                      {formatCOP(clientProfitCop)}
                                                    </span>
                                                    <span className="text-[10px] text-emerald-500/80 font-normal">
                                                      {formatUSD(clientProfitUsd)}
                                                    </span>
                                                  </div>
                                                  <div>
                                                    <span className="text-[10px] text-amber-400 block font-semibold">
                                                      Comisión Admin:
                                                    </span>
                                                    <span className="text-amber-300 font-bold block">
                                                      {formatCOP(adminCommissionCop)}
                                                    </span>
                                                    <span className="text-[10px] text-amber-500/80 font-normal">
                                                      {formatUSD(adminCommissionUsd)}
                                                    </span>
                                                  </div>
                                                </div>
                                              </div>
                                            );
                                          })}
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
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Global Month Summary Box */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-100">
              Resumen Consolidado del Mes ({currentCycle.name})
            </h3>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {calculatedUsersCount} de {totalActiveUsers} usuarios procesados
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-[11px] text-slate-400 uppercase font-semibold">Capital Total</span>
            <p className="text-base font-bold text-slate-100 font-mono mt-1">
              {formatCOP(currentCycle.totalManagedCapital)}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-[11px] text-slate-400 uppercase font-semibold">Total USD Operado</span>
            <p className="text-base font-bold text-emerald-400 font-mono mt-1">
              {formatUSD(currentCycle.totalGrossUsd)}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-[11px] text-slate-400 uppercase font-semibold">Total COP Generado</span>
            <p className="text-base font-bold text-slate-200 font-mono mt-1">
              {formatCOP(currentCycle.totalGrossCop)}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-[11px] text-slate-400 uppercase font-semibold">Ganancias Clientes</span>
            <p className="text-base font-bold text-indigo-300 font-mono mt-1">
              {formatCOP(currentCycle.totalUsersProfitCop)}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-[11px] text-slate-400 uppercase font-semibold">Comisión Admin</span>
            <p className="text-base font-bold text-amber-400 font-mono mt-1">
              {formatCOP(currentCycle.totalAdminCommissionCop)}
            </p>
          </div>
        </div>

        {/* Master Execution Action Bar from Mockup */}
        <div className="flex flex-col lg:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-800">
          <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
            <div className="flex items-center gap-2 bg-slate-950 px-3.5 py-2 rounded-xl border border-slate-800">
              <div className={`w-2 h-2 rounded-full ${is100Percent ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              <span className="text-slate-400">Usuarios Calculados:</span>
              <strong className="text-slate-100 font-bold">{calculatedUsersCount} / {totalActiveUsers}</strong>
              <span className={is100Percent ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                ({Math.round(progressPercentage)}%)
              </span>
            </div>

            <div className="flex items-center gap-2 bg-slate-950 px-3.5 py-2 rounded-xl border border-slate-800">
              <span className="text-slate-400">Grupos Calculados:</span>
              <strong className="text-slate-100 font-bold">{currentCycle.calculatedGroupsCount} / {currentCycle.totalGroupsCount}</strong>
              <span className={currentCycle.calculatedGroupsCount === currentCycle.totalGroupsCount ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                ({Math.round((currentCycle.calculatedGroupsCount / (currentCycle.totalGroupsCount || 1)) * 100)}%)
              </span>
            </div>

            {/* Solicitudes del Ciclo (Gate 1 & Gate 2 status) */}
            <div className="flex items-center gap-2 bg-slate-950 px-3.5 py-2 rounded-xl border border-slate-800">
              <RotateCcw className="w-3.5 h-3.5 text-teal-400" />
              <span className="text-slate-400">Solicitudes:</span>
              {hasUnresolvedRequests ? (
                <span className="text-amber-400 font-bold flex items-center gap-1">
                  ⚠️ {pendingRequestsCount + needsReviewRequestsCount} por resolver ({pendingRequestsCount} pend, {needsReviewRequestsCount} rev)
                </span>
              ) : (
                <span className="text-emerald-400 font-bold">
                  ✓ {approvedRequestsCount} aprobadas {rejectedRequestsCount > 0 ? `• ${rejectedRequestsCount} rech` : ''} {appliedRequestsCount > 0 ? `• ${appliedRequestsCount} aplicadas` : ''}
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:flex sm:items-center gap-3 w-full lg:w-auto">
            {/* Cycle-close notifications are automatic and mandatory */}
            <button
              type="button"
              disabled
              className="min-h-[44px] flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-extrabold w-full sm:w-auto bg-emerald-950/40 text-emerald-300 border border-emerald-800/60 cursor-default"
              title={'Las notificaciones personalizadas se generan autom\u00e1ticamente al cerrar el ciclo con la TRM definitiva.'}
            >
              <Bell className="w-4 h-4 shrink-0" />
              <span>{'\uD83D\uDD14 NOTIFICACIONES AUTOM\u00c1TICAS AL CERRAR'}</span>
            </button>

            {/* TRM definitiva de cierre */}
            {!isClosed && (
              <div className="w-full sm:w-auto min-w-[250px] rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                <label className="block text-[10px] font-black uppercase tracking-wide text-amber-400 mb-1">
                  TRM definitiva de cierre (COP/USD)
                </label>

                <input
                  type="text"
                  inputMode="decimal"
                  value={closingTrmInput}
                  onChange={(e) => setClosingTrmInput(e.target.value)}
                  disabled={isClosing}
                  placeholder="Ej. 3850.25"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-white outline-none focus:border-amber-500 disabled:opacity-50"
                />

                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                  Esta tasa será usada para la liquidación definitiva del ciclo.
                </p>
              </div>
            )}

            {/* Close Cycle Button (Amber in mockup) */}
            <button
              onClick={handleCloseCycle}
              disabled={!is100Percent || isClosed || isClosing || hasUnresolvedRequests || !hasValidClosingTrm}
              className={`min-h-[44px] flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-extrabold shadow-lg transition cursor-pointer w-full sm:w-auto active:scale-95 ${
                is100Percent && !isClosed && !isClosing && !hasUnresolvedRequests && hasValidClosingTrm
                  ? 'bg-amber-600 hover:bg-amber-500 text-slate-950 shadow-amber-600/30 font-black'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
              }`}
              title={
                !is100Percent
                  ? 'Debes calcular todos los usuarios antes de cerrar el ciclo'
                  : isClosing
                  ? 'Cierre en proceso...'
                  : hasUnresolvedRequests
                  ? `Bloqueado: existen ${pendingRequestsCount + needsReviewRequestsCount} solicitudes pendientes/en revisión que deben resolverse antes de cerrar`
                  : ''
              }
            >
              <Lock className="w-4 h-4 shrink-0" />
              <span className="text-center">{isClosing ? '⏳ PROCESANDO CIERRE...' : hasUnresolvedRequests ? '🔒 CIERRE BLOQUEADO (SOLICITUDES)' : '🔒 CERRAR CICLO'}</span>
            </button>
          </div>
        </div>

        {/* Warning if requests block closure */}
        {hasUnresolvedRequests && !isClosed && (
          <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>Atención (Gate 1 de Cierre):</strong> No se puede congelar el ciclo porque hay <strong>{pendingRequestsCount}</strong> solicitud(es) pendiente(s) y <strong>{needsReviewRequestsCount}</strong> en revisión. Debes resolverlas en la sección de Reinversiones antes de ejecutar el cierre.
              </span>
            </div>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('reinvestments')}
                className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg shrink-0 cursor-pointer text-xs"
              >
                Ir a Reinversiones →
              </button>
            )}
          </div>
        )}
      </div>

      {/* MODAL: Group Detail & Correction */}
      {selectedGroupForDetail && (
        <div className="fixed inset-0 z-50 flex justify-center items-start sm:items-center p-2 sm:p-4 bg-black/85 backdrop-blur-sm overflow-y-auto overscroll-contain animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[90vh] shadow-2xl flex flex-col text-slate-100 overflow-hidden my-2 sm:my-8">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60 shrink-0">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-slate-100 flex items-center gap-2">
                  <span>Detalle de Liquidación: {selectedGroupForDetail.category}</span>
                  <span className="font-mono text-blue-400 text-xs sm:text-sm">
                    {formatCOP(selectedGroupForDetail.groupCapitalCop)}
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  {selectedGroupForDetail.users.length} usuarios pertenecientes a este grupo
                </p>
              </div>
              <button
                onClick={() => setSelectedGroupForDetail(null)}
                className="p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body: Users List */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                  Liquidación Individual de Inversionistas
                </h4>
                <div className="border border-slate-800 rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse min-w-[560px]">
                    <thead>
                      <tr className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800 text-[11px]">
                        <th className="p-2.5">Código / Nombre</th>
                        <th className="p-2.5">USD Base</th>
                        <th className="p-2.5">Total COP</th>
                        <th className="p-2.5">Split %</th>
                        <th className="p-2.5">Ganancia Usuario</th>
                        <th className="p-2.5">Comisión Admin</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 font-mono">
                      {selectedGroupForDetail.users.map((user) => {
                        const res = userResults.find((r) => r.userId === user.id);
                        return (
                          <tr key={user.id} className="hover:bg-slate-950/50">
                            <td className="p-2.5 font-sans">
                              <p className="font-bold text-slate-200">{user.fullName}</p>
                              <span className="text-[10px] font-mono text-slate-400">{user.userCode}</span>
                            </td>
                            <td className="p-2.5 text-slate-300">
                              {res ? formatUSD(res.totalUsdOperated) : '—'}
                            </td>
                            <td className="p-2.5 text-slate-300">
                              {res ? formatCOP(res.totalGrossCop) : '—'}
                            </td>
                            <td className="p-2.5 font-bold">
                              <span className="text-emerald-400">{user.userPercentage}%</span> /{' '}
                              <span className="text-amber-400">{user.adminPercentage}%</span>
                            </td>
                            <td className="p-2.5 font-bold text-emerald-400">
                              {res ? formatCOP(res.userProfitCop) : '—'}
                            </td>
                            <td className="p-2.5 font-bold text-amber-400">
                              {res ? formatCOP(res.adminCommissionCop) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Correction Form */}
              {!isClosed && (
                <form onSubmit={handleApplyCorrection} className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-4">
                  <div className="flex items-center gap-2">
                    <Edit3 className="w-4 h-4 text-amber-400" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                      Corregir Valor USD del Grupo (Auditoría V2.1)
                    </h4>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Valor Anterior (USD)
                      </label>
                      <input
                        type="text"
                        disabled
                        value={selectedGroupForDetail.calculation?.totalUsdApplied || 0}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-400 font-mono text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-slate-300 font-semibold mb-1">
                        Nuevo Valor Correcto (USD)
                      </label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        value={correctionUsd}
                        onChange={(e) => setCorrectionUsd(e.target.value)}
                        placeholder="ej: 450"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-blue-500"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-300 font-semibold mb-1">
                      Motivo Obligatorio de Corrección
                    </label>
                    <input
                      type="text"
                      value={correctionReason}
                      onChange={(e) => setCorrectionReason(e.target.value)}
                      placeholder="ej: Ajuste de swap por rollover no computado"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>

                  {correctionError && (
                    <div className="p-3 rounded-lg bg-red-950/60 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{correctionError}</span>
                    </div>
                  )}

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      className="px-5 py-2 text-xs font-bold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-xl shadow-lg shadow-amber-500/20 transition cursor-pointer"
                    >
                      Aplicar Corrección Auditada
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 flex items-center justify-between bg-slate-950/60">
              {!isClosed ? (
                <button
                  type="button"
                  onClick={() => handleResetGroupBalance(selectedGroupForDetail)}
                  className="px-4 py-2 text-xs font-bold text-red-300 hover:text-red-100 bg-red-950/60 hover:bg-red-900/80 border border-red-500/40 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                  title="Reiniciar a $0 las operaciones y saldos de este grupo"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reiniciar Saldo ($0)</span>
                </button>
              ) : <div />}

              <button
                onClick={() => setSelectedGroupForDetail(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Confirm Send Notifications */}
      {showNotifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative text-slate-100">
            <button
              onClick={() => setShowNotifyModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Bell className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-100">Despachar Notificaciones Personalizadas</h3>
                <p className="text-xs text-slate-400">Ciclo {currentCycle.name}</p>
              </div>
            </div>

            {notifySuccess ? (
              <div className="p-5 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 flex items-center gap-3 my-4">
                <CheckCircle2 className="w-7 h-7 shrink-0" />
                <div>
                  <p className="text-sm font-bold">¡Notificaciones enviadas exitosamente!</p>
                  <p className="text-xs mt-0.5">Cada inversionista ha recibido su notificación con su valor exacto.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-slate-300 leading-relaxed">
                  Se enviarán <strong>{totalActiveUsers}</strong> notificaciones personalizadas a la bandeja y push de cada inversionista activo.
                </p>

                {/* Previews of messages */}
                <div className="space-y-2 text-xs">
                  <span className="font-semibold text-slate-400 uppercase text-[10px]">Ejemplo de Mensaje para Inversionista 50%:</span>
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 text-[11px] leading-relaxed">
                    &quot;Tu operación del mes de {currentCycle.name} fue de USD $400.00. Tu resultado convertido es de $1.608.000 COP y tu ganancia correspondiente (50%) es de $804.000 COP.&quot;
                  </div>

                  <span className="font-semibold text-slate-400 uppercase text-[10px]">Ejemplo de Mensaje para Inversionista 70%:</span>
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 text-[11px] leading-relaxed">
                    &quot;Tu operación del mes de {currentCycle.name} fue de USD $400.00. Tu resultado convertido es de $1.608.000 COP y tu ganancia correspondiente (70%) es de $1.125.600 COP.&quot;
                  </div>
                </div>

                {notifyError && (
                  <div className="p-3 rounded-lg bg-red-950/60 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{notifyError}</span>
                  </div>
                )}

                <div className="flex justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowNotifyModal(false)}
                    className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-xl transition cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSendNotifications}
                    className="px-5 py-2 text-xs font-bold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-xl shadow-lg shadow-amber-500/20 transition cursor-pointer"
                  >
                    Confirmar y Despachar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: Reopen Cycle */}
      {showReopenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl relative text-slate-100">
            <button
              onClick={() => setShowReopenModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Unlock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-100">Reabrir Ciclo Congelado</h3>
                <p className="text-xs text-slate-400">Ciclo {currentCycle.name}</p>
              </div>
            </div>

            <form onSubmit={handleReopenCycle} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Motivo de Auditoría Obligatorio
                </label>
                <textarea
                  rows={3}
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  placeholder="ej: Corrección extraordinaria autorizada por el comité para recalcular Bitácora Verde"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              {reopenError && (
                <div className="p-3 rounded-lg bg-red-950/60 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{reopenError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowReopenModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-xl transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-xl shadow-lg shadow-amber-500/20 transition cursor-pointer"
                >
                  Reabrir Ciclo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Adjust Cycle TRM */}
      {showTrmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl relative text-slate-100">
            <button
              onClick={() => setShowTrmModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <Edit3 className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-slate-100">Ajustar TRM del Ciclo</h3>
                  <span
                    className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full border ${
                      dataStore.getConfig().trmMode === 'AUTOMATIC'
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-500/40'
                        : 'bg-amber-950 text-amber-300 border-amber-500/40'
                    }`}
                  >
                    {dataStore.getConfig().trmMode === 'AUTOMATIC' ? '⚡ Automático' : '✍️ Manual'}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  {currentCycle.name} • TRM Actual:{' '}
                  <span className="font-mono font-bold text-blue-300">{formatTRM(currentCycle.trmApplied)} COP</span>
                </p>
              </div>
            </div>

            {/* Live Market Rate Widget */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 mb-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span className="text-[11px] font-bold text-slate-300">Tasa de Mercado en Vivo:</span>
                </div>
                <button
                  type="button"
                  onClick={fetchMarketTrm}
                  disabled={isFetchingTrm}
                  className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 transition cursor-pointer disabled:opacity-50"
                  title="Consultar cotización oficial del mercado"
                >
                  <RefreshCw className={`w-3 h-3 ${isFetchingTrm ? 'animate-spin' : ''}`} />
                  <span>{isFetchingTrm ? 'Consultando...' : 'Sincronizar'}</span>
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-base font-bold font-mono text-emerald-300">
                  ${formatTRM(liveTrmResult?.rate || dataStore.getConfig().trmMarketRate || 4028.50)} COP
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const rate = liveTrmResult?.rate || dataStore.getConfig().trmMarketRate || 4028.50;
                    setNewTrmInput(rate != null ? String(rate) : '');
                  }}
                  className="px-2 py-1 text-[11px] font-bold text-slate-900 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition cursor-pointer"
                >
                  ⚡ Usar Esta Tasa
                </button>
              </div>

              <p className="text-[10px] text-slate-500">
                Fuente: {liveTrmResult?.source || dataStore.getConfig().trmSource || 'Mercado Financiero USD/COP'}
              </p>
            </div>

            <form onSubmit={handleUpdateTrm} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Tasa Representativa del Mercado para este Ciclo (TRM COP / USD)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 font-mono text-xs">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="1000"
                    max="10000"
                    value={newTrmInput}
                    onChange={(e) => setNewTrmInput(e.target.value)}
                    placeholder="4028.50"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-8 pr-4 py-2.5 text-sm font-bold text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Puedes escribir un valor manual o usar la tasa automática del mercado.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Motivo de Auditoría (Opcional)
                </label>
                <input
                  type="text"
                  value={trmReason}
                  onChange={(e) => setTrmReason(e.target.value)}
                  placeholder="ej: Ajuste por TRM oficial certificada de fin de mes"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-500/30 text-blue-200 text-xs flex items-start gap-2.5">
                <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <span>
                  Al guardar, se recalcularán automáticamente los totales en COP y las liquidaciones de todos los inversionistas de este ciclo.
                </span>
              </div>

              {trmError && (
                <div className="p-3 rounded-lg bg-red-950/60 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{trmError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTrmModal(false)}
                  disabled={isUpdatingTrm}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-xl transition cursor-pointer disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingTrm}
                  className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-lg shadow-blue-600/30 transition cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {isUpdatingTrm ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Recalculando en Servidor...</span>
                    </>
                  ) : (
                    <span>Guardar y Recalcular</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Daily Operations Modal */}
      {selectedGroupForDailyOps && (
        <DailyOperationsModal
          isOpen={!!selectedGroupForDailyOps}
          onClose={() => setSelectedGroupForDailyOps(null)}
          group={selectedGroupForDailyOps}
          cycle={currentCycle}
          adminUid={currentUser?.id}
          adminName={currentUser?.fullName}
        />
      )}

      {/* Excel Bitacora Import Modal */}
      <ExcelBitacoraImportModal
        isOpen={showExcelImportModal}
        onClose={() => setShowExcelImportModal(false)}
        defaultCategory={excelImportCategory}
        defaultCycleId={selectedCycleId}
        onSuccess={() => {
          setShowExcelImportModal(false);
          setStatusMessage({
            type: 'success',
            text: '¡Migración e importación de Bitácora desde Excel completada con éxito!',
          });
        }}
      />
        </>
      )}
    </div>
  );
};
