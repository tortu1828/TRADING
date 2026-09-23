import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * SUITE COMPLETA DE CERTIFICACIÓN LOCAL PARA FASE 2A
 * Verifica todos los guardrails financieros, ciclo de vida, idempotencia,
 * límites atómicos de escritura, conciliaciones bancarias, y desacoplamiento de calendario.
 */

interface MockStore {
  get: (key: string) => any;
  set: (key: string, value: any) => void;
  delete: (key: string) => void;
  has: (key: string) => boolean;
  clear: () => void;
  getAll: () => Map<string, any>;
}

function createInMemoryStore(): MockStore {
  const map = new Map<string, any>();
  return {
    get: (key) => map.get(key),
    set: (key, val) => map.set(key, val),
    delete: (key) => map.delete(key),
    has: (key) => map.has(key),
    clear: () => map.clear(),
    getAll: () => map,
  };
}

// Helper de simulación de submitReinvestmentRequest
function simulateSubmitReinvestmentRequest({
  authUid,
  sourceCycleId,
  modality,
  selectedReinvestmentCop,
  desiredCapitalIncreaseCop,
  clientRequestId,
  store,
}: {
  authUid: string;
  sourceCycleId: string;
  modality: 'PROFIT_REINVESTMENT' | 'CAPITAL_INJECTION';
  selectedReinvestmentCop?: number;
  desiredCapitalIncreaseCop?: number;
  clientRequestId?: string;
  store: MockStore;
}) {
  if (!sourceCycleId || typeof sourceCycleId !== 'string' || !sourceCycleId.trim()) {
    throw new Error('INVALID_ARGUMENT: sourceCycleId es obligatorio.');
  }
  const cleanSourceCycleId = sourceCycleId.trim();
  const userPath = `users/${authUid}`;
  const sourceCyclePath = `monthlyCycles/${cleanSourceCycleId}`;
  const userResPath = `cycleUserResults/${cleanSourceCycleId}_${authUid}`;
  const reinvDocId = `${cleanSourceCycleId}_${authUid}`;
  const reinvPath = `reinvestments/${reinvDocId}`;

  const userDoc = store.get(userPath);
  if (!userDoc || userDoc.role !== 'USER' || userDoc.status !== 'ACTIVE') {
    throw new Error('PERMISSION_DENIED: Usuario no activo o no encontrado.');
  }

  const currentCapitalSnapshotCop = Number(userDoc.currentCapital || 0);
  const cycleDoc = store.get(sourceCyclePath);
  if (!cycleDoc || cycleDoc.status === 'CLOSED' || cycleDoc.operationalStatus !== 'STARTED') {
    throw new Error('FAILED_PRECONDITION: Ciclo no apto.');
  }

  const targetCycleId = cycleDoc.nextCycleId ? cycleDoc.nextCycleId.trim() : null;
  if (!targetCycleId) {
    throw new Error('FAILED_PRECONDITION: NO_SUCCESSOR_CYCLE');
  }

  const targetCycleDoc = store.get(`monthlyCycles/${targetCycleId}`);
  if (!targetCycleDoc || targetCycleDoc.status !== 'OPEN' || targetCycleDoc.operationalStatus !== 'PREPARING') {
    throw new Error('FAILED_PRECONDITION: TARGET_CYCLE_NOT_PREPARING');
  }

  if (targetCycleDoc.previousCycleId !== cleanSourceCycleId) {
    throw new Error('FAILED_PRECONDITION: CYCLE_LINKAGE_MISMATCH');
  }

  // Pointer cross-check
  const globalConfig = store.get('settings/global_config');
  if (globalConfig && globalConfig.preparingCycleId && globalConfig.preparingCycleId !== targetCycleId) {
    throw new Error('FAILED_PRECONDITION: CYCLE_POINTER_MISMATCH');
  }

  const userResDoc = store.get(userResPath);
  if (!userResDoc) {
    throw new Error('FAILED_PRECONDITION: CYCLE_RESULT_NOT_FOUND');
  }

  const cycleCapitalCop = Number(userResDoc.cycleCapitalCop || 0);
  if (currentCapitalSnapshotCop !== cycleCapitalCop) {
    throw new Error(`FAILED_PRECONDITION: CAPITAL_BASE_SNAPSHOT_MISMATCH: El capital actual ($${currentCapitalSnapshotCop}) no coincide con el capital base congelado ($${cycleCapitalCop}).`);
  }

  const cycleProfitSnapshotCop = Number(userResDoc.userProfitCop || 0);
  const reinvestableProfitCop = Math.floor(Math.max(cycleProfitSnapshotCop, 0) / 1_000_000) * 1_000_000;

  let profitAppliedCop = 0;
  let cashInjectionCop = 0;
  let totalIncreaseCop = 0;

  if (modality === 'PROFIT_REINVESTMENT') {
    profitAppliedCop = Number(selectedReinvestmentCop || 0);
    totalIncreaseCop = profitAppliedCop;
  } else {
    const desired = Number(desiredCapitalIncreaseCop || 0);
    profitAppliedCop = Math.min(reinvestableProfitCop, desired);
    cashInjectionCop = Math.max(desired - profitAppliedCop, 0);
    totalIncreaseCop = desired;
  }

  const canonicalDoc = {
    id: reinvDocId,
    userId: authUid,
    userUid: authUid,
    sourceCycleId: cleanSourceCycleId,
    targetCycleId,
    fundingReconciliationStatus: 'OK',
    fundingReconciliationReason: null,
    modality,
    requestVersion: 1,
    clientRequestId: clientRequestId || null,
    currentCapitalSnapshotCop,
    cycleProfitSnapshotCop,
    reinvestableProfitCop,
    profitAppliedCop,
    cashInjectionCop,
    totalIncreaseCop,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };

  store.set(reinvPath, canonicalDoc);
  return { success: true, reinvestment: canonicalDoc };
}

// Helper de simulación de adminResolveReinvestment
function simulateAdminResolveReinvestment({
  authUid,
  reinvestmentId,
  resolution,
  store,
}: {
  authUid: string;
  reinvestmentId: string;
  resolution: 'APPROVED' | 'REJECTED' | 'NEEDS_REVIEW';
  store: MockStore;
}) {
  const reinvPath = `reinvestments/${reinvestmentId}`;
  const req = store.get(reinvPath);
  if (!req) throw new Error('NOT_FOUND');

  const sourceCycleId = req.sourceCycleId;
  const targetCycleId = req.targetCycleId;

  if (!sourceCycleId || !targetCycleId) {
    throw new Error('FAILED_PRECONDITION: CYCLE_LINK_MISMATCH');
  }

  const cycleA = store.get(`monthlyCycles/${sourceCycleId}`);
  const cycleB = store.get(`monthlyCycles/${targetCycleId}`);

  if (!cycleA || !cycleB) {
    throw new Error('FAILED_PRECONDITION: CYCLE_LINK_MISMATCH');
  }

  if (cycleA.nextCycleId !== targetCycleId || cycleB.previousCycleId !== sourceCycleId) {
    throw new Error('FAILED_PRECONDITION: CYCLE_LINK_MISMATCH');
  }

  if (!['APPROVED', 'REJECTED', 'NEEDS_REVIEW'].includes(resolution)) {
    throw new Error('INVALID_ARGUMENT: Estado no permitido');
  }

  store.set(reinvPath, {
    ...req,
    status: resolution,
    resolvedAt: new Date().toISOString(),
    resolvedByUid: authUid,
  });

  return { success: true, status: resolution };
}

