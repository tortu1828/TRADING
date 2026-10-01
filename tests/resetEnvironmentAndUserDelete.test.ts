import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  MAX_BATCH_WRITES,
  FirestoreBatchRunner,
  serializeResetPlanForCallable,
  getProtectedAccounts,
  computeResetPlanHash,
  classifyIdempotencyKeys,
  classifyNotifications,
  buildTestEnvironmentResetPlan,
  auditUserActiveFinancialDependencies,
  executeTestEnvironmentResetCore,
  deleteIndividualUserCore,
} from '../functions/testEnvironmentResetCore';

/**
 * =========================================================================
 * TEST SUITE REAL: 40 CASOS DE PRUEBA AUTORITATIVOS (HARDENING FASE 1)
 * EJERCITA DIRECTAMENTE EL MÓDULO REAL functions/testEnvironmentResetCore.js
 * =========================================================================
 */

interface MockUserRecord {
  uid: string;
  email?: string;
  displayName?: string;
  customClaims?: Record<string, any>;
  metadata?: { creationTime?: string };
}

class MockAuth {
  public users: Map<string, MockUserRecord> = new Map();
  public failNextDelete: Error | null = null;
  public failNextList: Error | null = null;

  constructor() {
    this.reset();
  }

  reset() {
    this.users.clear();
    this.failNextDelete = null;
    this.failNextList = null;
  }

  addUser(user: MockUserRecord) {
    this.users.set(user.uid, user);
  }

  async listUsers(pageSize = 1000, pageToken?: string) {
    if (this.failNextList) {
      const err = this.failNextList;
      this.failNextList = null;
      throw err;
    }
    const allUsers = Array.from(this.users.values());
    return {
      users: allUsers,
      pageToken: undefined,
    };
  }

  async getUser(uid: string) {
    const u = this.users.get(uid);
    if (!u) {
      const err: any = new Error('User not found');
      err.code = 'auth/user-not-found';
      throw err;
    }
    return u;
  }

  async deleteUser(uid: string) {
    if (this.failNextDelete) {
      const err = this.failNextDelete;
      this.failNextDelete = null;
      if ((err as any).code === 'auth/user-not-found') {
        this.users.delete(uid);
      }
      throw err;
    }
    if (!this.users.has(uid)) {
      const err: any = new Error('User not found');
      err.code = 'auth/user-not-found';
      throw err;
    }
    this.users.delete(uid);
  }
}

class MockBatch {
  public operations: Array<{ type: 'delete' | 'update'; ref: any; data?: any }> = [];
  public static maxBatchSizeObserved = 0;
  public static batchesCommittedCount = 0;

  constructor(private db: MockFirestore) {}

  delete(ref: any) {
    if (this.operations.length >= MAX_BATCH_WRITES) {
      throw new Error(`[MockBatch] Batch size limit exceeded: attempted write > ${MAX_BATCH_WRITES}`);
    }
    this.operations.push({ type: 'delete', ref });
    if (this.operations.length > MockBatch.maxBatchSizeObserved) {
      MockBatch.maxBatchSizeObserved = this.operations.length;
    }
  }

  update(ref: any, data: any) {
    if (this.operations.length >= MAX_BATCH_WRITES) {
      throw new Error(`[MockBatch] Batch size limit exceeded: attempted write > ${MAX_BATCH_WRITES}`);
    }
    this.operations.push({ type: 'update', ref, data });
    if (this.operations.length > MockBatch.maxBatchSizeObserved) {
      MockBatch.maxBatchSizeObserved = this.operations.length;
    }
  }

  async commit() {
    for (const op of this.operations) {
      if (op.type === 'delete') {
        this.db.store.delete(op.ref.path);
      } else if (op.type === 'update') {
        const existing = this.db.store.get(op.ref.path) || {};
        this.db.store.set(op.ref.path, { ...existing, ...op.data });
      }
    }
    MockBatch.batchesCommittedCount++;
    this.operations = [];
  }
}

class MockDocRef {
  constructor(
    public id: string,
    public path: string,
    private db: MockFirestore
  ) {}

  async get() {
    const data = this.db.store.get(this.path);
    return {
      id: this.id,
      exists: data !== undefined,
      data: () => data,
      ref: this,
    };
  }

  async set(data: any, options?: any) {
    const existing = this.db.store.get(this.path) || {};
    if (options && options.merge) {
      this.db.store.set(this.path, { ...existing, ...data });
    } else {
      this.db.store.set(this.path, { ...data });
    }
  }

  async update(data: any) {
    const existing = this.db.store.get(this.path) || {};
    this.db.store.set(this.path, { ...existing, ...data });
  }

  async delete() {
    this.db.store.delete(this.path);
  }

  collection(subColName: string) {
    return new MockCollectionRef(`${this.path}/${subColName}`, this.db);
  }
}

class MockCollectionRef {
  constructor(
    public path: string,
    private db: MockFirestore
  ) {}

  doc(id?: string) {
    const docId = id || `doc_${Math.random().toString(36).substring(2, 9)}`;
    return new MockDocRef(docId, `${this.path}/${docId}`, this.db);
  }

