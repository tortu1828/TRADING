import React, { useState, useEffect } from 'react';
import {
  LogIn,
  KeyRound,
  UserPlus,
  AlertCircle,
  CheckCircle2,
  Check,
  Lock,
  Mail,
  ArrowRight,
  Eye,
  EyeOff,
  ArrowLeft,
  HelpCircle,
  ShieldCheck,
  Send,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { EasyTradersLogo } from './EasyTradersLogo';
import { dataStore } from '../lib/dataStore';
import { sendFirebasePasswordReset } from '../lib/firebase';
import { firestoreService } from '../lib/firestoreService';

interface LoginViewProps {
  onSuccess?: () => void;
  initialMode?: 'login' | 'claim' | 'apply' | 'recovery';
}

export const LoginView: React.FC<LoginViewProps> = ({ onSuccess, initialMode = 'login' }) => {
  const { loginWithCredentials, claimAccount } = useAuth();
  const [currentMode, setCurrentMode] = useState<'login' | 'claim' | 'apply' | 'recovery'>(initialMode);

  // Read URL query parameters on mount to support direct shareable links
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const modeParam = params.get('mode') || params.get('tab') || params.get('action');
      const codeParam = params.get('code') || params.get('userCode') || params.get('activate');

      if (modeParam === 'activate' || modeParam === 'claim' || !!codeParam) {
        setCurrentMode('claim');
        if (codeParam && typeof codeParam === 'string' && codeParam !== 'true') {
          setClaimCode(codeParam);
        }
      } else if (modeParam === 'apply' || modeParam === 'admision' || modeParam === 'postulacion') {
        setCurrentMode('apply');
      } else if (modeParam === 'recovery' || modeParam === 'reset' || modeParam === 'olvide') {
        setCurrentMode('recovery');
      }
    }
  }, []);

  // Update browser URL query param without full reload when switching modes
  const handleSwitchMode = (mode: 'login' | 'claim' | 'apply' | 'recovery') => {
    setCurrentMode(mode);
    setLoginError(null);
    setClaimError(null);
    setClaimToken('');
    setClaimEmail(''); // Limpieza inmediata de token plaintext en memoria React
    setApplyError(null);
    setRecoveryError(null);
    setRecoverySuccess(null);

    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (mode === 'login') {
        url.searchParams.delete('mode');
        url.searchParams.delete('code');
        url.searchParams.delete('token');
      } else {
        url.searchParams.set('mode', mode);
        url.searchParams.delete('token');
      }
      window.history.replaceState({}, '', url.toString());
    }
  };

  // Login form state
  const [emailOrCode, setEmailOrCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSuccess, setLoginSuccess] = useState<string | null>(null);

  // Recovery form state
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoverySuccess, setRecoverySuccess] = useState<string | null>(null);

  // Claim account state (existing bitácora user)
  const [claimCode, setClaimCode] = useState('');
  const [claimToken, setClaimToken] = useState('');
  const [claimEmail, setClaimEmail] = useState('');
  const [claimPassword, setClaimPassword] = useState('');
  const [claimConfirmPassword, setClaimConfirmPassword] = useState('');
  const [showClaimPassword, setShowClaimPassword] = useState(false);
  const [showClaimConfirmPassword, setShowClaimConfirmPassword] = useState(false);
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimSuccessMsg, setClaimSuccessMsg] = useState<string | null>(null);

  // Apply state (new investor FIFO)
  const [applyName, setApplyName] = useState('');
  const [applyDoc, setApplyDoc] = useState('');
  const [applyPhone, setApplyPhone] = useState('');
  const [applyEmail, setApplyEmail] = useState('');
  const [applyCapitalStr, setApplyCapitalStr] = useState('8.000.000');
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

  // Handle Password Recovery (Firebase Auth Reset)
  const handleRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryError(null);
    setRecoverySuccess(null);

    const cleanInput = recoveryEmail.trim();
    if (!cleanInput) {
      setRecoveryError('Por favor ingresa tu correo electrónico registrado.');
      return;
    }

    setRecoveryLoading(true);
    try {
      let targetEmail = cleanInput;

      // If user typed an investor code or document instead of an email, look it up in dataStore
      if (!cleanInput.includes('@')) {
        const found = dataStore.getUsers().find(
          (u) =>
            (u.userCode && u.userCode.toUpperCase() === cleanInput.toUpperCase()) ||
            (u.documentId && u.documentId.trim() === cleanInput)
        );
        if (found && found.email) {
          targetEmail = found.email;
        } else {
          setRecoveryError('No se encontró ningún usuario con ese código o cédula. Ingresa tu correo electrónico.');
          setRecoveryLoading(false);
          return;
        }
      }

      const res = await sendFirebasePasswordReset(targetEmail);
      if (res.success) {
        setRecoverySuccess(res.message);
      } else {
        setRecoveryError(res.message);
      }
    } catch (err: any) {
      setRecoveryError(err?.message || 'Error al solicitar el restablecimiento de contraseña.');
    } finally {
      setRecoveryLoading(false);
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
    if (!claimToken.trim()) {
      setClaimError('Ingresa el token de activación suministrado por administración.');
      return;
    }
    if (!claimCode.trim()) {
      setClaimError('Ingresa tu código de inversionista o documento.');
      return;
    }
    if (!claimToken.trim()) {
      setClaimError('Ingresa el token de activación que te fue asignado.');
      return;
    }
    const cleanClaimEmail =
      claimEmail
        .trim()
        .toLowerCase();

    const claimEmailRegex =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (
      !cleanClaimEmail ||
      !claimEmailRegex.test(cleanClaimEmail)
    ) {
      setClaimError(
        'Ingresa un correo electrónico válido para activar tu cuenta.'
      );
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
    const codeToSubmit = claimCode.trim();
    const tokenToSubmit = claimToken.trim();
    const emailToSubmit =
      claimEmail
        .trim()
        .toLowerCase();
    const passToSubmit = claimPassword;
    // Limpieza inmediata del token en texto claro y contraseñas de la memoria del componente
    setClaimToken('');
    setClaimPassword('');
    setClaimConfirmPassword('');

    try {
      const res = await claimAccount(
        codeToSubmit,
        tokenToSubmit,
        emailToSubmit,
        passToSubmit
      );
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

  // Handle Apply (FIFO Application via Backend Callable)
  const handleApply = async (e: React.FormEvent) => {
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

    const numericCapital = parseInt(applyCapitalStr.replace(/[^0-9]/g, ''), 10) || 0;
    if (numericCapital < 4_000_000) {
      setApplyError('El capital mínimo para solicitar admisión es de $4.000.000 COP.');
      return;
    }

    setApplyLoading(true);
    try {
      const result = await firestoreService.submitApplicationCallable({
        fullName: applyName.trim(),
        documentId: applyDoc.trim(),
        email: applyEmail.trim().toLowerCase(),
        phone: applyPhone.trim(),
        city: 'Medellín',
        requestedCapitalCop: numericCapital,
        originBank: applyBank,
        priorityNotes: 'Postulación desde Formulario de Admisión Web',
      });

      if (result.success) {
        setApplySuccessTurn(result.queuePosition);
      } else {
        setApplyError('No se pudo procesar la solicitud.');
      }
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

      {/* Main Card Container */}
      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl relative z-10 space-y-6">
        {/* Header Branding */}
        <div className="text-center space-y-2">
          <div className="flex justify-center mb-2">
            <EasyTradersLogo variant="portal" />
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-100 tracking-tight">
            {currentMode === 'login' && 'Acceso Institucional'}
            {currentMode === 'recovery' && 'Recuperar Contraseña'}
            {currentMode === 'claim' && 'Activar Cuenta de Inversionista'}
            {currentMode === 'apply' && 'Solicitud de Admisión'}
          </h1>
          <p className="text-xs text-slate-400">
            {currentMode === 'login' && 'Mesa de Operaciones y Liquidaciones de Capital'}
            {currentMode === 'recovery' && 'Restablece tu acceso institucional de forma segura'}
            {currentMode === 'claim' && 'Vinculación de credenciales oficiales para inversionistas'}
            {currentMode === 'apply' && 'Postulación de nuevos inversionistas por orden FIFO'}
          </p>
        </div>

        {/* ============================================================ */}
        {/* 1. MODO: INICIAR SESIÓN (Puro, sin pestañas intermedias) */}
        {/* ============================================================ */}
        {currentMode === 'login' && (
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
                placeholder="ej. usuario@easytraders24.app o USR-00001"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-amber-500 transition"
                required
                autoComplete="username"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  Contraseña
                </label>
                <button
                  type="button"
                  onClick={() => handleSwitchMode('recovery')}
                  className="text-[11px] text-amber-400 hover:text-amber-300 transition hover:underline cursor-pointer"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>

              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-amber-500 transition"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 transition cursor-pointer"
                  title={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4 text-amber-400" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-bold text-sm shadow-lg shadow-amber-950/40 flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 mt-2"
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

            {/* Subtle Onboarding & Help Links */}
            <div className="pt-4 border-t border-slate-800/80 flex flex-col items-center gap-2 text-xs text-slate-400">
              <button
                type="button"
                onClick={() => handleSwitchMode('claim')}
                className="text-emerald-400 hover:text-emerald-300 font-medium transition hover:underline flex items-center gap-1.5 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>¿Tienes un código asignado? Activar cuenta aquí</span>
              </button>
              <button
                type="button"
                onClick={() => handleSwitchMode('apply')}
                className="text-blue-400 hover:text-blue-300 font-medium transition hover:underline flex items-center gap-1.5 cursor-pointer text-[11px]"
              >
                <UserPlus className="w-3 h-3" />
                <span>¿Deseas postularte? Formulario de Admisión</span>
              </button>
            </div>
          </form>
        )}

        {/* ============================================================ */}
        {/* 2. MODO: RECUPERAR CONTRASEÑA */}
        {/* ============================================================ */}
        {currentMode === 'recovery' && (
          <form onSubmit={handleRecovery} className="space-y-4 animate-in fade-in duration-200">
            <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/20 text-xs text-amber-300 leading-relaxed">
              Ingresa el correo electrónico registrado con tu cuenta (o tu código de inversionista). Te enviaremos un enlace oficial de Firebase para restablecer tu contraseña.
            </div>

            {recoveryError && (
              <div className="p-3.5 rounded-xl bg-red-950/50 border border-red-500/40 flex items-start gap-2.5 text-xs text-red-300">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{recoveryError}</span>
              </div>
            )}

            {recoverySuccess && (
              <div className="p-3.5 rounded-xl bg-emerald-950/50 border border-emerald-500/40 flex items-start gap-2.5 text-xs text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{recoverySuccess}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-amber-400" />
                Correo Electrónico o Código de Inversionista
              </label>
              <input
                type="text"
                value={recoveryEmail}
                onChange={(e) => setRecoveryEmail(e.target.value)}
                placeholder="ej. inversionista@ejemplo.com o USR-00001"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-amber-500 transition"
                required
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={recoveryLoading}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-bold text-sm shadow-lg shadow-amber-950/40 flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
            >
              {recoveryLoading ? (
                <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Enviar Enlace de Recuperación</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleSwitchMode('login')}
              className="w-full py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Volver a Iniciar Sesión</span>
            </button>
          </form>
        )}

        {/* ============================================================ */}
        {/* 3. MODO: ACTIVAR CUENTA (Formulario dedicado con link directo) */}
        {/* ============================================================ */}
        {currentMode === 'claim' && (
          <form onSubmit={handleClaim} className="space-y-4 animate-in fade-in duration-200">
            <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/20 text-xs text-emerald-300 leading-relaxed">
              Inversionistas que ya figuran en las bitácoras pueden activar su acceso personal ingresando su código oficial asignado y definiendo su contraseña segura.
            </div>

            {claimError && (
              <div className="p-3.5 rounded-xl bg-red-950/50 border border-red-500/40 flex items-start gap-2.5 text-xs text-red-300">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{claimError}</span>
              </div>
            )}

            {claimSuccessMsg && (
              <div className="p-3.5 rounded-xl bg-emerald-950/50 border border-emerald-500/40 flex items-start gap-2.5 text-xs text-emerald-300">
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
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300">
                  Token de Activación Seguro
                </label>
                <span className="text-[10px] text-amber-400 font-medium">Suministrado por Tesorería</span>
              </div>
              <input
                type="text"
                value={claimToken}
                onChange={(e) => setClaimToken(e.target.value)}
                placeholder="ej. 64 caracteres hex o entregado por admin"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 transition font-mono"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-emerald-400" />
                Correo Electrónico Personal
              </label>

              <input
                type="email"
                value={claimEmail}
                onChange={(e) => setClaimEmail(e.target.value)}
                placeholder="ej. inversionista@gmail.com"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 transition"
                required
                autoComplete="email"
              />

              <p className="text-[10px] text-slate-500 leading-relaxed">
                Este será el correo definitivo que usarás para iniciar sesión.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Crea tu Contraseña
              </label>
              <div className="relative">
                <input
                  type={showClaimPassword ? 'text' : 'password'}
                  value={claimPassword}
                  onChange={(e) => setClaimPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 transition"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowClaimPassword(!showClaimPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 transition cursor-pointer"
                  title={showClaimPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                  tabIndex={-1}
                >
                  {showClaimPassword ? <EyeOff className="w-4 h-4 text-emerald-400" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Confirmar Contraseña
              </label>
              <div className="relative">
                <input
                  type={showClaimConfirmPassword ? 'text' : 'password'}
                  value={claimConfirmPassword}
                  onChange={(e) => setClaimConfirmPassword(e.target.value)}
                  placeholder="Repite la contraseña"
                  className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 transition"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowClaimConfirmPassword(!showClaimConfirmPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 transition cursor-pointer"
                  title={showClaimConfirmPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                  tabIndex={-1}
                >
                  {showClaimConfirmPassword ? <EyeOff className="w-4 h-4 text-emerald-400" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
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

            <button
              type="button"
              onClick={() => handleSwitchMode('login')}
              className="w-full py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Volver a Iniciar Sesión</span>
            </button>
          </form>
        )}

        {/* ============================================================ */}
        {/* 4. MODO: ADMISIÓN FIFO (Formulario dedicado con link directo) */}
        {/* ============================================================ */}
        {currentMode === 'apply' && (
          <div className="animate-in fade-in duration-200">
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
                  Tu postulación ha entrado a la lista oficial por orden de llegada (FIFO). El equipo de administración revisará tus datos y te contactará por WhatsApp para la formalización.
                </p>
                <button
                  onClick={() => {
                    setApplySuccessTurn(null);
                    handleSwitchMode('login');
                  }}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
                >
                  Volver al Inicio de Sesión
                </button>
              </div>
            ) : (
              <form onSubmit={handleApply} className="space-y-3.5">
                <div className="p-3 rounded-xl bg-blue-950/30 border border-blue-500/20 text-xs text-blue-300">
                  Las admisiones se procesan por estricto orden de llegada. Completa tus datos para ingresar al cupo oficial.
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
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-amber-400 font-bold text-xs">
                        $
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={applyCapitalStr}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^0-9]/g, '');
                          if (!raw) {
                            setApplyCapitalStr('');
                            return;
                          }
                          const num = parseInt(raw, 10);
                          setApplyCapitalStr(num.toLocaleString('es-CO'));
                        }}
                        placeholder="Ej: 8.000.000"
                        className="w-full pl-6 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs font-mono focus:outline-none focus:border-blue-500"
                        required
                      />
                    </div>
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
                      <span>Postularme en Admisión</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleSwitchMode('login')}
                  className="w-full py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Volver a Iniciar Sesión</span>
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 text-center text-xs text-slate-500 font-medium tracking-wide">
        EasyTraders24
      </div>
    </div>
  );
};

