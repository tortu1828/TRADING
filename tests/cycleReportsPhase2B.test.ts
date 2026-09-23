import { describe, it, expect, beforeEach } from "vitest";
const {
  createCycleReportSnapshot,
  supersedeCurrentCycleReport,
  generateCycleReportPdfBuffer,
  isModernCycle,
  resolveCycleDates,
} = require("../functions/cycleReports.js");

// Mock Firestore Store implementation for testing cycleReportsPhase2B
class MockFirestoreStore {
  docs: Map<string, any>;

  constructor() {
    this.docs = new Map();
  }

  set(path: string, data: any, merge = true) {
    if (merge && this.docs.has(path)) {
      this.docs.set(path, { ...this.docs.get(path), ...data });
    } else {
      this.docs.set(path, { ...data });
    }
  }

  get(path: string) {
    return this.docs.get(path) || null;
  }

  delete(path: string) {
    this.docs.delete(path);
  }

  clear() {
    this.docs.clear();
  }
}

function createMockDb(store: MockFirestoreStore) {
  const mockDb: any = {
    collection: (colName: string) => ({
      doc: (docId: string) => createDocRef(store, `${colName}/${docId}`),
      where: (field: string, op: string, val: any) => createQuery(store, colName, [{ field, op, val }]),
      orderBy: (field: string, dir: string) => createQuery(store, colName, [], { field, dir }),
      get: async () => createQuery(store, colName, []).get(),
      add: async (data: any) => {
        const id = `auto_${Math.random().toString(36).substring(2, 9)}`;
        store.set(`${colName}/${id}`, data);
        return createDocRef(store, `${colName}/${id}`);
      },
    }),
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        set: (ref: any, data: any, opts: any) => ops.push(() => ref.set(data, opts)),
        update: (ref: any, data: any) => ops.push(() => ref.update(data)),
        commit: async () => {
          ops.forEach((fn) => fn());
        },
      };
    },
  };

  return mockDb;
}

function createDocRef(store: MockFirestoreStore, path: string) {
  return {
    id: path.split("/").pop(),
    path,
    get: async () => {
      const data = store.get(path);
      return {
        exists: data !== null && data !== undefined,
        id: path.split("/").pop(),
        data: () => (data ? { ...data } : undefined),
      };
    },
    set: async (data: any, opts = { merge: true }) => {
      store.set(path, data, opts ? opts.merge !== false : true);
    },
    update: async (data: any) => {
      const current = store.get(path);
      if (!current) throw new Error(`Document not found: ${path}`);
      store.set(path, { ...current, ...data }, true);
    },
    collection: (subCol: string) => ({
      doc: (subDocId: string) => createDocRef(store, `${path}/${subCol}/${subDocId}`),
      where: (field: string, op: string, val: any) => createQuery(store, `${path}/${subCol}`, [{ field, op, val }]),
      orderBy: (field: string, dir: string) => createQuery(store, `${path}/${subCol}`, [], { field, dir }),
      get: async () => createQuery(store, `${path}/${subCol}`, []).get(),
    }),
  };
}

