import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest';
import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let testEnv: RulesTestEnvironment | null = null;

const PROJECT_ID = 'easytraders-rules-test';
const RULES_PATH = resolve(__dirname, '../firestore.rules');

beforeAll(async () => {
  const rules = readFileSync(RULES_PATH, 'utf8');
  try {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules,
        host: '127.0.0.1',
        port: 8080,
      },
    });
  } catch (err) {
    console.warn('Firestore emulator not running or unreachable, skipping rule tests:', err);
    testEnv = null;
  }
});

beforeEach(async (context) => {
  if (!testEnv) {
    context.skip();
    return;
  }
  await testEnv.clearFirestore();
  // Configurar datos base de perfiles
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.collection('users').doc('user_a_uid').set({
      id: 'user_a_uid',
      uid: 'user_a_uid',
      userCode: 'ET-1001',
      fullName: 'Inversionista A',
      email: 'usera@easytraders24.app',
      role: 'USER',
      status: 'ACTIVE',
    });
    await db.collection('users').doc('user_b_uid').set({
      id: 'user_b_uid',
      uid: 'user_b_uid',
      userCode: 'ET-1002',
      fullName: 'Inversionista B',
      email: 'userb@easytraders24.app',
      role: 'USER',
      status: 'ACTIVE',
    });
    await db.collection('users').doc('user_inactive_uid').set({
      id: 'user_inactive_uid',
      uid: 'user_inactive_uid',
      userCode: 'ET-1003',
      fullName: 'Inversionista Inactivo',
      email: 'inactive@easytraders24.app',
      role: 'USER',
      status: 'INACTIVE',
    });
    await db.collection('users').doc('admin_uid').set({
      id: 'admin_uid',
      uid: 'admin_uid',
      userCode: 'ADMIN-01',
      fullName: 'Administrador Principal',
      email: 'admin@easytraders24.app',
      role: 'ADMIN',
      status: 'ACTIVE',
    });
  });
});

