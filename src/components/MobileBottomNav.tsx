import React from 'react';
import {
  Zap,
  BarChart3,
  Users,
  Coins,
  RotateCcw,
  Home,
  Calendar,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dataStore } from '../lib/dataStore';

interface MobileBottomNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeTab,
  setActiveTab,
}) => {
  const { isSuperAdmin } = useAuth();
  const pendingReinvest = dataStore.getReinvestments().filter((r) => r.status === 'PENDING').length;
  const pendingDisburse = dataStore.getDisbursements().filter((d) => d.status === 'PENDING').length;
  const totalPendingRequests = pendingReinvest + pendingDisburse;

  if (!isSuperAdmin) {
    return (
      <nav
        id="mobile-bottom-nav-user"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#070b13]/95 backdrop-blur-xl border-t border-slate-800/90 px-2 py-1.5 flex items-center justify-around shadow-2xl safe-area-bottom"
      >
        <button
          onClick={() => setActiveTab('portal')}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-1 rounded-xl transition cursor-pointer ${
            activeTab === 'portal'
              ? 'text-amber-400 font-bold bg-amber-500/10'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Home className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] tracking-tight">Inicio</span>
        </button>

        <button
          onClick={() => setActiveTab('portal_history')}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-1 rounded-xl transition cursor-pointer ${
            activeTab === 'portal_history'
              ? 'text-blue-400 font-bold bg-blue-500/10'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Calendar className="w-5 h-5 mb-0.5 text-blue-400" />
          <span className="text-[10px] tracking-tight">Historial</span>
        </button>

        <button
          onClick={() => setActiveTab('portal_reinvestment')}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-1 rounded-xl transition cursor-pointer ${
            activeTab === 'portal_reinvestment'
              ? 'text-emerald-400 font-bold bg-emerald-500/10'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <RotateCcw className="w-5 h-5 mb-0.5 text-emerald-400" />
          <span className="text-[10px] tracking-tight">Reinversión</span>
        </button>

        <button
          onClick={() => setActiveTab('portal_withdrawals')}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-1 rounded-xl transition cursor-pointer ${
            activeTab === 'portal_withdrawals'
              ? 'text-amber-400 font-bold bg-amber-500/10'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Wallet className="w-5 h-5 mb-0.5 text-amber-400" />
          <span className="text-[10px] tracking-tight">Retiros</span>
        </button>
      </nav>
    );
  }

  return (
    <nav
      id="mobile-bottom-nav-admin"
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#070b13]/95 backdrop-blur-xl border-t border-slate-800/90 px-1 py-1.5 flex items-center justify-around shadow-2xl safe-area-bottom"
    >
      {/* 1. Cierre Mensual (Core) */}
      <button
        onClick={() => setActiveTab('monthly_closure')}
        className={`flex flex-col items-center justify-center flex-1 py-1 px-1 rounded-xl transition cursor-pointer relative ${
          activeTab === 'monthly_closure'
            ? 'text-amber-400 font-bold bg-amber-500/10'
            : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <Zap className="w-5 h-5 mb-0.5" />
        <span className="text-[10px] tracking-tight">Cierre</span>
      </button>

      {/* 2. Dashboard */}
      <button
        onClick={() => setActiveTab('dashboard')}
        className={`flex flex-col items-center justify-center flex-1 py-1 px-1 rounded-xl transition cursor-pointer ${
          activeTab === 'dashboard'
            ? 'text-blue-400 font-bold bg-blue-500/10'
            : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <BarChart3 className="w-5 h-5 mb-0.5" />
        <span className="text-[10px] tracking-tight">Dashboard</span>
      </button>

      {/* 3. Inversionistas */}
      <button
        onClick={() => setActiveTab('users')}
        className={`flex flex-col items-center justify-center flex-1 py-1 px-1 rounded-xl transition cursor-pointer ${
          activeTab === 'users'
            ? 'text-emerald-400 font-bold bg-emerald-500/10'
            : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <Users className="w-5 h-5 mb-0.5" />
        <span className="text-[10px] tracking-tight">Usuarios</span>
      </button>

      {/* 4. Finanzas */}
      <button
        onClick={() => setActiveTab('finance')}
        className={`flex flex-col items-center justify-center flex-1 py-1 px-1 rounded-xl transition cursor-pointer ${
          activeTab === 'finance'
            ? 'text-indigo-400 font-bold bg-indigo-500/10'
            : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <Coins className="w-5 h-5 mb-0.5" />
        <span className="text-[10px] tracking-tight">Finanzas</span>
      </button>

      {/* 5. Solicitudes */}
      <button
        onClick={() => setActiveTab('reinvestments')}
        className={`flex flex-col items-center justify-center flex-1 py-1 px-1 rounded-xl transition cursor-pointer relative ${
          activeTab === 'reinvestments'
            ? 'text-amber-400 font-bold bg-amber-500/10'
            : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <RotateCcw className="w-5 h-5 mb-0.5" />
        <span className="text-[10px] tracking-tight">Solicitudes</span>
        {totalPendingRequests > 0 && (
          <span className="absolute top-0.5 right-2 w-4 h-4 rounded-full bg-amber-500 text-slate-950 font-bold text-[9px] flex items-center justify-center">
            {totalPendingRequests}
          </span>
        )}
      </button>
    </nav>
  );
};
