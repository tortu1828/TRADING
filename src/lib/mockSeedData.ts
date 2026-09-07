import {
  UserProfile,
  MonthlyCycle,
  GlobalConfig,
  ReinvestmentRequest,
  DisbursementRequest,
  InvestmentRequest,
  InvestorApplication,
  AuditLog,
  DailyGroupOperation,
} from '../types';

export const INITIAL_GLOBAL_CONFIG: GlobalConfig = {
  trmReference: 4028.50,
  trmConfigured: 4028.50,
  trmMode: 'AUTOMATIC',
  trmAutoSync: true,
  trmMarketRate: 4028.50,
  trmSource: 'Mercado Oficial Bancario (USD/COP)',
  trmLastSyncedAt: new Date().toISOString(),
  activeCycleId: '2026-09',
  roundingRule: 'none',
  categories: [
    {
      id: 'AZUL',
      name: '🔵 Azul',
      minCapital: 7_000_000,
      maxCapital: 9_999_999,
      color: '#2563eb',
      badgeBg: 'bg-blue-900/40 border-blue-500/30 text-blue-300',
      badgeText: 'Azul ($7M - $9.999.999)',
    },
    {
      id: 'VERDE',
      name: '🟢 Verde',
      minCapital: 10_000_000,
      maxCapital: 49_999_999,
      color: '#059669',
      badgeBg: 'bg-emerald-900/40 border-emerald-500/30 text-emerald-300',
      badgeText: 'Verde ($10M - $49.999.999)',
    },
    {
      id: 'NEGRA',
      name: '⚫ Negra / Whale',
      minCapital: 50_000_000,
      maxCapital: 1_000_000_000,
      color: '#0f172a',
      badgeBg: 'bg-slate-800/80 border-slate-600/50 text-slate-200',
      badgeText: 'Negra ($50M - $1.000M)',
    },
  ],
  updatedAt: new Date().toISOString(),
  updatedBy: 'admin-system',
};

export const INITIAL_CYCLES: MonthlyCycle[] = [
  {
    id: '2026-09',
    cycleId: '2026-09',
    name: 'Septiembre 2026',
    status: 'OPEN',
    trmApplied: 4028.50,
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
  },
];

export const INITIAL_USERS: UserProfile[] = [
  {
    id: 'usr_admin',
    uid: 'lpx4NLEEMkeh9EJFcG68oPMVdXF2',
    userCode: 'ADM-JUANES',
    fullName: 'Juan Esteban (SuperAdmin)',
    email: 'juanes9802@gmail.com',
    phone: '+57 300 000 0000',
    role: 'ADMIN',
    status: 'ACTIVE',
    currentCapital: 0,
    currency: 'COP',
    category: 'NEGRA',
    userPercentage: 0,
    adminPercentage: 100,
    paymentMethod: 'Bancolombia',
    paymentDetails: 'Cuenta Maestra Tesorería Bancolombia Ahorros',
    createdAt: new Date().toISOString(),
    entryDate: new Date().toISOString(),
    isClaimed: true,
  },
];

export const INITIAL_REINVESTMENTS: ReinvestmentRequest[] = [];
export const INITIAL_DISBURSEMENTS: DisbursementRequest[] = [];
export const INITIAL_INVESTMENTS: InvestmentRequest[] = [];
export const INITIAL_APPLICATIONS: InvestorApplication[] = [];
export const INITIAL_AUDIT_LOGS: AuditLog[] = [];
export const INITIAL_DAILY_OPERATIONS: DailyGroupOperation[] = [];
