/**
 * ============================================================================
 * INFORMES OFICIALES DE CIERRE POR CICLO (SNAPSHOTS INMUTABLES) - BACKEND
 * ============================================================================
 * Módulo para generación, versionado, reconciliación y renderizado en PDF
 * de los informes oficiales de cierre en EasyTraders24.
 *
 * Principios:
 * 1. Los snapshots son 100% inmutables y congelan los valores financieros del cierre.
 * 2. Ningún informe histórico se recalcula con datos mutables de usuarios actuales.
 * 3. El PDF se genera estrictamente bajo demanda leyendo del snapshot del informe.
 * 4. Toda operación está protegida para acceso exclusivo de SuperAdmin.
 */

const PDFDocument = require("pdfkit");

/**
 * Formateador de moneda en pesos colombianos (COP).
 */
function formatCop(val) {
  const num = Math.round(Number(val) || 0);
  return "$" + num.toLocaleString("es-CO");
}

/**
 * Formateador de moneda en USD.
 */
function formatUsd(val) {
  const num = Number(val) || 0;
  return "$" + num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Formateador de fecha legible en español.
 */
function formatDateEs(isoDate) {
  if (!isoDate) return "N/D";
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return String(isoDate);
    return d.toLocaleString("es-CO", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/Bogota",
    });
  } catch {
    return String(isoDate);
  }
}

/**
 * Helper explícito para determinar si un ciclo utiliza el modelo moderno.
 * No infiere la modernidad únicamente por la cadena de `cycleId`.
 */
function isModernCycle(cycleData) {
  return Boolean(
    cycleData.operationalStatus ||
    (cycleData.closureVersion !== undefined && cycleData.closureVersion !== null) ||
    cycleData.previousCycleId ||
    cycleData.nextCycleId
  );
}

/**
 * Resuelve y valida autoritativamente el rango de fechas operativas del ciclo.
 */
function resolveCycleDates(cycleData) {
  const modern = isModernCycle(cycleData);

  let startedAt = null;
  let closedAt = null;

  if (modern) {
    if (!cycleData.startedAt) {
      throw new Error("REPORT_MISSING_AUTHORITATIVE_STARTED_AT: El ciclo moderno carece de fecha de inicio autoritativa 'startedAt'.");
    }
    startedAt = cycleData.startedAt;

    if (cycleData.status === "CLOSED" || cycleData.status === "REOPENED") {
      if (!cycleData.closedAt) {
        throw new Error("REPORT_MISSING_AUTHORITATIVE_CLOSED_AT: El ciclo moderno cerrado carece de fecha de cierre autoritativa 'closedAt'.");
      }
      closedAt = cycleData.closedAt;
    } else {
      closedAt = cycleData.closedAt || null;
    }
  } else {
    // Ciclo histórico legacy
    startedAt = cycleData.startedAt || cycleData.openedAt || cycleData.startDate || cycleData.createdAt || null;
    closedAt = cycleData.closedAt || cycleData.endDate || null;
  }

  if (!startedAt) {
    throw new Error("REPORT_MISSING_AUTHORITATIVE_STARTED_AT: No se pudo determinar la fecha de inicio autoritativa del ciclo.");
  }

  if (!closedAt && cycleData.status === "CLOSED") {
    throw new Error("REPORT_MISSING_AUTHORITATIVE_CLOSED_AT: No se pudo determinar la fecha de cierre autoritativa del ciclo.");
  }

  // Parsear y validar que closedAt >= startedAt
  const startMs = new Date(startedAt).getTime();
  const endMs = closedAt ? new Date(closedAt).getTime() : startMs;

  if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) {
    throw new Error("INVALID_CYCLE_REPORT_DATE_RANGE: Rango de fechas del ciclo inválido o closedAt es anterior a startedAt.");
  }

  const durationMs = endMs - startMs;
  const durationHours = durationMs / (1000 * 60 * 60);

  return {
    isModern: modern,
    startedAt,
    closedAt,
    openedAt: cycleData.openedAt || null,
    durationMs,
    durationHours,
  };
}

/**
 * Crea o recupera el snapshot oficial e inmutable del cierre de ciclo.
 *
 * @param {admin.firestore.Firestore} db Instancia de Firestore Admin
 * @param {admin} admin SDK de Admin
 * @param {string} cycleId ID del ciclo
 * @param {string} closureAttemptId ID del intento de cierre
 * @param {string} authUid UID del SuperAdmin ejecutor
 * @param {string} adminName Nombre del SuperAdmin ejecutor
 * @param {string} adminNotes Notas del cierre
 * @param {boolean} isRetrospective Si es una generación retrospectiva
 */
