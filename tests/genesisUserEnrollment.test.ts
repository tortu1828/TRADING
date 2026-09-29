import { describe, it, expect, vi } from 'vitest';
import {
  isCycleValidForFutureEnrollment,
  resolveDefaultTargetCycleId,
} from '../src/components/UserManagementView';
import { MonthlyCycle } from '../src/types';

describe('Génesis User Enrollment & Cycle Resolution (GENESIS-USER Tests)', () => {
  const genesisPreparingCycle: MonthlyCycle = {
    id: 'cyc_genesis_uuid',
    cycleId: 'cyc_genesis_uuid',
    name: 'Ciclo Génesis',
    status: 'OPEN',
    operationalStatus: 'PREPARING',
    isGenesis: true,
    previousCycleId: null,
    nextCycleId: null,
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

  const normalPredecessorClosed: MonthlyCycle = {
    id: 'cyc_prev_01',
    cycleId: 'cyc_prev_01',
    name: 'Ciclo Octubre 2026',
    status: 'CLOSED',
    operationalStatus: 'STARTED',
    previousCycleId: null,
    nextCycleId: 'cyc_succ_02',
    trmApplied: 4100,
    totalManagedCapital: 50000000,
    totalUsersActive: 5,
    calculatedUsersCount: 5,
    totalGroupsCount: 1,
    calculatedGroupsCount: 1,
    totalGrossUsd: 1000,
    totalGrossCop: 4100000,
    totalUsersProfitCop: 2050000,
    totalAdminCommissionCop: 2050000,
    notificationsSent: true,
    notificationsSentAt: null,
    closedAt: '2026-10-31T00:00:00Z',
    closedBy: 'admin',
  };

  const normalPredecessorOpen: MonthlyCycle = {
    ...normalPredecessorClosed,
    status: 'OPEN',
    closedAt: null,
  };

  const normalSuccessorPreparing: MonthlyCycle = {
    id: 'cyc_succ_02',
    cycleId: 'cyc_succ_02',
    name: 'Ciclo Noviembre 2026',
    status: 'OPEN',
    operationalStatus: 'PREPARING',
    isGenesis: false,
    previousCycleId: 'cyc_prev_01',
    nextCycleId: null,
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

  it('GENESIS-USER-01: Génesis PREPARING + previousCycleId null se considera ciclo válido para ingreso', () => {
    const isValid = isCycleValidForFutureEnrollment(
      genesisPreparingCycle,
      () => undefined
    );
    expect(isValid).toBe(true);
  });

  it('GENESIS-USER-02: No operationalCycleId + Génesis PREPARING -> formTargetCycleId por defecto = preparingCycleId', () => {
    const isValid = isCycleValidForFutureEnrollment(
      genesisPreparingCycle,
      () => undefined
    );
    expect(isValid).toBe(true);

    const defaultCycleId = resolveDefaultTargetCycleId({
      operationalCycleId: null,
      preparingCycle: genesisPreparingCycle,
      hasValidFutureCycle: isValid,
    });

    expect(defaultCycleId).toBe('cyc_genesis_uuid');
  });

  it('GENESIS-USER-03: Creación de usuario en Génesis -> asegura targetCycleId igual a preparingCycleId', () => {
    const isValid = isCycleValidForFutureEnrollment(
      genesisPreparingCycle,
      () => undefined
    );

    // Simula lógica de handleSave cuando operationalCycleId es null y preparingCycle está en PREPARING
    const operationalCycleId = null;
    const formTargetCycleId = ''; // Aunque el form tuviera string vacío
    const effectiveTargetCycleId =
      !operationalCycleId && isValid && genesisPreparingCycle
        ? formTargetCycleId || genesisPreparingCycle.cycleId
        : formTargetCycleId || null;

    expect(effectiveTargetCycleId).toBe('cyc_genesis_uuid');
  });

  it('GENESIS-USER-04: Ciclo sucesor normal conserva regla predecessor CLOSED', () => {
    // 1. Con predecessor CLOSED -> válido
    const cycleStoreWithClosed = new Map<string, MonthlyCycle>([
      ['cyc_prev_01', normalPredecessorClosed],
    ]);
    const isValidClosed = isCycleValidForFutureEnrollment(
      normalSuccessorPreparing,
      (id) => cycleStoreWithClosed.get(id)
    );
    expect(isValidClosed).toBe(true);

    // 2. Con predecessor OPEN -> inválido para ingreso anticipado
    const cycleStoreWithOpen = new Map<string, MonthlyCycle>([
      ['cyc_prev_01', normalPredecessorOpen],
    ]);
    const isValidOpen = isCycleValidForFutureEnrollment(
      normalSuccessorPreparing,
      (id) => cycleStoreWithOpen.get(id)
    );
    expect(isValidOpen).toBe(false);

    // 3. Con predecessor inexistente -> inválido
    const isValidMissing = isCycleValidForFutureEnrollment(
      normalSuccessorPreparing,
      () => undefined
    );
    expect(isValidMissing).toBe(false);
  });

  it('GENESIS-USER-05: Sin operationalCycleId y con preparingCycle válido -> no se permite guardar targetCycleId null', () => {
    const isValid = isCycleValidForFutureEnrollment(
      genesisPreparingCycle,
      () => undefined
    );
    const operationalCycleId = null;

    // Supongamos que se calcula effectiveTargetCycleId
    const effectiveTargetCycleId =
      !operationalCycleId && isValid && genesisPreparingCycle
        ? genesisPreparingCycle.cycleId
        : null;

    expect(effectiveTargetCycleId).not.toBeNull();
    expect(effectiveTargetCycleId).toBe('cyc_genesis_uuid');
  });
});
