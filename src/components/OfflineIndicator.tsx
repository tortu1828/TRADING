import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/usePWAInstall';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600/95 backdrop-blur-md px-3.5 py-2 text-xs font-bold text-white shadow-2xl border border-amber-400/40 animate-pulse">
      <WifiOff className="w-4 h-4 text-white shrink-0" />
      <span>Modo Sin Conexión — Datos locales cargados</span>
    </div>
  );
};