async function createCycleReportSnapshot(db, admin, cycleId, closureAttemptId, authUid, adminName, adminNotes = "", isRetrospective = false) {
  const targetCycleId = String(cycleId || "").trim();
  if (!targetCycleId) {
    throw new Error("createCycleReportSnapshot: 'cycleId' es requerido.");
  }

  const nowIso = new Date().toISOString();

  // 1. Obtener ciclo
  const cycleDocSnap = await db.collection("monthlyCycles").doc(targetCycleId).get();
  if (!cycleDocSnap.exists) {
    throw new Error(`El ciclo '${targetCycleId}' no existe en monthlyCycles.`);
  }
  const cycleData = cycleDocSnap.data() || {};
  const cycleName = cycleData.name || cycleData.title || targetCycleId;
  const trmApplied = Number(cycleData.trmApplied || cycleData.trmFinal || cycleData.trmSnapshot || 0);

  // 2. Resolver fechas autoritativas con guardrails estrictos
  const isModern = isModernCycle(cycleData);
  const dates = resolveCycleDates(cycleData);

  // 3. Determinar versionamiento autoritativo
  const versionsCollRef = db.collection("cycleReports").doc(targetCycleId).collection("versions");

  let versionId;
  let closureVersion = null;
  let versionNumber = 1;

  if (isModern) {
    if (!Number.isInteger(cycleData.closureVersion) || cycleData.closureVersion < 1) {
      throw new Error("REPORT_INVALID_CLOSURE_VERSION: El ciclo moderno debe poseer un closureVersion entero válido mayor o igual a 1.");
    }
    closureVersion = cycleData.closureVersion;
    versionNumber = closureVersion;
    versionId = `v${closureVersion}`;
  } else {
    // Legacy cycle versioning basado en el máximo número existente
    const lastVersionsSnap = await versionsCollRef
      .orderBy("versionNumber", "desc")
      .limit(1)
      .get();

    if (!lastVersionsSnap.empty) {
      const lastVer = lastVersionsSnap.docs[0].data();
      versionNumber = (Number(lastVer.versionNumber) || 0) + 1;
    }
    versionId = `v${versionNumber}`;
  }

  const effectiveClosureAttemptId = closureAttemptId || cycleData.lastClosureAttemptId || cycleData.closureAttemptId || `closure_${targetCycleId}_v${versionNumber}`;

  // 4. Guard de versión existente / Idempotencia y recuperación de fallos parciales
  const versionRef = versionsCollRef.doc(versionId);
  const versionSnap = await versionRef.get();

  if (versionSnap.exists) {
    const vData = versionSnap.data() || {};
    if (vData.status === "READY") {
      const sameAttempt = !vData.closureAttemptId || !effectiveClosureAttemptId || vData.closureAttemptId === effectiveClosureAttemptId;
      const sameClosureVersion = !isModern || vData.closureVersion === closureVersion;

      if (sameAttempt && sameClosureVersion) {
        return {
          isIdempotent: true,
          versionId,
          metadata: vData,
        };
      } else {
        throw new Error(`REPORT_VERSION_CONFLICT: La versión '${versionId}' ya existe en estado READY con metadata de cierre o intento diferente (${vData.closureAttemptId}).`);
      }
    }
    // Si la versión existe en estado GENERATING o FAILED, se reanuda la escritura sobre esta misma versión vN
  }

  // 5. Registrar/Actualizar estado inicial GENERATING de la versión
  await versionRef.set({
    id: versionId,
    cycleId: targetCycleId,
    cycleName,
    versionId,
    versionNumber,
    closureVersion: closureVersion || null,
    closureAttemptId: effectiveClosureAttemptId,
    status: "GENERATING",
    isCurrent: false,
    startedAt: dates.startedAt,
    openedAt: dates.openedAt,
    closedAt: dates.closedAt,
    durationHours: dates.durationHours,
    closedByUid: authUid,
    closedByName: adminName,
    adminNotes: adminNotes || "",
    trmApplied,
    createdAt: vDataExists(versionSnap) ? (versionSnap.data().createdAt || nowIso) : nowIso,
    snapshotGeneratedAt: nowIso,
    isRetrospective: Boolean(isRetrospective),
  }, { merge: true });

  function vDataExists(snap) {
    return snap && snap.exists;
  }

  // 6. Cargar datos de liquidación congelados (cycleUserResults)
  const resultsSnap = await db.collection("cycleUserResults")
    .where("cycleId", "==", targetCycleId)
    .get();

  if (resultsSnap.empty) {
    console.warn(`[createCycleReportSnapshot] No se encontraron resultados en cycleUserResults para ${targetCycleId}.`);
  }

  // 7. Cargar solicitudes de reinversión para cruzar utilidades y capitales asegurados
  const reinvSnap1 = await db.collection("reinvestments")
    .where("sourceCycleId", "==", targetCycleId)
    .get();
  const reinvSnap2 = await db.collection("reinvestments")
    .where("cycleId", "==", targetCycleId)
    .get();

  const reinvByUserUid = {};
  const mergeDoc = (doc) => {
    const rData = doc.data() || {};
    const uUid = rData.userUid || rData.userId;
    if (uUid && !reinvByUserUid[uUid]) {
      reinvByUserUid[uUid] = { id: doc.id, ...rData };
    }
  };
  reinvSnap1.forEach(mergeDoc);
  reinvSnap2.forEach(mergeDoc);

  // 8. Cargar usuarios únicamente si faltan metadatos visuales (userCode o userName)
  let profileMetadataFallbackUsed = false;
  const userUidsToFetch = [];
  resultsSnap.forEach((d) => {
    const ur = d.data();
    const uid = ur.userId || ur.userUid;
    if (uid && (!ur.userName || !ur.userCode)) {
      userUidsToFetch.push(uid);
    }
  });

  const userProfileMap = {};
  if (userUidsToFetch.length > 0) {
    profileMetadataFallbackUsed = true;
    const chunkSize = 30;
    for (let i = 0; i < userUidsToFetch.length; i += chunkSize) {
      const chunk = userUidsToFetch.slice(i, i + chunkSize);
      const uSnap = await db.collection("users").where(admin.firestore.FieldPath.documentId(), "in", chunk).get();
      uSnap.forEach((uDoc) => {
        userProfileMap[uDoc.id] = uDoc.data();
      });
    }
  }

  // 9. Construir snapshots individuales de cada inversionista
  const bitacoras = {
    AZUL: {
      category: "AZUL",
      usersCount: 0,
      managedCapitalCop: 0,
      totalUsdOperated: 0,
      grossProfitCop: 0,
      userProfitCop: 0,
      adminCommissionCop: 0,
      reinvestedProfitCop: 0,
      cashInjectionCop: 0,
      disbursementCop: 0,
      totalCapitalIncreaseCop: 0,
    },
    VERDE: {
      category: "VERDE",
      usersCount: 0,
      managedCapitalCop: 0,
      totalUsdOperated: 0,
      grossProfitCop: 0,
      userProfitCop: 0,
      adminCommissionCop: 0,
      reinvestedProfitCop: 0,
      cashInjectionCop: 0,
      disbursementCop: 0,
      totalCapitalIncreaseCop: 0,
    },
    NEGRA: {
      category: "NEGRA",
      usersCount: 0,
      managedCapitalCop: 0,
      totalUsdOperated: 0,
      grossProfitCop: 0,
      userProfitCop: 0,
      adminCommissionCop: 0,
      reinvestedProfitCop: 0,
      cashInjectionCop: 0,
      disbursementCop: 0,
      totalCapitalIncreaseCop: 0,
    },
  };

  const userSnapshots = [];

  let totalUsers = 0;
  let totalManagedCapital = 0;
  let totalUsdOperated = 0;
  let totalGrossCop = 0;
  let totalUsersProfitCop = 0;
  let totalAdminCommissionCop = 0;
  let totalReinvestedProfitCop = 0;
  let totalCashInjectionCop = 0;
  let totalDisbursementCop = 0;
  let totalCapitalIncreaseCop = 0;

  resultsSnap.forEach((docSnap) => {
    const ur = docSnap.data() || {};
    const uid = ur.userId || ur.userUid || docSnap.id;
    const profile = userProfileMap[uid] || {};

    const userCode = ur.userCode || profile.userCode || "S/C";
    const userNameSnapshot = ur.userName || ur.fullName || profile.fullName || "Inversionista";

    let rawCategory = (ur.category || ur.bitacoraCategory || profile.category || "AZUL").toUpperCase();
    if (!["AZUL", "VERDE", "NEGRA"].includes(rawCategory)) {
      rawCategory = "AZUL";
    }
    const cycleCategory = rawCategory;

    const cycleCapitalCop = Math.round(Number(ur.capitalCop || ur.currentCapitalCop || ur.groupCapitalCop || 0));
    const groupCapitalCop = Math.round(Number(ur.groupCapitalCop || cycleCapitalCop || 0));
    const userPercentage = Number(ur.userPercentage !== undefined ? ur.userPercentage : (profile.userPercentage || 75));
    const adminPercentage = Number(ur.adminPercentage !== undefined ? ur.adminPercentage : (profile.adminPercentage || 25));
    const usdOp = Number(ur.totalUsdOperated || 0);
    const trmUsed = Number(ur.trmUsed || ur.trmSnapshot || trmApplied || 0);

    const userProfitCop = Math.round(Number(ur.userProfitCop || 0));
    const adminCommissionCop = Math.round(Number(ur.adminCommissionCop || 0));
    const grossCop = Math.round(Number(ur.totalGrossCop || (userProfitCop + adminCommissionCop) || 0));

    const reinv = reinvByUserUid[uid];
    const isAppliedOrClosure = reinv && (
      reinv.status === "APPLIED" ||
      reinv.profitAppliedAtCycleClosure === true ||
      reinv.appliedAtCycleClosure === true ||
      (reinv.status === "APPROVED" && (Number(reinv.profitAppliedCop || 0) > 0 || Number(reinv.cashInjectionCop || 0) > 0))
    );

    let reinvestmentModality = "NONE";
    let reinvestmentStatus = "NONE";
    let cycleProfitSnapshotCop = 0;
    let reinvestableProfitCop = 0;
    let profitAppliedCop = 0;
    let cashInjectionCop = 0;
    let profitToDisburseCop = userProfitCop;
    let totalIncreaseCop = 0;
    let externalContributionStatusAtClose = "NOT_REQUIRED";

    if (isAppliedOrClosure) {
      reinvestmentStatus = "APPLIED";
      const rawType = (reinv.type || reinv.modality || "PROFIT_REINVESTMENT").toUpperCase();
      reinvestmentModality = rawType.includes("CAPITAL") || rawType.includes("INJECTION")
        ? "CAPITAL_INJECTION"
        : "PROFIT_REINVESTMENT";

      cycleProfitSnapshotCop = Math.round(Number(reinv.cycleProfitSnapshotCop || userProfitCop));
      reinvestableProfitCop = Math.round(Number(reinv.reinvestableProfitCop || userProfitCop));

      if (reinvestmentModality === "PROFIT_REINVESTMENT") {
        profitAppliedCop = Math.round(Number(reinv.profitAppliedCop || reinv.requestedAmountCop || reinv.totalIncreaseCop || 0));
        cashInjectionCop = 0;
        externalContributionStatusAtClose = "NOT_REQUIRED";
      } else {
        cashInjectionCop = Math.round(Number(reinv.cashInjectionCop || reinv.externalCapitalCop || 0));
        profitAppliedCop = Math.round(Number(reinv.profitAppliedCop || ((reinv.totalIncreaseCop || 0) - cashInjectionCop) || 0));
        externalContributionStatusAtClose = reinv.externalFundingStatus || (cashInjectionCop > 0 ? (reinv.cashReceivedConfirmed ? "CONFIRMED" : "PENDING") : "NOT_REQUIRED");
      }

      profitToDisburseCop = Math.max(0, userProfitCop - profitAppliedCop);
      totalIncreaseCop = profitAppliedCop + cashInjectionCop;
    }

    const capitalBeforeCloseCop = cycleCapitalCop;
    const profitReinvestedCop = profitAppliedCop;
    const profitDisbursedCop = profitToDisburseCop;
    const externalContributionRequestedCop = cashInjectionCop;
    const securedNextCapitalCop = capitalBeforeCloseCop + profitReinvestedCop;
    const projectedNextCapitalCop = securedNextCapitalCop + externalContributionRequestedCop;
    const capitalIncreaseAppliedCop = profitReinvestedCop;
    const finalCapitalAfterCloseCop = securedNextCapitalCop;

    const userSnapshot = {
      userUid: uid,
      userCode,
      userNameSnapshot,
      cycleId: targetCycleId,
      cycleCategory,
      groupCapitalCop,
      cycleCapitalCop,
      userPercentage,
      adminPercentage,
      totalUsdOperated: usdOp,
      trmUsed,
      totalGrossCop: grossCop,
      userProfitCop,
      adminCommissionCop,
      reinvestmentModality,
      reinvestmentStatus,
      cycleProfitSnapshotCop,
      reinvestableProfitCop,
      profitAppliedCop,
      profitReinvestedCop,
      profitDisbursedCop,
      cashInjectionCop,
      externalContributionRequestedCop,
      externalContributionStatusAtClose,
      securedNextCapitalCop,
      projectedNextCapitalCop,
      profitToDisburseCop,
      totalIncreaseCop,
      capitalBeforeCloseCop,
      capitalIncreaseAppliedCop,
      finalCapitalAfterCloseCop,
    };

    userSnapshots.push(userSnapshot);

    const b = bitacoras[cycleCategory];
    b.usersCount += 1;
    b.managedCapitalCop += cycleCapitalCop;
    b.totalUsdOperated += usdOp;
    b.grossProfitCop += grossCop;
    b.userProfitCop += userProfitCop;
    b.adminCommissionCop += adminCommissionCop;
    b.reinvestedProfitCop += profitAppliedCop;
    b.cashInjectionCop += cashInjectionCop;
    b.disbursementCop += profitToDisburseCop;
    b.totalCapitalIncreaseCop += totalIncreaseCop;

    totalUsers += 1;
    totalManagedCapital += cycleCapitalCop;
    totalUsdOperated += usdOp;
    totalGrossCop += grossCop;
    totalUsersProfitCop += userProfitCop;
    totalAdminCommissionCop += adminCommissionCop;
    totalReinvestedProfitCop += profitAppliedCop;
    totalCashInjectionCop += cashInjectionCop;
    totalDisbursementCop += profitToDisburseCop;
    totalCapitalIncreaseCop += totalIncreaseCop;
  });

  // 10. Reconciliación matemática obligatoria contra cycleFinancialSummaries
  const finSummarySnap = await db.collection("cycleFinancialSummaries").doc(targetCycleId).get();
  if (isModern) {
    if (!finSummarySnap.exists) {
      await versionRef.update({ status: "FAILED" });
      throw new Error(`REPORT_FINANCIAL_SUMMARY_MISMATCH: El resumen financiero 'cycleFinancialSummaries/${targetCycleId}' no existe.`);
    }
    const fin = finSummarySnap.data() || {};
    if (fin.isCycleClosed !== true) {
      await versionRef.update({ status: "FAILED" });
      throw new Error(`REPORT_FINANCIAL_SUMMARY_MISMATCH: El resumen financiero 'cycleFinancialSummaries/${targetCycleId}' no está marcado como cerrado (isCycleClosed !== true).`);
    }
    if (fin.closureVersion !== undefined && fin.closureVersion !== null && fin.closureVersion !== closureVersion) {
      await versionRef.update({ status: "FAILED" });
      throw new Error(`REPORT_FINANCIAL_SUMMARY_MISMATCH: El closureVersion del resumen (${fin.closureVersion}) difiere del ciclo (${closureVersion}).`);
    }
  }

  let reconciliationStatus = "PASSED";
  const sumUserProfits = bitacoras.AZUL.userProfitCop + bitacoras.VERDE.userProfitCop + bitacoras.NEGRA.userProfitCop;
  const sumAdminCommissions = bitacoras.AZUL.adminCommissionCop + bitacoras.VERDE.adminCommissionCop + bitacoras.NEGRA.adminCommissionCop;

  if (finSummarySnap.exists) {
    const fin = finSummarySnap.data() || {};
    const expectedUsersProfit = Number(fin.totalUsersProfitCop || 0);
    const expectedAdminProfit = Number(fin.totalAdminCommissionCop || 0);

    const maxAllowedProfitDiff = isRetrospective ? totalUsers : 0;
    const maxAllowedAdminDiff = isRetrospective ? totalUsers : 0;

    if (expectedUsersProfit > 0 && Math.abs(sumUserProfits - expectedUsersProfit) > maxAllowedProfitDiff) {
      console.warn(`[createCycleReportSnapshot] Discrepancia en utilidades usuarios: sum=${sumUserProfits} vs summary=${expectedUsersProfit}`);
      reconciliationStatus = "FAILED";
    }
    if (expectedAdminProfit > 0 && Math.abs(sumAdminCommissions - expectedAdminProfit) > maxAllowedAdminDiff) {
      console.warn(`[createCycleReportSnapshot] Discrepancia en comisiones admin: sum=${sumAdminCommissions} vs summary=${expectedAdminProfit}`);
      reconciliationStatus = "FAILED";
    }
  }

  if (reconciliationStatus === "FAILED") {
    await versionRef.update({ status: "FAILED", reconciliationStatus: "FAILED" });
    throw new Error("RECONCILIATION_FAILED: La suma de resultados individuales no coincide con el resumen financiero.");
  }

  // 11. Guardar snapshots de usuarios en subcolección users/{userUid} en lotes determinísticos
  const userBatches = [];
  let currentBatch = db.batch();
  let countInBatch = 0;

  for (const userSnap of userSnapshots) {
    const userDocRef = versionRef.collection("users").doc(userSnap.userUid);
    currentBatch.set(userDocRef, userSnap);
    countInBatch++;

    if (countInBatch >= 300) {
      userBatches.push(currentBatch);
      currentBatch = db.batch();
      countInBatch = 0;
    }
  }
  if (countInBatch > 0) {
    userBatches.push(currentBatch);
  }

  for (const b of userBatches) {
    await b.commit();
  }

  // 12. Transición de la versión a READY y marcar versiones anteriores como SUPERSEDED
  const metadataDoc = {
    id: versionId,
    cycleId: targetCycleId,
    cycleName,
    versionId,
    versionNumber,
    closureVersion: closureVersion || null,
    closureAttemptId: effectiveClosureAttemptId,
    status: "READY",
    isCurrent: true,
    startedAt: dates.startedAt,
    openedAt: dates.openedAt,
    closedAt: dates.closedAt,
    durationHours: dates.durationHours,
    closedByUid: authUid,
    closedByName: adminName,
    adminNotes: adminNotes || "",
    trmApplied,
    totalUsers,
    totalManagedCapital,
    totalUsdOperated,
    totalGrossCop,
    totalUsersProfitCop,
    totalAdminCommissionCop,
    totalReinvestedProfitCop,
    totalCashInjectionCop,
    totalDisbursementCop,
    totalCapitalIncreaseCop,
    bitacoras,
    createdAt: nowIso,
    snapshotGeneratedAt: nowIso,
    isRetrospective: Boolean(isRetrospective),
    profileMetadataFallbackUsed,
    reconciliationStatus,
  };

  await versionRef.set(metadataDoc, { merge: true });

  const activeVersionsSnap = await versionsCollRef.where("isCurrent", "==", true).get();
  const batchSupersede = db.batch();
  activeVersionsSnap.forEach((doc) => {
    if (doc.id !== versionId) {
      batchSupersede.update(doc.ref, {
        isCurrent: false,
        status: "SUPERSEDED",
        supersededAt: nowIso,
        supersededByUid: authUid,
        supersededByName: adminName,
      });
    }
  });
  if (!activeVersionsSnap.empty) {
    await batchSupersede.commit();
  }

  // 13. Actualizar documento raíz de cycleReports (sólo apunta a una versión READY vigente)
  await db.collection("cycleReports").doc(targetCycleId).set({
    cycleId: targetCycleId,
    cycleName,
    currentVersionId: versionId,
    currentVersionNumber: versionNumber,
    closureVersion: closureVersion || null,
    status: "READY",
    updatedAt: nowIso,
    trmApplied,
    totalUsers,
    totalManagedCapital,
  }, { merge: true });

  // 14. Registrar auditoría inmutable
  await db.collection("auditLogs").add({
    action: isRetrospective ? "CYCLE_REPORT_RETROSPECTIVE_CREATED" : "CYCLE_REPORT_SNAPSHOT_CREATED",
    performedBy: authUid,
    performedByName: adminName,
    cycleId: targetCycleId,
    versionId,
    closureVersion: closureVersion || null,
    closureAttemptId: metadataDoc.closureAttemptId,
    reconciliationStatus,
    status: "READY",
    details: {
      totalUsers,
      totalManagedCapital,
      trmApplied,
      totalGrossCop,
      totalUsersProfitCop,
      totalAdminCommissionCop,
    },
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  }).catch(() => {});

  return {
    success: true,
    versionId,
    versionNumber,
    closureVersion: closureVersion || null,
    metadata: metadataDoc,
  };
}

