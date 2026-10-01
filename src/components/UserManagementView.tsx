import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Search,
  Filter,
  Edit2,
  CheckCircle2,
  DollarSign,
  Phone,
  Mail,
  Shield,
  CreditCard,
  X,
  AlertCircle,
  TrendingUp,
  FileSpreadsheet,
  Copy,
  Check,
  Link,
  MessageCircle,
  Clock,
  Sparkles,
  Trash2,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';
import { dataStore } from '../lib/dataStore';
import { useAuth } from '../context/AuthContext';
import { BitacoraCategory, UserProfile, UserStatus } from '../types';
import { formatCOP, getCategoryForCapital } from '../lib/financialEngine';
import { ExcelBitacoraImportModal } from './ExcelBitacoraImportModal';
import { InvestorApplicationsView } from './InvestorApplicationsView';
import { createFirebaseAuthUser } from '../lib/firebase';
import { firestoreService } from '../lib/firestoreService';
import { MonthlyCycle } from '../types';

export function isCycleValidForFutureEnrollment(
  preparingCycle: MonthlyCycle | null | undefined,
  getCycleById: (id: string) => MonthlyCycle | undefined
): boolean {
  if (!preparingCycle) return false;

  // Validar estados base obligatorios del ciclo en preparación
  if (preparingCycle.status !== 'OPEN' || preparingCycle.operationalStatus !== 'PREPARING') {
    return false;
  }

  // CASO A — GÉNESIS:
  if (
    (preparingCycle.isGenesis === true || !preparingCycle.previousCycleId) &&
    preparingCycle.previousCycleId == null
  ) {
    return true;
  }

  // CASO B — SUCESOR NORMAL:
  if (preparingCycle.previousCycleId) {
    const prevCycle = getCycleById(preparingCycle.previousCycleId);
    return !!prevCycle && prevCycle.status === 'CLOSED';
  }

  return false;
}

export function resolveDefaultTargetCycleId(params: {
  operationalCycleId?: string | null;
  preparingCycle?: MonthlyCycle | null;
  hasValidFutureCycle: boolean;
}): string {
  if (!params.operationalCycleId && params.hasValidFutureCycle && params.preparingCycle) {
    return params.preparingCycle.cycleId || params.preparingCycle.id;
  }
  return '';
}