afterAll(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

describe('Firestore Rules Security Suite (SEC-01 a SEC-30)', () => {
  // SEC-01
  it('SEC-01: Usuario anÃ³nimo intenta leer /users -> DENIED', async () => {
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(unauthDb.collection('users').get());
  });

  // SEC-02
  it('SEC-02: USER_A lee su propio perfil /users/user_a_uid -> PASS', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertSucceeds(userADb.collection('users').doc('user_a_uid').get());
  });

  // SEC-03
  it('SEC-03: USER_A intenta leer el perfil de USER_B /users/user_b_uid -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(userADb.collection('users').doc('user_b_uid').get());
  });

  // SEC-04
  it('SEC-04: ADMIN lee cualquier perfil de usuario -> PASS', async () => {
    const adminDb = testEnv.authenticatedContext('admin_uid', { role: 'admin' }).firestore();
    await assertSucceeds(adminDb.collection('users').doc('user_a_uid').get());
  });

  // SEC-05
  it('SEC-05: USER_A lee operaciÃ³n diaria donde estÃ¡ autorizado -> PASS', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection('dailyOperations').doc('op_1').set({
        authorizedUids: ['user_a_uid'],
        isPublicToActiveUsers: false,
      });
    });
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertSucceeds(userADb.collection('dailyOperations').doc('op_1').get());
  });

  // SEC-06
  it('SEC-06: USER_B intenta leer operaciÃ³n privada de USER_A -> DENIED', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection('dailyOperations').doc('op_1').set({
        authorizedUids: ['user_a_uid'],
        isPublicToActiveUsers: false,
      });
    });
    const userBDb = testEnv.authenticatedContext('user_b_uid').firestore();
    await assertFails(userBDb.collection('dailyOperations').doc('op_1').get());
  });

  // SEC-07
  it('SEC-07: USER_A intenta crear operaciÃ³n diaria directa -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('dailyOperations').doc('op_2').set({
        amountUsd: 100,
        cycleId: '2026-08',
      })
    );
  });

  // SEC-08
  it('SEC-08: ADMIN desde Client SDK intenta crear operaciÃ³n diaria directa -> DENIED', async () => {
    const adminDb = testEnv.authenticatedContext('admin_uid', { role: 'admin' }).firestore();
    await assertFails(
      adminDb.collection('dailyOperations').doc('op_admin_direct').set({
        amountUsd: 500,
      })
    );
  });

  // SEC-09
  it('SEC-09: USER_A lee sus propias reinversiones -> PASS', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection('reinvestments').doc('reinv_1').set({
        userUid: 'user_a_uid',
      });
    });
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertSucceeds(userADb.collection('reinvestments').doc('reinv_1').get());
  });

  // SEC-10
  it('SEC-10: USER_B intenta leer reinversiÃ³n de USER_A -> DENIED', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection('reinvestments').doc('reinv_1').set({
        userUid: 'user_a_uid',
      });
    });
    const userBDb = testEnv.authenticatedContext('user_b_uid').firestore();
    await assertFails(userBDb.collection('reinvestments').doc('reinv_1').get());
  });

  // SEC-11
  it('SEC-11: USER_A intenta crear reinversiÃ³n directa por Client SDK -> DENIED (Backend-authoritative only)', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('reinvestments').doc('reinv_valid').set({
        id: 'reinv_valid',
        userId: 'user_a_uid',
        userUid: 'user_a_uid',
        userCode: 'ET-1001',
        userName: 'Inversionista A',
        sourceCycleId: '2026-08',
        availableProfitCop: 1000000,
        reinvestAmountCop: 500000,
        withdrawAmountCop: 500000,
        newCapitalTargetCop: 8500000,
        newCategoryTarget: 'AMARILLA',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        resolvedBy: null,
        notes: 'ReinversiÃ³n mensual',
      })
    );
  });

  // SEC-12
  it('SEC-12: USER_A intenta crear reinversiÃ³n con status APPROVED -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('reinvestments').doc('reinv_bypass').set({
        id: 'reinv_bypass',
        userId: 'user_a_uid',
        userUid: 'user_a_uid',
        userCode: 'ET-1001',
        userName: 'Inversionista A',
        sourceCycleId: '2026-08',
        status: 'APPROVED',
        createdAt: new Date().toISOString(),
      })
    );
  });

  // SEC-13
  it('SEC-13: USER_A intenta crear reinversiÃ³n con userUid de USER_B -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('reinvestments').doc('reinv_fake_uid').set({
        id: 'reinv_fake_uid',
        userId: 'user_b_uid',
        userUid: 'user_b_uid',
        userCode: 'ET-1002',
        userName: 'Inversionista B',
        sourceCycleId: '2026-08',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      })
    );
  });

  // SEC-14
  it('SEC-14: USER_A no puede crear desembolso directamente -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('disbursements').doc('disb_valid').set({
        id: 'disb_valid',
        userId: 'user_a_uid',
        userUid: 'user_a_uid',
        userCode: 'ET-1001',
        userName: 'Inversionista A',
        sourceCycleId: '2026-08',
        amountCop: 300000,
        disbursementSource: 'PROFIT',
        method: 'TRANSFERENCIA',
        bankName: 'Bancolombia',
        accountType: 'Ahorros',
        accountNumber: '123456789',
        accountHolderName: 'Inversionista A',
        idDocument: '1098765432',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        resolvedBy: null,
        notes: 'Solicitud retiro',
      })
    );
  });

  // SEC-15
  it('SEC-15: USER_A crea desembolso con campos administrativos (paidAt) -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('disbursements').doc('disb_admin_field').set({
        id: 'disb_admin_field',
        userId: 'user_a_uid',
        userUid: 'user_a_uid',
        userCode: 'ET-1001',
        userName: 'Inversionista A',
        sourceCycleId: '2026-08',
        amountCop: 300000,
        method: 'TRANSFERENCIA',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        paidAt: new Date().toISOString(), // Prohibido en creaciÃ³n
      })
    );
  });

  // SEC-16
  it('SEC-16: USER_A marca como leÃ­da su notificaciÃ³n (solo isRead y readAt) -> PASS', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection('notifications').doc('notif_a').set({
        userUid: 'user_a_uid',
        title: 'Hola A',
        message: 'Mensaje de prueba',
        isRead: false,
        readAt: null,
      });
    });
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertSucceeds(
      userADb.collection('notifications').doc('notif_a').update({
        isRead: true,
        readAt: new Date().toISOString(),
      })
    );
  });

  // SEC-17
  it('SEC-17: USER_A intenta modificar el tÃ­tulo de una notificaciÃ³n -> DENIED', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection('notifications').doc('notif_a').set({
        userUid: 'user_a_uid',
        title: 'Hola A',
        isRead: false,
      });
    });
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('notifications').doc('notif_a').update({
        title: 'TÃ­tulo Modificado Maliciosamente',
      })
    );
  });

  // SEC-18
  it('SEC-18: USER_A intenta leer /auditLogs -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(userADb.collection('auditLogs').get());
  });

  // SEC-19
  it('SEC-19: USER_A intenta modificar su propio perfil /users/user_a_uid -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('users').doc('user_a_uid').update({
        userPercentage: 100,
      })
    );
  });

  // SEC-20
  it('SEC-20: ADMIN intenta crear dailyOperation por Client SDK -> DENIED', async () => {
    const adminDb = testEnv.authenticatedContext('admin_uid', { role: 'admin' }).firestore();
    await assertFails(
      adminDb.collection('dailyOperations').add({
        amountUsd: 100,
      })
    );
  });

  // SEC-21
  it('SEC-21: ADMIN intenta modificar un auditLog por Client SDK -> DENIED', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection('auditLogs').doc('log_1').set({
        action: 'TEST',
      });
    });
    const adminDb = testEnv.authenticatedContext('admin_uid', { role: 'admin' }).firestore();
    await assertFails(
      adminDb.collection('auditLogs').doc('log_1').update({
        action: 'ALTERED',
      })
    );
  });

  // SEC-22
  it('SEC-22: USER_A crea reinversiÃ³n con campo extra arbitrario -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('reinvestments').doc('reinv_extra').set({
        id: 'reinv_extra',
        userId: 'user_a_uid',
        userUid: 'user_a_uid',
        userCode: 'ET-1001',
        userName: 'Inversionista A',
        sourceCycleId: '2026-08',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        campoInyectadoArbitrario: 'HACK',
      })
    );
  });

  // SEC-23
  it('SEC-23: USER_A crea desembolso con campo extra arbitrario -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('disbursements').doc('disb_extra').set({
        id: 'disb_extra',
        userId: 'user_a_uid',
        userUid: 'user_a_uid',
        userCode: 'ET-1001',
        userName: 'Inversionista A',
        sourceCycleId: '2026-08',
        amountCop: 500000,
        method: 'TRANSFERENCIA',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        campoExtraProhibido: true,
      })
    );
  });

  // SEC-24
  it('SEC-24: USER_A crea investment con status APPROVED -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('investments').doc('inv_app').set({
        id: 'inv_app',
        userId: 'user_a_uid',
        userUid: 'user_a_uid',
        userCode: 'ET-1001',
        userName: 'Inversionista A',
        requestedAmountCop: 10000000,
        paymentMethod: 'Bancolombia',
        status: 'APPROVED',
        createdAt: new Date().toISOString(),
      })
    );
  });

  // SEC-25
  it('SEC-25: USER_A crea reinversiÃ³n con userUid de A pero userId de USER_B -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('reinvestments').doc('reinv_mismatch_id').set({
        id: 'reinv_mismatch_id',
        userId: 'user_b_uid', // Mismatch con userADb auth.uid
        userUid: 'user_a_uid',
        userCode: 'ET-1001',
        userName: 'Inversionista A',
        sourceCycleId: '2026-08',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      })
    );
  });

  // SEC-26
  it('SEC-26: USER_A crea reinversiÃ³n con userCode falso ("ET-9999") -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('reinvestments').doc('reinv_fake_code').set({
        id: 'reinv_fake_code',
        userId: 'user_a_uid',
        userUid: 'user_a_uid',
        userCode: 'ET-9999', // Mismatch con perfil real "ET-1001"
        userName: 'Inversionista A',
        sourceCycleId: '2026-08',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      })
    );
  });

  // SEC-27
  it('SEC-27: USER_A crea desembolso con userName de otro usuario -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('disbursements').doc('disb_fake_name').set({
        id: 'disb_fake_name',
        userId: 'user_a_uid',
        userUid: 'user_a_uid',
        userCode: 'ET-1001',
        userName: 'Inversionista B Falso', // Mismatch con "Inversionista A"
        sourceCycleId: '2026-08',
        amountCop: 200000,
        method: 'EFECTIVO',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      })
    );
  });

  // SEC-28
  it('SEC-28: USER_A intenta establecer queuePosition en investment -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('investments').doc('inv_queue_hack').set({
        id: 'inv_queue_hack',
        userId: 'user_a_uid',
        userUid: 'user_a_uid',
        userCode: 'ET-1001',
        userName: 'Inversionista A',
        requestedAmountCop: 5000000,
        paymentMethod: 'Bancolombia',
        status: 'PENDING',
        queuePosition: 1, // Eliminado de whitelist USER
        createdAt: new Date().toISOString(),
      })
    );
  });

  // SEC-29
  it('SEC-29: ADMIN intenta create directo en /users desde Client SDK -> DENIED', async () => {
    const adminDb = testEnv.authenticatedContext('admin_uid', { role: 'admin' }).firestore();
    await assertFails(
      adminDb.collection('users').doc('new_user_direct').set({
        fullName: 'Nuevo Usuario Directo',
        email: 'nuevo@easytraders24.app',
      })
    );
  });

  // SEC-30
  it('SEC-30: ADMIN intenta delete directo en /users/{uid} -> DENIED', async () => {
    const adminDb = testEnv.authenticatedContext('admin_uid', { role: 'admin' }).firestore();
    await assertFails(
      adminDb.collection('users').doc('user_b_uid').delete()
    );
  });
});

