import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

interface MockDocSnap {
  exists: boolean;
  data: () => any;
  ref?: any;
  id?: string;
}

interface MockStore {
  getDoc(collection: string, id: string): any;
  setDoc(collection: string, id: string, data: any): void;
  updateDoc(collection: string, id: string, data: any): void;
  query(collection: string, filter: (doc: any) => boolean): { id: string; ref: any; data: () => any }[];
}

class InMemoryDb implements MockStore {
  private data = new Map<string, Map<string, any>>();

  private getCol(col: string) {
    if (!this.data.has(col)) {
      this.data.set(col, new Map());
    }
    return this.data.get(col)!;
  }

  getDoc(col: string, id: string): any {
    const d = this.getCol(col).get(id);
    return d ? JSON.parse(JSON.stringify(d)) : undefined;
  }

  setDoc(col: string, id: string, d: any) {
    this.getCol(col).set(id, JSON.parse(JSON.stringify(d)));
  }

  updateDoc(col: string, id: string, d: any) {
    const existing = this.getDoc(col, id) || {};
    this.getCol(col).set(id, { ...existing, ...JSON.parse(JSON.stringify(d)) });
  }

  query(col: string, filter: (doc: any) => boolean) {
    const res: { id: string; ref: any; data: () => any }[] = [];
    for (const [id, val] of this.getCol(col).entries()) {
      if (filter(val)) {
        res.push({
          id,
          ref: { col, id },
          data: () => JSON.parse(JSON.stringify(val)),
        });
      }
    }
    return res;
  }
}

// Helpers que reproducen exactamente las reglas de Phase 2A
function getCategoryForCapital(capitalCop: number): string {
  if (capitalCop >= 50000000) return 'DIAMANTE';
  if (capitalCop >= 30000000) return 'ORO';
  if (capitalCop >= 15000000) return 'PLATA';
  if (capitalCop >= 5000000) return 'BRONCE';
  return 'AZUL';
}

function getCategoryPercentages(category: string): { userPct: number; adminPct: number } {
  switch (category) {
    case 'DIAMANTE':
      return { userPct: 90, adminPct: 10 };
    case 'ORO':
      return { userPct: 85, adminPct: 15 };
    case 'PLATA':
      return { userPct: 80, adminPct: 20 };
    case 'BRONCE':
      return { userPct: 75, adminPct: 25 };
    default:
      return { userPct: 70, adminPct: 30 };
  }
}

