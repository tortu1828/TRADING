export type BitacoraCategory = 'AZUL' | 'VERDE' | 'NEGRA';

export type UserRole = 'ADMIN' | 'USER';

export type UserStatus = 'ACTIVE' | 'PENDING' | 'INACTIVE' | 'BLOCKED';

export type CycleStatus = 'OPEN' | 'CLOSED' | 'REOPENED';

export type NotificationType = 
  | 'MONTHLY_CLOSURE' 
  | 'REINVESTMENT' 
  | 'DISBURSEMENT'
  | 'INVESTMENT_REQUEST' 
  | 'CORRECTION' 
  | 'SYSTEM';

export interface UserProfile {
  id: string;
  uid: string;
  userCode: string; // ej: "USR-8F29K"
  fullName: string;
  email: string;
  phone: string;
  role: UserRole;
  status: UserStatus;
  currentCapital: number; // Capital operativo COP
  currency: 'COP';
  category: BitacoraCategory;
  userPercentage: number; // ej: 50 o 70
  adminPercentage: number; // ej: 50 o 30
  paymentMethod: 'Bancolombia' | 'Nequi' | 'Llave' | 'Efectivo' | string;
  paymentDetails: string;
  createdAt: string;
  entryDate: string;
  documentId?: string; // Cédula de ciudadanía o NIT
  password?: string; // Credencial de acceso
  isClaimed?: boolean; // Si la cuenta ya fue vinculada/activada por el inversionista
  claimedAt?: string; // Fecha de activación
}

export interface MonthlyCycle {
  id: string;
  cycleId: string; // "2026-08"
  name: string; // "Agosto 2026"
  status: CycleStatus;
  trmApplied: number;
  totalManagedCapital: number;
  totalUsersActive: number;
  calculatedUsersCount: number;
  totalGroupsCount: number;
  calculatedGroupsCount: number;
  totalGrossUsd: number;
  totalGrossCop: number;
  totalUsersProfitCop: number;
  totalAdminCommissionCop: number;
  notificationsSent: boolean;
  notificationsSentAt: string | null;
  closedAt: string | null;
  closedBy: string | null;
  reopenAudit?: {
    reopenedAt: string;
    reopenedBy: string;
    reason: string;
  }[];
}

export interface DailyGroupOperation {
  id: string; // ej: "op_2026-08_AZUL_7000000_1"
  cycleId: string;
  category: BitacoraCategory;
  groupCapitalCop: number;
  date: string; // YYYY-MM-DD
  amountUsd: number;
  notes?: string;
  createdAt: string;
  createdBy: string;
}

export interface CycleGroupCalculation {
  id: string; // `${cycleId}_${category}_${groupCapitalCop}`
  cycleId: string;
  category: BitacoraCategory;
  groupCapitalCop: number;
  usersCount: number;
  userIds: string[];
  totalUsdApplied: number;
  trmUsed: number;
  totalCopPerUser: number;
  totalGroupCop: number;
  totalUsersProfitCop: number;
  totalAdminCommissionCop: number;
  status: 'CALCULATED' | 'VOIDED';
  calculatedAt: string;
  calculatedBy: string;
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

export interface CycleUserResult {
  id: string; // `${cycleId}_${userId}`
  cycleId: string;
  userId: string;
  userCode: string;
  userName: string;
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
  isCycleClosed: boolean;
  idempotencyKey?: string;
  isCorrected?: boolean;
  correctionHistory?: {
    previousUsd: number;
    newUsd: number;
    updatedAt: string;
    reason: string;
  }[];
}

export interface NotificationItem {
  id: string;
  userId: string;
  userCode: string;
  userName?: string;
  cycleId: string;
  type: NotificationType;
  title: string;
  message: string;
  payload: {
    cycleId: string;
    usdAmount: number;
    copAmount: number;
    userProfitCop: number;
    userPercentage: number;
    trmUsed?: number;
  };
  isRead: boolean;
  sentAt: string;
  readAt: string | null;
}

export interface ReinvestmentRequest {
  id: string;
  userId: string;
  userCode: string;
  userName: string;
  sourceCycleId: string;
  availableProfitCop: number;
  reinvestAmountCop: number;
  withdrawAmountCop: number;
  newCapitalTargetCop: number;
  newCategoryTarget: BitacoraCategory;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  notes?: string;
}

export type DisbursementMethod = 'TRANSFERENCIA' | 'EFECTIVO';
export type DisbursementStatus = 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED';

export interface DisbursementRequest {
  id: string;
  userId: string;
  userCode: string;
  userName: string;
  sourceCycleId: string;
  amountCop: number;
  disbursementSource: 'PROFIT' | 'CAPITAL' | 'MIXED';
  method: DisbursementMethod;
  // Campos para transferencia (disponible solo <= 10.000.000 COP)
  bankName?: string;
  accountType?: 'Ahorros' | 'Corriente' | string;
  accountNumber?: string;
  accountHolderName?: string;
  idDocument?: string;
  // Campos para efectivo (obligatorio > 10.000.000 COP o elegido voluntariamente)
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
}

export interface InvestmentRequest {
  id: string;
  userId: string;
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
}

export interface InvestorApplication {
  id: string;
  queuePosition: number; // Turno por orden de llegada (FIFO: 1, 2, 3...)
  fullName: string;
  documentId: string; // Cédula o NIT
  email: string;
  phone: string; // WhatsApp
  city?: string;
  requestedCapitalCop: number;
  originBank?: string;
  submissionDate: string; // Fecha y hora de radicación
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WAITLIST';
  source: 'WEB_FORM' | 'EXCEL_HISTORICO' | 'DIRECT_ADMIN';
  excelRowIndex?: number;
  priorityNotes?: string;
  assignedUserCode?: string;
  assignedUserId?: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  rejectionReason?: string | null;
  welcomeMessageSent?: boolean;
}

export interface AuditLog {
  id: string;
  action: 
    | 'GROUP_CALCULATED' 
    | 'CALCULATION_CORRECTED' 
    | 'DAILY_OPERATION_ADDED'
    | 'DAILY_OPERATION_DELETED'
    | 'DAILY_OPERATION_UPDATED'
    | 'EXCEL_BITACORA_IMPORTED'
    | 'NOTIFICATIONS_DISPATCHED' 
    | 'CYCLE_CLOSED' 
    | 'CYCLE_REOPENED' 
    | 'REINVESTMENT_APPROVED' 
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
    | 'APPLICATIONS_IMPORTED'
    | 'ACCOUNT_CLAIMED';
  performedBy: string;
  performedByName: string;
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
