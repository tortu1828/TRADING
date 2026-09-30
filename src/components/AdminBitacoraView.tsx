import React, { useState, useEffect } from 'react';
import {
  Activity,
  Layers,
  Calendar,
  DollarSign,
  TrendingUp,
  Users,
  User,
  Search,
  CheckCircle2,
  AlertCircle,
  Clock,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
  Eye,
  Play,
  ArrowRight,
  Bell,
  Send,
  Plus,
  Sparkles,
  RefreshCw,
  SlidersHorizontal,
  Lock,
  Unlock,
  Check,
  ShieldCheck,
  Info,
  Maximize2,
  Minimize2,
  Trash2,
  Edit,
  FolderOpen,
} from 'lucide-react';
import { BitacoraCategory, CategoryGroupInfo, MonthlyCycle, UserProfile } from '../types';
import { dataStore } from '../lib/dataStore';
import {
  formatCOP,
  formatUSD,
  formatTRM,
  calculateUserMonthlyResult,
  getCategoryForCapital,
} from '../lib/financialEngine';
import { DailyOperationsModal } from './DailyOperationsModal';
import { ExcelBitacoraImportModal } from './ExcelBitacoraImportModal';
import { EditTRMModal } from './EditTRMModal';
import { useAuth } from '../context/AuthContext';
import { firestoreService } from '../lib/firestoreService';

interface AdminBitacoraViewProps {
  onNavigate?: (tab: string) => void;
}

