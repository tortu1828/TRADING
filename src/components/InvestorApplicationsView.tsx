import React, { useState, useMemo } from 'react';
import {
  Users,
  Clock,
  CheckCircle2,
  XCircle,
  Upload,
  Download,
  Plus,
  Search,
  ArrowUpDown,
  FileSpreadsheet,
  MessageCircle,
  Copy,
  ExternalLink,
  ChevronUp,
  ChevronDown,
  Sparkles,
  AlertTriangle,
  Info,
  Calendar,
  DollarSign,
  Building2,
  Phone,
  Mail,
  ShieldCheck,
  UserCheck,
  Check,
  Link,
  Trash2,
  RotateCcw,
} from 'lucide-react';
import { InvestorApplication, BitacoraCategory, UserProfile } from '../types';
import { dataStore } from '../lib/dataStore';
import { firestoreService } from '../lib/firestoreService';
import { getAppBaseUrl } from '../lib/constants';
import { useAuth } from '../context/AuthContext';
import { getCategoryForCapital } from '../lib/financialEngine';
import {
  parseExcelApplicationsFile,
  parsePastedApplicationsText,
  downloadApplicationsExcelTemplate,
  exportApplicationsToExcelFile,
  ParsedApplicationRow,
} from '../lib/excelApplicationImporter';

interface InvestorApplicationsViewProps {
  onNavigateToUser?: (userId: string) => void;
}