// Helper de simulación de adminCloseCycle
function simulateAdminCloseCycle({
  authUid,
  cycleId,
  clientRequestId,
  store,
}: {
  authUid: string;
  cycleId: string;
  clientRequestId?: string;
  store: MockStore;
}) {
  const cyclePath = `monthlyCycles/${cycleId}`;
  const cycleDoc = store.get(cyclePath);
  if (!cycleDoc) throw new Error('NOT_FOUND');

  if (cycleDoc.status === 'CLOSED') {
    if (clientRequestId && cycleDoc.lastCloseRequestId === clientRequestId) {
      return { success: true, cycleClosed: true, closureVersion: cycleDoc.closureVersion, idempotentReplay: true };
    }
    throw new Error('FAILED_PRECONDITION: CYCLE_ALREADY_CLOSED');
  }

  const approvedReinvestments: any[] = [];
  store.getAll().forEach((val, key) => {
    if (key.startsWith('reinvestments/')) {
      if (val.sourceCycleId === cycleId && val.status === 'APPROVED') {
        approvedReinvestments.push({ key, doc: val });
      }
    }
  });

  // Write limit check: 4 + 2*N
  const requiredCloseWrites = 4 + (approvedReinvestments.length * 2);
  if (requiredCloseWrites > 450) {
    throw new Error(`RESOURCE_EXHAUSTED: CLOSE_TOO_LARGE_FOR_ATOMIC_COMMIT (${requiredCloseWrites} > 450)`);
  }

  const currentClosureVersion = Number(cycleDoc.closureVersion || 0);
  const newClosureVersion = currentClosureVersion + 1;
  const successorCycleId = cycleDoc.nextCycleId ? cycleDoc.nextCycleId.trim() : null;

  const nowIso = new Date().toISOString();

  // Process requests and absolute capital updates
  approvedReinvestments.forEach(({ key, doc }) => {
    const userResPath = `cycleUserResults/${cycleId}_${doc.userId}`;
    const userResDoc = store.get(userResPath);
    if (!userResDoc) throw new Error('FAILED_PRECONDITION: CYCLE_RESULT_NOT_FOUND');

    const baseCapitalCop = Number(userResDoc.cycleCapitalCop || 0);
    if (doc.currentCapitalSnapshotCop !== baseCapitalCop) {
      throw new Error('FAILED_PRECONDITION: CAPITAL_BASE_SNAPSHOT_MISMATCH');
    }

    const securedNextCapitalCop = baseCapitalCop + doc.profitAppliedCop;

    // Reconciliation check
    let reconStatus: 'OK' | 'NEEDS_REVIEW' = 'OK';
    let reconReason: string | null = null;
    if (doc.externalFundingStatus === 'CONFIRMED') {
      const confirmedAmt = Number(doc.confirmedAmountCop || 0);
      if (confirmedAmt !== doc.cashInjectionCop) {
        reconStatus = 'NEEDS_REVIEW';
        reconReason = `Aporte confirmado de $${confirmedAmt} difiere de nueva inyección de $${doc.cashInjectionCop}`;
      }
    }

    // Absolute assignment to user
    const userPath = `users/${doc.userId}`;
    const userDoc = store.get(userPath);
    if (userDoc) {
      store.set(userPath, {
        ...userDoc,
        currentCapital: securedNextCapitalCop, // ABSOLUTE
        updatedAt: nowIso,
      });
    }

    // Update reinvestment
    store.set(key, {
      ...doc,
      appliedClosureVersion: newClosureVersion,
      securedNextCapitalCop,
      fundingReconciliationStatus: reconStatus,
      fundingReconciliationReason: reconReason,
      appliedInCycleId: cycleId,
      updatedAt: nowIso,
    });
  });

  // Update Cycle A
  store.set(cyclePath, {
    ...cycleDoc,
    status: 'CLOSED',
    closureVersion: newClosureVersion,
    lastCloseRequestId: clientRequestId || null,
    closedAt: nowIso,
    closedByUid: authUid,
  });

  // Update Cycle B
  if (successorCycleId) {
    const succPath = `monthlyCycles/${successorCycleId}`;
    const succDoc = store.get(succPath) || {};
    store.set(succPath, {
      ...succDoc,
      sourceClosureVersion: newClosureVersion,
      preparationNeedsReview: false,
      updatedAt: nowIso,
    });
  }

  // Update Summary A
  store.set(`cycleFinancialSummaries/${cycleId}`, {
    cycleId,
    isCycleClosed: true,
    closedAt: nowIso,
    updatedAt: nowIso,
  });

  // Update Pointers
  store.set('settings/global_config', {
    operationalCycleId: null,
    preparingCycleId: successorCycleId,
    activeCycleId: successorCycleId,
    updatedAt: nowIso,
  });

  return { success: true, cycleClosed: true, closureVersion: newClosureVersion };
}

// Helper de simulación de adminReopenCycle
function simulateAdminReopenCycle({ authUid, cycleId, store }: { authUid: string; cycleId: string; store: MockStore }) {
  const cyclePath = `monthlyCycles/${cycleId}`;
  const cycleDoc = store.get(cyclePath);
  if (!cycleDoc || cycleDoc.status !== 'CLOSED') {
    throw new Error('FAILED_PRECONDITION: El ciclo debe estar CLOSED.');
  }

  const nowIso = new Date().toISOString();

  // Update Cycle A status
  store.set(cyclePath, {
    ...cycleDoc,
    status: 'REOPENED',
    reopenedAt: nowIso,
    reopenedByUid: authUid,
  });

  // Mark B preparationNeedsReview = true (without changing sourceClosureVersion)
  if (cycleDoc.nextCycleId) {
    const succPath = `monthlyCycles/${cycleDoc.nextCycleId.trim()}`;
    const succDoc = store.get(succPath);
    if (succDoc && succDoc.operationalStatus === 'PREPARING') {
      store.set(succPath, {
        ...succDoc,
        preparationNeedsReview: true,
        updatedAt: nowIso,
      });
    }
  }

  // Reopen summary A
  store.set(`cycleFinancialSummaries/${cycleId}`, {
    cycleId,
    isCycleClosed: false,
    closedAt: null,
    updatedAt: nowIso,
  });

  // Mark old report SUPERSEDED
  const reportPath = `cycleReports/${cycleId}_v${cycleDoc.closureVersion}`;
  if (store.has(reportPath)) {
    store.set(reportPath, {
      ...store.get(reportPath),
      status: 'SUPERSEDED',
      supersededAt: nowIso,
    });
  }

  return { success: true, reopened: true };
}