export const AdminBitacoraView: React.FC<AdminBitacoraViewProps> = ({ onNavigate }) => {
  const { currentUser, isSuperAdmin } = useAuth();
  const [selectedCategory, setSelectedCategory] = useState<BitacoraCategory | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedGroupForDailyOps, setSelectedGroupForDailyOps] = useState<CategoryGroupInfo | null>(null);
  const [showExcelModal, setShowExcelModal] = useState<boolean>(false);
  const [showTrmModal, setShowTrmModal] = useState<boolean>(false);
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Record<string, boolean>>({});
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [notifyingKey, setNotifyingKey] = useState<string | null>(null);

  // Modal para aperturar un nuevo grupo de capital manual
  const [showNewGroupModal, setShowNewGroupModal] = useState<boolean>(false);
  const [newGroupCapitalCop, setNewGroupCapitalCop] = useState<string>('');
  const [newGroupInitialUsd, setNewGroupInitialUsd] = useState<string>('');
  const [newGroupDate, setNewGroupDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [newGroupNotes, setNewGroupNotes] = useState<string>('');

  // Modal para Cierre Operativo Global y Notificaciones
  const [showGlobalClosureModal, setShowGlobalClosureModal] = useState<boolean>(false);
  const [shouldNotifyOnGlobalClose, setShouldNotifyOnGlobalClose] = useState<boolean>(true);

  // Modal para Purga de Datos de Prueba (SuperAdmin)
  const [showPurgeModal, setShowPurgeModal] = useState<boolean>(false);
  const [isPurging, setIsPurging] = useState<boolean>(false);
  const [dryRunLoading, setDryRunLoading] = useState<boolean>(false);
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [purgeConfirmationInput, setPurgeConfirmationInput] = useState<string>('');
  const [purgeError, setPurgeError] = useState<string | null>(null);

  // Re-render listener for real-time Firestore sync
  const [, setTick] = useState(0);
  useEffect(() => {
    const unsub = dataStore.subscribe(() => {
      setTick((prev) => prev + 1);
    });
    return () => unsub();
  }, []);

  const cycles = dataStore.getCycles();
  const currentCycle = dataStore.getActiveCycle() || cycles[0];

  if (!currentCycle) {
    return (
      <div className="p-8 text-center text-slate-400">
        <Activity className="w-12 h-12 mx-auto text-slate-600 mb-3" />
        <p className="text-base font-bold text-slate-200">No hay ciclos de liquidación configurados.</p>
        <p className="text-xs text-slate-500 mt-1">Crea o inicializa un ciclo para gestionar las bitácoras.</p>
      </div>
    );
  }

  const trm = currentCycle.trmApplied || 4028.50;
  const isClosed = currentCycle.status === 'CLOSED';
  const config = dataStore.getConfig();
  const hasOperationalCycle = !!config.operationalCycleId;

  // Get categorized groups
  const groupsByCategory = dataStore.getCategoryGroups(currentCycle.cycleId);
  const blueGroups = groupsByCategory.AZUL || [];
  const greenGroups = groupsByCategory.VERDE || [];
  const blackGroups = groupsByCategory.NEGRA || [];

  const allGroups: CategoryGroupInfo[] = [...blueGroups, ...greenGroups, ...blackGroups];

  // Claves de grupos operativos activos actuales
  const activeGroupKeys = new Set(allGroups.map((g) => `${g.category}_${g.groupCapitalCop}`));

  // Cálculos consolidados para Cierre Operativo Global y Notificaciones vinculados estrictamente a grupos activos
  const allActiveOps = dataStore
    .getDailyOperations(
      currentCycle.cycleId
    )
    .filter(
      (op) =>
        !(op as any).globalClosedAt &&
        activeGroupKeys.has(
          `${op.category}_${op.groupCapitalCop}`
        )
    );

  const globalActiveUsdTotal =
    allActiveOps.reduce(
      (sum, op) =>
        sum +
        Number(op.amountUsd || 0),
      0
    );

  const operatedGroupsList =
    allGroups
      .map((group) => {

        const ops =
          dataStore
            .getDailyOperations(
              currentCycle.cycleId,
              group.category,
              group.groupCapitalCop
            )
            .filter(
              (op) =>
                !(op as any)
                  .globalClosedAt
            );

        if (ops.length === 0) {
          return null;
        }

        return {
          ...group,

          usdOperated:
            ops.reduce(
              (sum, op) =>
                sum +
                Number(
                  op.amountUsd ||
                  0
                ),
              0
            ),

          groupGrossCop:
            ops.reduce(
              (sum, op) =>
                sum +
                Number(
                  op.grossCop ??
                  (
                    Number(
                      op.amountUsd ||
                      0
                    ) *
                    Number(
                      op.trmUsed ||
                      trm
                    )
                  )
                ),
              0
            ),

          activeOpsCount:
            ops.length,
        };
      })
      .filter(
        (group):
          group is NonNullable<
            typeof group
          > =>
            group !== null
      );

  const operatedUsersMap =
    new Map<string, {
      user: UserProfile;
      category: BitacoraCategory;
      groupCapitalCop: number;
      usdOperatedGroup: number;
      userPercentage: number;
      userProfitCop: number;
      userProfitUsd: number;
      grossCopIndividual: number;
      adminCommissionCop: number;
    }>();

  allActiveOps.forEach((op) => {

    const group =
      allGroups.find(
        (candidate) =>
          candidate.category ===
            op.category &&
          Number(
            candidate.groupCapitalCop
          ) ===
            Number(
              op.groupCapitalCop
            )
      );

    if (!group) {
      return;
    }

    const authorized =
      new Set(
        (op.authorizedUids || [])
          .filter(Boolean)
          .map(
            (value) =>
              String(value)
                .trim()
                .toLowerCase()
          )
      );

    const recipients =
      authorized.size === 0
        ? group.users
        : group.users.filter(
            (user) => {

              const keys = [
                user.uid,
                user.id,
                user.userCode,
                user.email,
              ]
                .filter(Boolean)
                .map(
                  (value) =>
                    String(value)
                      .trim()
                      .toLowerCase()
                );

              return keys.some(
                (key) =>
                  authorized.has(key)
              );
            }
          );

    recipients.forEach((user) => {

      if (
        user.role === 'ADMIN' ||
        user.userCode?.startsWith(
          'ADM'
        )
      ) {
        return;
      }

      const rawUserPct =
        user.userPercentage ??
        75;

      const rawAdminPct =
        user.adminPercentage ??
        25;

      const userPct =
        rawUserPct <= 1
          ? rawUserPct * 100
          : rawUserPct;

      const adminPct =
        rawAdminPct <= 1
          ? rawAdminPct * 100
          : rawAdminPct;

      const opUsd =
        Number(
          op.amountUsd || 0
        );

      const opTrm =
        Number(
          op.trmUsed ||
          trm
        );

      const calc =
        calculateUserMonthlyResult(
          opUsd,
          opTrm,
          userPct,
          adminPct
        );

      const uid =
        String(
          user.uid ||
          user.id ||
          user.userCode
        );

      const rowKey =
        `${uid}_${op.category}_${op.groupCapitalCop}`;

      const current =
        operatedUsersMap.get(
          rowKey
        );

      if (current) {

        current.usdOperatedGroup +=
          opUsd;

        current.userProfitCop +=
          calc.userProfitCop;

        current.userProfitUsd +=
          calc.userProfitUsd;

        current.grossCopIndividual +=
          calc.grossCop;

        current.adminCommissionCop +=
          calc.adminCommissionCop;

        return;
      }

      operatedUsersMap.set(
        rowKey,
        {
          user,

          category:
            op.category,

          groupCapitalCop:
            Number(
              op.groupCapitalCop
            ),

          usdOperatedGroup:
            opUsd,

          userPercentage:
            userPct,

          userProfitCop:
            calc.userProfitCop,

          userProfitUsd:
            calc.userProfitUsd,

          grossCopIndividual:
            calc.grossCop,

          adminCommissionCop:
            calc.adminCommissionCop,
        }
      );
    });
  });

  const operatedUsersList =
    Array.from(
      operatedUsersMap.values()
    );

  const globalActiveGrossCopTotal =
    operatedUsersList.reduce(
      (sum, item) =>
        sum +
        item.grossCopIndividual,
      0
    );

  const totalClientProfitCopGlobal =
    operatedUsersList.reduce(
      (sum, item) =>
        sum +
        item.userProfitCop,
      0
    );

  const totalAdminCommissionCopGlobal =
    operatedUsersList.reduce(
      (sum, item) =>
        sum +
        item.adminCommissionCop,
      0
    );


  const totalOperationsCount = allGroups.reduce((acc, g) => {
    const ops = dataStore.getDailyOperations(currentCycle.cycleId, g.category, g.groupCapitalCop);
    return acc + ops.length;
  }, 0);

  const totalUsdAcrossGroups = allGroups.reduce((acc, g) => {
    const ops = dataStore.getDailyOperations(currentCycle.cycleId, g.category, g.groupCapitalCop);
    const sumUsd = ops.reduce((s, op) => s + op.amountUsd, 0);
    return acc + sumUsd * g.users.length;
  }, 0);

  const totalInvestorsInGroups = allGroups.reduce((acc, g) => acc + g.users.length, 0);
  const totalGrossCopGenerated = totalUsdAcrossGroups * trm;

  // Handlers para purga de datos de prueba (SuperAdmin)
  const handleOpenPurgeModal = async () => {
    setShowPurgeModal(true);
    setDryRunLoading(true);
    setPurgeError(null);
    setPurgeConfirmationInput('');
    setDryRunResult(null);
    try {
      const res = await firestoreService.adminPurgeTradingTestDataCallable({
        dryRun: true,
        confirmation: '',
        cycleId: currentCycle.cycleId,
      });
      setDryRunResult(res);
    } catch (err: any) {
      setPurgeError(err.message || 'Error al ejecutar auditoría previa de purga.');
    } finally {
      setDryRunLoading(false);
    }
  };

  const handleExecutePurge = async () => {
    if (purgeConfirmationInput !== 'LIMPIAR BITÁCORAS DE PRUEBA') {
      setPurgeError('Debes escribir exactamente la frase de confirmación.');
      return;
    }
    setIsPurging(true);
    setPurgeError(null);
    try {
      const res = await firestoreService.adminPurgeTradingTestDataCallable({
        dryRun: false,
        confirmation: 'LIMPIAR BITÁCORAS DE PRUEBA',
        cycleId: currentCycle.cycleId,
      });
      dataStore.purgeTradingTestDataLocal(currentCycle.cycleId);
      setShowPurgeModal(false);
      setSuccessToast(`✓ ${res.message || 'Limpieza de bitácoras de prueba completada con éxito.'}`);
      setTimeout(() => setSuccessToast(null), 5000);
    } catch (err: any) {
      setPurgeError(err.message || 'Error al ejecutar la purga.');
    } finally {
      setIsPurging(false);
    }
  };

  // Totales por categoría
  const blueTotalCap = blueGroups.reduce((sum, g) => sum + g.groupCapitalCop * g.users.length, 0);
  const greenTotalCap = greenGroups.reduce((sum, g) => sum + g.groupCapitalCop * g.users.length, 0);
  const blackTotalCap = blackGroups.reduce((sum, g) => sum + g.groupCapitalCop * g.users.length, 0);

  const blueUsersCount = blueGroups.reduce((sum, g) => sum + g.users.length, 0);
  const greenUsersCount = greenGroups.reduce((sum, g) => sum + g.users.length, 0);
  const blackUsersCount = blackGroups.reduce((sum, g) => sum + g.users.length, 0);

  const toggleGroupExpand = (key: string) => {
    setExpandedGroupKeys((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleExpandAll = (expand: boolean) => {
    const newKeys: Record<string, boolean> = {};
    displayedGroups.forEach((g) => {
      newKeys[`${g.category}_${g.groupCapitalCop}`] = expand;
    });
    setExpandedGroupKeys(newKeys);
  };

  const handleNotifyGroup = (group: CategoryGroupInfo) => {
    if (!hasOperationalCycle) {
      setErrorToast('No hay un ciclo operativo iniciado en este momento.');
      setTimeout(() => setErrorToast(null), 4000);
      return;
    }
    const groupKey = `${group.category}_${group.groupCapitalCop}`;
    setErrorToast(null);
    setSuccessToast(null);

    const activeOperations = dataStore
      .getDailyOperations(currentCycle.cycleId, group.category, group.groupCapitalCop)
      .filter((op) => op.status !== 'CONSOLIDATED');

    if (activeOperations.length === 0) {
      setErrorToast(`El grupo ${formatCOP(group.groupCapitalCop)} no tiene operaciones activas pendientes por notificar.`);
      setTimeout(() => setErrorToast(null), 4000);
      return;
    }

    try {
      setNotifyingKey(groupKey);
      let totalSentCount = 0;
      activeOperations.forEach((op) => {
        const res = dataStore.sendDailyGroupNotification(
          currentCycle.cycleId,
          group.category,
          group.groupCapitalCop,
          op.amountUsd,
          op.date || new Date().toISOString().split('T')[0],
          op.notes || 'Operación registrada en la bitácora diaria',
          currentUser?.id || 'admin_root_uid',
          currentUser?.fullName || 'Administrador Principal',
          op.id,
          op
        );
        totalSentCount += res.sentCount;
      });
      setSuccessToast(`✓ Se enviaron ${totalSentCount} notificaciones individuales a los inversionistas del grupo.`);
      setTimeout(() => setSuccessToast(null), 5000);
    } catch (err: any) {
      setErrorToast(err.message || 'Error al enviar notificaciones.');
      setTimeout(() => setErrorToast(null), 4000);
    } finally {
      setNotifyingKey(null);
    }
  };

  const handleNotifyAllGlobal = () => {
    setErrorToast(null);
    setSuccessToast(null);

    if (operatedUsersList.length === 0 || allActiveOps.length === 0) {
      setErrorToast('No hay operaciones activas ni inversionistas pendientes por notificar.');
      setTimeout(() => setErrorToast(null), 4000);
      return;
    }

    try {
      const res = dataStore.notifyAllActiveDailyOperations(
        currentCycle.cycleId,
        currentUser?.id || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      setSuccessToast(res.message);
      setTimeout(() => setSuccessToast(null), 5000);
    } catch (err: any) {
      setErrorToast(err.message || 'Error al enviar notificaciones.');
      setTimeout(() => setErrorToast(null), 4000);
    }
  };

  const handleExecuteConsolidateAllGlobal = async () => {
    setErrorToast(null);
    setSuccessToast(null);

    if (allActiveOps.length === 0) {
      setErrorToast('No hay operaciones activas pendientes por cerrar en ninguna bitácora.');
      setTimeout(() => setErrorToast(null), 4000);
      return;
    }

    try {
      const res = await dataStore.consolidateAllDailyOperations(
        currentCycle.cycleId,
        shouldNotifyOnGlobalClose,
        currentUser?.id || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      setSuccessToast(res.message);
      setShowGlobalClosureModal(false);
      setTimeout(() => setSuccessToast(null), 5000);
    } catch (err: any) {
      setErrorToast(err.message || 'Error al consolidar todas las operaciones diarias.');
      setTimeout(() => setErrorToast(null), 4000);
    }
  };

  const handleConsolidateAllGlobal = () => {
    if (allActiveOps.length === 0) {
      setErrorToast('No hay operaciones activas pendientes por cerrar en ninguna bitácora.');
      setTimeout(() => setErrorToast(null), 4000);
      return;
    }
    setShowGlobalClosureModal(true);
  };

  const handleCreateManualGroupOperation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasOperationalCycle) {
      setErrorToast('No hay un ciclo operativo iniciado en este momento.');
      setTimeout(() => setErrorToast(null), 4000);
      return;
    }
    const capital = parseFloat(newGroupCapitalCop.replace(/[^0-9]/g, ''));
    const usd = parseFloat(newGroupInitialUsd.replace(/[^0-9.]/g, ''));

    if (isNaN(capital) || capital < 1_000_000) {
      setErrorToast('Ingresa un valor de capital válido (mínimo $1.000.000 COP).');
      return;
    }

    if (isNaN(usd) || usd <= 0) {
      setErrorToast('Ingresa un monto operado en USD válido mayor a cero.');
      return;
    }

    const category = getCategoryForCapital(capital);

    try {
      const res = dataStore.addDailyOperation(
        currentCycle.cycleId,
        category,
        capital,
        newGroupDate || new Date().toISOString().split('T')[0],
        usd,
        newGroupNotes || `Apertura y registro directo para grupo ${formatCOP(capital)}`,
        currentUser?.id || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );

      setSuccessToast(`✓ ${res.message}`);
      setShowNewGroupModal(false);
      setNewGroupCapitalCop('');
      setNewGroupInitialUsd('');
      setNewGroupNotes('');
      setExpandedGroupKeys((prev) => ({
        ...prev,
        [`${category}_${capital}`]: true,
      }));
      setTimeout(() => setSuccessToast(null), 5000);
    } catch (err: any) {
      setErrorToast(err.message || 'Error al crear la operación del grupo.');
      setTimeout(() => setErrorToast(null), 4000);
    }
  };

  const categories = [
    {
      key: 'ALL' as const,
      label: 'Todas las Bitácoras',
      badgeLabel: 'General',
      rangeText: 'Todos los Rangos',
      icon: Layers,
      count: allGroups.length,
      usersCount: totalInvestorsInGroups,
      totalCap: blueTotalCap + greenTotalCap + blackTotalCap,
      color: 'text-slate-300',
      activeBg: 'bg-slate-800 text-slate-100 border-slate-600 shadow-slate-900/60 ring-1 ring-slate-600',
    },
    {
      key: 'AZUL' as const,
      label: 'Bitácora Azul',
      badgeLabel: 'Azul',
      rangeText: '$4M - $9M COP',
      icon: Activity,
      count: blueGroups.length,
      usersCount: blueUsersCount,
      totalCap: blueTotalCap,
      color: 'text-blue-400',
      activeBg: 'bg-blue-950 text-blue-100 border-blue-500 shadow-blue-950/60 ring-1 ring-blue-500',
    },
    {
      key: 'VERDE' as const,
      label: 'Bitácora Verde',
      badgeLabel: 'Verde',
      rangeText: '$10M - $50M COP',
      icon: Activity,
      count: greenGroups.length,
      usersCount: greenUsersCount,
      totalCap: greenTotalCap,
      color: 'text-emerald-400',
      activeBg: 'bg-emerald-950 text-emerald-100 border-emerald-500 shadow-emerald-950/60 ring-1 ring-emerald-500',
    },
    {
      key: 'NEGRA' as const,
      label: 'Bitácora Negra',
      badgeLabel: 'Negra',
      rangeText: '> $60M COP',
      icon: Activity,
      count: blackGroups.length,
      usersCount: blackUsersCount,
      totalCap: blackTotalCap,
      color: 'text-zinc-300',
      activeBg: 'bg-zinc-900 text-zinc-100 border-zinc-700 shadow-zinc-950/60 ring-1 ring-zinc-700',
    },
  ];

  const displayedGroups = allGroups.filter((g) => {
    if (selectedCategory !== 'ALL' && g.category !== selectedCategory) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const matchesCapital =
      formatCOP(g.groupCapitalCop).toLowerCase().includes(q) || g.groupCapitalCop.toString().includes(q);
    const matchesCategory = g.category.toLowerCase().includes(q);
    const matchesUser = g.users.some(
      (u) =>
        u.fullName.toLowerCase().includes(q) ||
        u.userCode.toLowerCase().includes(q) ||
        (u.documentId && u.documentId.toLowerCase().includes(q))
    );
    return matchesCapital || matchesCategory || matchesUser;
  });

  const allDisplayedExpanded = displayedGroups.length > 0 && displayedGroups.every(
    (g) => !!expandedGroupKeys[`${g.category}_${g.groupCapitalCop}`]
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Toast notifications */}
      {successToast && (
        <div className="fixed top-20 right-6 z-50 p-4 rounded-xl bg-emerald-950 border border-emerald-500/50 text-emerald-200 text-xs flex items-center gap-3 shadow-2xl shadow-emerald-950/60 animate-in slide-in-from-top-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="font-semibold">{successToast}</span>
        </div>
      )}

      {errorToast && (
        <div className="fixed top-20 right-6 z-50 p-4 rounded-xl bg-red-950 border border-red-500/50 text-red-200 text-xs flex items-center gap-3 shadow-2xl shadow-red-950/60 animate-in slide-in-from-top-2">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <span className="font-semibold">{errorToast}</span>
        </div>
      )}

      {!hasOperationalCycle && (
        <div className="p-4 bg-amber-900/40 border border-amber-500/30 rounded-2xl flex items-center gap-3 text-amber-200 animate-in fade-in slide-in-from-top-2">
          <AlertCircle className="w-5 h-5 shrink-0 text-amber-400 animate-pulse" />
          <div className="text-xs sm:text-sm font-medium">
            No hay un ciclo operativo iniciado en este momento. Las acciones de registro, importación y consolidación de operaciones diarias se encuentran bloqueadas.
          </div>
        </div>
      )}

      {/* Main Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900/90 to-blue-950/40 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400 shadow-md shadow-blue-500/10">
                <SlidersHorizontal className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-100 flex items-center gap-2">
                  Bitácoras de Trading Diarias
                  <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/40 text-blue-300 font-bold uppercase">
                    Tiempo Real
                  </span>
                </h1>
                <p className="text-xs text-slate-400">
                  Ciclo Activo:{' '}
                  <span className="font-bold text-slate-200">{currentCycle.name}</span> • TRM Oficial:{' '}
                  <span className="font-mono font-bold text-emerald-400">{formatTRM(trm)} COP</span>
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-400 max-w-3xl leading-relaxed pt-1">
              Organización ordenada de grupos de capital exacto. Despliega cualquier grupo (individual o multicuenta) para registrar los trades diarios en USD, consultar los beneficiarios y sincronizar automáticamente el Cierre Mensual.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleConsolidateAllGlobal}
              disabled={!hasOperationalCycle || allActiveOps.length === 0}
              className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-md shadow-emerald-600/20"
              title={!hasOperationalCycle ? "No hay un ciclo operativo iniciado" : `Cerrar la jornada diaria activa en todas las bitácoras (${formatUSD(globalActiveUsdTotal)}) y consolidar las ganancias en el Cierre Mensual`}
            >
              <Lock className="w-4 h-4" />
              <span>Cerrar Jornada Global ({formatUSD(globalActiveUsdTotal)})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (!hasOperationalCycle) {
                  setErrorToast('No hay un ciclo operativo iniciado en este momento.');
                  setTimeout(() => setErrorToast(null), 4000);
                  return;
                }
                if (operatedUsersList.length === 0 || allActiveOps.length === 0) {
                  setErrorToast('No hay operaciones activas ni inversionistas pendientes por notificar.');
                  setTimeout(() => setErrorToast(null), 4000);
                  return;
                }
                setShowGlobalClosureModal(true);
              }}
              className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-md shadow-indigo-600/20"
              title="Enviar notificaciones personalizadas con nombre y ganancia a todos los usuarios operados"
            >
              <Send className="w-4 h-4 text-indigo-200" />
              <span>Notificar a Todos ({operatedUsersList.length})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (!hasOperationalCycle) {
                  setErrorToast('No hay un ciclo operativo iniciado en este momento.');
                  setTimeout(() => setErrorToast(null), 4000);
                  return;
                }
                setShowNewGroupModal(true);
              }}
              className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-md shadow-blue-600/20"
              title="Aperturar un nuevo grupo o registrar un trade directo"
            >
              <Plus className="w-4 h-4" />
              <span>Nuevo Trade / Grupo</span>
            </button>

            <button
              onClick={() => {
                if (!hasOperationalCycle) {
                  setErrorToast('No hay un ciclo operativo iniciado en este momento.');
                  setTimeout(() => setErrorToast(null), 4000);
                  return;
                }
                setShowExcelModal(true);
              }}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-sm"
              title="Importar operaciones desde archivo Excel"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              <span>Importar Excel</span>
            </button>

            <button
              onClick={() => setShowTrmModal(true)}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-sm"
              title="Ajustar Tasa Representativa del Mercado"
            >
              <DollarSign className="w-4 h-4 text-amber-400" />
              <span>Ajustar TRM</span>
            </button>

            {isSuperAdmin && (
              <button
                type="button"
                onClick={handleOpenPurgeModal}
                className="px-3.5 py-2 rounded-xl bg-rose-950/70 hover:bg-rose-900/80 text-rose-200 border border-rose-800/80 text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-sm"
                title="Limpiar datos de prueba del ciclo activo (trades, cálculos y notificaciones)"
              >
                <Trash2 className="w-4 h-4 text-rose-400" />
                <span>Limpiar datos de prueba</span>
              </button>
            )}

            {onNavigate && (
              <button
                onClick={() => onNavigate('monthly_closure')}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-xs font-extrabold flex items-center gap-2 transition cursor-pointer shadow-lg shadow-amber-500/20"
              >
                <span>Ir al Cierre Mensual</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Global summary stats cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-5 mt-5 border-t border-slate-800/80 font-mono text-xs">
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <span className="text-[10px] text-slate-500 block uppercase font-bold">Trades Registrados</span>
            <span className="text-base font-extrabold text-blue-400 flex items-center gap-1.5 mt-0.5">
              <Activity className="w-4 h-4" /> {totalOperationsCount} operaciones
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <span className="text-[10px] text-slate-500 block uppercase font-bold">Total USD Acumulado Grupo</span>
            <span className="text-base font-extrabold text-emerald-400 flex items-center gap-1.5 mt-0.5">
              <DollarSign className="w-4 h-4" /> {formatUSD(totalUsdAcrossGroups)}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <span className="text-[10px] text-slate-500 block uppercase font-bold">Rendimiento Bruto COP</span>
            <span className="text-base font-extrabold text-slate-200 flex items-center gap-1.5 mt-0.5">
              {formatCOP(totalGrossCopGenerated)}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <span className="text-[10px] text-slate-500 block uppercase font-bold">Inversionistas Vinculados</span>
            <span className="text-base font-extrabold text-amber-400 flex items-center gap-1.5 mt-0.5">
              <Users className="w-4 h-4" /> {totalInvestorsInGroups} personas
            </span>
          </div>
        </div>
      </div>

      {/* Category Selection Cards / Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {categories.map((cat) => {
          const isSelected = selectedCategory === cat.key;
          return (
            <button
              key={cat.key}
              type="button"
              onClick={() => setSelectedCategory(cat.key)}
              className={`p-4 rounded-2xl border text-left transition cursor-pointer relative overflow-hidden flex flex-col justify-between ${
                isSelected
                  ? cat.activeBg
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-850 hover:border-slate-700 shadow-md'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <cat.icon className={`w-4 h-4 ${cat.color}`} />
                  <span className="font-extrabold text-xs tracking-tight text-slate-100">{cat.label}</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-black/40 border border-slate-700/60 text-slate-200 font-bold">
                  {cat.count} {cat.count === 1 ? 'grupo' : 'grupos'}
                </span>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono">
                <span className="text-slate-400 font-sans text-[10px]">{cat.rangeText}</span>
                <span className="text-slate-300 font-bold">{cat.usersCount} inv.</span>
              </div>

              {cat.totalCap > 0 && (
                <div className="mt-1 text-[11px] font-mono font-bold text-slate-400">
                  {formatCOP(cat.totalCap)}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Filter, Search & Display Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/60 border border-slate-800 p-3 rounded-2xl">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleExpandAll(!allDisplayedExpanded)}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
            title={allDisplayedExpanded ? 'Colapsar todos los grupos' : 'Desplegar todos los grupos'}
          >
            {allDisplayedExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span>{allDisplayedExpanded ? 'Colapsar Todo' : 'Desplegar Todos los Grupos'}</span>
          </button>

          <span className="text-xs text-slate-400 font-mono pl-1">
            Mostrando <strong className="text-slate-200">{displayedGroups.length}</strong> de{' '}
            <strong className="text-slate-200">{allGroups.length}</strong> grupos
          </span>
        </div>

        {/* Search input */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Buscar por monto (ej: $4M), cédula o cliente..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Groups List */}
      {allGroups.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-900/30 space-y-3">
          <FolderOpen className="w-10 h-10 mx-auto text-slate-600" />
          <h3 className="text-base font-bold text-slate-200">No hay inversionistas activos</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            Las bitácoras se crearán automáticamente cuando existan inversionistas con capital asignado.
          </p>
        </div>
      ) : displayedGroups.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-900/30 space-y-3">
          <FolderOpen className="w-10 h-10 mx-auto text-slate-600" />
          <h3 className="text-sm font-bold text-slate-300">No se encontraron grupos en este criterio</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Prueba con otro término de búsqueda o limpia el filtro de categoría.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {displayedGroups.map((group) => {
            const groupKey = `${group.category}_${group.groupCapitalCop}`;
            const isExpanded = !!expandedGroupKeys[groupKey];
            const operations = dataStore.getDailyOperations(currentCycle.cycleId, group.category, group.groupCapitalCop);
            const totalUsdAccumulated = operations.reduce((sum, op) => sum + op.amountUsd, 0);
            const totalGrossCopPerUser = totalUsdAccumulated * trm;
            const isNotifyingThis = notifyingKey === groupKey;

            // Inversionistas del grupo
            const users = group.users;
            const isIndividual = users.length === 1;
            const singleUser = isIndividual ? users[0] : null;

            // Totales de ganancia para este grupo
            const totalGroupProfitCop = users.reduce((acc, u) => {
              const raw = u.userPercentage !== undefined ? u.userPercentage : 75;
              const ratio = raw > 1 ? raw / 100 : raw;
              return acc + totalGrossCopPerUser * ratio;
            }, 0);

            const totalGroupAdminCop = users.reduce((acc, u) => {
              const raw = u.adminPercentage !== undefined ? u.adminPercentage : 25;
              const ratio = raw > 1 ? raw / 100 : raw;
              return acc + totalGrossCopPerUser * ratio;
            }, 0);

            const getCategoryBadge = (cat: BitacoraCategory) => {
              switch (cat) {
                case 'AZUL':
                  return {
                    label: 'Bitácora Azul ($4M - $9M)',
                    badge: 'bg-blue-950 text-blue-300 border-blue-500/40',
                    border: 'border-blue-500/30',
                  };
                case 'VERDE':
                  return {
                    label: 'Bitácora Verde ($10M - $50M)',
                    badge: 'bg-emerald-950 text-emerald-300 border-emerald-500/40',
                    border: 'border-emerald-500/30',
                  };
                case 'NEGRA':
                  return {
                    label: 'Bitácora Negra (> $60M)',
                    badge: 'bg-zinc-950 text-zinc-200 border-zinc-700',
                    border: 'border-zinc-800',
                  };
              }
            };

            const catInfo = getCategoryBadge(group.category);

            return (
              <div
                key={groupKey}
                className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg transition hover:border-slate-700"
              >
                {/* Main Card Header */}
                <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-950/70">
                  <div className="flex items-start sm:items-center gap-3.5">
                    <div className="w-11 h-11 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-200 font-extrabold font-mono text-sm shrink-0 shadow-inner">
                      $
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full border ${catInfo.badge}`}>
                          {catInfo.label}
                        </span>

                        <h2 className="text-base sm:text-lg font-black text-slate-100 font-mono">
                          {formatCOP(group.groupCapitalCop)}
                        </h2>

                        {isIndividual && singleUser ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-950/80 border border-blue-500/30 text-blue-300 flex items-center gap-1">
                            <User className="w-3 h-3" />
                            <span>Individual: {singleUser.fullName}</span>
                          </span>
                        ) : users.length > 1 ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            <span>Grupo Multicuenta ({users.length} personas)</span>
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-500/30 text-amber-300">
                            Grupo Abierto (0 clientes asignados)
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-2">
                        <span>
                          {users.length} {users.length === 1 ? 'Inversionista activo' : 'Inversionistas vinculados'}
                        </span>
                        <span>•</span>
                        <span className="font-mono text-blue-400 font-bold">
                          {operations.length} {operations.length === 1 ? 'trade registrado' : 'trades registrados'}
                        </span>
                        {singleUser?.documentId && (
                          <>
                            <span>•</span>
                            <span className="text-slate-400 font-mono">CC: {singleUser.documentId}</span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Financial Quick Metrics */}
                  <div className="grid grid-cols-3 gap-3 font-mono text-xs text-left bg-slate-900/90 p-2.5 rounded-xl border border-slate-800">
                    <div>
                      <span className="text-[10px] text-slate-500 block">USD Acumulado:</span>
                      <span className="text-sm font-extrabold text-blue-400">
                        {formatUSD(totalUsdAccumulated)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Total Bruto COP:</span>
                      <span className="text-sm font-bold text-slate-200">
                        {formatCOP(totalGrossCopPerUser)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-emerald-500/80 block font-semibold">Ganancia Cliente:</span>
                      <span className="text-sm font-bold text-emerald-400">
                        {formatCOP(totalGroupProfitCop)}
                      </span>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => handleNotifyGroup(group)}
                      disabled={isNotifyingThis || isClosed || totalUsdAccumulated <= 0 || users.length === 0}
                      className="px-3 py-2 rounded-xl bg-blue-950/70 hover:bg-blue-900 border border-blue-500/30 text-blue-300 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-40"
                      title="Enviar notificación con el saldo acumulado a todos los inversionistas de este grupo"
                    >
                      <Bell className="w-3.5 h-3.5" />
                      <span>{isNotifyingThis ? 'Enviando...' : isIndividual ? 'Notificar' : 'Notificar Grupo'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (!hasOperationalCycle) {
                          setErrorToast('No hay un ciclo operativo iniciado en este momento.');
                          setTimeout(() => setErrorToast(null), 4000);
                          return;
                        }
                        setSelectedGroupForDailyOps(group);
                      }}
                      className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-blue-600/20 transition cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Registrar Trade</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleGroupExpand(groupKey)}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center gap-1 transition cursor-pointer border border-slate-700"
                      title={isExpanded ? 'Ocultar detalles' : 'Desplegar detalles'}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Expanded Details: Inversionistas + Historial de Trades */}
                {isExpanded && (
                  <div className="p-4 sm:p-5 border-t border-slate-800/80 bg-slate-950/90 space-y-5">
                    {/* 1. Lista de Inversionistas Beneficiarios */}
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300">
                          {isIndividual ? <User className="w-4 h-4 text-blue-400" /> : <Users className="w-4 h-4 text-blue-400" />}
                          <span>
                            {isIndividual
                              ? 'Inversionista que recibe la liquidación (1 persona)'
                              : `Inversionistas que reciben los ${formatUSD(totalUsdAccumulated)} (${users.length} personas)`}
                          </span>
                        </div>
                        <span className="text-[11px] font-mono text-slate-400">
                          Capital Base Consolidado: {formatCOP(group.groupCapitalCop * Math.max(1, users.length))}
                        </span>
                      </div>

                      {users.length === 0 ? (
                        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400">
                          No hay clientes asignados directamente con este capital exacto de {formatCOP(group.groupCapitalCop)}. Las operaciones registradas se conservan en la bitácora y se vincularán cuando los clientes sean aprobados.
                        </div>
                      ) : (
                        <div className="border border-slate-800 rounded-xl overflow-hidden shadow-sm">
                          <table className="w-full text-xs text-left">
                            <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 font-mono uppercase text-[10px]">
                              <tr>
                                <th className="py-2.5 px-3">Inversionista</th>
                                <th className="py-2.5 px-3">Capital Base</th>
                                <th className="py-2.5 px-3">USD Operado</th>
                                <th className="py-2.5 px-3">Bruto COP</th>
                                <th className="py-2.5 px-3">Ganancia Cliente</th>
                                <th className="py-2.5 px-3">Comisión Admin</th>
                                <th className="py-2.5 px-3 text-center">Estado</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60 font-mono">
                              {users.map((user, idx) => {
                                const rawUserPct = user.userPercentage !== undefined ? user.userPercentage : 75;
                                const rawAdminPct = user.adminPercentage !== undefined ? user.adminPercentage : 25;
                                const userPct = rawUserPct <= 1 ? rawUserPct * 100 : rawUserPct;
                                const adminPct = rawAdminPct <= 1 ? rawAdminPct * 100 : rawAdminPct;
                                const calc = calculateUserMonthlyResult(totalUsdAccumulated, trm, userPct, adminPct);

                                return (
                                  <tr key={user.id} className="hover:bg-slate-800/30 transition">
                                    <td className="py-2.5 px-3 font-sans">
                                      <div className="flex items-center gap-2">
                                        <span className="w-5 h-5 rounded-md bg-blue-950 text-blue-300 text-[10px] font-bold flex items-center justify-center border border-blue-500/30">
                                          {idx + 1}
                                        </span>
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

                                    <td className="py-2.5 px-3 text-slate-300 font-semibold">
                                      {formatCOP(user.currentCapital)}
                                    </td>

                                    <td className="py-2.5 px-3 font-bold text-blue-400">
                                      {formatUSD(totalUsdAccumulated)}
                                    </td>

                                    <td className="py-2.5 px-3 text-slate-200">
                                      {formatCOP(calc.grossCop)}
                                    </td>

                                    <td className="py-2.5 px-3 font-bold text-emerald-400">
                                      {formatCOP(calc.userProfitCop)}
                                      <span className="block text-[10px] text-emerald-500/80 font-normal">
                                        {formatUSD(calc.userProfitUsd)}
                                      </span>
                                    </td>

                                    <td className="py-2.5 px-3 font-bold text-amber-400">
                                      {formatCOP(calc.adminCommissionCop)}
                                      <span className="block text-[10px] text-amber-500/80 font-normal">
                                        {formatUSD(calc.adminCommissionUsd)}
                                      </span>
                                    </td>

                                    <td className="py-2.5 px-3 text-center font-sans">
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 text-[10px] font-bold border border-emerald-500/30">
                                        <CheckCircle2 className="w-3 h-3" /> Activo
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* 2. Historial de Operaciones Diarias del Grupo */}
                    <div className="pt-2 border-t border-slate-800/80 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                          <Activity className="w-3.5 h-3.5 text-blue-400" />
                          <span>Historial de Trades Diarios ({operations.length} registros)</span>
                        </span>

                        <button
                          type="button"
                          onClick={() => {
                            if (!hasOperationalCycle) {
                              setErrorToast('No hay un ciclo operativo iniciado en este momento.');
                              setTimeout(() => setErrorToast(null), 4000);
                              return;
                            }
                            setSelectedGroupForDailyOps(group);
                          }}
                          className="text-[11px] font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Agregar otro trade a este grupo</span>
                        </button>
                      </div>

                      {operations.length === 0 ? (
                        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400">
                          No hay operaciones diarias registradas en este ciclo para {formatCOP(group.groupCapitalCop)}.
                        </div>
                      ) : (
                        <div className="border border-slate-800 rounded-xl overflow-hidden">
                          <table className="w-full text-xs text-left">
                            <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 font-mono uppercase text-[10px]">
                              <tr>
                                <th className="py-2 px-3">Fecha</th>
                                <th className="py-2 px-3">Monto USD</th>
                                <th className="py-2 px-3">Equivalente COP</th>
                                <th className="py-2 px-3">Notas / Detalle</th>
                                <th className="py-2 px-3 text-right">Registrado Por</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60 font-mono">
                              {operations.map((op) => (
                                <tr key={op.id} className="hover:bg-slate-800/20 transition">
                                  <td className="py-2 px-3 text-slate-300 font-bold">{op.date}</td>
                                  <td className="py-2 px-3 font-extrabold text-blue-400">
                                    {formatUSD(op.amountUsd)}
                                  </td>
                                  <td className="py-2 px-3 text-slate-200">
                                    {formatCOP(op.amountUsd * trm)}
                                  </td>
                                  <td className="py-2 px-3 text-slate-400 font-sans max-w-xs truncate">
                                    {op.notes || 'Operación de trading regular'}
                                  </td>
                                  <td className="py-2 px-3 text-right text-slate-400 font-sans text-[11px]">
                                    {op.createdBy || 'Administrador'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Apertura de Nuevo Grupo / Trade Directo */}
      {showNewGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-100">Nuevo Trade / Grupo de Capital</h3>
                  <p className="text-xs text-slate-400">Apertura y registro directo para cualquier importe</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowNewGroupModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateManualGroupOperation} className="space-y-4 pt-4 text-xs">
              <div>
                <label className="block font-bold text-slate-300 mb-1">Capital Base del Grupo (COP)</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: 4000000 o 10000000"
                  value={newGroupCapitalCop}
                  onChange={(e) => setNewGroupCapitalCop(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                />
                <span className="text-[10px] text-slate-500 mt-0.5 block">
                  Bitácoras: Azul ($4M - $9M) • Verde ($10M - $50M) • Negra (&gt; $60M)
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-300 mb-1">Monto Operado (USD)</label>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="Ej: 150"
                    value={newGroupInitialUsd}
                    onChange={(e) => setNewGroupInitialUsd(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-blue-400 font-mono font-bold focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-300 mb-1">Fecha del Trade</label>
                  <input
                    type="date"
                    required
                    value={newGroupDate}
                    onChange={(e) => setNewGroupDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Notas / Detalle de la Operación</label>
                <input
                  type="text"
                  placeholder="Ej: Trade sesión New York NASDAQ"
                  value={newGroupNotes}
                  onChange={(e) => setNewGroupNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowNewGroupModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold cursor-pointer shadow-md shadow-blue-600/20"
                >
                  Guardar y Aperturar
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
          adminUid={currentUser?.id || 'admin_root_uid'}
          adminName={currentUser?.fullName || 'Administrador Principal'}
        />
      )}

      {/* Excel Import Modal */}
      <ExcelBitacoraImportModal
        isOpen={showExcelModal}
        onClose={() => setShowExcelModal(false)}
        cycle={currentCycle}
        adminUid={currentUser?.id || 'admin_root_uid'}
        adminName={currentUser?.fullName || 'Administrador Principal'}
        onImportSuccess={() => {
          setSuccessToast('Operaciones importadas exitosamente desde Excel.');
          setTimeout(() => setSuccessToast(null), 4000);
        }}
      />

      {/* Adjust TRM Modal */}
      <EditTRMModal isOpen={showTrmModal} onClose={() => setShowTrmModal(false)} />

      {/* Modal: Cierre Operativo Global y Notificaciones */}
      {showGlobalClosureModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl p-6 shadow-2xl relative max-h-[90vh] flex flex-col space-y-4">
            
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                    Resumen de Cierre Operativo Global
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold uppercase">
                      Jornada Activa
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Consolidación e informe de operaciones en todas las bitácoras (TRM: <span className="text-emerald-400 font-mono font-bold">{formatTRM(trm)} COP</span>)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGlobalClosureModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            {/* Content Container with Scroll */}
            <div className="overflow-y-auto space-y-4 pr-1 text-xs">
              
              {/* KPI Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                    <DollarSign className="w-3.5 h-3.5 text-blue-400" /> USD Operados Hoy
                  </div>
                  <div className="text-lg font-black text-blue-400 font-mono">
                    {formatUSD(globalActiveUsdTotal)}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {allActiveOps.length} trades activos
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                    <DollarSign className="w-3.5 h-3.5 text-slate-300" /> Total COP Bruto
                  </div>
                  <div className="text-lg font-black text-slate-100 font-mono">
                    {formatCOP(globalActiveGrossCopTotal)}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Suma total generada
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950 border border-emerald-900/40 bg-emerald-950/10 space-y-1">
                  <div className="text-[10px] uppercase font-bold text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Ganancia Clientes COP
                  </div>
                  <div className="text-lg font-black text-emerald-400 font-mono">
                    {formatCOP(totalClientProfitCopGlobal)}
                  </div>
                  <div className="text-[10px] text-emerald-500/80">
                    {operatedUsersList.length} inversionistas
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950 border border-amber-900/40 bg-amber-950/10 space-y-1">
                  <div className="text-[10px] uppercase font-bold text-amber-400 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-400" /> Comisión Admin COP
                  </div>
                  <div className="text-lg font-black text-amber-400 font-mono">
                    {formatCOP(totalAdminCommissionCopGlobal)}
                  </div>
                  <div className="text-[10px] text-amber-500/80">
                    Retención de plataforma
                  </div>
                </div>
              </div>

              {/* Lista de Inversionistas Operados y Notificaciones */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-200 text-xs flex items-center gap-2">
                    <Users className="w-4 h-4 text-indigo-400" />
                    <span>Inversionistas a Notificar ({operatedUsersList.length}):</span>
                  </h4>
                  <button
                    type="button"
                    onClick={handleNotifyAllGlobal}
                    className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Send className="w-3 h-3" />
                    <span>Enviar Notificaciones Ahora</span>
                  </button>
                </div>

                {operatedUsersList.length === 0 ? (
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-center text-slate-400">
                    No hay inversionistas vinculados a las operaciones activas de hoy.
                  </div>
                ) : (
                  <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-900 text-slate-400 font-mono uppercase text-[10px] border-b border-slate-800">
                        <tr>
                          <th className="py-2.5 px-3">Inversionista</th>
                          <th className="py-2.5 px-3">Bitácora / Grupo</th>
                          <th className="py-2.5 px-3 text-center">% Split</th>
                          <th className="py-2.5 px-3">USD Operado</th>
                          <th className="py-2.5 px-3">Ganancia Inversionista</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80 font-mono">
                        {operatedUsersList.map((item) => (
                          <tr key={item.user.id} className="hover:bg-slate-900/50 transition">
                            <td className="py-2.5 px-3 font-sans">
                              <span className="font-bold text-slate-200 block">{item.user.fullName}</span>
                              <span className="text-[10px] text-slate-400 font-mono">
                                {item.user.userCode} • {item.user.documentId ? `CC: ${item.user.documentId}` : item.user.email}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-sans">
                              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
                                Bitácora {item.category} ({formatCOP(item.groupCapitalCop)})
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center font-bold text-indigo-400">
                              {item.userPercentage}%
                            </td>
                            <td className="py-2.5 px-3 font-bold text-blue-400">
                              {formatUSD(item.usdOperatedGroup)}
                            </td>
                            <td className="py-2.5 px-3 font-bold text-emerald-400">
                              {formatCOP(item.userProfitCop)}
                              <span className="block text-[10px] text-emerald-500/80 font-normal">
                                {formatUSD(item.userProfitUsd)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Opción de Notificar al Consolidar */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                <label className="flex items-center gap-2.5 cursor-pointer text-slate-200 font-medium">
                  <input
                    type="checkbox"
                    checked={shouldNotifyOnGlobalClose}
                    onChange={(e) => setShouldNotifyOnGlobalClose(e.target.checked)}
                    className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                  />
                  <span>Enviar automáticamente notificaciones personalizadas al confirmar el Cierre Global</span>
                </label>
              </div>
            </div>

            {/* Modal Footer Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowGlobalClosureModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold cursor-pointer transition text-xs"
              >
                Volver
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExecuteConsolidateAllGlobal}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs flex items-center gap-2 transition cursor-pointer shadow-lg shadow-emerald-600/20"
                >
                  <Lock className="w-4 h-4" />
                  <span>Confirmar Cierre Global y Guardar ({formatUSD(globalActiveUsdTotal)})</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Modal Purga de Datos de Prueba (SuperAdmin) */}
      {showPurgeModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-rose-950/80 border border-rose-800/80 flex items-center justify-center text-rose-400">
                    <Trash2 className="w-4 h-4" />
                  </div>
                  <h3 className="text-base font-bold text-slate-100">
                    Limpieza Segura de Datos de Prueba
                  </h3>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Purga autorizada para bitácoras del ciclo activo (<span className="font-mono text-slate-200">{currentCycle.cycleId}</span>).
                </p>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-800/60 font-bold">
                SUPERADMIN ONLY
              </span>
            </div>

            {/* Modal Content */}
            {dryRunLoading ? (
              <div className="py-12 text-center space-y-3">
                <RefreshCw className="w-8 h-8 mx-auto text-rose-400 animate-spin" />
                <p className="text-sm font-semibold text-slate-300">Auditoría en curso...</p>
                <p className="text-xs text-slate-500">
                  Comprobando restricciones de seguridad e integridad del ciclo activo.
                </p>
              </div>
            ) : dryRunResult ? (
              <div className="space-y-4">
                {/* Audit summary card */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between text-xs font-mono border-b border-slate-800/80 pb-2">
                    <span className="text-slate-400">Ciclo Objetivo:</span>
                    <span className="text-slate-200 font-bold">
                      {dryRunResult.preview?.cycleId} ({dryRunResult.preview?.cycleStatus})
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs font-mono">
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-[10px] text-slate-500 block uppercase">Inversionistas</span>
                      <span className={`text-sm font-bold ${dryRunResult.preview?.activeInvestorCount > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {dryRunResult.preview?.activeInvestorCount} activos
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-[10px] text-slate-500 block uppercase">Trades / Operaciones</span>
                      <span className="text-sm font-bold text-slate-200">
                        {dryRunResult.preview?.dailyOperations}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-[10px] text-slate-500 block uppercase">Resultados de Ciclo</span>
                      <span className="text-sm font-bold text-slate-200">
                        {dryRunResult.preview?.cycleUserResults}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-[10px] text-slate-500 block uppercase">Grupos de Capital</span>
                      <span className="text-sm font-bold text-slate-200">
                        {dryRunResult.preview?.cycleGroupCalculations}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-[10px] text-slate-500 block uppercase">Notificaciones</span>
                      <span className="text-sm font-bold text-slate-200">
                        {dryRunResult.preview?.tradingNotifications}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/40">
                      <span className="text-[10px] text-rose-300 block uppercase font-bold">Total a Limpiar</span>
                      <span className="text-sm font-extrabold text-rose-300">
                        {dryRunResult.preview?.totalDocuments} docs
                      </span>
                    </div>
                  </div>
                </div>

                {/* Status-specific warning/confirmation block */}
                {dryRunResult.preview?.activeInvestorCount > 0 ? (
                  <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/50 text-rose-200 text-xs space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-rose-300">
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                      <span>Acción Bloqueada por Seguridad</span>
                    </div>
                    <p className="leading-relaxed text-slate-300">
                      Existen <strong className="text-rose-300">{dryRunResult.preview?.activeInvestorCount} inversionista(s) activo(s)</strong> con capital asignado en el sistema. Por directriz institucional, la purga de datos de bitácoras de prueba solo se permite cuando hay 0 inversionistas activos.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-xs space-y-2">
                      <div className="flex items-center gap-2 font-bold text-amber-300">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>Confirmación Obligatoria</span>
                      </div>
                      <p className="text-slate-300 leading-relaxed">
                        Se eliminarán permanentemente los <strong className="text-amber-300">{dryRunResult.preview?.totalDocuments}</strong> registros de prueba del ciclo activo. Las cuentas de usuario y los ciclos cerrados permanecerán intactos.
                      </p>
                      <p className="text-slate-400 text-[11px]">
                        Para confirmar, escribe exactamente: <code className="text-amber-200 bg-amber-950/80 px-1.5 py-0.5 rounded font-bold font-mono">LIMPIAR BITÁCORAS DE PRUEBA</code>
                      </p>
                    </div>

                    <div>
                      <input
                        type="text"
                        value={purgeConfirmationInput}
                        onChange={(e) => setPurgeConfirmationInput(e.target.value)}
                        placeholder="LIMPIAR BITÁCORAS DE PRUEBA"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-600 font-mono focus:outline-none focus:border-rose-500"
                      />
                    </div>
                  </div>
                )}

                {purgeError && (
                  <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-600/50 text-rose-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{purgeError}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 text-center text-rose-400 text-xs">
                {purgeError || 'No se pudo cargar la vista previa.'}
              </div>
            )}

            {/* Modal Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowPurgeModal(false)}
                disabled={isPurging}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold transition text-xs cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleExecutePurge}
                disabled={
                  dryRunLoading ||
                  !dryRunResult ||
                  dryRunResult.preview?.activeInvestorCount > 0 ||
                  purgeConfirmationInput !== 'LIMPIAR BITÁCORAS DE PRUEBA' ||
                  isPurging
                }
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center gap-2 transition cursor-pointer shadow-lg shadow-rose-600/20"
              >
                {isPurging ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Purgando registros...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>Ejecutar Limpieza</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
