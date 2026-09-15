import { firestoreService } from './firestoreService';
import { 
  UserProfile, 
  DailyGroupOperation, 
  CycleFinancialSummary,
  OperationTargetType 
} from '../types';

export interface ReconciliationReport {
  success: boolean;
  usersReconciled: number;
  operationsReconciled: number;
  financialSummariesCreated: number;
  errors: string[];
  executionTimeMs: number;
  timestamp: string;
}

/**
 * Servicio de Migración Histórica y Reconciliación de Datos en Firestore.
 * Sanea y retroalimenta documentos legacy para garantizar aislamiento criptográfico total.
 */
export const historicalMigrationService = {
  /**
   * Reconcilia la colección `users`, garantizando que id === uid, campos numéricos y estado válido.
   */
  async reconcileUsers(): Promise<{ reconciledCount: number; errors: string[] }> {
    const errors: string[] = [];
    let reconciledCount = 0;

    try {
      const users = await firestoreService.getAllUsers();

      for (const user of users) {
        try {
          const targetUid = user.uid || user.id;
          let needsUpdate = false;

          const updatedUser: UserProfile = { ...user };

          if (!user.uid || user.uid !== targetUid) {
            updatedUser.uid = targetUid;
            updatedUser.id = targetUid;
            needsUpdate = true;
          }

          if (typeof user.currentCapital !== 'number' || isNaN(user.currentCapital)) {
            updatedUser.currentCapital = Number(user.currentCapital) || 0;
            needsUpdate = true;
          }

          if (!user.status) {
            updatedUser.status = 'ACTIVE';
            needsUpdate = true;
          }

          if (!user.userPercentage) {
            updatedUser.userPercentage = 75;
            updatedUser.adminPercentage = 25;
            needsUpdate = true;
          }

          if (user.migrationStatus !== 'MIGRATED') {
            updatedUser.migrationStatus = 'MIGRATED';
            needsUpdate = true;
          }

          if (needsUpdate) {
            await firestoreService.saveUser(updatedUser);
            reconciledCount++;
          }
        } catch (err: any) {
          errors.push(`Error reconciliando usuario ${user.id || user.fullName}: ${err?.message}`);
        }
      }
    } catch (err: any) {
      errors.push(`Error al obtener usuarios para reconciliación: ${err?.message}`);
    }

    return { reconciledCount, errors };
  },

  /**
   * Reconcilia la colección `dailyOperations`, inyectando `targetType`, `authorizedUids` e `isPublicToActiveUsers`.
   */
  async reconcileDailyOperations(): Promise<{ reconciledCount: number; errors: string[] }> {
    const errors: string[] = [];
    let reconciledCount = 0;

    try {
      const allOps = await firestoreService.getAllDailyOperations();
      const allUsers = await firestoreService.getAllUsers();

      for (const op of allOps) {
        try {
          let needsUpdate = false;
          let targetType: OperationTargetType = op.targetType || 'CUSTOM_GROUP';
          let authorizedUids: string[] = op.authorizedUids || [];
          let isPublicToActiveUsers: boolean = op.isPublicToActiveUsers ?? false;

          // 1. Si la operación tiene destinatario individual
          if (op.userId || op.userUid) {
            targetType = 'INDIVIDUAL';
            const matchedUser = allUsers.find(
              (u) => u.id === op.userId || u.uid === op.userUid || (op.userCode && u.userCode === op.userCode)
            );
            const userUid = matchedUser?.uid || matchedUser?.id || op.userUid || op.userId;
            authorizedUids = userUid ? [userUid] : [];
            isPublicToActiveUsers = false;
            needsUpdate = true;
          } 
          // 2. Si es una operación global
          else if (op.targetType === 'GLOBAL' || (!op.category && !op.groupCapitalCop)) {
            targetType = 'GLOBAL';
            authorizedUids = [];
            isPublicToActiveUsers = true;
            needsUpdate = true;
          } 
          // 3. Si pertenece a una categoría o grupo de capital
          else {
            targetType = 'CUSTOM_GROUP';
            isPublicToActiveUsers = false;

            const groupUsers = allUsers.filter((u) => {
              const capitalMatch = Number(u.currentCapital) === Number(op.groupCapitalCop);
              const catMatch = !op.category || u.category === op.category;
              return capitalMatch && catMatch && u.status === 'ACTIVE';
            });

            authorizedUids = Array.from(
              new Set(
                groupUsers
                  .map((u) => u.uid || u.id)
                  .filter((uid): uid is string => Boolean(uid && uid.trim().length > 0))
              )
            );
            needsUpdate = true;
          }

          if (needsUpdate || !op.migrationStatus || op.migrationStatus !== 'MIGRATED') {
            const updatedOp: DailyGroupOperation = {
              ...op,
              targetType,
              authorizedUids,
              isPublicToActiveUsers,
              migrationStatus: 'MIGRATED',
            };

            await firestoreService.saveDailyOperation(updatedOp);
            reconciledCount++;
          }
        } catch (err: any) {
          errors.push(`Error reconciliando operación diaria ${op.id}: ${err?.message}`);
        }
      }
    } catch (err: any) {
      errors.push(`Error al obtener operaciones para reconciliación: ${err?.message}`);
    }

    return { reconciledCount, errors };
  },

  /**
   * Reconcilia resúmenes financieros privados (`cycleFinancialSummaries`) para cada ciclo en `monthlyCycles`.
   */
  async reconcileFinancialSummaries(): Promise<{ createdCount: number; errors: string[] }> {
    const errors: string[] = [];
    let createdCount = 0;

    try {
      const cycles = await firestoreService.getAllCycles();

      for (const cycle of cycles) {
        try {
          const cycleId = cycle.cycleId || cycle.id;
          const existingSummary = await firestoreService.getFinancialSummary(cycleId);

          if (!existingSummary) {
            const newSummary: CycleFinancialSummary = {
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
              updatedBy: 'historical_migration_service',
            };

            await firestoreService.saveFinancialSummary(newSummary);
            createdCount++;
          }
        } catch (err: any) {
          errors.push(`Error reconciliando resumen financiero para ciclo ${cycle.id}: ${err?.message}`);
        }
      }
    } catch (err: any) {
      errors.push(`Error al obtener ciclos para reconciliación de resúmenes: ${err?.message}`);
    }

    return { createdCount, errors };
  },

  /**
   * Ejecuta el ciclo completo de migración y auditoría histórica.
   */
  async runFullHistoricalReconciliation(): Promise<ReconciliationReport> {
    const startTime = Date.now();
    const allErrors: string[] = [];

    console.log('[Migration] Iniciando Reconciliación Histórica de Datos...');

    const userRes = await this.reconcileUsers();
    allErrors.push(...userRes.errors);

    const opRes = await this.reconcileDailyOperations();
    allErrors.push(...opRes.errors);

    const summaryRes = await this.reconcileFinancialSummaries();
    allErrors.push(...summaryRes.errors);

    const executionTimeMs = Date.now() - startTime;
    console.log(`[Migration] Reconciliación completada en ${executionTimeMs}ms.`);

    return {
      success: allErrors.length === 0,
      usersReconciled: userRes.reconciledCount,
      operationsReconciled: opRes.reconciledCount,
      financialSummariesCreated: summaryRes.createdCount,
      errors: allErrors,
      executionTimeMs,
      timestamp: new Date().toISOString(),
    };
  },
};