  where(field: string, op: string, val: any) {
    return {
      limit: (n: number) => ({
        get: async () => {
          const res = await this.where(field, op, val).get();
          return {
            docs: res.docs.slice(0, n),
            empty: res.docs.length === 0,
            size: Math.min(res.docs.length, n),
          };
        },
      }),
      get: async () => {
        if (this.db.failGetForCollection[this.path]) {
          const err = this.db.failGetForCollection[this.path];
          delete this.db.failGetForCollection[this.path];
          throw err;
        }
        const prefix = `${this.path}/`;
        const docs: any[] = [];
        for (const [key, value] of this.db.store.entries()) {
          if (key.startsWith(prefix) && key.split('/').length === this.path.split('/').length + 1) {
            const docId = key.substring(prefix.length);
            if (op === '==' && value[field] === val) {
              docs.push({
                id: docId,
                exists: true,
                data: () => value,
                ref: new MockDocRef(docId, key, this.db),
              });
            }
          }
        }
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
  }

  async get() {
    if (this.db.failGetForCollection[this.path]) {
      const err = this.db.failGetForCollection[this.path];
      delete this.db.failGetForCollection[this.path];
      throw err;
    }
    if (this.db.failNextUsersGet && this.path === 'users') {
      const err = this.db.failNextUsersGet;
      this.db.failNextUsersGet = null;
      throw err;
    }
    const prefix = `${this.path}/`;
    const docs: any[] = [];
    for (const [key, value] of this.db.store.entries()) {
      if (key.startsWith(prefix) && key.split('/').length === this.path.split('/').length + 1) {
        const docId = key.substring(prefix.length);
        docs.push({
          id: docId,
          exists: true,
          data: () => value,
          ref: new MockDocRef(docId, key, this.db),
        });
      }
    }
    return {
      docs,
      empty: docs.length === 0,
      size: docs.length,
      forEach: (cb: any) => docs.forEach(cb),
    };
  }

  async add(data: any) {
    if (this.db.failNextAuditAdd && this.path === 'auditLogs') {
      const err = this.db.failNextAuditAdd;
      this.db.failNextAuditAdd = null;
      throw err;
    }
    const docId = `log_${Math.random().toString(36).substring(2, 9)}`;
    this.db.store.set(`${this.path}/${docId}`, data);
    return new MockDocRef(docId, `${this.path}/${docId}`, this.db);
  }
}

class MockFirestore {
  public store: Map<string, any> = new Map();
  public failNextUsersGet: Error | null = null;
  public failNextAuditAdd: Error | null = null;
  public failGetForCollection: Record<string, Error> = {};

  reset() {
    this.store.clear();
    this.failNextUsersGet = null;
    this.failNextAuditAdd = null;
    this.failGetForCollection = {};
    MockBatch.maxBatchSizeObserved = 0;
    MockBatch.batchesCommittedCount = 0;
  }

  batch() {
    return new MockBatch(this);
  }

  collection(path: string) {
    return new MockCollectionRef(path, this);
  }

  doc(path: string) {
    const parts = path.split('/');
    const docId = parts[parts.length - 1];
    return new MockDocRef(docId, path, this);
  }
}

describe('SUITE 40 CASOS REALES: testEnvironmentResetCore.js', () => {
  let db: MockFirestore;
  let auth: MockAuth;

  const rootAdminUid = 'lpx4NLEEMkeh9EJFcG68oPMVdXF2';
  const superAdminEmail = 'elcocalombiano1828@gmail.com';
  const secondarySuperAdminEmail = 'juanes9802@gmail.com';

  beforeEach(() => {
    db = new MockFirestore();
    auth = new MockAuth();

    // 1. Root SuperAdmin
    auth.addUser({
      uid: rootAdminUid,
      email: superAdminEmail,
      customClaims: { superadmin: true, admin: true },
    });
    db.store.set(`users/${rootAdminUid}`, {
      uid: rootAdminUid,
      email: superAdminEmail,
      role: 'ADMIN',
      userCode: 'ADM-0001',
    });

    // 2. Secondary SuperAdmin
    auth.addUser({
      uid: 'secondary_superadmin_uid',
      email: secondarySuperAdminEmail,
      customClaims: { superadmin: true },
    });
    db.store.set('users/secondary_superadmin_uid', {
      uid: 'secondary_superadmin_uid',
      email: secondarySuperAdminEmail,
      role: 'ADMIN',
      userCode: 'ADM-0002',
    });

    // 3. Normal Admin con Claim
    auth.addUser({
      uid: 'custom_admin_uid',
      email: 'customadmin@test.com',
      customClaims: { admin: true },
    });
    db.store.set('users/custom_admin_uid', {
      uid: 'custom_admin_uid',
      email: 'customadmin@test.com',
      role: 'ADMIN',
      userCode: 'ADM-0003',
    });

    // 4. Inversionistas de prueba (Candidatos a borrado)
    auth.addUser({
      uid: 'user_cand_1',
      email: 'candidate1@test.com',
      displayName: 'Inversionista Prueba 1',
    });
    db.store.set('users/user_cand_1', {
      uid: 'user_cand_1',
      userCode: 'USR-1001',
      fullName: 'Inversionista Prueba 1',
      email: 'candidate1@test.com',
      role: 'USER',
      currentCapital: 0,
    });
    db.store.set('users/user_cand_1/pushTokens/token_1', {
      token: 'fcm_tok_123',
    });

    auth.addUser({
      uid: 'user_cand_2',
      email: 'candidate2@test.com',
      displayName: 'Inversionista Prueba 2',
    });
    db.store.set('users/user_cand_2', {
      uid: 'user_cand_2',
      userCode: 'USR-1002',
      fullName: 'Inversionista Prueba 2',
      email: 'candidate2@test.com',
      role: 'USER',
      currentCapital: 0,
    });

    // 5. Ciclos de prueba
    db.store.set('monthlyCycles/2026-09', {
      name: 'Ciclo Septiembre 2026',
      status: 'OPEN',
      operationalStatus: 'STARTED',
    });

    // 6. Resumen financiero
    db.store.set('cycleFinancialSummaries/2026-09', {
      cycleId: '2026-09',
      isCycleClosed: false,
    });

    // 7. Resultados de usuario
    db.store.set('cycleUserResults/res_1', {
      cycleId: '2026-09',
      userUid: 'user_cand_1',
      profitCop: 500000,
    });

    // 8. Reinversiones
    db.store.set('reinvestments/reinv_1', {
      cycleId: '2026-09',
      userUid: 'user_cand_1',
      status: 'PENDING',
    });

    // 9. Desembolsos
    db.store.set('disbursements/disb_1', {
      cycleId: '2026-09',
      userUid: 'user_cand_1',
      status: 'REQUESTED',
    });

    // 10. Operaciones diarias
    db.store.set('dailyOperations/op_1', {
      cycleId: '2026-09',
      authorizedUids: ['user_cand_1', 'user_cand_2'],
    });

    // 11. Idempotency keys vinculadas y no vinculadas
    db.store.set('idempotencyKeys/create_next_req_test_1', {
      sourceCycleId: '2026-09',
      userUid: 'user_cand_1',
    });
    db.store.set('idempotencyKeys/unknown_standalone_key', {
      purpose: 'SYSTEM_INTERNAL',
    });

    // 12. Notificaciones vinculadas y administrativas
    db.store.set('notifications/notif_user_1', {
      userUid: 'user_cand_1',
      title: 'Tu reporte',
    });
    db.store.set('notifications/notif_admin_alert', {
      title: 'Alerta del sistema',
      targetUids: [rootAdminUid],
    });

    // 13. Settings global_config
    db.store.set('settings/global_config', {
      activeCycleId: '2026-09',
      operationalCycleId: '2026-09',
      preparingCycleId: null,
      lastClosedCycleId: '2026-08',
      trmReference: 4150,
      trmMode: 'MANUAL',
    });

    // 14. Contador
    db.store.set('counters/users', { nextCodeNumber: 1003 });
  });

  // 1 SuperAdmin protegido
  it('1. SuperAdmin protegido: root UID y email SuperAdmin no pueden purgarse ni ser eliminados', async () => {
    const { protectedUids, protectedEmails } = await getProtectedAccounts(
      rootAdminUid,
      superAdminEmail,
      db as any,
      auth as any
    );
    expect(protectedUids.has(rootAdminUid)).toBe(true);
    expect(protectedEmails.has(superAdminEmail)).toBe(true);
    expect(protectedEmails.has(secondarySuperAdminEmail)).toBe(true);
  });

  // 2 claim admin protegido
  it('2. claim admin protegido: cuenta con customClaims.admin == true es protegida', async () => {
    const { protectedUids } = await getProtectedAccounts(rootAdminUid, superAdminEmail, db as any, auth as any);
    expect(protectedUids.has('custom_admin_uid')).toBe(true);
  });

  // 3 claim superadmin protegido
  it('3. claim superadmin protegido: cuenta con customClaims.superadmin == true es protegida', async () => {
    const { protectedUids } = await getProtectedAccounts(rootAdminUid, superAdminEmail, db as any, auth as any);
    expect(protectedUids.has('secondary_superadmin_uid')).toBe(true);
  });

  // 4 role ADMIN protegido
  it('4. role ADMIN protegido: documento /users con role === ADMIN es protegido', async () => {
    const { protectedDocIds } = await getProtectedAccounts(rootAdminUid, superAdminEmail, db as any, auth as any);
    expect(protectedDocIds.has(rootAdminUid)).toBe(true);
    expect(protectedDocIds.has('custom_admin_uid')).toBe(true);
  });

  // 5 normal Auth candidato
  it('5. normal Auth candidato: usuario no administrativo de Auth entra como candidato a borrar', async () => {
    const { plan } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);
    const authCandidateUids = plan.authUsersToDelete.map((u: any) => u.uid);
    expect(authCandidateUids).toContain('user_cand_1');
    expect(authCandidateUids).toContain('user_cand_2');
    expect(authCandidateUids).not.toContain(rootAdminUid);
  });

  // 6 normal Firestore candidato
  it('6. normal Firestore candidato: documento no administrativo de /users entra como candidato', async () => {
    const { plan } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);
    const fsCandidateIds = plan.firestoreUsersToDelete.map((u: any) => u.id);
    expect(fsCandidateIds).toContain('user_cand_1');
    expect(fsCandidateIds).toContain('user_cand_2');
    expect(fsCandidateIds).not.toContain(rootAdminUid);
  });

  // 7 preview read-only
  it('7. preview read-only: buildTestEnvironmentResetPlan ejecuta cero mutaciones en Auth y Firestore', async () => {
    const initialDbKeys = Array.from(db.store.keys());
    const initialAuthUsers = Array.from(auth.users.keys());

    await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);

    expect(Array.from(db.store.keys())).toEqual(initialDbKeys);
    expect(Array.from(auth.users.keys())).toEqual(initialAuthUsers);
  });

