const crypto = require("crypto");

/**
 * =========================================================================
 * CORE AUTORITATIVO DE RESET DE ENTORNO DE PRUEBA Y BORRADO INDIVIDUAL
 * =========================================================================
 */

const MAX_BATCH_WRITES = 400;

/**
 * Batch manager seguro para Firestore.
 * Garantiza commits atómicos cada 400 operaciones (o menos), cumpliendo con el límite
 * estricto de Firestore y las directrices de hardening de la Fase 1.
 */
class FirestoreBatchRunner {
  constructor(db, maxBatchWrites = MAX_BATCH_WRITES) {
    this.db = db;
    this.maxBatchWrites = maxBatchWrites;
    this.batch = typeof db.batch === "function" ? db.batch() : null;
    this.currentBatchCount = 0;
    this.totalCommitted = 0;
    this.batchesCommitted = 0;
  }

  async delete(docRef) {
    if (!docRef) return;
    if (!this.batch) {
      if (typeof docRef.delete === "function") {
        await docRef.delete();
      }
      this.totalCommitted++;
      return;
    }
    this.batch.delete(docRef);
    this.currentBatchCount++;
    if (this.currentBatchCount >= this.maxBatchWrites) {
      await this.commit();
    }
  }

  async update(docRef, data) {
    if (!docRef) return;
    if (!this.batch) {
      if (typeof docRef.update === "function") {
        await docRef.update(data);
      }
      this.totalCommitted++;
      return;
    }
    this.batch.update(docRef, data);
    this.currentBatchCount++;
    if (this.currentBatchCount >= this.maxBatchWrites) {
      await this.commit();
    }
  }

  async commit() {
    if (this.currentBatchCount > 0 && this.batch) {
      await this.batch.commit();
      this.totalCommitted += this.currentBatchCount;
      this.batchesCommitted++;
      this.batch = typeof this.db.batch === "function" ? this.db.batch() : null;
      this.currentBatchCount = 0;
    }
  }
}

/**
 * Helper autoritativo: Obtiene y consolida todas las identidades administrativas y protegidas.
 * FAIL-CLOSED: Si falla admin.auth().listUsers() o la consulta de /users, ABORTA inmediatamente
 * para evitar operar con una lista parcial o desprotegida.
 */
async function getProtectedAccounts(authUid, authEmail, db, auth) {
  const protectedUids = new Set();
  const protectedDocIds = new Set();
  const protectedEmails = new Set([
    "juanes9802@gmail.com",
    "elcocalombiano1828@gmail.com",
  ]);

  if (authUid) {
    protectedUids.add(authUid);
    protectedDocIds.add(authUid);
  }
  protectedUids.add("lpx4NLEEMkeh9EJFcG68oPMVdXF2");
  protectedDocIds.add("lpx4NLEEMkeh9EJFcG68oPMVdXF2");
  if (authEmail) {
    protectedEmails.add(authEmail.toLowerCase().trim());
  }

  // 1. Recorrer Auth paginado - FAIL CLOSED
  let nextPageToken;
  try {
    do {
      const listResult = await auth.listUsers(1000, nextPageToken);
      for (const u of listResult.users) {
        const email = (u.email || "").toLowerCase().trim();
        const claims = u.customClaims || {};
        if (
          protectedUids.has(u.uid) ||
          protectedEmails.has(email) ||
          claims.admin === true ||
          claims.superadmin === true
        ) {
          protectedUids.add(u.uid);
          protectedDocIds.add(u.uid);
          if (email) protectedEmails.add(email);
        }
      }
      nextPageToken = listResult.pageToken;
    } while (nextPageToken);
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al listar usuarios de Firebase Auth: ${err.message}`);
  }

  // 2. Recorrer /users en Firestore - FAIL CLOSED
  try {
    const usersSnap = await db.collection("users").get();
    usersSnap.forEach((doc) => {
      const d = doc.data ? doc.data() : doc;
      const uUid = d.uid || d.userUid || doc.id;
      const email = (d.email || "").toLowerCase().trim();
      const isAdmRole = d.role === "ADMIN";
      const isAdmCode = typeof d.userCode === "string" && d.userCode.startsWith("ADM");

      if (
        protectedUids.has(doc.id) ||
        protectedUids.has(uUid) ||
        protectedEmails.has(email) ||
        isAdmRole ||
        isAdmCode ||
        (d.migratedToUid && protectedUids.has(d.migratedToUid))
      ) {
        protectedUids.add(doc.id);
        protectedDocIds.add(doc.id);
        if (uUid) protectedUids.add(uUid);
        if (email) protectedEmails.add(email);
        if (d.migratedToUid) protectedUids.add(d.migratedToUid);
      }
    });
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al consultar /users en Firestore: ${err.message}`);
  }

  return { protectedUids, protectedDocIds, protectedEmails };
}

/**
 * Cálculo del Hash Criptográfico SHA-256 del Plan de Reset.
 * - Prioriza path completo sobre id para recursos anidados: return item.path || item.uid || item.id || "".
 * - Incluye TODAS las mutaciones, específicamente notificationsToUpdate con remainingTargets ordenados.
 * - Construido estrictamente con identificadores determinísticos ordenados. CERO timestamps.
 */
function computeResetPlanHash(plan) {
  const getId = (item) => {
    if (!item) return "";
    if (typeof item === "string") return item;
    return item.path || item.uid || item.id || "";
  };

  const getNotifUpdateCanonical = (item) => {
    if (!item) return "";
    const path = item.path || item.id || "";
    const targets = Array.isArray(item.remainingTargets) ? [...item.remainingTargets].sort() : [];
    return `${path}:${targets.join(",")}`;
  };

  const canonicalPayload = {
    authUsers: (plan.authUsersToDelete || []).map(getId).filter(Boolean).sort(),
    firestoreUsers: (plan.firestoreUsersToDelete || []).map(getId).filter(Boolean).sort(),
    pushTokens: (plan.pushTokensToDelete || []).map(getId).filter(Boolean).sort(),
    monthlyCycles: (plan.monthlyCyclesToDelete || []).map(getId).filter(Boolean).sort(),
    cycleFinancialSummaries: (plan.cycleFinancialSummariesToDelete || []).map(getId).filter(Boolean).sort(),
    cycleReports: (plan.cycleReportsToDelete || []).map(getId).filter(Boolean).sort(),
    cycleUserResults: (plan.cycleUserResultsToDelete || []).map(getId).filter(Boolean).sort(),
    cycleGroupCalculations: (plan.cycleGroupCalculationsToDelete || []).map(getId).filter(Boolean).sort(),
    dailyOperations: (plan.dailyOperationsToDelete || []).map(getId).filter(Boolean).sort(),
    reinvestments: (plan.reinvestmentsToDelete || []).map(getId).filter(Boolean).sort(),
    disbursements: (plan.disbursementsToDelete || []).map(getId).filter(Boolean).sort(),
    investments: (plan.investmentsToDelete || []).map(getId).filter(Boolean).sort(),
    notifications: (plan.notificationsToDelete || []).map(getId).filter(Boolean).sort(),
    notificationsToUpdate: (plan.notificationsToUpdate || []).map(getNotifUpdateCanonical).filter(Boolean).sort(),
    idempotencyKeys: (plan.idempotencyKeysToDelete || []).map(getId).filter(Boolean).sort(),
    investorApplications: (plan.investorApplicationsToDelete || []).map(getId).filter(Boolean).sort(),
    claimOperations: (plan.claimOperationsToDelete || []).map(getId).filter(Boolean).sort(),
    bitacoras: (plan.bitacorasToDelete || []).map(getId).filter(Boolean).sort(),
  };

  return crypto.createHash("sha256").update(JSON.stringify(canonicalPayload)).digest("hex");
}

