import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { AdminDashboard } from './components/AdminDashboard';
import { MonthlyClosureView } from './components/MonthlyClosureView';
import { AdminBitacoraView } from './components/AdminBitacoraView';
import { UserManagementView } from './components/UserManagementView';
import { ReinvestmentsView } from './components/ReinvestmentsView';
import { AuditLogsView } from './components/AuditLogsView';
import { AdminFinanceView } from './components/AdminFinanceView';
import { InvestorApplicationsView } from './components/InvestorApplicationsView';
import { UserPortalView } from './components/UserPortalView';
import { AdminStatisticsPanel } from './components/AdminStatisticsPanel';
import { SupportTicketsView } from './components/SupportTicketsView';
import { EditTRMModal } from './components/EditTRMModal';
import { NotificationsModal } from './components/NotificationsModal';
import { LiveNotificationToast } from './components/LiveNotificationToast';
import { OfflineIndicator } from './components/OfflineIndicator';
import { LoginView } from './components/LoginView';
import { fetchLiveTRM } from './lib/trmService';
import { dataStore } from './lib/dataStore';
import { ensureAutoNotificationPermission } from './lib/pushNotifications';

const MainLayout: React.FC = () => {
  const { currentUser, isSuperAdmin, isAuthLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('monthly_closure');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showTrmModal, setShowTrmModal] = useState(false);
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [selectedCycleId, setSelectedCycleId] = useState<string>(() => {
    const active = dataStore.getActiveCycle();
    return active ? active.cycleId : (dataStore.getCycles()[0]?.cycleId || '');
  });

  const handleToggleSidebar = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setIsMobileSidebarOpen((prev) => !prev);
    } else {
      setIsSidebarCollapsed((prev) => !prev);
    }
  };

  // Pedir permiso de notificaciones SOLO a usuarios que ya tengan cuenta activa en la app (no a visitantes ni al admin)
  React.useEffect(() => {
    if (currentUser && currentUser.role === 'USER') {
      ensureAutoNotificationPermission().catch((err) => {
        console.warn('Auto notification permission check:', err);
      });
    }
  }, [currentUser]);

  // Auto-sync TRM desde la única fuente server-side.
  React.useEffect(() => {
    if (!currentUser) {
      return;
    }

    let cancelled = false;

    const syncTrm = async () => {
      try {
        const res = await fetchLiveTRM();

        if (!cancelled) {
          dataStore.syncAutomaticTRM(
            res.rate,
            res.sourceLabel || res.source
          );
        }
      } catch (err) {
        console.warn(
          'Dolar-Colombia TRM sync error:',
          err
        );
      }
    };

    syncTrm();

    const intervalId =
      window.setInterval(
        syncTrm,
        5 * 60 * 1000
      );

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [currentUser?.uid]);

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
        onOpenNotifications={() => {
          setShowNotifModal(true);
          setIsMobileSidebarOpen(false);
        }}
        onOpenSettings={() => setShowTrmModal(true)}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
      />

      {/* Main Content Area (offset by sidebar width on lg screens) */}
      <div
        className={`flex-1 flex flex-col min-w-0 w-full max-w-full transition-[padding] duration-300 ease-in-out ${
          isSidebarCollapsed ? 'lg:pl-20' : 'lg:pl-64'
        }`}
      >
        {/* Top Navbar */}
        <Navbar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onToggleSidebar={handleToggleSidebar}
          isSidebarCollapsed={isSidebarCollapsed}
        />

        {/* Dynamic View Component */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-2.5 sm:px-6 lg:px-8 py-3.5 sm:py-6 pb-8">
          {activeTab === 'support' ? (
            <SupportTicketsView />
          ) : isSuperAdmin && !activeTab.startsWith('portal') ? (
            <>
              {activeTab === 'dashboard' && <AdminDashboard onNavigate={setActiveTab} />}
              {activeTab === 'finance' && <AdminFinanceView onNavigate={setActiveTab} />}
              {activeTab === 'bitacoras' && <AdminBitacoraView onNavigate={setActiveTab} />}
              {activeTab === 'monthly_closure' && <MonthlyClosureView onNavigate={setActiveTab} />}
              {activeTab === 'users' && <UserManagementView />}
              {activeTab === 'applications' && (
                <InvestorApplicationsView onNavigateToUser={() => setActiveTab('users')} />
              )}
              {activeTab === 'reinvestments' && <ReinvestmentsView />}
              {activeTab === 'admin_statistics' && <AdminStatisticsPanel />}
              {activeTab === 'audit' && <AuditLogsView />}
            </>
          ) : (
            <UserPortalView
              activeSection={activeTab}
              onNavigate={(tab) => setActiveTab(tab)}
              selectedCycleId={selectedCycleId}
              onSelectCycle={setSelectedCycleId}
            />
          )}
        </main>

        <footer className="hidden sm:flex border-t border-slate-900/90 bg-[#070b13]/80 py-4 px-6 text-center text-xs text-slate-500 flex-col sm:flex-row items-center justify-between gap-2 max-w-7xl mx-auto w-full">
          <div>
            <span className="font-semibold text-slate-400">EasyTraders24</span>
          </div>
          <div className="flex items-center gap-4 text-[11px] font-mono">
            <span>🔵 Azul • 🟢 Verde • ⚫ Negra</span>
            <span>•</span>
            <span className="text-emerald-400">Auditoría en Tiempo Real</span>
          </div>
        </footer>
      </div>

      {/* Shared Modals accessible from sidebar */}
      <EditTRMModal isOpen={showTrmModal} onClose={() => setShowTrmModal(false)} />
      <NotificationsModal
        isOpen={showNotifModal}
        onClose={() => setShowNotifModal(false)}
        onSelectTab={setActiveTab}
        onSelectCycle={setSelectedCycleId}
      />

      {/* Real-time in-app notification banner toast */}
      <LiveNotificationToast onNavigateToTab={setActiveTab} />

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

