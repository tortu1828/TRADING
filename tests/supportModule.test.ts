import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  verifySupportPrivileges,
  updateSupportPermissionsCore,
  createSupportTicketCore,
  replySupportTicketCore,
  addInternalNoteCore,
  assignSupportTicketCore,
  updateSupportTicketStatusCore,
  getSupportUserContextCore,
  VALID_TICKET_CATEGORIES,
  VALID_TICKET_STATUSES,
} from '../functions/supportCore';

// =========================================================================
// MOCK FIRESTORE ENVIRONMENT PARA PRUEBAS UNITARIAS DE SOPORTE
// =========================================================================

class MockDocSnapshot {
  constructor(
    public id: string,
    public ref: any,
    private _data: any,
    private _exists: boolean
  ) {}

  get exists() {
    return this._exists;
  }

  data() {
    return this._exists ? { ...this._data } : undefined;
  }
}

class MockQuerySnapshot {
  constructor(public docs: MockDocSnapshot[]) {}

  get empty() {
    return this.docs.length === 0;
  }

  get size() {
    return this.docs.length;
  }

  forEach(callback: (doc: MockDocSnapshot) => void) {
    this.docs.forEach(callback);
  }
}

class MockQuery {
  constructor(
    private path: string,
    private store: Map<string, any>,
    private filters: Array<{ field: string; op: string; val: any }> = [],
    private limitCount: number = 0
  ) {}

  where(field: string, op: string, val: any): MockQuery {
    return new MockQuery(
      this.path,
      this.store,
      [...this.filters, { field, op, val }],
      this.limitCount
    );
  }

  limit(count: number): MockQuery {
    return new MockQuery(this.path, this.store, this.filters, count);
  }

  async get() {
    const prefix = `${this.path}/`;
    const results: MockDocSnapshot[] = [];

    for (const [docPath, docData] of this.store.entries()) {
      if (docPath.startsWith(prefix)) {
        const remaining = docPath.slice(prefix.length);
        if (remaining.includes('/')) continue; // Subcolección más profunda

        let matches = true;
        for (const f of this.filters) {
          if (f.op === '==') {
            const keys = f.field.split('.');
            let val = docData;
            for (const k of keys) {
              val = val ? val[k] : undefined;
            }
            if (val !== f.val) {
              matches = false;
              break;
            }
          } else if (f.op === 'array-contains') {
            const arr = docData[f.field];
            if (!Array.isArray(arr) || !arr.includes(f.val)) {
              matches = false;
              break;
            }
          }
        }

        if (matches) {
          results.push(new MockDocSnapshot(remaining, new MockDocRef(docPath, remaining, this.store), docData, true));
          if (this.limitCount > 0 && results.length >= this.limitCount) {
            break;
          }
        }
      }
    }

    return new MockQuerySnapshot(results);
  }
}

class MockDocRef {
  constructor(
    public path: string,
    public id: string,
    private store: Map<string, any>
  ) {}

  collection(subColName: string) {
    return new MockCollection(`${this.path}/${subColName}`, this.store);
  }

  async get() {
    const exists = this.store.has(this.path);
    const data = exists ? this.store.get(this.path) : undefined;
    return new MockDocSnapshot(this.id, this, data, exists);
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
      const err: any = new Error(`NOT_FOUND: ${this.path}`);
      err.code = 'not-found';
      throw err;
    }
    const existing = this.store.get(this.path);
    this.store.set(this.path, applyMockUpdate(existing, data));
  }

  async delete() {
    this.store.delete(this.path);
  }
}

class MockCollection {
  constructor(
    public path: string,
    private store: Map<string, any>
  ) {}

  doc(id?: string) {
    const cleanId = id || `doc_${crypto.randomUUID()}`;
    return new MockDocRef(`${this.path}/${cleanId}`, cleanId, this.store);
  }

  where(field: string, op: string, val: any) {
    return new MockQuery(this.path, this.store, [{ field, op, val }]);
  }

  limit(count: number) {
    return new MockQuery(this.path, this.store, [], count);
  }

  async get() {
    return new MockQuery(this.path, this.store).get();
  }

  async add(data: any) {
    const id = `doc_${crypto.randomUUID()}`;
    const ref = this.doc(id);
    await ref.set(data);
    return ref;
  }
}

function applyMockUpdate(existing: any, data: any) {
  const result = { ...(existing || {}) };
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && '_increment' in (v as any)) {
      result[k] = (Number(result[k]) || 0) + (v as any)._increment;
    } else {
      result[k] = v;
    }
  }
  return result;
}

class MockBatch {
  private ops: Array<() => void> = [];

  constructor(private store: Map<string, any>) {}

  set(docRef: MockDocRef, data: any) {
    this.ops.push(() => {
      this.store.set(docRef.path, { ...data });
    });
    return this;
  }