// 1. Simulación de adminCloseCycleCallable
function simulateCloseCycle({
  db,
  cycleAId,
  clientRequestId,
  authUid = 'admin_uid',
  adminName = 'Admin',
}: {
  db: InMemoryDb;
  cycleAId: string;
  clientRequestId: string;
  authUid?: string;
  adminName?: string;
}) {
  const cycleA = db.getDoc('monthlyCycles', cycleAId);
  if (!cycleA) throw new Error(`El ciclo ${cycleAId} no existe.`);

  if (cycleA.status === 'CLOSED') {
    const lastAttemptId = cycleA.lastClosureRequestId || cycleA.lastClosureAttemptId;
    if (clientRequestId && lastAttemptId && clientRequestId === lastAttemptId) {
      return {
        alreadyClosed: true,
        idempotentRetry: true,
        cycleClosed: true,
        closureVersion: cycleA.closureVersion,
      };
    }
    throw new Error(`CYCLE_ALREADY_CLOSED: El ciclo ${cycleAId} ya se encuentra cerrado.`);
  }

  if (cycleA.status !== 'OPEN' && cycleA.status !== 'REOPENED') {
    throw new Error(`El ciclo ${cycleAId} se encuentra en estado ${cycleA.status}.`);
  }

  if (!cycleA.nextCycleId) {
    throw new Error('El ciclo no tiene un sucesor configurado (nextCycleId).');
  }

  const cycleBId = cycleA.nextCycleId;
  const cycleB = db.getDoc('monthlyCycles', cycleBId);
  if (!cycleB) throw new Error(`El ciclo sucesor ${cycleBId} no existe.`);
  if (cycleB.previousCycleId !== cycleAId || cycleB.status !== 'OPEN' || cycleB.operationalStatus !== 'PREPARING') {
    throw new Error('Inconsistencia en el ciclo sucesor B.');
  }

  // Verificar solicitudes PENDING o NEEDS_REVIEW
  const allReinv = db.query('reinvestments', (d) => d.sourceCycleId === cycleAId);
  const pendingOrNeedsReview = allReinv.filter(
    (r) => r.data().status === 'PENDING' || r.data().status === 'NEEDS_REVIEW'
  );
  if (pendingOrNeedsReview.length > 0) {
    return { gate1Blocked: true, pendingCount: pendingOrNeedsReview.length };
  }

  const approvedReinv = allReinv.filter((r) => r.data().status === 'APPROVED');
  const pendingItemsToApply: any[] = [];

  for (const r of approvedReinv) {
    const reinvData = r.data();
    const uid = reinvData.userUid || reinvData.userId;
    const user = db.getDoc('users', uid);
    if (!user || user.status !== 'ACTIVE') throw new Error(`Usuario ${uid} inválido.`);

    const userRes = db.getDoc('cycleUserResults', `${cycleAId}_${uid}`);
    if (!userRes) throw new Error(`CYCLE_RESULT_NOT_FOUND para ${cycleAId}_${uid}`);

    const baseCapitalCop = Number(userRes.cycleCapitalCop || 0);
    const userProfitCop = Number(userRes.userProfitCop || 0);

    if (reinvData.currentCapitalSnapshotCop !== undefined && reinvData.currentCapitalSnapshotCop !== null) {
      if (Math.round(Number(reinvData.currentCapitalSnapshotCop)) !== Math.round(baseCapitalCop)) {
        throw new Error('CAPITAL_BASE_SNAPSHOT_MISMATCH');
      }
    }

    let desiredIncreaseCop = 0;
    let profitAppliedCop = 0;
    let cashInjectionCop = 0;

    if (reinvData.modality === 'PROFIT_REINVESTMENT') {
      desiredIncreaseCop = Number(
        reinvData.desiredCapitalIncreaseCop !== undefined
          ? reinvData.desiredCapitalIncreaseCop
          : reinvData.reinvestAmountCop !== undefined
          ? reinvData.reinvestAmountCop
          : userProfitCop
      );
      profitAppliedCop = Math.min(Math.max(userProfitCop, 0), desiredIncreaseCop);
      cashInjectionCop = 0;
    } else {
      desiredIncreaseCop = Number(
        reinvData.desiredCapitalIncreaseCop !== undefined
          ? reinvData.desiredCapitalIncreaseCop
          : reinvData.totalIncreaseCop || 0
      );
      profitAppliedCop = Math.min(Math.max(userProfitCop, 0), desiredIncreaseCop);
      cashInjectionCop = Math.max(desiredIncreaseCop - profitAppliedCop, 0);
    }

    // Regla de Asignación Absoluta
    const securedNextCapitalCop = baseCapitalCop + profitAppliedCop;
    const projectedNextCapitalCop = securedNextCapitalCop + cashInjectionCop;
    const securedCategory = getCategoryForCapital(securedNextCapitalCop);

    let fundingReconciliationStatus = 'OK';
    let fundingReconciliationReason = null;
    if (reinvData.externalFundingStatus === 'CONFIRMED') {
      const confirmedAmount = Number(reinvData.confirmedAmountCop || 0);
      if (confirmedAmount === cashInjectionCop) {
        fundingReconciliationStatus = 'OK';
      } else {
        fundingReconciliationStatus = 'NEEDS_REVIEW';
        fundingReconciliationReason = `CONFIRMED_AMOUNT_MISMATCH: Recibidos ${confirmedAmount} vs requeridos ${cashInjectionCop}`;
      }
    }

    pendingItemsToApply.push({
      reinvId: r.id,
      uid,
      securedNextCapitalCop,
      projectedNextCapitalCop,
      securedCategory,
      profitAppliedCop,
      cashInjectionCop,
      totalIncreaseCop: profitAppliedCop + cashInjectionCop,
      fundingReconciliationStatus,
      fundingReconciliationReason,
    });
  }

  // Límite de escrituras atómicas: 4 fijas + 2 * N
  const requiredCloseWrites = 4 + pendingItemsToApply.length * 2;
  if (requiredCloseWrites > 450) {
    throw new Error('CLOSE_TOO_LARGE_FOR_ATOMIC_COMMIT');
  }

  // Commit Atómico
  const currentClosureVersion = Number(cycleA.closureVersion || 0);
  const newClosureVersion = currentClosureVersion + 1;
  const nowIso = new Date().toISOString();

  for (const item of pendingItemsToApply) {
    // 1. users: Asignación ABSOLUTA (no +=, no cash)
    db.updateDoc('users', item.uid, {
      currentCapital: item.securedNextCapitalCop,
      category: item.securedCategory,
      updatedAt: nowIso,
    });

    // 2. reinvestments
    db.updateDoc('reinvestments', item.reinvId, {
      status: 'APPROVED',
      appliedClosureVersion: newClosureVersion,
      profitAppliedAtCycleClosure: true,
      securedNextCapitalCop: item.securedNextCapitalCop,
      projectedNextCapitalCop: item.projectedNextCapitalCop,
      capitalAfterClosureCop: item.securedNextCapitalCop,
      profitAppliedCop: item.profitAppliedCop,
      cashInjectionCop: item.cashInjectionCop,
      totalIncreaseCop: item.totalIncreaseCop,
      fundingReconciliationStatus: item.fundingReconciliationStatus,
      fundingReconciliationReason: item.fundingReconciliationReason,
      updatedAt: nowIso,
    });
  }

  // 3. monthlyCycles/A
  db.updateDoc('monthlyCycles', cycleAId, {
    status: 'CLOSED',
    closureVersion: newClosureVersion,
    lastClosureRequestId: clientRequestId,
    closedAt: nowIso,
    updatedAt: nowIso,
  });

  // 4. monthlyCycles/B
  db.updateDoc('monthlyCycles', cycleBId, {
    sourceClosureVersion: newClosureVersion,
    preparationNeedsReview: false,
    updatedAt: nowIso,
  });

  // 5. cycleFinancialSummaries/A
  db.updateDoc('cycleFinancialSummaries', cycleAId, {
    isCycleClosed: true,
    closedAt: nowIso,
    updatedAt: nowIso,
  });

  // 6. settings/global_config
  db.updateDoc('settings', 'global_config', {
    operationalCycleId: null,
    preparingCycleId: cycleBId,
    activeCycleId: cycleBId,
    updatedAt: nowIso,
  });

  return {
    success: true,
    closureVersion: newClosureVersion,
    appliedCount: pendingItemsToApply.length,
  };
}

