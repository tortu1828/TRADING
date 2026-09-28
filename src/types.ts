export type BitacoraCategory = 'AZUL' | 'VERDE' | 'NEGRA';

export type UserRole = 'ADMIN' | 'USER';

export type UserStatus = 'ACTIVE' | 'PENDING' | 'INACTIVE' | 'BLOCKED';

export type CycleStatus = 'OPEN' | 'CLOSED' | 'REOPENED';

export type OperationTargetType = 'INDIVIDUAL' | 'CUSTOM_GROUP' | 'CATEGORY' | 'GLOBAL';

export type MigrationStatus = 'MIGRATED' | 'REQUIRES_ADMIN_REVIEW' | 'LEGACY_VERIFIED';

export type DeliveryStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';

export type NotificationType = 
  | 'DAILY_OPERATION'
  | 'MONTHLY_CLOSURE' 
  | 'REINVESTMENT' 
  | 'DISBURSEMENT'
  | 'INVESTMENT_REQUEST' 
  | 'CORRECTION' 
  | 'SYSTEM'
  | 'ADMIN_BROADCAST';

export interface UserPermissions {
  supportAgent?: boolean;
  supportReadUserContext?: boolean;
  supportReadOperationalContext?: boolean;
  updatedAt?: any;
  updatedByUid?: string;
  updatedByName?: string;
}

/**
 * Perfil de usuario / inversionista.
 * Identidad principal de autorización: uid (Firebase Auth UID).
 */
export interface UserProfile {
  id: string; // Para compatibilidad, siempre id === uid
  uid: string; // Firebase Authentication UID
  userCode: string; // ej: "INV-001" (etiqueta de visualización y búsqueda)
  fullName: string;
  tradeNotificationAlias?: string; // Nombre alternativo exclusivo para el saludo de notificaciones de trade diario
  email: string;
  phone: string;
  role: UserRole;
  status: UserStatus;
  permissions?: UserPermissions;
  currentCapital: number; // Capital operativo COP
  baseCapital?: number; // Capital aportado inicial
  currency: 'COP';
  category: BitacoraCategory;
  userPercentage: number; // Porcentaje del cliente (ej. 75)
  adminPercentage: number; // Porcentaje de comisión admin (ej. 25)
  paymentMethod: 'Bancolombia' | 'Nequi' | 'Llave' | 'Efectivo' | string;
  paymentDetails: string;
  createdAt: string;
  entryDate: string;
  documentId?: string; // Cédula de ciudadanía o NIT
  password?: string;
  isClaimed?: boolean;
  claimedAt?: string;
  migrationStatus?: MigrationStatus;
  entryCycleId?: string | null;
}

/**
 * Token de dispositivo para Firebase Cloud Messaging (FCM).
 * Ubicación en Firestore: users/{userUid}/pushTokens/{tokenId}
 */
export interface UserPushToken {
  id: string; // Hash determinístico del token
  token: string; // String completo FCM
  platform: 'Web' | 'Android' | 'iOS' | 'macOS' | 'Windows' | string;
  browser?: 'Chrome' | 'Safari' | 'Edge' | 'Firefox' | string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Ciclo Mensual (Metadatos públicos visibles para usuarios autenticados).
 * Colección Firestore: monthlyCycles/{cycleId}
 */
export interface MonthlyCycle {
  id: string; // Igual a cycleId (ej. "2026-09" o "cyc_...")
  cycleId: string; // "2026-09" o "cyc_..."
  name: string; // "Septiembre 2026", "Ciclo 2 - Septiembre"
  status: CycleStatus;
  trmApplied?: number;
  // Modelo TRM Dinámica y Cierre Manual Definitivo
  closingTrm?: number | null;
  closingTrmSetAt?: string | null;
  closingTrmSetByUid?: string | null;
  closingTrmSetByName?: string | null;
  observedMarketTrmAtClose?: number | null;
  isLegacy?: boolean;
  openedAt?: string;
  closedAt: string | null;
  closedBy: string | null;
  notificationsSent: boolean;
  notificationsSentAt: string | null;
  // Sucesión explícita y auditoría temporal de ciclos arbitrarios
  nextCycleId?: string | null;
  previousCycleId?: string | null;
  createdAt?: string;
  // Campos de compatibilidad visual (derivados o enlazados a FinancialSummary)
  totalManagedCapital?: number;
  totalUsersActive?: number;
  calculatedUsersCount?: number;
  totalGroupsCount?: number;
  calculatedGroupsCount?: number;
  totalGrossUsd?: number;
  totalGrossCop?: number;
  totalUsersProfitCop?: number;
  totalAdminCommissionCop?: number;
  reopenAudit?: {
    reopenedAt: string;
    reopenedBy: string;
    reopenedByUid?: string;
    reason: string;
  }[];
  reopenedAt?: string | null;
  reopenedBy?: string | null;
  reopenedByUid?: string | null;
  reopenReason?: string | null;
  // Control de Concurrencia y Lock Atómico de Cierre
  isClosing?: boolean;
  closingStartedAt?: string | null;
  closingByUid?: string | null;
  closingByName?: string | null;
  closureAttemptId?: string | null;

