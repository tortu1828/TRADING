import React from 'react';

interface EasyTradersLogoProps {
  variant?: 'admin' | 'portal';
  collapsed?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const EasyTradersLogo: React.FC<EasyTradersLogoProps> = ({
  variant = 'admin',
  collapsed = false,
  size = 'md',
}) => {
  const sizeMap = {
    sm: { badge: 'w-8 h-8', title: 'text-sm', sub: 'text-[8px]' },
    md: { badge: 'w-10 h-10', title: 'text-base', sub: 'text-[9px]' },
    lg: { badge: 'w-14 h-14', title: 'text-lg', sub: 'text-[10px]' },
  };

  const currentSize = sizeMap[size] || sizeMap.md;

  return (
    <div className="flex items-center gap-3 select-none">
      {/* Official Easy Traders Circular Badge */}
      <div className="relative shrink-0">
        <div className={`${currentSize.badge} rounded-full overflow-hidden shadow-lg shadow-black/40 ring-1 ring-white/30 hover:ring-white/60 transition duration-300 flex items-center justify-center bg-[#0c121e]`}>
          <img
            src="/easytraders-logo.svg"
            alt="Easy Traders Logo"
            className="w-full h-full object-contain pointer-events-none"
          />
        </div>
        <div className="absolute -inset-0.5 rounded-full bg-slate-400/10 blur-sm -z-10 pointer-events-none" />
      </div>

      {!collapsed && (
        <div className="leading-tight">
          <div className="flex items-center gap-1.5">
            <span className={`${currentSize.title} font-black tracking-widest text-slate-100 font-sans`}>
              EASY
            </span>
            <span className={`${currentSize.title} font-black tracking-widest text-slate-100 font-sans`}>
              TRADERS
            </span>
          </div>
          <p className={`${currentSize.sub} font-bold tracking-widest uppercase font-mono text-slate-400 mt-0.5`}>
            {variant === 'admin' ? 'PLATAFORMA DE GESTIÓN' : 'PORTAL INVERSIONISTA'}
          </p>
        </div>
      )}
    </div>
  );
};
