const crypto = require("crypto");

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function generateCanonicalCycleId() {
  return `cyc_${crypto.randomUUID()}`;
}

function getCanonicalCategoryForCapital(capitalCop) {
  const cap = Number(capitalCop) || 0;
  if (cap >= 60000000) return "NEGRA";
  if (cap >= 10000000) return "VERDE";
  return "AZUL";
}

/**
 * Validación Pre-Transaccional de Cero Historial (FAIL-CLOSED)
 */
async function validateGenesisNoHistoryPreCheck(db) {
  try {
    const [
      monthlyCyclesSnap,
      dailyOpsSnap,
      summariesSnap,
      resultsSnap,
      groupsSnap,
      reinvSnap,
      disbSnap,
      invSnap,
    ] = await Promise.all([
      db.collection("monthlyCycles").limit(1).get(),
      db.collection("dailyOperations").limit(1).get(),
      db.collection("cycleFinancialSummaries").limit(1).get(),
      db.collection("cycleUserResults").limit(1).get(),
      db.collection("cycleGroupCalculations").limit(1).get(),
      db.collection("reinvestments").limit(1).get(),
      db.collection("disbursements").limit(1).get(),
      db.collection("investments").limit(1).get(),
    ]);

    const hasHistory =
      !monthlyCyclesSnap.empty ||
      !dailyOpsSnap.empty ||
      !summariesSnap.empty ||
      !resultsSnap.empty ||
      !groupsSnap.empty ||
      !reinvSnap.empty ||
      !disbSnap.empty ||
      !invSnap.empty;

    if (hasHistory) {
      const err = new Error("NO_HISTORY_VIOLATION: Se detectaron registros operativos o ciclos preexistentes en la base de datos incompatibles con la creación del ciclo génesis.");
      err.code = "failed-precondition";
      throw err;
    }
  } catch (err) {
    if (err.code === "failed-precondition") throw err;
    const failClosedErr = new Error(`[FAIL_CLOSED] Error al verificar guard NO-HISTORY pre-transaccional: ${err.message}`);
    failClosedErr.code = "failed-precondition";
    throw failClosedErr;
  }
}

/**
 * Validación Transaccional de Cero Historial y Configuración Global (FAIL-CLOSED)
 * Se ejecuta dentro de db.runTransaction(async (transaction) => { ... })
 * Realiza todas las lecturas de Query y Documentos antes de cualquier escritura.
 */