/**
 * Clasificador estricto de idempotencyKeys.
 * Solo marca para eliminar claves verificablemente vinculadas a las entidades purgadas.
 * Cualquier clave ambigua o administrativa general es PRESERVADA.
 */
function classifyIdempotencyKeys(idempotencyDocs, deletedUidsSet, deletedCyclesSet, deletedOpsSet, deletedReinvSet, deletedDisbSet) {
  const idempotencyKeysToDelete = [];
  const unclassifiedIdempotencyKeys = [];

  for (const doc of idempotencyDocs) {
    const id = doc.id;
    const d = doc.data ? doc.data() : (doc.data || {});
    const keyUser = d.userUid || d.userId || d.createdByUid;
    const keyCycle = d.sourceCycleId || d.createdCycleId || d.cycleId;
    const keyReq = d.requestId || d.reinvestmentId || d.clientRequestId;
    const keyDisb = d.disbursementId;
    const keyOp = d.operationId;

    const matchesUser = keyUser && deletedUidsSet.has(keyUser);
    const matchesCycle = keyCycle && deletedCyclesSet.has(keyCycle);
    const matchesReinv = keyReq && deletedReinvSet.has(keyReq);
    const matchesDisb = keyDisb && deletedDisbSet.has(keyDisb);
    const matchesOp = keyOp && deletedOpsSet.has(keyOp);

    if (matchesUser || matchesCycle || matchesReinv || matchesDisb || matchesOp) {
      idempotencyKeysToDelete.push({ id, path: `idempotencyKeys/${id}`, ref: doc.ref });
    } else {
      unclassifiedIdempotencyKeys.push({ id, path: `idempotencyKeys/${id}` });
    }
  }

  return { idempotencyKeysToDelete, unclassifiedIdempotencyKeys };
}

/**
 * Clasificador estricto de notificaciones.
 * Elimina solo las vinculadas inequívocamente con UIDs, ciclos o eventos eliminados.
 * Preserva notificaciones de seguridad, difusiones y las ambiguas.
 */
function classifyNotifications(notificationDocs, deletedUidsSet, deletedCyclesSet, deletedOpsSet, deletedReinvSet, deletedDisbSet) {
  const notificationsToDelete = [];
  const notificationsToUpdate = [];
  const preservedNotifications = [];

  for (const doc of notificationDocs) {
    const id = doc.id;
    const d = doc.data ? doc.data() : (doc.data || {});
    const targetUids = Array.isArray(d.targetUids) ? d.targetUids : [];
    const userUid = d.userUid || d.userId;
    const cycleId = d.cycleId;
    const opId = d.operationId || d.payload?.operationId;
    const reinvId = d.reinvestmentId || d.payload?.reinvestmentId;
    const disbId = d.disbursementId || d.payload?.disbursementId;

    const isDirectUser = userUid && deletedUidsSet.has(userUid);
    const isDirectCycle = cycleId && deletedCyclesSet.has(cycleId);
    const isDirectOp = opId && deletedOpsSet.has(opId);
    const isDirectReinv = reinvId && deletedReinvSet.has(reinvId);
    const isDirectDisb = disbId && deletedDisbSet.has(disbId);

    if (targetUids.length > 0) {
      const remainingTargets = targetUids.filter((uid) => !deletedUidsSet.has(uid));
      if (remainingTargets.length === 0) {
        notificationsToDelete.push({ id, path: `notifications/${id}`, ref: doc.ref });
      } else if (remainingTargets.length < targetUids.length) {
        notificationsToUpdate.push({ id, path: `notifications/${id}`, ref: doc.ref, remainingTargets });
      } else {
        preservedNotifications.push({ id, path: `notifications/${id}`, reason: "ADMIN_OR_UNRELATED_TARGETS" });
      }
    } else if (isDirectUser || isDirectCycle || isDirectOp || isDirectReinv || isDirectDisb) {
      notificationsToDelete.push({ id, path: `notifications/${id}`, ref: doc.ref });
    } else {
      preservedNotifications.push({ id, path: `notifications/${id}`, reason: "ADMIN_OR_AMBIGUOUS" });
    }
  }

  return { notificationsToDelete, notificationsToUpdate, preservedNotifications };
}

/**
 * Construye el plan único determinístico de Reset del Entorno de Prueba.
 * Reutilizado exactamente por el Preview y la Ejecución.
 * FAIL-CLOSED: Si falla la lectura de cualquier colección o subcolección crítica,
 * ABORTA inmediatamente la construcción del plan.
 */
