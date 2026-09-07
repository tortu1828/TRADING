import React, { useState } from 'react';
import {
  LogIn,
  KeyRound,
  UserPlus,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Lock,
  Mail,
  ArrowRight,
  Sparkles,
  Building2,
  Clock,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { EasyTradersLogo } from './EasyTradersLogo';
import { dataStore } from '../lib/dataStore';
import { ensureAutoNotificationPermission } from '../lib/pushNotifications';

interface LoginViewProps {
  onSuccess?: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onSuccess }) => {
  const { loginWithCredentials, claimAccount } = useAuth();
  const [activeTab, setActiveTab] = useState<'login' | 'claim' | 'apply'>('login');

  // Pedir permisos de notificación de inmediato al cargar la pantalla de login
  React.useEffect(() => {
    ensureAutoNotificationPermission().catch(() => {});
  }, []);

  // Login form state
  const [emailOrCode, setEmailOrCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSuccess, setLoginSuccess] = useState<string | null>(null);

  // Claim account state (existing bitácora user)
  const [claimCode, setClaimCode] = useState('');
  const [claimEmail, setClaimEmail] = useState('');
  const [claimPassword, setClaimPassword] = useState('');
  const [claimConfirmPassword, setClaimConfirmPassword] = useState('');
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimSuccessMsg, setClaimSuccessMsg] = useState<string | null>(null);

  // Apply state (new investor FIFO)
  const [applyName, setApplyName] = useState('');
  const [applyDoc, setApplyDoc] = useState('');
  const [applyPhone, setApplyPhone] = useState('');
  const [applyEmail, setApplyEmail] = useState('');
  const [applyCapital, setApplyCapital] = useState(8_000_000);
  const [applyBank, setApplyBank] = useState('Bancolombia');
  const [applyLoading, setApplyLoading] = useState(false);
  const [applySuccessTurn, setApplySuccessTurn] = useState<number | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Handle Login Submit (Firebase Auth)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginSuccess(null);

    if (!emailOrCode.trim()) {
      setLoginError('Ingresa tu correo electrónico o código de inversionista.');
      return;
    }
    if (!password) {
      setLoginError('Ingresa tu contraseña.');
      return;
    }

    setLoading(true);
    try {
      const res = await loginWithCredentials(emailOrCode.trim(), password);
      if (res.success) {
        setLoginSuccess(res.message || 'Inicio de sesión exitoso.');
        if (onSuccess) onSuccess();
      } else {
        setLoginError(res.message || 'Credenciales inválidas.');
      }
    } catch (err: any) {
      setLoginError(err?.message || 'Error al conectar con el servidor de autenticación.');
    } finally {
      setLoading(false);
    }
  };

  // Handle Claim Account (Existing Investor)
  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setClaimError(null);
    setClaimSuccessMsg(null);

    if (!claimCode.trim()) {
      setClaimError('Ingresa tu código oficial de inversionista o documento.');
      return;
    }
    if (!claimEmail.trim() || !claimEmail.includes('@')) {
      setClaimError('Ingresa un correo electrónico válido.');
      return;
    }
    if (claimPassword.length < 6) {
      setClaimError('La contraseña debe contener al menos 6 caracteres.');
      return;
    }
    if (claimPassword !== claimConfirmPassword) {
      setClaimError('Las contraseñas no coinciden.');
      return;
    }

    setClaimLoading(true);
    try {
      const res = claimAccount(claimCode.trim(), claimEmail.trim(), claimPassword);
      if (res.success) {
        setClaimSuccessMsg(res.message || 'Cuenta activada exitosamente.');
        if (onSuccess) onSuccess();
      } else {
        setClaimError(res.message);
      }
    } catch (err: any) {
      setClaimError(err?.message || 'Error al activar la cuenta.');
    } finally {
      setClaimLoading(false);
    }
  };

  // Handle Apply (FIFO Application)
  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    setApplyError(null);

    if (!applyName.trim()) {
      setApplyError('Por favor ingresa tu nombre completo.');
      return;
    }
    if (!applyDoc.trim()) {
      setApplyError('Por favor ingresa tu número de documento.');
      return;
    }
    if (!applyPhone.trim()) {
      setApplyError('Por favor ingresa tu número de WhatsApp.');
      return;
    }
    if (!applyEmail.trim() || !applyEmail.includes('@')) {
      setApplyError('Por favor ingresa un correo electrónico válido.');
      return;
    }

    setApplyLoading(true);
    try {
      const result = dataStore.createApplication({
        fullName: applyName.trim(),
        documentId: applyDoc.trim(),
        email: applyEmail.trim(),
        phone: applyPhone.trim(),
        city: 'Medellín',
        requestedCapitalCop: applyCapital,
        originBank: applyBank,
        priorityNotes: 'Postulación desde Portal Web',
        source: 'WEB_FORM',
      });

      setApplySuccessTurn(result.queuePosition);
    } catch (err: any) {
      setApplyError(err?.message || 'Error al enviar la solicitud.');
    } finally {
      setApplyLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#05080f] flex flex-col justify-center items-center px-4 py-8 relative overflow-y-auto">
      {/* Background Ambience Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-1/4 w-80 h-80 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main Login Card */}
      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl relative z-10 space-y-6">
        {/* Header Branding */}
        <div className="text-center space-y-2">
          <div className="flex justify-center mb-2">
            <EasyTradersLogo variant="portal" />
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-100 tracking-tight">
            Acceso Institucional Seguro
          </h1>
          <p className="text-xs text-slate-400">
            Mesa de Operaciones y Liquidaciones de Capital
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1.5 rounded-xl border border-slate-800 text-xs font-semibold">
          <button
            type="button"
            onClick={() => {
              setActiveTab('login');
              setLoginError(null);
            }}
            className={`py-2 rounded-lg transition text-center cursor-pointer ${
              activeTab === 'login'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Iniciar Sesión
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('claim');
              setClaimError(null);
            }}
            className={`py-2 rounded-lg transition text-center cursor-pointer ${
              activeTab === 'claim'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Activar Cuenta
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('apply');
              setApplyError(null);
            }}
            className={`py-2 rounded-lg transition text-center cursor-pointer ${
              activeTab === 'apply'
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Admisión Normal
          </button>
        </div>

        {/* TAB 1: INICIAR SESIÓN (FIREBASE AUTH) */}
        {activeTab === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            {loginError && (
              <div className="p-3.5 rounded-xl bg-red-950/50 border border-red-500/40 flex items-start gap-2.5 text-xs text-red-300 animate-in fade-in">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{loginError}</span>
              </div>
            )}

            {loginSuccess && (
              <div className="p-3.5 rounded-xl bg-emerald-950/50 border border-emerald-500/40 flex items-start gap-2.5 text-xs text-emerald-300 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{loginSuccess}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-amber-400" />
                Correo Electrónico o Código
              </label>
              <input
                type="text"
                value={emailOrCode}
                onChange={(e) => setEmailOrCode(e.target.value)}
                placeholder="ej. usuario@easytraders.com o USR-00001"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-amber-500 transition"
                required
                autoComplete="email"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-amber-500 transition"
                required
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-bold text-sm shadow-lg shadow-amber-950/40 flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>Ingresar de Forma Segura</span>
                </>
              )}
            </button>

            <div className="pt-2 text-center">
              <p className="text-[11px] text-slate-500">
                Protegido con Firebase Authentication & TLS 256-bit.
              </p>
            </div>
          </form>
        )}

        {/* TAB 2: ACTIVAR CUENTA (INVERSIONISTAS EXISTENTES) */}
        {activeTab === 'claim' && (
          <form onSubmit={handleClaim} className="space-y-4">
            <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/20 text-xs text-emerald-300">
              Inversionistas que ya figuren en las bitácoras pueden vincular su correo personal y definir su contraseña aquí.
            </div>

            {claimError && (
              <div className="p-3 rounded-xl bg-red-950/50 border border-red-500/40 flex items-start gap-2.5 text-xs text-red-300">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{claimError}</span>
              </div>
            )}

            {claimSuccessMsg && (
              <div className="p-3 rounded-xl bg-emerald-950/50 border border-emerald-500/40 flex items-start gap-2.5 text-xs text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{claimSuccessMsg}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Código de Inversionista o Cédula
              </label>
              <input
                type="text"
                value={claimCode}
                onChange={(e) => setClaimCode(e.target.value)}
                placeholder="ej. USR-00001 o 1037654321"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 transition font-mono"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Tu Correo Electrónico
              </label>
              <input
                type="email"
                value={claimEmail}
                onChange={(e) => setClaimEmail(e.target.value)}
                placeholder="inversionista@ejemplo.com"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 transition"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Crea tu Contraseña
              </label>
              <input
                type="password"
                value={claimPassword}
                onChange={(e) => setClaimPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 transition"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Confirmar Contraseña
              </label>
              <input
                type="password"
                value={claimConfirmPassword}
                onChange={(e) => setClaimConfirmPassword(e.target.value)}
                placeholder="Repite la contraseña"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 transition"
                required
              />
            </div>

            <button
              type="submit"
              disabled={claimLoading}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm shadow-lg shadow-emerald-950/40 flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
            >
              {claimLoading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  <span>Activar y Entrar al Portal</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* TAB 3: ADMISIÓN FIFO (NUEVOS INVERSIONISTAS) */}
        {activeTab === 'apply' && (
          <div>
            {applySuccessTurn ? (
              <div className="p-5 rounded-2xl bg-slate-950 border border-blue-500/40 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400 mx-auto">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-slate-100">
                  ¡Solicitud Registrada!
                </h3>
                <div className="inline-block px-3 py-1 rounded-full bg-blue-950 text-blue-300 font-mono font-bold text-xs border border-blue-500/30">
                  Turno Oficial: #{applySuccessTurn}
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Tu solicitud ha entrado a la lista oficial por orden de llegada. El administrador revisará y te contactará por WhatsApp para la formalización.
                </p>
                <button
                  onClick={() => {
                    setApplySuccessTurn(null);
                    setActiveTab('login');
                  }}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
                >
                  Volver al Inicio de Sesión
                </button>
              </div>
            ) : (
              <form onSubmit={handleApply} className="space-y-3.5">
                <div className="p-3 rounded-xl bg-blue-950/30 border border-blue-500/20 text-xs text-blue-300">
                  Las admisiones se procesan por orden de llegada.
                </div>

                {applyError && (
                  <div className="p-3 rounded-xl bg-red-950/50 border border-red-500/40 text-xs text-red-300">
                    {applyError}
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Nombre Completo</label>
                  <input
                    type="text"
                    value={applyName}
                    onChange={(e) => setApplyName(e.target.value)}
                    placeholder="ej. Carlos Arturo Valencia"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">Documento</label>
                    <input
                      type="text"
                      value={applyDoc}
                      onChange={(e) => setApplyDoc(e.target.value)}
                      placeholder="Cédula"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">WhatsApp</label>
                    <input
                      type="tel"
                      value={applyPhone}
                      onChange={(e) => setApplyPhone(e.target.value)}
                      placeholder="+57 300..."
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Correo Electrónico</label>
                  <input
                    type="email"
                    value={applyEmail}
                    onChange={(e) => setApplyEmail(e.target.value)}
                    placeholder="correo@ejemplo.com"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">Capital Proyectado (COP)</label>
                    <input
                      type="number"
                      value={applyCapital}
                      onChange={(e) => setApplyCapital(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs font-mono focus:outline-none focus:border-blue-500"
                      min={1000000}
                      step={500000}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">Banco Receptor</label>
                    <select
                      value={applyBank}
                      onChange={(e) => setApplyBank(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-blue-500"
                    >
                      <option value="Bancolombia">Bancolombia</option>
                      <option value="Davivienda">Davivienda</option>
                      <option value="Nequi">Nequi</option>
                      <option value="BBVA">BBVA</option>
                      <option value="Banco de Bogotá">Banco de Bogotá</option>
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={applyLoading}
                  className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-blue-950/40 flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                >
                  {applyLoading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Postularme en Admisión Normal</span>
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 text-center text-xs text-slate-600">
        EASYTRADERS • Gestor de Capital y Liquidaciones v2.1 • Todos los derechos reservados
      </div>
    </div>
  );
};