describe('Hardening Rules Test Suite: monthlyCycles & reinvestments (RULE-01 a RULE-11)', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.collection('monthlyCycles').doc('cycle_2026_08').set({
        id: 'cycle_2026_08',
        cycleId: 'cycle_2026_08',
        name: 'Ciclo Agosto 2026',
        status: 'OPEN',
        trmApplied: 4100,
        isClosing: false,
        closingStartedAt: null,
        closingByUid: null,
        closingByName: null,
        closureAttemptId: null,
        closedAt: null,
        closedBy: null,
        closedByUid: null,
        appliedReinvestmentsCount: 0,
        openedAt: new Date().toISOString(),
      });
      await db.collection('reinvestments').doc('reinv_user_a').set({
        id: 'reinv_user_a',
        userUid: 'user_a_uid',
        userId: 'user_a_uid',
        sourceCycleId: 'cycle_2026_08',
        status: 'PENDING',
      });
      await db.collection('reinvestments').doc('reinv_user_b').set({
        id: 'reinv_user_b',
        userUid: 'user_b_uid',
        userId: 'user_b_uid',
        sourceCycleId: 'cycle_2026_08',
        status: 'PENDING',
      });
    });
  });

  // TEST RULE-01
  it('TEST RULE-01: USER intenta monthlyCycles/{cycleId} status = CLOSED -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('monthlyCycles').doc('cycle_2026_08').update({
        status: 'CLOSED',
      })
    );
  });

  // TEST RULE-02
  it('TEST RULE-02: ADMIN cliente intenta status = CLOSED -> DENIED', async () => {
    const adminDb = testEnv.authenticatedContext('admin_uid', { role: 'admin' }).firestore();
    await assertFails(
      adminDb.collection('monthlyCycles').doc('cycle_2026_08').update({
        status: 'CLOSED',
      })
    );
  });

  // TEST RULE-03
  it('TEST RULE-03: ADMIN cliente intenta isClosing = false -> DENIED', async () => {
    const adminDb = testEnv.authenticatedContext('admin_uid', { role: 'admin' }).firestore();
    await assertFails(
      adminDb.collection('monthlyCycles').doc('cycle_2026_08').update({
        isClosing: false,
      })
    );
  });

  // TEST RULE-04
  it('TEST RULE-04: ADMIN cliente intenta closureAttemptId = "otro" -> DENIED', async () => {
    const adminDb = testEnv.authenticatedContext('admin_uid', { role: 'admin' }).firestore();
    await assertFails(
      adminDb.collection('monthlyCycles').doc('cycle_2026_08').update({
        closureAttemptId: 'otro_intento_malicioso',
      })
    );
  });

  // TEST RULE-05
  it('TEST RULE-05: ADMIN modifica trmApplied sin tocar campos sensibles -> DENIED (monthlyCycles is now backend-only)', async () => {
    const adminDb = testEnv.authenticatedContext('admin_uid', { role: 'admin' }).firestore();
    await assertFails(
      adminDb.collection('monthlyCycles').doc('cycle_2026_08').update({
        trmApplied: 4150,
      })
    );
  });

  // TEST RULE-06
  it('TEST RULE-06: USER intenta modificar trmApplied -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('monthlyCycles').doc('cycle_2026_08').update({
        trmApplied: 4200,
      })
    );
  });

  // TEST RULE-07
  it('TEST RULE-07: USER intenta create/update/delete reinvestments -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('reinvestments').doc('reinv_direct_user').set({
        userUid: 'user_a_uid',
        status: 'PENDING',
      })
    );
    await assertFails(
      userADb.collection('reinvestments').doc('reinv_user_a').update({
        notes: 'Intento de update directo',
      })
    );
    await assertFails(
      userADb.collection('reinvestments').doc('reinv_user_a').delete()
    );
  });

  // TEST RULE-08
  it('TEST RULE-08: ADMIN intenta update directo reinvestments.status = APPROVED -> DENIED', async () => {
    const adminDb = testEnv.authenticatedContext('admin_uid', { role: 'admin' }).firestore();
    await assertFails(
      adminDb.collection('reinvestments').doc('reinv_user_a').update({
        status: 'APPROVED',
      })
    );
  });

  // TEST RULE-09
  it('TEST RULE-09: USER propietario lee su propia reinvestment -> ALLOWED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertSucceeds(
      userADb.collection('reinvestments').doc('reinv_user_a').get()
    );
  });

  // TEST RULE-10
  it('TEST RULE-10: USER A intenta leer reinvestment de USER B -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('reinvestments').doc('reinv_user_b').get()
    );
  });

  // TEST RULE-11: REOPEN DIRECTO
  it('TEST RULE-11: ADMIN cliente o USER intenta status = REOPENED directo -> DENIED', async () => {
    const adminDb = testEnv.authenticatedContext('admin_uid', { role: 'admin' }).firestore();
    await assertFails(
      adminDb.collection('monthlyCycles').doc('cycle_2026_08').update({
        status: 'REOPENED',
      })
    );
  });
});

