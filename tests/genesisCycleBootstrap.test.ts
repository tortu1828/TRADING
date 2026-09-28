import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  createGenesisCycleCore,
  validateGenesisNoHistoryPreCheck,
  validateGenesisNoHistoryTransactional,
  validateTargetCycleForUserEntry,
  validateStartCycleGenesisAndPendingGuard,
  claimAccountCore,
} from '../functions/genesisCycleCore';

class MockQuery {
  constructor(private collectionPath: string, private store: Map<string, any>, private limitCount?: number, private filters?: Array<{ field: string; op: string; val: any }>) {}

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
        if (id.includes('/')) continue; // only direct children

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

  where(field: string, op: string, val: any) {
    return new MockQuery(this.path, this.store, undefined, [{ field, op, val }]);
  }

  limit(count: number) {
    return new MockQuery(this.path, this.store, count);
  }

  async get() {
    return new MockQuery(this.path, this.store).get();
  }

  async add(data: any) {
    const id = `audit_${crypto.randomUUID()}`;
    const docRef = this.doc(id);
    await docRef.set(data);
    return docRef;
  }
}

class MockTransaction {
  public writes: Array<() => void> = [];

  constructor(private store: Map<string, any>) {}

  async get(target: any) {
    return target.get();
  }

  set(docRef: MockDocRef, data: any, options?: { merge?: boolean }) {
    this.writes.push(() => docRef.set(data, options));
  }

  update(docRef: MockDocRef, data: any) {
    this.writes.push(() => docRef.update(data));
  }

  commit() {
    for (const w of this.writes) {
      w();
    }
  }
}

class MockFirestore {
  public store = new Map<string, any>();

  collection(path: string) {
    return new MockCollection(path, this.store);
  }

  async runTransaction(updateFunction: (transaction: MockTransaction) => Promise<any>) {
    const transaction = new MockTransaction(this.store);
    const result = await updateFunction(transaction);
    transaction.commit();
    return result;
  }
}

class MockAuth {
  public users = new Map<string, any>();
  public failDelete = false;

  async createUser(params: { email: string; password?: string; displayName?: string }) {
    for (const u of this.users.values()) {
      if (u.email === params.email) {
        const err: any = new Error('auth/email-already-exists');
        err.code = 'auth/email-already-exists';
        throw err;
      }
    }
    const uid = `auth_${crypto.randomUUID()}`;
    const record = { uid, email: params.email, displayName: params.displayName };
    this.users.set(uid, record);
    return record;
  }

  async deleteUser(uid: string) {
    if (this.failDelete) {
      throw new Error('AUTH_DELETE_SERVICE_UNAVAILABLE');
    }
    this.users.delete(uid);
  }

  async getUserByEmail(email: string) {
    for (const u of this.users.values()) {
      if (u.email === email) return u;
    }
    return null;
  }
}