async function validateGenesisNoHistoryTransactional({ transaction, db, candidateRef, configRef, idemRef, cleanClientRequestId, cleanName, cleanTrm }) {
  const [
    monthlyCyclesQuerySnap,
    dailyOpsQuerySnap,
    summariesQuerySnap,
    resultsQuerySnap,
    groupsQuerySnap,
    reinvQuerySnap,
    disbQuerySnap,
    invQuerySnap,
    idemSnap,
    configSnap,
    candidateSnap,
  ] = await Promise.all([
    transaction.get(db.collection("monthlyCycles").limit(1)),
    transaction.get(db.collection("dailyOperations").limit(1)),
    transaction.get(db.collection("cycleFinancialSummaries").limit(1)),
    transaction.get(db.collection("cycleUserResults").limit(1)),
    transaction.get(db.collection("cycleGroupCalculations").limit(1)),
    transaction.get(db.collection("reinvestments").limit(1)),
    transaction.get(db.collection("disbursements").limit(1)),
    transaction.get(db.collection("investments").limit(1)),
    transaction.get(idemRef),
    transaction.get(configRef),
    transaction.get(candidateRef),
  ]);

  // A. Verificación de Idempotencia dentro de la transacción
  if (idemSnap && (typeof idemSnap.exists === "function" ? idemSnap.exists() : idemSnap.exists)) {
    const existingData = typeof idemSnap.data === "function" ? idemSnap.data() || {} : idemSnap.data || {};
    if (
      existingData.name === cleanName &&
      existingData.action === "CREATE_GENESIS_CYCLE"
    ) {
      return { isIdempotentReplay: true, cycleId: existingData.cycleId };
    }
    const conflictErr = new Error(`IDEMPOTENCY_KEY_CONFLICT: El clientRequestId '${cleanClientRequestId}' ya fue procesado con parámetros diferentes.`);
    conflictErr.code = "already-exists";
    throw conflictErr;
  }

  // B. Verificación de Cero Historial en colecciones operativas
  const hasHistory =
    !monthlyCyclesQuerySnap.empty ||
    !dailyOpsQuerySnap.empty ||
    !summariesQuerySnap.empty ||
    !resultsQuerySnap.empty ||
    !groupsQuerySnap.empty ||
    !reinvQuerySnap.empty ||
    !disbQuerySnap.empty ||
    !invQuerySnap.empty;

  if (hasHistory) {
    const histErr = new Error("NO_HISTORY_VIOLATION: Se detectaron registros operativos o ciclos preexistentes dentro de la transacción.");
    histErr.code = "failed-precondition";
    throw histErr;
  }

  // C. Verificación de configuración canónica (settings/global_config)
  const configExists = typeof configSnap.exists === "function" ? configSnap.exists() : configSnap.exists;
  const configData = configExists ? (typeof configSnap.data === "function" ? configSnap.data() || {} : configSnap.data || {}) : {};

  if (configData.operationalCycleId !== null && configData.operationalCycleId !== undefined) {
    const err = new Error(`GENESIS_ALREADY_EXISTS: Ya existe un ciclo operativo activo (${configData.operationalCycleId}).`);
    err.code = "failed-precondition";
    throw err;
  }

  if (configData.preparingCycleId !== null && configData.preparingCycleId !== undefined) {
    const err = new Error(`GENESIS_ALREADY_EXISTS: Ya existe un ciclo en preparación (${configData.preparingCycleId}).`);
    err.code = "failed-precondition";
    throw err;
  }

  if (configData.activeCycleId !== null && configData.activeCycleId !== undefined) {
    const err = new Error(`GENESIS_ALREADY_EXISTS: Ya existe un ciclo activo configurado (${configData.activeCycleId}).`);
    err.code = "failed-precondition";
    throw err;
  }

  if (configData.lastClosedCycleId !== null && configData.lastClosedCycleId !== undefined) {
    const err = new Error(`NO_HISTORY_VIOLATION: settings/global_config registra un ciclo cerrado previo (${configData.lastClosedCycleId}).`);
    err.code = "failed-precondition";
    throw err;
  }

  const candExists = typeof candidateSnap.exists === "function" ? candidateSnap.exists() : candidateSnap.exists;
  if (candExists) {
    const err = new Error("Colisión de identificador de ciclo génesis generado.");
    err.code = "already-exists";
    throw err;
  }

  return { isIdempotentReplay: false, cycleId: null };
}

/**
 * Lógica Core de Creación de Ciclo Génesis
 */
