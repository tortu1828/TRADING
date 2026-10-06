import React, { useState, useEffect } from 'react';
import {
  RotateCcw,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Info,
  Clock,
  BarChart2,
  TrendingUp,
  Home,
  DollarSign,
  ArrowRight,
  FileCheck2,
  Bell,
  Wallet,
  Banknote,
  Coins,
  ShieldCheck,
  Loader2,
  X,
  Lock,
  Compass,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { useAuth } from '../context/AuthContext';
import { dataStore } from '../lib/dataStore';
import { StatisticsView } from './StatisticsView';
import { formatCOP, formatUSD, formatTRM, getCategoryForCapital, calculateUserMonthlyResult } from '../lib/financialEngine';
import {
  getNotificationPermissionState,
  requestNotificationPermission,
  sendBrowserPushNotification,
  playPushNotificationSound,
  ensurePushRegistration,
} from '../lib/pushNotifications';
import confetti from 'canvas-confetti';

interface UserPortalViewProps {
  activeSection?: string;
  onNavigate?: (tab: string) => void;
  selectedCycleId?: string;
  onSelectCycle?: (cycleId: string) => void;
}

export const UserPortalView: React.FC<UserPortalViewProps> = ({
  activeSection,
  onNavigate,
  selectedCycleId: propSelectedCycleId,
  onSelectCycle,
}) => {
  const { currentUser: authUser } = useAuth();
  const activeCycle = dataStore.getActiveCycle();
  const allCycles = dataStore.getCycles();

  // Siempre obtener el perfil más completo y fresco desde dataStore (sincronizado en tiempo real)
  const currentUser = React.useMemo(() => {
    if (!authUser) return null;
    const freshUser = dataStore.getUsers().find(
      (u) =>
        (authUser.id && u.id === authUser.id) ||
        (authUser.uid && (u.uid === authUser.uid || u.id === authUser.uid)) ||
        (authUser.userCode && u.userCode?.toUpperCase() === authUser.userCode.toUpperCase()) ||
        (authUser.email && u.email?.toLowerCase() === authUser.email.toLowerCase())
    );
    return freshUser ? { ...freshUser, uid: authUser.uid || freshUser.uid } : authUser;
  }, [authUser, dataStore.getUsers()]);

  // Internal tab state synchronized with activeSection
  const getTabFromSection = (section?: string): 'summary' | 'history' | 'reinvestment' | 'statistics' => {
    if (section === 'portal_history' || section === 'history') return 'history';
    if (section === 'portal_reinvestment' || section === 'reinvestment') return 'reinvestment';
    if (section === 'portal_statistics' || section === 'statistics') return 'statistics';
    return 'summary';
  };

  const [currentTab, setCurrentTab] = useState<'summary' | 'history' | 'reinvestment' | 'statistics'>(
    getTabFromSection(activeSection)
  );

  React.useEffect(() => {
    if (activeSection) {
      setCurrentTab(getTabFromSection(activeSection));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [activeSection]);

  const handleTabChange = (tab: 'summary' | 'history' | 'reinvestment' | 'statistics') => {
    setCurrentTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (onNavigate) {
      if (tab === 'summary') onNavigate('portal');
      else if (tab === 'history') onNavigate('portal_history');
      else if (tab === 'reinvestment') onNavigate('portal_reinvestment');
      else if (tab === 'statistics') onNavigate('portal_statistics');
    }
  };

  // Real-time synchronization with dataStore and Firestore
  const [, setTick] = useState<number>(0);
  useEffect(() => {
    const unsub = dataStore.subscribe(() => {
      setTick((t) => t + 1);
    });
    return () => unsub();
  }, []);

  const config = dataStore.getConfig();
  const operationalCycleId = config.operationalCycleId;
  const preparingCycleId = config.preparingCycleId;

  const isCloseToStartCase = !operationalCycleId && !!preparingCycleId && (() => {
    const cycleB = dataStore.getCycleById(preparingCycleId);
    if (cycleB && cycleB.previousCycleId) {
      const cycleA = dataStore.getCycleById(cycleB.previousCycleId);
      return cycleA && cycleA.nextCycleId === cycleB.cycleId;
    }
    return false;
  })();

  const getCloseToStartSourceId = () => {
    if (!operationalCycleId && preparingCycleId) {
      const cycleB = dataStore.getCycleById(preparingCycleId);
      if (cycleB && cycleB.previousCycleId) {
        const cycleA = dataStore.getCycleById(cycleB.previousCycleId);
        if (cycleA && cycleA.nextCycleId === cycleB.cycleId) {
          return cycleA.cycleId;
        }
      }
    }
    return null;
  };

  const [selectedCycleId, setSelectedCycleId] = useState<string>(() => {
    if (propSelectedCycleId) return propSelectedCycleId;
    const closeToStartSourceId = getCloseToStartSourceId();
    if (closeToStartSourceId) return closeToStartSourceId;
    return activeCycle ? activeCycle.cycleId : (dataStore.getCycles()[0]?.cycleId || '');
  });

  // Secure unidimensional propagation to prevent react state update loops
  useEffect(() => {
    if (propSelectedCycleId && propSelectedCycleId !== selectedCycleId) {
      setSelectedCycleId(propSelectedCycleId);
    }
  }, [propSelectedCycleId]);

  // Fail-safe initialization to activeCycleId
  useEffect(() => {
    if (activeCycle && (!selectedCycleId || !dataStore.getCycleById(selectedCycleId))) {
      const closeToStartSourceId = getCloseToStartSourceId();
      const targetCycleId = propSelectedCycleId || closeToStartSourceId || activeCycle.cycleId;
      setSelectedCycleId(targetCycleId);
      if (onSelectCycle) {
        onSelectCycle(targetCycleId);
      }
    }
  }, [activeCycle]);

  const currentCycle = dataStore.getCycleById(selectedCycleId) || activeCycle;

  // Push notifications activation state
  const [notifPermission, setNotifPermission] = useState<string>(getNotificationPermissionState());
  const [isActivatingNotif, setIsActivatingNotif] = useState(false);
  const [notifFeedback, setNotifFeedback] = useState<string | null>(null);
  const [hasConfigError, setHasConfigError] = useState(false);

  useEffect(() => {
    if (notifPermission === 'granted') {
      const token = localStorage.getItem('gestor_push_fcm_token');
      if (!token) {
        setHasConfigError(true);
      } else {
        setHasConfigError(false);
      }
    } else {
      setHasConfigError(false);
    }
  }, [notifPermission]);

  const handleEnableNotifications = async () => {
    setIsActivatingNotif(true);
    setNotifFeedback(null);
    setHasConfigError(false);
    try {
      const res = await requestNotificationPermission();
      setNotifPermission(getNotificationPermissionState());
      if (res.granted) {
        if (res.token) {
          sendBrowserPushNotification('¡Notificaciones Push Activadas!', {
            body: `Hola ${currentUser?.fullName || 'Inversionista'}, recibirás tus reportes y ganancias de trading en tiempo real.`,
            tag: 'welcome_portal_push',
          });
          playPushNotificationSound();
          setHasConfigError(false);
        } else if (res.error) {
          setNotifFeedback(res.error);
          setHasConfigError(true);
        }
      } else if (res.error) {
        setNotifFeedback(res.error);
        setHasConfigError(true);
      }
    } catch (e) {
      console.warn('Error solicitando permisos push:', e);
      setHasConfigError(true);
    } finally {
      setIsActivatingNotif(false);
    }
  };

  const handleRetryPushConfig = async () => {
    setIsActivatingNotif(true);
    setNotifFeedback(null);
    setHasConfigError(false);
    try {
      const res = await ensurePushRegistration({ forceRepair: false });
      setNotifPermission(getNotificationPermissionState());
      if (res.success && res.token) {
        setHasConfigError(false);
        sendBrowserPushNotification('¡Notificaciones Configuradas!', {
          body: 'Configuración restablecida con éxito.',
          icon: '/favicon.png',
        });
      } else {
        setHasConfigError(true);
        setNotifFeedback(res.error || 'No se pudo registrar en la base de datos.');
      }
    } catch (e) {
      console.warn('Error reintentando configuración push:', e);
      setHasConfigError(true);
    } finally {
      setIsActivatingNotif(false);
    }
  };

  // Reinvestment State (2-Modality Architecture)
  const [profitReinvestSelectedCop, setProfitReinvestSelectedCop] = useState<number>(0);
  const [desiredCapitalIncreaseCop, setDesiredCapitalIncreaseCop] = useState<number>(1_000_000);
  const [isSubmittingReinvest, setIsSubmittingReinvest] = useState<boolean>(false);
  const [reinvestSubmitted, setReinvestSubmitted] = useState<boolean>(false);
  const [reinvestSuccessMessage, setReinvestSuccessMessage] = useState<string | null>(null);
  const [reinvestError, setReinvestError] = useState<string | null>(null);
  const [reinvestModalConfig, setReinvestModalConfig] = useState<{
    modality: 'PROFIT_REINVESTMENT' | 'CAPITAL_INJECTION';
    selectedReinvestmentCop?: number;
    desiredCapitalIncreaseCop?: number;
    currentCapitalSnapshotCop: number;
    cycleProfitSnapshotCop: number;
    reinvestableProfitCop: number;
    profitAppliedCop: number;
    cashInjectionCop: number;
    profitToDisburseCop: number;
    totalIncreaseCop: number;
    projectedCapitalCop: number;
    projectedCategory: string;
  } | null>(null);

  if (!currentUser) {
    return (
      <div className="p-8 text-center text-slate-400">
        <p>No has seleccionado un usuario para visualizar.</p>
      </div>
    );
  }

  const userResult =
    dataStore.getUserResultForUser(currentUser.id, selectedCycleId) ||
    (currentUser.uid ? dataStore.getUserResultForUser(currentUser.uid, selectedCycleId) : undefined) ||
    dataStore.getUserResultForUser(currentUser.userCode, selectedCycleId) ||
    (currentUser.email ? dataStore.getUserResultForUser(currentUser.email, selectedCycleId) : undefined);

  const allUserHistoricalResults = dataStore.getUserResults().filter(
    (r) =>
      r.userId === currentUser.id ||
      r.userCode === currentUser.userCode ||
      (currentUser.uid && (r.userUid === currentUser.uid || r.userId === currentUser.uid)) ||
      (currentUser.email && r.email && currentUser.email.toLowerCase() === currentUser.email.toLowerCase())
  );

  // User Reinvestments
  const userReinvestments = dataStore.getReinvestments().filter(
    (r) =>
      r.userId === currentUser.id ||
      r.userCode === currentUser.userCode ||
      (currentUser.uid && (r.userUid === currentUser.uid || r.userId === currentUser.uid))
  );

  // Equivalente informativo del capital a USD.
  // Usa exclusivamente la TRM automática validada desde Dolar-Colombia.com.
  // NO usa TRM de cierre, resultados históricos ni fallbacks financieros.
  const marketTrmCandidate = Number(config?.trmMarketRate);

  const hasAuthoritativeMarketTrm =
    Number.isFinite(marketTrmCandidate) &&
    marketTrmCandidate > 1000 &&
    marketTrmCandidate < 10000 &&
    String(config?.trmSource || '').trim().toLowerCase() === 'dolar-colombia.com';

  const capitalEquivalentUsd = hasAuthoritativeMarketTrm
    ? currentUser.currentCapital / marketTrmCandidate
    : null;

  const capitalEquivalentUsdLabel =
    capitalEquivalentUsd !== null
      ? `$${capitalEquivalentUsd.toLocaleString('es-CO', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} USD`
      : 'TRM no disponible';

  // FINANCIAL SNAPSHOTS FOR REINVESTMENT
  const selectedCycleObj = allCycles.find((c) => c.cycleId === selectedCycleId);
  const isCycleClosing = selectedCycleObj?.isClosing === true;

  // Solo presentación: la lógica interna continúa usando cycleId.
  const getCycleDisplayName = (cycleId?: string | null) => {
    if (!cycleId) return '';
    const cycle = allCycles.find(
      (c) => c.cycleId === cycleId || c.id === cycleId
    );
    return cycle?.name?.trim() || cycleId;
  };

  const selectedCycleName =
    getCycleDisplayName(selectedCycleId);

  let preparingCycleObj: any = null;
  let previousCycleObj: any = null;

  if (isCloseToStartCase && preparingCycleId) {
    const cycleB = dataStore.getCycleById(preparingCycleId);
    if (cycleB && cycleB.previousCycleId) {
      preparingCycleObj = cycleB;
      previousCycleObj = dataStore.getCycleById(cycleB.previousCycleId);
    }
  }

  const cycleProfitCop = userResult ? Math.round(Number(userResult.userProfitCop) || 0) : 0;
  // Regla de redondeo obligatoria: múltiplos de $1.000.000 COP siempre hacia abajo.
  // NO transformar pérdidas en valores positivos.
  const reinvestableProfitCop = cycleProfitCop >= 1_000_000 ? Math.floor(cycleProfitCop / 1_000_000) * 1_000_000 : 0;
  const profitRemainderCop = Math.max(0, cycleProfitCop - reinvestableProfitCop);

  // Solicitud PENDING existente para el ciclo
  const pendingRequestForCycle = userReinvestments.find(
    (r) => r.sourceCycleId === selectedCycleId && r.status === 'PENDING'
  );

  // Initialize selected profit reinvestment whenever cycle or profit changes
  useEffect(() => {
    if (reinvestableProfitCop >= 1_000_000) {
      setProfitReinvestSelectedCop(reinvestableProfitCop);
    } else {
      setProfitReinvestSelectedCop(0);
    }
  }, [reinvestableProfitCop, selectedCycleId]);

  // Calculations for Card 1 (PROFIT_REINVESTMENT)
  const card1SelectedReinvest = Math.min(
    Math.max(0, Math.floor(profitReinvestSelectedCop / 1_000_000) * 1_000_000),
    reinvestableProfitCop
  );
  const card1ProfitRemainder = Math.max(0, cycleProfitCop - card1SelectedReinvest);
  const card1ProjectedCapital = currentUser.currentCapital + card1SelectedReinvest;
  const card1ProjectedCategory = getCategoryForCapital(card1ProjectedCapital);

  // Calculations for Card 2 (CAPITAL_INJECTION)
  const card2DesiredIncrease = Math.max(1_000_000, Math.floor(desiredCapitalIncreaseCop / 1_000_000) * 1_000_000);
  const card2ProfitApplied = Math.min(reinvestableProfitCop, card2DesiredIncrease);
  const card2CashInjection = Math.max(0, card2DesiredIncrease - card2ProfitApplied);
  const card2ProfitToDisburse = Math.max(0, cycleProfitCop - card2ProfitApplied);
  const card2ProjectedCapital = currentUser.currentCapital + card2DesiredIncrease;
  const card2ProjectedCategory = getCategoryForCapital(card2ProjectedCapital);

  // User Performance Chart Data
  const userPerformanceData = allUserHistoricalResults.map((r) => ({
    cycle: getCycleDisplayName(r.cycleId),
    profitCOP_k: Math.round(r.userProfitCop / 1000),
    profitCOP: r.userProfitCop,
    usdOperated: r.totalUsdOperated,
  }));

  // Aggregated stats for history
  const totalAccumulatedProfitCop = allUserHistoricalResults.reduce(
    (sum, r) => sum + r.userProfitCop,
    0
  );
  const totalAccumulatedUsdOperated = allUserHistoricalResults.reduce(
    (sum, r) => sum + r.totalUsdOperated,
    0
  );
  const avgMonthlyProfitCop =
    allUserHistoricalResults.length > 0
      ? Math.round(totalAccumulatedProfitCop / allUserHistoricalResults.length)
      : 0;

  const handleOpenCard1Modal = () => {
    setReinvestError(null);
    if (selectedCycleId !== activeCycle?.cycleId) {
      setReinvestError('Solo se pueden radicar solicitudes de reinversión en el ciclo operativo activo.');
      return;
    }
    if (isCycleClosing) {
      setReinvestError('El ciclo se encuentra en proceso de cierre transaccional. No se pueden radicar nuevas solicitudes en este momento.');
      return;
    }
    if (reinvestableProfitCop < 1_000_000) {
      setReinvestError('Tus ganancias todavía no alcanzan el mínimo de $1.000.000 necesario para reinvertir.');
      return;
    }
    const selected = card1SelectedReinvest > 0 ? card1SelectedReinvest : reinvestableProfitCop;
    setReinvestModalConfig({
      modality: 'PROFIT_REINVESTMENT',
      selectedReinvestmentCop: selected,
      currentCapitalSnapshotCop: currentUser.currentCapital,
      cycleProfitSnapshotCop: cycleProfitCop,
      reinvestableProfitCop,
      profitAppliedCop: selected,
      cashInjectionCop: 0,
      profitToDisburseCop: Math.max(0, cycleProfitCop - selected),
      totalIncreaseCop: selected,
      projectedCapitalCop: currentUser.currentCapital + selected,
      projectedCategory: getCategoryForCapital(currentUser.currentCapital + selected),
    });
  };

  const handleOpenCard2Modal = () => {
    setReinvestError(null);
    if (selectedCycleId !== activeCycle?.cycleId) {
      setReinvestError('Solo se pueden radicar solicitudes de reinversión en el ciclo operativo activo.');
      return;
    }
    if (isCycleClosing) {
      setReinvestError('El ciclo se encuentra en proceso de cierre transaccional. No se pueden radicar nuevas solicitudes en este momento.');
      return;
    }
    if (card2DesiredIncrease <= 0 || card2DesiredIncrease % 1_000_000 !== 0) {
      setReinvestError('El aumento de capital debe ser un múltiplo de $1.000.000 COP.');
      return;
    }
    setReinvestModalConfig({
      modality: 'CAPITAL_INJECTION',
      desiredCapitalIncreaseCop: card2DesiredIncrease,
      currentCapitalSnapshotCop: currentUser.currentCapital,
      cycleProfitSnapshotCop: cycleProfitCop,
      reinvestableProfitCop,
      profitAppliedCop: card2ProfitApplied,
      cashInjectionCop: card2CashInjection,
      profitToDisburseCop: card2ProfitToDisburse,
      totalIncreaseCop: card2DesiredIncrease,
      projectedCapitalCop: card2ProjectedCapital,
      projectedCategory: card2ProjectedCategory,
    });
  };

  const handleConfirmSubmit = async () => {
    if (!reinvestModalConfig) return;
    if (selectedCycleId !== activeCycle?.cycleId) {
      setReinvestError('Solo se pueden radicar solicitudes de reinversión en el ciclo operativo activo.');
      return;
    }
    setIsSubmittingReinvest(true);
    setReinvestError(null);

    try {
      if (reinvestModalConfig.modality === 'PROFIT_REINVESTMENT') {
        await dataStore.submitReinvestmentRequest({
          userId: currentUser.id,
          sourceCycleId: selectedCycleId,
          modality: 'PROFIT_REINVESTMENT',
          selectedReinvestmentCop: reinvestModalConfig.selectedReinvestmentCop || 0,
        });
      } else {
        await dataStore.submitReinvestmentRequest({
          userId: currentUser.id,
          sourceCycleId: selectedCycleId,
          modality: 'CAPITAL_INJECTION',
          desiredCapitalIncreaseCop: reinvestModalConfig.desiredCapitalIncreaseCop || 0,
        });
      }

      setReinvestSubmitted(true);
      setReinvestSuccessMessage('¡Solicitud de reinversión radicada con éxito ante la administración!');
      setReinvestModalConfig(null);
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.6 },
      });
      setTimeout(() => {
        setReinvestSubmitted(false);
        setReinvestSuccessMessage(null);
      }, 4000);
    } catch (err: any) {
      setReinvestError(err.message || 'Error al radicar la solicitud de reinversión.');
    } finally {
      setIsSubmittingReinvest(false);
    }
  };

  const isCyclePending = !userResult;

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* 1. Profile Header Banner */}
      <div className="p-4 sm:p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-blue-950/60 border border-blue-500/40 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-full bg-gradient-to-l from-emerald-500/5 to-transparent pointer-events-none" />

        <div className="flex items-center gap-3.5 sm:gap-4">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white font-bold text-lg sm:text-xl shadow-lg shadow-blue-600/30 border border-blue-400/30 shrink-0">
            {currentUser.fullName.charAt(0)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg sm:text-xl font-extrabold text-slate-100 truncate">
                {currentUser.fullName}
              </h2>
              <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-blue-950 text-blue-300 border border-blue-500/40">
                {currentUser.userCode}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
              <span>Capital:</span>
              <strong className="text-slate-100 font-mono font-bold">
                {formatCOP(currentUser.currentCapital)}
              </strong>
              <span className="text-slate-600">•</span>
              <span>Equivalente:</span>
              <strong className="text-blue-300 font-mono font-bold">
                {capitalEquivalentUsdLabel}
              </strong>
            </p>
          </div>
        </div>

        {/* Action Controls - Period Selector */}
        <div className="flex items-center gap-3 self-start md:self-auto w-full sm:w-auto">
          <div className="flex items-center gap-2 bg-slate-950 px-3 py-2 rounded-xl border border-slate-800 w-full sm:w-auto shadow-inner">
            <Calendar className="w-4 h-4 text-blue-400 shrink-0" />
            <span className="text-xs text-slate-400 shrink-0">Período:</span>
            <select
              value={selectedCycleId}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedCycleId(val);
                onSelectCycle?.(val);
              }}
              className="bg-transparent text-xs font-bold text-slate-100 focus:outline-none cursor-pointer w-full"
            >
              {allCycles.map((c) => (
                <option key={c.cycleId} value={c.cycleId} className="bg-slate-900 text-slate-100">
                  {c.name} ({c.status})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Push Notification Banner */}
      {notifPermission !== 'unsupported' && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950/20 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xl">
          {hasConfigError && notifPermission === 'granted' ? (
            // State C: Error de Configuración
            <>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
                  <span className="text-xl">⚠️</span>
                </div>
                <div>
                  <p className="text-xs font-bold text-amber-200">No pudimos configurar las notificaciones.</p>
                  {notifFeedback ? (
                    <p className="text-[11px] text-amber-400 font-semibold mt-0.5">{notifFeedback}</p>
                  ) : (
                    <p className="text-[11px] text-slate-400 mt-0.5">Ocurrió un inconveniente al registrar tu dispositivo en la base de datos.</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={handleRetryPushConfig}
                disabled={isActivatingNotif}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shrink-0 transition flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/10 cursor-pointer disabled:opacity-50"
              >
                <span>{isActivatingNotif ? 'Configurando...' : 'Reintentar'}</span>
              </button>
            </>
          ) : notifPermission === 'granted' ? (
            // State A: Activado
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                <span className="text-lg">🔔</span>
              </div>
              <div>
                <p className="text-xs font-bold text-emerald-400">Notificaciones activadas</p>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  Recibirás avisos de tus operaciones.
                </p>
              </div>
            </div>
          ) : (
            // State B: Sin Permiso
            <>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
                  <span className="text-lg">🔔</span>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-100">Activa las notificaciones</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Mantente informado sobre tus operaciones.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleEnableNotifications}
                disabled={isActivatingNotif}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shrink-0 transition flex items-center justify-center gap-1.5 shadow-md shadow-blue-600/20 cursor-pointer disabled:opacity-50"
              >
                <span>{isActivatingNotif ? 'Activando...' : 'Activar notificaciones'}</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* 2. Top Navigation Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-900/90 backdrop-blur-md rounded-xl border border-slate-800/90 overflow-x-auto">
        <button
          onClick={() => handleTabChange('summary')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
            currentTab === 'summary'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <Home className="w-4 h-4" />
          <span>Inicio & Resumen</span>
        </button>

        <button
          onClick={() => handleTabChange('history')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
            currentTab === 'history'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Historial de Ciclos</span>
          {allUserHistoricalResults.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-300 font-mono">
              {allUserHistoricalResults.length}
            </span>
          )}
        </button>

        <button
          onClick={() => handleTabChange('reinvestment')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
            currentTab === 'reinvestment'
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <RotateCcw className="w-4 h-4 text-emerald-400" />
          <span>Solicitar Reinversión a Capital</span>
        </button>

        <button
          onClick={() => handleTabChange('statistics')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
            currentTab === 'statistics'
              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <BarChart2 className="w-4 h-4 text-amber-500" />
          <span>Estadísticas</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* VIEW 1: SUMMARY (Inicio & Resumen) */}
      {/* ========================================================================= */}
      {currentTab === 'summary' && (() => {
        const targetCycleId = selectedCycleId || activeCycle?.cycleId || currentCycle?.cycleId || '';
        const userCategory = currentUser.category || getCategoryForCapital(currentUser.currentCapital) || 'AZUL';

        // 1. Obtener de forma estricta ÚNICAMENTE las operaciones reales de este usuario (o de su grupo exacto)
        const userDailyOps = dataStore.getDailyOperationsForUser(currentUser, targetCycleId);
        const sumDailyUsd = userDailyOps.reduce((sum, op) => sum + op.amountUsd, 0);

        // Si hay operaciones diarias registradas en este ciclo (ej: 3 trades de 123 USD = 369 USD),
        // esa es la verdad operativa en tiempo real para este inversionista.
        // Si no hay operaciones diarias aún, consultar el userResult del ciclo si existe.
        const liveTotalUsd =
          userDailyOps.length > 0
            ? sumDailyUsd
            : (userResult?.totalUsdOperated ?? 0);

        // Operaciones diarias:
        // usar exclusivamente valores persistidos
        // por el backend con su TRM real.
        const persistedDailyGrossCop =
          userDailyOps.reduce(
            (sum, op) => {
              const gross =
                Number((op as any).grossCop);

              if (Number.isFinite(gross)) {
                return sum + gross;
              }

              const operationTrm =
                Number((op as any).trmUsed);

              if (
                Number.isFinite(operationTrm) &&
                operationTrm > 0
              ) {
                return (
                  sum +
                  Number(op.amountUsd || 0) *
                    operationTrm
                );
              }

              return sum;
            },
            0
          );

        const dailyEffectiveTrm =
          userDailyOps.length > 0 &&
          sumDailyUsd !== 0
            ? persistedDailyGrossCop /
              sumDailyUsd
            : 0;

        const resultTrmCandidate =
          Number(userResult?.trmUsed);

        const frozenCycleTrmCandidate =
          Number(
            currentCycle?.trmApplied ??
            activeCycle?.trmApplied ??
            0
          );

        const liveTrm =
          userDailyOps.length > 0 &&
          Number.isFinite(dailyEffectiveTrm) &&
          dailyEffectiveTrm > 0
            ? dailyEffectiveTrm
            : Number.isFinite(resultTrmCandidate) &&
              resultTrmCandidate > 0
              ? resultTrmCandidate
              : currentCycle?.status === 'CLOSED' &&
                Number.isFinite(frozenCycleTrmCandidate) &&
                frozenCycleTrmCandidate > 0
                ? frozenCycleTrmCandidate
                : hasAuthoritativeMarketTrm
                  ? marketTrmCandidate
                  : 0;

        const liveCalc = calculateUserMonthlyResult(
          liveTotalUsd,
          liveTrm,
          currentUser.userPercentage,
          currentUser.adminPercentage
        );

        const displayGrossCop = liveCalc.grossCop;
        const displayUserProfitCop = liveCalc.userProfitCop;
        const displayUserProfitUsd = liveCalc.userProfitUsd;
        const displayAdminCommissionCop = liveCalc.adminCommissionCop;

        const hasActivity = userDailyOps.length > 0 || (userResult && userResult.totalUsdOperated > 0);

        return (
          <div className="space-y-6">
            {!hasActivity ? (
              <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-3 shadow-xl">
                <Clock className="w-12 h-12 mx-auto text-amber-400/80 animate-pulse" />
                <h3 className="text-base font-bold text-slate-200">
                  Sin Operaciones Diarias Registradas Aún en {currentCycle?.name || selectedCycleId}
                </h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                  Tu capital (<strong className="text-slate-200">{formatCOP(currentUser.currentCapital)}</strong>, Categoría <span className="text-blue-400 font-bold">{userCategory}</span>) se encuentra activo en la mesa de operaciones. Tan pronto como la mesa de trading registre las primeras operaciones diarias de tu grupo, se actualizarán tus métricas automáticamente en tiempo real.
                </p>
              </div>
            ) : (
              <div className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-blue-500/40 shadow-2xl space-y-6 relative overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3 flex-wrap gap-2">
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-blue-400 font-mono">
                      {userResult ? 'Liquidación Oficial de Rendimientos' : '⚡ Bitácora y Operación Diaria en Tiempo Real'}
                    </span>
                    <h3 className="text-base sm:text-lg font-black text-slate-100">
                      Período: {currentCycle?.name || selectedCycleId}
                    </h3>
                  </div>
                  {userResult ? (
                    <span className="text-xs px-3 py-1 rounded-full bg-emerald-950 border border-emerald-500/40 text-emerald-300 font-mono font-bold shadow-sm shadow-emerald-500/20">
                      ✓ Liquidado Oficial
                    </span>
                  ) : (
                    <span className="text-xs px-3 py-1 rounded-full bg-blue-950 border border-blue-500/40 text-blue-300 font-mono font-bold shadow-sm shadow-blue-500/20 flex items-center gap-1.5 animate-pulse">
                      <span className="w-2 h-2 rounded-full bg-blue-400" />
                      Ciclo Activo en Tiempo Real
                    </span>
                  )}
                </div>

                {/* Highlights Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Total USD Operado */}
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 shadow-sm">
                    <span className="text-[11px] text-slate-400 uppercase font-semibold">Total USD Operado</span>
                    <p className="text-xl sm:text-2xl font-black text-slate-100 font-mono mt-1">
                      {formatUSD(liveTotalUsd)}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-1">Operaciones acumuladas del grupo</p>
                  </div>

                  {/* TRM Aplicada */}
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 shadow-sm">
                    <span className="text-[11px] text-slate-400 uppercase font-semibold">TRM Período</span>
                    <p className="text-xl sm:text-2xl font-black text-blue-400 font-mono mt-1">
                      {formatTRM(liveTrm)} COP
                    </p>
                    <p className="text-[10px] text-slate-500 mt-1">Tasa de cambio de referencia</p>
                  </div>

                  {/* Total Convertido COP */}
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 shadow-sm">
                    <span className="text-[11px] text-slate-400 uppercase font-semibold">Total Generado (100%)</span>
                    <p className="text-xl sm:text-2xl font-black text-slate-200 font-mono mt-1">
                      {formatCOP(displayGrossCop)}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-1">USD operado × TRM</p>
                  </div>

                  {/* TU GANANCIA NETA */}
                  <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-950/90 to-slate-950 border border-emerald-500/60 shadow-xl shadow-emerald-500/10">
                    <div className="flex items-center justify-between text-emerald-400">
                      <span className="text-[11px] uppercase font-bold tracking-wider">Tu Ganancia Neta</span>
                    </div>
                    <p className="text-xl sm:text-2xl font-black text-emerald-300 font-mono mt-1">
                      {formatCOP(displayUserProfitCop)}
                    </p>
                    <p className="text-[10px] text-emerald-400/90 font-mono mt-1">
                      Equivalente: {formatUSD(displayUserProfitUsd)} USD
                    </p>
                  </div>
                </div>

                {/* Step-by-Step Transparency Roadmap */}
                <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                    <Info className="w-4 h-4 text-blue-400" />
                    Flujo de Liquidación y Transparencia
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono">
                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                      <span className="text-slate-500 text-[10px] uppercase font-bold">1. Operación del Mes</span>
                      <p className="text-slate-100 font-bold">{formatUSD(liveTotalUsd)}</p>
                      <p className="text-[10px] text-slate-400">Total operado en el período</p>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                      <span className="text-slate-500 text-[10px] uppercase font-bold">2. Conversión a COP</span>
                      <p className="text-blue-300 font-bold">{formatCOP(displayGrossCop)}</p>
                      <p className="text-[10px] text-slate-400">TRM: {formatTRM(liveTrm)}</p>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                      <span className="text-slate-500 text-[10px] uppercase font-bold">3. Tu Ganancia</span>
                      <p className="text-emerald-400 font-bold">{formatCOP(displayUserProfitCop)}</p>
                      <p className="text-[10px] text-slate-400">Rendimiento neto acreditado</p>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                      <span className="text-slate-500 text-[10px] uppercase font-bold">4. Comisión de Administración</span>
                      <p className="text-amber-400 font-bold">{formatCOP(displayAdminCommissionCop)}</p>
                      <p className="text-[10px] text-slate-400">Honorarios de administración</p>
                    </div>
                  </div>
                </div>

                {/* Daily Operations Ledger Breakdown */}
                {userDailyOps.length > 0 && (
                  <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-blue-400" />
                        Tus Operaciones de Trading del Ciclo ({userDailyOps.length} trades)
                      </h4>
                      <span className="text-[11px] text-slate-400 font-mono">
                        Total Operado:{' '}
                        <strong className="text-emerald-400">
                          {formatUSD(userDailyOps.reduce((s, o) => s + o.amountUsd, 0))}
                        </strong>
                      </span>
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-slate-800/80">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-slate-900 text-slate-400 text-[10px] uppercase font-mono border-b border-slate-800">
                          <tr>
                            <th className="py-2.5 px-3"># / Fecha</th>
                            <th className="py-2.5 px-3">Operación (USD)</th>
                            <th className="py-2.5 px-3">Equivalente (COP)</th>
                            <th className="py-2.5 px-3">Tu Ganancia Neta ({currentUser.userPercentage || 75}%)</th>
                            <th className="py-2.5 px-3">Notas</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50 font-mono text-[11px]">
                          {userDailyOps.map((op, idx) => {
                            const rawPct = currentUser.userPercentage !== undefined ? currentUser.userPercentage : 75;
                            const userPctRatio = rawPct > 1 ? rawPct / 100 : rawPct;
                            const opProfitCop = op.amountUsd * liveTrm * userPctRatio;
                            const opProfitUsd = op.amountUsd * userPctRatio;

                            return (
                              <tr key={op.id} className="hover:bg-slate-900/40">
                                <td className="py-2 px-3 text-slate-300">
                                  <span className="text-slate-500 mr-1.5">{idx + 1}.</span>
                                  {op.date}
                                </td>
                                <td className="py-2 px-3 font-bold text-emerald-400">
                                  {formatUSD(op.amountUsd)}
                                </td>
                                <td className="py-2 px-3 text-blue-300">
                                  {formatCOP(op.amountUsd * liveTrm)}
                                </td>
                                <td className="py-2 px-3 text-emerald-300 font-bold">
                                  {formatCOP(opProfitCop)}
                                  <span className="block text-[9px] text-emerald-500/80 font-normal">
                                    {formatUSD(opProfitUsd)}
                                  </span>
                                </td>
                                <td className="py-2 px-3 text-slate-400 text-[10px] font-sans italic">
                                  {op.notes || (op.userName ? `Trade para ${op.userName}` : 'Operación de trading diario')}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

          {/* Quick Action Navigation Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => handleTabChange('history')}
              className="p-4 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-blue-500/50 transition cursor-pointer text-left flex items-center justify-between group shadow-lg"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-200">Historial de Ciclos</h4>
                  <p className="text-[11px] text-slate-400">Ver todos tus cierres liquidados</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-blue-400 group-hover:translate-x-1 transition" />
            </button>

            <button
              onClick={() => handleTabChange('reinvestment')}
              className="p-4 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-emerald-500/50 transition cursor-pointer text-left flex items-center justify-between group shadow-lg"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 group-hover:bg-emerald-600 group-hover:text-white transition">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-200">Solicitar Reinversión a Capital</h4>
                  <p className="text-[11px] text-slate-400">Sumar utilidades directamente a tu capital</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 group-hover:translate-x-1 transition" />
            </button>
          </div>
        </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* VIEW 2: HISTORY (Historial de Ciclos) */}
      {/* ========================================================================= */}
      {currentTab === 'history' && (
        <div className="space-y-6">
          {/* Historical Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
              <span className="text-[11px] text-slate-400 uppercase font-semibold">Total Ganancias Acumuladas</span>
              <p className="text-xl sm:text-2xl font-black text-emerald-400 font-mono mt-1">
                {formatCOP(totalAccumulatedProfitCop)}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">En todos los ciclos liquidados</p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
              <span className="text-[11px] text-slate-400 uppercase font-semibold">Total USD Operado</span>
              <p className="text-xl sm:text-2xl font-black text-slate-100 font-mono mt-1">
                {formatUSD(totalAccumulatedUsdOperated)}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">Monto acumulado operado</p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
              <span className="text-[11px] text-slate-400 uppercase font-semibold">Promedio por Ciclo</span>
              <p className="text-xl sm:text-2xl font-black text-blue-400 font-mono mt-1">
                {formatCOP(avgMonthlyProfitCop)}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">Rendimiento neto promedio</p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
              <span className="text-[11px] text-slate-400 uppercase font-semibold">Ciclos Cerrados</span>
              <p className="text-xl sm:text-2xl font-black text-amber-400 font-mono mt-1">
                {allUserHistoricalResults.length}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">Períodos auditados</p>
            </div>
          </div>

          {/* Performance Chart */}
          {userPerformanceData.length > 0 && (
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
              <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <BarChart2 className="w-5 h-5 text-blue-400" />
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">Curva de Rendimiento Histórico</h3>
                    <p className="text-[11px] text-slate-400">Evolución de ganancias mensuales acreditadas</p>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/80 px-2.5 py-1 rounded border border-emerald-500/30">
                  {userPerformanceData.length} CICLOS
                </span>
              </div>

              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={userPerformanceData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="histProfitGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="cycle" stroke="#64748b" fontSize={11} tickLine={false} />
                    <YAxis stroke="#64748b" fontSize={11} tickLine={false} unit="k" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        borderColor: '#334155',
                        borderRadius: '0.75rem',
                        fontSize: '12px',
                      }}
                      formatter={(val: any) => [`$${(val * 1000).toLocaleString('es-CO')} COP`, 'Ganancia']}
                    />
                    <Area
                      type="monotone"
                      dataKey="profitCOP_k"
                      stroke="#10b981"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#histProfitGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Full Historical Cycles List */}
          <div className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-base font-bold text-slate-100">Historial Detallado de Ciclos</h3>
                  <p className="text-xs text-slate-400">Todos los períodos oficiales con registro de TRM y rendimiento</p>
                </div>
              </div>
              <span className="text-xs text-slate-400 font-mono">{allUserHistoricalResults.length} registros</span>
            </div>

            {allUserHistoricalResults.length === 0 ? (
              <div className="p-8 text-center text-slate-500 font-sans text-xs">
                No hay historial de ciclos cerrado aún para este usuario.
              </div>
            ) : (
              <>
                {/* Mobile Cards for History */}
                <div className="block sm:hidden divide-y divide-slate-800/60">
                  {allUserHistoricalResults.map((r) => (
                    <div key={r.id} className="py-3.5 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-100 text-sm">{r.cycleId}</span>
                        <span className="font-mono font-bold text-emerald-400 text-sm">
                          {formatCOP(r.userProfitCop)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                        <span>Operado: {formatUSD(r.totalUsdOperated)}</span>
                        <span>TRM: {formatTRM(r.trmUsed)}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Equivalente: {formatUSD(r.userProfitUsd)} USD</span>
                        <span className="text-emerald-400 font-mono text-[10px]">✓ Liquidado</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop Table for History */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                        <th className="pb-3 px-3">Ciclo</th>
                        <th className="pb-3 px-3">Operado USD</th>
                        <th className="pb-3 px-3">TRM Aplicada</th>
                        <th className="pb-3 px-3">Ganancia COP</th>
                        <th className="pb-3 px-3">Ganancia USD</th>
                        <th className="pb-3 px-3 text-right">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {allUserHistoricalResults.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-950/40 transition">
                          <td className="py-3 px-3 font-bold text-slate-200">{r.cycleId}</td>
                          <td className="py-3 px-3 text-slate-300">{formatUSD(r.totalUsdOperated)}</td>
                          <td className="py-3 px-3 text-slate-400">{formatTRM(r.trmUsed)}</td>
                          <td className="py-3 px-3 font-bold text-emerald-400">{formatCOP(r.userProfitCop)}</td>
                          <td className="py-3 px-3 text-blue-300">{formatUSD(r.userProfitUsd)} USD</td>
                          <td className="py-3 px-3 text-right">
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/30">
                              ✓ Liquidado
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 3: REINVESTMENT & CAPITAL INJECTION (2 MODALITIES) */}
      {/* ========================================================================= */}
      {currentTab === 'reinvestment' && (
        <div className="space-y-6">
          {/* Header Card with Cycle Selection & Rules Notice */}
          <div className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-600/30 to-teal-600/30 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-slate-100">
                    Módulo de Reinversión e Inyección de Capital
                  </h3>
                  <p className="text-xs text-slate-400">
                    Elige entre reinvertir tus ganancias o inyectar capital adicional para el próximo ciclo
                  </p>
                </div>
              </div>

              {/* Cycle Selector */}
              <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 self-start sm:self-auto">
                <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="text-xs text-slate-400 font-semibold">Ciclo:</span>
                <select
                  value={selectedCycleId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedCycleId(val);
                    onSelectCycle?.(val);
                  }}
                  className="bg-transparent text-xs font-mono font-bold text-slate-200 focus:outline-none cursor-pointer"
                >
                  {allCycles.map((c) => (
                    <option key={c.id} value={c.cycleId} className="bg-slate-900 text-slate-100">
                      {c.name || c.cycleId} {c.status === 'CLOSED' ? '(Cerrado)' : '(Activo)'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Financial Overview Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono">
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80">
                <span className="text-slate-400 block text-[11px] font-sans">Capital Actual</span>
                <span className="text-slate-100 font-bold text-sm block mt-0.5">
                  {formatCOP(currentUser.currentCapital)}
                </span>
                <span className="text-[10px] text-blue-400 font-sans block mt-0.5">
                  {capitalEquivalentUsdLabel}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80">
                <span className="text-slate-400 block text-[11px] font-sans">Ganancia {selectedCycleName}</span>
                <span
                  className={`font-bold text-sm block mt-0.5 ${
                    cycleProfitCop > 0
                      ? 'text-emerald-400'
                      : cycleProfitCop < 0
                      ? 'text-red-400'
                      : 'text-slate-300'
                  }`}
                >
                  {formatCOP(cycleProfitCop)}
                </span>
                <span className="text-[10px] text-slate-400 font-sans block mt-0.5">
                  {userResult ? `${formatUSD(userResult.userProfitUsd)} USD` : '$0 USD'}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80">
                <span className="text-slate-400 block text-[11px] font-sans">Ganancia Reinvertible (Múltiplos $1M)</span>
                <span className="text-teal-300 font-bold text-sm block mt-0.5">
                  {formatCOP(reinvestableProfitCop)}
                </span>
                <span className="text-[10px] text-slate-400 font-sans block mt-0.5">
                  Redondeo exacto hacia abajo
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80">
                <span className="text-slate-400 block text-[11px] font-sans">Saldo Restante a Consignar</span>
                <span className="text-slate-200 font-bold text-sm block mt-0.5">
                  {formatCOP(profitRemainderCop)}
                </span>
                <span className="text-[10px] text-emerald-400/90 font-sans block mt-0.5">
                  A transferir a tu cuenta
                </span>
              </div>
            </div>

            {/* Mandatory Business Rule Notice */}
            <div className="p-3.5 rounded-xl bg-blue-950/30 border border-blue-500/30 text-xs text-blue-200/90 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                <strong>Regla de Operación:</strong> Para mantener capitales cerrados, las reinversiones se realizan en millones completos ($1.000.000 COP). Cualquier saldo restante de tus ganancias será consignado a tu cuenta bancaria. Los cambios se aplicarán formalmente al capital del próximo ciclo una vez sean aprobados por la mesa de control.
              </p>
            </div>
          </div>

          {/* Cycle Preparing Alert */}
          {preparingCycleObj && (
            <div className="p-4 sm:p-5 rounded-2xl bg-indigo-950/50 border border-indigo-500/50 text-indigo-200 text-xs space-y-2 shadow-lg animate-pulse mb-4">
              <div className="flex items-center gap-2">
                <Compass className="w-5 h-5 text-indigo-400 shrink-0" />
                <h4 className="font-bold text-indigo-300 text-sm">
                  Ciclo de Preparación Iniciado: {preparingCycleObj.name}
                </h4>
              </div>
              <p className="text-[11px] text-indigo-300/90 leading-relaxed">
                El ciclo operativo activo anterior se ha cerrado y el nuevo ciclo <strong>{preparingCycleObj.name}</strong> está en fase de preparación. Estás visualizando los resultados finales consolidados del ciclo anterior <strong>{previousCycleObj?.name || 'A'}</strong> y el estado de tu solicitud de reinversión/inyección hacia {preparingCycleObj.name}.
              </p>
            </div>
          )}

          {/* Cycle Closing Alert */}
          {isCycleClosing && (
            <div className="p-4 sm:p-5 rounded-2xl bg-amber-950/50 border border-amber-500/50 text-amber-200 text-xs space-y-2 shadow-lg animate-pulse">
              <div className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-amber-400 shrink-0" />
                <h4 className="font-bold text-amber-300 text-sm">
                  Cierre de Ciclo en Proceso ({selectedCycleName})
                </h4>
              </div>
              <p className="text-[11px] text-amber-300/90 leading-relaxed">
                El ciclo se encuentra actualmente en proceso de liquidación y congelamiento formal. La radicación de nuevas solicitudes de reinversión o inyección de capital está bloqueada temporalmente hasta que finalice el proceso de cierre.
              </p>
            </div>
          )}

          {/* Pending Request Alert for Selected Cycle */}
          {pendingRequestForCycle && (
            <div className="p-4 sm:p-5 rounded-2xl bg-amber-950/40 border border-amber-500/50 text-amber-200 text-xs space-y-3 shadow-lg">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-400 shrink-0" />
                <h4 className="font-bold text-amber-300 text-sm">
                  Ya tienes una solicitud pendiente para {selectedCycleName}
                </h4>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950/60 p-3 rounded-xl border border-amber-500/20 font-mono text-[11px]">
                <div>
                  <span className="text-slate-400 block font-sans text-[10px]">Modalidad</span>
                  <span className="text-amber-200 font-bold">
                    {pendingRequestForCycle.modality === 'CAPITAL_INJECTION' ? 'Inyección de Capital' : 'Reinversión de Ganancias'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block font-sans text-[10px]">Aumento Solicitado</span>
                  <span className="text-emerald-400 font-bold">
                    +{formatCOP(pendingRequestForCycle.totalIncreaseCop || pendingRequestForCycle.reinvestAmountCop)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block font-sans text-[10px]">Capital Proyectado</span>
                  <span className="text-slate-200 font-bold">
                    {formatCOP(pendingRequestForCycle.projectedCapitalCop || pendingRequestForCycle.newCapitalTargetCop)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block font-sans text-[10px]">Radicada el</span>
                  <span className="text-slate-300">
                    {new Date(pendingRequestForCycle.createdAt).toLocaleDateString('es-CO')}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-amber-300/80">
                Tu solicitud está siendo revisada por la administración. No es posible radicar una nueva solicitud para este ciclo hasta que sea procesada.
              </p>
            </div>
          )}

          {/* Feedback Messages */}
          {reinvestSuccessMessage && (
            <div className="p-4 rounded-xl bg-emerald-950/70 border border-emerald-500/50 text-emerald-300 text-xs flex items-center gap-3 animate-in fade-in">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span className="font-semibold">{reinvestSuccessMessage}</span>
            </div>
          )}

          {reinvestError && (
            <div className="p-4 rounded-xl bg-red-950/60 border border-red-500/40 text-red-300 text-xs flex items-center gap-3 animate-in fade-in">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
              <span>{reinvestError}</span>
            </div>
          )}

          {/* ========================================================================= */}
          {/* THE 2 MODALITIES CARDS */}
          {/* ========================================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* ------------------------------------------------------------- */}
            {/* MODALITY 1: REINVERSIÓN DE GANANCIAS */}
            {/* ------------------------------------------------------------- */}
            <div className={`p-5 sm:p-6 rounded-2xl bg-slate-900 border transition-all flex flex-col justify-between space-y-5 shadow-xl ${
              reinvestableProfitCop >= 1_000_000
                ? 'border-teal-500/40 hover:border-teal-500/60'
                : 'border-slate-800 opacity-90'
            }`}>
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-teal-950/80 border border-teal-500/40 flex items-center justify-center text-teal-300 shrink-0">
                      <Coins className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-teal-400 block">
                        Modalidad 1
                      </span>
                      <h4 className="text-base font-bold text-slate-100">
                        Reinvertir mis ganancias
                      </h4>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-teal-950 text-teal-300 border border-teal-500/30">
                    Utilidades
                  </span>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  Usa tus ganancias de este ciclo para aumentar tu capital del próximo ciclo. Las reinversiones se realizan en millones completos. El saldo restante será consignado a tu cuenta bancaria.
                </p>

                {/* Condition: If profit < 1M or negative */}
                {reinvestableProfitCop < 1_000_000 ? (
                  <div className="p-4 rounded-xl bg-slate-950/80 border border-amber-500/30 text-amber-300 text-xs space-y-2">
                    <div className="flex items-center gap-2 font-semibold">
                      <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Opción no disponible en este ciclo</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Tus ganancias todavía no alcanzan el mínimo de $1.000.000 COP necesario para reinvertir. Si deseas aumentar tu capital, puedes utilizar la opción de <strong>Inyección de Capital</strong>.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Fast 100% button */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 font-semibold">Monto a reinvertir:</span>
                      <button
                        type="button"
                        onClick={() => setProfitReinvestSelectedCop(reinvestableProfitCop)}
                        className="text-[11px] text-teal-400 hover:text-teal-300 hover:underline font-mono cursor-pointer flex items-center gap-1"
                      >
                        ⚡ Reinvertir máximo disponible ({formatCOP(reinvestableProfitCop)})
                      </button>
                    </div>

                    {/* Step selector for multiples of 1,000,000 */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setProfitReinvestSelectedCop((prev) => Math.max(1_000_000, prev - 1_000_000))}
                          disabled={card1SelectedReinvest <= 1_000_000}
                          className="px-3 py-2 bg-slate-950 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-700 rounded-xl text-slate-200 font-mono font-bold text-sm cursor-pointer"
                        >
                          -$1M
                        </button>
                        <div className="flex-1 text-center py-2 bg-slate-950 border border-slate-700 rounded-xl font-mono font-bold text-teal-300 text-base">
                          {formatCOP(card1SelectedReinvest)}
                        </div>
                        <button
                          type="button"
                          onClick={() => setProfitReinvestSelectedCop((prev) => Math.min(reinvestableProfitCop, prev + 1_000_000))}
                          disabled={card1SelectedReinvest >= reinvestableProfitCop}
                          className="px-3 py-2 bg-slate-950 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-700 rounded-xl text-slate-200 font-mono font-bold text-sm cursor-pointer"
                        >
                          +$1M
                        </button>
                      </div>

                      {/* Quick chips if multiple millions available */}
                      {reinvestableProfitCop > 1_000_000 && (
                        <div className="flex items-center gap-1.5 flex-wrap pt-1">
                          {Array.from({ length: Math.min(6, reinvestableProfitCop / 1_000_000) }, (_, i) => (i + 1) * 1_000_000).map((amt) => (
                            <button
                              key={amt}
                              type="button"
                              onClick={() => setProfitReinvestSelectedCop(amt)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition cursor-pointer ${
                                card1SelectedReinvest === amt
                                  ? 'bg-teal-600 text-white font-bold shadow-md shadow-teal-600/30'
                                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                              }`}
                            >
                              {formatCOP(amt)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Breakdown Box */}
                    <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs font-mono">
                      <div className="flex justify-between text-slate-400">
                        <span>Capital actual:</span>
                        <span className="text-slate-200">{formatCOP(currentUser.currentCapital)}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Ganancia total del ciclo:</span>
                        <span className="text-emerald-400">{formatCOP(cycleProfitCop)}</span>
                      </div>
                      <div className="flex justify-between text-teal-400 font-semibold pt-1 border-t border-slate-800/80">
                        <span>Ganancia que reinvertirás:</span>
                        <span>+{formatCOP(card1SelectedReinvest)}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Saldo restante a consignar:</span>
                        <span className="text-slate-200">{formatCOP(card1ProfitRemainder)}</span>
                      </div>
                      <div className="flex justify-between text-slate-100 font-bold pt-2 border-t border-slate-800">
                        <span>Capital proyectado:</span>
                        <span className="text-emerald-300">{formatCOP(card1ProjectedCapital)}</span>
                      </div>
                      <div className="flex justify-between text-[11px] text-slate-400">
                        <span>Bitácora proyectada:</span>
                        <span className="text-blue-300 font-sans font-bold">{card1ProjectedCategory}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Button */}
              <button
                type="button"
                onClick={handleOpenCard1Modal}
                disabled={reinvestableProfitCop < 1_000_000 || !!pendingRequestForCycle || isCycleClosing || (selectedCycleId !== activeCycle?.cycleId && !isCloseToStartCase)}
                className="w-full py-3 bg-teal-600 hover:bg-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-bold text-xs shadow-lg shadow-teal-600/20 transition cursor-pointer flex items-center justify-center gap-2 mt-4"
              >
                <Coins className="w-4 h-4" />
                <span>
                  {selectedCycleId !== activeCycle?.cycleId && !isCloseToStartCase
                    ? 'Solo Disponible en Ciclo Activo'
                    : isCycleClosing
                    ? 'Cierre en Proceso (Bloqueado)'
                    : 'Solicitar Reinversión de Ganancias'}
                </span>
              </button>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* MODALITY 2: INYECCIÓN DE CAPITAL */}
            {/* ------------------------------------------------------------- */}
            <div className="p-5 sm:p-6 rounded-2xl bg-slate-900 border border-blue-500/40 hover:border-blue-500/60 transition-all flex flex-col justify-between space-y-5 shadow-xl">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-blue-950/80 border border-blue-500/40 flex items-center justify-center text-blue-300 shrink-0">
                      <Wallet className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-blue-400 block">
                        Modalidad 2
                      </span>
                      <h4 className="text-base font-bold text-slate-100">
                        Inyección de capital
                      </h4>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-blue-950 text-blue-300 border border-blue-500/30">
                    Ganancia + Transferencia
                  </span>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  Elige cuánto quieres aumentar tu capital para el próximo ciclo. Primero utilizaremos tus ganancias disponibles y te indicaremos cuánto dinero adicional debes aportar.
                </p>

                {/* Amount selector in multiples of 1,000,000 */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <label className="text-slate-300 font-semibold">
                      ¿Cuánto quieres aumentar tu capital?
                    </label>
                    <span className="text-[11px] text-slate-400 font-mono">
                      Múltiplos de $1.000.000 COP
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDesiredCapitalIncreaseCop((prev) => Math.max(1_000_000, prev - 1_000_000))}
                      disabled={card2DesiredIncrease <= 1_000_000}
                      className="px-3 py-2 bg-slate-950 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-700 rounded-xl text-slate-200 font-mono font-bold text-sm cursor-pointer"
                    >
                      -$1M
                    </button>
                    <div className="flex-1 text-center py-2 bg-slate-950 border border-slate-700 rounded-xl font-mono font-bold text-blue-300 text-base">
                      +{formatCOP(card2DesiredIncrease)}
                    </div>
                    <button
                      type="button"
                      onClick={() => setDesiredCapitalIncreaseCop((prev) => prev + 1_000_000)}
                      className="px-3 py-2 bg-slate-950 hover:bg-slate-800 border border-slate-700 rounded-xl text-slate-200 font-mono font-bold text-sm cursor-pointer"
                    >
                      +$1M
                    </button>
                  </div>

                  {/* Quick Chips for Capital Injection */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setDesiredCapitalIncreaseCop(amt)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition cursor-pointer ${
                          card2DesiredIncrease === amt
                            ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/30'
                            : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                        }`}
                      >
                        +{formatCOP(amt)}
                      </button>
                    ))}
                  </div>

                  {/* Real-time Dynamic Breakdown */}
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs font-mono">
                    <div className="flex justify-between text-slate-400">
                      <span>Ganancia disponible del ciclo:</span>
                      <span className="text-slate-200">{formatCOP(reinvestableProfitCop)}</span>
                    </div>
                    <div className="flex justify-between text-teal-400">
                      <span>Tus ganancias aportan:</span>
                      <span className="font-semibold">{formatCOP(card2ProfitApplied)}</span>
                    </div>
                    <div className="flex justify-between text-blue-300 pt-1 border-t border-slate-800/80">
                      <span className="font-sans font-semibold">Debes transferir (dinero nuevo):</span>
                      <span className="font-bold">{formatCOP(card2CashInjection)}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Recibirás de tus ganancias (a consignar):</span>
                      <span className="text-slate-200">{formatCOP(card2ProfitToDisburse)}</span>
                    </div>
                    <div className="flex justify-between text-slate-100 font-bold pt-2 border-t border-slate-800">
                      <span>Capital proyectado próximo ciclo:</span>
                      <span className="text-emerald-300">{formatCOP(card2ProjectedCapital)}</span>
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>Bitácora proyectada:</span>
                      <span className="text-blue-300 font-sans font-bold">{card2ProjectedCategory}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <button
                type="button"
                onClick={handleOpenCard2Modal}
                disabled={!!pendingRequestForCycle || isCycleClosing || (selectedCycleId !== activeCycle?.cycleId && !isCloseToStartCase)}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-bold text-xs shadow-lg shadow-blue-600/20 transition cursor-pointer flex items-center justify-center gap-2 mt-4"
              >
                <Wallet className="w-4 h-4" />
                <span>
                  {selectedCycleId !== activeCycle?.cycleId && !isCloseToStartCase
                    ? 'Solo Disponible en Ciclo Activo'
                    : isCycleClosing
                    ? 'Cierre en Proceso (Bloqueado)'
                    : 'Solicitar Inyección de Capital'}
                </span>
              </button>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* USER REINVESTMENT REQUESTS HISTORY */}
          {/* ========================================================================= */}
          <div className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FileCheck2 className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-base font-bold text-slate-100">Mis Solicitudes de Reinversión e Inyección</h3>
                  <p className="text-xs text-slate-400">Historial y estado de validación ante la administración</p>
                </div>
              </div>
              <span className="text-xs text-slate-400 font-mono">{userReinvestments.length} solicitudes</span>
            </div>

            {userReinvestments.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                Aún no tienes solicitudes de reinversión radicadas.
              </div>
            ) : (
              <div className="space-y-3">
                {userReinvestments.map((req) => (
                  <div
                    key={req.id}
                    className="p-4 rounded-xl bg-slate-950 border border-slate-800/90 space-y-3 text-xs"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-900 pb-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            req.modality === 'CAPITAL_INJECTION'
                              ? 'bg-blue-950 text-blue-300 border border-blue-500/30'
                              : 'bg-teal-950 text-teal-300 border border-teal-500/30'
                          }`}
                        >
                          {req.modality === 'CAPITAL_INJECTION' ? 'Inyección de Capital' : 'Reinversión de Ganancias'}
                        </span>
                        <span className="font-bold text-slate-200 font-mono text-sm">
                          +{formatCOP(req.totalIncreaseCop || req.reinvestAmountCop)}
                        </span>
                        <span className="text-[11px] text-slate-500 font-mono">
                          • Ciclo: {req.sourceCycleId}
                        </span>
                      </div>

                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono self-start sm:self-auto ${
                          req.status === 'APPROVED'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                            : req.status === 'PENDING'
                            ? 'bg-amber-950 text-amber-300 border border-amber-500/30'
                            : 'bg-red-950 text-red-300 border border-red-500/30'
                        }`}
                      >
                        {req.status === 'APPROVED'
                          ? req.appliedAtCycleClosure ? 'APLICADA EN CIERRE ✓' : 'APROBADA (SE APLICARÁ AL CIERRE)'
                          : req.status === 'PENDING'
                          ? 'PENDIENTE DE APROBACIÓN'
                          : 'RECHAZADA'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-[11px] text-slate-400">
                      <div>
                        <span className="text-[10px] block font-sans text-slate-500">Ganancia Aplicada</span>
                        <span className="text-emerald-400 font-semibold">
                          {formatCOP(req.profitAppliedCop !== undefined ? req.profitAppliedCop : req.reinvestAmountCop)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] block font-sans text-slate-500">Aporte en Efectivo</span>
                        <span className="text-blue-300 font-semibold">
                          {formatCOP(req.cashInjectionCop || 0)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] block font-sans text-slate-500">Saldo a Consignar</span>
                        <span className="text-slate-300">
                          {formatCOP(req.profitToDisburseCop || req.withdrawAmountCop || 0)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] block font-sans text-slate-500">Capital Proyectado</span>
                        <span className="text-slate-100 font-bold">
                          {formatCOP(req.projectedCapitalCop || req.newCapitalTargetCop)}
                        </span>
                      </div>
                    </div>

                    {req.notes && (
                      <p className="text-[10px] text-slate-500 pt-2 border-t border-slate-900">
                        {req.notes}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ========================================================================= */}
          {/* CONFIRMATION MODAL */}
          {/* ========================================================================= */}
          {reinvestModalConfig && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
              <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-5 sm:p-6 space-y-5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                    <h3 className="text-base font-bold text-slate-100">
                      {reinvestModalConfig.modality === 'PROFIT_REINVESTMENT'
                        ? 'Confirmar Reinversión de Ganancias'
                        : 'Confirmar Inyección de Capital'}
                    </h3>
                  </div>
                  <button
                    onClick={() => setReinvestModalConfig(null)}
                    disabled={isSubmittingReinvest}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1 font-mono">
                    <div className="flex justify-between text-slate-400">
                      <span className="font-sans">Inversionista:</span>
                      <span className="text-slate-200 font-bold">{currentUser.fullName} ({currentUser.userCode})</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span className="font-sans">Ciclo de origen:</span>
                      <span className="text-slate-200">{selectedCycleName}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span className="font-sans">Modalidad:</span>
                      <span className="text-teal-300 font-sans font-bold">
                        {reinvestModalConfig.modality === 'PROFIT_REINVESTMENT' ? 'Reinversión de Ganancias' : 'Inyección de Capital'}
                      </span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2 font-mono">
                    <div className="flex justify-between text-slate-400">
                      <span className="font-sans">Capital actual:</span>
                      <span className="text-slate-200">{formatCOP(reinvestModalConfig.currentCapitalSnapshotCop)}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span className="font-sans">Ganancia total del ciclo:</span>
                      <span className="text-emerald-400">{formatCOP(reinvestModalConfig.cycleProfitSnapshotCop)}</span>
                    </div>
                    <div className="flex justify-between text-teal-400 pt-1 border-t border-slate-800">
                      <span className="font-sans">Ganancia aplicada:</span>
                      <span className="font-semibold">{formatCOP(reinvestModalConfig.profitAppliedCop)}</span>
                    </div>
                    {reinvestModalConfig.cashInjectionCop > 0 && (
                      <div className="flex justify-between text-blue-300">
                        <span className="font-sans font-semibold">Dinero nuevo a transferir:</span>
                        <span className="font-bold">{formatCOP(reinvestModalConfig.cashInjectionCop)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-slate-400">
                      <span className="font-sans">Saldo restante a consignar:</span>
                      <span className="text-slate-200">{formatCOP(reinvestModalConfig.profitToDisburseCop)}</span>
                    </div>
                    <div className="flex justify-between text-emerald-300 font-bold pt-2 border-t border-slate-800 text-sm">
                      <span className="font-sans">Aumento total de capital:</span>
                      <span>+{formatCOP(reinvestModalConfig.totalIncreaseCop)}</span>
                    </div>
                    <div className="flex justify-between text-slate-100 font-bold">
                      <span className="font-sans">Capital proyectado próximo ciclo:</span>
                      <span>{formatCOP(reinvestModalConfig.projectedCapitalCop)}</span>
                    </div>
                    <div className="flex justify-between text-blue-300 text-[11px]">
                      <span className="font-sans">Bitácora proyectada:</span>
                      <span className="font-sans font-bold">{reinvestModalConfig.projectedCategory}</span>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-500/30 text-blue-200/90 text-[11px] leading-relaxed">
                    <strong>Importante:</strong> Esta solicitud será procesada formalmente por el administrador. El capital del inversionista no mutará de inmediato; se aplicará oficialmente durante el cierre del ciclo operativo (APPROVED ≠ APPLIED).
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setReinvestModalConfig(null)}
                    disabled={isSubmittingReinvest}
                    className="px-4 py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs font-semibold transition cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmSubmit}
                    disabled={isSubmittingReinvest}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-emerald-600/30 transition cursor-pointer flex items-center gap-2"
                  >
                    {isSubmittingReinvest ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Radicando Solicitud...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Confirmar y Radicar Solicitud</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {currentTab === 'statistics' && (
        <div className="mt-4">
          <StatisticsView />
        </div>
      )}
    </div>
  );
};
