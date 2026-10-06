import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  deleteField,
  query,
  where,
  orderBy,
  onSnapshot,
  runTransaction,
  writeBatch,
} from 'firebase/firestore';
import { db, functions, httpsCallable, auth, createFirebaseAuthUser } from './firebase';
import {
  UserProfile,
  MonthlyCycle,
  CycleFinancialSummary,
  InvestorApplication,
  DailyGroupOperation,
  CycleGroupCalculation,
  CycleUserResult,
  ReinvestmentRequest,
  DisbursementRequest,
  BitacoraCategory,
  OperationTargetType,
  InvestmentRequest,
  NotificationItem,
  UserPushToken,
  AuditLog,
  GlobalConfig,
  SupportTicket,
  SupportTicketMessage,
  SupportInternalNote,
} from '../types';

export const firestoreService = {
  // ==========================================
  // --- USUARIOS (users/{userUid}) ---
  // ==========================================
  /**
   * Invoca la Cloud Function HTTPS Callable `adminCreateUser` para registro atómico en Auth + Firestore con compensación.
   */
  async adminCreateUser(params: {
    email: string;
    password?: string;
    fullName: string;
    phone?: string;
    currentCapital: number;
    userPercentage?: number;
    adminPercentage?: number;
    paymentMethod?: string;
    paymentDetails?: string;
    role?: 'USER' | 'ADMIN';
    targetCycleId?: string | null;
  }): Promise<{ success: boolean; user: UserProfile; message: string }> {
    const callable = httpsCallable(functions, 'adminCreateUser');
    const response = await callable(params);
    return response.data as { success: boolean; user: UserProfile; message: string };
  },

  /**
   * Configura una cuenta administrativa existente
   * como participante financiero SELF_ADMIN.
   *
   * El rol ADMIN se conserva.
   */
  async adminConfigureTradingParticipant(params: {
    targetUid: string;
    currentCapital: number;
    targetCycleId: string;
  }): Promise<{
    success: boolean;
    participant: {
      uid: string;
      fullName: string;
      email: string;
      role: string;
      status: string;
      participatesInTrading: true;
      commissionMode: 'SELF_ADMIN';
      currentCapital: number;
      baseCapital: number;
      category: BitacoraCategory;
      userPercentage: 100;
      adminPercentage: 0;
      entryCycleId: string;
    };
    message: string;
  }> {
    const callable = httpsCallable<
      {
        targetUid: string;
        currentCapital: number;
        targetCycleId: string;
      },
      {
        success: boolean;
        participant: {
          uid: string;
          fullName: string;
          email: string;
          role: string;
          status: string;
          participatesInTrading: true;
          commissionMode: 'SELF_ADMIN';
          currentCapital: number;
          baseCapital: number;
          category: BitacoraCategory;
          userPercentage: 100;
          adminPercentage: 0;
          entryCycleId: string;
        };
        message: string;
      }
    >(
      functions,
      'adminConfigureTradingParticipantCallable'
    );

    const response =
      await callable(params);

    return response.data;
  },

  /**
   * Invoca la Cloud Function HTTPS Callable `adminCreatePendingInvestor`
   * para registrar un inversionista pendiente de activación (Solo Firestore, sin cuenta Firebase Auth).
   */
  async adminCreatePendingInvestor(params: {
    email: string;
    fullName: string;
    phone?: string;
    currentCapital: number;
    userPercentage?: number;
    adminPercentage?: number;
    paymentMethod?: string;
    paymentDetails?: string;
    targetCycleId?: string | null;
  }): Promise<{ success: boolean; user: UserProfile; message: string }> {
    const callable = httpsCallable(functions, 'adminCreatePendingInvestor');
    const response = await callable(params);
    return response.data as { success: boolean; user: UserProfile; message: string };
  },

  /**
   * Importacion masiva autoritativa de inversionistas
   * hacia el ciclo PREPARING.
   *
   * No crea cycleUserResults ni modifica usuarios existentes.
   */
  async adminBulkImportInvestors(params: {
    targetCycleId: string;
    clientRequestId?: string;
    rows: Array<{
      rawId?: string;
      id?: string;
      clientName?: string;
      fullName?: string;
      email?: string;
      phone?: string;
      capitalCop?: number;
      currentCapital?: number;
      matchedUserCode?: string;
      userPercentage?: number;
      adminPercentage?: number;
      paymentMethod?: string;
      paymentDetails?: string;
    }>;
  }): Promise<{
    success: boolean;
    partialSuccess?: boolean;
    targetCycleId: string;
    rowsReceived: number;
    createdUsersCount: number;
    skippedUsersCount: number;
    failedUsersCount: number;
    results: Array<{
      index: number;
      rawId?: string;
      fullName?: string;
      status: 'CREATED' | 'SKIPPED' | 'FAILED';
      code: string;
      message?: string;
      userId?: string;
      userCode?: string;
      existingUserId?: string;
      existingUserCode?: string;
      category?: string;
      currentCapital?: number;
      email?: string;
      placeholderEmail?: boolean;
    }>;
    message: string;
  }> {
    const callable =
      httpsCallable<any, any>(
        functions,
        'adminBulkImportInvestorsCallable'
      );

    const response =
      await callable(params);

    return response.data;
  },

  /**
   * Invoca la Cloud Function HTTPS Callable `adminReconcileActiveUser`
   * para reconciliar usuarios inconsistentes (Auth existe pero Firestore sin isClaimed).
   */
  async adminReconcileActiveUser(userDocumentId: string): Promise<{ success: boolean; message: string }> {
    const callable = httpsCallable(functions, 'adminReconcileActiveUser');
    const response = await callable({ userDocumentId });
    return response.data as { success: boolean; message: string };
  },

  /**
   * FASE 1B: Invoca la Cloud Function HTTPS Callable `claimAccountCallable`
   * para activar un perfil legacy en Firebase Auth y crear la identidad canónica /users/{firebaseAuthUid}.
   * El cliente suministra identifier, activationToken, email y password.
   * El email y el identificador de operación se determinan de manera autoritativa en el servidor.
   */
  async claimAccountCallable(payload: {
    identifier: string;
    activationToken: string;
    email: string;
    password: string;
    clientRequestId?: string;
  }): Promise<{ success: boolean; message: string; uid?: string; email?: string }> {
    const callable = httpsCallable(functions, 'claimAccountCallable');
    const response = await callable(payload);
    return response.data as { success: boolean; message: string; uid?: string; email?: string };
  },

  /**
   * FASE 1B: Invoca la Cloud Function HTTPS Callable `adminGenerateActivationToken`
   * para generar un activationToken criptográfico de alta entropía. Solo SuperAdmin.
   */
  async adminGenerateActivationToken(legacyUserDocumentId: string): Promise<{
    success: boolean;
    token: string;
    expiresAt: string;
    userCode: string;
    fullName: string;
  }> {
    const callable = httpsCallable(functions, 'adminGenerateActivationToken');
    const response = await callable({ legacyUserDocumentId });
    return response.data as {
      success: boolean;
      token: string;
      expiresAt: string;
      userCode: string;
      fullName: string;
    };
  },

  /**
   * Corrección autoritativa del capital por SuperAdmin.
   * El navegador NO escribe currentCapital/category directamente.
   */
  async adminUpdateInvestorCapital(params: {
    targetUid: string;
    currentCapital: number;
    userPercentage: number;
    adminPercentage: number;
  }): Promise<{
    success: boolean;
    targetUserDocId: string;
    currentCapital: number;
    category: BitacoraCategory;
    userPercentage: number;
    adminPercentage: number;
    preparingCycleId: string;
    message: string;
  }> {
    const callable = httpsCallable<
      {
        targetUid: string;
        currentCapital: number;
        userPercentage: number;
        adminPercentage: number;
      },
      {
        success: boolean;
        targetUserDocId: string;
        currentCapital: number;
        category: BitacoraCategory;
        userPercentage: number;
        adminPercentage: number;
        preparingCycleId: string;
        message: string;
      }
    >(
      functions,
      'adminUpdateInvestorCapitalCallable'
    );

    const response =
      await callable(params);

    return response.data;
  },

  async saveUser(user: UserProfile) {
    const targetUid = user.uid || user.id;

    // Separar campos autoritativos del payload cliente legítimo
    const {
      currentCapital,
      baseCapital,
      category,
      entryCycleId,
      role,
      status,
      userPercentage,
      adminPercentage,
      userCode,
      createdAt,
      entryDate,
      isClaimed,
      claimedAt,
      migrationStatus,
      id,
      uid,
      password,
      ...safeClientUser
    } = user;

    const normalizedUser: Record<string, any> = {
      ...safeClientUser,
      id: targetUid,
      uid: targetUid,
    };

    if (!user.tradeNotificationAlias || !user.tradeNotificationAlias.trim()) {
      normalizedUser.tradeNotificationAlias = deleteField();
    } else {
      normalizedUser.tradeNotificationAlias = user.tradeNotificationAlias.trim();
    }

    const userRef = doc(db, 'users', targetUid);
    await setDoc(userRef, normalizedUser, { merge: true });
  },

  async getUser(id: string): Promise<UserProfile | null> {
    const snap = await getDoc(doc(db, 'users', id));
    return snap.exists() ? (snap.data() as UserProfile) : null;
  },

  async getAllUsers(): Promise<UserProfile[]> {
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs.map((d) => d.data() as UserProfile);
  },

  async deleteUser(
    id: string,
    confirmation: string
  ): Promise<{
    success: boolean;
    message?: string;
    deletedUserId?: string;
    deletedUserCode?: string;
  }> {
    const callable = httpsCallable<
      {
        userId: string;
        confirmation: string;
      },
      {
        success: boolean;
        message?: string;
        deletedUserId?: string;
        deletedUserCode?: string;
      }
    >(
      functions,
      'adminDeleteUserCallable'
    );

    const res = await callable({
      userId: id,
      confirmation,
    });

    if (!res.data?.success) {
      throw new Error(
        res.data?.message ||
        'El servidor no confirmo la eliminacion del inversionista.'
      );
    }

    return res.data;
  },

  // ==========================================
  // --- TOKENS FCM (users/{userUid}/pushTokens/{tokenId}) ---
  // ==========================================
  async savePushToken(userUid: string, tokenData: UserPushToken): Promise<void> {
    if (!userUid || !tokenData.id) return;
    const tokenRef = doc(db, 'users', userUid, 'pushTokens', tokenData.id);
    await setDoc(tokenRef, tokenData, { merge: true });
  },

  async deletePushToken(userUid: string, tokenId: string): Promise<void> {
    if (!userUid || !tokenId) return;
    const tokenRef = doc(db, 'users', userUid, 'pushTokens', tokenId);
    await deleteDoc(tokenRef);
  },

  async getUserPushTokens(userUid: string): Promise<UserPushToken[]> {
    if (!userUid) return [];
    const snap = await getDocs(collection(db, 'users', userUid, 'pushTokens'));
    return snap.docs.map((d) => d.data() as UserPushToken);
  },

  // ==========================================
  // --- CICLOS MENSUALES Y RESÚMENES FINANCIEROS ---
  // ==========================================
  /**
   * Guarda los metadatos públicos en `monthlyCycles/{cycleId}` y
   * segrega las métricas confidenciales en `cycleFinancialSummaries/{cycleId}`.
   */
  async saveCycle(cycle: MonthlyCycle, financialSummary?: CycleFinancialSummary) {
    const cycleId = cycle.cycleId || cycle.id;
    
    // 1. Datos públicos del ciclo (Accesibles por usuarios autenticados)
    // EXCLUSIÓN ESTRICTA: Los campos de ciclo de vida/cierre (status, isClosing, closedAt, closedBy, closureAttemptId, etc.)
    // son autoritativos de backend y NUNCA deben sobreescribirse desde sincronizaciones cliente.
    const publicCycleData: Partial<MonthlyCycle> = {
      id: cycleId,
      cycleId: cycleId,
      name: cycle.name,
      trmApplied: cycle.trmApplied,
      openedAt: cycle.openedAt || new Date().toISOString(),
      notificationsSent: !!cycle.notificationsSent,
      notificationsSentAt: cycle.notificationsSentAt || null,
      // Mantener campos numéricos básicos si existen para compatibilidad en memoria
      totalManagedCapital: cycle.totalManagedCapital,
      totalGrossUsd: cycle.totalGrossUsd,
      totalGrossCop: cycle.totalGrossCop,
      totalUsersProfitCop: cycle.totalUsersProfitCop,
      totalAdminCommissionCop: cycle.totalAdminCommissionCop,
      totalUsersActive: cycle.totalUsersActive,
      calculatedUsersCount: cycle.calculatedUsersCount,
      totalGroupsCount: cycle.totalGroupsCount,
      calculatedGroupsCount: cycle.calculatedGroupsCount,
    };

    const cycleRef = doc(db, 'monthlyCycles', cycleId);
    await setDoc(cycleRef, publicCycleData, { merge: true });

    // 2. Métricas confidenciales (Solo Administrador)
    const summaryToSave: CycleFinancialSummary = financialSummary || {
      id: cycleId,
      cycleId: cycleId,
      totalManagedCapital: cycle.totalManagedCapital || 0,
      totalUsersActive: cycle.totalUsersActive || 0,
      calculatedUsersCount: cycle.calculatedUsersCount || 0,
      totalGroupsCount: cycle.totalGroupsCount || 0,
      calculatedGroupsCount: cycle.calculatedGroupsCount || 0,
      totalGrossUsd: cycle.totalGrossUsd || 0,
      totalGrossCop: cycle.totalGrossCop || 0,
      totalUsersProfitCop: cycle.totalUsersProfitCop || 0,
      totalAdminCommissionCop: cycle.totalAdminCommissionCop || 0,
      updatedAt: new Date().toISOString(),
      updatedBy: cycle.closedBy || 'ADMIN',
      reopenAudit: cycle.reopenAudit || [],
    };

    const summaryRef = doc(db, 'cycleFinancialSummaries', cycleId);
    await setDoc(summaryRef, summaryToSave, { merge: true });
  },

  /**
   * Reapertura administrativa autoritativa de ciclo cerrado (Exclusivo SuperAdmin)
   */
  async adminReopenCycleCallable(payload: {
    cycleId: string;
    reason: string;
  }): Promise<{ success: boolean; cycleId: string; status: string; message: string }> {
    const callable = httpsCallable(functions, 'adminReopenCycleCallable');
    const response = await callable(payload);
    return response.data as { success: boolean; cycleId: string; status: string; message: string };
  },

  async getAllCycles(): Promise<MonthlyCycle[]> {
    const snap = await getDocs(collection(db, 'monthlyCycles'));
    return snap.docs.map((d) => d.data() as MonthlyCycle);
  },

  async getFinancialSummary(cycleId: string): Promise<CycleFinancialSummary | null> {
    const snap = await getDoc(doc(db, 'cycleFinancialSummaries', cycleId));
    return snap.exists() ? (snap.data() as CycleFinancialSummary) : null;
  },

  async saveFinancialSummary(summary: CycleFinancialSummary): Promise<void> {
    const summaryRef = doc(db, 'cycleFinancialSummaries', summary.cycleId || summary.id);
    await setDoc(summaryRef, summary, { merge: true });
  },

  async getAllFinancialSummaries(): Promise<CycleFinancialSummary[]> {
    const snap = await getDocs(collection(db, 'cycleFinancialSummaries'));
    return snap.docs.map((d) => d.data() as CycleFinancialSummary);
  },

  // ==========================================
  // --- OPERACIONES DIARIAS (dailyOperations/{operationId}) ---
  // ==========================================
  /**
   * Executar Operación Diaria Servidor / Transacción Atómica (Fase 1)
   */
  async executeAdminDailyOperation(params: {
    action?: string;
    operationIntentId: string;
    payloadFingerprint: string;
    cycleId: string;
    category: BitacoraCategory;
    groupCapitalCop: number;
    date: string;
    amountUsd: number;
    notes?: string;
    targetType?: OperationTargetType;
    targetUserId?: string;
    customAuthorizedUids?: string[];
  }): Promise<{
    success: boolean;
    operation: DailyGroupOperation;
    message: string;
  }> {
    const callable =
      httpsCallable<
        typeof params,
        {
          success: boolean;
          operation: DailyGroupOperation;
          message: string;
        }
      >(
        functions,
        'adminExecuteDailyOperation'
      );

    try {
      const response =
        await callable(params);

      return response.data;
    } catch (err: any) {
      console.error(
        '[FirestoreService] adminExecuteDailyOperation falló. No existe fallback financiero client-side.',
        err?.code,
        err?.message
      );

      throw err;
    }
  },

  /**
   * Ruta legacy deshabilitada.
   */
  async adminCloseDailyOperationsCallable(payload: {
    scope: 'GROUP' | 'GLOBAL';
    cycleId: string;
    category?: string;
    groupCapitalCop?: number;
    clientRequestId: string;
  }): Promise<{
    success: boolean;
    alreadyClosed?: boolean;
    scope: 'GROUP' | 'GLOBAL';
    cycleId: string;
    closureId: string;
    closedOperationsCount: number;
    totalUsdClosed: number;
    operationIds: string[];
    message: string;
  }> {

    const callable =
      httpsCallable<any, any>(
        functions,
        'adminCloseDailyOperationsCallable'
      );

    const response =
      await callable(payload);

    return response.data;
  },

  async saveDailyOperation(_op: DailyGroupOperation) {
    throw new Error('Ruta legacy deshabilitada. Toda creación de operaciones financieras debe ejecutarse mediante adminExecuteDailyOperation.');
  },

  async deleteDailyOperation(id: string) {
    await deleteDoc(doc(db, 'dailyOperations', id));
  },

  /**
   * Invoca la Cloud Function HTTPS Callable v2 adminSendTestPush
   * para probar de forma aislada el envío de Notificaciones Push FCM.
   */
  async sendTestPushNotification(
    targetUid: string,
    mode: 'notification' | 'data' = 'notification'
  ): Promise<{
    success: boolean;
    tokenCount: number;
    successCount: number;
    failureCount: number;
    errorCodes: string[];
    message?: string;
  }> {
    try {
      const adminSendTestPushFn = httpsCallable<{ targetUid: string; mode: string }, any>(
        functions,
        'adminSendTestPush'
      );
      const result = await adminSendTestPushFn({ targetUid, mode });
      return result.data;
    } catch (err: any) {
      console.error('[firestoreService] Error enviando Push de prueba:', err);
      return {
        success: false,
        tokenCount: 0,
        successCount: 0,
        failureCount: 0,
        errorCodes: [err.code || err.message || 'unknown_error'],
        message: err.message || 'Error al comunicarse con la Cloud Function de prueba.',
      };
    }
  },

  async getAllDailyOperations(): Promise<DailyGroupOperation[]> {
    const snap = await getDocs(collection(db, 'dailyOperations'));
    return snap.docs.map((d) => d.data() as DailyGroupOperation);
  },

  /**
   * Consulta autorizada para el Cliente:
   * 1. Operaciones donde authorizedUids contiene su authUid.
   * 2. Operaciones globales públicas (isPublicToActiveUsers == true).
   * 3. Compatibilidad temporal histórica (Fase 3) si existe userUid/userId.
   */
  async getDailyOperationsForUser(userUid: string, cycleId?: string): Promise<DailyGroupOperation[]> {
    if (!userUid) return [];

    try {
      const opsCol = collection(db, 'dailyOperations');
      const operationsMap = new Map<string, DailyGroupOperation>();

      // Query 1: Operaciones donde el usuario está en authorizedUids
      const qAuth = cycleId
        ? query(opsCol, where('authorizedUids', 'array-contains', userUid), where('cycleId', '==', cycleId))
        : query(opsCol, where('authorizedUids', 'array-contains', userUid));
      
      const snapAuth = await getDocs(qAuth);
      snapAuth.docs.forEach((d) => operationsMap.set(d.id, d.data() as DailyGroupOperation));

      // Query 2: Operaciones globales públicas
      const qGlobal = cycleId
        ? query(opsCol, where('isPublicToActiveUsers', '==', true), where('cycleId', '==', cycleId))
        : query(opsCol, where('isPublicToActiveUsers', '==', true));
      
      const snapGlobal = await getDocs(qGlobal);
      snapGlobal.docs.forEach((d) => operationsMap.set(d.id, d.data() as DailyGroupOperation));

      // Query 3: Fallback de compatibilidad temporal por userUid
      const qLegacyUid = cycleId
        ? query(opsCol, where('userUid', '==', userUid), where('cycleId', '==', cycleId))
        : query(opsCol, where('userUid', '==', userUid));
      
      const snapLegacyUid = await getDocs(qLegacyUid);
      snapLegacyUid.docs.forEach((d) => operationsMap.set(d.id, d.data() as DailyGroupOperation));

      return Array.from(operationsMap.values()).sort((a, b) => b.date.localeCompare(a.date));
    } catch (err) {
      console.warn('[Firestore] Error consultando operaciones para usuario:', err);
      return [];
    }
  },

  // ==========================================
  // --- CÁLCULOS Y LIQUIDACIONES ---
  // ==========================================
  async saveGroupCalculation(calc: CycleGroupCalculation) {
    const calcRef = doc(db, 'cycleGroupCalculations', calc.id);
    await setDoc(calcRef, calc, { merge: true });
  },

  async deleteGroupCalculation(id: string) {
    await deleteDoc(doc(db, 'cycleGroupCalculations', id));
  },

  async getAllGroupCalculations(): Promise<CycleGroupCalculation[]> {
    const snap = await getDocs(collection(db, 'cycleGroupCalculations'));
    return snap.docs.map((d) => d.data() as CycleGroupCalculation);
  },

  async saveUserResult(result: CycleUserResult) {
    const userUid = result.userUid || result.userId;
    const docId = result.id || `${result.cycleId}_${userUid}`;
    const normalizedResult: CycleUserResult = {
      ...result,
      id: docId,
      userUid: userUid,
      userId: userUid,
    };
    const resRef = doc(db, 'cycleUserResults', docId);
    await setDoc(resRef, normalizedResult, { merge: true });
  },

  async deleteUserResult(id: string) {
    await deleteDoc(doc(db, 'cycleUserResults', id));
  },

  async getAllUserResults(): Promise<CycleUserResult[]> {
    const snap = await getDocs(collection(db, 'cycleUserResults'));
    return snap.docs.map((d) => d.data() as CycleUserResult);
  },

  async getUserResultForUser(userUid: string, cycleId: string): Promise<CycleUserResult | null> {
    if (!userUid || !cycleId) return null;
    const docId = `${cycleId}_${userUid}`;
    const snap = await getDoc(doc(db, 'cycleUserResults', docId));
    if (snap.exists()) {
      return snap.data() as CycleUserResult;
    }
    // Fallback temporal si el ID antiguo usaba otro formato
    const q = query(
      collection(db, 'cycleUserResults'),
      where('cycleId', '==', cycleId),
      where('userUid', '==', userUid)
    );
    const querySnap = await getDocs(q);
    return querySnap.empty ? null : (querySnap.docs[0].data() as CycleUserResult);
  },

  // ==========================================
  // --- SOLICITUDES (Reinversiones, Desembolsos, Inversiones) ---
  // ==========================================
  async submitReinvestmentRequestCallable(payload: {
    modality: 'PROFIT_REINVESTMENT' | 'CAPITAL_INJECTION';
    sourceCycleId: string;
    selectedReinvestmentCop?: number;
    desiredCapitalIncreaseCop?: number;
    clientRequestId?: string;
  }): Promise<{ success: boolean; reinvestment: ReinvestmentRequest; message?: string }> {
    const callable = httpsCallable(functions, 'submitReinvestmentRequestCallable');
    const response = await callable(payload);
    return response.data as { success: boolean; reinvestment: ReinvestmentRequest; message?: string };
  },

  async adminResolveReinvestmentCallable(payload: {
    reinvestmentId: string;
    action: 'APPROVE' | 'PREAPPROVE' | 'CONFIRM_CASH_AND_APPROVE' | 'REJECT' | 'NEEDS_REVIEW';
    rejectionReason?: string;
  }): Promise<{ success: boolean; reinvestment: ReinvestmentRequest; message: string }> {
    const callable = httpsCallable(functions, 'adminResolveReinvestmentCallable');
    const response = await callable(payload);
    return response.data as { success: boolean; reinvestment: ReinvestmentRequest; message: string };
  },

  /**
   * Vista Previa / Dry Run de Solicitudes Huérfanas
   */
  async adminPreviewOrphanReinvestmentsCallable(): Promise<{
    success: boolean;
    totalScanned: number;
    orphanCount: number;
    protectedCount: number;
    candidates: any[];
    protectedItems: any[];
  }> {
    const callable = httpsCallable(functions, 'adminPreviewOrphanReinvestmentsCallable');
    const response = await callable({});
    return response.data as any;
  },

  /**
   * Purga Definitiva de Solicitudes Huérfanas (SuperAdmin)
   */
  async adminPurgeOrphanReinvestmentsCallable(payload: {
    documentIds: string[];
    confirmationPhrase: string;
  }): Promise<{
    success: boolean;
    purgedCount: number;
    skippedCount: number;
    purgedIds: string[];
    skipped: any[];
    message: string;
  }> {
    const callable = httpsCallable(functions, 'adminPurgeOrphanReinvestmentsCallable');
    const response = await callable(payload);
    return response.data as any;
  },

  /**
   * Cierre autoritativo de ciclo y aplicación atómica de reinversiones en servidor
   */
  async adminCloseCycleCallable(payload: {
    cycleId: string;
    closingTrm: number;
    adminNotes?: string;
    clientRequestId?: string;
  }): Promise<{
    success: boolean;
    cycleId: string;
    cycleClosed: boolean;
    closingTrm?: number;
    closingTrmSetAt?: string;
    closingTrmSetByUid?: string;
    closingTrmSetByName?: string;
    observedMarketTrmAtClose?: number | null;
    totalGrossUsd?: number;
    totalGrossCop?: number;
    totalUsersProfitCop?: number;
    totalAdminCommissionCop?: number;
    code?: string;
    pendingCount?: number;
    needsReviewCount?: number;
    approvedCount?: number;
    rejectedCount?: number;
    alreadyAppliedCount?: number;
    closedAt?: string;
    processedCount: number;
    appliedCount: number;
    failedCount: number;
    conflictCount: number;
    conflicts?: any[];
    failures?: any[];
    appliedReinvestments?: any[];
    message: string;
  }> {
    const callable = httpsCallable(functions, 'adminCloseCycleCallable');
    const response = await callable(payload);
    return response.data as any;
  },

  /**
   * Desbloqueo administrativo de ciclo bloqueado con lock huérfano (Exclusivo SuperAdmin)
   */
  async adminUnlockCycleCallable(payload: {
    cycleId: string;
    expectedClosureAttemptId: string;
    confirmation: string;
    reason: string;
  }): Promise<{ success: boolean; message: string; cycleId?: string; closureAttemptId?: string }> {
    const callable = httpsCallable(functions, 'adminUnlockCycleCallable');
    const response = await callable(payload);
    return response.data as { success: boolean; message: string; cycleId?: string; closureAttemptId?: string };
  },

  /**
   * Confirmación administrativa de recepción de aporte externo (Exclusivo SuperAdmin)
   */
  async adminConfirmExternalContributionCallable(payload: {
    requestId: string;
    confirmedAmountCop: number;
    bankReference?: string;
    notes?: string;
  }): Promise<{
    success: boolean;
    alreadyConfirmed?: boolean;
    requestId: string;
    message: string;
    confirmedAmountCop: number;
    confirmedAt: string;
  }> {
    const callable = httpsCallable(functions, 'adminConfirmExternalContributionCallable');
    const response = await callable(payload);
    return response.data as {
      success: boolean;
      alreadyConfirmed?: boolean;
      requestId: string;
      message: string;
      confirmedAmountCop: number;
      confirmedAt: string;
    };
  },

  /**
   * Resuelve conciliaciones en estado NEEDS_REVIEW (Exclusivo SuperAdmin)
   */
  async adminResolveFundingReconciliationCallable(payload: {
    requestId: string;
    resolution: 'RESOLVE_MATCHING' | 'KEEP_REVIEW';
    notes?: string;
    clientRequestId: string;
  }): Promise<{
    success: boolean;
    message: string;
  }> {
    const callable = httpsCallable(functions, 'adminResolveFundingReconciliationCallable');
    const response = await callable(payload);
    return response.data as { success: boolean; message: string };
  },

  /**
   * Radica solicitud de desembolso (Exclusivo SuperAdmin)
   */
  async adminRequestDisbursementCallable(payload: {
    userId: string;
    sourceCycleId: string;
    amountCop: number;
    disbursementSource?: 'PROFIT' | 'CAPITAL' | 'MIXED';
    method: 'TRANSFERENCIA' | 'EFECTIVO';
    bankName?: string;
    accountType?: string;
    accountNumber?: string;
    accountHolderName?: string;
    idDocument?: string;
    cashOffice?: string;
    receiverId?: string;
    receiverFullName?: string;
    notes?: string;
    clientRequestId: string;
  }): Promise<{
    success: boolean;
    disbursement: any;
    message: string;
  }> {
    const callable = httpsCallable(functions, 'adminRequestDisbursementCallable');
    const response = await callable(payload);
    return response.data as { success: boolean; disbursement: any; message: string };
  },

  /**
   * Resuelve solicitud de desembolso (Exclusivo SuperAdmin)
   */
  async adminResolveDisbursementCallable(payload: {
    requestId: string;
    action: 'APPROVE' | 'PAY' | 'REJECT';
    notes?: string;
    voucher?: string;
  }): Promise<{
    success: boolean;
    disbursement: any;
    message: string;
  }> {
    const callable = httpsCallable(functions, 'adminResolveDisbursementCallable');
    const response = await callable(payload);
    return response.data as { success: boolean; disbursement: any; message: string };
  },

  /**
   * Inicio operativo y congelamiento de capitales del ciclo (Exclusivo SuperAdmin)
   */
  async adminStartCycleCallable(payload: {
    cycleId: string;
    clientRequestId: string;
  }): Promise<{
    success: boolean;
    cycleId: string;
    alreadyStarted?: boolean;
    operationalStatus: 'STARTED';
    startedAt: string;
    initialManagedCapitalCop: number;
    initialActiveUsersCount: number;
    reinvestmentsAppliedCount?: number;
    usersCapitalUpdatedCount?: number;
    message: string;
  }> {
    const callable = httpsCallable(functions, 'adminStartCycleCallable');
    const response = await callable(payload);
    return response.data as {
      success: boolean;
      cycleId: string;
      alreadyStarted?: boolean;
      operationalStatus: 'STARTED';
      startedAt: string;
      initialManagedCapitalCop: number;
      initialActiveUsersCount: number;
      reinvestmentsAppliedCount?: number;
      usersCapitalUpdatedCount?: number;
      message: string;
    };
  },

  async adminCreateNextCycleCallable(payload: {
    sourceCycleId: string;
    name: string;
    clientRequestId: string;
  }): Promise<{
    success: boolean;
    cycleId: string;
    idempotentReplay?: boolean;
  }> {
    const callable = httpsCallable(functions, 'adminCreateNextCycleCallable');
    const response = await callable(payload);

    return response.data as {
      success: boolean;
      cycleId: string;
      idempotentReplay?: boolean;
    };
  },

  async adminCreateGenesisCycleCallable(payload: {
    name: string;
    clientRequestId: string;
  }): Promise<{
    success: boolean;
    cycleId: string;
    operationalStatus?: 'PREPARING';
    message?: string;
    idempotentReplay?: boolean;
    cycle?: any;
  }> {
    const callable = httpsCallable(functions, 'adminCreateGenesisCycleCallable');
    const response = await callable(payload);
    return response.data as {
      success: boolean;
      cycleId: string;
      operationalStatus?: 'PREPARING';
      message?: string;
      idempotentReplay?: boolean;
      cycle?: any;
    };
  },

  async saveReinvestment(reinv: ReinvestmentRequest) {
    // Reglas de seguridad endurecidas: toda mutación debe realizarse por Cloud Functions autoritativas.
    // Se mantiene soporte en memoria y advertencia si se invoca directamente.
    const normalized: ReinvestmentRequest = {
      ...reinv,
      userId: reinv.userUid || reinv.userId,
      userUid: reinv.userUid || reinv.userId,
    };
    try {
      await setDoc(doc(db, 'reinvestments', reinv.id), normalized, { merge: true });
    } catch (err) {
      console.warn('[firestoreService.saveReinvestment] Escritura directa bloqueada por reglas de seguridad (comportamiento esperado por arquitectura). La mutación autoritativa debe ser procesada por Cloud Functions:', err);
    }
  },

  async getAllReinvestments(): Promise<ReinvestmentRequest[]> {
    const snap = await getDocs(collection(db, 'reinvestments'));
    return snap.docs.map((d) => ({
      ...(d.data() as ReinvestmentRequest),
      id: d.id,
    }));
  },

  async saveDisbursement(disb: DisbursementRequest) {
    const normalized: DisbursementRequest = {
      ...disb,
      userId: disb.userUid || disb.userId,
      userUid: disb.userUid || disb.userId,
    };
    await setDoc(doc(db, 'disbursements', disb.id), normalized, { merge: true });
  },

  async getAllDisbursements(): Promise<DisbursementRequest[]> {
    const snap = await getDocs(collection(db, 'disbursements'));
    return snap.docs.map((d) => d.data() as DisbursementRequest);
  },

  async saveInvestment(inv: InvestmentRequest) {
    const normalized: InvestmentRequest = {
      ...inv,
      userId: inv.userUid || inv.userId,
      userUid: inv.userUid || inv.userId,
    };
    await setDoc(doc(db, 'investments', inv.id), normalized, { merge: true });
  },

  async getAllInvestments(): Promise<InvestmentRequest[]> {
    const snap = await getDocs(collection(db, 'investments'));
    return snap.docs.map((d) => d.data() as InvestmentRequest);
  },

  // ==========================================
  // --- PURGA Y LIMPIEZA DE USUARIOS DE PRUEBA ---
  // ==========================================
  async adminPurgeNonAdminUsersCallable(params: {
    confirmation?: string;
    dryRun?: boolean;
    deleteTestFinancialData?: boolean;
    resetUserCounter?: boolean;
  }): Promise<{
    success: boolean;
    dryRun: boolean;
    authUsersToDelete: number;
    authUsersDeleted: number;
    firestoreUsersToDelete: number;
    firestoreUsersDeleted: number;
    pushTokensToDelete: number;
    pushTokensDeleted: number;
    cycleUserResultsToDelete: number;
    cycleUserResultsDeleted: number;
    reinvestmentsToDelete: number;
    reinvestmentsDeleted: number;
    disbursementsToDelete: number;
    disbursementsDeleted: number;
    investmentsToDelete: number;
    investmentsDeleted: number;
    notificationsToDelete: number;
    notificationsDeleted: number;
    notificationsUpdated: number;
    claimOperationsToDelete: number;
    claimOperationsDeleted: number;
    dailyOperationsAffected: number;
    dailyOperationsDeleted: number;
    userCounterReset: boolean;
    protectedUsersCount: number;
    errors: string[];
  }> {
    const purgeFn = httpsCallable(functions, 'adminPurgeNonAdminUsers');
    const response = await purgeFn(params);
    return response.data as any;
  },

  /**
   * PURGA SEGURA DE DATOS DE PRUEBA DEL CICLO ACTIVO DE TRADING (Callable)
   * Alcance único: TEST_CLEANUP_ACTIVE_CYCLE
   * Solo SuperAdmin.
   */
  async adminPurgeTradingTestDataCallable(params: {
    dryRun?: boolean;
    confirmation?: string;
    cycleId?: string;
  }): Promise<{
    success: boolean;
    dryRun: boolean;
    scope: string;
    cycleId: string;
    cycleStatus: string;
    activeInvestorCount: number;
    dailyOperations: number;
    cycleGroupCalculations: number;
    cycleUserResults: number;
    tradingNotifications: number;
    totalDocuments: number;
    message: string;
    deletedCounts?: {
      dailyOperations: number;
      cycleGroupCalculations: number;
      cycleUserResults: number;
      tradingNotifications: number;
      totalDocuments: number;
    };
  }> {
    const purgeFn = httpsCallable(functions, 'adminPurgeTradingTestData');
    const response = await purgeFn(params);
    return response.data as any;
  },

  // ==========================================
  // --- POSTULACIONES FIFO ---
  // ==========================================
  /**
   * FASE 1B: Envío seguro de postulación mediante Cloud Function HTTPS Callable.
   * Valida whitelist, datos y calcula queuePosition exclusivamente del lado servidor.
   */
  async submitApplicationCallable(payload: {
    fullName: string;
    documentId: string;
    email: string;
    phone: string;
    city?: string;
    requestedCapitalCop: number;
    originBank?: string;
    priorityNotes?: string;
  }): Promise<{ success: boolean; applicationId: string; queuePosition: number }> {
    const callable = httpsCallable(functions, 'submitApplicationCallable');
    const response = await callable(payload);
    return response.data as { success: boolean; applicationId: string; queuePosition: number };
  },

  async saveApplication(app: InvestorApplication) {
    // FASE 1B: Delegación estricta a Cloud Function Callable con validación de backend
    const res = await this.submitApplicationCallable({
      fullName: app.fullName,
      documentId: app.documentId,
      email: app.email,
      phone: app.phone,
      city: app.city,
      requestedCapitalCop: app.requestedCapitalCop,
      originBank: app.originBank,
      priorityNotes: app.priorityNotes,
    });
    if (res && res.applicationId) {
      app.id = res.applicationId;
      app.queuePosition = res.queuePosition;
    }
  },

  async saveApplicationsBatch(apps: InvestorApplication[]) {
    for (const app of apps) {
      try {
        const appRef = doc(db, 'investorApplications', app.id);
        await setDoc(appRef, app, { merge: true });
      } catch (err) {
        console.warn(`Error al guardar solicitud ${app.id} en Firestore:`, err);
      }
    }
  },

  async getAllApplications(): Promise<InvestorApplication[]> {
    const snap = await getDocs(collection(db, 'investorApplications'));
    return snap.docs.map((d) => d.data() as InvestorApplication);
  },

  async deleteApplication(id: string): Promise<void> {
    const appRef = doc(db, 'investorApplications', id);
    await deleteDoc(appRef);
    try {
      const altRef = doc(db, 'applications', id);
      await deleteDoc(altRef);
    } catch {
      // Ignorar
    }
  },

  // ==========================================
  // --- NOTIFICACIONES (Idempotencia & Destinatarios) ---
  // ==========================================
  async saveNotification(notif: NotificationItem) {
    const normalized: NotificationItem = {
      ...notif,
      targetType: notif.targetType || (notif.targetUserUid ? 'INDIVIDUAL' : 'CATEGORY'),
      targetUids: notif.targetUids || (notif.targetUserUid ? [notif.targetUserUid] : (notif.userUid ? [notif.userUid] : [])),
      deliveryStatus: notif.deliveryStatus || 'PENDING',
    };
    await setDoc(doc(db, 'notifications', notif.id), normalized, { merge: true });
  },

  async saveNotificationsBatch(notifs: NotificationItem[]) {
    for (const notif of notifs) {
      try {
        await this.saveNotification(notif);
      } catch (err) {
        console.warn(`Error al guardar notificación ${notif.id} en Firestore:`, err);
      }
    }
  },

  async getAllNotifications(): Promise<NotificationItem[]> {
    const snap = await getDocs(collection(db, 'notifications'));
    return snap.docs.map((d) => d.data() as NotificationItem);
  },

  async deleteNotification(id: string) {
    await deleteDoc(doc(db, 'notifications', id));
  },

  async markNotificationAsRead(id: string) {
    const ref = doc(db, 'notifications', id);
    await updateDoc(ref, {
      isRead: true,
      readAt: new Date().toISOString()
    });
  },

  async markAllNotificationsAsRead(notifIds: string[]) {
    const chunkSize = 400;
    for (let i = 0; i < notifIds.length; i += chunkSize) {
      const chunk = notifIds.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      for (const id of chunk) {
        const ref = doc(db, 'notifications', id);
        batch.update(ref, {
          isRead: true,
          readAt: new Date().toISOString()
        });
      }
      await batch.commit();
    }
  },

  async hideNotification(id: string) {
    const ref = doc(db, 'notifications', id);
    await updateDoc(ref, {
      hiddenByUser: true,
      hiddenAt: new Date().toISOString()
    });
  },

  async hideNotificationsBatch(notifIds: string[]) {
    const chunkSize = 400;
    for (let i = 0; i < notifIds.length; i += chunkSize) {
      const chunk = notifIds.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      for (const id of chunk) {
        const ref = doc(db, 'notifications', id);
        batch.update(ref, {
          hiddenByUser: true,
          hiddenAt: new Date().toISOString()
        });
      }
      await batch.commit();
    }
  },

  // ==========================================
  // --- CONFIGURACIÓN GLOBAL & AUDITORÍA ---
  // ==========================================
  async saveSettings(config: GlobalConfig) {
    const {
      activeCycleId,
      operationalCycleId,
      preparingCycleId,
      ...safeClientSettings
    } = config;
    await setDoc(doc(db, 'settings', 'global_config'), safeClientSettings, { merge: true });
  },

  async getSettings(): Promise<GlobalConfig | null> {
    const snap = await getDoc(doc(db, 'settings', 'global_config'));
    return snap.exists() ? (snap.data() as GlobalConfig) : null;
  },

  async logAudit(log: AuditLog) {
    await setDoc(doc(db, 'auditLogs', log.id), log, { merge: true });
  },

  async getAllAuditLogs(): Promise<AuditLog[]> {
    const snap = await getDocs(collection(db, 'auditLogs'));
    return snap.docs.map((d) => d.data() as AuditLog);
  },

  async findUserByCodeOrDoc(identifier: string): Promise<UserProfile | null> {
    try {
      const clean = identifier.trim().toUpperCase();
      const snap = await getDocs(collection(db, 'users'));
      const foundDoc = snap.docs.find((d) => {
        const u = d.data() as UserProfile;
        return (
          u.userCode?.toUpperCase() === clean ||
          u.documentId?.trim() === identifier.trim() ||
          u.email?.trim().toLowerCase() === identifier.trim().toLowerCase()
        );
      });
      return foundDoc ? (foundDoc.data() as UserProfile) : null;
    } catch (err) {
      console.warn('[Firestore] Error looking up user by code:', err);
      return null;
    }
  },

  // ==========================================
  // --- LISTENERS EN TIEMPO REAL SEGUROS ---
  // ==========================================
  listenUsers(onUpdate: (users: UserProfile[]) => void): () => void {
    try {
      return onSnapshot(
        collection(db, 'users'),
        (snapshot) => {
          const users = snapshot.docs.map((d) => d.data() as UserProfile);
          onUpdate(users);
        },
        (error) => console.error('[FirestoreService] Error en snapshot de usuarios (Admin):', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener de usuarios no disponible:', err);
      return () => {};
    }
  },

  /**
   * Listener de Perfil Canónico Exclusivo para el Inversionista:
   * Solo consulta su documento canónico /users/{userUid}. PROHIBIDO consultar collection('users').
   */
  listenUserProfile(userUid: string, onUpdate: (user: UserProfile | null) => void): () => void {
    if (!userUid) return () => {};
    try {
      const userRef = doc(db, 'users', userUid);
      return onSnapshot(
        userRef,
        (snapshot) => {
          if (snapshot.exists()) {
            onUpdate(snapshot.data() as UserProfile);
          } else {
            onUpdate(null);
          }
        },
        (error) => console.error('[FirestoreService] Error en snapshot de perfil de usuario:', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener de perfil no disponible:', err);
      return () => {};
    }
  },

  /**
   * Listener de Operaciones Diarias para Administrador (Todas las operaciones)
   */
  listenDailyOperations(onUpdate: (ops: DailyGroupOperation[]) => void): () => void {
    try {
      return onSnapshot(
        collection(db, 'dailyOperations'),
        (snapshot) => {
          const ops = snapshot.docs.map((d) => d.data() as DailyGroupOperation);
          onUpdate(ops);
        },
        (error) => console.error('[FirestoreService] Error en snapshot de operaciones (Admin):', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener de operaciones no disponible:', err);
      return () => {};
    }
  },

  /**
   * Listener de Operaciones Diarias Aislado y Seguro para el Inversionista:
   * Ejecuta dos consultas:
   * A) where('authorizedUids', 'array-contains', userUid)
   * B) where('isPublicToActiveUsers', '==', true)
   * Unifica y deduplica por document ID antes de emitir.
   */
  listenDailyOperationsForUser(userUid: string, onUpdate: (ops: DailyGroupOperation[]) => void): () => void {
    if (!userUid) return () => {};

    let listSpecific: DailyGroupOperation[] = [];
    let listGlobal: DailyGroupOperation[] = [];

    const mergeAndEmit = () => {
      const map = new Map<string, DailyGroupOperation>();
      for (const op of listSpecific) {
        if (op && op.id) map.set(op.id, op);
      }
      for (const op of listGlobal) {
        if (op && op.id) map.set(op.id, op);
      }
      const merged = Array.from(map.values()).sort(
        (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
      );
      onUpdate(merged);
    };

    let unsubSpecific = () => {};
    let unsubGlobal = () => {};

    try {
      const qSpecific = query(
        collection(db, 'dailyOperations'),
        where('authorizedUids', 'array-contains', userUid)
      );
      unsubSpecific = onSnapshot(
        qSpecific,
        (snapshot) => {
          listSpecific = snapshot.docs.map((d) => d.data() as DailyGroupOperation);
          mergeAndEmit();
        },
        (error) => console.error('[FirestoreService] Error en snapshot operaciones (authorizedUids):', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Error al inicializar listener operaciones (authorizedUids):', err);
    }

    try {
      const qGlobal = query(
        collection(db, 'dailyOperations'),
        where('isPublicToActiveUsers', '==', true)
      );
      unsubGlobal = onSnapshot(
        qGlobal,
        (snapshot) => {
          listGlobal = snapshot.docs.map((d) => d.data() as DailyGroupOperation);
          mergeAndEmit();
        },
        (error) => console.error('[FirestoreService] Error en snapshot operaciones (isPublicToActiveUsers):', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Error al inicializar listener operaciones (isPublicToActiveUsers):', err);
    }

    return () => {
      unsubSpecific();
      unsubGlobal();
    };
  },

  listenCycles(onUpdate: (cycles: MonthlyCycle[]) => void): () => void {
    try {
      return onSnapshot(
        collection(db, 'monthlyCycles'),
        (snapshot) => {
          const cycles = snapshot.docs.map((d) => d.data() as MonthlyCycle);
          onUpdate(cycles);
        },
        (error) => console.error('[FirestoreService] Error en snapshot de ciclos:', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener de ciclos no disponible:', err);
      return () => {};
    }
  },

  listenFinancialSummaries(onUpdate: (summaries: CycleFinancialSummary[]) => void): () => void {
    try {
      return onSnapshot(
        collection(db, 'cycleFinancialSummaries'),
        (snapshot) => {
          const summaries = snapshot.docs.map((d) => d.data() as CycleFinancialSummary);
          onUpdate(summaries);
        },
        (error) => console.error('[FirestoreService] Error en snapshot de resúmenes financieros:', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener de resúmenes financieros no disponible:', err);
      return () => {};
    }
  },

  listenGroupCalculations(onUpdate: (calcs: CycleGroupCalculation[]) => void): () => void {
    try {
      return onSnapshot(
        collection(db, 'cycleGroupCalculations'),
        (snapshot) => {
          const calcs = snapshot.docs.map((d) => d.data() as CycleGroupCalculation);
          onUpdate(calcs);
        },
        (error) => console.error('[FirestoreService] Error en snapshot de cálculos grupales:', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener de cálculos grupales no disponible:', err);
      return () => {};
    }
  },

  listenUserResults(onUpdate: (results: CycleUserResult[]) => void): () => void {
    try {
      return onSnapshot(
        collection(db, 'cycleUserResults'),
        (snapshot) => {
          const results = snapshot.docs.map((d) => d.data() as CycleUserResult);
          onUpdate(results);
        },
        (error) => console.error('[FirestoreService] Error en snapshot de resultados de usuario (Admin):', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener de resultados de usuario no disponible:', err);
      return () => {};
    }
  },

  /**
   * Listener de resultados de liquidación exclusivo para el Inversionista:
   * where('userUid', '==', currentUser.uid)
   */
  listenUserResultsForUser(userUid: string, onUpdate: (results: CycleUserResult[]) => void): () => void {
    if (!userUid) return () => {};
    try {
      const q = query(collection(db, 'cycleUserResults'), where('userUid', '==', userUid));
      return onSnapshot(
        q,
        (snapshot) => {
          const results = snapshot.docs.map((d) => d.data() as CycleUserResult);
          onUpdate(results);
        },
        (error) => console.error('[FirestoreService] Error en snapshot de resultados para usuario:', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener de resultados para usuario no disponible:', err);
      return () => {};
    }
  },

  listenApplications(onUpdate: (apps: InvestorApplication[]) => void): () => void {
    try {
      const appCol = collection(db, 'investorApplications');
      return onSnapshot(
        appCol,
        (snapshot) => {
          const apps = snapshot.docs.map((d) => d.data() as InvestorApplication);
          onUpdate(apps);
        },
        (error) => console.error('[FirestoreService] Error en snapshot de postulaciones (Admin):', error)
      );
    } catch (err) {
      console.error('[FirestoreService] No se pudo inicializar listener de postulaciones:', err);
      return () => {};
    }
  },

  listenReinvestments(onUpdate: (reinvs: ReinvestmentRequest[]) => void): () => void {
    try {
      const reinvCol = collection(db, 'reinvestments');
      return onSnapshot(
        reinvCol,
        (snapshot) => {
          const reinvs = snapshot.docs.map((d) => ({
            ...(d.data() as ReinvestmentRequest),
            id: d.id,
          }));
          onUpdate(reinvs);
        },
        (error) => console.error('[FirestoreService] Error en snapshot de reinversiones (Admin):', error)
      );
    } catch (err) {
      console.error('[FirestoreService] No se pudo inicializar listener de reinversiones:', err);
      return () => {};
    }
  },

  /**
   * Listener de Solicitudes de Reinversión Exclusivo para el Inversionista:
   * where('userUid', '==', currentUser.uid)
   */
  listenReinvestmentsForUser(userUid: string, onUpdate: (reinvs: ReinvestmentRequest[]) => void): () => void {
    if (!userUid) return () => {};
    try {
      const q = query(collection(db, 'reinvestments'), where('userUid', '==', userUid));
      return onSnapshot(
        q,
        (snapshot) => {
          const reinvs = snapshot.docs.map((d) => ({
            ...(d.data() as ReinvestmentRequest),
            id: d.id,
          }));
          onUpdate(reinvs);
        },
        (error) => console.error('[FirestoreService] Error en snapshot de reinversiones para usuario:', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener de reinversiones para usuario no disponible:', err);
      return () => {};
    }
  },

  listenDisbursements(onUpdate: (disbs: DisbursementRequest[]) => void): () => void {
    try {
      return onSnapshot(
        collection(db, 'disbursements'),
        (snapshot) => {
          const disbs = snapshot.docs.map((d) => d.data() as DisbursementRequest);
          onUpdate(disbs);
        },
        (error) => console.error('[FirestoreService] Error en snapshot de desembolsos (Admin):', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener de desembolsos no disponible:', err);
      return () => {};
    }
  },

  /**
   * Listener de Solicitudes de Desembolso Exclusivo para el Inversionista:
   * where('userUid', '==', currentUser.uid)
   */
  listenDisbursementsForUser(userUid: string, onUpdate: (disbs: DisbursementRequest[]) => void): () => void {
    if (!userUid) return () => {};
    try {
      const q = query(collection(db, 'disbursements'), where('userUid', '==', userUid));
      return onSnapshot(
        q,
        (snapshot) => {
          const disbs = snapshot.docs.map((d) => d.data() as DisbursementRequest);
          onUpdate(disbs);
        },
        (error) => console.error('[FirestoreService] Error en snapshot de desembolsos para usuario:', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener de desembolsos para usuario no disponible:', err);
      return () => {};
    }
  },

  listenInvestments(onUpdate: (invs: InvestmentRequest[]) => void): () => void {
    try {
      return onSnapshot(
        collection(db, 'investments'),
        (snapshot) => {
          const invs = snapshot.docs.map((d) => d.data() as InvestmentRequest);
          onUpdate(invs);
        },
        (error) => console.error('[FirestoreService] Error en snapshot de inversiones (Admin):', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener de inversiones no disponible:', err);
      return () => {};
    }
  },

  /**
   * Listener de Inversiones Exclusivo para el Inversionista:
   * where('userUid', '==', currentUser.uid)
   */
  listenInvestmentsForUser(userUid: string, onUpdate: (invs: InvestmentRequest[]) => void): () => void {
    if (!userUid) return () => {};
    try {
      const q = query(collection(db, 'investments'), where('userUid', '==', userUid));
      return onSnapshot(
        q,
        (snapshot) => {
          const invs = snapshot.docs.map((d) => d.data() as InvestmentRequest);
          onUpdate(invs);
        },
        (error) => console.error('[FirestoreService] Error en snapshot de inversiones para usuario:', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener de inversiones para usuario no disponible:', err);
      return () => {};
    }
  },

  listenSettings(onUpdate: (config: GlobalConfig) => void): () => void {
    try {
      return onSnapshot(
        doc(db, 'settings', 'global_config'),
        (snapshot) => {
          if (snapshot.exists()) {
            onUpdate(snapshot.data() as GlobalConfig);
          }
        },
        (error) => console.error('[FirestoreService] Error en snapshot de configuración:', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener de configuración no disponible:', err);
      return () => {};
    }
  },

  listenNotifications(onUpdate: (notifs: NotificationItem[]) => void): () => void {
    try {
      return onSnapshot(
        collection(db, 'notifications'),
        (snapshot) => {
          const notifs = snapshot.docs.map((d) => d.data() as NotificationItem);
          onUpdate(notifs);
        },
        (error) => console.error('[FirestoreService] Error en snapshot de notificaciones (Admin):', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener de notificaciones no disponible:', err);
      return () => {};
    }
  },

  /**
   * Listener de Notificaciones Aislado y Seguro para el Inversionista:
   * Mantiene dos listeners filtrados para compatibilidad histórica:
   * A) where('userUid', '==', currentUser.uid)
   * B) where('targetUids', 'array-contains', currentUser.uid)
   * Unifica y deduplica por document ID antes de emitir.
   */
  listenNotificationsForUser(userUid: string, onUpdate: (notifs: NotificationItem[]) => void): () => void {
    if (!userUid) return () => {};

    let listA: NotificationItem[] = [];
    let listB: NotificationItem[] = [];

    const mergeAndEmit = () => {
      const map = new Map<string, NotificationItem>();
      for (const n of listA) {
        if (n && n.id) map.set(n.id, n);
      }
      for (const n of listB) {
        if (n && n.id) map.set(n.id, n);
      }
      const merged = Array.from(map.values()).sort(
        (a, b) => new Date(b.sentAt || 0).getTime() - new Date(a.sentAt || 0).getTime()
      );
      onUpdate(merged);
    };

    let unsubA = () => {};
    let unsubB = () => {};

    try {
      const qA = query(collection(db, 'notifications'), where('userUid', '==', userUid));
      unsubA = onSnapshot(
        qA,
        (snapshot) => {
          listA = snapshot.docs.map((d) => d.data() as NotificationItem);
          mergeAndEmit();
        },
        (error) => console.error('[FirestoreService] Error en snapshot notificaciones (userUid):', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener notificaciones (userUid) no disponible:', err);
    }

    try {
      const qB = query(collection(db, 'notifications'), where('targetUids', 'array-contains', userUid));
      unsubB = onSnapshot(
        qB,
        (snapshot) => {
          listB = snapshot.docs.map((d) => d.data() as NotificationItem);
          mergeAndEmit();
        },
        (error) => console.error('[FirestoreService] Error en snapshot notificaciones (targetUids):', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener notificaciones (targetUids) no disponible:', err);
    }

    return () => {
      unsubA();
      unsubB();
    };
  },

  listenAuditLogs(onUpdate: (logs: AuditLog[]) => void): () => void {
    try {
      return onSnapshot(
        collection(db, 'auditLogs'),
        (snapshot) => {
          const logs = snapshot.docs.map((d) => d.data() as AuditLog);
          onUpdate(logs);
        },
        (error) => console.error('[FirestoreService] Error en snapshot de auditoría:', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener de auditoría no disponible:', err);
      return () => {};
    }
  },

  async adminSendBroadcastNotification(params: {
    title: string;
    message: string;
    personalizeGreeting: boolean;
    clientRequestId: string;
  }) {
    const callable = httpsCallable<{
      title: string;
      message: string;
      personalizeGreeting: boolean;
      clientRequestId: string;
    }, {
      success: boolean;
      status: string;
      broadcastId: string;
      targetUsersCount: number;
      createdNotificationsCount: number;
      notificationsAlreadyExistedCount: number;
      targetsUnavailableCount: number;
      message: string;
    }>(functions, 'adminSendBroadcastNotificationCallable');

    const result = await callable(params);
    return result.data;
  },

  async adminUpdateCycleTrm(params: {
    cycleId: string;
    clientRequestId: string;
    reason?: string;
  }) {
    const callable =
      httpsCallable<
        {
          cycleId: string;
          clientRequestId: string;
          reason?: string;
        },
        {
          success: boolean;

          idempotentReplay?: boolean;

          cycleId: string;

          previousTrm?:
            | number
            | null;

          // newTrm ES RESPUESTA DEL SERVIDOR.
          // Nunca es entrada del navegador.
          newTrm: number;

          trmSource?:
            | string
            | null;

          trmSourceUrl?:
            | string
            | null;

          trmEffectiveDate?:
            | string
            | null;

          trmCapturedAt?:
            | string
            | null;

          trmRateCents?:
            | number
            | null;

          affectedUsersCount:
            number;

          affectedGroupsCount:
            number;

          affectedReinvestmentsCount:
            number;

          needsReviewCount:
            number;

          message:
            string;
        }
      >(
        functions,
        'adminUpdateCycleTrmCallable'
      );

    const result =
      await callable(params);

    return result.data;
  },

  // ==========================================
  // --- MÓDULO DE SOPORTE TÉCNICO Y PERMISOS ---
  // ==========================================

  async adminUpdateSupportPermissions(params: {
    targetUid: string;
    permissions: {
      supportAgent: boolean;
      supportReadUserContext?: boolean;
      supportReadOperationalContext?: boolean;
    };
    clientRequestId: string;
  }) {
    const callable = httpsCallable<typeof params, {
      success: boolean;
      targetUid: string;
      permissions: any;
      idempotentReplay?: boolean;
    }>(functions, 'adminUpdateSupportPermissionsCallable');
    const result = await callable(params);
    return result.data;
  },

  async supportCreateTicket(params: {
    subject: string;
    category: string;
    description: string;
    clientRequestId?: string;
  }) {
    const callable = httpsCallable<typeof params, {
      success: boolean;
      ticketId: string;
      ticketNumber: string;
      idempotentReplay?: boolean;
    }>(functions, 'supportCreateTicketCallable');
    const result = await callable(params);
    return result.data;
  },

  async supportReplyTicket(params: {
    ticketId: string;
    text: string;
    clientRequestId?: string;
  }) {
    const callable = httpsCallable<typeof params, {
      success: boolean;
      messageId: string;
      status: string;
    }>(functions, 'supportReplyTicketCallable');
    const result = await callable(params);
    return result.data;
  },

  async supportAddInternalNote(params: {
    ticketId: string;
    noteText: string;
    clientRequestId?: string;
  }) {
    const callable = httpsCallable<typeof params, {
      success: boolean;
      noteId: string;
    }>(functions, 'supportAddInternalNoteCallable');
    const result = await callable(params);
    return result.data;
  },

  async supportAssignTicket(params: {
    ticketId: string;
    assignedToUid?: string;
    clientRequestId?: string;
  }) {
    const callable = httpsCallable<typeof params, {
      success: boolean;
      ticketId: string;
      assignedToUid: string;
      assignedToName: string;
      status: string;
    }>(functions, 'supportAssignTicketCallable');
    const result = await callable(params);
    return result.data;
  },

  async supportUpdateTicketStatus(params: {
    ticketId: string;
    status: string;
    reason?: string;
    clientRequestId?: string;
  }) {
    const callable = httpsCallable<typeof params, {
      success: boolean;
      ticketId: string;
      previousStatus: string;
      newStatus: string;
    }>(functions, 'supportUpdateTicketStatusCallable');
    const result = await callable(params);
    return result.data;
  },

  async supportGetUserContext(params: {
    ticketId: string;
  }) {
    const callable = httpsCallable<typeof params, {
      success: boolean;
      hasUserContext: boolean;
      hasOperationalContext: boolean;
      user?: any;
      operationalContext?: any;
      message?: string;
    }>(functions, 'supportGetUserContextCallable');
    const result = await callable(params);
    return result.data;
  },

  listenSupportTickets(onUpdate: (tickets: SupportTicket[]) => void): () => void {
    try {
      const q = query(collection(db, 'supportTickets'), orderBy('updatedAt', 'desc'));
      return onSnapshot(
        q,
        (snapshot) => {
          const tickets = snapshot.docs.map((d) => ({
            ticketId: d.id,
            ...(d.data() as SupportTicket),
          }));
          onUpdate(tickets);
        },
        (error) => console.error('[FirestoreService] Error en snapshot de tickets de soporte:', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener de tickets no disponible:', err);
      return () => {};
    }
  },

  listenUserSupportTickets(userUid: string, onUpdate: (tickets: SupportTicket[]) => void): () => void {
    if (!userUid) return () => {};
    try {
      const q = query(
        collection(db, 'supportTickets'),
        where('createdByUid', '==', userUid),
        orderBy('updatedAt', 'desc')
      );
      return onSnapshot(
        q,
        (snapshot) => {
          const tickets = snapshot.docs.map((d) => ({
            ticketId: d.id,
            ...(d.data() as SupportTicket),
          }));
          onUpdate(tickets);
        },
        (error) => console.error('[FirestoreService] Error en snapshot de tickets de usuario:', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener de tickets de usuario no disponible:', err);
      return () => {};
    }
  },

  listenTicketMessages(ticketId: string, onUpdate: (messages: SupportTicketMessage[]) => void): () => void {
    if (!ticketId) return () => {};
    try {
      const q = query(
        collection(db, 'supportTickets', ticketId, 'messages'),
        orderBy('createdAt', 'asc')
      );
      return onSnapshot(
        q,
        (snapshot) => {
          const msgs = snapshot.docs.map((d) => ({
            messageId: d.id,
            ...(d.data() as SupportTicketMessage),
          }));
          onUpdate(msgs);
        },
        (error) => console.error('[FirestoreService] Error en snapshot de mensajes del ticket:', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener de mensajes de ticket no disponible:', err);
      return () => {};
    }
  },

  listenTicketInternalNotes(ticketId: string, onUpdate: (notes: SupportInternalNote[]) => void): () => void {
    if (!ticketId) return () => {};
    try {
      const q = query(
        collection(db, 'supportTickets', ticketId, 'internalNotes'),
        orderBy('createdAt', 'asc')
      );
      return onSnapshot(
        q,
        (snapshot) => {
          const notes = snapshot.docs.map((d) => ({
            noteId: d.id,
            ...(d.data() as SupportInternalNote),
          }));
          onUpdate(notes);
        },
        (error) => console.error('[FirestoreService] Error en snapshot de notas internas:', error)
      );
    } catch (err) {
      console.error('[FirestoreService] Listener de notas internas no disponible:', err);
      return () => {};
    }
  },
};