/**
 * Marca la versión activa de un ciclo como SUPERSEDED al reabrir el ciclo.
 */
async function supersedeCurrentCycleReport(db, admin, cycleId, authUid, adminName, reason = "") {
  const targetCycleId = String(cycleId || "").trim();
  const versionsCollRef = db.collection("cycleReports").doc(targetCycleId).collection("versions");
  const activeSnap = await versionsCollRef.where("isCurrent", "==", true).get();

  if (activeSnap.empty) {
    return { supersededCount: 0 };
  }

  const nowIso = new Date().toISOString();
  const batch = db.batch();
  activeSnap.forEach((doc) => {
    batch.update(doc.ref, {
      isCurrent: false,
      status: "SUPERSEDED",
      supersededAt: nowIso,
      supersededByUid: authUid,
      supersededByName: adminName,
      supersededReason: reason || "Reapertura de ciclo autorizada",
    });
  });

  await batch.commit();

  await db.collection("cycleReports").doc(targetCycleId).set({
    status: "SUPERSEDED",
    updatedAt: nowIso,
  }, { merge: true });

  await db.collection("auditLogs").add({
    action: "CYCLE_REPORT_SUPERSEDED",
    performedBy: authUid,
    performedByName: adminName,
    cycleId: targetCycleId,
    reason,
    supersededCount: activeSnap.size,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  }).catch(() => {});

  return { supersededCount: activeSnap.size };
}