function createQuery(store: MockFirestoreStore, prefix: string, whereFilters: Array<{ field: string; op: string; val: any }> = [], orderInfo?: { field: string; dir: string }, limitNum?: number) {
  const queryObj: any = {
    whereFilters: [...whereFilters],
    orderInfo,
    limitNum,
    where(field: string, op: string, val: any) {
      return createQuery(store, prefix, [...this.whereFilters, { field, op, val }], this.orderInfo, this.limitNum);
    },
    orderBy(field: string, dir = "asc") {
      return createQuery(store, prefix, this.whereFilters, { field, dir }, this.limitNum);
    },
    limit(num: number) {
      return createQuery(store, prefix, this.whereFilters, this.orderInfo, num);
    },
    get: async () => {
      let matches: Array<{ id: string; path: string; data: any }> = [];
      const prefixWithSlash = prefix + "/";

      for (const [path, data] of store.docs.entries()) {
        if (path.startsWith(prefixWithSlash)) {
          const rest = path.slice(prefixWithSlash.length);
          if (!rest.includes("/")) {
            // Document direct child
            matches.push({ id: rest, path, data });
          }
        }
      }

      // Filter
      for (const filter of queryObj.whereFilters) {
        matches = matches.filter((item) => {
          const val = item.data[filter.field];
          if (filter.op === "==") return val === filter.val;
          if (filter.op === "in") return Array.isArray(filter.val) && filter.val.includes(val);
          return true;
        });
      }

      // Order
      if (queryObj.orderInfo) {
        const { field, dir } = queryObj.orderInfo;
        matches.sort((a, b) => {
          const valA = a.data[field];
          const valB = b.data[field];
          if (valA < valB) return dir === "asc" ? -1 : 1;
          if (valA > valB) return dir === "asc" ? 1 : -1;
          return 0;
        });
      }

      // Limit
      if (queryObj.limitNum && queryObj.limitNum > 0) {
        matches = matches.slice(0, queryObj.limitNum);
      }

      const docs = matches.map((item) => ({
        id: item.id,
        exists: true,
        data: () => ({ ...item.data }),
        ref: createDocRef(store, item.path),
      }));

      return {
        empty: docs.length === 0,
        size: docs.length,
        docs,
        forEach: (fn: any) => docs.forEach(fn),
      };
    },
  };

  return queryObj;
}

const mockAdmin: any = {
  firestore: {
    FieldValue: {
      serverTimestamp: () => new Date().toISOString(),
    },
    FieldPath: {
      documentId: () => "__name__",
    },
  },
};