  update(docRef: MockDocRef, data: any) {
    this.ops.push(() => {
      const existing = this.store.get(docRef.path) || {};
      this.store.set(docRef.path, applyMockUpdate(existing, data));
    });
    return this;
  }

  delete(docRef: MockDocRef) {
    this.ops.push(() => {
      this.store.delete(docRef.path);
    });
    return this;
  }

  async commit() {
    for (const op of this.ops) {
      op();
    }
    this.ops = [];
  }
}

class MockFirestore {
  public store = new Map<string, any>();
  private _txQueue: Promise<any> = Promise.resolve();

  collection(path: string) {
    return new MockCollection(path, this.store);
  }

  batch() {
    return new MockBatch(this.store);
  }

  async runTransaction(updateFunction: (transaction: any) => Promise<any>) {
    // Firestore serializes transactions or retries on collision. In MockFirestore, enqueue transactions sequentially.
    const run = async () => {
      const tx = {
        get: async (ref: MockDocRef) => ref.get(),
        set: (ref: MockDocRef, data: any) => {
          this.store.set(ref.path, { ...data });
        },
        update: (ref: MockDocRef, data: any) => {
          const existing = this.store.get(ref.path) || {};
          this.store.set(ref.path, applyMockUpdate(existing, data));
        },
        delete: (ref: MockDocRef) => {
          this.store.delete(ref.path);
        },
      };
      return await updateFunction(tx);
    };

    const nextTx = this._txQueue.then(run, run);
    this._txQueue = nextTx;
    return await nextTx;
  }
}

const mockAdmin = {
  firestore: {
    FieldValue: {
      serverTimestamp: () => 'MOCK_TIMESTAMP',
      increment: (n: number) => ({ _increment: n }),
    },
  },
};

// =========================================================================
// SUITE DE PRUEBAS DE MÓDULO DE SOPORTE Y PERMISOS GRANULARES
// =========================================================================

