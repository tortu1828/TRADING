import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { AdminDashboard } from './components/AdminDashboard';
import { MonthlyClosureView } from './components/MonthlyClosureView';
import { UserManagementView } from './components/UserManagementView';
import { ReinvestmentsView } from './components/ReinvestmentsView';
import { AuditLogsView } from './components/AuditLogsView';
import { AdminFinanceView } from './components/AdminFinanceView';
import { InvestorApplicationsView } from './components/InvestorApplicationsView';
import { UserPortalView } from './components/UserPortalView';
import { EditTRMModal } from './components/EditTRMModal';
import { NotificationsModal } from './components/NotificationsModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { MobileBottomNav } from './components/MobileBottomNav';
import { LoginView } from './components/LoginView';
import { fetchLiveTRM } from './lib/trmService';
import { dataStore } from './lib/dataStore';
import { ensureAutoNotificationPermission } from './lib/pushNotifications';

const MainLayout: React.FC = () => {
  const { currentUser, isSuperAdmin, isAuthLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('monthly_closure');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [showTrmModal, setShowTrmModal] = useState(false);
  const [showNotifModal, setShowNotifModal] = useState(false);

  // Pedir permiso de notificaciones de inmediato al cargar la app
  React.useEffect(() => {
    ensureAutoNotificationPermission().catch((err) => {
      console.warn('Auto notification permission check:', err);
    });
  }, []);

  // Auto-sync TRM en vivo al iniciar
  React.useEffect(() => {
    fetchLiveTRM()
      .then((res) => {
        dataStore.syncAutomaticTRM(res.rate, res.source);
      })
      .catch((err) => {
        console.warn('Background TRM sync error:', err);
      });
  }, []);

  // If role switches from user to admin or vice versa, adapt tab
  React.useEffect(() => {
    if (!isSuperAdmin) {
      if (!activeTab.startsWith('portal')) {
        setActiveTab('portal');
      }
    } else if (activeTab.startsWith('portal')) {
      setActiveTab('monthly_closure');
    }
  }, [isSuperAdmin]);

  // If Firebase Auth is checking credentials
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-[#05080f] flex items-center justify-center text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-mono tracking-wider text-slate-400">Conectando con Firebase...</span>
        </div>
      </div>
    );
  }

  // If user is not authenticated, display secure LoginView
  if (!currentUser) {
    return <LoginView />;
  }

  return (
    <div className="min-h-screen bg-[#05080f] text-slate-100 flex selection:bg-amber-500/30 selection:text-amber-200 w-full overflow-x-clip">
      {/* Sidebar Navigation matching the exact user mockup */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenNotifications={() => setShowNotifModal(true)}
        onOpenSettings={() => setShowTrmModal(true)}
        onOpenReports={() => setActiveTab('monthly_closure')}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      {/* Main Content Area (offset by sidebar width on lg screens) */}
      <div className="flex-1 flex flex-col min-w-0 w-full max-w-full lg:pl-64">
        {/* Top Navbar */}
        <Navbar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onToggleSidebar={() => setIsMobileSidebarOpen(true)}
        />

        {/* Dynamic View Component */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-2.5 sm:px-6 lg:px-8 py-3.5 sm:py-6 pb-24 sm:pb-8">
          {isSuperAdmin && !activeTab.startsWith('portal') ? (
            <>
              {activeTab === 'dashboard' && <AdminDashboard onNavigate={setActiveTab} />}
              {activeTab === 'finance' && <AdminFinanceView onNavigate={setActiveTab} />}
              {activeTab === 'monthly_closure' && <MonthlyClosureView />}
              {activeTab === 'users' && <UserManagementView />}
              {activeTab === 'applications' && (
                <InvestorApplicationsView onNavigateToUser={() => setActiveTab('users')} />
              )}
              {activeTab === 'reinvestments' && <ReinvestmentsView />}
              {activeTab === 'audit' && <AuditLogsView />}
            </>
          ) : (
            <UserPortalView activeSection={activeTab} onNavigate={(tab) => setActiveTab(tab)} />
          )}
        </main>

        <footer className="hidden sm:flex border-t border-slate-900/90 bg-[#070b13]/80 py-4 px-6 text-center text-xs text-slate-500 flex-col sm:flex-row items-center justify-between gap-2 max-w-7xl mx-auto w-full">
          <div>
            <span className="font-semibold text-slate-400">EASYTRADERS</span>
            <span className="mx-2 text-slate-600">•</span>
            <span>Gestor de Capital y Liquidaciones v2.1</span>
          </div>
          <div className="flex items-center gap-4 text-[11px] font-mono">
            <span>🔵 Azul • 🟢 Verde • ⚫ Negra</span>
            <span>•</span>
            <span className="text-emerald-400">Auditoría en Tiempo Real</span>
          </div>
        </footer>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <MobileBottomNav activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Shared Modals accessible from sidebar */}
      <EditTRMModal isOpen={showTrmModal} onClose={() => setShowTrmModal(false)} />
      <NotificationsModal isOpen={showNotifModal} onClose={() => setShowNotifModal(false)} />

      {/* PWA Offline indicator */}
      <OfflineIndicator />
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <MainLayout />
    </AuthProvider>
  );
}

