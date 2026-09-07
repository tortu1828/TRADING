import React from 'react';
import {
  Table2,
  Home,
  Users,
  SlidersHorizontal,
  TrendingUp,
  RotateCcw,
  Bell,
  FileText,
  Shield,
  Settings,
  ChevronRight,
  User,
  ArrowLeftRight,
  Sparkles,
  Calendar,
  HelpCircle,
  X,
  Wallet,
  UserCheck,
  LogOut,
} from 'lucide-react';
import { EasyTradersLogo } from './EasyTradersLogo';
import { useAuth } from '../context/AuthContext';
import { dataStore } from '../lib/dataStore';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenNotifications?: () => void;
  onOpenSettings?: () => void;
  onOpenReports?: () => void;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  onOpenNotifications,
  onOpenSettings,
  onOpenReports,
  isOpenMobile = false,
  onCloseMobile,
}) => {
  const { currentUser, isSuperAdmin, switchToAdmin, switchUser, allUsers, logout } = useAuth();
  const [showSwitchMenu, setShowSwitchMenu] = React.useState(false);

  const notifications = isSuperAdmin
    ? dataStore.getAllNotifications()
    : currentUser
    ? dataStore.getNotificationsForUser(currentUser.id)
    : [];
  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const pendingAppsCount = dataStore.getPendingApplications().length;

  const handleNavClick = (tabKey: string) => {
    if (tabKey === 'notifications') {
      if (onOpenNotifications) onOpenNotifications();
      return;
    }
    if (tabKey === 'settings') {
      if (onOpenSettings) onOpenSettings();
      return;
    }
    if (tabKey === 'reports') {
      if (onOpenReports) onOpenReports();
      return;
    }

    setActiveTab(tabKey);
    if (onCloseMobile) onCloseMobile();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden transition-opacity"
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-[#070b13] border-r border-slate-800/80
          flex flex-col justify-between transition-transform duration-300 ease-in-out
          ${isOpenMobile ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Top Branding Header */}
        <div className="px-5 pt-5 pb-4 border-b border-slate-800/60 flex items-center justify-between">
          <EasyTradersLogo variant={isSuperAdmin ? 'admin' : 'portal'} />
          {isOpenMobile && (
            <button
              onClick={onCloseMobile}
              className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Navigation List matching exact order and design from uploaded image */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-4 space-y-1.5 custom-scrollbar overscroll-contain touch-pan-y">
          {isSuperAdmin ? (
            /* ================= ADMIN NAVIGATION ================= */
            <>
              {/* 1. Cierre Mensual (Active highlighted gold in screenshot) */}
              <button
                onClick={() => handleNavClick('monthly_closure')}
                className={`w-full flex items-center gap-3.5 px-3.5 py-3 rounded-2xl text-sm font-semibold transition text-left cursor-pointer ${
                  activeTab === 'monthly_closure'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg shadow-amber-950/40'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/50 border border-transparent'
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-lg flex items-center justify-center ${
                    activeTab === 'monthly_closure'
                      ? 'text-amber-400 bg-amber-500/20 border border-amber-500/40'
                      : 'text-slate-400'
                  }`}
                >
                  <Table2 className="w-4 h-4" />
                </div>
                <span className="flex-1 tracking-wide">Cierre Mensual</span>
              </button>

              {/* 2. Dashboard */}
              <button
                onClick={() => handleNavClick('dashboard')}
                className={`w-full flex items-center gap-3.5 px-3.5 py-3 rounded-2xl text-sm font-semibold transition text-left cursor-pointer ${
                  activeTab === 'dashboard'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/50 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-slate-400">
                  <Home className="w-4 h-4" />
                </div>
                <span>Dashboard</span>
              </button>

              {/* 3. Usuarios */}
              <button
                onClick={() => handleNavClick('users')}
                className={`w-full flex items-center gap-3.5 px-3.5 py-3 rounded-2xl text-sm font-semibold transition text-left cursor-pointer ${
                  activeTab === 'users'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/50 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-slate-400">
                  <Users className="w-4 h-4" />
                </div>
                <span>Usuarios</span>
              </button>

              {/* 3.1 Admisiones FIFO (Cola de Solicitudes) */}
              <button
                onClick={() => handleNavClick('applications')}
                className={`w-full flex items-center justify-between px-3.5 py-3 rounded-2xl text-sm font-semibold transition text-left cursor-pointer ${
                  activeTab === 'applications'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/50 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-6 h-6 flex items-center justify-center text-amber-400">
                    <UserCheck className="w-4 h-4" />
                  </div>
                  <span>Admisiones Normal</span>
                </div>
                {pendingAppsCount > 0 && (
                  <span className="bg-amber-500 text-slate-950 text-[10px] font-mono font-extrabold px-2 py-0.5 rounded-full shadow-sm shadow-amber-500/20">
                    {pendingAppsCount}
                  </span>
                )}
              </button>

              {/* 4. Bitácoras (with blue 'Nuevo' badge) */}
              <button
                onClick={() => handleNavClick('monthly_closure')}
                className="w-full flex items-center justify-between px-3.5 py-3 rounded-2xl text-sm font-semibold text-slate-400 hover:text-slate-100 hover:bg-slate-900/50 transition text-left cursor-pointer border border-transparent"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-6 h-6 flex items-center justify-center text-slate-400">
                    <SlidersHorizontal className="w-4 h-4" />
                  </div>
                  <span>Bitácoras</span>
                </div>
                <span className="bg-[#1c64ec] text-white text-[11px] font-bold px-2.5 py-0.5 rounded-full shadow-sm shadow-blue-600/30">
                  Nuevo
                </span>
              </button>

              {/* 5. Liquidaciones */}
              <button
                onClick={() => handleNavClick('finance')}
                className={`w-full flex items-center gap-3.5 px-3.5 py-3 rounded-2xl text-sm font-semibold transition text-left cursor-pointer ${
                  activeTab === 'finance'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/50 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-slate-400">
                  <TrendingUp className="w-4 h-4" />
                </div>
                <span>Liquidaciones</span>
              </button>

              {/* 6. Reinversiones */}
              <button
                onClick={() => handleNavClick('reinvestments')}
                className={`w-full flex items-center gap-3.5 px-3.5 py-3 rounded-2xl text-sm font-semibold transition text-left cursor-pointer ${
                  activeTab === 'reinvestments'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/50 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-slate-400">
                  <RotateCcw className="w-4 h-4" />
                </div>
                <span>Reinversiones</span>
              </button>

              {/* 7. Reportes */}
              <button
                onClick={() => handleNavClick('reports')}
                className="w-full flex items-center gap-3.5 px-3.5 py-3 rounded-2xl text-sm font-semibold text-slate-400 hover:text-slate-100 hover:bg-slate-900/50 transition text-left cursor-pointer border border-transparent"
              >
                <div className="w-6 h-6 flex items-center justify-center text-slate-400">
                  <FileText className="w-4 h-4" />
                </div>
                <span>Reportes</span>
              </button>

              {/* 9. Auditoría */}
              <button
                onClick={() => handleNavClick('audit')}
                className={`w-full flex items-center gap-3.5 px-3.5 py-3 rounded-2xl text-sm font-semibold transition text-left cursor-pointer ${
                  activeTab === 'audit'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/50 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-slate-400">
                  <Shield className="w-4 h-4" />
                </div>
                <span>Auditoría</span>
              </button>

              {/* 10. Configuración */}
              <button
                onClick={() => handleNavClick('settings')}
                className="w-full flex items-center justify-between px-3.5 py-3 rounded-2xl text-sm font-semibold text-slate-400 hover:text-slate-100 hover:bg-slate-900/50 transition text-left cursor-pointer border border-transparent"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-6 h-6 flex items-center justify-center text-slate-400">
                    <Settings className="w-4 h-4" />
                  </div>
                  <span>Configuración TRM</span>
                </div>
                <span
                  className={`text-[9px] uppercase font-mono px-2 py-0.5 rounded-full font-bold border ${
                    dataStore.getConfig().trmMode === 'AUTOMATIC'
                      ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300'
                      : 'bg-amber-950/80 border-amber-500/40 text-amber-300'
                  }`}
                >
                  {dataStore.getConfig().trmMode === 'AUTOMATIC' ? 'AUTO' : 'MANUAL'}
                </span>
              </button>
            </>
          ) : (
            /* ================= USER / INVESTOR NAVIGATION ================= */
            <>
              {/* 1. Inicio & Resumen */}
              <button
                onClick={() => handleNavClick('portal')}
                className={`w-full flex items-center gap-3.5 px-3.5 py-3 rounded-2xl text-sm font-semibold transition text-left cursor-pointer ${
                  activeTab === 'portal'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/50 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-amber-400">
                  <Home className="w-4 h-4" />
                </div>
                <span>Inicio & Resumen</span>
              </button>

              {/* 2. Historial de Ciclos */}
              <button
                onClick={() => handleNavClick('portal_history')}
                className={`w-full flex items-center gap-3.5 px-3.5 py-3 rounded-2xl text-sm font-semibold transition text-left cursor-pointer ${
                  activeTab === 'portal_history'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/50 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-blue-400">
                  <Calendar className="w-4 h-4" />
                </div>
                <span>Historial de Ciclos</span>
              </button>

              {/* 3. Reinversión */}
              <button
                onClick={() => handleNavClick('portal_reinvestment')}
                className={`w-full flex items-center gap-3.5 px-3.5 py-3 rounded-2xl text-sm font-semibold transition text-left cursor-pointer ${
                  activeTab === 'portal_reinvestment'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/50 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-emerald-400">
                  <RotateCcw className="w-4 h-4" />
                </div>
                <span>Reinversión</span>
              </button>

              {/* 4. Retiros */}
              <button
                onClick={() => handleNavClick('portal_withdrawals')}
                className={`w-full flex items-center gap-3.5 px-3.5 py-3 rounded-2xl text-sm font-semibold transition text-left cursor-pointer ${
                  activeTab === 'portal_withdrawals'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/50 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-amber-400">
                  <Wallet className="w-4 h-4" />
                </div>
                <span>Retiros</span>
              </button>

              {/* 5. Notificaciones */}
              <button
                onClick={() => handleNavClick('notifications')}
                className="w-full flex items-center justify-between px-3.5 py-3 rounded-2xl text-sm font-semibold text-slate-400 hover:text-slate-100 hover:bg-slate-900/50 transition text-left cursor-pointer"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-6 h-6 flex items-center justify-center text-slate-400">
                    <Bell className="w-4 h-4" />
                  </div>
                  <span>Notificaciones</span>
                </div>
                {unreadCount > 0 && (
                  <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-mono font-bold flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>
            </>
          )}
        </div>

        {/* Bottom Profile Footer from Screenshot */}
        <div className="p-3 border-t border-slate-800/80 bg-[#060a12] relative">
          <button
            onClick={() => setShowSwitchMenu(!showSwitchMenu)}
            className="w-full flex items-center justify-between p-2 rounded-2xl bg-[#0a0f19] border border-slate-800/90 hover:border-slate-700 transition cursor-pointer text-left group"
            title="Haz clic para cambiar entre Administrador e Inversionistas"
          >
            <div className="flex items-center gap-3 min-w-0">
              {/* Gold User Icon with Green online indicator dot */}
              <div className="relative shrink-0">
                <div className="w-10 h-10 rounded-xl bg-[#171308] border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-sm">
                  <User className="w-5 h-5" />
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0a0f19]" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-100 truncate group-hover:text-white transition">
                  {isSuperAdmin ? (currentUser?.fullName || 'Juan Esteban') : currentUser?.fullName || 'Inversionista'}
                </p>
                <p className="text-xs text-slate-400 truncate">
                  {isSuperAdmin ? (currentUser?.email || 'juanes9802@gmail.com') : currentUser?.email || 'usuario@easytraders.com'}
                </p>
              </div>
            </div>

            {/* Bright Green Chevron from Mockup */}
            <ChevronRight className="w-4 h-4 text-emerald-400 shrink-0 stroke-[2.5] group-hover:translate-x-0.5 transition-transform" />
          </button>

          {/* Profile Switcher Popover */}
          {showSwitchMenu && (
            <div className="absolute bottom-20 left-3 right-3 bg-slate-900 border border-slate-800 rounded-2xl p-3 shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-2 duration-150">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-xs">
                <span className="font-bold text-slate-200 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-blue-400" />
                  {isSuperAdmin ? 'Cambiar Rol / Simular Sesión' : 'Mi Cuenta Inversionista'}
                </span>
                <button
                  onClick={() => setShowSwitchMenu(false)}
                  className="text-slate-400 hover:text-slate-200 p-1 text-xs font-bold"
                >
                  ✕
                </button>
              </div>

              {isSuperAdmin ? (
                <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                  {/* Option 1: Panel Administrador */}
                  <button
                    onClick={() => {
                      switchToAdmin();
                      setActiveTab('monthly_closure');
                      setShowSwitchMenu(false);
                    }}
                    className={`w-full p-2.5 rounded-xl text-left text-xs font-bold transition flex items-center gap-2.5 ${
                      isSuperAdmin
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div className="w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 text-xs">
                      👑
                    </div>
                    <div className="flex-1">
                      <p className="leading-none text-slate-100">Panel Administrador</p>
                      <span className="text-[10px] text-slate-400 font-normal">{currentUser?.email || 'juanes9802@gmail.com'}</span>
                    </div>
                  </button>

                  <div className="px-2 pt-2 pb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    Simular Vista Inversionista
                  </div>

                  {/* Investors */}
                  {allUsers
                    .filter((u) => u.role === 'USER')
                    .slice(0, 5)
                    .map((u) => (
                      <button
                        key={u.id}
                        onClick={() => {
                          switchUser(u.id);
                          setActiveTab('portal');
                          setShowSwitchMenu(false);
                        }}
                        className={`w-full p-2 rounded-xl text-left text-xs font-medium transition flex items-center gap-2.5 ${
                          currentUser?.id === u.id
                            ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40'
                            : 'text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <div className="w-6 h-6 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 text-xs font-bold">
                          {u.fullName.charAt(0)}
                        </div>
                        <div className="truncate flex-1">
                          <p className="leading-none truncate text-slate-200">{u.fullName}</p>
                          <span className="text-[10px] text-slate-400 font-mono font-normal">
                            {u.userCode} • {u.category}
                          </span>
                        </div>
                      </button>
                    ))}
                </div>
              ) : (
                <div className="space-y-2 text-xs p-1">
                  <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                    <p className="font-bold text-slate-100">{currentUser?.fullName}</p>
                    <p className="text-[11px] text-slate-400">{currentUser?.email}</p>
                    <span className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-500/30">
                      Rol: Inversionista ({currentUser?.userCode || 'CÓDIGO'})
                    </span>
                  </div>
                </div>
              )}

              {/* Logout button */}
              <div className="pt-2 mt-2 border-t border-slate-800">
                <button
                  onClick={async () => {
                    setShowSwitchMenu(false);
                    await logout();
                  }}
                  className="w-full p-2 rounded-xl text-left text-xs font-semibold text-red-400 hover:bg-red-950/40 hover:text-red-300 transition flex items-center gap-2 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5 text-red-400" />
                  <span>Cerrar Sesión</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};