async function buildTestEnvironmentResetPlan(authUid, authEmail, db, auth) {
  // 1. Identificar cuentas protegidas - FAIL CLOSED
  const { protectedUids, protectedDocIds, protectedEmails } = await getProtectedAccounts(authUid, authEmail, db, auth);

  // 2. Auth: identificar candidatos no administrativos
  const authUsersToDelete = [];
  let nextPageToken;
  try {
    do {
      const listResult = await auth.listUsers(1000, nextPageToken);
      for (const u of listResult.users) {
        const email = (u.email || "").toLowerCase().trim();
        if (!protectedUids.has(u.uid) && !protectedEmails.has(email)) {
          authUsersToDelete.push({ uid: u.uid, email: u.email || "", displayName: u.displayName || "" });
        }
      }
      nextPageToken = listResult.pageToken;
    } while (nextPageToken);
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al listar usuarios de Firebase Auth en plan: ${err.message}`);
  }

  const deletedUidsSet = new Set(authUsersToDelete.map((u) => u.uid));

  // 3. Firestore /users: identificar candidatos no administrativos y subcolecciones pushTokens
  let usersSnap;
  try {
    usersSnap = await db.collection("users").get();
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al consultar /users: ${err.message}`);
  }

  const firestoreUsersToDelete = [];
  const pushTokensToDelete = [];
  const protectedAdminsList = [];

  for (const doc of usersSnap.docs) {
    const d = doc.data ? doc.data() : doc;
    const uUid = d.uid || d.userUid || doc.id;
    const email = (d.email || "").toLowerCase().trim();

    if (protectedDocIds.has(doc.id) || protectedUids.has(uUid) || protectedEmails.has(email)) {
      protectedAdminsList.push({ id: doc.id, uid: uUid, email: d.email || "", role: d.role || "ADMIN" });
    } else {
      firestoreUsersToDelete.push({
        id: doc.id,
        path: `users/${doc.id}`,
        uid: uUid,
        userCode: d.userCode || "",
        fullName: d.fullName || "",
        email: d.email || "",
        role: d.role || "USER",
        status: d.status || "",
        currentCapital: d.currentCapital || 0,
      });
      deletedUidsSet.add(doc.id);
      if (uUid) deletedUidsSet.add(uUid);

      if (doc.ref && typeof doc.ref.collection === "function") {
        try {
          const tokensSnap = await doc.ref.collection("pushTokens").get();
          for (const tDoc of tokensSnap.docs) {
            pushTokensToDelete.push({ id: tDoc.id, path: `users/${doc.id}/pushTokens/${tDoc.id}`, ref: tDoc.ref });
          }
        } catch (err) {
          throw new Error(`[FAIL_CLOSED] Error al leer subcolección pushTokens de users/${doc.id}: ${err.message}`);
        }
      }
    }
  }

  // 4. monthlyCycles - FAIL CLOSED
  let cyclesSnap;
  try {
    cyclesSnap = await db.collection("monthlyCycles").get();
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al consultar monthlyCycles: ${err.message}`);
  }
  const monthlyCyclesToDelete = cyclesSnap.docs.map((d) => {
    const data = d.data ? d.data() : (d.data || {});
    return {
      id: d.id,
      path: `monthlyCycles/${d.id}`,
      name: data.name || d.id,
      status: data.status || "",
      operationalStatus: data.operationalStatus || "",
      ref: d.ref,
    };
  });
  const deletedCyclesSet = new Set(monthlyCyclesToDelete.map((c) => c.id));

  // 5. cycleFinancialSummaries - FAIL CLOSED
  let finSnap;
  try {
    finSnap = await db.collection("cycleFinancialSummaries").get();
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al consultar cycleFinancialSummaries: ${err.message}`);
  }
  const cycleFinancialSummariesToDelete = finSnap.docs.map((d) => ({
    id: d.id,
    path: `cycleFinancialSummaries/${d.id}`,
    ref: d.ref,
  }));

  // 6. cycleReports & subcollections - FAIL CLOSED
  let reportsSnap;
  try {
    reportsSnap = await db.collection("cycleReports").get();
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al consultar cycleReports: ${err.message}`);
  }
  const cycleReportsToDelete = [];
  for (const rDoc of reportsSnap.docs) {
    cycleReportsToDelete.push({ id: rDoc.id, path: `cycleReports/${rDoc.id}`, ref: rDoc.ref });
    if (rDoc.ref && typeof rDoc.ref.collection === "function") {
      try {
        const versionsSnap = await rDoc.ref.collection("versions").get();
        for (const vDoc of versionsSnap.docs) {
          cycleReportsToDelete.push({ id: vDoc.id, path: `cycleReports/${rDoc.id}/versions/${vDoc.id}`, ref: vDoc.ref });
          if (vDoc.ref && typeof vDoc.ref.collection === "function") {
            const uSnap = await vDoc.ref.collection("users").get();
            for (const uDoc of uSnap.docs) {
              cycleReportsToDelete.push({
                id: uDoc.id,
                path: `cycleReports/${rDoc.id}/versions/${vDoc.id}/users/${uDoc.id}`,
                ref: uDoc.ref,
              });
            }
          }
        }
      } catch (err) {
        throw new Error(`[FAIL_CLOSED] Error al leer subcolecciones de cycleReports/${rDoc.id}: ${err.message}`);
      }
    }
  }

  // 7. cycleUserResults & cycleGroupCalculations - FAIL CLOSED
  let curSnap;
  try {
    curSnap = await db.collection("cycleUserResults").get();
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al consultar cycleUserResults: ${err.message}`);
  }
  const cycleUserResultsToDelete = curSnap.docs.map((d) => ({
    id: d.id,
    path: `cycleUserResults/${d.id}`,
    ref: d.ref,
  }));

  let cgcSnap;
  try {
    cgcSnap = await db.collection("cycleGroupCalculations").get();
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al consultar cycleGroupCalculations: ${err.message}`);
  }
  const cycleGroupCalculationsToDelete = cgcSnap.docs.map((d) => ({
    id: d.id,
    path: `cycleGroupCalculations/${d.id}`,
    ref: d.ref,
  }));

  // 8. dailyOperations - FAIL CLOSED
  let opsSnap;
  try {
    opsSnap = await db.collection("dailyOperations").get();
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al consultar dailyOperations: ${err.message}`);
  }
  const dailyOperationsToDelete = opsSnap.docs.map((d) => ({
    id: d.id,
    path: `dailyOperations/${d.id}`,
    ref: d.ref,
  }));
  const deletedOpsSet = new Set(dailyOperationsToDelete.map((o) => o.id));

  // 9. reinvestments, disbursements, investments - FAIL CLOSED
  let reinvSnap;
  try {
    reinvSnap = await db.collection("reinvestments").get();
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al consultar reinvestments: ${err.message}`);
  }
  const reinvestmentsToDelete = reinvSnap.docs.map((d) => ({
    id: d.id,
    path: `reinvestments/${d.id}`,
    ref: d.ref,
  }));
  const deletedReinvSet = new Set(reinvestmentsToDelete.map((r) => r.id));

  let disbSnap;
  try {
    disbSnap = await db.collection("disbursements").get();
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al consultar disbursements: ${err.message}`);
  }
  const disbursementsToDelete = disbSnap.docs.map((d) => ({
    id: d.id,
    path: `disbursements/${d.id}`,
    ref: d.ref,
  }));
  const deletedDisbSet = new Set(disbursementsToDelete.map((d) => d.id));

  let invSnap;
  try {
    invSnap = await db.collection("investments").get();
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al consultar investments: ${err.message}`);
  }
  const investmentsToDelete = invSnap.docs.map((d) => ({
    id: d.id,
    path: `investments/${d.id}`,
    ref: d.ref,
  }));

  // 10. idempotencyKeys clasificadas - FAIL CLOSED
  let idempotencyDocs = [];
  try {
    const idemSnap = await db.collection("idempotencyKeys").get();
    idempotencyDocs = idemSnap.docs;
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al leer colección idempotencyKeys: ${err.message}`);
  }
  const { idempotencyKeysToDelete, unclassifiedIdempotencyKeys } = classifyIdempotencyKeys(
    idempotencyDocs,
    deletedUidsSet,
    deletedCyclesSet,
    deletedOpsSet,
    deletedReinvSet,
    deletedDisbSet
  );

  // 11. notifications (TODAS AL PLAN DE BORRADO: CONFIRMADO POR EL PROPIETARIO COMO CONTENIDO DE PRUEBA) - FAIL CLOSED
  let notifDocs = [];
  try {
    const notifSnap = await db.collection("notifications").get();
    notifDocs = notifSnap.docs;
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al leer colección notifications: ${err.message}`);
  }
  const notificationsToDelete = notifDocs.map((doc) => ({
    id: doc.id,
    path: `notifications/${doc.id}`,
    ref: doc.ref,
  }));
  const notificationsToUpdate = [];
  const preservedNotifications = [];

  // 12. investorApplications (TODAS AL PLAN DE BORRADO: CONFIRMADO POR EL PROPIETARIO COMO CONTENIDO DE PRUEBA) - FAIL CLOSED
  let appSnap;
  try {
    appSnap = await db.collection("investorApplications").get();
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al consultar investorApplications: ${err.message}`);
  }
  const investorApplicationsToDelete = appSnap.docs.map((doc) => ({
    id: doc.id,
    path: `investorApplications/${doc.id}`,
    ref: doc.ref,
  }));
  const preservedApplications = [];

  // 13. claimOperations vinculadas - FAIL CLOSED
  const claimOperationsToDelete = [];
  const preservedClaimOperations = [];
  try {
    const claimSnap = await db.collection("claimOperations").get();
    for (const doc of claimSnap.docs) {
      const d = doc.data ? doc.data() : (doc.data || {});
      const isLinked =
        (d.canonicalUid && deletedUidsSet.has(d.canonicalUid)) ||
        (d.orphanedAuthUid && deletedUidsSet.has(d.orphanedAuthUid)) ||
        (d.legacyDocId && deletedUidsSet.has(d.legacyDocId)) ||
        (d.legacyUserDocumentId && deletedUidsSet.has(d.legacyUserDocumentId));

      if (isLinked) {
        claimOperationsToDelete.push({ id: doc.id, path: `claimOperations/${doc.id}`, ref: doc.ref });
      } else {
        preservedClaimOperations.push({ id: doc.id, path: `claimOperations/${doc.id}` });
      }
    }
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al consultar claimOperations: ${err.message}`);
  }

  // 14. bitacoras vinculadas - FAIL CLOSED
  const bitacorasToDelete = [];
  const preservedBitacoras = [];
  try {
    const bitSnap = await db.collection("bitacoras").get();
    for (const doc of bitSnap.docs) {
      const d = doc.data ? doc.data() : (doc.data || {});
      if (d.cycleId && deletedCyclesSet.has(d.cycleId)) {
        bitacorasToDelete.push({ id: doc.id, path: `bitacoras/${doc.id}`, ref: doc.ref });
      } else {
        preservedBitacoras.push({ id: doc.id, path: `bitacoras/${doc.id}` });
      }
    }
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al consultar bitacoras: ${err.message}`);
  }

  const plan = {
    protectedAdmins: protectedAdminsList,
    protectedCount: protectedUids.size,
    authUsersToDelete,
    firestoreUsersToDelete,
    pushTokensToDelete,
    monthlyCyclesToDelete,
    cycleFinancialSummariesToDelete,
    cycleReportsToDelete,
    cycleUserResultsToDelete,
    cycleGroupCalculationsToDelete,
    dailyOperationsToDelete,
    reinvestmentsToDelete,
    disbursementsToDelete,
    investmentsToDelete,
    idempotencyKeysToDelete,
    unclassifiedIdempotencyKeys,
    notificationsToDelete,
    notificationsToUpdate,
    preservedNotifications,
    investorApplicationsToDelete,
    preservedApplications,
    claimOperationsToDelete,
    preservedClaimOperations,
    bitacorasToDelete,
    preservedBitacoras,
    settingsResetFields: ["operationalCycleId", "activeCycleId", "preparingCycleId"],
    counterTargetDoc: null,
    counterPreserved: true,
  };

  const previewHash = computeResetPlanHash(plan);

  return { plan, previewHash };
}