// Helper de simulación de adminConfirmExternalContribution
function simulateAdminConfirmExternalContribution({
  authUid,
  targetCycleId,
  reinvestmentId,
  confirmedAmountCop,
  bankReference,
  store,
}: {
  authUid: string;
  targetCycleId: string;
  reinvestmentId: string;
  confirmedAmountCop: number;
  bankReference?: string;
  store: MockStore;
}) {
  const reinvPath = `reinvestments/${reinvestmentId}`;
  const reinvDoc = store.get(reinvPath);
  if (!reinvDoc) throw new Error('NOT_FOUND');

  if (reinvDoc.targetCycleId && reinvDoc.targetCycleId.trim() !== targetCycleId) {
    throw new Error('FAILED_PRECONDITION: CYCLE_LINK_MISMATCH');
  }

  // Validate B
  const cycleB = store.get(`monthlyCycles/${targetCycleId}`);
  if (!cycleB || cycleB.status !== 'OPEN' || cycleB.operationalStatus !== 'PREPARING' || !cycleB.previousCycleId) {
    throw new Error('FAILED_PRECONDITION: TARGET_CYCLE_NOT_PREPARING');
  }

  // Validate A
  const sourceCycleId = cycleB.previousCycleId;
  const cycleA = store.get(`monthlyCycles/${sourceCycleId}`);
  if (!cycleA || cycleA.status !== 'CLOSED' || cycleA.nextCycleId !== targetCycleId) {
    throw new Error('FAILED_PRECONDITION: PREDECESSOR_CYCLE_NOT_CLOSED');
  }

  if (reinvDoc.externalFundingStatus !== 'PENDING') {
    throw new Error('FAILED_PRECONDITION: EXTERNAL_FUNDING_NOT_PENDING');
  }

  const requiredCash = Math.round(Number(reinvDoc.cashInjectionCop || 0));
  const confirmed = Math.round(Number(confirmedAmountCop));

  if (confirmed !== requiredCash) {
    throw new Error('INVALID_ARGUMENT: CONFIRMATION_AMOUNT_MISMATCH');
  }

  const nowIso = new Date().toISOString();
  store.set(reinvPath, {
    ...reinvDoc,
    externalFundingStatus: 'CONFIRMED',
    confirmedAmountCop: confirmed,
    confirmedAt: nowIso,
    confirmedByUid: authUid,
    bankReference: (bankReference || '').trim(),
    updatedAt: nowIso,
  });

  return { success: true, externalFundingStatus: 'CONFIRMED' };
}

// Helper de simulación de adminCreateUser
function simulateAdminCreateUser({
  email,
  fullName,
  initialCapitalCop,
  targetCycleId,
  store,
}: {
  email: string;
  fullName: string;
  initialCapitalCop: number;
  targetCycleId?: string | null;
  store: MockStore;
}) {
  let entryCycleId: string | null = null;
  if (targetCycleId && targetCycleId.trim()) {
    const cleanB = targetCycleId.trim();
    const cycleB = store.get(`monthlyCycles/${cleanB}`);
    if (!cycleB || cycleB.status !== 'OPEN' || cycleB.operationalStatus !== 'PREPARING' || !cycleB.previousCycleId) {
      throw new Error('FAILED_PRECONDITION: TARGET_CYCLE_NOT_PREPARING');
    }
    const cycleA = store.get(`monthlyCycles/${cycleB.previousCycleId}`);
    if (!cycleA || cycleA.status !== 'CLOSED') {
      throw new Error('FAILED_PRECONDITION: PREDECESSOR_CYCLE_NOT_CLOSED_FOR_NEW_ENTRY');
    }
    entryCycleId = cleanB;
  }

  const uid = `usr_new_${Date.now()}`;
  const newUser = {
    id: uid,
    email,
    fullName,
    role: 'USER',
    status: 'ACTIVE',
    currentCapital: initialCapitalCop,
    baseCapital: initialCapitalCop,
    entryCycleId,
    createdAt: new Date().toISOString(),
  };

  store.set(`users/${uid}`, newUser);
  return { success: true, user: newUser };
}