async function createGenesisCycleCore({
  db,
  authUid,
  createdByName,
  name,
  trmApplied,
  clientRequestId,
  isSuperAdmin,
}) {
  if (!isSuperAdmin) {
    const err = new Error("PERMISSION_DENIED: Se requieren privilegios de SuperAdmin para crear el ciclo génesis.");
    err.code = "permission-denied";
    throw err;
  }

  if (!clientRequestId || typeof clientRequestId !== "string" || !clientRequestId.trim()) {
    const err = new Error("INVALID_CLIENT_REQUEST_ID: clientRequestId es obligatorio.");
    err.code = "invalid-argument";
    throw err;
  }
  const cleanClientRequestId = clientRequestId.trim();
  if (!UUID_V4_REGEX.test(cleanClientRequestId)) {
    const err = new Error("INVALID_CLIENT_REQUEST_ID: clientRequestId debe ser un UUID v4 válido conforme a RFC 4122.");
    err.code = "invalid-argument";
    throw err;
  }

  if (!name || typeof name !== "string") {
    const err = new Error("INVALID_NAME: El nombre del ciclo es obligatorio.");
    err.code = "invalid-argument";
    throw err;
  }
  const cleanName = name.trim();
  if (cleanName.length < 3 || cleanName.length > 60) {
    const err = new Error("INVALID_NAME: El nombre del ciclo debe tener entre 3 y 60 caracteres.");
    err.code = "invalid-argument";
    throw err;
  }

  const cleanTrm = Number.isFinite(Number(trmApplied)) && Number(trmApplied) > 0 ? Number(trmApplied) : null;

  const candidateCycleId = generateCanonicalCycleId();
  const idemRef = db.collection("idempotencyKeys").doc(`create_genesis_${cleanClientRequestId}`);
  const candidateRef = db.collection("monthlyCycles").doc(candidateCycleId);
  const configRef = db.collection("settings").doc("global_config");

  // 1. Verificación rápida de Idempotencia previa fuera de transacción
  const initialIdemSnap = await idemRef.get();
  const initialIdemExists = typeof initialIdemSnap.exists === "function" ? initialIdemSnap.exists() : initialIdemSnap.exists;
  if (initialIdemExists) {
    const existingData = typeof initialIdemSnap.data === "function" ? initialIdemSnap.data() || {} : initialIdemSnap.data || {};
    if (
      existingData.name === cleanName &&
      existingData.action === "CREATE_GENESIS_CYCLE"
    ) {
      return {
        success: true,
        cycleId: existingData.cycleId,
        name: cleanName,
        status: "OPEN",
        operationalStatus: "PREPARING",
        previousCycleId: null,
        isGenesis: true,
        cohortVersion: 1,
        trmApplied: cleanTrm,
        closingTrm: null,
        idempotentReplay: true,
        message: `Operación idempotente: El ciclo génesis ${existingData.cycleId} ya había sido creado previamente.`,
      };
    }
    const conflictErr = new Error(`IDEMPOTENCY_KEY_CONFLICT: El clientRequestId '${cleanClientRequestId}' ya fue procesado con parámetros diferentes.`);
    conflictErr.code = "already-exists";
    throw conflictErr;
  }

  // 2. Verificación rápida fuera de transacción (Pre-check optimizado)
  await validateGenesisNoHistoryPreCheck(db);

  // 3. Transacción Atómica
  let resultCycleId = null;
  let isIdempotentReplay = false;

  await db.runTransaction(async (transaction) => {
    const transCheck = await validateGenesisNoHistoryTransactional({
      transaction,
      db,
      candidateRef,
      configRef,
      idemRef,
      cleanClientRequestId,
      cleanName,
      cleanTrm,
    });

    if (transCheck.isIdempotentReplay) {
      resultCycleId = transCheck.cycleId;
      isIdempotentReplay = true;
      return;
    }

    const nowIso = new Date().toISOString();
    const newCyclePayload = {
      id: candidateCycleId,
      cycleId: candidateCycleId,
      name: cleanName,
      status: "OPEN",
      operationalStatus: "PREPARING",
      previousCycleId: null,
      nextCycleId: null,
      isGenesis: true,
      cohortVersion: 1,
      trmApplied: cleanTrm,
      closingTrm: null,
      closingTrmSetAt: null,
      closingTrmSetByUid: null,
      closingTrmSetByName: null,
      observedMarketTrmAtClose: null,
      createdAt: nowIso,
      openedAt: nowIso,
      startedAt: null,
      closedAt: null,
      isStarting: false,
      startAttemptId: null,
      isClosing: false,
      closingStartedAt: null,
      closingByUid: null,
      closingByName: null,
      closureAttemptId: null,
      notificationsSent: false,
      notificationsSentAt: null,
    };

    transaction.set(candidateRef, newCyclePayload);

    transaction.set(
      configRef,
      {
        preparingCycleId: candidateCycleId,
        updatedAt: nowIso,
      },
      { merge: true }
    );

    transaction.set(idemRef, {
      action: "CREATE_GENESIS_CYCLE",
      cycleId: candidateCycleId,
      name: cleanName,
      trmApplied: cleanTrm,
      clientRequestId: cleanClientRequestId,
      createdAt: nowIso,
      createdByUid: authUid,
      createdByName: createdByName || "Super Admin",
    });

    resultCycleId = candidateCycleId;
  });

  if (!isIdempotentReplay) {
    await db.collection("auditLogs").add({
      action: "ADMIN_CREATE_GENESIS_CYCLE",
      cycleId: resultCycleId,
      performedBy: authUid,
      performedByName: createdByName || "Super Admin",
      targetEntity: resultCycleId,
      details: {
        name: cleanName,
        trmApplied: cleanTrm,
        operationalStatus: "PREPARING",
        isGenesis: true,
        cohortVersion: 1,
      },
      timestamp: new Date().toISOString(),
    }).catch(() => {});
  }

  return {
    success: true,
    cycleId: resultCycleId,
    name: cleanName,
    status: "OPEN",
    operationalStatus: "PREPARING",
    previousCycleId: null,
    isGenesis: true,
    cohortVersion: 1,
    trmApplied: cleanTrm,
    closingTrm: null,
    idempotentReplay: isIdempotentReplay,
    message: isIdempotentReplay
      ? `Operación idempotente: El ciclo génesis ${resultCycleId} ya había sido creado previamente.`
      : `Ciclo génesis ${resultCycleId} creado exitosamente en estado PREPARING.`,
  };
}

