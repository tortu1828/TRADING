import React, { useState, useEffect } from 'react';
import { X, Bell, CheckCircle2, Clock, DollarSign, ArrowRight, ShieldCheck, Smartphone, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dataStore } from '../lib/dataStore';
import { NotificationItem } from '../types';
import {
  getNotificationPermissionState,
  requestNotificationPermission,
  sendBrowserPushNotification,
} from '../lib/pushNotifications';

interface NotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCycle?: (cycleId: string) => void;
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({
  isOpen,
  onClose,
  onSelectCycle,
}) => {
  const { currentUser, isSuperAdmin } = useAuth();
  const [pushStatus, setPushStatus] = useState<NotificationPermission>('default');
  const [isActivatingPush, setIsActivatingPush] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setPushStatus(getNotificationPermissionState());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleEnablePush = async () => {
    setIsActivatingPush(true);
    setPushMsg(null);
    const res = await requestNotificationPermission();
    setIsActivatingPush(false);
    setPushStatus(getNotificationPermissionState());

    if (res.granted) {
      setPushMsg('¡Notificaciones Push activadas con éxito!');
      sendBrowserPushNotification('🔔 Gestor de Capital EasyTraders', {
        body: 'Notificaciones Push vinculadas correctamente a tu dispositivo.',
        icon: '/favicon.png',
      });
      setTimeout(() => setPushMsg(null), 4000);
    } else if (res.error) {
      setPushMsg(res.error);
    }
  };

  const notifications: NotificationItem[] = isSuperAdmin
    ? dataStore.getAllNotifications()
    : currentUser
    ? dataStore.getNotificationsForUser(currentUser.id)
    : [];

  const handleNotificationClick = (notif: NotificationItem) => {
    dataStore.markNotificationAsRead(notif.id);
    if (notif.payload.cycleId && onSelectCycle) {
      onSelectCycle(notif.payload.cycleId);
      onClose();
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
                {isSuperAdmin ? 'Bandeja Global de Notificaciones' : 'Tus Notificaciones'}
              </h3>
              <p className="text-xs text-slate-400">
                {notifications.length} {notifications.length === 1 ? 'notificación' : 'notificaciones'} registradas
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Push Notification Toggle Banner */}
        <div className="mt-4 p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-lg bg-blue-950/80 border border-blue-500/30 text-blue-400 shrink-0">
              <Smartphone className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-200">Notificaciones Push</span>
                {pushStatus === 'granted' ? (
                  <span className="px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> Habilitadas
                  </span>
                ) : (
                  <span className="px-1.5 py-0.2 rounded bg-amber-950 text-amber-400 border border-amber-500/30 text-[10px] font-mono">
                    Desactivadas
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 truncate">
                Recibe avisos inmediatos en tu dispositivo cuando haya nuevos reportes o solicitudes.
              </p>
            </div>
          </div>

          {pushStatus !== 'granted' && (
            <button
              onClick={handleEnablePush}
              disabled={isActivatingPush}
              className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shrink-0 flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isActivatingPush ? 'Activando...' : 'Activar Push'}</span>
            </button>
          )}
        </div>

        {pushMsg && (
          <div className="mt-2 text-center text-xs font-medium text-amber-400 bg-amber-950/40 border border-amber-500/30 p-2 rounded-lg">
            {pushMsg}
          </div>
        )}

        <div className="flex-1 overflow-y-auto my-4 space-y-3 pr-1">
          {notifications.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Bell className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No tienes notificaciones pendientes.</p>
            </div>
          ) : (
            notifications.map((notif) => (
              <div
                key={notif.id}
                onClick={() => handleNotificationClick(notif)}
                className={`p-4 rounded-xl border transition cursor-pointer relative ${
                  notif.isRead
                    ? 'bg-slate-950/40 border-slate-800/80 opacity-80 hover:opacity-100'
                    : 'bg-blue-950/20 border-blue-500/40 shadow-sm shadow-blue-500/5'
                } hover:border-slate-600`}
              >
                {!notif.isRead && (
                  <span className="absolute top-3.5 right-3.5 w-2.5 h-2.5 bg-blue-500 rounded-full animate-pulse" />
                )}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 shrink-0 mt-0.5">
                    {notif.type === 'MONTHLY_CLOSURE' ? (
                      <DollarSign className="w-4 h-4 text-emerald-400" />
                    ) : notif.type === 'REINVESTMENT' ? (
                      <CheckCircle2 className="w-4 h-4 text-blue-400" />
                    ) : (
                      <Clock className="w-4 h-4 text-amber-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="text-xs font-bold text-slate-200">{notif.title}</h4>
                    </div>
                    {isSuperAdmin && notif.userName && (
                      <span className="inline-block text-[10px] text-blue-400 bg-blue-950/60 px-2 py-0.5 rounded font-mono mb-1">
                        Destinatario: {notif.userName} ({notif.userCode})
                      </span>
                    )}
                    <p className="text-xs text-slate-300 leading-relaxed">{notif.message}</p>
                    <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-slate-800/60 text-[11px] text-slate-500">
                      <span>{new Date(notif.sentAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                      <span className="text-blue-400 flex items-center gap-1 hover:underline">
                        Ver detalle <ArrowRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="pt-3 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
