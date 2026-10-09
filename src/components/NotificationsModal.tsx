import React, { useState, useEffect } from 'react';
import { X, Bell, CheckCircle2, Clock, DollarSign, ArrowRight, ShieldCheck, Smartphone, Sparkles, Trash2, Megaphone } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dataStore } from '../lib/dataStore';
import { firestoreService } from '../lib/firestoreService';
import { NotificationItem } from '../types';
import { PushDiagnosisPanel } from './PushDiagnosisPanel';
import {
  getNotificationPermissionState,
  requestNotificationPermission,
  sendBrowserPushNotification,
  testPushNotification,
  ensurePushRegistration,
} from '../lib/pushNotifications';

interface NotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCycle?: (cycleId: string) => void;
  onSelectTab?: (tab: string) => void;
}

export interface NotificationDestination {
  tab: string;
  cycleId?: string;
}

export function getNotificationDestination(
  notif: NotificationItem,
  isAdmin: boolean
): NotificationDestination | null {
  const cycleId = notif.payload?.cycleId || notif.cycleId || undefined;

  switch (notif.type) {
    case 'DAILY_OPERATION':
    case 'DISBURSEMENT':
    case 'CORRECTION':
      if (!cycleId) return null;
      return {
        tab: isAdmin ? 'monthly_closure' : 'portal',
        cycleId,
      };

    case 'MONTHLY_CLOSURE':
      if (!cycleId) return null;
      return {
        tab: isAdmin ? 'monthly_closure' : 'portal_history',
        cycleId,
      };

    case 'SYSTEM':
      if (!cycleId) return null;
      return {
        tab: isAdmin ? 'monthly_closure' : 'portal',
        cycleId,
      };

    case 'REINVESTMENT':
      if (isAdmin) {
        return { tab: 'reinvestments' };
      } else {
        return {
          tab: 'portal_reinvestment',
          ...(cycleId && { cycleId }),
        };
      }

    case 'INVESTMENT_REQUEST':
      if (isAdmin) {
        return { tab: 'applications' };
      } else {
        return {
          tab: 'portal',
          ...(cycleId && { cycleId }),
        };
      }

    case 'ANNOUNCEMENT':
      return { tab: 'announcements' };

    case 'ADMIN_BROADCAST':
    default:
      return null;
  }
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({
  isOpen,
  onClose,
  onSelectCycle,
  onSelectTab,
}) => {
  const { currentUser, isSuperAdmin } = useAuth();

  // Presentación únicamente: conserva cycleId real y el contenido
  // original almacenado en Firestore.
  const getNotificationDisplayText = (
    value: string,
    notif: any
  ) => {
    const cycleId =
      notif?.payload?.cycleId ||
      notif?.cycleId ||
      '';

    if (!cycleId || !value?.includes(cycleId)) {
      return value;
    }

    const cycle =
      dataStore.getCycleById(cycleId);

    const cycleName =
      cycle?.name?.trim();

    if (!cycleName || cycleName === cycleId) {
      return value;
    }

    return value.split(cycleId).join(cycleName);
  };
  const [pushStatus, setPushStatus] = useState<NotificationPermission>('default');
  const [isActivatingPush, setIsActivatingPush] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [hasConfigError, setHasConfigError] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showConfirmClearAll, setShowConfirmClearAll] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPushStatus(getNotificationPermissionState());
    }
  }, [isOpen]);

  useEffect(() => {
    if (pushStatus === 'granted') {
      const token = localStorage.getItem('gestor_push_fcm_token');
      if (!token) {
        setHasConfigError(true);
      } else {
        setHasConfigError(false);
      }
    } else {
      setHasConfigError(false);
    }
  }, [pushStatus]);

  if (!isOpen) return null;

  const handleEnablePush = async () => {
    setIsActivatingPush(true);
    setPushMsg(null);
    setHasConfigError(false);
    try {
      const res = await requestNotificationPermission();
      setPushStatus(getNotificationPermissionState());
      if (res.granted) {
        if (res.token) {
          setHasConfigError(false);
          setPushMsg('¡Notificaciones Push activadas con éxito!');
          sendBrowserPushNotification('🔔 Gestor de Capital EasyTraders', {
            body: 'Notificaciones Push vinculadas correctamente a tu dispositivo.',
            icon: '/favicon.png',
          });
          setTimeout(() => setPushMsg(null), 4000);
        } else {
          setHasConfigError(true);
        }
      } else if (res.error) {
        setPushMsg(res.error);
        setHasConfigError(true);
      }
    } catch (err) {
      console.error(err);
      setHasConfigError(true);
    } finally {
      setIsActivatingPush(false);
    }
  };

  const handleRetryPush = async () => {
    setIsActivatingPush(true);
    setPushMsg(null);
    setHasConfigError(false);
    try {
      const res = await ensurePushRegistration({ forceRepair: false });
      setPushStatus(getNotificationPermissionState());
      if (res.success && res.token) {
        setHasConfigError(false);
        setPushMsg('¡Notificaciones configuradas exitosamente!');
        setTimeout(() => setPushMsg(null), 4000);
      } else {
        setHasConfigError(true);
        setPushMsg(res.error || 'No se pudo completar el registro en base de datos.');
      }
    } catch (err) {
      console.error(err);
      setHasConfigError(true);
    } finally {
      setIsActivatingPush(false);
    }
  };

  const isAdminUser = isSuperAdmin || currentUser?.role === 'ADMIN';

  const notifications: NotificationItem[] = isAdminUser
    ? dataStore.getAdminNotifications()
    : currentUser
    ? dataStore.getNotificationsForUser(currentUser.id)
    : [];

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const readOwnedCount = notifications.filter((n) => n.isRead && dataStore.isNotificationOwned(n)).length;

  const handleNotificationClick = (notif: NotificationItem) => {
    dataStore.markNotificationAsRead(notif.id);

    if (
      notif.type === 'ANNOUNCEMENT' &&
      notif.payload?.announcementId &&
      currentUser?.uid
    ) {
      const announcementId = String(notif.payload.announcementId);
      void firestoreService.markAnnouncementAsRead(
        announcementId,
        currentUser.uid
      );

      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('tab', 'announcements');
        url.searchParams.set('announcementId', announcementId);
        window.history.replaceState({}, '', url.toString());
      }
    }

    const destination = getNotificationDestination(notif, isAdminUser);
    if (destination) {
      if (destination.cycleId && onSelectCycle) {
        onSelectCycle(destination.cycleId);
      }
      if (onSelectTab) {
        onSelectTab(destination.tab);
      }
      onClose();
    }
  };

  const handleMarkAllRead = async () => {
    const ownedUnreadIds = notifications
      .filter((n) => !n.isRead && dataStore.isNotificationOwned(n))
      .map((n) => n.id);

    const sharedUnread = notifications.filter((n) => !n.isRead && !dataStore.isNotificationOwned(n));

    try {
      if (ownedUnreadIds.length > 0) {
        await dataStore.markAllNotificationsAsRead(ownedUnreadIds);
      }
      for (const n of sharedUnread) {
        await dataStore.markNotificationAsRead(n.id);
      }

      if (currentUser?.uid) {
        const unreadAnnouncements = notifications.filter(
          (n) =>
            !n.isRead &&
            n.type === 'ANNOUNCEMENT' &&
            n.payload?.announcementId
        );

        for (const notif of unreadAnnouncements) {
          await firestoreService.markAnnouncementAsRead(
            String(notif.payload.announcementId),
            currentUser.uid
          );
        }
      }
    } catch (err) {
      console.error('Error al marcar todas como leídas:', err);
    }
  };

  const handleHideNotification = async (notifId: string) => {
    try {
      await dataStore.hideNotification(notifId);
    } catch (err) {
      console.error('Error al ocultar la notificación:', err);
    }
  };

  const handleHideAllRead = async () => {
    const readOwnedIds = notifications
      .filter((n) => n.isRead && dataStore.isNotificationOwned(n))
      .map((n) => n.id);

    if (readOwnedIds.length === 0) return;

    try {
      await dataStore.hideNotificationsBatch(readOwnedIds);
      setShowConfirmClearAll(false);
    } catch (err) {
      console.error('Error al ocultar notificaciones leídas:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative text-slate-100 flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100">
                {isAdminUser ? 'Bandeja de Notificaciones Admin' : 'Tus Notificaciones'}
              </h3>
              <p className="text-xs text-slate-400">
                {notifications.length} {notifications.length === 1 ? 'notificación' : 'notificaciones'} registradas
                {unreadCount > 0 && ` • ${unreadCount} sin leer`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
              >
                Marcar leídas
              </button>
            )}
            {readOwnedCount > 0 && (
              <button
                onClick={() => setShowConfirmClearAll(true)}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/40 text-rose-300 border border-rose-900/30 transition cursor-pointer"
              >
                Borrar leídas
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Push Notification Toggle Banner */}
        {!isSuperAdmin ? (
          <div className="mt-4 p-4 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-3 shadow-lg">
            {hasConfigError && pushStatus === 'granted' ? (
              // State C: Error de Configuración
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
                    <span className="text-xl">⚠️</span>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-amber-200">No pudimos terminar de configurar las notificaciones.</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Ocurrió un inconveniente al registrar tu dispositivo.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleRetryPush}
                  disabled={isActivatingPush}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shrink-0 transition flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/10 cursor-pointer disabled:opacity-50"
                >
                  <span>{isActivatingPush ? 'Configurando...' : 'Reintentar'}</span>
                </button>
              </div>
            ) : pushStatus === 'granted' ? (
              // State A: Activado
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                  <span className="text-lg">🔔</span>
                </div>
                <div>
                  <p className="text-xs font-bold text-emerald-400">Notificaciones activadas</p>
                  <p className="text-[11px] text-slate-300 mt-0.5">
                    Recibirás avisos sobre nuevas operaciones, resultados y novedades importantes.
                  </p>
                </div>
              </div>
            ) : (
              // State B: Sin Permiso
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
                    <span className="text-lg">🔔</span>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-100">Activa las notificaciones</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Mantente informado sobre tus operaciones y resultados.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleEnablePush}
                  disabled={isActivatingPush}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shrink-0 transition flex items-center justify-center gap-1.5 shadow-md shadow-blue-600/20 cursor-pointer disabled:opacity-50"
                >
                  <span>{isActivatingPush ? 'Activando...' : 'Activar notificaciones'}</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-lg bg-blue-950/80 border border-blue-500/30 text-blue-400 shrink-0">
                  <Smartphone className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-bold text-slate-200">Notificaciones en tu Dispositivo</span>
                    {pushStatus === 'granted' ? (
                      <span className="px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3" /> Habilitadas
                      </span>
                    ) : pushStatus === 'denied' ? (
                      <span className="px-1.5 py-0.2 rounded bg-rose-950 text-rose-400 border border-rose-500/30 text-[10px] font-mono">
                        Bloqueadas por el Sistema
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.2 rounded bg-amber-950 text-amber-400 border border-amber-500/30 text-[10px] font-mono">
                        Desactivadas
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 truncate">
                    Alertas y sonidos inmediatos al recibir solicitudes de admisión o novedades.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {pushStatus === 'granted' ? (
                  <button
                    onClick={() => {
                      testPushNotification();
                      setPushMsg('🔔 Notificación y sonido de prueba emitidos');
                      setTimeout(() => setPushMsg(null), 3500);
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-[11px] flex items-center gap-1.5 transition cursor-pointer"
                    title="Probar sonido y notificación"
                  >
                    <Bell className="w-3 h-3 text-amber-400" />
                    <span>Probar</span>
                  </button>
                ) : (
                  <button
                    onClick={handleEnablePush}
                    disabled={isActivatingPush}
                    className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{isActivatingPush ? 'Activando...' : 'Activar'}</span>
                  </button>
                )}
              </div>
            </div>

            {pushStatus === 'denied' && (
              <div className="p-2.5 rounded-lg bg-rose-950/30 border border-rose-500/30 text-[11px] text-rose-200 leading-relaxed">
                <strong className="text-rose-300">¿Cómo activarlas en Mac / PWA?:</strong> Ve a <em>Ajustes del Sistema de macOS &gt; Notificaciones &gt; Gestor de Capital (o Safari / Google Chrome)</em> y activa "Permitir notificaciones". Luego recarga la app.
              </div>
            )}
          </div>
        )}

        {pushMsg && (
          <div className="mt-2 text-center text-xs font-medium text-amber-400 bg-amber-950/40 border border-amber-500/30 p-2 rounded-lg">
            {pushMsg}
          </div>
        )}

        {(isSuperAdmin && showDiagnostics) ? (
          <div className="flex-1 overflow-y-auto my-4 space-y-3 pr-1">
            <PushDiagnosisPanel />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto my-4 space-y-3 pr-1">
            {notifications.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <Bell className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No tienes notificaciones pendientes.</p>
              </div>
            ) : (
              notifications.map((notif) => {
                const isAdmission = notif.type === 'INVESTMENT_REQUEST';
                const dest = getNotificationDestination(notif, isAdminUser);
                return (
                  <div
                    key={notif.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleNotificationClick(notif)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleNotificationClick(notif);
                      }
                    }}
                    className={`p-4 rounded-xl border transition cursor-pointer relative ${
                      notif.isRead
                        ? 'bg-slate-950/40 border-slate-800/80 opacity-80 hover:opacity-100'
                        : isAdmission
                        ? 'bg-amber-950/20 border-amber-500/50 shadow-sm shadow-amber-500/5'
                        : 'bg-blue-950/20 border-blue-500/40 shadow-sm shadow-blue-500/5'
                    } hover:border-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50`}
                  >
                    {!notif.isRead && (
                      <span
                        className={`absolute top-3.5 right-3.5 w-2.5 h-2.5 rounded-full animate-pulse ${
                          isAdmission ? 'bg-amber-400' : 'bg-blue-500'
                        }`}
                      />
                    )}
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${
                          isAdmission
                            ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                            : notif.type === 'MONTHLY_CLOSURE'
                            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                            : notif.type === 'REINVESTMENT'
                            ? 'bg-blue-500/20 border-blue-500/40 text-blue-400'
                            : notif.type === 'ANNOUNCEMENT'
                            ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                            : notif.type === 'ADMIN_BROADCAST'
                            ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400'
                            : 'bg-slate-800 border-slate-700 text-slate-300'
                        }`}
                      >
                        {isAdmission ? (
                          <Sparkles className="w-4 h-4" />
                        ) : notif.type === 'MONTHLY_CLOSURE' ? (
                          <DollarSign className="w-4 h-4" />
                        ) : notif.type === 'REINVESTMENT' ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : notif.type === 'ANNOUNCEMENT' ? (
                          <Megaphone className="w-4 h-4" />
                        ) : notif.type === 'ADMIN_BROADCAST' ? (
                          <Bell className="w-4 h-4" />
                        ) : (
                          <Clock className="w-4 h-4" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h4 className="text-xs font-bold text-slate-100">{getNotificationDisplayText(notif.title, notif)}</h4>
                          {isAdmission && (
                            <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-medium border border-amber-500/30">
                              Admisión
                            </span>
                          )}
                          {notif.type === 'ANNOUNCEMENT' && (
                            <span className="text-[10px] bg-violet-500/20 text-violet-300 px-2.5 py-0.5 rounded-full font-medium border border-violet-500/30">
                              Comunicado
                            </span>
                          )}
                          {notif.type === 'ADMIN_BROADCAST' && (
                            <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2.5 py-0.5 rounded-full font-medium border border-indigo-500/30">
                              Global 📢
                            </span>
                          )}
                        </div>

                        {notif.payload?.copAmount ? (
                          <div className="my-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/90 border border-slate-800 text-emerald-400 font-mono text-xs font-semibold">
                            <span>Monto:</span>
                            <span>${notif.payload.copAmount.toLocaleString('es-CO')} COP</span>
                          </div>
                        ) : null}

                        <p className="text-xs text-slate-300 leading-relaxed mt-1">{getNotificationDisplayText(notif.message, notif)}</p>
                        
                        <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-t-slate-800/60 text-[11px] text-slate-500">
                          <span>{new Date(notif.sentAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                          {dest !== null && (
                            <span className="text-amber-400 flex items-center gap-1 hover:underline font-medium pointer-events-none">
                              {notif.type === 'INVESTMENT_REQUEST' && isAdminUser
                                ? 'Ir a Admisiones'
                                : notif.type === 'ANNOUNCEMENT'
                                ? 'Leer comunicado'
                                : 'Ver detalle'} <ArrowRight className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {dataStore.isNotificationOwned(notif) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(notif.id);
                        }}
                        className="absolute bottom-3 right-3 p-1.5 rounded bg-slate-900/60 hover:bg-rose-950/80 hover:text-rose-400 text-slate-500 border border-slate-800 hover:border-rose-900/50 transition cursor-pointer"
                        title="Eliminar de mi bandeja"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {confirmDeleteId === notif.id && (
                      <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-3 rounded-xl z-10 border border-slate-700/50 animate-in fade-in duration-150">
                        <p className="text-xs font-bold text-slate-200 text-center mb-2">¿Seguro que deseas eliminar esta notificación de tu bandeja?</p>
                        <div className="flex items-center gap-2.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleHideNotification(notif.id);
                              setConfirmDeleteId(null);
                            }}
                            className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] rounded transition cursor-pointer"
                          >
                            Eliminar
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(null);
                            }}
                            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-[11px] rounded border border-slate-700 transition cursor-pointer"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        <div className="pt-3 border-t border-slate-800 flex justify-between items-center">
          {isSuperAdmin ? (
            <button
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              className="px-3.5 py-2 text-xs font-semibold text-amber-400 hover:text-amber-300 bg-slate-900 border border-slate-800 hover:border-amber-500/30 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>{showDiagnostics ? 'Ver Notificaciones' : '🛠️ Diagnóstico Avanzado'}</span>
            </button>
          ) : (
            <div />
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition"
          >
            Cerrar
          </button>
        </div>

        {showConfirmClearAll && (
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-xs flex items-center justify-center p-6 rounded-2xl z-25 animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-sm w-full shadow-2xl text-center">
              <span className="text-3xl mb-2.5 block">🗑️</span>
              <h4 className="text-sm font-bold text-slate-100 mb-1">¿Borrar todas las notificaciones leídas?</h4>
              <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                Esta acción ocultará de tu bandeja de entrada todas tus notificaciones que ya han sido leídas. Podrás seguir operando con normalidad.
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={handleHideAllRead}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-lg transition cursor-pointer"
                >
                  Confirmar Borrado
                </button>
                <button
                  onClick={() => setShowConfirmClearAll(false)}
                  className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-lg transition cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