export const UserManagementView: React.FC = () => {
  const { allUsers, currentUser, isSuperAdmin } = useAuth();
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');

  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isExcelModalOpen, setIsExcelModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  const [generatingTokenUserId, setGeneratingTokenUserId] = useState<string | null>(null);
  const [generatedTokenModal, setGeneratedTokenModal] = useState<{
    token: string;
    expiresAt: string;
    userCode: string;
    fullName: string;
    directUrl: string;
    whatsappMessage: string;
  } | null>(null);
  const [copiedModalField, setCopiedModalField] = useState<string | null>(null);

  // Estados para Prueba Directa de Push FCM
  const [testPushUser, setTestPushUser] = useState<UserProfile | null>(null);
  const [isSendingTestPush, setIsSendingTestPush] = useState(false);
  const [testPushResult, setTestPushResult] = useState<{
    success: boolean;
    tokenCount: number;
    successCount: number;
    failureCount: number;
    errorCodes: string[];
    message?: string;
    mode?: 'notification' | 'data';
  } | null>(null);

  // Estados para Purga de Usuarios de Prueba (Preview + Purga)
  const [isPurgeModalOpen, setIsPurgeModalOpen] = useState(false);
  const [deleteTestFinancialData, setDeleteTestFinancialData] = useState(false);
  const [resetUserCounter, setResetUserCounter] = useState(false);
  const [purgeConfirmationInput, setPurgeConfirmationInput] = useState('');
  const [isDryRunLoading, setIsDryRunLoading] = useState(false);
  const [isExecutingPurge, setIsExecutingPurge] = useState(false);
  const [purgePreviewData, setPurgePreviewData] = useState<any>(null);
  const [purgeResultData, setPurgeResultData] = useState<any>(null);

  // Form State
  const [createMode, setCreateMode] = useState<'PENDING' | 'ACTIVE'>('PENDING');
  const [subTab, setSubTab] = useState<'active' | 'queue'>('active');
  const [copiedUserId, setCopiedUserId] = useState<string | null>(null);
  const [copiedGlobalActivationLink, setCopiedGlobalActivationLink] = useState(false);
  const [reconcilingUserId, setReconcilingUserId] = useState<string | null>(null);
  const [reconcileSuccessMsg, setReconcileSuccessMsg] = useState<string | null>(null);
  const [reconcileErrorMsg, setReconcileErrorMsg] = useState<string | null>(null);
  const pendingApps = dataStore.getPendingApplications();

  const [formName, setFormName] = useState('');
  const [formTradeAlias, setFormTradeAlias] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('EasyTrader2026*');
  const [formPhone, setFormPhone] = useState('');
  const [formCapital, setFormCapital] = useState('');
  const [formUserSplit, setFormUserSplit] = useState('50');
  const [formBank, setFormBank] = useState('Bancolombia');
  const [formAccount, setFormAccount] = useState('');
  const [formTargetCycleId, setFormTargetCycleId] = useState('');
  const [formSupportAgent, setFormSupportAgent] = useState(false);
  const [formSupportReadUserContext, setFormSupportReadUserContext] = useState(false);
  const [formSupportReadOperationalContext, setFormSupportReadOperationalContext] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Participación financiera del SuperAdmin Juanes
  const [selfAdminCapital, setSelfAdminCapital] = useState('');
  const [isConfiguringSelfAdmin, setIsConfiguringSelfAdmin] = useState(false);
  const [selfAdminConfigError, setSelfAdminConfigError] = useState<string | null>(null);
  const [selfAdminConfigSuccess, setSelfAdminConfigSuccess] = useState<string | null>(null);

  const config = dataStore.getConfig();
  const preparingCycleId = config?.preparingCycleId;
  const preparingCycle = preparingCycleId ? dataStore.getCycleById(preparingCycleId) : null;
  const hasValidFutureCycle = isCycleValidForFutureEnrollment(
    preparingCycle,
    (id) => dataStore.getCycleById(id)
  );

  const numericCapital = parseFloat(formCapital) || 0;
  const detectedCategory = getCategoryForCapital(numericCapital);
  const adminSplit = 100 - (parseFloat(formUserSplit) || 50);

  // -------------------------------------------------------
  // SuperAdmin Juanes como participante financiero.
  //
  // El rol ADMIN se conserva. La inversión es una dimensión
  // financiera independiente.
  // -------------------------------------------------------

  const juanesFinancialAdmin =
    allUsers.find(
      (user) =>
        (user.email || '')
          .trim()
          .toLowerCase() ===
        'juanes9802@gmail.com'
    ) || null;

  const selfAdminCapitalNumber =
    Number(selfAdminCapital || 0);

  const selfAdminCapitalValid =
    Number.isFinite(selfAdminCapitalNumber) &&
    selfAdminCapitalNumber >= 4_000_000 &&
    selfAdminCapitalNumber <= Number.MAX_SAFE_INTEGER;

  const selfAdminCategory =
    selfAdminCapitalValid
      ? getCategoryForCapital(selfAdminCapitalNumber)
      : null;

  const selfAdminTargetCycleId =
    preparingCycleId || '';

  const selfAdminPreparingCycleValid =
    !!preparingCycle &&
    preparingCycle.status === 'OPEN' &&
    preparingCycle.operationalStatus === 'PREPARING' &&
    !!selfAdminTargetCycleId;

  const selfAdminTargetUid =
    juanesFinancialAdmin?.uid ||
    juanesFinancialAdmin?.id ||
    '';

  const canConfigureSelfAdmin =
    isSuperAdmin &&
    !!selfAdminTargetUid &&
    selfAdminCapitalValid &&
    selfAdminPreparingCycleValid;

  const filteredUsers = allUsers.filter((u) => {
    if (
      u.role === 'ADMIN' &&
      u.participatesInTrading !== true
    ) {
      return false;
    }
    if (selectedCategory !== 'ALL' && u.category !== selectedCategory) return false;
    if (selectedStatus !== 'ALL') {
      if (selectedStatus === 'PENDING_CLAIM') {
        if (u.status !== 'PENDING_CLAIM' && u.status !== 'PENDING') return false;
      } else if (u.status !== selectedStatus) {
        return false;
      }
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.phone.includes(q) ||
        u.userCode.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Precargar capital de Juanes cuando ya tenga
  // participación financiera configurada.
  useEffect(() => {
    if (
      juanesFinancialAdmin?.participatesInTrading === true &&
      !selfAdminCapital
    ) {
      setSelfAdminCapital(
        String(
          juanesFinancialAdmin.currentCapital || ''
        )
      );
    }
  }, [
    juanesFinancialAdmin?.participatesInTrading,
    juanesFinancialAdmin?.currentCapital,
  ]);

  const handleConfigureSelfAdminInvestment = async () => {
    setSelfAdminConfigError(null);
    setSelfAdminConfigSuccess(null);

    if (!isSuperAdmin) {
      setSelfAdminConfigError(
        'Solo SuperAdmin puede configurar esta participación financiera.'
      );
      return;
    }

    if (!juanesFinancialAdmin) {
      setSelfAdminConfigError(
        'No se encontró la cuenta de juanes9802@gmail.com dentro de los usuarios cargados.'
      );
      return;
    }

    if (!selfAdminTargetUid) {
      setSelfAdminConfigError(
        'La cuenta de Juanes no tiene un UID válido.'
      );
      return;
    }

    if (!selfAdminPreparingCycleValid) {
      setSelfAdminConfigError(
        'No existe un ciclo PREPARING autoritativo disponible.'
      );
      return;
    }

    if (!selfAdminCapitalValid) {
      setSelfAdminConfigError(
        'El capital debe ser igual o superior a $4.000.000 COP.'
      );
      return;
    }

    const category =
      getCategoryForCapital(
        selfAdminCapitalNumber
      );

    const cycleName =
      preparingCycle?.name ||
      selfAdminTargetCycleId;

    const confirmMessage =
      `Configurar participación financiera de Juanes\n\n` +
      `Capital: ${formatCOP(selfAdminCapitalNumber)}\n` +
      `Bitácora: ${category}\n` +
      `Ciclo: ${cycleName}\n` +
      `Distribución: 100% Juanes / 0% administración\n` +
      `Modo: SELF_ADMIN\n\n` +
      `El rol ADMIN / SuperAdmin NO cambiar?.\n\n` +
      `¿Confirmar configuración?`;

    if (
      !window.confirm(confirmMessage)
    ) {
      return;
    }

    setIsConfiguringSelfAdmin(true);

    try {
      const response =
        await firestoreService
          .adminConfigureTradingParticipant({
            targetUid:
              selfAdminTargetUid,

            currentCapital:
              selfAdminCapitalNumber,

            targetCycleId:
              selfAdminTargetCycleId,
          });

      setSelfAdminCapital(
        String(
          response.participant.currentCapital
        )
      );

      setSelfAdminConfigSuccess(
        response.message ||
        'Participación financiera configurada correctamente.'
      );
    } catch (error: any) {
      console.error(
        '[SELF_ADMIN] Error configurando participación financiera:',
        error
      );

      const rawMessage =
        error?.message ||
        error?.details ||
        'No fue posible configurar la participación financiera.';

      setSelfAdminConfigError(
        String(rawMessage)
      );
    } finally {
      setIsConfiguringSelfAdmin(false);
    }
  };

  const handleOpenAdd = () => {
    setCreateMode('PENDING');
    setFormName('');
    setFormTradeAlias('');
    setFormEmail('');
    setFormPassword('EasyTrader2026*');
    setFormPhone('');
    setFormCapital('8000000');
    setFormUserSplit('50');
    setFormBank('Bancolombia');
    setFormAccount('');
    setFormSupportAgent(false);
    setFormSupportReadUserContext(false);
    setFormSupportReadOperationalContext(false);
    setFormTargetCycleId(
      resolveDefaultTargetCycleId({
        operationalCycleId: config?.operationalCycleId,
        preparingCycle,
        hasValidFutureCycle,
      })
    );
    setFormError(null);
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (user: UserProfile) => {
    setEditingUser(user);
    setFormName(user.fullName);
    setFormTradeAlias(user.tradeNotificationAlias || '');
    setFormEmail(user.email);
    setFormPhone(user.phone);
    setFormCapital(user.currentCapital.toString());
    setFormUserSplit(user.userPercentage.toString());
    setFormBank(user.paymentMethod);
    setFormAccount(user.paymentDetails);
    setFormSupportAgent(user.permissions?.supportAgent === true);
    setFormSupportReadUserContext(user.permissions?.supportReadUserContext === true);
    setFormSupportReadOperationalContext(user.permissions?.supportReadOperationalContext === true);
    setFormError(null);
  };

  const handleReconcileUser = async (user: UserProfile) => {
    const confirmReconcile = window.confirm(
      `¿Deseas reconciliar a "${user.fullName}" (${user.email}) como usuario ACTIVO?\n\n` +
      `Esto verificará la coincidencia con Firebase Authentication y actualizará su estado a ACTIVO en Firestore.`
    );
    if (!confirmReconcile) return;

    setReconcilingUserId(user.id);
    setReconcileErrorMsg(null);
    setReconcileSuccessMsg(null);

    try {
      const res = await firestoreService.adminReconcileActiveUser(user.id);
      if (res.success) {
        setReconcileSuccessMsg(res.message);
        dataStore.updateUser(
          user.id,
          {
            isClaimed: true,
            status: 'ACTIVE',
            uid: user.id,
          },
          currentUser?.uid || 'admin_root_uid',
          currentUser?.fullName || 'Administrador Principal'
        );
        setTimeout(() => setReconcileSuccessMsg(null), 6000);
      }
    } catch (err: any) {
      setReconcileErrorMsg(err?.message || 'Error al reconciliar el usuario con Firebase Auth.');
      setTimeout(() => setReconcileErrorMsg(null), 8000);
    } finally {
      setReconcilingUserId(null);
    }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cap = parseFloat(formCapital);
    const split = parseFloat(formUserSplit);

    if (isNaN(cap) || cap < 4_000_000) {
      setFormError('El capital mínimo de inversión es de $4.000.000 COP (Bitácora Azul).');
      return;
    }

    if (cap > 4_000_000_000) {
      setFormError('El capital excede el límite máximo de $4.000.000.000 COP.');
      return;
    }

    if (isNaN(split) || split <= 0 || split > 100) {
      setFormError('El porcentaje del inversionista debe ser entre 1% y 100%.');
      return;
    }

    if (!editingUser && createMode === 'ACTIVE' && (!formPassword || formPassword.length < 6)) {
      setFormError('La contraseña inicial debe tener al menos 6 caracteres para la autenticación.');
      return;
    }

    if (formTradeAlias.trim().length > 30) {
      setFormError('El nombre para notificación de trade diario no puede superar los 30 caracteres.');
      return;
    }

    const category = getCategoryForCapital(cap);
    const trimmedAlias = formTradeAlias.trim() || undefined;
    setIsSubmitting(true);

    try {
      if (editingUser) {
        // Update user in dataStore and Firestore (PROTEGIENDO CAMPOS FINANCIEROS DEL SERVIDOR)
        const updatedUser = dataStore.updateUser(
          editingUser.id,
          {
            fullName: formName,
            tradeNotificationAlias: trimmedAlias,
            email: formEmail,
            phone: formPhone,
            currentCapital: editingUser.currentCapital, // PROTEGIDO: Solo lectura, administrado por el sistema financiero
            userPercentage: split,
            adminPercentage: 100 - split,
            category: editingUser.category, // PROTEGIDO: Solo lectura, administrado por el sistema financiero
            paymentMethod: formBank,
            paymentDetails: formAccount || 'Cuenta Principal',
          },
          currentUser?.uid || 'admin_root_uid',
          currentUser?.fullName || 'Administrador Principal'
        );

        await firestoreService.saveUser(updatedUser);

        // Si es SuperAdmin y los permisos de soporte cambiaron, invocar callable autoritativa
        if (isSuperAdmin) {
          const currentAgent = editingUser.permissions?.supportAgent === true;
          const currentReadUser = editingUser.permissions?.supportReadUserContext === true;
          const currentReadOp = editingUser.permissions?.supportReadOperationalContext === true;

          const hasPermsChanged =
            formSupportAgent !== currentAgent ||
            formSupportReadUserContext !== currentReadUser ||
            formSupportReadOperationalContext !== currentReadOp;

          if (hasPermsChanged) {
            const permRes = await firestoreService.adminUpdateSupportPermissions({
              targetUid: editingUser.uid || editingUser.id,
              permissions: {
                supportAgent: formSupportAgent,
                supportReadUserContext: formSupportAgent && formSupportReadUserContext,
                supportReadOperationalContext: formSupportAgent && formSupportReadOperationalContext,
              },
              clientRequestId: crypto.randomUUID(),
            });

            if (permRes && permRes.permissions) {
              dataStore.updateUser(
                editingUser.id,
                { permissions: permRes.permissions },
                currentUser?.uid || 'admin_root_uid',
                currentUser?.fullName || 'Administrador Principal'
              );
            }
          }
        }

        setEditingUser(null);
      } else {
        const effectiveTargetCycleId =
          hasValidFutureCycle && preparingCycle
            ? (formTargetCycleId || preparingCycle.cycleId || preparingCycle.id)
            : null;

        if (!effectiveTargetCycleId) {
          setFormError(
            'No hay un ciclo de ingreso válido en preparación. Crea o habilita el próximo ciclo antes de registrar este inversionista.'
          );
          setIsSubmitting(false);
          return;
        }

        if (createMode === 'PENDING') {
          // MODO PENDIENTE: Crea perfil en Firestore (status: PENDING_CLAIM, uid: null) sin cuenta Auth
          const result = await firestoreService.adminCreatePendingInvestor({
            email: formEmail,
            fullName: formName,
            phone: formPhone,
            currentCapital: cap,
            userPercentage: split,
            adminPercentage: 100 - split,
            paymentMethod: formBank,
            paymentDetails: formAccount || 'Cuenta Principal',
            targetCycleId: effectiveTargetCycleId,
          });

          if (result && result.user) {
            const userWithAlias = { ...result.user, tradeNotificationAlias: trimmedAlias };
            dataStore.registerRemoteUserLocally(userWithAlias);
            if (trimmedAlias) {
              await firestoreService.saveUser(userWithAlias);
            }
          }
          setFormTargetCycleId('');
          setIsAddModalOpen(false);
        } else {
          // MODO ACTIVO DIRECTO: Crea en Firebase Auth y Firestore (status: ACTIVE, isClaimed: true)
          const result = await firestoreService.adminCreateUser({
            email: formEmail,
            password: formPassword,
            fullName: formName,
            phone: formPhone,
            currentCapital: cap,
            userPercentage: split,
            adminPercentage: 100 - split,
            paymentMethod: formBank,
            paymentDetails: formAccount || 'Cuenta Principal',
            role: 'USER',
            targetCycleId: effectiveTargetCycleId,
          });

          if (result && result.user) {
            const userWithAlias = { ...result.user, tradeNotificationAlias: trimmedAlias };
            dataStore.registerRemoteUserLocally(userWithAlias);
            if (trimmedAlias) {
              await firestoreService.saveUser(userWithAlias);
            }
          }
          setFormTargetCycleId('');
          setIsAddModalOpen(false);
        }
      }
    } catch (err: any) {
      setFormError(err?.message || 'Ocurrió un error al guardar el usuario.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyGlobalActivationLink = () => {
    const url = `${window.location.origin}/?mode=claim`;
    navigator.clipboard.writeText(url);
    setCopiedGlobalActivationLink(true);
    setTimeout(() => setCopiedGlobalActivationLink(false), 3000);
  };

  const handleCopyWhatsAppAccess = async (user: UserProfile) => {
    if (user.isClaimed) {
      const loginLink = `${window.location.origin}/?mode=login`;
      const message = `👋 *¡Hola ${user.fullName}!*
Te recordamos el enlace de acceso a tu portal de inversionista en *EasyTraders*:

🔑 *Código de Inversionista:* \`${user.userCode}\`
💼 *Capital Registrado:* ${formatCOP(user.currentCapital)}
📊 *Bitácora Asignada:* ${user.category}
🌐 *Portal Web:* ${loginLink}

💡 Ingresa con tu correo personal registrado y tu contraseña previamente configurada.`;

      navigator.clipboard.writeText(message);
      setCopiedUserId(user.id);
      setTimeout(() => setCopiedUserId(null), 3000);
      return;
    }

    // Usuario pendiente de activación: Generar token de alta entropía en servidor
    setGeneratingTokenUserId(user.id);
    try {
      const res = await firestoreService.adminGenerateActivationToken(user.id || user.userCode);
      if (res.success && res.token) {
        // Enlace sin token en query params por seguridad (el usuario lo pega manualmente)
        const directLink = `${window.location.origin}/?mode=claim&code=${encodeURIComponent(user.userCode)}`;
        const message = `👋 *¡Hola ${user.fullName}!*
Te compartimos tus credenciales y token de activación seguro para tu portal de inversionista en *EasyTraders*:

🔑 *Código de Inversionista:* \`${user.userCode}\`
🛡️ *Token de Activación Seguro:* \`${res.token}\`
💼 *Capital Registrado:* ${formatCOP(user.currentCapital)}
📊 *Bitácora Asignada:* ${user.category}
⏳ *Vigencia:* 7 días (un solo uso)

🌐 *Enlace Directo al Portal:*
${directLink}

💡 *Instrucciones:*
1. Abre el enlace directo o ingresa a la plataforma (tu código se precargará automáticamente).
2. Pega manualmente el *Token de Activación Seguro* recibido en este mensaje.
3. Confirma tu correo personal y define tu contraseña segura.
⚠️ *Seguridad:* Este token es personal e intransferible. No lo compartas con terceros. Una vez activada tu cuenta quedará invalidado de inmediato.`;

        navigator.clipboard.writeText(message);
        setCopiedUserId(user.id);
        setTimeout(() => setCopiedUserId(null), 3000);

        setGeneratedTokenModal({
          token: res.token,
          expiresAt: res.expiresAt,
          userCode: user.userCode,
          fullName: user.fullName,
          directUrl: directLink,
          whatsappMessage: message,
        });
      } else {
        alert('No se pudo generar el token de activación.');
      }
    } catch (err: any) {
      alert(`Error al generar token de activación: ${err?.message || err}`);
    } finally {
      setGeneratingTokenUserId(null);
    }
  };

  const handleSendTestPush = async (mode: 'notification' | 'data') => {
    if (!testPushUser) return;
    const uid = testPushUser.uid || testPushUser.id;
    if (!uid) {
      alert('El usuario seleccionado no posee un UID válido.');
      return;
    }

    setIsSendingTestPush(true);
    setTestPushResult(null);

    try {
      const res = await firestoreService.sendTestPushNotification(uid, mode);
      setTestPushResult({
        ...res,
        mode,
      });
    } catch (err: any) {
      setTestPushResult({
        success: false,
        tokenCount: 0,
        successCount: 0,
        failureCount: 0,
        errorCodes: [err.message || 'unknown_error'],
        message: err.message || 'Error al enviar Push de prueba',
        mode,
      });
    } finally {
      setIsSendingTestPush(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    alert("La eliminación individual directa vía SDK está deshabilitada por reglas de seguridad. Por favor utiliza la acción 'LIMPIAR USUARIOS DE PRUEBA' para purgar cuentas o ejecuta la Cloud Function correspondiente.");
    setUserToDelete(null);
  };

  const runPurgePreview = async (delFinancial: boolean, resetCounter: boolean) => {
    setIsDryRunLoading(true);
    setPurgePreviewData(null);
    try {
      const result = await firestoreService.adminPurgeNonAdminUsersCallable({
        dryRun: true,
        deleteTestFinancialData: delFinancial,
        resetUserCounter: resetCounter,
      });
      setPurgePreviewData(result);
    } catch (err: any) {
      alert(`Error al generar vista previa de purga: ${err?.message || err}`);
    } finally {
      setIsDryRunLoading(false);
    }
  };

  const handleOpenPurgeModal = () => {
    setIsPurgeModalOpen(true);
    setPurgeResultData(null);
    setPurgeConfirmationInput('');
    setDeleteTestFinancialData(false);
    setResetUserCounter(false);
    runPurgePreview(false, false);
  };

  const handleExecutePurge = async () => {
    if (purgeConfirmationInput.trim() !== 'PURGAR USUARIOS DE PRUEBA') return;
    setIsExecutingPurge(true);
    try {
      const result = await firestoreService.adminPurgeNonAdminUsersCallable({
        confirmation: 'PURGAR USUARIOS DE PRUEBA',
        dryRun: false,
        deleteTestFinancialData,
        resetUserCounter,
      });
      setPurgeResultData(result);
    } catch (err: any) {
      alert(`Error al ejecutar purga de usuarios: ${err?.message || err}`);
    } finally {
      setIsExecutingPurge(false);
    }
  };

  if (subTab === 'queue') {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        {/* Sub-tab Navigation */}
        <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-slate-900 border border-slate-800">
          <button
            onClick={() => setSubTab('active')}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs text-slate-400 hover:text-slate-100 transition cursor-pointer"
          >
            <Users className="w-4 h-4 text-blue-400" />
            <span>Inversionistas Registrados ({allUsers.filter((u) => u.role === 'USER' || u.participatesInTrading === true).length})</span>
          </button>
          <button
            onClick={() => setSubTab('queue')}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm transition cursor-pointer"
          >
            <Clock className="w-4 h-4 text-amber-400" />
            <span>Cola de Admisiones</span>
            {pendingApps.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 font-mono font-black text-[10px]">
                {pendingApps.length}
              </span>
            )}
          </button>
        </div>

        <InvestorApplicationsView />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Sub-tab Navigation */}
      <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-slate-900 border border-slate-800">
        <button
          onClick={() => setSubTab('active')}
          className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs bg-blue-600/20 text-blue-300 border border-blue-500/40 shadow-sm transition cursor-pointer"
        >
          <Users className="w-4 h-4 text-blue-400" />
          <span>Inversionistas Registrados ({allUsers.filter((u) => u.role === 'USER').length})</span>
        </button>
        <button
          onClick={() => setSubTab('queue')}
          className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs text-slate-400 hover:text-slate-100 transition cursor-pointer"
        >
          <Clock className="w-4 h-4 text-amber-400" />
          <span>Cola de Admisiones</span>
          {pendingApps.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 font-mono font-black text-[10px]">
              {pendingApps.length}
            </span>
          )}
        </button>
      </div>

      {/* PARTICIPACIÓN FINANCIERA SUPERADMIN */}
      {isSuperAdmin && (
        <div className="rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-950/60 via-slate-900 to-slate-950 shadow-xl overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-violet-500/20">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5 text-violet-300" />
                </div>

                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm sm:text-base font-black text-slate-100">
                      Participación financiera de Juanes
                    </h3>

                    <span className="px-2 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300 text-[10px] font-black">
                      SELF_ADMIN
                    </span>

                    {juanesFinancialAdmin?.participatesInTrading === true && (
                      <span className="px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-[10px] font-black">
                        ACTIVA
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-xs text-slate-400 max-w-2xl">
                    Juanes conserva su rol ADMIN / SuperAdmin y además participa como inversionista.
                    Su resultado financiero es 100% propio y genera 0% de comisión administrativa.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center shrink-0">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <p className="text-[9px] uppercase font-bold text-slate-500">
                    Rol
                  </p>
                  <p className="text-xs font-black text-violet-300">
                    ADMIN
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <p className="text-[9px] uppercase font-bold text-slate-500">
                    Juanes
                  </p>
                  <p className="text-xs font-black text-emerald-300">
                    100%
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <p className="text-[9px] uppercase font-bold text-slate-500">
                    Admin
                  </p>
                  <p className="text-xs font-black text-slate-300">
                    0%
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <p className="text-[9px] uppercase font-bold text-slate-500">
                    Bitácora
                  </p>
                  <p
                    className={`text-xs font-black ${
                      selfAdminCategory === 'NEGRA'
                        ? 'text-slate-100'
                        : selfAdminCategory === 'VERDE'
                        ? 'text-emerald-300'
                        : selfAdminCategory === 'AZUL'
                        ? 'text-blue-300'
                        : 'text-slate-500'
                    }`}
                  >
                    {selfAdminCategory || '?'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-5 grid grid-cols-1 xl:grid-cols-[1.2fr_1fr_auto] gap-4 items-end">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">
                Capital de Juanes (COP)
              </label>

              <input
                type="text"
                inputMode="numeric"
                value={selfAdminCapital}
                onChange={(e) => {
                  const clean =
                    e.target.value.replace(/[^\d]/g, '');

                  setSelfAdminCapital(clean);
                  setSelfAdminConfigError(null);
                  setSelfAdminConfigSuccess(null);
                }}
                placeholder="Ej: 10500000000"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 font-mono text-sm focus:outline-none focus:border-violet-500"
              />

              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
                <span className="text-slate-500">
                  Mínimo: $4.000.000
                </span>

                {selfAdminCapitalNumber > 0 && (
                  <span className="text-violet-300 font-mono">
                    {formatCOP(selfAdminCapitalNumber)}
                  </span>
                )}

                {selfAdminCapitalNumber > 60_000_000 && (
                  <span className="text-slate-300 font-bold">
                    NEGRA · sin tope comercial
                  </span>
                )}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">
                Ciclo de ingreso
              </p>

              <div
                className={`min-h-[42px] px-3 py-2.5 rounded-xl border ${
                  selfAdminPreparingCycleValid
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : 'border-amber-500/30 bg-amber-500/5'
                }`}
              >
                {selfAdminPreparingCycleValid ? (
                  <>
                    <p className="text-xs font-black text-emerald-300">
                      {preparingCycle?.name || 'Ciclo en preparación'}
                    </p>

                    <p className="text-[9px] font-mono text-slate-500 truncate">
                      {selfAdminTargetCycleId}
                    </p>
                  </>
                ) : (
                  <p className="text-xs font-bold text-amber-300">
                    No hay ciclo PREPARING disponible
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={handleConfigureSelfAdminInvestment}
              disabled={
                !canConfigureSelfAdmin ||
                isConfiguringSelfAdmin
              }
              className="h-[42px] px-4 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-xs font-black transition flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <ShieldCheck className="w-4 h-4" />

              {isConfiguringSelfAdmin
                ? 'CONFIGURANDO...'
                : juanesFinancialAdmin?.participatesInTrading === true
                ? 'ACTUALIZAR INVERSIÓN'
                : 'CONFIGURAR INVERSIÓN'}
            </button>
          </div>

          {!juanesFinancialAdmin && (
            <div className="mx-4 sm:mx-5 mb-4 px-3 py-2 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs">
              No se encontró en memoria la cuenta juanes9802@gmail.com.
            </div>
          )}

          {selfAdminConfigError && (
            <div className="mx-4 sm:mx-5 mb-4 px-3 py-2 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-xs break-words">
              {selfAdminConfigError}
            </div>
          )}

          {selfAdminConfigSuccess && (
            <div className="mx-4 sm:mx-5 mb-4 px-3 py-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs">
              {selfAdminConfigSuccess}
            </div>
          )}

          {juanesFinancialAdmin?.participatesInTrading === true && (
            <div className="mx-4 sm:mx-5 mb-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
                <p className="text-[9px] uppercase text-slate-500 font-bold">
                  Capital actual
                </p>
                <p className="mt-1 text-xs text-slate-100 font-mono font-black">
                  {formatCOP(juanesFinancialAdmin.currentCapital || 0)}
                </p>
              </div>

              <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
                <p className="text-[9px] uppercase text-slate-500 font-bold">
                  Categoría
                </p>
                <p className="mt-1 text-xs text-slate-100 font-black">
                  {juanesFinancialAdmin.category || '?'}
                </p>
              </div>

              <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
                <p className="text-[9px] uppercase text-slate-500 font-bold">
                  Ciclo asignado
                </p>
                <p className="mt-1 text-[10px] text-slate-300 font-mono truncate">
                  {juanesFinancialAdmin.entryCycleId || '?'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-lg sm:text-xl font-black text-slate-100 flex items-center gap-2">
              <Users className="w-5 h-5 sm:w-6 sm:h-6 text-blue-400" />
              Gestión de Inversionistas & Bitácoras
            </h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-950 border border-blue-500/40 text-blue-300 font-mono">
              {filteredUsers.length} Inversionistas
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Asignación automática a bitácoras por capital snapshot: 🔵 Azul, 🟢 Verde o ⚫ Negra
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <button
            onClick={handleCopyGlobalActivationLink}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border text-xs font-bold transition cursor-pointer shrink-0 ${
              copiedGlobalActivationLink
                ? 'bg-emerald-950 border-emerald-500 text-emerald-300'
                : 'bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-emerald-500/50 text-slate-200 hover:text-emerald-300'
            }`}
            title="Copiar link público para que los inversionistas activen su cuenta"
          >
            {copiedGlobalActivationLink ? (
              <>
                <Check className="w-4 h-4 text-emerald-400" />
                <span>¡Link Copiado!</span>
              </>
            ) : (
              <>
                <Link className="w-4 h-4 text-emerald-400" />
                <span>Link de Activación</span>
              </>
            )}
          </button>

          <button
            onClick={() => setIsExcelModalOpen(true)}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-blue-500/50 text-slate-200 hover:text-blue-300 text-xs font-bold transition cursor-pointer shrink-0"
            title="Importar y migrar inversionistas desde archivo Excel"
          >
            <FileSpreadsheet className="w-4 h-4 text-blue-400" />
            <span>Importar Excel</span>
          </button>

          <button
            onClick={handleOpenPurgeModal}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-rose-950/60 hover:bg-rose-900/80 border border-rose-800/80 hover:border-rose-500 text-rose-300 hover:text-rose-100 text-xs font-bold transition cursor-pointer shrink-0"
            title="Purga segura y definitiva de cuentas de prueba e historial asociado"
          >
            <Trash2 className="w-4 h-4 text-rose-400" />
            <span>Limpiar Usuarios de Prueba</span>
          </button>

          <button
            onClick={handleOpenAdd}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-600/30 transition cursor-pointer shrink-0"
          >
            <UserPlus className="w-4 h-4" />
            <span>Nuevo Inversionista</span>
          </button>
        </div>
      </div>

      {/* Selector de Ventanas de Bitácoras */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {/* Ventana Azul */}
        {(() => {
          const azulUsers = allUsers.filter((u) => (u.role === 'USER' || u.participatesInTrading === true) && u.category === 'AZUL');
          const azulCap = azulUsers.reduce((sum, u) => sum + u.currentCapital, 0);
          const isSelected = selectedCategory === 'AZUL';
          return (
            <button
              onClick={() => setSelectedCategory('AZUL')}
              className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                isSelected
                  ? 'bg-blue-950/80 border-blue-500 text-blue-100 shadow-lg shadow-blue-500/20 ring-1 ring-blue-500'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-850 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                  <span className="font-extrabold text-xs">Ventana Azul</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-950 border border-blue-500/30 text-blue-300">
                  {azulUsers.length} Users
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 font-mono">{formatCOP(azulCap)}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">$4.000.000 a $10.000.000 COP</p>
            </button>
          );
        })()}

        {/* Ventana Verde */}
        {(() => {
          const verdeUsers = allUsers.filter((u) => (u.role === 'USER' || u.participatesInTrading === true) && u.category === 'VERDE');
          const verdeCap = verdeUsers.reduce((sum, u) => sum + u.currentCapital, 0);
          const isSelected = selectedCategory === 'VERDE';
          return (
            <button
              onClick={() => setSelectedCategory('VERDE')}
              className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                isSelected
                  ? 'bg-emerald-950/80 border-emerald-500 text-emerald-100 shadow-lg shadow-emerald-500/20 ring-1 ring-emerald-500'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-850 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span className="font-extrabold text-xs">Ventana Verde</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-500/30 text-emerald-300">
                  {verdeUsers.length} Users
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 font-mono">{formatCOP(verdeCap)}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">&gt;$10.000.000 a $60.000.000 COP</p>
            </button>
          );
        })()}

        {/* Ventana Negra */}
        {(() => {
          const negraUsers = allUsers.filter((u) => (u.role === 'USER' || u.participatesInTrading === true) && u.category === 'NEGRA');
          const negraCap = negraUsers.reduce((sum, u) => sum + u.currentCapital, 0);
          const isSelected = selectedCategory === 'NEGRA';
          return (
            <button
              onClick={() => setSelectedCategory('NEGRA')}
              className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                isSelected
                  ? 'bg-slate-800 border-slate-400 text-slate-100 shadow-lg shadow-slate-500/20 ring-1 ring-slate-400'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-850 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                  <span className="font-extrabold text-xs">Ventana Bitácora Negra</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 border border-slate-600 text-slate-300">
                  {negraUsers.length} Users
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 font-mono">{formatCOP(negraCap)}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">&gt;$60.000.000 COP ? sin tope</p>
            </button>
          );
        })()}

        {/* Todas las Ventanas */}
        {(() => {
          const totalUsers = allUsers.filter((u) => u.role === 'USER' || u.participatesInTrading === true);
          const totalCap = totalUsers.reduce((sum, u) => sum + u.currentCapital, 0);
          const isSelected = selectedCategory === 'ALL';
          return (
            <button
              onClick={() => setSelectedCategory('ALL')}
              className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                isSelected
                  ? 'bg-indigo-950/80 border-indigo-500 text-indigo-100 shadow-lg shadow-indigo-500/20 ring-1 ring-indigo-500'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-850 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs">🪟</span>
                  <span className="font-extrabold text-xs">Todas las Ventanas</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-950 border border-indigo-500/30 text-indigo-300">
                  {totalUsers.length} Total
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 font-mono">{formatCOP(totalCap)}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Vista global de inversionistas</p>
            </button>
          );
        })()}
      </div>

      {/* Reconcile Banners */}
      {reconcileSuccessMsg && (
        <div className="p-4 rounded-xl bg-emerald-950/80 border border-emerald-500/50 flex items-center justify-between gap-3 text-emerald-200 animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span className="text-xs font-semibold">{reconcileSuccessMsg}</span>
          </div>
          <button onClick={() => setReconcileSuccessMsg(null)} className="text-emerald-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {reconcileErrorMsg && (
        <div className="p-4 rounded-xl bg-rose-950/80 border border-rose-500/50 flex items-center justify-between gap-3 text-rose-200 animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
            <span className="text-xs font-semibold">{reconcileErrorMsg}</span>
          </div>
          <button onClick={() => setReconcileErrorMsg(null)} className="text-rose-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filters Bar */}
      <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, código (USR-XXXXX), email o teléfono..."
            className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="text-xs text-slate-400 shrink-0 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> Estado:
          </span>
          {['ALL', 'ACTIVE', 'PENDING_CLAIM', 'INACTIVE'].map((st) => (
            <button
              key={st}
              onClick={() => setSelectedStatus(st)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer shrink-0 ${
                selectedStatus === st
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {st === 'ALL' ? 'Todos' : st === 'ACTIVE' ? 'Activos' : st === 'PENDING_CLAIM' ? 'Pendientes' : 'Inactivos'}
            </button>
          ))}
        </div>
      </div>

      {/* Users Window Container */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden">
        {/* Terminal Header Bar */}
        <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/90" />
              <div className="w-3 h-3 rounded-full bg-amber-500/90" />
              <div className="w-3 h-3 rounded-full bg-emerald-500/90" />
            </div>
            <span className="text-xs font-mono font-bold text-slate-300">
              {selectedCategory === 'ALL'
                ? 'VENTANA GLOBAL // TODOS LOS INVERSIONISTAS'
                : `VENTANA OPERATIVA // BITÁCORA ${selectedCategory}`}
            </span>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {filteredUsers.length} registros listados
          </span>
        </div>
        {/* Mobile View: Cards (block md:hidden) */}
        <div className="block md:hidden divide-y divide-slate-800/70">
          {filteredUsers.length === 0 ? (
            <div className="p-6 text-center text-slate-500 text-xs">
              No se encontraron inversionistas con los filtros seleccionados.
            </div>
          ) : (
            filteredUsers.map((user) => (
              <div key={user.id} className="p-4 space-y-3 hover:bg-slate-950/40 transition">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono font-bold text-blue-400 bg-blue-950/80 px-2 py-0.5 rounded border border-blue-500/20 text-xs">
                      {user.userCode}
                    </span>
                    <div>
                      <h4 className="font-bold text-slate-100 text-sm leading-tight flex items-center gap-1.5 flex-wrap">
                        <span>{user.fullName}</span>
                        {user.tradeNotificationAlias && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-950/80 border border-indigo-500/40 text-indigo-300" title={`Alias de notificación de trade diario: "${user.tradeNotificationAlias}"`}>
                            🔔 {user.tradeNotificationAlias}
                          </span>
                        )}
                      </h4>
                      <span className="text-[11px] text-slate-400 font-mono">{user.email}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleOpenEdit(user)}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer"
                    title="Editar inversionista"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
                    <span className="text-[10px] text-slate-500 uppercase block font-semibold">Capital Snapshot</span>
                    <span className="font-mono font-black text-slate-100 text-sm mt-0.5 block">
                      {formatCOP(user.currentCapital)}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 flex flex-col justify-center">
                    <span className="text-[10px] text-slate-500 uppercase block font-semibold">Bitácora / Split</span>
                    <div className="flex items-center justify-between mt-0.5">
                      <span
                        className={`text-[10px] font-bold font-mono px-1.5 py-0.2 rounded ${
                          user.category === 'AZUL'
                            ? 'bg-blue-950 text-blue-300'
                            : user.category === 'VERDE'
                            ? 'bg-emerald-950 text-emerald-300'
                            : 'bg-slate-800 text-slate-200'
                        }`}
                      >
                        {user.category === 'AZUL' ? '🔵 Azul' : user.category === 'VERDE' ? '🟢 Verde' : '⚫ Negra'}
                      </span>
                      <span className="font-mono font-bold text-emerald-400 text-[11px]">
                        {user.userPercentage}% / {user.adminPercentage}%
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                  <div className="flex items-center gap-1.5 truncate max-w-[150px]">
                    <span className="font-semibold text-slate-300">{user.paymentMethod}:</span>
                    <span className="font-mono truncate">{user.paymentDetails}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleCopyWhatsAppAccess(user)}
                      disabled={generatingTokenUserId === user.id}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer disabled:opacity-60 ${
                        copiedUserId === user.id
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-500/50'
                          : 'bg-slate-900 hover:bg-slate-800 text-emerald-400 border-emerald-500/30'
                      }`}
                      title={user.isClaimed ? 'Copiar datos de acceso para WhatsApp' : 'Generar token criptográfico y copiar acceso'}
                    >
                      {generatingTokenUserId === user.id ? (
                        <>
                          <div className="w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                          <span>Generando...</span>
                        </>
                      ) : copiedUserId === user.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span>¡Copiado!</span>
                        </>
                      ) : (
                        <>
                          {user.isClaimed ? (
                            <MessageCircle className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <KeyRound className="w-3 h-3 text-amber-400" />
                          )}
                          <span>{user.isClaimed ? 'WhatsApp' : 'Token Act.'}</span>
                        </>
                      )}
                    </button>
                    {isSuperAdmin && user.status === 'ACTIVE' && (
                      <button
                        onClick={() => {
                          setTestPushUser(user);
                          setTestPushResult(null);
                        }}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-blue-950/80 hover:bg-blue-900 border border-blue-500/40 text-blue-300 hover:text-white transition cursor-pointer"
                        title="Probar envío Push FCM directo"
                      >
                        <Sparkles className="w-3 h-3 text-blue-400" />
                        <span>Push</span>
                      </button>
                    )}
                    <button
                      onClick={() => handleOpenEdit(user)}
                      className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer"
                      title="Editar inversionista"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setUserToDelete(user)}
                      className="p-1 rounded-lg bg-rose-950/60 hover:bg-rose-900/80 text-rose-400 border border-rose-800/40 transition cursor-pointer"
                      title="Eliminar inversionista"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold font-mono ${
                        user.status === 'ACTIVE'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {user.status === 'ACTIVE' ? 'Activo' : user.status}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Desktop View: Full Table (hidden md:block) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                <th className="pb-3 px-3">Código</th>
                <th className="pb-3 px-3">Inversionista</th>
                <th className="pb-3 px-3">Bitácora / Rango</th>
                <th className="pb-3 px-3">Capital Actual</th>
                <th className="pb-3 px-3">Split Acordado</th>
                <th className="pb-3 px-3">Datos Bancarios</th>
                <th className="pb-3 px-3">Estado</th>
                <th className="pb-3 px-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-slate-950/40 transition">
                  {/* Code */}
                  <td className="py-3.5 px-3">
                    <span className="font-mono font-bold text-blue-400 bg-blue-950/80 px-2 py-0.5 rounded border border-blue-500/20 text-xs">
                      {user.userCode}
                    </span>
                  </td>

                  {/* Name & Contact */}
                  <td className="py-3.5 px-3">
                    <p className="font-bold text-slate-100 text-sm flex items-center gap-1.5 flex-wrap">
                      <span>{user.fullName}</span>
                      {user.tradeNotificationAlias && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-950/80 border border-indigo-500/40 text-indigo-300" title={`Alias de notificación de trade diario: "${user.tradeNotificationAlias}"`}>
                          🔔 {user.tradeNotificationAlias}
                        </span>
                      )}
                      {user.permissions?.supportAgent && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-950/90 border border-blue-500/50 text-blue-300 font-bold" title="Agente de Soporte Técnico Autorizado">
                          🎧 Soporte
                        </span>
                      )}
                    </p>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                      <span className="flex items-center gap-1">
                        <Mail className="w-3 h-3 text-slate-500" /> {user.email}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Phone className="w-3 h-3 text-slate-500" /> {user.phone}
                      </span>
                    </div>
                  </td>

                  {/* Bitácora */}
                  <td className="py-3.5 px-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold font-mono text-[11px] border ${
                        user.category === 'AZUL'
                          ? 'bg-blue-950 text-blue-300 border-blue-500/40'
                          : user.category === 'VERDE'
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-500/40'
                          : 'bg-slate-800 text-slate-200 border-slate-600'
                      }`}
                    >
                      {user.category === 'AZUL' ? '🔵 Azul' : user.category === 'VERDE' ? '🟢 Verde' : '⚫ Negra'}
                    </span>
                  </td>

                  {/* Capital */}
                  <td className="py-3.5 px-3 font-mono font-bold text-slate-100 text-sm">
                    {formatCOP(user.currentCapital)}
                  </td>

                  {/* Split */}
                  <td className="py-3.5 px-3 font-mono font-bold">
                    <span className="text-emerald-400">{user.userPercentage}% Inversionista</span>
                    <span className="text-slate-500 mx-1">/</span>
                    <span className="text-amber-400">{user.adminPercentage}% Admin</span>
                  </td>

                  {/* Bank */}
                  <td className="py-3.5 px-3 text-slate-300 text-[11px]">
                    <p className="font-semibold text-slate-200">{user.paymentMethod}</p>
                    <p className="font-mono text-slate-400">{user.paymentDetails}</p>
                  </td>

                  {/* Status & Activation */}
                  <td className="py-3.5 px-3">
                    <div className="space-y-1">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold font-mono ${
                          user.status === 'ACTIVE'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {user.status === 'ACTIVE' ? 'Activo' : user.status}
                      </span>
                      <div>
                        {user.isClaimed ? (
                          <span className="text-[10px] text-emerald-400/90 font-mono flex items-center gap-1">
                            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400 shrink-0" /> Clave Activa
                          </span>
                        ) : (
                          <span className="text-[10px] text-amber-400 font-mono flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5 text-amber-400 shrink-0" /> Por Activar
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="py-3.5 px-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Caso A: Inversionista Pendiente de Activación */}
                      {((user.status === 'PENDING_CLAIM' || user.status === 'PENDING') && !user.isClaimed && !user.uid) && (
                        <button
                          onClick={() => handleCopyWhatsAppAccess(user)}
                          disabled={generatingTokenUserId === user.id}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer disabled:opacity-60 ${
                            copiedUserId === user.id
                              ? 'bg-amber-950 text-amber-300 border-amber-500/50'
                              : 'bg-slate-800 hover:bg-slate-700 text-amber-400 hover:text-amber-300 border-amber-500/30'
                          }`}
                          title="Generar token seguro de activación y copiar plantilla para WhatsApp"
                        >
                          {generatingTokenUserId === user.id ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                              <span>Generando...</span>
                            </>
                          ) : copiedUserId === user.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-amber-400" />
                              <span>¡Copiado!</span>
                            </>
                          ) : (
                            <>
                              <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                              <span>Generar Token</span>
                            </>
                          )}
                        </button>
                      )}

                      {/* Caso B: Usuario Inconsistente Reconciliable (Auth existe en Firebase, Firestore sin isClaimed) */}
                      {(!user.isClaimed && user.id && user.id.length >= 20 && user.status !== 'PENDING_CLAIM' && user.status !== 'MIGRATED') && (
                        <button
                          onClick={() => handleReconcileUser(user)}
                          disabled={reconcilingUserId === user.id}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer disabled:opacity-60 bg-blue-950/80 hover:bg-blue-900 text-blue-300 border-blue-500/40"
                          title="Reconciliar con cuenta existente de Firebase Auth"
                        >
                          {reconcilingUserId === user.id ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                              <span>Reconciliando...</span>
                            </>
                          ) : (
                            <>
                              <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                              <span>Reconciliar</span>
                            </>
                          )}
                        </button>
                      )}

                      {/* Caso C: Usuario Activo Directo con Credenciales */}
                      {((user.status === 'ACTIVE' || user.isClaimed) && (user.uid || (user.id && user.id.length >= 20)) && !(user.status === 'PENDING_CLAIM' && !user.isClaimed)) && (
                        <button
                          onClick={() => handleCopyWhatsAppAccess(user)}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                            copiedUserId === user.id
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-500/50'
                              : 'bg-slate-800 hover:bg-slate-700 text-emerald-400 hover:text-emerald-300 border-emerald-500/30'
                          }`}
                          title="Copiar mensaje con datos de acceso para WhatsApp"
                        >
                          {copiedUserId === user.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span>¡Copiado!</span>
                            </>
                          ) : (
                            <>
                              <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Enviar Acceso</span>
                            </>
                          )}
                        </button>
                      )}

                      {/* Botón Probar Push para SuperAdmin en Desktop */}
                      {isSuperAdmin && user.status === 'ACTIVE' && (
                        <button
                          onClick={() => {
                            setTestPushUser(user);
                            setTestPushResult(null);
                          }}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-blue-950/80 hover:bg-blue-900 border border-blue-500/40 text-blue-300 hover:text-white transition cursor-pointer"
                          title="Probar envío Push FCM directo a este usuario"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                          <span>Probar Push</span>
                        </button>
                      )}

                      <button
                        onClick={() => handleOpenEdit(user)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer"
                        title="Editar inversionista"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => setUserToDelete(user)}
                        className="p-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900/80 text-rose-400 hover:text-rose-300 border border-rose-800/50 transition cursor-pointer"
                        title="Eliminar inversionista"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: Add / Edit User */}
      {(isAddModalOpen || editingUser) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative text-slate-100 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => {
                setIsAddModalOpen(false);
                setEditingUser(null);
              }}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <UserPlus className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-100">
                  {editingUser
                    ? `Editar: ${editingUser.fullName}`
                    : createMode === 'PENDING'
                    ? 'Registrar Inversionista (Pendiente)'
                    : 'Crear Usuario Activo Directamente'}
                </h3>
                <p className="text-xs text-slate-400">
                  {editingUser
                    ? `Código: ${editingUser.userCode}`
                    : createMode === 'PENDING'
                    ? 'Perfil en Firestore pendiente de reclamo y token seguro'
                    : 'Crea cuenta inmediata en Firebase Auth y Firestore'}
                </p>
              </div>
            </div>

            {/* Selector de Modo (Solo al crear) */}
            {!editingUser && (
              <div className="space-y-3 mb-2">
                <div className="grid grid-cols-2 gap-2 p-1.5 rounded-xl bg-slate-950 border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setCreateMode('PENDING')}
                    className={`py-2 px-3 rounded-lg text-xs font-bold transition flex flex-col items-center gap-0.5 cursor-pointer ${
                      createMode === 'PENDING'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5" />
                      Registrar Inversionista
                    </span>
                    <span className="text-[10px] font-normal opacity-80">(Recomendado)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCreateMode('ACTIVE')}
                    className={`py-2 px-3 rounded-lg text-xs font-bold transition flex flex-col items-center gap-0.5 cursor-pointer ${
                      createMode === 'ACTIVE'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Crear Usuario Activo
                    </span>
                    <span className="text-[10px] font-normal opacity-80">(Modo Directo)</span>
                  </button>
                </div>

                {createMode === 'PENDING' ? (
                  <div className="p-3 rounded-xl bg-blue-950/30 border border-blue-500/30 text-xs text-blue-200">
                    <p className="font-semibold text-blue-100 flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-blue-400" /> Modo Pendiente de Activación
                    </p>
                    <p className="text-[11px] text-blue-300/90 mt-1">
                      El inversionista recibirá un código y token seguro de activación para registrar su propia contraseña. No se crea cuenta en Firebase Auth hasta que el usuario la active.
                    </p>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200">
                    <p className="font-semibold text-amber-100 flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-amber-400" /> Modo Activo Directo
                    </p>
                    <p className="text-[11px] text-amber-300/90 mt-1">
                      Se crea inmediatamente una cuenta de acceso en Firebase Authentication con la contraseña inicial asignada. El inversionista no pasará por flujo de activación.
                    </p>
                  </div>
                )}
              </div>
            )}

            <form onSubmit={handleSaveUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Nombre Completo</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="ej: Diana Marcela Torres"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-300">
                    Nombre para notificación de trade diario
                  </label>
                  {formTradeAlias.trim() && (
                    <button
                      type="button"
                      onClick={() => setFormTradeAlias('')}
                      className="text-[10px] text-rose-400 hover:text-rose-300 hover:underline cursor-pointer"
                    >
                      Restablecer al nombre real
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  maxLength={30}
                  value={formTradeAlias}
                  onChange={(e) => setFormTradeAlias(e.target.value)}
                  placeholder="ej: Toro (opcional)"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                />
                <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                  Solo cambia el nombre mostrado en el saludo de la notificación de la operación diaria. No modifica el nombre real del usuario.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Correo Electrónico</label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="cliente@email.com"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Teléfono / WhatsApp</label>
                  <input
                    type="tel"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="+57 300 000 0000"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
              </div>

              {!editingUser && createMode === 'ACTIVE' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Contraseña Inicial (Para Firebase Auth)
                  </label>
                  <input
                    type="text"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder="Contraseña inicial min 6 caracteres"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                    required
                    minLength={6}
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Esta contraseña registrará inmediatamente al usuario en Firebase Authentication para que pueda iniciar sesión.
                  </p>
                </div>
              )}

              {/* Capital & Dynamic Category Box */}
              {editingUser ? (
                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-slate-300">Capital Operativo (COP)</label>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-500/30">
                      Solo Lectura
                    </span>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-slate-500">$</span>
                    <input
                      type="text"
                      disabled
                      value={Number(editingUser.currentCapital || 0).toLocaleString('es-CO')}
                      className="w-full bg-slate-900/50 border border-slate-800 rounded-lg pl-7 pr-3 py-2 text-slate-300 font-mono font-bold text-sm cursor-not-allowed opacity-80"
                    />
                  </div>

                  <p className="text-[11px] text-amber-300/90 flex items-center gap-1.5 bg-amber-950/30 border border-amber-500/20 px-2.5 py-1.5 rounded-lg">
                    <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>Capital operativo administrado por el sistema financiero.</span>
                  </p>

                  <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800/60 mt-1">
                    <span className="text-slate-400">Bitácora Oficial:</span>
                    <span
                      className={`px-2 py-0.5 rounded font-mono font-bold ${
                        editingUser.category === 'AZUL'
                          ? 'bg-blue-950 text-blue-300 border border-blue-500/40'
                          : editingUser.category === 'VERDE'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                          : 'bg-slate-800 text-slate-200 border border-slate-600'
                      }`}
                    >
                      {editingUser.category === 'AZUL'
                        ? '🔵 Azul'
                        : editingUser.category === 'VERDE'
                        ? '🟢 Verde'
                        : '⚫ Negra'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <label className="block text-xs font-semibold text-slate-300">Capital de Inversión (COP)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-slate-400">$</span>
                    <input
                      type="number"
                      step="100000"
                      min="4000000"
                      max={Number.MAX_SAFE_INTEGER}
                      value={formCapital}
                      onChange={(e) => setFormCapital(e.target.value)}
                      placeholder="8000000"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-7 pr-3 py-2 text-slate-100 font-mono font-bold text-sm focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1">
                    <span className="text-slate-400">Bitácora Asignada Automáticamente:</span>
                    <span
                      className={`px-2 py-0.5 rounded font-mono font-bold ${
                        detectedCategory === 'AZUL'
                          ? 'bg-blue-950 text-blue-300 border border-blue-500/40'
                          : detectedCategory === 'VERDE'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                          : 'bg-slate-800 text-slate-200 border border-slate-600'
                      }`}
                    >
                      {detectedCategory === 'AZUL'
                        ? '🔵 Azul ($4M - <$10M)'
                        : detectedCategory === 'VERDE'
                        ? '🟢 Verde ($10M - <$60M)'
                        : '⚫ Negra ($60M+)'}
                    </span>
                  </div>
                </div>
              )}

              {/* Target Cycle Selection */}
              {!editingUser && hasValidFutureCycle && preparingCycle && (
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <label className="block text-xs font-semibold text-slate-300">Ciclo de Ingreso</label>
                  {!config?.operationalCycleId ? (
                    <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs">
                      <p className="font-semibold">
                        El nuevo inversionista ingresará al ciclo en preparación:{' '}
                        <span className="font-bold underline">{preparingCycle.name}</span>
                      </p>
                      <p className="text-[10px] text-emerald-400/80 mt-1">
                        (No existe ciclo operativo actualmente activo; su capital quedará asegurado para el inicio de este ciclo).
                      </p>
                    </div>
                  ) : (
                    <>
                      <select
                        value={formTargetCycleId}
                        onChange={(e) => setFormTargetCycleId(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                      >
                        <option value="">Ingresar en Ciclo Activo Actual</option>
                        <option value={preparingCycle.cycleId}>
                          {preparingCycle.isGenesis
                            ? `Ingresar al ciclo en preparación: ${preparingCycle.name}`
                            : `Ingresar desde el Ciclo de Preparación: ${preparingCycle.name}`}
                        </option>
                      </select>
                      <p className="text-[10px] text-slate-400">
                        Si se selecciona el ciclo de preparación, el capital se registrará en el backend con ingreso programado para {preparingCycle.name}.
                      </p>
                    </>
                  )}
                </div>
              )}

              {/* Split Distribution */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">Reparto de Rentabilidad (Split %)</label>
                  <span className="text-xs text-slate-400 font-mono">Suma obligatoria: 100%</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[11px] text-emerald-400 font-semibold">% Inversionista:</span>
                    <input
                      type="number"
                      min="1"
                      max="99"
                      value={formUserSplit}
                      onChange={(e) => setFormUserSplit(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-emerald-300 font-mono font-bold text-sm mt-1 focus:outline-none focus:border-emerald-500"
                      required
                    />
                  </div>
                  <div>
                    <span className="text-[11px] text-amber-400 font-semibold">% Administrador:</span>
                    <input
                      type="number"
                      disabled
                      value={adminSplit}
                      className="w-full bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-1.5 text-amber-300 font-mono font-bold text-sm mt-1"
                    />
                  </div>
                </div>
              </div>

              {/* Bank Details */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Banco / Billetera</label>
                  <select
                    value={formBank}
                    onChange={(e) => setFormBank(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    <option value="Bancolombia">Bancolombia</option>
                    <option value="Nequi">Nequi</option>
                    <option value="Davivienda">Davivienda</option>
                    <option value="Llaves (Bre-B / Transfiya)">Llaves (Bre-B / Transfiya)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Número de Cuenta</label>
                  <input
                    type="text"
                    value={formAccount}
                    onChange={(e) => setFormAccount(e.target.value)}
                    placeholder="1234567890"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Support Permissions Configuration (SuperAdmin Only on Edit) */}
              {editingUser && isSuperAdmin && (
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-blue-400" />
                      Permisos de Soporte Técnico
                    </label>
                    <span className="text-[10px] font-bold text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-500/30">
                      SuperAdmin
                    </span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <label className="flex items-center gap-2 text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formSupportAgent}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setFormSupportAgent(checked);
                          if (!checked) {
                            setFormSupportReadUserContext(false);
                            setFormSupportReadOperationalContext(false);
                          }
                        }}
                        className="rounded border-slate-700 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                      <span className="font-semibold">Agente de soporte (supportAgent)</span>
                    </label>

                    {formSupportAgent && (
                      <div className="pl-6 space-y-2 border-l border-slate-800 ml-2">
                        <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formSupportReadUserContext}
                            onChange={(e) => setFormSupportReadUserContext(e.target.checked)}
                            className="rounded border-slate-700 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                          <span>Ver contexto del usuario (supportReadUserContext)</span>
                        </label>

                        <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formSupportReadOperationalContext}
                            onChange={(e) => setFormSupportReadOperationalContext(e.target.checked)}
                            className="rounded border-slate-700 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                          <span>Ver contexto operacional (supportReadOperationalContext)</span>
                        </label>
                      </div>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-400 leading-snug bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                    Este permiso no concede acceso a operaciones financieras, capitales, cierres ni administración.
                  </p>
                </div>
              )}

              {formError && (
                <div className="p-3 rounded-lg bg-red-950/60 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    setIsAddModalOpen(false);
                    setEditingUser(null);
                  }}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-xl transition disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-lg shadow-blue-600/30 transition cursor-pointer flex items-center gap-2 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Procesando...</span>
                    </>
                  ) : editingUser ? (
                    'Guardar Cambios'
                  ) : (
                    'Registrar Inversionista'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Excel Bitacora / User Import Modal */}
      <ExcelBitacoraImportModal
        isOpen={isExcelModalOpen}
        onClose={() => setIsExcelModalOpen(false)}
        defaultCategory={selectedCategory !== 'ALL' ? (selectedCategory as BitacoraCategory) : undefined}
      />

      {/* Confirmation Modal: Delete User */}
      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-400 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div className="text-center">
              <h3 className="text-base font-extrabold text-slate-100">¿Eliminar Inversionista?</h3>
              <p className="text-xs text-slate-300 mt-2">
                Esta acción eliminará permanentemente a <strong className="text-rose-400">{userToDelete.fullName}</strong> ({userToDelete.userCode}) tanto de la base de datos Firestore como de la plataforma.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                disabled={isDeletingUser}
                onClick={() => setUserToDelete(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeletingUser}
                onClick={handleConfirmDelete}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-lg shadow-rose-600/30 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                {isDeletingUser ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Eliminando...</span>
                  </>
                ) : (
                  'Sí, Eliminar'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Purga de Usuarios de Prueba (Preview + Purga Destructiva) */}
      {isPurgeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5 text-left max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-400 flex items-center justify-center shrink-0">
                  <Trash2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-100 flex items-center gap-2">
                    Purga de Usuarios de Prueba
                  </h3>
                  <p className="text-xs text-slate-400">
                    Limpieza segura e irreversible de cuentas de prueba e historial
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsPurgeModalOpen(false)}
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Banner Informativo */}
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-200">Previsualización (Dry Run Obligatorio)</p>
                <p className="text-[11px] text-amber-300/80 mt-0.5">
                  Las cuentas con rol <strong>ADMIN</strong>, credenciales SuperAdmin y listas protegidas están 100% blindadas y NO serán eliminadas.
                </p>
              </div>
            </div>

            {/* Opciones de Purga */}
            {!purgeResultData && (
              <div className="space-y-3 p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={deleteTestFinancialData}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setDeleteTestFinancialData(val);
                      runPurgePreview(val, resetUserCounter);
                    }}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-rose-500"
                  />
                  <div>
                    <span className="font-semibold text-slate-200">Eliminar registros financieros de prueba en Operaciones Diarias</span>
                    <p className="text-[10px] text-slate-400">Si está marcado, elimina operaciones que pertenezcan exclusivamente a usuarios purgados.</p>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={resetUserCounter}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setResetUserCounter(val);
                      runPurgePreview(deleteTestFinancialData, val);
                    }}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-rose-500"
                  />
                  <div>
                    <span className="font-semibold text-slate-200">Resetear contador correlativo (/counters/users) a USR-1001</span>
                    <p className="text-[10px] text-slate-400">Solo se aplicará si no queda ningún usuario normal activo en la base de datos.</p>
                  </div>
                </label>
              </div>
            )}

            {/* Vista Previa de Resultados (Dry Run) */}
            {isDryRunLoading ? (
              <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 text-center space-y-2">
                <div className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs font-semibold text-slate-300">Calculando previsualización segura (Dry Run)...</p>
              </div>
            ) : purgePreviewData && !purgeResultData ? (
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <h4 className="text-xs uppercase font-extrabold text-slate-400 tracking-wider">
                  Resumen de Elementos Detectados para Purga:
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono">
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                    <p className="text-[10px] text-slate-400 uppercase">Auth Users</p>
                    <p className="text-base font-black text-rose-400">{purgePreviewData.authUsersToDelete}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                    <p className="text-[10px] text-slate-400 uppercase">Firestore Docs</p>
                    <p className="text-base font-black text-rose-400">{purgePreviewData.firestoreUsersToDelete}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                    <p className="text-[10px] text-slate-400 uppercase">Push Tokens</p>
                    <p className="text-base font-black text-slate-300">{purgePreviewData.pushTokensToDelete}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                    <p className="text-[10px] text-slate-400 uppercase">Reinversiones</p>
                    <p className="text-base font-black text-slate-300">{purgePreviewData.reinvestmentsToDelete}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                    <p className="text-[10px] text-slate-400 uppercase">Desembolsos</p>
                    <p className="text-base font-black text-slate-300">{purgePreviewData.disbursementsToDelete}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                    <p className="text-[10px] text-slate-400 uppercase">Inversiones</p>
                    <p className="text-base font-black text-slate-300">{purgePreviewData.investmentsToDelete}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                    <p className="text-[10px] text-slate-400 uppercase">Notificaciones</p>
                    <p className="text-base font-black text-slate-300">{purgePreviewData.notificationsToDelete}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                    <p className="text-[10px] text-slate-400 uppercase">Reclamaciones</p>
                    <p className="text-base font-black text-slate-300">{purgePreviewData.claimOperationsToDelete}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                    <p className="text-[10px] text-slate-400 uppercase">Op. Diarias Afec.</p>
                    <p className="text-base font-black text-amber-400">{purgePreviewData.dailyOperationsAffected}</p>
                  </div>
                </div>
                <div className="pt-1 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Usuarios Protegidos Conservados: <strong className="text-emerald-400">{purgePreviewData.protectedUsersCount}</strong></span>
                  {resetUserCounter && (
                    <span className="text-indigo-300">Contador se reseteará a USR-1001</span>
                  )}
                </div>
              </div>
            ) : null}

            {/* Resultado de la Ejecución Real */}
            {purgeResultData && (
              <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 space-y-3 text-xs">
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <Check className="w-5 h-5" />
                  <span>Purga Realizada Exitosamente</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono">
                  <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                    <p className="text-[10px] text-slate-400">Auth Borrados</p>
                    <p className="text-sm font-bold text-emerald-300">{purgeResultData.authUsersDeleted}</p>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                    <p className="text-[10px] text-slate-400">Firestore Borrados</p>
                    <p className="text-sm font-bold text-emerald-300">{purgeResultData.firestoreUsersDeleted}</p>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                    <p className="text-[10px] text-slate-400">Contador Reseteado</p>
                    <p className="text-sm font-bold text-indigo-300">{purgeResultData.userCounterReset ? 'SÍ (USR-1001)' : 'NO'}</p>
                  </div>
                </div>
                {purgeResultData.errors && purgeResultData.errors.length > 0 && (
                  <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/40 text-[11px] text-rose-300 space-y-1">
                    <p className="font-bold">Advertencias / Reportes:</p>
                    {purgeResultData.errors.map((e: string, idx: number) => (
                      <p key={idx}>• {e}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Paso de Confirmación por Escrito */}
            {purgePreviewData && !purgeResultData && (
              <div className="space-y-2 pt-1">
                <label className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">
                  Para confirmar, escribe exactamente: <strong className="text-rose-400">PURGAR USUARIOS DE PRUEBA</strong>
                </label>
                <input
                  type="text"
                  value={purgeConfirmationInput}
                  onChange={(e) => setPurgeConfirmationInput(e.target.value)}
                  placeholder="PURGAR USUARIOS DE PRUEBA"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-rose-500"
                />
              </div>
            )}

            {/* Botones de Acción */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                disabled={isExecutingPurge}
                onClick={() => setIsPurgeModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition disabled:opacity-50"
              >
                {purgeResultData ? 'Cerrar' : 'Cancelar'}
              </button>
              {!purgeResultData && (
                <button
                  type="button"
                  disabled={isExecutingPurge || isDryRunLoading || purgeConfirmationInput.trim() !== 'PURGAR USUARIOS DE PRUEBA'}
                  onClick={handleExecutePurge}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-lg shadow-rose-600/30 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isExecutingPurge ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Purgando...</span>
                    </>
                  ) : (
                    'PURGAR DESTRUCTIVAMENTE'
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Token de Activación Criptográfico Generado (FASE 1B Anti-Hijacking) */}
      {generatedTokenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5 text-left">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-100 flex items-center gap-2">
                    Token de Activación Generado
                  </h3>
                  <p className="text-xs text-slate-400">
                    Inversionista: <strong className="text-slate-200">{generatedTokenModal.fullName}</strong> ({generatedTokenModal.userCode})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setGeneratedTokenModal(null)}
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-200">Prueba de posesión de un solo uso (Anti-Hijacking)</p>
                <p className="text-[11px] text-amber-300/80 mt-0.5">
                  El servidor guardó el hash criptográfico SHA-256. El token en texto claro solo se muestra en esta ocasión.
                </p>
              </div>
            </div>

            {/* User Code Copy Block */}
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">
                Código de Usuario (userCode)
              </label>
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                <span className="flex-1 font-mono font-extrabold text-xs sm:text-sm text-indigo-300 tracking-wider select-all">
                  {generatedTokenModal.userCode}
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(generatedTokenModal.userCode || '');
                    setCopiedModalField('code');
                    setTimeout(() => setCopiedModalField(null), 2000);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition shrink-0 cursor-pointer"
                >
                  {copiedModalField === 'code' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">✓ Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span>Copiar</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Token Copy Block */}
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">
                Token de Activación (Secreto Temporal)
              </label>
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                <span className="flex-1 font-mono font-black text-xs sm:text-sm text-amber-300 tracking-wider break-all select-all">
                  {generatedTokenModal.token}
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(generatedTokenModal.token);
                    setCopiedModalField('token');
                    setTimeout(() => setCopiedModalField(null), 2500);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition shrink-0 cursor-pointer"
                >
                  {copiedModalField === 'token' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span>Copiar</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Direct Link Block */}
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">
                URL de Activación
              </label>
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                <span className="flex-1 font-mono text-xs text-slate-300 truncate select-all">
                  {generatedTokenModal.directUrl}
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(generatedTokenModal.directUrl);
                    setCopiedModalField('url');
                    setTimeout(() => setCopiedModalField(null), 2500);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition shrink-0 cursor-pointer"
                >
                  {copiedModalField === 'url' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span>Copiar Link</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-center gap-2 pt-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedTokenModal.whatsappMessage);
                  setCopiedModalField('whatsapp');
                  setTimeout(() => setCopiedModalField(null), 2500);
                }}
                className="w-full sm:flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 cursor-pointer"
              >
                {copiedModalField === 'whatsapp' ? (
                  <>
                    <Check className="w-4 h-4 text-white" />
                    <span>¡Mensaje de WhatsApp Copiado!</span>
                  </>
                ) : (
                  <>
                    <MessageCircle className="w-4 h-4 text-white" />
                    <span>Copiar Mensaje WhatsApp</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setGeneratedTokenModal(null)}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Diagnóstico Directo FCM / Push Test */}
      {testPushUser && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-slate-100 text-sm">Prueba Push FCM Directa</h3>
              </div>
              <button
                onClick={() => setTestPushUser(null)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <p className="text-slate-400">
                  Usuario Target: <span className="font-bold text-slate-100">{testPushUser.fullName}</span>
                </p>
                <p className="text-slate-400 font-mono text-[11px]">
                  Código: <span className="text-blue-400">{testPushUser.userCode}</span> | UID: <span className="text-slate-300">{testPushUser.uid || testPushUser.id}</span>
                </p>
              </div>

              <p className="text-slate-300 text-[11px]">
                Selecciona el modo de mensaje FCM para despachar un Push de diagnóstico sin modificar datos ni jornadas financieras:
              </p>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleSendTestPush('notification')}
                  disabled={isSendingTestPush}
                  className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-xs shadow-md transition cursor-pointer"
                >
                  {isSendingTestPush ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  <span>Probar Notification</span>
                </button>

                <button
                  onClick={() => handleSendTestPush('data')}
                  disabled={isSendingTestPush}
                  className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold text-xs shadow-md transition cursor-pointer"
                >
                  {isSendingTestPush ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  <span>Probar Data-only</span>
                </button>
              </div>

              {testPushResult && (
                <div className={`p-4 rounded-xl border text-xs space-y-2 animate-in fade-in ${
                  testPushResult.success && testPushResult.successCount > 0
                    ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-200'
                    : testPushResult.tokenCount === 0
                    ? 'bg-amber-950/80 border-amber-500/50 text-amber-200'
                    : 'bg-rose-950/80 border-rose-500/50 text-rose-200'
                }`}>
                  <div className="flex items-center justify-between font-bold">
                    <span>Resultado Modo {testPushResult.mode === 'data' ? 'Data-only' : 'Notification'}:</span>
                    <span className="font-mono">{testPushResult.success ? 'OK' : 'ERROR'}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 font-mono text-[11px] pt-1">
                    <div className="p-2 rounded bg-slate-900/80 border border-slate-700/50 text-center">
                      <span className="block text-[10px] text-slate-400 uppercase">Tokens</span>
                      <span className="font-bold text-slate-100">{testPushResult.tokenCount}</span>
                    </div>
                    <div className="p-2 rounded bg-slate-900/80 border border-slate-700/50 text-center">
                      <span className="block text-[10px] text-emerald-400 uppercase">Éxito</span>
                      <span className="font-bold text-emerald-300">{testPushResult.successCount}</span>
                    </div>
                    <div className="p-2 rounded bg-slate-900/80 border border-slate-700/50 text-center">
                      <span className="block text-[10px] text-rose-400 uppercase">Fallidos</span>
                      <span className="font-bold text-rose-300">{testPushResult.failureCount}</span>
                    </div>
                  </div>

                  {testPushResult.errorCodes && testPushResult.errorCodes.length > 0 && (
                    <div className="pt-1 text-[10px] font-mono text-rose-300">
                      <span className="font-bold">Error Codes:</span> {testPushResult.errorCodes.join(', ')}
                    </div>
                  )}

                  {testPushResult.message && (
                    <p className="text-[11px] font-sans pt-1 border-t border-slate-800">
                      {testPushResult.message}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