/**
 * Guard Financiero Activo para Borrado Individual.
 * Audita si el usuario participa en flujos operativos activos antes de cualquier borrado.
 * FAIL-CLOSED: Si falla la lectura de cualquier colección crítica, aborta la operación.
 */
async function auditUserActiveFinancialDependencies(userId, userDoc, resolvedUid, db) {
  const activeDependencies = [];
  const uidsSet = new Set([userId, resolvedUid].filter(Boolean));

  // 1. Configuración global - FAIL CLOSED
  let configData = {};
  try {
    const configSnap = await db.collection("settings").doc("global_config").get();
    configData = configSnap.exists ? (configSnap.data ? configSnap.data() : configSnap) : {};
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al consultar settings/global_config: ${err.message}`);
  }
  const operationalCycleId = configData.operationalCycleId || configData.activeCycleId;
  const preparingCycleId = configData.preparingCycleId;

  // DELETE_PREPARING_PROVISIONAL_ENTRY_ALLOWED
  // A user assigned only to the authoritative PREPARING cycle has not
  // entered operational trading yet. Positive capital in that provisional
  // profile is therefore not, by itself, an active financial dependency.
  //
  // This exception is deliberately narrow and fail-closed:
  // - entryCycleId must equal settings/global_config.preparingCycleId
  // - the referenced monthlyCycles document must exist
  // - status must be OPEN
  // - operationalStatus must be PREPARING
  //
  // All real financial dependencies checked below remain blocking.
  let isValidProvisionalPreparingEntry = false;

  if (
    userDoc &&
    userDoc.entryCycleId &&
    preparingCycleId &&
    userDoc.entryCycleId === preparingCycleId
  ) {
    let preparingCycleSnap;

    try {
      preparingCycleSnap = await db
        .collection("monthlyCycles")
        .doc(preparingCycleId)
        .get();
    } catch (err) {
      throw new Error(
        `[FAIL_CLOSED] Error al consultar monthlyCycles/${preparingCycleId} para validar borrado de usuario PREPARING: ${err.message}`
      );
    }

    if (preparingCycleSnap.exists) {
      const preparingCycleData = preparingCycleSnap.data
        ? preparingCycleSnap.data()
        : preparingCycleSnap;

      isValidProvisionalPreparingEntry =
        preparingCycleData.status === "OPEN" &&
        preparingCycleData.operationalStatus === "PREPARING";
    }
  }

  // 2. Perfil de usuario
  if (userDoc) {
    if (
      userDoc.entryCycleId &&
      userDoc.entryCycleId === preparingCycleId &&
      !isValidProvisionalPreparingEntry
    ) {
      activeDependencies.push({
        type: "PREPARING_CYCLE_ENTRY",
        entryCycleId: userDoc.entryCycleId,
      });
    }

    if (
      Number(userDoc.currentCapital) > 0 &&
      !isValidProvisionalPreparingEntry
    ) {
      activeDependencies.push({
        type: "POSITIVE_CAPITAL",
        currentCapital: userDoc.currentCapital,
      });
    }

    if (userDoc.externalFundingStatus === "PENDING") {
      activeDependencies.push({
        type: "EXTERNAL_FUNDING_PENDING",
      });
    }
  }

  // 3. Participación en ciclo activo (OPEN/REOPENED con operationalStatus STARTED) - FAIL CLOSED
  if (operationalCycleId) {
    let cycleSnap;
    try {
      cycleSnap = await db.collection("monthlyCycles").doc(operationalCycleId).get();
    } catch (err) {
      throw new Error(`[FAIL_CLOSED] Error al consultar monthlyCycles/${operationalCycleId}: ${err.message}`);
    }
    if (cycleSnap.exists) {
      const cData = cycleSnap.data ? cycleSnap.data() : cycleSnap;
      const isOpenOrStarted =
        (cData.status === "OPEN" || cData.status === "REOPENED") &&
        cData.operationalStatus === "STARTED";

      if (isOpenOrStarted) {
        let curSnap;
        try {
          curSnap = await db.collection("cycleUserResults").where("cycleId", "==", operationalCycleId).get();
        } catch (err) {
          throw new Error(`[FAIL_CLOSED] Error al consultar cycleUserResults de ${operationalCycleId}: ${err.message}`);
        }
        for (const doc of curSnap.docs) {
          const d = doc.data ? doc.data() : doc;
          if (uidsSet.has(d.userUid) || uidsSet.has(d.userId)) {
            activeDependencies.push({ type: "ACTIVE_CYCLE_USER_RESULT", cycleId: operationalCycleId, resultId: doc.id });
          }
        }
      }
    }
  }

  // 4. Reinversiones activas - FAIL CLOSED
  // Bloquear si status es PENDING, APPROVED, NEEDS_REVIEW
  // Bloquear también si externalFundingStatus === "PENDING" o fundingReconciliationStatus === "NEEDS_REVIEW"
  const activeReinvStatuses = ["PENDING", "APPROVED", "NEEDS_REVIEW"];
  try {
    const reinvSnap = await db.collection("reinvestments").get();
    for (const doc of reinvSnap.docs) {
      const d = doc.data ? doc.data() : doc;
      if (uidsSet.has(d.userUid) || uidsSet.has(d.userId)) {
        const st = String(d.status || "").toUpperCase();
        if (activeReinvStatuses.includes(st)) {
          activeDependencies.push({ type: "ACTIVE_REINVESTMENT", reinvestmentId: doc.id, status: d.status });
        }
        if (d.externalFundingStatus === "PENDING") {
          activeDependencies.push({
            type: "REINVESTMENT_EXTERNAL_FUNDING_PENDING",
            reinvestmentId: doc.id,
            externalFundingStatus: d.externalFundingStatus,
          });
        }
        if (d.fundingReconciliationStatus === "NEEDS_REVIEW") {
          activeDependencies.push({
            type: "REINVESTMENT_FUNDING_RECONCILIATION_NEEDS_REVIEW",
            reinvestmentId: doc.id,
            fundingReconciliationStatus: d.fundingReconciliationStatus,
          });
        }
      }
    }
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al consultar reinvestments: ${err.message}`);
  }

  // 5. Desembolsos pendientes o en proceso - FAIL CLOSED
  const activeDisbStatuses = ["PENDING", "PROCESSING", "REQUESTED", "IN_PROCESS"];
  try {
    const disbSnap = await db.collection("disbursements").get();
    for (const doc of disbSnap.docs) {
      const d = doc.data ? doc.data() : doc;
      if (uidsSet.has(d.userUid) || uidsSet.has(d.userId)) {
        if (activeDisbStatuses.includes(String(d.status || "").toUpperCase())) {
          activeDependencies.push({ type: "ACTIVE_DISBURSEMENT", disbursementId: doc.id, status: d.status });
        }
      }
    }
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al consultar disbursements: ${err.message}`);
  }

  // 6. Inversiones pendientes o en proceso - FAIL CLOSED
  const activeInvStatuses = ["PENDING", "PROCESSING", "REQUESTED", "IN_PROCESS"];
  try {
    const invSnap = await db.collection("investments").get();
    for (const doc of invSnap.docs) {
      const d = doc.data ? doc.data() : doc;
      if (uidsSet.has(d.userUid) || uidsSet.has(d.userId)) {
        if (activeInvStatuses.includes(String(d.status || "").toUpperCase())) {
          activeDependencies.push({ type: "ACTIVE_INVESTMENT", investmentId: doc.id, status: d.status });
        }
      }
    }
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al consultar investments: ${err.message}`);
  }

  return activeDependencies;
}

