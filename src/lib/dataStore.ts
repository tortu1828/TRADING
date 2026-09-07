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
} from '../types';
import {
  notifyCycleClosureToUser,
  notifyNewApplicationToAdmin,
  notifyApplicationStatusToUser,
} from './pushNotifications';
import {
  INITIAL_GLOBAL_CONFIG,
  INITIAL_CYCLES,
  INITIAL_USERS,
  INITIAL_REINVESTMENTS,
  INITIAL_DISBURSEMENTS,
  INITIAL_INVESTMENTS,
  INITIAL_APPLICATIONS,
  INITIAL_AUDIT_LOGS,
  INITIAL_DAILY_OPERATIONS,
} from './mockSeedData';
import {
  calculateUserMonthlyResult,
  getCategoryForCapital,
  generateUserCode,
} from './financialEngine';
import { normalizeName } from './excelMigrationService';

const STORAGE_KEYS = {
  USERS: 'gestor_capital_users_v5_clean_zero',
  CYCLES: 'gestor_capital_cycles_v5_clean_zero',
  CONFIG: 'gestor_capital_config_v5_clean_zero',
  GROUP_CALCS: 'gestor_capital_group_calcs_v5_clean_zero',
  USER_RESULTS: 'gestor_capital_user_results_v5_clean_zero',
  NOTIFICATIONS: 'gestor_capital_notifications_v5_clean_zero',
  REINVESTMENTS: 'gestor_capital_reinvestments_v5_clean_zero',
  DISBURSEMENTS: 'gestor_capital_disbursements_v5_clean_zero',
  INVESTMENTS: 'gestor_capital_investments_v5_clean_zero',
  APPLICATIONS: 'gestor_capital_applications_v5_clean_zero',
  AUDIT_LOGS: 'gestor_capital_audit_logs_v5_clean_zero',
  DAILY_OPERATIONS: 'gestor_capital_daily_ops_v5_clean_zero',
};

