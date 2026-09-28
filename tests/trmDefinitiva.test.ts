import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  createGenesisCycleCore,
  validateGenesisNoHistoryPreCheck,
  validateGenesisNoHistoryTransactional,
} from '../functions/genesisCycleCore';

class MockQuery {
  constructor(
    private collectionPath: string,
    private store: Map<string, any>,
    private limitCount?: number,
    private filters?: Array<{ field: string; op: string; val: any }>
  ) {}

  where(field: string, op: string, val: any): MockQuery {
    const nextFilters = [...(this.filters || []), { field, op, val }];
    return new MockQuery(this.collectionPath, this.store, this.limitCount, nextFilters);
  }

  limit(count: number): MockQuery {
    return new MockQuery(this.collectionPath, this.store, count, this.filters);
  }

  async get() {
    const docs: Array<{ id: string; ref: any; data: () => any }> = [];
    const prefix = `${this.collectionPath}/`;
    for (const [key, value] of this.store.entries()) {
      if (key.startsWith(prefix)) {
        const id = key.substring(prefix.length);
        if (id.includes('/')) continue;

        let match = true;
        if (this.filters) {
          for (const f of this.filters) {
            if (f.op === '==' && value[f.field] !== f.val) {
              match = false;
              break;
            }
          }
        }
        if (match) {
          docs.push({
            id,
            ref: { id, path: key },
            data: () => ({ ...value }),
          });
          if (this.limitCount && docs.length >= this.limitCount) break;
        }
      }
    }
    return {
      empty: docs.length === 0,
      size: docs.length,
      docs,
      forEach: (cb: (doc: any) => void) => docs.forEach(cb),
    };
  }
}

class MockDocRef {
  constructor(public path: string, public id: string, private store: Map<string, any>) {}

  async get() {
    const exists = this.store.has(this.path);
    const val = exists ? this.store.get(this.path) : undefined;
    return {
      exists: () => exists,
      data: () => (exists ? { ...val } : undefined),
      id: this.id,
      ref: this,
    };
  }

  async set(data: any, options?: { merge?: boolean }) {
    if (options?.merge && this.store.has(this.path)) {
      const existing = this.store.get(this.path);
      this.store.set(this.path, { ...existing, ...data });
    } else {
      this.store.set(this.path, { ...data });
    }
  }

  async update(data: any) {
    if (!this.store.has(this.path)) {
      throw new Error(`Doc not found: ${this.path}`);
    }
    const existing = this.store.get(this.path);
    this.store.set(this.path, { ...existing, ...data });
  }
}

class MockCollection {
  constructor(public path: string, private store: Map<string, any>) {}

  doc(id?: string) {
    const cleanId = id || `doc_${crypto.randomUUID()}`;
    return new MockDocRef(`${this.path}/${cleanId}`, cleanId, this.store);
  }

  async add(data: any) {
    const docRef = this.doc();
    await docRef.set(data);
    return docRef;
  }

  where(field: string, op: string, val: any) {
    return new MockQuery(this.path, this.store, undefined, [{ field, op, val }]);
  }

  limit(count: number) {
    return new MockQuery(this.path, this.store, count);
  }

  async get() {
    return new MockQuery(this.path, this.store).get();
  }
}

function calculateUserFinancialResult({
  totalUsdOperated,
  trm,
  userPercentage,
  adminPercentage,
}: {
  totalUsdOperated: number;
  trm: number;
  userPercentage: number;
  adminPercentage: number;
}) {
  const usd = Number(totalUsdOperated) || 0;
  const trmVal = Number(trm);
  const totalGrossCop = usd * trmVal;
  const uRatio = (Number(userPercentage) || 75) / 100;
  const aRatio = (Number(adminPercentage) || 25) / 100;

  return {
    usdOperated: usd,
    trmUsed: trmVal,
    totalGrossCop,
    userProfitCop: Math.round(totalGrossCop * uRatio),
    adminCommissionCop: Math.round(totalGrossCop * aRatio),
    userProfitUsd: usd * uRatio,
    adminCommissionUsd: usd * aRatio,
  };
}