/**
 * Genera el documento PDF oficial de cierre de ciclo bajo demanda en orientación Landscape A4.
 * Lee estrictamente de los snapshots inmutables congelados en cycleReports.
 *
 * @param {admin.firestore.Firestore} db
 * @param {string} cycleId
 * @param {string} versionId
 * @returns {Promise<{ pdfBuffer: Buffer, filename: string, metadata: object }>}
 */
async function generateCycleReportPdfBuffer(db, cycleId, versionId) {
  const targetCycleId = String(cycleId || "").trim();
  const targetVersionId = String(versionId || "").trim();

  // 1. Obtener metadatos de la versión del informe
  const versionRef = db.collection("cycleReports").doc(targetCycleId).collection("versions").doc(targetVersionId);
  const versionSnap = await versionRef.get();
  if (!versionSnap.exists) {
    throw new Error(`La versión '${targetVersionId}' del informe para el ciclo '${targetCycleId}' no existe.`);
  }

  const metadata = versionSnap.data() || {};
  if (metadata.status === "FAILED" || metadata.status === "GENERATING") {
    throw new Error(`El snapshot '${targetVersionId}' está en estado ${metadata.status}. No se puede emitir PDF.`);
  }

  // 2. Obtener usuarios congelados desde el snapshot
  const usersSnap = await versionRef.collection("users").get();
  const allUsers = [];
  usersSnap.forEach((doc) => {
    allUsers.push(doc.data());
  });

  allUsers.sort((a, b) => (a.userCode || "").localeCompare(b.userCode || ""));

  const usersByBitacora = {
    AZUL: allUsers.filter((u) => u.cycleCategory === "AZUL"),
    VERDE: allUsers.filter((u) => u.cycleCategory === "VERDE"),
    NEGRA: allUsers.filter((u) => u.cycleCategory === "NEGRA"),
  };

  // 3. Crear documento PDF (A4 Landscape: 841.89 x 595.28 pt)
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margins: { top: 30, bottom: 40, left: 30, right: 30 },
    bufferPages: true,
    autoFirstPage: true,
  });

  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  const PAGE_WIDTH = 841.89;
  const PAGE_HEIGHT = 595.28;
  const MARGIN = 30;
  const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);

  const C_DARK_BG = "#0f172a";
  const C_HEADER_BG = "#1e293b";
  const C_GOLD = "#d97706";
  const C_TEXT_MAIN = "#0f172a";
  const C_TEXT_MUTED = "#64748b";
  const C_BORDER = "#e2e8f0";
  const C_CARD_BG = "#f8fafc";
  const C_ROW_ALT = "#f1f5f9";
  const C_AZUL = "#0284c7";
  const C_VERDE = "#16a34a";
  const C_NEGRA = "#334155";

  doc.rect(MARGIN, MARGIN, CONTENT_WIDTH, 56).fill(C_DARK_BG);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(15).text("EASYTRADERS24 — INFORME OFICIAL DE CIERRE DE CICLO", MARGIN + 16, MARGIN + 12);
  doc.fillColor("#94a3b8").font("Helvetica").fontSize(9).text("Snapshot Inmutable de Rendimientos, TRM Aplicada y Liquidación Financiera", MARGIN + 16, MARGIN + 32);

  const statusBadge = metadata.isCurrent ? "VERSIÓN OFICIAL VIGENTE" : "VERSIÓN HISTÓRICA (SUPERSEDED)";
  doc.rect(PAGE_WIDTH - MARGIN - 210, MARGIN + 14, 194, 26).fill(metadata.isCurrent ? "#065f46" : "#475569");
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9).text(`${statusBadge} • ${metadata.versionId || "v1"}`, PAGE_WIDTH - MARGIN - 200, MARGIN + 22, { width: 174, align: "center" });

  let curY = MARGIN + 70;

  doc.rect(MARGIN, curY, CONTENT_WIDTH, 60).fillAndStroke(C_CARD_BG, C_BORDER);

  doc.fillColor(C_TEXT_MUTED).font("Helvetica").fontSize(8).text("CICLO OPERATIVO", MARGIN + 14, curY + 10);
  doc.fillColor(C_TEXT_MAIN).font("Helvetica-Bold").fontSize(11).text(metadata.cycleName || metadata.cycleId, MARGIN + 14, curY + 22);

  doc.fillColor(C_TEXT_MUTED).font("Helvetica").fontSize(8).text("FECHA DE CIERRE", MARGIN + 180, curY + 10);
  doc.fillColor(C_TEXT_MAIN).font("Helvetica-Bold").fontSize(10).text(formatDateEs(metadata.closedAt), MARGIN + 180, curY + 22);

  doc.fillColor(C_TEXT_MUTED).font("Helvetica").fontSize(8).text("TRM OFICIAL APLICADA", MARGIN + 350, curY + 10);
  doc.fillColor(C_GOLD).font("Helvetica-Bold").fontSize(11).text(formatCop(metadata.trmApplied) + " COP", MARGIN + 350, curY + 22);

  doc.fillColor(C_TEXT_MUTED).font("Helvetica").fontSize(8).text("TOTAL INVERSIONISTAS", MARGIN + 510, curY + 10);
  doc.fillColor(C_TEXT_MAIN).font("Helvetica-Bold").fontSize(11).text(`${metadata.totalUsers || 0} activos`, MARGIN + 510, curY + 22);

  doc.fillColor(C_TEXT_MUTED).font("Helvetica").fontSize(8).text("RECONCILIACIÓN", MARGIN + 660, curY + 10);
  doc.fillColor(metadata.reconciliationStatus === "PASSED" ? "#16a34a" : "#dc2626").font("Helvetica-Bold").fontSize(10).text(metadata.reconciliationStatus || "PASSED", MARGIN + 660, curY + 22);

  doc.fillColor(C_TEXT_MUTED).font("Helvetica").fontSize(7.5).text(`SuperAdmin: ${metadata.closedByName || "Sistema"} (${metadata.closedByUid || "N/A"}) • Intento: ${metadata.closureAttemptId || "N/A"} • Versión: ${metadata.versionId} • Snapshot: ${formatDateEs(metadata.snapshotGeneratedAt)}`, MARGIN + 14, curY + 44);

  curY += 72;

  doc.fillColor(C_TEXT_MAIN).font("Helvetica-Bold").fontSize(12).text("CONSOLIDADO FINANCIERO GLOBAL DEL CICLO", MARGIN, curY);
  curY += 16;

  const kpis = [
    { label: "CAPITAL OPERADO TOTAL", value: formatCop(metadata.totalManagedCapital), color: C_TEXT_MAIN },
    { label: "TOTAL USD OPERADO", value: formatUsd(metadata.totalUsdOperated), color: "#2563eb" },
    { label: "GANANCIA BRUTA COP", value: formatCop(metadata.totalGrossCop), color: "#059669" },
    { label: "GANANCIAS INVERSIONISTAS", value: formatCop(metadata.totalUsersProfitCop), color: "#0d9488" },
    { label: "COMISIÓN ADMINISTRACIÓN", value: formatCop(metadata.totalAdminCommissionCop), color: "#7c3aed" },
    { label: "UTILIDAD REINVERTIDA (APPLIED)", value: formatCop(metadata.totalReinvestedProfitCop), color: "#0284c7" },
    { label: "INYECCIÓN EXTERNA (APPLIED)", value: formatCop(metadata.totalCashInjectionCop), color: "#0891b2" },
    { label: "TOTAL A DESEMBOLSAR NETO", value: formatCop(metadata.totalDisbursementCop), color: "#b45309" },
  ];

  const kpiW = (CONTENT_WIDTH - 18) / 4;
  const kpiH = 46;

  kpis.forEach((kpi, idx) => {
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    const x = MARGIN + (col * (kpiW + 6));
    const y = curY + (row * (kpiH + 6));

    doc.rect(x, y, kpiW, kpiH).fillAndStroke("#ffffff", C_BORDER);
    doc.fillColor(C_TEXT_MUTED).font("Helvetica").fontSize(7).text(kpi.label, x + 10, y + 8);
    doc.fillColor(kpi.color).font("Helvetica-Bold").fontSize(11).text(kpi.value, x + 10, y + 23);
  });

  curY += (kpiH * 2) + 20;

  doc.fillColor(C_TEXT_MAIN).font("Helvetica-Bold").fontSize(12).text("RESUMEN COMPARATIVO POR BITÁCORA", MARGIN, curY);
  curY += 16;

  const bitCols = [
    { label: "Bitácora", w: 85, align: "left" },
    { label: "Usuarios", w: 55, align: "center" },
    { label: "Capital Operado", w: 90, align: "right" },
    { label: "USD Operado", w: 75, align: "right" },
    { label: "Ganancia Bruta", w: 90, align: "right" },
    { label: "Ganancia Usuarios", w: 90, align: "right" },
    { label: "Comisión Admin", w: 85, align: "right" },
    { label: "Reinvertido", w: 70, align: "right" },
    { label: "Inyección", w: 65, align: "right" },
    { label: "Desembolso", w: 76, align: "right" },
  ];

  doc.rect(MARGIN, curY, CONTENT_WIDTH, 20).fill(C_HEADER_BG);
  let colX = MARGIN + 6;
  bitCols.forEach((c) => {
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5).text(c.label, colX, curY + 6, { width: c.w - 10, align: c.align });
    colX += c.w;
  });
  curY += 20;

  const bitacoraRows = [
    { name: "AZUL", color: C_AZUL, data: metadata.bitacoras?.AZUL || {} },
    { name: "VERDE", color: C_VERDE, data: metadata.bitacoras?.VERDE || {} },
    { name: "NEGRA", color: C_NEGRA, data: metadata.bitacoras?.NEGRA || {} },
  ];

  bitacoraRows.forEach((br, rIdx) => {
    const rowBg = rIdx % 2 === 0 ? "#ffffff" : C_ROW_ALT;
    doc.rect(MARGIN, curY, CONTENT_WIDTH, 22).fillAndStroke(rowBg, C_BORDER);

    colX = MARGIN + 6;
    doc.fillColor(br.color).font("Helvetica-Bold").fontSize(8.5).text(br.name, colX, curY + 6, { width: bitCols[0].w - 10, align: "left" });
    colX += bitCols[0].w;

    doc.fillColor(C_TEXT_MAIN).font("Helvetica").fontSize(8).text(String(br.data.usersCount || 0), colX, curY + 6, { width: bitCols[1].w - 10, align: "center" });
    colX += bitCols[1].w;

    doc.text(formatCop(br.data.managedCapitalCop), colX, curY + 6, { width: bitCols[2].w - 10, align: "right" });
    colX += bitCols[2].w;

    doc.text(formatUsd(br.data.totalUsdOperated), colX, curY + 6, { width: bitCols[3].w - 10, align: "right" });
    colX += bitCols[3].w;

    doc.text(formatCop(br.data.grossProfitCop), colX, curY + 6, { width: bitCols[4].w - 10, align: "right" });
    colX += bitCols[4].w;

    doc.fillColor("#047857").font("Helvetica-Bold").text(formatCop(br.data.userProfitCop), colX, curY + 6, { width: bitCols[5].w - 10, align: "right" });
    colX += bitCols[5].w;

    doc.fillColor(C_TEXT_MAIN).font("Helvetica").text(formatCop(br.data.adminCommissionCop), colX, curY + 6, { width: bitCols[6].w - 10, align: "right" });
    colX += bitCols[6].w;

    doc.text(formatCop(br.data.reinvestedProfitCop), colX, curY + 6, { width: bitCols[7].w - 10, align: "right" });
    colX += bitCols[7].w;

    doc.text(formatCop(br.data.cashInjectionCop), colX, curY + 6, { width: bitCols[8].w - 10, align: "right" });
    colX += bitCols[8].w;

    doc.fillColor("#b45309").font("Helvetica-Bold").text(formatCop(br.data.disbursementCop), colX, curY + 6, { width: bitCols[9].w - 10, align: "right" });

    curY += 22;
  });

  doc.rect(MARGIN, curY, CONTENT_WIDTH, 24).fillAndStroke(C_ROW_ALT, C_BORDER);
  colX = MARGIN + 6;
  doc.fillColor(C_TEXT_MAIN).font("Helvetica-Bold").fontSize(9).text("TOTAL CONSOLIDADO", colX, curY + 6, { width: bitCols[0].w - 10, align: "left" });
  colX += bitCols[0].w;
  doc.text(String(metadata.totalUsers || 0), colX, curY + 6, { width: bitCols[1].w - 10, align: "center" });
  colX += bitCols[1].w;
  doc.text(formatCop(metadata.totalManagedCapital), colX, curY + 6, { width: bitCols[2].w - 10, align: "right" });
  colX += bitCols[2].w;
  doc.text(formatUsd(metadata.totalUsdOperated), colX, curY + 6, { width: bitCols[3].w - 10, align: "right" });
  colX += bitCols[3].w;
  doc.text(formatCop(metadata.totalGrossCop), colX, curY + 6, { width: bitCols[4].w - 10, align: "right" });
  colX += bitCols[4].w;
  doc.fillColor("#047857").text(formatCop(metadata.totalUsersProfitCop), colX, curY + 6, { width: bitCols[5].w - 10, align: "right" });
  colX += bitCols[5].w;
  doc.fillColor(C_TEXT_MAIN).text(formatCop(metadata.totalAdminCommissionCop), colX, curY + 6, { width: bitCols[6].w - 10, align: "right" });
  colX += bitCols[6].w;
  doc.text(formatCop(metadata.totalReinvestedProfitCop), colX, curY + 6, { width: bitCols[7].w - 10, align: "right" });
  colX += bitCols[7].w;
  doc.text(formatCop(metadata.totalCashInjectionCop), colX, curY + 6, { width: bitCols[8].w - 10, align: "right" });
  colX += bitCols[8].w;
  doc.fillColor("#b45309").text(formatCop(metadata.totalDisbursementCop), colX, curY + 6, { width: bitCols[9].w - 10, align: "right" });

  curY += 34;

  doc.rect(MARGIN, curY, CONTENT_WIDTH, 42).fillAndStroke("#fefce8", "#fef08a");
  doc.fillColor("#854d0e").font("Helvetica-Bold").fontSize(8).text("CERTIFICACIÓN DE INMUTABILIDAD Y PROTECCIÓN DE DATOS:", MARGIN + 12, curY + 8);
  doc.fillColor("#713f12").font("Helvetica").fontSize(7).text(
    `Este reporte fue compilado y congelado por el motor de transacciones de EasyTraders24 en la fecha de cierre. Los valores financieros, TRM ($${metadata.trmApplied || 0}) y participaciones registradas son definitivas e inmodificables. No admiten recálculo dinámico con base en saldos futuros o mutaciones posteriores de perfiles.`,
    MARGIN + 12,
    curY + 20,
    { width: CONTENT_WIDTH - 24, lineGap: 2 }
  );

  const userCols = [
    { key: "code", label: "Código", w: 50, align: "left" },
    { key: "name", label: "Inversionista", w: 100, align: "left" },
    { key: "capital", label: "Capital Op.", w: 65, align: "right" },
    { key: "split", label: "Split", w: 40, align: "center" },
    { key: "usd", label: "USD Op.", w: 50, align: "right" },
    { key: "gross", label: "Gan. Bruta", w: 60, align: "right" },
    { key: "userProfit", label: "Gan. Usuario", w: 65, align: "right" },
    { key: "adminComm", label: "Com. Admin", w: 60, align: "right" },
    { key: "modality", label: "Modalidad", w: 60, align: "center" },
    { key: "reinv", label: "Reinvertido", w: 55, align: "right" },
    { key: "inj", label: "Inyección", w: 50, align: "right" },
    { key: "disb", label: "Desembolso", w: 60, align: "right" },
    { key: "finalCap", label: "Cap. Asegurado", w: 67, align: "right" },
  ];

  function drawUserTableHeader(yPos, categoryName, categoryColor) {
    doc.rect(MARGIN, yPos, CONTENT_WIDTH, 22).fill(categoryColor);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9).text(`DETALLE DE INVERSIONISTAS — BITÁCORA ${categoryName}`, MARGIN + 12, yPos + 6);

    const tableHeaderY = yPos + 22;
    doc.rect(MARGIN, tableHeaderY, CONTENT_WIDTH, 18).fill(C_HEADER_BG);

    let cx = MARGIN + 4;
    userCols.forEach((col) => {
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(6.5).text(col.label, cx, tableHeaderY + 5, { width: col.w - 6, align: col.align });
      cx += col.w;
    });

    return tableHeaderY + 18;
  }

  const bitacoraOrder = [
    { name: "AZUL", color: C_AZUL, list: usersByBitacora.AZUL },
    { name: "VERDE", color: C_VERDE, list: usersByBitacora.VERDE },
    { name: "NEGRA", color: C_NEGRA, list: usersByBitacora.NEGRA },
  ];

  bitacoraOrder.forEach((bObj) => {
    doc.addPage();
    let rowY = MARGIN;

    rowY = drawUserTableHeader(rowY, bObj.name, bObj.color);

    if (bObj.list.length === 0) {
      doc.rect(MARGIN, rowY, CONTENT_WIDTH, 24).fillAndStroke("#ffffff", C_BORDER);
      doc.fillColor(C_TEXT_MUTED).font("Helvetica-Oblique").fontSize(8).text("No se registraron inversionistas activos en esta bitácora durante el ciclo.", MARGIN + 14, rowY + 8);
      return;
    }

    const ROW_HEIGHT = 16;
    const MAX_PAGE_Y = PAGE_HEIGHT - MARGIN - 20;

    bObj.list.forEach((u, uIdx) => {
      if (rowY + ROW_HEIGHT > MAX_PAGE_Y) {
        doc.addPage();
        rowY = drawUserTableHeader(MARGIN, bObj.name, bObj.color);
      }

      const rowBg = uIdx % 2 === 0 ? "#ffffff" : C_ROW_ALT;
      doc.rect(MARGIN, rowY, CONTENT_WIDTH, ROW_HEIGHT).fillAndStroke(rowBg, C_BORDER);

      let cx = MARGIN + 4;

      doc.fillColor(C_TEXT_MAIN).font("Helvetica-Bold").fontSize(6.5).text(u.userCode || "S/C", cx, rowY + 4, { width: userCols[0].w - 6, align: "left" });
      cx += userCols[0].w;

      doc.font("Helvetica").text((u.userNameSnapshot || "Inversionista").substring(0, 22), cx, rowY + 4, { width: userCols[1].w - 6, align: "left" });
      cx += userCols[1].w;

      doc.text(formatCop(u.cycleCapitalCop), cx, rowY + 4, { width: userCols[2].w - 6, align: "right" });
      cx += userCols[2].w;

      doc.text(`${u.userPercentage}/${u.adminPercentage}`, cx, rowY + 4, { width: userCols[3].w - 6, align: "center" });
      cx += userCols[3].w;

      doc.text(formatUsd(u.totalUsdOperated), cx, rowY + 4, { width: userCols[4].w - 6, align: "right" });
      cx += userCols[4].w;

      doc.text(formatCop(u.totalGrossCop), cx, rowY + 4, { width: userCols[5].w - 6, align: "right" });
      cx += userCols[5].w;

      doc.fillColor("#047857").font("Helvetica-Bold").text(formatCop(u.userProfitCop), cx, rowY + 4, { width: userCols[6].w - 6, align: "right" });
      cx += userCols[6].w;

      doc.fillColor(C_TEXT_MAIN).font("Helvetica").text(formatCop(u.adminCommissionCop), cx, rowY + 4, { width: userCols[7].w - 6, align: "right" });
      cx += userCols[7].w;

      const modLabel = u.reinvestmentModality === "CAPITAL_INJECTION" ? "INYECCIÓN" : (u.reinvestmentModality === "PROFIT_REINVESTMENT" ? "REINVERSIÓN" : "-");
      doc.fontSize(6).text(modLabel, cx, rowY + 4.5, { width: userCols[8].w - 6, align: "center" });
      cx += userCols[8].w;

      doc.fontSize(6.5).text(u.profitAppliedCop > 0 ? formatCop(u.profitAppliedCop) : "-", cx, rowY + 4, { width: userCols[9].w - 6, align: "right" });
      cx += userCols[9].w;

      doc.text(u.cashInjectionCop > 0 ? formatCop(u.cashInjectionCop) : "-", cx, rowY + 4, { width: userCols[10].w - 6, align: "right" });
      cx += userCols[10].w;

      doc.fillColor(u.profitToDisburseCop > 0 ? "#b45309" : C_TEXT_MUTED).font(u.profitToDisburseCop > 0 ? "Helvetica-Bold" : "Helvetica").text(formatCop(u.profitToDisburseCop), cx, rowY + 4, { width: userCols[11].w - 6, align: "right" });
      cx += userCols[11].w;

      doc.fillColor(C_TEXT_MAIN).font("Helvetica-Bold").text(formatCop(u.finalCapitalAfterCloseCop), cx, rowY + 4, { width: userCols[12].w - 6, align: "right" });

      rowY += ROW_HEIGHT;
    });
  });

  const range = doc.bufferedPageRange();
  const totalPages = range.count;

  for (let i = range.start; i < range.start + totalPages; i++) {
    doc.switchToPage(i);

    const footerY = PAGE_HEIGHT - 26;
    doc.rect(MARGIN, footerY - 4, CONTENT_WIDTH, 0.5).fill(C_BORDER);

    doc.fillColor(C_TEXT_MUTED).font("Helvetica").fontSize(7);
    doc.text(`EasyTraders24 • Informe de Cierre: ${metadata.cycleName || metadata.cycleId} (${metadata.versionId}) • Emitido: ${formatDateEs(new Date().toISOString())}`, MARGIN, footerY);
    doc.text(`DOCUMENTO OFICIAL CONFIDENCIAL — SUPERADMINISTRACIÓN`, MARGIN, footerY, { width: CONTENT_WIDTH, align: "center" });
    doc.text(`Página ${i + 1} de ${totalPages}`, PAGE_WIDTH - MARGIN - 80, footerY, { width: 80, align: "right" });
  }

  doc.end();

  const pdfBuffer = await new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const safeCycleName = (metadata.cycleName || targetCycleId).replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `Informe_Cierre_${safeCycleName}_${metadata.versionId}.pdf`;

  return {
    pdfBuffer,
    filename,
    metadata,
  };
}

module.exports = {
  createCycleReportSnapshot,
  supersedeCurrentCycleReport,
  generateCycleReportPdfBuffer,
  isModernCycle,
  resolveCycleDates,
};