// Limpieza proactiva de datos demo antiguos en el navegador
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('gestor_capital_') && !key.endsWith('_v5_clean_zero')) {
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
  private config: GlobalConfig = INITIAL_GLOBAL_CONFIG;
  private groupCalculations: CycleGroupCalculation[] = [];
  private userResults: CycleUserResult[] = [];
  private notifications: NotificationItem[] = [];
  private reinvestments: ReinvestmentRequest[] = [];
  private disbursements: DisbursementRequest[] = [];
  private investments: InvestmentRequest[] = [];
  private applications: InvestorApplication[] = [];
  private auditLogs: AuditLog[] = [];
  private dailyOperations: DailyGroupOperation[] = [];

  private listeners: Set<Listener> = new Set();

  constructor() {
    this.loadState();
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.saveState();
    this.listeners.forEach((l) => {
      try {
        l();
      } catch (err) {
        console.error('Listener error:', err);
      }
    });
  }

  private loadState() {
    try {
      const storedUsers = localStorage.getItem(STORAGE_KEYS.USERS);
      this.users = storedUsers ? JSON.parse(storedUsers) : [...INITIAL_USERS];

      const storedCycles = localStorage.getItem(STORAGE_KEYS.CYCLES);
      this.cycles = storedCycles ? JSON.parse(storedCycles) : [...INITIAL_CYCLES];

      const storedConfig = localStorage.getItem(STORAGE_KEYS.CONFIG);
      this.config = storedConfig ? JSON.parse(storedConfig) : { ...INITIAL_GLOBAL_CONFIG };
      // Asegurar campos de TRM automática/manual
      if (!this.config.trmMode) {
        this.config.trmMode = 'AUTOMATIC';
        this.config.trmAutoSync = true;
        this.config.trmMarketRate = this.config.trmConfigured || 4028.50;
        this.config.trmSource = 'Mercado Oficial Bancario (USD/COP)';
        this.config.trmLastSyncedAt = new Date().toISOString();
      }

      const storedGroupCalcs = localStorage.getItem(STORAGE_KEYS.GROUP_CALCS);
      this.groupCalculations = storedGroupCalcs ? JSON.parse(storedGroupCalcs) : [];

      const storedUserResults = localStorage.getItem(STORAGE_KEYS.USER_RESULTS);
      this.userResults = storedUserResults ? JSON.parse(storedUserResults) : [];

      const storedNotifications = localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
      this.notifications = storedNotifications ? JSON.parse(storedNotifications) : [];

      const storedReinv = localStorage.getItem(STORAGE_KEYS.REINVESTMENTS);
      this.reinvestments = storedReinv ? JSON.parse(storedReinv) : [...INITIAL_REINVESTMENTS];

      const storedDisb = localStorage.getItem(STORAGE_KEYS.DISBURSEMENTS);
      this.disbursements = storedDisb ? JSON.parse(storedDisb) : [...INITIAL_DISBURSEMENTS];

      const storedInv = localStorage.getItem(STORAGE_KEYS.INVESTMENTS);
      this.investments = storedInv ? JSON.parse(storedInv) : [...INITIAL_INVESTMENTS];

      const storedApps = localStorage.getItem(STORAGE_KEYS.APPLICATIONS);
      this.applications = storedApps ? JSON.parse(storedApps) : [...INITIAL_APPLICATIONS];

      const storedLogs = localStorage.getItem(STORAGE_KEYS.AUDIT_LOGS);
      this.auditLogs = storedLogs ? JSON.parse(storedLogs) : [...INITIAL_AUDIT_LOGS];

      const storedDailyOps = localStorage.getItem(STORAGE_KEYS.DAILY_OPERATIONS);
      this.dailyOperations = storedDailyOps ? JSON.parse(storedDailyOps) : [...INITIAL_DAILY_OPERATIONS];

      // No inyectar cálculos demo; el sistema inicia en cero limpio
      this.recalculateCycleMetrics();
    } catch (e) {
      console.warn('Error loading state from localStorage, using initial mock data', e);
      this.resetToDefaults();
    }
  }

  public resetToDefaults() {
    this.users = [...INITIAL_USERS];
    this.cycles = [...INITIAL_CYCLES];
    this.config = { ...INITIAL_GLOBAL_CONFIG };
    this.groupCalculations = [];
    this.userResults = [];
    this.notifications = [];
    this.reinvestments = [...INITIAL_REINVESTMENTS];
    this.disbursements = [...INITIAL_DISBURSEMENTS];
    this.investments = [...INITIAL_INVESTMENTS];
    this.applications = [...INITIAL_APPLICATIONS];
    this.auditLogs = [...INITIAL_AUDIT_LOGS];
    this.dailyOperations = [...INITIAL_DAILY_OPERATIONS];
    this.recalculateCycleMetrics();
    this.notify();
  }

  private seedMockCalculations() {
    // Modo producción / datos reales en cero: no inyecta cálculos ni resultados ficticios
  }

  private saveState() {
    try {
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(this.users));
      localStorage.setItem(STORAGE_KEYS.CYCLES, JSON.stringify(this.cycles));
      localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(this.config));
      localStorage.setItem(STORAGE_KEYS.GROUP_CALCS, JSON.stringify(this.groupCalculations));
      localStorage.setItem(STORAGE_KEYS.USER_RESULTS, JSON.stringify(this.userResults));
      localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(this.notifications));
      localStorage.setItem(STORAGE_KEYS.REINVESTMENTS, JSON.stringify(this.reinvestments));
      localStorage.setItem(STORAGE_KEYS.DISBURSEMENTS, JSON.stringify(this.disbursements));
      localStorage.setItem(STORAGE_KEYS.INVESTMENTS, JSON.stringify(this.investments));
      localStorage.setItem(STORAGE_KEYS.APPLICATIONS, JSON.stringify(this.applications));
      localStorage.setItem(STORAGE_KEYS.AUDIT_LOGS, JSON.stringify(this.auditLogs));
      localStorage.setItem(STORAGE_KEYS.DAILY_OPERATIONS, JSON.stringify(this.dailyOperations));
    } catch (e) {
      console.error('Error saving state to localStorage', e);
    }
  }

  // Getters
  public getUsers(): UserProfile[] {
    return this.users;
  }

  public getActiveUsers(): UserProfile[] {
    return this.users.filter((u) => u.role === 'USER' && u.status === 'ACTIVE');
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

  public getActiveCycle(): MonthlyCycle {
    const cycle = this.cycles.find((c) => c.cycleId === this.config.activeCycleId);
    if (!cycle) {
      return this.cycles[0];
    }
    return cycle;
  }

  public getCycleById(cycleId: string): MonthlyCycle | undefined {
    return this.cycles.find((c) => c.cycleId === cycleId);
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
    return this.userResults.find((r) => (r.userId === userId || r.userCode === userId) && r.cycleId === targetCycleId);
  }

  public getNotificationsForUser(userId: string): NotificationItem[] {
    return this.notifications.filter((n) => n.userId === userId || n.userCode === userId).sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
  }

  public getAllNotifications(): NotificationItem[] {
    return [...this.notifications].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
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
   * Obtiene la estructura de grupos de capital exacto agrupados por bitácora
   */
  public getCategoryGroups(cycleId?: string): Record<BitacoraCategory, CategoryGroupInfo[]> {
    const targetCycleId = cycleId || this.config.activeCycleId;
    const activeUsers = this.getActiveUsers();
    const groupCalculations = this.getGroupCalculations(targetCycleId);

    const result: Record<BitacoraCategory, CategoryGroupInfo[]> = {
      AZUL: [],
      VERDE: [],
      NEGRA: [],
    };

    // Agrupar usuarios por categoría y capital exacto
    const map = new Map<string, { category: BitacoraCategory; groupCapitalCop: number; users: UserProfile[] }>();

    activeUsers.forEach((user) => {
      const category = getCategoryForCapital(user.currentCapital);
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

    // Ordenar y vincular cálculos y operaciones diarias
    map.forEach((item) => {
      const calcId = `${targetCycleId}_${item.category}_${item.groupCapitalCop}`;
      const calculation = groupCalculations.find((g) => g.id === calcId);
      const dailyOps = this.getDailyOperations(targetCycleId, item.category, item.groupCapitalCop);
      const dailySumUsd = dailyOps.reduce((sum, op) => sum + op.amountUsd, 0);

      const groupInfo: CategoryGroupInfo = {
        category: item.category,
        groupCapitalCop: item.groupCapitalCop,
        users: item.users,
        calculation,
        isCalculated: !!calculation && calculation.status === 'CALCULATED',
        totalUsdApplied: calculation?.totalUsdApplied || (dailyOps.length > 0 ? dailySumUsd : 0),
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

  public getDailyOperations(cycleId?: string, category?: BitacoraCategory, groupCapitalCop?: number): DailyGroupOperation[] {
    let list = [...this.dailyOperations];
    if (cycleId) {
      list = list.filter((op) => op.cycleId === cycleId);
    }
    if (category) {
      list = list.filter((op) => op.category === category);
    }
    if (groupCapitalCop !== undefined) {
      list = list.filter((op) => op.groupCapitalCop === groupCapitalCop);
    }
    return list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  public addDailyOperation(
    cycleId: string,
    category: BitacoraCategory,
    groupCapitalCop: number,
    date: string,
    amountUsd: number,
    notes?: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): { success: boolean; totalUsd: number; operation: DailyGroupOperation; message: string } {
    const cycle = this.getCycleById(cycleId);
    if (!cycle || cycle.status === 'CLOSED') {
      throw new Error('No se pueden registrar operaciones en un ciclo cerrado.');
    }
    if (isNaN(amountUsd) || amountUsd <= 0) {
      throw new Error('El monto operado en USD debe ser mayor a 0.');
    }

    const opId = `dop_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newOp: DailyGroupOperation = {
      id: opId,
      cycleId,
      category,
      groupCapitalCop,
      date: date || new Date().toISOString().split('T')[0],
      amountUsd,
      notes: notes || '',
      createdAt: new Date().toISOString(),
      createdBy: adminName,
    };

    this.dailyOperations.push(newOp);

    // Sumar todas las operaciones del grupo en este ciclo
    const groupOps = this.getDailyOperations(cycleId, category, groupCapitalCop);
    const totalUsdAccumulated = groupOps.reduce((sum, op) => sum + op.amountUsd, 0);

    // Auto-calcular / sincronizar el grupo con la suma acumulada
    this.calculateGroup(cycleId, category, groupCapitalCop, totalUsdAccumulated, adminUid, adminName, true);

    this.addAuditLog({
      action: 'DAILY_OPERATION_ADDED',
      performedBy: adminUid,
      performedByName: adminName,
      cycleId,
      targetEntity: opId,
      details: {
        category,
        groupCapitalCop,
        date: newOp.date,
        amountUsd,
        totalUsdAccumulated,
        notes,
      },
    });

    this.notify();

    return {
      success: true,
      totalUsd: totalUsdAccumulated,
      operation: newOp,
      message: `Operación de $${amountUsd} USD registrada con éxito. Total acumulado del ciclo: $${totalUsdAccumulated} USD.`,
    };
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

    // Remove all operations for this group in this cycle
    this.dailyOperations = this.dailyOperations.filter(
      (op) => !(op.cycleId === cycleId && op.category === category && op.groupCapitalCop === groupCapitalCop)
    );

    // Remove group calculations and user results
    const calcId = `${cycleId}_${category}_${groupCapitalCop}`;
    const groupCalcIndex = this.groupCalculations.findIndex((g) => g.id === calcId);
    if (groupCalcIndex >= 0) {
      this.groupCalculations.splice(groupCalcIndex, 1);
    }
    this.userResults = this.userResults.filter(
      (r) => !(r.cycleId === cycleId && r.cycleCategory === category && r.groupCapitalCop === groupCapitalCop)
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

  // Recalcular métricas de ciclos
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
    allowOverwrite: boolean = false
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

    // Obtener usuarios del grupo
    const usersInGroup = this.getActiveUsers().filter(
      (u) => getCategoryForCapital(u.currentCapital) === category && u.currentCapital === groupCapitalCop
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
        userCode: user.userCode,
        userName: user.fullName,
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
      (u) => getCategoryForCapital(u.currentCapital) === category && u.currentCapital === groupCapitalCop
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

    userResults.forEach((res) => {
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
        message: `Tu operación del mes de ${cycle.name} fue de USD ${formattedUsd}. Tu resultado convertido es de ${formattedCop} y tu ganancia correspondiente (${res.userPercentage}%) es de ${formattedProfit}.`,
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

      // Disparar Notificación Push al dispositivo del usuario
      notifyCycleClosureToUser({
        userName: res.userName,
        userProfitCop: res.userProfitCop,
        totalUsdOperated: res.totalUsdOperated,
        cycleName: cycle.name,
      });

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
   * CERRAR CICLO (Regla V2.1)
   * Bloquea el ciclo contra modificaciones financieras y prepara histórico.
   */
  public closeCycle(
    cycleId: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): { success: boolean; message: string } {
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

    const now = new Date().toISOString();

    // Bloquear cycleUserResults
    this.userResults.forEach((r) => {
      if (r.cycleId === cycleId) {
        r.isCycleClosed = true;
      }
    });

    this.cycles[cycleIndex] = {
      ...cycle,
      status: 'CLOSED',
      closedAt: now,
      closedBy: adminName,
    };

    this.addAuditLog({
      action: 'CYCLE_CLOSED',
      performedBy: adminUid,
      performedByName: adminName,
      cycleId,
      targetEntity: cycleId,
      details: {
        totalGrossCop: cycle.totalGrossCop,
        totalUsersProfitCop: cycle.totalUsersProfitCop,
        totalAdminCommissionCop: cycle.totalAdminCommissionCop,
      },
    });

    this.notify();

    return {
      success: true,
      message: `Ciclo ${cycle.name} cerrado y congelado exitosamente.`,
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
      this.config.trmMode = 'MANUAL';
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
   * REABRIR CICLO (Auditoría estricta)
   */
  public reopenCycle(
    cycleId: string,
    reason: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): { success: boolean; message: string } {
    const cycleIndex = this.cycles.findIndex((c) => c.cycleId === cycleId);
    if (cycleIndex < 0) {
      throw new Error('Ciclo no encontrado.');
    }
    if (!reason || reason.trim().length < 5) {
      throw new Error('Se requiere un motivo obligatorio de reapertura.');
    }

    const now = new Date().toISOString();
    const cycle = this.cycles[cycleIndex];

    this.cycles[cycleIndex] = {
      ...cycle,
      status: 'REOPENED',
      reopenAudit: [
        ...(cycle.reopenAudit || []),
        {
          reopenedAt: now,
          reopenedBy: adminName,
          reason,
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
      reason,
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

  public deleteUser(
    userId: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Juan Esteban'
  ): UserProfile {
    const userIndex = this.users.findIndex((u) => u.id === userId);
    if (userIndex < 0) {
      throw new Error('Usuario no encontrado.');
    }

    const removedUser = this.users[userIndex];
    this.users.splice(userIndex, 1);

    this.addAuditLog({
      action: 'USER_DELETED',
      performedBy: adminUid,
      performedByName: adminName,
      targetEntity: userId,
      previousValue: removedUser,
      newValue: null,
      details: {
        fullName: removedUser.fullName,
        userCode: removedUser.userCode,
      },
    });

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
        trmApplied: this.config.trmConfigured || 4028.50,
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

    const trm = cycle.trmApplied || this.config.trmConfigured || 4028.50;
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
          email: `${userCode.toLowerCase()}@easytraders.app`,
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
    source: string = 'Mercado Oficial Bancario (USD/COP)',
    forceApply: boolean = false
  ): { applied: boolean; rate: number; mode: string } {
    if (marketRate <= 0 || isNaN(marketRate)) {
      return { applied: false, rate: this.config.trmConfigured, mode: this.config.trmMode };
    }

    const previousMarketRate = this.config.trmMarketRate;
    this.config.trmMarketRate = marketRate;
    this.config.trmLastSyncedAt = new Date().toISOString();
    this.config.trmSource = source;

    const shouldApply = forceApply || this.config.trmMode === 'AUTOMATIC';

    if (shouldApply) {
      const prevConfigured = this.config.trmConfigured;
      this.config.trmConfigured = marketRate;
      this.config.trmReference = marketRate;

      // Actualizar ciclo activo si está abierto
      const activeCycle = this.getActiveCycle();
      if (activeCycle && activeCycle.status === 'OPEN') {
        const idx = this.cycles.findIndex((c) => c.cycleId === activeCycle.cycleId);
        if (idx >= 0) {
          this.cycles[idx].trmApplied = marketRate;
        }

        // Recalcular cálculos existentes del ciclo con la nueva TRM en vivo
        this.groupCalculations.forEach((gc) => {
          if (gc.cycleId === activeCycle.cycleId) {
            gc.trmUsed = marketRate;
            gc.totalCopPerUser = gc.totalUsdApplied * marketRate;
            gc.totalGroupCop = gc.totalUsdApplied * marketRate * gc.usersCount;
          }
        });

        this.userResults.forEach((ur) => {
          if (ur.cycleId === activeCycle.cycleId) {
            ur.trmUsed = marketRate;
            ur.totalGrossCop = ur.totalUsdOperated * marketRate;
            ur.userProfitCop = Math.round(ur.totalGrossCop * (ur.userPercentage / 100));
            ur.adminCommissionCop = Math.round(ur.totalGrossCop * (ur.adminPercentage / 100));
          }
        });

        this.recalculateCycleMetrics();
      }

      if (Math.abs(prevConfigured - marketRate) > 0.01) {
        this.addAuditLog({
          action: 'TRM_UPDATED',
          performedBy: 'system_auto_sync',
          performedByName: 'Sincronizador Automático TRM',
          targetEntity: 'settings/global_config',
          previousValue: prevConfigured,
          newValue: marketRate,
          difference: marketRate - prevConfigured,
          reason: `Sincronización automática con tasa de mercado en vivo (${source})`,
        });
      }
    }

    this.notify();
    return { applied: shouldApply, rate: marketRate, mode: this.config.trmMode };
  }

  /**
   * CAMBIAR MODO DE TRM (AUTOMÁTICO vs MANUAL)
   */
  public setTRMMode(
    mode: 'AUTOMATIC' | 'MANUAL',
    manualRate?: number,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ): { success: boolean; mode: string; currentTrm: number } {
    const prevMode = this.config.trmMode;
    const prevTrm = this.config.trmConfigured;
    this.config.trmMode = mode;
    this.config.updatedAt = new Date().toISOString();
    this.config.updatedBy = adminName;

    if (mode === 'AUTOMATIC') {
      const rateToApply = this.config.trmMarketRate || prevTrm;
      this.config.trmConfigured = rateToApply;

      const activeCycle = this.getActiveCycle();
      if (activeCycle && activeCycle.status === 'OPEN') {
        const idx = this.cycles.findIndex((c) => c.cycleId === activeCycle.cycleId);
        if (idx >= 0) {
          this.cycles[idx].trmApplied = rateToApply;
        }
        this.recalculateCycleMetrics();
      }
    } else if (mode === 'MANUAL' && manualRate && manualRate > 0) {
      this.config.trmConfigured = manualRate;

      const activeCycle = this.getActiveCycle();
      if (activeCycle && activeCycle.status === 'OPEN') {
        const idx = this.cycles.findIndex((c) => c.cycleId === activeCycle.cycleId);
        if (idx >= 0) {
          this.cycles[idx].trmApplied = manualRate;
        }
        this.recalculateCycleMetrics();
      }
    }

    this.addAuditLog({
      action: 'TRM_UPDATED',
      performedBy: adminUid,
      performedByName: adminName,
      targetEntity: 'settings/global_config',
      previousValue: { mode: prevMode, trm: prevTrm },
      newValue: { mode: this.config.trmMode, trm: this.config.trmConfigured },
      reason: `Cambio de modo TRM a ${mode === 'AUTOMATIC' ? 'Automático (En Vivo)' : 'Manual (Personalizado)'}`,
    });

    this.notify();
    return { success: true, mode: this.config.trmMode, currentTrm: this.config.trmConfigured };
  }

  /**
   * ACTUALIZAR TRM MANUALMENTE
   */
  public updateTRM(
    newTrm: number,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ) {
    if (newTrm <= 0 || isNaN(newTrm)) {
      throw new Error('La TRM debe ser un valor numérico válido mayor a 0.');
    }

    const prevTrm = this.config.trmConfigured;
    this.config.trmConfigured = newTrm;
    // Al ingresar un valor manual explícito, fijamos el modo a MANUAL
    this.config.trmMode = 'MANUAL';
    this.config.updatedAt = new Date().toISOString();
    this.config.updatedBy = adminName;

    // Actualizar ciclo activo si está abierto
    const activeCycle = this.getActiveCycle();
    if (activeCycle && activeCycle.status === 'OPEN') {
      const idx = this.cycles.findIndex((c) => c.cycleId === activeCycle.cycleId);
      if (idx >= 0) {
        this.cycles[idx].trmApplied = newTrm;
      }

      // Recalcular resultados existentes del ciclo con la nueva TRM
      this.groupCalculations.forEach((gc) => {
        if (gc.cycleId === activeCycle.cycleId) {
          gc.trmUsed = newTrm;
          gc.totalCopPerUser = gc.totalUsdApplied * newTrm;
          gc.totalGroupCop = gc.totalUsdApplied * newTrm * gc.usersCount;
        }
      });

      this.userResults.forEach((ur) => {
        if (ur.cycleId === activeCycle.cycleId) {
          ur.trmUsed = newTrm;
          ur.totalGrossCop = ur.totalUsdOperated * newTrm;
          ur.userProfitCop = Math.round(ur.totalGrossCop * (ur.userPercentage / 100));
          ur.adminCommissionCop = Math.round(ur.totalGrossCop * (ur.adminPercentage / 100));
        }
      });

      this.recalculateCycleMetrics();
    }

    this.addAuditLog({
      action: 'TRM_UPDATED',
      performedBy: adminUid,
      performedByName: adminName,
      targetEntity: 'settings/global_config',
      previousValue: prevTrm,
      newValue: newTrm,
      difference: newTrm - prevTrm,
      reason: 'Ajuste manual de TRM por Administrador',
    });

    this.notify();
  }

  /**
   * GESTIÓN DE REINVERSIONES
   */
  public createReinvestmentRequest(
    userId: string,
    sourceCycleId: string,
    reinvestAmountCop: number,
    withdrawAmountCop: number,
    notes?: string
  ): ReinvestmentRequest {
    const user = this.getUserById(userId);
    if (!user) throw new Error('Usuario no encontrado.');

    const userResult = this.getUserResultForUser(userId, sourceCycleId);
    const availableProfit = userResult ? userResult.userProfitCop : 0;

    if (reinvestAmountCop <= 0) {
      throw new Error('El monto a reinvertir debe ser mayor a cero.');
    }

    const newCapitalTargetCop = user.currentCapital + reinvestAmountCop;
    const newCategoryTarget = getCategoryForCapital(newCapitalTargetCop);

    const newRequest: ReinvestmentRequest = {
      id: `reinv_${Date.now()}`,
      userId,
      userCode: user.userCode,
      userName: user.fullName,
      sourceCycleId,
      availableProfitCop: availableProfit,
      reinvestAmountCop,
      withdrawAmountCop,
      newCapitalTargetCop,
      newCategoryTarget,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolvedBy: null,
      notes,
    };

    this.reinvestments.unshift(newRequest);
    this.notify();
    return newRequest;
  }

  public approveReinvestment(
    requestId: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ) {
    const reqIndex = this.reinvestments.findIndex((r) => r.id === requestId);
    if (reqIndex < 0) throw new Error('Solicitud no encontrada.');

    const req = this.reinvestments[reqIndex];
    if (req.status !== 'PENDING') throw new Error('La solicitud ya fue procesada.');

    const user = this.getUserById(req.userId);
    if (!user) throw new Error('Usuario no encontrado.');

    const previousCapital = user.currentCapital;
    const newCapital = req.newCapitalTargetCop;
    const newCategory = getCategoryForCapital(newCapital);

    // Actualizar usuario
    this.updateUser(
      user.id,
      {
        currentCapital: newCapital,
        category: newCategory,
      },
      adminUid,
      adminName
    );

    // Marcar solicitud
    this.reinvestments[reqIndex] = {
      ...req,
      status: 'APPROVED',
      resolvedAt: new Date().toISOString(),
      resolvedBy: adminName,
    };

    // Notificar al usuario
    this.notifications.unshift({
      id: `notif_reinv_appr_${Date.now()}`,
      userId: user.id,
      userCode: user.userCode,
      userName: user.fullName,
      cycleId: req.sourceCycleId,
      type: 'REINVESTMENT',
      title: '¡Reinversión Aprobada!',
      message: `Tu solicitud de reinversión por $${req.reinvestAmountCop.toLocaleString('es-CO')} COP fue aprobada. Tu nuevo capital para el próximo ciclo es de $${newCapital.toLocaleString('es-CO')} COP (${newCategory}).`,
      payload: {
        cycleId: req.sourceCycleId,
        usdAmount: 0,
        copAmount: req.reinvestAmountCop,
        userProfitCop: 0,
        userPercentage: user.userPercentage,
      },
      isRead: false,
      sentAt: new Date().toISOString(),
      readAt: null,
    });

    this.addAuditLog({
      action: 'REINVESTMENT_APPROVED',
      performedBy: adminUid,
      performedByName: adminName,
      targetEntity: req.id,
      previousValue: previousCapital,
      newValue: newCapital,
      details: {
        userCode: user.userCode,
        reinvestAmount: req.reinvestAmountCop,
        newCategory,
      },
    });

    this.notify();
  }

  public rejectReinvestment(
    requestId: string,
    reason?: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ) {
    const reqIndex = this.reinvestments.findIndex((r) => r.id === requestId);
    if (reqIndex < 0) throw new Error('Solicitud no encontrada.');

    const req = this.reinvestments[reqIndex];
    this.reinvestments[reqIndex] = {
      ...req,
      status: 'REJECTED',
      resolvedAt: new Date().toISOString(),
      resolvedBy: adminName,
      notes: reason ? `${req.notes ? req.notes + ' | ' : ''}Rechazo: ${reason}` : req.notes,
    };

    this.notify();
  }

  /**
   * GESTIÓN DE DESEMBOLSOS (DISBURSEMENTS)
   * Regla de Negocio: Para transferencias superiores a 10 millones COP es obligatoriamente en EFECTIVO.
   */
  public createDisbursementRequest(params: {
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
  }): DisbursementRequest {
    const user = this.getUserById(params.userId);
    if (!user) throw new Error('Usuario no encontrado.');

    if (!params.amountCop || params.amountCop <= 0) {
      throw new Error('El monto de desembolso debe ser mayor a $0 COP.');
    }

    // REGLA DE NEGOCIO CRÍTICA:
    // Para transferencias superiores a 10 millones COP es en efectivo.
    if (params.amountCop > 10_000_000 && params.method === 'TRANSFERENCIA') {
      throw new Error(
        'Por política de seguridad institucional y topes bancarios, todo desembolso superior a $10.000.000 COP debe realizarse obligatoriamente en EFECTIVO.'
      );
    }

    const effectiveMethod: DisbursementMethod =
      params.amountCop > 10_000_000 ? 'EFECTIVO' : params.method;

    const newRequest: DisbursementRequest = {
      id: `disb_${Date.now()}`,
      userId: user.id,
      userCode: user.userCode,
      userName: user.fullName,
      sourceCycleId: params.sourceCycleId,
      amountCop: params.amountCop,
      disbursementSource: params.disbursementSource || 'PROFIT',
      method: effectiveMethod,
      bankName: effectiveMethod === 'TRANSFERENCIA' ? params.bankName : undefined,
      accountType: effectiveMethod === 'TRANSFERENCIA' ? params.accountType : undefined,
      accountNumber: effectiveMethod === 'TRANSFERENCIA' ? params.accountNumber : undefined,
      accountHolderName: effectiveMethod === 'TRANSFERENCIA' ? params.accountHolderName : undefined,
      idDocument: params.idDocument,
      cashOffice: effectiveMethod === 'EFECTIVO' ? (params.cashOffice || 'Sede Principal de Tesorería') : undefined,
      receiverId: effectiveMethod === 'EFECTIVO' ? (params.receiverId || params.idDocument) : undefined,
      receiverFullName: effectiveMethod === 'EFECTIVO' ? (params.receiverFullName || user.fullName) : undefined,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolvedBy: null,
      notes: params.notes,
    };

    this.disbursements.unshift(newRequest);

    // Notificar al usuario
    this.notifications.unshift({
      id: `notif_disb_req_${Date.now()}`,
      userId: user.id,
      userCode: user.userCode,
      userName: user.fullName,
      cycleId: params.sourceCycleId,
      type: 'DISBURSEMENT',
      title: 'Solicitud de Desembolso Radicada',
      message: `Tu solicitud de desembolso por $${params.amountCop.toLocaleString('es-CO')} COP (${
        effectiveMethod === 'EFECTIVO' ? 'Efectivo en Taquilla' : 'Transferencia Bancaria'
      }) fue radicada con éxito.`,
      payload: {
        cycleId: params.sourceCycleId,
        usdAmount: 0,
        copAmount: params.amountCop,
        userProfitCop: 0,
        userPercentage: user.userPercentage,
      },
      isRead: false,
      sentAt: new Date().toISOString(),
      readAt: null,
    });

    this.addAuditLog({
      action: 'DISBURSEMENT_REQUESTED',
      performedBy: user.uid || user.id,
      performedByName: user.fullName,
      cycleId: params.sourceCycleId,
      targetEntity: newRequest.id,
      newValue: params.amountCop,
      reason: `Solicitud de desembolso (${effectiveMethod})${
        params.amountCop > 10_000_000 ? ' - Aplicada regla: > $10M COP obligatoriamente en efectivo' : ''
      }`,
      details: {
        method: effectiveMethod,
        amountCop: params.amountCop,
        userCode: user.userCode,
      },
    });

    this.notify();
    return newRequest;
  }

  public approveDisbursement(
    requestId: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ) {
    const reqIndex = this.disbursements.findIndex((d) => d.id === requestId);
    if (reqIndex < 0) throw new Error('Solicitud de desembolso no encontrada.');

    const req = this.disbursements[reqIndex];
    if (req.status !== 'PENDING') throw new Error('La solicitud ya fue procesada.');

    this.disbursements[reqIndex] = {
      ...req,
      status: 'APPROVED',
      resolvedAt: new Date().toISOString(),
      resolvedBy: adminName,
    };

    const user = this.getUserById(req.userId);
    if (user) {
      this.notifications.unshift({
        id: `notif_disb_appr_${Date.now()}`,
        userId: user.id,
        userCode: user.userCode,
        userName: user.fullName,
        cycleId: req.sourceCycleId,
        type: 'DISBURSEMENT',
        title: '¡Desembolso Aprobado!',
        message: `Tu desembolso por $${req.amountCop.toLocaleString('es-CO')} COP ha sido aprobado por Tesorería. Método: ${
          req.method === 'EFECTIVO' ? 'Efectivo en Taquilla' : 'Transferencia Bancaria'
        }.`,
        payload: {
          cycleId: req.sourceCycleId,
          usdAmount: 0,
          copAmount: req.amountCop,
          userProfitCop: 0,
          userPercentage: user.userPercentage,
        },
        isRead: false,
        sentAt: new Date().toISOString(),
        readAt: null,
      });
    }

    this.addAuditLog({
      action: 'DISBURSEMENT_APPROVED',
      performedBy: adminUid,
      performedByName: adminName,
      targetEntity: req.id,
      newValue: req.amountCop,
      details: {
        userCode: req.userCode,
        amountCop: req.amountCop,
        method: req.method,
      },
    });

    this.notify();
  }

  public markDisbursementAsPaid(
    requestId: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal',
    voucherOrNotes?: string
  ) {
    const reqIndex = this.disbursements.findIndex((d) => d.id === requestId);
    if (reqIndex < 0) throw new Error('Solicitud de desembolso no encontrada.');

    const req = this.disbursements[reqIndex];
    this.disbursements[reqIndex] = {
      ...req,
      status: 'PAID',
      resolvedAt: new Date().toISOString(),
      resolvedBy: adminName,
      paidAt: new Date().toISOString(),
      paymentVoucher: voucherOrNotes || null,
      notes: voucherOrNotes
        ? `${req.notes ? req.notes + ' | ' : ''}Liquidado: ${voucherOrNotes}`
        : req.notes,
    };

    const user = this.getUserById(req.userId);
    if (user) {
      this.notifications.unshift({
        id: `notif_disb_paid_${Date.now()}`,
        userId: user.id,
        userCode: user.userCode,
        userName: user.fullName,
        cycleId: req.sourceCycleId,
        type: 'DISBURSEMENT',
        title: '¡Desembolso Liquidado y Entregado!',
        message: `Tu desembolso por $${req.amountCop.toLocaleString('es-CO')} COP ha sido procesado y entregado exitosamente mediante ${
          req.method === 'EFECTIVO' ? 'Efectivo en Taquilla' : 'Transferencia Bancaria'
        }.`,
        payload: {
          cycleId: req.sourceCycleId,
          usdAmount: 0,
          copAmount: req.amountCop,
          userProfitCop: 0,
          userPercentage: user.userPercentage,
        },
        isRead: false,
        sentAt: new Date().toISOString(),
        readAt: null,
      });
    }

    this.addAuditLog({
      action: 'DISBURSEMENT_PAID',
      performedBy: adminUid,
      performedByName: adminName,
      targetEntity: req.id,
      newValue: req.amountCop,
      details: {
        userCode: req.userCode,
        amountCop: req.amountCop,
        method: req.method,
        voucherOrNotes,
      },
    });

    this.notify();
  }

  public rejectDisbursement(
    requestId: string,
    reason?: string,
    adminUid: string = 'admin_root_uid',
    adminName: string = 'Administrador Principal'
  ) {
    const reqIndex = this.disbursements.findIndex((d) => d.id === requestId);
    if (reqIndex < 0) throw new Error('Solicitud de desembolso no encontrada.');

    const req = this.disbursements[reqIndex];
    this.disbursements[reqIndex] = {
      ...req,
      status: 'REJECTED',
      resolvedAt: new Date().toISOString(),
      resolvedBy: adminName,
      rejectionReason: reason || null,
      notes: reason ? `${req.notes ? req.notes + ' | ' : ''}Rechazo: ${reason}` : req.notes,
    };

    const user = this.getUserById(req.userId);
    if (user) {
      this.notifications.unshift({
        id: `notif_disb_rej_${Date.now()}`,
        userId: user.id,
        userCode: user.userCode,
        userName: user.fullName,
        cycleId: req.sourceCycleId,
        type: 'DISBURSEMENT',
        title: 'Solicitud de Desembolso Rechazada',
        message: `Tu solicitud de desembolso por $${req.amountCop.toLocaleString('es-CO')} COP no pudo ser tramitada.${
          reason ? ' Motivo: ' + reason : ''
        }`,
        payload: {
          cycleId: req.sourceCycleId,
          usdAmount: 0,
          copAmount: req.amountCop,
          userProfitCop: 0,
          userPercentage: user.userPercentage,
        },
        isRead: false,
        sentAt: new Date().toISOString(),
        readAt: null,
      });
    }

    this.addAuditLog({
      action: 'DISBURSEMENT_REJECTED',
      performedBy: adminUid,
      performedByName: adminName,
      targetEntity: req.id,
      reason: reason || 'Rechazado por tesorería',
      details: {
        userCode: req.userCode,
        amountCop: req.amountCop,
      },
    });

    this.notify();
  }

  public markNotificationAsRead(notifId: string) {
    const notif = this.notifications.find((n) => n.id === notifId);
    if (notif && !notif.isRead) {
      notif.isRead = true;
      notif.readAt = new Date().toISOString();
      this.notify();
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

    // Disparar Notificación Push a los Administradores
    notifyNewApplicationToAdmin({
      applicantName: newApp.fullName,
      requestedCapitalCop: newApp.requestedCapitalCop,
      queuePosition: newApp.queuePosition,
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
    adminName: string = 'Administrador Principal'
  ): { importedCount: number; startingTurn: number } {
    if (!rows || rows.length === 0) {
      return { importedCount: 0, startingTurn: 0 };
    }

    const currentMaxTurn = this.applications.reduce(
      (max, item) => Math.max(max, item.queuePosition || 0),
      0
    );
    const startingTurn = currentMaxTurn + 1;

    const newItems: InvestorApplication[] = rows.map((r, idx) => {
      const turn = r.excelTurno && Number(r.excelTurno) > 0 ? Number(r.excelTurno) : startingTurn + idx;
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

    this.addAuditLog({
      action: 'APPLICATIONS_IMPORTED',
      performedBy: adminUid,
      performedByName: adminName,
      targetEntity: 'investor_applications',
      details: {
        count: newItems.length,
        startingTurn,
        endingTurn: startingTurn + newItems.length - 1,
      },
      reason: 'Carga masiva de solicitudes históricas en estricto orden de llegada FIFO',
    });

    this.notify();
    return { importedCount: newItems.length, startingTurn };
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
    const originUrl = typeof window !== 'undefined' ? window.location.origin : 'https://easytraders.app';
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

    this.notify();
  }

  public reorderApplicationQueue(applicationId: string, newTurn: number) {
    const appIndex = this.applications.findIndex((a) => a.id === applicationId);
    if (appIndex < 0) throw new Error('Solicitud no encontrada.');
    const app = this.applications[appIndex];
    app.queuePosition = Math.max(1, newTurn);
    this.notify();
  }

  // ==========================================
  // VINCULACIÓN / ACTIVACIÓN DE CUENTA (CLAIM)
  // ==========================================
  public claimAccount(
    identifier: string,
    newEmail: string,
    newPassword?: string
  ): { success: boolean; user?: UserProfile; message: string } {
    const cleanId = identifier.trim().toUpperCase();
    const user = this.users.find((u) =>
      u.userCode.toUpperCase() === cleanId ||
      (u.documentId && u.documentId.trim() === identifier.trim()) ||
      (u.email && u.email.trim().toLowerCase() === identifier.trim().toLowerCase())
    );

    if (!user) {
      return {
        success: false,
        message: 'No se encontró ninguna cuenta asociada a este código o documento de identidad.',
      };
    }

    user.email = newEmail.trim().toLowerCase();
    if (newPassword) {
      user.password = newPassword.trim();
    }
    user.isClaimed = true;
    user.claimedAt = new Date().toISOString();

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
    if (cleanLower === 'admin' || cleanLower === 'admin@easytraders.com') {
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
