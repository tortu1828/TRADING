import React, { useState } from 'react';
import {
  Download,
  Smartphone,
  Share,
  PlusSquare,
  X,
  CheckCircle2,
  Laptop,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  className?: string;
  variant?: 'button' | 'banner' | 'compact';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  className = '',
  variant = 'button',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showInstructionsModal, setShowInstructionsModal] = useState<boolean>(false);
  const [activeDeviceTab, setActiveDeviceTab] = useState<'ios' | 'android'>(isIOS ? 'ios' : 'android');
  const [isInstalling, setIsInstalling] = useState<boolean>(false);

  // If already running as installed PWA app, hide install buttons
  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      setIsInstalling(true);
      try {
        const result = await install();
        if (!result) {
          setShowInstructionsModal(true);
        }
      } catch {
        setShowInstructionsModal(true);
      } finally {
        setIsInstalling(false);
      }
    } else {
      setShowInstructionsModal(true);
    }
  };

  return (
    <>
      {variant === 'compact' ? (
        <button
          type="button"
          onClick={handleInstallClick}
          disabled={isInstalling}
          className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-600/20 transition cursor-pointer border border-blue-400/40 shrink-0 ${className}`}
          title="Instalar EasyTraders en tu celular"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Instalar</span>
        </button>
      ) : variant === 'banner' ? (
        <div className={`p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-blue-950/90 via-slate-900 to-indigo-950/90 border border-blue-500/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xl ${className}`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 shrink-0">
              <Smartphone className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h4 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5 truncate">
                <span>Instala EasyTraders en tu celular</span>
                <span className="px-1.5 py-0.2 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px]">PWA</span>
              </h4>
              <p className="text-[11px] sm:text-xs text-slate-300 line-clamp-1 sm:line-clamp-none">
                Acceso directo desde tu pantalla de inicio y carga instantánea.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleInstallClick}
            disabled={isInstalling}
            className="w-full sm:w-auto px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 transition cursor-pointer shrink-0"
          >
            <Download className="w-4 h-4" />
            <span>{isInstalling ? 'Instalando...' : 'Instalar Aplicación'}</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleInstallClick}
          disabled={isInstalling}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-600/30 transition cursor-pointer border border-blue-400/30 ${className}`}
        >
          <Download className="w-4 h-4" />
          <span>Instalar Aplicación</span>
        </button>
      )}

      {/* Super Clear 3-Step Installation Guide Modal */}
      {showInstructionsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/90 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-md p-5 sm:p-6 shadow-2xl space-y-4 my-auto">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3.5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 shrink-0">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-white leading-tight">
                    Instalar EasyTraders App
                  </h3>
                  <p className="text-xs text-emerald-400 font-semibold mt-0.5">
                    Guía de instalación en 3 pasos rápidos
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowInstructionsModal(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0"
                title="Cerrar guía"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Device Tabs: iPhone vs Android/PC */}
            <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-slate-950 border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setActiveDeviceTab('ios')}
                className={`py-2 px-3 rounded-xl font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  activeDeviceTab === 'ios'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="text-sm">🍎</span>
                <span>iPhone / iPad</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveDeviceTab('android')}
                className={`py-2 px-3 rounded-xl font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  activeDeviceTab === 'android'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="text-sm">🤖</span>
                <span>Android / PC</span>
              </button>
            </div>

            {/* Step by Step Visual Guide */}
            {activeDeviceTab === 'ios' ? (
              <div className="space-y-3 text-xs">
                {/* Paso 1 */}
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-blue-500/40 flex items-start gap-3">
                  <div className="w-7 h-7 rounded-xl bg-blue-600 text-white font-black flex items-center justify-center shrink-0 text-xs shadow-md">
                    1
                  </div>
                  <div className="space-y-1 min-w-0">
                    <p className="font-bold text-white text-xs sm:text-sm flex items-center gap-1.5 flex-wrap">
                      <span>Toca el botón</span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-blue-900/80 text-blue-200 border border-blue-400/40 font-bold text-xs">
                        <Share className="w-3.5 h-3.5 text-blue-400" /> Compartir
                      </span>
                    </p>
                    <p className="text-slate-300 text-xs leading-relaxed">
                      Se encuentra en la <strong>barra inferior</strong> de tu navegador Safari.
                    </p>
                  </div>
                </div>

                {/* Paso 2 */}
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 flex items-start gap-3">
                  <div className="w-7 h-7 rounded-xl bg-slate-800 text-emerald-400 font-black flex items-center justify-center shrink-0 text-xs border border-slate-700">
                    2
                  </div>
                  <div className="space-y-1 min-w-0">
                    <p className="font-bold text-white text-xs sm:text-sm flex items-center gap-1.5 flex-wrap">
                      <span>Selecciona</span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-800 text-emerald-300 border border-emerald-500/40 font-bold text-xs">
                        <PlusSquare className="w-3.5 h-3.5 text-emerald-400" /> "Agregar a inicio"
                      </span>
                    </p>
                    <p className="text-slate-400 text-xs leading-relaxed">
                      Desliza el menú de opciones hacia abajo hasta encontrar el botón.
                    </p>
                  </div>
                </div>

                {/* Paso 3 */}
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 flex items-start gap-3">
                  <div className="w-7 h-7 rounded-xl bg-slate-800 text-blue-400 font-black flex items-center justify-center shrink-0 text-xs border border-slate-700">
                    3
                  </div>
                  <div className="space-y-1 min-w-0">
                    <p className="font-bold text-white text-xs sm:text-sm">
                      Toca <strong className="text-emerald-400">"Agregar"</strong> en la esquina superior.
                    </p>
                    <p className="text-slate-400 text-xs leading-relaxed">
                      ¡Listo! El icono de EasyTraders quedará guardado en tu pantalla de inicio como una app móvil.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                {/* Paso 1 */}
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-emerald-500/40 flex items-start gap-3">
                  <div className="w-7 h-7 rounded-xl bg-emerald-600 text-white font-black flex items-center justify-center shrink-0 text-xs shadow-md">
                    1
                  </div>
                  <div className="space-y-1 min-w-0">
                    <p className="font-bold text-white text-xs sm:text-sm">
                      Toca los <strong className="text-emerald-300">3 puntos (⋮)</strong> o el icono de descarga.
                    </p>
                    <p className="text-slate-300 text-xs leading-relaxed">
                      En la esquina superior derecha del navegador Chrome o Edge.
                    </p>
                  </div>
                </div>

                {/* Paso 2 */}
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 flex items-start gap-3">
                  <div className="w-7 h-7 rounded-xl bg-slate-800 text-emerald-400 font-black flex items-center justify-center shrink-0 text-xs border border-slate-700">
                    2
                  </div>
                  <div className="space-y-1 min-w-0">
                    <p className="font-bold text-white text-xs sm:text-sm">
                      Selecciona <strong className="text-emerald-300">"Instalar aplicación"</strong> o "Agregar a pantalla".
                    </p>
                    <p className="text-slate-400 text-xs leading-relaxed">
                      Aparecerá un mensaje del sistema para confirmar.
                    </p>
                  </div>
                </div>

                {/* Paso 3 */}
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 flex items-start gap-3">
                  <div className="w-7 h-7 rounded-xl bg-slate-800 text-blue-400 font-black flex items-center justify-center shrink-0 text-xs border border-slate-700">
                    3
                  </div>
                  <div className="space-y-1 min-w-0">
                    <p className="font-bold text-white text-xs sm:text-sm">
                      Confirma tocando <strong className="text-emerald-400">"Instalar"</strong>.
                    </p>
                    <p className="text-slate-400 text-xs leading-relaxed">
                      ¡Listo! EasyTraders se abrirá en pantalla completa y cargará de forma instantánea.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowInstructionsModal(false)}
              className="w-full py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs sm:text-sm transition cursor-pointer shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>¡Entendido!</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
};