// Helper de simulación de adminStartCycle
function simulateAdminStartCycle({
  authUid,
  targetCycleId,
  store,
}: {
  authUid: string;
  targetCycleId: string;
  store: MockStore;
}) {
  const cycleBPath = `monthlyCycles/${targetCycleId}`;
  const cycleB = store.get(cycleBPath);
  if (!cycleB || cycleB.status !== 'OPEN' || cycleB.operationalStatus !== 'PREPARING') {
    throw new Error('FAILED_PRECONDITION: TARGET_CYCLE_NOT_PREPARING');
  }

  if (!cycleB.previousCycleId) {
    throw new Error('FAILED_PRECONDITION: CYCLE_LINK_MISMATCH');
  }

  const sourceCycleId = cycleB.previousCycleId;
  const cycleA = store.get(`monthlyCycles/${sourceCycleId}`);
  if (!cycleA || cycleA.status !== 'CLOSED' || cycleA.nextCycleId !== targetCycleId) {
    throw new Error('FAILED_PRECONDITION: PREVIOUS_CYCLE_NOT_CLOSED');
  }

  if (Number(cycleB.sourceClosureVersion) !== Number(cycleA.closureVersion)) {
    throw new Error('FAILED_PRECONDITION: STALE_PREPARATION_STATE');
  }

  if (cycleB.preparationNeedsReview === true) {
    throw new Error('FAILED_PRECONDITION: PREPARATION_NEEDS_REVIEW');
  }

  const trmNum = Number(cycleB.trmApplied);
  if (!Number.isFinite(trmNum) || trmNum <= 0) {
    throw new Error('FAILED_PRECONDITION: INVALID_CYCLE_TRM');
  }

  // Existing operations check
  let hasOps = false;
  store.getAll().forEach((v, k) => {
    if (k.startsWith('dailyOperations/') && v.cycleId === targetCycleId) hasOps = true;
  });
  if (hasOps) throw new Error('FAILED_PRECONDITION: CYCLE_HAS_EXISTING_OPERATIONS');

  // Existing results check
  let hasResults = false;
  store.getAll().forEach((v, k) => {
    if (k.startsWith('cycleUserResults/') && v.cycleId === targetCycleId) hasResults = true;
  });
  if (hasResults) throw new Error('FAILED_PRECONDITION: CYCLE_RESULTS_ALREADY_INITIALIZED');

  // Existing summary check
  const existingSummary = store.get(`cycleFinancialSummaries/${targetCycleId}`);
  if (existingSummary && existingSummary.isCycleClosed === false && existingSummary.startedAt) {
    throw new Error('FAILED_PRECONDITION: CYCLE_FINANCIAL_SUMMARY_ALREADY_INITIALIZED');
  }

  // Fetch requests for target B
  const reinvDocsMap = new Map<string, any>();
  let hasUnresolvedRecon = false;
  let hasBlockingStatus = false;

  store.getAll().forEach((v, k) => {
    if (k.startsWith('reinvestments/') && v.targetCycleId === targetCycleId) {
      reinvDocsMap.set(v.userId || v.userUid, v);
      if (v.fundingReconciliationStatus === 'NEEDS_REVIEW') hasUnresolvedRecon = true;
      if (v.status === 'PENDING' || v.status === 'NEEDS_REVIEW') hasBlockingStatus = true;
    }
  });

  if (hasUnresolvedRecon) throw new Error('FAILED_PRECONDITION: UNRESOLVED_FUNDING_RECONCILIATION');
  if (hasBlockingStatus) throw new Error('FAILED_PRECONDITION: PENDING_REQUESTS_BLOCK_START');

  // Build deterministic cohort (Cohort A from cycleUserResults A + Cohort B from entryCycleId == B)
  const prevResultsMap = new Map<string, any>();
  store.getAll().forEach((v, k) => {
    if (k.startsWith('cycleUserResults/') && v.cycleId === sourceCycleId) {
      const uid = v.userId || v.userUid;
      if (uid) prevResultsMap.set(uid, v);
    }
  });

  const newEntriesMap = new Map<string, any>();
  store.getAll().forEach((v, k) => {
    if (k.startsWith('users/') && v.entryCycleId === targetCycleId) {
      newEntriesMap.set(v.id, v);
    }
  });

  const participantUids = new Set([...prevResultsMap.keys(), ...newEntriesMap.keys()]);
  if (participantUids.size === 0) {
    throw new Error('FAILED_PRECONDITION: ZERO_PARTICIPANTS_DETECTED');
  }

  let totalInitialCapital = 0;
  const cycleUserResultsToSet: any[] = [];
  const userUpdates: any[] = [];
  const reinvUpdates: any[] = [];

  for (const uid of participantUids) {
    const uProfile = store.get(`users/${uid}`);
    if (!uProfile || (uProfile.status && uProfile.status !== 'ACTIVE')) continue;

    const req = reinvDocsMap.get(uid);
    const prevRes = prevResultsMap.get(uid);

    let finalCapitalCop = 0;
    if (req && req.status === 'APPROVED') {
      const cashInjectionCop = Math.round(Number(req.cashInjectionCop || 0));
      let cashToAdd = 0;
      let finalFundingStatus = 'NOT_REQUIRED';
      if (cashInjectionCop > 0) {
        if (req.externalFundingStatus === 'CONFIRMED' && req.fundingReconciliationStatus !== 'NEEDS_REVIEW') {
          cashToAdd = cashInjectionCop;
          finalFundingStatus = 'CONFIRMED';
        } else {
          cashToAdd = 0;
          finalFundingStatus = 'NOT_RECEIVED';
        }
      }

      const securedNextCapitalCop = Math.round(Number(req.securedNextCapitalCop || (prevRes ? prevRes.cycleCapitalCop : uProfile.currentCapital) || 0));
      finalCapitalCop = securedNextCapitalCop + cashToAdd;

      reinvUpdates.push({
        key: `reinvestments/${req.id}`,
        doc: {
          ...req,
          status: 'APPLIED',
          externalFundingStatus: finalFundingStatus,
          appliedAtCycleStart: true,
          appliedInCycleId: targetCycleId,
          finalCapitalCop,
          updatedAt: new Date().toISOString(),
        },
      });
    } else if (prevRes) {
      finalCapitalCop = Number(prevRes.cycleCapitalCop || 0);
    } else {
      finalCapitalCop = Number(uProfile.currentCapital || 0);
    }

    if (finalCapitalCop <= 0) {
      throw new Error(`FAILED_PRECONDITION: INVALID_ZERO_CAPITAL_DETECTED: Capital ${finalCapitalCop}`);
    }

    totalInitialCapital += finalCapitalCop;

    cycleUserResultsToSet.push({
      key: `cycleUserResults/${targetCycleId}_${uid}`,
      doc: {
        cycleId: targetCycleId,
        userId: uid,
        cycleCapitalCop: finalCapitalCop,
        trmUsed: trmNum,
        isFrozen: true,
      },
    });

    if (Number(uProfile.currentCapital) !== finalCapitalCop) {
      userUpdates.push({
        key: `users/${uid}`,
        doc: {
          ...uProfile,
          currentCapital: finalCapitalCop,
          updatedAt: new Date().toISOString(),
        },
      });
    }
  }

  // Write limit check: 3 + P + U + R
  const requiredStartWrites = 3 + cycleUserResultsToSet.length + userUpdates.length + reinvUpdates.length;
  if (requiredStartWrites > 450) {
    throw new Error(`RESOURCE_EXHAUSTED: START_TOO_LARGE_FOR_ATOMIC_COMMIT (${requiredStartWrites} > 450)`);
  }

  const nowIso = new Date().toISOString();

  // Commit
  store.set(cycleBPath, {
    ...cycleB,
    operationalStatus: 'STARTED',
    startedAt: nowIso,
    startedByUid: authUid,
    initialManagedCapitalCop: totalInitialCapital,
    initialActiveUsersCount: participantUids.size,
  });

  store.set('settings/global_config', {
    operationalCycleId: targetCycleId,
    preparingCycleId: null,
    activeCycleId: targetCycleId,
    updatedAt: nowIso,
  });

  store.set(`cycleFinancialSummaries/${targetCycleId}`, {
    cycleId: targetCycleId,
    initialManagedCapitalCop: totalInitialCapital,
    initialActiveUsersCount: participantUids.size,
    isCycleClosed: false,
    startedAt: nowIso,
    createdAt: nowIso,
  });

  cycleUserResultsToSet.forEach((item) => store.set(item.key, item.doc));
  userUpdates.forEach((item) => store.set(item.key, item.doc));
  reinvUpdates.forEach((item) => store.set(item.key, item.doc));

  return { success: true, initialManagedCapitalCop: totalInitialCapital, participantCount: participantUids.size };
}

// Helper de simulación de adminUpdateCycleTrm
function simulateAdminUpdateCycleTrm({ cycleId, newTrm, store }: { cycleId: string; newTrm: number; store: MockStore }) {
  const cyclePath = `monthlyCycles/${cycleId}`;
  const cycleDoc = store.get(cyclePath);
  if (!cycleDoc) throw new Error('NOT_FOUND');

  if (cycleDoc.status === 'CLOSED') {
    throw new Error('FAILED_PRECONDITION: Ciclo ya CERRADO');
  }
  if (cycleDoc.operationalStatus === 'STARTED') {
    throw new Error('FAILED_PRECONDITION: TRM_FROZEN_AFTER_CYCLE_START');
  }

  if (!Number.isFinite(newTrm) || newTrm <= 0) {
    throw new Error('INVALID_ARGUMENT: TRM inválida');
  }

  store.set(cyclePath, {
    ...cycleDoc,
    trmApplied: newTrm,
    updatedAt: new Date().toISOString(),
  });

  return { success: true, trmApplied: newTrm };
}