  // Estado Operativo y Lock Atómico de Inicio / Freeze de Capitales
  operationalStatus?: 'PREPARING' | 'STARTED';
  isStarting?: boolean;
  startingStartedAt?: string | null;
  startingByUid?: string | null;
  startingByName?: string | null;
  startAttemptId?: string | null;
  lastStartRequestId?: string | null;
  startedAt?: string | null;
  startedByUid?: string | null;
  startedByName?: string | null;
  initialManagedCapitalCop?: number;
  initialActiveUsersCount?: number;

  // Fase 2A: Versión de cierre e integridad financiera de reconciliación
  closureVersion?: number;
  sourceClosureVersion?: number;
  preparationNeedsReview?: boolean;
}

/**
 * Resumen Financiero y Métricas Globales del Ciclo (Exclusivo para ADMINISTRACIÓN).
 * Colección Firestore: cycleFinancialSummaries/{cycleId}
 */
export interface CycleFinancialSummary {
  id: string; // Igual a cycleId
  cycleId: string;
  totalManagedCapital: number;
  totalUsersActive: number;
  calculatedUsersCount: number;
  totalGroupsCount: number;
  calculatedGroupsCount: number;
  totalGrossUsd: number;
  totalGrossCop: number;
  totalUsersProfitCop: number;
  totalAdminCommissionCop: number;
  closingTrm?: number | null;
  trmApplied?: number;
  updatedAt: string;
  updatedBy: string;
  reopenAudit?: {
    reopenedAt: string;
    reopenedBy: string;
    reason: string;
  }[];
}

/**
 * Operación Diaria de Trading.
 * Colección Firestore: dailyOperations/{operationId}
 * Autorización criptográfica: request.auth.uid in authorizedUids o isPublicToActiveUsers === true
 */
export interface DailyGroupOperation {
  id: string; // ej: "op_2026-09_AZUL_7000000_1"
  operationIntentId?: string;
  payloadFingerprint?: string;
  cycleId: string;
  category: BitacoraCategory;
  groupCapitalCop: number;
  date: string; // YYYY-MM-DD (Timezone: America/Bogota)
  amountUsd: number;
  trmUsed?: number;
  trmSource?: string;
  trmCapturedAt?: string;
  grossCop?: number;
  notes?: string;
  status?: 'ACTIVE' | 'CONSOLIDATED';
  consolidatedAt?: string;
  createdAt: string;
  createdBy: string;
  createdByUid?: string;
  
  // Modelo Criptográfico y de Aislamiento
  targetType?: OperationTargetType;
  authorizedUids?: string[]; // Lista de Firebase Auth UIDs con permiso de lectura
  isPublicToActiveUsers?: boolean; // Solo true si targetType === 'GLOBAL'
  
