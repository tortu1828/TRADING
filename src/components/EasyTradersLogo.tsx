import React from 'react';

interface EasyTradersLogoProps {
  variant?: 'admin' | 'portal';
  collapsed?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const EasyTradersLogo: React.FC<EasyTradersLogoProps> = ({
  collapsed = false,
  size = 'md',
}) => {
  const sizeMap = {
    sm: { badge: 'w-8 h-8', title: 'text-sm' },
    md: { badge: 'w-10 h-10', title: 'text-base sm:text-lg' },
    lg: { badge: 'w-14 h-14', title: 'text-xl sm:text-2xl' },
  };

  const currentSize = sizeMap[size] || sizeMap.md;

  return (
    <div className="flex items-center gap-3 select-none">
      {/* Official Easy Traders Circular Badge */}
      <div className="relative shrink-0">
        <div className={`${currentSize.badge} rounded-full overflow-hidden shadow-lg shadow-black/40 ring-1 ring-white/30 hover:ring-white/60 transition duration-300 flex items-center justify-center bg-[#0c121e]`}>
          <img
            src="/easytraders-logo.svg"
            alt="EasyTraders24 Logo"
            className="w-full h-full object-contain pointer-events-none"
          />
        </div>
        <div className="absolute -inset-0.5 rounded-full bg-slate-400/10 blur-sm -z-10 pointer-events-none" />
      </div>

      {!collapsed && (
        <div className="flex items-center">
          <span className={`${currentSize.title} font-black tracking-tight text-slate-100 font-sans`}>
            EasyTraders24
          </span>
        </div>
      )}
    </div>
  );
};
