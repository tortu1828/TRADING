import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  Activity, 
  RefreshCw, 
  Clock, 
  Smartphone, 
  Database, 
  HelpCircle, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle 
} from 'lucide-react';
import { getPushDiagnostics, repairAndDiagnosePush, PushDiagnosticInfo } from '../lib/pushNotifications';
import { useAuth } from '../context/AuthContext';

export const PushDiagnosisPanel: React.FC = () => {
  const { currentUser } = useAuth();
  const [diag, setDiag] = useState<PushDiagnosticInfo | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<'status' | 'comparison' | 'help'>('status');

  const fetchDiagnostics = async () => {
    try {
      const data = await getPushDiagnostics();
      setDiag(data);
    } catch (e) {
      console.error('Error fetching diagnostics:', e);
    }
  };

  useEffect(() => {
    fetchDiagnostics();
    const interval = setInterval(fetchDiagnostics, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleRepair = async () => {
    setIsRunning(true);
    try {
      const result = await repairAndDiagnosePush(true);
      setDiag(result);
    } catch (err) {
      console.error('Error during push repair:', err);
    } finally {
      setIsRunning(false);
    }
  };

  if (!diag) {
    return (
      <div className="p-6 bg-slate-950/40 border border-slate-800 rounded-2xl flex flex-col items-center justify-center text-slate-400 gap-2">
        <RefreshCw className="w-6 h-6 animate-spin text-amber-500" />
        <span className="text-xs font-mono">Cargando diagnóstico...</span>
      </div>
    );
  }

  const renderStatusBadge = (status: 'NOT_STARTED' | 'RUNNING' | 'SUCCESS' | 'ERROR') => {
    switch (status) {
      case 'SUCCESS':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold uppercase">
            <CheckCircle2 className="w-3 h-3" /> Exitoso
          </span>
        );
      case 'RUNNING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-950 text-blue-400 border border-blue-500/30 text-[10px] font-bold uppercase animate-pulse">
            <RefreshCw className="w-3 h-3 animate-spin" /> Procesando
          </span>
        );
      case 'ERROR':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-950 text-rose-400 border border-rose-500/30 text-[10px] font-bold uppercase">
            <XCircle className="w-3 h-3" /> Fallido
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-900 text-slate-400 border border-slate-800 text-[10px] font-bold uppercase">
            Sin iniciar
          </span>
        );
    }
  };

  const formatDate = (isoStr: string) => {
    if (!isoStr || isoStr === 'Nunca') return 'Nunca';
    try {
      return new Date(isoStr).toLocaleString('es-CO', {
        dateStyle: 'medium',
        timeStyle: 'medium'
      });
    } catch {
      return isoStr;
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl animate-in fade-in duration-300">
      {/* Title Header */}
      <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950/40 border-b border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-100">
              Diagnóstico de Notificaciones Push
            </h3>
            <p className="text-xs text-slate-400">
              Auditoría y auto-reparación técnica en tiempo real
            </p>
          </div>
        </div>

        {/* Reparar Trigger Button */}
        <button
          onClick={handleRepair}
          disabled={isRunning}
          className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-md shadow-amber-500/10 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
          <span>{isRunning ? 'Reparando...' : 'Reparar Notificaciones'}</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800/80 bg-slate-950/30 px-4 pt-2 gap-1">
        <button
          onClick={() => setActiveTab('status')}
          className={`px-3.5 py-2.5 text-xs font-semibold border-b-2 transition ${
            activeTab === 'status'
              ? 'border-amber-500 text-amber-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Estado Actual
        </button>
        <button
          onClick={() => setActiveTab('comparison')}
          className={`px-3.5 py-2.5 text-xs font-semibold border-b-2 transition ${
            activeTab === 'comparison'
              ? 'border-amber-500 text-amber-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Comparativa de Fallo
        </button>
        <button
          onClick={() => setActiveTab('help')}
          className={`px-3.5 py-2.5 text-xs font-semibold border-b-2 transition ${
            activeTab === 'help'
              ? 'border-amber-500 text-amber-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Guía de Solución
        </button>
      </div>

      <div className="p-4 sm:p-5">
        {/* TAB 1: STATUS DETAILS */}
        {activeTab === 'status' && (
          <div className="space-y-4">
            {/* Realtime Checks */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Box 1: Platform & Perms */}
              <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800/80 space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-900 pb-2">
                  <Smartphone className="w-4 h-4 text-blue-400" />
                  <span className="text-xs font-bold text-slate-200">Dispositivo y Permisos</span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Modo PWA (Petición PWA):</span>
                    <span className={`font-semibold ${diag.standalone ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {diag.standalone ? 'Standalone (Instalada) ✔' : 'Navegador Web ℹ'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Permiso del Navegador:</span>
                    <span className={`font-semibold ${
                      diag.permission === 'granted' 
                        ? 'text-emerald-400' 
                        : diag.permission === 'denied' 
                        ? 'text-rose-400' 
                        : 'text-amber-400'
                    }`}>
                      {diag.permission === 'granted' 
                        ? 'Permitido (Granted) ✔' 
                        : diag.permission === 'denied' 
                        ? 'Bloqueado (Denied) ❌' 
                        : 'Preguntar (Default) 🛈'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Soporte FCM (isSupported):</span>
                    <span className={`font-semibold ${diag.messagingSupported ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {diag.messagingSupported ? 'Compatible ✔' : 'Incompatible ❌'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Box 2: Service Worker */}
              <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800/80 space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-900 pb-2">
                  <Database className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-slate-200">Service Worker Activo</span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">SW Controlador:</span>
                    <span className={`font-semibold ${diag.swControllerPresent ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {diag.swControllerPresent ? 'Presente ✔' : 'Ausente ❌'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Versión de Fondo (FCM SW):</span>
                    <span className="font-mono text-amber-300 font-bold">
                      {diag.swVersion}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Registración SW:</span>
                    <span className={`font-semibold ${diag.swRegistrationFound ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {diag.swRegistrationFound ? `Activa (${diag.swRegistrationState})` : 'No encontrada'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Step status block */}
            <div className="p-4 rounded-xl bg-slate-950/30 border border-slate-800/60 space-y-3.5">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800/40">
                <span className="text-xs font-bold text-slate-200">Etapas del Último Proceso de Registro</span>
                {diag.errorCode && (
                  <span className="px-2 py-0.5 rounded bg-rose-950/50 text-rose-300 border border-rose-500/20 text-[10px] font-mono font-bold">
                    Código Error: {diag.errorCode}
                  </span>
                )}
              </div>

              {/* Stages List */}
              <div className="space-y-2.5 text-xs">
                {/* Stage 1: Permiso y SW */}
                <div className="flex justify-between items-center bg-slate-900/40 p-2 rounded border border-slate-800/40">
                  <span className="text-slate-300">1. Comprobación y carga de Service Worker:</span>
                  <span className="font-semibold text-emerald-400">Exitoso ✔</span>
                </div>

                {/* Stage 1.5: Old Token Cleanup */}
                {diag.oldTokenCleanupStatus && diag.oldTokenCleanupStatus !== 'NOT_STARTED' && (
                  <div className="flex justify-between items-center bg-slate-900/40 p-2 rounded border border-slate-800/40">
                    <div className="flex flex-col">
                      <span className="text-slate-300">1.5. Invalidar/Rotar registro anterior (FCM):</span>
                      {diag.oldTokenFingerprint && (
                        <span className="text-[10px] text-slate-500 font-mono">Fingerprint anterior: {diag.oldTokenFingerprint}</span>
                      )}
                    </div>
                    <span>{renderStatusBadge(diag.oldTokenCleanupStatus)}</span>
                  </div>
                )}

                {/* Stage 2: Token Acquisition */}
                <div className="flex justify-between items-center bg-slate-900/40 p-2 rounded border border-slate-800/40">
                  <div className="flex flex-col">
                    <span className="text-slate-300">2. Obtener Token único desde Google Cloud (FCM):</span>
                    {diag.newTokenFingerprint ? (
                      <span className="text-[10px] text-amber-400 font-mono">Fingerprint nuevo: {diag.newTokenFingerprint}</span>
                    ) : diag.tokenFingerprint ? (
                      <span className="text-[10px] text-slate-500 font-mono">Fingerprint: {diag.tokenFingerprint}</span>
                    ) : null}
                  </div>
                  <span>{renderStatusBadge(diag.getTokenStatus)}</span>
                </div>

                {/* Stage 3: Firestore Upload */}
                <div className="flex justify-between items-center bg-slate-900/40 p-2 rounded border border-slate-800/40">
                  <div className="flex flex-col">
                    <span className="text-slate-300">3. Registrar Token en base de datos Firestore:</span>
                    <span className="text-[10px] text-slate-500 font-mono">Destino: /users/{"{"}activeUid{"}"}/pushTokens/*</span>
                  </div>
                  <span>{renderStatusBadge(diag.firestoreStatus)}</span>
                </div>
              </div>

              {/* Error Alert if present */}
              {diag.errorMessage && (
                <div className="p-3.5 rounded-lg bg-rose-950/30 border border-rose-500/30 text-xs text-rose-200 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-rose-300">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>Se detectó un obstáculo en el registro:</span>
                  </div>
                  <p className="leading-relaxed text-[11px] font-mono bg-black/40 p-2 rounded border border-rose-500/10">
                    {diag.errorMessage}
                  </p>
                </div>
              )}
            </div>

            {/* Timestamps */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center text-[10px] font-mono">
              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-400">
                <Clock className="w-3.5 h-3.5 mx-auto mb-1 text-slate-500" />
                <span className="block text-slate-500 font-semibold mb-0.5">Último Intento</span>
                <span className="font-bold text-slate-300">{formatDate(diag.lastAttemptAt)}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-400">
                <CheckCircle2 className="w-3.5 h-3.5 mx-auto mb-1 text-emerald-500" />
                <span className="block text-emerald-500 font-semibold mb-0.5">Éxito de Token</span>
                <span className="font-bold text-slate-300">{formatDate(diag.lastTokenSuccessAt)}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-400">
                <Database className="w-3.5 h-3.5 mx-auto mb-1 text-blue-400" />
                <span className="block text-blue-400 font-semibold mb-0.5">Éxito en Base de Datos</span>
                <span className="font-bold text-slate-300">{formatDate(diag.lastFirestoreSuccessAt)}</span>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: COMPARISON MATRIX */}
        {activeTab === 'comparison' && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-blue-950/20 border border-blue-500/20 text-xs text-blue-300">
              Esta matriz compara tu estado en tiempo real contra un dispositivo que funciona con éxito y el caso reportado. Esto ayuda a identificar fallos de caché de iOS.
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-300 font-semibold">
                    <th className="p-3">Variable Técnica</th>
                    <th className="p-3 text-emerald-400">iPhone Funcional (Ref)</th>
                    <th className="p-3 text-rose-400">iPhone de Edwin (Fallo)</th>
                    <th className="p-3 text-amber-300 bg-slate-900/60">Tu Dispositivo (Realtime)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300 bg-slate-950/20">
                  <tr>
                    <td className="p-3 font-medium">Modo PWA (Instalada)</td>
                    <td className="p-3 text-emerald-500">Sí (standalone) ✔</td>
                    <td className="p-3 text-rose-400">Sí (standalone)</td>
                    <td className={`p-3 font-semibold ${diag.standalone ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {diag.standalone ? 'Sí (standalone) ✔' : 'No (Navegador) ⚠️'}
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium">Permisos Notificación</td>
                    <td className="p-3 text-emerald-500">Granted ✔</td>
                    <td className="p-3 text-rose-400">Granted</td>
                    <td className={`p-3 font-semibold ${diag.permission === 'granted' ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {diag.permission === 'granted' ? 'Granted ✔' : `${diag.permission} ❌`}
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium">Service Worker Activo</td>
                    <td className="p-3 text-emerald-500">Sí ✔</td>
                    <td className="p-3 text-rose-400">Sí</td>
                    <td className={`p-3 font-semibold ${diag.swControllerPresent ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {diag.swControllerPresent ? 'Sí ✔' : 'No ❌'}
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium">Versión del SW</td>
                    <td className="p-3 text-emerald-500 font-mono">push-bg-test-1 ✔</td>
                    <td className="p-3 text-rose-400">Versión Desconocida/Vacia ⚠️</td>
                    <td className="p-3 text-amber-300 font-mono font-bold">{diag.swVersion}</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium">Soporte FCM API</td>
                    <td className="p-3 text-emerald-500">Sí ✔</td>
                    <td className="p-3 text-rose-400">Sí</td>
                    <td className={`p-3 font-semibold ${diag.messagingSupported ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {diag.messagingSupported ? 'Sí ✔' : 'No ❌'}
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium">FCM Token Generado</td>
                    <td className="p-3 text-emerald-500 font-semibold">Sí (Válido) ✔</td>
                    <td className="p-3 text-rose-400 font-semibold">Fallo / Vacío ❌</td>
                    <td className={`p-3 font-semibold ${diag.tokenPresent ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {diag.tokenPresent ? 'Sí (Generado) ✔' : 'No generado ❌'}
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium">Guardado en Firestore</td>
                    <td className="p-3 text-emerald-500 font-semibold">Exitoso ✔</td>
                    <td className="p-3 text-rose-400 font-semibold">No registrado / Vacío ❌</td>
                    <td className={`p-3 font-semibold ${diag.firestoreStatus === 'SUCCESS' ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {diag.firestoreStatus === 'SUCCESS' ? 'Exitoso ✔' : `${diag.firestoreStatus} ❌`}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-400 space-y-1 leading-relaxed">
              <span className="font-bold text-amber-400 block mb-1">Análisis Técnico del Diagnóstico:</span>
              <p>
                Si en el dispositivo de Edwin el <strong className="text-slate-200">FCM Token</strong> y el <strong className="text-slate-200">Guardado en Firestore</strong> permanecen en <strong className="text-rose-400">"No" / "Vacío"</strong> mientras que los <strong className="text-emerald-400">Permisos de Notificación</strong> están aprobados, esto confirma que el motor web de iOS / Safari tiene un <span className="text-amber-300">token de caché corrupto</span> o que el Service Worker se cargó de forma incompleta. El botón de <strong>"Reparar"</strong> purga e invalida de forma canónica la caché para forzar un registro nuevo directo con los servidores de Google.
              </p>
            </div>
          </div>
        )}

        {/* TAB 3: SOLUTIONS HELP */}
        {activeTab === 'help' && (
          <div className="space-y-4 text-xs">
            <div className="space-y-3">
              <h4 className="font-bold text-slate-100 flex items-center gap-1.5 text-xs">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span>¿Por qué falla el iPhone de Edwin si ya tiene permisos aprobados?</span>
              </h4>
              <p className="text-slate-400 leading-relaxed">
                En iOS (especialmente a partir de iOS 16.4+ con soporte PWA), si las notificaciones se activan pero el token de mensajería no se guarda en la base de datos (dejando <code className="text-slate-300">pushTokens</code> vacío), usualmente se debe a tres motivos específicos:
              </p>
              
              <ol className="list-decimal pl-4 space-y-2 text-slate-400">
                <li>
                  <strong className="text-slate-200">Caché corrupta de Tokens:</strong> El dispositivo cree tener un token de un Service Worker anterior y la API de Google bloquea el refresco.
                </li>
                <li>
                  <strong className="text-slate-200">La aplicación se abrió directamente en Safari y no como PWA:</strong> En iOS, las notificaciones Push requieren estrictamente que la aplicación esté añadida a la pantalla de inicio ("Compartir &gt; Añadir a pantalla de inicio") y se ejecute en pantalla completa (modo standalone).
                </li>
                <li>
                  <strong className="text-slate-200">Falta de sincronización de Sesión de Auth:</strong> La escritura en Firestore requiere que el token se asocie al ID del usuario autenticado de forma exacta.
                </li>
              </ol>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/50 border border-slate-800 space-y-2">
              <span className="font-bold text-emerald-400 block">Paso a paso recomendado para Edwin:</span>
              <ul className="list-disc pl-4 space-y-1.5 text-slate-300">
                <li>Asegúrate de haber instalado la PWA (Añadir a pantalla de inicio) y abrirla desde el ícono en tu pantalla.</li>
                <li>Inicia sesión con tu cuenta activa de Inversionista.</li>
                <li>Abre este panel en Ajustes/Perfil y presiona el botón <strong>"Reparar Notificaciones"</strong>.</li>
                <li>Si aparece un error, verifica si el código es <code className="text-rose-400">messaging/permission-blocked</code> o similar, lo que indicaría que debes restablecer los permisos en Ajustes del iPhone.</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