// 2. Simulación de adminReopenCycleCallable
function simulateReopenCycle({ db, cycleAId }: { db: InMemoryDb; cycleAId: string }) {
  const cycleA = db.getDoc('monthlyCycles', cycleAId);
  if (!cycleA || cycleA.status !== 'CLOSED') throw new Error('Solo ciclos CLOSED pueden reabrirse.');

  const nowIso = new Date().toISOString();
  db.updateDoc('monthlyCycles', cycleAId, {
    status: 'REOPENED',
    reopenedAt: nowIso,
    updatedAt: nowIso,
  });

  if (cycleA.nextCycleId) {
    const cycleB = db.getDoc('monthlyCycles', cycleA.nextCycleId);
    if (cycleB && cycleB.operationalStatus === 'PREPARING') {
      db.updateDoc('monthlyCycles', cycleA.nextCycleId, {
        preparationNeedsReview: true,
        updatedAt: nowIso,
      });
    }
  }

  const summary = db.getDoc('cycleFinancialSummaries', cycleAId);
  if (summary) {
    db.updateDoc('cycleFinancialSummaries', cycleAId, {
      isCycleClosed: false,
      closedAt: null,
      updatedAt: nowIso,
    });
  }
}

// 3. Simulación de adminConfirmExternalContributionCallable
function simulateConfirmExternalContribution({
  db,
  reinvId,
  confirmedAmountCop,
}: {
  db: InMemoryDb;
  reinvId: string;
  confirmedAmountCop: number;
}) {
  const reinv = db.getDoc('reinvestments', reinvId);
  if (!reinv) throw new Error('Solicitud no encontrada.');

  const targetCycleId = reinv.targetCycleId;
  const targetCycle = db.getDoc('monthlyCycles', targetCycleId);
  if (!targetCycle || targetCycle.operationalStatus !== 'PREPARING') {
    throw new Error('El ciclo objetivo no está en PREPARING.');
  }

  const predecessorId = targetCycle.previousCycleId;
  const predecessorCycle = db.getDoc('monthlyCycles', predecessorId);
  if (!predecessorCycle || predecessorCycle.status !== 'CLOSED') {
    throw new Error('El ciclo predecesor no está CLOSED.');
  }

  const requiredCash = Number(reinv.cashInjectionCop || 0);
  let fundingReconciliationStatus = 'OK';
  let fundingReconciliationReason = null;

  if (confirmedAmountCop !== requiredCash) {
    fundingReconciliationStatus = 'NEEDS_REVIEW';
    fundingReconciliationReason = `CONFIRMED_AMOUNT_MISMATCH: Recibidos ${confirmedAmountCop} vs requeridos ${requiredCash}`;
  }

  db.updateDoc('reinvestments', reinvId, {
    externalFundingStatus: 'CONFIRMED',
    confirmedAmountCop,
    fundingReconciliationStatus,
    fundingReconciliationReason,
  });
}