describe('Phase 2D Hardening Tests: Settings, Users & Deny Total Client Writes', () => {
  // TEST RULE-12: Write to settings doc with cycle lifecycle fields -> DENIED
  it('TEST RULE-12: ADMIN intenta modificar activeCycleId en settings -> DENIED', async () => {
    const adminDb = testEnv.authenticatedContext('admin_uid', { role: 'admin' }).firestore();
    await assertFails(
      adminDb.collection('settings').doc('global_config').set({
        activeCycleId: '2026-10',
      })
    );
  });

  // TEST RULE-13: Write to settings doc with safe fields -> ALLOWED
  it('TEST RULE-13: ADMIN intenta modificar roundingRule en settings -> PASS', async () => {
    const adminDb = testEnv.authenticatedContext('admin_uid', { role: 'admin' }).firestore();
    await assertSucceeds(
      adminDb.collection('settings').doc('global_config').set({
        roundingRule: 'NEAREST',
      })
    );
  });

  // TEST RULE-14: User updates profile with allowed fields -> PASS
  it('TEST RULE-14: USER intenta actualizar su propio fullName en users -> PASS', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertSucceeds(
      userADb.collection('users').doc('user_a_uid').update({
        fullName: 'Nuevo Inversionista A',
      })
    );
  });

  // TEST RULE-15: User updates profile with unauthorized/sensitive fields -> DENIED
  it('TEST RULE-15: USER intenta actualizar su propio currentCapital en users -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('users').doc('user_a_uid').update({
        currentCapital: 9999999,
      })
    );
  });

  // TEST RULE-16: Admin updates profile with sensitive fields -> DENIED
  it('TEST RULE-16: ADMIN intenta actualizar currentCapital de usuario en users -> DENIED', async () => {
    const adminDb = testEnv.authenticatedContext('admin_uid', { role: 'admin' }).firestore();
    await assertFails(
      adminDb.collection('users').doc('user_a_uid').update({
        currentCapital: 9999999,
      })
    );
  });

  // TEST RULE-17: Client write on disbursements -> DENIED
  it('TEST RULE-17: USER o ADMIN intenta crear o modificar desembolso directo -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(
      userADb.collection('disbursements').doc('disb_direct').set({
        id: 'disb_direct',
        amountCop: 100000,
        status: 'PENDING',
      })
    );
  });

  // TEST RULE-18: Client write on cycleGroupCalculations -> DENIED
  it('TEST RULE-18: ADMIN intenta crear o modificar cycleGroupCalculations directo -> DENIED', async () => {
    const adminDb = testEnv.authenticatedContext('admin_uid', { role: 'admin' }).firestore();
    await assertFails(
      adminDb.collection('cycleGroupCalculations').doc('gc_direct').set({
        id: 'gc_direct',
        trmUsed: 4000,
      })
    );
  });

  // TEST RULE-19: Client write on cycleFinancialSummaries -> DENIED
  it('TEST RULE-19: ADMIN intenta crear o modificar cycleFinancialSummaries directo -> DENIED', async () => {
    const adminDb = testEnv.authenticatedContext('admin_uid', { role: 'admin' }).firestore();
    await assertFails(
      adminDb.collection('cycleFinancialSummaries').doc('fs_direct').set({
        id: 'fs_direct',
        totalManagedCapital: 5000000,
      })
    );
  });
});