/**
 * Validación Autoritativa de Ciclo Objetivo para Nuevos Usuarios / Inversionistas Pendientes
 */
async function validateTargetCycleForUserEntry({ db, targetCycleId }) {
  if (!targetCycleId || typeof targetCycleId !== "string" || !targetCycleId.trim()) {
    return null;
  }
  const cleanTargetCycleId = targetCycleId.trim();
  const targetCycleRef = db.collection("monthlyCycles").doc(cleanTargetCycleId);
  const targetCycleSnap = await targetCycleRef.get();

  const targetCycleExists = typeof targetCycleSnap.exists === "function" ? targetCycleSnap.exists() : targetCycleSnap.exists;
  if (!targetCycleExists) {
    const err = new Error(`El ciclo especificado (${cleanTargetCycleId}) no existe.`);
    err.code = "not-found";
    throw err;
  }

  const targetCycleData = typeof targetCycleSnap.data === "function" ? targetCycleSnap.data() || {} : targetCycleSnap.data || {};
  if (targetCycleData.status !== "OPEN") {
    const err = new Error(`TARGET_CYCLE_NOT_OPEN: El ciclo objetivo (${cleanTargetCycleId}) no se encuentra abierto.`);
    err.code = "failed-precondition";
    throw err;
  }
  if (targetCycleData.operationalStatus !== "PREPARING") {
    const err = new Error(`TARGET_CYCLE_NOT_PREPARING: El ciclo objetivo (${cleanTargetCycleId}) debe estar en estado de preparación (PREPARING).`);
    err.code = "failed-precondition";
    throw err;
  }

  if (!targetCycleData.previousCycleId) {
    // Validación estricta de Ciclo Génesis
    try {
      const [globalConfigSnap, monthlyCyclesSnap] = await Promise.all([
        db.collection("settings").doc("global_config").get(),
        db.collection("monthlyCycles").get(),
      ]);

      const globalConfigExists = typeof globalConfigSnap.exists === "function" ? globalConfigSnap.exists() : globalConfigSnap.exists;
      const globalConfig = globalConfigExists ? (typeof globalConfigSnap.data === "function" ? globalConfigSnap.data() || {} : globalConfigSnap.data || {}) : {};

      const cyclesCount = typeof monthlyCyclesSnap.size === "number" ? monthlyCyclesSnap.size : (monthlyCyclesSnap.docs ? monthlyCyclesSnap.docs.length : 0);

      const isStrictGenesis =
        targetCycleData.isGenesis === true &&
        (targetCycleData.previousCycleId === null || targetCycleData.previousCycleId === undefined) &&
        targetCycleData.status === "OPEN" &&
        targetCycleData.operationalStatus === "PREPARING" &&
        globalConfig.preparingCycleId === cleanTargetCycleId &&
        (globalConfig.operationalCycleId === null || globalConfig.operationalCycleId === undefined) &&
        (globalConfig.activeCycleId === null || globalConfig.activeCycleId === undefined) &&
        (globalConfig.lastClosedCycleId === null || globalConfig.lastClosedCycleId === undefined) &&
        cyclesCount === 1;

      if (!isStrictGenesis) {
        const err = new Error(`TARGET_CYCLE_NO_PREVIOUS: El ciclo objetivo (${cleanTargetCycleId}) no tiene ciclo previo registrado ni cumple con las condiciones estrictas del ciclo génesis (monthlyCycles=${cyclesCount}).`);
        err.code = "failed-precondition";
        throw err;
      }
    } catch (readErr) {
      if (readErr.code === "failed-precondition") throw readErr;
      const err = new Error(`[FAIL_CLOSED] Error al validar ciclo génesis para nuevo usuario: ${readErr.message}`);
      err.code = "failed-precondition";
      throw err;
    }
  } else {
    const prevCycleSnap = await db.collection("monthlyCycles").doc(targetCycleData.previousCycleId).get();
    const prevExists = typeof prevCycleSnap.exists === "function" ? prevCycleSnap.exists() : prevCycleSnap.exists;
    const prevData = prevExists ? (typeof prevCycleSnap.data === "function" ? prevCycleSnap.data() || {} : prevCycleSnap.data || {}) : {};

    if (!prevExists || prevData.status !== "CLOSED") {
      const err = new Error(`PREDECESSOR_CYCLE_NOT_CLOSED_FOR_NEW_ENTRY: El ciclo predecesor (${targetCycleData.previousCycleId}) debe estar en estado CLOSED para autorizar el ingreso de un nuevo inversionista en ${cleanTargetCycleId}.`);
      err.code = "failed-precondition";
      throw err;
    }
  }

  return cleanTargetCycleId;
}

