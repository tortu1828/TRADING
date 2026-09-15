import React, { useState } from 'react';
import {
  Menu,
  DollarSign,
  CalendarDays,
  Bell,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dataStore } from '../lib/dataStore';
import { formatTRM } from '../lib/financialEngine';
import { EditTRMModal } from './EditTRMModal';
import { NotificationsModal } from './NotificationsModal';
import { AutomatedTestSuiteModal } from './AutomatedTestSuiteModal';
import { PWAInstallButton } from './PWAInstallButton';
import { AccessGatewayModal } from './AccessGatewayModal';

import { NotificationPromptBanner } from './NotificationPromptBanner';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onToggleSidebar?: () => void;
  isSidebarCollapsed?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  onToggleSidebar,
  isSidebarCollapsed = false,
}) => {
  const { currentUser, isSuperAdmin } = useAuth();
  const activeCycle = dataStore.getActiveCycle();
  const config = dataStore.getConfig();

  const [showTrmModal, setShowTrmModal] = useState(false);
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [showAccessModal, setShowAccessModal] = useState(false);

  const isAdminUser = isSuperAdmin || currentUser?.role === 'ADMIN';

  const notifications = isAdminUser
    ? dataStore.getAdminNotifications()
    : currentUser
    ? dataStore.getNotificationsForUser(currentUser.id)
    : [];

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  // Human readable title for current section
  const getTabTitle = () => {
    switch (activeTab) {
      case 'monthly_closure':
        return 'Cierre Mensual';
      case 'dashboard':
        return 'Dashboard';
      case 'users':
        return 'Usuarios & Bitácoras';
      case 'applications':
        return 'Admisiones';
      case 'finance':
        return 'Liquidaciones';
      case 'reinvestments':
        return 'Reinversiones a Capital';
      case 'audit':
        return 'Auditoría';
      case 'portal':
        return 'Inicio & Resumen';
      case 'portal_history':
        return 'Historial de Ciclos';
      case 'portal_reinvestment':
        return 'Reinversión a Capital';
      default:
        return 'EasyTraders24';
    }
  };

  return (
    <>
      <header className="sticky top-0 z-30 bg-[#070b13] backdrop-blur-md border-b border-slate-800/80 px-3 sm:px-6 pt-3.5 pb-2.5 transition w-full max-w-full">
        <div className="flex items-center justify-between gap-2 max-w-full">
          {/* Left: Hamburger (mobile) + Active Section Title */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              id="btn-open-sidebar-menu"
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onToggleSidebar) onToggleSidebar();
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                if (onToggleSidebar) onToggleSidebar();
              }}
              className="min-w-[38px] min-h-[38px] px-2 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 active:scale-95 transition shrink-0 cursor-pointer flex items-center justify-center gap-1.5 shadow-sm shadow-amber-500/10 touch-manipulation z-50"
              aria-label="Alternar Menú de Navegación"
              title={isSidebarCollapsed ? 'Expandir menú lateral' : 'Colapsar menú lateral'}
            >
              <Menu className="w-4 h-4 sm:w-5 sm:h-5 text-amber-300 shrink-0" />
              <span className="text-[11px] font-extrabold text-amber-300 sm:hidden">MENÚ</span>
            </button>

            <div className="flex items-center gap-1.5 min-w-0">
              <div className="hidden sm:flex w-2 h-2 rounded-full bg-amber-400 shrink-0" />
              <h1 className="text-xs sm:text-base font-bold text-slate-100 tracking-tight truncate">
                {getTabTitle()}
              </h1>
              {activeTab === 'monthly_closure' && (
                <span className="hidden md:inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 shrink-0">
                  2026
                </span>
              )}
            </div>
          </div>

          {/* Center / Right: TRM, Ciclo & User Switcher */}
          <div className="flex items-center gap-1 sm:gap-2.5 shrink-0">
            {/* TRM Ticker */}
            <button
              onClick={() => isSuperAdmin && setShowTrmModal(true)}
              className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl border text-xs font-mono transition shrink-0 ${
                isSuperAdmin
                  ? 'bg-slate-900/90 border-slate-700/80 hover:border-amber-500/60 text-slate-200 cursor-pointer shadow-sm'
                  : 'bg-slate-900/60 border-slate-800 text-slate-300 cursor-default'
              }`}
              title={
                isSuperAdmin
                  ? `TRM: $${formatTRM(config.trmConfigured)} COP (${config.trmMode === 'AUTOMATIC' ? 'Automática en Vivo' : 'Manual'}). Clic para cambiar.`
                  : 'TRM aplicada para cálculos'
              }
            >
              <div className="flex items-center gap-1">
                {config.trmMode === 'AUTOMATIC' ? (
                  <span className="relative flex h-2 w-2 mr-0.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                ) : (
                  <DollarSign className="w-3 h-3 text-amber-400 shrink-0" />
                )}
                <span className="text-slate-400 hidden md:inline text-[11px]">TRM:</span>
                <span className="font-bold text-slate-100 font-mono text-[11px] sm:text-xs">${formatTRM(config.trmConfigured)}</span>
              </div>
              <span
                className={`text-[8px] sm:text-[9px] uppercase font-bold px-1 py-0.2 rounded hidden sm:inline-block ${
                  config.trmMode === 'AUTOMATIC'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                    : 'bg-amber-950 text-amber-300 border border-amber-500/30'
                }`}
              >
                {config.trmMode === 'AUTOMATIC' ? 'AUTO' : 'MAN'}
              </span>
              {isSuperAdmin && <span className="text-[9px] sm:text-[10px] text-amber-400 hidden xs:inline">✎</span>}
            </button>

            {/* Active Cycle Badge */}
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs">
              <CalendarDays className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-slate-400">Ciclo:</span>
              <span className="font-bold text-slate-100">{activeCycle?.name}</span>
            </div>

            {/* PWA Install Action Button */}
            <PWAInstallButton variant="compact" />

            {/* Notifications Button */}
            <button
              onClick={() => setShowNotifModal(true)}
              className="relative p-1.5 sm:p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 transition cursor-pointer shrink-0"
              title="Bandeja de Notificaciones"
            >
              <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 px-1 sm:px-1.5 py-0.2 sm:py-0.5 bg-amber-500 text-slate-950 font-extrabold rounded-full text-[9px] sm:text-[10px]">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Prominent Banner for requesting push permissions on touch */}
      <NotificationPromptBanner />

      {/* Modals */}
      <EditTRMModal isOpen={showTrmModal} onClose={() => setShowTrmModal(false)} />
      <NotificationsModal
        isOpen={showNotifModal}
        onClose={() => setShowNotifModal(false)}
        onSelectTab={setActiveTab}
      />
      <AutomatedTestSuiteModal isOpen={showTestModal} onClose={() => setShowTestModal(false)} />
      <AccessGatewayModal isOpen={showAccessModal} onClose={() => setShowAccessModal(false)} />
    </>
  );
};
