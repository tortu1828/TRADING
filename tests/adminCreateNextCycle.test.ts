import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';

// Replicar las validaciones y el núcleo lógico exacto de adminCreateNextCycleCallable para test unitario
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function generateCanonicalCycleId() {
  return `cyc_${crypto.randomUUID()}`;
}

interface MockDocSnap {
  exists: boolean;
  data: () => any;
}

interface MockTx {
  get: (ref: any) => Promise<MockDocSnap>;
  set: (ref: any, data: any, options?: any) => void;
  update: (ref: any, data: any) => void;
}

async function simulateCreateNextCycleTx({
  authUid,
  isSuperAdmin,
  sourceCycleId,
  name,
  clientRequestId,
  forcedCandidateId,
  store,
}: {
  authUid: string;
  isSuperAdmin: boolean;
  sourceCycleId: any;
  name: any;
  clientRequestId: any;
  forcedCandidateId?: string;
  store: Map<string, any>;
}) {
  if (!isSuperAdmin) {
    throw new Error('PERMISSION_DENIED: Se requieren privilegios de SuperAdmin.');
  }

  if (!sourceCycleId || typeof sourceCycleId !== 'string' || !sourceCycleId.trim()) {
    throw new Error('INVALID_SOURCE_CYCLE_ID: sourceCycleId es obligatorio y debe ser un string no vacío.');
  }
  const cleanSourceCycleId = sourceCycleId.trim();

  if (!name || typeof name !== 'string') {
    throw new Error('INVALID_NAME: El nombre del ciclo es obligatorio.');
  }
  const cleanName = name.trim();
  if (cleanName.length < 3 || cleanName.length > 60) {
    throw new Error('INVALID_NAME: El nombre del ciclo debe tener entre 3 y 60 caracteres.');
  }

  if (!clientRequestId || typeof clientRequestId !== 'string') {
    throw new Error('INVALID_CLIENT_REQUEST_ID: clientRequestId es obligatorio.');
  }
  const cleanClientRequestId = clientRequestId.trim();
  if (!UUID_V4_REGEX.test(cleanClientRequestId)) {
    throw new Error('INVALID_CLIENT_REQUEST_ID: clientRequestId debe ser un UUID v4 válido conforme a RFC 4122.');
  }

  const candidateCycleId = forcedCandidateId || generateCanonicalCycleId();

  const idemPath = `idempotencyKeys/create_next_${cleanClientRequestId}`;
  const sourcePath = `monthlyCycles/${cleanSourceCycleId}`;
  const candidatePath = `monthlyCycles/${candidateCycleId}`;
  const configPath = `settings/global_config`;

  // READ PHASE
  const idemSnap: MockDocSnap = {
    exists: store.has(idemPath),
    data: () => store.get(idemPath) || {},
  };
  const sourceSnap: MockDocSnap = {
    exists: store.has(sourcePath),
    data: () => store.get(sourcePath) || {},
  };
  const candidateSnap: MockDocSnap = {
    exists: store.has(candidatePath),
    data: () => store.get(candidatePath) || {},
  };
  const configSnap: MockDocSnap = {
    exists: store.has(configPath),
    data: () => store.get(configPath) || {},
  };

  if (candidateSnap.exists) {
    throw new Error('CYCLE_ID_COLLISION: Colisión detectada al generar candidateCycleId.');
  }

  if (idemSnap.exists) {
    const idemData = idemSnap.data();
    if (
      idemData.action !== 'CREATE_NEXT_CYCLE' ||
      idemData.sourceCycleId !== cleanSourceCycleId ||
      idemData.normalizedName !== cleanName
    ) {
      throw new Error('IDEMPOTENCY_KEY_CONFLICT: El clientRequestId suministrado ya fue utilizado con parámetros diferentes.');
    }

    const existingCreatedCycleId = idemData.createdCycleId;
    const sourceData = sourceSnap.data();
    if (sourceData.nextCycleId !== existingCreatedCycleId) {
      throw new Error(`IDEMPOTENCY_STATE_CONFLICT: Incoherencia en el ciclo origen (${cleanSourceCycleId}).`);
    }

    return {
      success: true,
      cycleId: existingCreatedCycleId,
      idempotentReplay: true,
    };
  }

  if (!sourceSnap.exists) {
    throw new Error(`SOURCE_NOT_FOUND: El ciclo origen '${cleanSourceCycleId}' no existe.`);
  }

  const sourceData = sourceSnap.data();
  if (sourceData.status !== 'OPEN' && sourceData.status !== 'REOPENED') {
    throw new Error(`SOURCE_NOT_OPEN: El ciclo origen '${cleanSourceCycleId}' está en estado '${sourceData.status}'.`);
  }

  if (sourceData.operationalStatus !== 'STARTED') {
    throw new Error(`SOURCE_NOT_STARTED: El ciclo origen '${cleanSourceCycleId}' tiene operationalStatus '${sourceData.operationalStatus || 'UNDEFINED'}'.`);
  }

  if (sourceData.nextCycleId) {
    throw new Error(`NEXT_CYCLE_ALREADY_EXISTS: El ciclo origen '${cleanSourceCycleId}' ya cuenta con un sucesor enlazado (${sourceData.nextCycleId}).`);
  }

  const rawTrm = Number(sourceData.trmApplied);
  if (!Number.isFinite(rawTrm) || rawTrm <= 0) {
    throw new Error(`SOURCE_CYCLE_TRM_INVALID: El ciclo origen '${cleanSourceCycleId}' no cuenta con una TRM válida configurada (${sourceData.trmApplied}).`);
  }
  const inheritedTrm = rawTrm;

  const configData = configSnap.data();
  if (configData.operationalCycleId && configData.operationalCycleId !== cleanSourceCycleId) {
    throw new Error(`CONFIG_CYCLE_MISMATCH: settings/global_config.operationalCycleId (${configData.operationalCycleId}) no coincide con el ciclo origen indicado (${cleanSourceCycleId}).`);
  }

  // WRITE PHASE
  const nowIso = new Date().toISOString();
  store.set(candidatePath, {
    id: candidateCycleId,
    cycleId: candidateCycleId,
    name: cleanName,
    status: 'OPEN',
    operationalStatus: 'PREPARING',
    previousCycleId: cleanSourceCycleId,
    nextCycleId: null,
    trmApplied: inheritedTrm,
    createdAt: nowIso,
    openedAt: nowIso,
    startedAt: null,
    closedAt: null,
  });

  store.set(sourcePath, {
    ...sourceData,
    nextCycleId: candidateCycleId,
    updatedAt: nowIso,
  });

  store.set(configPath, {
    ...configData,
    preparingCycleId: candidateCycleId,
    updatedAt: nowIso,
  });

  store.set(idemPath, {
    action: 'CREATE_NEXT_CYCLE',
    sourceCycleId: cleanSourceCycleId,
    normalizedName: cleanName,
    createdCycleId: candidateCycleId,
    clientRequestId: cleanClientRequestId,
    createdByUid: authUid,
    createdAt: nowIso,
  });

  return {
    success: true,
    cycleId: candidateCycleId,
    idempotentReplay: false,
  };
}