describe('Support Module Security Rules: isSupportAgent & Status Active Hardening', () => {
  beforeEach(async (context) => {
    if (!testEnv) {
      context.skip();
      return;
    }
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();

      // Agente Activo
      await db.collection('users').doc('agent_active_uid').set({
        id: 'agent_active_uid',
        uid: 'agent_active_uid',
        userCode: 'AGT-01',
        fullName: 'Agente Activo',
        email: 'agent_active@easytraders.app',
        role: 'USER',
        status: 'ACTIVE',
        permissions: { supportAgent: true },
      });

      // Agente Suspendido
      await db.collection('users').doc('agent_suspended_uid').set({
        id: 'agent_suspended_uid',
        uid: 'agent_suspended_uid',
        userCode: 'AGT-02',
        fullName: 'Agente Suspendido',
        email: 'agent_suspended@easytraders.app',
        role: 'USER',
        status: 'SUSPENDED',
        permissions: { supportAgent: true },
      });

      // Agente Inactivo
      await db.collection('users').doc('agent_inactive_uid').set({
        id: 'agent_inactive_uid',
        uid: 'agent_inactive_uid',
        userCode: 'AGT-03',
        fullName: 'Agente Inactivo',
        email: 'agent_inactive@easytraders.app',
        role: 'USER',
        status: 'INACTIVE',
        permissions: { supportAgent: true },
      });

      // Agente Pending Claim
      await db.collection('users').doc('agent_pending_uid').set({
        id: 'agent_pending_uid',
        uid: 'agent_pending_uid',
        userCode: 'AGT-04',
        fullName: 'Agente Pendiente',
        email: 'agent_pending@easytraders.app',
        role: 'USER',
        status: 'PENDING_CLAIM',
        permissions: { supportAgent: true },
      });

      // Ticket creado por user_a_uid
      await db.collection('supportTickets').doc('ticket_1').set({
        ticketId: 'ticket_1',
        ticketNumber: 'SUP-000001',
        createdByUid: 'user_a_uid',
        status: 'OPEN',
      });

      // Nota interna en ticket_1
      await db.collection('supportTickets').doc('ticket_1').collection('internalNotes').doc('note_1').set({
        noteId: 'note_1',
        authorUid: 'admin_uid',
        noteText: 'Nota confidencial',
      });
    });
  });

  it('SEC-SUP-01: Agente ACTIVE con supportAgent=true lee ticket ajeno -> ALLOWED', async () => {
    const agentDb = testEnv.authenticatedContext('agent_active_uid').firestore();
    await assertSucceeds(agentDb.collection('supportTickets').doc('ticket_1').get());
  });

  it('SEC-SUP-02: Agente ACTIVE con supportAgent=true lee internalNotes -> ALLOWED', async () => {
    const agentDb = testEnv.authenticatedContext('agent_active_uid').firestore();
    await assertSucceeds(agentDb.collection('supportTickets').doc('ticket_1').collection('internalNotes').doc('note_1').get());
  });

  it('SEC-SUP-03: Agente SUSPENDED con supportAgent=true lee ticket ajeno -> DENIED', async () => {
    const suspendedDb = testEnv.authenticatedContext('agent_suspended_uid').firestore();
    await assertFails(suspendedDb.collection('supportTickets').doc('ticket_1').get());
  });

  it('SEC-SUP-04: Agente SUSPENDED con supportAgent=true lee internalNotes -> DENIED', async () => {
    const suspendedDb = testEnv.authenticatedContext('agent_suspended_uid').firestore();
    await assertFails(suspendedDb.collection('supportTickets').doc('ticket_1').collection('internalNotes').doc('note_1').get());
  });

  it('SEC-SUP-05: Agente INACTIVE con supportAgent=true lee internalNotes -> DENIED', async () => {
    const inactiveDb = testEnv.authenticatedContext('agent_inactive_uid').firestore();
    await assertFails(inactiveDb.collection('supportTickets').doc('ticket_1').collection('internalNotes').doc('note_1').get());
  });

  it('SEC-SUP-06: Agente PENDING_CLAIM con supportAgent=true lee internalNotes -> DENIED', async () => {
    const pendingDb = testEnv.authenticatedContext('agent_pending_uid').firestore();
    await assertFails(pendingDb.collection('supportTickets').doc('ticket_1').collection('internalNotes').doc('note_1').get());
  });

  it('SEC-SUP-07: Usuario normal dueÃ±o del ticket intenta leer internalNotes -> DENIED', async () => {
    const userADb = testEnv.authenticatedContext('user_a_uid').firestore();
    await assertFails(userADb.collection('supportTickets').doc('ticket_1').collection('internalNotes').doc('note_1').get());
  });
});
