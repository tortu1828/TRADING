import React, { useState } from 'react';
import {
  KeyRound,
  UserCheck,
  UserPlus,
  LogIn,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Copy,
  Check,
  Building2,
  Phone,
  Mail,
  DollarSign,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dataStore } from '../lib/dataStore';
import { firestoreService } from '../lib/firestoreService';
import { UserProfile } from '../types';
import { getCategoryForCapital } from '../lib/financialEngine';
import { getAppBaseUrl } from '../lib/constants';

interface AccessGatewayModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'login' | 'claim' | 'apply';
}

export const AccessGatewayModal: React.FC<AccessGatewayModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'login',
}) => {
  const { loginWithCredentials, claimAccount, currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'login' | 'claim' | 'apply'>(initialTab);

  // Tab 1: Login
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  // Tab 2: Claim / Activación
  const [claimIdentifier, setClaimIdentifier] = useState('');
  const [foundUser, setFoundUser] = useState<UserProfile | null>(null);
  const [claimActivationToken, setClaimActivationToken] = useState('');
  const [claimEmail, setClaimEmail] = useState('');
  const [claimPassword, setClaimPassword] = useState('');
  const [claimConfirmPassword, setClaimConfirmPassword] = useState('');
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState(false);

  // Tab 3: Postulación de Nuevo Inversionista
  const [applyName, setApplyName] = useState('');
  const [applyDoc, setApplyDoc] = useState('');
  const [applyPhone, setApplyPhone] = useState('');
  const [applyEmail, setApplyEmail] = useState('');
  const [applyCity, setApplyCity] = useState('Medellín');
  const [applyCapitalStr, setApplyCapitalStr] = useState('8.000.000');
  const [applyBank, setApplyBank] = useState('Bancolombia');
  const [applyNotes, setApplyNotes] = useState('');
  const [applySuccessTurn, setApplySuccessTurn] = useState<number | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Copiado
  const [copiedLink, setCopiedLink] = useState(false);

  if (!isOpen) return null;

  // Manejar Login
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!loginIdentifier.trim()) {
      setLoginError('Ingresa tu código de inversionista o correo electrónico.');
      return;
    }

    const res = await loginWithCredentials(loginIdentifier, loginPassword);
    if (res.success) {
      onClose();
    } else {
      setLoginError(res.message);
    }
  };

  // Buscar cuenta para vincular (Paso 1 del Claim)
  const handleSearchAccountToClaim = async () => {
    setClaimError(null);
    setFoundUser(null);
    if (!claimIdentifier.trim()) {
      setClaimError('Ingresa tu código de inversionista (ej. USR-8F29K) o número de cédula.');
      return;
    }

    const clean = claimIdentifier.trim().toUpperCase();
    let user = dataStore.getUsers().find(
      (u) =>
        u.userCode.toUpperCase() === clean ||
        (u.documentId && u.documentId.trim() === claimIdentifier.trim()) ||
        (u.email && u.email.trim().toLowerCase() === claimIdentifier.trim().toLowerCase())
    );

    if (!user) {
      try {
        const remoteUser = await firestoreService.findUserByCodeOrDoc(claimIdentifier);
        if (remoteUser) {
          user = remoteUser;
        }
      } catch (err) {
        console.warn('Error en búsqueda remota Firestore:', err);
      }
    }

    if (!user) {
      setClaimError('No se encontró ningún inversionista registrado con ese código o cédula.');
      return;
    }

    setFoundUser(user);

    const currentEmail =
      String(user.email || '').trim();

    const isPlaceholderEmail =
      /^pending\..+@easytraders24\.app$/i.test(
        currentEmail
      );

    setClaimEmail(
      isPlaceholderEmail
        ? ''
        : currentEmail
    );
  };

  // Confirmar activación (Paso 2 del Claim)
  const handleConfirmClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!foundUser) return;
    setClaimError(null);

    if (!claimActivationToken.trim()) {
      setClaimError('Por favor ingresa el token de activación seguro suministrado por administración.');
      return;
    }

    if (!claimEmail.trim() || !claimEmail.includes('@')) {
      setClaimError('Por favor ingresa un correo electrónico válido.');
      return;
    }

    if (claimPassword && claimPassword !== claimConfirmPassword) {
      setClaimError('Las contraseñas no coinciden.');
      return;
    }

    const tokenToSubmit =
      claimActivationToken.trim();

    const emailToSubmit =
      claimEmail
        .trim()
        .toLowerCase();

    const passwordToSubmit =
      claimPassword;

    if (passwordToSubmit.length < 6) {
      setClaimError(
        'La contrase?a debe tener al menos 6 caracteres.'
      );
      return;
    }

    setClaimActivationToken('');
    setClaimPassword('');
    setClaimConfirmPassword('');

    const res = await claimAccount(
      foundUser.userCode,
      tokenToSubmit,
      emailToSubmit,
      passwordToSubmit
    );
    if (res.success) {
      setClaimSuccess(true);
      setTimeout(() => {
        onClose();
      }, 2000);
    } else {
      setClaimError(res.message);
    }
  };

  // Manejar envío de postulación de nuevo usuario (Server-Side Callable)
  const handleApplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApplyError(null);

    if (!applyName.trim() || !applyPhone.trim()) {
      setApplyError('El nombre completo y celular son obligatorios.');
      return;
    }

    const numericCapital = parseInt(applyCapitalStr.replace(/[^0-9]/g, ''), 10) || 0;
    if (numericCapital < 4_000_000) {
      setApplyError('El capital mínimo para solicitar admisión es de $4.000.000 COP.');
      return;
    }

    try {
      const result = await firestoreService.submitApplicationCallable({
        fullName: applyName.trim(),
        documentId: applyDoc.trim(),
        email: applyEmail.trim().toLowerCase(),
        phone: applyPhone.trim(),
        city: applyCity.trim(),
        requestedCapitalCop: numericCapital,
        originBank: applyBank.trim(),
        priorityNotes: applyNotes || 'Postulación radicada desde formulario público web',
      });

      if (result.success) {
        setApplySuccessTurn(result.queuePosition);
      } else {
        setApplyError('No se pudo radicar la solicitud.');
      }
    } catch (err: any) {
      setApplyError(err.message || 'Error al enviar la solicitud.');
    }
  };

  // Copiar link de postulación para compartir
  const handleCopyPublicLink = () => {
    const originUrl = getAppBaseUrl();
    const textToCopy = `📈 *Postulación a EasyTraders Fondo de Inversión*\nIngresa al siguiente enlace para solicitar tu ingreso por orden de llegada:\n${originUrl}`;
    navigator.clipboard.writeText(textToCopy);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/90 rounded-3xl p-5 sm:p-7 w-full max-w-xl shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto custom-scrollbar">
        {/* Header con Marca */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-400 p-0.5 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center text-amber-400 font-extrabold text-sm">
                ET
              </div>
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-100 tracking-tight">
                Acceso a la Plataforma
              </h3>
              <p className="text-xs text-slate-400">
                Portal de Liquidaciones & Gestión de Capital
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-xl hover:bg-slate-800 transition cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Selector de 3 Pestañas Claras */}
        <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1.5 rounded-2xl border border-slate-800 text-xs">
          <button
            onClick={() => {
              setActiveTab('login');
              setLoginError(null);
            }}
            className={`py-2 px-1 text-center rounded-xl font-semibold transition cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'login'
                ? 'bg-slate-800 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <LogIn className="w-3.5 h-3.5 text-amber-400" />
            <span className="truncate">Ingresar</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('claim');
              setClaimError(null);
            }}
            className={`py-2 px-1 text-center rounded-xl font-semibold transition cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'claim'
                ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span className="truncate">Activar Cuenta</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('apply');
              setApplyError(null);
              setApplySuccessTurn(null);
            }}
            className={`py-2 px-1 text-center rounded-xl font-semibold transition cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'apply'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span className="truncate">Postularse</span>
          </button>
        </div>

        {/* ========================================================================= */}
        {/* PESTAÑA 1: INICIAR SESIÓN */}
        {/* ========================================================================= */}
        {activeTab === 'login' && (
          <form onSubmit={handleLoginSubmit} className="space-y-4 animate-in fade-in duration-150">
            <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800 text-xs text-slate-300 space-y-1">
              <p className="font-semibold text-slate-200">Acceso para Inversionistas y Administradores</p>
              <p className="text-[11px] text-slate-400">
                Puedes ingresar con tu <span className="text-amber-400 font-mono">Código de Inversionista</span> (ej. USR-8F29K o INV-001), o con tu correo electrónico registrado.
              </p>
            </div>

            {loginError && (
              <div className="p-3 bg-red-950/40 border border-red-500/40 rounded-xl text-red-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Código de Inversionista o Correo
                </label>
                <input
                  type="text"
                  required
                  value={loginIdentifier}
                  onChange={(e) => setLoginIdentifier(e.target.value)}
                  placeholder="ej. USR-8F29K o admin@easytraders24.app"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500 font-mono text-sm"
                />
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-slate-300 font-semibold">Contraseña</label>
                  <span className="text-[10px] text-slate-500">
                    (Opcional si accedes con código por primera vez)
                  </span>
                </div>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500 text-sm"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-lg shadow-amber-500/20 transition cursor-pointer flex items-center justify-center gap-2"
            >
              <LogIn className="w-4 h-4" />
              <span>Iniciar Sesión en el Portal</span>
            </button>

            <div className="pt-2 text-center">
              <p className="text-[11px] text-slate-400">
                ¿Eres un inversionista antiguo y aún no has creado tu contraseña?{' '}
                <button
                  type="button"
                  onClick={() => setActiveTab('claim')}
                  className="text-amber-400 hover:underline font-semibold cursor-pointer"
                >
                  Activa tu cuenta aquí
                </button>
              </p>
            </div>
          </form>
        )}

        {/* ========================================================================= */}
        {/* PESTAÑA 2: ACTIVAR CUENTA (INVERSIONISTAS ANTIGUOS Y APROBADOS) */}
        {/* ========================================================================= */}
        {activeTab === 'claim' && (
          <div className="space-y-4 animate-in fade-in duration-150 text-xs">
            <div className="bg-gradient-to-r from-amber-950/40 via-slate-950 to-slate-950 p-3.5 rounded-2xl border border-amber-500/30 text-amber-200/90 space-y-1">
              <p className="font-bold text-amber-300 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Vincular Cuenta Existente
              </p>
              <p className="text-[11px] text-amber-200/70 leading-relaxed">
                Si ya tienes historial, capital activo o te acaban de aprobar tu solicitud, ingresa tu código de inversionista o cédula para asignarle tu correo y contraseña personal.
              </p>
            </div>

            {claimError && (
              <div className="p-3 bg-red-950/40 border border-red-500/40 rounded-xl text-red-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{claimError}</span>
              </div>
            )}

            {claimSuccess && (
              <div className="p-4 bg-emerald-950/60 border border-emerald-500/50 rounded-2xl text-emerald-300 text-center space-y-1">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-400" />
                <p className="font-bold text-sm">¡Cuenta activada con éxito!</p>
                <p className="text-[11px] text-emerald-200/80">Entrando a tu portal de inversionista...</p>
              </div>
            )}

            {!claimSuccess && !foundUser && (
              <div className="space-y-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Ingresa tu Código de Inversionista o Cédula
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={claimIdentifier}
                      onChange={(e) => setClaimIdentifier(e.target.value)}
                      placeholder="ej. USR-8F29K o 1020304050"
                      className="flex-1 px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-mono text-sm focus:outline-none focus:border-amber-500"
                    />
                    <button
                      type="button"
                      onClick={handleSearchAccountToClaim}
                      className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition cursor-pointer shrink-0"
                    >
                      Buscar
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Prueba por ejemplo con: <code className="text-amber-400">USR-8F29K</code> (Juan Pérez) o <code className="text-amber-400">USR-8F30L</code> (Carlos Meza).
                  </p>
                </div>
              </div>
            )}

            {!claimSuccess && foundUser && (
              <form onSubmit={handleConfirmClaim} className="space-y-3.5">
                {/* Resumen del Inversionista Encontrado */}
                <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
                        ✓
                      </div>
                      <div>
                        <p className="font-bold text-slate-100 text-sm">{foundUser.fullName}</p>
                        <p className="font-mono text-[11px] text-amber-400">{foundUser.userCode}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFoundUser(null)}
                      className="text-[11px] text-slate-400 hover:text-slate-200 underline"
                    >
                      Cambiar
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 text-[11px]">
                    <div>
                      <span className="text-slate-500">Capital Activo:</span>
                      <p className="font-mono font-bold text-slate-200">
                        ${foundUser.currentCapital.toLocaleString('es-CO')} COP
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">Bitácora:</span>
                      <p className="font-bold text-blue-400">Categoría {foundUser.category}</p>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-slate-300 font-semibold">
                      Token de Activación Seguro <span className="text-amber-400">*</span>
                    </label>
                    <span className="text-[10px] text-amber-400 font-mono">Entregado por Admin</span>
                  </div>
                  <input
                    type="text"
                    required
                    value={claimActivationToken}
                    onChange={(e) => setClaimActivationToken(e.target.value)}
                    placeholder="Pega aquí tu token alfanumérico generado por administración"
                    className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-mono text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Confirma tu Correo Electrónico <span className="text-amber-400">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={claimEmail}
                    onChange={(e) => setClaimEmail(e.target.value)}
                    placeholder="tu.correo@ejemplo.com"
                    className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Crea tu Contraseña <span className="text-amber-400">*</span>
                    </label>
                    <input
                      type="password"
                      required
                      value={claimPassword}
                      onChange={(e) => setClaimPassword(e.target.value)}
                      placeholder="Mínimo 6 caracteres"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Confirmar Contraseña <span className="text-amber-400">*</span>
                    </label>
                    <input
                      type="password"
                      required
                      value={claimConfirmPassword}
                      onChange={(e) => setClaimConfirmPassword(e.target.value)}
                      placeholder="Repite la contraseña"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold transition shadow-lg shadow-emerald-950/40 cursor-pointer"
                >
                  Activar y Entrar al Portal
                </button>
              </form>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* PESTAÑA 3: POSTULACIÓN DE NUEVOS INVERSIONISTAS (LISTA DE ESPERA FIFO) */}
        {/* ========================================================================= */}
        {activeTab === 'apply' && (
          <div className="space-y-4 animate-in fade-in duration-150 text-xs">
            {applySuccessTurn !== null ? (
              <div className="bg-slate-950 border border-emerald-500/40 rounded-2xl p-5 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/10">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-slate-100">
                    ¡Tu Solicitud ha sido Registrada con Éxito!
                  </h4>
                  <div className="inline-block mt-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono font-bold text-sm">
                    Turno Oficial: #{applySuccessTurn}
                  </div>
                </div>
                <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                  Las solicitudes se atienden en estricto <span className="text-amber-300 font-semibold">Orden de Llegada</span>. 
                  Una vez la administración valide tu cupo, recibirás un mensaje oficial de WhatsApp con tu código de inversionista y las instrucciones para acceder.
                </p>
                <div className="pt-2">
                  <button
                    onClick={() => {
                      setApplySuccessTurn(null);
                      onClose();
                    }}
                    className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold"
                  >
                    Entendido, Cerrar
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleApplySubmit} className="space-y-3.5">
                <div className="bg-blue-950/30 p-3 rounded-2xl border border-blue-500/30 text-blue-200/90 flex items-start gap-2.5">
                  <Clock className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-blue-300">Ingreso por Orden de Llegada</p>
                    <p className="text-[11px] text-blue-200/70">
                      Al radicar tu postulación quedarás en la lista de espera oficial. Cuando se abra cupo en la bitácora correspondiente, se te contactará por WhatsApp.
                    </p>
                  </div>
                </div>

                {applyError && (
                  <div className="p-3 bg-red-950/40 border border-red-500/40 rounded-xl text-red-300 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{applyError}</span>
                  </div>
                )}

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Nombre Completo *</label>
                  <input
                    type="text"
                    required
                    value={applyName}
                    onChange={(e) => setApplyName(e.target.value)}
                    placeholder="ej. Mariana Gómez Restrepo"
                    className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Cédula / Documento</label>
                    <input
                      type="text"
                      value={applyDoc}
                      onChange={(e) => setApplyDoc(e.target.value)}
                      placeholder="1037648291"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Celular / WhatsApp *</label>
                    <input
                      type="tel"
                      required
                      value={applyPhone}
                      onChange={(e) => setApplyPhone(e.target.value)}
                      placeholder="3124567890"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Correo Electrónico</label>
                    <input
                      type="email"
                      value={applyEmail}
                      onChange={(e) => setApplyEmail(e.target.value)}
                      placeholder="inversionista@email.com"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Ciudad</label>
                    <input
                      type="text"
                      value={applyCity}
                      onChange={(e) => setApplyCity(e.target.value)}
                      placeholder="Medellín"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Capital Propuesto (COP) *</label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-amber-400 font-bold text-xs">
                        $
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        required
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
                        className="w-full pl-6 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <span className="text-[10px] text-slate-500 mt-0.5 block">
                      Bitácora sugerida: {getCategoryForCapital(parseInt(applyCapitalStr.replace(/[^0-9]/g, ''), 10) || 0)}
                    </span>
                  </div>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Banco de Origen</label>
                    <select
                      value={applyBank}
                      onChange={(e) => setApplyBank(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-blue-500"
                    >
                      <option value="Bancolombia">Bancolombia</option>
                      <option value="Davivienda">Davivienda</option>
                      <option value="Nequi">Nequi</option>
                      <option value="Daviplata">Daviplata</option>
                      <option value="BBVA">BBVA</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Observaciones / Referido por</label>
                  <input
                    type="text"
                    value={applyNotes}
                    onChange={(e) => setApplyNotes(e.target.value)}
                    placeholder="ej. Referido por Juan Pérez..."
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold transition shadow-lg shadow-blue-900/40 cursor-pointer"
                  >
                    Radicar Postulación en Admisión
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyPublicLink}
                    className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-semibold flex items-center gap-1.5 cursor-pointer shrink-0"
                    title="Copiar texto con enlace para compartir a interesados"
                  >
                    {copiedLink ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-[11px]">Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span className="text-[11px]">Compartir Link</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