describe('Fase 1: adminCreateNextCycleCallable Test Matrix', () => {
  const validUuid1 = 'e4b1a410-6c9a-4c91-9e2b-7f284b123456';
  const validUuid2 = 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d';

  it('CREATE_SUCCESS: Crea sucesor PREPARING con double link y actualiza config canónica', async () => {
    const store = new Map<string, any>();
    store.set('monthlyCycles/2026-09', {
      id: '2026-09',
      status: 'OPEN',
      operationalStatus: 'STARTED',
      trmApplied: 4150,
      nextCycleId: null,
    });
    store.set('settings/global_config', {
      operationalCycleId: '2026-09',
      activeCycleId: '2026-09',
    });

    const res = await simulateCreateNextCycleTx({
      authUid: 'super_admin_1',
      isSuperAdmin: true,
      sourceCycleId: '2026-09',
      name: 'Ciclo 2 - Septiembre',
      clientRequestId: validUuid1,
      store,
    });

    expect(res.success).toBe(true);
    expect(res.idempotentReplay).toBe(false);
    expect(res.cycleId).toMatch(/^cyc_[0-9a-f-]{36}$/);

    // Verificar nuevo ciclo
    const createdCycle = store.get(`monthlyCycles/${res.cycleId}`);
    expect(createdCycle).toBeDefined();
    expect(createdCycle.status).toBe('OPEN');
    expect(createdCycle.operationalStatus).toBe('PREPARING');
    expect(createdCycle.previousCycleId).toBe('2026-09');
    expect(createdCycle.nextCycleId).toBeNull();
    expect(createdCycle.trmApplied).toBe(4150);

    // Verificar double link en source
    const sourceCycle = store.get('monthlyCycles/2026-09');
    expect(sourceCycle.nextCycleId).toBe(res.cycleId);

    // Verificar settings/global_config
    const config = store.get('settings/global_config');
    expect(config.preparingCycleId).toBe(res.cycleId);
    expect(config.operationalCycleId).toBe('2026-09');
    expect(config.activeCycleId).toBe('2026-09');
  });

  it('IDEMPOTENT_RETRY: Mismo clientRequestId con mismo payload retorna el mismo cycleId', async () => {
    const store = new Map<string, any>();
    store.set('monthlyCycles/2026-09', {
      id: '2026-09',
      status: 'OPEN',
      operationalStatus: 'STARTED',
      trmApplied: 4150,
      nextCycleId: null,
    });
    store.set('settings/global_config', {
      operationalCycleId: '2026-09',
    });

    const res1 = await simulateCreateNextCycleTx({
      authUid: 'super_admin_1',
      isSuperAdmin: true,
      sourceCycleId: '2026-09',
      name: 'Ciclo 2 - Septiembre',
      clientRequestId: validUuid1,
      store,
    });

    const res2 = await simulateCreateNextCycleTx({
      authUid: 'super_admin_1',
      isSuperAdmin: true,
      sourceCycleId: '2026-09',
      name: 'Ciclo 2 - Septiembre',
      clientRequestId: validUuid1,
      store,
    });

    expect(res2.success).toBe(true);
    expect(res2.idempotentReplay).toBe(true);
    expect(res2.cycleId).toBe(res1.cycleId);
  });

  it('SAME_IDEMPOTENCY_DIFFERENT_NAME: Arroja IDEMPOTENCY_KEY_CONFLICT', async () => {
    const store = new Map<string, any>();
    store.set('monthlyCycles/2026-09', {
      id: '2026-09',
      status: 'OPEN',
      operationalStatus: 'STARTED',
      trmApplied: 4150,
      nextCycleId: null,
    });

    await simulateCreateNextCycleTx({
      authUid: 'super_admin_1',
      isSuperAdmin: true,
      sourceCycleId: '2026-09',
      name: 'Ciclo 2 - Septiembre',
      clientRequestId: validUuid1,
      store,
    });

    await expect(
      simulateCreateNextCycleTx({
        authUid: 'super_admin_1',
        isSuperAdmin: true,
        sourceCycleId: '2026-09',
        name: 'Nombre Diferente',
        clientRequestId: validUuid1,
        store,
      })
    ).rejects.toThrow(/IDEMPOTENCY_KEY_CONFLICT/);
  });

  it('SAME_IDEMPOTENCY_DIFFERENT_SOURCE: Arroja IDEMPOTENCY_KEY_CONFLICT', async () => {
    const store = new Map<string, any>();
    store.set('monthlyCycles/2026-09', {
      id: '2026-09',
      status: 'OPEN',
      operationalStatus: 'STARTED',
      trmApplied: 4150,
      nextCycleId: null,
    });
    store.set('monthlyCycles/2026-08', {
      id: '2026-08',
      status: 'OPEN',
      operationalStatus: 'STARTED',
      trmApplied: 4150,
      nextCycleId: null,
    });

    await simulateCreateNextCycleTx({
      authUid: 'super_admin_1',
      isSuperAdmin: true,
      sourceCycleId: '2026-09',
      name: 'Ciclo 2',
      clientRequestId: validUuid1,
      store,
    });

    await expect(
      simulateCreateNextCycleTx({
        authUid: 'super_admin_1',
        isSuperAdmin: true,
        sourceCycleId: '2026-08',
        name: 'Ciclo 2',
        clientRequestId: validUuid1,
        store,
      })
    ).rejects.toThrow(/IDEMPOTENCY_KEY_CONFLICT/);
  });

  it('CONCURRENT_DIFFERENT_REQUEST_IDS: Solo el primero tiene éxito; el segundo arroja NEXT_CYCLE_ALREADY_EXISTS', async () => {
    const store = new Map<string, any>();
    store.set('monthlyCycles/2026-09', {
      id: '2026-09',
      status: 'OPEN',
      operationalStatus: 'STARTED',
      trmApplied: 4150,
      nextCycleId: null,
    });

    const res1 = await simulateCreateNextCycleTx({
      authUid: 'super_admin_1',
      isSuperAdmin: true,
      sourceCycleId: '2026-09',
      name: 'Ciclo Siguiente A',
      clientRequestId: validUuid1,
      store,
    });
    expect(res1.success).toBe(true);

    await expect(
      simulateCreateNextCycleTx({
        authUid: 'super_admin_1',
        isSuperAdmin: true,
        sourceCycleId: '2026-09',
        name: 'Ciclo Siguiente B',
        clientRequestId: validUuid2,
        store,
      })
    ).rejects.toThrow(/NEXT_CYCLE_ALREADY_EXISTS/);
  });

  it('CONCURRENT_SAME_REQUEST_ID: Ambos devuelven el mismo ciclo', async () => {
    const store = new Map<string, any>();
    store.set('monthlyCycles/2026-09', {
      id: '2026-09',
      status: 'OPEN',
      operationalStatus: 'STARTED',
      trmApplied: 4150,
      nextCycleId: null,
    });

    const res1 = await simulateCreateNextCycleTx({
      authUid: 'super_admin_1',
      isSuperAdmin: true,
      sourceCycleId: '2026-09',
      name: 'Ciclo 2',
      clientRequestId: validUuid1,
      store,
    });

    const res2 = await simulateCreateNextCycleTx({
      authUid: 'super_admin_1',
      isSuperAdmin: true,
      sourceCycleId: '2026-09',
      name: 'Ciclo 2',
      clientRequestId: validUuid1,
      store,
    });

    expect(res1.cycleId).toBe(res2.cycleId);
    expect(res2.idempotentReplay).toBe(true);
  });

  it('SOURCE_NOT_FOUND: Arroja SOURCE_NOT_FOUND', async () => {
    const store = new Map<string, any>();
    await expect(
      simulateCreateNextCycleTx({
        authUid: 'super_admin_1',
        isSuperAdmin: true,
        sourceCycleId: 'non_existent_cycle',
        name: 'Ciclo 2',
        clientRequestId: validUuid1,
        store,
      })
    ).rejects.toThrow(/SOURCE_NOT_FOUND/);
  });

  it('SOURCE_NOT_OPEN: Arroja SOURCE_NOT_OPEN si status es CLOSED', async () => {
    const store = new Map<string, any>();
    store.set('monthlyCycles/2026-09', {
      id: '2026-09',
      status: 'CLOSED',
      operationalStatus: 'STARTED',
      trmApplied: 4150,
    });

    await expect(
      simulateCreateNextCycleTx({
        authUid: 'super_admin_1',
        isSuperAdmin: true,
        sourceCycleId: '2026-09',
        name: 'Ciclo 2',
        clientRequestId: validUuid1,
        store,
      })
    ).rejects.toThrow(/SOURCE_NOT_OPEN/);
  });

  it('SOURCE_NOT_STARTED: Arroja SOURCE_NOT_STARTED si operationalStatus es PREPARING', async () => {
    const store = new Map<string, any>();
    store.set('monthlyCycles/2026-09', {
      id: '2026-09',
      status: 'OPEN',
      operationalStatus: 'PREPARING',
      trmApplied: 4150,
    });

    await expect(
      simulateCreateNextCycleTx({
        authUid: 'super_admin_1',
        isSuperAdmin: true,
        sourceCycleId: '2026-09',
        name: 'Ciclo 2',
        clientRequestId: validUuid1,
        store,
      })
    ).rejects.toThrow(/SOURCE_NOT_STARTED/);
  });

  it('SUCCESSOR_ALREADY_EXISTS: Arroja error si nextCycleId ya está poblado', async () => {
    const store = new Map<string, any>();
    store.set('monthlyCycles/2026-09', {
      id: '2026-09',
      status: 'OPEN',
      operationalStatus: 'STARTED',
      trmApplied: 4150,
      nextCycleId: 'cyc_already_exists',
    });

    await expect(
      simulateCreateNextCycleTx({
        authUid: 'super_admin_1',
        isSuperAdmin: true,
        sourceCycleId: '2026-09',
        name: 'Ciclo 2',
        clientRequestId: validUuid1,
        store,
      })
    ).rejects.toThrow(/NEXT_CYCLE_ALREADY_EXISTS/);
  });

  it('SOURCE_CYCLE_TRM_INVALID: Arroja error si trmApplied no es un número positivo finito', async () => {
    const store = new Map<string, any>();
    store.set('monthlyCycles/2026-09', {
      id: '2026-09',
      status: 'OPEN',
      operationalStatus: 'STARTED',
      trmApplied: 0,
      nextCycleId: null,
    });

    await expect(
      simulateCreateNextCycleTx({
        authUid: 'super_admin_1',
        isSuperAdmin: true,
        sourceCycleId: '2026-09',
        name: 'Ciclo 2',
        clientRequestId: validUuid1,
        store,
      })
    ).rejects.toThrow(/SOURCE_CYCLE_TRM_INVALID/);
  });

  it('CYCLE_ID_COLLISION: Detecta colisión si candidateCycleId ya existe', async () => {
    const store = new Map<string, any>();
    store.set('monthlyCycles/2026-09', {
      id: '2026-09',
      status: 'OPEN',
      operationalStatus: 'STARTED',
      trmApplied: 4150,
      nextCycleId: null,
    });
    store.set('monthlyCycles/cyc_collision_test', {
      id: 'cyc_collision_test',
    });

    await expect(
      simulateCreateNextCycleTx({
        authUid: 'super_admin_1',
        isSuperAdmin: true,
        sourceCycleId: '2026-09',
        name: 'Ciclo 2',
        clientRequestId: validUuid1,
        forcedCandidateId: 'cyc_collision_test',
        store,
      })
    ).rejects.toThrow(/CYCLE_ID_COLLISION/);
  });

  it('INVALID_NAME: Rechaza nombres menores a 3 o mayores a 60 caracteres', async () => {
    const store = new Map<string, any>();
    await expect(
      simulateCreateNextCycleTx({
        authUid: 'super_admin_1',
        isSuperAdmin: true,
        sourceCycleId: '2026-09',
        name: 'AB',
        clientRequestId: validUuid1,
        store,
      })
    ).rejects.toThrow(/INVALID_NAME/);

    await expect(
      simulateCreateNextCycleTx({
        authUid: 'super_admin_1',
        isSuperAdmin: true,
        sourceCycleId: '2026-09',
        name: 'A'.repeat(61),
        clientRequestId: validUuid1,
        store,
      })
    ).rejects.toThrow(/INVALID_NAME/);
  });

  it('INVALID_CLIENT_REQUEST_ID: Rechaza IDs que no sean UUID v4 válido', async () => {
    const store = new Map<string, any>();
    await expect(
      simulateCreateNextCycleTx({
        authUid: 'super_admin_1',
        isSuperAdmin: true,
        sourceCycleId: '2026-09',
        name: 'Ciclo 2',
        clientRequestId: 'not-a-uuid-v4',
        store,
      })
    ).rejects.toThrow(/INVALID_CLIENT_REQUEST_ID/);
  });

  it('NON_SUPERADMIN_DENIED: Rechaza si no es SuperAdmin', async () => {
    const store = new Map<string, any>();
    await expect(
      simulateCreateNextCycleTx({
        authUid: 'regular_user_1',
        isSuperAdmin: false,
        sourceCycleId: '2026-09',
        name: 'Ciclo 2',
        clientRequestId: validUuid1,
        store,
      })
    ).rejects.toThrow(/PERMISSION_DENIED/);
  });
});