  // Metadatos auxiliares de visualización y trazabilidad
  userId?: string;
  userUid?: string;
  userEmail?: string;
  userCode?: string;
  userName?: string;
  migrationStatus?: MigrationStatus;
}

/**
 * Cálculo consolidado por grupo de capital (Bitácora Administrativa).
 * Colección Firestore: cycleGroupCalculations/{groupId}
 */
export interface CycleGroupCalculation {
  id: string; // `${cycleId}_${category}_${groupCapitalCop}`
  cycleId: string;
  category: BitacoraCategory;
  groupCapitalCop: number;
  usersCount: number;
  userIds: string[]; // Auth UIDs de los usuarios en el grupo
  userUids?: string[]; // Alias explícito
  totalUsdApplied: number;
  trmUsed: number;
  totalCopPerUser: number;
  totalGroupCop: number;
  totalUsersProfitCop: number;
  totalAdminCommissionCop: number;
  status: 'CALCULATED' | 'VOIDED';
  calculatedAt: string;
  calculatedBy: string;
  calculatedByUid?: string;
  dailyOperations?: DailyGroupOperation[];
  history?: {
    previousUsd: number;
    newUsd: number;
    differenceUsd: number;
    updatedAt: string;
    updatedBy: string;
    reason: string;
  }[];
}

/**
 * Resultado y Liquidación Oficial Individual por Ciclo para un Inversionista.
 * Colección Firestore: cycleUserResults/{cycleId}_{userUid}
 */
export interface CycleUserResult {
  id: string; // `${cycleId}_${userUid}`
  cycleId: string;
  userId: string; // Auth UID
  userUid?: string; // Firebase Auth UID garantizado
  userCode: string;
  userName: string;
  email?: string;
  cycleCapitalCop: number;
  cycleCategory: BitacoraCategory;
  groupCapitalCop: number;
  totalUsdOperated: number;
  trmUsed: number;
  totalGrossCop: number;
  userPercentage: number;
  adminPercentage: number;
  userProfitCop: number;
  userProfitUsd: number;
  adminCommissionCop: number;
  adminCommissionUsd: number;
  notificationStatus: 'PENDING' | 'SENT' | 'FAILED';
  notificationSentAt: string | null;
  calculatedAt: string;
  calculatedBy: string;
  calculatedByUid?: string;
  isCycleClosed: boolean;
  isFrozen?: boolean;
  idempotencyKey?: string;
  isCorrected?: boolean;
  migrationStatus?: MigrationStatus;
  correctionHistory?: {
    previousUsd: number;
    newUsd: number;
    updatedAt: string;
    reason: string;
  }[];
}

/**
 * Elemento de Notificación en Firestore.
 * Colección Firestore: notifications/{notificationId}
 */
export interface NotificationItem {
  id: string;
  userId?: string;
  userUid?: string;
  userEmail?: string;
  userCode?: string;
  userName?: string;
  cycleId: string;
  type: NotificationType;
  title: string;
  message: string;
  
  // Modelo de destinatarios unificado
  targetType?: OperationTargetType;
  targetUserUid?: string; // Para notificaciones individuales
  targetUids?: string[]; // Lista de Auth UIDs autorizados
  targetCategory?: BitacoraCategory | 'ALL';
  
  deliveryStatus?: DeliveryStatus;
  processingStartedAt?: string;
  sentAt: string;
  readAt: string | null;
  isRead: boolean;
  hiddenByUser?: boolean;
  hiddenAt?: string | null;
  
  payload: {
    cycleId: string;
    usdAmount?: number;
    copAmount?: number;
    userProfitCop?: number;
    userPercentage?: number;
    trmUsed?: number;
    userProfitUsd?: number;
    notes?: string;
    category?: BitacoraCategory | string;
    groupCapitalCop?: number;
    userEmail?: string;
    [key: string]: any;
  };
}

export type ReinvestmentStatus = 'PENDING' | 'PREAPPROVED' | 'APPROVED' | 'NEEDS_REVIEW' | 'REJECTED' | 'APPLIED';

export type ReinvestmentModality = 'PROFIT_REINVESTMENT' | 'CAPITAL_INJECTION';

/**
 * Solicitud de Reinversión de Utilidades e Inyección de Capital.
 * Colección Firestore: reinvestments/{reinvestmentId}
 */
export interface ReinvestmentRequest {
  id: string;
  userId: string; // Auth UID
  userUid?: string; // Firebase Auth UID
  userCode: string;
  userName: string;
  userEmail?: string;
  sourceCycleId: string;
  targetCycleId?: string;
  modality: ReinvestmentModality;
  clientRequestId?: string | null;

  // Snapshots financieros auditados
  currentCapitalSnapshotCop: number;
  cycleProfitSnapshotCop: number;
  reinvestableProfitCop: number;
  desiredCapitalIncreaseCop?: number | null; // Presente en CAPITAL_INJECTION
  profitAppliedCop: number;
  cashInjectionCop: number; // 0 en PROFIT_REINVESTMENT
  totalIncreaseCop: number; // profitAppliedCop + cashInjectionCop
  profitToDisburseCop: number; // Saldo de ganancia restante a consignar
  projectedCapitalCop: number; // currentCapitalSnapshotCop + totalIncreaseCop
  projectedCategory: BitacoraCategory;