/**
 * Ejecutor Central de Reset del Entorno de Prueba.
 * Reutilizado autoritativamente en la Cloud Function y testeable con Mock DB.
 * Ejecución por fases con protección absoluta contra huérfanos:
 * FASE AUTH -> Si hay cualquier error no idempotente, NO toca Firestore.
 * FASE FIRESTORE -> Batches de máximo 400 escrituras.
 * FASE SETTINGS -> Merge true de cycle pointers a null.
 * FASE COUNTER -> Preservado en Fase 1 (no asumir 1001).
 * FASE AUDIT -> Auditoría completa de éxito o fallo parcial con stage.
 */
async function executeTestEnvironmentResetCore({
  authUid,
  authEmail,
  createdByName,
  confirmation,
  expectedPreviewHash,
  db,
  auth,
  FieldValue,
}) {
  // 1. Validar confirmación canónica estricta
  if (confirmation !== "REINICIAR ENTORNO DE PRUEBA") {
    const err = new Error("La frase de confirmación no coincide. Se requiere exactamente: REINICIAR ENTORNO DE PRUEBA");
    err.code = "invalid-argument";
    throw err;
  }

  // 2. Validar hash de preview
  if (!expectedPreviewHash || typeof expectedPreviewHash !== "string" || !expectedPreviewHash.trim()) {
    const err = new Error("El parámetro 'expectedPreviewHash' es obligatorio para ejecutar el reset.");
    err.code = "invalid-argument";
    throw err;
  }

  // 3. Recalcular plan y hash en caliente - FAIL CLOSED
  const { plan, previewHash } = await buildTestEnvironmentResetPlan(authUid, authEmail, db, auth);

  // 4. Validar STALE PREVIEW - CERO MUTACIONES SI DIFIERE
  if (previewHash !== expectedPreviewHash.trim()) {
    const err = new Error("RESET_PREVIEW_STALE");
    err.code = "failed-precondition";
    throw err;
  }

  // =========================================================================
  // FASE 1: AUTH DELETE
  // =========================================================================
  const authErrors = [];
  let authUsersDeleted = 0;

  for (const u of plan.authUsersToDelete) {
    try {
      await auth.deleteUser(u.uid);
      authUsersDeleted++;
    } catch (err) {
      if (err.code === "auth/user-not-found") {
        authUsersDeleted++; // Idempotente
      } else {
        authErrors.push(`[AuthDelete] UID ${u.uid}: ${err.message || err.code}`);
      }
    }
  }

  // SI EXISTE AL MENOS UN ERROR AUTH NO IDEMPOTENTE:
  // ABORTAR INMEDIATAMENTE SIN TOCAR FIRESTORE. Cero mutaciones Firestore.
  if (authErrors.length > 0) {
    try {
      await db.collection("auditLogs").add({
        action: "TEST_ENVIRONMENT_FULL_RESET",
        performedBy: authUid,
        performedByName: createdByName,
        authEmail,
        timestamp: FieldValue ? FieldValue.serverTimestamp() : new Date().toISOString(),
        previewHash,
        authUsersDeleted,
        totalFirestoreDocsDeleted: 0,
        partialFailure: true,
        stage: "AUTH_DELETE",
        errors: authErrors,
      });
    } catch (_) {}

    return {
      success: false,
      partialFailure: true,
      stage: "AUTH_DELETE",
      previewHash,
      authUsersDeleted,
      firestoreUsersDeleted: 0,
      pushTokensDeleted: 0,
      monthlyCyclesDeleted: 0,
      cycleFinancialSummariesDeleted: 0,
      cycleReportsDeleted: 0,
      cycleUserResultsDeleted: 0,
      cycleGroupCalculationsDeleted: 0,
      dailyOperationsDeleted: 0,
      reinvestmentsDeleted: 0,
      disbursementsDeleted: 0,
      investmentsDeleted: 0,
      idempotencyKeysDeleted: 0,
      notificationsDeleted: 0,
      notificationsUpdated: 0,
      investorApplicationsDeleted: 0,
      claimOperationsDeleted: 0,
      bitacorasDeleted: 0,
      totalEntitiesDeleted: authUsersDeleted,
      counterWasReset: false,
      auditLogged: true,
      errors: authErrors,
    };
  }

  // =========================================================================
  // FASE 2: FIRESTORE DESTRUCTIVE WRITES EN BATCHES <= 400
  // =========================================================================
  let currentStage = "FIRESTORE_DELETE";
  const batchRunner = new FirestoreBatchRunner(db, MAX_BATCH_WRITES);

  let firestoreUsersDeleted = 0;
  let pushTokensDeleted = 0;
  let monthlyCyclesDeleted = 0;
  let cycleFinancialSummariesDeleted = 0;
  let cycleReportsDeleted = 0;
  let cycleUserResultsDeleted = 0;
  let cycleGroupCalculationsDeleted = 0;
  let dailyOperationsDeleted = 0;
  let reinvestmentsDeleted = 0;
  let disbursementsDeleted = 0;
  let investmentsDeleted = 0;
  let idempotencyKeysDeleted = 0;
  let notificationsDeleted = 0;
  let notificationsUpdated = 0;
  let investorApplicationsDeleted = 0;
  let claimOperationsDeleted = 0;
  let bitacorasDeleted = 0;

  try {
    // 1. users
    for (const u of plan.firestoreUsersToDelete) {
      await batchRunner.delete(db.collection("users").doc(u.id));
      firestoreUsersDeleted++;
    }

    // 2. pushTokens
    for (const t of plan.pushTokensToDelete) {
      const ref = t.ref || (db.doc ? db.doc(t.path) : null);
      if (ref) await batchRunner.delete(ref);
      pushTokensDeleted++;
    }

    // 3. monthlyCycles
    for (const c of plan.monthlyCyclesToDelete) {
      await batchRunner.delete(db.collection("monthlyCycles").doc(c.id));
      monthlyCyclesDeleted++;
    }

    // 4. cycleFinancialSummaries
    for (const f of plan.cycleFinancialSummariesToDelete) {
      const ref = f.ref || (db.collection("cycleFinancialSummaries").doc ? db.collection("cycleFinancialSummaries").doc(f.id) : null);
      if (ref) await batchRunner.delete(ref);
      cycleFinancialSummariesDeleted++;
    }

    // 5. cycleReports y subcolecciones
    for (const r of plan.cycleReportsToDelete) {
      const ref = r.ref || (db.doc ? db.doc(r.path) : null);
      if (ref) await batchRunner.delete(ref);
      cycleReportsDeleted++;
    }

    // 6. cycleUserResults
    for (const r of plan.cycleUserResultsToDelete) {
      const ref = r.ref || (db.collection("cycleUserResults").doc ? db.collection("cycleUserResults").doc(r.id) : null);
      if (ref) await batchRunner.delete(ref);
      cycleUserResultsDeleted++;
    }

    // 7. cycleGroupCalculations
    for (const g of plan.cycleGroupCalculationsToDelete) {
      const ref = g.ref || (db.collection("cycleGroupCalculations").doc ? db.collection("cycleGroupCalculations").doc(g.id) : null);
      if (ref) await batchRunner.delete(ref);
      cycleGroupCalculationsDeleted++;
    }

    // 8. dailyOperations
    for (const o of plan.dailyOperationsToDelete) {
      const ref = o.ref || (db.collection("dailyOperations").doc ? db.collection("dailyOperations").doc(o.id) : null);
      if (ref) await batchRunner.delete(ref);
      dailyOperationsDeleted++;
    }

    // 9. reinvestments
    for (const r of plan.reinvestmentsToDelete) {
      const ref = r.ref || (db.collection("reinvestments").doc ? db.collection("reinvestments").doc(r.id) : null);
      if (ref) await batchRunner.delete(ref);
      reinvestmentsDeleted++;
    }

    // 10. disbursements
    for (const d of plan.disbursementsToDelete) {
      const ref = d.ref || (db.collection("disbursements").doc ? db.collection("disbursements").doc(d.id) : null);
      if (ref) await batchRunner.delete(ref);
      disbursementsDeleted++;
    }

    // 11. investments
    for (const i of plan.investmentsToDelete) {
      const ref = i.ref || (db.collection("investments").doc ? db.collection("investments").doc(i.id) : null);
      if (ref) await batchRunner.delete(ref);
      investmentsDeleted++;
    }

    // 12. idempotencyKeys
    for (const k of plan.idempotencyKeysToDelete) {
      const ref = k.ref || (db.collection("idempotencyKeys").doc ? db.collection("idempotencyKeys").doc(k.id) : null);
      if (ref) await batchRunner.delete(ref);
      idempotencyKeysDeleted++;
    }

    // 13. notifications delete
    for (const n of plan.notificationsToDelete) {
      const ref = n.ref || (db.collection("notifications").doc ? db.collection("notifications").doc(n.id) : null);
      if (ref) await batchRunner.delete(ref);
      notificationsDeleted++;
    }

    // 14. notifications update
    for (const n of plan.notificationsToUpdate) {
      const ref = n.ref || (db.collection("notifications").doc ? db.collection("notifications").doc(n.id) : null);
      if (ref) await batchRunner.update(ref, { targetUids: n.remainingTargets });
      notificationsUpdated++;
    }

    // 15. investorApplications
    for (const a of plan.investorApplicationsToDelete) {
      const ref = a.ref || (db.collection("investorApplications").doc ? db.collection("investorApplications").doc(a.id) : null);
      if (ref) await batchRunner.delete(ref);
      investorApplicationsDeleted++;
    }

    // 16. claimOperations
    for (const c of plan.claimOperationsToDelete) {
      const ref = c.ref || (db.collection("claimOperations").doc ? db.collection("claimOperations").doc(c.id) : null);
      if (ref) await batchRunner.delete(ref);
      claimOperationsDeleted++;
    }

    // 17. bitacoras
    for (const b of plan.bitacorasToDelete) {
      const ref = b.ref || (db.collection("bitacoras").doc ? db.collection("bitacoras").doc(b.id) : null);
      if (ref) await batchRunner.delete(ref);
      bitacorasDeleted++;
    }

    // Commit final de batches
    await batchRunner.commit();

    // =========================================================================
    // FASE 3: SETTINGS RESET
    // =========================================================================
    currentStage = "SETTINGS_RESET";
    await db.collection("settings").doc("global_config").set(
      {
        operationalCycleId: null,
        activeCycleId: null,
        preparingCycleId: null,
      },
      { merge: true }
    );

    // =========================================================================
    // FASE 4: COUNTER USERS (PRESERVADO - NO ASUMIR 1001)
    // =========================================================================
    // Conforme a la auditoría técnica y directriz de Fase 1, se preserva el contador sin alterar.
    const counterWasReset = false;

    // =========================================================================
    // FASE 5: AUDITORÍA INMUTABLE
    // =========================================================================
    currentStage = "AUDIT_LOG";
    const totalDeleted =
      authUsersDeleted +
      firestoreUsersDeleted +
      pushTokensDeleted +
      monthlyCyclesDeleted +
      cycleFinancialSummariesDeleted +
      cycleReportsDeleted +
      cycleUserResultsDeleted +
      cycleGroupCalculationsDeleted +
      dailyOperationsDeleted +
      reinvestmentsDeleted +
      disbursementsDeleted +
      investmentsDeleted +
      idempotencyKeysDeleted +
      notificationsDeleted +
      investorApplicationsDeleted +
      claimOperationsDeleted +
      bitacorasDeleted;

    await db.collection("auditLogs").add({
      action: "TEST_ENVIRONMENT_FULL_RESET",
      stage: "COMPLETED",
      partialFailure: false,
      performedBy: authUid,
      performedByName: createdByName,
      authEmail,
      timestamp: FieldValue ? FieldValue.serverTimestamp() : new Date().toISOString(),
      previewHash,
      authUsersDeleted,
      totalFirestoreDocsDeleted: totalDeleted - authUsersDeleted,
      batchesCommitted: batchRunner.batchesCommitted,
      details: {
        firestoreUsersDeleted,
        pushTokensDeleted,
        monthlyCyclesDeleted,
        cycleFinancialSummariesDeleted,
        cycleReportsDeleted,
        cycleUserResultsDeleted,
        cycleGroupCalculationsDeleted,
        dailyOperationsDeleted,
        reinvestmentsDeleted,
        disbursementsDeleted,
        investmentsDeleted,
        idempotencyKeysDeleted,
        notificationsDeleted,
        notificationsUpdated,
        investorApplicationsDeleted,
        claimOperationsDeleted,
        bitacorasDeleted,
        counterWasReset,
      },
      errors: [],
    });

    return {
      success: true,
      partialFailure: false,
      stage: "COMPLETED",
      previewHash,
      authUsersDeleted,
      firestoreUsersDeleted,
      pushTokensDeleted,
      monthlyCyclesDeleted,
      cycleFinancialSummariesDeleted,
      cycleReportsDeleted,
      cycleUserResultsDeleted,
      cycleGroupCalculationsDeleted,
      dailyOperationsDeleted,
      reinvestmentsDeleted,
      disbursementsDeleted,
      investmentsDeleted,
      idempotencyKeysDeleted,
      notificationsDeleted,
      notificationsUpdated,
      investorApplicationsDeleted,
      claimOperationsDeleted,
      bitacorasDeleted,
      totalEntitiesDeleted: totalDeleted,
      counterWasReset,
      auditLogged: true,
      errors: [],
    };
  } catch (firestoreErr) {
    // Si falla Firestore tras haber comenzado, registrar auditoría de fallo parcial con stage
    try {
      await db.collection("auditLogs").add({
        action: "TEST_ENVIRONMENT_FULL_RESET",
        stage: currentStage,
        partialFailure: true,
        performedBy: authUid,
        performedByName: createdByName,
        authEmail,
        timestamp: FieldValue ? FieldValue.serverTimestamp() : new Date().toISOString(),
        previewHash,
        authUsersDeleted,
        totalFirestoreDocsDeleted: batchRunner.totalCommitted,
        batchesCommitted: batchRunner.batchesCommitted,
        errors: [firestoreErr.message],
      });
    } catch (_) {}

    return {
      success: false,
      partialFailure: true,
      stage: currentStage,
      previewHash,
      authUsersDeleted,
      firestoreUsersDeleted,
      pushTokensDeleted,
      totalFirestoreDocsDeleted: batchRunner.totalCommitted,
      counterWasReset: false,
      auditLogged: true,
      errors: [firestoreErr.message],
    };
  }
}