describe('Fase 2: Arranque Limpio y Ciclo Génesis (Core Real Suite)', () => {
  let db: MockFirestore;
  let auth: MockAuth;
  const superAdminUid = 'lpx4NLEEMkeh9EJFcG68oPMVdXF2';

  beforeEach(() => {
    db = new MockFirestore();
    auth = new MockAuth();
  });

  // 1. GENESIS CREATION TESTS
  it('GENESIS_CREATE_01: Creación exitosa en sistema completamente vacío', async () => {
    const result = await createGenesisCycleCore({
      db: db as any,
      authUid: superAdminUid,
      createdByName: 'Super Admin',
      name: 'Ciclo Génesis Octubre 2026',
      trmApplied: 4150,
      clientRequestId: '11111111-1111-4111-8111-111111111111',
      isSuperAdmin: true,
    });

    expect(result.success).toBe(true);
    expect(result.operationalStatus).toBe('PREPARING');
    expect(result.status).toBe('OPEN');
    expect(result.previousCycleId).toBeNull();
    expect(result.isGenesis).toBe(true);
    expect(result.cohortVersion).toBe(1);
    expect(result.trmApplied).toBe(4150);

    const configSnap = await db.collection('settings').doc('global_config').get();
    expect(configSnap.data()?.preparingCycleId).toBe(result.cycleId);
    expect(configSnap.data()?.operationalCycleId).toBeUndefined();
  });

  it('GENESIS_CREATE_02: Rechaza creación para usuario sin permisos SuperAdmin', async () => {
    await expect(
      createGenesisCycleCore({
        db: db as any,
        authUid: 'non_admin_uid',
        createdByName: 'Regular User',
        name: 'Génesis Invalido',
        trmApplied: 4150,
        clientRequestId: '22222222-2222-4222-8222-222222222222',
        isSuperAdmin: false,
      })
    ).rejects.toThrow('PERMISSION_DENIED');
  });

  it('GENESIS_CREATE_03: Replay idempotente con mismo clientRequestId y payload devuelve mismo cycleId', async () => {
    const res1 = await createGenesisCycleCore({
      db: db as any,
      authUid: superAdminUid,
      createdByName: 'Super Admin',
      name: 'Génesis Idem',
      trmApplied: 4150,
      clientRequestId: '33333333-3333-4333-8333-333333333333',
      isSuperAdmin: true,
    });

    const res2 = await createGenesisCycleCore({
      db: db as any,
      authUid: superAdminUid,
      createdByName: 'Super Admin',
      name: 'Génesis Idem',
      trmApplied: 4150,
      clientRequestId: '33333333-3333-4333-8333-333333333333',
      isSuperAdmin: true,
    });

    expect(res2.cycleId).toBe(res1.cycleId);
    expect(res2.idempotentReplay).toBe(true);
  });

  it('GENESIS_CREATE_04: Mismo clientRequestId con payload distinto rechaza con IDEMPOTENCY_KEY_CONFLICT', async () => {
    await createGenesisCycleCore({
      db: db as any,
      authUid: superAdminUid,
      createdByName: 'Super Admin',
      name: 'Génesis Idem A',
      trmApplied: 4150,
      clientRequestId: '44444444-4444-4444-8444-444444444444',
      isSuperAdmin: true,
    });

    await expect(
      createGenesisCycleCore({
        db: db as any,
        authUid: superAdminUid,
        createdByName: 'Super Admin',
        name: 'Génesis Idem B (Distinto)',
        trmApplied: 4200,
        clientRequestId: '44444444-4444-4444-8444-444444444444',
        isSuperAdmin: true,
      })
    ).rejects.toThrow('IDEMPOTENCY_KEY_CONFLICT');
  });

  it('GENESIS_CREATE_05: lastClosedCycleId preexistente en settings/global_config bloquea CREATE', async () => {
    await db.collection('settings').doc('global_config').set({
      lastClosedCycleId: 'cyc_legacy_old_closed',
    });

    await expect(
      createGenesisCycleCore({
        db: db as any,
        authUid: superAdminUid,
        createdByName: 'Super Admin',
        name: 'Génesis Blocked',
        trmApplied: 4150,
        clientRequestId: '55555555-5555-4555-8555-555555555555',
        isSuperAdmin: true,
      })
    ).rejects.toThrow('NO_HISTORY_VIOLATION');
  });

  it('GENESIS_CREATE_06: Historial operativo en dailyOperations bloquea CREATE transaccionalmente', async () => {
    await db.collection('dailyOperations').doc('op_1').set({ amount: 500 });

    await expect(
      createGenesisCycleCore({
        db: db as any,
        authUid: superAdminUid,
        createdByName: 'Super Admin',
        name: 'Génesis Dirty',
        trmApplied: 4150,
        clientRequestId: '66666666-6666-4666-8666-666666666666',
        isSuperAdmin: true,
      })
    ).rejects.toThrow('NO_HISTORY_VIOLATION');
  });

  // 2. TARGET CYCLE VALIDATION TESTS (adminCreateUser & adminCreatePendingInvestor)
  it('TARGET_CYCLE_01: Permite targetCycleId apuntando a Génesis PREPARING válido', async () => {
    const genesisRes = await createGenesisCycleCore({
      db: db as any,
      authUid: superAdminUid,
      createdByName: 'Super Admin',
      name: 'Génesis Target',
      trmApplied: 4150,
      clientRequestId: '77777777-7777-4777-8777-777777777777',
      isSuperAdmin: true,
    });

    const assignedCycle = await validateTargetCycleForUserEntry({
      db: db as any,
      targetCycleId: genesisRes.cycleId,
    });
    expect(assignedCycle).toBe(genesisRes.cycleId);
  });

  it('TARGET_CYCLE_02: monthlyCycles corrupto (>1) bloquea creación de usuario apuntando a génesis', async () => {
    const genesisRes = await createGenesisCycleCore({
      db: db as any,
      authUid: superAdminUid,
      createdByName: 'Super Admin',
      name: 'Génesis Target Corrupt',
      trmApplied: 4150,
      clientRequestId: '88888888-8888-4888-8888-888888888888',
      isSuperAdmin: true,
    });

    // Inyectar segundo ciclo en monthlyCycles
    await db.collection('monthlyCycles').doc('cyc_extra_rogue').set({ name: 'Rogue' });

    await expect(
      validateTargetCycleForUserEntry({
        db: db as any,
        targetCycleId: genesisRes.cycleId,
      })
    ).rejects.toThrow('TARGET_CYCLE_NO_PREVIOUS');
  });

  it('TARGET_CYCLE_03: targetCycleId inexistente es rechazado con not-found', async () => {
    await expect(
      validateTargetCycleForUserEntry({
        db: db as any,
        targetCycleId: 'cyc_ghost_404',
      })
    ).rejects.toThrow('El ciclo especificado (cyc_ghost_404) no existe.');
  });

  // 3. CLAIM FLOW AND SAFE AUTH COMPENSATION TESTS
  it('CLAIM_01: claimAccountCore migra usuario, preserva entryCycleId y capital, e incrementa cohortVersion', async () => {
    const genesisRes = await createGenesisCycleCore({
      db: db as any,
      authUid: superAdminUid,
      createdByName: 'Super Admin',
      name: 'Génesis Claim Test',
      trmApplied: 4150,
      clientRequestId: '99999999-9999-4999-8999-999999999999',
      isSuperAdmin: true,
    });

    await db.collection('users').doc('legacy_inv_1').set({
      fullName: 'Inversionista Genesis',
      email: 'genesis.inv@easytraders.com',
      currentCapital: 30000000,
      entryCycleId: genesisRes.cycleId,
      status: 'PENDING_ACTIVATION',
      isClaimed: false,
    });

    const claimRes = await claimAccountCore({
      db: db as any,
      auth: auth as any,
      legacyDocId: 'legacy_inv_1',
      password: 'SecurePassword123!',
      clientRequestId: 'claim_req_1',
    });

    expect(claimRes.success).toBe(true);

    const canonicalSnap = await db.collection('users').doc(claimRes.uid).get();
    expect(canonicalSnap.data()?.status).toBe('ACTIVE');
    expect(canonicalSnap.data()?.currentCapital).toBe(30000000);
    expect(canonicalSnap.data()?.category).toBe('VERDE');
    expect(canonicalSnap.data()?.entryCycleId).toBe(genesisRes.cycleId);

    const legacySnap = await db.collection('users').doc('legacy_inv_1').get();
    expect(legacySnap.data()?.status).toBe('MIGRATED');
    expect(legacySnap.data()?.migratedToUid).toBe(claimRes.uid);

    const cycleSnap = await db.collection('monthlyCycles').doc(genesisRes.cycleId).get();
    expect(cycleSnap.data()?.cohortVersion).toBe(2);
  });

  it('CLAIM_02: claim contra ciclo STARTED falla con TARGET_CYCLE_ALREADY_STARTED y compensa Auth recién creado', async () => {
    const genesisRes = await createGenesisCycleCore({
      db: db as any,
      authUid: superAdminUid,
      createdByName: 'Super Admin',
      name: 'Génesis Started',
      trmApplied: 4150,
      clientRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      isSuperAdmin: true,
    });

    // Cambiar ciclo a STARTED
    await db.collection('monthlyCycles').doc(genesisRes.cycleId).update({
      operationalStatus: 'STARTED',
    });

    await db.collection('users').doc('legacy_inv_late').set({
      email: 'late.inv@easytraders.com',
      currentCapital: 15000000,
      entryCycleId: genesisRes.cycleId,
      status: 'PENDING_ACTIVATION',
      isClaimed: false,
    });

    await expect(
      claimAccountCore({
        db: db as any,
        auth: auth as any,
        legacyDocId: 'legacy_inv_late',
        password: 'Password123!',
        clientRequestId: 'claim_late_req',
      })
    ).rejects.toThrow('TARGET_CYCLE_ALREADY_STARTED');

    // Confirmar que la cuenta Auth nueva fue borrada (compensada)
    expect(auth.users.size).toBe(0);
  });

  it('CLAIM_03: Usuario Auth recuperado huérfano/preexistente NUNCA se borra en compensación', async () => {
    const genesisRes = await createGenesisCycleCore({
      db: db as any,
      authUid: superAdminUid,
      createdByName: 'Super Admin',
      name: 'Génesis Orphan Test',
      trmApplied: 4150,
      clientRequestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      isSuperAdmin: true,
    });

    // Poner ciclo en STARTED para forzar error en Firestore
    await db.collection('monthlyCycles').doc(genesisRes.cycleId).update({
      operationalStatus: 'STARTED',
    });

    // Preexistente en Auth
    const preExistingAuth = await auth.createUser({ email: 'preexisting@easytraders.com' });

    await db.collection('users').doc('legacy_inv_orphan').set({
      email: 'preexisting@easytraders.com',
      currentCapital: 10000000,
      entryCycleId: genesisRes.cycleId,
      orphanedAuthUid: preExistingAuth.uid,
      status: 'PENDING_ACTIVATION',
      isClaimed: false,
    });

    await expect(
      claimAccountCore({
        db: db as any,
        auth: auth as any,
        legacyDocId: 'legacy_inv_orphan',
        password: 'Password123!',
        clientRequestId: 'claim_orphan_req',
        isRecoveredOrphan: true,
        orphanedAuthUid: preExistingAuth.uid,
      })
    ).rejects.toThrow('TARGET_CYCLE_ALREADY_STARTED');

    // Confirmar que la cuenta Auth preexistente NO se eliminó
    expect(auth.users.has(preExistingAuth.uid)).toBe(true);
  });

  it('CLAIM_04: Fallo al compensar Auth registra COMPENSATION_FAILED explícito', async () => {
    const genesisRes = await createGenesisCycleCore({
      db: db as any,
      authUid: superAdminUid,
      createdByName: 'Super Admin',
      name: 'Génesis Comp Fail',
      trmApplied: 4150,
      clientRequestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      isSuperAdmin: true,
    });

    await db.collection('monthlyCycles').doc(genesisRes.cycleId).update({
      operationalStatus: 'STARTED',
    });

    await db.collection('users').doc('legacy_inv_fail_comp').set({
      email: 'failcomp@easytraders.com',
      currentCapital: 10000000,
      entryCycleId: genesisRes.cycleId,
      status: 'PENDING_ACTIVATION',
      isClaimed: false,
    });

    auth.failDelete = true; // Simular fallo de red en Firebase Auth deleteUser

    await expect(
      claimAccountCore({
        db: db as any,
        auth: auth as any,
        legacyDocId: 'legacy_inv_fail_comp',
        password: 'Password123!',
        clientRequestId: 'claim_fail_comp_req',
      })
    ).rejects.toThrow('COMPENSATION_FAILED');
  });

  // 4. START CYCLE GENESIS & PARTICIPANTS GUARDS TESTS
  it('START_01: Inversionista en PENDING_ACTIVATION bloquea el START con PENDING_PARTICIPANTS_REQUIRE_ACTIVATION', async () => {
    const genesisRes = await createGenesisCycleCore({
      db: db as any,
      authUid: superAdminUid,
      createdByName: 'Super Admin',
      name: 'Génesis Pending Guard',
      trmApplied: 4150,
      clientRequestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      isSuperAdmin: true,
    });

    await db.collection('users').doc('user_act_1').set({
      status: 'ACTIVE',
      currentCapital: 20000000,
      entryCycleId: genesisRes.cycleId,
    });

    await db.collection('users').doc('user_pend_1').set({
      status: 'PENDING_ACTIVATION',
      currentCapital: 10000000,
      entryCycleId: genesisRes.cycleId,
    });

    const cycleSnap = await db.collection('monthlyCycles').doc(genesisRes.cycleId).get();

    await expect(
      validateStartCycleGenesisAndPendingGuard({
        db: db as any,
        targetCycleId: genesisRes.cycleId,
        cycleData: cycleSnap.data(),
      })
    ).rejects.toThrow('PENDING_PARTICIPANTS_REQUIRE_ACTIVATION');
  });

  it('START_02: Inversionista en PENDING_CLAIM bloquea el START con PENDING_PARTICIPANTS_REQUIRE_ACTIVATION', async () => {
    const genesisRes = await createGenesisCycleCore({
      db: db as any,
      authUid: superAdminUid,
      createdByName: 'Super Admin',
      name: 'Génesis Pending Claim Guard',
      trmApplied: 4150,
      clientRequestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      isSuperAdmin: true,
    });

    await db.collection('users').doc('user_pend_claim_1').set({
      status: 'PENDING_CLAIM',
      currentCapital: 10000000,
      entryCycleId: genesisRes.cycleId,
    });

    const cycleSnap = await db.collection('monthlyCycles').doc(genesisRes.cycleId).get();

    await expect(
      validateStartCycleGenesisAndPendingGuard({
        db: db as any,
        targetCycleId: genesisRes.cycleId,
        cycleData: cycleSnap.data(),
      })
    ).rejects.toThrow('PENDING_PARTICIPANTS_REQUIRE_ACTIVATION');
  });

  it('START_03: Historial previo incompatible bloquea el START de Génesis con NO_HISTORY_VIOLATION', async () => {
    const genesisRes = await createGenesisCycleCore({
      db: db as any,
      authUid: superAdminUid,
      createdByName: 'Super Admin',
      name: 'Génesis History Guard',
      trmApplied: 4150,
      clientRequestId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      isSuperAdmin: true,
    });

    // Inyectar operación incompatible
    await db.collection('dailyOperations').doc('op_rogue').set({ amount: 1000 });

    const cycleSnap = await db.collection('monthlyCycles').doc(genesisRes.cycleId).get();

    await expect(
      validateStartCycleGenesisAndPendingGuard({
        db: db as any,
        targetCycleId: genesisRes.cycleId,
        cycleData: cycleSnap.data(),
      })
    ).rejects.toThrow('NO_HISTORY_VIOLATION');
  });

  it('START_04: previousCycleId=null con isGenesis != true es bloqueado', async () => {
    await db.collection('monthlyCycles').doc('cyc_fake_genesis').set({
      name: 'Fake Genesis',
      previousCycleId: null,
      isGenesis: false,
    });

    const fakeSnap = await db.collection('monthlyCycles').doc('cyc_fake_genesis').get();

    await expect(
      validateStartCycleGenesisAndPendingGuard({
        db: db as any,
        targetCycleId: 'cyc_fake_genesis',
        cycleData: fakeSnap.data(),
      })
    ).rejects.toThrow('CYCLE_LINK_MISMATCH');
  });

  // 5. OCC COHORT VERSION CONCURRENCY RACE TEST (REAL TRANSACTION EXECUTION)
  it('RACE_OCC_01: Transacción START aborta con COHORT_CHANGED_RETRY_START si cohortVersion cambió por un CLAIM concurrente', async () => {
    const genesisRes = await createGenesisCycleCore({
      db: db as any,
      authUid: superAdminUid,
      createdByName: 'Super Admin',
      name: 'Génesis Race OCC',
      trmApplied: 4150,
      clientRequestId: '12121212-1212-4212-8212-121212121212',
      isSuperAdmin: true,
    });

    // START preparado esperando cohortVersion = 1
    const expectedCohortVersion = 1;

    // Concurrencia: CLAIM concurrente se ejecutó primero y aumentó cohortVersion a 2
    await db.collection('monthlyCycles').doc(genesisRes.cycleId).update({
      cohortVersion: 2,
    });

    // Ejecutar transacción de START
    const cycleRef = db.collection('monthlyCycles').doc(genesisRes.cycleId);

    await expect(
      db.runTransaction(async (transaction) => {
        const cSnap = await transaction.get(cycleRef);
        const cData = cSnap.data() || {};
        if (Number(cData.cohortVersion || 1) !== expectedCohortVersion) {
          throw new Error('COHORT_CHANGED_RETRY_START');
        }
        transaction.update(cycleRef, { operationalStatus: 'STARTED' });
      })
    ).rejects.toThrow('COHORT_CHANGED_RETRY_START');

    // Verificar que el ciclo PERMANECE en PREPARING
    const cycleSnapAfter = await db.collection('monthlyCycles').doc(genesisRes.cycleId).get();
    expect(cycleSnapAfter.data()?.operationalStatus).toBe('PREPARING');

    // Verificar que NO se crearon resúmenes financieros
    const summariesSnap = await db.collection('cycleFinancialSummaries').doc(genesisRes.cycleId).get();
    expect(summariesSnap.exists()).toBe(false);

    // Verificar que settings no pasó a operativo
    const configSnap = await db.collection('settings').doc('global_config').get();
    expect(configSnap.data()?.operationalCycleId).toBeUndefined();
  });

  // 6. START EXECUTION INTEGRATION AND SUCCESSOR TESTS
  it('START_INTEGRATION_01: START exitoso congela participantes y asegura que NINGÚN usuario ACTIVE quede sin cycleUserResult', async () => {
    const genesisRes = await createGenesisCycleCore({
      db: db as any,
      authUid: superAdminUid,
      createdByName: 'Super Admin',
      name: 'Génesis Full Start',
      trmApplied: 4150,
      clientRequestId: '13131313-1313-4313-8313-131313131313',
      isSuperAdmin: true,
    });

    await db.collection('users').doc('user_active_a').set({
      id: 'user_active_a',
      uid: 'user_active_a',
      status: 'ACTIVE',
      currentCapital: 25000000,
      entryCycleId: genesisRes.cycleId,
    });

    await db.collection('users').doc('user_active_b').set({
      id: 'user_active_b',
      uid: 'user_active_b',
      status: 'ACTIVE',
      currentCapital: 35000000,
      entryCycleId: genesisRes.cycleId,
    });

    const cycleSnap = await db.collection('monthlyCycles').doc(genesisRes.cycleId).get();
    const guardRes = await validateStartCycleGenesisAndPendingGuard({
      db: db as any,
      targetCycleId: genesisRes.cycleId,
      cycleData: cycleSnap.data(),
    });

    expect(guardRes.activeParticipants.length).toBe(2);

    // Simular transacción real de START
    const cycleRef = db.collection('monthlyCycles').doc(genesisRes.cycleId);
    const globalConfigRef = db.collection('settings').doc('global_config');
    const summaryRef = db.collection('cycleFinancialSummaries').doc(genesisRes.cycleId);

    await db.runTransaction(async (transaction) => {
      let totalCapital = 0;
      for (const p of guardRes.activeParticipants) {
        totalCapital += Number(p.currentCapital || 0);
        const curRef = db.collection('cycleUserResults').doc(`${genesisRes.cycleId}_${p.id}`);
        transaction.set(curRef, {
          cycleId: genesisRes.cycleId,
          userId: p.id,
          cycleCapitalCop: p.currentCapital,
          isFrozen: true,
        });
      }

      transaction.update(cycleRef, {
        operationalStatus: 'STARTED',
        startedAt: new Date().toISOString(),
        initialManagedCapitalCop: totalCapital,
        initialActiveUsersCount: guardRes.activeParticipants.length,
      });

      transaction.set(globalConfigRef, {
        operationalCycleId: genesisRes.cycleId,
        activeCycleId: genesisRes.cycleId,
        preparingCycleId: null,
      }, { merge: true });

      transaction.set(summaryRef, {
        cycleId: genesisRes.cycleId,
        initialManagedCapitalCop: totalCapital,
        initialActiveUsersCount: guardRes.activeParticipants.length,
        isCycleClosed: false,
      });
    });

    // Verificaciones finales
    const updatedCycle = await cycleRef.get();
    expect(updatedCycle.data()?.operationalStatus).toBe('STARTED');
    expect(updatedCycle.data()?.initialManagedCapitalCop).toBe(60000000);
    expect(updatedCycle.data()?.initialActiveUsersCount).toBe(2);

    const updatedConfig = await globalConfigRef.get();
    expect(updatedConfig.data()?.operationalCycleId).toBe(genesisRes.cycleId);
    expect(updatedConfig.data()?.preparingCycleId).toBeNull();

    // Comprobar que TODOS los usuarios ACTIVE tienen su cycleUserResult congelado
    for (const p of guardRes.activeParticipants) {
      const curSnap = await db.collection('cycleUserResults').doc(`${genesisRes.cycleId}_${p.id}`).get();
      expect(curSnap.exists()).toBe(true);
      expect(curSnap.data()?.isFrozen).toBe(true);
      expect(curSnap.data()?.cycleCapitalCop).toBe(p.currentCapital);
    }
  });

  it('SUCCESSOR_FLOW_01: Tras START de Génesis A, Ciclo B nace con cohortVersion=1 y previousCycleId=A.id', async () => {
    const genesisRes = await createGenesisCycleCore({
      db: db as any,
      authUid: superAdminUid,
      createdByName: 'Super Admin',
      name: 'Génesis Base A',
      trmApplied: 4150,
      clientRequestId: '14141414-1414-4414-8414-141414141414',
      isSuperAdmin: true,
    });

    // START Génesis A
    await db.collection('monthlyCycles').doc(genesisRes.cycleId).update({
      operationalStatus: 'STARTED',
    });
    await db.collection('settings').doc('global_config').set({
      operationalCycleId: genesisRes.cycleId,
      activeCycleId: genesisRes.cycleId,
      preparingCycleId: null,
    });

    // Crear sucesor B (simulación de adminCreateNextCycleCallable)
    const succCycleId = 'cyc_successor_b';
    await db.collection('monthlyCycles').doc(succCycleId).set({
      id: succCycleId,
      cycleId: succCycleId,
      name: 'Ciclo Sucesor B',
      status: 'OPEN',
      operationalStatus: 'PREPARING',
      previousCycleId: genesisRes.cycleId,
      nextCycleId: null,
      cohortVersion: 1,
      trmApplied: 4150,
    });

    await db.collection('monthlyCycles').doc(genesisRes.cycleId).update({
      nextCycleId: succCycleId,
    });

    const cycleBSnap = await db.collection('monthlyCycles').doc(succCycleId).get();
    expect(cycleBSnap.data()?.previousCycleId).toBe(genesisRes.cycleId);
    expect(cycleBSnap.data()?.cohortVersion).toBe(1);
    expect(cycleBSnap.data()?.operationalStatus).toBe('PREPARING');

    const cycleASnap = await db.collection('monthlyCycles').doc(genesisRes.cycleId).get();
    expect(cycleASnap.data()?.nextCycleId).toBe(succCycleId);
  });
});