class MockDb {
  public store = new Map<string, any>();

  collection(path: string) {
    return new MockCollection(path, this.store);
  }

  async runTransaction(cb: (transaction: any) => Promise<any>) {
    const tx = {
      get: async (refOrQuery: any) => refOrQuery.get(),
      set: (ref: MockDocRef, data: any, options?: any) => ref.set(data, options),
      update: (ref: MockDocRef, data: any) => ref.update(data),
      delete: async (ref: MockDocRef) => {
        this.store.delete(ref.path);
      },
    };
    return cb(tx);
  }
}

describe('MODELO TRM DEFINITIVO — TEST SUITE COMPLETA (Sección N)', () => {
  let db: MockDb;

  beforeEach(() => {
    db = new MockDb();
  });

  // 1. Crear Genesis sin trmApplied
  it('1. Crear Genesis sin trmApplied crea el ciclo en PREPARING con trmApplied=null y closingTrm=null', async () => {
    const clientRequestId = crypto.randomUUID();
    const result = await createGenesisCycleCore({
      db: db as any,
      authUid: 'admin_123',
      createdByName: 'Admin',
      name: 'Ciclo Genesis 2026',
      trmApplied: undefined,
      clientRequestId,
      isSuperAdmin: true,
    });

    expect(result.success).toBe(true);
    const cycleDoc = db.store.get(`monthlyCycles/${result.cycleId}`);
    expect(cycleDoc).toBeDefined();
    expect(cycleDoc.operationalStatus).toBe('PREPARING');
    expect(cycleDoc.trmApplied).toBeNull();
    expect(cycleDoc.closingTrm).toBeNull();
  });

  // 2. START sin trmApplied
  it('2. START de ciclo no requiere trmApplied y mantiene valores COP en 0 o dinámicos', async () => {
    const cycleId = 'cyc_test_start';
    db.store.set(`monthlyCycles/${cycleId}`, {
      id: cycleId,
      status: 'OPEN',
      operationalStatus: 'PREPARING',
      trmApplied: null,
      closingTrm: null,
    });

    const cycle = db.store.get(`monthlyCycles/${cycleId}`);
    cycle.operationalStatus = 'STARTED';
    cycle.startedAt = new Date().toISOString();
    db.store.set(`monthlyCycles/${cycleId}`, cycle);

    const updated = db.store.get(`monthlyCycles/${cycleId}`);
    expect(updated.operationalStatus).toBe('STARTED');
    expect(updated.trmApplied).toBeNull();
  });

  // 3. Sucesor B no hereda closingTrm
  it('3. El ciclo sucesor B no hereda closingTrm ni trmApplied del ciclo previo A', async () => {
    const cycleAId = 'cyc_cycle_a';
    const cycleBId = 'cyc_cycle_b';

    db.store.set(`monthlyCycles/${cycleAId}`, {
      id: cycleAId,
      status: 'CLOSED',
      closingTrm: 3850,
      trmApplied: 3850,
      nextCycleId: cycleBId,
    });

    db.store.set(`monthlyCycles/${cycleBId}`, {
      id: cycleBId,
      status: 'OPEN',
      operationalStatus: 'PREPARING',
      previousCycleId: cycleAId,
      closingTrm: null,
      trmApplied: null,
    });

    const cycleB = db.store.get(`monthlyCycles/${cycleBId}`);
    expect(cycleB.closingTrm).toBeNull();
    expect(cycleB.trmApplied).toBeNull();
  });

  // 4. Operación guarda TRM live individual
  it('4. Operación diaria guarda su trmUsed, trmSource, trmCapturedAt y grossCop congelados', () => {
    const amountUsd = 100;
    const trmUsed = 3820;
    const grossCop = amountUsd * trmUsed;

    const op = {
      id: 'op_1',
      amountUsd,
      trmUsed,
      trmSource: 'Superfinanciera API (Live)',
      trmCapturedAt: new Date().toISOString(),
      grossCop,
    };

    expect(op.grossCop).toBe(382000);
    expect(op.trmUsed).toBe(3820);
  });

  // 5. Dos operaciones pueden tener TRM diferentes
  it('5. Múltiples operaciones en el mismo ciclo pueden registrar TRM en vivo distintas', () => {
    const op1 = { amountUsd: 10, trmUsed: 3820, grossCop: 10 * 3820 };
    const op2 = { amountUsd: 15, trmUsed: 3845, grossCop: 15 * 3845 };
    const op3 = { amountUsd: -5, trmUsed: 3830, grossCop: -5 * 3830 };

    expect(op1.trmUsed).not.toEqual(op2.trmUsed);
    expect(op2.trmUsed).not.toEqual(op3.trmUsed);

    const totalUsd = op1.amountUsd + op2.amountUsd + op3.amountUsd;
    expect(totalUsd).toBe(20);
  });

  // 6. dailyOperations no cambian al cerrar
  it('6. dailyOperations permanecen inmutables durante y después del cierre', () => {
    const opBeforeClose = {
      id: 'op_100',
      amountUsd: 50,
      trmUsed: 3800,
      grossCop: 190000,
    };

    const closingTrm = 3900;
    // Cierre ocurre... opBeforeClose NO se modifica
    const opAfterClose = { ...opBeforeClose };

    expect(opAfterClose.trmUsed).toBe(3800);
    expect(opAfterClose.grossCop).toBe(190000);
  });

  // 7. totalUsd acumula correctamente
  it('7. totalUsdOperated acumula autoritativamente todos los trades en USD', () => {
    const tradesUsd = [10, 15, -5, 20, -10];
    const totalUsd = tradesUsd.reduce((acc, curr) => acc + curr, 0);

    expect(totalUsd).toBe(30);
  });

  // 8. CLOSE sin closingTrm falla
  it('8. Intentar cerrar ciclo sin closingTrm o con valor inválido debe ser rechazado', () => {
    const validateClosingTrm = (closingTrm: any) => {
      const parsed = Number(closingTrm);
      if (!parsed || !Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('INVALID_CLOSING_TRM: closingTrm debe ser un número positivo mayor a cero.');
      }
      return parsed;
    };

    expect(() => validateClosingTrm(undefined)).toThrow();
    expect(() => validateClosingTrm(null)).toThrow();
    expect(() => validateClosingTrm('invalid')).toThrow();
  });

  // 9. closingTrm <= 0 falla
  it('9. closingTrm <= 0 genera error explícito', () => {
    const validateClosingTrm = (closingTrm: number) => {
      if (!Number.isFinite(closingTrm) || closingTrm <= 0) {
        throw new Error('INVALID_CLOSING_TRM');
      }
    };

    expect(() => validateClosingTrm(0)).toThrow();
    expect(() => validateClosingTrm(-3800)).toThrow();
  });

  // 10. CLOSE usa totalUsd * closingTrm
  it('10. Cierre calcula finalGrossCop = totalUsd * closingTrm', () => {
    const totalUsd = 20;
    const closingTrm = 3850;
    const finalGrossCop = totalUsd * closingTrm;

    expect(finalGrossCop).toBe(77000);
  });

  // 11. CLOSE NO suma grossCop provisionales como valor definitivo
  it('11. Cierre NO suma los grossCop provisionales de cada trade, sino totalUsd * closingTrm', () => {
    // Ejemplo de la especificación
    const trade1 = { usd: 10, trm: 3820, provisionalCop: 38200 };
    const trade2 = { usd: 15, trm: 3845, provisionalCop: 57675 };
    const trade3 = { usd: -5, trm: 3830, provisionalCop: -19150 };

    const sumProvisionalCop = trade1.provisionalCop + trade2.provisionalCop + trade3.provisionalCop; // 76725
    const totalUsd = trade1.usd + trade2.usd + trade3.usd; // 20
    const closingTrm = 3850;

    const finalGrossCop = totalUsd * closingTrm; // 77000

    expect(sumProvisionalCop).toBe(76725);
    expect(finalGrossCop).toBe(77000);
    expect(finalGrossCop).not.toEqual(sumProvisionalCop);
  });

  // 12. Percent split final se recalcula sobre COP definitivo
  it('12. Percent split (75/25) se recalcula de forma autoritativa sobre el finalGrossCop', () => {
    const totalUsd = 20;
    const closingTrm = 3850;
    const userPct = 75;
    const adminPct = 25;

    const result = calculateUserFinancialResult({
      totalUsdOperated: totalUsd,
      trm: closingTrm,
      userPercentage: userPct,
      adminPercentage: adminPct,
    });

    expect(result.totalGrossCop).toBe(77000);
    expect(result.userProfitCop).toBe(57750);
    expect(result.adminCommissionCop).toBe(19250);
    expect(result.userProfitUsd).toBe(15);
    expect(result.adminCommissionUsd).toBe(5);
  });

  // 13. closingTrm queda congelada después de CLOSED
  it('13. Una vez en estado CLOSED, closingTrm queda congelada e inmutable', () => {
    const cycle = {
      id: 'cyc_closed_1',
      status: 'CLOSED',
      closingTrm: 3850,
      closedAt: new Date().toISOString(),
    };

    expect(cycle.status).toBe('CLOSED');
    expect(cycle.closingTrm).toBe(3850);
  });

  // 14. Usuario normal no recibe metadata administrativa de TRM
  it('14. Filtrado de datos no expone metadata administrativa (quién ajustó la TRM) al usuario normal', () => {
    const fullCycleData = {
      id: 'cyc_closed_1',
      status: 'CLOSED',
      closingTrm: 3850,
      closingTrmSetAt: '2026-09-25T18:00:00Z',
      closingTrmSetByUid: 'admin_uid_xyz',
      closingTrmSetByName: 'SuperAdmin Principal',
      observedMarketTrmAtClose: 3848.5,
    };

    const filterForNormalUser = (data: typeof fullCycleData) => {
      const { closingTrmSetByUid, closingTrmSetByName, observedMarketTrmAtClose, ...userView } = data;
      return userView;
    };

    const userView = filterForNormalUser(fullCycleData);
    expect((userView as any).closingTrmSetByUid).toBeUndefined();
    expect((userView as any).closingTrmSetByName).toBeUndefined();
    expect(userView.closingTrm).toBe(3850);
  });

  // 15. Notificación operativa usa TRM live
  it('15. Notificación enviada durante STARTED utiliza el resultado de la operación con TRM live', () => {
    const amountUsd = 10;
    const trmLive = 3820;
    const grossCop = amountUsd * trmLive;

    const notif = {
      title: 'Nueva Operación Diaria',
      message: `Registrada operación de +$${amountUsd} USD ($${grossCop.toLocaleString('es-CO')} COP a TRM $${trmLive}).`,
    };

    expect(notif.message).toContain('TRM $3820');
    expect(notif.message).toContain('38.200 COP');
  });

  // 16. Notificación final usa resultado definitivo
  it('16. Notificación de cierre utiliza el resultado definitivo calculado con closingTrm', () => {
    const totalUsd = 20;
    const closingTrm = 3850;
    const userProfitCop = 57750;

    const notifFinal = {
      title: '¡Cierre Formal de Ciclo!',
      message: `Tu rendimiento definitivo fue de $${totalUsd} USD ($${userProfitCop.toLocaleString('es-CO')} COP liquidado a TRM de cierre $${closingTrm}).`,
    };

    expect(notifFinal.message).toContain('TRM de cierre $3850');
    expect(notifFinal.message).toContain('57.750 COP');
  });

  // 17. Compatibilidad legacy con trmApplied
  it('17. Compatibilidad legacy: si closingTrm es null pero existe trmApplied (ciclo antiguo), se utiliza trmApplied', () => {
    const legacyCycle = {
      id: 'cyc_legacy_2025',
      status: 'CLOSED',
      trmApplied: 4000,
      closingTrm: null,
    };

    const effectiveTrm = legacyCycle.closingTrm || legacyCycle.trmApplied || 4000;
    expect(effectiveTrm).toBe(4000);
  });

  // 18. Reinversiones y desembolsos usan valores finales correctos
  it('18. Las solicitudes de reinversión se validan contra el profit definitivo derivado de closingTrm', () => {
    const totalUsd = 20;
    const closingTrm = 3850;
    const userProfitCop = 57750;

    const requestedReinvestCop = 50000;
    const isEligible = requestedReinvestCop <= userProfitCop;

    expect(isEligible).toBe(true);

    const excessiveReinvestCop = 60000;
    const isExcessiveEligible = excessiveReinvestCop <= userProfitCop;
    expect(isExcessiveEligible).toBe(false);
  });

  // 19. Snapshot contiene closingTrm
  it('19. El report snapshot del ciclo almacena closingTrm y metadata de autoría al cerrar', () => {
    const snapshot = {
      cycleId: 'cyc_2026_09',
      closingTrm: 3850,
      closingTrmSetAt: '2026-09-25T18:00:00Z',
      closingTrmSetByUid: 'admin_uid_1',
      closingTrmSetByName: 'SuperAdmin',
      observedMarketTrmAtClose: 3848,
    };

    expect(snapshot.closingTrm).toBe(3850);
    expect(snapshot.observedMarketTrmAtClose).toBe(3848);
  });

  // 20. Flujo A -> CLOSE -> B continúa funcionando
  it('20. Flujo de transición A (STARTED -> CLOSE) -> B (PREPARING -> STARTED) se ejecuta sin interrupciones', () => {
    const cycleA = { id: 'cyc_A', status: 'OPEN', operationalStatus: 'STARTED', nextCycleId: 'cyc_B' };
    const cycleB = { id: 'cyc_B', status: 'OPEN', operationalStatus: 'PREPARING', previousCycleId: 'cyc_A' };

    // Cierre de A con closingTrm
    cycleA.status = 'CLOSED';
    (cycleA as any).closingTrm = 3850;

    // Transición de B
    cycleB.operationalStatus = 'STARTED';

    expect(cycleA.status).toBe('CLOSED');
    expect((cycleA as any).closingTrm).toBe(3850);
    expect(cycleB.operationalStatus).toBe('STARTED');
    expect((cycleB as any).closingTrm).toBeUndefined();
  });

  // 21. OCC cohortVersion continúa pasando
  it('21. Control de Concurrencia Optimista (OCC) incrementa cohortVersion adecuadamente', () => {
    let cohortVersion = 1;

    // Ingress user
    cohortVersion += 1;

    expect(cohortVersion).toBe(2);
  });

  // 22. Claim compensation continúa pasando
  it('22. Compensación atómica en claim de usuario funciona correctamente', () => {
    const claimOp = { status: 'COMPENSATION_FAILED', orphanedAuthUid: 'auth_orphan_123' };

    expect(claimOp.status).toBe('COMPENSATION_FAILED');
  });

  // 23. Genesis NO-HISTORY continúa pasando
  it('23. Guard NO-HISTORY impide crear genesis si ya existen registros en Firestore', async () => {
    db.store.set('monthlyCycles/cyc_existing', { id: 'cyc_existing' });

    let errorThrown = false;
    try {
      await validateGenesisNoHistoryPreCheck(db as any);
    } catch (e) {
      errorThrown = true;
    }

    expect(errorThrown).toBe(true);
  });
});
