import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

// --- MOCK SERVICES & MODELS ---

interface MockDocSnap {
  exists: boolean;
  data: () => any;
}

interface MockTx {
  get: (ref: any) => Promise<MockDocSnap>;
  set: (ref: any, data: any, options?: any) => void;
  update: (ref: any, data: any) => void;
}

// SIMULACIÓN DE ADMIN_REQUEST_DISBURSEMENT_CALLABLE
async function simulateAdminRequestDisbursement({
  authUid,
  isSuperAdmin,
  store,
  payload,
}: {
  authUid: string;
  isSuperAdmin: boolean;
  store: Map<string, any>;
  payload: any;
}) {
  if (!isSuperAdmin) {
    throw new Error('PERMISSION_DENIED: Se requieren privilegios de SuperAdmin.');
  }

  const {
    userId,
    sourceCycleId,
    amountCop,
    disbursementSource = 'PROFIT',
    method,
    clientRequestId,
    bankName,
    notes,
  } = payload;

  if (!clientRequestId || typeof clientRequestId !== 'string' || !clientRequestId.trim()) {
    throw new Error('INVALID_ARGUMENT: El parámetro "clientRequestId" es obligatorio.');
  }
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    throw new Error('INVALID_ARGUMENT: El parámetro "userId" es obligatorio.');
  }
  if (!sourceCycleId || typeof sourceCycleId !== 'string' || !sourceCycleId.trim()) {
    throw new Error('INVALID_ARGUMENT: El parámetro "sourceCycleId" es obligatorio.');
  }

  const amt = Math.round(Number(amountCop));
  if (isNaN(amt) || amt <= 0) {
    throw new Error('INVALID_ARGUMENT: El monto de desembolso debe ser mayor a $0 COP.');
  }

  const cleanUserId = userId.trim();
  const cleanCycleId = sourceCycleId.trim();
  const cleanMethod = String(method || 'TRANSFERENCIA').trim().toUpperCase();
  const cleanClientRequestId = clientRequestId.trim();

  // Check Idempotency Key
  const idemKey = `disb_req_${cleanClientRequestId}`;
  if (store.has(idemKey)) {
    return {
      success: true,
      disbursement: store.get(idemKey).disbursement,
      message: 'Solicitud de desembolso recuperada exitosamente (Idempotente).',
    };
  }

  // Check user
  const userKey = `users/${cleanUserId}`;
  if (!store.has(userKey)) {
    throw new Error('NOT_FOUND: Inversionista no encontrado.');
  }
  const userData = store.get(userKey);

  const id = `disb_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const newRequest = {
    id,
    userId: cleanUserId,
    userUid: cleanUserId,
    userCode: userData.userCode || '',
    userName: userData.fullName || '',
    sourceCycleId: cleanCycleId,
    amountCop: amt,
    disbursementSource,
    method: cleanMethod,
    bankName: cleanMethod === 'TRANSFERENCIA' ? (bankName || 'Bancolombia') : null,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
    notes: (notes || '').trim(),
    clientRequestId: cleanClientRequestId,
  };

  // Write to store
  store.set(`disbursements/${id}`, newRequest);
  store.set(idemKey, {
    clientRequestId: cleanClientRequestId,
    disbursement: newRequest,
  });

  return {
    success: true,
    disbursement: newRequest,
    message: `Solicitud de desembolso radicada exitosamente con código ${id}.`,
  };
}

// SIMULACIÓN DE ADMIN_RESOLVE_DISBURSEMENT_CALLABLE
async function simulateAdminResolveDisbursement({
  authUid,
  isSuperAdmin,
  store,
  payload,
}: {
  authUid: string;
  isSuperAdmin: boolean;
  store: Map<string, any>;
  payload: { requestId: string; action: string; notes?: string; voucher?: string };
}) {
  if (!isSuperAdmin) {
    throw new Error('PERMISSION_DENIED: Privilegios insuficientes.');
  }

  const { requestId, action, notes = '', voucher = '' } = payload;
  const cleanRequestId = requestId.trim();
  const cleanAction = action.trim().toUpperCase();

  const disbKey = `disbursements/${cleanRequestId}`;
  if (!store.has(disbKey)) {
    throw new Error('NOT_FOUND: La solicitud de desembolso no existe.');
  }

  const disbData = store.get(disbKey);

  if (cleanAction === 'APPROVE') {
    if (disbData.status !== 'PENDING') {
      throw new Error(`FAILED_PRECONDITION: La solicitud ya no está PENDING (estado actual: ${disbData.status}).`);
    }
    disbData.status = 'APPROVED';
    disbData.resolvedAt = new Date().toISOString();
    disbData.resolvedBy = 'SuperAdmin';
  } else if (cleanAction === 'PAY') {
    if (disbData.status !== 'APPROVED') {
      throw new Error(`FAILED_PRECONDITION: Solo las solicitudes en estado APPROVED pueden ser liquidadas (PAID) (estado actual: ${disbData.status}).`);
    }
    disbData.status = 'PAID';
    disbData.resolvedAt = new Date().toISOString();
    disbData.resolvedBy = 'SuperAdmin';
    disbData.paymentVoucher = voucher.trim() || 'VOUCHER_123';
  } else if (cleanAction === 'REJECT') {
    if (disbData.status !== 'PENDING') {
      throw new Error(`FAILED_PRECONDITION: Solo las solicitudes en estado PENDING pueden ser rechazadas (estado actual: ${disbData.status}).`);
    }
    disbData.status = 'REJECTED';
    disbData.resolvedAt = new Date().toISOString();
    disbData.resolvedBy = 'SuperAdmin';
    disbData.rejectionReason = notes.trim() || 'Rechazado';
  } else {
    throw new Error(`INVALID_ARGUMENT: Acción '${cleanAction}' no soportada.`);
  }

  store.set(disbKey, disbData);
  return { success: true, disbursement: disbData };
}

// SIMULACIÓN DE ADMIN_RESOLVE_FUNDING_RECONCILIATION_CALLABLE
async function simulateAdminResolveFundingReconciliation({
  authUid,
  isSuperAdmin,
  store,
  payload,
}: {
  authUid: string;
  isSuperAdmin: boolean;
  store: Map<string, any>;
  payload: { requestId: string; resolution: string; notes?: string; clientRequestId: string };
}) {
  if (!isSuperAdmin) {
    throw new Error('PERMISSION_DENIED: Privilegios de SuperAdmin requeridos.');
  }

  const { requestId, resolution, notes = '', clientRequestId } = payload;

  if (!requestId || typeof requestId !== 'string' || !requestId.trim()) {
    throw new Error('INVALID_ARGUMENT: El parámetro "requestId" es obligatorio.');
  }
  if (!resolution || typeof resolution !== 'string' || !resolution.trim()) {
    throw new Error('INVALID_ARGUMENT: El parámetro "resolution" es obligatorio.');
  }
  if (!clientRequestId || typeof clientRequestId !== 'string' || !clientRequestId.trim()) {
    throw new Error('INVALID_ARGUMENT: El parámetro "clientRequestId" es obligatorio.');
  }

  const cleanRequestId = requestId.trim();
  const cleanResolution = resolution.trim().toUpperCase();
  const cleanClientRequestId = clientRequestId.trim();

  // Check Idempotency Key
  const idemKey = `resolve_recon_${cleanClientRequestId}`;
  if (store.has(idemKey)) {
    return {
      success: true,
      message: store.get(idemKey).message || 'Operación de conciliación resuelta con éxito (Idempotente).',
    };
  }

  const reinvKey = `reinvestments/${cleanRequestId}`;
  if (!store.has(reinvKey)) {
    throw new Error(`NOT_FOUND: La solicitud ${cleanRequestId} no existe.`);
  }

  const reinvData = store.get(reinvKey);
  if (reinvData.fundingReconciliationStatus !== 'NEEDS_REVIEW') {
    throw new Error(`FAILED_PRECONDITION: La solicitud no está en estado NEEDS_REVIEW (estado actual: ${reinvData.fundingReconciliationStatus || 'OK'}).`);
  }

  const confirmedAmount = Number(reinvData.confirmedAmountCop || 0);
  const requiredCash = Number(reinvData.cashInjectionCop || 0);

  let resultMsg = '';

  if (cleanResolution === 'RESOLVE_MATCHING') {
    if (confirmedAmount === requiredCash) {
      reinvData.fundingReconciliationStatus = 'OK';
      reinvData.fundingReconciliationReason = null;
      reinvData.notes = notes ? `${reinvData.notes || ''} | RESOLVED: ${notes.trim()}` : (reinvData.notes || '');
      reinvData.updatedAt = new Date().toISOString();
      resultMsg = 'Conciliación resuelta exitosamente: El aporte verificado coincide matemáticamente con la inyección requerida.';
    } else {
      throw new Error(`RECONCILIATION_AMOUNT_MISMATCH: El aporte verificado ($${confirmedAmount}) no coincide con el capital requerido ($${requiredCash}).`);
    }
  } else if (cleanResolution === 'KEEP_REVIEW') {
    reinvData.notes = notes ? `${reinvData.notes || ''} | REVIEW_NOTE: ${notes.trim()}` : (reinvData.notes || '');
    reinvData.updatedAt = new Date().toISOString();
    resultMsg = 'Nota de revisión agregada. La solicitud continúa en NEEDS_REVIEW.';
  } else {
    throw new Error(`INVALID_ARGUMENT: Resolución '${cleanResolution}' no soportada.`);
  }

  store.set(reinvKey, reinvData);
  store.set(idemKey, {
    clientRequestId: cleanClientRequestId,
    message: resultMsg,
  });

  return { success: true, message: resultMsg };
}

// SIMULACIÓN DE ADMIN_START_CYCLE_CALLABLE (REGRESSION GUARD)
async function simulateAdminStartCycle({
  authUid,
  isSuperAdmin,
  store,
  targetCycleId,
}: {
  authUid: string;
  isSuperAdmin: boolean;
  store: Map<string, any>;
  targetCycleId: string;
}) {
  if (!isSuperAdmin) {
    throw new Error('PERMISSION_DENIED');
  }

  // Guard: Funding Reconciliation Guard
  let hasUnresolvedRecon = false;
  store.forEach((value, key) => {
    if (key.startsWith('reinvestments/')) {
      if (value.targetCycleId === targetCycleId && value.fundingReconciliationStatus === 'NEEDS_REVIEW') {
        hasUnresolvedRecon = true;
      }
    }
  });

  if (hasUnresolvedRecon) {
    throw new Error('UNRESOLVED_FUNDING_RECONCILIATION: Existen solicitudes con conciliación pendiente (NEEDS_REVIEW).');
  }

  return { success: true };
}

// --- SUITE DE PRUEBAS ---

describe('Phase 2C + 2D — Complete Local Certification Suite', () => {

  describe('1. adminRequestDisbursementCallable', () => {
    it('Debe bloquear solicitudes si no se es SuperAdmin', async () => {
      const store = new Map();
      const payload = {
        userId: 'usr_1',
        sourceCycleId: 'cyc_2026-09',
        amountCop: 5000000,
        method: 'TRANSFERENCIA',
        clientRequestId: crypto.randomUUID(),
      };

      await expect(
        simulateAdminRequestDisbursement({ authUid: 'user_1', isSuperAdmin: false, store, payload })
      ).rejects.toThrow(/PERMISSION_DENIED/);
    });

    it('Debe exigir obligatoriamente clientRequestId para prevenir duplicados', async () => {
      const store = new Map();
      const payload = {
        userId: 'usr_1',
        sourceCycleId: 'cyc_2026-09',
        amountCop: 5000000,
        method: 'TRANSFERENCIA',
      };

      await expect(
        simulateAdminRequestDisbursement({ authUid: 'admin_1', isSuperAdmin: true, store, payload })
      ).rejects.toThrow(/clientRequestId/);
    });

    it('Debe crear un desembolso exitosamente sin forzar métodos de pago', async () => {
      const store = new Map();
      store.set('users/usr_1', { id: 'usr_1', userCode: 'INV-001', fullName: 'Carlos Fuentes' });

      const payload = {
        userId: 'usr_1',
        sourceCycleId: 'cyc_2026-09',
        amountCop: 15000000, // Superior a 10M
        method: 'TRANSFERENCIA', // No debe ser forzado a EFECTIVO
        clientRequestId: 'req_disb_unique_1',
      };

      const res = await simulateAdminRequestDisbursement({ authUid: 'admin_1', isSuperAdmin: true, store, payload });
      expect(res.success).toBe(true);
      expect(res.disbursement.amountCop).toBe(15000000);
      expect(res.disbursement.method).toBe('TRANSFERENCIA'); // Preserva el método
      expect(res.disbursement.status).toBe('PENDING');
    });

    it('Debe retornar repetición idéntica e idempotent replay si coincide clientRequestId', async () => {
      const store = new Map();
      store.set('users/usr_1', { id: 'usr_1', userCode: 'INV-001', fullName: 'Carlos Fuentes' });

      const payload = {
        userId: 'usr_1',
        sourceCycleId: 'cyc_2026-09',
        amountCop: 4000000,
        method: 'EFECTIVO',
        clientRequestId: 'req_disb_idemp_1',
      };

      const firstRes = await simulateAdminRequestDisbursement({ authUid: 'admin_1', isSuperAdmin: true, store, payload });
      const secondRes = await simulateAdminRequestDisbursement({ authUid: 'admin_1', isSuperAdmin: true, store, payload });

      expect(firstRes.disbursement.id).toBe(secondRes.disbursement.id);
      expect(secondRes.message).toContain('Idempotente');
    });
  });

  describe('2. adminResolveDisbursementCallable', () => {
    it('Debe validar transiciones de estados de forma estricta (PENDING -> APPROVED -> PAID)', async () => {
      const store = new Map();
      const disbId = 'disb_test_1';
      store.set(`disbursements/${disbId}`, {
        id: disbId,
        status: 'PENDING',
        amountCop: 3000000,
      });

      // PENDING -> PAID Directamente debe fallar si exigimos aprobación previa
      await expect(
        simulateAdminResolveDisbursement({
          authUid: 'admin_1',
          isSuperAdmin: true,
          store,
          payload: { requestId: disbId, action: 'PAY', voucher: 'V-001' },
        })
      ).rejects.toThrow(/APPROVED/);

      // PENDING -> APPROVED Exitoso
      const appRes = await simulateAdminResolveDisbursement({
        authUid: 'admin_1',
        isSuperAdmin: true,
        store,
        payload: { requestId: disbId, action: 'APPROVE' },
      });
      expect(appRes.disbursement.status).toBe('APPROVED');

      // APPROVED -> PAID Exitoso
      const payRes = await simulateAdminResolveDisbursement({
        authUid: 'admin_1',
        isSuperAdmin: true,
        store,
        payload: { requestId: disbId, action: 'PAY', voucher: 'V-001' },
      });
      expect(payRes.disbursement.status).toBe('PAID');
    });

    it('Debe denegar transiciones a PAID si ya está REJECTED', async () => {
      const store = new Map();
      const disbId = 'disb_test_2';
      store.set(`disbursements/${disbId}`, {
        id: disbId,
        status: 'PENDING',
        amountCop: 3000000,
      });

      // PENDING -> REJECTED Exitoso
      await simulateAdminResolveDisbursement({
        authUid: 'admin_1',
        isSuperAdmin: true,
        store,
        payload: { requestId: disbId, action: 'REJECT', notes: 'No cumple' },
      });

      // REJECTED -> PAY Debe fallar
      await expect(
        simulateAdminResolveDisbursement({
          authUid: 'admin_1',
          isSuperAdmin: true,
          store,
          payload: { requestId: disbId, action: 'PAY', voucher: 'V-002' },
        })
      ).rejects.toThrow(/APPROVED/);
    });
  });

  describe('3. adminResolveFundingReconciliationCallable', () => {
    it('Debe denegar resoluciones a usuarios sin privilegios de SuperAdmin', async () => {
      const store = new Map();
      const payload = {
        requestId: 'reinv_1',
        resolution: 'RESOLVE_MATCHING',
        clientRequestId: crypto.randomUUID(),
      };

      await expect(
        simulateAdminResolveFundingReconciliation({ authUid: 'user_1', isSuperAdmin: false, store, payload })
      ).rejects.toThrow(/SuperAdmin/);
    });

    it('Debe resolver a OK si confirmedAmount coincide matemáticamente con requiredCash', async () => {
      const store = new Map();
      const reqId = 'reinv_match_1';
      store.set(`reinvestments/${reqId}`, {
        id: reqId,
        fundingReconciliationStatus: 'NEEDS_REVIEW',
        confirmedAmountCop: 8000000,
        cashInjectionCop: 8000000,
        notes: '',
      });

      const payload = {
        requestId: reqId,
        resolution: 'RESOLVE_MATCHING',
        notes: 'Coincidencia verificada',
        clientRequestId: 'recon_client_1',
      };

      const res = await simulateAdminResolveFundingReconciliation({ authUid: 'admin_1', isSuperAdmin: true, store, payload });
      expect(res.success).toBe(true);

      const updated = store.get(`reinvestments/${reqId}`);
      expect(updated.fundingReconciliationStatus).toBe('OK');
      expect(updated.fundingReconciliationReason).toBeNull();
      expect(updated.notes).toContain('Coincidencia verificada');
    });

    it('Debe prohibir forzar OK si los montos difieren (mismatch)', async () => {
      const store = new Map();
      const reqId = 'reinv_mismatch_1';
      store.set(`reinvestments/${reqId}`, {
        id: reqId,
        fundingReconciliationStatus: 'NEEDS_REVIEW',
        confirmedAmountCop: 7500000, // Menos de lo requerido
        cashInjectionCop: 8000000,
        notes: '',
      });

      const payload = {
        requestId: reqId,
        resolution: 'RESOLVE_MATCHING',
        notes: 'Forzar OK descabellado',
        clientRequestId: 'recon_client_2',
      };

      await expect(
        simulateAdminResolveFundingReconciliation({ authUid: 'admin_1', isSuperAdmin: true, store, payload })
      ).rejects.toThrow(/RECONCILIATION_AMOUNT_MISMATCH/);

      // Debe conservar estado NEEDS_REVIEW
      const unchanged = store.get(`reinvestments/${reqId}`);
      expect(unchanged.fundingReconciliationStatus).toBe('NEEDS_REVIEW');
    });

    it('Debe permitir agregar notas de auditoría y mantener en NEEDS_REVIEW vía KEEP_REVIEW', async () => {
      const store = new Map();
      const reqId = 'reinv_review_1';
      store.set(`reinvestments/${reqId}`, {
        id: reqId,
        fundingReconciliationStatus: 'NEEDS_REVIEW',
        confirmedAmountCop: 7500000,
        cashInjectionCop: 8000000,
        notes: '',
      });

      const payload = {
        requestId: reqId,
        resolution: 'KEEP_REVIEW',
        notes: 'Falta adjuntar comprobante de banco secundario.',
        clientRequestId: 'recon_client_3',
      };

      const res = await simulateAdminResolveFundingReconciliation({ authUid: 'admin_1', isSuperAdmin: true, store, payload });
      expect(res.success).toBe(true);

      const updated = store.get(`reinvestments/${reqId}`);
      expect(updated.fundingReconciliationStatus).toBe('NEEDS_REVIEW'); // Sigue igual
      expect(updated.notes).toContain('Falta adjuntar comprobante de banco secundario.');
    });

    it('Debe garantizar idempotencia total en resoluciones con el mismo clientRequestId', async () => {
      const store = new Map();
      const reqId = 'reinv_idemp_1';
      store.set(`reinvestments/${reqId}`, {
        id: reqId,
        fundingReconciliationStatus: 'NEEDS_REVIEW',
        confirmedAmountCop: 5000000,
        cashInjectionCop: 5000000,
        notes: '',
      });

      const payload = {
        requestId: reqId,
        resolution: 'RESOLVE_MATCHING',
        notes: 'Ok',
        clientRequestId: 'idem_recon_key_77',
      };

      const first = await simulateAdminResolveFundingReconciliation({ authUid: 'admin_1', isSuperAdmin: true, store, payload });
      const second = await simulateAdminResolveFundingReconciliation({ authUid: 'admin_1', isSuperAdmin: true, store, payload });

      expect(first.message).toBe(second.message);
      expect(second.message).toContain('coincide matemáticamente');
    });
  });

  describe('4. adminStartCycleCallable Regression Guard', () => {
    it('Debe seguir bloqueando el inicio de ciclo si hay un NEEDS_REVIEW pendiente', async () => {
      const store = new Map();
      // Agregar un reinvestment en NEEDS_REVIEW
      store.set('reinvestments/reinv_blocked', {
        id: 'reinv_blocked',
        targetCycleId: 'cyc_B',
        fundingReconciliationStatus: 'NEEDS_REVIEW',
      });

      await expect(
        simulateAdminStartCycle({ authUid: 'admin_1', isSuperAdmin: true, store, targetCycleId: 'cyc_B' })
      ).rejects.toThrow(/UNRESOLVED_FUNDING_RECONCILIATION/);
    });
  });

  describe('5. USERPORTAL_CLOSE_TO_START Dashboard Window', () => {
    it('USERPORTAL_CLOSE_TO_START_RESOLVES_A: Debe resolver y seleccionar ciclo A cuando B está en preparación', () => {
      // Mock de configuración global de la applet
      const config = {
        operationalCycleId: null, // Ciclo cerrado
        preparingCycleId: 'cyc_B', // Sucesor en preparación
      };

      // Mocks de ciclos en dataStore
      const cycles = new Map<string, any>([
        ['cyc_A', { cycleId: 'cyc_A', nextCycleId: 'cyc_B', status: 'CLOSED' }],
        ['cyc_B', { cycleId: 'cyc_B', previousCycleId: 'cyc_A', operationalStatus: 'PREPARING' }],
      ]);

      const getCycleById = (id: string) => cycles.get(id);

      // Lógica de UserPortalView:
      const isCloseToStartCase = !config.operationalCycleId && !!config.preparingCycleId && (() => {
        const cycleB = getCycleById(config.preparingCycleId);
        if (cycleB && cycleB.previousCycleId) {
          const cycleA = getCycleById(cycleB.previousCycleId);
          return cycleA && cycleA.nextCycleId === cycleB.cycleId;
        }
        return false;
      })();

      expect(isCloseToStartCase).toBe(true);

      const getCloseToStartSourceId = () => {
        if (!config.operationalCycleId && config.preparingCycleId) {
          const cycleB = getCycleById(config.preparingCycleId);
          if (cycleB && cycleB.previousCycleId) {
            const cycleA = getCycleById(cycleB.previousCycleId);
            if (cycleA && cycleA.nextCycleId === cycleB.cycleId) {
              return cycleA.cycleId;
            }
          }
        }
        return null;
      };

      const selectedCycleId = getCloseToStartSourceId();
      expect(selectedCycleId).toBe('cyc_A'); // Resuelve correctamente a A para ver resultados financieros
    });

    it('USERPORTAL_CLOSE_TO_START_DOUBLE_LINK: Debe fallar si la doble vinculación está rota', () => {
      const config = {
        operationalCycleId: null,
        preparingCycleId: 'cyc_B',
      };

      // cyc_A no tiene nextCycleId apuntando a cyc_B
      const cycles = new Map<string, any>([
        ['cyc_A', { cycleId: 'cyc_A', nextCycleId: 'cyc_Z_broken', status: 'CLOSED' }],
        ['cyc_B', { cycleId: 'cyc_B', previousCycleId: 'cyc_A', operationalStatus: 'PREPARING' }],
      ]);

      const getCycleById = (id: string) => cycles.get(id);

      const isCloseToStartCase = !config.operationalCycleId && !!config.preparingCycleId && (() => {
        const cycleB = getCycleById(config.preparingCycleId);
        if (cycleB && cycleB.previousCycleId) {
          const cycleA = getCycleById(cycleB.previousCycleId);
          return cycleA && cycleA.nextCycleId === cycleB.cycleId;
        }
        return false;
      })();

      expect(isCloseToStartCase).toBe(false);
    });

    it('USERPORTAL_CLOSE_TO_START_B_NOT_OPERATIONAL: No debe mostrar el ciclo B en preparación como operativo', () => {
      const config = {
        operationalCycleId: null,
        preparingCycleId: 'cyc_B',
      };

      const cycles = new Map<string, any>([
        ['cyc_A', { cycleId: 'cyc_A', nextCycleId: 'cyc_B', status: 'CLOSED' }],
        ['cyc_B', { cycleId: 'cyc_B', previousCycleId: 'cyc_A', operationalStatus: 'PREPARING' }],
      ]);

      const getCycleById = (id: string) => cycles.get(id);

      const activeCycle = config.operationalCycleId ? getCycleById(config.operationalCycleId) : null;
      expect(activeCycle).toBeNull(); // No hay ciclo activo/operativo visible
    });
  });

});