  // Confirmación administrativa de recepción de dinero nuevo (Para PREAPPROVED -> APPROVED en CAPITAL_INJECTION)
  cashReceivedConfirmed?: boolean;
  cashReceivedAmountCop?: number;
  cashReceivedAt?: string | null;
  cashReceivedByUid?: string | null;
  cashReceivedByName?: string | null;

  // Política definitiva de aporte externo y ciclo operativo N+1
  externalFundingStatus?: 'NOT_REQUIRED' | 'PENDING' | 'CONFIRMED' | 'NOT_RECEIVED';
  confirmedAmountCop?: number;
  confirmedAt?: string | null;
  confirmedByUid?: string | null;
  confirmedByName?: string | null;
  bankReference?: string | null;

  // Trazabilidad de Cierre de Ciclo N y Capital Asegurado
  profitAppliedAtCycleClosure?: boolean;
  profitAppliedAt?: string | null;
  securedNextCapitalCop?: number;
  projectedNextCapitalCop?: number;
  appliedClosureVersion?: number;
  fundingReconciliationStatus?: 'OK' | 'NEEDS_REVIEW';
  fundingReconciliationReason?: string | null;

  // Trazabilidad de Inicio Operativo de Ciclo N+1 y Capital Congelado
  appliedAtCycleStart?: boolean;
  finalCapitalCop?: number;
  finalIncreaseAppliedCop?: number;
  excludedCashAmountCop?: number;

  // Retrocompatibilidad con esquemas heredados
  cycleId?: string;
  baseCapital?: number;
  availableProfitCop: number;
  reinvestAmountCop: number; // Ganancia del ciclo efectivamente reinvertida (semántica histórica canónica = profitAppliedCop)
  withdrawAmountCop: number;
  newCapitalTargetCop: number;
  newCategoryTarget: BitacoraCategory;

