import React, { useState, useEffect } from 'react';
import { Bell, Sparkles, X, ArrowRight, DollarSign } from 'lucide-react';
import { playNotificationAudio } from '../lib/pushNotifications';

interface NotificationToastData {
  title: string;
  body: string;
  applicantName?: string;
  amountCop?: number;
  queuePosition?: number;
  phone?: string;
  city?: string;
  bank?: string;
  type?: string;
}

interface LiveNotificationToastProps {
  onNavigateToTab: (tab: string) => void;
}

export const LiveNotificationToast: React.FC<LiveNotificationToastProps> = ({ onNavigateToTab }) => {
  const [toast, setToast] = useState<NotificationToastData | null>(null);

  useEffect(() => {
    const handleInAppNotification = (e: Event) => {
      const customEvent = e as CustomEvent<NotificationToastData>;
      if (customEvent.detail) {
        setToast(customEvent.detail);
        playNotificationAudio();
      }
    };

    window.addEventListener('easytraders:in-app-notification', handleInAppNotification);
    return () => {
      window.removeEventListener('easytraders:in-app-notification', handleInAppNotification);
    };
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 9000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  if (!toast) return null;

  const getHeaderTitle = () => {
    switch (toast.type) {
      case 'REINVESTMENT':
        return 'Solicitud de Reinversión';
      case 'DAILY_TRADE':
        return 'Operación de Trading';
      case 'MONTHLY_CLOSURE':
        return 'Liquidación Mensual';
      case 'INVESTMENT_REQUEST':
        return 'Nueva Solicitud de Aporte';
      case 'DISBURSEMENT':
        return 'Solicitud de Retiro';
      default:
        return 'Notificación Recibida';
    }
  };

  const getNavigationTab = () => {
    switch (toast.type) {
      case 'REINVESTMENT':
        return 'reinvestments';
      case 'INVESTMENT_REQUEST':
        return 'investor_applications';
      case 'DISBURSEMENT':
        return 'finances';
      case 'DAILY_TRADE':
      case 'MONTHLY_CLOSURE':
        return 'monthly_closure';
      default:
        return null;
    }
  };

  const getButtonLabel = () => {
    switch (toast.type) {
      case 'REINVESTMENT':
        return 'Ver en Reinversiones';
      case 'INVESTMENT_REQUEST':
        return 'Ver en Admisiones';
      case 'DISBURSEMENT':
        return 'Ver en Finanzas';
      case 'DAILY_TRADE':
      case 'MONTHLY_CLOSURE':
        return 'Ver Historial';
      default:
        return 'Ir a Sección';
    }
  };

  const targetTab = getNavigationTab();

  return (
    <div
      id="live-notification-toast"
      role="alert"
      className="fixed top-5 right-5 z-[100] max-w-md w-full bg-slate-900/95 border-2 border-amber-500/80 shadow-2xl shadow-amber-500/20 rounded-2xl p-4.5 backdrop-blur-md text-slate-100 animate-in slide-in-from-top-4 duration-300 pointer-events-auto"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/50 flex items-center justify-center text-amber-400 shrink-0 mt-0.5 animate-pulse">
          <Sparkles className="w-5 h-5" />
        </div>

        <div className="flex-1 min-w-0 pr-1">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[11px] font-bold text-amber-400 tracking-wider uppercase flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5" />{' '}
              {getHeaderTitle()}
            </span>
            <button
              onClick={() => setToast(null)}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
              aria-label="Cerrar notificación"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <h4 className="text-sm font-bold text-white mb-1">
            {toast.title || toast.applicantName || 'Inversionista'}
          </h4>

          {toast.amountCop !== undefined && (
            <div className="my-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 font-mono text-xs font-bold">
              <DollarSign className="w-3.5 h-3.5" />
              <span>${toast.amountCop.toLocaleString('es-CO')} COP</span>
            </div>
          )}

          <p className="text-xs text-slate-300 leading-relaxed mb-3">
            {toast.body}
          </p>

          <div className="flex items-center gap-2">
            {targetTab && (
              <button
                onClick={() => {
                  onNavigateToTab(targetTab);
                  setToast(null);
                }}
                className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-amber-500/20 transition cursor-pointer"
              >
                <span>{getButtonLabel()}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => setToast(null)}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
            >
              Entendido
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
