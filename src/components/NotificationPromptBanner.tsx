import React, { useState, useEffect } from 'react';
import { Bell, Sparkles, X, ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  getNotificationPermissionState,
  requestNotificationPermission,
  sendBrowserPushNotification,
} from '../lib/pushNotifications';

export const NotificationPromptBanner: React.FC = () => {
  const { currentUser } = useAuth();
  const [permissionState, setPermissionState] = useState<NotificationPermission>('granted');
  const [isVisible, setIsVisible] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  useEffect(() => {
    // Si no hay usuario activo o es administrador, no hacer sondeo
    if (!currentUser || currentUser.role !== 'USER') {
      setIsVisible(false);
      return;
    }

    const checkState = () => {
      const state = getNotificationPermissionState();
      setPermissionState(state);
      // Show banner if permission is default (not yet answered) and user hasn't dismissed it in this session
      if (state === 'default' && !sessionStorage.getItem('notif_banner_dismissed')) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };

    checkState();
    // Check every 2 seconds in case permission state changes
    const interval = setInterval(checkState, 2000);
    return () => clearInterval(interval);
  }, [currentUser]);

  // REGLA ESTRICTA: Solo las personas que ya tienen usuario en la app pueden activar notificaciones
  // Visitantes recién llegados y aspirantes que soliciten entrar NO ven este banner
  if (!currentUser || currentUser.role !== 'USER' || !isVisible || permissionState !== 'default') {
    return null;
  }

  const handleEnableNotifications = async () => {
    setIsActivating(true);
    setFeedbackMsg(null);
    try {
      const res = await requestNotificationPermission();
      setIsActivating(false);
      const newState = getNotificationPermissionState();
      setPermissionState(newState);

      if (res.granted) {
        setFeedbackMsg('¡Notificaciones activadas con éxito!');
        sendBrowserPushNotification('🔔 Notificaciones Activadas', {
          body: 'Recibirás avisos instantáneos cuando se cierren ciclos o haya novedades.',
          icon: '/favicon.png',
        });
        setTimeout(() => {
          setIsVisible(false);
        }, 2000);
      } else if (res.error) {
        setFeedbackMsg(res.error);
      } else {
        setIsVisible(false);
      }
    } catch (err: any) {
      setIsActivating(false);
      setFeedbackMsg(err.message || 'No se pudo activar el permiso.');
    }
  };

  const handleDismiss = () => {
    sessionStorage.setItem('notif_banner_dismissed', 'true');
    setIsVisible(false);
  };

  return (
    <div className="bg-gradient-to-r from-amber-950/90 via-slate-900 to-amber-950/90 border-b border-amber-500/40 px-3.5 py-2.5 sm:px-6 shadow-lg relative z-20 animate-in slide-in-from-top duration-300">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2.5">
        <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
          <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0 animate-bounce">
            <Bell className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-amber-200">Activa tus Notificaciones Push</span>
              <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded font-mono">
                Recomendado
              </span>
            </div>
            <p className="text-[11px] text-slate-300 truncate">
              Toca para recibir avisos en tiempo real sobre tus cierres de ciclo y liquidaciones.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
          {feedbackMsg ? (
            <span className="text-xs font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-500/30 px-3 py-1.5 rounded-xl">
              {feedbackMsg}
            </span>
          ) : (
            <>
              <button
                onClick={handleEnableNotifications}
                disabled={isActivating}
                className="flex-1 sm:flex-initial px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-extrabold text-xs shadow-md shadow-amber-500/20 flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5 fill-slate-950" />
                <span>{isActivating ? 'Solicitando...' : 'Activar Notificaciones'}</span>
              </button>
              <button
                onClick={handleDismiss}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition cursor-pointer"
                title="Cerrar aviso"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