export const InvestorApplicationsView: React.FC<InvestorApplicationsViewProps> = ({ onNavigateToUser }) => {
  const { currentUser } = useAuth();
  const [applications, setApplications] = useState<InvestorApplication[]>(() => dataStore.getApplications());
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | BitacoraCategory>('ALL');

  // Modales
  const [showImportModal, setShowImportModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [approvingApp, setApprovingApp] = useState<InvestorApplication | null>(null);
  const [rejectingApp, setRejectingApp] = useState<InvestorApplication | null>(null);
  const [deletingApp, setDeletingApp] = useState<InvestorApplication | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteSuccessMsg, setDeleteSuccessMsg] = useState<string | null>(null);
  const [showRenumberModal, setShowRenumberModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [generatedWelcomeModal, setGeneratedWelcomeModal] = useState<{
    app: InvestorApplication;
    message: string;
    userCode: string;
  } | null>(null);

  // Estados para Modal de Aprobación
  const [approvalCapitalStr, setApprovalCapitalStr] = useState<string>('8.000.000');
  const [approvalCategory, setApprovalCategory] = useState<BitacoraCategory>('AZUL');
  const [approvalBank, setApprovalBank] = useState<string>('Bancolombia');
  const [approvalPaymentDetails, setApprovalPaymentDetails] = useState<string>('');
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [generatingAccessAppId, setGeneratingAccessAppId] = useState<string | null>(null);

  // Estados para Importador
  const [importTab, setImportTab] = useState<'file' | 'paste'>('file');
  const [pastedText, setPastedText] = useState('');
  const [parsedPreviewRows, setParsedPreviewRows] = useState<ParsedApplicationRow[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccessCount, setImportSuccessCount] = useState<number | null>(null);
  const [replaceQueueOnImport, setReplaceQueueOnImport] = useState(false);

  // Estado para creación manual
  const [manualName, setManualName] = useState('');
  const [manualDoc, setManualDoc] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [manualCity, setManualCity] = useState('Medellín');
  const [manualCapitalStr, setManualCapitalStr] = useState('8.000.000');
  const [manualBank, setManualBank] = useState('Bancolombia');
  const [manualNotes, setManualNotes] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  // Copiado al portapapeles
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedApplyLink, setCopiedApplyLink] = useState(false);

  // Suscripción al dataStore
  React.useEffect(() => {
    const unsub = dataStore.subscribe(() => {
      setApplications(dataStore.getApplications());
    });
    return unsub;
  }, []);

  // Métricas
  const pendingApps = useMemo(() => applications.filter((a) => a.status === 'PENDING'), [applications]);
  const approvedApps = useMemo(() => applications.filter((a) => a.status === 'APPROVED'), [applications]);
  const rejectedApps = useMemo(() => applications.filter((a) => a.status === 'REJECTED'), [applications]);

  const totalPendingCapital = useMemo(
    () => pendingApps.reduce((acc, a) => acc + (a.requestedCapitalCop || 0), 0),
    [pendingApps]
  );

  // Lista filtrada
  const filteredApps = useMemo(() => {
    return applications.filter((app) => {
      if (statusFilter !== 'ALL' && app.status !== statusFilter) return false;
      if (categoryFilter !== 'ALL') {
        const cat = getCategoryForCapital(app.requestedCapitalCop);
        if (cat !== categoryFilter) return false;
      }
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase().trim();
        const matchName = app.fullName.toLowerCase().includes(term);
        const matchDoc = app.documentId?.toLowerCase().includes(term);
        const matchPhone = app.phone?.toLowerCase().includes(term);
        const matchEmail = app.email?.toLowerCase().includes(term);
        const matchCode = app.assignedUserCode?.toLowerCase().includes(term);
        const matchNotes = app.priorityNotes?.toLowerCase().includes(term);
        const matchTurn = String(app.queuePosition) === term || `#${app.queuePosition}` === term;
        if (!matchName && !matchDoc && !matchPhone && !matchEmail && !matchCode && !matchNotes && !matchTurn) {
          return false;
        }
      }
      return true;
    });
  }, [applications, statusFilter, categoryFilter, searchTerm]);

  // Manejar apertura de modal de aprobación
  const buildAdmissionActivationMessage = (params: {
    app: InvestorApplication;
    userCode: string;
    token: string;
    capital: number;
    category: BitacoraCategory;
    expiresAt: string;
  }): string => {
    const baseUrl = getAppBaseUrl().replace(/\/+$/, '');

    const directLink =
      `${baseUrl}/?mode=claim&code=${encodeURIComponent(params.userCode)}`;

    return `?? ?Hola *${params.app.fullName}*!

Tu ingreso como inversionista en *EasyTraders24* fue aprobado correctamente.

?? *C?digo de Inversionista:* \`${params.userCode}\`
??? *Token de Activaci?n Seguro:* \`${params.token}\`
?? *Capital Registrado:* $${params.capital.toLocaleString('es-CO')} COP
?? *Bit?cora Asignada:* ${params.category}
? *Vigencia:* 7 d?as (un solo uso)

?? *Enlace directo para activar tu cuenta:*
${directLink}

?? *Instrucciones:*
1. Abre el enlace.
2. Verifica tu c?digo.
3. Pega manualmente el token de activaci?n.
4. Confirma tu correo y define tu contrase?a.

?? El token es personal y de un solo uso.`;
  };

  // Manejar apertura del modal de aprobaci?n
  const handleOpenApprove = (app: InvestorApplication) => {
    setApprovingApp(app);

    const capital =
      app.requestedCapitalCop ||
      8_000_000;

    setApprovalCapitalStr(
      capital.toLocaleString('es-CO')
    );

    setApprovalCategory(
      getCategoryForCapital(capital)
    );

    setApprovalBank(
      app.originBank ||
      'Bancolombia'
    );

    setApprovalPaymentDetails(
      `Cuenta de ahorros ${app.originBank || 'Bancolombia'} (${app.phone})`
    );

    setApprovalError(null);
  };

  // Confirmar aprobaci?n mediante backend autoritativo
  const handleConfirmApprove = async () => {
    if (
      !approvingApp ||
      isApproving
    ) {
      return;
    }

    setApprovalError(null);

    const numCapital =
      parseInt(
        approvalCapitalStr.replace(/[^0-9]/g, ''),
        10
      ) || 0;

    if (numCapital < 4_000_000) {
      setApprovalError(
        'El capital m?nimo para aprobar una admisi?n es de $4.000.000 COP.'
      );
      return;
    }

    if (
      !approvingApp.email ||
      !approvingApp.email.includes('@')
    ) {
      setApprovalError(
        'La solicitud debe tener un correo electr?nico v?lido.'
      );
      return;
    }

    const targetCycleId =
      String(
        dataStore.getConfig()?.preparingCycleId ||
        ''
      ).trim();

    if (!targetCycleId) {
      setApprovalError(
        'No existe un ciclo PREPARING para recibir al nuevo inversionista.'
      );
      return;
    }

    setIsApproving(true);

    try {
      const res =
        await firestoreService.adminApproveInvestorApplication({
          applicationId:
            approvingApp.id,

          finalCapitalCop:
            numCapital,

          paymentMethod:
            approvalBank,

          paymentDetails:
            approvalPaymentDetails,

          targetCycleId,
        });

      if (
        !res?.success ||
        !res?.user ||
        !res?.application ||
        !res?.token ||
        !res?.user?.userCode
      ) {
        throw new Error(
          'El servidor no devolvi? un acceso de activaci?n completo.'
        );
      }

      const capital =
        Number(res.user.currentCapital) ||
        numCapital;

      const category =
        res.user.category ||
        getCategoryForCapital(capital);

      const welcomeMessage =
        buildAdmissionActivationMessage({
          app:
            res.application,

          userCode:
            res.user.userCode,

          token:
            res.token,

          capital,

          category,

          expiresAt:
            res.expiresAt,
        });

      setApprovingApp(null);

      setGeneratedWelcomeModal({
        app:
          res.application,

        message:
          welcomeMessage,

        userCode:
          res.user.userCode,
      });
    } catch (err: any) {
      setApprovalError(
        err?.message ||
        'Error al aprobar la solicitud y generar el token.'
      );
    } finally {
      setIsApproving(false);
    }
  };

  const handleGenerateApprovedAccess = async (
    app: InvestorApplication
  ) => {
    if (generatingAccessAppId) {
      return;
    }

    setGeneratingAccessAppId(app.id);

    try {
      let effectiveApp = app;

      let userCode =
        String(
          app.assignedUserCode || ''
        ).trim();

      let token = '';
      let expiresAt = '';

      let capital =
        Number(
          app.requestedCapitalCop
        ) || 0;

      let category =
        getCategoryForCapital(capital);

      const linkedUserId =
        String(
          app.assignedUserId || ''
        ).trim();

      let existingUser: UserProfile | null = null;

      if (linkedUserId) {
        try {
          existingUser =
            await firestoreService.getUser(
              linkedUserId
            );
        } catch {
          existingUser = null;
        }
      }

      if (existingUser) {
        if (
          existingUser.isClaimed === true ||
          existingUser.status === 'MIGRATED' ||
          existingUser.status === 'ACTIVE'
        ) {
          throw new Error(
            'Esta cuenta ya fue activada. El inversionista debe ingresar con su correo y contrase?a.'
          );
        }

        const tokenResult =
          await firestoreService
            .adminGenerateActivationToken(
              linkedUserId
            );

        if (
          !tokenResult?.success ||
          !tokenResult?.token
        ) {
          throw new Error(
            'No fue posible generar el token de activacion.'
          );
        }

        token = tokenResult.token;
        expiresAt = tokenResult.expiresAt;

        userCode =
          tokenResult.userCode ||
          existingUser.userCode ||
          userCode;

        capital =
          Number(existingUser.currentCapital) ||
          capital;

        category =
          existingUser.category ||
          getCategoryForCapital(capital);
      } else {
        const targetCycleId =
          String(
            dataStore.getConfig()
              ?.preparingCycleId ||
            ''
          ).trim();

        if (!targetCycleId) {
          throw new Error(
            'Esta admision requiere recuperacion, pero actualmente no existe un ciclo PREPARING.'
          );
        }

        if (capital < 4_000_000) {
          throw new Error(
            'Esta admision no puede recuperarse porque su capital es inferior a $4.000.000 COP.'
          );
        }

        const recovery =
          await firestoreService
            .adminApproveInvestorApplication({
              applicationId:
                app.id,

              finalCapitalCop:
                capital,

              paymentMethod:
                app.originBank ||
                'Bancolombia',

              paymentDetails:
                `Recuperacion de admision aprobada (${app.phone})`,

              targetCycleId,
            });

        if (
          !recovery?.success ||
          !recovery?.user ||
          !recovery?.application ||
          !recovery?.token ||
          !recovery?.user?.userCode
        ) {
          throw new Error(
            'La recuperacion no devolvio un acceso valido.'
          );
        }

        effectiveApp =
          recovery.application;

        userCode =
          recovery.user.userCode;

        token =
          recovery.token;

        expiresAt =
          recovery.expiresAt;

        capital =
          Number(
            recovery.user.currentCapital
          ) || capital;

        category =
          recovery.user.category ||
          getCategoryForCapital(capital);
      }

      if (!userCode || !token) {
        throw new Error(
          'No fue posible obtener el codigo y token de activacion.'
        );
      }

      const message =
        buildAdmissionActivationMessage({
          app:
            effectiveApp,

          userCode,
          token,
          capital,
          category,
          expiresAt,
        });

      setGeneratedWelcomeModal({
        app:
          effectiveApp,

        message,
        userCode,
      });
    } catch (err: any) {
      window.alert(
        err?.message ||
        'No fue posible generar el acceso de activacion.'
      );
    } finally {
      setGeneratingAccessAppId(null);
    }
  };

  const handleConfirmReject = () => {
    if (!rejectingApp) return;
    try {
      dataStore.rejectApplication(
        rejectingApp.id,
        rejectionReason,
        currentUser?.id || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      setRejectingApp(null);
      setRejectionReason('');
    } catch (err: any) {
      console.error(err.message || 'Error al rechazar');
    }
  };

  // Confirmar Eliminación definitiva en local y base de datos Firestore
  const handleConfirmDelete = async () => {
    if (!deletingApp) return;
    setIsDeleting(true);
    try {
      await dataStore.deleteApplication(
        deletingApp.id,
        currentUser?.id || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      setDeleteSuccessMsg(`La postulación de "${deletingApp.fullName}" fue eliminada de la base de datos.`);
      setTimeout(() => setDeleteSuccessMsg(null), 4500);
      setDeletingApp(null);
    } catch (err: any) {
      console.error('Error al eliminar postulación:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  // Mover turno
  const handleMoveTurn = (appId: string, currentTurn: number, direction: 'up' | 'down') => {
    const targetTurn = direction === 'up' ? Math.max(1, currentTurn - 1) : currentTurn + 1;
    dataStore.reorderApplicationQueue(appId, targetTurn);
  };

  // Copiar al portapapeles
  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  // Procesar archivo Excel
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(true);
    setImportError(null);
    try {
      const rows = await parseExcelApplicationsFile(file);
      setParsedPreviewRows(rows);
    } catch (err: any) {
      setImportError(err.message || 'Error al leer el archivo Excel.');
    } finally {
      setImportLoading(false);
    }
  };

  // Procesar texto pegado
  const handleParsePasted = () => {
    if (!pastedText.trim()) return;
    try {
      setImportError(null);
      const rows = parsePastedApplicationsText(pastedText);
      if (rows.length === 0) {
        setImportError('No se encontraron filas válidas en el texto pegado.');
        return;
      }
      setParsedPreviewRows(rows);
    } catch (err: any) {
      setImportError(err.message || 'Error al procesar el texto.');
    }
  };

  // Confirmar importación
  const handleConfirmImport = () => {
    if (parsedPreviewRows.length === 0) return;
    try {
      const res = dataStore.importApplicationsFromExcel(
        parsedPreviewRows,
        currentUser?.id || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal',
        replaceQueueOnImport
      );
      setImportSuccessCount(res.importedCount);
      setParsedPreviewRows([]);
      setPastedText('');
      setTimeout(() => {
        setImportSuccessCount(null);
        setShowImportModal(false);
      }, 2000);
    } catch (err: any) {
      setImportError(err.message || 'Error al guardar las solicitudes importadas.');
    }
  };

  // Crear solicitud manual
  const handleCreateManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualName.trim() || !manualPhone.trim()) {
      setManualError('El nombre completo y teléfono son obligatorios.');
      return;
    }
    const numCapital = parseInt(manualCapitalStr.replace(/[^0-9]/g, ''), 10) || 0;
    if (numCapital < 1_000_000) {
      setManualError('Ingresa un capital propuesto válido (mínimo $1.000.000 COP).');
      return;
    }
    try {
      setManualError(null);
      dataStore.createApplication({
        fullName: manualName,
        documentId: manualDoc,
        email: manualEmail,
        phone: manualPhone,
        city: manualCity,
        requestedCapitalCop: numCapital,
        originBank: manualBank,
        priorityNotes: manualNotes || 'Registrada manualmente por administración',
        source: 'DIRECT_ADMIN',
      });
      setShowManualModal(false);
      // Reset form
      setManualName('');
      setManualDoc('');
      setManualEmail('');
      setManualPhone('');
      setManualCity('Medellín');
      setManualCapitalStr('8.000.000');
      setManualBank('Bancolombia');
      setManualNotes('');
    } catch (err: any) {
      setManualError(err.message || 'Error al crear la solicitud.');
    }
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-200">
      {/* Alerta de confirmación de eliminación en base de datos */}
      {deleteSuccessMsg && (
        <div className="flex items-center justify-between p-3.5 rounded-xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-200 text-xs shadow-lg animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-medium">{deleteSuccessMsg}</span>
          </div>
          <button
            onClick={() => setDeleteSuccessMsg(null)}
            className="text-emerald-400 hover:text-emerald-200 p-1 rounded-lg hover:bg-emerald-900/50 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* 1. Header & Quick Stats */}
      <div className="bg-gradient-to-br from-slate-900 via-[#0d1527] to-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2.5 mb-1.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-sm">
                <Users className="w-5 h-5" />
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight">
                Cola de Admisión & Solicitudes de Nuevo Ingreso
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl leading-relaxed">
              Gestión secuencial por <span className="text-amber-300 font-semibold">Orden de Llegada</span>. 
              El inversionista con el Turno #1 tiene la máxima prioridad para incorporarse al siguiente ciclo operativo de capital.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 w-full lg:w-auto">
            <button
              onClick={() => {
                const url = `${window.location.origin}/?mode=apply`;
                navigator.clipboard.writeText(url);
                setCopiedApplyLink(true);
                setTimeout(() => setCopiedApplyLink(false), 3000);
              }}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition cursor-pointer ${
                copiedApplyLink
                  ? 'bg-blue-950 border-blue-500 text-blue-300'
                  : 'bg-slate-900 hover:bg-slate-800 border-slate-700 hover:border-blue-500/50 text-slate-200'
              }`}
              title="Copiar link público para compartir el Formulario de Admisión"
            >
              {copiedApplyLink ? (
                <>
                  <Check className="w-4 h-4 text-blue-400" />
                  <span>¡Link Copiado!</span>
                </>
              ) : (
                <>
                  <Link className="w-4 h-4 text-blue-400" />
                  <span>Link Admisión</span>
                </>
              )}
            </button>

            <button
              onClick={() => setShowImportModal(true)}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-blue-700 to-indigo-700 hover:from-blue-600 hover:to-indigo-600 text-white text-xs font-semibold shadow-md shadow-blue-900/30 transition cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>Importar Excel Antiguo</span>
            </button>

            <button
              onClick={() => setShowManualModal(true)}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-md shadow-amber-500/20 transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Radicar Solicitud</span>
            </button>

            <button
              onClick={() => setShowRenumberModal(true)}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition cursor-pointer"
              title="Renumerar turnos pendientes en orden secuencial limpio (1, 2, 3...)"
            >
              <RotateCcw className="w-4 h-4 text-blue-400" />
              <span className="hidden sm:inline">Renumerar Turnos</span>
            </button>

            <button
              onClick={() => exportApplicationsToExcelFile(applications)}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition cursor-pointer"
              title="Descargar reporte completo en Excel"
            >
              <Download className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline">Exportar</span>
            </button>
          </div>
        </div>

        {/* 4 Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mt-5 pt-5 border-t border-slate-800/80">
          <div className="bg-slate-950/60 border border-slate-800/90 rounded-xl p-3 sm:p-4">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>En Lista de Espera</span>
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <p className="text-xl sm:text-2xl font-bold font-mono text-amber-400">
              {pendingApps.length}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">Pendientes por aprobar</p>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/90 rounded-xl p-3 sm:p-4">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Próximo Turno</span>
              <Sparkles className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-xl sm:text-2xl font-bold font-mono text-emerald-400">
              {pendingApps.length > 0 ? `#${pendingApps[0].queuePosition}` : 'Al día'}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5 truncate">
              {pendingApps.length > 0 ? pendingApps[0].fullName : 'Cola completada'}
            </p>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/90 rounded-xl p-3 sm:p-4">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Capital en Espera</span>
              <DollarSign className="w-4 h-4 text-blue-400" />
            </div>
            <p className="text-lg sm:text-2xl font-bold font-mono text-blue-400 truncate">
              ${(totalPendingCapital / 1_000_000).toFixed(1)}M <span className="text-xs text-slate-500">COP</span>
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">Suma de aportes pretendidos</p>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/90 rounded-xl p-3 sm:p-4">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Aprobadas & Activas</span>
              <CheckCircle2 className="w-4 h-4 text-purple-400" />
            </div>
            <p className="text-xl sm:text-2xl font-bold font-mono text-purple-400">
              {approvedApps.length}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">Inversionistas incorporados</p>
          </div>
        </div>
      </div>

      {/* 2. Banner de Regla de Negocio FIFO */}
      <div className="bg-amber-950/20 border border-amber-500/30 rounded-2xl p-3.5 sm:p-4 flex items-start gap-3 text-xs text-amber-200/90">
        <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-amber-300">
            Regla de Prioridad Institucional: Orden de Llegada Estricto
          </p>
          <p className="text-amber-200/70 text-[11px] leading-relaxed">
            Las postulaciones radicadas vía web o importadas desde tu Excel histórico ocupan un puesto secuencial inmutable. 
            Al aprobar una solicitud, el sistema genera automáticamente el código único de inversionista (ej. <code className="bg-amber-950/60 px-1 py-0.5 rounded text-amber-300">INV-046</code>), 
            establece su cuenta activa y redacta el mensaje de bienvenida con enlace y credenciales para enviar por WhatsApp en 1 solo clic.
          </p>
        </div>
      </div>

      {/* 3. Toolbar de Filtros y Búsqueda */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Buscador */}
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por turno #, nombre, documento, celular..."
            className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filtros de Estado y Categoría */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg transition ${
                statusFilter === 'ALL' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Todas ({applications.length})
            </button>
            <button
              onClick={() => setStatusFilter('PENDING')}
              className={`px-2.5 py-1 rounded-lg transition flex items-center gap-1 ${
                statusFilter === 'PENDING'
                  ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Clock className="w-3 h-3 text-amber-400" />
              Cola ({pendingApps.length})
            </button>
            <button
              onClick={() => setStatusFilter('APPROVED')}
              className={`px-2.5 py-1 rounded-lg transition flex items-center gap-1 ${
                statusFilter === 'APPROVED'
                  ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              Aprobadas ({approvedApps.length})
            </button>
            <button
              onClick={() => setStatusFilter('REJECTED')}
              className={`px-2.5 py-1 rounded-lg transition flex items-center gap-1 ${
                statusFilter === 'REJECTED'
                  ? 'bg-red-500/20 text-red-300 font-bold border border-red-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <XCircle className="w-3 h-3 text-red-400" />
              Rechazadas ({rejectedApps.length})
            </button>
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as any)}
            className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 focus:outline-none focus:border-amber-500/50 cursor-pointer"
          >
            <option value="ALL">Todas las Categorías</option>
            <option value="AZUL">🔵 Bitácora Azul ($2M - $9.999.999)</option>
            <option value="VERDE">🟢 Bitácora Verde ($10M - $59.999.999)</option>
            <option value="NEGRA">⚫ Bitácora Negra ($60M+)</option>
          </select>
        </div>
      </div>

      {/* 4. Tabla Principal de Cola de Solicitudes */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-medium tracking-wider uppercase text-[10px]">
                <th className="py-3.5 px-4">Turno</th>
                <th className="py-3.5 px-4">Inversionista Aspirante</th>
                <th className="py-3.5 px-4">Contacto & WhatsApp</th>
                <th className="py-3.5 px-4">Capital Propuesto</th>
                <th className="py-3.5 px-4">Llegada & Origen</th>
                <th className="py-3.5 px-4">Estado</th>
                <th className="py-3.5 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {filteredApps.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-40 text-slate-400" />
                    <p className="font-semibold text-slate-300">No hay solicitudes que coincidan con los filtros</p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Puedes importar tu Excel histórico o registrar una postulación manual arriba.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredApps.map((app, index) => {
                  const isFirstPending = app.status === 'PENDING' && pendingApps[0]?.id === app.id;
                  const estimatedCategory = getCategoryForCapital(app.requestedCapitalCop);
                  const cleanPhone = app.phone.replace(/[^0-9]/g, '');
                  const waLink = `https://wa.me/57${cleanPhone.startsWith('57') ? cleanPhone.slice(2) : cleanPhone}`;

                  return (
                    <tr
                      key={app.id}
                      className={`hover:bg-slate-800/40 transition ${
                        isFirstPending ? 'bg-amber-500/[0.04] border-l-4 border-l-amber-400' : ''
                      }`}
                    >
                      {/* Turno */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2.5 py-1 rounded-lg font-mono font-bold text-xs ${
                              isFirstPending
                                ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 shadow-md shadow-amber-500/20'
                                : app.status === 'PENDING'
                                ? 'bg-amber-950/60 text-amber-300 border border-amber-500/30'
                                : app.status === 'APPROVED'
                                ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-500/20'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            Turno #{app.queuePosition}
                          </span>
                          {isFirstPending && (
                            <span className="hidden xl:inline-flex items-center gap-1 text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse">
                              Siguiente
                            </span>
                          )}
                          {app.status === 'PENDING' && (
                            <div className="flex flex-col gap-0.5">
                              <button
                                onClick={() => handleMoveTurn(app.id, app.queuePosition, 'up')}
                                title="Subir en orden de prioridad"
                                className="p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white"
                              >
                                <ChevronUp className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleMoveTurn(app.id, app.queuePosition, 'down')}
                                title="Bajar en orden de prioridad"
                                className="p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white"
                              >
                                <ChevronDown className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Inversionista */}
                      <td className="py-3 px-4">
                        <div>
                          <p className="font-semibold text-slate-200">{app.fullName}</p>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                            {app.documentId && <span>CC: {app.documentId}</span>}
                            {app.city && (
                              <>
                                <span>•</span>
                                <span>{app.city}</span>
                              </>
                            )}
                          </div>
                          {app.priorityNotes && (
                            <p className="text-[10px] text-slate-400 italic mt-1 line-clamp-1 max-w-xs">
                              💬 {app.priorityNotes}
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Contacto */}
                      <td className="py-3 px-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Phone className="w-3 h-3 text-slate-500" />
                            <span className="font-mono text-slate-300">{app.phone}</span>
                            <a
                              href={waLink}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1 rounded bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-500/30 text-emerald-400 transition"
                              title="Abrir chat en WhatsApp"
                            >
                              <MessageCircle className="w-3 h-3" />
                            </a>
                          </div>
                          {app.email && (
                            <div className="flex items-center gap-2 text-[11px] text-slate-400">
                              <Mail className="w-3 h-3 text-slate-500" />
                              <span className="truncate max-w-[150px]">{app.email}</span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Capital */}
                      <td className="py-3 px-4">
                        <div>
                          <p className="font-mono font-bold text-slate-100 text-sm">
                            ${app.requestedCapitalCop.toLocaleString('es-CO')} <span className="text-[10px] text-slate-400">COP</span>
                          </p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                estimatedCategory === 'AZUL'
                                  ? 'bg-blue-950 text-blue-300 border border-blue-500/30'
                                  : estimatedCategory === 'VERDE'
                                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-slate-800 text-slate-300 border border-slate-600'
                              }`}
                            >
                              Bitácora {estimatedCategory}
                            </span>
                            {app.originBank && (
                              <span className="text-[10px] text-slate-400">({app.originBank})</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Llegada & Origen */}
                      <td className="py-3 px-4">
                        <div>
                          <div className="flex items-center gap-1.5 text-slate-300 font-mono text-[11px]">
                            <Calendar className="w-3 h-3 text-slate-500" />
                            <span>
                              {new Date(app.submissionDate).toLocaleDateString('es-CO', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </span>
                          </div>
                          <span
                            className={`inline-block mt-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                              app.source === 'EXCEL_HISTORICO'
                                ? 'bg-indigo-950/70 text-indigo-300 border border-indigo-500/30'
                                : app.source === 'WEB_FORM'
                                ? 'bg-cyan-950/70 text-cyan-300 border border-cyan-500/30'
                                : 'bg-slate-800 text-slate-400 border border-slate-700'
                            }`}
                          >
                            {app.source === 'EXCEL_HISTORICO'
                              ? `Excel Antiguo (Fila ${app.excelRowIndex || '-'})`
                              : app.source === 'WEB_FORM'
                              ? 'Formulario Web'
                              : 'Registro Admin'}
                          </span>
                        </div>
                      </td>

                      {/* Estado */}
                      <td className="py-3 px-4">
                        {app.status === 'PENDING' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] font-semibold">
                            <Clock className="w-3 h-3" />
                            Pendiente
                          </span>
                        ) : app.status === 'APPROVED' ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold">
                              <CheckCircle2 className="w-3 h-3" />
                              Aprobada
                            </span>
                            {app.assignedUserCode && (
                              <p className="font-mono text-[11px] font-bold text-amber-400">
                                Código: {app.assignedUserCode}
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/30 text-red-300 text-[11px] font-semibold">
                              <XCircle className="w-3 h-3" />
                              Rechazada
                            </span>
                            {app.rejectionReason && (
                              <p className="text-[10px] text-slate-400 italic line-clamp-1 max-w-[140px]">
                                {app.rejectionReason}
                              </p>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Acciones */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {app.status === 'PENDING' && (
                            <>
                              <button
                                onClick={() => handleOpenApprove(app)}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow transition cursor-pointer"
                                title="Aprobar e incorporar inversionista"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>Aprobar</span>
                              </button>

                              <button
                                onClick={() => setRejectingApp(app)}
                                className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-950/60 text-slate-400 hover:text-red-400 border border-slate-700 transition cursor-pointer"
                                title="Rechazar solicitud"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}

                          {app.status === 'APPROVED' && (
                            <div className="flex items-center gap-1">
                              {app.assignedUserId && onNavigateToUser && (
                                <button
                                  onClick={() => onNavigateToUser(app.assignedUserId!)}
                                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] font-medium transition cursor-pointer"
                                >
                                  Ver Perfil
                                </button>
                              )}
                              <button
                                onClick={() => handleGenerateApprovedAccess(app)}
                                disabled={generatingAccessAppId === app.id}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Generar token seguro y mensaje de activacion"
                              >
                                {generatingAccessAppId === app.id ? (
                                  <>
                                    <div className="w-3 h-3 border-2 border-emerald-300/30 border-t-emerald-300 rounded-full animate-spin" />
                                    <span>Generando...</span>
                                  </>
                                ) : (
                                  <>
                                    <ShieldCheck className="w-3 h-3" />
                                    <span>Generar Acceso</span>
                                  </>
                                )}
                              </button>
                            </div>
                          )}

                          {app.status === 'REJECTED' && (
                            <span className="text-[11px] text-slate-500 italic mr-1">Rechazada</span>
                          )}

                          {/* Botón de eliminación definitiva en base de datos para cualquier postulación */}
                          <button
                            onClick={() => setDeletingApp(app)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-950/80 text-slate-400 hover:text-red-400 border border-slate-700 hover:border-red-500/40 transition cursor-pointer"
                            title="Eliminar postulación de la base de datos"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: APROBACIÓN DE SOLICITUD & ASIGNACIÓN DE CÓDIGO */}
      {/* ========================================================================= */}
      {approvingApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700/90 rounded-2xl p-5 sm:p-6 w-full max-w-lg shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <UserCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-100">Aprobar Solicitud de Ingreso</h3>
                  <p className="text-xs text-slate-400">Turno #{approvingApp.queuePosition} • {approvingApp.fullName}</p>
                </div>
              </div>
              <button
                onClick={() => setApprovingApp(null)}
                className="text-slate-400 hover:text-slate-200 text-sm p-1 rounded-lg hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            {approvalError && (
              <div className="p-3 bg-red-950/40 border border-red-500/40 rounded-xl text-red-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{approvalError}</span>
              </div>
            )}

            <div className="space-y-3.5 text-xs">
              {/* Resumen Inversionista */}
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-400">Inversionista:</span>
                  <span className="font-semibold text-slate-200">{approvingApp.fullName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Documento / Cédula:</span>
                  <span className="font-mono text-slate-200">{approvingApp.documentId || 'Sin registrar'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">WhatsApp / Teléfono:</span>
                  <span className="font-mono text-slate-200">{approvingApp.phone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Correo Electrónico:</span>
                  <span className="text-slate-200">{approvingApp.email || 'Sin registrar'}</span>
                </div>
              </div>

              {/* Código a Asignar */}
              <div className="p-3 rounded-xl bg-blue-950/30 border border-blue-500/30">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-blue-200">
                      Codigo y token automaticos
                    </p>
                    <p className="text-[11px] text-blue-200/70 mt-1 leading-relaxed">
                      Al aprobar, el servidor asignara el codigo INV-XXXX y generara un token seguro de activacion de un solo uso.
                    </p>
                  </div>
                </div>
              </div>

              {/* Capital y Categoría */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Capital Acreditado (COP) <span className="text-amber-400">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-amber-400 font-bold text-xs">
                      $
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={approvalCapitalStr}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        if (!raw) {
                          setApprovalCapitalStr('');
                          return;
                        }
                        const val = parseInt(raw, 10);
                        setApprovalCapitalStr(val.toLocaleString('es-CO'));
                        setApprovalCategory(getCategoryForCapital(val));
                      }}
                      placeholder="Ej: 8.000.000"
                      className="w-full pl-6 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl font-mono text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Categoría Asignada</label>
                  <select
                    value={approvalCategory}
                    disabled
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 opacity-80 cursor-not-allowed"
                  >
                    <option value="AZUL">🔵 Azul ($2M - $9.999.999)</option>
                    <option value="VERDE">🟢 Verde ($10M - $59.999.999)</option>
                    <option value="NEGRA">⚫ Bitácora Negra ($60M+)</option>
                  </select>
                </div>
              </div>

              {/* Banco y Detalles */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Banco de Origen</label>
                  <select
                    value={approvalBank}
                    onChange={(e) => setApprovalBank(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="Bancolombia">Bancolombia</option>
                    <option value="Davivienda">Davivienda</option>
                    <option value="Nequi">Nequi</option>
                    <option value="Daviplata">Daviplata</option>
                    <option value="BBVA">BBVA</option>
                    <option value="Efectivo">Efectivo Institucional</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Referencia / Cuenta</label>
                  <input
                    type="text"
                    value={approvalPaymentDetails}
                    onChange={(e) => setApprovalPaymentDetails(e.target.value)}
                    placeholder="Cuenta de ahorros..."
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setApprovingApp(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmApprove}
                disabled={isApproving}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-950/40 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isApproving ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Aprobando y generando token...</span>
                  </>
                ) : (
                  <span>Aprobar y Generar Acceso WhatsApp</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: MENSAJE DE BIENVENIDA GENERADO PARA WHATSAPP */}
      {/* ========================================================================= */}
      {generatedWelcomeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-2xl p-5 sm:p-6 w-full max-w-lg shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-100">¡Inversionista Aprobado con Éxito!</h3>
                  <p className="text-xs text-slate-400">
                    Código asignado: <span className="text-amber-300 font-mono font-bold">{generatedWelcomeModal.userCode}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setGeneratedWelcomeModal(null)}
                className="text-slate-400 hover:text-slate-200 text-sm p-1 rounded-lg hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Copia el siguiente mensaje oficial para enviárselo directamente al inversionista por WhatsApp o correo:
            </p>

            <div className="relative bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs text-slate-300 font-mono whitespace-pre-wrap max-h-56 overflow-y-auto custom-scrollbar">
              {generatedWelcomeModal.message}
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2">
              <a
                href={`https://wa.me/57${generatedWelcomeModal.app.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
                  generatedWelcomeModal.message
                )}`}
                target="_blank"
                rel="noreferrer"
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-md shadow-emerald-900/30 cursor-pointer"
              >
                <MessageCircle className="w-4 h-4" />
                <span>Enviar por WhatsApp Web</span>
              </a>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={() => handleCopyText(generatedWelcomeModal.message, 'welcome_modal_copy')}
                  className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold cursor-pointer"
                >
                  {copiedId === 'welcome_modal_copy' ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span>¡Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copiar Texto</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => setGeneratedWelcomeModal(null)}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold cursor-pointer"
                >
                  Listo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: IMPORTADOR DE EXCEL HISTÓRICO (ORDEN DE LLEGADA) */}
      {/* ========================================================================= */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700/90 rounded-2xl p-5 sm:p-6 w-full max-w-2xl shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center">
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-100">Importar Excel Histórico de Solicitudes</h3>
                  <p className="text-xs text-slate-400">Preserva estrictamente el orden de filas como orden de llegada</p>
                </div>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm p-1 rounded-lg hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            {/* Selector de Pestaña */}
            <div className="flex items-center justify-between bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setImportTab('file')}
                  className={`px-3 py-1.5 rounded-lg transition ${
                    importTab === 'file' ? 'bg-blue-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Subir Archivo (.xlsx / .csv)
                </button>
                <button
                  onClick={() => setImportTab('paste')}
                  className={`px-3 py-1.5 rounded-lg transition ${
                    importTab === 'paste' ? 'bg-blue-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Pegar Filas de Excel (Ctrl+V)
                </button>
              </div>

              <button
                onClick={downloadApplicationsExcelTemplate}
                className="flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 font-semibold px-2 py-1"
                title="Descargar plantilla de Excel con el formato de columnas"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Descargar Plantilla</span>
              </button>
            </div>

            {importError && (
              <div className="p-3 bg-red-950/40 border border-red-500/40 rounded-xl text-red-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{importError}</span>
              </div>
            )}

            {importSuccessCount !== null && (
              <div className="p-3 bg-emerald-950/40 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>¡Se importaron con éxito {importSuccessCount} solicitudes en orden de llegada!</span>
              </div>
            )}

            {/* Pestaña Archivo */}
            {importTab === 'file' && (
              <div className="space-y-3">
                <label className="border-2 border-dashed border-slate-700 hover:border-blue-500/70 rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition bg-slate-950/40">
                  <Upload className="w-8 h-8 text-blue-400 mb-2" />
                  <p className="text-xs font-semibold text-slate-200">
                    Haz clic para seleccionar o arrastra tu archivo Excel antiguo
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1">Soporta formatos .xlsx, .xls y .csv</p>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            )}

            {/* Pestaña Pegar */}
            {importTab === 'paste' && (
              <div className="space-y-2">
                <label className="block text-xs text-slate-300">
                  Copia las celdas en tu Excel y pégalas aquí (Nombre, Cédula, Teléfono, Capital...):
                </label>
                <textarea
                  rows={5}
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder="Mariana Gómez&#9;1037648291&#9;3124567890&#9;15000000&#9;mariana@gmail.com&#10;Andrés Cardona&#9;71829401&#9;3109876543&#9;8000000&#9;andres@hotmail.com"
                  className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={handleParsePasted}
                  className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
                >
                  Procesar Filas Pegadas
                </button>
              </div>
            )}

            {/* Previsualización de Filas Parseadas */}
            {parsedPreviewRows.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-200">
                    Vista Previa de Admisión ({parsedPreviewRows.length} solicitudes detectadas en orden):
                  </span>
                  <span className="text-[11px] text-amber-300 font-mono">
                    Turnos #{pendingApps.length + 1} a #{pendingApps.length + parsedPreviewRows.length}
                  </span>
                </div>

                <div className="max-h-48 overflow-y-auto border border-slate-800 rounded-xl bg-slate-950 divide-y divide-slate-800 text-[11px]">
                  {parsedPreviewRows.map((r, i) => (
                    <div key={i} className="p-2.5 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold text-[10px]">
                          #{i + 1}
                        </span>
                        <div>
                          <p className="font-semibold text-slate-200">{r.fullName}</p>
                          <p className="text-[10px] text-slate-500">{r.phone} • {r.documentId || 'Sin CC'}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-mono font-bold text-slate-200">
                          ${r.requestedCapitalCop.toLocaleString('es-CO')}
                        </p>
                        <p className="text-[9px] text-slate-500">{r.notes}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Opción de Reemplazo para lista vieja */}
            {parsedPreviewRows.length > 0 && (
              <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="replaceQueueCheck"
                  checked={replaceQueueOnImport}
                  onChange={(e) => setReplaceQueueOnImport(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-500 cursor-pointer"
                />
                <label htmlFor="replaceQueueCheck" className="text-xs text-slate-300 cursor-pointer">
                  <span className="font-semibold text-amber-300 block">
                    Reemplazar cola previa con esta lista de Excel (Recomendado para importar lista vieja)
                  </span>
                  <span className="text-slate-400 text-[11px] block mt-0.5">
                    Garantiza que los turnos (#1, #2, #3...) coincidan exactamente y en orden con el archivo importado, limpiando registros de prueba previos.
                  </span>
                </label>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setShowImportModal(false);
                  setParsedPreviewRows([]);
                }}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Cerrar
              </button>

              <button
                type="button"
                disabled={parsedPreviewRows.length === 0}
                onClick={handleConfirmImport}
                className={`px-5 py-2 rounded-xl text-xs font-bold transition shadow-lg ${
                  parsedPreviewRows.length > 0
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white cursor-pointer shadow-blue-900/40'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
              >
                {replaceQueueOnImport ? 'Reemplazar y Cargar ' : 'Confirmar e Incorporar '}
                {parsedPreviewRows.length} a la Cola
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: RADICAR SOLICITUD MANUAL */}
      {/* ========================================================================= */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <form
            onSubmit={handleCreateManual}
            className="bg-slate-900 border border-slate-700/90 rounded-2xl p-5 sm:p-6 w-full max-w-md shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-100">Radicar Nueva Solicitud</h3>
                  <p className="text-xs text-slate-400">
                    Se le asignará automáticamente el siguiente turno disponible ({applications.length + 1})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm p-1 rounded-lg hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            {manualError && (
              <div className="p-3 bg-red-950/40 border border-red-500/40 rounded-xl text-red-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{manualError}</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Nombre Completo *</label>
                <input
                  type="text"
                  required
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="ej. Carlos Eduardo Restrepo"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Cédula / Documento</label>
                  <input
                    type="text"
                    value={manualDoc}
                    onChange={(e) => setManualDoc(e.target.value)}
                    placeholder="1020304050"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Teléfono / WhatsApp *</label>
                  <input
                    type="tel"
                    required
                    value={manualPhone}
                    onChange={(e) => setManualPhone(e.target.value)}
                    placeholder="3101234567"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Correo Electrónico</label>
                  <input
                    type="email"
                    value={manualEmail}
                    onChange={(e) => setManualEmail(e.target.value)}
                    placeholder="inversionista@email.com"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Ciudad</label>
                  <input
                    type="text"
                    value={manualCity}
                    onChange={(e) => setManualCity(e.target.value)}
                    placeholder="Medellín"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500"
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
                      value={manualCapitalStr}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        if (!raw) {
                          setManualCapitalStr('');
                          return;
                        }
                        const num = parseInt(raw, 10);
                        setManualCapitalStr(num.toLocaleString('es-CO'));
                      }}
                      placeholder="Ej: 8.000.000"
                      className="w-full pl-6 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl font-mono text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Banco de Origen</label>
                  <select
                    value={manualBank}
                    onChange={(e) => setManualBank(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-amber-500"
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
                <label className="block text-slate-300 font-semibold mb-1">Observaciones / Referido</label>
                <input
                  type="text"
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                  placeholder="Referido por..., aspira a entrar en septiembre..."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-lg shadow-amber-500/20 cursor-pointer"
              >
                Registrar en Cola
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: CONFIRMACIÓN DE RECHAZO */}
      {/* ========================================================================= */}
      {rejectingApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-red-500/40 rounded-2xl p-5 sm:p-6 w-full max-w-md shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-red-400">
                <XCircle className="w-5 h-5" />
                <h3 className="text-base font-bold text-slate-100">Rechazar Solicitud</h3>
              </div>
              <button
                onClick={() => setRejectingApp(null)}
                className="text-slate-400 hover:text-slate-200 text-sm p-1 rounded-lg hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300">
              ¿Estás seguro de rechazar la solicitud de{' '}
              <span className="font-bold text-white">{rejectingApp.fullName}</span> (Turno #{rejectingApp.queuePosition})?
            </p>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Motivo del rechazo (opcional):</label>
              <input
                type="text"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Falta de cupo en bitácora, datos bancarios incompletos..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-red-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRejectingApp(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold shadow-md shadow-red-900/30 cursor-pointer"
              >
                Confirmar Rechazo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmación de Eliminación Definitiva */}
      {deletingApp && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-red-500/50 rounded-2xl p-5 sm:p-6 w-full max-w-md shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5 text-red-400">
                <div className="p-2 rounded-xl bg-red-500/10 border border-red-500/30">
                  <Trash2 className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-100">Eliminar Solicitud</h3>
                  <p className="text-[11px] text-slate-400">Esta acción es permanente en la base de datos</p>
                </div>
              </div>
              <button
                onClick={() => !isDeleting && setDeletingApp(null)}
                className="text-slate-400 hover:text-slate-200 text-sm p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between items-center text-slate-300">
                <span className="text-slate-400">Aspirante:</span>
                <span className="font-bold text-slate-100">{deletingApp.fullName}</span>
              </div>
              {deletingApp.documentId && (
                <div className="flex justify-between items-center text-slate-300">
                  <span className="text-slate-400">Cédula:</span>
                  <span className="font-mono text-slate-200">{deletingApp.documentId}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-slate-300">
                <span className="text-slate-400">Turno / Estado:</span>
                <span className="font-mono font-bold text-amber-300">
                  Turno #{deletingApp.queuePosition} ({deletingApp.status})
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-300">
                <span className="text-slate-400">Capital propuesto:</span>
                <span className="font-mono font-bold text-emerald-400">
                  ${deletingApp.requestedCapitalCop.toLocaleString('es-CO')} COP
                </span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-red-950/30 border border-red-500/30 flex items-start gap-2.5 text-xs text-red-300">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>
                La solicitud se eliminará tanto de la lista local como de la base de datos en la nube (Firestore), recalculando el turno de las demás solicitudes.
              </span>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeletingApp(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 active:scale-95 text-white text-xs font-bold shadow-lg shadow-red-900/40 cursor-pointer transition disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Eliminando en base de datos...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Eliminar Definitivamente</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmación para Renumerar Turnos */}
      {showRenumberModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 w-full max-w-md shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-blue-400">
                <RotateCcw className="w-5 h-5" />
                <h3 className="text-base font-bold text-slate-100">Renumerar Turnos</h3>
              </div>
              <button
                onClick={() => setShowRenumberModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              ¿Deseas renumerar consecutivamente todas las solicitudes en estado <span className="font-bold text-amber-300">Pendiente</span> (1, 2, 3...) y sincronizar los turnos en la base de datos Firestore?
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowRenumberModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  dataStore.renumberPendingQueue();
                  setShowRenumberModal(false);
                }}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md shadow-blue-900/30 cursor-pointer"
              >
                Renumerar Turnos
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
