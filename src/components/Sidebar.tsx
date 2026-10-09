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
  ChevronLeft,
  User,
  ArrowLeftRight,
  Sparkles,
  Calendar,
  HelpCircle,
  X,
  Wallet,
  UserCheck,
  LogOut,
  BarChart3,
  LifeBuoy,
  Megaphone,
} from 'lucide-react';
import { EasyTradersLogo } from './EasyTradersLogo';
import { useAuth } from '../context/AuthContext';
import { dataStore } from '../lib/dataStore';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenNotifications?: () => void;
  onOpenSettings?: () => void;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  onOpenNotifications,
  onOpenSettings,
  isOpenMobile = false,
  onCloseMobile,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const { currentUser, isSuperAdmin, isSupportAgent, logout } = useAuth();
  const [showSwitchMenu, setShowSwitchMenu] = React.useState(false);
  const [, forceStoreRefresh] = React.useReducer((value: number) => value + 1, 0);

  React.useEffect(() => dataStore.subscribe(forceStoreRefresh), []);

  const isAdminUser = isSuperAdmin || currentUser?.role === 'ADMIN';
  const notifications = isAdminUser
    ? dataStore.getAdminNotifications()
    : currentUser
    ? dataStore.getNotificationsForUser(currentUser.id)
    : [];
  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const announcementUnreadCount = notifications.filter(
    (n) => n.type === 'ANNOUNCEMENT' && !n.isRead
  ).length;
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

    setActiveTab(tabKey);
    if (onCloseMobile) onCloseMobile();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          onTouchStart={onCloseMobile}
          className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm lg:hidden transition-opacity cursor-pointer"
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-[60] bg-[#070b13] border-r border-slate-800/80
          flex flex-col justify-between transition-all duration-300 ease-in-out
          ${
            isOpenMobile
              ? 'w-64 max-w-[85vw] translate-x-0 shadow-2xl shadow-amber-500/15'
              : isCollapsed
              ? 'w-20 -translate-x-full lg:translate-x-0'
              : 'w-64 -translate-x-full lg:translate-x-0'
          }
        `}
      >
        {/* Top Branding Header */}
        <div className={`pt-4 pb-3.5 border-b border-slate-800/70 flex items-center ${isCollapsed ? 'px-2 justify-center flex-col gap-2' : 'px-4 justify-between'}`}>
          <EasyTradersLogo variant={isSuperAdmin ? 'admin' : 'portal'} collapsed={isCollapsed} size={isCollapsed ? 'sm' : 'md'} />
          
          <div className="flex items-center gap-1">
            {/* Desktop Collapse / Expand toggle button */}
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                className="hidden lg:flex p-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-slate-400 hover:text-amber-300 hover:border-amber-500/40 hover:bg-slate-800 transition cursor-pointer"
                title={isCollapsed ? "Expandir menú lateral" : "Colapsar menú lateral"}
                aria-label={isCollapsed ? "Expandir menú lateral" : "Colapsar menú lateral"}
              >
                {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              </button>
            )}

            {/* Mobile Close Button */}
            {isOpenMobile && (
              <button
                onClick={onCloseMobile}
                className="lg:hidden min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white active:scale-95 transition cursor-pointer"
                aria-label="Cerrar Menú"
              >
                <X className="w-4 h-4 text-amber-400" />
              </button>
            )}
          </div>
        </div>

        {/* Navigation List matching exact order and design from uploaded image */}
        <div className={`flex-1 min-h-0 overflow-y-auto py-3 space-y-1.5 custom-scrollbar overscroll-contain touch-pan-y ${isCollapsed ? 'px-2' : 'px-3'}`}>
          {isSuperAdmin ? (
            /* ================= ADMIN NAVIGATION ================= */
            <>
              {/* 1. Cierre Mensual */}
              <button
                onClick={() => handleNavClick('monthly_closure')}
                title="Cierre Mensual"
                className={`w-full flex items-center transition cursor-pointer relative ${
                  isCollapsed ? 'justify-center p-3 rounded-xl' : 'gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-left'
                } ${
                  activeTab === 'monthly_closure'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg shadow-amber-950/40'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                    activeTab === 'monthly_closure'
                      ? 'text-amber-400 bg-amber-500/20 border border-amber-500/40'
                      : 'text-slate-400'
                  }`}
                >
                  <Table2 className="w-4 h-4" />
                </div>
                {!isCollapsed && <span className="flex-1 tracking-wide truncate">Cierre Mensual</span>}
              </button>

              {/* 2. Dashboard */}
              <button
                onClick={() => handleNavClick('dashboard')}
                title="Dashboard"
                className={`w-full flex items-center transition cursor-pointer relative ${
                  isCollapsed ? 'justify-center p-3 rounded-xl' : 'gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-left'
                } ${
                  activeTab === 'dashboard'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-slate-400 shrink-0">
                  <Home className="w-4 h-4" />
                </div>
                {!isCollapsed && <span className="flex-1 tracking-wide truncate">Dashboard</span>}
              </button>

              {/* 3. Usuarios */}
              <button
                onClick={() => handleNavClick('users')}
                title="Usuarios"
                className={`w-full flex items-center transition cursor-pointer relative ${
                  isCollapsed ? 'justify-center p-3 rounded-xl' : 'gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-left'
                } ${
                  activeTab === 'users'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-slate-400 shrink-0">
                  <Users className="w-4 h-4" />
                </div>
                {!isCollapsed && <span className="flex-1 tracking-wide truncate">Usuarios</span>}
              </button>

              {/* 3.1 Admisiones FIFO (Cola de Solicitudes) */}
              <button
                onClick={() => handleNavClick('applications')}
                title="Admisiones"
                className={`w-full flex items-center transition cursor-pointer relative ${
                  isCollapsed ? 'justify-center p-3 rounded-xl' : 'justify-between px-3 py-2.5 rounded-xl text-sm font-semibold text-left'
                } ${
                  activeTab === 'applications'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-6 h-6 flex items-center justify-center text-amber-400 shrink-0">
                    <UserCheck className="w-4 h-4" />
                  </div>
                  {!isCollapsed && <span className="tracking-wide truncate">Admisiones</span>}
                </div>
                {pendingAppsCount > 0 && (
                  isCollapsed ? (
                    <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-[#070b13]" />
                  ) : (
                    <span className="bg-amber-500 text-slate-950 text-[10px] font-mono font-extrabold px-2 py-0.5 rounded-full shadow-sm shadow-amber-500/20">
                      {pendingAppsCount}
                    </span>
                  )
                )}
              </button>

              {/* 3.2 Comunicados */}
              <button
                onClick={() => handleNavClick('announcements')}
                title="Comunicados"
                className={`w-full flex items-center transition cursor-pointer relative ${
                  isCollapsed ? 'justify-center p-3 rounded-xl' : 'gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-left'
                } ${
                  activeTab === 'announcements'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-violet-400 shrink-0">
                  <Megaphone className="w-4 h-4" />
                </div>
                {!isCollapsed && <span className="flex-1 tracking-wide truncate">Comunicados</span>}
              </button>

              {/* 4. Bitácoras (with blue 'Nuevo' badge) */}
              <button
                onClick={() => handleNavClick('bitacoras')}
                title="Bitácoras de Trading"
                className={`w-full flex items-center transition cursor-pointer relative ${
                  isCollapsed ? 'justify-center p-3 rounded-xl' : 'justify-between px-3 py-2.5 rounded-xl text-sm font-semibold text-left'
                } ${
                  activeTab === 'bitacoras'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-6 h-6 flex items-center justify-center shrink-0 ${
                      activeTab === 'bitacoras' ? 'text-amber-400' : 'text-blue-400'
                    }`}
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                  </div>
                  {!isCollapsed && <span className="tracking-wide truncate">Bitácoras</span>}
                </div>
                {isCollapsed ? (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-500 ring-2 ring-[#070b13]" />
                ) : (
                  <span className="bg-[#1c64ec] text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm shadow-blue-600/30">
                    Nuevo
                  </span>
                )}
              </button>

              {/* 5. Liquidaciones */}
              <button
                onClick={() => handleNavClick('finance')}
                title="Liquidaciones"
                className={`w-full flex items-center transition cursor-pointer relative ${
                  isCollapsed ? 'justify-center p-3 rounded-xl' : 'gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-left'
                } ${
                  activeTab === 'finance'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-slate-400 shrink-0">
                  <TrendingUp className="w-4 h-4" />
                </div>
                {!isCollapsed && <span className="flex-1 tracking-wide truncate">Liquidaciones</span>}
              </button>

              {/* 6. Reinversiones */}
              <button
                onClick={() => handleNavClick('reinvestments')}
                title="Reinversiones"
                className={`w-full flex items-center transition cursor-pointer relative ${
                  isCollapsed ? 'justify-center p-3 rounded-xl' : 'gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-left'
                } ${
                  activeTab === 'reinvestments'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-slate-400 shrink-0">
                  <RotateCcw className="w-4 h-4" />
                </div>
                {!isCollapsed && <span className="flex-1 tracking-wide truncate">Reinversiones</span>}
              </button>

              {/* 6.1 Estadísticas */}
              <button
                onClick={() => handleNavClick('admin_statistics')}
                title="Estadísticas"
                className={`w-full flex items-center transition cursor-pointer relative ${
                  isCollapsed ? 'justify-center p-3 rounded-xl' : 'gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-left'
                } ${
                  activeTab === 'admin_statistics'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-slate-400 shrink-0">
                  <BarChart3 className="w-4 h-4" />
                </div>
                {!isCollapsed && <span className="flex-1 tracking-wide truncate">Estadísticas</span>}
              </button>

              {/* 8. Auditoría */}
              <button
                onClick={() => handleNavClick('audit')}
                title="Auditoría"
                className={`w-full flex items-center transition cursor-pointer relative ${
                  isCollapsed ? 'justify-center p-3 rounded-xl' : 'gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-left'
                } ${
                  activeTab === 'audit'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-slate-400 shrink-0">
                  <Shield className="w-4 h-4" />
                </div>
                {!isCollapsed && <span className="flex-1 tracking-wide truncate">Auditoría</span>}
              </button>

              {/* 9.1 Soporte Técnico */}
              <button
                onClick={() => handleNavClick('support')}
                title="Soporte Técnico"
                className={`w-full flex items-center transition cursor-pointer relative ${
                  isCollapsed ? 'justify-center p-3 rounded-xl' : 'gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-left'
                } ${
                  activeTab === 'support'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-blue-400 shrink-0">
                  <LifeBuoy className="w-4 h-4" />
                </div>
                {!isCollapsed && <span className="flex-1 tracking-wide truncate">Soporte Técnico</span>}
              </button>

              {/* 10. Configuración */}
              <button
                onClick={() => handleNavClick('settings')}
                title="Configuración TRM"
                className={`w-full flex items-center transition cursor-pointer border border-transparent relative ${
                  isCollapsed ? 'justify-center p-3 rounded-xl' : 'justify-between px-3 py-2.5 rounded-xl text-sm font-semibold text-left'
                } text-slate-400 hover:text-slate-100 hover:bg-slate-900/60`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-6 h-6 flex items-center justify-center text-slate-400 shrink-0">
                    <Settings className="w-4 h-4" />
                  </div>
                  {!isCollapsed && <span className="tracking-wide truncate">Configuración TRM</span>}
                </div>
                {!isCollapsed && (
                  <span
                    className={`text-[9px] uppercase font-mono px-2 py-0.5 rounded-full font-bold border ${
                      dataStore.getConfig().trmMode === 'AUTOMATIC'
                        ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300'
                        : 'bg-amber-950/80 border-amber-500/40 text-amber-300'
                    }`}
                  >
                    {dataStore.getConfig().trmMode === 'AUTOMATIC' ? 'AUTO' : 'MANUAL'}
                  </span>
                )}
              </button>
            </>
          ) : (
            /* ================= USER / INVESTOR NAVIGATION ================= */
            <>
              {/* 1. Inicio & Resumen */}
              <button
                onClick={() => handleNavClick('portal')}
                title="Inicio & Resumen"
                className={`w-full flex items-center transition cursor-pointer relative ${
                  isCollapsed ? 'justify-center p-3 rounded-xl' : 'gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-left'
                } ${
                  activeTab === 'portal'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-amber-400 shrink-0">
                  <Home className="w-4 h-4" />
                </div>
                {!isCollapsed && <span className="flex-1 tracking-wide truncate">Inicio & Resumen</span>}
              </button>

              {/* 2. Historial de Ciclos */}
              <button
                onClick={() => handleNavClick('portal_history')}
                title="Historial de Ciclos"
                className={`w-full flex items-center transition cursor-pointer relative ${
                  isCollapsed ? 'justify-center p-3 rounded-xl' : 'gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-left'
                } ${
                  activeTab === 'portal_history'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-blue-400 shrink-0">
                  <Calendar className="w-4 h-4" />
                </div>
                {!isCollapsed && <span className="flex-1 tracking-wide truncate">Historial de Ciclos</span>}
              </button>

              {/* 3. Reinversión a Capital */}
              <button
                onClick={() => handleNavClick('portal_reinvestment')}
                title="Reinversión a Capital"
                className={`w-full flex items-center transition cursor-pointer relative ${
                  isCollapsed ? 'justify-center p-3 rounded-xl' : 'gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-left'
                } ${
                  activeTab === 'portal_reinvestment'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-emerald-400 shrink-0">
                  <RotateCcw className="w-4 h-4" />
                </div>
                {!isCollapsed && <span className="flex-1 tracking-wide truncate">Reinversión a Capital</span>}
              </button>

              {/* 3.1 Estadísticas */}
              <button
                onClick={() => handleNavClick('portal_statistics')}
                title="Estadísticas"
                className={`w-full flex items-center transition cursor-pointer relative ${
                  isCollapsed ? 'justify-center p-3 rounded-xl' : 'gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-left'
                } ${
                  activeTab === 'portal_statistics'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-amber-400 shrink-0">
                  <BarChart3 className="w-4 h-4" />
                </div>
                {!isCollapsed && <span className="flex-1 tracking-wide truncate">Estadísticas</span>}
              </button>

              {/* 3.2 Comunicados */}
              <button
                onClick={() => handleNavClick('announcements')}
                title="Comunicados"
                className={`w-full flex items-center transition cursor-pointer relative ${
                  isCollapsed ? 'justify-center p-3 rounded-xl' : 'justify-between px-3 py-2.5 rounded-xl text-sm font-semibold text-left'
                } ${
                  activeTab === 'announcements'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-6 h-6 flex items-center justify-center text-violet-400 shrink-0">
                    <Megaphone className="w-4 h-4" />
                  </div>
                  {!isCollapsed && <span className="tracking-wide truncate">Comunicados</span>}
                </div>
                {announcementUnreadCount > 0 && (
                  isCollapsed ? (
                    <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-violet-400 ring-2 ring-[#070b13]" />
                  ) : (
                    <span className="min-w-5 h-5 px-1 rounded-full bg-violet-500 text-white text-[10px] font-mono font-bold flex items-center justify-center">
                      {announcementUnreadCount > 99 ? '99+' : announcementUnreadCount}
                    </span>
                  )
                )}
              </button>

              {/* 3.3 Mesa de Ayuda / Soporte */}
              <button
                onClick={() => handleNavClick('support')}
                title="Mesa de Ayuda"
                className={`w-full flex items-center transition cursor-pointer relative ${
                  isCollapsed ? 'justify-center p-3 rounded-xl' : 'gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-left'
                } ${
                  activeTab === 'support'
                    ? 'bg-gradient-to-r from-[#241a08] via-[#2c2009] to-[#241a08] border border-amber-500/50 text-amber-200 shadow-lg'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center text-blue-400 shrink-0">
                  <LifeBuoy className="w-4 h-4" />
                </div>
                {!isCollapsed && (
                  <span className="flex-1 tracking-wide truncate">
                    {isSupportAgent ? 'Panel de Soporte' : 'Mesa de Ayuda'}
                  </span>
                )}
              </button>

              {/* 4. Notificaciones */}
              <button
                onClick={() => handleNavClick('notifications')}
                title="Notificaciones"
                className={`w-full flex items-center transition cursor-pointer relative ${
                  isCollapsed ? 'justify-center p-3 rounded-xl' : 'justify-between px-3 py-2.5 rounded-xl text-sm font-semibold text-left'
                } text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 border border-transparent`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-6 h-6 flex items-center justify-center text-slate-400 shrink-0">
                    <Bell className="w-4 h-4" />
                  </div>
                  {!isCollapsed && <span className="tracking-wide truncate">Notificaciones</span>}
                </div>
                {unreadCount > 0 && (
                  isCollapsed ? (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-[#070b13]" />
                  ) : (
                    <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-mono font-bold flex items-center justify-center">
                      {unreadCount}
                    </span>
                  )
                )}
              </button>
            </>
          )}
        </div>

        {/* Bottom Profile Footer */}
        <div className={`p-2.5 border-t border-slate-800/80 bg-[#060a12] relative ${isCollapsed ? 'flex justify-center' : ''}`}>
          {isCollapsed ? (
            <button
              onClick={() => setShowSwitchMenu(!showSwitchMenu)}
              className="w-12 h-12 rounded-xl bg-[#0a0f19] border border-slate-800/90 hover:border-amber-500/50 transition cursor-pointer flex items-center justify-center relative"
              title={`${isSuperAdmin ? 'Administrador' : 'Inversionista'}: ${currentUser?.fullName || 'Usuario'}`}
            >
              <div className="relative">
                <div className="w-8 h-8 rounded-lg bg-[#171308] border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-sm">
                  <User className="w-4 h-4" />
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-[#0a0f19]" />
              </div>
            </button>
          ) : (
            <button
              onClick={() => setShowSwitchMenu(!showSwitchMenu)}
              className="w-full flex items-center justify-between p-2 rounded-xl bg-[#0a0f19] border border-slate-800/90 hover:border-slate-700 transition cursor-pointer text-left group"
              title="Opciones de cuenta"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {/* Gold User Icon with Green online indicator dot */}
                <div className="relative shrink-0">
                  <div className="w-9 h-9 rounded-xl bg-[#171308] border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-sm">
                    <User className="w-4 h-4" />
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-[#0a0f19]" />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-bold text-slate-100 truncate group-hover:text-white transition">
                    {isSuperAdmin ? (currentUser?.fullName || 'Juan Esteban') : currentUser?.fullName || 'Inversionista'}
                  </p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {isSuperAdmin ? (currentUser?.email || 'juanes9802@gmail.com') : currentUser?.email || 'usuario@easytraders24.app'}
                  </p>
                </div>
              </div>

              {/* Bright Green Chevron */}
              <ChevronRight className="w-4 h-4 text-emerald-400 shrink-0 stroke-[2.5] group-hover:translate-x-0.5 transition-transform" />
            </button>
          )}

          {/* Profile Menu Popover */}
          {showSwitchMenu && (
            <div className={`absolute ${isCollapsed ? 'left-20 bottom-1 w-64' : 'bottom-16 left-2 right-2'} bg-slate-900 border border-slate-800 rounded-2xl p-3 shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-2 duration-150`}>
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-xs">
                <span className="font-bold text-slate-200 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-blue-400" />
                  {isSuperAdmin ? 'Mi Cuenta Administrador' : 'Mi Cuenta Inversionista'}
                </span>
                <button
                  onClick={() => setShowSwitchMenu(false)}
                  className="text-slate-400 hover:text-slate-200 p-1 text-xs font-bold"
                >
                  ✕
                </button>
              </div>

              {isSuperAdmin ? (
                <div className="space-y-2 text-xs p-1">
                  <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                    <p className="font-bold text-slate-100 flex items-center gap-1.5">
                      <span className="text-amber-400">👑</span>
                      {currentUser?.fullName || 'Juan Esteban'}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{currentUser?.email || 'juanes9802@gmail.com'}</p>
                    <span className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-mono bg-amber-950 text-amber-400 border border-amber-500/30">
                      Rol: Super Administrador
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 text-xs p-1">
                  <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                    <p className="font-bold text-slate-100">{currentUser?.fullName}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{currentUser?.email}</p>
                    <span className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-500/30">
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