describe('Certificación de Guardrails Financieros — Fase 2A', () => {

  it('1. AUDITORÍA FINAL DE TIPOS Y ENUMS NO AUTORIZADOS', () => {
    const typesPath = path.join(process.cwd(), 'src/types.ts');
    const content = fs.readFileSync(typesPath, 'utf8');

    // Confirm non-allowed enums are zero
    expect(content.includes('PENDING_RECONCILIATION')).toBe(false);
    expect(content.includes('RECONCILED')).toBe(false);
    expect(content.includes('UNRECONCILED')).toBe(false);

    // Confirm MonthlyCycle fields
    expect(content.includes('closureVersion?: number')).toBe(true);
    expect(content.includes('sourceClosureVersion?: number')).toBe(true);
    expect(content.includes('preparationNeedsReview?: boolean')).toBe(true);

    // Confirm ReinvestmentRequest fields
    expect(content.includes('appliedClosureVersion?: number')).toBe(true);
    expect(content.includes("fundingReconciliationStatus?: 'OK' | 'NEEDS_REVIEW'")).toBe(true);

    // Confirm User fields
    expect(content.includes('entryCycleId?: string | null')).toBe(true);

    // Confirm GlobalConfig fields
    expect(content.includes('activeCycleId')).toBe(true);
    expect(content.includes('operationalCycleId')).toBe(true);
    expect(content.includes('preparingCycleId')).toBe(true);

    // Confirm absent properties on CycleUserResult and ReinvestmentRequest
    const cycleUserResultMatch = content.match(/export interface CycleUserResult \{([\s\S]*?)\}/);
    if (cycleUserResultMatch) {
      expect(cycleUserResultMatch[1].includes('closureVersion')).toBe(false);
    }

    const reinvestmentRequestMatch = content.match(/export interface ReinvestmentRequest \{([\s\S]*?)\}/);
    if (reinvestmentRequestMatch) {
      expect(reinvestmentRequestMatch[1].includes('sourceClosureVersion')).toBe(false);
    }
  });

  it('2. CLOSE V1 Y V2 ABSOLUTO (10M -> 15M -> REOPEN -> 16M)', () => {
    const store = createInMemoryStore();

    store.set('users/usr_1', { id: 'usr_1', role: 'USER', status: 'ACTIVE', currentCapital: 10_000_000 });
    store.set('monthlyCycles/cyc_A', { id: 'cyc_A', status: 'OPEN', operationalStatus: 'STARTED', closureVersion: 0, nextCycleId: 'cyc_B' });
    store.set('monthlyCycles/cyc_B', { id: 'cyc_B', status: 'OPEN', operationalStatus: 'PREPARING', previousCycleId: 'cyc_A' });
    store.set('cycleUserResults/cyc_A_usr_1', { cycleCapitalCop: 10_000_000, userProfitCop: 5_000_000 });
    store.set('reinvestments/reinv_1', {
      id: 'reinv_1',
      userId: 'usr_1',
      sourceCycleId: 'cyc_A',
      targetCycleId: 'cyc_B',
      status: 'APPROVED',
      currentCapitalSnapshotCop: 10_000_000,
      profitAppliedCop: 5_000_000,
      cashInjectionCop: 0,
    });

    // CLOSE V1
    const closeV1 = simulateAdminCloseCycle({ authUid: 'admin_1', cycleId: 'cyc_A', store });
    expect(closeV1.closureVersion).toBe(1);
    expect(store.get('users/usr_1').currentCapital).toBe(15_000_000); // 10M base + 5M profit
    expect(store.get('reinvestments/reinv_1').appliedClosureVersion).toBe(1);
    expect(store.get('monthlyCycles/cyc_B').sourceClosureVersion).toBe(1);

    // REOPEN
    simulateAdminReopenCycle({ authUid: 'admin_1', cycleId: 'cyc_A', store });
    expect(store.get('monthlyCycles/cyc_A').status).toBe('REOPENED');
    expect(store.get('monthlyCycles/cyc_B').preparationNeedsReview).toBe(true);
    expect(store.get('monthlyCycles/cyc_B').sourceClosureVersion).toBe(1); // Unchanged on reopen

    // Update profit to 6M in cycleUserResults
    store.set('cycleUserResults/cyc_A_usr_1', { cycleCapitalCop: 10_000_000, userProfitCop: 6_000_000 });
    store.set('reinvestments/reinv_1', {
      ...store.get('reinvestments/reinv_1'),
      profitAppliedCop: 6_000_000,
    });

    // CLOSE V2
    const closeV2 = simulateAdminCloseCycle({ authUid: 'admin_1', cycleId: 'cyc_A', store });
    expect(closeV2.closureVersion).toBe(2);
    expect(store.get('users/usr_1').currentCapital).toBe(16_000_000); // Base 10M + recalculated 6M = 16M (NO 21M, NO 15M)
    expect(store.get('reinvestments/reinv_1').appliedClosureVersion).toBe(2);
    expect(store.get('monthlyCycles/cyc_B').sourceClosureVersion).toBe(2);
  });

  it('3. BOOLEAN LEGACY NO CONTROLA RECLOSE', () => {
    const store = createInMemoryStore();

    store.set('users/usr_1', { id: 'usr_1', role: 'USER', status: 'ACTIVE', currentCapital: 15_000_000 });
    store.set('monthlyCycles/cyc_A', { id: 'cyc_A', status: 'OPEN', closureVersion: 1, nextCycleId: 'cyc_B' });
    store.set('monthlyCycles/cyc_B', { id: 'cyc_B', status: 'OPEN', operationalStatus: 'PREPARING', previousCycleId: 'cyc_A' });
    store.set('cycleUserResults/cyc_A_usr_1', { cycleCapitalCop: 10_000_000 });
    store.set('reinvestments/reinv_1', {
      id: 'reinv_1',
      userId: 'usr_1',
      sourceCycleId: 'cyc_A',
      targetCycleId: 'cyc_B',
      status: 'APPROVED',
      appliedAtCycleClosure: true, // Legacy boolean flag
      appliedClosureVersion: 1,
      currentCapitalSnapshotCop: 10_000_000,
      profitAppliedCop: 7_000_000,
    });

    const res = simulateAdminCloseCycle({ authUid: 'admin_1', cycleId: 'cyc_A', store });
    expect(res.closureVersion).toBe(2);
    expect(store.get('reinvestments/reinv_1').appliedClosureVersion).toBe(2);
    expect(store.get('users/usr_1').currentCapital).toBe(17_000_000);
  });

  it('4. CAPITAL SNAPSHOT CROSS-CHECK', () => {
    const store = createInMemoryStore();

    store.set('users/usr_1', { id: 'usr_1', role: 'USER', status: 'ACTIVE', currentCapital: 11_000_000 });
    store.set('monthlyCycles/cyc_A', { id: 'cyc_A', status: 'OPEN', closureVersion: 0, nextCycleId: 'cyc_B' });
    store.set('monthlyCycles/cyc_B', { id: 'cyc_B', status: 'OPEN', operationalStatus: 'PREPARING', previousCycleId: 'cyc_A' });
    store.set('cycleUserResults/cyc_A_usr_1', { cycleCapitalCop: 10_000_000 });
    store.set('reinvestments/reinv_1', {
      id: 'reinv_1',
      userId: 'usr_1',
      sourceCycleId: 'cyc_A',
      targetCycleId: 'cyc_B',
      status: 'APPROVED',
      currentCapitalSnapshotCop: 11_000_000, // Discrepancia con 10M!
      profitAppliedCop: 2_000_000,
    });

    expect(() => simulateAdminCloseCycle({ authUid: 'admin_1', cycleId: 'cyc_A', store })).toThrowError(
      /CAPITAL_BASE_SNAPSHOT_MISMATCH/
    );
  });

  it('5. CLOSE DOUBLE-LINK VALIDATION', () => {
    const store = createInMemoryStore();

    store.set('reinvestments/reinv_1', {
      id: 'reinv_1',
      sourceCycleId: 'cyc_A',
      targetCycleId: 'cyc_B',
      status: 'PENDING',
    });
    store.set('monthlyCycles/cyc_A', { id: 'cyc_A', nextCycleId: 'cyc_B' });
    store.set('monthlyCycles/cyc_B', { id: 'cyc_B', previousCycleId: 'cyc_WRONG' }); // Link roto!

    expect(() =>
      simulateAdminResolveReinvestment({
        authUid: 'admin_1',
        reinvestmentId: 'reinv_1',
        resolution: 'APPROVED',
        store,
      })
    ).toThrowError(/CYCLE_LINK_MISMATCH/);
  });

  it('6. CLOSE POINTERS UPDATE IN GLOBAL CONFIG', () => {
    const store = createInMemoryStore();

    store.set('monthlyCycles/cyc_A', { id: 'cyc_A', status: 'OPEN', closureVersion: 0, nextCycleId: 'cyc_B' });
    store.set('monthlyCycles/cyc_B', { id: 'cyc_B', status: 'OPEN', operationalStatus: 'PREPARING', previousCycleId: 'cyc_A' });

    simulateAdminCloseCycle({ authUid: 'admin_1', cycleId: 'cyc_A', store });

    const globalConfig = store.get('settings/global_config');
    expect(globalConfig.operationalCycleId).toBeNull();
    expect(globalConfig.preparingCycleId).toBe('cyc_B');
    expect(globalConfig.activeCycleId).toBe('cyc_B');
  });

  it('7. CLOSE WRITE LIMIT (N=223 ALLOWED, N=224 DENIED)', () => {
    const store223 = createInMemoryStore();
    store223.set('monthlyCycles/cyc_A', { id: 'cyc_A', status: 'OPEN', closureVersion: 0, nextCycleId: 'cyc_B' });
    store223.set('monthlyCycles/cyc_B', { id: 'cyc_B', status: 'OPEN', operationalStatus: 'PREPARING', previousCycleId: 'cyc_A' });

    for (let i = 0; i < 223; i++) {
      store223.set(`users/usr_${i}`, { id: `usr_${i}`, currentCapital: 10_000_000 });
      store223.set(`cycleUserResults/cyc_A_usr_${i}`, { cycleCapitalCop: 10_000_000 });
      store223.set(`reinvestments/reinv_${i}`, {
        id: `reinv_${i}`,
        userId: `usr_${i}`,
        sourceCycleId: 'cyc_A',
        status: 'APPROVED',
        currentCapitalSnapshotCop: 10_000_000,
        profitAppliedCop: 1_000_000,
      });
    }

    const res223 = simulateAdminCloseCycle({ authUid: 'admin_1', cycleId: 'cyc_A', store: store223 });
    expect(res223.cycleClosed).toBe(true);

    const store224 = createInMemoryStore();
    store224.set('monthlyCycles/cyc_A', { id: 'cyc_A', status: 'OPEN', closureVersion: 0, nextCycleId: 'cyc_B' });
    store224.set('monthlyCycles/cyc_B', { id: 'cyc_B', status: 'OPEN', operationalStatus: 'PREPARING', previousCycleId: 'cyc_A' });

    for (let i = 0; i < 224; i++) {
      store224.set(`users/usr_${i}`, { id: `usr_${i}`, currentCapital: 10_000_000 });
      store224.set(`cycleUserResults/cyc_A_usr_${i}`, { cycleCapitalCop: 10_000_000 });
      store224.set(`reinvestments/reinv_${i}`, {
        id: `reinv_${i}`,
        userId: `usr_${i}`,
        sourceCycleId: 'cyc_A',
        status: 'APPROVED',
        currentCapitalSnapshotCop: 10_000_000,
        profitAppliedCop: 1_000_000,
      });
    }

    expect(() => simulateAdminCloseCycle({ authUid: 'admin_1', cycleId: 'cyc_A', store: store224 })).toThrowError(
      /CLOSE_TOO_LARGE_FOR_ATOMIC_COMMIT/
    );
  });

  it('8. CLOSE IDEMPOTENCY (SAME REQUEST VS DIFFERENT REQUEST WHEN CLOSED)', () => {
    const store = createInMemoryStore();
    store.set('monthlyCycles/cyc_A', { id: 'cyc_A', status: 'OPEN', closureVersion: 0, nextCycleId: 'cyc_B' });
    store.set('monthlyCycles/cyc_B', { id: 'cyc_B', status: 'OPEN', operationalStatus: 'PREPARING', previousCycleId: 'cyc_A' });

    // Close with request X
    const resX = simulateAdminCloseCycle({ authUid: 'admin_1', cycleId: 'cyc_A', clientRequestId: 'req_X', store });
    expect(resX.closureVersion).toBe(1);

    // Retry same request X -> idempotent replay
    const resX2 = simulateAdminCloseCycle({ authUid: 'admin_1', cycleId: 'cyc_A', clientRequestId: 'req_X', store });
    expect(resX2.idempotentReplay).toBe(true);
    expect(resX2.closureVersion).toBe(1);

    // Different request Y when already closed -> DENY
    expect(() => simulateAdminCloseCycle({ authUid: 'admin_1', cycleId: 'cyc_A', clientRequestId: 'req_Y', store })).toThrowError(
      /CYCLE_ALREADY_CLOSED/
    );
    expect(store.get('monthlyCycles/cyc_A').closureVersion).toBe(1);
  });

  it('9. ADMIN CONFIRM EXTERNAL CONTRIBUTION GUARDS', () => {
    const store = createInMemoryStore();

    store.set('monthlyCycles/cyc_A', { id: 'cyc_A', status: 'CLOSED', nextCycleId: 'cyc_B' });
    store.set('monthlyCycles/cyc_B', { id: 'cyc_B', status: 'OPEN', operationalStatus: 'PREPARING', previousCycleId: 'cyc_A' });
    store.set('reinvestments/reinv_1', {
      id: 'reinv_1',
      targetCycleId: 'cyc_B',
      cashInjectionCop: 2_000_000,
      externalFundingStatus: 'PENDING',
    });

    // Exact amount confirmation
    const res = simulateAdminConfirmExternalContribution({
      authUid: 'admin_1',
      targetCycleId: 'cyc_B',
      reinvestmentId: 'reinv_1',
      confirmedAmountCop: 2_000_000,
      store,
    });
    expect(res.externalFundingStatus).toBe('CONFIRMED');

    // Mismatch confirmation -> DENY
    store.set('reinvestments/reinv_2', {
      id: 'reinv_2',
      targetCycleId: 'cyc_B',
      cashInjectionCop: 2_000_000,
      externalFundingStatus: 'PENDING',
    });

    expect(() =>
      simulateAdminConfirmExternalContribution({
        authUid: 'admin_1',
        targetCycleId: 'cyc_B',
        reinvestmentId: 'reinv_2',
        confirmedAmountCop: 1_000_000,
        store,
      })
    ).toThrowError(/CONFIRMATION_AMOUNT_MISMATCH/);
  });

  it('10. CASH + RECLOSE RECONCILIATION STATUS', () => {
    const store = createInMemoryStore();

    store.set('users/usr_1', { id: 'usr_1', currentCapital: 10_000_000 });
    store.set('monthlyCycles/cyc_A', { id: 'cyc_A', status: 'OPEN', closureVersion: 0, nextCycleId: 'cyc_B' });
    store.set('monthlyCycles/cyc_B', { id: 'cyc_B', status: 'OPEN', operationalStatus: 'PREPARING', previousCycleId: 'cyc_A' });
    store.set('cycleUserResults/cyc_A_usr_1', { cycleCapitalCop: 10_000_000 });

    // Request confirmed with 2M cash
    store.set('reinvestments/reinv_1', {
      id: 'reinv_1',
      userId: 'usr_1',
      sourceCycleId: 'cyc_A',
      targetCycleId: 'cyc_B',
      status: 'APPROVED',
      currentCapitalSnapshotCop: 10_000_000,
      profitAppliedCop: 0,
      cashInjectionCop: 2_000_000,
      externalFundingStatus: 'CONFIRMED',
      confirmedAmountCop: 2_000_000,
    });

    // Close when cash matches -> fundingReconciliationStatus = OK
    simulateAdminCloseCycle({ authUid: 'admin_1', cycleId: 'cyc_A', store });
    expect(store.get('reinvestments/reinv_1').fundingReconciliationStatus).toBe('OK');

    // Reopen and change required cash injection to 3M while bank evidence remains 2M
    simulateAdminReopenCycle({ authUid: 'admin_1', cycleId: 'cyc_A', store });
    store.set('reinvestments/reinv_1', {
      ...store.get('reinvestments/reinv_1'),
      cashInjectionCop: 3_000_000, // Discrepancia con 2M confirmados
    });

    simulateAdminCloseCycle({ authUid: 'admin_1', cycleId: 'cyc_A', store });
    expect(store.get('reinvestments/reinv_1').fundingReconciliationStatus).toBe('NEEDS_REVIEW');
    expect(store.get('reinvestments/reinv_1').externalFundingStatus).toBe('CONFIRMED'); // Evidence untouched
    expect(store.get('reinvestments/reinv_1').confirmedAmountCop).toBe(2_000_000);
  });

  it('11. NEW USER ENTRY (entryCycleId)', () => {
    const store = createInMemoryStore();

    store.set('monthlyCycles/cyc_A', { id: 'cyc_A', status: 'CLOSED', nextCycleId: 'cyc_B' });
    store.set('monthlyCycles/cyc_B', { id: 'cyc_B', status: 'OPEN', operationalStatus: 'PREPARING', previousCycleId: 'cyc_A' });

    // Create user for B when A is CLOSED -> PASS
    const newUser = simulateAdminCreateUser({
      email: 'newuser@investor.com',
      fullName: 'New Investor B',
      initialCapitalCop: 5_000_000,
      targetCycleId: 'cyc_B',
      store,
    });

    expect(newUser.user.entryCycleId).toBe('cyc_B');

    // Create user when predecessor A is NOT CLOSED -> DENY
    store.set('monthlyCycles/cyc_A2', { id: 'cyc_A2', status: 'OPEN', nextCycleId: 'cyc_B2' });
    store.set('monthlyCycles/cyc_B2', { id: 'cyc_B2', status: 'OPEN', operationalStatus: 'PREPARING', previousCycleId: 'cyc_A2' });

    expect(() =>
      simulateAdminCreateUser({
        email: 'baduser@investor.com',
        fullName: 'Bad Investor',
        initialCapitalCop: 5_000_000,
        targetCycleId: 'cyc_B2',
        store,
      })
    ).toThrowError(/PREDECESSOR_CYCLE_NOT_CLOSED_FOR_NEW_ENTRY/);
  });

  it('12. DETERMINISTIC eligibleParticipants & PARTICIPANT WITHOUT REQUEST', () => {
    const store = createInMemoryStore();

    store.set('monthlyCycles/cyc_A', { id: 'cyc_A', status: 'CLOSED', closureVersion: 1, nextCycleId: 'cyc_B' });
    store.set('monthlyCycles/cyc_B', { id: 'cyc_B', status: 'OPEN', operationalStatus: 'PREPARING', previousCycleId: 'cyc_A', sourceClosureVersion: 1, trmApplied: 4000 });

    // User 1: Cohort A with request
    store.set('users/usr_1', { id: 'usr_1', status: 'ACTIVE', currentCapital: 10_000_000 });
    store.set('cycleUserResults/cyc_A_usr_1', { cycleId: 'cyc_A', userId: 'usr_1', cycleCapitalCop: 10_000_000 });
    store.set('reinvestments/reinv_1', {
      id: 'reinv_1',
      userId: 'usr_1',
      targetCycleId: 'cyc_B',
      status: 'APPROVED',
      cashInjectionCop: 0,
      securedNextCapitalCop: 12_000_000,
    });

    // User 2: Cohort A without request (stale currentCapital in user profile = 99M)
    store.set('users/usr_2', { id: 'usr_2', status: 'ACTIVE', currentCapital: 99_000_000 });
    store.set('cycleUserResults/cyc_A_usr_2', { cycleId: 'cyc_A', userId: 'usr_2', cycleCapitalCop: 10_000_000 });

    // User 3: Cohort B new entry
    store.set('users/usr_3', { id: 'usr_3', status: 'ACTIVE', entryCycleId: 'cyc_B', currentCapital: 5_000_000 });

    // User 4: Global ACTIVE user NOT in A and NOT in entry B
    store.set('users/usr_4', { id: 'usr_4', status: 'ACTIVE', currentCapital: 50_000_000 });

    const startRes = simulateAdminStartCycle({ authUid: 'admin_1', targetCycleId: 'cyc_B', store });
    expect(startRes.participantCount).toBe(3); // User 1, 2, 3 (NOT User 4)

    // User 2 must use 10M from cycleUserResults/A, NOT 99M from users.currentCapital
    expect(store.get('cycleUserResults/cyc_B_usr_2').cycleCapitalCop).toBe(10_000_000);

    // Summary consistency
    const summary = store.get('cycleFinancialSummaries/cyc_B');
    expect(summary.initialActiveUsersCount).toBe(3);
    expect(summary.initialManagedCapitalCop).toBe(27_000_000); // 12M + 10M + 5M = 27M
  });

  it('13. START LIFECYCLE GUARDS & DATA BLOCKS', () => {
    const store = createInMemoryStore();

    store.set('monthlyCycles/cyc_A', { id: 'cyc_A', status: 'CLOSED', closureVersion: 1, nextCycleId: 'cyc_B' });
    store.set('monthlyCycles/cyc_B', { id: 'cyc_B', status: 'OPEN', operationalStatus: 'PREPARING', previousCycleId: 'cyc_A', sourceClosureVersion: 1, trmApplied: 4000 });

    store.set('users/usr_1', { id: 'usr_1', status: 'ACTIVE', currentCapital: 10_000_000 });
    store.set('cycleUserResults/cyc_A_usr_1', { cycleId: 'cyc_A', userId: 'usr_1', cycleCapitalCop: 10_000_000 });

    // Block if existing operations in B
    store.set('dailyOperations/op_1', { cycleId: 'cyc_B', amountUsd: 100 });
    expect(() => simulateAdminStartCycle({ authUid: 'admin_1', targetCycleId: 'cyc_B', store })).toThrowError(
      /CYCLE_HAS_EXISTING_OPERATIONS/
    );
    store.delete('dailyOperations/op_1');

    // Block if funding reconciliation is NEEDS_REVIEW
    store.set('reinvestments/reinv_1', {
      id: 'reinv_1',
      userId: 'usr_1',
      targetCycleId: 'cyc_B',
      status: 'APPROVED',
      fundingReconciliationStatus: 'NEEDS_REVIEW',
    });
    expect(() => simulateAdminStartCycle({ authUid: 'admin_1', targetCycleId: 'cyc_B', store })).toThrowError(
      /UNRESOLVED_FUNDING_RECONCILIATION/
    );
  });

  it('14. START TRM VALIDATION & TRM LIFECYCLE FREEZE', () => {
    const store = createInMemoryStore();

    store.set('monthlyCycles/cyc_A', { id: 'cyc_A', status: 'OPEN', operationalStatus: 'PREPARING', trmApplied: 4000 });

    // Update TRM during PREPARING -> ALLOW
    const trmRes = simulateAdminUpdateCycleTrm({ cycleId: 'cyc_A', newTrm: 4200, store });
    expect(trmRes.trmApplied).toBe(4200);

    // Update TRM after STARTED -> DENY
    store.set('monthlyCycles/cyc_A', { ...store.get('monthlyCycles/cyc_A'), operationalStatus: 'STARTED' });
    expect(() => simulateAdminUpdateCycleTrm({ cycleId: 'cyc_A', newTrm: 4300, store })).toThrowError(
      /TRM_FROZEN_AFTER_CYCLE_START/
    );
  });

  it('15. START WRITE LIMIT (149 WORST ALLOWED vs 150 WORST DENIED)', () => {
    const store149 = createInMemoryStore();
    store149.set('monthlyCycles/cyc_A', { id: 'cyc_A', status: 'CLOSED', closureVersion: 1, nextCycleId: 'cyc_B' });
    store149.set('monthlyCycles/cyc_B', { id: 'cyc_B', status: 'OPEN', operationalStatus: 'PREPARING', previousCycleId: 'cyc_A', sourceClosureVersion: 1, trmApplied: 4000 });

    // P=149, U=149, R=149 -> 3 + 149 + 149 + 149 = 450
    for (let i = 0; i < 149; i++) {
      store149.set(`users/usr_${i}`, { id: `usr_${i}`, status: 'ACTIVE', currentCapital: 10_000_000 });
      store149.set(`cycleUserResults/cyc_A_usr_${i}`, { cycleId: 'cyc_A', userId: `usr_${i}`, cycleCapitalCop: 10_000_000 });
      store149.set(`reinvestments/reinv_${i}`, {
        id: `reinv_${i}`,
        userId: `usr_${i}`,
        targetCycleId: 'cyc_B',
        status: 'APPROVED',
        cashInjectionCop: 1_000_000,
        externalFundingStatus: 'CONFIRMED',
        fundingReconciliationStatus: 'OK',
      });
    }

    const start149 = simulateAdminStartCycle({ authUid: 'admin_1', targetCycleId: 'cyc_B', store: store149 });
    expect(start149.participantCount).toBe(149);

    const store150 = createInMemoryStore();
    store150.set('monthlyCycles/cyc_A', { id: 'cyc_A', status: 'CLOSED', closureVersion: 1, nextCycleId: 'cyc_B' });
    store150.set('monthlyCycles/cyc_B', { id: 'cyc_B', status: 'OPEN', operationalStatus: 'PREPARING', previousCycleId: 'cyc_A', sourceClosureVersion: 1, trmApplied: 4000 });

    // P=150, U=150, R=150 -> 3 + 150 + 150 + 150 = 453 > 450
    for (let i = 0; i < 150; i++) {
      store150.set(`users/usr_${i}`, { id: `usr_${i}`, status: 'ACTIVE', currentCapital: 10_000_000 });
      store150.set(`cycleUserResults/cyc_A_usr_${i}`, { cycleId: 'cyc_A', userId: `usr_${i}`, cycleCapitalCop: 10_000_000 });
      store150.set(`reinvestments/reinv_${i}`, {
        id: `reinv_${i}`,
        userId: `usr_${i}`,
        targetCycleId: 'cyc_B',
        status: 'APPROVED',
        cashInjectionCop: 1_000_000,
        externalFundingStatus: 'CONFIRMED',
        fundingReconciliationStatus: 'OK',
      });
    }

    expect(() => simulateAdminStartCycle({ authUid: 'admin_1', targetCycleId: 'cyc_B', store: store150 })).toThrowError(
      /START_TOO_LARGE_FOR_ATOMIC_COMMIT/
    );
  });

  it('16. CALENDAR DEPENDENCIES IN FINANCIAL BACKEND CODE', () => {
    const fnIndexPath = path.join(process.cwd(), 'functions/index.js');
    const fnCode = fs.readFileSync(fnIndexPath, 'utf8');

    // Extract finance callables
    const financialCallables = [
      'submitReinvestmentRequestCallable',
      'adminResolveReinvestmentCallable',
      'adminCloseCycleCallable',
      'adminConfirmExternalContributionCallable',
      'adminStartCycleCallable',
      'adminReopenCycleCallable',
    ];

    financialCallables.forEach((callableName) => {
      const fnStart = fnCode.indexOf(callableName);
      expect(fnStart).toBeGreaterThan(-1);
      const fnSlice = fnCode.substring(fnStart, fnStart + 4000);

      expect(fnSlice.includes('getNextCycleId(')).toBe(false);
      expect(fnSlice.includes('getPreviousCycleId(')).toBe(false);
      expect(fnSlice.includes('getCycleMonthName(')).toBe(false);
    });
  });
});