/**
 * Guard de Inicio Operativo para Ciclo Génesis y Detección de Participantes Pendientes
 */
async function validateStartCycleGenesisAndPendingGuard({ db, targetCycleId, cycleData }) {
  // 1. Participantes pendientes en /users (PENDING_ACTIVATION o PENDING_CLAIM)
  const allEntriesSnap = await db.collection("users").where("entryCycleId", "==", targetCycleId).get();
  const pendingParticipants = [];
  const activeParticipants = [];

  const docs = allEntriesSnap.docs || [];
  for (const doc of docs) {
    const u = typeof doc.data === "function" ? doc.data() || {} : doc.data || {};
    const docId = doc.id;
    if (u.status === "PENDING_ACTIVATION" || u.status === "PENDING_CLAIM") {
      pendingParticipants.push(docId);
    } else if (u.status === "ACTIVE") {
      activeParticipants.push({ id: docId, ref: doc.ref, ...u });
    }
  }

  if (pendingParticipants.length > 0) {
    const err = new Error(`PENDING_PARTICIPANTS_REQUIRE_ACTIVATION: Existen ${pendingParticipants.length} inversionistas con activación o claim pendiente para este ciclo. Todos los participantes registrados deben completar su activación antes del inicio operativo.`);
    err.code = "failed-precondition";
    throw err;
  }

  // 2. Si previousCycleId === null, validar guard NO-HISTORY completo
  if (!cycleData.previousCycleId) {
    if (cycleData.isGenesis !== true) {
      const err = new Error(`CYCLE_LINK_MISMATCH: El ciclo ${targetCycleId} no especifica un ciclo previo ni es un ciclo génesis válido.`);
      err.code = "failed-precondition";
      throw err;
    }

    const globalConfigSnap = await db.collection("settings").doc("global_config").get();
    const configExists = typeof globalConfigSnap.exists === "function" ? globalConfigSnap.exists() : globalConfigSnap.exists;
    const globalConfig = configExists ? (typeof globalConfigSnap.data === "function" ? globalConfigSnap.data() || {} : globalConfigSnap.data || {}) : {};

    if (globalConfig.operationalCycleId !== null && globalConfig.operationalCycleId !== undefined) {
      const err = new Error("NO_HISTORY_VIOLATION: Ya existe un ciclo operativo activo en settings/global_config.");
      err.code = "failed-precondition";
      throw err;
    }
    if (globalConfig.activeCycleId !== null && globalConfig.activeCycleId !== undefined) {
      const err = new Error("NO_HISTORY_VIOLATION: Ya existe un ciclo activo configurado en settings/global_config.");
      err.code = "failed-precondition";
      throw err;
    }
    if (globalConfig.preparingCycleId !== targetCycleId) {
      const err = new Error("NO_HISTORY_VIOLATION: settings/global_config.preparingCycleId no coincide con el ciclo génesis.");
      err.code = "failed-precondition";
      throw err;
    }
    if (globalConfig.lastClosedCycleId !== null && globalConfig.lastClosedCycleId !== undefined) {
      const err = new Error("NO_HISTORY_VIOLATION: settings/global_config registra un ciclo previo cerrado.");
      err.code = "failed-precondition";
      throw err;
    }

    try {
      const [
        cyclesSnap,
        opsSnap,
        summariesSnap,
        resSnap,
        groupsSnap,
        reinvAllSnap,
        disbAllSnap,
        invAllSnap,
      ] = await Promise.all([
        db.collection("monthlyCycles").get(),
        db.collection("dailyOperations").limit(1).get(),
        db.collection("cycleFinancialSummaries").limit(1).get(),
        db.collection("cycleUserResults").limit(1).get(),
        db.collection("cycleGroupCalculations").limit(1).get(),
        db.collection("reinvestments").limit(1).get(),
        db.collection("disbursements").limit(1).get(),
        db.collection("investments").limit(1).get(),
      ]);

      const cyclesCount = typeof cyclesSnap.size === "number" ? cyclesSnap.size : (cyclesSnap.docs ? cyclesSnap.docs.length : 0);

      if (
        cyclesCount !== 1 ||
        !opsSnap.empty ||
        !summariesSnap.empty ||
        !resSnap.empty ||
        !groupsSnap.empty ||
        !reinvAllSnap.empty ||
        !disbAllSnap.empty ||
        !invAllSnap.empty
      ) {
        const err = new Error("NO_HISTORY_VIOLATION: Se detectaron registros operativos o ciclos previos incompatibles con el inicio del ciclo génesis.");
        err.code = "failed-precondition";
        throw err;
      }
    } catch (readErr) {
      if (readErr.code === "failed-precondition") throw readErr;
      const err = new Error(`[FAIL_CLOSED] Error al verificar colecciones para inicio génesis: ${readErr.message}`);
      err.code = "failed-precondition";
      throw err;
    }
  }

  return { activeParticipants };
}