  status: ReinvestmentStatus;
  requestVersion?: number;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolvedByUid?: string | null;
  rejectionReason?: string;
  rejectionHistory?: {
    rejectedAt: string;
    rejectedBy: string;
    rejectedByUid?: string | null;
    rejectionReason: string;
    previousRequestVersion?: number;
    previousModality: ReinvestmentModality;
    previousTotalIncreaseCop: number;
    previousCashInjectionCop?: number;
    previousProfitAppliedCop?: number;
    previousCurrentCapitalSnapshotCop?: number;
    previousCycleProfitSnapshotCop?: number;
    previousProjectedCapitalCop?: number;
    previousProfitToDisburseCop?: number;
    previousStatus?: ReinvestmentStatus;
    actionType?: string;
  }[];
  notes?: string;
  appliedAtCycleClosure?: boolean;
  appliedAt?: string | null;
  migrationStatus?: MigrationStatus;
}

/**
 * Helper canónico para obtener el Aumento Total de Capital solicitado.
 * Para documentos nuevos prioriza totalIncreaseCop.
 * Para documentos legacy sin totalIncreaseCop, toma reinvestAmountCop.
 */
export function getReinvestmentTotalIncrease(req?: Partial<ReinvestmentRequest> | null): number {
  if (!req) return 0;
  if (typeof req.totalIncreaseCop === 'number') return req.totalIncreaseCop;
  return Number(req.reinvestAmountCop) || 0;
}

/**
 * Helper canónico para obtener la Ganancia Efectivamente Reinvertida.
 * Para documentos nuevos prioriza profitAppliedCop.
 * Para documentos legacy sin profitAppliedCop, toma reinvestAmountCop (semántica histórica real).
 */
export function getReinvestmentProfitApplied(req?: Partial<ReinvestmentRequest> | null): number {
  if (!req) return 0;
  if (typeof req.profitAppliedCop === 'number') return req.profitAppliedCop;
  return Number(req.reinvestAmountCop) || 0;
}

export type DisbursementMethod = 'TRANSFERENCIA' | 'EFECTIVO';
export type DisbursementStatus = 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED';

/**
 * Solicitud de Desembolso / Retiro.
 * Colección Firestore: disbursements/{disbursementId}
 */
export interface DisbursementRequest {
  id: string;
  userId: string; // Auth UID
  userUid?: string; // Firebase Auth UID
  userCode: string;
  userName: string;
  sourceCycleId: string;
  amountCop: number;
  disbursementSource: 'PROFIT' | 'CAPITAL' | 'MIXED';
  method: DisbursementMethod;
  bankName?: string;
  accountType?: 'Ahorros' | 'Corriente' | string;
  accountNumber?: string;
  accountHolderName?: string;
  idDocument?: string;
  cashOffice?: string;
  receiverId?: string;
  receiverFullName?: string;
  status: DisbursementStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  paidAt?: string | null;
  paymentVoucher?: string | null;
  rejectionReason?: string | null;
  notes?: string;
  migrationStatus?: MigrationStatus;
}

/**
 * Solicitud de Inversión / Aporte de Capital.
 * Colección Firestore: investments/{investmentId}
 */
export interface InvestmentRequest {
  id: string;
  userId: string; // Auth UID
  userUid?: string; // Firebase Auth UID
  userCode: string;
  userName: string;
  requestedAmountCop: number;
  paymentMethod: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  queuePosition: number;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy?: string | null;
  notes?: string;
  migrationStatus?: MigrationStatus;
}

/**
 * Postulación de Nuevo Inversionista (FIFO).
 * Colección Firestore: investorApplications/{applicationId}
 */
export interface InvestorApplication {
  id: string;
  queuePosition: number;
  fullName: string;
  documentId: string;
  email: string;
  phone: string;
  city?: string;
  requestedCapitalCop: number;
  originBank?: string;
  submissionDate: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WAITLIST';
  source: 'WEB_FORM' | 'EXCEL_HISTORICO' | 'DIRECT_ADMIN';
  excelRowIndex?: number;
  priorityNotes?: string;
  assignedUserCode?: string;
  assignedUserId?: string;
  assignedUserUid?: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  rejectionReason?: string | null;
  welcomeMessageSent?: boolean;
}

/**
 * Registro de Auditoría y Trazabilidad Administrativa.
 * Colección Firestore: auditLogs/{logId}
 */
export interface AuditLog {
  id: string;
  action: 
    | 'GROUP_CALCULATED' 
    | 'CALCULATION_CORRECTED' 
    | 'DAILY_OPERATION_ADDED'
    | 'DAILY_OPERATION_DELETED'
    | 'DAILY_OPERATION_UPDATED'
    | 'DAILY_OPERATIONS_CONSOLIDATED'
    | 'DAILY_OPERATION_NOTIFIED'
    | 'EXCEL_BITACORA_IMPORTED'
    | 'NOTIFICATIONS_DISPATCHED' 
    | 'CYCLE_CLOSED' 
    | 'CYCLE_REOPENED' 
    | 'CYCLE_UNLOCKED'
    | 'REINVESTMENT_APPROVED' 
    | 'REINVESTMENT_REJECTED'
    | 'REINVESTMENT_NEEDS_REVIEW'
    | 'REINVESTMENT_APPLIED_AT_CLOSURE'
    | 'DISBURSEMENT_REQUESTED'
    | 'DISBURSEMENT_APPROVED'
    | 'DISBURSEMENT_PAID'
    | 'DISBURSEMENT_REJECTED'
    | 'USER_CREATED' 
    | 'USER_UPDATED' 
    | 'USER_DELETED' 
    | 'TRM_UPDATED'
    | 'APPLICATION_APPROVED'
    | 'APPLICATION_REJECTED'
    | 'APPLICATION_DELETED'
    | 'APPLICATIONS_IMPORTED'
    | 'ACCOUNT_CLAIMED'
    | 'MIGRATION_EXECUTED';
  performedBy: string;
  performedByName: string;
  performedByUid?: string;
  cycleId?: string;
  targetEntity: string;
  details?: Record<string, any>;
  previousValue?: any;
  newValue?: any;
  difference?: any;
  reason?: string;
  timestamp: string;
}

export type TRMMode = 'AUTOMATIC' | 'MANUAL';

export interface GlobalConfig {
  trmReference: number;
  trmConfigured: number;
  trmMode: TRMMode;
  trmAutoSync: boolean;
  trmMarketRate: number;
  trmLastSyncedAt?: string;
  trmSource?: string;
  activeCycleId: string;
  operationalCycleId?: string | null;
  preparingCycleId?: string | null;
  roundingRule: 'none' | 'nearest_100' | 'nearest_1000';
  categories: {
    id: BitacoraCategory;
    name: string;
    minCapital: number;
    maxCapital: number;
    color: string;
    badgeBg: string;
    badgeText: string;
  }[];
  updatedAt: string;
  updatedBy: string;
}

export interface CategoryGroupInfo {
  category: BitacoraCategory;
  groupCapitalCop: number;
  users: UserProfile[];
  calculation?: CycleGroupCalculation;
  isCalculated: boolean;
  totalUsdApplied: number;
  totalCopPerUser: number;
  totalUsersProfitCop: number;
  totalAdminCommissionCop: number;
  dailyOperations?: DailyGroupOperation[];
  totalOperationsCount?: number;
}

export interface ImportedBitacoraRow {
  rawId: string;
  clientName: string;
  capitalCop: number;
  totalUsdEarnings: number;
  totalCopEarnings: number;
  totalClientCop: number;
  totalCommissionCop: number;
  status: 'PAGO' | 'PENDIENTE' | string;
  category: BitacoraCategory;
  isNewUser: boolean;
  matchedUserId?: string;
  matchedUserUid?: string;
  matchedUserCode?: string;
  notes?: string;
}

export interface ImportBitacoraSummary {
  totalRows: number;
  newUsersCount: number;
  existingUsersCount: number;
  totalCapitalCop: number;
  totalUsdEarnings: number;
  totalCopEarnings: number;
  cycleId: string;
  category?: BitacoraCategory | 'ALL';
}

export interface UserCycleStatistic {
  cycleId: string;
  cycleTitle: string;
  status: 'OPEN' | 'CLOSED' | 'REOPENED';
  cycleCapitalCop: number;
  userProfitCop: number;
  userProfitUsd: number;
  totalUsdOperated: number;
  trmUsed: number;
  cycleCategory: BitacoraCategory;
  groupCapitalCop: number;
  userPercentage: number;
  adminPercentage: number;
  nextCapitalCop: number | 'N/D';
  returnPercent?: number | null;
  reinvestmentAppliedCop?: number;
  injectionAppliedCop?: number;
}

export interface UserStatisticsSummary {
  kpis: {
    cycleCapitalCop: number;
    currentCapital: number;
    cycleProfitCop: number;
    accumulatedProfitCop: number;
    cycleReturnPercent: number | null;
    averageReturnPercent: number | null;
    totalUsdOperated: number;
    cyclesOperatedCount: number;
  };
  charts: {
    cycleId: string;
    cycleTitle: string;
    userProfitCop: number;
    cycleCapitalCop: number;
    totalUsdOperated: number;
    status: string;
  }[];
}

export interface AdminCycleStatistic {
  cycleId: string;
  cycleTitle: string;
  status: 'OPEN' | 'CLOSED' | 'REOPENED';
  totalManagedCapital: number;
  totalUsersActive: number;
  totalGrossCop: number;
  totalGrossUsd: number;
  totalUsersProfitCop: number;
  totalAdminCommissionCop: number;
}

export type StatisticsRange = 'current' | '3' | '6' | '12' | 'all';

/**
 * Estado en vivo de la TRM del mercado (desacoplada de la liquidación del ciclo)
 */
export interface LiveTRMState {
  marketRate: number;
  source: string;
  lastSyncedAt: string;
  status: 'ONLINE' | 'FALLBACK' | 'MANUAL';
}

/**
 * ============================================================================
 * INFORMES OFICIALES DE CIERRE POR CICLO (SNAPSHOTS INMUTABLES)
 * ============================================================================
 */

export interface CycleReportBitacoraSummary {
  category: BitacoraCategory;
  usersCount: number;
  managedCapitalCop: number;
  totalUsdOperated: number;
  grossProfitCop: number;
  userProfitCop: number;
  adminCommissionCop: number;
  reinvestedProfitCop: number;
  cashInjectionCop: number;
  disbursementCop: number;
  totalCapitalIncreaseCop: number;
}

export interface CycleReportUserSnapshot {
  userUid: string;
  userCode: string;
  userNameSnapshot: string;
  cycleId: string;
  cycleCategory: BitacoraCategory;
  groupCapitalCop: number;
  cycleCapitalCop: number;
  userPercentage: number;
  adminPercentage: number;
  totalUsdOperated: number;
  trmUsed: number;
  totalGrossCop: number;
  userProfitCop: number;
  adminCommissionCop: number;
  reinvestmentModality: 'PROFIT_REINVESTMENT' | 'CAPITAL_INJECTION' | 'NONE';
  reinvestmentStatus: 'APPLIED' | 'NONE';
  cycleProfitSnapshotCop: number;
  reinvestableProfitCop: number;
  profitAppliedCop: number;
  cashInjectionCop: number;
  profitToDisburseCop: number;
  totalIncreaseCop: number;
  capitalBeforeCloseCop: number;
  capitalIncreaseAppliedCop: number;
  finalCapitalAfterCloseCop: number;
}

export interface CycleReportMetadata {
  id: string; // document id in versions subcollection
  cycleId: string;
  cycleName: string;
  versionId: string;
  versionNumber: number;
  closureVersion?: number;
  closureAttemptId?: string;
  status: 'GENERATING' | 'READY' | 'SUPERSEDED' | 'FAILED';
  isCurrent: boolean;
  startedAt?: string;
  openedAt?: string;
  closedAt: string;
  durationHours?: number;
  closedByUid?: string;
  closedByName?: string;
  trmApplied: number;
  totalUsers: number;
  totalManagedCapital: number;
  totalUsdOperated: number;
  totalGrossCop: number;
  totalUsersProfitCop: number;
  totalAdminCommissionCop: number;
  totalReinvestedProfitCop: number;
  totalCashInjectionCop: number;
  totalDisbursementCop: number;
  totalCapitalIncreaseCop: number;
  bitacoras: {
    AZUL: CycleReportBitacoraSummary;
    VERDE: CycleReportBitacoraSummary;
    NEGRA: CycleReportBitacoraSummary;
  };
  createdAt: string;
  snapshotGeneratedAt: string;
  isRetrospective: boolean;
  profileMetadataFallbackUsed?: boolean;
  reconciliationStatus?: 'PASSED' | 'FAILED';
}

export interface CycleReportHeaderDoc {
  cycleId: string;
  cycleName: string;
  currentVersionId: string;
  currentVersionNumber: number;
  status: 'GENERATING' | 'READY' | 'SUPERSEDED' | 'FAILED';
  updatedAt: string;
}

// =========================================================================
// MÓDULO DE SOPORTE TÉCNICO (FASES S1, S2, S3)
// =========================================================================

export type SupportTicketCategory =
  | 'ACCOUNT_ACCESS'
  | 'CAPITAL'
  | 'CYCLE'
  | 'OPERATIONS'
  | 'PROFITS'
  | 'REINVESTMENT'
  | 'WITHDRAWAL'
  | 'NOTIFICATIONS'
  | 'TECHNICAL'
  | 'OTHER';

export type SupportTicketStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_USER'
  | 'RESOLVED'
  | 'CLOSED';

export type SupportTicketPriority =
  | 'LOW'
  | 'NORMAL'
  | 'HIGH'
  | 'URGENT';

export interface SupportTicket {
  ticketId: string;
  ticketNumber: string;