  // 8 hash determinístico
  it('8. hash determinístico: múltiples cálculos sobre el mismo plan producen el mismo hash SHA-256', async () => {
    const res1 = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);
    const res2 = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);
    expect(res1.previewHash).toBe(res2.previewHash);
    expect(res1.previewHash.length).toBe(64);
  });

  // 9 hash cambia al cambiar candidato
  it('9. hash cambia al cambiar candidato: agregar un nuevo usuario cambia el hash determinístico', async () => {
    const res1 = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);

    auth.addUser({ uid: 'new_user_cand', email: 'newcand@test.com' });
    db.store.set('users/new_user_cand', { uid: 'new_user_cand', role: 'USER' });

    const res2 = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);
    expect(res1.previewHash).not.toBe(res2.previewHash);
  });

  // 10 confirmation reset incorrecta
  it('10. confirmation reset incorrecta: rechaza cualquier frase diferente a REINICIAR ENTORNO DE PRUEBA', async () => {
    const { previewHash } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);

    await expect(
      executeTestEnvironmentResetCore({
        authUid: rootAdminUid,
        authEmail: superAdminEmail,
        createdByName: 'Super Admin',
        confirmation: 'RESET TOTAL ENTORNO DE PRUEBA',
        expectedPreviewHash: previewHash,
        db: db as any,
        auth: auth as any,
        FieldValue: null,
      })
    ).rejects.toThrow('La frase de confirmación no coincide');
  });

  // 11 stale preview rechazado
  it('11. stale preview rechazado: si expectedPreviewHash difiere del hash en caliente, lanza RESET_PREVIEW_STALE', async () => {
    await expect(
      executeTestEnvironmentResetCore({
        authUid: rootAdminUid,
        authEmail: superAdminEmail,
        createdByName: 'Super Admin',
        confirmation: 'REINICIAR ENTORNO DE PRUEBA',
        expectedPreviewHash: 'hash_obsoleto_12345',
        db: db as any,
        auth: auth as any,
        FieldValue: null,
      })
    ).rejects.toThrow('RESET_PREVIEW_STALE');
  });

  // 12 auth/user-not-found idempotente
  it('12. auth/user-not-found idempotente: si usuario de Auth ya no existe, el reset continúa exitosamente', async () => {
    const { previewHash } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);

    auth.failNextDelete = Object.assign(new Error('User not found'), { code: 'auth/user-not-found' });

    const result = await executeTestEnvironmentResetCore({
      authUid: rootAdminUid,
      authEmail: superAdminEmail,
      createdByName: 'Super Admin',
      confirmation: 'REINICIAR ENTORNO DE PRUEBA',
      expectedPreviewHash: previewHash,
      db: db as any,
      auth: auth as any,
      FieldValue: null,
    });

    expect(result.success).toBe(true);
  });

  // 13 auditLogs nunca se borra
  it('13. auditLogs nunca se borra: registros de auditLogs existentes se preservan durante el reset', async () => {
    db.store.set('auditLogs/historical_log_1', { action: 'CYCLE_OPENED', cycleId: '2026-08' });

    const { previewHash } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);

    await executeTestEnvironmentResetCore({
      authUid: rootAdminUid,
      authEmail: superAdminEmail,
      createdByName: 'Super Admin',
      confirmation: 'REINICIAR ENTORNO DE PRUEBA',
      expectedPreviewHash: previewHash,
      db: db as any,
      auth: auth as any,
      FieldValue: null,
    });

    expect(db.store.has('auditLogs/historical_log_1')).toBe(true);
  });

  // 14 settings/global_config no se elimina
  it('14. settings/global_config no se elimina: se actualiza con merge y se preserva', async () => {
    const { previewHash } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);

    await executeTestEnvironmentResetCore({
      authUid: rootAdminUid,
      authEmail: superAdminEmail,
      createdByName: 'Super Admin',
      confirmation: 'REINICIAR ENTORNO DE PRUEBA',
      expectedPreviewHash: previewHash,
      db: db as any,
      auth: auth as any,
      FieldValue: null,
    });

    expect(db.store.has('settings/global_config')).toBe(true);
    const cfg = db.store.get('settings/global_config');
    expect(cfg.trmReference).toBe(4150);
    expect(cfg.trmMode).toBe('MANUAL');
  });

  // 15 ciclos enumerados explícitamente
  it('15. ciclos enumerados explícitamente: monthlyCyclesToDelete lista los ciclos detectados', async () => {
    const { plan } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);
    const cycleIds = plan.monthlyCyclesToDelete.map((c: any) => c.id);
    expect(cycleIds).toContain('2026-09');
  });

  // 16 report versions incluidas
  it('16. report versions incluidas: subcolecciones versions y snapshots de cycleReports entran en el plan', async () => {
    db.store.set('cycleReports/rep_2026_09', { cycleId: '2026-09' });
    db.store.set('cycleReports/rep_2026_09/versions/v1', { version: 1 });
    db.store.set('cycleReports/rep_2026_09/versions/v1/users/usr_snap_1', { profit: 100 });

    const { plan } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);
    const reportPaths = plan.cycleReportsToDelete.map((r: any) => r.path);
    expect(reportPaths).toContain('cycleReports/rep_2026_09');
    expect(reportPaths).toContain('cycleReports/rep_2026_09/versions/v1');
    expect(reportPaths).toContain('cycleReports/rep_2026_09/versions/v1/users/usr_snap_1');
  });

  // 17 idempotency ambigua preservada
  it('17. idempotency ambigua preservada: clave no vinculada a ciclos u operaciones eliminadas se preserva', async () => {
    const { plan } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);
    const deletedKeys = plan.idempotencyKeysToDelete.map((k: any) => k.id);
    const unclassified = plan.unclassifiedIdempotencyKeys.map((k: any) => k.id);

    expect(deletedKeys).toContain('create_next_req_test_1');
    expect(unclassified).toContain('unknown_standalone_key');
  });

  // 18 delete Admin bloqueado
  it('18. delete Admin bloqueado: rechaza eliminar SuperAdmin o admin con permission-denied', async () => {
    await expect(
      deleteIndividualUserCore({
        authUid: rootAdminUid,
        authEmail: superAdminEmail,
        createdByName: 'Super Admin',
        targetId: 'custom_admin_uid',
        confirmation: 'ELIMINAR customadmin@test.com',
        db: db as any,
        auth: auth as any,
        FieldValue: null,
      })
    ).rejects.toThrow('Está estrictamente prohibido eliminar a un Administrador');
  });

  // 19 delete usuario con ciclo activo bloqueado
  it('19. delete usuario con ciclo activo bloqueado: bloquea con USER_HAS_ACTIVE_FINANCIAL_DEPENDENCIES', async () => {
    await expect(
      deleteIndividualUserCore({
        authUid: rootAdminUid,
        authEmail: superAdminEmail,
        createdByName: 'Super Admin',
        targetId: 'user_cand_1',
        confirmation: 'ELIMINAR USR-1001',
        db: db as any,
        auth: auth as any,
        FieldValue: null,
      })
    ).rejects.toThrow('USER_HAS_ACTIVE_FINANCIAL_DEPENDENCIES');
  });

  // 20 delete con reinversión activa bloqueado - PENDING, APPROVED, NEEDS_REVIEW de forma separada
  it('20. delete con reinversión activa bloqueado: prueba de forma separada y real PENDING, APPROVED y NEEDS_REVIEW', async () => {
    // Retirar del ciclo activo para aislar reinversión
    db.store.delete('cycleUserResults/res_1');
    db.store.set('monthlyCycles/2026-09', { status: 'CLOSED', operationalStatus: 'CLOSED' });

    for (const status of ['PENDING', 'APPROVED', 'NEEDS_REVIEW']) {
      db.store.set('reinvestments/reinv_1', {
        userUid: 'user_cand_1',
        cycleId: '2026-09',
        status,
      });

      await expect(
        deleteIndividualUserCore({
          authUid: rootAdminUid,
          authEmail: superAdminEmail,
          createdByName: 'Super Admin',
          targetId: 'user_cand_1',
          confirmation: 'ELIMINAR USR-1001',
          db: db as any,
          auth: auth as any,
          FieldValue: null,
        })
      ).rejects.toThrow('USER_HAS_ACTIVE_FINANCIAL_DEPENDENCIES');
    }
  });

  // DELETE_PREPARING_PROVISIONAL_ENTRY_TESTS
  it('20A. delete PREPARING con capital positivo permitido antes de START', async () => {
    const uid = 'user_preparing_delete';
    const cycleId = 'cyc_delete_preparing';

    auth.addUser({
      uid,
      email: 'preparing-delete@test.com',
    });

    db.store.set('settings/global_config', {
      operationalCycleId: null,
      activeCycleId: null,
      preparingCycleId: cycleId,
    });

    db.store.set(`monthlyCycles/${cycleId}`, {
      id: cycleId,
      cycleId,
      status: 'OPEN',
      operationalStatus: 'PREPARING',
    });

    db.store.set(`users/${uid}`, {
      uid,
      userCode: 'USR-PREP-DELETE',
      email: 'preparing-delete@test.com',
      role: 'USER',
      status: 'ACTIVE',
      currentCapital: 8_000_000,
      baseCapital: 8_000_000,
      entryCycleId: cycleId,
    });

    const res = await deleteIndividualUserCore({
      authUid: rootAdminUid,
      authEmail: superAdminEmail,
      createdByName: 'Super Admin',
      targetId: uid,
      confirmation: 'ELIMINAR USR-PREP-DELETE',
      db: db as any,
      auth: auth as any,
      FieldValue: null,
    });

    expect(res.success).toBe(true);
    expect(res.authDeleted).toBe(true);
    expect(res.firestoreDocDeleted).toBe(true);
    expect(auth.users.has(uid)).toBe(false);
    expect(db.store.has(`users/${uid}`)).toBe(false);

    const cycleSnap = await db
      .collection('monthlyCycles')
      .doc(cycleId)
      .get();

    expect(cycleSnap.exists).toBe(true);
    expect(cycleSnap.data()?.operationalStatus).toBe('PREPARING');
  });

  it('20B. delete PREPARING sigue bloqueado por reinversion activa', async () => {
    const uid = 'user_preparing_reinv';
    const cycleId = 'cyc_delete_preparing_reinv';

    auth.addUser({
      uid,
      email: 'preparing-reinv@test.com',
    });

    db.store.set('settings/global_config', {
      operationalCycleId: null,
      activeCycleId: null,
      preparingCycleId: cycleId,
    });

    db.store.set(`monthlyCycles/${cycleId}`, {
      id: cycleId,
      cycleId,
      status: 'OPEN',
      operationalStatus: 'PREPARING',
    });

    db.store.set(`users/${uid}`, {
      uid,
      userCode: 'USR-PREP-REINV',
      email: 'preparing-reinv@test.com',
      role: 'USER',
      status: 'ACTIVE',
      currentCapital: 8_000_000,
      entryCycleId: cycleId,
    });

    db.store.set('reinvestments/reinv_preparing_block', {
      id: 'reinv_preparing_block',
      userUid: uid,
      userId: uid,
      targetCycleId: cycleId,
      status: 'PENDING',
    });

    await expect(
      deleteIndividualUserCore({
        authUid: rootAdminUid,
        authEmail: superAdminEmail,
        createdByName: 'Super Admin',
        targetId: uid,
        confirmation: 'ELIMINAR USR-PREP-REINV',
        db: db as any,
        auth: auth as any,
        FieldValue: null,
      })
    ).rejects.toThrow('USER_HAS_ACTIVE_FINANCIAL_DEPENDENCIES');

    expect(auth.users.has(uid)).toBe(true);
    expect(db.store.has(`users/${uid}`)).toBe(true);
  });

  it('20C. delete no permite excepcion si el ciclo ya esta STARTED', async () => {
    const uid = 'user_started_delete_block';
    const cycleId = 'cyc_delete_started';

    auth.addUser({
      uid,
      email: 'started-delete@test.com',
    });

    db.store.set('settings/global_config', {
      operationalCycleId: cycleId,
      activeCycleId: cycleId,
      preparingCycleId: cycleId,
    });

    db.store.set(`monthlyCycles/${cycleId}`, {
      id: cycleId,
      cycleId,
      status: 'OPEN',
      operationalStatus: 'STARTED',
    });

    db.store.set(`users/${uid}`, {
      uid,
      userCode: 'USR-STARTED-BLOCK',
      email: 'started-delete@test.com',
      role: 'USER',
      status: 'ACTIVE',
      currentCapital: 8_000_000,
      entryCycleId: cycleId,
    });

    await expect(
      deleteIndividualUserCore({
        authUid: rootAdminUid,
        authEmail: superAdminEmail,
        createdByName: 'Super Admin',
        targetId: uid,
        confirmation: 'ELIMINAR USR-STARTED-BLOCK',
        db: db as any,
        auth: auth as any,
        FieldValue: null,
      })
    ).rejects.toThrow('USER_HAS_ACTIVE_FINANCIAL_DEPENDENCIES');

    expect(auth.users.has(uid)).toBe(true);
    expect(db.store.has(`users/${uid}`)).toBe(true);
  });

  it('20D. delete falla cerrado si entryCycleId apunta a PREPARING inexistente', async () => {
    const uid = 'user_missing_preparing';
    const cycleId = 'cyc_missing_preparing';

    auth.addUser({
      uid,
      email: 'missing-preparing@test.com',
    });

    db.store.set('settings/global_config', {
      operationalCycleId: null,
      activeCycleId: null,
      preparingCycleId: cycleId,
    });

    db.store.set(`users/${uid}`, {
      uid,
      userCode: 'USR-MISSING-PREP',
      email: 'missing-preparing@test.com',
      role: 'USER',
      status: 'ACTIVE',
      currentCapital: 8_000_000,
      entryCycleId: cycleId,
    });

    await expect(
      deleteIndividualUserCore({
        authUid: rootAdminUid,
        authEmail: superAdminEmail,
        createdByName: 'Super Admin',
        targetId: uid,
        confirmation: 'ELIMINAR USR-MISSING-PREP',
        db: db as any,
        auth: auth as any,
        FieldValue: null,
      })
    ).rejects.toThrow('USER_HAS_ACTIVE_FINANCIAL_DEPENDENCIES');

    expect(auth.users.has(uid)).toBe(true);
    expect(db.store.has(`users/${uid}`)).toBe(true);
  });

  // 21 delete usuario sin dependencias permitido
  it('21. delete usuario sin dependencias permitido: elimina correctamente usuario limpio', async () => {
    auth.addUser({ uid: 'user_clean_3', email: 'clean3@test.com' });
    db.store.set('users/user_clean_3', { uid: 'user_clean_3', userCode: 'USR-1003', email: 'clean3@test.com', role: 'USER' });

    const res = await deleteIndividualUserCore({
      authUid: rootAdminUid,
      authEmail: superAdminEmail,
      createdByName: 'Super Admin',
      targetId: 'user_clean_3',
      confirmation: 'ELIMINAR USR-1003',
      db: db as any,
      auth: auth as any,
      FieldValue: null,
    });

    expect(res.success).toBe(true);
    expect(res.authDeleted).toBe(true);
    expect(res.firestoreDocDeleted).toBe(true);
    expect(auth.users.has('user_clean_3')).toBe(false);
    expect(db.store.has('users/user_clean_3')).toBe(false);
  });

  // 22 histórico CLOSED preservado
  it('22. histórico CLOSED preservado: al borrar usuario, registros en ciclos CLOSED se conservan', async () => {
    auth.addUser({ uid: 'user_hist_4', email: 'hist4@test.com' });
    db.store.set('users/user_hist_4', { uid: 'user_hist_4', userCode: 'USR-1004', email: 'hist4@test.com', role: 'USER' });

    db.store.set('monthlyCycles/2026-08', { status: 'CLOSED', operationalStatus: 'CLOSED' });
    db.store.set('cycleUserResults/res_hist_4', { cycleId: '2026-08', userUid: 'user_hist_4', profitCop: 800000 });
    db.store.set('reinvestments/reinv_hist_4', { cycleId: '2026-08', userUid: 'user_hist_4', status: 'APPLIED' });
    db.store.set('dailyOperations/op_closed', { cycleId: '2026-08', authorizedUids: ['user_hist_4'] });

    const res = await deleteIndividualUserCore({
      authUid: rootAdminUid,
      authEmail: superAdminEmail,
      createdByName: 'Super Admin',
      targetId: 'user_hist_4',
      confirmation: 'ELIMINAR USR-1004',
      db: db as any,
      auth: auth as any,
      FieldValue: null,
    });

    expect(res.success).toBe(true);
    expect(res.preservedHistoricalRecords.cycleUserResults).toBe(1);
    expect(res.preservedHistoricalRecords.reinvestments).toBe(1);
    expect(res.preservedHistoricalRecords.dailyOperations).toBe(1);

    expect(db.store.has('cycleUserResults/res_hist_4')).toBe(true);
    expect(db.store.has('reinvestments/reinv_hist_4')).toBe(true);
    expect(db.store.get('dailyOperations/op_closed').authorizedUids).toEqual(['user_hist_4']);
  });

  // 23 Auth + Firestore + pushTokens coherentes
  it('23. Auth + Firestore + pushTokens coherentes: borrado elimina Auth, /users y subcolección pushTokens', async () => {
    auth.addUser({ uid: 'user_tok_5', email: 'tok5@test.com' });
    db.store.set('users/user_tok_5', { uid: 'user_tok_5', userCode: 'USR-1005', email: 'tok5@test.com', role: 'USER' });
    db.store.set('users/user_tok_5/pushTokens/tok_a', { token: 'token_a' });
    db.store.set('users/user_tok_5/pushTokens/tok_b', { token: 'token_b' });

    const res = await deleteIndividualUserCore({
      authUid: rootAdminUid,
      authEmail: superAdminEmail,
      createdByName: 'Super Admin',
      targetId: 'user_tok_5',
      confirmation: 'ELIMINAR USR-1005',
      db: db as any,
      auth: auth as any,
      FieldValue: null,
    });

    expect(res.cleanedRecords.pushTokens).toBe(2);
    expect(auth.users.has('user_tok_5')).toBe(false);
    expect(db.store.has('users/user_tok_5')).toBe(false);
    expect(db.store.has('users/user_tok_5/pushTokens/tok_a')).toBe(false);
    expect(db.store.has('users/user_tok_5/pushTokens/tok_b')).toBe(false);
  });

  // 24 cero lógica mensual/calendario en el módulo real
  it('24. cero lógica mensual/calendario: el código opera sin invenciones de fechas ni meses futuros', () => {
    const coreCode = fs.readFileSync(path.resolve(__dirname, '../functions/testEnvironmentResetCore.js'), 'utf8');
    expect(coreCode).not.toMatch(/getNextCycleId/);
    expect(coreCode).not.toMatch(/getPreviousCycleId/);
    expect(coreCode).not.toMatch(/2026-10/);
    expect(coreCode).not.toMatch(/new Date\(.*getFullYear/);
  });

  // 25 error Auth real NO borra Firestore
  it('25. error Auth real NO borra Firestore: si auth.deleteUser falla (ej. network error), Firestore NO se borra', async () => {
    auth.addUser({ uid: 'user_err_6', email: 'err6@test.com' });
    db.store.set('users/user_err_6', { uid: 'user_err_6', userCode: 'USR-1006', email: 'err6@test.com', role: 'USER' });

    auth.failNextDelete = new Error('Auth service network timeout');

    await expect(
      deleteIndividualUserCore({
        authUid: rootAdminUid,
        authEmail: superAdminEmail,
        createdByName: 'Super Admin',
        targetId: 'user_err_6',
        confirmation: 'ELIMINAR USR-1006',
        db: db as any,
        auth: auth as any,
        FieldValue: null,
      })
    ).rejects.toThrow('AuthDeleteFailure');

    expect(db.store.has('users/user_err_6')).toBe(true);
  });

  // 26 audit log failure no se silencia
  it('26. audit log failure no se silencia: error al guardar auditoría se propaga', async () => {
    auth.addUser({ uid: 'user_clean_7', email: 'clean7@test.com' });
    db.store.set('users/user_clean_7', { uid: 'user_clean_7', userCode: 'USR-1007', email: 'clean7@test.com', role: 'USER' });

    db.failNextAuditAdd = new Error('Disk quota exceeded in audit collection');

    await expect(
      deleteIndividualUserCore({
        authUid: rootAdminUid,
        authEmail: superAdminEmail,
        createdByName: 'Super Admin',
        targetId: 'user_clean_7',
        confirmation: 'ELIMINAR USR-1007',
        db: db as any,
        auth: auth as any,
        FieldValue: null,
      })
    ).rejects.toThrow('AuditLogFailure');
  });

  // 27 stale preview produce cero mutaciones
  it('27. stale preview produce cero mutaciones: si el hash es stale, NINGÚN dato es mutado', async () => {
    const initialDbKeys = Array.from(db.store.keys());
    const initialAuthUsers = Array.from(auth.users.keys());

    await expect(
      executeTestEnvironmentResetCore({
        authUid: rootAdminUid,
        authEmail: superAdminEmail,
        createdByName: 'Super Admin',
        confirmation: 'REINICIAR ENTORNO DE PRUEBA',
        expectedPreviewHash: 'hash_falso',
        db: db as any,
        auth: auth as any,
        FieldValue: null,
      })
    ).rejects.toThrow('RESET_PREVIEW_STALE');

    expect(Array.from(db.store.keys())).toEqual(initialDbKeys);
    expect(Array.from(auth.users.keys())).toEqual(initialAuthUsers);
  });

  // 28 lastClosedCycleId permanece intacto
  it('28. lastClosedCycleId permanece intacto: reset total limpia active/operational pero mantiene lastClosedCycleId', async () => {
    const { previewHash } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db, auth);

    await executeTestEnvironmentResetCore({
      authUid: rootAdminUid,
      authEmail: superAdminEmail,
      createdByName: 'Super Admin',
      confirmation: 'REINICIAR ENTORNO DE PRUEBA',
      expectedPreviewHash: previewHash,
      db: db as any,
      auth: auth as any,
      FieldValue: null,
    });

    const cfg = db.store.get('settings/global_config');
    expect(cfg.lastClosedCycleId).toBe('2026-08');
    expect(cfg.operationalCycleId).toBeNull();
    expect(cfg.activeCycleId).toBeNull();
    expect(cfg.preparingCycleId).toBeNull();
  });

  // 29 todas las notificaciones se purgan en reset total del entorno
  it('29. todas las notificaciones se purgan en reset total del entorno: confirmado contenido de prueba', async () => {
    const { previewHash } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db, auth);

    await executeTestEnvironmentResetCore({
      authUid: rootAdminUid,
      authEmail: superAdminEmail,
      createdByName: 'Super Admin',
      confirmation: 'REINICIAR ENTORNO DE PRUEBA',
      expectedPreviewHash: previewHash,
      db: db as any,
      auth: auth as any,
      FieldValue: null,
    });

    expect(db.store.has('notifications/notif_admin_alert')).toBe(false);
    expect(db.store.has('notifications/notif_user_1')).toBe(false);
  });

  // 30 idempotencyKey ambigua se preserva
  it('30. idempotencyKey ambigua se preserva: clave sin vínculo explícito a ciclo/usuario eliminado permanece intacta', async () => {
    const { previewHash } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db, auth);

    await executeTestEnvironmentResetCore({
      authUid: rootAdminUid,
      authEmail: superAdminEmail,
      createdByName: 'Super Admin',
      confirmation: 'REINICIAR ENTORNO DE PRUEBA',
      expectedPreviewHash: previewHash,
      db: db as any,
      auth: auth as any,
      FieldValue: null,
    });

    expect(db.store.has('idempotencyKeys/unknown_standalone_key')).toBe(true);
    expect(db.store.has('idempotencyKeys/create_next_req_test_1')).toBe(false);
  });

  // 31 total reset: error Auth real deja /users intacto
  it('31. total reset: error Auth real deja /users intacto', async () => {
    const { previewHash } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db, auth);

    // Simular error de red en Firebase Auth al intentar borrar usuarios
    auth.failNextDelete = Object.assign(new Error('Firebase Auth connection failure'), { code: 'auth/internal-error' });

    const result = await executeTestEnvironmentResetCore({
      authUid: rootAdminUid,
      authEmail: superAdminEmail,
      createdByName: 'Super Admin',
      confirmation: 'REINICIAR ENTORNO DE PRUEBA',
      expectedPreviewHash: previewHash,
      db: db as any,
      auth: auth as any,
      FieldValue: null,
    });

    expect(result.success).toBe(false);
    expect(result.partialFailure).toBe(true);
    expect(result.stage).toBe('AUTH_DELETE');
    expect(result.firestoreUsersDeleted).toBe(0);

    // /users permanece intacto
    expect(db.store.has('users/user_cand_1')).toBe(true);
    expect(db.store.has('users/user_cand_2')).toBe(true);
  });

  // 32 total reset: error Auth evita borrar ciclos/datos financieros
  it('32. total reset: error Auth evita borrar ciclos/datos financieros', async () => {
    const { previewHash } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db, auth);

    auth.failNextDelete = Object.assign(new Error('Network error on Auth'), { code: 'auth/network-request-failed' });

    const result = await executeTestEnvironmentResetCore({
      authUid: rootAdminUid,
      authEmail: superAdminEmail,
      createdByName: 'Super Admin',
      confirmation: 'REINICIAR ENTORNO DE PRUEBA',
      expectedPreviewHash: previewHash,
      db: db as any,
      auth: auth as any,
      FieldValue: null,
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe('AUTH_DELETE');

    // Ningún dato financiero o ciclo fue tocado
    expect(db.store.has('monthlyCycles/2026-09')).toBe(true);
    expect(db.store.has('cycleUserResults/res_1')).toBe(true);
    expect(db.store.has('reinvestments/reinv_1')).toBe(true);
    expect(db.store.has('disbursements/disb_1')).toBe(true);
  });

  // 33 build plan falla si falla lectura notifications
  it('33. build plan falla si falla lectura notifications', async () => {
    db.failGetForCollection['notifications'] = new Error('Read error in notifications collection');

    await expect(
      buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any)
    ).rejects.toThrow('[FAIL_CLOSED] Error al leer colección notifications');
  });

  // 34 build plan falla si falla lectura idempotencyKeys
  it('34. build plan falla si falla lectura idempotencyKeys', async () => {
    db.failGetForCollection['idempotencyKeys'] = new Error('Read timeout in idempotencyKeys collection');

    await expect(
      buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any)
    ).rejects.toThrow('[FAIL_CLOSED] Error al leer colección idempotencyKeys');
  });

  // 35 delete user falla cerrado si query reinvestments falla
  it('35. delete user falla cerrado si query reinvestments falla', async () => {
    db.failGetForCollection['reinvestments'] = new Error('Database query failure on reinvestments');

    await expect(
      deleteIndividualUserCore({
        authUid: rootAdminUid,
        authEmail: superAdminEmail,
        createdByName: 'Super Admin',
        targetId: 'user_cand_1',
        confirmation: 'ELIMINAR USR-1001',
        db: db as any,
        auth: auth as any,
        FieldValue: null,
      })
    ).rejects.toThrow('[FAIL_CLOSED] Error al consultar reinvestments');
  });

  // 36 delete user bloquea externalFundingStatus=PENDING
  it('36. delete user bloquea externalFundingStatus=PENDING', async () => {
    db.store.delete('cycleUserResults/res_1');
    db.store.delete('reinvestments/reinv_1');
    db.store.delete('disbursements/disb_1');
    db.store.set('monthlyCycles/2026-09', { status: 'CLOSED', operationalStatus: 'CLOSED' });

    // Configurar externalFundingStatus en el usuario
    db.store.set('users/user_cand_1', {
      uid: 'user_cand_1',
      userCode: 'USR-1001',
      email: 'candidate1@test.com',
      role: 'USER',
      externalFundingStatus: 'PENDING',
    });

    await expect(
      deleteIndividualUserCore({
        authUid: rootAdminUid,
        authEmail: superAdminEmail,
        createdByName: 'Super Admin',
        targetId: 'user_cand_1',
        confirmation: 'ELIMINAR USR-1001',
        db: db as any,
        auth: auth as any,
        FieldValue: null,
      })
    ).rejects.toThrow('USER_HAS_ACTIVE_FINANCIAL_DEPENDENCIES');
  });

  // 37 delete user bloquea fundingReconciliationStatus=NEEDS_REVIEW
  it('37. delete user bloquea fundingReconciliationStatus=NEEDS_REVIEW', async () => {
    db.store.delete('cycleUserResults/res_1');
    db.store.delete('disbursements/disb_1');
    db.store.set('monthlyCycles/2026-09', { status: 'CLOSED', operationalStatus: 'CLOSED' });

    // Reinversión con fundingReconciliationStatus === NEEDS_REVIEW aunque status sea APPLIED
    db.store.set('reinvestments/reinv_1', {
      userUid: 'user_cand_1',
      cycleId: '2026-09',
      status: 'APPLIED',
      fundingReconciliationStatus: 'NEEDS_REVIEW',
    });

    await expect(
      deleteIndividualUserCore({
        authUid: rootAdminUid,
        authEmail: superAdminEmail,
        createdByName: 'Super Admin',
        targetId: 'user_cand_1',
        confirmation: 'ELIMINAR USR-1001',
        db: db as any,
        auth: auth as any,
        FieldValue: null,
      })
    ).rejects.toThrow('USER_HAS_ACTIVE_FINANCIAL_DEPENDENCIES');
  });

  // 38 hash usa path completo para recursos anidados
  it('38. hash usa path completo para recursos anidados', () => {
    const planA = {
      cycleReportsToDelete: [{ id: 'snap_1', path: 'cycleReports/cycle_A/versions/v1/users/snap_1' }],
    };
    const planB = {
      cycleReportsToDelete: [{ id: 'snap_1', path: 'cycleReports/cycle_B/versions/v1/users/snap_1' }],
    };

    const hashA = computeResetPlanHash(planA as any);
    const hashB = computeResetPlanHash(planB as any);

    expect(hashA).not.toBe(hashB);
  });

  // 39 hash cambia si cambia remainingTargets de notification update
  it('39. hash cambia si cambia remainingTargets de notification update', () => {
    const planA = {
      notificationsToUpdate: [
        { path: 'notifications/notif_1', remainingTargets: ['admin_uid_1', 'admin_uid_2'] },
      ],
    };
    const planB = {
      notificationsToUpdate: [
        { path: 'notifications/notif_1', remainingTargets: ['admin_uid_1', 'admin_uid_3'] },
      ],
    };

    const hashA = computeResetPlanHash(planA as any);
    const hashB = computeResetPlanHash(planB as any);

    expect(hashA).not.toBe(hashB);
  });

  // 40 batch nunca supera 400 writes
  it('40. batch nunca supera 400 writes', async () => {
    // Generar 450 usuarios de prueba para verificar que el batch runner commitea sin exceder 400
    for (let i = 1; i <= 450; i++) {
      const uid = `bulk_user_${i}`;
      auth.addUser({ uid, email: `bulk_${i}@test.com` });
      db.store.set(`users/${uid}`, { uid, userCode: `USR-${2000 + i}`, role: 'USER' });
    }

    const { previewHash } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);

    MockBatch.maxBatchSizeObserved = 0;
    MockBatch.batchesCommittedCount = 0;

    const result = await executeTestEnvironmentResetCore({
      authUid: rootAdminUid,
      authEmail: superAdminEmail,
      createdByName: 'Super Admin',
      confirmation: 'REINICIAR ENTORNO DE PRUEBA',
      expectedPreviewHash: previewHash,
      db: db as any,
      auth: auth as any,
      FieldValue: null,
    });

    expect(result.success).toBe(true);
    expect(MockBatch.maxBatchSizeObserved).toBeLessThanOrEqual(MAX_BATCH_WRITES);
    expect(MockBatch.batchesCommittedCount).toBeGreaterThanOrEqual(2);
  });

  // 41 serializablePlan no contiene ninguna key 'ref'
  it('41. serializablePlan no contiene ninguna key ref', async () => {
    const { plan } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);
    const serializablePlan = serializeResetPlanForCallable(plan);

    const hasRefKey = (obj: any): boolean => {
      if (!obj || typeof obj !== 'object') return false;
      if (Array.isArray(obj)) return obj.some(hasRefKey);
      for (const [key, val] of Object.entries(obj)) {
        if (key === 'ref') return true;
        if (hasRefKey(val)) return true;
      }
      return false;
    };

    expect(hasRefKey(plan)).toBe(true);
    expect(hasRefKey(serializablePlan)).toBe(false);
  });

  // 42 JSON.stringify(serializablePlan) no lanza error
  it('42. JSON.stringify(serializablePlan) no lanza error', async () => {
    const { plan } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);
    const serializablePlan = serializeResetPlanForCallable(plan);

    expect(() => JSON.stringify(serializablePlan)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(serializablePlan));
    expect(parsed.authUsersToDelete.length).toBe(plan.authUsersToDelete.length);
    expect(parsed.firestoreUsersToDelete.length).toBe(plan.firestoreUsersToDelete.length);
  });

  // 43 previewHash antes y después de serializar sigue siendo el mismo valor autoritativo
  it('43. previewHash antes y después de serializar sigue siendo el mismo valor autoritativo', async () => {
    const { plan, previewHash } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);

    expect(previewHash).toBeDefined();
    expect(previewHash.length).toBe(64);
    expect(computeResetPlanHash(plan)).toBe(previewHash);
  });

  // 44 buildTestEnvironmentResetPlan mantiene sus refs internas para ejecución
  it('44. buildTestEnvironmentResetPlan mantiene sus refs internas para ejecución', async () => {
    const { plan, previewHash } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);

    const hasInternalRefs =
      plan.dailyOperationsToDelete.some((op: any) => op.ref !== undefined) ||
      plan.monthlyCyclesToDelete.some((c: any) => c.ref !== undefined) ||
      plan.reinvestmentsToDelete.some((r: any) => r.ref !== undefined);

    expect(hasInternalRefs).toBe(true);

    const result = await executeTestEnvironmentResetCore({
      authUid: rootAdminUid,
      authEmail: superAdminEmail,
      createdByName: 'Super Admin',
      confirmation: 'REINICIAR ENTORNO DE PRUEBA',
      expectedPreviewHash: previewHash,
      db: db as any,
      auth: auth as any,
      FieldValue: null,
    });

    expect(result.success).toBe(true);
  });

  // 45 (A, B, C): Todas las notifications del fixture aparecen en notificationsToDelete, preserved y toUpdate vacíos
  it('45. notifications del fixture van 100% a notificationsToDelete, preservedNotifications y notificationsToUpdate vacíos', async () => {
    const { plan } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);

    const deletedIds = plan.notificationsToDelete.map((n: any) => n.id);
    expect(deletedIds).toContain('notif_user_1');
    expect(deletedIds).toContain('notif_admin_alert');
    expect(plan.notificationsToDelete.length).toBe(2);
    expect(plan.preservedNotifications).toEqual([]);
    expect(plan.notificationsToUpdate).toEqual([]);
  });

  // 46 (D, E): Todas las investorApplications aparecen en investorApplicationsToDelete, preservedApplications vacío
  it('46. investorApplications van 100% a investorApplicationsToDelete, preservedApplications vacío', async () => {
    db.store.set('investorApplications/app_1', { email: 'applicant1@test.com', status: 'PENDING' });
    db.store.set('investorApplications/app_2_legacy', { email: 'old_legacy@test.com', userId: 'old_uid_99' });

    const { plan } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);

    const deletedAppIds = plan.investorApplicationsToDelete.map((a: any) => a.id);
    expect(deletedAppIds).toContain('app_1');
    expect(deletedAppIds).toContain('app_2_legacy');
    expect(plan.preservedApplications).toEqual([]);
  });

  // 47 (F): Los administradores siguen protegidos
  it('47. los administradores y sus documentos siguen estrictamente protegidos', async () => {
    const { plan } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);

    const authCandidateUids = plan.authUsersToDelete.map((u: any) => u.uid);
    const fsCandidateIds = plan.firestoreUsersToDelete.map((u: any) => u.id);

    expect(authCandidateUids).not.toContain(rootAdminUid);
    expect(authCandidateUids).not.toContain('secondary_superadmin_uid');
    expect(authCandidateUids).not.toContain('custom_admin_uid');

    expect(fsCandidateIds).not.toContain(rootAdminUid);
    expect(fsCandidateIds).not.toContain('secondary_superadmin_uid');
    expect(fsCandidateIds).not.toContain('custom_admin_uid');
    expect(plan.protectedCount).toBeGreaterThanOrEqual(3);
  });

  // 48 (G): auditLogs no forman parte del plan destructivo
  it('48. auditLogs no forman parte de ninguna lista de borrado y se preservan', async () => {
    db.store.set('auditLogs/historical_log_system', { action: 'SYSTEM_BOOT', timestamp: '2026-08-01' });

    const { plan, previewHash } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);

    const planKeys = Object.keys(plan);
    for (const key of planKeys) {
      if (Array.isArray((plan as any)[key])) {
        const items = (plan as any)[key];
        for (const item of items) {
          if (typeof item === 'object' && item.path) {
            expect(item.path.startsWith('auditLogs/')).toBe(false);
          }
        }
      }
    }

    await executeTestEnvironmentResetCore({
      authUid: rootAdminUid,
      authEmail: superAdminEmail,
      createdByName: 'Super Admin',
      confirmation: 'REINICIAR ENTORNO DE PRUEBA',
      expectedPreviewHash: previewHash,
      db: db as any,
      auth: auth as any,
      FieldValue: null,
    });

    expect(db.store.has('auditLogs/historical_log_system')).toBe(true);
  });

  // 49 (H): counterPreserved === true
  it('49. counterPreserved === true y counters/users no es mutado', async () => {
    db.store.set('counters/users', { nextCodeNumber: 1042 });

    const { plan, previewHash } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);
    expect(plan.counterPreserved).toBe(true);
    expect(plan.counterTargetDoc).toBeNull();

    await executeTestEnvironmentResetCore({
      authUid: rootAdminUid,
      authEmail: superAdminEmail,
      createdByName: 'Super Admin',
      confirmation: 'REINICIAR ENTORNO DE PRUEBA',
      expectedPreviewHash: previewHash,
      db: db as any,
      auth: auth as any,
      FieldValue: null,
    });

    const counterDoc = db.store.get('counters/users');
    expect(counterDoc.nextCodeNumber).toBe(1042);
  });

  // 50 (I): previewHash cambia si cambia el conjunto de notifications o investorApplications
  it('50. previewHash cambia determinísticamente si cambia el conjunto de notifications o investorApplications', async () => {
    const resBase = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);

    // Agregar nueva notificación
    db.store.set('notifications/notif_extra_99', { title: 'Extra' });
    const resWithNotif = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);
    expect(resWithNotif.previewHash).not.toBe(resBase.previewHash);

    // Agregar nueva aplicación
    db.store.set('investorApplications/app_extra_99', { email: 'extra@test.com' });
    const resWithApp = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);
    expect(resWithApp.previewHash).not.toBe(resWithNotif.previewHash);
  });

  // 51 (J): Reset utiliza batches <= 400 y ejecuta de forma atómica y completa
  it('51. reset total con nueva política de notificaciones y postulaciones ejecuta en batches <= 400', async () => {
    db.store.set('investorApplications/app_bulk_1', { email: 'app1@test.com' });
    db.store.set('investorApplications/app_bulk_2', { email: 'app2@test.com' });

    const { previewHash } = await buildTestEnvironmentResetPlan(rootAdminUid, superAdminEmail, db as any, auth as any);

    MockBatch.maxBatchSizeObserved = 0;

    const result = await executeTestEnvironmentResetCore({
      authUid: rootAdminUid,
      authEmail: superAdminEmail,
      createdByName: 'Super Admin',
      confirmation: 'REINICIAR ENTORNO DE PRUEBA',
      expectedPreviewHash: previewHash,
      db: db as any,
      auth: auth as any,
      FieldValue: null,
    });

    expect(result.success).toBe(true);
    expect(result.notificationsDeleted).toBe(2);
    expect(result.notificationsUpdated).toBe(0);
    expect(result.investorApplicationsDeleted).toBe(2);
    expect(MockBatch.maxBatchSizeObserved).toBeLessThanOrEqual(MAX_BATCH_WRITES);
  });
});