/**
 * Lógica Core de Claim con Compensación Auth Segura y OCC cohortVersion
 */
async function claimAccountCore({
  db,
  auth,
  legacyDocId,
  password,
  clientRequestId,
  isRecoveredOrphan = false,
  orphanedAuthUid = null,
}) {
  const legacyUserRef = db.collection("users").doc(legacyDocId);
  const legacyUserSnap = await legacyUserRef.get();
  const legacyExists = typeof legacyUserSnap.exists === "function" ? legacyUserSnap.exists() : legacyUserSnap.exists;
  if (!legacyExists) {
    const err = new Error("LEGACY_DOC_NOT_FOUND");
    err.code = "not-found";
    throw err;
  }

  const legacyData = typeof legacyUserSnap.data === "function" ? legacyUserSnap.data() || {} : legacyUserSnap.data || {};
  if (legacyData.isClaimed === true || legacyData.status === "MIGRATED") {
    const err = new Error("ALREADY_CLAIMED: Esta cuenta ya fue activada previamente.");
    err.code = "already-exists";
    throw err;
  }

  const canonicalEmail = String(legacyData.email || "").trim().toLowerCase();
  let firebaseAuthUid = isRecoveredOrphan ? orphanedAuthUid : null;
  let authUserCreatedThisAttempt = false;

  if (!firebaseAuthUid) {
    try {
      const createdAuthUser = await auth.createUser({
        email: canonicalEmail,
        password: password,
        displayName: legacyData.fullName || "Inversionista EasyTraders",
      });
      firebaseAuthUid = createdAuthUser.uid;
      authUserCreatedThisAttempt = true;
    } catch (authError) {
      if (authError.code === "auth/email-already-exists") {
        const err = new Error("already-exists: El correo ya está registrado en Firebase Auth.");
        err.code = "already-exists";
        throw err;
      }
      throw authError;
    }
  }

  // Transacción atómica Firestore
  try {
    await db.runTransaction(async (transaction) => {
      const freshLegacySnap = await transaction.get(legacyUserRef);
      const freshExists = typeof freshLegacySnap.exists === "function" ? freshLegacySnap.exists() : freshLegacySnap.exists;
      if (!freshExists) {
        throw new Error("LEGACY_DOC_NOT_FOUND");
      }
      const freshLegacyData = typeof freshLegacySnap.data === "function" ? freshLegacySnap.data() || {} : freshLegacySnap.data || {};
      if (freshLegacyData.isClaimed === true || freshLegacyData.status === "MIGRATED") {
        throw new Error("ALREADY_CLAIMED");
      }

      if (freshLegacyData.entryCycleId) {
        const entryCycleRef = db.collection("monthlyCycles").doc(freshLegacyData.entryCycleId);
        const entryCycleSnap = await transaction.get(entryCycleRef);
        const cycleExists = typeof entryCycleSnap.exists === "function" ? entryCycleSnap.exists() : entryCycleSnap.exists;
        if (!cycleExists) {
          throw new Error("TARGET_CYCLE_NOT_FOUND");
        }
        const entryCycleData = typeof entryCycleSnap.data === "function" ? entryCycleSnap.data() || {} : entryCycleSnap.data || {};
        if (entryCycleData.status !== "OPEN" || entryCycleData.operationalStatus !== "PREPARING") {
          throw new Error("TARGET_CYCLE_ALREADY_STARTED");
        }

        const currentCohortVersion = Number(entryCycleData.cohortVersion || 1);
        transaction.update(entryCycleRef, {
          cohortVersion: currentCohortVersion + 1,
          updatedAt: new Date().toISOString(),
        });
      }

      const canonicalUserRef = db.collection("users").doc(firebaseAuthUid);
      const finalCapital = Number(freshLegacyData.currentCapital || freshLegacyData.baseCapital || 0);
      const finalBaseCapital = Number(freshLegacyData.baseCapital || freshLegacyData.currentCapital || 0);
      const canonicalCategory = getCanonicalCategoryForCapital(finalCapital);

      const canonicalData = {
        id: firebaseAuthUid,
        uid: firebaseAuthUid,
        legacyOriginalId: legacyDocId,
        userCode: freshLegacyData.userCode || "",
        fullName: freshLegacyData.fullName || "",
        email: canonicalEmail,
        phone: freshLegacyData.phone || "",
        documentId: freshLegacyData.documentId || "",
        role: "USER",
        status: "ACTIVE",
        currentCapital: finalCapital,
        baseCapital: finalBaseCapital,
        currency: "COP",
        category: canonicalCategory,
        entryCycleId: freshLegacyData.entryCycleId || null,
        isClaimed: true,
        createdAt: freshLegacyData.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      transaction.set(canonicalUserRef, canonicalData);
      transaction.update(legacyUserRef, {
        status: "MIGRATED",
        isClaimed: true,
        migratedToUid: firebaseAuthUid,
        updatedAt: new Date().toISOString(),
      });
    });

    return {
      success: true,
      uid: firebaseAuthUid,
      email: canonicalEmail,
    };
  } catch (firestoreError) {
    if (authUserCreatedThisAttempt === true) {
      try {
        await auth.deleteUser(firebaseAuthUid);
      } catch (deleteError) {
        const compErr = new Error(`COMPENSATION_FAILED: Fallo al eliminar usuario Auth recién creado: ${deleteError.message}`);
        compErr.code = "internal";
        compErr.orphanedAuthUid = firebaseAuthUid;
        throw compErr;
      }
    }

    if (firestoreError.message === "TARGET_CYCLE_ALREADY_STARTED") {
      const err = new Error("TARGET_CYCLE_ALREADY_STARTED: El ciclo de ingreso asignado ya inició operaciones o no se encuentra en estado de preparación.");
      err.code = "failed-precondition";
      throw err;
    }

    if (firestoreError.message === "TARGET_CYCLE_NOT_FOUND") {
      const err = new Error("TARGET_CYCLE_NOT_FOUND: El ciclo de ingreso asignado no existe.");
      err.code = "not-found";
      throw err;
    }

    throw firestoreError;
  }
}

module.exports = {
  UUID_V4_REGEX,
  generateCanonicalCycleId,
  getCanonicalCategoryForCapital,
  validateGenesisNoHistoryPreCheck,
  validateGenesisNoHistoryTransactional,
  createGenesisCycleCore,
  validateTargetCycleForUserEntry,
  validateStartCycleGenesisAndPendingGuard,
  claimAccountCore,
};