  createdByUid: string;
  createdByUserId: string;
  createdByUserCode: string;
  createdByName: string;

  subject: string;
  category: SupportTicketCategory;
  description: string;

  status: SupportTicketStatus;
  priority: SupportTicketPriority;

  assignedToUid: string | null;
  assignedToName: string | null;
  assignedAt: string | null;

  lastMessagePreview: string;
  lastMessageByUid: string;
  lastMessageByName: string;
  lastMessageSenderType: 'USER' | 'SUPPORT' | 'SUPERADMIN';
  lastMessageAt: string;

  messageCount: number;

  unreadByUser: boolean;
  unreadBySupport: boolean;

  createdAt: string;
  updatedAt: string;

  resolvedAt: string | null;
  resolvedByUid: string | null;
  resolvedByName: string | null;

  closedAt: string | null;
  closedByUid: string | null;
  closedByName: string | null;
  closedReason?: string | null;
}

export interface SupportTicketMessage {
  messageId: string;
  ticketId: string;

  senderUid: string;
  senderName: string;
  senderUserCode: string;
  senderType: 'USER' | 'SUPPORT' | 'SUPERADMIN';

  text: string;
  createdAt: string;
}

export interface SupportInternalNote {
  noteId: string;
  ticketId: string;
  authorUid: string;
  authorName: string;
  noteText: string;
  createdAt: string;
}

