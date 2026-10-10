import {
  UserProfile,
  MonthlyCycle,
  GlobalConfig,
  CycleGroupCalculation,
  CycleUserResult,
  NotificationItem,
  ReinvestmentRequest,
  DisbursementRequest,
  DisbursementMethod,
  DisbursementStatus,
  InvestmentRequest,
  InvestorApplication,
  AuditLog,
  BitacoraCategory,
  CategoryGroupInfo,
  DailyGroupOperation,
  ImportedBitacoraRow,
  OperationTargetType,
  CycleFinancialSummary,
} from '../types';
import {
  notifyCycleClosureToUser,
  notifyNewApplicationToAdmin,
  notifyApplicationStatusToUser,
  notifyNewReinvestmentToAdmin,
  notifyDailyTradeToUser,
  resolveTradeNotificationName,
  playNotificationAudio,
  sendBrowserPushNotification,
} from './pushNotifications';
import {
  calculateUserMonthlyResult,
  getCategoryForCapital,
  generateUserCode,
} from './financialEngine';
import { normalizeName } from './excelMigrationService';
import { firestoreService } from './firestoreService';
import { historicalMigrationService, ReconciliationReport } from './historicalMigrationService';
import { fetchLiveTRM } from './trmService';
import { auth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { getAppBaseUrl } from './constants';

function isActiveFinancialParticipant(
  user: UserProfile
): boolean {
  return (
    user.status === 'ACTIVE' &&
    (
      user.role === 'USER' ||
      user.participatesInTrading === true
    )
  );
}

function getEffectiveFinancialSplit(
  user: UserProfile
): {
  userPercentage: number;
  adminPercentage: number;
} {
  if (user.commissionMode === 'SELF_ADMIN') {
    return {
      userPercentage: 100,
      adminPercentage: 0,
    };
  }

  return {
    userPercentage:
      user.userPercentage !== undefined
        ? user.userPercentage
        : 75,

    adminPercentage:
      user.adminPercentage !== undefined
        ? user.adminPercentage
        : 25,
  };
}


export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  trmReference: 0,
  trmConfigured: 0,
  trmMode: 'AUTOMATIC',
  trmAutoSync: true,
  trmMarketRate: 0,
  trmSource: 'TRM no disponible',
  trmLastSyncedAt: '',
  activeCycleId: '',
  operationalCycleId: null,
  preparingCycleId: null,
  roundingRule: 'none',
  categories: [
    {
      id: 'AZUL',
      name: '🔵 Azul',
      minCapital: 2_000_000,
      maxCapital: 9_999_999,
      color: '#2563eb',
      badgeBg: 'bg-blue-900/40 border-blue-500/30 text-blue-300',
      badgeText: 'Azul ($2M - $9.999.999 COP)',
    },
    {
      id: 'VERDE',
      name: '🟢 Verde',
      minCapital: 10_000_000,
      maxCapital: 59_999_999,
      color: '#059669',
      badgeBg: 'bg-emerald-900/40 border-emerald-500/30 text-emerald-300',
      badgeText: 'Verde ($10M - $59.999.999 COP)',
    },
    {
      id: 'NEGRA',
      name: '⚫ Bitácora Negra',
      minCapital: 60_000_000,
      maxCapital: Number.MAX_SAFE_INTEGER,
      color: '#09090b',
      badgeBg: 'bg-zinc-950 border-zinc-700 text-zinc-200',
      badgeText: 'Bitácora Negra ($60M+ COP)',
    },
  ],
  updatedAt: new Date().toISOString(),
  updatedBy: 'admin-system',
};

// Limpieza total de almacenamiento local heredado para asegurar que Firestore sea la única fuente de verdad
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    Object.keys(localStorage).forEach((key) => {
      if (
        key.startsWith('gestor_capital_') &&
        !key.includes('current_user') &&
        !key.includes('session')
      ) {
        localStorage.removeItem(key);
      }
    });
  }
} catch {
  // Manejo seguro para entornos sin storage
}

type Listener = () => void;

class DataStore {
  private users: UserProfile[] = [];
  private cycles: MonthlyCycle[] = [];
  private config: GlobalConfig = DEFAULT_GLOBAL_CONFIG;
  private groupCalculations: CycleGroupCalculation[] = [];
  private userResults: CycleUserResult[] = [];
  private notifications: NotificationItem[] = [];
  private reinvestments: ReinvestmentRequest[] = [];
  private disbursements: DisbursementRequest[] = [];
  private investments: InvestmentRequest[] = [];
  private applications: InvestorApplication[] = [];
  private auditLogs: AuditLog[] = [];
  private dailyOperations: DailyGroupOperation[] = [];
  private financialSummaries: CycleFinancialSummary[] = [];

  private knownApplicationIds: Set<string> = new Set();
  private knownReinvestmentIds: Set<string> = new Set();
  private knownNotificationIds: Set<string> = new Set();
  private readSharedIds: Set<string> = new Set();
  private isInitialAppsSynced: boolean = false;
  private isInitialReinvSynced: boolean = false;
  private isInitialNotifsSynced: boolean = false;

  private listeners: Set<Listener> = new Set();

  // Lifecycle & Listener Unsubscribers (FASE 1A)
  private activeUnsubscribers: (() => void)[] = [];
  private currentActiveUid: string | null = null;
  private currentActiveRole: 'ADMIN' | 'INVESTOR' | null = null;
  private authListenerUnsubscribe: (() => void) | null = null;