// 4. Simulación de adminStartCycleCallable
function simulateStartCycle({
  db,
  cycleBId,
  clientRequestId,
}: {
  db: InMemoryDb;
  cycleBId: string;
  clientRequestId: string;
}) {
  const cycleB = db.getDoc('monthlyCycles', cycleBId);
  if (!cycleB) throw new Error(`Ciclo ${cycleBId} no existe.`);

  if (cycleB.operationalStatus === 'STARTED') {
    if (clientRequestId && cycleB.lastStartRequestId === clientRequestId) {
      return { success: true, alreadyStarted: true };
    }
    throw new Error('CYCLE_ALREADY_STARTED');
  }

  if (cycleB.status !== 'OPEN' || cycleB.operationalStatus !== 'PREPARING') {
    throw new Error('El ciclo debe estar en OPEN y PREPARING.');
  }

  const predecessorId = cycleB.previousCycleId;
  if (!predecessorId) throw new Error('Sin predecesor.');
  const cycleA = db.getDoc('monthlyCycles', predecessorId);
  if (!cycleA || cycleA.status !== 'CLOSED' || cycleA.nextCycleId !== cycleBId) {
    throw new Error('Predecesor no es válido o no está CLOSED.');
  }

  if (Number(cycleB.sourceClosureVersion || 0) !== Number(cycleA.closureVersion || 0)) {
    throw new Error('STALE_CLOSURE_VERSION: sourceClosureVersion no coincide con closureVersion de A.');
  }

  if (cycleB.preparationNeedsReview === true) {
    throw new Error('PREPARATION_NEEDS_REVIEW: B marcado para revisión tras reapertura de A.');
  }

  const summary = db.getDoc('cycleFinancialSummaries', cycleBId);
  if (summary) {
    throw new Error('CYCLE_FINANCIAL_SUMMARY_ALREADY_INITIALIZED');
  }

  // Solicitudes asociadas
  const reinvs = db.query(
    'reinvestments',
    (d) => d.sourceCycleId === predecessorId && d.targetCycleId === cycleBId
  );
  for (const r of reinvs) {
    const data = r.data();
    if (data.status === 'PENDING' || data.status === 'NEEDS_REVIEW') {
      throw new Error('PENDING_REQUESTS_BLOCK_START');
    }
    if (data.fundingReconciliationStatus === 'NEEDS_REVIEW') {
      throw new Error('FUNDING_RECONCILIATION_NEEDS_REVIEW');
    }
  }

  const reinvMap = new Map();
  reinvs.forEach((r) => {
    if (r.data().status === 'APPROVED') {
      reinvMap.set(r.data().userUid, { id: r.id, ...r.data() });
    }
  });

  // Carry forward cohorte
  const prevResults = db.query('cycleUserResults', (d) => d.cycleId === predecessorId);
  const participants: any[] = [];
  let userUpdatesCount = 0;
  let reinvUpdatesCount = 0;

  for (const doc of prevResults) {
    const ur = doc.data();
    const uid = ur.userUid;
    const user = db.getDoc('users', uid);
    if (!user || user.status !== 'ACTIVE') continue;

    const req = reinvMap.get(uid);
    let finalCapitalCop = Number(ur.cycleCapitalCop || 0);
    let reqToApply = null;

    if (req) {
      const baseSecured = Number(req.securedNextCapitalCop || finalCapitalCop);
      const cashCop = Number(req.cashInjectionCop || 0);
      let cashToAdd = 0;
      let finalFundingStatus = 'NOT_REQUIRED';
      if (cashCop > 0) {
        if (req.externalFundingStatus === 'CONFIRMED' && req.fundingReconciliationStatus !== 'NEEDS_REVIEW') {
          cashToAdd = cashCop;
          finalFundingStatus = 'CONFIRMED';
        } else {
          finalFundingStatus = 'NOT_RECEIVED';
        }
      }
      finalCapitalCop = baseSecured + cashToAdd;
      reqToApply = { id: req.id, finalCapitalCop, finalFundingStatus };
      reinvUpdatesCount++;
    }

    const cat = getCategoryForCapital(finalCapitalCop);
    if (user.currentCapital !== finalCapitalCop || user.category !== cat) {
      userUpdatesCount++;
    }

    participants.push({
      uid,
      userCode: user.userCode,
      finalCapitalCop,
      cat,
      reqToApply,
    });
  }

  // Fixed writes = 3: monthlyCycles/B, settings/global_config, cycleFinancialSummaries/B
  const requiredStartWrites = 3 + participants.length + userUpdatesCount + reinvUpdatesCount;
  if (requiredStartWrites > 450) {
    throw new Error('START_TOO_LARGE_FOR_ATOMIC_COMMIT');
  }

  const nowIso = new Date().toISOString();

  // Commit
  db.updateDoc('monthlyCycles', cycleBId, {
    operationalStatus: 'STARTED',
    startedAt: nowIso,
    lastStartRequestId: clientRequestId,
    updatedAt: nowIso,
  });

  db.setDoc('cycleFinancialSummaries', cycleBId, {
    cycleId: cycleBId,
    initialManagedCapitalCop: participants.reduce((acc, p) => acc + p.finalCapitalCop, 0),
    initialActiveUsersCount: participants.length,
    isCycleClosed: false,
    startedAt: nowIso,
  });

  db.setDoc('settings', 'global_config', {
    operationalCycleId: cycleBId,
    preparingCycleId: null,
    activeCycleId: cycleBId,
    updatedAt: nowIso,
  });

  for (const p of participants) {
    db.setDoc('cycleUserResults', `${cycleBId}_${p.uid}`, {
      cycleId: cycleBId,
      userUid: p.uid,
      cycleCapitalCop: p.finalCapitalCop,
      cycleCategory: p.cat,
      isFrozen: true,
    });

    db.updateDoc('users', p.uid, {
      currentCapital: p.finalCapitalCop,
      category: p.cat,
      updatedAt: nowIso,
    });

    if (p.reqToApply) {
      db.updateDoc('reinvestments', p.reqToApply.id, {
        status: 'APPLIED',
        finalCapitalCop: p.finalCapitalCop,
        externalFundingStatus: p.reqToApply.finalFundingStatus,
        appliedAtCycleStart: true,
        updatedAt: nowIso,
      });
    }
  }

  return {
    success: true,
    participantsCount: participants.length,
  };
}