/**
 * Ejecutor Central de Borrado Individual Seguro.
 * Reutilizado autoritativamente en Cloud Function y testeable con Mock DB.
 * FAIL-CLOSED: Si falla la lectura de cuentas protegidas o dependencias financieras, aborta inmediatamente.
 */
async function deleteIndividualUserCore({
  authUid,
  authEmail,
  createdByName,
  targetId,
  confirmation,
  db,
  auth,
  FieldValue,
}) {
  if (!targetId || typeof targetId !== "string" || !targetId.trim()) {
    const err = new Error("El identificador del usuario (userId / uid) es obligatorio y debe ser un string no vacío.");
    err.code = "invalid-argument";
    throw err;
  }
  const cleanTargetId = targetId.trim();

  // 1. Verificación de Cuentas Protegidas - FAIL CLOSED
  const { protectedUids, protectedDocIds, protectedEmails } = await getProtectedAccounts(authUid, authEmail, db, auth);

  if (
    protectedUids.has(cleanTargetId) ||
    protectedDocIds.has(cleanTargetId) ||
    protectedEmails.has(cleanTargetId.toLowerCase())
  ) {
    const err = new Error("Está estrictamente prohibido eliminar a un Administrador o SuperAdmin del sistema.");
    err.code = "permission-denied";
    throw err;
  }

  // 2. Resolver Documento de Firestore y Auth
  let userDoc = null;
  let resolvedDocId = null;
  let resolvedUid = null;
  let resolvedEmail = null;

  const directDocSnap = await db.collection("users").doc(cleanTargetId).get();
  if (directDocSnap.exists) {
    userDoc = directDocSnap.data ? directDocSnap.data() : directDocSnap;
    resolvedDocId = directDocSnap.id;
    resolvedUid = userDoc.uid || userDoc.userUid || directDocSnap.id;
    resolvedEmail = (userDoc.email || "").toLowerCase().trim();
  } else {
    const querySnap = await db.collection("users").where("uid", "==", cleanTargetId).limit(1).get();
    if (!querySnap.empty) {
      const d = querySnap.docs[0];
      userDoc = d.data ? d.data() : d;
      resolvedDocId = d.id;
      resolvedUid = userDoc.uid || userDoc.userUid || d.id;
      resolvedEmail = (userDoc.email || "").toLowerCase().trim();
    } else {
      const codeSnap = await db.collection("users").where("userCode", "==", cleanTargetId).limit(1).get();
      if (!codeSnap.empty) {
        const d = codeSnap.docs[0];
        userDoc = d.data ? d.data() : d;
        resolvedDocId = d.id;
        resolvedUid = userDoc.uid || userDoc.userUid || d.id;
        resolvedEmail = (userDoc.email || "").toLowerCase().trim();
      }
    }
  }

  let authRecord = null;
  try {
    authRecord = await auth.getUser(cleanTargetId);
    if (!resolvedUid) resolvedUid = authRecord.uid;
    if (!resolvedEmail && authRecord.email) resolvedEmail = authRecord.email.toLowerCase().trim();
  } catch (_) {}

  if (!authRecord && resolvedUid) {
    try {
      authRecord = await auth.getUser(resolvedUid);
      if (!resolvedEmail && authRecord.email) resolvedEmail = authRecord.email.toLowerCase().trim();
    } catch (_) {}
  }

  if (!userDoc && !authRecord) {
    const err = new Error(`No se encontró ningún usuario con el identificador '${cleanTargetId}'.`);
    err.code = "not-found";
    throw err;
  }

  // Verificar claims o rol administrativo
  if (authRecord) {
    const claims = authRecord.customClaims || {};
    if (
      claims.admin === true ||
      claims.superadmin === true ||
      protectedEmails.has((authRecord.email || "").toLowerCase().trim())
    ) {
      const err = new Error("Está estrictamente prohibido eliminar a un Administrador con claims autoritativos.");
      err.code = "permission-denied";
      throw err;
    }
  }
  if (userDoc && (userDoc.role === "ADMIN" || (userDoc.userCode && userDoc.userCode.startsWith("ADM")))) {
    const err = new Error("El usuario tiene rol administrativo en Firestore y no puede ser eliminado.");
    err.code = "permission-denied";
    throw err;
  }

  // 3. Validación de Confirmación Exacta
  const userCode = userDoc?.userCode;
  const targetEmail = resolvedEmail || (authRecord && authRecord.email) || userDoc?.email;
  const expectedConfirmation = userCode
    ? `ELIMINAR ${userCode}`
    : `ELIMINAR ${targetEmail || cleanTargetId}`;

  const cleanConfirmation = typeof confirmation === "string" ? confirmation.trim() : "";
  if (cleanConfirmation !== expectedConfirmation) {
    const err = new Error(`Confirmación no coincide. Se requiere exactamente: '${expectedConfirmation}'`);
    err.code = "invalid-argument";
    throw err;
  }

  // 4. Guard Financiero Activo - ANTES DE CUALQUIER MUTACIÓN (FAIL-CLOSED)
  const activeDeps = await auditUserActiveFinancialDependencies(resolvedDocId || cleanTargetId, userDoc, resolvedUid, db);
  if (activeDeps.length > 0) {
    const err = new Error(`USER_HAS_ACTIVE_FINANCIAL_DEPENDENCIES: El usuario no puede ser eliminado porque tiene flujos financieros activos. Dependencias: ${JSON.stringify(activeDeps)}`);
    err.code = "failed-precondition";
    err.details = activeDeps;
    throw err;
  }

  // 5. Identificar Ciclos Cerrados para PRESERVAR HISTÓRICO - FAIL CLOSED
  const closedCycleIds = new Set();
  try {
    const cyclesSnap = await db.collection("monthlyCycles").get();
    cyclesSnap.forEach((doc) => {
      const d = doc.data ? doc.data() : doc;
      const status = String(d.status || "").toUpperCase();
      if (["CLOSED", "CLOSED_MONTH", "FINALIZED"].includes(status)) {
        closedCycleIds.add(doc.id);
      }
    });
  } catch (err) {
    throw new Error(`[FAIL_CLOSED] Error al consultar monthlyCycles para verificar histórico: ${err.message}`);
  }

  const uidsToDeleteSet = new Set([cleanTargetId, resolvedUid, resolvedDocId].filter(Boolean));

  // 6. Eliminar de Firebase Auth (FAIL-CLOSED: Si falla con error no-idempotente, ABORTA antes de tocar Firestore)
  let authDeleted = false;
  if (resolvedUid) {
    try {
      await auth.deleteUser(resolvedUid);
      authDeleted = true;
    } catch (err) {
      if (err.code === "auth/user-not-found") {
        authDeleted = true; // Idempotente
      } else {
        const e = new Error(`[AuthDeleteFailure] Fallo al eliminar usuario de Firebase Auth (${err.code || err.message}). Operación abortada sin tocar Firestore.`);
        e.code = "internal";
        throw e;
      }
    }
  }

  // 7. Eliminar Firestore /users y subcolección pushTokens
  let pushTokensDeleted = 0;
  if (resolvedDocId) {
    const userRef = db.collection("users").doc(resolvedDocId);
    if (userRef && typeof userRef.collection === "function") {
      try {
        const tokensSnap = await userRef.collection("pushTokens").get();
        for (const tDoc of tokensSnap.docs) {
          await tDoc.ref.delete();
          pushTokensDeleted++;
        }
      } catch (_) {}
    }
    await userRef.delete();
  }

  // 8. Cascada respetando HISTÓRICO CLOSED
  const preservedHistoricalRecords = {
    cycleUserResults: 0,
    reinvestments: 0,
    disbursements: 0,
    investments: 0,
    dailyOperations: 0,
  };

  let cycleUserResultsDeleted = 0;
  const curSnap = await db.collection("cycleUserResults").get();
  for (const doc of curSnap.docs) {
    const d = doc.data ? doc.data() : doc;
    if (uidsToDeleteSet.has(d.userUid) || uidsToDeleteSet.has(d.userId)) {
      if (d.cycleId && closedCycleIds.has(d.cycleId)) {
        preservedHistoricalRecords.cycleUserResults++;
      } else {
        await doc.ref.delete();
        cycleUserResultsDeleted++;
      }
    }
  }

  let reinvestmentsDeleted = 0;
  const reinvSnap = await db.collection("reinvestments").get();
  for (const doc of reinvSnap.docs) {
    const d = doc.data ? doc.data() : doc;
    if (uidsToDeleteSet.has(d.userUid) || uidsToDeleteSet.has(d.userId)) {
      const st = String(d.status || "").toUpperCase();
      if (["APPLIED", "REJECTED"].includes(st)) {
        preservedHistoricalRecords.reinvestments++;
      } else {
        await doc.ref.delete();
        reinvestmentsDeleted++;
      }
    }
  }

  let disbursementsDeleted = 0;
  const disbSnap = await db.collection("disbursements").get();
  for (const doc of disbSnap.docs) {
    const d = doc.data ? doc.data() : doc;
    if (uidsToDeleteSet.has(d.userUid) || uidsToDeleteSet.has(d.userId)) {
      const st = String(d.status || "").toUpperCase();
      if (["PAID", "REJECTED", "COMPLETED"].includes(st)) {
        preservedHistoricalRecords.disbursements++;
      } else {
        await doc.ref.delete();
        disbursementsDeleted++;
      }
    }
  }

  let investmentsDeleted = 0;
  const invSnap = await db.collection("investments").get();
  for (const doc of invSnap.docs) {
    const d = doc.data ? doc.data() : doc;
    if (uidsToDeleteSet.has(d.userUid) || uidsToDeleteSet.has(d.userId)) {
      const st = String(d.status || "").toUpperCase();
      if (["COMPLETED", "REJECTED"].includes(st)) {
        preservedHistoricalRecords.investments++;
      } else {
        await doc.ref.delete();
        investmentsDeleted++;
      }
    }
  }

  // dailyOperations: NO modificar authorizedUids si el ciclo está CLOSED
  let dailyOperationsUpdated = 0;
  const dailySnap = await db.collection("dailyOperations").get();
  for (const doc of dailySnap.docs) {
    const d = doc.data ? doc.data() : doc;
    const authorized = Array.isArray(d.authorizedUids) ? d.authorizedUids : [];
    if (authorized.some((id) => uidsToDeleteSet.has(id))) {
      if (d.cycleId && closedCycleIds.has(d.cycleId)) {
        preservedHistoricalRecords.dailyOperations++;
      } else {
        const remaining = authorized.filter((id) => !uidsToDeleteSet.has(id));
        await doc.ref.update({ authorizedUids: remaining });
        dailyOperationsUpdated++;
      }
    }
  }

  // 9. Auditoría inmutable con acción exacta ADMIN_USER_DELETED
  try {
    await db.collection("auditLogs").add({
      action: "ADMIN_USER_DELETED",
      targetUserId: resolvedDocId || cleanTargetId,
      targetUid: resolvedUid || cleanTargetId,
      targetEmail: resolvedEmail,
      performedBy: authUid,
      performedByName: createdByName,
      authEmail,
      timestamp: FieldValue ? FieldValue.serverTimestamp() : new Date().toISOString(),
      details: {
        authDeleted,
        firestoreDocDeleted: true,
        pushTokensDeleted,
        cycleUserResultsDeleted,
        reinvestmentsDeleted,
        disbursementsDeleted,
        investmentsDeleted,
        dailyOperationsUpdated,
        preservedHistoricalRecords,
      },
    });
  } catch (auditErr) {
    const err = new Error(`[AuditLogFailure] Error al registrar auditoría: ${auditErr.message}`);
    err.code = "internal";
    throw err;
  }

  return {
    success: true,
    targetUserId: resolvedDocId || cleanTargetId,
    targetUid: resolvedUid || cleanTargetId,
    authDeleted,
    firestoreDocDeleted: true,
    cleanedRecords: {
      pushTokens: pushTokensDeleted,
      cycleUserResults: cycleUserResultsDeleted,
      reinvestments: reinvestmentsDeleted,
      disbursements: disbursementsDeleted,
      investments: investmentsDeleted,
      dailyOperationsUpdated,
    },
    preservedHistoricalRecords,
  };
}

/**
 * Helper: Serialización segura para JSON / HTTPS Callable.
 * Elimina recursivamente propiedades 'ref' (Firestore DocumentReference)
 * y valores no serializables (funciones, undefined) antes de devolver el plan al cliente.
 */
function serializeResetPlanForCallable(value) {
  if (Array.isArray(value)) {
    return value.map(serializeResetPlanForCallable);
  }

  if (value && typeof value === "object") {
    const out = {};

    for (const [key, val] of Object.entries(value)) {
      if (key === "ref") continue;
      if (typeof val === "function" || typeof val === "undefined") continue;

      out[key] = serializeResetPlanForCallable(val);
    }

    return out;
  }

  return value;
}

module.exports = {
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
};