  constructor() {
    this.loadState();
    try {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('gestor_read_shared_notifications');
        if (saved) {
          this.readSharedIds = new Set(JSON.parse(saved));
        }
      }
    } catch (e) {
      console.error(e);
    }
    // FASE 1A: this.syncWithFirestore() y this.initRealtimeFirestoreSync() han sido removidos
    // del constructor para evitar listeners globales y sincronización bulk insegura durante el bootstrap.
    // Los listeners se activan exclusivamente tras resolver una identidad canónica en Firebase Auth.
    this.initAuthLifecycle();
  }

  /**
   * Inicializa el observador del ciclo de vida de autenticación canónica de Firebase Auth.
   * Regla 12: NUNCA inicia listeners privados si auth.currentUser == null o currentUser.uid está vacío.
   */
  private initAuthLifecycle() {
    if (typeof window === 'undefined') return;

    if (this.authListenerUnsubscribe) {
      this.authListenerUnsubscribe();
      this.authListenerUnsubscribe = null;
    }

    this.authListenerUnsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      // Si no hay usuario autenticado en Firebase Auth, destruir listeners y limpiar datos privados
      if (!fbUser || !fbUser.uid) {
        this.stopActiveSubscriptions();
        this.clearPrivateData();
        return;
      }

      const uid = fbUser.uid.trim();
      if (!uid) {
        this.stopActiveSubscriptions();
        this.clearPrivateData();
        return;
      }

      // Determinar rol del usuario
      const email = (fbUser.email || '').toLowerCase().trim();
      const isKnownAdmin =
        email === 'elcocalombiano1828@gmail.com' ||
        email === 'juanes9802@gmail.com' ||
        uid === 'lpx4NLEEMkeh9EJFcG68oPMVdXF2' ||
        uid === 'admin_root_uid';

      let isAdmin = isKnownAdmin;

      if (!isAdmin) {
        try {
          const tokenResult = await fbUser.getIdTokenResult();
          if (
            tokenResult.claims.role === 'admin' ||
            tokenResult.claims.role === 'ADMIN' ||
            tokenResult.claims.admin === true ||
            tokenResult.claims.superadmin === true
          ) {
            isAdmin = true;
          }
        } catch (err) {
          console.warn('[DataStore] Error verificando claims de token:', err);
        }
      }

      if (!isAdmin) {
        try {
          const profileDoc = await firestoreService.getUser(uid);
          if (profileDoc && (profileDoc.role === 'ADMIN' || profileDoc.userCode?.startsWith('ADM'))) {
            isAdmin = true;
          }
        } catch (err) {
          console.warn('[DataStore] Consulta de verificación de rol administrador omitida:', err);
        }
      }

      const targetRole: 'ADMIN' | 'INVESTOR' = isAdmin ? 'ADMIN' : 'INVESTOR';

      // Evitar reconexiones duplicadas si la sesión actual no ha cambiado
      if (this.currentActiveUid === uid && this.currentActiveRole === targetRole && this.activeUnsubscribers.length > 0) {
        return;
      }

      // Destruir listeners anteriores y limpiar datos privados del usuario previo
      this.stopActiveSubscriptions();
      this.clearPrivateData();

      this.currentActiveUid = uid;
      this.currentActiveRole = targetRole;

      if (isAdmin) {
        this.startAdminSubscriptions();
      } else {
        this.startInvestorSubscriptions(uid);
      }
    });
  }

  /**
   * Destruye todos los listeners activos en Firestore y reinicia los punteros de sesión.
   */
  public stopActiveSubscriptions() {
    this.activeUnsubscribers.forEach((unsub) => {
      try {
        if (typeof unsub === 'function') {
          unsub();
        }
      } catch (err) {
        console.warn('[DataStore] Error ejecutando unsubscribe:', err);
      }
    });
    this.activeUnsubscribers = [];
    this.currentActiveUid = null;
    this.currentActiveRole = null;
  }

  /**
   * Limpia el estado privado en memoria para prevenir que queden datos del usuario previo.
   */
  public clearPrivateData() {
    this.users = [];
    this.dailyOperations = [];
    this.groupCalculations = [];
    this.userResults = [];
    this.reinvestments = [];
    this.disbursements = [];
    this.investments = [];
    this.applications = [];
    this.notifications = [];
    this.auditLogs = [];
    this.knownApplicationIds.clear();
    this.knownReinvestmentIds.clear();
    this.knownNotificationIds.clear();
    this.isInitialAppsSynced = false;
    this.isInitialReinvSynced = false;
    this.isInitialNotifsSynced = false;
    this.notify();
  }

  /**
   * Inicia listeners globales exclusivos para el rol ADMINISTRADOR.
   */
  public startAdminSubscriptions() {
    this.stopActiveSubscriptions();
    this.currentActiveRole = 'ADMIN';

    // 1. Users global
    const uUsers = firestoreService.listenUsers((remoteUsers) => {
      if (remoteUsers && remoteUsers.length > 0) {
        this.users = remoteUsers;
        this.saveState();
        this.notify();
      }
    });
    this.activeUnsubscribers.push(uUsers);

    // 2. Daily Operations global
    const uDailyOps = firestoreService.listenDailyOperations((remoteOps) => {
      if (remoteOps) {
        this.dailyOperations = remoteOps.sort(
          (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
        );
        this.saveState();
        this.notify();
      }
    });
    this.activeUnsubscribers.push(uDailyOps);

    // 3. Monthly Cycles global
    const uCycles = firestoreService.listenCycles((remoteCycles) => {
      if (remoteCycles && remoteCycles.length > 0) {
        this.cycles = remoteCycles;
        this.saveState();
        this.notify();
      }
    });
    this.activeUnsubscribers.push(uCycles);

    // 4. Group Calculations global
    const uGroupCalcs = firestoreService.listenGroupCalculations((remoteCalcs) => {
      if (remoteCalcs) {
        this.groupCalculations = remoteCalcs;
        this.saveState();
        this.notify();
      }
    });
    this.activeUnsubscribers.push(uGroupCalcs);

    // 5. User Results global
    const uResults = firestoreService.listenUserResults((remoteResults) => {
      if (remoteResults) {
        this.userResults = remoteResults;
        this.saveState();
        this.notify();
      }
    });
    this.activeUnsubscribers.push(uResults);

    // 6. Investor Applications global
    const uApps = firestoreService.listenApplications((remoteApps) => {
      if (!remoteApps) return;

      const orderedPending = remoteApps
        .filter((app) => app.status === 'PENDING')
        .sort((a, b) => {
          const queueDiff = Number(a.queuePosition || 0) - Number(b.queuePosition || 0);
          if (queueDiff !== 0) return queueDiff;

          const dateDiff =
            new Date(a.submissionDate || 0).getTime() -
            new Date(b.submissionDate || 0).getTime();

          if (dateDiff !== 0) return dateDiff;
          return String(a.id).localeCompare(String(b.id));
        });

      const pendingTurnById = new Map(
        orderedPending.map((app, index) => [app.id, index + 1])
      );

      const isFirst = !this.isInitialAppsSynced;
      remoteApps.forEach((app) => {
        if (!this.knownApplicationIds.has(app.id)) {
          this.knownApplicationIds.add(app.id);
          if (!isFirst && app.status === 'PENDING') {
            notifyNewApplicationToAdmin({
              applicantName: app.fullName,
              requestedCapitalCop: app.requestedCapitalCop,
              queuePosition: pendingTurnById.get(app.id) || 1,
              phone: app.phone,
              city: app.city,
              bank: app.originBank,
            });
          }
        }
      });
      this.isInitialAppsSynced = true;
      this.applications = remoteApps.sort((a, b) => (a.queuePosition || 0) - (b.queuePosition || 0));
      this.saveState();
      this.notify();
    });
    this.activeUnsubscribers.push(uApps);

    // 7. Reinvestments global
    const uReinvs = firestoreService.listenReinvestments((remoteReinvs) => {
      if (!remoteReinvs) return;
      const isFirst = !this.isInitialReinvSynced;
      remoteReinvs.forEach((reinv) => {
        if (!this.knownReinvestmentIds.has(reinv.id)) {
          this.knownReinvestmentIds.add(reinv.id);
          if (!isFirst && reinv.status === 'PENDING') {
            notifyNewReinvestmentToAdmin({
              userName: reinv.userName,
              userCode: reinv.userCode,
              newCapitalTargetCop: reinv.newCapitalTargetCop,
            });
          }
        }
      });
      this.isInitialReinvSynced = true;
      this.reinvestments = remoteReinvs.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      this.saveState();
      this.notify();
    });
    this.activeUnsubscribers.push(uReinvs);

    // 8. Disbursements global
    const uDisbs = firestoreService.listenDisbursements((remoteDisbs) => {
      if (remoteDisbs) {
        this.disbursements = remoteDisbs;
        this.saveState();
        this.notify();
      }
    });
    this.activeUnsubscribers.push(uDisbs);

    // 9. Investments global
    const uInvs = firestoreService.listenInvestments((remoteInvs) => {
      if (remoteInvs) {
        this.investments = remoteInvs;
        this.saveState();
        this.notify();
      }
    });
    this.activeUnsubscribers.push(uInvs);

    // 10. Global Config Settings
    const uSettings = firestoreService.listenSettings((remoteConfig) => {
      if (remoteConfig) {
        this.config = { ...this.config, ...remoteConfig };
        this.saveState();
        this.notify();
      }
    });
    this.activeUnsubscribers.push(uSettings);

    // 11. Notifications global
    const uNotifs = firestoreService.listenNotifications((remoteNotifs) => {
      if (!remoteNotifs) return;
      this.notifications = remoteNotifs.sort(
        (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()
      );
      this.saveState();
      this.notify();
    });
    this.activeUnsubscribers.push(uNotifs);

    // 12. Audit Logs global
    const uAudit = firestoreService.listenAuditLogs((remoteLogs) => {
      if (remoteLogs) {
        this.auditLogs = remoteLogs.sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        this.saveState();
        this.notify();
      }
    });
    this.activeUnsubscribers.push(uAudit);

    // 13. Financial Summaries global
    const uSummaries = firestoreService.listenFinancialSummaries((remoteSummaries) => {
      if (remoteSummaries) {
        this.financialSummaries = remoteSummaries;
        this.notify();
      }
    });
    this.activeUnsubscribers.push(uSummaries);
  }

  /**
   * Inicia listeners aislados y seguros exclusivos para el rol INVERSIONISTA.
   * Regla 2: NO consulta collection('users'). Carga exclusivamente su perfil canónico.
   * Regla 3: cycleUserResults where('userUid', '==', currentUser.uid).
   * Regla 4: reinvestments where('userUid', '==', currentUser.uid).
   * Regla 5: disbursements where('userUid', '==', currentUser.uid).
   * Regla 6: investments where('userUid', '==', currentUser.uid).
   * Regla 7: notifications (dos listeners: userUid y targetUids, unificados y deduplicados por document ID).
   * Regla 8: dailyOperations (dos listeners: authorizedUids y isPublicToActiveUsers, unificados y deduplicados).
   * Regla 9: cycleGroupCalculations NO se escucha para inversionistas.
   * Regla 10: bitacoras no tiene listeners.
   */
  public startInvestorSubscriptions(userUid: string) {
    if (!userUid) return;
    this.stopActiveSubscriptions();
    this.currentActiveUid = userUid;
    this.currentActiveRole = 'INVESTOR';

    // 1. Perfil propio exclusivo (doc(db, 'users', userUid))
    const uProfile = firestoreService.listenUserProfile(userUid, (remoteProfile) => {
      if (remoteProfile) {
        const existingIdx = this.users.findIndex(
          (u) => u.uid === userUid || u.id === userUid || (remoteProfile.id && u.id === remoteProfile.id)
        );
        if (existingIdx >= 0) {
          this.users[existingIdx] = remoteProfile;
        } else {
          this.users = [remoteProfile];
        }
        this.saveState();
        this.notify();
      }
    });
    this.activeUnsubscribers.push(uProfile);

    // 2. Operaciones Diarias: dos listeners (authorizedUids y isPublicToActiveUsers) deduplicados
    const uDailyOps = firestoreService.listenDailyOperationsForUser(userUid, (ops) => {
      this.dailyOperations = ops;
      this.saveState();
      this.notify();
    });
    this.activeUnsubscribers.push(uDailyOps);

    // 3. Ciclos mensuales (información general de ciclo y TRM)
    const uCycles = firestoreService.listenCycles((remoteCycles) => {
      if (remoteCycles && remoteCycles.length > 0) {
        this.cycles = remoteCycles;
        this.saveState();
        this.notify();
      }
    });
    this.activeUnsubscribers.push(uCycles);

    // 4. Resultados de liquidación individual: where('userUid', '==', currentUser.uid)
    // PROHIBIDO: iniciar listener de cycleGroupCalculations para inversionista
    const uResults = firestoreService.listenUserResultsForUser(userUid, (results) => {
      this.userResults = results;
      this.saveState();
      this.notify();
    });
    this.activeUnsubscribers.push(uResults);

    // 5. Reinversiones propias: where('userUid', '==', currentUser.uid)
    const uReinvs = firestoreService.listenReinvestmentsForUser(userUid, (reinvs) => {
      this.reinvestments = reinvs.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      this.saveState();
      this.notify();
    });
    this.activeUnsubscribers.push(uReinvs);

    // 6. Desembolsos propios: where('userUid', '==', currentUser.uid)
    const uDisbs = firestoreService.listenDisbursementsForUser(userUid, (disbs) => {
      this.disbursements = disbs.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      this.saveState();
      this.notify();
    });
    this.activeUnsubscribers.push(uDisbs);

    // 7. Inversiones propias: where('userUid', '==', currentUser.uid)
    const uInvs = firestoreService.listenInvestmentsForUser(userUid, (invs) => {
      this.investments = invs.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      this.saveState();
      this.notify();
    });
    this.activeUnsubscribers.push(uInvs);

    // 8. Configuración global (TRM, rangos)
    const uSettings = firestoreService.listenSettings((remoteConfig) => {
      if (remoteConfig) {
        this.config = { ...this.config, ...remoteConfig };
        this.saveState();
        this.notify();
      }
    });
    this.activeUnsubscribers.push(uSettings);

    // 9. Notificaciones: dos listeners (userUid y targetUids), deduplicados por document ID
    const uNotifs = firestoreService.listenNotificationsForUser(userUid, (notifs) => {
      this.notifications = notifs;
      this.saveState();
      this.notify();
    });
    this.activeUnsubscribers.push(uNotifs);
  }

  /**
   * Alias retrocompatible para herramientas administrativas.
   */
  public initRealtimeFirestoreSync() {
    this.startAdminSubscriptions();
  }

  public async syncWithFirestore() {
    try {
      // 1. Cargar usuarios reales desde Firestore
      const remoteUsers = await firestoreService.getAllUsers();
      if (remoteUsers && remoteUsers.length > 0) {
        this.users = remoteUsers;
      }

      // 2. Cargar ciclos reales desde Firestore
      const remoteCycles = await firestoreService.getAllCycles();
      if (remoteCycles && remoteCycles.length > 0) {
        this.cycles = remoteCycles;
      }

      // 3. Cargar operaciones diarias desde Firestore
      const remoteOps = await firestoreService.getAllDailyOperations();
      if (remoteOps) {
        this.dailyOperations = remoteOps;
      }

      // 4. Cargar cálculos grupales y liquidaciones individuales
      const remoteCalcs = await firestoreService.getAllGroupCalculations();
      if (remoteCalcs) {
        this.groupCalculations = remoteCalcs;
      }

      const remoteResults = await firestoreService.getAllUserResults();
      if (remoteResults) {
        this.userResults = remoteResults;
      }

      // 5. Cargar postulaciones
      const remoteApps = await firestoreService.getAllApplications();
      if (remoteApps) {
        remoteApps.forEach((a) => this.knownApplicationIds.add(a.id));
        this.applications = remoteApps.sort((a, b) => (a.queuePosition || 0) - (b.queuePosition || 0));
        this.isInitialAppsSynced = true;
      }

      // 6. Cargar solicitudes de reinversión y desembolsos
      const remoteReinvs = await firestoreService.getAllReinvestments();
      if (remoteReinvs) {
        remoteReinvs.forEach((r) => this.knownReinvestmentIds.add(r.id));
        this.reinvestments = remoteReinvs.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        this.isInitialReinvSynced = true;
      }

      const remoteDisbs = await firestoreService.getAllDisbursements();
      if (remoteDisbs) {
        this.disbursements = remoteDisbs;
      }

      const remoteInvs = await firestoreService.getAllInvestments();
      if (remoteInvs) {
        this.investments = remoteInvs;
      }

      // 7. Cargar notificaciones
      const remoteNotifs = await firestoreService.getAllNotifications();
      if (remoteNotifs) {
        remoteNotifs.forEach((n) => this.knownNotificationIds.add(n.id));
        this.notifications = remoteNotifs.sort(
          (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()
        );
        this.isInitialNotifsSynced = true;
      }

      // 8. Cargar configuración global
      const remoteConfig = await firestoreService.getSettings();
      if (remoteConfig) {
        this.config = { ...this.config, ...remoteConfig };
      }

      // 9. Cargar logs de auditoría
      const remoteLogs = await firestoreService.getAllAuditLogs();
      if (remoteLogs) {
        this.auditLogs = remoteLogs.sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
      }

      this.notify();
    } catch (err) {
      console.warn('[DataStore] Error en sincronización inicial Firestore:', err);
    }
  }

  /**
   * Fuerza el envío y sincronización completa del estado en memoria a Cloud Firestore
   */
  public async forceFullCloudSync(): Promise<{ success: boolean; message: string }> {
    try {
      for (const u of this.users) {
        await firestoreService.saveUser(u);
      }
      if (this.applications.length > 0) {
        await firestoreService.saveApplicationsBatch(this.applications);
      }
      await firestoreService.saveSettings(this.config);
      if (this.notifications.length > 0) {
        await firestoreService.saveNotificationsBatch(this.notifications);
      }

      this.notify();
      return { success: true, message: '¡Sincronización en tiempo real con Cloud Firestore completada al 100%!' };
    } catch (err: any) {
      console.error('Error al forzar la sincronización en la nube:', err);
      return { success: false, message: err?.message || 'Error al guardar en la nube.' };
    }
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => {
      try {
        l();
      } catch (err) {
        console.error('Listener error:', err);
      }
    });
  }

  private loadState() {
    // Inicialización limpia 100% en memoria; los datos provienen de Firestore
    this.users = [];
    this.cycles = [];
    this.config = { ...DEFAULT_GLOBAL_CONFIG };
    this.groupCalculations = [];
    this.userResults = [];
    this.notifications = [];
    this.reinvestments = [];
    this.disbursements = [];
    this.investments = [];
    this.applications = [];
    this.auditLogs = [];
    this.dailyOperations = [];
  }

  public resetToDefaults() {
    this.users = [];
    this.cycles = [];
    this.config = { ...DEFAULT_GLOBAL_CONFIG };
    this.groupCalculations = [];
    this.userResults = [];
    this.notifications = [];
    this.reinvestments = [];
    this.disbursements = [];
    this.investments = [];
    this.applications = [];
    this.auditLogs = [];
    this.dailyOperations = [];
    this.notify();
  }

  private seedMockCalculations() {
    // No-op: Modo producción / datos reales en cero
  }

  private saveState() {
    // No-op: No persistir datos financieros en localStorage. Firestore es la única fuente de verdad.
  }

  // Getters
  public getUsers(): UserProfile[] {
    return this.users;
  }

  public getActiveUsers(): UserProfile[] {
    return this.users.filter(
      (u) => isActiveFinancialParticipant(u)
    );
  }

  public getUserById(id: string): UserProfile | undefined {
    return this.users.find((u) => u.id === id || u.uid === id);
  }

  public getUserByCode(code: string): UserProfile | undefined {
    return this.users.find((u) => u.userCode.toUpperCase() === code.toUpperCase().trim());
  }

  public getCycles(): MonthlyCycle[] {
    return this.cycles;
  }

  public getFinancialSummaries(): CycleFinancialSummary[] {
    return this.financialSummaries;
  }

  public getAllUserResults(): CycleUserResult[] {
    return this.userResults;
  }

  public getActiveCycle(): MonthlyCycle {
    const cycle = this.cycles.find((c) => c.cycleId === this.config.activeCycleId || c.id === this.config.activeCycleId);
    if (cycle) return cycle;
    if (this.cycles && this.cycles.length > 0) return this.cycles[0];

    // Fallback seguro cuando la base de datos está vacía o cargando
    const activeId = this.config?.activeCycleId || '';
    return {
      id: activeId,
      cycleId: activeId,
      name: 'Ciclo Activo',
      status: 'OPEN',
      trmApplied: 0,
      totalManagedCapital: 0,
      totalUsersActive: 0,
      calculatedUsersCount: 0,
      totalGroupsCount: 0,
      calculatedGroupsCount: 0,
      totalGrossUsd: 0,
      totalGrossCop: 0,
      totalUsersProfitCop: 0,
      totalAdminCommissionCop: 0,
      notificationsSent: false,
      notificationsSentAt: null,
      closedAt: null,
      closedBy: null,
      openedAt: new Date().toISOString(),
    };
  }

  public getCycleById(cycleId: string): MonthlyCycle | undefined {
    return this.cycles.find((c) => c.cycleId === cycleId || c.id === cycleId);
  }

  public getConfig(): GlobalConfig {
    return this.config;
  }

  public getGroupCalculations(cycleId?: string): CycleGroupCalculation[] {
    const targetCycleId = cycleId || this.config.activeCycleId;
    return this.groupCalculations.filter((g) => g.cycleId === targetCycleId && g.status === 'CALCULATED');
  }

  public getUserResults(cycleId?: string): CycleUserResult[] {
    const targetCycleId = cycleId || this.config.activeCycleId;
    return this.userResults.filter((r) => r.cycleId === targetCycleId);
  }

  public getUserResultForUser(userId: string, cycleId?: string): CycleUserResult | undefined {
    const targetCycleId = cycleId || this.config.activeCycleId;
    return this.userResults.find(
      (r) =>
        (r.userId === userId ||
          r.userCode === userId ||
          (r.userUid && r.userUid === userId) ||
          (r.email && r.email.toLowerCase() === userId.toLowerCase())) &&
        r.cycleId === targetCycleId
    );
  }

  private mapSharedReadStates(notifs: NotificationItem[]): NotificationItem[] {
    return notifs.map(n => {
      if (!n.isRead && !this.isNotificationOwned(n) && this.readSharedIds.has(n.id)) {
        return { ...n, isRead: true };
      }
      return n;
    });
  }

  /**
   * Obtiene exclusivamente las notificaciones pertinentes al Administrador:
   * - Nuevas solicitudes de ingreso/admisión (INVESTMENT_REQUEST)
   * - Solicitudes de reinversión a capital (REINVESTMENT)
   * - Solicitudes de desembolso o retiros (DISBURSEMENT)
   * - Avisos directos para la administración (ALL_ADMINS / admin_root_uid)
   * EXCLUYE estrictamente todas las notificaciones individuales de operaciones diarias
   * y cierres mensuales enviadas a cada inversionista individual.
   */
  public getAdminNotifications(): NotificationItem[] {
    const list = this.notifications
      .filter((n) => {
        if (n.hiddenByUser === true) return false;

        // Excluir estrictamente reportes, operaciones diarias individuales y cierres mensuales de inversionistas
        if (
          n.type === 'MONTHLY_CLOSURE' ||
          n.title?.includes('Operación Diaria') ||
          n.message?.includes('Tu ganancia') ||
          n.message?.includes('Tu operación del mes')
        ) {
          // Solamente conservar si fue dirigida explícitamente a la administración general
          if (n.userId !== 'ALL_ADMINS' && n.userId !== 'admin_root_uid' && n.userId !== 'usr_admin') {
            return false;
          }
        }

        // Si la notificación pertenece a un usuario regular individual (ej: no ALL_ADMINS) y no es para admin, descartar
        if (
          n.userId &&
          n.userId !== 'ALL_ADMINS' &&
          n.userId !== 'admin_root_uid' &&
          n.userId !== 'usr_admin' &&
          !n.userId.toUpperCase().includes('ADMIN')
        ) {
          return false;
        }

        return (
          n.type === 'INVESTMENT_REQUEST' ||
          n.type === 'REINVESTMENT' ||
          n.type === 'DISBURSEMENT' ||
          n.userId === 'ALL_ADMINS' ||
          n.userId === 'admin_root_uid' ||
          n.userId === 'usr_admin' ||
          n.userCode === 'ADMIN'
        );
      })
      .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
    return this.mapSharedReadStates(list);
  }

  public getNotificationsForUser(userId: string): NotificationItem[] {
    const user =
      this.getUserById(userId) ||
      this.getUserByCode(userId);

    const isAdmin =
      user?.role === 'ADMIN' ||
      user?.email === 'elcocalombiano1828@gmail.com' ||
      user?.userCode?.startsWith('ADM') ||
      userId === 'admin_root_uid' ||
      userId === 'usr_admin' ||
      userId === 'ALL_ADMINS' ||
      userId.toUpperCase().includes('ADMIN');

    const adminFinancialParticipant =
      isAdmin &&
      user?.participatesInTrading === true;

    // ------------------------------------------------------
    // ADMIN NORMAL
    //
    // Sigue viendo exclusivamente el buzón administrativo.
    // ------------------------------------------------------

    if (
      isAdmin &&
      !adminFinancialParticipant
    ) {
      return this.getAdminNotifications();
    }

    // ------------------------------------------------------
    // NOTIFICACIONES PERSONALES
    //
    // Este bloque sirve tanto para USER normal como para
    // ADMIN + participatesInTrading.
    // ------------------------------------------------------

    const personalList =
      this.notifications
        .filter((n) => {
          if (n.hiddenByUser === true) {
            return false;
          }

          // Una notificación general de admisiones no es
          // una notificación financiera personal.
          if (
            n.userId === 'ALL_ADMINS' &&
            n.type === 'INVESTMENT_REQUEST'
          ) {
            return false;
          }

          const notifEmail =
            (
              n.userEmail ||
              n.payload?.userEmail ||
              ''
            )
              .toString()
              .toLowerCase()
              .trim();

          const notifUid =
            n.userUid ||
            (n as any).uid ||
            n.payload?.userUid ||
            '';

          const notifUserId =
            n.userId || '';

          const notifCode =
            (n.userCode || '')
              .toString()
              .toUpperCase()
              .trim();

          const userEmail =
            (user?.email || '')
              .toString()
              .toLowerCase()
              .trim();

          const userUid =
            user?.uid || '';

          const userInternalId =
            user?.id || '';

          const userCode =
            (user?.userCode || '')
              .toString()
              .toUpperCase()
              .trim();

          return (
            notifUserId === userId ||

            notifCode ===
              userId.toUpperCase() ||

            (
              user &&
              (
                (
                  userInternalId &&
                  (
                    notifUserId ===
                      userInternalId ||

                    notifUserId ===
                      userCode
                  )
                ) ||

                (
                  userUid &&
                  (
                    notifUid ===
                      userUid ||

                    notifUserId ===
                      userUid
                  )
                ) ||

                (
                  userCode &&
                  notifCode &&
                  userCode ===
                    notifCode
                ) ||

                (
                  userEmail &&
                  notifEmail &&
                  userEmail ===
                    notifEmail
                ) ||

                (
                  user.fullName &&
                  n.userName &&
                  user.fullName
                    .toLowerCase()
                    .trim() ===
                    n.userName
                      .toLowerCase()
                      .trim()
                )
              )
            )
          );
        })
        .sort(
          (a, b) =>
            new Date(b.sentAt).getTime() -
            new Date(a.sentAt).getTime()
        );

    const mappedPersonal =
      this.mapSharedReadStates(
        personalList
      );

    // ------------------------------------------------------
    // USER NORMAL
    // ------------------------------------------------------

    if (!isAdmin) {
      return mappedPersonal;
    }

    // ------------------------------------------------------
    // ADMIN + PARTICIPANTE FINANCIERO
    //
    // Une:
    // 1. Buzón administrativo
    // 2. Sus operaciones diarias
    // 3. Sus cierres mensuales
    // 4. Sus avisos financieros personales
    //
    // Sin duplicar documentos con el mismo ID.
    // ------------------------------------------------------

    const adminList =
      this.getAdminNotifications();

    const mergedById =
      new Map<string, NotificationItem>();

    adminList.forEach(
      (notification) => {
        mergedById.set(
          notification.id,
          notification
        );
      }
    );

    mappedPersonal.forEach(
      (notification) => {
        mergedById.set(
          notification.id,
          notification
        );
      }
    );

    return Array.from(
      mergedById.values()
    ).sort(
      (a, b) =>
        new Date(b.sentAt).getTime() -
        new Date(a.sentAt).getTime()
    );
  }

  public getAllNotifications(): NotificationItem[] {
    const list = [...this.notifications].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
    return this.mapSharedReadStates(list);
  }

  public getReinvestments(): ReinvestmentRequest[] {
    return this.reinvestments;
  }

  public getDisbursements(): DisbursementRequest[] {
    return this.disbursements;
  }

  public getDisbursementsForUser(userId: string): DisbursementRequest[] {
    return this.disbursements
      .filter((d) => d.userId === userId || d.userCode === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public getInvestments(): InvestmentRequest[] {
    return this.investments;
  }

  public getAuditLogs(): AuditLog[] {
    return [...this.auditLogs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /**
   * Obtiene la estructura de grupos de capital exacto agrupados por bitácora.
   * Reglas de negocio críticas (V2.2):
   * 1. CICLO ACTIVO: La vista representa exclusivamente grupos operativos ACTUALES.
   *    Regla: active USER con capital X -> grupo X existe.
   *    0 USER ACTIVE -> 0 grupos activos.
   *    dailyOperations huérfanas/históricas -> NO crean tarjetas activas.
   * 2. CICLO CERRADO: Snapshot histórico inmutable.
   *    Derivado de las grabaciones históricas de cycleGroupCalculations y cycleUserResults,
   *    preservando los datos sin afectarse por usuarios eliminados o desactivados en el presente.
   */
  public getCategoryGroups(cycleId?: string): Record<BitacoraCategory, CategoryGroupInfo[]> {
    const targetCycleId = cycleId || this.config.activeCycleId;
    const targetCycle = this.cycles.find((c) => c.cycleId === targetCycleId);
    const isClosedCycle = targetCycle?.status === 'CLOSED';
    const isStartedCycle = targetCycle?.operationalStatus === 'STARTED';
    const groupCalculations = this.getGroupCalculations(targetCycleId);
    const cycleUserResults = this.getUserResults(targetCycleId);

    const result: Record<BitacoraCategory, CategoryGroupInfo[]> = {
      AZUL: [],
      VERDE: [],
      NEGRA: [],
    };

    // Agrupar usuarios por categoría y capital exacto
    const map = new Map<string, { category: BitacoraCategory; groupCapitalCop: number; users: UserProfile[] }>();

    if (isClosedCycle) {
      // CICLO CERRADO: Snapshot histórico inmutable.
      // Reconstruir grupos desde los cálculos guardados de dicho ciclo cerrado
      groupCalculations.forEach((calc) => {
        const key = `${calc.category}_${calc.groupCapitalCop}`;
        if (!map.has(key)) {
          const matchingResults = cycleUserResults.filter(
            (r) => r.cycleCategory === calc.category && Number(r.groupCapitalCop || r.cycleCapitalCop) === Number(calc.groupCapitalCop)
          );
          const reconstructedUsers: UserProfile[] = matchingResults.map((r) => ({
            id: r.userId,
            uid: r.userUid || r.userId,
            userCode: r.userCode,
            fullName: r.userName,
            email: r.email,
            phone: '',
            role: 'USER',
            status: 'ACTIVE',
            currentCapital: r.groupCapitalCop || r.currentCycleCapitalCop || r.cycleCapitalCop,
            currency: 'COP',
            category: r.cycleCategory,
            userPercentage: r.userPercentage,
            adminPercentage: r.adminPercentage,
            paymentMethod: '',
            paymentDetails: '',
            createdAt: r.calculatedAt || '',
            entryDate: '',
          }));

          map.set(key, {
            category: calc.category,
            groupCapitalCop: Number(calc.groupCapitalCop),
            users: reconstructedUsers,
          });
        }
      });

      // Asegurar que si hay resultados individuales guardados en el ciclo cerrado, se muestren
      // GROUP_USERS_SAME_CAPITAL:
      // Todos los participantes congelados con la misma categoria y
      // groupCapitalCop pertenecen al MISMO grupo operativo.
      cycleUserResults.forEach((r) => {
        const capital = Number(
          r.groupCapitalCop ||
          r.cycleCapitalCop ||
          0
        );

        if (!capital || !r.cycleCategory) {
          return;
        }

        const key =
          `${r.cycleCategory}_${capital}`;

        const user: UserProfile = {
          id: r.userId,
          uid: r.userUid || r.userId,
          userCode: r.userCode,
          fullName: r.userName,
          email: r.email,
          phone: '',
          role: 'USER',
          status: 'ACTIVE',
          currentCapital: capital,
          currency: 'COP',
          category: r.cycleCategory,
          userPercentage: r.userPercentage,
          adminPercentage: r.adminPercentage,
          paymentMethod: '',
          paymentDetails: '',
          createdAt: r.calculatedAt || '',
          entryDate: '',
        };

        const existingGroup =
          map.get(key);

        if (!existingGroup) {
          map.set(key, {
            category: r.cycleCategory,
            groupCapitalCop: capital,
            users: [user],
          });

          return;
        }

        const alreadyIncluded =
          existingGroup.users.some(
            (existingUser) =>
              (
                user.uid &&
                existingUser.uid === user.uid
              ) ||
              (
                user.id &&
                existingUser.id === user.id
              ) ||
              (
                user.userCode &&
                existingUser.userCode === user.userCode
              )
          );

        if (!alreadyIncluded) {
          existingGroup.users.push(user);
        }
      });
    } else if (isStartedCycle) {
      // CICLO STARTED: autoridad operativa = cycleUserResults vigente.
      // Un ajuste de capital dentro del ciclo mueve al usuario de grupo
      // sin reescribir dailyOperations históricas.
      cycleUserResults.forEach((r) => {
        const capital = Number(
          r.currentCycleCapitalCop ??
          r.groupCapitalCop ??
          r.cycleCapitalCop ??
          0
        );

        if (!capital) return;

        const category =
          r.cycleCategory ||
          getCategoryForCapital(capital);

        const key = `${category}_${capital}`;

        const user: UserProfile = {
          id: r.userId,
          uid: r.userUid || r.userId,
          userCode: r.userCode,
          fullName: r.userName,
          email: r.email,
          phone: '',
          role: 'USER',
          status: 'ACTIVE',
          currentCapital: capital,
          currency: 'COP',
          category,
          userPercentage: r.userPercentage,
          adminPercentage: r.adminPercentage,
          paymentMethod: '',
          paymentDetails: '',
          createdAt: r.calculatedAt || '',
          entryDate: '',
        };

        if (!map.has(key)) {
          map.set(key, {
            category,
            groupCapitalCop: capital,
            users: [],
          });
        }

        const group = map.get(key)!;
        const alreadyIncluded = group.users.some(
          (existingUser) =>
            (user.uid && existingUser.uid === user.uid) ||
            (user.id && existingUser.id === user.id) ||
            (user.userCode && existingUser.userCode === user.userCode)
        );

        if (!alreadyIncluded) {
          group.users.push(user);
        }
      });
    } else {
      // CICLO ACTIVO NO STARTED: Vista operativa desde perfiles actuales.
      // Regla estricta: active USER con capital X -> grupo X existe.
      // 0 USER ACTIVE -> 0 grupos activos.
      // dailyOperations huérfanas/históricas -> NO crean tarjetas activas.
      const activeUsers = this.getActiveUsers();
      activeUsers.forEach((user) => {
        const category = user.category || getCategoryForCapital(user.currentCapital);
        const key = `${category}_${user.currentCapital}`;
        if (!map.has(key)) {
          map.set(key, {
            category,
            groupCapitalCop: user.currentCapital,
            users: [],
          });
        }
        map.get(key)!.users.push(user);
      });
    }

    // Ordenar y vincular cálculos y operaciones diarias
    map.forEach((item) => {
      const calcId = `${targetCycleId}_${item.category}_${item.groupCapitalCop}`;
      const calculation = groupCalculations.find((g) => g.id === calcId);
      const dailyOps = this.getDailyOperations(targetCycleId, item.category, item.groupCapitalCop);
      const dailySumUsd = dailyOps.reduce((sum, op) => sum + op.amountUsd, 0);

      const groupInfo: CategoryGroupInfo = {
        category: item.category,
        groupCapitalCop: item.groupCapitalCop,
        // BITACORA_USERS_CAPITAL_ASC
        users: [...item.users].sort((a, b) => {
          const capitalDifference =
            (Number(a.currentCapital) || 0) -
            (Number(b.currentCapital) || 0);

          if (capitalDifference !== 0) {
            return capitalDifference;
          }

          const codeDifference =
            String(a.userCode || '').localeCompare(
              String(b.userCode || '')
            );

          if (codeDifference !== 0) {
            return codeDifference;
          }

          return String(
            a.fullName || ''
          ).localeCompare(
            String(b.fullName || '')
          );
        }),
        calculation,
        isCalculated: !!calculation && calculation.status === 'CALCULATED',
        totalUsdApplied: dailyOps.length > 0 ? dailySumUsd : (calculation?.totalUsdApplied || 0),
        totalCopPerUser: calculation?.totalCopPerUser || 0,
        totalUsersProfitCop: calculation?.totalUsersProfitCop || 0,
        totalAdminCommissionCop: calculation?.totalAdminCommissionCop || 0,
        dailyOperations: dailyOps,
        totalOperationsCount: dailyOps.length,
      };

      result[item.category].push(groupInfo);
    });

    // Ordenar ascendentemente por capital dentro de cada categoría
    result.AZUL.sort((a, b) => a.groupCapitalCop - b.groupCapitalCop);
    result.VERDE.sort((a, b) => a.groupCapitalCop - b.groupCapitalCop);
    result.NEGRA.sort((a, b) => a.groupCapitalCop - b.groupCapitalCop);

    return result;
  }

  /**
   * Limpieza local en memoria tras ejecución de purga autoritativa del ciclo activo
   */
  public purgeTradingTestDataLocal(cycleId: string): void {
    const targetCycle = this.cycles.find((c) => c.cycleId === cycleId);
    if (!targetCycle || targetCycle.status === 'CLOSED') {
      return;
    }

    const opsToRemove = this.dailyOperations.filter((op) => op.cycleId === cycleId);
    const opIdsSet = new Set(opsToRemove.map((o) => o.id));

    this.dailyOperations = this.dailyOperations.filter((op) => op.cycleId !== cycleId);
    this.groupCalculations = this.groupCalculations.filter(
      (g) => g.cycleId !== cycleId && !g.id.startsWith(`${cycleId}_`)
    );
    this.userResults = this.userResults.filter((r) => r.cycleId !== cycleId);
    this.notifications = this.notifications.filter((n) => {
      const isDirectOp = n.payload && n.payload.operationId && opIdsSet.has(n.payload.operationId);
      const isDirectOpField = (n as any).operationId && opIdsSet.has((n as any).operationId);
      const isPrefix = Array.from(opIdsSet).some((opId) => n.id.startsWith(`notif_op_${opId}_`));
      const isCycleDailyNotif =
        n.cycleId === cycleId &&
        (n.type === 'DAILY_OPERATION' || (n.type === 'SYSTEM' && n.title?.includes('Operación Diaria')));
      return !(isDirectOp || isDirectOpField || isPrefix || isCycleDailyNotif);
    });

    targetCycle.totalGroupsCount = 0;
    targetCycle.calculatedGroupsCount = 0;
    targetCycle.calculatedUsersCount = 0;
    targetCycle.totalGrossUsd = 0;
    targetCycle.totalGrossCop = 0;
    targetCycle.totalUsersProfitCop = 0;
    targetCycle.totalAdminCommissionCop = 0;
    targetCycle.notificationsSent = false;
    targetCycle.notificationsSentAt = undefined;

    this.recalculateCycleMetrics();
    this.notify();
  }

  public getDailyOperations(cycleId?: string, category?: BitacoraCategory, groupCapitalCop?: number): DailyGroupOperation[] {
    let list = [...this.dailyOperations];
    if (cycleId) {
      list = list.filter((op) => op.cycleId === cycleId);
    }
    if (category) {
      list = list.filter((op) => op.category === category);
    }
    if (groupCapitalCop !== undefined) {
      list = list.filter((op) => Number(op.groupCapitalCop) === Number(groupCapitalCop));
    }
    return list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  /**
   * Obtiene de forma estricta y transparente ÚNICAMENTE las operaciones que corresponden a un inversionista específico.
   * Incluye:
   * 1. Operaciones individuales asignadas directamente a su id, uid, email o userCode.
   * 2. Operaciones que incluyan su uid, id o userCode en el array `authorizedUids`.
   * 3. Operaciones públicas globales (`targetType === 'GLOBAL'` o `isPublicToActiveUsers === true`).
   * 4. Operaciones de categoría (`targetType === 'CATEGORY'` y `category === userCategory`).
   * 5. Operaciones grupales generales cuyo capital coincida exactamente con el capital actual del usuario.
   * Excluye estrictamente operaciones asignadas a otros usuarios individuales.
   */
  /**
   * Helper canónico para resolver los destinatarios de una operación diaria.
   * Orden de autoridad obligatorio:
   * 1. INDIVIDUAL: targetType === 'INDIVIDUAL' o op.userUid/userId -> SOLO el usuario con ese UID exacto.
   * 2. AUTHORIZED UIDS: Si op.authorizedUids tiene elementos, SOLO los usuarios cuyos UIDs estén en la lista.
   * 3. GLOBAL: Solo si op.isPublicToActiveUsers === true.
   * 4. CATEGORY legacy: op.targetType === 'CATEGORY' && op.category
   * 5. GROUP legacy: (op.targetType === 'GROUP' || op.targetType === 'CUSTOM_GROUP') && op.groupCapitalCop != null
   * Fallback final obligatorio: [] (NUNCA todos los usuarios).
   */
  public resolveOperationRecipients(
    op: DailyGroupOperation,
    activeUsers: UserProfile[]
  ): UserProfile[] {
    const eligibleUsers = activeUsers.filter(
      (u) => isActiveFinancialParticipant(u)
    );

    // A. INDIVIDUAL EXPLÍCITO
    if (op.targetType === 'INDIVIDUAL' || op.userUid || op.userId) {
      const targetUid = (op.userUid || op.userId || '').trim();
      if (!targetUid) return [];
      return eligibleUsers.filter(
        (u) =>
          (u.uid && u.uid.trim() === targetUid) ||
          (u.id && u.id.trim() === targetUid) ||
          (u.userCode && op.userCode && u.userCode.trim().toUpperCase() === op.userCode.trim().toUpperCase())
      );
    }

    // B. AUTHORIZED UIDS ES AUTORITATIVO
    if (Array.isArray(op.authorizedUids) && op.authorizedUids.length > 0) {
      const allowed = new Set(op.authorizedUids.map((id) => (id || '').trim()));
      return eligibleUsers.filter((u) => u.uid && allowed.has(u.uid.trim()));
    }

    // C. OPERACIÓN GLOBAL REAL
    if (op.isPublicToActiveUsers === true) {
      return eligibleUsers;
    }

    // D. CATEGORY LEGACY
    if (op.targetType === 'CATEGORY' && op.category) {
      return eligibleUsers.filter((u) => u.category === op.category);
    }

    // E. GROUP / CUSTOM_GROUP LEGACY
    if (
      ((op.targetType as string) === 'GROUP' || op.targetType === 'CUSTOM_GROUP') &&
      op.groupCapitalCop != null
    ) {
      return eligibleUsers.filter(
        (u) => Number(u.currentCapital) === Number(op.groupCapitalCop)
      );
    }

    // Fallback obligatorio: NUNCA todos los usuarios
    return [];
  }

  public getDailyOperationsForUser(
    user: UserProfile | { id?: string; uid?: string; email?: string; userCode?: string; fullName?: string; currentCapital?: number; category?: BitacoraCategory } | null | undefined,
    cycleId?: string
  ): DailyGroupOperation[] {
    if (!user) return [];

    const targetCycleId = (cycleId || this.getActiveCycle()?.cycleId || this.config.activeCycleId || '').trim();
    const userCapital = Number(user.currentCapital || 0);
    const userCategory = user.category || (userCapital > 0 ? getCategoryForCapital(userCapital) : undefined);
    const userEmail = user.email ? user.email.toLowerCase().trim() : '';
    const userUid = user.uid ? user.uid.trim() : '';
    const userId = user.id ? user.id.trim() : '';
    const userCode = user.userCode ? user.userCode.toUpperCase().trim() : '';

    const dbUser = this.users.find(
      (u) =>
        (userId && u.id === userId) ||
        (userUid && u.uid === userUid) ||
        (userEmail && u.email?.toLowerCase().trim() === userEmail) ||
        (userCode && u.userCode?.toUpperCase().trim() === userCode)
    );

    const allUserKeys = new Set<string>();
    if (userId) allUserKeys.add(userId);
    if (userUid) allUserKeys.add(userUid);
    if (userCode) allUserKeys.add(userCode);
    if (userEmail) allUserKeys.add(userEmail);

    if (dbUser) {
      if (dbUser.id) allUserKeys.add(dbUser.id);
      if (dbUser.uid) allUserKeys.add(dbUser.uid);
      if (dbUser.userCode) allUserKeys.add(dbUser.userCode.toUpperCase().trim());
      if (dbUser.email) allUserKeys.add(dbUser.email.toLowerCase().trim());
    }

    const keyList = Array.from(allUserKeys).map((k) => k.toLowerCase().trim());

    return this.dailyOperations
      .filter((op) => {
        // 1. Filtrar por ciclo si se especificó y no es 'ALL'
        if (
          targetCycleId &&
          targetCycleId !== 'ALL' &&
          op.cycleId &&
          op.cycleId.trim().toLowerCase() !== targetCycleId.toLowerCase()
        ) {
          return false;
        }

        // 1. INDIVIDUAL: Si la operación es explícitamente individual o asignada a un usuario
        if (op.targetType === 'INDIVIDUAL' || op.userId || op.userUid || op.userCode) {
          const opUserId = op.userId ? op.userId.trim().toLowerCase() : '';
          const opUserUid = op.userUid ? op.userUid.trim().toLowerCase() : '';
          const opUserCode = op.userCode ? op.userCode.trim().toUpperCase() : '';

          const matchesDirectUser = keyList.some((k) => {
            return (
              (opUserId && opUserId === k) ||
              (opUserUid && opUserUid === k) ||
              (opUserCode && opUserCode === k.toUpperCase())
            );
          });
          return matchesDirectUser;
        }

        // 2. AUTHORIZED UIDS ES AUTORITATIVO
        // Si existe y tiene elementos, SOLO se permite si incluye alguno de los UIDs del usuario.
        // Si NO incluye el UID del usuario, retorna false INMEDIATAMENTE (NO continuar a category/capital).
        if (Array.isArray(op.authorizedUids) && op.authorizedUids.length > 0) {
          const inAuthList = op.authorizedUids.some((authId) => {
            if (!authId) return false;
            const clean = authId.trim().toLowerCase();
            return keyList.includes(clean);
          });
          return inAuthList; // true si está autorizado, false INMEDIATAMENTE si no lo está.
        }

        // 3. OPERACIÓN GLOBAL REAL
        if (op.isPublicToActiveUsers === true) {
          return true;
        }

        // 4. CATEGORY LEGACY
        const targetCategory = dbUser?.category || userCategory;
        if (op.targetType === 'CATEGORY' && targetCategory && op.category === targetCategory) {
          return true;
        }

        // 5. GROUP / CUSTOM_GROUP LEGACY
        if ((op.targetType as string) === 'GROUP' || op.targetType === 'CUSTOM_GROUP') {
          const targetCapital = Number(dbUser?.currentCapital || userCapital);
          if (targetCapital > 0 && Number(op.groupCapitalCop) === targetCapital) {
            if (!targetCategory || !op.category || op.category === targetCategory) {
              return true;
            }
          }
        }

        // 6. Fallback final: false
        return false;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  public async addDailyOperationAsync(
    cycleId: string,
    category: BitacoraCategory,
    groupCapitalCop: number,
    date: string,
    amountUsd: number,
    notes?: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal',
    targetUser?: UserProfile | null,
    targetTypeParam?: OperationTargetType,
    customAuthorizedUids?: string[],
    trmUsedParam?: number,
    trmSourceParam?: string,
    trmCapturedAtParam?: string
  ): Promise<{ success: boolean; totalUsd: number; operation: DailyGroupOperation; message: string }> {
    const cycle = this.getCycleById(cycleId);
    if (!cycle || cycle.status === 'CLOSED') {
      throw new Error('No se pueden registrar operaciones en un ciclo cerrado.');
    }
    if (isNaN(amountUsd) || amountUsd <= 0) {
      throw new Error('El monto operado en USD debe ser mayor a 0.');
    }

    // TRM_AUTHORITATIVE_SERVER_ONLY
    // La Cloud Function obtiene la TRM directamente
    // desde Dolar-Colombia.com.

    const targetType: OperationTargetType = targetTypeParam || (targetUser ? 'INDIVIDUAL' : 'CUSTOM_GROUP');
    const targetUserId = targetUser?.uid || targetUser?.id;

    const operationIntentId = crypto.randomUUID();

    const cleanNotes = (notes || '').trim();
    const rawFingerprintString = `${cycleId}_${category}_${groupCapitalCop}_${amountUsd}_${date || ''}_${targetType}_${targetUserId || ''}_${cleanNotes}`;

    let payloadFingerprint = '';
    try {
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawFingerprintString));
      payloadFingerprint = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      payloadFingerprint = `fp_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    }

    // Ejecución en Servidor (Cloud Function / Transacción Atómica Firestore)
    // CRÍTICO: NO se modifica `this.dailyOperations` manualmente en RAM antes de confirmar la nube.
    const serverRes = await firestoreService.executeAdminDailyOperation({
      action: 'CREATE',
      operationIntentId,
      payloadFingerprint,
      cycleId,
      category,
      groupCapitalCop,
      date,
      amountUsd,
      notes: cleanNotes,
      targetType,
      targetUserId,
      customAuthorizedUids,
    });

    const createdOp = serverRes.operation;
    const groupOps = this.getDailyOperations(cycleId, category, groupCapitalCop);
    const totalUsd = groupOps.reduce((sum, op) => sum + op.amountUsd, 0) + (groupOps.some(o => o.id === createdOp.id) ? 0 : createdOp.amountUsd);

    return {
      success: true,
      totalUsd,
      operation: createdOp,
      message: serverRes.message || 'Operación creada y guardada exitosamente en Firestore.',
    };
  }

  public addDailyOperation(
    cycleId: string,
    category: BitacoraCategory,
    groupCapitalCop: number,
    date: string,
    amountUsd: number,
    notes?: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal',
    targetUser?: UserProfile | null,
    targetTypeParam?: OperationTargetType,
    customAuthorizedUids?: string[]
  ): { success: boolean; totalUsd: number; operation: DailyGroupOperation; message: string } {
    throw new Error('Usa addDailyOperationAsync para asegurar la persistencia atómica en el servidor.');
  }

  public deleteDailyOperation(
    operationId: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): { success: boolean; totalUsd: number; message: string } {
    const opIndex = this.dailyOperations.findIndex((op) => op.id === operationId);
    if (opIndex < 0) {
      throw new Error('Operación diaria no encontrada.');
    }

    const op = this.dailyOperations[opIndex];
    const cycle = this.getCycleById(op.cycleId);
    if (!cycle || cycle.status === 'CLOSED') {
      throw new Error('No se pueden eliminar operaciones de un ciclo cerrado.');
    }

    this.dailyOperations.splice(opIndex, 1);
    firestoreService.deleteDailyOperation(operationId).catch((e) => console.warn('Error deleting op from Firestore:', e));

    // Recalcular total acumulado
    const remainingOps = this.getDailyOperations(op.cycleId, op.category, op.groupCapitalCop);
    const totalUsdAccumulated = remainingOps.reduce((sum, o) => sum + o.amountUsd, 0);

    if (totalUsdAccumulated > 0) {
      this.calculateGroup(op.cycleId, op.category, op.groupCapitalCop, totalUsdAccumulated, adminUid, adminName, true);
    } else {
      // Si no quedan operaciones, eliminar el cálculo del grupo y resultados de usuarios
      const calcId = `${op.cycleId}_${op.category}_${op.groupCapitalCop}`;
      const groupCalcIndex = this.groupCalculations.findIndex((g) => g.id === calcId);
      if (groupCalcIndex >= 0) {
        this.groupCalculations.splice(groupCalcIndex, 1);
      }
      this.userResults = this.userResults.filter(
        (r) => !(r.cycleId === op.cycleId && r.cycleCategory === op.category && r.groupCapitalCop === op.groupCapitalCop)
      );
      this.recalculateCycleMetrics();
    }

    this.addAuditLog({
      action: 'DAILY_OPERATION_DELETED',
      performedBy: adminUid,
      performedByName: adminName,
      cycleId: op.cycleId,
      targetEntity: operationId,
      details: {
        category: op.category,
        groupCapitalCop: op.groupCapitalCop,
        deletedAmountUsd: op.amountUsd,
        newTotalUsdAccumulated: totalUsdAccumulated,
      },
    });

    this.notify();

    return {
      success: true,
      totalUsd: totalUsdAccumulated,
      message: `Operación eliminada. Nuevo total acumulado: $${totalUsdAccumulated} USD.`,
    };
  }

  public updateDailyOperation(
    operationId: string,
    date: string,
    amountUsd: number,
    notes?: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): { success: boolean; totalUsd: number; message: string } {
    const op = this.dailyOperations.find((o) => o.id === operationId);
    if (!op) {
      throw new Error('Operación no encontrada.');
    }
    const cycle = this.getCycleById(op.cycleId);
    if (!cycle || cycle.status === 'CLOSED') {
      throw new Error('No se pueden editar operaciones en un ciclo cerrado.');
    }
    if (isNaN(amountUsd) || amountUsd <= 0) {
      throw new Error('El monto en USD debe ser mayor a 0.');
    }

    op.date = date || op.date;
    op.amountUsd = amountUsd;
    if (notes !== undefined) {
      op.notes = notes;
    }

    firestoreService.saveDailyOperation(op).catch((e) => console.warn('Error updating op in Firestore:', e));

    const groupOps = this.getDailyOperations(op.cycleId, op.category, op.groupCapitalCop);
    const totalUsdAccumulated = groupOps.reduce((sum, o) => sum + o.amountUsd, 0);

    this.calculateGroup(op.cycleId, op.category, op.groupCapitalCop, totalUsdAccumulated, adminUid, adminName, true);

    this.addAuditLog({
      action: 'DAILY_OPERATION_UPDATED',
      performedBy: adminUid,
      performedByName: adminName,
      cycleId: op.cycleId,
      targetEntity: operationId,
      details: {
        category: op.category,
        groupCapitalCop: op.groupCapitalCop,
        newAmountUsd: amountUsd,
        totalUsdAccumulated,
      },
    });

    this.notify();

    return {
      success: true,
      totalUsd: totalUsdAccumulated,
      message: `Operación actualizada. Total acumulado: $${totalUsdAccumulated} USD.`,
    };
  }

  public resetDailyOperations(
    cycleId: string,
    category: BitacoraCategory,
    groupCapitalCop: number,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): { success: boolean; message: string } {
    const cycle = this.getCycleById(cycleId);
    if (!cycle || cycle.status === 'CLOSED') {
      throw new Error('No se pueden reiniciar operaciones de un ciclo cerrado.');
    }

    // Find ops to delete from Firestore
    const opsToDelete = this.dailyOperations.filter(
      (op) => op.cycleId === cycleId && op.category === category && Number(op.groupCapitalCop) === Number(groupCapitalCop)
    );
    opsToDelete.forEach((op) => {
      firestoreService.deleteDailyOperation(op.id).catch(() => {});
    });

    // Remove all operations for this group in this cycle
    this.dailyOperations = this.dailyOperations.filter(
      (op) => !(op.cycleId === cycleId && op.category === category && Number(op.groupCapitalCop) === Number(groupCapitalCop))
    );

    // Remove group calculations and user results
    const calcId = `${cycleId}_${category}_${groupCapitalCop}`;
    const groupCalcIndex = this.groupCalculations.findIndex((g) => g.id === calcId);
    if (groupCalcIndex >= 0) {
      this.groupCalculations.splice(groupCalcIndex, 1);
    }
    this.userResults = this.userResults.filter(
      (r) => !(r.cycleId === cycleId && r.cycleCategory === category && Number(r.groupCapitalCop) === Number(groupCapitalCop))
    );

    this.recalculateCycleMetrics();

    this.addAuditLog({
      action: 'CALCULATION_CORRECTED',
      performedBy: adminUid,
      performedByName: adminName,
      cycleId,
      targetEntity: calcId,
      reason: 'Reiniciar saldo de operaciones acumuladas del grupo a $0',
      details: {
        category,
        groupCapitalCop,
        resetToZero: true,
      },
    });

    this.notify();

    return {
      success: true,
      message: `El saldo y las operaciones del grupo fueron reiniciadas a $0 exitosamente.`,
    };
  }
  public async consolidateDailyOperations(
    cycleId: string,
    category: BitacoraCategory,
    groupCapitalCop: number,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): Promise<{
    success: boolean;
    consolidatedUsd: number;
    totalUsdAccumulated: number;
    message: string;
  }> {

    const cycle =
      this.getCycleById(cycleId);

    if (!cycle || cycle.status === 'CLOSED') {
      throw new Error(
        'No se pueden consolidar operaciones de un ciclo cerrado.'
      );
    }

    const activeOps =
      this.dailyOperations.filter(
        (op) =>
          op.cycleId === cycleId &&
          op.category === category &&
          Number(op.groupCapitalCop) ===
            Number(groupCapitalCop) &&
          op.status !== 'CONSOLIDATED'
      );

    if (activeOps.length === 0) {
      throw new Error(
        'No hay operaciones activas pendientes en este grupo.'
      );
    }

    const requestId =
      globalThis.crypto?.randomUUID?.() ||
      `group_close_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`;

    const result =
      await firestoreService
        .adminCloseDailyOperationsCallable({
          scope: 'GROUP',
          cycleId,
          category,
          groupCapitalCop,
          clientRequestId:
            requestId,
        });

    const affectedIds =
      new Set(
        result.operationIds || []
      );

    const now =
      new Date().toISOString();

    // Optimistic LOCAL update ?nicamente
    // DESPU?S de confirmaci?n del servidor.
    this.dailyOperations.forEach(
      (op) => {
        if (affectedIds.has(op.id)) {
          op.status =
            'CONSOLIDATED';

          op.consolidatedAt =
            op.consolidatedAt ||
            now;
        }
      }
    );

    this.notify();

    const totalUsdAccumulated =
      this.getDailyOperations(
        cycleId,
        category,
        groupCapitalCop
      ).reduce(
        (sum, op) =>
          sum +
          Number(op.amountUsd || 0),
        0
      );

    return {
      success:
        result.success,

      consolidatedUsd:
        Number(
          result.totalUsdClosed || 0
        ),

      totalUsdAccumulated,

      message:
        result.message,
    };
  }
  private resolveNotificationRecipientsFromOperation(
    operation: DailyGroupOperation,
    cycleId: string
  ): UserProfile[] {

    const uids =
      Array.from(
        new Set(
          (operation.authorizedUids || [])
            .filter(
              (uid): uid is string =>
                typeof uid === 'string' &&
                uid.trim().length > 0
            )
            .map(
              (uid) =>
                uid.trim()
            )
        )
      );

    const activeUsers =
      this.getActiveUsers();

    // Solo compatibilidad legacy.
    if (uids.length === 0) {
      return this.resolveOperationRecipients(
        operation,
        activeUsers
      );
    }

    const liveMap =
      new Map<string, UserProfile>();

    activeUsers.forEach((user) => {

      [
        user.uid,
        user.id,
        user.userCode,
        user.email?.toLowerCase(),
      ]
        .filter(Boolean)
        .forEach((key) =>
          liveMap.set(
            String(key).trim(),
            user
          )
        );
    });

    const snapshotMap =
      new Map<string, any>();

    this.getUserResults(cycleId)
      .forEach((result) => {

        [
          result.userUid,
          result.userId,
          result.userCode,
          result.email?.toLowerCase(),
        ]
          .filter(Boolean)
          .forEach((key) =>
            snapshotMap.set(
              String(key).trim(),
              result
            )
          );
      });

    const recipients =
      new Map<string, UserProfile>();

    uids.forEach((uid) => {

      const live =
        liveMap.get(uid);

      if (live) {
        recipients.set(
          String(
            live.uid ||
            live.id
          ),
          live
        );
        return;
      }

      const result =
        snapshotMap.get(uid);

      if (!result) {
        console.warn(
          '[NotificationRecipients] UID no resuelto:',
          uid
        );
        return;
      }

      const capital =
        Number(
          result.currentCycleCapitalCop ||
          result.groupCapitalCop ||
          result.cycleCapitalCop ||
          operation.groupCapitalCop ||
          0
        );

      const profile = {
        id:
          result.userId ||
          uid,

        uid:
          result.userUid ||
          uid,

        userCode:
          result.userCode ||
          '',

        fullName:
          result.userName ||
          'Inversionista',

        email:
          result.email ||
          '',

        phone: '',
        role: 'USER',
        status: 'ACTIVE',

        currentCapital:
          capital,

        currency: 'COP',

        category:
          result.cycleCategory ||
          operation.category,

        userPercentage:
          result.userPercentage,

        adminPercentage:
          result.adminPercentage,

        paymentMethod: '',
        paymentDetails: '',

        createdAt:
          result.calculatedAt ||
          '',

        entryDate: '',
      } as UserProfile;

      recipients.set(
        String(profile.uid),
        profile
      );
    });

    return Array.from(
      recipients.values()
    );
  }
  public notifyAllActiveDailyOperations(
    cycleId: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): {
    success: boolean;
    sentCount: number;
    totalUsdNotified: number;
    message: string;
  } {

    const cycle =
      this.getCycleById(cycleId) ||
      this.getActiveCycle();

    if (!cycle) {
      throw new Error(
        'No se encontr? el ciclo.'
      );
    }

    // La condici?n de jornada global es globalClosedAt,
    // NO status === ACTIVE.
    const pendingOps =
      this.dailyOperations.filter(
        (op) =>
          op.cycleId === cycleId &&
          !(op as any).globalClosedAt
      );

    if (pendingOps.length === 0) {
      throw new Error(
        'No hay operaciones pendientes por notificar.'
      );
    }

    const now =
      new Date().toISOString();

    let totalSentCount = 0;
    let totalUsdNotified = 0;

    const notificationsToSave:
      NotificationItem[] = [];

    pendingOps.forEach((op) => {

      const recipients =
        this.resolveNotificationRecipientsFromOperation(
          op,
          cycleId
        );

      recipients.forEach((user) => {

        if (
          user.role === 'ADMIN' ||
          user.userCode?.startsWith('ADM')
        ) {
          return;
        }

        const opUsd =
          Number(op.amountUsd || 0);

        const opTrm =
          Number(op.trmUsed);

        if (
          !Number.isFinite(opTrm) ||
          opTrm <= 0
        ) {
          throw new Error(
            'TRM_OPERATION_MISSING: La operaci?n no contiene una TRM server-side v?lida.'
          );
        }

        const rawUserPct =
          user.userPercentage ??
          75;

        const rawAdminPct =
          user.adminPercentage ??
          25;

        const userPct =
          rawUserPct <= 1
            ? rawUserPct * 100
            : rawUserPct;

        const adminPct =
          rawAdminPct <= 1
            ? rawAdminPct * 100
            : rawAdminPct;

        const calc =
          calculateUserMonthlyResult(
            opUsd,
            opTrm,
            userPct,
            adminPct
          );

        const recipientUid =
          user.uid ||
          user.id;

        const notifId =
          `notif_op_${op.id}_${recipientUid}`;

        const tradeName =
          resolveTradeNotificationName(
            user
          );

        const formattedUsd =
          `+$${Math.abs(opUsd).toFixed(2)} USD`;

        const formattedProfit =
          `+$${Math.abs(
            calc.userProfitCop
          ).toLocaleString(
            'es-CO'
          )} COP`;

        const notification:
          NotificationItem = {

          id:
            notifId,

          userId:
            user.id,

          userUid:
            user.uid,

          userCode:
            user.userCode,

          userEmail:
            user.email,

          userName:
            user.fullName,

          cycleId,

          type:
            'SYSTEM',

          title:
            `${opUsd >= 0 ? '📈' : '📉'} Operación Registrada: ${formattedUsd}`,

          message:
            `Hola ${tradeName}, se ejecutó una operación de trading por ${formattedUsd} el ${
              op.date ||
              'día de hoy'
            } en tu Bitácora ${
              user.category ||
              op.category
            }. Tu resultado para esta operación es de ${formattedProfit}.`,

          payload: {
            cycleId,

            operationId:
              op.id,

            usdAmount:
              opUsd,

            copAmount:
              calc.grossCop,

            userProfitCop:
              calc.userProfitCop,

            userProfitUsd:
              calc.userProfitUsd,

            trmUsed:
              opTrm,

            category:
              user.category ||
              op.category,

            groupCapitalCop:
              Number(
                op.groupCapitalCop
              ),

            userEmail:
              user.email,

            userUid:
              user.uid,
          },

          isRead:
            false,

          sentAt:
            now,

          readAt:
            null,
        };

        const index =
          this.notifications
            .findIndex(
              (n) =>
                n.id === notifId
            );

        if (index >= 0) {
          this.notifications[
            index
          ] = notification;

        } else {
          this.notifications.push(
            notification
          );
        }

        notificationsToSave.push(
          notification
        );

        totalSentCount++;
        totalUsdNotified +=
          opUsd;
      });
    });

    if (
      notificationsToSave.length >
      0
    ) {
      firestoreService
        .saveNotificationsBatch(
          notificationsToSave
        )
        .catch((error) =>
          console.warn(
            'Error guardando notificaciones globales:',
            error
          )
        );
    }

    this.notify();

    return {
      success: true,

      sentCount:
        totalSentCount,

      totalUsdNotified,

      message:
        `? ${totalSentCount} notificaciones generadas para las operaciones pendientes del Cierre Global.`,
    };
  }
  public async consolidateAllDailyOperations(
    cycleId: string,
    shouldNotify: boolean = false,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): Promise<{
    success: boolean;
    consolidatedOpsCount: number;
    totalUsdConsolidated: number;
    notificationsSent: number;
    message: string;
  }> {

    const cycle =
      this.getCycleById(cycleId);

    if (!cycle || cycle.status === 'CLOSED') {
      throw new Error(
        'No se pueden cerrar operaciones de un ciclo cerrado.'
      );
    }

    const pendingOps =
      this.dailyOperations.filter(
        (op) =>
          op.cycleId === cycleId &&
          !(op as any).globalClosedAt
      );

    if (pendingOps.length === 0) {
      throw new Error(
        'No hay operaciones pendientes del Cierre Global.'
      );
    }

    let notificationsSent = 0;

    if (shouldNotify) {
      try {

        const notificationResult =
          this.notifyAllActiveDailyOperations(
            cycleId,
            adminUid,
            adminName
          );

        notificationsSent =
          notificationResult.sentCount;

      } catch (error) {

        console.warn(
          '[GlobalClose] Error en notificaciones:',
          error
        );
      }
    }

    const requestId =
      globalThis.crypto?.randomUUID?.() ||
      `global_close_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`;

    const result =
      await firestoreService
        .adminCloseDailyOperationsCallable({
          scope:
            'GLOBAL',

          cycleId,

          clientRequestId:
            requestId,
        });

    const affected =
      new Set(
        result.operationIds || []
      );

    const now =
      new Date().toISOString();

    // Actualizaci?n local SOLO despu?s
    // de confirmaci?n del servidor.
    this.dailyOperations.forEach(
      (op) => {

        if (!affected.has(op.id)) {
          return;
        }

        op.status =
          'CONSOLIDATED';

        op.consolidatedAt =
          op.consolidatedAt ||
          now;

        (op as any).globalClosureId =
          result.closureId;

        (op as any).globalClosedAt =
          now;
      }
    );

    this.notify();

    return {
      success:
        result.success,

      consolidatedOpsCount:
        Number(
          result.closedOperationsCount ||
          0
        ),

      totalUsdConsolidated:
        Number(
          result.totalUsdClosed ||
          0
        ),

      notificationsSent,

      message:
        `${result.message}${
          notificationsSent > 0
            ? ` Se generaron ${notificationsSent} notificaciones.`
            : ''
        }`,
    };
  }


  private recalculateCycleMetrics() {
    this.cycles = this.cycles.map((cycle) => {
      const activeUsers = this.getActiveUsers();
      const userResults = this.userResults.filter((r) => r.cycleId === cycle.cycleId);
      const groupCalcs = this.groupCalculations.filter((g) => g.cycleId === cycle.cycleId && g.status === 'CALCULATED');

      const totalManagedCapital = activeUsers.reduce((sum, u) => sum + u.currentCapital, 0);
      const totalGrossUsd = userResults.reduce((sum, r) => sum + r.totalUsdOperated, 0);
      const totalGrossCop = userResults.reduce((sum, r) => sum + r.totalGrossCop, 0);
      const totalUsersProfitCop = userResults.reduce((sum, r) => sum + r.userProfitCop, 0);
      const totalAdminCommissionCop = userResults.reduce((sum, r) => sum + r.adminCommissionCop, 0);

      // Total de grupos
      const categoryGroups = this.getCategoryGroups(cycle.cycleId);
      const totalGroupsCount = categoryGroups.AZUL.length + categoryGroups.VERDE.length + categoryGroups.NEGRA.length;

      return {
        ...cycle,
        totalManagedCapital,
        totalUsersActive: activeUsers.length,
        calculatedUsersCount: userResults.length,
        totalGroupsCount: Math.max(totalGroupsCount, groupCalcs.length),
        calculatedGroupsCount: groupCalcs.length,
        totalGrossUsd,
        totalGrossCop,
        totalUsersProfitCop,
        totalAdminCommissionCop,
      };
    });
  }

  // MUTACIONES / OPERACIONES CRÍTICAS

  /**
   * CALCULAR GRUPO (Regla V2.1)
   * Aplica el USD COMPLETO a cada usuario perteneciente a ese grupo de capital exacto.
   * Genera registros deterministas individuales en cycleUserResults.
   * Idempotente: si ya existe, se previene duplicación.
   */
  public calculateGroup(
    cycleId: string,
    category: BitacoraCategory,
    groupCapitalCop: number,
    totalUsdApplied: number,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal',
    allowOverwrite: boolean = false,
    targetUserId?: string
  ): { success: boolean; affectedUsersCount: number; message: string } {
    const cycle = this.getCycleById(cycleId);
    if (!cycle) {
      throw new Error(`El ciclo ${cycleId} no existe.`);
    }
    if (cycle.status === 'CLOSED') {
      throw new Error(`El ciclo ${cycleId} se encuentra CERRADO. No se permiten cálculos.`);
    }

    if (totalUsdApplied <= 0 || isNaN(totalUsdApplied)) {
      throw new Error('El total USD debe ser un número positivo mayor a 0.');
    }

    const trmUsed = cycle.trmApplied || this.config.trmConfigured;
    const calcId = `${cycleId}_${category}_${groupCapitalCop}`;

    // Obtener usuarios del grupo (estrictamente por capital exacto o por ID de usuario específico)
    const usersInGroup = targetUserId
      ? this.getActiveUsers().filter(
          (u) => u.id === targetUserId || u.uid === targetUserId || u.userCode === targetUserId
        )
      : this.getActiveUsers().filter(
          (u) => Number(u.currentCapital) === Number(groupCapitalCop)
        );

    if (usersInGroup.length === 0) {
      throw new Error(`No hay usuarios activos en el grupo ${category} de $${groupCapitalCop.toLocaleString('es-CO')} COP.`);
    }

    // Verificar si ya existe para asegurar idempotencia
    const existingGroupIndex = this.groupCalculations.findIndex((g) => g.id === calcId);
    if (!allowOverwrite && existingGroupIndex >= 0 && this.groupCalculations[existingGroupIndex].status === 'CALCULATED') {
      throw new Error(`Este grupo ya fue calculado previamente. Si deseas cambiar el valor de USD $${this.groupCalculations[existingGroupIndex].totalUsdApplied} a USD $${totalUsdApplied}, usa la acción de Corrección o agrega una nueva operación diaria.`);
    }

    // Calcular para cada usuario
    let totalGroupCop = 0;
    let totalGroupUserProfit = 0;
    let totalGroupAdminCommission = 0;

    const newResults: CycleUserResult[] = [];

    usersInGroup.forEach((user) => {
      const calc = calculateUserMonthlyResult(
        totalUsdApplied,
        trmUsed,
        user.userPercentage,
        user.adminPercentage
      );

      totalGroupCop += calc.grossCop;
      totalGroupUserProfit += calc.userProfitCop;
      totalGroupAdminCommission += calc.adminCommissionCop;

      const userResultId = `${cycleId}_${user.id}`;
      const userResult: CycleUserResult = {
        id: userResultId,
        cycleId,
        userId: user.id,
        userUid: user.uid,
        userCode: user.userCode,
        userName: user.fullName,
        email: user.email,
        cycleCapitalCop: user.currentCapital,
        cycleCategory: category,
        groupCapitalCop,
        totalUsdOperated: totalUsdApplied,
        trmUsed,
        totalGrossCop: calc.grossCop,
        userPercentage: user.userPercentage,
        adminPercentage: user.adminPercentage,
        userProfitCop: calc.userProfitCop,
        userProfitUsd: calc.userProfitUsd,
        adminCommissionCop: calc.adminCommissionCop,
        adminCommissionUsd: calc.adminCommissionUsd,
        notificationStatus: 'PENDING',
        notificationSentAt: null,
        calculatedAt: new Date().toISOString(),
        calculatedBy: adminName,
        isCycleClosed: false,
      };

      // Reemplazar o insertar en userResults
      const existingUserResultIndex = this.userResults.findIndex((r) => r.id === userResultId);
      if (existingUserResultIndex >= 0) {
        this.userResults[existingUserResultIndex] = userResult;
      } else {
        this.userResults.push(userResult);
      }

      newResults.push(userResult);
    });

    const groupCalculation: CycleGroupCalculation = {
      id: calcId,
      cycleId,
      category,
      groupCapitalCop,
      usersCount: usersInGroup.length,
      userIds: usersInGroup.map((u) => u.id),
      totalUsdApplied,
      trmUsed,
      totalCopPerUser: totalUsdApplied * trmUsed,
      totalGroupCop,
      totalUsersProfitCop: totalGroupUserProfit,
      totalAdminCommissionCop: totalGroupAdminCommission,
      status: 'CALCULATED',
      calculatedAt: new Date().toISOString(),
      calculatedBy: adminName,
    };

    if (existingGroupIndex >= 0) {
      this.groupCalculations[existingGroupIndex] = groupCalculation;
    } else {
      this.groupCalculations.push(groupCalculation);
    }

    // Persistir a Firestore para sincronización en tiempo real entre todos los dispositivos
    firestoreService.saveGroupCalculation(groupCalculation).catch((e) => console.warn('Error saving groupCalc to Firestore:', e));
    newResults.forEach((res) => {
      firestoreService.saveUserResult(res).catch((e) => console.warn('Error saving userResult to Firestore:', e));
    });

    // Auditoría
    this.addAuditLog({
      action: 'GROUP_CALCULATED',
      performedBy: adminUid,
      performedByName: adminName,
      cycleId,
      targetEntity: calcId,
      details: {
        category,
        groupCapitalCop,
        usersCount: usersInGroup.length,
        totalUsdApplied,
        trmUsed,
        totalGroupCop,
      },
    });

    this.recalculateCycleMetrics();
    this.notify();

    return {
      success: true,
      affectedUsersCount: usersInGroup.length,
      message: `Grupo ${category} ($${groupCapitalCop.toLocaleString('es-CO')}) calculado con éxito para ${usersInGroup.length} usuarios a USD $${totalUsdApplied}.`,
    };
  }

  /**
   * CORREGIR CÁLCULO DE GRUPO (Regla V2.1)
   * Trazabilidad completa: anterior, nuevo, diferencia, motivo y auditoría.
   */
  public correctGroupCalculation(
    cycleId: string,
    category: BitacoraCategory,
    groupCapitalCop: number,
    newUsdAmount: number,
    reason: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): { success: boolean; message: string } {
    const cycle = this.getCycleById(cycleId);
    if (!cycle || cycle.status === 'CLOSED') {
      throw new Error('No se pueden corregir cálculos en un ciclo cerrado.');
    }

    if (!reason || reason.trim().length < 5) {
      throw new Error('Es obligatorio ingresar un motivo claro para la corrección (mínimo 5 caracteres).');
    }

    const calcId = `${cycleId}_${category}_${groupCapitalCop}`;
    const groupCalcIndex = this.groupCalculations.findIndex((g) => g.id === calcId);
    if (groupCalcIndex < 0) {
      throw new Error('El grupo no ha sido calculado previamente. Utiliza la opción Calcular.');
    }

    const prevCalc = this.groupCalculations[groupCalcIndex];
    const previousUsd = prevCalc.totalUsdApplied;
    const differenceUsd = newUsdAmount - previousUsd;
    const trmUsed = prevCalc.trmUsed;

    const usersInGroup = this.getActiveUsers().filter(
      (u) => Number(u.currentCapital) === Number(groupCapitalCop)
    );

    let totalGroupCop = 0;
    let totalGroupUserProfit = 0;
    let totalGroupAdminCommission = 0;

    usersInGroup.forEach((user) => {
      const calc = calculateUserMonthlyResult(
        newUsdAmount,
        trmUsed,
        user.userPercentage,
        user.adminPercentage
      );

      totalGroupCop += calc.grossCop;
      totalGroupUserProfit += calc.userProfitCop;
      totalGroupAdminCommission += calc.adminCommissionCop;

      const userResultId = `${cycleId}_${user.id}`;
      const existingResult = this.userResults.find((r) => r.id === userResultId);

      const historyEntry = {
        previousUsd,
        newUsd: newUsdAmount,
        updatedAt: new Date().toISOString(),
        reason,
      };

      const updatedResult: CycleUserResult = {
        id: userResultId,
        cycleId,
        userId: user.id,
        userCode: user.userCode,
        userName: user.fullName,
        cycleCapitalCop: user.currentCapital,
        cycleCategory: category,
        groupCapitalCop,
        totalUsdOperated: newUsdAmount,
        trmUsed,
        totalGrossCop: calc.grossCop,
        userPercentage: user.userPercentage,
        adminPercentage: user.adminPercentage,
        userProfitCop: calc.userProfitCop,
        userProfitUsd: calc.userProfitUsd,
        adminCommissionCop: calc.adminCommissionCop,
        adminCommissionUsd: calc.adminCommissionUsd,
        notificationStatus: existingResult?.notificationStatus === 'SENT' ? 'SENT' : 'PENDING',
        notificationSentAt: existingResult?.notificationSentAt || null,
        calculatedAt: new Date().toISOString(),
        calculatedBy: adminName,
        isCycleClosed: false,
        isCorrected: true,
        correctionHistory: [
          ...(existingResult?.correctionHistory || []),
          historyEntry,
        ],
      };

      const index = this.userResults.findIndex((r) => r.id === userResultId);
      if (index >= 0) {
        this.userResults[index] = updatedResult;
      }
    });

    const updatedGroupCalc: CycleGroupCalculation = {
      ...prevCalc,
      totalUsdApplied: newUsdAmount,
      totalCopPerUser: newUsdAmount * trmUsed,
      totalGroupCop,
      totalUsersProfitCop: totalGroupUserProfit,
      totalAdminCommissionCop: totalGroupAdminCommission,
      calculatedAt: new Date().toISOString(),
      calculatedBy: adminName,
      history: [
        ...(prevCalc.history || []),
        {
          previousUsd,
          newUsd: newUsdAmount,
          differenceUsd,
          updatedAt: new Date().toISOString(),
          updatedBy: adminName,
          reason,
        },
      ],
    };

    this.groupCalculations[groupCalcIndex] = updatedGroupCalc;

    this.addAuditLog({
      action: 'CALCULATION_CORRECTED',
      performedBy: adminUid,
      performedByName: adminName,
      cycleId,
      targetEntity: calcId,
      previousValue: previousUsd,
      newValue: newUsdAmount,
      difference: differenceUsd,
      reason,
      details: {
        category,
        groupCapitalCop,
        usersAffected: usersInGroup.length,
      },
    });

    this.recalculateCycleMetrics();
    this.notify();

    return {
      success: true,
      message: `Corrección aplicada con éxito. Grupo ajustado de USD $${previousUsd} a USD $${newUsdAmount} (${usersInGroup.length} usuarios actualizados).`,
    };
  }

  /**
   * ENVIAR NOTIFICACIONES PERSONALIZADAS (Regla V2.1)
   * Solo habilitado si el 100% de usuarios activos están calculados.
   * Genera mensaje personalizado con el monto exacto según el split individual.
   */
  public sendCycleNotifications(
    cycleId: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): { success: boolean; sentCount: number; message: string } {
    const cycle = this.getCycleById(cycleId);
    if (!cycle) {
      throw new Error(`El ciclo ${cycleId} no existe.`);
    }

    // Cycle-close notifications are automatic for modern cycles.
    // This legacy method must never compete with adminCloseCycleCallable.
    if (cycle.isLegacy !== true) {
      throw new Error(
        'Las notificaciones de cierre se generan autom\u00e1ticamente al cerrar el ciclo con la TRM definitiva.'
      );
    }

    const activeUsers = this.getActiveUsers();
    const userResults = this.getUserResults(cycleId);

    // Validación estricta: todos los usuarios activos deben tener resultado
    const missingUsers = activeUsers.filter((u) => !userResults.some((r) => r.userId === u.id));
    if (missingUsers.length > 0) {
      const names = missingUsers.map((u) => `${u.fullName} (${u.userCode})`).join(', ');
      throw new Error(`No se pueden enviar las notificaciones. Faltan ${missingUsers.length} usuario(s) por calcular: ${names}`);
    }

    let sentCount = 0;
    const now = new Date().toISOString();

    // Notificar exclusivamente a usuarios que son inversionistas (NO administradores)
    const nonAdminResults = userResults.filter((res) => {
      const user = this.getUserById(res.userId) || this.getUserByCode(res.userCode);
      if (!user) return true;
      const isAdmin =
        user.role === 'ADMIN' ||
        user.userCode?.startsWith('ADM') ||
        user.id === 'admin_root_uid' ||
        user.id === 'usr_admin';

      return (
        !isAdmin ||
        user.participatesInTrading === true
      );
    });

    nonAdminResults.forEach((res) => {
      // Formato personalizado según el split individual
      const formattedUsd = `$${res.totalUsdOperated.toFixed(2)}`;
      const formattedCop = `$${res.totalGrossCop.toLocaleString('es-CO')} COP`;
      const formattedProfit = `$${res.userProfitCop.toLocaleString('es-CO')} COP`;

      const notification: NotificationItem = {
        id: `notif_${cycleId}_${res.userId}_${Date.now()}`,
        userId: res.userId,
        userCode: res.userCode,
        userName: res.userName,
        cycleId,
        type: 'MONTHLY_CLOSURE',
        title: 'Tu operación mensual ya está disponible',
        message: `Tu operación del mes de ${cycle.name} fue de USD ${formattedUsd}. Tu resultado convertido es de ${formattedCop} y tu ganancia correspondiente es de ${formattedProfit}.`,
        payload: {
          cycleId,
          usdAmount: res.totalUsdOperated,
          copAmount: res.totalGrossCop,
          userProfitCop: res.userProfitCop,
          userPercentage: res.userPercentage,
          trmUsed: res.trmUsed,
        },
        isRead: false,
        sentAt: now,
        readAt: null,
      };

      this.notifications.push(notification);

      // Actualizar estado en userResult
      res.notificationStatus = 'SENT';
      res.notificationSentAt = now;
      sentCount++;
    });

    // Marcar ciclo
    const cycleIndex = this.cycles.findIndex((c) => c.cycleId === cycleId);
    if (cycleIndex >= 0) {
      this.cycles[cycleIndex].notificationsSent = true;
      this.cycles[cycleIndex].notificationsSentAt = now;
    }

    if (nonAdminResults.length > 0) {
      firestoreService.saveNotificationsBatch(this.notifications.slice(-sentCount)).catch((e) => console.warn('Error batch saving cycle notifs:', e));
    }

    this.addAuditLog({
      action: 'NOTIFICATIONS_DISPATCHED',
      performedBy: adminUid,
      performedByName: adminName,
      cycleId,
      targetEntity: cycleId,
      details: { sentCount, cycleName: cycle.name },
    });

    this.notify();

    return {
      success: true,
      sentCount,
      message: `Se enviaron exitosamente ${sentCount} notificaciones personalizadas para el ciclo ${cycle.name}.`,
    };
  }

  /**
   * Enviar notificación de operación diaria a los destinatarios autorizados para esa operación.
   */
  public sendDailyGroupNotification(
    cycleId: string,
    category: BitacoraCategory,
    groupCapitalCop: number,
    operationUsd: number,
    date: string,
    notes?: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal',
    operationId?: string,
    operation?: DailyGroupOperation
  ): { success: boolean; sentCount: number; message: string } {
    const cycle = this.getCycleById(cycleId) || this.getActiveCycle();
    const targetOp: DailyGroupOperation =
      operation ||
      (operationId ? this.dailyOperations.find((op) => op.id === operationId) : undefined) ||
      ({
        id: operationId || `op_${Date.now()}`,
        cycleId,
        category,
        groupCapitalCop,
        date,
        amountUsd: operationUsd,
        notes,
        createdAt: new Date().toISOString(),
        createdBy: adminName,
        targetType: 'CUSTOM_GROUP',
      } as DailyGroupOperation);

    const trm = targetOp.trmUsed || cycle.closingTrm || (cycle.isLegacy ? (cycle.trmApplied || 0) : 0);

    const activeUsers = this.getActiveUsers();
    const recipients = this.resolveOperationRecipients(targetOp, activeUsers);

    if (recipients.length === 0) {
      console.warn('[DEV] sendDailyGroupNotification: No se encontraron destinatarios autorizados para la operación', targetOp.id);
      return {
        success: true,
        sentCount: 0,
        message: 'No hay destinatarios autorizados para esta operación.',
      };
    }

    let sentCount = 0;
    const now = new Date().toISOString();
    const notificationsToSave: NotificationItem[] = [];

    recipients.forEach((user) => {
      const isAdmin =
        user.role === 'ADMIN' ||
        user.userCode?.startsWith('ADM');

      if (
        isAdmin &&
        user.participatesInTrading !== true
      ) {
        return;
      }

      const split =
        getEffectiveFinancialSplit(user);

      const userPct =
        split.userPercentage;

      const adminPct =
        split.adminPercentage;

      const calc =
        calculateUserMonthlyResult(
          operationUsd,
          trm,
          userPct,
          adminPct
        );

      const isPositive = operationUsd >= 0;
      const signStr = isPositive ? '+' : '-';
      const formattedUsd = `${signStr}$${Math.abs(operationUsd).toFixed(2)} USD`;
      const formattedProfitCop = `${isPositive ? '+' : '-'}$${Math.abs(calc.userProfitCop).toLocaleString('es-CO')} COP`;

      const notifId = targetOp.id ? `notif_op_${targetOp.id}_${user.uid || user.id}` : `notif_daily_${Date.now()}_${user.id}_${Math.random().toString(36).substring(2, 6)}`;

      const tradeName = resolveTradeNotificationName(user);

      const notif: NotificationItem = {
        id: notifId,
        userId: user.id,
        userUid: user.uid,
        userCode: user.userCode,
        userEmail: user.email,
        userName: user.fullName,
        cycleId,
        type: 'SYSTEM',
        title: `${isPositive ? '📈' : '📉'} Operación Diaria: ${formattedUsd}`,
        message: `Hola ${tradeName}, se ejecutó una operación de trading por ${formattedUsd} el ${date}. Tu resultado para esta operación es de ${formattedProfitCop}.`,
        payload: {
          cycleId,
          operationId: targetOp.id,
          usdAmount: operationUsd,
          copAmount: calc.grossCop,
          userProfitCop: calc.userProfitCop,
          userProfitUsd: calc.userProfitUsd,
          trmUsed: trm,
          notes,
          category,
          groupCapitalCop,
          userEmail: user.email,
          userUid: user.uid,
        },
        isRead: false,
        sentAt: now,
        readAt: null,
      };

      const existingIndex = this.notifications.findIndex((n) => n.id === notifId);
      if (existingIndex >= 0) {
        this.notifications[existingIndex] = notif;
      } else {
        this.notifications.push(notif);
      }
      notificationsToSave.push(notif);

      sentCount++;
    });

    if (notificationsToSave.length > 0) {
      firestoreService.saveNotificationsBatch(notificationsToSave).catch((e) => console.warn('Error saving daily notifs:', e));
    }

    this.addAuditLog({
      action: 'DAILY_OPERATION_NOTIFIED',
      performedBy: adminUid,
      performedByName: adminName,
      cycleId,
      targetEntity: `${category}_${groupCapitalCop}`,
      details: {
        category,
        groupCapitalCop,
        operationUsd,
        date,
        sentCount,
      },
    });

    this.notify();

    return {
      success: true,
      sentCount,
      message: `Notificación de operación ($${operationUsd} USD) enviada exitosamente a los ${sentCount} inversionistas del grupo.`,
    };
  }

  /**
   * CERRAR CICLO (Regla V2.1 / Modelo TRM Definitiva)
   * Bloquea el ciclo contra modificaciones financieras y prepara histórico.
   * Recalcula la liquidación definitiva individual: finalGrossCop = totalUsd * closingTrm
   */
  public async closeCycle(
    cycleId: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal',
    closingTrmParam?: number,
    observedMarketTrmAtCloseParam?: number,
    adminNotes?: string
  ): Promise<{ success: boolean; message: string; closingTrm?: number }> {
    const cycleIndex = this.cycles.findIndex((c) => c.cycleId === cycleId);
    if (cycleIndex < 0) {
      throw new Error('Ciclo no encontrado.');
    }

    const cycle = this.cycles[cycleIndex];
    if (cycle.status === 'CLOSED') {
      throw new Error('El ciclo ya se encuentra cerrado.');
    }

    const activeUsers = this.getActiveUsers();
    const userResults = this.getUserResults(cycleId);
    if (userResults.length < activeUsers.length) {
      throw new Error(`No se puede cerrar el ciclo. Aún existen ${activeUsers.length - userResults.length} usuarios sin calcular.`);
    }

    // CLOSING_TRM_MANUAL_FINAL
    //
    // closingTrmParam es la TRM manual definitiva ingresada
    // por el SuperAdmin ?nicamente al cerrar el ciclo.
    // La TRM del mercado durante el ciclo contin?a siendo autom?tica.
    // observedMarketTrmAtCloseParam se conserva por retrocompatibilidad.
    const now = new Date().toISOString();

    // 1. INVOCAR CLOUD FUNCTION AUTORITATIVA DE SERVIDOR
    // Realiza el cierre en Firestore y aplica cada reinversión aprobada mediante Transacciones Atómicas en el backend
    const callResult = await firestoreService.adminCloseCycleCallable({
      cycleId,
      closingTrm: closingTrmParam,

      adminNotes:
        adminNotes ||
        `Cierre formal ejecutado por ${adminName}`,
    });

    if (!callResult.success || !callResult.cycleClosed) {
      if (callResult.code === 'CLOSURE_BLOCKED_PENDING_REQUESTS') {
        throw new Error(
          `No puedes cerrar este ciclo todavía.\nExisten solicitudes que requieren decisión o revisión administrativa antes del cierre:\n\n• Solicitudes pendientes: ${callResult.pendingCount || 0}\n• Solicitudes en revisión: ${callResult.needsReviewCount || 0}\n• Solicitudes aprobadas: ${callResult.approvedCount || 0}\n• Solicitudes rechazadas: ${callResult.rejectedCount || 0}\n\nPor favor aprueba, rechaza o resuelve todas las solicitudes antes de proceder con el cierre.`
        );
      }

      let conflictMsg = callResult.message;
      if (callResult.conflicts && callResult.conflicts.length > 0) {
        const details = callResult.conflicts
          .map((c: any) => {
            if (c.code === 'PROFIT_SNAPSHOT_MISMATCH') {
              return `[PROFIT_SNAPSHOT_MISMATCH] ${c.userCode || c.userUid}: Las ganancias de este inversionista cambiaron después de la solicitud. La solicitud debe revisarse nuevamente antes de cerrar el ciclo. (Ganancia al solicitar: $${Number(c.snapshotProfitCop).toLocaleString('es-CO')}, Ganancia actual: $${Number(c.currentProfitCop).toLocaleString('es-CO')}, Diferencia: $${Number(c.differenceCop).toLocaleString('es-CO')})`;
            }
            if (c.code === 'CAPITAL_SNAPSHOT_MISMATCH') {
              return `[CAPITAL_SNAPSHOT_MISMATCH] ${c.userCode || c.userUid}: Discrepancia de capital base. (Capital al solicitar: $${Number(c.snapshotCapitalCop).toLocaleString('es-CO')}, Capital actual: $${Number(c.actualCurrentCapitalCop).toLocaleString('es-CO')})`;
            }
            if (c.code === 'CYCLE_RESULT_NOT_FOUND') {
              return `[CYCLE_RESULT_NOT_FOUND] ${c.userCode || c.userUid}: ${c.message}`;
            }
            return `[${c.code}] ${c.userCode ? `${c.userCode}: ` : ''}${c.message}`;
          })
          .join('\n• ');
        conflictMsg = `${callResult.message}\n\nDetalles de conflictos detectados:\n• ${details}`;
      }
      throw new Error(conflictMsg);
    }

    const finalClosingTrm =
      Number(
        callResult.closingTrm
      );

    if (
      !Number.isFinite(
        finalClosingTrm
      ) ||
      finalClosingTrm <= 0
    ) {
      throw new Error(
        'SERVER_CLOSING_TRM_MISSING: El servidor no devolvió la TRM definitiva del cierre.'
      );
    }
    let totalGrossUsdAtClose = 0;
    let totalGrossCopAtClose = 0;
    let totalUsersProfitCopAtClose = 0;
    let totalAdminCommCopAtClose = 0;

    // 2. Liquidación Definitiva en cycleUserResults localmente
    // finalGrossCop = totalUsd * finalClosingTrm (Autoritativo y definitivo)
    this.userResults.forEach((r) => {
      if (r.cycleId === cycleId) {
        r.isCycleClosed = true;
        r.trmUsed = finalClosingTrm;

        const opUsd = Number(r.totalUsdOperated || 0);
        const finalGrossCop = opUsd * finalClosingTrm;
        const userPctRaw = r.userPercentage !== undefined ? r.userPercentage : 75;
        const adminPctRaw = r.adminPercentage !== undefined ? r.adminPercentage : 25;
        const uRatio = userPctRaw > 1 ? userPctRaw / 100 : userPctRaw;
        const aRatio = adminPctRaw > 1 ? adminPctRaw / 100 : adminPctRaw;

        const finalUserProfitCop = finalGrossCop * uRatio;
        const finalAdminCommCop = finalGrossCop * aRatio;
        const finalUserProfitUsd = opUsd * uRatio;
        const finalAdminCommUsd = opUsd * aRatio;

        r.totalGrossCop = finalGrossCop;
        r.userProfitCop = finalUserProfitCop;
        r.adminCommissionCop = finalAdminCommCop;
        r.userProfitUsd = finalUserProfitUsd;
        r.adminCommissionUsd = finalAdminCommUsd;

        totalGrossUsdAtClose += opUsd;
        totalGrossCopAtClose += finalGrossCop;
        totalUsersProfitCopAtClose += finalUserProfitCop;
        totalAdminCommCopAtClose += finalAdminCommCop;
      }
    });

    // 3. Sincronizar estado en memoria: las reinversiones aprobadas pasan a APPLIED
    const approvedReinvestments = this.reinvestments.filter(
      (r) => r.sourceCycleId === cycleId && (r.status === 'APPROVED' || r.status === 'APPLIED') && !r.appliedAtCycleClosure
    );

    approvedReinvestments.forEach((reinv) => {
      const user = this.getUserById(reinv.userId || reinv.userUid || '');
      if (user) {
        const previousCapital = user.currentCapital;
        const newCapital = reinv.projectedCapitalCop || reinv.newCapitalTargetCop;
        const newCategory = getCategoryForCapital(newCapital);

        user.currentCapital = newCapital;
        user.category = newCategory;

        reinv.status = 'APPLIED';
        reinv.appliedAtCycleClosure = true;
        reinv.appliedAt = now;

        this.addAuditLog({
          action: 'REINVESTMENT_APPLIED_AT_CLOSURE',
          performedBy: adminUid,
          performedByName: adminName,
          cycleId,
          targetEntity: reinv.id,
          previousValue: previousCapital,
          newValue: newCapital,
          details: {
            userCode: user.userCode,
            totalIncreaseCop: reinv.totalIncreaseCop || reinv.reinvestAmountCop,
            profitAppliedCop: reinv.profitAppliedCop,
            cashInjectionCop: reinv.cashInjectionCop,
            newCategory,
          },
        });
      }
    });

    this.cycles[cycleIndex] = {
      ...cycle,
      status: 'CLOSED',
      closedAt: now,
      closedBy: adminName,
      closingTrm: finalClosingTrm,
      closingTrmSetAt: now,
      closingTrmSetByUid: adminUid,
      closingTrmSetByName: adminName,
      observedMarketTrmAtClose: observedMarketTrmAtCloseParam || null,
      trmApplied: finalClosingTrm, // legacy
      totalGrossUsd: callResult.totalGrossUsd !== undefined ? callResult.totalGrossUsd : totalGrossUsdAtClose,
      totalGrossCop: callResult.totalGrossCop !== undefined ? callResult.totalGrossCop : totalGrossCopAtClose,
      totalUsersProfitCop: callResult.totalUsersProfitCop !== undefined ? callResult.totalUsersProfitCop : totalUsersProfitCopAtClose,
      totalAdminCommissionCop: callResult.totalAdminCommissionCop !== undefined ? callResult.totalAdminCommissionCop : totalAdminCommCopAtClose,
      isClosing: false,
      closingStartedAt: null,
      closingByUid: null,
      closingByName: null,
      closureAttemptId: null,
    };

    this.addAuditLog({
      action: 'CYCLE_CLOSED',
      performedBy: adminUid,
      performedByName: adminName,
      cycleId,
      targetEntity: cycleId,
      details: {
        closingTrm: finalClosingTrm,
        closingTrmSetAt: now,
        closingTrmSetByUid: adminUid,
        closingTrmSetByName: adminName,
        observedMarketTrmAtClose: observedMarketTrmAtCloseParam || null,
        totalGrossUsd: this.cycles[cycleIndex].totalGrossUsd,
        totalGrossCop: this.cycles[cycleIndex].totalGrossCop,
        totalUsersProfitCop: this.cycles[cycleIndex].totalUsersProfitCop,
        totalAdminCommissionCop: this.cycles[cycleIndex].totalAdminCommissionCop,
      },
    });

    this.notify();

    return {
      success: true,
      closingTrm: finalClosingTrm,
      message: `Ciclo ${cycle.name} cerrado exitosamente con TRM definitiva de $${finalClosingTrm.toLocaleString('es-CO')} COP. Las notificaciones personalizadas de cierre quedaron programadas autom\u00e1ticamente para los inversionistas.`,
    };
  }

  /**
   * DESBLOQUEAR LOCK DE CIERRE HUÉRFANO (SuperAdmin / Recovery)
   */
  public async unlockCycle(
    cycleId: string,
    expectedClosureAttemptId: string,
    confirmation: string,
    reason: string = 'Desbloqueo administrativo de lock de cierre',
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): Promise<{ success: boolean; message: string }> {
    const cycleIndex = this.cycles.findIndex((c) => c.cycleId === cycleId);
    if (cycleIndex < 0) {
      throw new Error('Ciclo no encontrado.');
    }

    const cycle = this.cycles[cycleIndex];
    const attemptToUnlock = expectedClosureAttemptId || cycle.closureAttemptId || '';

    await firestoreService.adminUnlockCycleCallable({
      cycleId,
      expectedClosureAttemptId: attemptToUnlock,
      confirmation,
      reason,
    });

    this.cycles[cycleIndex] = {
      ...cycle,
      isClosing: false,
      closingStartedAt: null,
      closingByUid: null,
      closingByName: null,
      closureAttemptId: null,
    };

    this.addAuditLog({
      action: 'CYCLE_UNLOCKED',
      performedBy: adminUid,
      performedByName: adminName,
      cycleId,
      targetEntity: cycleId,
      details: { reason, closureAttemptId: attemptToUnlock },
    });

    this.notify();

    return {
      success: true,
      message: `Lock de cierre del ciclo ${cycle.name} liberado exitosamente.`,
    };
  }

  /**
   * ACTUALIZAR TRM DEL CICLO
   */
  public updateCycleTrm(
    cycleId: string,
    newTrm: number,
    reason: string = 'Ajuste de TRM oficial del período',
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): { success: boolean; message: string } {
    const cycleIndex = this.cycles.findIndex((c) => c.cycleId === cycleId);
    if (cycleIndex < 0) {
      throw new Error('Ciclo no encontrado.');
    }
    const cycle = this.cycles[cycleIndex];
    if (cycle.status === 'CLOSED') {
      throw new Error('No se puede modificar la TRM de un ciclo cerrado.');
    }
    if (newTrm <= 0) {
      throw new Error('La TRM debe ser un valor mayor a cero.');
    }

    const previousTrm = cycle.trmApplied;
    this.cycles[cycleIndex] = {
      ...cycle,
      trmApplied: newTrm,
    };

    // Mantener sincronizada la configuración global
    if (cycleId === this.config.activeCycleId) {
      this.config.trmConfigured = newTrm;
      this.config.trmMode = 'AUTOMATIC';
      this.config.updatedAt = new Date().toISOString();
      this.config.updatedBy = adminName;
    }

    // Recalcular resultados existentes del ciclo con la nueva TRM
    this.groupCalculations.forEach((gc) => {
      if (gc.cycleId === cycleId) {
        gc.trmUsed = newTrm;
        gc.totalCopPerUser = gc.totalUsdApplied * newTrm;
        gc.totalGroupCop = gc.totalUsdApplied * newTrm * gc.usersCount;
        gc.totalUsersProfitCop = gc.totalGroupCop * 0.5;
        gc.totalAdminCommissionCop = gc.totalGroupCop * 0.5;
      }
    });

    this.userResults.forEach((ur) => {
      if (ur.cycleId === cycleId) {
        ur.trmUsed = newTrm;
        ur.totalGrossCop = ur.totalUsdOperated * newTrm;
        ur.userProfitCop = Math.round(ur.totalGrossCop * (ur.userPercentage / 100));
        ur.adminCommissionCop = Math.round(ur.totalGrossCop * (ur.adminPercentage / 100));
      }
    });

    this.recalculateCycleMetrics();

    this.addAuditLog({
      action: 'TRM_UPDATED',
      performedBy: adminUid,
      performedByName: adminName,
      cycleId,
      targetEntity: `TRM_${cycleId}`,
      details: {
        previousTrm,
        newTrm,
        reason,
      },
    });

    this.notify();

    return {
      success: true,
      message: `TRM actualizada exitosamente a $${newTrm.toLocaleString('es-CO')} COP para el ciclo ${cycle.name}.`,
    };
  }

  /**
   * REABRIR CICLO (Auditoría estricta y delegación autoritativa a Cloud Functions)
   */
  public async reopenCycle(
    cycleId: string,
    reason: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): Promise<{ success: boolean; message: string }> {
    const cycleIndex = this.cycles.findIndex((c) => c.cycleId === cycleId);
    if (cycleIndex < 0) {
      throw new Error('Ciclo no encontrado.');
    }
    if (!reason || reason.trim().length < 5) {
      throw new Error('Se requiere un motivo obligatorio de reapertura (mínimo 5 caracteres).');
    }

    const cycle = this.cycles[cycleIndex];

    // Delegación autoritativa al backend SuperAdmin
    await firestoreService.adminReopenCycleCallable({
      cycleId,
      reason: reason.trim(),
    });

    const now = new Date().toISOString();

    this.cycles[cycleIndex] = {
      ...cycle,
      status: 'REOPENED',
      reopenedAt: now,
      reopenedBy: adminName,
      reopenedByUid: adminUid,
      reopenReason: reason.trim(),
      reopenAudit: [
        ...(cycle.reopenAudit || []),
        {
          reopenedAt: now,
          reopenedBy: adminName,
          reason: reason.trim(),
        },
      ],
    };

    this.userResults.forEach((r) => {
      if (r.cycleId === cycleId) {
        r.isCycleClosed = false;
      }
    });

    this.addAuditLog({
      action: 'CYCLE_REOPENED',
      performedBy: adminUid,
      performedByName: adminName,
      cycleId,
      targetEntity: cycleId,
      reason: reason.trim(),
    });

    this.notify();

    return {
      success: true,
      message: `Ciclo ${cycle.name} reabierto para ajustes autorizados.`,
    };
  }

  /**
   * GESTIÓN DE USUARIOS
   */
  public createUser(
    userData: Omit<UserProfile, 'id' | 'userCode' | 'category' | 'createdAt'>,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): UserProfile {
    const existingCodes = this.users.map((u) => u.userCode);
    const userCode = generateUserCode(existingCodes);
    const category = getCategoryForCapital(userData.currentCapital);

    const newUser: UserProfile = {
      ...userData,
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(-4)}`,
      userCode,
      category,
      createdAt: new Date().toISOString(),
    };

    this.users.push(newUser);
    firestoreService.saveUser(newUser).catch((err) => console.warn('Error saving user in Firestore:', err));

    this.addAuditLog({
      action: 'USER_CREATED',
      performedBy: adminUid,
      performedByName: adminName,
      targetEntity: newUser.id,
      details: {
        fullName: newUser.fullName,
        userCode: newUser.userCode,
        capital: newUser.currentCapital,
        category: newUser.category,
        userPercentage: newUser.userPercentage,
      },
    });

    this.recalculateCycleMetrics();
    this.notify();

    return newUser;
  }

  public registerRemoteUserLocally(user: UserProfile) {
    const exists = this.users.some((u) => u.id === user.id || (user.uid && u.uid === user.uid));
    if (!exists) {
      this.users.push(user);
    } else {
      this.users = this.users.map((u) => (u.id === user.id || (user.uid && u.uid === user.uid)) ? user : u);
    }
    this.recalculateCycleMetrics();
    this.notify();
  }

  public updateUser(
    userId: string,
    updates: Partial<UserProfile>,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): UserProfile {
    const userIndex = this.users.findIndex((u) => u.id === userId);
    if (userIndex < 0) {
      throw new Error('Usuario no encontrado.');
    }

    const prevUser = this.users[userIndex];
    let newCategory = prevUser.category;

    if (updates.currentCapital !== undefined && updates.currentCapital !== prevUser.currentCapital) {
      newCategory = getCategoryForCapital(updates.currentCapital);
    }

    const updatedUser: UserProfile = {
      ...prevUser,
      ...updates,
      category: newCategory,
    };

    this.users[userIndex] = updatedUser;
    firestoreService.saveUser(updatedUser).catch((err) => console.warn('Error updating user in Firestore:', err));

    this.addAuditLog({
      action: 'USER_UPDATED',
      performedBy: adminUid,
      performedByName: adminName,
      targetEntity: userId,
      previousValue: prevUser,
      newValue: updatedUser,
      details: {
        userCode: updatedUser.userCode,
        fullName: updatedUser.fullName,
      },
    });

    this.recalculateCycleMetrics();
    this.notify();

    return updatedUser;
  }

  public async deleteUser(
    userId: string,
    confirmation: string
  ): Promise<UserProfile> {
    const userIndex = this.users.findIndex(
      (u) => u.id === userId
    );

    if (userIndex < 0) {
      throw new Error('Usuario no encontrado.');
    }

    const removedUser = this.users[userIndex];

    // Server-authoritative deletion.
    // The local list is modified ONLY after the backend confirms success.
    await firestoreService.deleteUser(
      userId,
      confirmation
    );

    // Firestore listeners may already have removed the user
    // while the callable was completing.
    const freshIndex = this.users.findIndex(
      (u) => u.id === userId
    );

    if (freshIndex >= 0) {
      this.users.splice(freshIndex, 1);
    }

    this.recalculateCycleMetrics();
    this.notify();

    return removedUser;
  }

  /**
   * IMPORTACIÓN MASIVA DESDE EXCEL DE BITÁCORAS Y USUARIOS
   * Importa las filas del archivo Excel, crea o actualiza los usuarios y registra las operaciones del ciclo
   */
  public importBitacoraFromExcel(params: {
    cycleId: string;
    rows: ImportedBitacoraRow[];
    autoCreateUsers?: boolean;
    updateExistingCapital?: boolean;
    adminUid?: string;
    adminName?: string;
  }): {
    success: boolean;
    createdUsersCount: number;
    updatedUsersCount: number;
    resultsImportedCount: number;
    summary: {
      totalCapitalCop: number;
      totalUsdEarnings: number;
      totalCopEarnings: number;
    };
  } {
    const adminUid = params.adminUid || 'admin_root_uid';
    const adminName = params.adminName || 'Administrador Principal';
    const autoCreateUsers = params.autoCreateUsers !== false;
    const updateExistingCapital = params.updateExistingCapital !== false;

    // 1. Asegurar o crear ciclo
    let cycle = this.cycles.find((c) => c.cycleId === params.cycleId);
    if (!cycle) {
      const parts = params.cycleId.split('-');
      const y = parts[0] || new Date().getFullYear().toString();
      const m = parts[1] || '08';
      const monthNames = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
      ];
      const mIdx = Math.max(0, Math.min(11, parseInt(m, 10) - 1));
      const monthName = monthNames[mIdx];

      cycle = {
        id: `cycle_${params.cycleId}`,
        cycleId: params.cycleId,
        name: `${monthName} ${y}`,
        status: 'OPEN',
        trmApplied: 0,
        totalManagedCapital: 0,
        totalUsersActive: 0,
        calculatedUsersCount: 0,
        totalGroupsCount: 0,
        calculatedGroupsCount: 0,
        totalGrossUsd: 0,
        totalGrossCop: 0,
        totalUsersProfitCop: 0,
        totalAdminCommissionCop: 0,
        notificationsSent: false,
        notificationsSentAt: null,
        closedAt: null,
        closedBy: null,
      };
      this.cycles.unshift(cycle);
    }

    const marketTrmCandidate =
      Number(this.config.trmMarketRate);

    const marketSource =
      String(this.config.trmSource || '')
        .trim()
        .toLowerCase();

    const hasAuthoritativeMarketTrm =
      Number.isFinite(marketTrmCandidate) &&
      marketTrmCandidate > 1000 &&
      marketTrmCandidate < 10000 &&
      (
        marketSource === 'dolar-colombia.com' ||
        marketSource === 'dolar_colombia'
      );

    const closedCycleTrm =
      Number(cycle.trmApplied);

    const trm =
      cycle.status === 'CLOSED' &&
      Number.isFinite(closedCycleTrm) &&
      closedCycleTrm > 0
        ? closedCycleTrm
        : hasAuthoritativeMarketTrm
          ? marketTrmCandidate
          : 0;

    if (
      !Number.isFinite(trm) ||
      trm <= 0
    ) {
      throw new Error(
        'TRM_SOURCE_UNAVAILABLE: No existe una TRM autom?tica v?lida de Dolar-Colombia.'
      );
    }
    let createdUsersCount = 0;
    let updatedUsersCount = 0;
    let resultsImportedCount = 0;
    let totalCapitalCop = 0;
    let totalUsdEarnings = 0;
    let totalCopEarnings = 0;

    // 2. Procesar cada fila
    params.rows.forEach((row) => {
      const normClientName = normalizeName(row.clientName);
      let user = this.users.find((u) => {
        const uNorm = normalizeName(u.fullName);
        return uNorm === normClientName || uNorm.includes(normClientName) || normClientName.includes(uNorm);
      });

      // Si no existe y autoCreateUsers está activo, crearlo
      if (!user && autoCreateUsers) {
        const existingCodes = this.users.map((u) => u.userCode);
        const userCode = generateUserCode(existingCodes);
        const category = row.category || getCategoryForCapital(row.capitalCop);

        // Calcular porcentaje cliente si viene en la hoja (ej. 50% o 75%)
        let userPercentage = 75;
        if (row.totalCopEarnings > 0 && row.totalClientCop > 0) {
          const calculatedPct = Math.round((row.totalClientCop / row.totalCopEarnings) * 100);
          if (calculatedPct >= 10 && calculatedPct <= 90) {
            userPercentage = calculatedPct;
          }
        }
        const adminPercentage = 100 - userPercentage;

        user = {
          id: `usr_${Date.now()}_${Math.random().toString(36).slice(-4)}`,
          uid: `uid_${userCode.toLowerCase()}`,
          userCode,
          fullName: row.clientName,
          email: `${userCode.toLowerCase()}@easytraders24.app`,
          phone: '+57 300 000 0000',
          role: 'USER',
          status: 'ACTIVE',
          currentCapital: row.capitalCop,
          currency: 'COP',
          category,
          userPercentage,
          adminPercentage,
          paymentMethod: row.capitalCop > 10000000 ? 'Efectivo' : 'Bancolombia',
          paymentDetails: `Cuenta Ahorros - ${row.clientName}`,
          createdAt: new Date().toISOString(),
          entryDate: `${params.cycleId}-01`,
        };

        this.users.push(user);
        createdUsersCount++;
      } else if (user && updateExistingCapital && row.capitalCop > 0) {
        user.currentCapital = row.capitalCop;
        user.category = getCategoryForCapital(row.capitalCop);
        updatedUsersCount++;
      }

      if (!user) return;

      // 3. Upsert CycleUserResult
      const resultIdx = this.userResults.findIndex(
        (r) => r.userId === user.id && r.cycleId === params.cycleId
      );

      const grossCop =
        row.totalCopEarnings > 0
          ? row.totalCopEarnings
          : row.totalUsdEarnings > 0
          ? row.totalUsdEarnings * trm
          : 0;

      const clientCop =
        row.totalClientCop > 0
          ? row.totalClientCop
          : Math.round(grossCop * (user.userPercentage / 100));

      const commissionCop =
        row.totalCommissionCop > 0
          ? row.totalCommissionCop
          : grossCop - clientCop;

      const userProfitUsd =
        row.totalUsdEarnings > 0
          ? row.totalUsdEarnings * (user.userPercentage / 100)
          : grossCop > 0 && trm > 0
          ? (clientCop / trm)
          : 0;

      const adminCommissionUsd =
        row.totalUsdEarnings > 0
          ? row.totalUsdEarnings * (user.adminPercentage / 100)
          : grossCop > 0 && trm > 0
          ? (commissionCop / trm)
          : 0;

      const userResult: CycleUserResult = {
        id:
          resultIdx >= 0
            ? this.userResults[resultIdx].id
            : `${params.cycleId}_${user.id}`,
        cycleId: params.cycleId,
        userId: user.id,
        userCode: user.userCode,
        userName: user.fullName,
        cycleCapitalCop: row.capitalCop || user.currentCapital,
        cycleCategory: row.category || user.category,
        groupCapitalCop: row.capitalCop || user.currentCapital,
        totalUsdOperated: row.totalUsdEarnings,
        trmUsed: trm,
        totalGrossCop: grossCop,
        userPercentage: user.userPercentage,
        adminPercentage: user.adminPercentage,
        userProfitCop: clientCop,
        userProfitUsd,
        adminCommissionCop: commissionCop,
        adminCommissionUsd,
        notificationStatus: 'PENDING',
        notificationSentAt: null,
        calculatedAt: new Date().toISOString(),
        calculatedBy: adminName,
        isCycleClosed: false,
      };

      if (resultIdx >= 0) {
        this.userResults[resultIdx] = userResult;
      } else {
        this.userResults.push(userResult);
      }

      resultsImportedCount++;
      totalCapitalCop += row.capitalCop;
      totalUsdEarnings += row.totalUsdEarnings;
      totalCopEarnings += grossCop;
    });

    // 4. Actualizar cálculos de grupos para las bitácoras
    const groupMap = new Map<string, { category: BitacoraCategory; capitalCop: number; rows: ImportedBitacoraRow[] }>();
    params.rows.forEach((r) => {
      const key = `${r.category}_${r.capitalCop}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, { category: r.category, capitalCop: r.capitalCop, rows: [] });
      }
      groupMap.get(key)!.rows.push(r);
    });

    groupMap.forEach(({ category, capitalCop, rows }) => {
      const groupTotalUsd = rows.reduce((acc, r) => acc + r.totalUsdEarnings, 0);
      const groupTotalCop = rows.reduce((acc, r) => acc + r.totalCopEarnings, 0);
      const avgUsdPerUser = rows.length > 0 ? groupTotalUsd / rows.length : 0;
      const avgCopPerUser = rows.length > 0 ? groupTotalCop / rows.length : 0;

      const calcIndex = this.groupCalculations.findIndex(
        (g) => g.cycleId === params.cycleId && g.category === category && g.groupCapitalCop === capitalCop
      );

      const totalGroupCop = groupTotalCop || (avgUsdPerUser * trm * rows.length);
      const totalUsersProfitCop = Math.round(totalGroupCop * 0.75);
      const totalAdminCommissionCop = totalGroupCop - totalUsersProfitCop;

      const groupCalc: CycleGroupCalculation = {
        id:
          calcIndex >= 0
            ? this.groupCalculations[calcIndex].id
            : `${params.cycleId}_${category}_${capitalCop}`,
        cycleId: params.cycleId,
        category,
        groupCapitalCop: capitalCop,
        usersCount: rows.length,
        userIds: rows.map((r) => r.matchedUserCode || r.clientName),
        totalUsdApplied: avgUsdPerUser,
        trmUsed: trm,
        totalCopPerUser: avgCopPerUser || (avgUsdPerUser * trm),
        totalGroupCop,
        totalUsersProfitCop,
        totalAdminCommissionCop,
        status: 'CALCULATED',
        calculatedAt: new Date().toISOString(),
        calculatedBy: adminName,
      };

      if (calcIndex >= 0) {
        this.groupCalculations[calcIndex] = groupCalc;
      } else {
        this.groupCalculations.push(groupCalc);
      }
    });

    // 5. Auditoría
    this.addAuditLog({
      action: 'EXCEL_BITACORA_IMPORTED',
      performedBy: adminUid,
      performedByName: adminName,
      cycleId: params.cycleId,
      targetEntity: `cycle/${params.cycleId}/excel_import`,
      details: {
        totalRows: params.rows.length,
        createdUsersCount,
        updatedUsersCount,
        resultsImportedCount,
        totalCapitalCop,
        totalUsdEarnings,
        totalCopEarnings,
      },
      reason: `Importación masiva de bitácora Excel para el ciclo ${params.cycleId}`,
    });

    // 6. Recalcular métricas y notificar a la UI
    this.recalculateCycleMetrics();
    this.notify();

    return {
      success: true,
      createdUsersCount,
      updatedUsersCount,
      resultsImportedCount,
      summary: {
        totalCapitalCop,
        totalUsdEarnings,
        totalCopEarnings,
      },
    };
  }


  /**
   * SINCRONIZAR TRM AUTOMÁTICA (Mercado en Vivo)
   */
  public syncAutomaticTRM(
    marketRate: number,
    source: string = 'Dolar-Colombia.com',
    _forceApply: boolean = false
  ): { applied: boolean; rate: number; mode: string } {
    void _forceApply;

    const normalizedSource =
      String(source || '')
        .trim()
        .toLowerCase();

    const authoritativeSource =
      normalizedSource === 'dolar-colombia.com' ||
      normalizedSource === 'dolar_colombia';

    if (
      !Number.isFinite(marketRate) ||
      marketRate <= 1000 ||
      marketRate >= 10000 ||
      !authoritativeSource
    ) {
      return {
        applied: false,
        rate: Number(this.config.trmMarketRate || 0),
        mode: 'AUTOMATIC',
      };
    }

    const roundedRate =
      Math.round(marketRate * 100) / 100;

    // ?nicamente estado autom?tico de mercado.
    // NO modifica trmApplied de ning?n ciclo.
    this.config.trmMarketRate = roundedRate;
    this.config.trmReference = roundedRate;
    this.config.trmConfigured = roundedRate;
    this.config.trmMode = 'AUTOMATIC';
    this.config.trmAutoSync = true;
    this.config.trmSource = 'Dolar-Colombia.com';
    this.config.trmLastSyncedAt =
      new Date().toISOString();

    this.notify();

    return {
      applied: true,
      rate: roundedRate,
      mode: 'AUTOMATIC',
    };
  }

  public setTRMMode(
    mode: 'AUTOMATIC' | 'MANUAL',
    manualRate?: number,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): { success: boolean; mode: string; currentTrm: number } {
    void manualRate;
    void adminUid;
    void adminName;

    if (mode !== 'AUTOMATIC') {
      throw new Error(
        'TRM_MANUAL_DISABLED: La TRM operativa es autom?tica. La ?nica TRM manual permitida es la definitiva del cierre.'
      );
    }

    const rate =
      Number(this.config.trmMarketRate);

    const source =
      String(this.config.trmSource || '')
        .trim()
        .toLowerCase();

    const valid =
      Number.isFinite(rate) &&
      rate > 1000 &&
      rate < 10000 &&
      (
        source === 'dolar-colombia.com' ||
        source === 'dolar_colombia'
      );

    if (!valid) {
      throw new Error(
        'TRM_SOURCE_UNAVAILABLE: No hay una TRM v?lida de Dolar-Colombia.'
      );
    }

    this.config.trmMode = 'AUTOMATIC';
    this.config.trmConfigured = rate;
    this.config.trmReference = rate;
    this.config.trmAutoSync = true;

    this.notify();

    return {
      success: true,
      mode: 'AUTOMATIC',
      currentTrm: rate,
    };
  }

  public updateTRM(
    newTrm: number,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ) {
    void newTrm;
    void adminUid;
    void adminName;

    throw new Error(
      'TRM_MANUAL_DISABLED: No se puede modificar manualmente la TRM operativa. Usa la TRM definitiva ?nicamente al cerrar el ciclo.'
    );
  }

  public async submitReinvestmentRequest(params: {
    userId: string;
    sourceCycleId: string;
    modality: 'PROFIT_REINVESTMENT' | 'CAPITAL_INJECTION';
    selectedReinvestmentCop?: number;
    desiredCapitalIncreaseCop?: number;
    clientRequestId?: string;
  }): Promise<ReinvestmentRequest> {
    const { userId, sourceCycleId, modality, selectedReinvestmentCop, desiredCapitalIncreaseCop, clientRequestId } = params;
    const user = this.getUserById(userId);
    if (!user) throw new Error('Usuario no encontrado.');

    // 1. Verificar si ya existe una solicitud PENDING para este usuario y ciclo
    const existingPending = this.reinvestments.find(
      (r) => (r.userId === userId || r.userUid === userId) &&
             r.sourceCycleId === sourceCycleId &&
             r.status === 'PENDING'
    );
    if (existingPending) {
      throw new Error('Ya tienes una solicitud pendiente para este ciclo.');
    }

    // 2. Intentar llamada mediante Cloud Function HTTPS Callable de Servidor (Obligatorio)
    try {
      const resp = await firestoreService.submitReinvestmentRequestCallable({
        modality,
        sourceCycleId,
        selectedReinvestmentCop,
        desiredCapitalIncreaseCop,
        clientRequestId: clientRequestId || `req_${Date.now()}_${userId.slice(0, 6)}`,
      });

      if (resp && resp.reinvestment) {
        const created = resp.reinvestment;
        this.reinvestments.unshift(created);
        this.knownReinvestmentIds.add(created.id);
        this.notify();
        return created;
      }
    } catch (callError) {
      console.error(
        '[DataStore] REINVESTMENT_SERVER_AUTHORITATIVE: el servidor rechazo o no pudo procesar la solicitud; no se creara una solicitud local.',
        callError
      );
      throw callError instanceof Error
        ? callError
        : new Error(
            'No se pudo radicar la solicitud de reinversion en el servidor. Intenta nuevamente.'
          );
    }

    throw new Error(
      'REINVESTMENT_SERVER_RESPONSE_INVALID: el servidor no devolvio una solicitud valida.'
    );
  }

  public createReinvestmentRequest(
    userId: string,
    sourceCycleId: string,
    reinvestAmountCop: number,
    withdrawAmountCop: number,
    notes?: string
  ): ReinvestmentRequest {
    // Wrapper de retrocompatibilidad que invoca el modelo unificado
    const user = this.getUserById(userId);
    if (!user) throw new Error('Usuario no encontrado.');

    const userResult = this.getUserResultForUser(userId, sourceCycleId);
    const availableProfit = userResult ? userResult.userProfitCop : 0;
    const positiveProfit = Math.max(availableProfit, 0);
    const reinvestableProfit = Math.floor(positiveProfit / 1_000_000) * 1_000_000;

    const modality = reinvestAmountCop > reinvestableProfit ? 'CAPITAL_INJECTION' : 'PROFIT_REINVESTMENT';

    // Disparar sincronización asíncrona
    this.submitReinvestmentRequest({
      userId,
      sourceCycleId,
      modality,
      selectedReinvestmentCop: modality === 'PROFIT_REINVESTMENT' ? reinvestAmountCop : undefined,
      desiredCapitalIncreaseCop: modality === 'CAPITAL_INJECTION' ? reinvestAmountCop : undefined,
    }).catch((err) => {
      console.warn('[DataStore] Error en createReinvestmentRequest retrocompatible:', err);
    });

    // Devolver objeto representativo
    return {
      id: `reinv_${Date.now()}`,
      userId,
      userCode: user.userCode,
      userName: user.fullName,
      sourceCycleId,
      modality,
      currentCapitalSnapshotCop: user.currentCapital,
      cycleProfitSnapshotCop: availableProfit,
      reinvestableProfitCop: reinvestableProfit,
      profitAppliedCop: Math.min(reinvestableProfit, reinvestAmountCop),
      cashInjectionCop: Math.max(reinvestAmountCop - reinvestableProfit, 0),
      totalIncreaseCop: reinvestAmountCop,
      profitToDisburseCop: withdrawAmountCop,
      projectedCapitalCop: user.currentCapital + reinvestAmountCop,
      projectedCategory: getCategoryForCapital(user.currentCapital + reinvestAmountCop),
      availableProfitCop: availableProfit,
      reinvestAmountCop: Math.min(reinvestableProfit, reinvestAmountCop), // Semántica histórica canónica = profitAppliedCop
      withdrawAmountCop,
      newCapitalTargetCop: user.currentCapital + reinvestAmountCop,
      newCategoryTarget: getCategoryForCapital(user.currentCapital + reinvestAmountCop),
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolvedBy: null,
      notes,
    };
  }

  public async preapproveReinvestment(
    requestId: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ) {
    const reqIndex = this.reinvestments.findIndex((r) => r.id === requestId);
    if (reqIndex < 0) throw new Error('Solicitud no encontrada.');

    const req = this.reinvestments[reqIndex];
    if (req.status !== 'PENDING') throw new Error(`Solo solicitudes PENDING pueden ser preaprobadas (actual: ${req.status}).`);

    const res = await firestoreService.adminResolveReinvestmentCallable({
      reinvestmentId: req.id,
      action: 'PREAPPROVE',
    });

    if (res && res.reinvestment) {
      this.reinvestments[reqIndex] = res.reinvestment;
    } else {
      this.reinvestments[reqIndex] = {
        ...req,
        status: 'PREAPPROVED',
        resolvedAt: new Date().toISOString(),
        resolvedBy: adminName,
        resolvedByUid: adminUid,
      };
    }

    this.notify();
    return this.reinvestments[reqIndex];
  }

  public async confirmCashAndApproveReinvestment(
    requestId: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ) {
    const reqIndex = this.reinvestments.findIndex((r) => r.id === requestId);
    if (reqIndex < 0) throw new Error('Solicitud no encontrada.');

    const req = this.reinvestments[reqIndex];
    if (req.status !== 'PREAPPROVED') throw new Error(`Solo solicitudes PREAPPROVED pueden confirmarse y aprobarse (actual: ${req.status}).`);

    const res = await firestoreService.adminResolveReinvestmentCallable({
      reinvestmentId: req.id,
      action: 'CONFIRM_CASH_AND_APPROVE',
    });

    if (res && res.reinvestment) {
      this.reinvestments[reqIndex] = res.reinvestment;
    } else {
      const nowIso = new Date().toISOString();
      this.reinvestments[reqIndex] = {
        ...req,
        status: 'APPROVED',
        resolvedAt: nowIso,
        resolvedBy: adminName,
        resolvedByUid: adminUid,
        cashReceivedConfirmed: true,
        cashReceivedAmountCop: Number(req.cashInjectionCop || 0),
        cashReceivedAt: nowIso,
        cashReceivedByUid: adminUid,
        cashReceivedByName: adminName,
      };
    }

    this.notify();
    return this.reinvestments[reqIndex];
  }

  public async approveReinvestment(
    requestId: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ) {
    const reqIndex = this.reinvestments.findIndex((r) => r.id === requestId);
    if (reqIndex < 0) throw new Error('Solicitud no encontrada.');

    const req = this.reinvestments[reqIndex];
    if (req.status !== 'PENDING') throw new Error(`Solo solicitudes en estado PENDING pueden aprobarse directamente (actual: ${req.status}).`);

    const cashInjection = Number(req.cashInjectionCop || 0);
    if (req.modality === 'CAPITAL_INJECTION' && cashInjection > 0) {
      throw new Error(`Esta solicitud contempla un aporte de $${cashInjection.toLocaleString('es-CO')} COP. Debe ser PREAPROBADA primero y luego APROBADA confirmando el dinero recibido.`);
    }

    const res = await firestoreService.adminResolveReinvestmentCallable({
      reinvestmentId: req.id,
      action: 'APPROVE',
    });

    if (res && res.reinvestment) {
      this.reinvestments[reqIndex] = res.reinvestment;
    } else {
      const nowIso = new Date().toISOString();
      this.reinvestments[reqIndex] = {
        ...req,
        status: 'APPROVED',
        resolvedAt: nowIso,
        resolvedBy: adminName,
        resolvedByUid: adminUid,
      };
    }

    this.notify();
    return this.reinvestments[reqIndex];
  }

  public async rejectReinvestment(
    requestId: string,
    reason?: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ) {
    const reqIndex = this.reinvestments.findIndex((r) => r.id === requestId);
    if (reqIndex < 0) throw new Error('Solicitud no encontrada.');

    const req = this.reinvestments[reqIndex];
    const res = await firestoreService.adminResolveReinvestmentCallable({
      reinvestmentId: req.id,
      action: 'REJECT',
      rejectionReason: reason,
    });

    if (res && res.reinvestment) {
      this.reinvestments[reqIndex] = res.reinvestment;
    } else {
      const nowIso = new Date().toISOString();
      this.reinvestments[reqIndex] = {
        ...req,
        status: 'REJECTED',
        resolvedAt: nowIso,
        resolvedBy: adminName,
        resolvedByUid: adminUid,
        rejectionReason: reason,
      };
    }

    this.notify();
    return this.reinvestments[reqIndex];
  }

  public async needsReviewReinvestment(
    requestId: string,
    reason?: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ) {
    const reqIndex = this.reinvestments.findIndex((r) => r.id === requestId);
    if (reqIndex < 0) throw new Error('Solicitud no encontrada.');

    const req = this.reinvestments[reqIndex];
    const res = await firestoreService.adminResolveReinvestmentCallable({
      reinvestmentId: req.id,
      action: 'NEEDS_REVIEW',
      rejectionReason: reason,
    });

    if (res && res.reinvestment) {
      this.reinvestments[reqIndex] = res.reinvestment;
    } else {
      const nowIso = new Date().toISOString();
      this.reinvestments[reqIndex] = {
        ...req,
        status: 'NEEDS_REVIEW',
        resolvedAt: nowIso,
        resolvedBy: adminName,
        resolvedByUid: adminUid,
        rejectionReason: reason,
      };
    }

    this.notify();
    return this.reinvestments[reqIndex];
  }

  public async resolveFundingReconciliation(
    requestId: string,
    resolution: 'RESOLVE_MATCHING' | 'KEEP_REVIEW',
    notes: string,
    clientRequestId: string
  ) {
    const reqIndex = this.reinvestments.findIndex((r) => r.id === requestId);
    if (reqIndex < 0) throw new Error('Solicitud no encontrada.');

    const res = await firestoreService.adminResolveFundingReconciliationCallable({
      requestId,
      resolution,
      notes,
      clientRequestId,
    });

    if (res.success) {
      const req = this.reinvestments[reqIndex];
      this.reinvestments[reqIndex] = {
        ...req,
        fundingReconciliationStatus: resolution === 'RESOLVE_MATCHING' ? 'OK' : 'NEEDS_REVIEW',
        fundingReconciliationReason: resolution === 'RESOLVE_MATCHING' ? null : req.fundingReconciliationReason,
        notes: notes ? (req.notes ? `${req.notes} | RESOLVED: ${notes}` : `RESOLVED: ${notes}`) : (req.notes || ''),
      };
      this.notify();
    }
    return res;
  }

  public async previewOrphanReinvestments() {
    return await firestoreService.adminPreviewOrphanReinvestmentsCallable();
  }

  public async purgeOrphanReinvestments(documentIds: string[], confirmationPhrase: string) {
    return await firestoreService.adminPurgeOrphanReinvestmentsCallable({
      documentIds,
      confirmationPhrase,
    });
  }

  /**
   * GESTIÓN DE DESEMBOLSOS (DISBURSEMENTS) - CANAL AUTORITATIVO POR BACKEND
   * Regla de Negocio: Para transferencias superiores a 10 millones COP es obligatoriamente en EFECTIVO.
   */
  public async createDisbursementRequest(params: {
    userId: string;
    sourceCycleId: string;
    amountCop: number;
    disbursementSource?: 'PROFIT' | 'CAPITAL' | 'MIXED';
    method: DisbursementMethod;
    bankName?: string;
    accountType?: string;
    accountNumber?: string;
    accountHolderName?: string;
    idDocument?: string;
    cashOffice?: string;
    receiverId?: string;
    receiverFullName?: string;
    notes?: string;
  }): Promise<DisbursementRequest> {
    const user = this.getUserById(params.userId);
    if (!user) throw new Error('Usuario no encontrado.');

    if (!params.amountCop || params.amountCop <= 0) {
      throw new Error('El monto de desembolso debe ser mayor a $0 COP.');
    }

    const clientRequestId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `cl_${Math.random().toString(36).substring(2)}_${Date.now().toString(36)}`;

    const res = await firestoreService.adminRequestDisbursementCallable({
      userId: params.userId,
      sourceCycleId: params.sourceCycleId,
      amountCop: params.amountCop,
      disbursementSource: params.disbursementSource || 'PROFIT',
      method: params.method,
      bankName: params.bankName,
      accountType: params.accountType,
      accountNumber: params.accountNumber,
      accountHolderName: params.accountHolderName,
      idDocument: params.idDocument,
      cashOffice: params.cashOffice,
      receiverId: params.receiverId,
      receiverFullName: params.receiverFullName,
      notes: params.notes,
      clientRequestId,
    });

    if (res.success && res.disbursement) {
      this.disbursements.unshift(res.disbursement);
      this.notify();
      return res.disbursement;
    }
    throw new Error(res.message || 'Error al procesar la solicitud de desembolso en el servidor.');
  }

  public async approveDisbursement(
    requestId: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): Promise<void> {
    const reqIndex = this.disbursements.findIndex((d) => d.id === requestId);
    if (reqIndex < 0) throw new Error('Solicitud de desembolso no encontrada.');

    const req = this.disbursements[reqIndex];
    if (req.status !== 'PENDING') throw new Error('La solicitud ya fue procesada.');

    const res = await firestoreService.adminResolveDisbursementCallable({
      requestId,
      action: 'APPROVE',
    });

    if (res.success && res.disbursement) {
      this.disbursements[reqIndex] = res.disbursement;
      this.notify();
    } else {
      throw new Error(res.message || 'Error al aprobar el desembolso en el servidor.');
    }
  }

  public async markDisbursementAsPaid(
    requestId: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal',
    voucherOrNotes?: string
  ): Promise<void> {
    const reqIndex = this.disbursements.findIndex((d) => d.id === requestId);
    if (reqIndex < 0) throw new Error('Solicitud de desembolso no encontrada.');

    const res = await firestoreService.adminResolveDisbursementCallable({
      requestId,
      action: 'PAY',
      voucher: voucherOrNotes,
    });

    if (res.success && res.disbursement) {
      this.disbursements[reqIndex] = res.disbursement;
      this.notify();
    } else {
      throw new Error(res.message || 'Error al marcar desembolso como liquidado en el servidor.');
    }
  }

  public async rejectDisbursement(
    requestId: string,
    reason?: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): Promise<void> {
    const reqIndex = this.disbursements.findIndex((d) => d.id === requestId);
    if (reqIndex < 0) throw new Error('Solicitud de desembolso no encontrada.');

    const res = await firestoreService.adminResolveDisbursementCallable({
      requestId,
      action: 'REJECT',
      notes: reason,
    });

    if (res.success && res.disbursement) {
      this.disbursements[reqIndex] = res.disbursement;
      this.notify();
    } else {
      throw new Error(res.message || 'Error al rechazar el desembolso en el servidor.');
    }
  }

  public isNotificationOwned(n: NotificationItem): boolean {
    const currentUid = this.currentActiveUid;
    if (!currentUid) return false;
    return (
      (n.userUid != null && n.userUid === currentUid) ||
      (n.userId != null && n.userId === currentUid)
    );
  }

  public isNotificationRead(n: NotificationItem): boolean {
    if (n.isRead) return true;
    if (!this.isNotificationOwned(n)) {
      return this.readSharedIds.has(n.id);
    }
    return false;
  }

  public async markNotificationAsRead(notifId: string) {
    const notif = this.notifications.find((n) => n.id === notifId);
    if (!notif) return;

    if (this.isNotificationOwned(notif)) {
      if (!notif.isRead) {
        try {
          await firestoreService.markNotificationAsRead(notifId);
        } catch (err) {
          console.error(`Error al marcar notificación ${notifId} como leída:`, err);
        }
      }
    } else {
      // Es compartida, marcar localmente
      if (!this.readSharedIds.has(notifId)) {
        this.readSharedIds.add(notifId);
        try {
          if (typeof window !== 'undefined') {
            localStorage.setItem('gestor_read_shared_notifications', JSON.stringify(Array.from(this.readSharedIds)));
          }
        } catch (e) {
          console.error(e);
        }
        this.notify();
      }
    }
  }

  public async markAllNotificationsAsRead(notifIds: string[]) {
    if (!notifIds || !notifIds.length) return;
    try {
      await firestoreService.markAllNotificationsAsRead(notifIds);
    } catch (err) {
      console.error('Error al marcar todas las notificaciones como leídas:', err);
      throw err;
    }
  }

  public async hideNotification(notifId: string) {
    try {
      await firestoreService.hideNotification(notifId);
    } catch (err) {
      console.error(`Error al ocultar la notificación ${notifId}:`, err);
    }
  }

  public async hideNotificationsBatch(notifIds: string[]) {
    if (!notifIds || !notifIds.length) return;
    try {
      await firestoreService.hideNotificationsBatch(notifIds);
    } catch (err) {
      console.error('Error al ocultar lote de notificaciones:', err);
      throw err;
    }
  }

  // ==========================================
  // GESTIÓN DE SOLICITUDES DE INGRESO (FIFO)
  // ==========================================
  public getApplications(): InvestorApplication[] {
    return [...this.applications].sort((a, b) => a.queuePosition - b.queuePosition);
  }

  public getPendingApplications(): InvestorApplication[] {
    return this.applications
      .filter((a) => a.status === 'PENDING')
      .sort((a, b) => a.queuePosition - b.queuePosition);
  }

  public getApplicationById(id: string): InvestorApplication | undefined {
    return this.applications.find((a) => a.id === id);
  }

  public createApplication(data: {
    fullName: string;
    documentId: string;
    email: string;
    phone: string;
    city?: string;
    requestedCapitalCop: number;
    originBank?: string;
    priorityNotes?: string;
    source?: 'WEB_FORM' | 'DIRECT_ADMIN';
  }): InvestorApplication {
    const currentMaxTurn = this.applications.reduce(
      (max, item) => Math.max(max, item.queuePosition || 0),
      0
    );
    const newTurn = currentMaxTurn + 1;
    const displayTurn =
      this.applications.filter((item) => item.status === 'PENDING').length + 1;

    const newApp: InvestorApplication = {
      id: `app_${Date.now()}_${Math.random().toString(36).slice(-4)}`,
      queuePosition: newTurn,
      fullName: data.fullName.trim(),
      documentId: data.documentId.trim(),
      email: data.email.trim().toLowerCase(),
      phone: data.phone.trim(),
      city: data.city?.trim() || 'Colombia',
      requestedCapitalCop: Number(data.requestedCapitalCop) || 8_000_000,
      originBank: data.originBank?.trim() || 'Bancolombia',
      submissionDate: new Date().toISOString(),
      status: 'PENDING',
      source: data.source || 'WEB_FORM',
      priorityNotes: data.priorityNotes?.trim(),
    };

    this.applications.push(newApp);
    this.knownApplicationIds.add(newApp.id);

    // Notificación en la app para los Administradores
    const formattedAmount = `$${newApp.requestedCapitalCop.toLocaleString('es-CO')} COP`;
    const detailsInfo = [
      newApp.phone ? `Celular: ${newApp.phone}` : null,
      newApp.city ? `Ciudad: ${newApp.city}` : null,
      newApp.originBank ? `Banco: ${newApp.originBank}` : null,
      newApp.documentId ? `C.C.: ${newApp.documentId}` : null,
    ]
      .filter(Boolean)
      .join(' • ');

    this.notifications.unshift({
      id: `notif_app_sub_${Date.now()}_${Math.random().toString(36).slice(-4)}`,
      userId: 'ALL_ADMINS',
      userCode: 'ADMIN',
      userName: 'Administradores EasyTraders',
      cycleId: this.config.activeCycleId || '2026-08',
      type: 'INVESTMENT_REQUEST',
      title: `📥 Nueva Solicitud de Admisión: ${newApp.fullName} (Turno #${displayTurn})`,
      message: `${newApp.fullName} ha radicado una solicitud de ingreso con un capital de ${formattedAmount}.${detailsInfo ? ` [${detailsInfo}]` : ''} Revisa la sección de Admisiones para gestionar la aprobación.`,
      payload: {
        cycleId: this.config.activeCycleId || '2026-08',
        usdAmount: 0,
        copAmount: newApp.requestedCapitalCop,
        userProfitCop: 0,
        userPercentage: 0,
      },
      isRead: false,
      sentAt: new Date().toISOString(),
      readAt: null,
    });

    // Disparar Notificación Push / Alerta Sonora a los Administradores
    notifyNewApplicationToAdmin({
      applicantName: newApp.fullName,
      requestedCapitalCop: newApp.requestedCapitalCop,
      queuePosition: displayTurn,
      phone: newApp.phone,
      city: newApp.city,
      bank: newApp.originBank,
    });

    // Persistir en Firestore en segundo plano si está disponible
    firestoreService.saveApplication(newApp).catch((err) => {
      console.warn('[DataStore] Error al guardar solicitud en Firestore:', err);
    });

    this.notify();
    return newApp;
  }

  public importApplicationsFromExcel(
    rows: Array<{
      fullName: string;
      documentId?: string;
      email?: string;
      phone?: string;
      city?: string;
      requestedCapitalCop?: number;
      originBank?: string;
      submissionDate?: string;
      notes?: string;
      excelTurno?: number;
    }>,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal',
    replaceExistingQueue: boolean = false
  ): { importedCount: number; startingTurn: number } {
    if (!rows || rows.length === 0) {
      return { importedCount: 0, startingTurn: 0 };
    }

    // Si se selecciona reemplazar la lista de espera oficial existente
    if (replaceExistingQueue) {
      const oldPending = this.applications.filter((a) => a.status === 'PENDING');
      this.applications = this.applications.filter((a) => a.status !== 'PENDING');
      // Eliminar de Firestore las solicitudes pendientes reemplazadas
      for (const oldApp of oldPending) {
        firestoreService.deleteApplication(oldApp.id).catch(() => {});
      }
    }

    const currentMaxTurn = replaceExistingQueue
      ? 0
      : this.applications.reduce(
          (max, item) => Math.max(max, item.queuePosition || 0),
          0
        );
    const startingTurn = currentMaxTurn + 1;

    const newItems: InvestorApplication[] = rows.map((r, idx) => {
      // Si se reemplaza la lista, el turno coincide exactamente con el orden del Excel (Fila 1 = Turno 1)
      const turn = replaceExistingQueue
        ? (r.excelTurno && Number(r.excelTurno) > 0 ? Number(r.excelTurno) : idx + 1)
        : (r.excelTurno && Number(r.excelTurno) > 0 ? Number(r.excelTurno) : startingTurn + idx);

      return {
        id: `app_xl_${Date.now()}_${idx}_${Math.random().toString(36).slice(-3)}`,
        queuePosition: turn,
        fullName: (r.fullName || 'Inversionista Aspirante').trim(),
        documentId: (r.documentId || '').trim(),
        email: (r.email || '').trim().toLowerCase(),
        phone: (r.phone || '').trim(),
        city: r.city?.trim() || 'Colombia',
        requestedCapitalCop: Number(r.requestedCapitalCop) || 8_000_000,
        originBank: r.originBank?.trim() || 'Bancolombia',
        submissionDate: r.submissionDate || new Date().toISOString(),
        status: 'PENDING',
        source: 'EXCEL_HISTORICO',
        excelRowIndex: idx + 1,
        priorityNotes: r.notes || `Fila ${idx + 1} de lista histórica en Excel (Orden de llegada)`,
      };
    });

    this.applications.push(...newItems);

    // Asegurar que la cola quede ordenada cronológicamente por número de turno
    this.applications.sort((a, b) => a.queuePosition - b.queuePosition);

    // Guardar el lote en base de datos Firestore
    firestoreService.saveApplicationsBatch(newItems).catch((err) => {
      console.warn('[DataStore] Error al guardar lote en Firestore:', err);
    });

    this.addAuditLog({
      action: 'APPLICATIONS_IMPORTED',
      performedBy: adminUid,
      performedByName: adminName,
      targetEntity: 'investor_applications',
      details: {
        count: newItems.length,
        startingTurn,
        endingTurn: startingTurn + newItems.length - 1,
        replacedQueue: replaceExistingQueue,
      },
      reason: replaceExistingQueue
        ? 'Carga de lista histórica oficial reemplazando la cola de espera previa'
        : 'Carga masiva de solicitudes históricas en estricto orden de llegada FIFO',
    });

    this.notify();
    return { importedCount: newItems.length, startingTurn };
  }

  /**
   * Renumera de forma estrictamente correlativa (1, 2, 3...) todas las solicitudes pendientes
   */
  public renumberPendingQueue(): void {
    const pending = this.applications.filter((a) => a.status === 'PENDING');
    pending.sort((a, b) => a.queuePosition - b.queuePosition);
    pending.forEach((app, idx) => {
      app.queuePosition = idx + 1;
      // Actualizar turno en Firestore
      firestoreService.saveApplication(app).catch(() => {});
    });
    this.notify();
  }

  /**
   * Elimina una solicitud de la lista de espera y de la base de datos Firestore
   */
  public async deleteApplication(
    applicationId: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): Promise<{ success: boolean; message: string }> {
    const target = this.applications.find((a) => a.id === applicationId);
    this.applications = this.applications.filter((a) => a.id !== applicationId);
    
    // Reindexar orden correlativo de las pendientes
    this.renumberPendingQueue();

    // Eliminar de base de datos Firestore
    try {
      await firestoreService.deleteApplication(applicationId);
    } catch (err: any) {
      console.error('[DataStore] Error al eliminar solicitud en Firestore:', err);
    }

    if (target) {
      this.addAuditLog({
        action: 'APPLICATION_DELETED',
        performedBy: adminUid,
        performedByName: adminName,
        targetEntity: applicationId,
        details: {
          fullName: target.fullName,
          status: target.status,
          capital: target.requestedCapitalCop,
          queuePosition: target.queuePosition,
        },
        reason: `Eliminación permanente de postulación de admisión (${target.fullName})`,
      });
    }

    this.notify();
    return {
      success: true,
      message: `La solicitud de ${target?.fullName || 'admisión'} ha sido eliminada permanentemente.`,
    };
  }

  public approveApplication(
    applicationId: string,
    params: {
      userCode?: string;
      category?: BitacoraCategory;
      finalCapitalCop?: number;
      paymentMethod?: string;
      paymentDetails?: string;
      adminPercentage?: number;
      userPercentage?: number;
    },
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): { user: UserProfile; application: InvestorApplication; welcomeMessage: string } {
    const appIndex = this.applications.findIndex((a) => a.id === applicationId);
    if (appIndex < 0) throw new Error('Solicitud no encontrada.');

    const app = this.applications[appIndex];
    const capital = Number(params.finalCapitalCop) || app.requestedCapitalCop || 8_000_000;

    // ADMISSION_APPROVAL_MINIMUM_CAPITAL:
    // Las excepciones desde $2M pertenecen al flujo operativo de Bitacoras,
    // no al flujo normal de Admisiones.
    if (!Number.isFinite(capital) || capital < 4_000_000) {
      throw new Error(
        'Una admision no puede aprobarse con un capital inferior a $4.000.000 COP.'
      );
    }
    const category = params.category || getCategoryForCapital(capital);

    // Asignar o generar código
    let assignedCode = params.userCode?.trim().toUpperCase();
    if (!assignedCode) {
      assignedCode = generateUserCode(this.users.map((u) => u.userCode));
    }

    const existing = this.getUserByCode(assignedCode);
    if (existing) {
      throw new Error(`El código ${assignedCode} ya está asignado a ${existing.fullName}.`);
    }

    const userId = `usr_${Date.now()}_${Math.random().toString(36).slice(-4)}`;
    const nowIso = new Date().toISOString();

    const newUser: UserProfile = {
      id: userId,
      uid: userId,
      userCode: assignedCode,
      fullName: app.fullName,
      email: app.email,
      phone: app.phone,
      documentId: app.documentId,
      role: 'USER',
      status: 'ACTIVE',
      currentCapital: capital,
      currency: 'COP',
      category,
      userPercentage: params.userPercentage ?? (category === 'NEGRA' ? 70 : 50),
      adminPercentage: params.adminPercentage ?? (category === 'NEGRA' ? 30 : 50),
      paymentMethod: params.paymentMethod || app.originBank || 'Bancolombia',
      paymentDetails: params.paymentDetails || `Cuenta registrada por admisión (${app.phone})`,
      createdAt: nowIso,
      entryDate: nowIso.split('T')[0],
      isClaimed: false,
    };

    this.users.push(newUser);

    // Actualizar solicitud
    this.applications[appIndex] = {
      ...app,
      status: 'APPROVED',
      assignedUserCode: assignedCode,
      assignedUserId: userId,
      resolvedAt: nowIso,
      resolvedBy: adminName,
    };

    // Mensaje de WhatsApp listo para copiar y enviar al nuevo inversionista
    const originUrl = getAppBaseUrl();
    const welcomeMessage = `👋 ¡Hola *${app.fullName}*! Te damos la bienvenida oficial a *EasyTraders*.\n\n` +
      `Tu solicitud de ingreso (Turno #${app.queuePosition}) ha sido *APROBADA* exitosamente.\n\n` +
      `📋 *Datos Oficiales de tu Cuenta:*\n` +
      `• *Código de Inversionista:* *${assignedCode}*\n` +
      `• *Capital Acreditado:* $${capital.toLocaleString('es-CO')} COP\n` +
      `• *Categoría de Bitácora:* ${category}\n` +
      `• *Documento:* ${app.documentId || 'Registrado'}\n\n` +
      `📲 *Instrucciones para Ingresar al Portal:*\n` +
      `1. Abre este enlace: ${originUrl}\n` +
      `2. Selecciona la opción *"Activar Cuenta (Inversionistas Antiguos y Nuevos)"*.\n` +
      `3. Digita tu código *${assignedCode}* o tu cédula.\n` +
      `4. Asigna tu correo y contraseña personal para consultar tus liquidaciones, bitácoras y utilidades en tiempo real.\n\n` +
      `¡Muchos éxitos y bienvenido a nuestro fondo de capital! 🚀`;

    this.addAuditLog({
      action: 'APPLICATION_APPROVED',
      performedBy: adminUid,
      performedByName: adminName,
      targetEntity: app.id,
      reason: `Aprobado en turno #${app.queuePosition}. Código asignado: ${assignedCode}`,
      details: {
        applicationId: app.id,
        userCode: assignedCode,
        capital,
        category,
      },
    });

    // Notificación Push al Inversionista
    notifyApplicationStatusToUser({
      applicantName: app.fullName,
      status: 'APPROVED',
    });

    // Guardar en Firestore
    firestoreService.saveUser(newUser).catch(() => {});
    firestoreService.saveApplication(this.applications[appIndex]).catch(() => {});

    this.notify();
    return { user: newUser, application: this.applications[appIndex], welcomeMessage };
  }

  public rejectApplication(
    applicationId: string,
    reason?: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ) {
    const appIndex = this.applications.findIndex((a) => a.id === applicationId);
    if (appIndex < 0) throw new Error('Solicitud no encontrada.');

    const app = this.applications[appIndex];
    this.applications[appIndex] = {
      ...app,
      status: 'REJECTED',
      rejectionReason: reason || 'Rechazada por administración',
      resolvedAt: new Date().toISOString(),
      resolvedBy: adminName,
    };

    this.addAuditLog({
      action: 'APPLICATION_REJECTED',
      performedBy: adminUid,
      performedByName: adminName,
      targetEntity: app.id,
      reason: reason || 'Rechazada por administración',
      details: {
        applicationId: app.id,
        queuePosition: app.queuePosition,
        fullName: app.fullName,
      },
    });

    // Notificación Push al Inversionista
    notifyApplicationStatusToUser({
      applicantName: app.fullName,
      status: 'REJECTED',
      rejectionReason: reason,
    });

    firestoreService.saveApplication(this.applications[appIndex]).catch(() => {});

    this.notify();
  }

  public reorderApplicationQueue(applicationId: string, newTurn: number) {
    const pending = this.applications
      .filter((a) => a.status === 'PENDING')
      .sort((a, b) => {
        const queueDiff = Number(a.queuePosition || 0) - Number(b.queuePosition || 0);
        if (queueDiff !== 0) return queueDiff;

        const dateDiff =
          new Date(a.submissionDate || 0).getTime() -
          new Date(b.submissionDate || 0).getTime();

        if (dateDiff !== 0) return dateDiff;
        return String(a.id).localeCompare(String(b.id));
      });

    const currentIndex = pending.findIndex((a) => a.id === applicationId);
    if (currentIndex < 0) return;

    const targetIndex = Math.max(0, Math.min(newTurn - 1, pending.length - 1));
    if (currentIndex === targetIndex) return;

    const [moved] = pending.splice(currentIndex, 1);
    pending.splice(targetIndex, 0, moved);

    pending.forEach((app, index) => {
      app.queuePosition = index + 1;
      firestoreService.saveApplication(app).catch(() => {});
    });

    this.applications.sort((a, b) => (a.queuePosition || 0) - (b.queuePosition || 0));
    this.notify();
  }

  // ==========================================
  // VINCULACIÓN / ACTIVACIÓN DE CUENTA (CLAIM)
  // ==========================================
  public async claimAccount(
    identifier: string,
    newEmail: string,
    newPassword?: string
  ): Promise<{ success: boolean; user?: UserProfile; message: string }> {
    const cleanId = identifier.trim().toUpperCase();
    let user = this.users.find((u) =>
      (u.userCode && u.userCode.trim().toUpperCase() === cleanId) ||
      (u.documentId && u.documentId.trim() === identifier.trim()) ||
      (u.email && u.email.trim().toLowerCase() === identifier.trim().toLowerCase())
    );

    // Si no está en memoria local aún, buscar directamente en Firestore (soporte multi-dispositivo)
    if (!user) {
      try {
        const remoteUser = await firestoreService.findUserByCodeOrDoc(identifier);
        if (remoteUser) {
          user = remoteUser;
          const idx = this.users.findIndex((u) => u.id === user!.id);
          if (idx >= 0) {
            this.users[idx] = user;
          } else {
            this.users.push(user);
          }
        }
      } catch (err) {
        console.warn('Error en fallback Firestore claimAccount:', err);
      }
    }

    if (!user) {
      return {
        success: false,
        message: 'No se encontró ninguna cuenta asociada a este código o documento de identidad. Verifica que el código coincida exactamente.',
      };
    }

    user.email = newEmail.trim().toLowerCase();
    if (newPassword) {
      user.password = newPassword.trim();
    }
    user.isClaimed = true;
    user.claimedAt = new Date().toISOString();

    // Guardar en Firestore de inmediato para persistencia
    firestoreService.saveUser(user).catch((err) => console.warn('Error al guardar claim en Firestore:', err));

    this.addAuditLog({
      action: 'ACCOUNT_CLAIMED',
      performedBy: user.id,
      performedByName: user.fullName,
      targetEntity: user.id,
      reason: `Cuenta activada exitosamente con código ${user.userCode}`,
      details: {
        userCode: user.userCode,
        email: user.email,
      },
    });

    this.saveState();
    this.notify();
    return {
      success: true,
      user,
      message: `¡Cuenta activada con éxito para ${user.fullName}!`,
    };
  }

  public loginWithCredentials(
    identifier: string,
    password?: string
  ): { success: boolean; user?: UserProfile; message: string } {
    const cleanId = identifier.trim().toUpperCase();
    const cleanLower = identifier.trim().toLowerCase();

    // Acceso rápido admin
    if (cleanLower === 'admin' || cleanLower === 'admin@easytraders.com' || cleanLower === 'admin@easytraders24.app') {
      const admin = this.users.find((u) => u.role === 'ADMIN');
      if (admin) return { success: true, user: admin, message: 'Bienvenido Administrador' };
    }

    // Buscar usuario por código, documento o email
    const user = this.users.find((u) =>
      u.userCode.toUpperCase() === cleanId ||
      (u.documentId && u.documentId.trim() === identifier.trim()) ||
      (u.email && u.email.trim().toLowerCase() === cleanLower)
    );

    if (!user) {
      return {
        success: false,
        message: 'Usuario no encontrado. Verifica tu código, correo o cédula.',
      };
    }

    if (user.password && password) {
      if (user.password !== password.trim()) {
        return { success: false, message: 'Contraseña incorrecta.' };
      }
    }

    return {
      success: true,
      user,
      message: `Bienvenido, ${user.fullName}`,
    };
  }

  public async runHistoricalMigration(): Promise<ReconciliationReport> {
    return historicalMigrationService.runFullHistoricalReconciliation();
  }

  private addAuditLog(log: Omit<AuditLog, 'id' | 'timestamp'>) {
    const newLog: AuditLog = {
      ...log,
      id: `log_${Date.now()}_${Math.random().toString(36).slice(-4)}`,
      timestamp: new Date().toISOString(),
    };
    this.auditLogs.unshift(newLog);
  }
}

export const dataStore = new DataStore();