describe('Fase 2A: Motor Financiero de Ciclos Arbitrarios', () => {
  it('TEST 1: CLOSE_V1_BASIC (A 10M + profit 5M -> users.currentCapital = 15M, v1)', () => {
    const db = new InMemoryDb();
    const cycleAId = 'cyc_A';
    const cycleBId = 'cyc_B';
    const uid = 'usr_1';

    db.setDoc('monthlyCycles', cycleAId, {
      status: 'OPEN',
      operationalStatus: 'STARTED',
      nextCycleId: cycleBId,
      closureVersion: 0,
    });
    db.setDoc('monthlyCycles', cycleBId, {
      status: 'OPEN',
      operationalStatus: 'PREPARING',
      previousCycleId: cycleAId,
      sourceClosureVersion: 0,
    });
    db.setDoc('users', uid, {
      status: 'ACTIVE',
      userCode: 'INV-001',
      currentCapital: 10000000,
      category: 'BRONCE',
    });
    db.setDoc('cycleUserResults', `${cycleAId}_${uid}`, {
      cycleId: cycleAId,
      userUid: uid,
      cycleCapitalCop: 10000000,
      userProfitCop: 5000000,
    });
    db.setDoc('reinvestments', 'reinv_1', {
      sourceCycleId: cycleAId,
      targetCycleId: cycleBId,
      userUid: uid,
      userCode: 'INV-001',
      status: 'APPROVED',
      modality: 'PROFIT_REINVESTMENT',
      desiredCapitalIncreaseCop: 5000000,
      currentCapitalSnapshotCop: 10000000,
    });

    const res = simulateCloseCycle({
      db,
      cycleAId,
      clientRequestId: 'req_close_v1',
    });

    expect(res.success).toBe(true);
    expect(res.closureVersion).toBe(1);

    const user = db.getDoc('users', uid);
    expect(user.currentCapital).toBe(15000000);
    expect(user.category).toBe('PLATA');

    const cycleA = db.getDoc('monthlyCycles', cycleAId);
    expect(cycleA.status).toBe('CLOSED');
    expect(cycleA.closureVersion).toBe(1);

    const cycleB = db.getDoc('monthlyCycles', cycleBId);
    expect(cycleB.sourceClosureVersion).toBe(1);
    expect(cycleB.preparationNeedsReview).toBe(false);

    const reinv = db.getDoc('reinvestments', 'reinv_1');
    expect(reinv.appliedClosureVersion).toBe(1);
    expect(reinv.securedNextCapitalCop).toBe(15000000);
  });

  it('TEST 2: CLOSE_V2_ABSOLUTE_AFTER_REOPEN (REOPEN -> Recálculo 6M -> users.currentCapital = 16M, NO 21M, NO 15M)', () => {
    const db = new InMemoryDb();
    const cycleAId = 'cyc_A';
    const cycleBId = 'cyc_B';
    const uid = 'usr_1';

    // 1. Setup ciclo cerrado en v1
    db.setDoc('monthlyCycles', cycleAId, {
      status: 'CLOSED',
      operationalStatus: 'STARTED',
      nextCycleId: cycleBId,
      closureVersion: 1,
      lastClosureRequestId: 'req_v1',
    });
    db.setDoc('monthlyCycles', cycleBId, {
      status: 'OPEN',
      operationalStatus: 'PREPARING',
      previousCycleId: cycleAId,
      sourceClosureVersion: 1,
      preparationNeedsReview: false,
    });
    db.setDoc('users', uid, {
      status: 'ACTIVE',
      userCode: 'INV-001',
      currentCapital: 15000000, // Capital dejado por v1
      category: 'PLATA',
    });
    db.setDoc('cycleUserResults', `${cycleAId}_${uid}`, {
      cycleId: cycleAId,
      userUid: uid,
      cycleCapitalCop: 10000000, // Base congelada original de A
      userProfitCop: 5000000,
    });
    db.setDoc('reinvestments', 'reinv_1', {
      sourceCycleId: cycleAId,
      targetCycleId: cycleBId,
      userUid: uid,
      userCode: 'INV-001',
      status: 'APPROVED',
      modality: 'PROFIT_REINVESTMENT',
      desiredCapitalIncreaseCop: 6000000, // Desea reinvertir la nueva ganancia
      currentCapitalSnapshotCop: 10000000,
      appliedClosureVersion: 1,
      profitAppliedAtCycleClosure: true,
    });

    // 2. Ejecutar REOPEN A
    simulateReopenCycle({ db, cycleAId });
    expect(db.getDoc('monthlyCycles', cycleAId).status).toBe('REOPENED');
    expect(db.getDoc('monthlyCycles', cycleBId).preparationNeedsReview).toBe(true);

    // 3. Modificar ganancias autoritativas en cycleUserResults a 6M
    db.updateDoc('cycleUserResults', `${cycleAId}_${uid}`, {
      userProfitCop: 6000000,
    });

    // 4. Ejecutar segundo CLOSE A (v2)
    const resV2 = simulateCloseCycle({
      db,
      cycleAId,
      clientRequestId: 'req_close_v2',
    });

    expect(resV2.success).toBe(true);
    expect(resV2.closureVersion).toBe(2);

    // Verificación fundamental: Capital absoluto asignado = 16M (NO 21M acumulativo, NO 15M obsoleto)
    const user = db.getDoc('users', uid);
    expect(user.currentCapital).toBe(16000000);

    const cycleA = db.getDoc('monthlyCycles', cycleAId);
    expect(cycleA.status).toBe('CLOSED');
    expect(cycleA.closureVersion).toBe(2);

    const cycleB = db.getDoc('monthlyCycles', cycleBId);
    expect(cycleB.sourceClosureVersion).toBe(2);
    expect(cycleB.preparationNeedsReview).toBe(false);

    const reinv = db.getDoc('reinvestments', 'reinv_1');
    expect(reinv.appliedClosureVersion).toBe(2);
    expect(reinv.securedNextCapitalCop).toBe(16000000);
  });

  it('TEST 3: START_BLOCKS_STALE_VERSION (START B falla si sourceClosureVersion !== closureVersion de A)', () => {
    const db = new InMemoryDb();
    const cycleAId = 'cyc_A';
    const cycleBId = 'cyc_B';

    db.setDoc('monthlyCycles', cycleAId, {
      status: 'CLOSED',
      closureVersion: 2,
      nextCycleId: cycleBId,
    });
    db.setDoc('monthlyCycles', cycleBId, {
      status: 'OPEN',
      operationalStatus: 'PREPARING',
      previousCycleId: cycleAId,
      sourceClosureVersion: 1, // Desactualizado (stale)
      preparationNeedsReview: false,
    });

    expect(() =>
      simulateStartCycle({
        db,
        cycleBId,
        clientRequestId: 'req_start_1',
      })
    ).toThrow('STALE_CLOSURE_VERSION');
  });

  it('TEST 4: START_BLOCKS_PENDING_OR_RECONCILIATION (Bloqueo si hay PENDING o NEEDS_REVIEW)', () => {
    const db = new InMemoryDb();
    const cycleAId = 'cyc_A';
    const cycleBId = 'cyc_B';

    db.setDoc('monthlyCycles', cycleAId, {
      status: 'CLOSED',
      closureVersion: 1,
      nextCycleId: cycleBId,
    });
    db.setDoc('monthlyCycles', cycleBId, {
      status: 'OPEN',
      operationalStatus: 'PREPARING',
      previousCycleId: cycleAId,
      sourceClosureVersion: 1,
      preparationNeedsReview: false,
    });
    db.setDoc('reinvestments', 'reinv_pending', {
      sourceCycleId: cycleAId,
      targetCycleId: cycleBId,
      status: 'PENDING', // Solicitud no resuelta
    });

    expect(() =>
      simulateStartCycle({
        db,
        cycleBId,
        clientRequestId: 'req_start_1',
      })
    ).toThrow('PENDING_REQUESTS_BLOCK_START');
  });

  it('TEST 5: CONFIRM_AFTER_CLOSE_BEFORE_START (Aporte externo se confirma en PREPARING tras CLOSE A)', () => {
    const db = new InMemoryDb();
    const cycleAId = 'cyc_A';
    const cycleBId = 'cyc_B';

    db.setDoc('monthlyCycles', cycleAId, {
      status: 'CLOSED',
      nextCycleId: cycleBId,
    });
    db.setDoc('monthlyCycles', cycleBId, {
      status: 'OPEN',
      operationalStatus: 'PREPARING',
      previousCycleId: cycleAId,
    });
    db.setDoc('reinvestments', 'reinv_cash', {
      sourceCycleId: cycleAId,
      targetCycleId: cycleBId,
      status: 'APPROVED',
      cashInjectionCop: 2000000,
      externalFundingStatus: 'PENDING',
    });

    simulateConfirmExternalContribution({
      db,
      reinvId: 'reinv_cash',
      confirmedAmountCop: 2000000,
    });

    const reinv = db.getDoc('reinvestments', 'reinv_cash');
    expect(reinv.externalFundingStatus).toBe('CONFIRMED');
    expect(reinv.fundingReconciliationStatus).toBe('OK');
  });

  it('TEST 6: START_APPLIES_CONFIRMED_CASH (START B suma cash confirmado a usuarios y congela cycleUserResults)', () => {
    const db = new InMemoryDb();
    const cycleAId = 'cyc_A';
    const cycleBId = 'cyc_B';
    const uid = 'usr_1';

    db.setDoc('monthlyCycles', cycleAId, {
      status: 'CLOSED',
      closureVersion: 1,
      nextCycleId: cycleBId,
    });
    db.setDoc('monthlyCycles', cycleBId, {
      status: 'OPEN',
      operationalStatus: 'PREPARING',
      previousCycleId: cycleAId,
      sourceClosureVersion: 1,
      preparationNeedsReview: false,
    });
    db.setDoc('users', uid, {
      status: 'ACTIVE',
      userCode: 'INV-001',
      currentCapital: 15000000, // Base asegurada en CLOSE
      category: 'PLATA',
    });
    db.setDoc('cycleUserResults', `${cycleAId}_${uid}`, {
      cycleId: cycleAId,
      userUid: uid,
      cycleCapitalCop: 10000000,
      userProfitCop: 5000000,
    });
    db.setDoc('reinvestments', 'reinv_1', {
      sourceCycleId: cycleAId,
      targetCycleId: cycleBId,
      userUid: uid,
      status: 'APPROVED',
      securedNextCapitalCop: 15000000,
      cashInjectionCop: 2000000,
      externalFundingStatus: 'CONFIRMED',
      fundingReconciliationStatus: 'OK',
    });

    const startRes = simulateStartCycle({
      db,
      cycleBId,
      clientRequestId: 'req_start_1',
    });

    expect(startRes.success).toBe(true);

    // El capital final en users incluye el cash confirmado: 15M + 2M = 17M
    const user = db.getDoc('users', uid);
    expect(user.currentCapital).toBe(17000000);

    // En cycleUserResults del ciclo B, el capital congelado es 17M
    const curB = db.getDoc('cycleUserResults', `${cycleBId}_${uid}`);
    expect(curB.cycleCapitalCop).toBe(17000000);
    expect(curB.isFrozen).toBe(true);

    // La solicitud pasa a APPLIED
    const reinv = db.getDoc('reinvestments', 'reinv_1');
    expect(reinv.status).toBe('APPLIED');
    expect(reinv.finalCapitalCop).toBe(17000000);
  });

  it('TEST 7: WRITE_LIMIT_ENFORCED (Formula requiredWrites > 450 aborta atómicamente)', () => {
    const db = new InMemoryDb();
    const cycleAId = 'cyc_A';
    const cycleBId = 'cyc_B';

    db.setDoc('monthlyCycles', cycleAId, {
      status: 'OPEN',
      nextCycleId: cycleBId,
      closureVersion: 0,
    });
    db.setDoc('monthlyCycles', cycleBId, {
      status: 'OPEN',
      operationalStatus: 'PREPARING',
      previousCycleId: cycleAId,
    });

    // Crear 224 solicitudes aprobadas: 4 + (224 * 2) = 452 > 450
    for (let i = 1; i <= 224; i++) {
      const uid = `usr_${i}`;
      db.setDoc('users', uid, { status: 'ACTIVE', currentCapital: 1000000 });
      db.setDoc('cycleUserResults', `${cycleAId}_${uid}`, { cycleCapitalCop: 1000000, userProfitCop: 100000 });
      db.setDoc('reinvestments', `reinv_${i}`, {
        sourceCycleId: cycleAId,
        targetCycleId: cycleBId,
        userUid: uid,
        status: 'APPROVED',
        desiredCapitalIncreaseCop: 100000,
        currentCapitalSnapshotCop: 1000000,
      });
    }

    expect(() =>
      simulateCloseCycle({
        db,
        cycleAId,
        clientRequestId: 'req_overflow',
      })
    ).toThrow('CLOSE_TOO_LARGE_FOR_ATOMIC_COMMIT');
  });

  it('TEST 8: IDEMPOTENCY_CLOSE_AND_START (Reintentos con mismo clientRequestId retornan resultado sin re-ejecutar)', () => {
    const db = new InMemoryDb();
    const cycleAId = 'cyc_A';
    const cycleBId = 'cyc_B';
    const uid = 'usr_1';

    db.setDoc('monthlyCycles', cycleAId, {
      status: 'OPEN',
      nextCycleId: cycleBId,
      closureVersion: 0,
    });
    db.setDoc('monthlyCycles', cycleBId, {
      status: 'OPEN',
      operationalStatus: 'PREPARING',
      previousCycleId: cycleAId,
    });
    db.setDoc('users', uid, { status: 'ACTIVE', currentCapital: 10000000 });
    db.setDoc('cycleUserResults', `${cycleAId}_${uid}`, { cycleCapitalCop: 10000000, userProfitCop: 2000000 });
    db.setDoc('reinvestments', 'reinv_1', {
      sourceCycleId: cycleAId,
      targetCycleId: cycleBId,
      userUid: uid,
      status: 'APPROVED',
      currentCapitalSnapshotCop: 10000000,
      desiredCapitalIncreaseCop: 2000000,
    });

    // Primer close
    const firstClose = simulateCloseCycle({
      db,
      cycleAId,
      clientRequestId: 'uuid_idem_123',
    });
    expect(firstClose.success).toBe(true);

    // Replay idempotente con el mismo requestId
    const retryClose = simulateCloseCycle({
      db,
      cycleAId,
      clientRequestId: 'uuid_idem_123',
    });
    expect(retryClose.idempotentRetry).toBe(true);
    expect(retryClose.alreadyClosed).toBe(true);

    // Request diferente sobre ciclo cerrado debe lanzar error
    expect(() =>
      simulateCloseCycle({
        db,
        cycleAId,
        clientRequestId: 'uuid_different_456',
      })
    ).toThrow('CYCLE_ALREADY_CLOSED');
  });
});