describe('Módulo de Soporte y Permisos Granulares (Support Module Test Suite)', () => {
  let db: MockFirestore;

  const SUPERADMIN_UID = 'lpx4NLEEMkeh9EJFcG68oPMVdXF2';
  const SUPERADMIN_EMAIL = 'juanes9802@gmail.com';
  const AGENT_UID = 'uid_support_agent_01';
  const USER_UID = 'uid_investor_01';
  const OTHER_USER_UID = 'uid_investor_02';

  beforeEach(() => {
    db = new MockFirestore();

    // 1. SuperAdmin User Doc
    db.store.set(`users/${SUPERADMIN_UID}`, {
      uid: SUPERADMIN_UID,
      email: SUPERADMIN_EMAIL,
      fullName: 'Juan Esteban SuperAdmin',
      userCode: 'ADM-01',
      role: 'ADMIN',
      status: 'ACTIVE',
      isClaimed: true,
    });

    // 2. Candidate Agent User Doc (Active investor)
    db.store.set(`users/${AGENT_UID}`, {
      uid: AGENT_UID,
      email: 'agente@easytraders.com',
      fullName: 'Agente Prueba',
      userCode: 'INV-AGT01',
      role: 'USER',
      status: 'ACTIVE',
      isClaimed: true,
      currentCapital: 25000000,
      permissions: {
        supportAgent: false,
      },
    });

    // 3. Regular Investor User Doc
    db.store.set(`users/${USER_UID}`, {
      uid: USER_UID,
      email: 'inversionista@easytraders.com',
      fullName: 'Carlos Inversionista',
      userCode: 'INV-042',
      role: 'USER',
      status: 'ACTIVE',
      isClaimed: true,
      category: 'VERDE',
      currentCapital: 50000000,
    });

    // 4. Other Regular Investor
    db.store.set(`users/${OTHER_USER_UID}`, {
      uid: OTHER_USER_UID,
      email: 'otro@easytraders.com',
      fullName: 'Ana Inversionista',
      userCode: 'INV-099',
      role: 'USER',
      status: 'ACTIVE',
      isClaimed: true,
      category: 'AZUL',
      currentCapital: 10000000,
    });

    // 5. Global Config
    db.store.set('settings/global_config', {
      activeCycleId: '2026-09',
      operationalCycleId: '2026-09',
    });
  });

  // -----------------------------------------------------------------------
  // 1. PRIVILEGIOS Y ROLES DE SOPORTE (verifySupportPrivileges)
  // -----------------------------------------------------------------------
  describe('verifySupportPrivileges', () => {
    it('1. Permite acceso al SuperAdmin por UID', async () => {
      const res = await verifySupportPrivileges({
        request: { auth: { uid: SUPERADMIN_UID, token: { email: SUPERADMIN_EMAIL } } },
        db,
        admin: mockAdmin,
      });
      expect(res.isSuperAdmin).toBe(true);
      expect(res.isSupportAgent).toBe(true);
    });

    it('2. Deniega acceso a un usuario regular sin permisos de soporte', async () => {
      await expect(
        verifySupportPrivileges({
          request: { auth: { uid: USER_UID, token: { email: 'inversionista@easytraders.com' } } },
          db,
          admin: mockAdmin,
        })
      ).rejects.toThrow(/Acceso denegado/);
    });

    it('3. Permite acceso a un agente de soporte con permissions.supportAgent == true', async () => {
      db.store.set(`users/${AGENT_UID}`, {
        ...db.store.get(`users/${AGENT_UID}`),
        permissions: { supportAgent: true, supportReadUserContext: true },
      });

      const res = await verifySupportPrivileges({
        request: { auth: { uid: AGENT_UID, token: { email: 'agente@easytraders.com' } } },
        db,
        admin: mockAdmin,
      });
      expect(res.isSuperAdmin).toBe(false);
      expect(res.isSupportAgent).toBe(true);
      expect(res.permissions.supportReadUserContext).toBe(true);
    });

    it('4. Deniega acceso si el agente de soporte no está en estado ACTIVE', async () => {
      db.store.set(`users/${AGENT_UID}`, {
        ...db.store.get(`users/${AGENT_UID}`),
        status: 'BLOCKED',
        permissions: { supportAgent: true },
      });

      await expect(
        verifySupportPrivileges({
          request: { auth: { uid: AGENT_UID, token: { email: 'agente@easytraders.com' } } },
          db,
          admin: mockAdmin,
        })
      ).rejects.toThrow(/Acceso denegado/);
    });
  });

  // -----------------------------------------------------------------------
  // 2. ASIGNACIÓN DE PERMISOS GRANULARES (updateSupportPermissionsCore)
  // -----------------------------------------------------------------------
  describe('updateSupportPermissionsCore', () => {
    it('5. SuperAdmin concede permisos de soporte con clientRequestId válido', async () => {
      const clientRequestId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
      const result = await updateSupportPermissionsCore({
        db,
        admin: mockAdmin,
        authUid: SUPERADMIN_UID,
        authEmail: SUPERADMIN_EMAIL,
        callerName: 'Juan Esteban',
        targetUid: AGENT_UID,
        permissions: {
          supportAgent: true,
          supportReadUserContext: true,
          supportReadOperationalContext: false,
        },
        clientRequestId,
      });

      expect(result.success).toBe(true);
      expect(result.permissions.supportAgent).toBe(true);
      expect(result.permissions.supportReadUserContext).toBe(true);
      expect(result.permissions.supportReadOperationalContext).toBe(false);

      // Verificar persistencia en Firestore
      const updatedUser = db.store.get(`users/${AGENT_UID}`);
      expect(updatedUser.permissions.supportAgent).toBe(true);

      // Verificar registro en auditLogs
      let auditFound = false;
      for (const [key, val] of db.store.entries()) {
        if (key.startsWith('auditLogs/') && val.action === 'SUPPORT_PERMISSIONS_UPDATED') {
          auditFound = true;
          expect(val.targetUid).toBe(AGENT_UID);
        }
      }
      expect(auditFound).toBe(true);
    });

    it('6. Replay idempotente con el mismo clientRequestId retorna éxito sin duplicar', async () => {
      const clientRequestId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
      await updateSupportPermissionsCore({
        db,
        admin: mockAdmin,
        authUid: SUPERADMIN_UID,
        authEmail: SUPERADMIN_EMAIL,
        callerName: 'Juan Esteban',
        targetUid: AGENT_UID,
        permissions: { supportAgent: true },
        clientRequestId,
      });

      const replay = await updateSupportPermissionsCore({
        db,
        admin: mockAdmin,
        authUid: SUPERADMIN_UID,
        authEmail: SUPERADMIN_EMAIL,
        callerName: 'Juan Esteban',
        targetUid: AGENT_UID,
        permissions: { supportAgent: true },
        clientRequestId,
      });

      expect(replay.success).toBe(true);
      expect(replay.idempotentReplay).toBe(true);
    });

    it('7. Falla si clientRequestId no es un UUID v4 válido', async () => {
      await expect(
        updateSupportPermissionsCore({
          db,
          admin: mockAdmin,
          authUid: SUPERADMIN_UID,
          authEmail: SUPERADMIN_EMAIL,
          callerName: 'Juan Esteban',
          targetUid: AGENT_UID,
          permissions: { supportAgent: true },
          clientRequestId: 'invalido-no-uuid',
        })
      ).rejects.toThrow(/UUID v4/);
    });

    it('8. Falla si el usuario objetivo no existe', async () => {
      await expect(
        updateSupportPermissionsCore({
          db,
          admin: mockAdmin,
          authUid: SUPERADMIN_UID,
          authEmail: SUPERADMIN_EMAIL,
          callerName: 'Juan Esteban',
          targetUid: 'usuario_inexistente',
          permissions: { supportAgent: true },
          clientRequestId: '11111111-2222-4333-8444-555555555555',
        })
      ).rejects.toThrow(/no existe/);
    });

    it('9. Si supportAgent es false, anula automáticamente supportReadUserContext y operationalContext', async () => {
      const clientRequestId = '22222222-3333-4444-8555-666666666666';
      const result = await updateSupportPermissionsCore({
        db,
        admin: mockAdmin,
        authUid: SUPERADMIN_UID,
        authEmail: SUPERADMIN_EMAIL,
        callerName: 'Juan Esteban',
        targetUid: AGENT_UID,
        permissions: {
          supportAgent: false,
          supportReadUserContext: true,
          supportReadOperationalContext: true,
        },
        clientRequestId,
      });

      expect(result.permissions.supportAgent).toBe(false);
      expect(result.permissions.supportReadUserContext).toBe(false);
      expect(result.permissions.supportReadOperationalContext).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 3. CREACIÓN DE TICKETS (createSupportTicketCore)
  // -----------------------------------------------------------------------
  describe('createSupportTicketCore', () => {
    it('10. Inversionista activo crea un ticket con numeración correlativa SUP-000001', async () => {
      const res = await createSupportTicketCore({
        db,
        admin: mockAdmin,
        authUid: USER_UID,
        subject: 'Duda sobre la rentabilidad del ciclo actual',
        category: 'PROFITS',
        description: 'Deseo saber cuándo se proyecta la liquidación del ciclo.',
      });

      expect(res.success).toBe(true);
      expect(res.ticketNumber).toBe('SUP-000001');

      // Verificar que el ticket se guardó
      const ticketDoc = db.store.get(`supportTickets/${res.ticketId}`);
      expect(ticketDoc).toBeDefined();
      expect(ticketDoc.subject).toBe('Duda sobre la rentabilidad del ciclo actual');
      expect(ticketDoc.createdByUid).toBe(USER_UID);
      expect(ticketDoc.status).toBe('OPEN');
      expect(ticketDoc.priority).toBe('NORMAL');

      // Segundo ticket correlativo SUP-000002
      const res2 = await createSupportTicketCore({
        db,
        admin: mockAdmin,
        authUid: USER_UID,
        subject: 'Solicitud de reinversión para próximo ciclo',
        category: 'REINVESTMENT',
        description: 'Quiero reinvertir el 100% de mis ganancias.',
      });
      expect(res2.ticketNumber).toBe('SUP-000002');
    });

    it('11. Rechaza creación de ticket con asunto menor a 5 caracteres', async () => {
      await expect(
        createSupportTicketCore({
          db,
          admin: mockAdmin,
          authUid: USER_UID,
          subject: 'Hola',
          category: 'TECHNICAL',
          description: 'Descripción suficientemente detallada para el ticket.',
        })
      ).rejects.toThrow(/asunto del ticket debe tener entre 5 y 120/);
    });

    it('12. Rechaza creación de ticket con categoría inválida', async () => {
      await expect(
        createSupportTicketCore({
          db,
          admin: mockAdmin,
          authUid: USER_UID,
          subject: 'Asunto perfectamente válido',
          category: 'CATEGORIA_INVENTADA' as any,
          description: 'Descripción suficientemente detallada para el ticket.',
        })
      ).rejects.toThrow(/no válida/);
    });
  });

  // -----------------------------------------------------------------------
  // 4. RESPUESTAS Y MENSAJES DE TICKET (replySupportTicketCore)
  // -----------------------------------------------------------------------
  describe('replySupportTicketCore', () => {
    let ticketId: string;

    beforeEach(async () => {
      const created = await createSupportTicketCore({
        db,
        admin: mockAdmin,
        authUid: USER_UID,
        subject: 'Ticket para pruebas de respuesta',
        category: 'CYCLE',
        description: 'Pregunta inicial del inversionista.',
      });
      ticketId = created.ticketId;

      // Habilitar a AGENT_UID como agente de soporte
      db.store.set(`users/${AGENT_UID}`, {
        ...db.store.get(`users/${AGENT_UID}`),
        permissions: { supportAgent: true },
      });
    });

    it('13. Agente de soporte responde al ticket del inversionista', async () => {
      const replyRes = await replySupportTicketCore({
        db,
        admin: mockAdmin,
        authUid: AGENT_UID,
        ticketId,
        text: 'Hola Carlos, estamos revisando tu caso con el equipo de trading.',
      });

      expect(replyRes.success).toBe(true);

      const ticket = db.store.get(`supportTickets/${ticketId}`);
      expect(ticket.lastMessageSenderType).toBe('SUPPORT');
      expect(ticket.unreadByUser).toBe(true);
      expect(ticket.unreadBySupport).toBe(false);
      expect(ticket.messageCount).toBe(2);
    });

    it('14. Inversionista responde a su propio ticket y actualiza unreadBySupport', async () => {
      await replySupportTicketCore({
        db,
        admin: mockAdmin,
        authUid: USER_UID,
        ticketId,
        text: 'Muchas gracias por la pronta respuesta.',
      });

      const ticket = db.store.get(`supportTickets/${ticketId}`);
      expect(ticket.lastMessageSenderType).toBe('USER');
      expect(ticket.unreadByUser).toBe(false);
      expect(ticket.unreadBySupport).toBe(true);
    });

    it('15. Rechaza respuesta de un usuario no autorizado sobre el ticket de otro inversionista', async () => {
      await expect(
        replySupportTicketCore({
          db,
          admin: mockAdmin,
          authUid: OTHER_USER_UID, // Otro usuario no dueño ni agente
          ticketId,
          text: 'Intento de respuesta no autorizada.',
        })
      ).rejects.toThrow(/No tienes autorización/);
    });
  });

  // -----------------------------------------------------------------------
  // 5. NOTAS INTERNAS CONFIDENCIALES (addInternalNoteCore)
  // -----------------------------------------------------------------------
  describe('addInternalNoteCore', () => {
    let ticketId: string;

    beforeEach(async () => {
      const created = await createSupportTicketCore({
        db,
        admin: mockAdmin,
        authUid: USER_UID,
        subject: 'Ticket para notas internas',
        category: 'CAPITAL',
        description: 'Consulta sobre adición de capital.',
      });
      ticketId = created.ticketId;
    });

    it('16. Agente o SuperAdmin registra una nota interna confidencial', async () => {
      const res = await addInternalNoteCore({
        db,
        admin: mockAdmin,
        authUid: SUPERADMIN_UID,
        ticketId,
        noteText: 'El cliente confirmó transferencia por $10.000.000 COP en Bancolombia.',
      });

      expect(res.success).toBe(true);
      expect(res.noteId).toBeDefined();

      const note = db.store.get(`supportTickets/${ticketId}/internalNotes/${res.noteId}`);
      expect(note).toBeDefined();
      expect(note.noteText).toContain('$10.000.000 COP');
      expect(note.authorUid).toBe(SUPERADMIN_UID);
    });

    it('17. Rechaza nota interna vacía', async () => {
      await expect(
        addInternalNoteCore({
          db,
          admin: mockAdmin,
          authUid: SUPERADMIN_UID,
          ticketId,
          noteText: '   ',
        })
      ).rejects.toThrow(/entre 1 y 3000 caracteres/);
    });
  });

  // -----------------------------------------------------------------------
  // 6. ASIGNACIÓN Y ESTADOS (assignSupportTicketCore & updateSupportTicketStatusCore)
  // -----------------------------------------------------------------------
  describe('assignSupportTicketCore & updateSupportTicketStatusCore', () => {
    let ticketId: string;

    beforeEach(async () => {
      const created = await createSupportTicketCore({
        db,
        admin: mockAdmin,
        authUid: USER_UID,
        subject: 'Ticket para ciclo de vida',
        category: 'TECHNICAL',
        description: 'Incidencia en inicio de sesión.',
      });
      ticketId = created.ticketId;

      db.store.set(`users/${AGENT_UID}`, {
        ...db.store.get(`users/${AGENT_UID}`),
        permissions: { supportAgent: true },
      });
    });

    it('18. Asigna ticket al agente y pasa automáticamente a IN_PROGRESS si estaba OPEN', async () => {
      const assignRes = await assignSupportTicketCore({
        db,
        admin: mockAdmin,
        authUid: AGENT_UID,
        callerName: 'Agente Prueba',
        isSuperAdmin: false,
        ticketId,
        assignedToUid: AGENT_UID,
      });

      expect(assignRes.success).toBe(true);
      expect(assignRes.assignedToUid).toBe(AGENT_UID);
      expect(assignRes.status).toBe('IN_PROGRESS');

      const ticket = db.store.get(`supportTickets/${ticketId}`);
      expect(ticket.assignedToUid).toBe(AGENT_UID);
      expect(ticket.status).toBe('IN_PROGRESS');
    });

    it('19. Actualiza estado a RESOLVED registrando resolvedAt y resolvedByUid', async () => {
      // Primero transición legal OPEN -> IN_PROGRESS
      await updateSupportTicketStatusCore({
        db,
        admin: mockAdmin,
        authUid: AGENT_UID,
        callerName: 'Agente Prueba',
        isSuperAdmin: false,
        ticketId,
        status: 'IN_PROGRESS',
      });

      // Luego transición legal IN_PROGRESS -> RESOLVED
      const res = await updateSupportTicketStatusCore({
        db,
        admin: mockAdmin,
        authUid: AGENT_UID,
        callerName: 'Agente Prueba',
        isSuperAdmin: false,
        ticketId,
        status: 'RESOLVED',
      });

      expect(res.success).toBe(true);
      expect(res.newStatus).toBe('RESOLVED');

      const ticket = db.store.get(`supportTickets/${ticketId}`);
      expect(ticket.status).toBe('RESOLVED');
      expect(ticket.resolvedByUid).toBe(AGENT_UID);
    });

    it('20. Cierre de ticket registra closedAt, closedByUid y closedReason', async () => {
      const res = await updateSupportTicketStatusCore({
        db,
        admin: mockAdmin,
        authUid: SUPERADMIN_UID,
        callerName: 'Juan Esteban',
        isSuperAdmin: true,
        ticketId,
        status: 'CLOSED',
        reason: 'Problema solucionado por soporte de credenciales.',
      });

      expect(res.success).toBe(true);
      expect(res.newStatus).toBe('CLOSED');

      const ticket = db.store.get(`supportTickets/${ticketId}`);
      expect(ticket.status).toBe('CLOSED');
      expect(ticket.closedReason).toBe('Problema solucionado por soporte de credenciales.');
      expect(ticket.closedByUid).toBe(SUPERADMIN_UID);
    });
  });

  // -----------------------------------------------------------------------
  // 7. CONTEXTO DIAGNÓSTICO DEL INVERSIONISTA (getSupportUserContextCore)
  // -----------------------------------------------------------------------
  describe('getSupportUserContextCore', () => {
    let ticketId: string;

    beforeEach(async () => {
      const created = await createSupportTicketCore({
        db,
        admin: mockAdmin,
        authUid: USER_UID,
        subject: 'Consulta de contexto',
        category: 'CYCLE',
        description: 'Revisión de mi saldo en el ciclo.',
      });
      ticketId = created.ticketId;

      // Seed CycleUserResult
      db.store.set(`cycleUserResults/2026-09_${USER_UID}`, {
        userUid: USER_UID,
        cycleId: '2026-09',
        totalUsdOperated: 145.5,
        totalGrossCop: 560000,
        userProfitCop: 420000,
        trmUsed: 3850,
      });
    });

    it('21. SuperAdmin obtiene contexto personal y operacional completo', async () => {
      const ctx = await getSupportUserContextCore({
        db,
        admin: mockAdmin,
        authUid: SUPERADMIN_UID,
        callerName: 'Juan Esteban',
        permissions: {},
        isSuperAdmin: true,
        ticketId,
      });

      expect(ctx.success).toBe(true);
      expect(ctx.hasUserContext).toBe(true);
      expect(ctx.hasOperationalContext).toBe(true);
      expect(ctx.user.fullName).toBe('Carlos Inversionista');
      expect(ctx.user.category).toBe('VERDE');
      expect(ctx.operationalContext.activeCycleId).toBe('2026-09');
      expect(ctx.operationalContext.currentResult.totalUsdOperated).toBe(145.5);
    });

    it('22. Agente con soporte básico pero sin supportReadUserContext no recibe contexto', async () => {
      const ctx = await getSupportUserContextCore({
        db,
        admin: mockAdmin,
        authUid: AGENT_UID,
        callerName: 'Agente Sin Permiso',
        permissions: { supportAgent: true, supportReadUserContext: false },
        isSuperAdmin: false,
        ticketId,
      });

      expect(ctx.success).toBe(true);
      expect(ctx.hasUserContext).toBe(false);
      expect(ctx.hasOperationalContext).toBe(false);
      expect(ctx.user).toBeUndefined();
    });

    it('23. Agente con supportReadUserContext pero sin supportReadOperationalContext no ve finanzas operativas', async () => {
      const ctx = await getSupportUserContextCore({
        db,
        admin: mockAdmin,
        authUid: AGENT_UID,
        callerName: 'Agente Perfil',
        permissions: {
          supportAgent: true,
          supportReadUserContext: true,
          supportReadOperationalContext: false,
        },
        isSuperAdmin: false,
        ticketId,
      });

      expect(ctx.success).toBe(true);
      expect(ctx.hasUserContext).toBe(true);
      expect(ctx.hasOperationalContext).toBe(false);
      expect(ctx.user.fullName).toBe('Carlos Inversionista');
      expect(ctx.operationalContext).toBeNull();
    });

    it('24. Contexto de auditoría FAIL-CLOSED: Si falla escribir en auditLogs, aborta y no entrega datos', async () => {
      // Mock db.collection("auditLogs").add throwing error
      const brokenDb = {
        ...db,
        collection: (colName: string) => {
          if (colName === 'auditLogs') {
            return {
              add: async () => {
                throw new Error('DATABASE_AUDIT_WRITE_ERROR');
              },
            };
          }
          return db.collection(colName);
        },
      };

      await expect(
        getSupportUserContextCore({
          db: brokenDb as any,
          admin: mockAdmin,
          authUid: SUPERADMIN_UID,
          callerName: 'Juan Esteban',
          permissions: {},
          isSuperAdmin: true,
          ticketId,
        })
      ).rejects.toThrow('DATABASE_AUDIT_WRITE_ERROR');
    });
  });

  // -----------------------------------------------------------------------
  // 8. SEGURIDAD DE PRIVILEGIOS Y ESCALACIÓN (Requerimiento A)
  // -----------------------------------------------------------------------
  describe('Seguridad contra escalación de privilegios (Requerimiento A)', () => {
    it('25. Usuario regular modifica su email en Firestore al de SuperAdmin pero su token auth es real -> Denegado al responder ticket ajeno', async () => {
      // 1. Inversionista USER modifica su perfil en Firestore a un email de SuperAdmin
      db.store.set(`users/${OTHER_USER_UID}`, {
        ...db.store.get(`users/${OTHER_USER_UID}`),
        email: SUPERADMIN_EMAIL, // Spoofed email en Firestore doc
        role: 'USER',
        status: 'ACTIVE',
      });

      // 2. Crear ticket perteneciente a USER_UID
      const created = await createSupportTicketCore({
        db,
        admin: mockAdmin,
        authUid: USER_UID,
        subject: 'Ticket privado de otro usuario',
        category: 'CAPITAL',
        description: 'Información confidencial de depósitos.',
      });

      // 3. OTHER_USER_UID (cuyo token email es real 'otro@easytraders.com') intenta responder
      const actorContext = {
        authUid: OTHER_USER_UID,
        authEmail: 'otro@easytraders.com',
        isSuperAdmin: false,
        isSupportAgent: false,
        callerName: 'Ana Inversionista',
        callerUserCode: 'INV-099',
      };

      await expect(
        replySupportTicketCore({
          db,
          admin: mockAdmin,
          authUid: OTHER_USER_UID,
          ticketId: created.ticketId,
          text: 'Intento de respuesta atacante.',
          clientRequestId: '33333333-4444-4555-8666-777777777777',
          actorContext,
        })
      ).rejects.toThrow(/Acceso denegado/);
    });
  });

  // -----------------------------------------------------------------------
  // 9. IDEMPOTENCIA Y CONCURRENCIA REAL (Requerimientos C y D)
  // -----------------------------------------------------------------------
  describe('Idempotencia autoritativa y concurrencia (Requerimientos C y D)', () => {
    it('26. Dos solicitudes concurrentes con el mismo clientRequestId generan exactamente 1 ticket y 1 número de ticket', async () => {
      const clientRequestId = '44444444-5555-4666-8777-888888888888';
      const payload = {
        db,
        admin: mockAdmin,
        authUid: USER_UID,
        subject: 'Ticket para prueba de concurrencia',
        category: 'TECHNICAL',
        description: 'Probando idempotencia en llamadas simultáneas.',
        clientRequestId,
      };

      const [res1, res2] = await Promise.all([
        createSupportTicketCore(payload as any),
        createSupportTicketCore(payload as any),
      ]);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      expect(res1.ticketId).toBe(res2.ticketId);
      expect(res1.ticketNumber).toBe(res2.ticketNumber);
      // Una fue creación original y la otra fue replay idempotente
      expect(res1.idempotentReplay || res2.idempotentReplay).toBe(true);

      // Verificar que el counter solo se incrementó en 1
      const counterDoc = db.store.get('counters/supportTickets');
      expect(counterDoc.nextTicketNumber).toBe(2);
    });

    it('27. Mismo clientRequestId con payload distinto lanza IDEMPOTENCY_KEY_CONFLICT', async () => {
      const clientRequestId = '55555555-6666-4777-8888-999999999999';

      await createSupportTicketCore({
        db,
        admin: mockAdmin,
        authUid: USER_UID,
        subject: 'Primer Asunto',
        category: 'TECHNICAL',
        description: 'Primera descripción.',
        clientRequestId,
      });

      await expect(
        createSupportTicketCore({
          db,
          admin: mockAdmin,
          authUid: USER_UID,
          subject: 'Segundo Asunto Modificado',
          category: 'TECHNICAL',
          description: 'Segunda descripción diferente.',
          clientRequestId,
        })
      ).rejects.toThrow(/IDEMPOTENCY_KEY_CONFLICT/);
    });

    it('28. Idempotencia en respuestas, notas, asignación y cambios de estado', async () => {
      db.store.set(`users/${AGENT_UID}`, {
        ...db.store.get(`users/${AGENT_UID}`),
        permissions: { supportAgent: true },
      });

      const created = await createSupportTicketCore({
        db,
        admin: mockAdmin,
        authUid: USER_UID,
        subject: 'Ticket para pruebas completas de idempotencia',
        category: 'CYCLE',
        description: 'Prueba de todos los cores.',
      });
      const ticketId = created.ticketId;

      // 1. Reply Replay
      const replyReqId = '66666666-7777-4888-8999-000000000000';
      const rep1 = await replySupportTicketCore({
        db,
        admin: mockAdmin,
        authUid: USER_UID,
        ticketId,
        text: 'Mi primera respuesta.',
        clientRequestId: replyReqId,
      });
      const rep2 = await replySupportTicketCore({
        db,
        admin: mockAdmin,
        authUid: USER_UID,
        ticketId,
        text: 'Mi primera respuesta.',
        clientRequestId: replyReqId,
      });
      expect(rep1.success).toBe(true);
      expect(rep2.idempotentReplay).toBe(true);
      expect(rep1.messageId).toBe(rep2.messageId);

      // 2. Note Replay
      const noteReqId = '77777777-8888-4999-8000-111111111111';
      const note1 = await addInternalNoteCore({
        db,
        admin: mockAdmin,
        authUid: SUPERADMIN_UID,
        ticketId,
        noteText: 'Nota confidencial idempotente.',
        clientRequestId: noteReqId,
      });
      const note2 = await addInternalNoteCore({
        db,
        admin: mockAdmin,
        authUid: SUPERADMIN_UID,
        ticketId,
        noteText: 'Nota confidencial idempotente.',
        clientRequestId: noteReqId,
      });
      expect(note1.success).toBe(true);
      expect(note2.idempotentReplay).toBe(true);
      expect(note1.noteId).toBe(note2.noteId);

      // 3. Assign Replay
      const assignReqId = '88888888-9999-4000-8111-222222222222';
      const assign1 = await assignSupportTicketCore({
        db,
        admin: mockAdmin,
        authUid: SUPERADMIN_UID,
        callerName: 'Juan Esteban',
        isSuperAdmin: true,
        ticketId,
        assignedToUid: AGENT_UID,
        clientRequestId: assignReqId,
      });
      const assign2 = await assignSupportTicketCore({
        db,
        admin: mockAdmin,
        authUid: SUPERADMIN_UID,
        callerName: 'Juan Esteban',
        isSuperAdmin: true,
        ticketId,
        assignedToUid: AGENT_UID,
        clientRequestId: assignReqId,
      });
      expect(assign1.success).toBe(true);
      expect(assign2.idempotentReplay).toBe(true);

      // 4. Status Update Replay
      const statusReqId = '99999999-0000-4111-8222-333333333333';
      const st1 = await updateSupportTicketStatusCore({
        db,
        admin: mockAdmin,
        authUid: SUPERADMIN_UID,
        callerName: 'Juan Esteban',
        isSuperAdmin: true,
        ticketId,
        status: 'RESOLVED',
        clientRequestId: statusReqId,
      });
      const st2 = await updateSupportTicketStatusCore({
        db,
        admin: mockAdmin,
        authUid: SUPERADMIN_UID,
        callerName: 'Juan Esteban',
        isSuperAdmin: true,
        ticketId,
        status: 'RESOLVED',
        clientRequestId: statusReqId,
      });
      expect(st1.success).toBe(true);
      expect(st2.idempotentReplay).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 10. NOTIFICACIONES EXACTLY-ONCE Y FANOUT (Requerimientos E y F)
  // -----------------------------------------------------------------------
  describe('Notificaciones Exactly-Once y Fanout (Requerimientos E y F)', () => {
    it('29. Notificación de respuesta sin agente asignado realiza fanout a agentes activos y SuperAdmins con IDs determinísticos', async () => {
      // Crear agente activo
      db.store.set(`users/${AGENT_UID}`, {
        ...db.store.get(`users/${AGENT_UID}`),
        status: 'ACTIVE',
        permissions: { supportAgent: true },
      });

      // Crear ticket sin asignar
      const created = await createSupportTicketCore({
        db,
        admin: mockAdmin,
        authUid: USER_UID,
        subject: 'Ticket sin agente asignado',
        category: 'OTHER',
        description: 'Esperando atención.',
      });
      const ticketId = created.ticketId;

      const replyReqId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      await replySupportTicketCore({
        db,
        admin: mockAdmin,
        authUid: USER_UID,
        ticketId,
        text: '¿Alguien me puede atender?',
        clientRequestId: replyReqId,
      });

      // Verificar que se crearon notificaciones determinísticas para AGENT_UID y SUPERADMIN_UID
      const agentNotifId = `notif_sup_reply_${replyReqId}_${AGENT_UID}`;
      const superAdminNotifId = `notif_sup_reply_${replyReqId}_${SUPERADMIN_UID}`;

      const agentNotif = db.store.get(`notifications/${agentNotifId}`);
      const superAdminNotif = db.store.get(`notifications/${superAdminNotifId}`);

      expect(agentNotif).toBeDefined();
      expect(agentNotif.title).toContain('Respuesta de usuario');
      expect(superAdminNotif).toBeDefined();
      expect(superAdminNotif.title).toContain('Respuesta de usuario');
    });
  });
});