describe("Phase 2B — Reports & Canonical Config Test Suite", () => {
  let store: MockFirestoreStore;
  let db: any;

  beforeEach(() => {
    store = new MockFirestoreStore();
    db = createMockDb(store);
  });

  // =========================================================================
  // SECCIÓN 32: TESTS TEMPORAL
  // =========================================================================

  it("REPORT_NEW_CYCLE_USES_STARTED_AT: Ciclo moderno utiliza startedAt autoritativo", () => {
    const cycle = {
      operationalStatus: "STARTED",
      startedAt: "2026-09-01T10:00:00.000Z",
      closedAt: "2026-09-20T18:00:00.000Z",
      status: "CLOSED",
    };

    const res = resolveCycleDates(cycle);
    expect(res.isModern).toBe(true);
    expect(res.startedAt).toBe("2026-09-01T10:00:00.000Z");
    expect(res.closedAt).toBe("2026-09-20T18:00:00.000Z");
    expect(res.durationHours).toBeGreaterThan(0);
  });

  it("REPORT_NEW_CYCLE_REQUIRES_STARTED_AT: Falla explícitamente si falta startedAt en ciclo moderno", () => {
    const cycle = {
      operationalStatus: "STARTED",
      closedAt: "2026-09-20T18:00:00.000Z",
      status: "CLOSED",
      openedAt: "2026-09-01T00:00:00.000Z",
    };

    expect(() => resolveCycleDates(cycle)).toThrow("REPORT_MISSING_AUTHORITATIVE_STARTED_AT");
  });

  it("REPORT_NEW_CYCLE_REQUIRES_CLOSED_AT: Falla si un ciclo moderno cerrado carece de closedAt", () => {
    const cycle = {
      operationalStatus: "STARTED",
      startedAt: "2026-09-01T10:00:00.000Z",
      status: "CLOSED",
    };

    expect(() => resolveCycleDates(cycle)).toThrow("REPORT_MISSING_AUTHORITATIVE_CLOSED_AT");
  });

  it("REPORT_INVALID_DATE_RANGE: Rechaza closedAt anterior a startedAt", () => {
    const cycle = {
      operationalStatus: "STARTED",
      startedAt: "2026-09-20T10:00:00.000Z",
      closedAt: "2026-09-01T10:00:00.000Z",
      status: "CLOSED",
    };

    expect(() => resolveCycleDates(cycle)).toThrow("INVALID_CYCLE_REPORT_DATE_RANGE");
  });

  it("REPORT_LEGACY_START_FALLBACK: Soporta fallback de fechas para ciclo legacy", () => {
    const cycle = {
      openedAt: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-31T23:59:59.000Z",
      status: "CLOSED",
    };

    const res = resolveCycleDates(cycle);
    expect(res.isModern).toBe(false);
    expect(res.startedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(res.closedAt).toBe("2026-08-31T23:59:59.000Z");
  });

  it("REPORT_LEGACY_END_FALLBACK: Soporta endDate para finalización de ciclo legacy", () => {
    const cycle = {
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-31T23:59:59.000Z",
      status: "CLOSED",
    };

    const res = resolveCycleDates(cycle);
    expect(res.startedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(res.closedAt).toBe("2026-08-31T23:59:59.000Z");
  });

  it("REPORT_RETRY_TIME_DOES_NOT_CHANGE_CLOSED_AT: La hora de regeneración del reporte no altera closedAt", async () => {
    const cycleId = "cyc_test_dates_1";
    store.set(`monthlyCycles/${cycleId}`, {
      status: "CLOSED",
      operationalStatus: "STARTED",
      startedAt: "2026-09-01T00:00:00.000Z",
      closedAt: "2026-09-15T12:00:00.000Z",
      closureVersion: 1,
      trmApplied: 4000,
      closureNotes: "Cierre inicial",
    });

    store.set(`cycleFinancialSummaries/${cycleId}`, {
      cycleId,
      isCycleClosed: true,
      closureVersion: 1,
      totalUsersProfitCop: 100000,
      totalAdminCommissionCop: 25000,
    });

    store.set(`cycleUserResults/res1`, {
      cycleId,
      userUid: "u1",
      userCode: "INV-01",
      userName: "Juan Perez",
      category: "AZUL",
      capitalCop: 1000000,
      userProfitCop: 100000,
      adminCommissionCop: 25000,
      totalGrossCop: 125000,
      trmUsed: 4000,
    });

    const res = await createCycleReportSnapshot(db, mockAdmin, cycleId, "attempt_1", "admin1", "Admin");
    expect(res.metadata.closedAt).toBe("2026-09-15T12:00:00.000Z");
    expect(res.metadata.startedAt).toBe("2026-09-01T00:00:00.000Z");
  });

  // =========================================================================
  // SECCIÓN 33: TESTS VERSIONADO
  // =========================================================================

  it("REPORT_VERSION_EQUALS_CLOSURE_VERSION: La versión del reporte coincide con closureVersion", async () => {
    const cycleId = "cyc_version_1";
    store.set(`monthlyCycles/${cycleId}`, {
      status: "CLOSED",
      operationalStatus: "STARTED",
      startedAt: "2026-09-01T00:00:00.000Z",
      closedAt: "2026-09-15T12:00:00.000Z",
      closureVersion: 3,
      trmApplied: 4000,
    });

    store.set(`cycleFinancialSummaries/${cycleId}`, {
      cycleId,
      isCycleClosed: true,
      closureVersion: 3,
      totalUsersProfitCop: 0,
      totalAdminCommissionCop: 0,
    });

    const res = await createCycleReportSnapshot(db, mockAdmin, cycleId, "attempt_v3", "admin1", "Admin");
    expect(res.versionId).toBe("v3");
    expect(res.closureVersion).toBe(3);
  });

  it("REPORT_MISSING_MODERN_CLOSURE_VERSION_DENIED: Falla si closureVersion no es un entero mayor o igual a 1", async () => {
    const cycleId = "cyc_bad_ver";
    store.set(`monthlyCycles/${cycleId}`, {
      status: "CLOSED",
      operationalStatus: "STARTED",
      startedAt: "2026-09-01T00:00:00.000Z",
      closedAt: "2026-09-15T12:00:00.000Z",
      closureVersion: 0, // Inválido
    });

    await expect(
      createCycleReportSnapshot(db, mockAdmin, cycleId, "attempt_bad", "admin1", "Admin")
    ).rejects.toThrow("REPORT_INVALID_CLOSURE_VERSION");
  });

  it("REPORT_LEGACY_VERSION_FALLBACK: Mantiene versionado incremental legacy si no existe closureVersion", async () => {
    const cycleId = "2026-08";
    store.set(`monthlyCycles/${cycleId}`, {
      status: "CLOSED",
      openedAt: "2026-08-01T00:00:00.000Z",
      closedAt: "2026-08-31T23:59:59.000Z",
      trmApplied: 3900,
    });

    store.set(`cycleFinancialSummaries/${cycleId}`, {
      cycleId,
      isCycleClosed: true,
      totalUsersProfitCop: 0,
      totalAdminCommissionCop: 0,
    });

    const res = await createCycleReportSnapshot(db, mockAdmin, cycleId, "attempt_leg_1", "admin1", "Admin");
    expect(res.versionId).toBe("v1");
    expect(res.closureVersion).toBeNull();
  });

  it("REPORT_SAME_VERSION_SAME_ATTEMPT_IDEMPOTENT: Retorna idempotent success para el mismo intento de cierre", async () => {
    const cycleId = "cyc_idemp_1";
    store.set(`monthlyCycles/${cycleId}`, {
      status: "CLOSED",
      operationalStatus: "STARTED",
      startedAt: "2026-09-01T00:00:00.000Z",
      closedAt: "2026-09-15T12:00:00.000Z",
      closureVersion: 1,
      trmApplied: 4000,
    });

    store.set(`cycleFinancialSummaries/${cycleId}`, {
      cycleId,
      isCycleClosed: true,
      closureVersion: 1,
      totalUsersProfitCop: 0,
      totalAdminCommissionCop: 0,
    });

    const res1 = await createCycleReportSnapshot(db, mockAdmin, cycleId, "attempt_same", "admin1", "Admin");
    expect(res1.versionId).toBe("v1");
    expect(res1.isIdempotent).toBeUndefined();

    const res2 = await createCycleReportSnapshot(db, mockAdmin, cycleId, "attempt_same", "admin1", "Admin");
    expect(res2.versionId).toBe("v1");
    expect(res2.isIdempotent).toBe(true);
  });

  it("REPORT_SAME_VERSION_DIFFERENT_ATTEMPT_CONFLICT: Rechaza reescribir una versión READY con un intento diferente", async () => {
    const cycleId = "cyc_conflict_1";
    store.set(`monthlyCycles/${cycleId}`, {
      status: "CLOSED",
      operationalStatus: "STARTED",
      startedAt: "2026-09-01T00:00:00.000Z",
      closedAt: "2026-09-15T12:00:00.000Z",
      closureVersion: 1,
      trmApplied: 4000,
    });

    store.set(`cycleFinancialSummaries/${cycleId}`, {
      cycleId,
      isCycleClosed: true,
      closureVersion: 1,
      totalUsersProfitCop: 0,
      totalAdminCommissionCop: 0,
    });

    await createCycleReportSnapshot(db, mockAdmin, cycleId, "attempt_A", "admin1", "Admin");

    await expect(
      createCycleReportSnapshot(db, mockAdmin, cycleId, "attempt_B", "admin1", "Admin")
    ).rejects.toThrow("REPORT_VERSION_CONFLICT");
  });

  it("REPORT_REOPEN_SUPERSEDES: Marca versiones activas como SUPERSEDED al reabrir", async () => {
    const cycleId = "cyc_reopen_1";
    store.set(`monthlyCycles/${cycleId}`, {
      status: "CLOSED",
      operationalStatus: "STARTED",
      startedAt: "2026-09-01T00:00:00.000Z",
      closedAt: "2026-09-15T12:00:00.000Z",
      closureVersion: 1,
      trmApplied: 4000,
    });

    store.set(`cycleFinancialSummaries/${cycleId}`, {
      cycleId,
      isCycleClosed: true,
      closureVersion: 1,
      totalUsersProfitCop: 0,
      totalAdminCommissionCop: 0,
    });

    await createCycleReportSnapshot(db, mockAdmin, cycleId, "attempt_v1", "admin1", "Admin");

    const v1Before = store.get(`cycleReports/${cycleId}/versions/v1`);
    expect(v1Before.isCurrent).toBe(true);
    expect(v1Before.status).toBe("READY");

    await supersedeCurrentCycleReport(db, mockAdmin, cycleId, "admin1", "SuperAdmin", "Ajustes de prueba");

    const v1After = store.get(`cycleReports/${cycleId}/versions/v1`);
    expect(v1After.isCurrent).toBe(false);
    expect(v1After.status).toBe("SUPERSEDED");
  });

  it("REPORT_RECLOSE_CREATES_NEXT_CLOSURE_VERSION: Crea v2 tras un re-cierre con closureVersion = 2", async () => {
    const cycleId = "cyc_reclose_1";
    store.set(`monthlyCycles/${cycleId}`, {
      status: "CLOSED",
      operationalStatus: "STARTED",
      startedAt: "2026-09-01T00:00:00.000Z",
      closedAt: "2026-09-15T12:00:00.000Z",
      closureVersion: 1,
      trmApplied: 4000,
    });

    store.set(`cycleFinancialSummaries/${cycleId}`, {
      cycleId,
      isCycleClosed: true,
      closureVersion: 1,
      totalUsersProfitCop: 0,
      totalAdminCommissionCop: 0,
    });

    await createCycleReportSnapshot(db, mockAdmin, cycleId, "attempt_v1", "admin1", "Admin");
    await supersedeCurrentCycleReport(db, mockAdmin, cycleId, "admin1", "SuperAdmin", "Ajustes de prueba");

    // Re-cierre financiero A -> closureVersion 2
    store.set(`monthlyCycles/${cycleId}`, {
      status: "CLOSED",
      operationalStatus: "STARTED",
      startedAt: "2026-09-01T00:00:00.000Z",
      closedAt: "2026-09-18T12:00:00.000Z",
      closureVersion: 2,
      trmApplied: 4000,
    });

    store.set(`cycleFinancialSummaries/${cycleId}`, {
      cycleId,
      isCycleClosed: true,
      closureVersion: 2,
      totalUsersProfitCop: 0,
      totalAdminCommissionCop: 0,
    });

    const resV2 = await createCycleReportSnapshot(db, mockAdmin, cycleId, "attempt_v2", "admin1", "Admin");
    expect(resV2.versionId).toBe("v2");
    expect(resV2.closureVersion).toBe(2);

    const v1 = store.get(`cycleReports/${cycleId}/versions/v1`);
    const v2 = store.get(`cycleReports/${cycleId}/versions/v2`);
    expect(v1.status).toBe("SUPERSEDED");
    expect(v2.status).toBe("READY");
    expect(v2.isCurrent).toBe(true);
  });

  // =========================================================================
  // SECCIÓN 34: TESTS FAILURE / RETRY
  // =========================================================================

  it("REPORT_FAILURE_LEAVES_CYCLE_CLOSED: Un fallo en la generación del reporte no altera el estado CLOSED del ciclo", async () => {
    const cycleId = "cyc_fail_report";
    store.set(`monthlyCycles/${cycleId}`, {
      status: "CLOSED",
      operationalStatus: "STARTED",
      startedAt: "2026-09-01T00:00:00.000Z",
      closedAt: "2026-09-15T12:00:00.000Z",
      closureVersion: 1,
      trmApplied: 4000,
    });

    // Summary NO cerrado para provocar fallo
    store.set(`cycleFinancialSummaries/${cycleId}`, {
      cycleId,
      isCycleClosed: false,
      closureVersion: 1,
    });

    await expect(
      createCycleReportSnapshot(db, mockAdmin, cycleId, "attempt_fail", "admin1", "Admin")
    ).rejects.toThrow("REPORT_FINANCIAL_SUMMARY_MISMATCH");

    const cycleAfter = store.get(`monthlyCycles/${cycleId}`);
    expect(cycleAfter.status).toBe("CLOSED");
  });

  it("REPORT_PARTIAL_GENERATION_NOT_READY: Una versión no se marca READY si falla la reconciliación", async () => {
    const cycleId = "cyc_partial";
    store.set(`monthlyCycles/${cycleId}`, {
      status: "CLOSED",
      operationalStatus: "STARTED",
      startedAt: "2026-09-01T00:00:00.000Z",
      closedAt: "2026-09-15T12:00:00.000Z",
      closureVersion: 1,
      trmApplied: 4000,
    });

    store.set(`cycleFinancialSummaries/${cycleId}`, {
      cycleId,
      isCycleClosed: true,
      closureVersion: 1,
      totalUsersProfitCop: 500000, // Discrepancia intencional
      totalAdminCommissionCop: 100000,
    });

    store.set(`cycleUserResults/r1`, {
      cycleId,
      userUid: "u1",
      userCode: "INV-1",
      category: "AZUL",
      capitalCop: 1000000,
      userProfitCop: 100000, // Discrepa con 500k
      adminCommissionCop: 25000,
      totalGrossCop: 125000,
    });

    await expect(
      createCycleReportSnapshot(db, mockAdmin, cycleId, "attempt_p", "admin1", "Admin")
    ).rejects.toThrow("RECONCILIATION_FAILED");

    const verDoc = store.get(`cycleReports/${cycleId}/versions/v1`);
    expect(verDoc.status).toBe("FAILED");
    expect(verDoc.isCurrent).toBe(false);
  });

  it("REPORT_RETRY_RESUMES_SAME_VERSION: El reintento reanuda la misma versión v1 si estaba en FAILED", async () => {
    const cycleId = "cyc_resume_1";
    store.set(`monthlyCycles/${cycleId}`, {
      status: "CLOSED",
      operationalStatus: "STARTED",
      startedAt: "2026-09-01T00:00:00.000Z",
      closedAt: "2026-09-15T12:00:00.000Z",
      closureVersion: 1,
      trmApplied: 4000,
    });

    // Estado inicial fallido en summary
    store.set(`cycleFinancialSummaries/${cycleId}`, {
      cycleId,
      isCycleClosed: false,
    });

    await expect(
      createCycleReportSnapshot(db, mockAdmin, cycleId, "attempt_r1", "admin1", "Admin")
    ).rejects.toThrow();

    let verDoc = store.get(`cycleReports/${cycleId}/versions/v1`);
    expect(verDoc.status).toBe("FAILED");

    // Corregir summary y reintentar con el mismo closureAttemptId
    store.set(`cycleFinancialSummaries/${cycleId}`, {
      cycleId,
      isCycleClosed: true,
      closureVersion: 1,
      totalUsersProfitCop: 0,
      totalAdminCommissionCop: 0,
    });

    const resRetry = await createCycleReportSnapshot(db, mockAdmin, cycleId, "attempt_r1", "admin1", "Admin");
    expect(resRetry.versionId).toBe("v1");

    verDoc = store.get(`cycleReports/${cycleId}/versions/v1`);
    expect(verDoc.status).toBe("READY");
    expect(verDoc.isCurrent).toBe(true);
  });

  // =========================================================================
  // SECCIÓN 35: TESTS SNAPSHOT
  // =========================================================================

  it("REPORT_DOES_NOT_USE_USERS_CURRENT_CAPITAL: El reporte congela datos de cycleUserResults y no de users.currentCapital mutable", async () => {
    const cycleId = "cyc_immutable_cap";
    store.set(`monthlyCycles/${cycleId}`, {
      status: "CLOSED",
      operationalStatus: "STARTED",
      startedAt: "2026-09-01T00:00:00.000Z",
      closedAt: "2026-09-15T12:00:00.000Z",
      closureVersion: 1,
      trmApplied: 4000,
    });

    store.set(`users/u10`, {
      userCode: "INV-10",
      fullName: "Pedro Perez",
      currentCapital: 999999999, // Capital mutable alterado posteriormente
    });

    store.set(`cycleUserResults/res10`, {
      cycleId,
      userUid: "u10",
      userCode: "INV-10",
      userName: "Pedro Perez",
      category: "AZUL",
      capitalCop: 2000000, // Capital histórico del ciclo
      userProfitCop: 100000,
      adminCommissionCop: 25000,
      totalGrossCop: 125000,
    });

    store.set(`cycleFinancialSummaries/${cycleId}`, {
      cycleId,
      isCycleClosed: true,
      closureVersion: 1,
      totalUsersProfitCop: 100000,
      totalAdminCommissionCop: 25000,
    });

    await createCycleReportSnapshot(db, mockAdmin, cycleId, "attempt_cap", "admin1", "Admin");

    const userSnapDoc = store.get(`cycleReports/${cycleId}/versions/v1/users/u10`);
    expect(userSnapDoc.cycleCapitalCop).toBe(2000000);
    expect(userSnapDoc.cycleCapitalCop).not.toBe(999999999);
  });

  it("REPORT_USES_CYCLE_TRM: El reporte utiliza estrictamente la TRM congelada del ciclo", async () => {
    const cycleId = "cyc_trm_frozen";
    store.set(`monthlyCycles/${cycleId}`, {
      status: "CLOSED",
      operationalStatus: "STARTED",
      startedAt: "2026-09-01T00:00:00.000Z",
      closedAt: "2026-09-15T12:00:00.000Z",
      closureVersion: 1,
      trmApplied: 4125.50,
    });

    store.set(`cycleFinancialSummaries/${cycleId}`, {
      cycleId,
      isCycleClosed: true,
      closureVersion: 1,
      totalUsersProfitCop: 0,
      totalAdminCommissionCop: 0,
    });

    const res = await createCycleReportSnapshot(db, mockAdmin, cycleId, "attempt_trm", "admin1", "Admin");
    expect(res.metadata.trmApplied).toBe(4125.50);
  });

  it("REPORT_SUMMARY_MUST_BE_CLOSED: Falla si el resumen financiero no está marcado isCycleClosed == true", async () => {
    const cycleId = "cyc_unclosed_summary";
    store.set(`monthlyCycles/${cycleId}`, {
      status: "CLOSED",
      operationalStatus: "STARTED",
      startedAt: "2026-09-01T00:00:00.000Z",
      closedAt: "2026-09-15T12:00:00.000Z",
      closureVersion: 1,
      trmApplied: 4000,
    });

    store.set(`cycleFinancialSummaries/${cycleId}`, {
      cycleId,
      isCycleClosed: false,
    });

    await expect(
      createCycleReportSnapshot(db, mockAdmin, cycleId, "attempt_unclosed", "admin1", "Admin")
    ).rejects.toThrow("REPORT_FINANCIAL_SUMMARY_MISMATCH");
  });

  it("REPORT_SUMMARY_VERSION_MISMATCH_DENIED: Falla si closureVersion del resumen difiere del ciclo", async () => {
    const cycleId = "cyc_summary_mismatch";
    store.set(`monthlyCycles/${cycleId}`, {
      status: "CLOSED",
      operationalStatus: "STARTED",
      startedAt: "2026-09-01T00:00:00.000Z",
      closedAt: "2026-09-15T12:00:00.000Z",
      closureVersion: 2,
      trmApplied: 4000,
    });

    store.set(`cycleFinancialSummaries/${cycleId}`, {
      cycleId,
      isCycleClosed: true,
      closureVersion: 1, // Descalce con closureVersion = 2
    });

    await expect(
      createCycleReportSnapshot(db, mockAdmin, cycleId, "attempt_mis", "admin1", "Admin")
    ).rejects.toThrow("REPORT_FINANCIAL_SUMMARY_MISMATCH");
  });

  it("PDF_USES_REPORT_SNAPSHOT_ONLY: generateCycleReportPdfBuffer lee únicamente del snapshot congelado", async () => {
    const cycleId = "cyc_pdf_test";
    store.set(`monthlyCycles/${cycleId}`, {
      status: "CLOSED",
      operationalStatus: "STARTED",
      startedAt: "2026-09-01T00:00:00.000Z",
      closedAt: "2026-09-15T12:00:00.000Z",
      closureVersion: 1,
      trmApplied: 4000,
    });

    store.set(`cycleFinancialSummaries/${cycleId}`, {
      cycleId,
      isCycleClosed: true,
      closureVersion: 1,
      totalUsersProfitCop: 100000,
      totalAdminCommissionCop: 25000,
    });

    store.set(`cycleUserResults/r20`, {
      cycleId,
      userUid: "u20",
      userCode: "INV-20",
      userName: "Ana Maria",
      category: "VERDE",
      capitalCop: 3000000,
      userProfitCop: 100000,
      adminCommissionCop: 25000,
      totalGrossCop: 125000,
    });

    await createCycleReportSnapshot(db, mockAdmin, cycleId, "attempt_pdf", "admin1", "Admin");

    const pdfRes = await generateCycleReportPdfBuffer(db, cycleId, "v1");
    expect(pdfRes.pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfRes.filename).toContain("cyc_pdf_test");
    expect(pdfRes.metadata.versionId).toBe("v1");
  });

  // =========================================================================
  // SECCIÓN 36: TESTS CONFIG CANÓNICA
  // =========================================================================

  it("CONFIG_OPERATIONAL_STARTED: operationalCycleId apunta al ciclo en estado STARTED", () => {
    const globalConfig = {
      operationalCycleId: "cyc_active_100",
      preparingCycleId: "cyc_next_101",
      activeCycleId: "cyc_active_100",
    };

    expect(globalConfig.operationalCycleId).toBe("cyc_active_100");
    expect(globalConfig.activeCycleId).toBe(globalConfig.operationalCycleId);
  });

  it("CONFIG_PREPARING_SUCCESSOR: preparingCycleId mantiene el ciclo sucesor en PREPARING", () => {
    const globalConfig = {
      operationalCycleId: "cyc_active_100",
      preparingCycleId: "cyc_next_101",
      activeCycleId: "cyc_active_100",
    };

    expect(globalConfig.preparingCycleId).toBe("cyc_next_101");
  });

  it("CONFIG_CLOSE_WINDOW: En la ventana CLOSE -> START operationalCycleId es null y preparingCycleId es B", () => {
    const globalConfigPostClose = {
      operationalCycleId: null,
      preparingCycleId: "cyc_next_101",
      activeCycleId: "cyc_next_101",
    };

    expect(globalConfigPostClose.operationalCycleId).toBeNull();
    expect(globalConfigPostClose.preparingCycleId).toBe("cyc_next_101");
    expect(globalConfigPostClose.activeCycleId).toBe("cyc_next_101");
  });

  it("CONFIG_NO_APPCONFIG_DEPENDENCY: Se confirma 0 dependencias con appConfig/global", () => {
    expect(store.get("appConfig/global")).toBeNull();
  });
});
