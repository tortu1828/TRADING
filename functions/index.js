const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");
const {
  fetchDolarColombiaTrm,
} = require("./trmProvider");
const {
  createCycleReportSnapshot,
  supersedeCurrentCycleReport,
  generateCycleReportPdfBuffer,
} = require("./cycleReports");
const {
  validateGenesisNoHistoryPreCheck,
  validateGenesisNoHistoryTransactional,
  createGenesisCycleCore,
  validateTargetCycleForUserEntry,
  validateStartCycleGenesisAndPendingGuard,
  claimAccountCore,
} = require("./genesisCycleCore");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

function computeSha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/**
 * Fuente única de TRM de mercado para frontend.
 * El navegador nunca consulta proveedores externos directamente.
 */
exports.getLiveTrmCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Se requiere autenticación para consultar la TRM."
      );
    }

    try {
      const trm =
        await fetchDolarColombiaTrm();

      return {
        success: true,
        ...trm,
      };
    } catch (err) {
      console.error(
        "[getLiveTrmCallable] Dolar-Colombia no disponible:",
        err
      );

      throw new HttpsError(
        "unavailable",
        "TRM_SOURCE_UNAVAILABLE: No fue posible validar la TRM vigente desde Dolar-Colombia.com."
      );
    }
  }
);

/**
 * Helper Puro Canónico: Cálculo financiero de resultados mensuales por usuario.
 * Garantiza consistencia absoluta entre executeDailyOperation, adminUpdateCycleTrm y adminCloseCycle guardrails.
 * REGLAS:
 * - splits estrictos: userPercentage y adminPercentage snapshots obligatorios
 * - sin defaults arbitrarios
 * - redondeo canónico: Math.round(...) para COP y split exacto para USD
 */
function calculateUserFinancialResult({ totalUsdOperated, trm, userPercentage, adminPercentage }) {
  if (userPercentage === undefined || userPercentage === null || adminPercentage === undefined || adminPercentage === null) {
    throw new Error("INVALID_SPLIT_SNAPSHOT: Faltan los porcentajes contractuales en el snapshot.");
  }

  let uPct = Number(userPercentage);
  let aPct = Number(adminPercentage);
  if (isNaN(uPct) || isNaN(aPct)) {
    throw new Error("INVALID_SPLIT_SNAPSHOT: Los porcentajes deben ser numéricos.");
  }

  // Normalizar si vienen en rango decimal 0..1
  if (uPct <= 1 && aPct <= 1) {
    uPct = uPct * 100;
    aPct = aPct * 100;
  }

  const sumPct = Math.round((uPct + aPct) * 100) / 100;
  if (Math.abs(sumPct - 100) > 0.01) {
    throw new Error(`INVALID_SPLIT_SNAPSHOT: Los porcentajes deben sumar exactamente 100%. Suma actual: ${sumPct}%`);
  }

  const usd = Number(totalUsdOperated) || 0;
  const trmVal = Number(trm);
  if (isNaN(trmVal) || trmVal <= 0) {
    throw new Error("INVALID_TRM: La TRM debe ser un número positivo mayor a cero.");
  }

  const totalGrossCop = usd * trmVal;
  const uRatio = uPct / 100;
  const aRatio = aPct / 100;

  const userProfitCop = Math.round(totalGrossCop * uRatio);
  const adminCommissionCop = Math.round(totalGrossCop * aRatio);

  const userProfitUsd = usd * uRatio;
  const adminCommissionUsd = usd * aRatio;

  return {
    usdOperated: usd,
    trmUsed: trmVal,
    totalGrossCop,
    userPercentage: uPct,
    adminPercentage: aPct,
    userProfitCop,
    adminCommissionCop,
    userProfitUsd,
    adminCommissionUsd,
  };
}

/**
 * Cloud Function HTTPS Callable: Executar Operaciones Diarias con Validaciones de Servidor,
 * Idempotencia y Transacciones Atómicas (Fase 1).
 */
exports.adminExecuteDailyOperation = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    // 1. Verificar Autenticación y Privilegios Estrictos de Servidor
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "El usuario debe estar autenticado en Firebase Auth para registrar operaciones."
      );
    }

    const authUid = request.auth.uid;
    const authEmail = (request.auth.token && request.auth.token.email) ? request.auth.token.email.toLowerCase() : "";

    // ÚNICAMENTE UIDs privilegiados, Custom Claims o role === "ADMIN" en doc de servidor (Cero confianza en userCode)
    const userDocSnap = await db.collection("users").doc(authUid).get();
    let isSuperAdmin = false;

    if (
      authUid === "lpx4NLEEMkeh9EJFcG68oPMVdXF2" ||
      authEmail === "juanes9802@gmail.com" ||
      authEmail === "elcocalombiano1828@gmail.com" ||
      (request.auth.token && (request.auth.token.role === "admin" || request.auth.token.superadmin === true))
    ) {
      isSuperAdmin = true;
    } else if (userDocSnap.exists && userDocSnap.data().role === "ADMIN") {
      isSuperAdmin = true;
    }

    if (!isSuperAdmin) {
      throw new HttpsError(
        "permission-denied",
        "Acceso denegado: Se requieren privilegios de SuperAdmin para ejecutar operaciones diarias."
      );
    }

    const data = request.data || {};
    const {
      action = "CREATE",
      operationIntentId,
      cycleId,
      category,
      groupCapitalCop,
      date,
      amountUsd,
      notes = "",
      targetType = "CUSTOM_GROUP",
      targetUserId,
      customAuthorizedUids,
      trmUsed: reqTrmUsed,
      trmSource: reqTrmSource,
      trmCapturedAt: reqTrmCapturedAt,
    } = data;

    if (action !== "CREATE") {
      throw new HttpsError(
        "unimplemented",
        `La acción '${action}' no está soportada en Fase 1.`
      );
    }

    // Validar formato UUID v4 estricto para operationIntentId
    const uuidv4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!operationIntentId || typeof operationIntentId !== "string" || !uuidv4Regex.test(operationIntentId.trim())) {
      throw new HttpsError(
        "invalid-argument",
        "El parámetro 'operationIntentId' es obligatorio y debe ser un UUID v4 válido."
      );
    }

    // Validar targetType contra valores REALES permitidos para distribución financiera
    const VALID_TARGET_TYPES = ["INDIVIDUAL", "CUSTOM_GROUP", "CATEGORY"];
    if (targetType === "GLOBAL") {
      throw new HttpsError(
        "invalid-argument",
        "GLOBAL_NOT_SUPPORTED_FOR_FINANCIAL_OPERATION: Las operaciones de tipo GLOBAL no están permitidas para distribución financiera directa."
      );
    }
    if (!VALID_TARGET_TYPES.includes(targetType)) {
      throw new HttpsError(
        "invalid-argument",
        `El targetType '${targetType}' no es válido. Valores aceptados: ${VALID_TARGET_TYPES.join(", ")}`
      );
    }

    // Validar category contra valores REALES de BitacoraCategory
    const VALID_CATEGORIES = ["AZUL", "VERDE", "NEGRA"];
    if (!VALID_CATEGORIES.includes(category)) {
      throw new HttpsError(
        "invalid-argument",
        `La categoría '${category}' no es válida. Categorías aceptadas: ${VALID_CATEGORIES.join(", ")}`
      );
    }

    if (!cycleId || typeof groupCapitalCop !== "number" || groupCapitalCop <= 0) {
      throw new HttpsError("invalid-argument", "Identificador de ciclo o capital de grupo inválido.");
    }

    // Validación estricta de consistencia categoría / capital para CUSTOM_GROUP
    let expectedCustomGroupCategory = null;
    let legacyBoundaryCandidate = false;

    if (targetType === "CUSTOM_GROUP") {
      // CUSTOM_GROUP_MIN_CAPITAL
      if (
        !Number.isFinite(Number(groupCapitalCop)) ||
        Number(groupCapitalCop) < 2000000 ||
        Number(groupCapitalCop) > Number.MAX_SAFE_INTEGER
      ) {
        throw new HttpsError(
          "invalid-argument",
          "INVALID_GROUP_CAPITAL: El capital nominal del grupo debe ser igual o superior a $2.000.000 COP."
        );
      }

      expectedCustomGroupCategory =
        getCategoryForCapitalLocal(
          Number(groupCapitalCop)
        );

      // Solo estas dos fronteras pueden provenir de snapshots antiguos.
      legacyBoundaryCandidate =
        (Number(groupCapitalCop) === 10000000 && category === "AZUL") ||
        (Number(groupCapitalCop) === 60000000 && category === "VERDE");

      if (
        category !== expectedCustomGroupCategory &&
        !legacyBoundaryCandidate
      ) {
        throw new HttpsError(
          "invalid-argument",
          `CATEGORY_CAPITAL_MISMATCH: La categoría '${category}' no corresponde al capital nominal $${Number(groupCapitalCop).toLocaleString("es-CO")} COP (categoría esperada: '${expectedCustomGroupCategory}').`
        );
      }
    }

    if (typeof amountUsd !== "number" || isNaN(amountUsd)) {
      throw new HttpsError("invalid-argument", "El monto operado en USD ('amountUsd') debe ser un número válido.");
    }

    // Sanitización y normalización de customAuthorizedUids
    let sanitizedCustomUids = null;
    if (Array.isArray(customAuthorizedUids)) {
      sanitizedCustomUids = Array.from(
        new Set(
          customAuthorizedUids
            .filter((b) => typeof b === "string" && b.trim().length > 0)
            .map((b) => b.trim())
        )
      );
    }

    // 2. FINGERPRINT AUTORITATIVO COMPLETO EN SERVIDOR
    const cleanNotes = (notes || "").trim();
    const opDate = date || new Date().toISOString().split("T")[0];
    const cleanTargetUser = targetUserId || "";
    const normCustom = sanitizedCustomUids && sanitizedCustomUids.length > 0
      ? [...sanitizedCustomUids].sort().join(",")
      : "";

    const canonicalPayloadString = [
      cycleId,
      category,
      Number(groupCapitalCop),
      Number(amountUsd),
      opDate,
      targetType,
      cleanTargetUser,
      cleanNotes,
      normCustom,
    ].join("|");

    const serverFingerprint = computeSha256(canonicalPayloadString);

    const createdByName =
      (userDocSnap.exists && (userDocSnap.data().fullName || userDocSnap.data().displayName)) ||
      authEmail ||
      "Administrador";

    const opRef = db.collection("dailyOperations").doc(operationIntentId);
    const cycleRef = db.collection("monthlyCycles").doc(cycleId);

    // DOLAR_COLOMBIA_SERVER_AUTHORITY
    let authoritativeTrm;

    try {
      authoritativeTrm =
        await fetchDolarColombiaTrm();
    } catch (err) {
      console.error(
        "[adminExecuteDailyOperation] Falló fuente TRM:",
        err
      );

      throw new HttpsError(
        "unavailable",
        "TRM_SOURCE_UNAVAILABLE: No se pudo obtener y validar la TRM vigente desde Dolar-Colombia.com. La operación financiera no fue ejecutada."
      );
    }

    // 3. TRANSACCIÓN ATÓMICA CON SECUENCIA STRICT: ALL READS -> ALL CALCS -> ALL WRITES
    const txResult = await db.runTransaction(async (transaction) => {
      // === FASE DE LECTURAS (READ PHASE) ===
      
      // 1. Lectura de Idempotencia dentro de la transacción
      const existingOpSnap = await transaction.get(opRef);
      if (existingOpSnap.exists) {
        const existingData = existingOpSnap.data();
        if (existingData.payloadFingerprint === serverFingerprint) {
          console.log(`[Idempotency TX] Operación ${operationIntentId} ya procesada previamente.`);
          return {
            success: true,
            duplicated: true,
            operation: existingData,
            message: "Operación procesada idempotentemente en servidor.",
          };
        } else {
          throw new HttpsError(
            "already-exists",
            `El ID de intención '${operationIntentId}' ya fue registrado previamente con un payload o parámetros diferentes.`
          );
        }
      }

      // 2. Lectura y validación de estado del Ciclo y TRM
      const cycleSnap = await transaction.get(cycleRef);
      if (!cycleSnap.exists) {
        throw new HttpsError("failed-precondition", `El ciclo especificado (${cycleId}) no existe.`);
      }
      const cycleData = cycleSnap.data();
      if (cycleData.status !== "OPEN" && cycleData.status !== "REOPENED") {
        throw new HttpsError(
          "failed-precondition",
          `El ciclo (${cycleData.name || cycleId}) está en estado '${cycleData.status}'. No se permiten operaciones.`
        );
      }

      // Guardrail Operativo y Compatibilidad Determinística con Ciclos Legacy (Sections 6, 7, 35)
      const opStatus = cycleData.operationalStatus;
      let isCycleStarted = false;

      if (opStatus === "STARTED") {
        isCycleStarted = true;
      } else if (opStatus === "PREPARING") {
        throw new HttpsError(
          "failed-precondition",
          `CYCLE_NOT_OPERATIONALLY_STARTED: El ciclo (${cycleData.name || cycleId}) está en preparación (PREPARING) y no ha sido iniciado operativamente. Debe congelar capitales e iniciar el ciclo antes de registrar operaciones.`
        );
      } else {
        // operationalStatus no definido (Ciclo Legacy):
        // Consultar determinísticamente si existen dailyOperations para este cycleId
        const legacyOpsCheck = await transaction.get(
          db.collection("dailyOperations").where("cycleId", "==", cycleId).limit(1)
        );
        if (!legacyOpsCheck.empty) {
          // LEGACY_ALREADY_STARTED: Permite operar temporalmente como ciclo legacy ya iniciado
          console.log(`[adminExecuteDailyOperation] Ciclo legacy ${cycleId} reconocido como LEGACY_ALREADY_STARTED por tener operaciones previas.`);
          isCycleStarted = false;
        } else {
          // Ciclo legacy sin operaciones: TRADING BLOQUEADO hasta START
          throw new HttpsError(
            "failed-precondition",
            `CYCLE_NOT_OPERATIONALLY_STARTED: El ciclo (${cycleData.name || cycleId}) no ha sido iniciado operativamente. Debe congelar capitales e iniciar el ciclo formalmente antes de registrar operaciones.`
          );
        }
      }

      // Resolución de TRM operativa AUTHORITATIVE.
      // El valor se obtuvo en servidor directamente desde Dolar-Colombia.com.
      const trm =
        authoritativeTrm.rate;

      const trmSource =
        authoritativeTrm.source;

      const trmCapturedAt =
        authoritativeTrm.capturedAt;

      const trmEffectiveDate =
        authoritativeTrm.effectiveDate;

      const trmSourceUrl =
        authoritativeTrm.sourceUrl;

      const trmRateCents =
        authoritativeTrm.rateCents;

      // 3. Lectura de operaciones existentes del grupo en este ciclo
      const opsQuery = db.collection("dailyOperations")
        .where("cycleId", "==", cycleId)
        .where("category", "==", category)
        .where("groupCapitalCop", "==", Number(groupCapitalCop));
      const opsSnap = await transaction.get(opsQuery);

      // 4. Lectura estricta de usuarios objetivo según targetType y operationalStatus
      let targetUserSnap = null;
      let targetFrozenResultSnap = null;
      let targetUsersListSnap = null;
      let targetResultsListSnap = null;

      if (isCycleStarted) {
        // === AUTORIDAD OPERATIVA CANÓNICA: cycleUserResults congelado post-START ===
        if (targetType === "INDIVIDUAL") {
          if (!targetUserId || typeof targetUserId !== "string" || !targetUserId.trim()) {
            throw new HttpsError("invalid-argument", "Para targetType INDIVIDUAL el parámetro 'targetUserId' es obligatorio.");
          }
          const cleanUid = targetUserId.trim();
          targetFrozenResultSnap = await transaction.get(
            db.collection("cycleUserResults").doc(`${cycleId}_${cleanUid}`)
          );
          if (!targetFrozenResultSnap.exists || !targetFrozenResultSnap.data().isFrozen) {
            throw new HttpsError(
              "failed-precondition",
              `CYCLE_USER_SNAPSHOT_MISSING: No existe un snapshot congelado en cycleUserResults para el usuario especificado (${cleanUid}) en el ciclo ${cycleId}.`
            );
          }
          const frozenData = targetFrozenResultSnap.data();
          if (
            frozenData.cycleCategory !== category ||
            Number(frozenData.groupCapitalCop) !== Number(groupCapitalCop)
          ) {
            throw new HttpsError(
              "invalid-argument",
              `INDIVIDUAL_TARGET_GROUP_MISMATCH: El usuario objetivo (categoría: '${frozenData.cycleCategory}', capital: $${frozenData.groupCapitalCop}) no coincide con la categoría ('${category}') o capital ($${groupCapitalCop}) especificados en el trade.`
            );
          }
          targetUserSnap = await transaction.get(db.collection("users").doc(cleanUid));
        } else if (targetType === "CATEGORY") {
          targetResultsListSnap = await transaction.get(
            db.collection("cycleUserResults")
              .where("cycleId", "==", cycleId)
              .where("cycleCategory", "==", category)
          );
        } else if (targetType === "CUSTOM_GROUP") {
          targetResultsListSnap = await transaction.get(
            db.collection("cycleUserResults")
              .where("cycleId", "==", cycleId)
              .where("cycleCategory", "==", category)
              .where("groupCapitalCop", "==", Number(groupCapitalCop))
          );
        }
      } else {
        // === MODO COMPATIBILIDAD LEGACY: Lectura desde users para ciclos legacy sin START formal ===
        if (targetType === "INDIVIDUAL") {
          if (!targetUserId || typeof targetUserId !== "string" || !targetUserId.trim()) {
            throw new HttpsError("invalid-argument", "Para targetType INDIVIDUAL el parámetro 'targetUserId' es obligatorio.");
          }
          targetUserSnap = await transaction.get(db.collection("users").doc(targetUserId.trim()));
          targetFrozenResultSnap = await transaction.get(
            db.collection("cycleUserResults").doc(`${cycleId}_${targetUserId.trim()}`)
          );
        } else if (targetType === "CATEGORY") {
          targetUsersListSnap = await transaction.get(
            db.collection("users").where("category", "==", category)
          );
        } else if (targetType === "CUSTOM_GROUP") {
          targetUsersListSnap = await transaction.get(
            db.collection("users").where("currentCapital", "==", Number(groupCapitalCop))
          );
        }
      }

      // BITACORA_BOUNDARY_LEGACY_COMPAT
      // Una categoría antigua en 10M/60M solo es válida si:
      // 1. existe el snapshot congelado exacto en un ciclo STARTED, o
      // 2. se trata de un ciclo legacy real sin operationalStatus que ya
      //    superó el guard de operaciones históricas.
      if (
        targetType === "CUSTOM_GROUP" &&
        legacyBoundaryCandidate &&
        category !== expectedCustomGroupCategory
      ) {
        const frozenLegacyBoundaryMatch =
          isCycleStarted &&
          targetResultsListSnap &&
          !targetResultsListSnap.empty &&
          targetResultsListSnap.docs.some((docSnap) => {
            const frozen = docSnap.data() || {};

            return (
              frozen.isFrozen === true &&
              frozen.cycleCategory === category &&
              Number(frozen.groupCapitalCop) ===
                Number(groupCapitalCop)
            );
          });

        const trueLegacyCycleBoundaryMatch =
          !opStatus;

        if (
          !frozenLegacyBoundaryMatch &&
          !trueLegacyCycleBoundaryMatch
        ) {
          throw new HttpsError(
            "invalid-argument",
            `CATEGORY_CAPITAL_MISMATCH: La categoría legacy '${category}' para $${Number(groupCapitalCop).toLocaleString("es-CO")} COP no está respaldada por un snapshot congelado del ciclo. La categoría canónica actual es '${expectedCustomGroupCategory}'.`
          );
        }
      }

      // === FASE DE CÁLCULO Y CONSTRUCCIÓN (CALCULATION PHASE) ===

      let authorizedUids = [];
      let targetUserDocData = null;
      const userResultsToSet = [];
      const opUsd = Number(amountUsd);
      const opGrossCop = opUsd * trm;

      if (isCycleStarted) {
        // Recopilar candidatos elegibles desde cycleUserResults congelado
        let candidateResults = [];
        if (targetType === "INDIVIDUAL") {
          const r = targetFrozenResultSnap.data();
          const uUid = (r.userUid || r.userId || targetUserId).trim();
          candidateResults = [{
            ref: targetFrozenResultSnap.ref,
            id: targetFrozenResultSnap.id,
            r,
            uid: uUid,
          }];
          if (targetUserSnap && targetUserSnap.exists) {
            targetUserDocData = targetUserSnap.data();
          }
        } else if (targetResultsListSnap) {
          targetResultsListSnap.forEach((rDoc) => {
            const r = rDoc.data();
            const uUid = (r.userUid || r.userId || "").trim();
            if (uUid) {
              candidateResults.push({
                ref: rDoc.ref,
                id: rDoc.id,
                r,
                uid: uUid,
              });
            }
          });
        }

        // Aplicar filtrado y validación estricta de customAuthorizedUids si fue provisto
        let finalEligibleResults = [];
        if (sanitizedCustomUids && sanitizedCustomUids.length > 0) {
          const eligibleUidSet = new Set(candidateResults.map((c) => c.uid));
          for (const cUid of sanitizedCustomUids) {
            if (!eligibleUidSet.has(cUid)) {
              throw new HttpsError(
                "invalid-argument",
                `AUTHORIZED_UID_NOT_ELIGIBLE: El UID '${cUid}' en customAuthorizedUids no pertenece al grupo o categoría seleccionada en este ciclo.`
              );
            }
          }
          finalEligibleResults = candidateResults.filter((c) => sanitizedCustomUids.includes(c.uid));
        } else {
          finalEligibleResults = candidateResults;
        }

        // Guardrail: Cero usuarios elegibles en ciclo iniciado
        if (finalEligibleResults.length === 0) {
          throw new HttpsError(
            "failed-precondition",
            "NO_ELIGIBLE_USERS_FOR_OPERATION: No se encontraron usuarios elegibles para registrar la operación financiera."
          );
        }

        authorizedUids = finalEligibleResults.map((c) => c.uid);

        // Modelo de Acumulación Incremental Atómica sobre snapshot congelado de cada usuario
        finalEligibleResults.forEach((item) => {
          const r = item.r;
          const uUid = item.uid;
          const prevUsd = Number(r.totalUsdOperated || 0);
          const prevGrossCop = Number(r.totalGrossCop || 0);
          const prevUserProfitCop = Number(r.userProfitCop || 0);
          const prevAdminCommCop = Number(r.adminCommissionCop || 0);
          const prevUserProfitUsd = Number(r.userProfitUsd || 0);
          const prevAdminCommUsd = Number(r.adminCommissionUsd || 0);

          const userPctRaw = r.userPercentage !== undefined ? r.userPercentage : 75;
          const adminPctRaw = r.adminPercentage !== undefined ? r.adminPercentage : 25;
          const uRatio = userPctRaw > 1 ? userPctRaw / 100 : userPctRaw;
          const aRatio = adminPctRaw > 1 ? adminPctRaw / 100 : adminPctRaw;

          const deltaUserProfitCop = opGrossCop * uRatio;
          const deltaAdminCommCop = opGrossCop * aRatio;
          const deltaUserProfitUsd = opUsd * uRatio;
          const deltaAdminCommUsd = opUsd * aRatio;

          const userResultId = item.id || `${cycleId}_${uUid}`;
          const userResDoc = {
            id: userResultId,
            cycleId,
            userId: r.userId || uUid,
            userUid: uUid,
            userCode: r.userCode || "",
            userName: r.userName || "",
            email: r.email || "",
            cycleCapitalCop: r.cycleCapitalCop,
            cycleCategory: r.cycleCategory || category,
            groupCapitalCop: r.groupCapitalCop !== undefined ? r.groupCapitalCop : Number(groupCapitalCop),
            totalUsdOperated: prevUsd + opUsd,
            totalGrossCop: prevGrossCop + opGrossCop,
            userProfitCop: prevUserProfitCop + deltaUserProfitCop,
            adminCommissionCop: prevAdminCommCop + deltaAdminCommCop,
            userProfitUsd: prevUserProfitUsd + deltaUserProfitUsd,
            adminCommissionUsd: prevAdminCommUsd + deltaAdminCommUsd,
            userPercentage: uRatio * 100,
            adminPercentage: aRatio * 100,
            trmUsed: trm,
            isFrozen: true,
            updatedAt: new Date().toISOString(),
          };

          userResultsToSet.push({ ref: item.ref || db.collection("cycleUserResults").doc(userResultId), doc: userResDoc });
        });
      } else {
        // === MODO LEGACY (para ciclos no iniciados formalmente) ===
        let candidateLegacyUsers = [];
        if (targetType === "INDIVIDUAL") {
          if (!targetUserSnap || !targetUserSnap.exists) {
            throw new HttpsError("failed-precondition", `El usuario objetivo especificado (${targetUserId}) no existe en Firestore.`);
          }
          targetUserDocData = targetUserSnap.data();
          if (targetUserDocData.status !== "ACTIVE" || !targetUserDocData.uid) {
            throw new HttpsError("failed-precondition", "El usuario objetivo no se encuentra activo o carece de UID.");
          }
          candidateLegacyUsers = [targetUserDocData];
        } else if (targetUsersListSnap) {
          targetUsersListSnap.forEach((uDoc) => {
            const u = uDoc.data();
            if (u.status === "ACTIVE" && u.uid && typeof u.uid === "string" && u.uid.trim()) {
              if (targetType === "CUSTOM_GROUP" && category && u.category !== category) return;
              candidateLegacyUsers.push({ ...u, id: uDoc.id });
            }
          });
        }

        let finalLegacyUsers = [];
        if (sanitizedCustomUids && sanitizedCustomUids.length > 0) {
          const eligibleUidSet = new Set(candidateLegacyUsers.map((u) => u.uid.trim()));
          for (const cUid of sanitizedCustomUids) {
            if (!eligibleUidSet.has(cUid)) {
              throw new HttpsError(
                "invalid-argument",
                `AUTHORIZED_UID_NOT_ELIGIBLE: El UID '${cUid}' en customAuthorizedUids no pertenece al grupo o categoría seleccionada.`
              );
            }
          }
          finalLegacyUsers = candidateLegacyUsers.filter((u) => sanitizedCustomUids.includes(u.uid.trim()));
        } else {
          finalLegacyUsers = candidateLegacyUsers;
        }

        if (finalLegacyUsers.length === 0) {
          throw new HttpsError(
            "failed-precondition",
            "NO_ELIGIBLE_USERS_FOR_OPERATION: No se encontraron usuarios elegibles para registrar la operación financiera."
          );
        }

        authorizedUids = finalLegacyUsers.map((u) => u.uid.trim());

        finalLegacyUsers.forEach((u) => {
          const uUid = u.uid.trim();
          const userPctRaw = u.userPercentage !== undefined ? u.userPercentage : 75;
          const adminPctRaw = u.adminPercentage !== undefined ? u.adminPercentage : 25;
          const uRatio = userPctRaw > 1 ? userPctRaw / 100 : userPctRaw;
          const aRatio = adminPctRaw > 1 ? adminPctRaw / 100 : adminPctRaw;

          const deltaUserProfitCop = opGrossCop * uRatio;
          const deltaAdminCommCop = opGrossCop * aRatio;
          const deltaUserProfitUsd = opUsd * uRatio;
          const deltaAdminCommUsd = opUsd * aRatio;

          // Si existe registro previo en targetFrozenResultSnap para individual
          let prevUsd = 0;
          let prevGrossCop = 0;
          let prevUserProfitCop = 0;
          let prevAdminCommCop = 0;
          let prevUserProfitUsd = 0;
          let prevAdminCommUsd = 0;

          if (targetFrozenResultSnap && targetFrozenResultSnap.exists) {
            const r = targetFrozenResultSnap.data();
            prevUsd = Number(r.totalUsdOperated || 0);
            prevGrossCop = Number(r.totalGrossCop || 0);
            prevUserProfitCop = Number(r.userProfitCop || 0);
            prevAdminCommCop = Number(r.adminCommissionCop || 0);
            prevUserProfitUsd = Number(r.userProfitUsd || 0);
            prevAdminCommUsd = Number(r.adminCommissionUsd || 0);
          }

          const userResultId = `${cycleId}_${uUid}`;
          const userResDoc = {
            id: userResultId,
            cycleId,
            userId: u.id || uUid,
            userUid: uUid,
            userCode: u.userCode || "",
            userName: u.fullName || u.userName || "",
            totalUsdOperated: prevUsd + opUsd,
            totalGrossCop: prevGrossCop + opGrossCop,
            userProfitCop: prevUserProfitCop + deltaUserProfitCop,
            adminCommissionCop: prevAdminCommCop + deltaAdminCommCop,
            userProfitUsd: prevUserProfitUsd + deltaUserProfitUsd,
            adminCommissionUsd: prevAdminCommUsd + deltaAdminCommUsd,
            userPercentage: uRatio * 100,
            adminPercentage: aRatio * 100,
            trmUsed: trm,
            updatedAt: new Date().toISOString(),
          };

          userResultsToSet.push({ ref: db.collection("cycleUserResults").doc(userResultId), doc: userResDoc });
        });
      }

      // Cálculo de Resumen de Actividad de Grupo para cycleGroupCalculations
      let accumulatedUsd = Number(amountUsd);
      opsSnap.forEach((docSnap) => {
        const op = docSnap.data();
        if (docSnap.id !== operationIntentId && op.status !== "CONSOLIDATED") {
          accumulatedUsd += Number(op.amountUsd || 0);
        }
      });

      const groupGrossCop = accumulatedUsd * trm;
      const yieldPct = (groupGrossCop / Number(groupCapitalCop)) * 100;

      const groupCalcId = `calc_${cycleId}_${category}_${groupCapitalCop}`;
      const groupCalcDoc = {
        id: groupCalcId,
        cycleId,
        category,
        groupCapitalCop: Number(groupCapitalCop),
        accumulatedUsd,
        accumulatedGrossCop: groupGrossCop,
        yieldPercentage: yieldPct,
        updatedAt: new Date().toISOString(),
        updatedBy: createdByName,
      };

      // Objeto de Operación limpia
      const newOp = {
        id: operationIntentId,
        operationIntentId,
        payloadFingerprint: serverFingerprint,
        cycleId,
        category,
        groupCapitalCop: Number(groupCapitalCop),
        date: opDate,
        amountUsd: Number(amountUsd),
        trmUsed: trm,
        trmSource,
        trmCapturedAt,
        trmEffectiveDate,
        trmSourceUrl,
        trmRateCents,
        grossCop: Number(amountUsd) * trm,
        notes: cleanNotes,
        createdAt: new Date().toISOString(),
        createdBy: createdByName,
        createdByUid: authUid,
        status: "ACTIVE",
        targetType,
        authorizedUids,
        isPublicToActiveUsers: false,
      };

      if (targetType === "INDIVIDUAL") {
        if (targetUserDocData) {
          newOp.userId = targetUserDocData.id || targetUserDocData.uid;
          newOp.userUid = targetUserDocData.uid;
          if (targetUserDocData.email) newOp.userEmail = targetUserDocData.email;
          if (targetUserDocData.userCode) newOp.userCode = targetUserDocData.userCode;
          if (targetUserDocData.fullName) newOp.userName = targetUserDocData.fullName;
        } else if (targetFrozenResultSnap && targetFrozenResultSnap.exists) {
          const fr = targetFrozenResultSnap.data();
          newOp.userId = fr.userId || targetUserId;
          newOp.userUid = fr.userUid || targetUserId;
          if (fr.email) newOp.userEmail = fr.email;
          if (fr.userCode) newOp.userCode = fr.userCode;
          if (fr.userName) newOp.userName = fr.userName;
        }
      }

      // === FASE DE ESCRITURA (WRITE PHASE) ===
      transaction.set(opRef, newOp);
      transaction.set(db.collection("cycleGroupCalculations").doc(groupCalcId), groupCalcDoc, { merge: true });
      userResultsToSet.forEach((item) => {
        transaction.set(item.ref, item.doc, { merge: true });
      });

      return {
        success: true,
        operation: newOp,
        message: "Operación creada y calculada exitosamente en transacción servidor.",
      };
    });

    return txResult;
  }
);

/**
 * Helper: Validar autenticación y privilegios estrictos de SuperAdmin
 */
async function verifySuperAdminPrivileges(request) {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "El usuario debe estar autenticado en Firebase Auth."
    );
  }

  const authUid = request.auth.uid;
  const authEmail = (request.auth.token && request.auth.token.email) ? request.auth.token.email.toLowerCase() : "";

  const userDocSnap = await db.collection("users").doc(authUid).get();
  let isSuperAdmin = false;

  if (
    authUid === "lpx4NLEEMkeh9EJFcG68oPMVdXF2" ||
    authEmail === "juanes9802@gmail.com" ||
    authEmail === "elcocalombiano1828@gmail.com" ||
    (request.auth.token && (request.auth.token.role === "admin" || request.auth.token.superadmin === true))
  ) {
    isSuperAdmin = true;
  } else if (userDocSnap.exists && userDocSnap.data().role === "ADMIN") {
    isSuperAdmin = true;
  }

  if (!isSuperAdmin) {
    throw new HttpsError(
      "permission-denied",
      "Acceso denegado: Se requieren privilegios de SuperAdmin para esta operación."
    );
  }

  const createdByName =
    (userDocSnap.exists && (userDocSnap.data().fullName || userDocSnap.data().displayName)) ||
    authEmail ||
    "Administrador Principal";

  return { authUid, authEmail, createdByName };
}

/**
 * Helper: Generación atómica correlativa de userCode (USR-XXXX) sin colisiones concurrentes
 */
async function getNextAtomicUserCode(prefix = "USR") {
  const normalizedPrefix = prefix === "INV" ? "INV" : "USR";
  const counterRef = db.collection("counters").doc("users");
  const existingCounter = await counterRef.get();
  let baseline = 1000;

  if (!existingCounter.exists) {
    try {
      const maxSnap = await db.collection("users").orderBy("userCode", "desc").limit(5).get();
      if (!maxSnap.empty) {
        for (const d of maxSnap.docs) {
          const code = d.data().userCode || "";
          const match = code.match(/(\d+)/);
          if (match) {
            baseline = Math.max(baseline, parseInt(match[1], 10));
          }
        }
      }
    } catch (e) {
      console.warn("[getNextAtomicUserCode] No se pudo consultar correlativo máximo inicial:", e);
    }
  }

  let assignedCode = "";
  await db.runTransaction(async (transaction) => {
    const counterSnap = await transaction.get(counterRef);
    let nextNum = baseline + 1;
    if (counterSnap.exists) {
      const cData = counterSnap.data() || {};
      nextNum = Number(cData.nextCodeNumber) || (baseline + 1);
      transaction.update(counterRef, {
        nextCodeNumber: nextNum + 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      transaction.set(counterRef, {
        nextCodeNumber: nextNum + 1,
        initializedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    assignedCode = `${normalizedPrefix}-${String(nextNum).padStart(4, "0")}`;
  });

  return assignedCode;
}

/**
 * Determina la categoría canónica del inversionista a partir de su capital operativo (COP).
 * Rangos canónicos del sistema:
 * - AZUL: < $10.000.000 COP (típicamente $2.000.000 - $9.999.999 COP)
 * - VERDE: >= $10.000.000 COP y < $60.000.000 COP (ej. $18.000.000 COP)
 * - NEGRA / WHALE: >= $60.000.000 COP (ej. >= $60M COP)
 */
function getCanonicalCategoryForCapital(capital) {
  const cap = Number(capital) || 0;

  if (cap >= 60000000) {
    return "NEGRA";
  }

  if (cap >= 10000000) {
    return "VERDE";
  }

  return "AZUL";
}

/**
 * El rol administrativo y la participación financiera
 * son conceptos independientes.
 */
function isTradingParticipantProfile(profile) {
  if (!profile || typeof profile !== "object") {
    return false;
  }

  return (
    profile.role === "USER" ||
    profile.participatesInTrading === true
  );
}

/**
 * Obtiene el split financiero efectivo.
 *
 * SELF_ADMIN siempre debe ser 100 / 0.
 */
function getTradingSplitForProfile(profile) {
  if (
    profile &&
    profile.commissionMode === "SELF_ADMIN"
  ) {
    return {
      userPercentage: 100,
      adminPercentage: 0,
    };
  }

  const userPercentage =
    profile &&
    profile.userPercentage !== undefined
      ? Number(profile.userPercentage)
      : 75;

  const adminPercentage =
    profile &&
    profile.adminPercentage !== undefined
      ? Number(profile.adminPercentage)
      : 25;

  return {
    userPercentage:
      Number.isFinite(userPercentage)
        ? userPercentage
        : 75,

    adminPercentage:
      Number.isFinite(adminPercentage)
        ? adminPercentage
        : 25,
  };
}


/**
 * Normaliza createdAt a un Firestore Timestamp válido.
 * 1. Si ya es Firestore Timestamp -> lo conserva.
 * 2. Si es string ISO válido -> Timestamp.fromDate(new Date(value)).
 * 3. Si es Date válida -> Timestamp.fromDate(value).
 * 4. Si falta o es inválido -> FieldValue.serverTimestamp().
 */
function normalizeCreatedAt(value) {
  if (!value) {
    return admin.firestore.FieldValue.serverTimestamp();
  }
  if (value instanceof admin.firestore.Timestamp || (typeof value === "object" && typeof value.toDate === "function")) {
    return value;
  }
  if (value instanceof Date && !isNaN(value.getTime())) {
    return admin.firestore.Timestamp.fromDate(value);
  }
  if (typeof value === "string") {
    const parsedDate = new Date(value);
    if (!isNaN(parsedDate.getTime())) {
      return admin.firestore.Timestamp.fromDate(parsedDate);
    }
  }
  return admin.firestore.FieldValue.serverTimestamp();
}

/**
 * Cloud Function HTTPS Callable: Crear Usuario en Firebase Auth y Firestore con Compensación Atómica.
 * MODO ACTIVO DIRECTO (SuperAdmin): Establece inmediatamente status: 'ACTIVE', isClaimed: true, claimedAt.
 */
exports.adminCreateUser = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    // 1. Verificar Autenticación y Privilegios Estrictos de SuperAdmin
    const { authUid, authEmail, createdByName } = await verifySuperAdminPrivileges(request);

    const data = request.data || {};
    const {
      email,
      password,
      fullName,
      phone = "",
      currentCapital = 0,
      userPercentage = 75,
      adminPercentage = 25,
      paymentMethod = "",
      paymentDetails = "Cuenta Principal",
      role = "USER",
      targetCycleId = null,
    } = data;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      throw new HttpsError("invalid-argument", "El correo electrónico ingresado es inválido.");
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      throw new HttpsError("invalid-argument", "La contraseña inicial debe contener al menos 6 caracteres.");
    }
    if (!fullName || typeof fullName !== "string" || !fullName.trim()) {
      throw new HttpsError("invalid-argument", "El nombre completo del usuario es obligatorio.");
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanFullName = fullName.trim();
    const cleanPhone = String(phone || "").trim();
    const cleanPaymentMethod = String(paymentMethod || "").trim();
    const cleanPaymentDetails = String(paymentDetails || "Cuenta Principal").trim();

    const capNum = Number(currentCapital) || 0;

    // ADMIN_CREATE_USER_CAPITAL_GUARD
    if (
      role !== "ADMIN" &&
      (
        !Number.isFinite(capNum) ||
        capNum < 2000000 ||
        capNum > Number.MAX_SAFE_INTEGER
      )
    ) {
      throw new HttpsError(
        "invalid-argument",
        "INVALID_TRADING_CAPITAL: El capital del inversionista debe ser igual o superior a $2.000.000 COP."
      );
    }

    if (
      role === "ADMIN" &&
      (
        !Number.isFinite(capNum) ||
        capNum < 0 ||
        capNum > Number.MAX_SAFE_INTEGER
      )
    ) {
      throw new HttpsError(
        "invalid-argument",
        "INVALID_ADMIN_CAPITAL: El capital administrativo suministrado no es válido."
      );
    }

    const userPctNum = Number(userPercentage) !== undefined ? Number(userPercentage) : 75;
    const adminPctNum = Number(adminPercentage) !== undefined ? Number(adminPercentage) : 25;

    let entryCycleId = null;

    const isInvestorUser = role !== "ADMIN";

    if (
      isInvestorUser &&
      (!targetCycleId || typeof targetCycleId !== "string" || !targetCycleId.trim())
    ) {
      throw new HttpsError(
        "failed-precondition",
        "INVESTOR_TARGET_CYCLE_REQUIRED: No existe un ciclo de ingreso válido para este inversionista."
      );
    }

    if (targetCycleId && typeof targetCycleId === "string" && targetCycleId.trim()) {
      try {
        entryCycleId = await validateTargetCycleForUserEntry({ db, targetCycleId });
      } catch (err) {
        if (err.code === "not-found") {
          throw new HttpsError("not-found", err.message);
        }
        throw new HttpsError("failed-precondition", err.message);
      }
    }

    const category = getCanonicalCategoryForCapital(capNum);

    // Generar userCode correlativo atómico en /counters/users
    const userCode = await getNextAtomicUserCode();

    // PASO 1: Crear usuario en Firebase Authentication (Admin SDK)
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email: cleanEmail,
        password: password,
        displayName: cleanFullName,
      });
    } catch (authError) {
      console.error("[adminCreateUser] Error creando usuario en Firebase Auth:", authError);
      if (authError.code === "auth/email-already-in-use") {
        throw new HttpsError("already-exists", "El correo electrónico ya se encuentra registrado en Firebase Authentication.");
      }
      if (authError.code === "auth/invalid-email") {
        throw new HttpsError("invalid-argument", "El correo electrónico no tiene un formato válido.");
      }
      if (authError.code === "auth/weak-password") {
        throw new HttpsError("invalid-argument", "La contraseña es demasiado débil.");
      }
      throw new HttpsError("internal", `Error de Firebase Auth: ${authError.message || authError}`);
    }

    const newUid = userRecord.uid;

    // PASO 2: Crear perfil en Firestore (/users/{newUid}) - Estado ACTIVO directo
    const userProfileDoc = {
      id: newUid,
      uid: newUid,
      fullName: cleanFullName,
      email: cleanEmail,
      phone: cleanPhone,
      currentCapital: capNum,
      baseCapital: capNum,
      currency: "COP",
      userPercentage: userPctNum,
      adminPercentage: adminPctNum,
      status: "ACTIVE",
      isClaimed: true,
      claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      activationTokenHash: null,
      activationExpiresAt: null,
      role: role === "ADMIN" ? "ADMIN" : "USER",
      category,
      paymentMethod: cleanPaymentMethod,
      paymentDetails: cleanPaymentDetails,
      entryCycleId: entryCycleId || null,
      entryDate: new Date().toISOString().split("T")[0],
      userCode,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdByUid: authUid,
    };

    try {
      await db.collection("users").doc(newUid).set(userProfileDoc);
    } catch (firestoreError) {
      console.error(`[adminCreateUser] Fallo en Firestore para UID ${newUid}. Iniciando COMPENSACIÓN...`, firestoreError);
      // COMPENSACIÓN: Eliminar el Auth User recién creado para evitar usuarios huérfanos
      try {
        await admin.auth().deleteUser(newUid);
        console.log(`[adminCreateUser COMPENSADO] Usuario Auth ${newUid} eliminado correctamente.`);
      } catch (deleteError) {
        console.error(`[adminCreateUser COMPENSACIÓN ERROR] Fallo al borrar usuario Auth ${newUid}:`, deleteError);
      }

      await db.collection("auditLogs").add({
        action: "USER_CREATION_FAILED_COMPENSATED",
        targetUid: newUid,
        email: cleanEmail,
        error: firestoreError.message || String(firestoreError),
        timestamp: new Date().toISOString(),
        performedByUid: authUid,
      }).catch(() => {});

      throw new HttpsError(
        "internal",
        "Error al guardar el perfil en Firestore. Se ha ejecutado la compensación y revertido la cuenta de Firebase Auth."
      );
    }

    // Auditoría de éxito
    await db.collection("auditLogs").add({
      action: "USER_CREATED",
      performedBy: authUid,
      performedByName: createdByName,
      targetEntity: newUid,
      details: {
        fullName: userProfileDoc.fullName,
        email: userProfileDoc.email,
        userCode: userProfileDoc.userCode,
        capital: userProfileDoc.currentCapital,
        category: userProfileDoc.category,
      },
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    return {
      success: true,
      user: userProfileDoc,
      message: "Usuario registrado exitosamente en Firebase Auth y Firestore como ACTIVO.",
    };
  }
);

/**
 * Cloud Function HTTPS Callable: Registrar Inversionista Pendiente de Activación (Solo Firestore, NO Auth).
 * MODO PENDIENTE (SuperAdmin): No crea cuenta en Firebase Auth.
 * Establece status: 'PENDING_CLAIM', isClaimed: false, uid: null.
 */
exports.adminCreatePendingInvestor = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const { authUid, authEmail, createdByName } = await verifySuperAdminPrivileges(request);

    const data = request.data || {};
    const {
      email,
      fullName,
      phone = "",
      currentCapital = 0,
      userPercentage = 75,
      adminPercentage = 25,
      paymentMethod = "",
      paymentDetails = "Cuenta Principal",
      targetCycleId = null,
    } = data;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      throw new HttpsError("invalid-argument", "El correo electrónico ingresado es inválido.");
    }
    if (!fullName || typeof fullName !== "string" || !fullName.trim()) {
      throw new HttpsError("invalid-argument", "El nombre completo del usuario es obligatorio.");
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanFullName = fullName.trim();
    const cleanPhone = String(phone || "").trim();
    const cleanPaymentMethod = String(paymentMethod || "").trim();
    const cleanPaymentDetails = String(paymentDetails || "Cuenta Principal").trim();

    const capNum = Number(currentCapital) || 0;

    // ADMIN_CREATE_PENDING_INVESTOR_CAPITAL_GUARD
    if (
      !Number.isFinite(capNum) ||
      capNum < 2000000 ||
      capNum > Number.MAX_SAFE_INTEGER
    ) {
      throw new HttpsError(
        "invalid-argument",
        "INVALID_TRADING_CAPITAL: El capital del inversionista debe ser igual o superior a $2.000.000 COP."
      );
    }

    const userPctNum = Number(userPercentage) !== undefined ? Number(userPercentage) : 75;
    const adminPctNum = Number(adminPercentage) !== undefined ? Number(adminPercentage) : 25;

    let entryCycleId = null;

    if (!targetCycleId || typeof targetCycleId !== "string" || !targetCycleId.trim()) {
      throw new HttpsError(
        "failed-precondition",
        "INVESTOR_TARGET_CYCLE_REQUIRED: No existe un ciclo de ingreso válido para este inversionista."
      );
    }

    try {
      entryCycleId = await validateTargetCycleForUserEntry({
        db,
        targetCycleId: targetCycleId.trim(),
      });
    } catch (err) {
      if (err.code === "not-found") {
        throw new HttpsError("not-found", err.message);
      }
      throw new HttpsError("failed-precondition", err.message);
    }

    const category = getCanonicalCategoryForCapital(capNum);

    // Regla PENDING-01: Verificar que el email NO exista en Firebase Auth
    try {
      const existingAuthUser = await admin.auth().getUserByEmail(cleanEmail);
      if (existingAuthUser) {
        throw new HttpsError(
          "already-exists",
          "El correo electrónico ya se encuentra registrado en Firebase Authentication. Si este inversionista ya posee cuenta activa, gestiónala directamente."
        );
      }
    } catch (authErr) {
      if (authErr.code !== "auth/user-not-found") {
        if (authErr instanceof HttpsError) throw authErr;
        throw new HttpsError("internal", `Error al verificar autenticación: ${authErr.message || authErr}`);
      }
      // auth/user-not-found es el estado esperado y requerido
    }

    // Regla PENDING-02: Verificar que el email NO esté asignado a otro perfil activo/pendiente en Firestore
    const existingEmailSnap = await db.collection("users")
      .where("email", "==", cleanEmail)
      .limit(1)
      .get();
    if (!existingEmailSnap.empty) {
      const existingDoc = existingEmailSnap.docs[0].data();
      if (existingDoc.status !== "MIGRATED") {
        throw new HttpsError(
          "already-exists",
          "Ya existe un perfil activo o pendiente registrado con este correo electrónico en la plataforma."
        );
      }
    }

    // Generar userCode correlativo atómico en /counters/users
    const userCode = await getNextAtomicUserCode();

    // Crear únicamente perfil en Firestore con id legado
    const userRef = db.collection("users").doc();
    const legacyDocId = userRef.id;

    const pendingUserDoc = {
      id: legacyDocId,
      uid: null,
      isClaimed: false,
      status: "PENDING_CLAIM",
      email: cleanEmail,
      fullName: cleanFullName,
      phone: cleanPhone,
      currentCapital: capNum,
      baseCapital: capNum,
      currency: "COP",
      userPercentage: userPctNum,
      adminPercentage: adminPctNum,
      category,
      paymentMethod: cleanPaymentMethod,
      paymentDetails: cleanPaymentDetails,
      entryCycleId: entryCycleId || null,
      entryDate: new Date().toISOString().split("T")[0],
      userCode,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdByUid: authUid,
    };

    await userRef.set(pendingUserDoc);

    // Registro en auditoría
    await db.collection("auditLogs").add({
      action: "USER_PENDING_CREATED",
      performedBy: authUid,
      performedByName: createdByName,
      targetEntity: legacyDocId,
      details: {
        fullName: cleanFullName,
        email: cleanEmail,
        userCode,
        capital: capNum,
        category,
        status: "PENDING_CLAIM",
      },
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    return {
      success: true,
      user: pendingUserDoc,
      message: `Inversionista registrado exitosamente en estado PENDIENTE. Código: ${userCode}`,
    };
  }
);


/**
 * Bulk import autoritativo de inversionistas desde Excel.
 *
 * Reglas:
 * - Exclusivo SuperAdmin canonico.
 * - Solo registra usuarios NUEVOS.
 * - Nunca altera capital de usuarios existentes.
 * - Siempre asigna entryCycleId al PREPARING autoritativo.
 * - Los nuevos usuarios quedan PENDING_CLAIM.
 * - NO crea cycleUserResults ni calculos financieros.
 * - START sigue siendo la unica autoridad que congela cohortes.
 */
exports.adminBulkImportInvestorsCallable = onCall(
  {
    region: "us-central1",
    cors: true,
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (request) => {
    const {
      authUid,
      authEmail,
      createdByName,
    } = await verifySuperAdminPrivileges(request);

    // Hardening adicional:
    // este flujo masivo no confia solamente en role === ADMIN.
    const cleanAuthEmail = String(
      authEmail || ""
    )
      .trim()
      .toLowerCase();

    const canonicalSuperAdmin =
      authUid === "lpx4NLEEMkeh9EJFcG68oPMVdXF2" ||
      cleanAuthEmail === "juanes9802@gmail.com" ||
      cleanAuthEmail === "elcocalombiano1828@gmail.com";

    if (!canonicalSuperAdmin) {
      throw new HttpsError(
        "permission-denied",
        "BULK_IMPORT_SUPERADMIN_ONLY"
      );
    }

    const data = request.data || {};

    const rows = Array.isArray(data.rows)
      ? data.rows
      : [];

    const targetCycleId =
      typeof data.targetCycleId === "string"
        ? data.targetCycleId.trim()
        : "";

    const clientRequestId =
      typeof data.clientRequestId === "string"
        ? data.clientRequestId.trim().slice(0, 160)
        : "";

    if (!targetCycleId) {
      throw new HttpsError(
        "invalid-argument",
        "TARGET_CYCLE_REQUIRED"
      );
    }

    if (rows.length === 0) {
      throw new HttpsError(
        "invalid-argument",
        "ROWS_REQUIRED"
      );
    }

    if (rows.length > 150) {
      throw new HttpsError(
        "invalid-argument",
        "BULK_IMPORT_MAX_150_ROWS"
      );
    }

    let entryCycleId;

    try {
      entryCycleId =
        await validateTargetCycleForUserEntry({
          db,
          targetCycleId,
        });
    } catch (err) {
      if (
        err &&
        err.code === "not-found"
      ) {
        throw new HttpsError(
          "not-found",
          err.message
        );
      }

      throw new HttpsError(
        "failed-precondition",
        err && err.message
          ? err.message
          : "TARGET_CYCLE_NOT_PREPARING"
      );
    }

    if (
      !entryCycleId ||
      entryCycleId !== targetCycleId
    ) {
      throw new HttpsError(
        "failed-precondition",
        "TARGET_CYCLE_NOT_AUTHORITATIVE_PREPARING"
      );
    }

    const cycleRef =
      db
        .collection("monthlyCycles")
        .doc(entryCycleId);

    const cycleSnap =
      await cycleRef.get();

    if (!cycleSnap.exists) {
      throw new HttpsError(
        "not-found",
        "TARGET_CYCLE_NOT_FOUND"
      );
    }

    const cycleData =
      cycleSnap.data() || {};

    if (
      cycleData.status !== "OPEN" ||
      cycleData.operationalStatus !== "PREPARING"
    ) {
      throw new HttpsError(
        "failed-precondition",
        "TARGET_CYCLE_NOT_PREPARING"
      );
    }

    const settingsSnap =
      await db
        .collection("settings")
        .doc("global_config")
        .get();

    const settings =
      settingsSnap.exists
        ? settingsSnap.data() || {}
        : {};

    if (
      settings.preparingCycleId !==
      entryCycleId
    ) {
      throw new HttpsError(
        "failed-precondition",
        "TARGET_CYCLE_NOT_AUTHORITATIVE_PREPARING"
      );
    }

    if (cycleData.isStarting === true) {
      throw new HttpsError(
        "failed-precondition",
        "TARGET_CYCLE_START_IN_PROGRESS"
      );
    }

    const normalizeName = (value) =>
      String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");

    const cleanCode = (value) =>
      String(value || "")
        .trim()
        .toUpperCase();

    const existingUsersSnap =
      await db
        .collection("users")
        .get();

    const existingByName =
      new Map();

    const existingByCode =
      new Map();

    const existingByEmail =
      new Map();

    existingUsersSnap.forEach(
      (docSnap) => {
        const user =
          docSnap.data() || {};

        // MIGRATED es un documento historico.
        if (
          user.status === "MIGRATED"
        ) {
          return;
        }

        const normName =
          normalizeName(
            user.fullName
          );

        const code =
          cleanCode(
            user.userCode
          );

        const email =
          String(
            user.email || ""
          )
            .trim()
            .toLowerCase();

        if (
          normName &&
          !existingByName.has(normName)
        ) {
          existingByName.set(
            normName,
            {
              id: docSnap.id,
              ...user,
            }
          );
        }

        if (
          code &&
          !existingByCode.has(code)
        ) {
          existingByCode.set(
            code,
            {
              id: docSnap.id,
              ...user,
            }
          );
        }

        if (
          email &&
          !existingByEmail.has(email)
        ) {
          existingByEmail.set(
            email,
            {
              id: docSnap.id,
              ...user,
            }
          );
        }
      }
    );

    const results = [];

    const candidates = [];

    const fileNames =
      new Set();

    const fileEmails =
      new Set();

    for (
      let index = 0;
      index < rows.length;
      index += 1
    ) {
      const raw =
        rows[index] || {};

      const fullName =
        String(
          raw.fullName ||
          raw.clientName ||
          ""
        ).trim();

      const normalizedName =
        normalizeName(fullName);

      const matchedUserCode =
        cleanCode(
          raw.matchedUserCode
        );

      const suppliedEmail =
        String(
          raw.email || ""
        )
          .trim()
          .toLowerCase();

      const phone =
        String(
          raw.phone || ""
        ).trim();

      const capital =
        Number(
          raw.currentCapital ??
          raw.capitalCop
        );

      const rawId =
        String(
          raw.rawId ??
          raw.id ??
          index + 1
        );

      if (!fullName) {
        results.push({
          index,
          rawId,
          status: "FAILED",
          code: "FULL_NAME_REQUIRED",
          message:
            "La fila no tiene nombre.",
        });
        continue;
      }

      if (
        !Number.isFinite(capital) ||
        capital < 2000000 ||
        capital >
          Number.MAX_SAFE_INTEGER
      ) {
        results.push({
          index,
          rawId,
          fullName,
          status: "FAILED",
          code:
            "INVALID_TRADING_CAPITAL",
          message:
            "El capital debe ser igual o superior a 4.000.000 COP.",
        });
        continue;
      }

      if (
        matchedUserCode &&
        existingByCode.has(
          matchedUserCode
        )
      ) {
        const existing =
          existingByCode.get(
            matchedUserCode
          );

        results.push({
          index,
          rawId,
          fullName,
          status: "SKIPPED",
          code:
            "EXISTING_USER_CODE",
          existingUserId:
            existing.id,
          existingUserCode:
            existing.userCode || "",
          message:
            "El usuario ya existe. No se modifico su capital.",
        });
        continue;
      }

      if (
        normalizedName &&
        existingByName.has(
          normalizedName
        )
      ) {
        const existing =
          existingByName.get(
            normalizedName
          );

        results.push({
          index,
          rawId,
          fullName,
          status: "SKIPPED",
          code:
            "EXISTING_USER_NAME",
          existingUserId:
            existing.id,
          existingUserCode:
            existing.userCode || "",
          message:
            "Ya existe un usuario con este nombre. No se duplico.",
        });
        continue;
      }

      if (
        normalizedName &&
        fileNames.has(
          normalizedName
        )
      ) {
        results.push({
          index,
          rawId,
          fullName,
          status: "SKIPPED",
          code:
            "DUPLICATE_NAME_IN_FILE",
          message:
            "Nombre duplicado dentro del archivo.",
        });
        continue;
      }

      if (suppliedEmail) {
        if (
          !suppliedEmail.includes("@") ||
          suppliedEmail.length > 254
        ) {
          results.push({
            index,
            rawId,
            fullName,
            status: "FAILED",
            code: "INVALID_EMAIL",
            message:
              "El correo de la fila no es valido.",
          });
          continue;
        }

        if (
          existingByEmail.has(
            suppliedEmail
          )
        ) {
          const existing =
            existingByEmail.get(
              suppliedEmail
            );

          results.push({
            index,
            rawId,
            fullName,
            status: "SKIPPED",
            code:
              "EXISTING_USER_EMAIL",
            existingUserId:
              existing.id,
            existingUserCode:
              existing.userCode || "",
            message:
              "Ya existe un perfil con este correo.",
          });
          continue;
        }

        if (
          fileEmails.has(
            suppliedEmail
          )
        ) {
          results.push({
            index,
            rawId,
            fullName,
            status: "SKIPPED",
            code:
              "DUPLICATE_EMAIL_IN_FILE",
            message:
              "Correo duplicado dentro del archivo.",
          });
          continue;
        }
      }

      // Regla financiera fija para importacion Excel:
      // 50% inversionista / 50% administracion.
      // El backend ignora cualquier porcentaje enviado
      // por el archivo o por el cliente.
      const userPercentage = 50;
      const adminPercentage = 50;

      if (normalizedName) {
        fileNames.add(
          normalizedName
        );
      }

      if (suppliedEmail) {
        fileEmails.add(
          suppliedEmail
        );
      }

      candidates.push({
        index,
        rawId,
        fullName,
        normalizedName,
        suppliedEmail,
        phone,
        capital:
          Math.round(capital),
        userPercentage,
        adminPercentage,
        category:
          getCanonicalCategoryForCapital(
            Math.round(capital)
          ),
        paymentMethod:
          String(
            raw.paymentMethod || ""
          ).trim(),
        paymentDetails:
          String(
            raw.paymentDetails ||
            "Cuenta Principal"
          ).trim(),
      });
    }

    const authorizedCandidates =
      [];

    // Si el Excel trae email real,
    // verificar que tampoco exista en Firebase Auth.
    for (
      const candidate
      of candidates
    ) {
      if (
        !candidate.suppliedEmail
      ) {
        authorizedCandidates.push(
          candidate
        );
        continue;
      }

      try {
        const existingAuth =
          await admin
            .auth()
            .getUserByEmail(
              candidate.suppliedEmail
            );

        if (existingAuth) {
          results.push({
            index:
              candidate.index,
            rawId:
              candidate.rawId,
            fullName:
              candidate.fullName,
            status: "SKIPPED",
            code:
              "AUTH_EMAIL_EXISTS",
            message:
              "El correo ya existe en Firebase Authentication.",
          });

          continue;
        }
      } catch (authErr) {
        if (
          authErr &&
          authErr.code ===
            "auth/user-not-found"
        ) {
          authorizedCandidates.push(
            candidate
          );

          continue;
        }

        throw new HttpsError(
          "internal",
          `AUTH_CHECK_FAILED: ${
            authErr &&
            authErr.message
              ? authErr.message
              : authErr
          }`
        );
      }
    }

    const batch =
      db.batch();

    let createdUsersCount = 0;

    for (
      const candidate
      of authorizedCandidates
    ) {
      let userCode;

      try {
        userCode =
          await getNextAtomicUserCode();
      } catch (err) {
        results.push({
          index:
            candidate.index,
          rawId:
            candidate.rawId,
          fullName:
            candidate.fullName,
          status: "FAILED",
          code:
            "USER_CODE_ALLOCATION_FAILED",
          message:
            "No fue posible reservar el codigo de usuario.",
        });

        continue;
      }

      const userRef =
        db
          .collection("users")
          .doc();

      const legacyDocId =
        userRef.id;

      // El parser historico no siempre contiene email.
      // Se crea un email tecnico unico SOLO para el perfil pendiente.
      // El email definitivo se establece al completar la activacion.
      const effectiveEmail =
        candidate.suppliedEmail ||
        `pending.${legacyDocId.toLowerCase()}@easytraders24.app`;

      const pendingUserDoc = {
        id: legacyDocId,
        uid: null,

        isClaimed: false,
        status: "PENDING_CLAIM",
        role: "USER",

        email:
          effectiveEmail,

        bulkImportPlaceholderEmail:
          !candidate.suppliedEmail,

        fullName:
          candidate.fullName,

        phone:
          candidate.phone,

        currentCapital:
          candidate.capital,

        baseCapital:
          candidate.capital,

        currency: "COP",

        userPercentage:
          candidate.userPercentage,

        adminPercentage:
          candidate.adminPercentage,

        category:
          candidate.category,

        paymentMethod:
          candidate.paymentMethod,

        paymentDetails:
          candidate.paymentDetails,

        entryCycleId:
          entryCycleId,

        entryDate:
          new Date()
            .toISOString()
            .split("T")[0],

        userCode,

        source:
          "EXCEL_BULK_IMPORT",

        bulkImportClientRequestId:
          clientRequestId || null,

        createdAt:
          admin.firestore
            .FieldValue
            .serverTimestamp(),

        updatedAt:
          admin.firestore
            .FieldValue
            .serverTimestamp(),

        createdByUid:
          authUid,
      };

      batch.set(
        userRef,
        pendingUserDoc
      );

      existingByName.set(
        candidate.normalizedName,
        pendingUserDoc
      );

      existingByCode.set(
        userCode,
        pendingUserDoc
      );

      existingByEmail.set(
        effectiveEmail,
        pendingUserDoc
      );

      createdUsersCount += 1;

      results.push({
        index:
          candidate.index,
        rawId:
          candidate.rawId,
        fullName:
          candidate.fullName,
        status: "CREATED",
        code: "CREATED",
        userId:
          legacyDocId,
        userCode,
        category:
          candidate.category,
        currentCapital:
          candidate.capital,
        email:
          effectiveEmail,
        placeholderEmail:
          !candidate.suppliedEmail,
      });
    }

    const skippedUsersCount =
      results.filter(
        (item) =>
          item.status ===
          "SKIPPED"
      ).length;

    const failedUsersCount =
      results.filter(
        (item) =>
          item.status ===
          "FAILED"
      ).length;

    if (
      createdUsersCount > 0
    ) {
      const auditRef =
        db
          .collection("auditLogs")
          .doc();

      batch.set(
        auditRef,
        {
          action:
            "ADMIN_BULK_IMPORT_INVESTORS",

          performedBy:
            authUid,

          performedByName:
            createdByName,

          targetCycleId:
            entryCycleId,

          clientRequestId:
            clientRequestId || null,

          rowsReceived:
            rows.length,

          createdUsersCount,

          skippedUsersCount,

          failedUsersCount,

          timestamp:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        }
      );

      await batch.commit();
    }

    results.sort(
      (a, b) =>
        Number(a.index || 0) -
        Number(b.index || 0)
    );

    return {
      success: true,

      partialSuccess:
        createdUsersCount > 0 &&
        (
          skippedUsersCount > 0 ||
          failedUsersCount > 0
        ),

      targetCycleId:
        entryCycleId,

      rowsReceived:
        rows.length,

      createdUsersCount,

      skippedUsersCount,

      failedUsersCount,

      results,

      message:
        `Importacion procesada. ` +
        `Creados: ${createdUsersCount}. ` +
        `Omitidos: ${skippedUsersCount}. ` +
        `Errores: ${failedUsersCount}.`,
    };
  }
);

/**
 * Cloud Function HTTPS Callable: Reconciliar usuario existente como ACTIVO (Solo SuperAdmin).
 * Para casos donde Firestore tiene isClaimed == false o undefined, pero el documentId coincide
 * con un usuario de Firebase Auth y sus correos coinciden exactamente.
 */
exports.adminReconcileActiveUser = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const { authUid, authEmail, createdByName } = await verifySuperAdminPrivileges(request);

    const { userDocumentId } = request.data || {};
    if (!userDocumentId || typeof userDocumentId !== "string" || !userDocumentId.trim()) {
      throw new HttpsError("invalid-argument", "El identificador del documento de usuario es obligatorio.");
    }

    const docId = userDocumentId.trim();
    const userRef = db.collection("users").doc(docId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      throw new HttpsError("not-found", "El perfil de usuario especificado no existe en Firestore.");
    }

    const userData = userSnap.data() || {};
    if (userData.status === "MIGRATED") {
      throw new HttpsError("failed-precondition", "Este perfil ya figura como migrado a otra cuenta.");
    }

    // Verificar si Firebase Auth contiene exactamente este UID
    let authRecord;
    try {
      authRecord = await admin.auth().getUser(docId);
    } catch (authErr) {
      if (authErr.code === "auth/user-not-found") {
        throw new HttpsError(
          "failed-precondition",
          "No existe ningún usuario en Firebase Authentication con este identificador. No es un usuario inconsistente reconciliable."
        );
      }
      throw new HttpsError("internal", `Error consultando Firebase Auth: ${authErr.message || authErr}`);
    }

    // Verificar coincidencia exacta de correos normalizados
    const authEmailNorm = String(authRecord.email || "").trim().toLowerCase();
    const firestoreEmailNorm = String(userData.email || "").trim().toLowerCase();

    if (!authEmailNorm || !firestoreEmailNorm || authEmailNorm !== firestoreEmailNorm) {
      throw new HttpsError(
        "failed-precondition",
        `El correo de Firebase Auth (${authEmailNorm || "vacío"}) no coincide exactamente con el registrado en Firestore (${firestoreEmailNorm || "vacío"}). Reconciliación denegada por seguridad.`
      );
    }

    // Reconciliar perfil como activo y recalcular categoría canónica por capital
    const capNum = Number(userData.currentCapital || userData.baseCapital || 0);
    const category = getCanonicalCategoryForCapital(capNum);

    const reconciliationUpdate = {
      isClaimed: true,
      status: "ACTIVE",
      uid: docId,
      id: docId,
      category,
      claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      activationTokenHash: null,
      activationExpiresAt: null,
      reconciledByUid: authUid,
      reconciledAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await userRef.update(reconciliationUpdate);

    // Auditoría
    await db.collection("auditLogs").add({
      action: "ADMIN_RECONCILE_ACTIVE_USER",
      performedBy: authUid,
      performedByName: createdByName,
      targetEntity: docId,
      details: {
        email: firestoreEmailNorm,
        fullName: userData.fullName || "",
        userCode: userData.userCode || "",
        uid: docId,
      },
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    return {
      success: true,
      message: `Usuario ${userData.fullName || docId} reconciliado exitosamente como ACTIVO.`,
    };
  }
);

/**
 * Helper canónico para construir mensajes FCM Data-Only determinísticos para Web Push / PWA.
 * Garantiza que NO exista el objeto top-level 'notification' ni 'webpush.notification',
 * entregando el control total del renderizado al Service Worker (onBackgroundMessage) y evitando duplicados.
 */
function buildWebPushDataMessage(tokens, params) {
  const {
    title = "EasyTraders",
    body = "",
    type = "GENERAL",
    notifId = "",
    tag = "",
    url = "/",
  } = params || {};

  return {
    tokens,
    data: {
      title: String(title || "EasyTraders"),
      body: String(body || ""),
      type: String(type || "GENERAL"),
      notifId: String(notifId || ""),
      tag: String(tag || ""),
      url: String(url || "/"),
      timestamp: new Date().toISOString(),
    },
    webpush: {
      headers: {
        Urgency: "high",
        ...(tag ? { Topic: String(tag) } : {}),
      },
    },
  };
}

/**
 * Cloud Function para el despacho idempotente de Notificaciones Push (FCM).
 * Trigger: onDocumentCreated en la colección notifications/{notifId}
 */
exports.onNotificationCreated = onDocumentCreated(
  {
    document: "notifications/{notifId}",
    region: "us-central1",
    retry: false, // Evita reintentos automáticos descontrolados a nivel infraestructura
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const notifId = event.params.notifId;
    const notifRef = db.collection("notifications").doc(notifId);

    console.log(`[Push Notification] Iniciando procesamiento para ID: ${notifId}`);

    // =========================================================================
    // 1. CERROJO TRANSACCIONAL ATÓMICO (IDEMPOTENCIA ESTRICTA)
    // =========================================================================
    let notifData;
    try {
      notifData = await db.runTransaction(async (transaction) => {
        const freshDoc = await transaction.get(notifRef);
        if (!freshDoc.exists) {
          throw new Error("DOCUMENT_NOT_FOUND");
        }

        const data = freshDoc.data() || {};
        const currentStatus = data.deliveryStatus;

        // Si ya está en proceso o ya fue enviada, abortar inmediatamente
        if (currentStatus === "PROCESSING" || currentStatus === "SENT") {
          console.warn(
            `[Push Notification] Transacción abortada. La notificación ${notifId} ya se encuentra en estado: ${currentStatus}`
          );
          return null;
        }

        // Si el estado es PENDING (o no está definido), adquirir el bloqueo transaccional
        transaction.update(notifRef, {
          deliveryStatus: "PROCESSING",
          processingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
          attempts: admin.firestore.FieldValue.increment(1),
        });

        return data;
      });
    } catch (txError) {
      console.error(`[Push Notification] Error en cerrojo transaccional para ${notifId}:`, txError);
      return;
    }

    // Si la transacción retornó null (ya procesada o en proceso), finalizamos aquí
    if (!notifData) {
      return;
    }

    // =========================================================================
    // 2. RESOLUCIÓN DE DESTINATARIOS Y TOKENS FCM
    // =========================================================================
    try {
      const tokensMap = new Map(); // tokenString -> { docPath, userId }

      // Caso A: Notificación Global para todos los Administradores y SuperAdmins
      if (notifData.userId === "ALL_ADMINS" || notifData.targetRole === "ADMIN" || notifData.targetRole === "SUPERADMIN") {
        const adminUidsSet = new Set(["lpx4NLEEMkeh9EJFcG68oPMVdXF2"]);
        
        // Consultar por roles administrativos en la colección users
        const adminRoles = ["ADMIN", "SUPERADMIN", "admin", "superadmin"];
        for (const role of adminRoles) {
          const adminsSnap = await db.collection("users").where("role", "==", role).get();
          adminsSnap.forEach((doc) => adminUidsSet.add(doc.id));
        }

        // Consultar por emails de SuperAdmins conocidos
        const superEmails = ["juanes9802@gmail.com", "elcocalombiano1828@gmail.com"];
        for (const email of superEmails) {
          const emailSnap = await db.collection("users").where("email", "==", email).get();
          emailSnap.forEach((doc) => adminUidsSet.add(doc.id));
        }

        for (const adminUid of adminUidsSet) {
          const tokensSnap = await db.collection(`users/${adminUid}/pushTokens`).get();
          tokensSnap.forEach((tokenDoc) => {
            const tokenData = tokenDoc.data();
            if (tokenData && tokenData.token) {
              tokensMap.set(tokenData.token, { docPath: tokenDoc.ref.path, userId: adminUid });
            }
          });
        }
      } 
      // Caso B: Lista explícita de Firebase Auth UIDs (authorizedUids)
      else if (Array.isArray(notifData.authorizedUids) && notifData.authorizedUids.length > 0) {
        for (const uid of notifData.authorizedUids) {
          if (!uid) continue;
          const tokensSnap = await db.collection(`users/${uid}/pushTokens`).get();
          tokensSnap.forEach((tokenDoc) => {
            const tokenData = tokenDoc.data();
            if (tokenData && tokenData.token) {
              tokensMap.set(tokenData.token, { docPath: tokenDoc.ref.path, userId: uid });
            }
          });
        }
      } 
      // Caso C: Destinatario único por userId o userUid
      else if (notifData.userId || notifData.userUid) {
        const targetId = notifData.userUid || notifData.userId;
        let tokensSnap = await db.collection(`users/${targetId}/pushTokens`).get();

        // Fallback por userCode si no se encontraron tokens directamente
        if (tokensSnap.empty && notifData.userCode) {
          const userCodeSnap = await db
            .collection("users")
            .where("userCode", "==", notifData.userCode)
            .limit(1)
            .get();

          if (!userCodeSnap.empty) {
            const foundUid = userCodeSnap.docs[0].id;
            tokensSnap = await db.collection(`users/${foundUid}/pushTokens`).get();
          }
        }

        tokensSnap.forEach((tokenDoc) => {
          const tokenData = tokenDoc.data();
          if (tokenData && tokenData.token) {
            tokensMap.set(tokenData.token, { docPath: tokenDoc.ref.path, userId: targetId });
          }
        });
      }

      const tokensList = Array.from(tokensMap.keys());

      // Si no hay dispositivos registrados para el destinatario
      if (tokensList.length === 0) {
        console.log(`[Push Notification] No se encontraron tokens FCM registrados para ${notifId}`);
        await notifRef.update({
          deliveryStatus: "SENT", // Se marca completada para no reintentar
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          deliverySummary: {
            totalTokens: 0,
            successCount: 0,
            failureCount: 0,
            note: "No active device tokens found for target users",
          },
        });
        return;
      }

      console.log(`[Push Notification] Despachando a ${tokensList.length} dispositivos para ${notifId}`);

      // =========================================================================
      // 3. DESPACHO MULTICAST DATA-ONLY CON COLLAPSE KEY DETERMINÍSTICO
      // =========================================================================
      const collapseKey = `notif_${notifId}`;
      const payloadTitle = String(notifData.title || "EasyTraders Gestor de Capital");
      const payloadBody = String(notifData.message || notifData.body || "");
      const actionUrl = String(notifData.actionUrl || notifData.url || "/");

      const multicastMessage = buildWebPushDataMessage(tokensList, {
        title: payloadTitle,
        body: payloadBody,
        type: String(notifData.type || "GENERAL"),
        notifId: String(notifId),
        tag: collapseKey,
        url: actionUrl,
      });

      const response = await admin.messaging().sendEachForMulticast(multicastMessage);
      console.log(
        `[Push Notification] Despacho completado para ${notifId}. Éxitos: ${response.successCount}, Fallos: ${response.failureCount}`
      );

      // =========================================================================
      // 4. PURGA DE TOKENS INVÁLIDOS O DESINSTALADOS
      // =========================================================================
      if (response.failureCount > 0) {
        const cleanupPromises = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errorCode = resp.error ? resp.error.code : "";
            if (
              errorCode === "messaging/registration-token-not-registered" ||
              errorCode === "messaging/invalid-registration-token"
            ) {
              const staleToken = tokensList[idx];
              const tokenMeta = tokensMap.get(staleToken);
              if (tokenMeta && tokenMeta.docPath) {
                console.log(`[Push Notification] Purgando token obsoleto en ${tokenMeta.docPath}`);
                cleanupPromises.push(db.doc(tokenMeta.docPath).delete().catch(() => {}));
              }
            }
          }
        });
        await Promise.allSettled(cleanupPromises);
      }

      // =========================================================================
      // 5. CIERRE Y ACTUALIZACIÓN ATÓMICA A 'SENT'
      // =========================================================================
      await notifRef.update({
        deliveryStatus: "SENT",
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        deliverySummary: {
          totalTokens: tokensList.length,
          successCount: response.successCount,
          failureCount: response.failureCount,
        },
      });

      console.log(`[Push Notification] Notificación ${notifId} marcada exitosamente como SENT.`);
    } catch (dispatchError) {
      console.error(`[Push Notification Error] Fallo crítico despachando ${notifId}:`, dispatchError);
      await notifRef.update({
        deliveryStatus: "FAILED",
        lastError: String(dispatchError.message || dispatchError),
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
);

/**
 * Función auxiliar para comparación segura de cadenas en tiempo constante
 */
function safeTimingStringCompare(strA, strB) {
  if (typeof strA !== "string" || typeof strB !== "string") return false;
  const bufA = Buffer.from(strA, "utf8");
  const bufB = Buffer.from(strB, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * FASE 1B: Cloud Function HTTPS Callable para Reclamar Cuenta y Crear Identidad Canónica.
 * Invocable sin autenticación previa (atiende usuarios PRE-CLAIM).
 * Requiere identifier + activationToken + email + password + idempotencyKey.
 */
exports.claimAccountCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const data = request.data || {};
    const {
      identifier,
      activationToken,
      email,
      password,
      clientRequestId,
    } = data;

    // 1. Validaciones básicas de entrada (El cliente NO envía email)
    if (!identifier || typeof identifier !== "string" || !identifier.trim()) {
      throw new HttpsError("invalid-argument", "El identificador (código de usuario o cédula) es obligatorio.");
    }
    if (!activationToken || typeof activationToken !== "string" || !activationToken.trim()) {
      throw new HttpsError("invalid-argument", "El código de activación es obligatorio.");
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      throw new HttpsError("invalid-argument", "La contraseña debe tener al menos 6 caracteres.");
    }

    const cleanIdentifier =
      identifier.trim();

    const cleanToken =
      activationToken.trim();

    const requestedEmail =
      String(email || '')
        .trim()
        .toLowerCase();

    const requestedEmailRegex =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (
      !requestedEmail ||
      !requestedEmailRegex.test(requestedEmail) ||
      requestedEmail.length > 100
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Ingresa un correo electr?nico v?lido para activar tu cuenta."
      );
    }

    // 2. Localizar el perfil legacy sin confiar en el cliente
    let legacyUserDoc = null;
    const directDoc = await db.collection("users").doc(cleanIdentifier).get();
    if (directDoc.exists) {
      legacyUserDoc = directDoc;
    } else {
      const codeQuery = await db
        .collection("users")
        .where("userCode", "==", cleanIdentifier.toUpperCase())
        .limit(1)
        .get();
      if (!codeQuery.empty) {
        legacyUserDoc = codeQuery.docs[0];
      } else {
        const docIdQuery = await db
          .collection("users")
          .where("documentId", "==", cleanIdentifier)
          .limit(1)
          .get();
        if (!docIdQuery.empty) {
          legacyUserDoc = docIdQuery.docs[0];
        }
      }
    }

    // Si no existe, no filtrar detalles específicos al cliente
    if (!legacyUserDoc || !legacyUserDoc.exists) {
      throw new HttpsError("invalid-argument", "Código de activación, identificación o credenciales inválidas.");
    }

    const legacyDocId = legacyUserDoc.id;
    const legacyUserRef = db.collection("users").doc(legacyDocId);
    const legacyData = legacyUserDoc.data() || {};

    // 3. Validar estado del perfil legacy
    if (legacyData.isClaimed === true || legacyData.status === "MIGRATED") {
      throw new HttpsError("failed-precondition", "Esta cuenta ya ha sido activada anteriormente.");
    }
    if (legacyData.status === "SUSPENDED" || legacyData.status === "INACTIVE") {
      throw new HttpsError("failed-precondition", "La cuenta se encuentra inactiva o suspendida. Contacta a soporte.");
    }
    if (legacyData.status !== "PENDING_CLAIM" && legacyData.status !== "PENDING") {
      throw new HttpsError("failed-precondition", "La cuenta no se encuentra en estado pendiente de activación.");
    }
    if (legacyData.uid && legacyData.uid !== legacyDocId) {
      throw new HttpsError("failed-precondition", "Esta cuenta ya cuenta con una identidad vinculada.");
    }

    // 4. Rate limiting: Verificar bloqueo temporal
    const nowMs = Date.now();
    if (legacyData.claimLockedUntil) {
      const lockedUntilMs = legacyData.claimLockedUntil.toMillis
        ? legacyData.claimLockedUntil.toMillis()
        : new Date(legacyData.claimLockedUntil).getTime();
      if (lockedUntilMs > nowMs) {
        const remainingMin = Math.ceil((lockedUntilMs - nowMs) / (60 * 1000));
        throw new HttpsError(
          "resource-exhausted",
          `La cuenta se encuentra temporalmente bloqueada por múltiples intentos fallidos. Intenta nuevamente en ${remainingMin} minutos.`
        );
      }
    }

    // 5. Validar token de activación (Exigido en todos los casos)
    if (!legacyData.activationTokenHash) {
      throw new HttpsError(
        "failed-precondition",
        "La cuenta no tiene un código de activación generado. Solicítalo al administrador."
      );
    }

    if (legacyData.activationExpiresAt) {
      const expiresAtMs = legacyData.activationExpiresAt.toMillis
        ? legacyData.activationExpiresAt.toMillis()
        : new Date(legacyData.activationExpiresAt).getTime();
      if (expiresAtMs < nowMs) {
        throw new HttpsError(
          "failed-precondition",
          "El código de activación ha expirado. Solicita un nuevo código al administrador."
        );
      }
    }

    // Comparación segura en tiempo constante del token
    const incomingTokenHash = crypto.createHash("sha256").update(cleanToken).digest("hex");
    const storedTokenHash = String(legacyData.activationTokenHash || "");
    const isTokenValid = safeTimingStringCompare(incomingTokenHash, storedTokenHash);

    if (!isTokenValid) {
      // Incrementar intentos fallidos server-side de forma atómica
      const nextAttempts = (legacyData.claimAttempts || 0) + 1;
      const updateRateLimit = { claimAttempts: nextAttempts };
      if (nextAttempts >= 5) {
        updateRateLimit.claimLockedUntil = admin.firestore.Timestamp.fromMillis(nowMs + 30 * 60 * 1000);
      }
      await legacyUserRef.update(updateRateLimit);

      // Error genérico sin revelar datos del perfil ni del correo
      throw new HttpsError("invalid-argument", "Código de activación, identificación o credenciales inválidas.");
    }

    // 6. IDEMPOTENCIA Y LOCK DE CONCURRENCIA VINCULADO AL PERFIL LEGACY (CLAIM-04)
    // Se deriva server-side para evitar colisiones y no depender de un idempotencyKey arbitrario del cliente
    const claimOperationId = `claim_${legacyDocId}`;
    const claimOpRef = db.collection("claimOperations").doc(claimOperationId);

    const existingOpSnap = await claimOpRef.get();
    let opData = null;
    if (existingOpSnap.exists) {
      opData = existingOpSnap.data() || {};
      if (opData.status === "COMPLETED" || opData.status === "SUCCESS") {
        return {
          success: true,
          message: "Cuenta activada previamente con éxito.",
          uid: opData.uid || opData.firebaseAuthUid || opData.canonicalUid,
          email: opData.email,
        };
      }
      if (opData.status === "CLAIMING") {
        const createdAtMs = opData.createdAt?.toMillis
          ? opData.createdAt.toMillis()
          : (opData.createdAt ? new Date(opData.createdAt).getTime() : 0);
        // Si tiene menos de 60 segundos, rechazar como concurrente activo
        if (Date.now() - createdAtMs < 60000) {
          throw new HttpsError(
            "already-exists",
            "La solicitud de activación para esta cuenta ya está en proceso. Por favor espera unos segundos e intenta nuevamente."
          );
        }
      }
      // Los estados FAILED y COMPENSATION_FAILED pueden reintentarse libremente
    }

    // 7. Extraer y validar el email canónico exclusivamente desde el perfil PENDING de Firestore
    const canonicalEmail =
      requestedEmail;

    // El token v?lido permite definir el correo real.
    // El correo placeholder del Excel no es autoridad.
    const existingEmailSnap =
      await db
        .collection("users")
        .where("email", "==", canonicalEmail)
        .limit(5)
        .get();

    const conflictingEmailProfile =
      existingEmailSnap.docs.find((docSnap) => {
        if (docSnap.id === legacyDocId) {
          return false;
        }

        const existing =
          docSnap.data() || {};

        return existing.status !== "MIGRATED";
      });

    if (conflictingEmailProfile) {
      throw new HttpsError(
        "already-exists",
        "Este correo electr?nico ya est? asociado a otro perfil."
      );
    }

    // Recuperaci?n de intentos anteriores fallidos
    const isCompensationFailed =
      (opData && opData.status === "COMPENSATION_FAILED") ||
      legacyData.claimStatus === "COMPENSATION_FAILED";

    let firebaseAuthUid = null;
    let isRecoveredOrphan = false;

    if (isCompensationFailed) {
      const orphanedUid = (opData && opData.orphanedAuthUid) || legacyData.orphanedAuthUid;
      const recordedEmail = ((opData && opData.email) || legacyData.orphanedEmail || "").toLowerCase().trim();

      if (orphanedUid) {
        if (recordedEmail && canonicalEmail !== recordedEmail) {
          throw new HttpsError(
            "permission-denied",
            "Inconsistencia en el correo registrado en el intento de activación huérfano previo."
          );
        }

        // Verificar con Admin Auth que ese UID huérfano existe realmente
        try {
          const orphanedUserRecord = await admin.auth().getUser(orphanedUid);
          if (orphanedUserRecord && orphanedUserRecord.email.toLowerCase().trim() === canonicalEmail) {
            // Reutilizar ese Auth UID en vez de llamar createUser nuevamente
            firebaseAuthUid = orphanedUserRecord.uid;
            isRecoveredOrphan = true;
            // Actualizar contraseña al valor provisto en este reintento
            await admin.auth().updateUser(firebaseAuthUid, { password: password });
            console.log(`[claimAccountCallable RECUPERACIÓN] Reutilizando usuario Auth huérfano ${firebaseAuthUid} para ${canonicalEmail}`);
          }
        } catch (authFetchErr) {
          console.warn(`[claimAccountCallable] Usuario Auth huérfano ${orphanedUid} no existe en Auth (${authFetchErr.message}). Se procederá a creación.`);
        }
      }
    }

    let authUserCreatedThisAttempt = false;

    // 9. Creación de Auth User (solo si no fue recuperado un huérfano explícito)
    if (!firebaseAuthUid) {
      await claimOpRef.set({
        status: "CLAIMING",
        claimOperationId,
        clientRequestId: clientRequestId ? String(clientRequestId).trim() : null,
        legacyUserDocumentId: legacyDocId,
        legacyOriginalId: legacyDocId,
        email: canonicalEmail,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      try {
        const createdAuthUser = await admin.auth().createUser({
          email: canonicalEmail,
          password: password,
          displayName: legacyData.fullName || "Inversionista EasyTraders",
        });
        firebaseAuthUid = createdAuthUser.uid;
        authUserCreatedThisAttempt = true;
      } catch (authError) {
        await claimOpRef.update({
          status: "FAILED",
          failureReason: authError.code || authError.message,
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        if (authError.code === "auth/email-already-exists") {
          throw new HttpsError(
            "already-exists",
            "El correo registrado para este perfil ya cuenta con una cuenta en Firebase Authentication. Contacta al administrador para su reconciliación."
          );
        }
        throw new HttpsError("invalid-argument", authError.message || "Error al crear las credenciales de usuario.");
      }
    } else {
      // Registrar estado CLAIMING durante la recuperación
      await claimOpRef.set({
        status: "CLAIMING",
        claimOperationId,
        clientRequestId: clientRequestId ? String(clientRequestId).trim() : null,
        legacyUserDocumentId: legacyDocId,
        legacyOriginalId: legacyDocId,
        orphanedAuthUid: firebaseAuthUid,
        email: canonicalEmail,
        isRecovery: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    // 10. Transacción atómica en Firestore para crear /users/{firebaseAuthUid} canónico
    // y marcar /users/{legacyDocId} como MIGRATED
    try {
      await db.runTransaction(async (transaction) => {
        const freshLegacySnap = await transaction.get(legacyUserRef);
        if (!freshLegacySnap.exists) {
          throw new Error("LEGACY_DOC_NOT_FOUND");
        }
        const freshLegacyData = freshLegacySnap.data() || {};
        if (freshLegacyData.isClaimed === true || freshLegacyData.status === "MIGRATED") {
          throw new Error("ALREADY_CLAIMED");
        }

        // Validación estricta del ciclo de ingreso y bloqueo si ya inició operaciones
        if (freshLegacyData.entryCycleId) {
          const entryCycleRef = db.collection("monthlyCycles").doc(freshLegacyData.entryCycleId);
          const entryCycleSnap = await transaction.get(entryCycleRef);
          if (!entryCycleSnap.exists) {
            throw new Error("TARGET_CYCLE_NOT_FOUND");
          }
          const entryCycleData = entryCycleSnap.data() || {};
          if (entryCycleData.status !== "OPEN" || entryCycleData.operationalStatus !== "PREPARING") {
            throw new Error("TARGET_CYCLE_ALREADY_STARTED");
          }
          // Incrementar cohortVersion de forma atómica dentro de la misma transacción
          transaction.update(entryCycleRef, {
            cohortVersion: admin.firestore.FieldValue.increment(1),
            updatedAt: new Date().toISOString(),
          });
        }

        const canonicalUserRef = db.collection("users").doc(firebaseAuthUid);

        const finalCapital = Number(freshLegacyData.currentCapital || freshLegacyData.baseCapital || 0);
        const finalBaseCapital = Number(freshLegacyData.baseCapital || freshLegacyData.currentCapital || 0);
        const canonicalCategory = getCanonicalCategoryForCapital(finalCapital);

        // Copiar exclusivamente datos de negocio del servidor (NO confiar en cliente ni en category antigua)
        const canonicalData = {
          id: firebaseAuthUid,
          uid: firebaseAuthUid,
          legacyOriginalId: legacyDocId,
          userCode: freshLegacyData.userCode || "",
          fullName: freshLegacyData.fullName || "",
          email: canonicalEmail,
          bulkImportPlaceholderEmail: false,
          phone: freshLegacyData.phone || "",
          documentId: freshLegacyData.documentId || "",
          role: "USER",
          status: "ACTIVE",
          currentCapital: finalCapital,
          baseCapital: finalBaseCapital,
          currency: "COP",
          category: canonicalCategory,
          userPercentage: Number(freshLegacyData.userPercentage || 50),
          adminPercentage: Number(freshLegacyData.adminPercentage || 50),
          paymentMethod: freshLegacyData.paymentMethod || "Bancolombia",
          paymentDetails: freshLegacyData.paymentDetails || "Cuenta Principal",
          entryDate: freshLegacyData.entryDate || new Date().toISOString().split("T")[0],
          entryCycleId: freshLegacyData.entryCycleId || null,
          isClaimed: true,
          claimedAt: admin.firestore.FieldValue.serverTimestamp(),
          activationTokenHash: null,
          activationExpiresAt: null,
          claimAttempts: 0,
          claimLockedUntil: null,
          claimStatus: "COMPLETED",
          orphanedAuthUid: null,
          orphanedEmail: null,
          createdAt: normalizeCreatedAt(freshLegacyData.createdAt),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        transaction.set(canonicalUserRef, canonicalData);

        // Marcar documento legacy como MIGRATED y limpiar estados de contingencia
        transaction.update(legacyUserRef, {
          status: "MIGRATED",
          isClaimed: true,
          migratedToUid: firebaseAuthUid,
          claimedEmail: canonicalEmail,
          bulkImportPlaceholderEmail: false,
          claimStatus: "COMPLETED",
          orphanedAuthUid: null,
          orphanedEmail: null,
          activationTokenHash: null,
          activationExpiresAt: null,
          claimedAt: admin.firestore.FieldValue.serverTimestamp(),
          claimAttempts: 0,
          claimLockedUntil: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
    } catch (firestoreError) {
      console.error(`[claimAccountCallable] Fallo Firestore para UID ${firebaseAuthUid}. Evaluando compensación...`, firestoreError);

      if (authUserCreatedThisAttempt === true) {
        // COMPENSACIÓN ATÓMICA para usuario recién creado en esta invocación
        try {
          await admin.auth().deleteUser(firebaseAuthUid);
          console.log(`[claimAccountCallable COMPENSADO] Usuario Auth ${firebaseAuthUid} eliminado exitosamente.`);
          await claimOpRef.update({
            status: "FAILED",
            failureReason: firestoreError.message || String(firestoreError),
            compensated: true,
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (deleteError) {
          console.error(`[claimAccountCallable CRÍTICO] Compensación falló al borrar usuario Auth ${firebaseAuthUid}:`, deleteError);

          // Estado recuperable requerido en claimOperations (CLAIM-11)
          // NO se almacena password, activationToken ni activationTokenHash
          await claimOpRef.set({
            status: "COMPENSATION_FAILED",
            legacyUserDocumentId: legacyDocId,
            orphanedAuthUid: firebaseAuthUid,
            email: canonicalEmail,
            failureReason: deleteError.message || String(deleteError),
            compensated: false,
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });

          // También marcar documento legacy con referencia suficiente sin considerarlo CLAIMED
          await legacyUserRef.update({
            claimStatus: "COMPENSATION_FAILED",
            orphanedAuthUid: firebaseAuthUid,
            orphanedEmail: canonicalEmail,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }).catch(() => {});

          throw new HttpsError(
            "internal",
            `Error durante la activación con compensación pendiente. Por favor contacta a soporte o reintenta con el ID de operación: ${claimOperationId}`
          );
        }
      } else {
        // Reintento de migración para huérfano volvió a fallar en Firestore:
        console.warn(`[claimAccountCallable] Reintento de migración para huérfano ${firebaseAuthUid} falló en Firestore. Conservando COMPENSATION_FAILED.`);
        await claimOpRef.set({
          status: "COMPENSATION_FAILED",
          legacyUserDocumentId: legacyDocId,
          orphanedAuthUid: firebaseAuthUid,
          email: canonicalEmail,
          failureReason: firestoreError.message || String(firestoreError),
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        await legacyUserRef.update({
          claimStatus: "COMPENSATION_FAILED",
          orphanedAuthUid: firebaseAuthUid,
          orphanedEmail: canonicalEmail,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch(() => {});

        throw new HttpsError(
          "internal",
          `Fallo al completar la activación pendiente. El estado permanece recuperable con ID: ${claimOperationId}`
        );
      }

      if (firestoreError.message === "ALREADY_CLAIMED") {
        throw new HttpsError("already-exists", "Esta cuenta ya ha sido activada concurrentemente por otra sesión.");
      }

      if (firestoreError.message === "TARGET_CYCLE_ALREADY_STARTED") {
        throw new HttpsError(
          "failed-precondition",
          "TARGET_CYCLE_ALREADY_STARTED: El ciclo de ingreso asignado ya inició operaciones o no se encuentra en estado de preparación. Contacta al administrador."
        );
      }

      throw new HttpsError(
        "internal",
        "Error al registrar el perfil canónico en base de datos. La operación fue revertida de forma segura."
      );
    }

    // 11. Actualizar claimOperations a COMPLETED
    await claimOpRef.set({
      status: "COMPLETED",
      uid: firebaseAuthUid,
      firebaseAuthUid: firebaseAuthUid,
      canonicalUid: firebaseAuthUid,
      email: canonicalEmail,
      legacyUserDocumentId: legacyDocId,
      legacyOriginalId: legacyDocId,
      orphanedAuthUid: null,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // 12. Auditoría (sin contraseñas ni tokens)
    await db.collection("auditLogs").add({
      action: isRecoveredOrphan ? "USER_CLAIM_ACCOUNT_RECOVERED" : "USER_CLAIM_ACCOUNT",
      legacyOriginalId: legacyDocId,
      canonicalUid: firebaseAuthUid,
      userCode: legacyData.userCode || "",
      email: canonicalEmail,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});

    return {
      success: true,
      message: "Cuenta activada exitosamente.",
      uid: firebaseAuthUid,
      email: canonicalEmail,
    };
  }
);

/**
 * FASE 1B: Cloud Function HTTPS Callable para Generar ActivationToken Seguro.
 * Solo ejecutable por SuperAdministradores autenticados.
 * Genera token criptográfico de alta entropía, almacena únicamente el hash en Firestore
 * y retorna el token en plaintext UNA SOLA VEZ al administrador.
 */
exports.adminGenerateActivationToken = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Se requiere autenticación en Firebase Auth.");
    }

    const authUid = request.auth.uid;
    const authEmail = (request.auth.token && request.auth.token.email) ? request.auth.token.email.toLowerCase() : "";

    const userDocSnap = await db.collection("users").doc(authUid).get();
    let isSuperAdmin = false;

    if (
      authUid === "lpx4NLEEMkeh9EJFcG68oPMVdXF2" ||
      authEmail === "juanes9802@gmail.com" ||
      authEmail === "elcocalombiano1828@gmail.com" ||
      (request.auth.token && (request.auth.token.role === "admin" || request.auth.token.superadmin === true))
    ) {
      isSuperAdmin = true;
    } else if (userDocSnap.exists && userDocSnap.data().role === "ADMIN") {
      isSuperAdmin = true;
    }

    if (!isSuperAdmin) {
      throw new HttpsError(
        "permission-denied",
        "Acceso denegado: Se requieren privilegios de SuperAdmin para generar tokens de activación."
      );
    }

    const { legacyUserDocumentId } = request.data || {};
    if (!legacyUserDocumentId || typeof legacyUserDocumentId !== "string" || !legacyUserDocumentId.trim()) {
      throw new HttpsError("invalid-argument", "legacyUserDocumentId es obligatorio.");
    }

    const userRef = db.collection("users").doc(legacyUserDocumentId.trim());
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      throw new HttpsError("not-found", "Usuario no encontrado.");
    }

    const userData = userSnap.data() || {};
    if (userData.isClaimed === true || userData.status === "MIGRATED" || userData.status === "ACTIVE") {
      throw new HttpsError("failed-precondition", "La cuenta ya ha sido activada y cuenta con identidad canónica.");
    }

    // Generar token criptográfico de alta entropía (32 caracteres hexadecimales)
    const plaintextToken = crypto.randomBytes(16).toString("hex").toUpperCase();
    const tokenHash = crypto.createHash("sha256").update(plaintextToken).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 días de vigencia

    await userRef.update({
      activationTokenHash: tokenHash,
      activationExpiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      claimAttempts: 0,
      claimLockedUntil: null,
      tokenGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
      tokenGeneratedBy: authUid,
    });

    // Auditoría (sin token en plaintext ni hash en logs)
    await db.collection("auditLogs").add({
      action: "ADMIN_GENERATE_ACTIVATION_TOKEN",
      targetUserId: legacyUserDocumentId.trim(),
      userCode: userData.userCode || "",
      adminUid: authUid,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
    }).catch(() => {});

    // Retorna token plaintext UNA SOLA VEZ
    return {
      success: true,
      token: plaintextToken,
      expiresAt: expiresAt.toISOString(),
      userCode: userData.userCode || "",
      fullName: userData.fullName || "",
    };
  }
);

/**
 * ADMIN_APPROVE_APPLICATION_WITH_TOKEN
 *
 * Aprueba una admision de forma autoritativa:
 * - valida capital minimo de Admisiones ($4M)
 * - valida ciclo PREPARING
 * - crea el inversionista como PENDING_CLAIM
 * - genera codigo INV-XXXX en servidor
 * - genera token seguro y almacena solamente su hash
 * - marca la admision APPROVED en la misma transaccion
 *
 * El token plaintext solo se retorna una vez al administrador.
 */
exports.adminApproveInvestorApplicationCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const {
      authUid,
      createdByName,
    } = await verifySuperAdminPrivileges(request);

    const data = request.data || {};

    const applicationId =
      typeof data.applicationId === "string"
        ? data.applicationId.trim()
        : "";

    const targetCycleId =
      typeof data.targetCycleId === "string"
        ? data.targetCycleId.trim()
        : "";

    const finalCapitalCop =
      Math.round(Number(data.finalCapitalCop));

    const cleanPaymentMethod =
      String(data.paymentMethod || "").trim().slice(0, 100);

    const cleanPaymentDetails =
      String(data.paymentDetails || "Cuenta Principal").trim().slice(0, 500);

    if (!applicationId) {
      throw new HttpsError(
        "invalid-argument",
        "APPLICATION_ID_REQUIRED"
      );
    }

    if (
      !Number.isFinite(finalCapitalCop) ||
      finalCapitalCop < 4000000 ||
      finalCapitalCop > Number.MAX_SAFE_INTEGER
    ) {
      throw new HttpsError(
        "invalid-argument",
        "ADMISSION_MINIMUM_CAPITAL: El capital de una admision debe ser igual o superior a $4.000.000 COP."
      );
    }

    if (!targetCycleId) {
      throw new HttpsError(
        "failed-precondition",
        "ADMISSION_TARGET_CYCLE_REQUIRED: No existe un ciclo PREPARING valido para el nuevo inversionista."
      );
    }

    let entryCycleId;

    try {
      entryCycleId =
        await validateTargetCycleForUserEntry({
          db,
          targetCycleId,
        });
    } catch (err) {
      if (err && err.code === "not-found") {
        throw new HttpsError(
          "not-found",
          err.message
        );
      }

      throw new HttpsError(
        "failed-precondition",
        err && err.message
          ? err.message
          : "TARGET_CYCLE_NOT_PREPARING"
      );
    }

    const settingsSnap =
      await db.collection("settings")
        .doc("global_config")
        .get();

    const settingsData =
      settingsSnap.exists
        ? settingsSnap.data() || {}
        : {};

    if (
      settingsData.preparingCycleId !==
      entryCycleId
    ) {
      throw new HttpsError(
        "failed-precondition",
        "TARGET_CYCLE_NOT_AUTHORITATIVE_PREPARING"
      );
    }

    const authoritativeCycleSnap =
      await db.collection("monthlyCycles")
        .doc(entryCycleId)
        .get();

    if (!authoritativeCycleSnap.exists) {
      throw new HttpsError(
        "not-found",
        "TARGET_CYCLE_NOT_FOUND"
      );
    }

    const authoritativeCycle =
      authoritativeCycleSnap.data() || {};

    if (
      authoritativeCycle.status !== "OPEN" ||
      authoritativeCycle.operationalStatus !== "PREPARING" ||
      authoritativeCycle.isStarting === true
    ) {
      throw new HttpsError(
        "failed-precondition",
        "TARGET_CYCLE_NOT_AVAILABLE_FOR_NEW_INVESTOR"
      );
    }

    const appRef =
      db.collection("investorApplications")
        .doc(applicationId);

    const appSnap =
      await appRef.get();

    if (!appSnap.exists) {
      throw new HttpsError(
        "not-found",
        "APPLICATION_NOT_FOUND"
      );
    }

    const appData =
      appSnap.data() || {};

    const isApprovedRecovery =
      appData.status === "APPROVED";

    if (
      appData.status !== "PENDING" &&
      !isApprovedRecovery
    ) {
      throw new HttpsError(
        "failed-precondition",
        "APPLICATION_NOT_PENDING_OR_RECOVERABLE"
      );
    }

    const cleanFullName =
      String(appData.fullName || "").trim();

    const cleanEmail =
      String(appData.email || "")
        .trim()
        .toLowerCase();

    const cleanPhone =
      String(appData.phone || "").trim();

    const cleanDocumentId =
      String(appData.documentId || "").trim();

    const linkedUserId =
      typeof appData.assignedUserId === "string"
        ? appData.assignedUserId.trim()
        : "";

    // Recovery is intentionally restricted to admissions that were
    // already approved by the historical flow and retain both pieces
    // of linkage created by that flow.
    if (
      isApprovedRecovery &&
      (
        !linkedUserId ||
        linkedUserId.includes("/") ||
        typeof appData.assignedUserCode !== "string" ||
        !/^INV-\d+$/i.test(
          appData.assignedUserCode.trim()
        )
      )
    ) {
      throw new HttpsError(
        "failed-precondition",
        "APPROVED_RECOVERY_NOT_ELIGIBLE: La admision aprobada no tiene vinculacion historica valida para recuperacion."
      );
    }

    if (
      isApprovedRecovery &&
      linkedUserId &&
      !linkedUserId.includes("/")
    ) {
      const linkedUserSnap =
        await db.collection("users")
          .doc(linkedUserId)
          .get();

      if (linkedUserSnap.exists) {
        throw new HttpsError(
          "failed-precondition",
          "APPROVED_USER_ALREADY_EXISTS: El perfil del inversionista ya existe. Debe regenerarse su token de activacion, no crear otro usuario."
        );
      }
    }

    if (!cleanFullName) {
      throw new HttpsError(
        "failed-precondition",
        "APPLICATION_NAME_REQUIRED"
      );
    }

    if (
      !cleanEmail ||
      !cleanEmail.includes("@")
    ) {
      throw new HttpsError(
        "failed-precondition",
        "APPLICATION_EMAIL_REQUIRED: La admision debe tener un correo valido antes de aprobarse."
      );
    }

    // No permitir crear otra identidad Auth con el mismo correo.
    try {
      const authUser =
        await admin.auth()
          .getUserByEmail(cleanEmail);

      if (authUser) {
        throw new HttpsError(
          "already-exists",
          "Ya existe una cuenta de Firebase Authentication con este correo."
        );
      }
    } catch (authErr) {
      if (
        authErr &&
        authErr.code !== "auth/user-not-found"
      ) {
        if (authErr instanceof HttpsError) {
          throw authErr;
        }

        throw new HttpsError(
          "internal",
          `AUTH_CHECK_FAILED: ${
            authErr && authErr.message
              ? authErr.message
              : authErr
          }`
        );
      }
    }

    // No permitir otro perfil activo/pendiente con el mismo correo.
    const sameEmailSnap =
      await db.collection("users")
        .where("email", "==", cleanEmail)
        .limit(10)
        .get();

    const conflictingProfile =
      sameEmailSnap.docs.find((docSnap) => {
        const profile =
          docSnap.data() || {};

        return profile.status !== "MIGRATED";
      });

    if (conflictingProfile) {
      throw new HttpsError(
        "already-exists",
        "Ya existe un inversionista activo o pendiente con este correo."
      );
    }

    const category =
      getCanonicalCategoryForCapital(
        finalCapitalCop
      );

    // Conservar la politica que utilizaba el flujo historico
    // de aprobacion de Admisiones.
    const userPercentage =
      category === "NEGRA"
        ? 70
        : 50;

    const adminPercentage =
      100 - userPercentage;

    // El numero sigue usando el contador global atomico,
    // pero las aprobaciones de Admisiones conservan prefijo INV.
    let userCode = "";

    const legacyAssignedCode =
      isApprovedRecovery &&
      typeof appData.assignedUserCode === "string" &&
      /^INV-\d+$/i.test(
        appData.assignedUserCode.trim()
      )
        ? appData.assignedUserCode
            .trim()
            .toUpperCase()
        : "";

    if (legacyAssignedCode) {
      const existingLegacyCodeSnap =
        await db.collection("users")
          .where(
            "userCode",
            "==",
            legacyAssignedCode
          )
          .limit(1)
          .get();

      if (!existingLegacyCodeSnap.empty) {
        throw new HttpsError(
          "already-exists",
          `USER_CODE_ALREADY_EXISTS: El codigo ${legacyAssignedCode} ya pertenece a otro perfil.`
        );
      }

      userCode =
        legacyAssignedCode;
    } else {
      for (
        let attempt = 0;
        attempt < 100;
        attempt += 1
      ) {
        const candidateCode =
          await getNextAtomicUserCode("INV");

        const existingCodeSnap =
          await db.collection("users")
            .where(
              "userCode",
              "==",
              candidateCode
            )
            .limit(1)
            .get();

        if (existingCodeSnap.empty) {
          userCode =
            candidateCode;
          break;
        }
      }

      if (!userCode) {
        throw new HttpsError(
          "internal",
          "USER_CODE_GENERATION_EXHAUSTED"
        );
      }
    }

    const preservedAssignedUserId =
      isApprovedRecovery &&
      linkedUserId &&
      !linkedUserId.includes("/")
        ? linkedUserId
        : "";

    const userRef =
      preservedAssignedUserId
        ? db.collection("users")
            .doc(preservedAssignedUserId)
        : db.collection("users")
            .doc();

    const legacyDocId =
      userRef.id;

    const plaintextToken =
      crypto.randomBytes(16)
        .toString("hex")
        .toUpperCase();

    const tokenHash =
      crypto.createHash("sha256")
        .update(plaintextToken)
        .digest("hex");

    const expiresAt =
      new Date(
        Date.now() +
        7 * 24 * 60 * 60 * 1000
      );

    const nowIso =
      new Date().toISOString();

    const pendingUserDoc = {
      id: legacyDocId,
      uid: null,

      isClaimed: false,
      status: "PENDING_CLAIM",
      role: "USER",

      email: cleanEmail,
      fullName: cleanFullName,
      phone: cleanPhone,
      documentId: cleanDocumentId,

      currentCapital: finalCapitalCop,
      baseCapital: finalCapitalCop,
      currency: "COP",

      userPercentage,
      adminPercentage,
      category,

      paymentMethod:
        cleanPaymentMethod ||
        String(appData.originBank || "").trim() ||
        "Bancolombia",

      paymentDetails:
        cleanPaymentDetails,

      entryCycleId:
        entryCycleId || null,

      entryDate:
        nowIso.split("T")[0],

      userCode,

      source:
        "ADMISSION_APPROVAL",

      sourceApplicationId:
        applicationId,

      activationTokenHash:
        tokenHash,

      activationExpiresAt:
        admin.firestore.Timestamp
          .fromDate(expiresAt),

      claimAttempts: 0,
      claimLockedUntil: null,

      tokenGeneratedAt:
        admin.firestore.FieldValue
          .serverTimestamp(),

      tokenGeneratedBy:
        authUid,

      createdAt:
        admin.firestore.FieldValue
          .serverTimestamp(),

      updatedAt:
        admin.firestore.FieldValue
          .serverTimestamp(),

      createdByUid:
        authUid,
    };

    // User + Application cambian juntos.
    // Si cualquiera falla, no queda una admision aprobada sin usuario.
    await db.runTransaction(
      async (transaction) => {
        const freshAppSnap =
          await transaction.get(
            appRef
          );

        if (!freshAppSnap.exists) {
          throw new HttpsError(
            "not-found",
            "APPLICATION_NOT_FOUND"
          );
        }

        const freshAppData =
          freshAppSnap.data() || {};

        if (
          freshAppData.status !== "PENDING" &&
          freshAppData.status !== "APPROVED"
        ) {
          throw new HttpsError(
            "failed-precondition",
            "APPLICATION_NOT_PENDING_OR_RECOVERABLE"
          );
        }

        const freshUserSnap =
          await transaction.get(
            userRef
          );

        if (freshUserSnap.exists) {
          throw new HttpsError(
            "already-exists",
            "ASSIGNED_USER_ALREADY_EXISTS"
          );
        }

        transaction.set(
          userRef,
          pendingUserDoc
        );

        transaction.update(
          appRef,
          {
            status:
              "APPROVED",

            assignedUserCode:
              userCode,

            assignedUserId:
              legacyDocId,

            resolvedAt:
              nowIso,

            resolvedBy:
              createdByName,

            finalCapitalCop:
              finalCapitalCop,

            category,

            updatedAt:
              admin.firestore
                .FieldValue
                .serverTimestamp(),
          }
        );
      }
    );

    // Auditoria de aprobacion.
    await db.collection("auditLogs")
      .add({
        action:
          "APPLICATION_APPROVED",

        performedBy:
          authUid,

        performedByName:
          createdByName,

        targetEntity:
          applicationId,

        reason:
          `Admision aprobada. Codigo asignado: ${userCode}`,

        details: {
          applicationId,
          userId:
            legacyDocId,
          userCode,
          capital:
            finalCapitalCop,
          category,
          entryCycleId,
        },

        timestamp:
          admin.firestore
            .FieldValue
            .serverTimestamp(),
      })
      .catch(() => {});

    // Auditoria del token. Nunca guardar plaintext ni hash en logs.
    await db.collection("auditLogs")
      .add({
        action:
          "ADMIN_GENERATE_ACTIVATION_TOKEN",

        targetUserId:
          legacyDocId,

        userCode,

        adminUid:
          authUid,

        source:
          "ADMISSION_APPROVAL",

        timestamp:
          admin.firestore
            .FieldValue
            .serverTimestamp(),

        expiresAt:
          admin.firestore.Timestamp
            .fromDate(expiresAt),
      })
      .catch(() => {});

    const responseUser = {
      id:
        legacyDocId,

      uid:
        null,

      isClaimed:
        false,

      status:
        "PENDING_CLAIM",

      role:
        "USER",

      email:
        cleanEmail,

      fullName:
        cleanFullName,

      phone:
        cleanPhone,

      documentId:
        cleanDocumentId,

      currentCapital:
        finalCapitalCop,

      baseCapital:
        finalCapitalCop,

      currency:
        "COP",

      userPercentage,
      adminPercentage,
      category,

      paymentMethod:
        pendingUserDoc.paymentMethod,

      paymentDetails:
        pendingUserDoc.paymentDetails,

      entryCycleId:
        entryCycleId || null,

      entryDate:
        nowIso.split("T")[0],

      userCode,

      createdAt:
        nowIso,

      updatedAt:
        nowIso,
    };

    const responseApplication = {
      id:
        applicationId,

      queuePosition:
        Number(
          appData.queuePosition || 0
        ),

      fullName:
        cleanFullName,

      documentId:
        cleanDocumentId,

      email:
        cleanEmail,

      phone:
        cleanPhone,

      city:
        String(
          appData.city ||
          "Colombia"
        ),

      requestedCapitalCop:
        Number(
          appData.requestedCapitalCop ||
          finalCapitalCop
        ),

      originBank:
        String(
          appData.originBank ||
          ""
        ),

      submissionDate:
        typeof appData.submissionDate ===
        "string"
          ? appData.submissionDate
          : nowIso,

      status:
        "APPROVED",

      source:
        appData.source ||
        "WEB_FORM",

      priorityNotes:
        typeof appData.priorityNotes ===
        "string"
          ? appData.priorityNotes
          : "",

      assignedUserCode:
        userCode,

      assignedUserId:
        legacyDocId,

      resolvedAt:
        nowIso,

      resolvedBy:
        createdByName,
    };

    return {
      success:
        true,

      user:
        responseUser,

      application:
        responseApplication,

      token:
        plaintextToken,

      expiresAt:
        expiresAt.toISOString(),

      message:
        "Admision aprobada y token de activacion generado correctamente.",
    };
  }
);

/**
 * FASE 1B: Cloud Function HTTPS Callable para Postulación de Inversionistas (FIFO).
 * Invocable desde formulario público web sin Firebase Auth.
 * Aplica whitelist estricta, valida rangos y tipos, calcula queuePosition en servidor
 * y fija status='PENDING' y source='WEB_FORM'.
 */
exports.submitApplicationCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const data = request.data || {};

    // 1. Whitelist estricta: Rechazar cualquier campo adicional o no autorizado
    const allowedKeys = [
      "fullName",
      "documentId",
      "email",
      "phone",
      "city",
      "requestedCapitalCop",
      "originBank",
      "priorityNotes",
    ];

    const receivedKeys = Object.keys(data);
    const forbiddenKeys = receivedKeys.filter((k) => !allowedKeys.includes(k));
    if (forbiddenKeys.length > 0) {
      throw new HttpsError(
        "invalid-argument",
        `Parámetros no permitidos en la solicitud: ${forbiddenKeys.join(", ")}`
      );
    }

    // 2. Validaciones estrictas de tipos y longitudes
    const {
      fullName,
      documentId,
      email,
      phone,
      city,
      requestedCapitalCop,
      originBank,
      priorityNotes,
    } = data;

    if (!fullName || typeof fullName !== "string" || fullName.trim().length < 3 || fullName.trim().length > 100) {
      throw new HttpsError("invalid-argument", "El nombre completo debe tener entre 3 y 100 caracteres.");
    }
    if (!documentId || typeof documentId !== "string" || documentId.trim().length < 4 || documentId.trim().length > 30) {
      throw new HttpsError("invalid-argument", "El documento de identidad debe tener entre 4 y 30 caracteres.");
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || typeof email !== "string" || !emailRegex.test(email.trim()) || email.trim().length > 100) {
      throw new HttpsError("invalid-argument", "Por favor ingresa un correo electrónico válido.");
    }
    if (!phone || typeof phone !== "string" || phone.trim().length < 7 || phone.trim().length > 25) {
      throw new HttpsError("invalid-argument", "Por favor ingresa un número de teléfono o WhatsApp válido (7-25 dígitos).");
    }

    const numCapital = Number(requestedCapitalCop);
    if (
      !Number.isFinite(numCapital) ||
      numCapital < 4000000 ||
      numCapital > Number.MAX_SAFE_INTEGER
    ) {
      throw new HttpsError(
        "invalid-argument",
        "El capital solicitado debe ser igual o superior a $4.000.000 COP."
      );
    }

    const cleanCity = city && typeof city === "string" ? city.trim().slice(0, 50) : "Medellín";
    const cleanBank = originBank && typeof originBank === "string" ? originBank.trim().slice(0, 50) : "Bancolombia";
    const cleanNotes = priorityNotes && typeof priorityNotes === "string" ? priorityNotes.trim().slice(0, 500) : "Postulación desde Formulario Web";

    // 3. Asignación atómica de orden FIFO + posición visible dinámica.
    // queuePosition queda como secuencia histórica estable para ordenar.
    // La posición que ve el aspirante se calcula únicamente con los PENDING actuales,
    // por lo que nunca salta de #15 a #63 por aprobaciones/eliminaciones históricas.
    const counterRef = db.collection("counters").doc("investorApplications");
    const appRef = db.collection("investorApplications").doc();

    let assignedQueuePosition = 1;
    let assignedDisplayQueuePosition = 1;

    await db.runTransaction(async (transaction) => {
      const counterSnap = await transaction.get(counterRef);

      const pendingQuery = db
        .collection("investorApplications")
        .where("status", "==", "PENDING");

      const pendingSnap = await transaction.get(pendingQuery);
      assignedDisplayQueuePosition = pendingSnap.size + 1;

      if (counterSnap.exists) {
        const counterData = counterSnap.data() || {};
        assignedQueuePosition = Number(counterData.nextPosition) || 1;
        transaction.update(counterRef, {
          nextPosition: assignedQueuePosition + 1,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        // APPLICATION-05: inicialización segura de la secuencia histórica.
        const maxQuery = db
          .collection("investorApplications")
          .orderBy("queuePosition", "desc")
          .limit(1);

        const maxQuerySnap = await transaction.get(maxQuery);
        let maxExisting = 0;

        if (!maxQuerySnap.empty) {
          maxExisting = Number(maxQuerySnap.docs[0].data().queuePosition) || 0;
        }

        assignedQueuePosition = maxExisting + 1;

        transaction.set(counterRef, {
          nextPosition: assignedQueuePosition + 1,
          initializedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // 4. Creación autoritativa en Firestore dentro de la transacción atómica.
      const applicationDoc = {
        id: appRef.id,
        fullName: fullName.trim(),
        documentId: documentId.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        city: cleanCity,
        requestedCapitalCop: numCapital,
        originBank: cleanBank,
        priorityNotes: cleanNotes,
        status: "PENDING",
        source: "WEB_FORM",
        queuePosition: assignedQueuePosition,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        submissionDate: new Date().toISOString(),
      };

      transaction.set(appRef, applicationDoc);
    });

    return {
      success: true,
      applicationId: appRef.id,
      // Posición real dentro de la cola pendiente en el momento de radicar.
      queuePosition: assignedDisplayQueuePosition,
    };
  }
);

/**
 * HOTFIX ADMINISTRATIVO: Cloud Function Callable para Purga Segura de Usuarios de Prueba.
 * Reutiliza verifySuperAdminPrivileges(request) para verificación autoritativa de SuperAdmin.
 * Implementa Dry Run (Preview), paginación completa de Auth, protección estricta de Admins/SuperAdmins,
 * borrado atómico de subcolecciones/tokens, colecciones vinculadas, claimOperations, dailyOperations y reset de contador.
 */
exports.adminPurgeNonAdminUsers = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    // 1. Reutilizar helper canónico de verificación SuperAdmin
    const { authUid, authEmail } = await verifySuperAdminPrivileges(request);

    const data = request.data || {};
    const dryRun = Boolean(data.dryRun);
    const deleteTestFinancialData = Boolean(data.deleteTestFinancialData);
    const resetUserCounter = Boolean(data.resetUserCounter);
    const confirmation = typeof data.confirmation === "string" ? data.confirmation.trim() : "";

    if (!dryRun) {
      if (confirmation !== "PURGAR USUARIOS DE PRUEBA") {
        throw new HttpsError(
          "invalid-argument",
          "La frase de confirmación no coincide. Se requiere exactamente: PURGAR USUARIOS DE PRUEBA"
        );
      }
    }

    const errors = [];

    // 2. Definir conjuntos de UIDs y Documentos Protegidos (SuperAdmins & Admins)
    const protectedUids = new Set();
    const protectedDocIds = new Set();
    const protectedEmails = new Set(["juanes9802@gmail.com", "elcocalombiano1828@gmail.com"]);

    // Agregar usuario ejecutor y Root SuperAdmin
    protectedUids.add(authUid);
    protectedDocIds.add(authUid);
    protectedUids.add("lpx4NLEEMkeh9EJFcG68oPMVdXF2");
    protectedDocIds.add("lpx4NLEEMkeh9EJFcG68oPMVdXF2");

    // Recorrer paginación completa de Auth para identificar todas las cuentas y claims de Admin
    let nextPageToken;
    do {
      try {
        const listResult = await admin.auth().listUsers(1000, nextPageToken);
        for (const userRecord of listResult.users) {
          const uEmail = (userRecord.email || "").toLowerCase();
          const claims = userRecord.customClaims || {};
          const isProtected =
            protectedUids.has(userRecord.uid) ||
            protectedEmails.has(uEmail) ||
            claims.admin === true ||
            claims.superadmin === true;

          if (isProtected) {
            protectedUids.add(userRecord.uid);
            protectedDocIds.add(userRecord.uid);
          }
        }
        nextPageToken = listResult.pageToken;
      } catch (err) {
        errors.push(`[AuthList] Error al listar usuarios de Firebase Auth: ${err.code || err.message}`);
        break;
      }
    } while (nextPageToken);

    // Recorrer /users para identificar todos los documentos de ADMIN o migración a un ADMIN
    const usersSnap = await db.collection("users").get();
    usersSnap.forEach((doc) => {
      const uData = doc.data() || {};
      const uUid = uData.uid || uData.userUid || doc.id;
      const uEmail = (uData.email || "").toLowerCase();

      if (
        protectedUids.has(doc.id) ||
        protectedUids.has(uUid) ||
        protectedEmails.has(uEmail) ||
        uData.role === "ADMIN" ||
        (uData.migratedToUid && protectedUids.has(uData.migratedToUid))
      ) {
        protectedUids.add(doc.id);
        protectedDocIds.add(doc.id);
        if (uUid) protectedUids.add(uUid);
        if (uData.migratedToUid) protectedUids.add(uData.migratedToUid);
      }
    });

    // 3. Identificar Cuentas de Auth a eliminar (sin tocar protegidos)
    const authUsersToDelete = [];
    nextPageToken = undefined;
    do {
      try {
        const listResult = await admin.auth().listUsers(1000, nextPageToken);
        for (const userRecord of listResult.users) {
          if (!protectedUids.has(userRecord.uid)) {
            authUsersToDelete.push(userRecord.uid);
          }
        }
        nextPageToken = listResult.pageToken;
      } catch (err) {
        break;
      }
    } while (nextPageToken);

    // 4. Identificar Documentos de Firestore (/users) a eliminar
    const firestoreUserDocsToDelete = [];
    const uidsToDeleteSet = new Set(authUsersToDelete);
    const docIdsToDeleteSet = new Set();

    usersSnap.forEach((doc) => {
      const uData = doc.data() || {};
      const uUid = uData.uid || uData.userUid || doc.id;

      if (!protectedDocIds.has(doc.id) && !protectedUids.has(uUid)) {
        firestoreUserDocsToDelete.push({ id: doc.id, uid: uUid, status: uData.status });
        docIdsToDeleteSet.add(doc.id);
        if (uUid) uidsToDeleteSet.add(uUid);
      }
    });

    // 5. Identificar Subcolección /pushTokens para cada usuario a eliminar
    const pushTokenRefsToDelete = [];
    for (const docId of docIdsToDeleteSet) {
      try {
        const tokensSnap = await db.collection("users").doc(docId).collection("pushTokens").get();
        tokensSnap.forEach((tDoc) => {
          pushTokenRefsToDelete.push(tDoc.ref);
        });
      } catch (e) {
        // Ignorar si no existe subcolección
      }
    }

    // 6. Colecciones Relacionadas
    const cycleUserResultsToDelete = [];
    const reinvestmentsToDelete = [];
    const disbursementsToDelete = [];
    const investmentsToDelete = [];
    const claimOperationsToDelete = [];

    // cycleUserResults
    const cycleResSnap = await db.collection("cycleUserResults").get();
    cycleResSnap.forEach((doc) => {
      const d = doc.data() || {};
      if (
        (d.userUid && uidsToDeleteSet.has(d.userUid)) ||
        (d.userId && docIdsToDeleteSet.has(d.userId))
      ) {
        cycleUserResultsToDelete.push(doc.ref);
      }
    });

    // reinvestments
    const reinvSnap = await db.collection("reinvestments").get();
    reinvSnap.forEach((doc) => {
      const d = doc.data() || {};
      if (
        (d.userUid && uidsToDeleteSet.has(d.userUid)) ||
        (d.userId && docIdsToDeleteSet.has(d.userId))
      ) {
        reinvestmentsToDelete.push(doc.ref);
      }
    });

    // disbursements
    const disbSnap = await db.collection("disbursements").get();
    disbSnap.forEach((doc) => {
      const d = doc.data() || {};
      if (
        (d.userUid && uidsToDeleteSet.has(d.userUid)) ||
        (d.userId && docIdsToDeleteSet.has(d.userId))
      ) {
        disbursementsToDelete.push(doc.ref);
      }
    });

    // investments
    const invSnap = await db.collection("investments").get();
    invSnap.forEach((doc) => {
      const d = doc.data() || {};
      if (
        (d.userUid && uidsToDeleteSet.has(d.userUid)) ||
        (d.userId && docIdsToDeleteSet.has(d.userId))
      ) {
        investmentsToDelete.push(doc.ref);
      }
    });

    // notifications
    const notificationsToDelete = [];
    const notificationsToUpdate = [];
    const notifSnap = await db.collection("notifications").get();
    notifSnap.forEach((doc) => {
      const d = doc.data() || {};
      const targetUids = Array.isArray(d.targetUids) ? d.targetUids : [];
      const userUid = d.userUid;

      if (targetUids.length > 0) {
        const remaining = targetUids.filter((id) => !uidsToDeleteSet.has(id));
        if (remaining.length === 0) {
          if (!userUid || uidsToDeleteSet.has(userUid) || !protectedUids.has(userUid)) {
            notificationsToDelete.push(doc.ref);
          } else {
            notificationsToUpdate.push({ ref: doc.ref, remainingTargets: [] });
          }
        } else if (remaining.length < targetUids.length) {
          notificationsToUpdate.push({ ref: doc.ref, remainingTargets: remaining });
        }
      } else if (userUid && uidsToDeleteSet.has(userUid)) {
        notificationsToDelete.push(doc.ref);
      }
    });

    // claimOperations
    const claimOpsSnap = await db.collection("claimOperations").get();
    claimOpsSnap.forEach((doc) => {
      const d = doc.data() || {};
      if (
        (d.canonicalUid && uidsToDeleteSet.has(d.canonicalUid)) ||
        (d.orphanedAuthUid && uidsToDeleteSet.has(d.orphanedAuthUid)) ||
        (d.legacyDocId && docIdsToDeleteSet.has(d.legacyDocId)) ||
        (d.legacyUserDocumentId && docIdsToDeleteSet.has(d.legacyUserDocumentId))
      ) {
        claimOperationsToDelete.push(doc.ref);
      }
    });

    // dailyOperations
    const dailyOperationsToDelete = [];
    const dailyOperationsToUpdate = [];
    const dailyOpsSnap = await db.collection("dailyOperations").get();
    dailyOpsSnap.forEach((doc) => {
      const d = doc.data() || {};
      const authorized = Array.isArray(d.authorizedUids) ? d.authorizedUids : [];
      const dUserUid = d.userUid;

      const remainingAuthorized = authorized.filter((id) => !uidsToDeleteSet.has(id));

      if (deleteTestFinancialData) {
        const isExclusivelyPurged =
          authorized.length > 0 &&
          remainingAuthorized.length === 0 &&
          (!dUserUid || uidsToDeleteSet.has(dUserUid));

        if (isExclusivelyPurged) {
          dailyOperationsToDelete.push(doc.ref);
        } else if (remainingAuthorized.length < authorized.length) {
          dailyOperationsToUpdate.push({ ref: doc.ref, remainingAuthorized });
        }
      } else {
        if (remainingAuthorized.length < authorized.length) {
          dailyOperationsToUpdate.push({ ref: doc.ref, remainingAuthorized });
        }
      }
    });

    // 7. Si es DRY RUN (Preview), retornar de inmediato los números sin modificar datos
    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        authUsersToDelete: authUsersToDelete.length,
        authUsersDeleted: 0,
        firestoreUsersToDelete: firestoreUserDocsToDelete.length,
        firestoreUsersDeleted: 0,
        pushTokensToDelete: pushTokenRefsToDelete.length,
        pushTokensDeleted: 0,
        cycleUserResultsToDelete: cycleUserResultsToDelete.length,
        cycleUserResultsDeleted: 0,
        reinvestmentsToDelete: reinvestmentsToDelete.length,
        reinvestmentsDeleted: 0,
        disbursementsToDelete: disbursementsToDelete.length,
        disbursementsDeleted: 0,
        investmentsToDelete: investmentsToDelete.length,
        investmentsDeleted: 0,
        notificationsToDelete: notificationsToDelete.length,
        notificationsDeleted: 0,
        notificationsUpdated: notificationsToUpdate.length,
        claimOperationsToDelete: claimOperationsToDelete.length,
        claimOperationsDeleted: 0,
        dailyOperationsAffected: dailyOperationsToUpdate.length,
        dailyOperationsDeleted: dailyOperationsToDelete.length,
        userCounterReset: false,
        protectedUsersCount: protectedUids.size,
        errors,
      };
    }

    // 8. EJECUCIÓN REAL DE LA PURGA DESTRUCTIVA
    let authUsersDeleted = 0;
    let firestoreUsersDeleted = 0;
    let pushTokensDeleted = 0;
    let cycleUserResultsDeleted = 0;
    let reinvestmentsDeleted = 0;
    let disbursementsDeleted = 0;
    let investmentsDeleted = 0;
    let notificationsDeleted = 0;
    let notificationsUpdated = 0;
    let claimOperationsDeleted = 0;
    let dailyOperationsDeleted = 0;
    let dailyOperationsUpdated = 0;

    // A. Eliminar usuarios de Firebase Auth
    for (const uid of authUsersToDelete) {
      try {
        await admin.auth().deleteUser(uid);
        authUsersDeleted++;
      } catch (err) {
        if (err.code === "auth/user-not-found") {
          authUsersDeleted++; // Idempotente
        } else {
          errors.push(`[Auth] Error borrando UID ${uid}: ${err.code || err.message}`);
        }
      }
    }

    // B. Procesamiento en Lote (Batches de máximo 400 escrituras)
    let batch = db.batch();
    let batchCount = 0;

    const commitBatchIfNeeded = async () => {
      if (batchCount >= 400) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    };

    // Subcolección pushTokens
    for (const ref of pushTokenRefsToDelete) {
      batch.delete(ref);
      batchCount++;
      pushTokensDeleted++;
      await commitBatchIfNeeded();
    }

    // Documentos /users
    for (const item of firestoreUserDocsToDelete) {
      batch.delete(db.collection("users").doc(item.id));
      batchCount++;
      firestoreUsersDeleted++;
      await commitBatchIfNeeded();
    }

    // cycleUserResults
    for (const ref of cycleUserResultsToDelete) {
      batch.delete(ref);
      batchCount++;
      cycleUserResultsDeleted++;
      await commitBatchIfNeeded();
    }

    // reinvestments
    for (const ref of reinvestmentsToDelete) {
      batch.delete(ref);
      batchCount++;
      reinvestmentsDeleted++;
      await commitBatchIfNeeded();
    }

    // disbursements
    for (const ref of disbursementsToDelete) {
      batch.delete(ref);
      batchCount++;
      disbursementsDeleted++;
      await commitBatchIfNeeded();
    }

    // investments
    for (const ref of investmentsToDelete) {
      batch.delete(ref);
      batchCount++;
      investmentsDeleted++;
      await commitBatchIfNeeded();
    }

    // notifications
    for (const ref of notificationsToDelete) {
      batch.delete(ref);
      batchCount++;
      notificationsDeleted++;
      await commitBatchIfNeeded();
    }
    for (const item of notificationsToUpdate) {
      batch.update(item.ref, { targetUids: item.remainingTargets });
      batchCount++;
      notificationsUpdated++;
      await commitBatchIfNeeded();
    }

    // claimOperations
    for (const ref of claimOperationsToDelete) {
      batch.delete(ref);
      batchCount++;
      claimOperationsDeleted++;
      await commitBatchIfNeeded();
    }

    // dailyOperations
    for (const ref of dailyOperationsToDelete) {
      batch.delete(ref);
      batchCount++;
      dailyOperationsDeleted++;
      await commitBatchIfNeeded();
    }
    for (const item of dailyOperationsToUpdate) {
      batch.update(item.ref, { authorizedUids: item.remainingAuthorized });
      batchCount++;
      dailyOperationsUpdated++;
      await commitBatchIfNeeded();
    }

    // Flush batch final
    if (batchCount > 0) {
      await batch.commit();
    }

    // C. Resetear contador de usuarios en /counters/users si aplica
    let userCounterWasReset = false;
    if (resetUserCounter) {
      try {
        const remainingUsersSnap = await db.collection("users").where("role", "!=", "ADMIN").get();
        if (remainingUsersSnap.empty) {
          await db.collection("counters").doc("users").set({
            nextCodeNumber: 1001,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            resetAt: admin.firestore.FieldValue.serverTimestamp(),
            resetBy: authUid,
          });
          userCounterWasReset = true;
        } else {
          errors.push("[CounterReset] No se reseteó el contador porque aún existen usuarios normales en /users.");
        }
      } catch (e) {
        errors.push(`[CounterReset] Error al resetear contador: ${e.message}`);
      }
    }

    // Auditoría
    await db.collection("auditLogs").add({
      action: "ADMIN_PURGE_NON_ADMIN_USERS",
      adminUid: authUid,
      authUsersDeleted,
      firestoreUsersDeleted,
      deleteTestFinancialData,
      resetUserCounter,
      userCounterWasReset,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});

    return {
      success: true,
      dryRun: false,
      authUsersToDelete: authUsersToDelete.length,
      authUsersDeleted,
      firestoreUsersToDelete: firestoreUserDocsToDelete.length,
      firestoreUsersDeleted,
      pushTokensToDelete: pushTokenRefsToDelete.length,
      pushTokensDeleted,
      cycleUserResultsToDelete: cycleUserResultsToDelete.length,
      cycleUserResultsDeleted,
      reinvestmentsToDelete: reinvestmentsToDelete.length,
      reinvestmentsDeleted,
      disbursementsToDelete: disbursementsToDelete.length,
      disbursementsDeleted,
      investmentsToDelete: investmentsToDelete.length,
      investmentsDeleted,
      notificationsToDelete: notificationsToDelete.length,
      notificationsDeleted,
      notificationsUpdated,
      claimOperationsToDelete: claimOperationsToDelete.length,
      claimOperationsDeleted,
      dailyOperationsAffected: dailyOperationsToUpdate.length,
      dailyOperationsDeleted,
      userCounterReset: userCounterWasReset,
      protectedUsersCount: protectedUids.size,
      errors,
    };
  }
);

/**
 * Helper de autorización estricta exclusivo para herramientas de diagnóstico y nivel SuperAdmin.
 * Garantiza que usuarios con rol ADMIN estándar o USER reciban 'permission-denied'.
 */
function verifyStrictSuperAdminPrivileges(request) {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "El usuario debe estar autenticado en Firebase Auth para probar notificaciones push."
    );
  }

  const authUid = request.auth.uid;
  const authEmail = (request.auth.token && request.auth.token.email) ? request.auth.token.email.toLowerCase() : "";

  const isSuperAdmin =
    authUid === "lpx4NLEEMkeh9EJFcG68oPMVdXF2" ||
    authEmail === "juanes9802@gmail.com" ||
    authEmail === "elcocalombiano1828@gmail.com" ||
    (request.auth.token && request.auth.token.superadmin === true);

  if (!isSuperAdmin) {
    throw new HttpsError(
      "permission-denied",
      "Acceso denegado: Se requieren privilegios estrictos de SuperAdmin."
    );
  }

  return { authUid, authEmail };
}

/**
 * Cloud Function HTTPS Callable v2: Herramienta de diagnóstico SuperAdmin
 * para enviar un Push FCM directo (modo notification o data-only) y aislar el delivery de background.
 */
exports.adminSendTestPush = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    // 1. Verificar Autenticación y Privilegios Estrictos de Servidor (Exclusivo SuperAdmin)
    verifyStrictSuperAdminPrivileges(request);

    const data = request.data || {};
    const { targetUid, mode = "notification" } = data;

    if (!targetUid || typeof targetUid !== "string") {
      throw new HttpsError(
        "invalid-argument",
        "El parámetro 'targetUid' es obligatorio."
      );
    }

    // 2. Obtener tokens de /users/{targetUid}/pushTokens/*
    const tokensSnap = await db.collection("users").doc(targetUid).collection("pushTokens").get();
    const tokensList = tokensSnap.docs
      .map((doc) => ({ id: doc.id, token: doc.data().token }))
      .filter((item) => !!item.token && typeof item.token === "string");

    if (tokensList.length === 0) {
      console.log(`[PUSH TEST] targetUid=${targetUid}, mode=${mode}, tokenCount=0, successCount=0, failureCount=0, errorCodes=[]`);
      return {
        success: true,
        tokenCount: 0,
        successCount: 0,
        failureCount: 0,
        errorCodes: [],
        message: "No se encontraron dispositivos activos registrados para este usuario.",
      };
    }

    const tokensArray = tokensList.map((t) => t.token);

    // 3. Construir Payload FCM según modo (notification vs data-only)
    let messagePayload;

    if (mode === "data") {
      messagePayload = buildWebPushDataMessage(tokensArray, {
        title: "Prueba Push Data",
        body: "El Service Worker recibió FCM en background.",
        type: "PUSH_TEST_DATA",
        notifId: `test_${Date.now()}`,
        tag: "push_test_data",
        url: "/",
      });
    } else {
      messagePayload = {
        tokens: tokensArray,
        notification: {
          title: "Prueba Push",
          body: "FCM notification background funcionando.",
        },
        data: {
          type: "PUSH_TEST",
          url: "/",
        },
        webpush: {
          headers: {
            Urgency: "high",
          },
          notification: {
            title: "Prueba Push",
            body: "FCM notification background funcionando.",
            icon: "/favicon.png",
            badge: "/apple-touch-icon.png",
            tag: "push_test_notification",
          },
          fcmOptions: {
            link: "/",
          },
        },
      };
    }

    // 4. Despachar multicast vía admin.messaging()
    const response = await admin.messaging().sendEachForMulticast(messagePayload);
    const successCount = response.successCount;
    const failureCount = response.failureCount;
    const errorCodes = [];
    const tokensToDelete = [];

    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const errCode = resp.error ? resp.error.code : "unknown";
        errorCodes.push(errCode);
        if (
          errCode === "messaging/registration-token-not-registered" ||
          errCode === "messaging/invalid-registration-token"
        ) {
          tokensToDelete.push(tokensList[idx].id);
        }
      }
    });

    // 5. Eliminar tokens inváldos únicamente
    if (tokensToDelete.length > 0) {
      const batch = db.batch();
      tokensToDelete.forEach((docId) => {
        batch.delete(db.collection("users").doc(targetUid).collection("pushTokens").doc(docId));
      });
      await batch.commit().catch((e) => console.warn("[PUSH TEST] Error eliminando tokens obsoletos:", e));
    }

    console.log(
      `[PUSH TEST] targetUid=${targetUid}, mode=${mode}, tokenCount=${tokensArray.length}, successCount=${successCount}, failureCount=${failureCount}, errorCodes=${JSON.stringify(errorCodes)}`
    );

    return {
      success: true,
      tokenCount: tokensArray.length,
      successCount,
      failureCount,
      errorCodes,
    };
  }
);

/**
 * Cloud Function HTTPS Callable: Purga Segura de Datos de Prueba del Ciclo Activo de Trading.
 * Alcance Único Permitido: TEST_CLEANUP_ACTIVE_CYCLE
 * - Requiere autenticación y privilegios autoritativos de SuperAdmin.
 * - Protege ciclos cerrados: Rechaza terminantemente si cycle.status indica CLOSED, CLOSED_MONTH o FINALIZED.
 * - Protege inversionistas activos: Si activeInvestorCount > 0, aborta la ejecución real.
 * - Exige frase exacta de confirmación en ejecución real: "LIMPIAR BITÁCORAS DE PRUEBA".
 * - Elimina exclusivamente del targetActiveCycleId:
 *   1. dailyOperations where cycleId == targetActiveCycleId
 *   2. cycleGroupCalculations asociadas al ciclo
 *   3. cycleUserResults asociadas al ciclo
 *   4. tradingNotifications identificadas inequívocamente como derivadas de esas operaciones.
 * - monthlyCycles: Resetea SOLO campos agregados y contadores derivados de trades; jamás reabre ciclos cerrados.
 * - 100% Idempotente.
 * - Registra Audit Log con acción TRADING_TEST_DATA_PURGE.
 */
exports.adminPurgeTradingTestData = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    // 1. Verificar Autenticación y Privilegios Estrictos de SuperAdmin
    const { authUid, authEmail } = await verifySuperAdminPrivileges(request);

    const data = request.data || {};
    const dryRun = Boolean(data.dryRun);
    const confirmation = typeof data.confirmation === "string" ? data.confirmation.trim() : "";

    // 2. Determinar Ciclo Activo Objetivo (TEST_CLEANUP_ACTIVE_CYCLE)
    const configSnap = await db.collection("settings").doc("global_config").get();
    const configData = configSnap.exists ? configSnap.data() || {} : {};
    const activeCycleIdFromConfig = configData.activeCycleId || null;

    let targetCycleId = (typeof data.cycleId === "string" && data.cycleId.trim())
      ? data.cycleId.trim()
      : (activeCycleIdFromConfig || "2026-09");

    const cycleDocRef = db.collection("monthlyCycles").doc(targetCycleId);
    const cycleSnap = await cycleDocRef.get();

    if (!cycleSnap.exists) {
      throw new HttpsError(
        "not-found",
        `El ciclo operativo especificado (${targetCycleId}) no existe en monthlyCycles.`
      );
    }

    const cycleData = cycleSnap.data() || {};
    const cycleStatus = String(cycleData.status || "UNKNOWN").toUpperCase();

    // 3. Protección de Ciclos Cerrados (Sección 7)
    const closedStatuses = ["CLOSED", "CLOSED_MONTH", "FINALIZED"];
    if (closedStatuses.includes(cycleStatus)) {
      throw new HttpsError(
        "failed-precondition",
        `El ciclo (${targetCycleId}) está cerrado (${cycleStatus}). Está estrictamente prohibido alterar o purgar datos de ciclos históricos cerrados.`
      );
    }

    // 4. Protección por Usuarios Activos (Sección 8)
    const activeUsersSnap = await db.collection("users")
      .where("status", "==", "ACTIVE")
      .get();

    let activeInvestorCount = 0;
    activeUsersSnap.forEach((doc) => {
      const u = doc.data() || {};
      const uEmail = (u.email || "").toLowerCase().trim();
      const isSuperAdminEmail =
        uEmail === "elcocalombiano1828@gmail.com" ||
        uEmail === "juanes9802@gmail.com";
      const isSuperAdminUid =
        doc.id === "lpx4NLEEMkeh9EJFcG68oPMVdXF2" ||
        u.uid === "lpx4NLEEMkeh9EJFcG68oPMVdXF2";

      if (u.role !== "ADMIN" && !isSuperAdminEmail && !isSuperAdminUid && !u.userCode?.startsWith("ADM")) {
        activeInvestorCount++;
      }
    });

    // En ejecución real (no dryRun), abortar si hay inversionistas activos o falta confirmación
    if (!dryRun) {
      if (activeInvestorCount > 0) {
        throw new HttpsError(
          "failed-precondition",
          "No se puede limpiar el ciclo de prueba mientras existan inversionistas activos."
        );
      }

      if (confirmation !== "LIMPIAR BITÁCORAS DE PRUEBA") {
        throw new HttpsError(
          "invalid-argument",
          "La frase de confirmación no coincide. Se requiere exactamente: LIMPIAR BITÁCORAS DE PRUEBA"
        );
      }
    }

    // 5. Localizar Documentos Exclusivos del Ciclo Objetivo
    // A. dailyOperations (Sección 10)
    const opsSnap = await db.collection("dailyOperations")
      .where("cycleId", "==", targetCycleId)
      .get();
    const opsDocs = opsSnap.docs;
    const operationIds = new Set(opsDocs.map((d) => d.id));

    // B. cycleGroupCalculations (Sección 11)
    const groupCalcsSnap = await db.collection("cycleGroupCalculations")
      .where("cycleId", "==", targetCycleId)
      .get();
    const groupCalcDocIds = new Set(groupCalcsSnap.docs.map((d) => d.id));
    const groupCalcsToDeleteRefs = [...groupCalcsSnap.docs.map((d) => d.ref)];

    const allGroupCalcsSnap = await db.collection("cycleGroupCalculations").get();
    allGroupCalcsSnap.forEach((doc) => {
      if (doc.id.startsWith(targetCycleId + "_") && !groupCalcDocIds.has(doc.id)) {
        groupCalcsToDeleteRefs.push(doc.ref);
        groupCalcDocIds.add(doc.id);
      }
    });

    // C. cycleUserResults (Sección 12)
    const userResultsSnap = await db.collection("cycleUserResults")
      .where("cycleId", "==", targetCycleId)
      .get();
    const userResultsToDeleteRefs = userResultsSnap.docs.map((d) => d.ref);

    // D. notifications derivadas de esas operaciones (Sección 13)
    const notifsSnap = await db.collection("notifications").get();
    const notifsToDeleteRefs = [];
    notifsSnap.forEach((doc) => {
      const d = doc.data() || {};
      const notifId = doc.id;
      const isDirectOp = d.payload && d.payload.operationId && operationIds.has(d.payload.operationId);
      const isDirectOpField = d.operationId && operationIds.has(d.operationId);
      const isPrefixDeterministic = Array.from(operationIds).some((opId) =>
        notifId.startsWith(`notif_op_${opId}_`)
      );
      const isCycleDailyNotif =
        d.cycleId === targetCycleId &&
        (d.type === "DAILY_OPERATION" || (d.type === "SYSTEM" && String(d.title || "").includes("Operación Diaria")));

      if (isDirectOp || isDirectOpField || isPrefixDeterministic || isCycleDailyNotif) {
        notifsToDeleteRefs.push(doc.ref);
      }
    });

    const totalDocuments =
      opsDocs.length +
      groupCalcsToDeleteRefs.length +
      userResultsToDeleteRefs.length +
      notifsToDeleteRefs.length;

    // 6. Retorno de Dry Run (Sección 9)
    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        scope: "TEST_CLEANUP_ACTIVE_CYCLE",
        cycleId: targetCycleId,
        cycleStatus,
        activeInvestorCount,
        dailyOperations: opsDocs.length,
        cycleGroupCalculations: groupCalcsToDeleteRefs.length,
        cycleUserResults: userResultsToDeleteRefs.length,
        tradingNotifications: notifsToDeleteRefs.length,
        totalDocuments,
        message: activeInvestorCount > 0
          ? `Previsualización: Se encontraron ${totalDocuments} documentos para purgar. ATENCIÓN: La ejecución real está bloqueada porque hay ${activeInvestorCount} inversionista(s) activo(s).`
          : `Previsualización lista: ${totalDocuments} documentos detectados para limpieza segura.`,
      };
    }

    // 7. Ejecución Real por Lotes Atómicos (Chunking hasta 400 operaciones por batch)
    let batch = db.batch();
    let batchCount = 0;

    const commitBatchIfNeeded = async () => {
      if (batchCount >= 400) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    };

    // Eliminar dailyOperations
    for (const doc of opsDocs) {
      batch.delete(doc.ref);
      batchCount++;
      await commitBatchIfNeeded();
    }

    // Eliminar cycleGroupCalculations
    for (const ref of groupCalcsToDeleteRefs) {
      batch.delete(ref);
      batchCount++;
      await commitBatchIfNeeded();
    }

    // Eliminar cycleUserResults
    for (const ref of userResultsToDeleteRefs) {
      batch.delete(ref);
      batchCount++;
      await commitBatchIfNeeded();
    }

    // Eliminar trading notifications
    for (const ref of notifsToDeleteRefs) {
      batch.delete(ref);
      batchCount++;
      await commitBatchIfNeeded();
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    // 8. Resetear campos derivados de monthlyCycles (Sección 14)
    await cycleDocRef.update({
      totalGroupsCount: 0,
      calculatedGroupsCount: 0,
      calculatedUsersCount: 0,
      totalGrossUsd: 0,
      totalGrossCop: 0,
      totalUsersProfitCop: 0,
      totalAdminCommissionCop: 0,
      notificationsSent: false,
      notificationsSentAt: null,
    });

    const summaryRef = db.collection("cycleFinancialSummaries").doc(targetCycleId);
    const summarySnap = await summaryRef.get();
    if (summarySnap.exists) {
      await summaryRef.update({
        totalGroupsCount: 0,
        calculatedGroupsCount: 0,
        calculatedUsersCount: 0,
        totalGrossUsd: 0,
        totalGrossCop: 0,
        totalUsersProfitCop: 0,
        totalAdminCommissionCop: 0,
      }).catch(() => {});
    }

    // 9. Registrar Audit Log Inmutable (Sección 18)
    const deletedCounts = {
      dailyOperations: opsDocs.length,
      cycleGroupCalculations: groupCalcsToDeleteRefs.length,
      cycleUserResults: userResultsToDeleteRefs.length,
      tradingNotifications: notifsToDeleteRefs.length,
      totalDocuments,
    };

    await db.collection("auditLogs").add({
      action: "TRADING_TEST_DATA_PURGE",
      adminUid: authUid,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      cycleId: targetCycleId,
      scope: "TEST_CLEANUP_ACTIVE_CYCLE",
      deletedCounts,
    }).catch(() => {});

    return {
      success: true,
      dryRun: false,
      scope: "TEST_CLEANUP_ACTIVE_CYCLE",
      cycleId: targetCycleId,
      cycleStatus,
      activeInvestorCount,
      dailyOperations: opsDocs.length,
      cycleGroupCalculations: groupCalcsToDeleteRefs.length,
      cycleUserResults: userResultsToDeleteRefs.length,
      tradingNotifications: notifsToDeleteRefs.length,
      totalDocuments,
      deletedCounts,
      message: `Limpieza de bitácoras de prueba completada exitosamente. Se eliminaron ${totalDocuments} documentos del ciclo ${targetCycleId}.`,
    };
  }
);

/**
 * Helper de categorización de bitácora
 */
function getCategoryForCapitalLocal(capital) {
  const cap = Number(capital) || 0;

  if (cap >= 60000000) return 'NEGRA';
  if (cap >= 10000000) return 'VERDE';

  return 'AZUL';
}

function getNextCycleId(cycleId) {
  if (!cycleId || typeof cycleId !== "string") return "2026-10";
  const parts = cycleId.split("-");
  if (parts.length === 2) {
    let year = parseInt(parts[0], 10);
    let month = parseInt(parts[1], 10);
    if (!isNaN(year) && !isNaN(month)) {
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
      return `${year}-${String(month).padStart(2, "0")}`;
    }
  }
  return `${cycleId}-NEXT`;
}

function getPreviousCycleId(cycleId) {
  if (!cycleId || typeof cycleId !== "string") return "2026-08";
  const parts = cycleId.split("-");
  if (parts.length === 2) {
    let year = parseInt(parts[0], 10);
    let month = parseInt(parts[1], 10);
    if (!isNaN(year) && !isNaN(month)) {
      month -= 1;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
      return `${year}-${String(month).padStart(2, "0")}`;
    }
  }
  return `${cycleId}-PREV`;
}

function getCycleMonthName(cycleId) {
  if (!cycleId || typeof cycleId !== "string") return "Ciclo Operativo";
  const parts = cycleId.split("-");
  if (parts.length === 2) {
    const year = parts[0];
    const monthNum = parseInt(parts[1], 10);
    const months = [
      "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ];
    if (monthNum >= 1 && monthNum <= 12) {
      return `${months[monthNum - 1]} ${year}`;
    }
  }
  return `Ciclo ${cycleId}`;
}

/**
 * Cloud Function HTTPS Callable: Radicación de Solicitud de Reinversión / Inyección de Capital
 * Exclusiva para usuarios activos (USER).
 * ARQUITECTURA TRANSACCIONAL ATÓMICA:
 * - Clave canónica determinística de documento: reinvestments/{sourceCycleId}_{authUid}
 * - Ejecutada dentro de db.runTransaction(...) para exclusión mutua absoluta ante concurrencia.
 * - Una única solicitud financiera válida por usuario y ciclo (PENDING, APPROVED, APPLIED bloquean nueva solicitud).
 * - Permite radicar nueva solicitud únicamente tras REJECTED, preservando historial de rechazos.
 * - Semántica canónica legacy preservada: reinvestAmountCop = profitAppliedCop (ganancia reinvertida).
 */
exports.submitReinvestmentRequestCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    // 1. Validar autenticación de Firebase Auth
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesión para radicar una solicitud de reinversión o inyección."
      );
    }

    const authUid = request.auth.uid;
    const {
      modality,
      sourceCycleId,
      selectedReinvestmentCop,
      desiredCapitalIncreaseCop,
      clientRequestId,
    } = request.data || {};

    if (!sourceCycleId || typeof sourceCycleId !== "string" || !sourceCycleId.trim()) {
      throw new HttpsError("invalid-argument", "El parámetro sourceCycleId es obligatorio.");
    }

    if (modality !== "PROFIT_REINVESTMENT" && modality !== "CAPITAL_INJECTION") {
      throw new HttpsError(
        "invalid-argument",
        "Modalidad no válida. Debe ser PROFIT_REINVESTMENT o CAPITAL_INJECTION."
      );
    }

    const deterministicDocId = `${sourceCycleId.trim()}_${authUid}`;
    const reinvDocRef = db.collection("reinvestments").doc(deterministicDocId);
    const userDocRef = db.collection("users").doc(authUid);
    const cycleDocRef = db.collection("monthlyCycles").doc(sourceCycleId.trim());
    const userResDocRef = db.collection("cycleUserResults").doc(`${sourceCycleId.trim()}_${authUid}`);

    const nowIso = new Date().toISOString();

    // 2. EJECUCIÓN TRANSACCIONAL ATÓMICA EN SERVIDOR
    const txResult = await db.runTransaction(async (transaction) => {
      // === FASE DE LECTURAS (READ PHASE) ===

      // A. Perfil de inversionista autoritativo
      const userDocSnap = await transaction.get(userDocRef);
      if (!userDocSnap.exists) {
        throw new HttpsError("not-found", "Perfil de inversionista no encontrado en Firestore.");
      }
      const userData = userDocSnap.data();
      if (!isTradingParticipantProfile(userData)) {
        throw new HttpsError(
          "permission-denied",
          "La cuenta no est? habilitada como participante financiero."
        );
      }
      if (userData.status !== "ACTIVE") {
        throw new HttpsError("failed-precondition", "Tu cuenta debe estar activa para radicar solicitudes.");
      }
      const currentCapitalSnapshotCop = Number(userData.currentCapital) || 0;
      if (currentCapitalSnapshotCop < 0) {
        throw new HttpsError("failed-precondition", "Capital actual registrado inválido.");
      }

      // B. Ciclo de origen autoritativo (Validación estricta de elegibilidad, sucesor enlazado y Lock de Cierre)
      const cycleDocSnap = await transaction.get(cycleDocRef);
      if (!cycleDocSnap.exists) {
        throw new HttpsError("not-found", `El ciclo especificado (${sourceCycleId}) no existe.`);
      }
      const cycleData = cycleDocSnap.data() || {};
      if (cycleData.status === "CLOSED" || cycleData.isClosing === true) {
        throw new HttpsError(
          "failed-precondition",
          "El ciclo se encuentra en proceso de cierre. Ya no se admiten nuevas solicitudes para este periodo."
        );
      }
      if (cycleData.status !== "OPEN" && cycleData.status !== "REOPENED") {
        throw new HttpsError(
          "failed-precondition",
          `El ciclo (${sourceCycleId}) no se encuentra abierto/activo para solicitudes (estado actual: ${cycleData.status || "DESCONOCIDO"}). Solo ciclos con estado OPEN o REOPENED admiten nuevas radicaciones.`
        );
      }
      if (cycleData.operationalStatus !== "STARTED") {
        throw new HttpsError(
          "failed-precondition",
          `SOURCE_NOT_STARTED: El ciclo origen ${sourceCycleId} debe estar en estado operativo STARTED para recibir solicitudes de reinversión (estado operativo actual: ${cycleData.operationalStatus || "UNDEFINED"}).`
        );
      }
      if (!cycleData.nextCycleId || typeof cycleData.nextCycleId !== "string" || !cycleData.nextCycleId.trim()) {
        throw new HttpsError(
          "failed-precondition",
          `NO_SUCCESSOR_CYCLE: El ciclo origen ${sourceCycleId} no cuenta con un ciclo sucesor enlazado para recibir la solicitud.`
        );
      }

      // C. Verificar ciclo objetivo B (sucesores)
      const targetCycleId = cycleData.nextCycleId.trim();
      const targetCycleRef = db.collection("monthlyCycles").doc(targetCycleId);
      const targetCycleSnap = await transaction.get(targetCycleRef);
      if (!targetCycleSnap.exists) {
        throw new HttpsError(
          "not-found",
          `TARGET_CYCLE_NOT_FOUND: El ciclo sucesor enlazado (${targetCycleId}) no existe en la base de datos.`
        );
      }
      const targetCycleData = targetCycleSnap.data() || {};
      if (targetCycleData.status !== "OPEN") {
        throw new HttpsError(
          "failed-precondition",
          `TARGET_CYCLE_NOT_OPEN: El ciclo sucesor (${targetCycleId}) no se encuentra abierto (estado actual: ${targetCycleData.status || "UNKNOWN"}).`
        );
      }
      if (targetCycleData.operationalStatus !== "PREPARING") {
        throw new HttpsError(
          "failed-precondition",
          `TARGET_CYCLE_NOT_PREPARING: El ciclo sucesor (${targetCycleId}) debe estar en estado operativo PREPARING (estado actual: ${targetCycleData.operationalStatus || "UNKNOWN"}).`
        );
      }
      if (targetCycleData.previousCycleId !== sourceCycleId.trim()) {
        throw new HttpsError(
          "failed-precondition",
          `CYCLE_LINKAGE_MISMATCH: Incoherencia en el enlace de ciclos: El ciclo sucesor (${targetCycleId}) no tiene a ${sourceCycleId} como ciclo previo.`
        );
      }

      // Check settings/global_config pointer
      const globalConfigSnap = await transaction.get(db.collection("settings").doc("global_config"));
      if (globalConfigSnap.exists) {
        const globalData = globalConfigSnap.data() || {};
        if (globalData.preparingCycleId && globalData.preparingCycleId !== targetCycleId) {
          throw new HttpsError(
            "failed-precondition",
            `CYCLE_POINTER_MISMATCH: El ciclo en preparación registrado en global_config (${globalData.preparingCycleId}) no coincide con el ciclo sucesor enlazado (${targetCycleId}).`
          );
        }
      }

      // D. Ganancia de ciclo desde cycleUserResults canónico y validación de capital congelado autoritativo
      const userResDocSnap = await transaction.get(userResDocRef);
      if (!userResDocSnap.exists) {
        throw new HttpsError(
          "failed-precondition",
          `CYCLE_RESULT_NOT_FOUND: No se encontró el registro contable de liquidación para el ciclo ${sourceCycleId}. No es posible radicar solicitudes antes de calcular el resultado.`
        );
      }

      const resData = userResDocSnap.data() || {};
      const cycleProfitSnapshotCop = Number(resData.userProfitCop) || 0;
      const cycleCapitalCop = Number(resData.cycleCapitalCop || 0);

      if (currentCapitalSnapshotCop !== cycleCapitalCop) {
        throw new HttpsError(
          "failed-precondition",
          `CAPITAL_BASE_SNAPSHOT_MISMATCH: El capital actual registrado ($${currentCapitalSnapshotCop.toLocaleString("es-CO")}) no coincide con el capital base congelado del ciclo ($${cycleCapitalCop.toLocaleString("es-CO")}).`
        );
      }

      // E. Documento canónico determinístico de reinversión para este usuario y ciclo
      const existingReinvSnap = await transaction.get(reinvDocRef);
      let previousRejectionHistory = [];
      let requestVersion = 1;

      if (existingReinvSnap.exists) {
        const existingData = existingReinvSnap.data() || {};

        // Si el clientRequestId coincide, retornar idempotentemente la solicitud existente
        if (clientRequestId && existingData.clientRequestId === clientRequestId) {
          return {
            idempotentReplay: true,
            reinvestment: existingData,
            message: "Solicitud ya radicada previamente con este identificador (idempotente).",
            requestVersion: Number(existingData.requestVersion || 1),
          };
        }

        // Bloqueo de múltiples solicitudes pendientes o aprobadas
        if (existingData.status === "PENDING") {
          throw new HttpsError(
            "already-exists",
            `Ya tienes una solicitud PENDIENTE para el ciclo ${sourceCycleId}. Espera la resolución del administrador antes de radicar otra.`
          );
        }
        if (existingData.status === "APPROVED") {
          throw new HttpsError(
            "failed-precondition",
            `Ya tienes una solicitud APROBADA para el ciclo ${sourceCycleId}. No es posible radicar una nueva solicitud.`
          );
        }
        if (existingData.status === "APPLIED" || existingData.appliedAtCycleClosure === true) {
          throw new HttpsError(
            "failed-precondition",
            `Tu solicitud para el ciclo ${sourceCycleId} ya fue aplicada en el cierre. No se puede duplicar.`
          );
        }

        // Si el estado es REJECTED o NEEDS_REVIEW: se permite presentar una nueva solicitud reutilizando la ranura canónica
        // y preservando la trazabilidad completa en el historial, incrementando requestVersion.
        if (existingData.status === "REJECTED" || existingData.status === "NEEDS_REVIEW") {
          const previousVersion = Number(existingData.requestVersion || 1);
          requestVersion = previousVersion + 1;
          previousRejectionHistory = Array.isArray(existingData.rejectionHistory)
            ? [...existingData.rejectionHistory]
            : [];
          previousRejectionHistory.push({
            rejectedAt: existingData.resolvedAt || existingData.createdAt || nowIso,
            rejectedBy: existingData.resolvedBy || "ADMIN",
            rejectedByUid: existingData.resolvedByUid || null,
            rejectionReason: existingData.rejectionReason || (existingData.status === "NEEDS_REVIEW" ? "Devuelta para corrección" : "No especificado"),
            reason: existingData.rejectionReason || (existingData.status === "NEEDS_REVIEW" ? "Devuelta para corrección" : "No especificado"),
            previousRequestVersion: previousVersion,
            previousStatus: existingData.status,
            previousModality: existingData.modality,
            previousCurrentCapitalSnapshotCop: existingData.currentCapitalSnapshotCop || 0,
            previousCycleProfitSnapshotCop: existingData.cycleProfitSnapshotCop || 0,
            previousProfitAppliedCop: existingData.profitAppliedCop || 0,
            previousCashInjectionCop: existingData.cashInjectionCop || 0,
            previousTotalIncreaseCop: existingData.totalIncreaseCop || existingData.reinvestAmountCop || 0,
            previousProjectedCapitalCop: existingData.projectedCapitalCop || 0,
            previousProfitToDisburseCop: existingData.profitToDisburseCop || existingData.withdrawAmountCop || 0,
            resolvedAt: existingData.resolvedAt || null,
            resolvedByUid: existingData.resolvedByUid || null,
          });
        }
      }

      // === FASE DE CÁLCULO Y VALIDACIÓN MATEMÁTICA ===
      const positiveProfitCop = Math.max(cycleProfitSnapshotCop, 0);
      const reinvestableProfitCop = Math.floor(positiveProfitCop / 1_000_000) * 1_000_000;

      let profitAppliedCop = 0;
      let cashInjectionCop = 0;
      let totalIncreaseCop = 0;
      let profitToDisburseCop = 0;
      let projectedCapitalCop = currentCapitalSnapshotCop;
      let desiredIncrease = null;

      if (modality === "PROFIT_REINVESTMENT") {
        if (reinvestableProfitCop < 1_000_000) {
          throw new HttpsError(
            "failed-precondition",
            "Tus ganancias todavía no alcanzan el mínimo de $1.000.000 necesario para reinvertir."
          );
        }

        const selected = Number(selectedReinvestmentCop);
        if (
          isNaN(selected) ||
          selected < 1_000_000 ||
          selected > reinvestableProfitCop ||
          selected % 1_000_000 !== 0
        ) {
          throw new HttpsError(
            "invalid-argument",
            `El monto a reinvertir debe ser un múltiplo de $1.000.000 COP entre $1.000.000 y $${reinvestableProfitCop.toLocaleString("es-CO")}.`
          );
        }

        profitAppliedCop = selected;
        cashInjectionCop = 0;
        totalIncreaseCop = selected;
        profitToDisburseCop = Math.max(cycleProfitSnapshotCop - profitAppliedCop, 0);
        projectedCapitalCop = currentCapitalSnapshotCop + profitAppliedCop;
      } else {
        // CAPITAL_INJECTION
        const desired = Number(desiredCapitalIncreaseCop);
        if (isNaN(desired) || desired <= 0 || desired % 1_000_000 !== 0) {
          throw new HttpsError(
            "invalid-argument",
            "El aumento de capital deseado debe ser un número mayor a cero y múltiplo exacto de $1.000.000 COP."
          );
        }

        desiredIncrease = desired;
        profitAppliedCop = Math.min(reinvestableProfitCop, desired);
        cashInjectionCop = Math.max(desired - profitAppliedCop, 0);
        totalIncreaseCop = desired;
        projectedCapitalCop = currentCapitalSnapshotCop + desired;
        profitToDisburseCop = Math.max(cycleProfitSnapshotCop - profitAppliedCop, 0);
      }

      const projectedCategory = getCategoryForCapitalLocal(projectedCapitalCop);

      // === FASE DE ESCRITURA ATÓMICA (WRITE PHASE) ===
      // Semántica canónica legacy preservada:
      // reinvestAmountCop = profitAppliedCop (ganancia efectivamente reinvertida)
      // totalIncreaseCop = profitAppliedCop + cashInjectionCop (aumento total de capital)
      const canonicalReinvestmentDoc = {
        id: deterministicDocId,
        userId: authUid,
        userUid: authUid,
        userCode: userData.userCode || "",
        userName: userData.fullName || "",
        userEmail: userData.email || "",
        sourceCycleId: sourceCycleId.trim(),
        targetCycleId: targetCycleId,
        fundingReconciliationStatus: "OK",
        fundingReconciliationReason: null,
        modality,
        requestVersion,
        clientRequestId: clientRequestId || null,

        // Snapshots auditados de servidor
        currentCapitalSnapshotCop,
        cycleProfitSnapshotCop,
        reinvestableProfitCop,
        desiredCapitalIncreaseCop: modality === "CAPITAL_INJECTION" ? desiredIncrease : null,
        profitAppliedCop,
        cashInjectionCop,
        totalIncreaseCop,
        profitToDisburseCop,
        projectedCapitalCop,
        projectedCategory,

        // SEMÁNTICA LEGACY ESTRICTA:
        // reinvestAmountCop representa la ganancia del ciclo efectivamente reinvertida.
        reinvestAmountCop: profitAppliedCop,
        availableProfitCop: cycleProfitSnapshotCop,
        withdrawAmountCop: profitToDisburseCop,
        newCapitalTargetCop: projectedCapitalCop,
        newCategoryTarget: projectedCategory,

        status: "PENDING",
        createdAt: nowIso,
        resolvedAt: null,
        resolvedBy: null,
        resolvedByUid: null,
        rejectionReason: null,
        appliedAtCycleClosure: false,
        appliedAt: null,
        ...(previousRejectionHistory.length > 0 ? { rejectionHistory: previousRejectionHistory, resubmittedAt: nowIso } : {}),
      };

      transaction.set(reinvDocRef, canonicalReinvestmentDoc);

      return {
        idempotentReplay: false,
        reinvestment: canonicalReinvestmentDoc,
        message: "Solicitud de reinversión radicada exitosamente de forma atómica.",
        userData,
        totalIncreaseCop,
        requestVersion,
      };
    });

    if (txResult.idempotentReplay) {
      return {
        success: true,
        reinvestment: txResult.reinvestment,
        message: txResult.message,
      };
    }

    // 3. Notificación institucional para administradores fuera de la transacción (ID determinístico versionado)
    const currentReqVersion = txResult.requestVersion || txResult.reinvestment?.requestVersion || 1;
    const notifId = `notif_reinv_${deterministicDocId}_v${currentReqVersion}_REQUEST`;
    await db.collection("notifications").doc(notifId).set({
      id: notifId,
      userId: "ALL_ADMINS",
      targetRole: "ADMIN",
      userCode: "ADMIN",
      userName: "Administración",
      cycleId: sourceCycleId.trim(),
      type: "REINVESTMENT",
      title: modality === "PROFIT_REINVESTMENT" ? "Nueva Solicitud de Reinversión" : "Nueva Inyección de Capital",
      message: `${txResult.userData?.fullName || txResult.userData?.userCode || "Inversionista"} ha radicado una solicitud de ${
        modality === "PROFIT_REINVESTMENT" ? "reinversión de ganancias" : "inyección de capital"
      } (versión ${currentReqVersion}) por aumento total de $${txResult.totalIncreaseCop.toLocaleString("es-CO")} COP.`,
      actionUrl: "/admin/reinvestments",
      payload: {
        reinvestmentId: deterministicDocId,
        requestVersion: currentReqVersion,
        userUid: authUid,
        userCode: txResult.userData?.userCode || "",
        modality,
        totalIncreaseCop: txResult.totalIncreaseCop,
        profitAppliedCop: txResult.reinvestment.profitAppliedCop,
        cashInjectionCop: txResult.reinvestment.cashInjectionCop,
      },
      isRead: false,
      sentAt: nowIso,
      readAt: null,
    }).catch(() => {});

    return {
      success: true,
      reinvestment: txResult.reinvestment,
      message: "Solicitud de reinversión radicada exitosamente.",
    };
  }
);

/**
 * Cloud Function HTTPS Callable: Resolución Administrativa de Solicitudes de Reinversión (SuperAdmin / Admin)
 * PENDING -> APPROVED | REJECTED.
 * REGLA ESTRICTA: La aprobación NUNCA muta users.currentCapital en el ciclo activo.
 */
exports.adminResolveReinvestmentCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Usuario no autenticado.");
    }

    const authUid = request.auth.uid;
    const authEmail = (request.auth.token && request.auth.token.email) ? request.auth.token.email.toLowerCase() : "";

    const adminDoc = await db.collection("users").doc(authUid).get();
    let isAdmin = false;
    let adminName = "Administrador";

    if (
      authUid === "lpx4NLEEMkeh9EJFcG68oPMVdXF2" ||
      authEmail === "juanes9802@gmail.com" ||
      authEmail === "elcocalombiano1828@gmail.com" ||
      (request.auth.token && (request.auth.token.role === "admin" || request.auth.token.superadmin === true)) ||
      (adminDoc.exists && (adminDoc.data().role === "ADMIN" || adminDoc.data().role === "SUPERADMIN"))
    ) {
      isAdmin = true;
      if (adminDoc.exists && adminDoc.data().fullName) {
        adminName = adminDoc.data().fullName;
      }
    }

    if (!isAdmin) {
      throw new HttpsError("permission-denied", "Solo administradores autorizados pueden aprobar o rechazar solicitudes.");
    }

    const { reinvestmentId, action, rejectionReason } = request.data || {};
    if (!reinvestmentId || typeof reinvestmentId !== "string") {
      throw new HttpsError("invalid-argument", "reinvestmentId es obligatorio.");
    }
    const validActions = ["APPROVE", "PREAPPROVE", "CONFIRM_CASH_AND_APPROVE", "REJECT", "NEEDS_REVIEW"];
    if (!validActions.includes(action)) {
      throw new HttpsError("invalid-argument", `action debe ser uno de: ${validActions.join(", ")}.`);
    }

    // 1. TRANSACCIÓN ATÓMICA DE RESOLUCIÓN (READS Y MUTACIÓN DENTRO DE LA MISMA TRANSACCIÓN)
    const reinvRef = db.collection("reinvestments").doc(reinvestmentId);

    const txResult = await db.runTransaction(async (transaction) => {
      const reinvSnap = await transaction.get(reinvRef);
      if (!reinvSnap.exists) {
        throw new HttpsError("not-found", "Solicitud de reinversión no encontrada.");
      }

      const reinvData = reinvSnap.data() || {};

      // Validar enlace de ciclos A -> B y estado de cierre
      const sourceCycleId = reinvData.sourceCycleId;
      const targetCycleId = reinvData.targetCycleId;

      if (!sourceCycleId || !targetCycleId) {
        throw new HttpsError("failed-precondition", "CYCLE_LINK_MISMATCH: La solicitud debe especificar ciclo origen y ciclo objetivo.");
      }

      const cycleARef = db.collection("monthlyCycles").doc(sourceCycleId);
      const cycleBRef = db.collection("monthlyCycles").doc(targetCycleId);

      const cycleASnap = await transaction.get(cycleARef);
      const cycleBSnap = await transaction.get(cycleBRef);

      if (!cycleASnap.exists || !cycleBSnap.exists) {
        throw new HttpsError("not-found", "CYCLE_LINK_MISMATCH: Los ciclos origen y objetivo deben existir en Firestore.");
      }

      const cycleAData = cycleASnap.data() || {};
      const cycleBData = cycleBSnap.data() || {};

      if (cycleAData.nextCycleId !== targetCycleId || cycleBData.previousCycleId !== sourceCycleId) {
        throw new HttpsError(
          "failed-precondition",
          `CYCLE_LINK_MISMATCH: Enlace inválido entre ${sourceCycleId} y ${targetCycleId}. A.nextCycleId debe coincidir con B y B.previousCycleId con A.`
        );
      }

      if (cycleAData.isClosing === true) {
        throw new HttpsError(
          "failed-precondition",
          "El ciclo está en proceso de cierre transaccional. No se pueden modificar solicitudes hasta que finalice o se libere el cierre."
        );
      }
      if (cycleAData.status === "CLOSED") {
        throw new HttpsError(
          "failed-precondition",
          "El ciclo de origen ya se encuentra cerrado. No se pueden modificar solicitudes de ciclos finalizados."
        );
      }

      if (reinvData.status === "APPLIED" || reinvData.appliedAtCycleClosure === true) {
        throw new HttpsError("failed-precondition", "La solicitud ya fue aplicada durante el cierre del ciclo y no puede modificarse.");
      }

      const cashInjectionCop = Number(reinvData.cashInjectionCop || 0);
      const isCapitalInjectionWithCash = reinvData.modality === "CAPITAL_INJECTION" && cashInjectionCop > 0;

      // VALIDACIONES POR ACCIÓN
      if (action === "APPROVE") {
        if (reinvData.status === "NEEDS_REVIEW") {
          throw new HttpsError(
            "failed-precondition",
            "Una solicitud en revisión no puede ser aprobada directamente por la administración. El inversionista debe corregir y radicar nuevamente la solicitud."
          );
        }
        if (reinvData.status !== "PENDING" && reinvData.status !== "PREAPPROVED") {
          throw new HttpsError("failed-precondition", `Solo solicitudes en estado PENDING o PREAPPROVED pueden ser aprobadas (estado actual: ${reinvData.status}).`);
        }
      } else if (action === "PREAPPROVE") {
        if (reinvData.status !== "PENDING") {
          throw new HttpsError("failed-precondition", `Solo solicitudes PENDING pueden ser preaprobadas (estado actual: ${reinvData.status}).`);
        }
      } else if (action === "CONFIRM_CASH_AND_APPROVE") {
        if (reinvData.status !== "PREAPPROVED" && reinvData.status !== "APPROVED") {
          throw new HttpsError("failed-precondition", `Solo solicitudes en estado APPROVED o PREAPPROVED admiten confirmación de dinero (estado actual: ${reinvData.status}).`);
        }
        if (!isCapitalInjectionWithCash) {
          throw new HttpsError("failed-precondition", "La solicitud no registra dinero nuevo por recibir.");
        }
      } else if (action === "REJECT") {
        if (!["PENDING", "PREAPPROVED", "NEEDS_REVIEW", "APPROVED"].includes(reinvData.status)) {
          throw new HttpsError("failed-precondition", `La solicitud no puede ser rechazada en su estado actual (${reinvData.status}).`);
        }
      } else if (action === "NEEDS_REVIEW") {
        if (!["PENDING", "PREAPPROVED", "APPROVED"].includes(reinvData.status)) {
          throw new HttpsError("failed-precondition", `Solo solicitudes PENDING, PREAPPROVED o APPROVED pueden enviarse a revisión (estado actual: ${reinvData.status}).`);
        }
      }

      const nowIso = new Date().toISOString();
      let newStatus = "PENDING";
      const updateFields = {
        resolvedAt: nowIso,
        resolvedBy: adminName,
        resolvedByUid: authUid,
      };

      if (action === "APPROVE") {
        newStatus = "APPROVED";
        updateFields.status = "APPROVED";
        updateFields.rejectionReason = null;
        updateFields.externalFundingStatus = isCapitalInjectionWithCash
          ? (reinvData.externalFundingStatus === "CONFIRMED" ? "CONFIRMED" : "PENDING")
          : "NOT_REQUIRED";
      } else if (action === "PREAPPROVE") {
        newStatus = "APPROVED";
        updateFields.status = "APPROVED";
        updateFields.rejectionReason = null;
        updateFields.externalFundingStatus = "PENDING";
      } else if (action === "CONFIRM_CASH_AND_APPROVE") {
        newStatus = "APPROVED";
        updateFields.status = "APPROVED";
        updateFields.cashReceivedConfirmed = true;
        updateFields.cashReceivedAmountCop = cashInjectionCop; // Backend authoritative
        updateFields.confirmedAmountCop = cashInjectionCop;
        updateFields.confirmedAt = nowIso;
        updateFields.confirmedByUid = authUid;
        updateFields.confirmedByName = adminName;
        updateFields.externalFundingStatus = "CONFIRMED";
        updateFields.cashReceivedAt = nowIso;
        updateFields.cashReceivedByUid = authUid;
        updateFields.cashReceivedByName = adminName;
        updateFields.rejectionReason = null;
      } else if (action === "REJECT") {
        newStatus = "REJECTED";
        updateFields.status = "REJECTED";
        updateFields.rejectionReason = rejectionReason || "No especificado por el administrador";
      } else if (action === "NEEDS_REVIEW") {
        newStatus = "NEEDS_REVIEW";
        updateFields.status = "NEEDS_REVIEW";
        updateFields.rejectionReason = rejectionReason || "Devuelta para revisión financiera por parte del inversionista";
      }

      // Historial de devoluciones/rechazos
      if (action === "REJECT" || action === "NEEDS_REVIEW") {
        const historyEntry = {
          rejectedAt: nowIso,
          rejectedBy: adminName,
          rejectedByUid: authUid,
          rejectionReason: updateFields.rejectionReason,
          previousModality: reinvData.modality,
          previousTotalIncreaseCop: reinvData.totalIncreaseCop || reinvData.reinvestAmountCop || 0,
          previousCashInjectionCop: reinvData.cashInjectionCop || 0,
          previousProfitAppliedCop: reinvData.profitAppliedCop || 0,
          actionType: action,
        };
        const currentHistory = Array.isArray(reinvData.rejectionHistory) ? reinvData.rejectionHistory : [];
        updateFields.rejectionHistory = [...currentHistory, historyEntry];
      }

      transaction.update(reinvRef, updateFields);

      return {
        reinvData,
        updateFields,
        newStatus,
        nowIso,
        cashInjectionCop,
      };
    });

    const { reinvData, updateFields, newStatus, nowIso, cashInjectionCop } = txResult;

    // 2. Notificación Push determinística al inversionista (Versionada por requestVersion)
    const userTargetUid = reinvData.userUid || reinvData.userId;
    const modalityLabel = reinvData.modality === "CAPITAL_INJECTION" ? "inyección de capital" : "reinversión de ganancias";
    const requestVersion = Number(reinvData.requestVersion || 1);

    let notifTitle = "Actualización de Solicitud";
    let notifMsg = `Tu solicitud de ${modalityLabel} fue actualizada a estado ${newStatus}.`;
    let deterministicNotifId = `notif_reinv_${reinvestmentId}_v${requestVersion}_${newStatus}`;

    if (action === "APPROVE" || action === "CONFIRM_CASH_AND_APPROVE") {
      deterministicNotifId = `notif_reinv_${reinvestmentId}_v${requestVersion}_APPROVED`;
      notifTitle = "¡Solicitud Aprobada!";
      notifMsg = `Tu solicitud de ${modalityLabel} fue aprobada. Tu nuevo capital proyectado (${reinvData.projectedCategory}) se aplicará al cierre formal del ciclo.`;
    } else if (action === "PREAPPROVE") {
      deterministicNotifId = `notif_reinv_${reinvestmentId}_v${requestVersion}_PREAPPROVED`;
      notifTitle = "¡Solicitud Preaprobada!";
      notifMsg = `Tu solicitud de inyección fue preaprobada. Estamos pendientes de confirmar la recepción de tu aporte de $${cashInjectionCop.toLocaleString("es-CO")} COP para su aprobación final.`;
    } else if (action === "REJECT") {
      deterministicNotifId = `notif_reinv_${reinvestmentId}_v${requestVersion}_REJECTED`;
      notifTitle = "Solicitud No Aprobada";
      notifMsg = `Tu solicitud de ${modalityLabel} no fue aprobada. Motivo: ${updateFields.rejectionReason}.`;
    } else if (action === "NEEDS_REVIEW") {
      deterministicNotifId = `notif_reinv_${reinvestmentId}_v${requestVersion}_NEEDS_REVIEW`;
      notifTitle = "Solicitud Devuelta a Revisión";
      notifMsg = `Tu solicitud de ${modalityLabel} requiere revisión antes del cierre del ciclo. Motivo: ${updateFields.rejectionReason}. Por favor ingresa al portal para ajustar tu solicitud.`;
    }

    const notifUserRef = db.collection("notifications").doc(deterministicNotifId);
    await notifUserRef.set({
      id: deterministicNotifId,
      userId: userTargetUid,
      userUid: userTargetUid,
      userCode: reinvData.userCode || "",
      userName: reinvData.userName || "",
      cycleId: reinvData.sourceCycleId,
      type: "REINVESTMENT",
      title: notifTitle,
      message: notifMsg,
      actionUrl: "/reinvestment",
      payload: {
        reinvestmentId,
        requestVersion,
        status: newStatus,
        totalIncreaseCop: reinvData.totalIncreaseCop || reinvData.reinvestAmountCop,
        projectedCapitalCop: reinvData.projectedCapitalCop,
        cashInjectionCop: reinvData.cashInjectionCop || 0,
      },
      isRead: false,
      sentAt: nowIso,
      readAt: null,
    }).catch(() => {});

    // 3. Registrar en auditoría
    let auditAction = "REINVESTMENT_STATUS_UPDATED";
    if (action === "APPROVE") auditAction = "REINVESTMENT_APPROVED";
    else if (action === "PREAPPROVE") auditAction = "REINVESTMENT_PREAPPROVED";
    else if (action === "CONFIRM_CASH_AND_APPROVE") auditAction = "CAPITAL_INJECTION_CASH_CONFIRMED";
    else if (action === "REJECT") auditAction = "REINVESTMENT_REJECTED";
    else if (action === "NEEDS_REVIEW") auditAction = "REINVESTMENT_SENT_TO_REVIEW";

    await db.collection("auditLogs").add({
      action: auditAction,
      performedBy: authUid,
      performedByName: adminName,
      targetEntity: reinvestmentId,
      userUid: userTargetUid,
      details: {
        modality: reinvData.modality,
        totalIncreaseCop: reinvData.totalIncreaseCop,
        profitAppliedCop: reinvData.profitAppliedCop,
        cashInjectionCop: reinvData.cashInjectionCop,
        cashReceivedAmountCop: updateFields.cashReceivedAmountCop || null,
        rejectionReason: updateFields.rejectionReason || null,
        newStatus,
      },
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});

    return {
      success: true,
      reinvestment: {
        ...reinvData,
        ...updateFields,
      },
      message: action === "APPROVE" || action === "CONFIRM_CASH_AND_APPROVE"
        ? "Solicitud aprobada exitosamente."
        : action === "PREAPPROVE"
        ? "Solicitud preaprobada exitosamente (pendiente de confirmar fondos)."
        : action === "REJECT"
        ? "Solicitud rechazada."
        : "Solicitud devuelta a revisión.",
    };
  }
);

/**
 * Cloud Function HTTPS Callable: Cierre Autoritativo de Ciclo y Aplicación Transaccional de Reinversiones
 * AUTORIDAD EXCLUSIVA DE SERVIDOR (SuperAdmin / Admin).
 * - Cierra formalmente monthlyCycles/{cycleId}.
 * - Para cada solicitud APPROVED no aplicada:
 *   Ejecuta una Firestore Transaction ATÓMICA en la que:
 *   1. Lee reinvestments/{id} y users/{uid}.
 *   2. Verifica status === 'APPROVED' && appliedAtCycleClosure !== true.
 *   3. Aplica users/{uid}.currentCapital = projectedCapitalCop y reclasifica bitácora.
 *   4. Marca reinvestments/{id}.appliedAtCycleClosure = true y appliedAt = server timestamp.
 *   5. Si falla cualquiera, se descarta la transacción completa (cero estados parciales).
 * - Completamente IDEMPOTENTE ante reintentos o reconexiones de red.
 */

/**
 * Cierre diario autoritativo.
 *
 * GROUP:
 *   Cierra ?nicamente el mostrador del grupo.
 *
 * GLOBAL:
 *   Incluye todas las operaciones del ciclo que todav?a
 *   NO tengan globalClosedAt, incluso si status ya es
 *   CONSOLIDATED.
 *
 * Esta funci?n NO modifica cycleUserResults ni vuelve a
 * calcular ganancias.
 */
exports.adminCloseDailyOperationsCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const {
      authUid,
      createdByName,
    } = await verifySuperAdminPrivileges(request);

    const data = request.data || {};

    const cycleId =
      typeof data.cycleId === "string"
        ? data.cycleId.trim()
        : "";

    const scope =
      typeof data.scope === "string"
        ? data.scope.trim().toUpperCase()
        : "";

    const category =
      typeof data.category === "string"
        ? data.category.trim()
        : "";

    const groupCapitalCop =
      Number(data.groupCapitalCop);

    const rawRequestId =
      typeof data.clientRequestId === "string"
        ? data.clientRequestId.trim()
        : "";

    const cleanRequestId =
      rawRequestId
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 80);

    if (!cycleId) {
      throw new HttpsError(
        "invalid-argument",
        "cycleId es obligatorio."
      );
    }

    if (!["GROUP", "GLOBAL"].includes(scope)) {
      throw new HttpsError(
        "invalid-argument",
        "scope debe ser GROUP o GLOBAL."
      );
    }

    if (
      scope === "GROUP" &&
      (
        !category ||
        !Number.isFinite(groupCapitalCop) ||
        groupCapitalCop <= 0
      )
    ) {
      throw new HttpsError(
        "invalid-argument",
        "GROUP requiere category y groupCapitalCop v?lidos."
      );
    }

    const nowIso =
      new Date().toISOString();

    const closureId =
      `dailyclose_${cycleId}_${
        cleanRequestId ||
        `${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 10)}`
      }`;

    const cycleRef =
      db.collection("monthlyCycles")
        .doc(cycleId);

    const configRef =
      db.collection("settings")
        .doc("global_config");

    try {
      return await db.runTransaction(
        async (transaction) => {

          // --------------------------
          // READ PHASE
          // --------------------------

          const cycleSnap =
            await transaction.get(cycleRef);

          const configSnap =
            await transaction.get(configRef);

          const opsSnap =
            await transaction.get(
              db.collection("dailyOperations")
                .where(
                  "cycleId",
                  "==",
                  cycleId
                )
            );

          if (!cycleSnap.exists) {
            throw new HttpsError(
              "not-found",
              `El ciclo ${cycleId} no existe.`
            );
          }

          const cycleData =
            cycleSnap.data() || {};

          if (
            cycleData.status !== "OPEN" &&
            cycleData.status !== "REOPENED"
          ) {
            throw new HttpsError(
              "failed-precondition",
              "El ciclo no est? abierto."
            );
          }

          if (
            cycleData.operationalStatus !==
            "STARTED"
          ) {
            throw new HttpsError(
              "failed-precondition",
              "CYCLE_NOT_STARTED"
            );
          }

          const configData =
            configSnap.exists
              ? configSnap.data() || {}
              : {};

          if (
            configData.operationalCycleId !==
            cycleId
          ) {
            throw new HttpsError(
              "failed-precondition",
              `CONFIG_CYCLE_MISMATCH: ${
                configData.operationalCycleId ||
                "null"
              } != ${cycleId}`
            );
          }

          const candidates = [];

          opsSnap.docs.forEach((docSnap) => {
            const op =
              docSnap.data() || {};

            if (scope === "GROUP") {

              if (
                op.category === category &&
                Number(op.groupCapitalCop) ===
                  Number(groupCapitalCop) &&
                op.status !== "CONSOLIDATED"
              ) {
                candidates.push({
                  ref: docSnap.ref,
                  id: docSnap.id,
                  op,
                });
              }

              return;
            }

            // GLOBAL:
            // consolidated != globalmente cerrado.
            if (!op.globalClosedAt) {
              candidates.push({
                ref: docSnap.ref,
                id: docSnap.id,
                op,
              });
            }
          });

          if (candidates.length === 0) {
            return {
              success: true,
              alreadyClosed: true,
              scope,
              cycleId,
              closureId,
              closedOperationsCount: 0,
              totalUsdClosed: 0,
              operationIds: [],
              message:
                scope === "GLOBAL"
                  ? "No hay operaciones pendientes del Cierre Global."
                  : "El grupo no tiene operaciones activas pendientes.",
            };
          }

          if (candidates.length > 450) {
            throw new HttpsError(
              "resource-exhausted",
              `Demasiadas operaciones para una sola transacci?n: ${candidates.length}.`
            );
          }

          let totalUsdClosed = 0;
          const operationIds = [];

          candidates.forEach((item) => {

            const op =
              item.op || {};

            totalUsdClosed +=
              Number(op.amountUsd || 0);

            operationIds.push(
              item.id
            );

            if (scope === "GROUP") {

              transaction.update(
                item.ref,
                {
                  status:
                    "CONSOLIDATED",

                  consolidatedAt:
                    op.consolidatedAt ||
                    nowIso,

                  consolidatedByUid:
                    authUid,

                  consolidatedByName:
                    createdByName ||
                    "SuperAdmin",

                  updatedAt:
                    nowIso,

                  updatedByUid:
                    authUid,
                }
              );

              return;
            }

            transaction.update(
              item.ref,
              {
                status:
                  "CONSOLIDATED",

                consolidatedAt:
                  op.consolidatedAt ||
                  nowIso,

                consolidatedByUid:
                  op.consolidatedByUid ||
                  authUid,

                consolidatedByName:
                  op.consolidatedByName ||
                  createdByName ||
                  "SuperAdmin",

                globalClosureId:
                  closureId,

                globalClosedAt:
                  nowIso,

                globalClosedByUid:
                  authUid,

                globalClosedByName:
                  createdByName ||
                  "SuperAdmin",

                updatedAt:
                  nowIso,

                updatedByUid:
                  authUid,
              }
            );
          });

          const auditRef =
            db.collection("auditLogs")
              .doc();

          transaction.set(
            auditRef,
            {
              id:
                auditRef.id,

              action:
                scope === "GLOBAL"
                  ? "DAILY_GLOBAL_OPERATIONS_CLOSED"
                  : "DAILY_GROUP_OPERATIONS_CLOSED",

              performedBy:
                authUid,

              performedByUid:
                authUid,

              performedByName:
                createdByName ||
                "SuperAdmin",

              cycleId,

              targetEntity:
                scope === "GLOBAL"
                  ? `GLOBAL_${cycleId}`
                  : `${cycleId}_${category}_${groupCapitalCop}`,

              details: {
                scope,

                category:
                  scope === "GROUP"
                    ? category
                    : null,

                groupCapitalCop:
                  scope === "GROUP"
                    ? groupCapitalCop
                    : null,

                closureId,

                closedOperationsCount:
                  candidates.length,

                totalUsdClosed,

                operationIds,
              },

              timestamp:
                nowIso,

              createdAt:
                admin.firestore
                  .FieldValue
                  .serverTimestamp(),
            }
          );

          return {
            success: true,
            alreadyClosed: false,

            scope,
            cycleId,
            closureId,

            closedOperationsCount:
              candidates.length,

            totalUsdClosed,

            operationIds,

            message:
              scope === "GLOBAL"
                ? `Cierre Global completado: ${candidates.length} operaci?n(es), $${totalUsdClosed.toFixed(2)} USD.`
                : `Grupo consolidado: ${candidates.length} operaci?n(es), $${totalUsdClosed.toFixed(2)} USD.`,
          };
        }
      );

    } catch (err) {

      console.error(
        "[adminCloseDailyOperationsCallable]",
        err
      );

      if (err instanceof HttpsError) {
        throw err;
      }

      throw new HttpsError(
        "internal",
        err?.message ||
        "Error cerrando operaciones."
      );
    }
  }
);


exports.adminCloseCycleCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Usuario no autenticado.");
    }

    const authUid = request.auth.uid;
    const authEmail = (request.auth.token && request.auth.token.email) ? request.auth.token.email.toLowerCase() : "";

    const adminDoc = await db.collection("users").doc(authUid).get();
    let isAdmin = false;
    let adminName = "Administrador";

    if (
      authUid === "lpx4NLEEMkeh9EJFcG68oPMVdXF2" ||
      authEmail === "juanes9802@gmail.com" ||
      authEmail === "elcocalombiano1828@gmail.com" ||
      (request.auth.token && (request.auth.token.role === "admin" || request.auth.token.superadmin === true)) ||
      (adminDoc.exists && (adminDoc.data().role === "ADMIN" || adminDoc.data().role === "SUPERADMIN"))
    ) {
      isAdmin = true;
      if (adminDoc.exists && adminDoc.data().fullName) {
        adminName = adminDoc.data().fullName;
      }
    }

    if (!isAdmin) {
      throw new HttpsError("permission-denied", "Solo administradores autorizados pueden cerrar ciclos y aplicar reinversiones.");
    }

    const {
      cycleId,
      adminNotes,
      closingTrm,
      clientRequestId,
    } = request.data || {};

    if (
      !cycleId ||
      typeof cycleId !== "string" ||
      !cycleId.trim()
    ) {
      throw new HttpsError(
        "invalid-argument",
        "cycleId es obligatorio."
      );
    }

    const targetCycleId =
      cycleId.trim();

    let authoritativeClosingTrm =
      null;

    const parsedClosingTrm =
      Number(closingTrm);

    const parsedClosingTrmCents =
      Math.round(parsedClosingTrm * 100);

    if (
      !Number.isFinite(parsedClosingTrm) ||
      parsedClosingTrm < 1000 ||
      parsedClosingTrm > 10000 ||
      Math.abs(
        parsedClosingTrm * 100 -
        parsedClosingTrmCents
      ) > 0.000001
    ) {
      throw new HttpsError(
        "invalid-argument",
        "INVALID_CLOSING_TRM: La TRM definitiva de cierre es obligatoria, debe estar entre 1.000 y 10.000 COP/USD y tener máximo 2 decimales."
      );
    }

    let observedMarketTrmAtClose =
      null;

    const cycleRef = db.collection("monthlyCycles").doc(targetCycleId);
    const nowIso = new Date().toISOString();

    // Generar un identificador único seguro (UUID v4) para este intento de cierre
    const closureAttemptId = crypto.randomUUID();

    const closureNotificationJobId =
      `cycle_close_notify_${targetCycleId}_${closureAttemptId}`;

    const closureNotificationJobRef =
      db
        .collection("cycleClosureNotificationJobs")
        .doc(closureNotificationJobId);

    // =========================================================================
    // GATE 1 Y ADQUISICIÓN ATÓMICA DEL LOCK DE CIERRE (TRANSACCIÓN SERVIDOR)
    // =========================================================================
    const allReinvQuery = db.collection("reinvestments").where("sourceCycleId", "==", targetCycleId);

    const gate1Result = await db.runTransaction(async (transaction) => {
      const cycleSnap = await transaction.get(cycleRef);
      if (!cycleSnap.exists) {
        throw new HttpsError("not-found", `El ciclo ${targetCycleId} no existe en Firestore.`);
      }

      const cycleData = cycleSnap.data() || {};
      if (cycleData.status === "CLOSED") {
        // Post-Close Recovery: el cierre financiero ya ocurrió previamente
        return {
          alreadyClosed: true,
          cycleClosed: true,
          cycleId: targetCycleId,
          closedAt:
            cycleData.closedAt,

          closingTrm:
            Number(
              cycleData.closingTrm ||
              cycleData.trmApplied ||
              0
            ),

          closingTrmSource:
            cycleData.closingTrmSource ||
            cycleData.trmSource ||
            null,

          closingTrmSourceUrl:
            cycleData.closingTrmSourceUrl ||
            cycleData.trmSourceUrl ||
            null,

          closingTrmEffectiveDate:
            cycleData.closingTrmEffectiveDate ||
            cycleData.trmEffectiveDate ||
            null,

          closingTrmCapturedAt:
            cycleData.closingTrmCapturedAt ||
            cycleData.trmCapturedAt ||
            null,

          closingTrmRateCents:
            cycleData.closingTrmRateCents ||
            cycleData.trmRateCents ||
            null,

          appliedReinvestmentsCount:
            cycleData.appliedReinvestmentsCount || 0,
          closureNotes: cycleData.closureNotes || "",
          lastClosureAttemptId: cycleData.lastClosureAttemptId || cycleData.closureAttemptId || null,
        };
      }
      if (cycleData.status !== "OPEN" && cycleData.status !== "REOPENED") {
        throw new HttpsError(
          "failed-precondition",
          `El ciclo ${targetCycleId} se encuentra en estado ${cycleData.status} (solo OPEN o REOPENED admiten cierre).`
        );
      }
      if (cycleData.isClosing === true) {
        throw new HttpsError(
          "failed-precondition",
          "El ciclo ya tiene un proceso de cierre en ejecución. Espera a que finalice o sea liberado por la administración."
        );
      }

      // Leer todas las solicitudes del ciclo dentro de la transacción
      const reinvSnap = await transaction.get(allReinvQuery);
      let pendingCount = 0;
      let preapprovedCount = 0;
      let needsReviewCount = 0;
      let approvedCount = 0;
      let rejectedCount = 0;
      let alreadyAppliedCount = 0;

      reinvSnap.docs.forEach((d) => {
        const data = d.data() || {};
        if (data.status === "PENDING") {
          pendingCount++;
        } else if (data.status === "NEEDS_REVIEW") {
          needsReviewCount++;
        } else if (data.status === "APPROVED" || data.status === "PREAPPROVED") {
          if (data.profitAppliedAtCycleClosure === true || data.status === "APPLIED") {
            alreadyAppliedCount++;
          } else {
            approvedCount++;
          }
        } else if (data.status === "REJECTED") {
          rejectedCount++;
        } else if (data.status === "APPLIED" || data.profitAppliedAtCycleClosure === true) {
          alreadyAppliedCount++;
        }
      });

      // Si existen solicitudes PENDING o NEEDS_REVIEW: ABORTAR SIN ADQUIRIR LOCK
      // Nota: Solicitudes APPROVED (con aporte externo pendiente o confirmado) NO bloquean el cierre
      if (pendingCount > 0 || needsReviewCount > 0) {
        return {
          gate1Blocked: true,
          pendingCount,
          preapprovedCount: 0,
          needsReviewCount,
          approvedCount,
          rejectedCount,
          alreadyAppliedCount,
        };
      }

      // GATE 1 SUPERADO: Adquirir Lock Atómico de Cierre en monthlyCycles
      transaction.update(cycleRef, {
        isClosing: true,
        closingStartedAt: nowIso,
        closingByUid: authUid,
        closingByName: adminName,
        closureAttemptId: closureAttemptId,
      });

      return {
        gate1Blocked: false,
        pendingCount,
        preapprovedCount,
        needsReviewCount,
        approvedCount,
        rejectedCount,
        alreadyAppliedCount,
      };
    });

    if (gate1Result.alreadyClosed) {
      // 1. Verificar si ya existe snapshot oficial vigente (isCurrent == true)
      const versionsSnap = await db
        .collection("cycleReports")
        .doc(targetCycleId)
        .collection("versions")
        .where("isCurrent", "==", true)
        .limit(1)
        .get();

      if (!versionsSnap.empty) {
        const existingVer = versionsSnap.docs[0].data();
        return {
          success: true,
          cycleId: targetCycleId,
          cycleClosed: true,
          alreadyClosed: true,
          reportVersionId: existingVer.versionId,
          appliedCount: gate1Result.appliedReinvestmentsCount,
          closedAt:
          gate1Result.closedAt,

        closingTrm:
          gate1Result.closingTrm,

        closingTrmSource:
          gate1Result.closingTrmSource,

        closingTrmSourceUrl:
          gate1Result.closingTrmSourceUrl,

        closingTrmEffectiveDate:
          gate1Result.closingTrmEffectiveDate,

        closingTrmCapturedAt:
          gate1Result.closingTrmCapturedAt,

        closingTrmRateCents:
          gate1Result.closingTrmRateCents,
          message: `El ciclo ${targetCycleId} ya se encuentra cerrado con informe oficial vigente (${existingVer.versionId}). No se realizaron modificaciones financieras adicionales.`,
        };
      }

      // 2. Si el snapshot falló o quedó pendiente en el intento previo, completarlo ahora sin tocar finanzas
      let recoveredVersionId = null;
      try {
        const snapRes = await createCycleReportSnapshot(
          db,
          admin,
          targetCycleId,
          gate1Result.lastClosureAttemptId || closureAttemptId,
          authUid,
          adminName,
          gate1Result.closureNotes || "",
          false
        );
        recoveredVersionId = snapRes ? snapRes.versionId : null;
      } catch (recErr) {
        console.error("[adminCloseCycleCallable] Error recuperando snapshot pendiente tras cierre previo:", recErr);
      }

      return {
        success: true,
        cycleId: targetCycleId,
        cycleClosed: true,
        alreadyClosed: true,
        reportVersionId: recoveredVersionId,
        recoveredSnapshot: true,
        appliedCount: gate1Result.appliedReinvestmentsCount,
        closedAt:
          gate1Result.closedAt,

        closingTrm:
          gate1Result.closingTrm,

        closingTrmSource:
          gate1Result.closingTrmSource,

        closingTrmSourceUrl:
          gate1Result.closingTrmSourceUrl,

        closingTrmEffectiveDate:
          gate1Result.closingTrmEffectiveDate,

        closingTrmCapturedAt:
          gate1Result.closingTrmCapturedAt,

        closingTrmRateCents:
          gate1Result.closingTrmRateCents,
        message: `El ciclo ${targetCycleId} ya estaba cerrado financieramente. Se recuperó y generó exitosamente el snapshot oficial de informe (${recoveredVersionId || "pendiente"}).`,
      };
    }

    if (gate1Result.gate1Blocked) {
      return {
        success: false,
        cycleId: targetCycleId,
        cycleClosed: false,
        code: "CLOSURE_BLOCKED_PENDING_REQUESTS",
        pendingCount: gate1Result.pendingCount,
        preapprovedCount: gate1Result.preapprovedCount,
        needsReviewCount: gate1Result.needsReviewCount,
        approvedCount: gate1Result.approvedCount,
        rejectedCount: gate1Result.rejectedCount,
        alreadyAppliedCount: gate1Result.alreadyAppliedCount,
        processedCount: 0,
        appliedCount: 0,
        failedCount: 0,
        conflictCount: 0,
        conflicts: [],
        failures: [],
        appliedReinvestments: [],
        message: `No puedes cerrar este ciclo todavía. Hay ${gate1Result.pendingCount} solicitud(es) pendiente(s), ${gate1Result.preapprovedCount} preaprobada(s) sin dinero confirmado y ${gate1Result.needsReviewCount} en revisión. Resuelve todas las solicitudes antes de cerrar el ciclo.`,
      };
    }

    // Helper para liberación segura del lock en caso de conflicto o error
    const safelyReleaseLock = async () => {
      try {
        await db.runTransaction(async (tx) => {
          const cSnap = await tx.get(cycleRef);
          if (cSnap.exists && cSnap.data().closureAttemptId === closureAttemptId) {
            tx.update(cycleRef, {
              isClosing: false,
              closingStartedAt: null,
              closingByUid: null,
              closingByName: null,
              closureAttemptId: null,
            });
          }
        });
      } catch (releaseErr) {
        console.warn("[adminCloseCycleCallable] Error liberando lock:", releaseErr);
      }
    };

    // =========================================================================
    // =========================================================
    // CLOSING_TRM_MANUAL_FINAL_AUTHORITY
    // =========================================================
    //
    // REGLA FINANCIERA:
    //
    // - Durante el ciclo: TRM automática Dolar-Colombia.
    // - Cierre definitivo: TRM manual ingresada por el administrador.
    // - La TRM automática al cerrar es SOLO referencia de mercado.
    //
    // =========================================================

    authoritativeClosingTrm = {
      rate: parsedClosingTrm,
      rateCents: parsedClosingTrmCents,
      source: "MANUAL_SUPERADMIN",
      sourceLabel:
        "TRM manual definitiva de cierre",
      sourceUrl: null,
      effectiveDate: null,
      capturedAt: nowIso,
      isLive: false,
    };

    // Captura informativa de la TRM automática en el momento del cierre.
    // IMPORTANTE: esta tasa NO modifica parsedClosingTrm.
    try {
      const marketReferenceAtClose =
        await fetchDolarColombiaTrm();

      observedMarketTrmAtClose =
        marketReferenceAtClose.rate;
    } catch (err) {
      console.warn(
        "[adminCloseCycleCallable] No fue posible obtener la referencia de mercado de Dolar-Colombia al cerrar. Se conserva la TRM manual definitiva:",
        err
      );
    }

    // =========================================================================
    // GATE 2 — PRE-FLIGHT FINANCIERO GLOBAL (LIQUIDACIÓN DEFINITIVA CON CLOSING TRM)
    // =========================================================================
    const conflicts = [];
    const pendingItemsToApply = [];

    // Nivel 1: Lectura de cycleUserResults y cálculo definitivo con closingTrm
    // finalGrossCop = totalUsd * closingTrm
    const allUserResultsSnap = await db
      .collection("cycleUserResults")
      .where("cycleId", "==", targetCycleId)
      .get();

    const definitiveUserResults = [];
    const definitiveUserProfitMap = new Map();
    let totalGrossUsdAtClose = 0;
    let totalGrossCopAtClose = 0;
    let totalUsersProfitCopAtClose = 0;
    let totalAdminCommCopAtClose = 0;

    for (const urDoc of allUserResultsSnap.docs) {
      const ur = urDoc.data() || {};
      const uUid = (ur.userUid || ur.userId || urDoc.id).trim();
      const opUsd = Number(ur.totalUsdOperated || 0);

      // Conversión autoritativa definitiva: finalGrossCop = totalUsd * parsedClosingTrm
      const finalGrossCop = opUsd * parsedClosingTrm;

      const userPctRaw = ur.userPercentage !== undefined ? ur.userPercentage : 75;
      const adminPctRaw = ur.adminPercentage !== undefined ? ur.adminPercentage : 25;
      const uRatio = userPctRaw > 1 ? userPctRaw / 100 : userPctRaw;
      const aRatio = adminPctRaw > 1 ? adminPctRaw / 100 : adminPctRaw;

      const finalUserProfitCop = finalGrossCop * uRatio;
      const finalAdminCommCop = finalGrossCop * aRatio;
      const finalUserProfitUsd = opUsd * uRatio;
      const finalAdminCommUsd = opUsd * aRatio;

      definitiveUserProfitMap.set(uUid, finalUserProfitCop);

      totalGrossUsdAtClose += opUsd;
      totalGrossCopAtClose += finalGrossCop;
      totalUsersProfitCopAtClose += finalUserProfitCop;
      totalAdminCommCopAtClose += finalAdminCommCop;

      definitiveUserResults.push({
        ref: urDoc.ref,
        id: urDoc.id,
        uUid,
        finalGrossCop,
        finalUserProfitCop,
        finalAdminCommCop,
        finalUserProfitUsd,
        finalAdminCommUsd,
      });
    }

    const approvedReinvSnap = await db
      .collection("reinvestments")
      .where("sourceCycleId", "==", targetCycleId)
      .where("status", "==", "APPROVED")
      .get();

    let processedCount = 0;
    let alreadyAppliedCount = gate1Result.alreadyAppliedCount;

    for (const docSnap of approvedReinvSnap.docs) {
      processedCount++;
      const reinvId = docSnap.id;
      const reinvData = docSnap.data() || {};

      // Si ya fue aplicada previamente en una ejecución legítima anterior (recuperación controlada)
      if (reinvData.appliedAtCycleClosure === true || reinvData.status === "APPLIED") {
        continue;
      }

      // Validar status APPROVED
      if (reinvData.status !== "APPROVED") {
        conflicts.push({
          type: "CONFLICT",
          code: "STATUS_NOT_APPROVED",
          reinvestmentId: reinvId,
          status: reinvData.status,
          message: `La solicitud se encuentra en estado ${reinvData.status} (se requiere APPROVED).`,
        });
        continue;
      }

      // Validar coincidencia de ciclo
      if (reinvData.sourceCycleId !== targetCycleId) {
        conflicts.push({
          type: "CONFLICT",
          code: "CYCLE_MISMATCH",
          reinvestmentId: reinvId,
          sourceCycleId: reinvData.sourceCycleId,
          targetCycleId,
          message: "El ciclo de origen de la solicitud no coincide con el ciclo a cerrar.",
        });
        continue;
      }

      const targetUid = reinvData.userUid || reinvData.userId;
      if (!targetUid) {
        conflicts.push({
          type: "CONFLICT",
          code: "MISSING_USER_UID",
          reinvestmentId: reinvId,
          message: "La solicitud carece de identificador de usuario (userUid).",
        });
        continue;
      }

      const userRef = db.collection("users").doc(targetUid);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        conflicts.push({
          type: "CONFLICT",
          code: "USER_NOT_FOUND",
          reinvestmentId: reinvId,
          userUid: targetUid,
          userCode: reinvData.userCode || "",
          message: `El usuario con UID ${targetUid} no existe en la colección users. Bloqueo hasta resolución.`,
        });
        continue;
      }

      const userData = userSnap.data() || {};
      const userCode = userData.userCode || reinvData.userCode || "";

      // Validar estado del usuario
      if (userData.status !== "ACTIVE") {
        conflicts.push({
          type: "CONFLICT",
          code: "USER_NOT_ACTIVE",
          reinvestmentId: reinvId,
          userUid: targetUid,
          userCode,
          userStatus: userData.status,
          message: `El inversionista se encuentra en estado ${userData.status} (no ACTIVO). Requiere resolución administrativa antes de aplicar capital.`,
        });
        continue;
      }

      const currentCapitalSnapshotCop = Number(reinvData.currentCapitalSnapshotCop);
      const totalIncreaseCop = Number(
        reinvData.totalIncreaseCop !== undefined
          ? reinvData.totalIncreaseCop
          : (reinvData.reinvestAmountCop || 0)
      );
      const projectedCapitalCop = Number(
        reinvData.projectedCapitalCop !== undefined
          ? reinvData.projectedCapitalCop
          : (reinvData.newCapitalTargetCop || 0)
      );

      // Invariante matemática: projectedCapitalCop === currentCapitalSnapshotCop + totalIncreaseCop
      const expectedProjected = currentCapitalSnapshotCop + totalIncreaseCop;
      if (projectedCapitalCop !== expectedProjected) {
        conflicts.push({
          type: "CONFLICT",
          code: "INVALID_FINANCIAL_SNAPSHOT",
          reinvestmentId: reinvId,
          userUid: targetUid,
          userCode,
          currentCapitalSnapshotCop,
          totalIncreaseCop,
          projectedCapitalCop,
          expectedProjected,
          message: `Invariante financiera violada: el capital proyectado ($${projectedCapitalCop}) no coincide con snapshot ($${currentCapitalSnapshotCop}) + aumento ($${totalIncreaseCop}).`,
        });
        continue;
      }

      // Control de Capital Drift
      const actualCurrentCapital = Number(userData.currentCapital) || 0;
      if (actualCurrentCapital !== currentCapitalSnapshotCop) {
        conflicts.push({
          type: "CONFLICT",
          code: "CAPITAL_SNAPSHOT_MISMATCH",
          reinvestmentId: reinvId,
          userUid: targetUid,
          userCode,
          snapshotCapitalCop: currentCapitalSnapshotCop,
          actualCurrentCapitalCop: actualCurrentCapital,
          desiredIncreaseCop: totalIncreaseCop,
          originalProjectedCapitalCop: projectedCapitalCop,
          differenceCop: actualCurrentCapital - currentCapitalSnapshotCop,
          message: `Discrepancia de capital base: el capital actual ($${actualCurrentCapital.toLocaleString("es-CO")}) difiere del snapshot radicado ($${currentCapitalSnapshotCop.toLocaleString("es-CO")}).`,
        });
        continue;
      }

      // === VALIDACIÓN DE PROFIT SNAPSHOT DRIFT Y CYCLE USER RESULTS ===
      const profitAppliedCop = Number(
        reinvData.profitAppliedCop !== undefined
          ? reinvData.profitAppliedCop
          : (reinvData.reinvestAmountCop || 0)
      );
      const cycleProfitSnapshotCop = Number(
        reinvData.cycleProfitSnapshotCop !== undefined
          ? reinvData.cycleProfitSnapshotCop
          : (reinvData.availableProfitCop || 0)
      );

      const cycleResDocId = `${targetCycleId}_${targetUid}`;
      const cycleResSnap = await db.collection("cycleUserResults").doc(cycleResDocId).get();

      if (profitAppliedCop > 0) {
        // Validar si existe resultado contable para este usuario
        const definitiveProfit = definitiveUserProfitMap.get(targetUid);
        if (definitiveProfit === undefined) {
          conflicts.push({
            type: "CONFLICT",
            code: "CYCLE_RESULT_NOT_FOUND",
            reinvestmentId: reinvId,
            userUid: targetUid,
            userCode,
            profitAppliedCop,
            message: `No se encontró el registro contable cycleUserResults para respaldar la ganancia de $${profitAppliedCop.toLocaleString("es-CO")} COP del inversionista ${userCode}.`,
          });
          continue;
        }

        // Si la ganancia definitiva liquidada con la TRM de cierre no cubre el monto a reinvertir:
        if (profitAppliedCop > definitiveProfit) {
          conflicts.push({
            type: "CONFLICT",
            code: "PROFIT_SNAPSHOT_MISMATCH",
            reinvestmentId: reinvId,
            userUid: targetUid,
            userCode,
            snapshotProfitCop: Number(reinvData.cycleProfitSnapshotCop || 0),
            currentProfitCop: definitiveProfit,
            profitAppliedCop,
            differenceCop: definitiveProfit - profitAppliedCop,
            message: `La ganancia definitiva liquidada ($${Math.round(definitiveProfit).toLocaleString("es-CO")} COP con TRM de cierre $${parsedClosingTrm.toLocaleString("es-CO")}) es menor al monto solicitado para reinversión ($${profitAppliedCop.toLocaleString("es-CO")} COP). Requiere revisión administrativa antes de cerrar el ciclo.`,
          });
          continue;
        }
      }

      const definitiveProfit = definitiveUserProfitMap.get(targetUid) || 0;
      const cashInjectionCop = Number(reinvData.cashInjectionCop || 0);
      const securedNextCapitalCop = currentCapitalSnapshotCop + profitAppliedCop;
      const projectedNextCapitalCop = securedNextCapitalCop + cashInjectionCop;
      const securedCategory = getCategoryForCapitalLocal(securedNextCapitalCop);
      const projectedCategory = getCategoryForCapitalLocal(projectedNextCapitalCop);
      const externalFundingStatus = cashInjectionCop > 0 ? (reinvData.externalFundingStatus === "CONFIRMED" ? "CONFIRMED" : "PENDING") : "NOT_REQUIRED";
      const finalProfitToDisburseCop = Math.max(Math.round(definitiveProfit) - profitAppliedCop, 0);

      // Toda la validación fue exitosa para este ítem: encolar para aplicación atómica
      pendingItemsToApply.push({
        reinvDocRef: docSnap.ref,
        reinvId,
        userDocRef: userRef,
        userUid: targetUid,
        userCode,
        userName: userData.fullName || reinvData.userName || "",
        currentCapitalSnapshotCop,
        actualCurrentCapital,
        profitAppliedCop,
        cashInjectionCop,
        totalIncreaseCop,
        securedNextCapitalCop,
        projectedNextCapitalCop,
        securedCategory,
        projectedCategory,
        hasCash: cashInjectionCop > 0,
        externalFundingStatus,
        requestVersion: Number(reinvData.requestVersion || 1),
        finalProfitToDisburseCop,
        definitiveProfit: Math.round(definitiveProfit),
      });
    }

    // =========================================================================
    // EVALUACIÓN DE GATE 2 (CERO ESCRITURAS ANTE CONFLICTOS + LIBERACIÓN SEGURA DEL LOCK)
    // =========================================================================
    if (conflicts.length > 0) {
      console.warn(
        `[adminCloseCycleCallable] Pre-flight bloqueado: ${conflicts.length} conflicto(s). Liberando lock de cierre de forma segura.`
      );

      await safelyReleaseLock();

      await db.collection("auditLogs").add({
        action: "CYCLE_CLOSURE_BLOCKED_WITH_CONFLICTS",
        performedBy: authUid,
        performedByName: adminName,
        cycleId: targetCycleId,
        targetEntity: targetCycleId,
        details: {
          processedCount,
          appliedCount: 0,
          alreadyAppliedCount,
          conflictCount: conflicts.length,
          failedCount: 0,
          conflicts,
        },
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});

      return {
        success: false,
        cycleId: targetCycleId,
        cycleClosed: false,
        processedCount,
        appliedCount: 0,
        alreadyAppliedCount,
        failedCount: 0,
        conflictCount: conflicts.length,
        conflicts,
        failures: [],
        appliedReinvestments: [],
        message: `El cierre del ciclo NO fue completado. Se detectaron ${conflicts.length} conflicto(s) financiero(s) durante la validación global. El lock de cierre fue liberado y el ciclo permanece ABIERTO. Resuelva los conflictos y reintente el cierre.`,
      };
    }

    // =========================================================================
    // EVALUACIÓN DE GATE 2B (CAPACIDAD ATÓMICA DE ESCRITURA FINANCIERA)
    // =========================================================================
    const MAX_FINANCIAL_CLOSE_WRITES = 450;
    // Cálculo exacto de escrituras requeridas en la transacción financiera atómica:
    // 4 fijos: monthlyCycles/A, monthlyCycles/B, cycleFinancialSummaries/A, settings/global_config
    // + (2 * N): N users/{uid} + N reinvestments/{reinvId}
    // + M: M cycleUserResults (liquidación definitiva)
    const requiredFinancialWrites = 4 + (pendingItemsToApply.length * 2) + definitiveUserResults.length;

    if (requiredFinancialWrites > MAX_FINANCIAL_CLOSE_WRITES) {
      console.warn(
        `[adminCloseCycleCallable] Pre-flight bloqueado: ${requiredFinancialWrites} escrituras financieras requeridas superan el límite atómico seguro (${MAX_FINANCIAL_CLOSE_WRITES}). Liberando lock de cierre de forma segura.`
      );

      await safelyReleaseLock();

      await db.collection("auditLogs").add({
        action: "CYCLE_CLOSURE_BLOCKED_TOO_LARGE",
        performedBy: authUid,
        performedByName: adminName,
        cycleId: targetCycleId,
        targetEntity: targetCycleId,
        details: {
          requiredFinancialWrites,
          maxAllowedWrites: MAX_FINANCIAL_CLOSE_WRITES,
          pendingItemsCount: pendingItemsToApply.length,
          alreadyAppliedCount,
        },
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});

      throw new HttpsError(
        "resource-exhausted",
        `CLOSE_TOO_LARGE_FOR_ATOMIC_COMMIT: Este ciclo excede el límite seguro para un cierre atómico (${requiredFinancialWrites} > ${MAX_FINANCIAL_CLOSE_WRITES} escrituras requeridas). No se realizó ninguna modificación financiera.`
      );
    }

    // =========================================================================
    // FASE 3 — TRANSACCIÓN GLOBAL FIRESTORE (TODO O NADA)
    // =========================================================================
    const appliedReinvestments = [];

    try {
      await db.runTransaction(async (transaction) => {
        // 1. Re-verificar ciclo dentro de la transacción
        const freshCycleSnap = await transaction.get(cycleRef);
        if (!freshCycleSnap.exists) {
          throw new Error(`El ciclo ${targetCycleId} no existe en Firestore.`);
        }
        const freshCycleData = freshCycleSnap.data() || {};
        if (freshCycleData.status === "CLOSED") {
          if (clientRequestId && freshCycleData.lastCloseRequestId === clientRequestId) {
            return;
          }
          throw new Error(`CYCLE_ALREADY_CLOSED: El ciclo ${targetCycleId} ya se encuentra cerrado.`);
        }
        if (freshCycleData.closureAttemptId !== closureAttemptId) {
          throw new Error("Concurrencia: el intento de cierre fue invalidado por otra operación.");
        }

        const newClosureVersion = Number(freshCycleData.closureVersion || 0) + 1;
        const successorCycleId = freshCycleData.nextCycleId ? String(freshCycleData.nextCycleId).trim() : null;

        // ESCRITURA ATÓMICA 0: Resultados definitivos individuales en cycleUserResults
        for (const resItem of definitiveUserResults) {
          transaction.update(resItem.ref, {
            trmUsed: parsedClosingTrm,
            closingTrmUsed: parsedClosingTrm,
            totalGrossCop: resItem.finalGrossCop,
            userProfitCop: resItem.finalUserProfitCop,
            adminCommissionCop: resItem.finalAdminCommCop,
            userProfitUsd: resItem.finalUserProfitUsd,
            adminCommissionUsd: resItem.finalAdminCommUsd,
            isCycleClosed: true,
            closedAt: nowIso,
            updatedAt: nowIso,
          });
        }

        // 2. Re-verificar cada usuario y solicitud dentro de la transacción
        for (const item of pendingItemsToApply) {
          const txUserSnap = await transaction.get(item.userDocRef);
          const txReinvSnap = await transaction.get(item.reinvDocRef);

          if (!txUserSnap.exists) {
            throw new Error(`Usuario ${item.userCode} no encontrado durante la transacción.`);
          }
          if (!txReinvSnap.exists) {
            throw new Error(`Solicitud ${item.reinvId} no encontrada durante la transacción.`);
          }

          const txUserData = txUserSnap.data() || {};
          const txReinvData = txReinvSnap.data() || {};

          let reconStatus = "OK";
          let reconReason = null;
          if (txReinvData.externalFundingStatus === "CONFIRMED") {
            const confirmedAmt = Number(txReinvData.confirmedAmountCop || 0);
            if (confirmedAmt !== item.cashInjectionCop) {
              reconStatus = "NEEDS_REVIEW";
              reconReason = `Aporte verificado de $${confirmedAmt.toLocaleString("es-CO")} COP difiere de la nueva inyección requerida ($${item.cashInjectionCop.toLocaleString("es-CO")} COP).`;
            }
          }

          // ESCRITURA ATÓMICA 1: Usuario (ASIGNACIÓN ABSOLUTA: base + ganancia aplicada)
          transaction.update(item.userDocRef, {
            currentCapital: item.securedNextCapitalCop,
            category: item.securedCategory,
            updatedAt: nowIso,
            updatedBy: adminName,
          });

          // ESCRITURA ATÓMICA 2: Solicitud de reinversión
          transaction.update(item.reinvDocRef, {
            status: "APPROVED",
            profitAppliedAtCycleClosure: true,
            profitAppliedAt: nowIso,
            appliedClosureVersion: newClosureVersion,
            appliedInCycleId: targetCycleId,
            appliedByUid: authUid,
            appliedByName: adminName,
            securedNextCapitalCop: item.securedNextCapitalCop,
            projectedNextCapitalCop: item.projectedNextCapitalCop,
            profitAppliedCop: item.profitAppliedCop,
            cashInjectionCop: item.cashInjectionCop,
            totalIncreaseCop: item.totalIncreaseCop,
            externalFundingStatus: txReinvData.externalFundingStatus === "CONFIRMED" ? "CONFIRMED" : item.externalFundingStatus,
            fundingReconciliationStatus: reconStatus,
            fundingReconciliationReason: reconReason,
            previousCapitalAtClosureCop: item.actualCurrentCapital,
            capitalAfterClosureCop: item.securedNextCapitalCop,
            profitToDisburseCop: item.finalProfitToDisburseCop,
            cycleProfitSnapshotCop: item.definitiveProfit,
            updatedAt: nowIso,
          });

          appliedReinvestments.push({
            type: "APPLIED_CLOSURE",
            reinvestmentId: item.reinvId,
            requestVersion: item.requestVersion || 1,
            userUid: item.userUid,
            userCode: item.userCode,
            userName: item.userName,
            previousCapital: item.actualCurrentCapital,
            securedNextCapital: item.securedNextCapitalCop,
            projectedCapital: item.projectedNextCapitalCop,
            securedCategory: item.securedCategory,
            projectedCategory: item.projectedCategory,
            profitAppliedCop: item.profitAppliedCop,
            cashInjectionCop: item.cashInjectionCop,
            totalIncreaseCop: item.totalIncreaseCop,
            hasCash: item.hasCash,
            externalFundingStatus: item.externalFundingStatus,
          });
        }

        // ESCRITURA ATÓMICA 3: Cerrar formalmente el ciclo operativo A y liberar lock
        transaction.update(cycleRef, {
          status: "CLOSED",
          closedAt: nowIso,
          closedBy: adminName,
          closedByUid: authUid,
          closureNotes: adminNotes || null,
          closureVersion: newClosureVersion,
          lastCloseRequestId: clientRequestId || null,
          appliedReinvestmentsCount: pendingItemsToApply.length + alreadyAppliedCount,
          closingTrm: parsedClosingTrm,
          closingTrmSource: authoritativeClosingTrm.source,
          closingTrmSourceUrl: authoritativeClosingTrm.sourceUrl,
          closingTrmEffectiveDate: authoritativeClosingTrm.effectiveDate,
          closingTrmCapturedAt: authoritativeClosingTrm.capturedAt,
          closingTrmRateCents: authoritativeClosingTrm.rateCents,
          closingTrmSetAt: nowIso,
          closingTrmSetByUid: authUid,
          closingTrmSetByName: adminName,
          observedMarketTrmAtClose: observedMarketTrmAtClose ? Number(observedMarketTrmAtClose) : null,
          trmApplied: parsedClosingTrm,
          totalGrossUsd: totalGrossUsdAtClose,
          totalGrossCop: totalGrossCopAtClose,
          totalUsersProfitCop: totalUsersProfitCopAtClose,
          totalAdminCommissionCop: totalAdminCommCopAtClose,

          notificationsSent: false,
          notificationsSentAt: null,

          closureNotificationsStatus: "PENDING",
          closureNotificationsJobId: closureNotificationJobId,
          closureNotificationsExpected: null,
          closureNotificationsCreated: 0,
          closureNotificationsCompletedAt: null,
          closureNotificationsFailedAt: null,
          closureNotificationsLastError: null,

          isClosing: false,
          closingStartedAt: null,
          closingByUid: null,
          closingByName: null,
          closureAttemptId: null,
        });

        // ESCRITURA ATÓMICA 4: Actualizar ciclo B (sucesores) en la misma transacción
        if (successorCycleId) {
          const succRef = db.collection("monthlyCycles").doc(successorCycleId);
          transaction.set(
            succRef,
            {
              sourceClosureVersion: newClosureVersion,
              preparationNeedsReview: false,
              updatedAt: nowIso,
            },
            { merge: true }
          );
        }

        // ESCRITURA ATÓMICA 5: Resumen financiero A
        const summaryRef = db.collection("cycleFinancialSummaries").doc(targetCycleId);
        transaction.set(
          summaryRef,
          {
            cycleId: targetCycleId,
            closingTrm: parsedClosingTrm,
            closingTrmSource: authoritativeClosingTrm.source,
            closingTrmSourceUrl: authoritativeClosingTrm.sourceUrl,
            closingTrmEffectiveDate: authoritativeClosingTrm.effectiveDate,
            closingTrmCapturedAt: authoritativeClosingTrm.capturedAt,
            closingTrmRateCents: authoritativeClosingTrm.rateCents,
            trmApplied: parsedClosingTrm,
            totalGrossUsd: totalGrossUsdAtClose,
            totalGrossCop: totalGrossCopAtClose,
            totalUsersProfitCop: totalUsersProfitCopAtClose,
            totalAdminCommissionCop: totalAdminCommCopAtClose,
            isCycleClosed: true,
            closedAt: nowIso,
            closedBy: adminName,
            updatedAt: nowIso,
          },
          { merge: true }
        );

        // ESCRITURA ATÓMICA 6: Punteros globales en settings/global_config
        const globalConfigRef = db.collection("settings").doc("global_config");
        transaction.set(
          globalConfigRef,
          {
            operationalCycleId: null,
            preparingCycleId: successorCycleId || null,
            activeCycleId: successorCycleId || null,
            updatedAt: nowIso,
          },
          { merge: true }
        );

        transaction.set(
          closureNotificationJobRef,
          {
            id: closureNotificationJobId,
            cycleId: targetCycleId,
            closureAttemptId,
            closureVersion: newClosureVersion,

            closingTrm: parsedClosingTrm,

            closingTrmSource: authoritativeClosingTrm.source,

            closingTrmSourceUrl: authoritativeClosingTrm.sourceUrl,

            closingTrmEffectiveDate: authoritativeClosingTrm.effectiveDate,

            closingTrmCapturedAt: authoritativeClosingTrm.capturedAt,

            closingTrmRateCents: authoritativeClosingTrm.rateCents,

            createdByUid: authUid,
            createdByName: adminName,

            status: "PENDING",

            sourceResultsCount:
              definitiveUserResults.length,

            expectedNotifications: null,
            createdNotifications: 0,

            createdAt: nowIso,
            processingStartedAt: null,
            completedAt: null,
            failedAt: null,
            lastError: null,
          }
        );
      });
    } catch (err) {
      console.error("[adminCloseCycleCallable] Error en la transacción global de cierre:", err);
      await safelyReleaseLock();
      return {
        success: false,
        cycleId: targetCycleId,
        cycleClosed: false,
        processedCount,
        appliedCount: 0,
        alreadyAppliedCount,
        failedCount: 1,
        conflictCount: 0,
        conflicts: [],
        failures: [{ error: err.message || String(err) }],
        appliedReinvestments: [],
        message: `Fallo atómico durante la ejecución del cierre: ${err.message || String(err)}. Se ejecutó rollback completo. Ningún capital fue modificado. El ciclo permanece ABIERTO y el lock fue liberado.`,
      };
    }

    // Registrar auditoría de aplicaciones y cierre completado
    for (const applied of appliedReinvestments) {
      await db.collection("auditLogs").add({
        action: "REINVESTMENT_SECURED_AT_CLOSURE",
        performedBy: authUid,
        performedByName: adminName,
        cycleId: targetCycleId,
        targetEntity: applied.reinvestmentId,
        userUid: applied.userUid,
        previousValue: applied.previousCapital,
        newValue: applied.securedNextCapital,
        details: {
          userCode: applied.userCode,
          requestVersion: applied.requestVersion || 1,
          securedNextCapital: applied.securedNextCapital,
          projectedCapital: applied.projectedCapital,
          profitAppliedCop: applied.profitAppliedCop,
          cashInjectionCop: applied.cashInjectionCop,
          hasCash: applied.hasCash,
          externalFundingStatus: applied.externalFundingStatus,
          securedCategory: applied.securedCategory,
        },
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});

      // Notificación Push determinística al inversionista tras éxito del cierre (Versionada)
      const notifAppliedId = `notif_reinv_${applied.reinvestmentId}_v${applied.requestVersion || 1}_${targetCycleId}_CLOSURE`;
      let notifMsg = `Tu ganancia de $${applied.profitAppliedCop.toLocaleString("es-CO")} COP fue reinvertida formalmente al cierre del ciclo ${targetCycleId}. Tu capital asegurado es de $${applied.securedNextCapital.toLocaleString("es-CO")} COP (${applied.securedCategory}).`;
      if (applied.hasCash) {
        notifMsg += ` Tienes un aporte de capital externo de $${applied.cashInjectionCop.toLocaleString("es-CO")} COP pendiente de confirmación bancaria para el próximo ciclo.`;
      }

      await db.collection("notifications").doc(notifAppliedId).set({
        id: notifAppliedId,
        userId: applied.userUid,
        userUid: applied.userUid,
        userCode: applied.userCode || "",
        userName: applied.userName || "",
        cycleId: targetCycleId,
        type: "REINVESTMENT",
        title: "¡Capital Asegurado por Cierre de Ciclo!",
        message: notifMsg,
        actionUrl: "/portfolio",
        payload: {
          reinvestmentId: applied.reinvestmentId,
          requestVersion: applied.requestVersion || 1,
          status: "APPROVED",
          securedNextCapital: applied.securedNextCapital,
          projectedCapital: applied.projectedCapital,
          securedCategory: applied.securedCategory,
          profitAppliedCop: applied.profitAppliedCop,
          cashInjectionCop: applied.cashInjectionCop,
          hasCash: applied.hasCash,
          externalFundingStatus: applied.externalFundingStatus,
        },
        isRead: false,
        sentAt: nowIso,
        readAt: null,
      }).catch((notifErr) => {
        console.warn(`[adminCloseCycleCallable] Error enviando notificación de cierre para ${applied.userCode}:`, notifErr);
      });
    }

    await db.collection("auditLogs").add({
      action: "CYCLE_CLOSED",
      performedBy: authUid,
      performedByName: adminName,
      cycleId: targetCycleId,
      targetEntity: targetCycleId,
      details: {
        processedCount,
        appliedCount: appliedReinvestments.length,
        alreadyAppliedCount,
        adminNotes: adminNotes || "",
        closingTrm: parsedClosingTrm,
        closingTrmSource: authoritativeClosingTrm.source,
        closingTrmSourceUrl: authoritativeClosingTrm.sourceUrl,
        closingTrmEffectiveDate: authoritativeClosingTrm.effectiveDate,
        closingTrmCapturedAt: authoritativeClosingTrm.capturedAt,
        closingTrmRateCents: authoritativeClosingTrm.rateCents,
        closingTrmSetAt: nowIso,
        closingTrmSetByUid: authUid,
        closingTrmSetByName: adminName,
        observedMarketTrmAtClose: observedMarketTrmAtClose ? Number(observedMarketTrmAtClose) : null,
        totalGrossUsd: totalGrossUsdAtClose,
        totalGrossCop: totalGrossCopAtClose,
        totalUsersProfitCop: totalUsersProfitCopAtClose,
        totalAdminCommissionCop: totalAdminCommCopAtClose,
      },
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});

    // Nota: El ciclo sucesor es creado y gestionado exclusivamente vía adminCreateNextCycleCallable.

    // Generación del Snapshot Oficial e Inmutable de Cierre de Ciclo
    let reportVersionId = null;
    try {
      const snapshotResult = await createCycleReportSnapshot(
        db,
        admin,
        targetCycleId,
        closureAttemptId,
        authUid,
        adminName,
        adminNotes || "",
        false
      );
      reportVersionId = snapshotResult ? snapshotResult.versionId : null;
    } catch (snapshotErr) {
      console.error("[adminCloseCycleCallable] Error generando snapshot oficial de reporte:", snapshotErr);
    }

    return {
      success: true,
      cycleId: targetCycleId,
      cycleClosed: true,
      closedAt: nowIso,
      closingTrm: parsedClosingTrm,
      closingTrmSource: authoritativeClosingTrm.source,
      closingTrmSourceUrl: authoritativeClosingTrm.sourceUrl,
      closingTrmEffectiveDate: authoritativeClosingTrm.effectiveDate,
      closingTrmCapturedAt: authoritativeClosingTrm.capturedAt,
      closingTrmRateCents: authoritativeClosingTrm.rateCents,
      closingTrmSetAt: nowIso,
      closingTrmSetByUid: authUid,
      closingTrmSetByName: adminName,
      observedMarketTrmAtClose: observedMarketTrmAtClose ? Number(observedMarketTrmAtClose) : null,
      reportVersionId,

      closureNotificationsJobId,
      notificationsQueued: true,

      processedCount,
      appliedCount: appliedReinvestments.length,
      alreadyAppliedCount,
      failedCount: 0,
      conflictCount: 0,
      conflicts: [],
      failures: [],
      appliedReinvestments,
      message: `Ciclo ${targetCycleId} cerrado exitosamente con TRM definitiva de $${parsedClosingTrm.toLocaleString("es-CO")}. Se aplicaron ${appliedReinvestments.length} reinversiones aprobadas y se generó el snapshot oficial inmutable ${reportVersionId || ""}.`,
    };
  }
);

/**
 * Cloud Function HTTPS Callable: Desbloqueo Administrativo de Cierre Atascado (Recuperación Exclusiva SuperAdmin)
 * Permite a la administración SuperAdmin limpiar un lock de cierre huérfano de manera segura
 * validando que el closureAttemptId coincida con el lock activo y requiriendo confirmación explícita.
 */

/**
 * Automatic cycle-close notification worker.
 *
 * The job is created atomically by adminCloseCycleCallable.
 * Notification IDs are deterministic to make retries idempotent.
 */
exports.onCycleClosureNotificationJobCreated = onDocumentCreated(
  {
    document:
      "cycleClosureNotificationJobs/{jobId}",

    region:
      "us-central1",

    retry:
      true,
  },

  async (event) => {

    const jobId =
      event.params.jobId;

    const jobRef =
      db
        .collection("cycleClosureNotificationJobs")
        .doc(jobId);

    const jobSnap =
      await jobRef.get();

    if (!jobSnap.exists) {
      console.warn(
        "[CycleClosureNotifications] missing job",
        jobId
      );

      return;
    }

    const job =
      jobSnap.data() || {};

    if (job.status === "COMPLETED") {
      console.log(
        "[CycleClosureNotifications] already completed",
        jobId
      );

      return;
    }

    const cycleId =
      String(
        job.cycleId || ""
      ).trim();

    const closingTrm =
      Number(
        job.closingTrm
      );

    const closureVersion =
      Number(
        job.closureVersion || 1
      );

    if (!cycleId) {
      throw new Error(
        "INVALID_JOB_CYCLE_ID"
      );
    }

    if (
      !Number.isFinite(closingTrm) ||
      closingTrm <= 0
    ) {
      throw new Error(
        "INVALID_JOB_CLOSING_TRM"
      );
    }

    const cycleRef =
      db
        .collection("monthlyCycles")
        .doc(cycleId);

    const processingStartedAt =
      new Date().toISOString();

    await jobRef.set(
      {
        status:
          "PROCESSING",

        processingStartedAt,

        attempts:
          admin.firestore
            .FieldValue
            .increment(1),

        lastError:
          null,
      },

      {
        merge:
          true,
      }
    );

    try {

      // =====================================================
      // VERIFY FINANCIAL CLOSE
      // =====================================================

      const cycleSnap =
        await cycleRef.get();

      if (!cycleSnap.exists) {
        throw new Error(
          `CYCLE_NOT_FOUND:${cycleId}`
        );
      }

      const cycle =
        cycleSnap.data() || {};

      if (
        cycle.status !== "CLOSED"
      ) {
        throw new Error(
          `CYCLE_NOT_CLOSED:${cycle.status || "UNKNOWN"}`
        );
      }

      const persistedClosingTrm =
        Number(
          cycle.closingTrm ||
          cycle.trmApplied
        );

      if (
        !Number.isFinite(
          persistedClosingTrm
        ) ||
        persistedClosingTrm <= 0
      ) {
        throw new Error(
          "CLOSING_TRM_NOT_PERSISTED"
        );
      }

      if (
        Math.abs(
          persistedClosingTrm -
          closingTrm
        ) > 0.000001
      ) {
        throw new Error(
          `CLOSING_TRM_MISMATCH:${persistedClosingTrm}:${closingTrm}`
        );
      }


      // =====================================================
      // READ FINAL USER RESULTS
      // =====================================================

      const resultSnap =
        await db
          .collection("cycleUserResults")
          .where(
            "cycleId",
            "==",
            cycleId
          )
          .get();

      const recipients = [];

      for (
        const resultDoc of resultSnap.docs
      ) {

        const result =
          resultDoc.data() || {};

        const userUid =
          String(
            result.userUid ||
            result.userId ||
            ""
          ).trim();

        if (!userUid) {
          throw new Error(
            `RESULT_WITHOUT_UID:${resultDoc.id}`
          );
        }

        const userSnap =
          await db
            .collection("users")
            .doc(userUid)
            .get();

        const user =
          userSnap.exists
            ? userSnap.data() || {}
            : {};

        const role =
          String(
            user.role || ""
          )
            .trim()
            .toUpperCase();

        const userCode =
          String(
            result.userCode ||
            user.userCode ||
            ""
          ).trim();

        const isAdmin =
          role === "ADMIN" ||
          role === "SUPERADMIN" ||
          userCode
            .toUpperCase()
            .startsWith("ADM");

        const isFrozenTradingParticipant =
          result.participatesInTrading === true ||
          result.commissionMode === "SELF_ADMIN";

        if (
          isAdmin &&
          user.participatesInTrading !== true &&
          !isFrozenTradingParticipant
        ) {
          continue;
        }

        const closureParticipantSplit =
          getTradingSplitForProfile({
            ...user,

            commissionMode:
              result.commissionMode ||
              user.commissionMode,

            userPercentage:
                result.userPercentage,

            adminPercentage:
                result.adminPercentage,
          });

        const calc =
          calculateUserFinancialResult(
            {
              totalUsdOperated:
                Number(
                  result.totalUsdOperated ||
                  0
                ),

              trm:
                closingTrm,

              userPercentage:
                closureParticipantSplit.userPercentage,

              adminPercentage:
                closureParticipantSplit.adminPercentage,
            }
          );

        recipients.push(
          {
            resultRef:
              resultDoc.ref,

            userUid,

            userCode,

            userName:
              String(
                result.userName ||
                user.fullName ||
                "Inversionista"
              ),

            userEmail:
              String(
                result.email ||
                user.email ||
                ""
              ),

            totalUsdOperated:
              calc.usdOperated,

            totalGrossCop:
              calc.totalGrossCop,

            userPercentage:
              calc.userPercentage,

            userProfitCop:
              calc.userProfitCop,

            userProfitUsd:
              calc.userProfitUsd,
          }
        );
      }


      // =====================================================
      // CREATE DETERMINISTIC NOTIFICATIONS
      // =====================================================

      const sentAt =
        new Date().toISOString();

      const cycleName =
        String(
          cycle.name ||
          cycleId
        );

      const chunkSize =
        200;

      for (
        let offset = 0;
        offset < recipients.length;
        offset += chunkSize
      ) {

        const chunk =
          recipients.slice(
            offset,
            offset + chunkSize
          );

        const batch =
          db.batch();

        for (
          const recipient of chunk
        ) {

          const notificationId =
            `notif_cycle_close_${cycleId}_v${closureVersion}_${recipient.userUid}`;

          const notificationRef =
            db
              .collection("notifications")
              .doc(notificationId);

          const formattedTrm =
            closingTrm.toLocaleString(
              "es-CO",
              {
                maximumFractionDigits: 2,
              }
            );

          const formattedUsd =
            Number(
              recipient.totalUsdOperated
            ).toLocaleString(
              "es-CO",
              {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }
            );

          const formattedGrossCop =
            Math.round(
              Number(
                recipient.totalGrossCop
              )
            ).toLocaleString(
              "es-CO"
            );

          const formattedProfitCop =
            Math.round(
              Number(
                recipient.userProfitCop
              )
            ).toLocaleString(
              "es-CO"
            );

          const message =
            `Hola ${recipient.userName}, el ciclo ${cycleName} fue cerrado con una TRM definitiva de $${formattedTrm} COP/USD. ` +
            `Tu operacion acumulada fue de $${formattedUsd} USD, equivalente a $${formattedGrossCop} COP. ` +
            `Tu ganancia correspondiente es de $${formattedProfitCop} COP.`;

          batch.set(
            notificationRef,

            {
              id:
                notificationId,

              userId:
                recipient.userUid,

              userUid:
                recipient.userUid,

              userCode:
                recipient.userCode,

              userName:
                recipient.userName,

              userEmail:
                recipient.userEmail,

              cycleId,

              type:
                "MONTHLY_CLOSURE",

              targetType:
                "INDIVIDUAL",

              targetUserUid:
                recipient.userUid,

              targetUids: [
                recipient.userUid,
              ],

              authorizedUids: [
                recipient.userUid,
              ],

              title:
                "Cierre de ciclo completado",

              message,

              payload: {
                cycleId,

                usdAmount:
                  recipient.totalUsdOperated,

                copAmount:
                  recipient.totalGrossCop,

                userProfitCop:
                  recipient.userProfitCop,

                userProfitUsd:
                  recipient.userProfitUsd,

                userPercentage:
                  recipient.userPercentage,

                trmUsed:
                  closingTrm,

                closingTrm,

                closureVersion,

                closureNotificationJobId:
                  jobId,
              },

              isRead:
                false,

              readAt:
                null,

              sentAt,

              createdAt:
                sentAt,

              createdByUid:
                job.createdByUid ||
                "",

              createdByName:
                job.createdByName ||
                "Cycle Close System",
            },

            {
              merge:
                true,
            }
          );

          batch.set(
            recipient.resultRef,

            {
              notificationStatus:
                "SENT",

              notificationSentAt:
                sentAt,
            },

            {
              merge:
                true,
            }
          );
        }

        await batch.commit();
      }


      // =====================================================
      // COMPLETE JOB
      // =====================================================

      await Promise.all(
        [
          cycleRef.set(
            {
              notificationsSent:
                true,

              notificationsSentAt:
                sentAt,

              closureNotificationsStatus:
                "COMPLETED",

              closureNotificationsJobId:
                jobId,

              closureNotificationsExpected:
                recipients.length,

              closureNotificationsCreated:
                recipients.length,

              closureNotificationsCompletedAt:
                sentAt,

              closureNotificationsFailedAt:
                null,

              closureNotificationsLastError:
                null,
            },

            {
              merge:
                true,
            }
          ),

          jobRef.set(
            {
              status:
                "COMPLETED",

              expectedNotifications:
                recipients.length,

              createdNotifications:
                recipients.length,

              completedAt:
                sentAt,

              failedAt:
                null,

              lastError:
                null,
            },

            {
              merge:
                true,
            }
          ),

          db
            .collection("auditLogs")
            .doc(
              `cycle_close_notifications_${jobId}`
            )
            .set(
              {
                action:
                  "CYCLE_CLOSURE_NOTIFICATIONS_CREATED",

                performedBy:
                  job.createdByUid ||
                  "SYSTEM",

                performedByName:
                  job.createdByName ||
                  "Cycle Close System",

                cycleId,

                targetEntity:
                  cycleId,

                details: {
                  jobId,
                  closingTrm,
                  closureVersion,

                  expectedNotifications:
                    recipients.length,

                  createdNotifications:
                    recipients.length,
                },

                timestamp:
                  admin.firestore
                    .FieldValue
                    .serverTimestamp(),
              },

              {
                merge:
                  true,
              }
            ),
        ]
      );

      console.log(
        "[CycleClosureNotifications] COMPLETED",
        {
          cycleId,
          jobId,
          createdNotifications:
            recipients.length,
        }
      );

    } catch (err) {

      const message =
        err?.message ||
        String(err);

      const failedAt =
        new Date().toISOString();

      console.error(
        "[CycleClosureNotifications] FAILED",
        {
          cycleId,
          jobId,
          error:
            message,
        }
      );

      await Promise.allSettled(
        [
          jobRef.set(
            {
              status:
                "FAILED",

              failedAt,

              lastError:
                message,
            },

            {
              merge:
                true,
            }
          ),

          cycleRef.set(
            {
              notificationsSent:
                false,

              closureNotificationsStatus:
                "FAILED",

              closureNotificationsJobId:
                jobId,

              closureNotificationsFailedAt:
                failedAt,

              closureNotificationsLastError:
                message,
            },

            {
              merge:
                true,
            }
          ),
        ]
      );

      throw err;
    }
  }
);


exports.adminUnlockCycleCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Usuario no autenticado.");
    }

    const authUid = request.auth.uid;
    const authEmail = (request.auth.token && request.auth.token.email) ? request.auth.token.email.toLowerCase() : "";
    const adminDoc = await db.collection("users").doc(authUid).get();
    
    // Verificación canónica exclusiva de SuperAdmin (Se rechaza Admin secundario)
    let isSuperAdmin = false;
    let adminName = "SuperAdmin";

    if (
      authUid === "lpx4NLEEMkeh9EJFcG68oPMVdXF2" ||
      authEmail === "juanes9802@gmail.com" ||
      authEmail === "elcocalombiano1828@gmail.com" ||
      (request.auth.token && (request.auth.token.superadmin === true || request.auth.token.role === "superadmin"))
    ) {
      isSuperAdmin = true;
      if (adminDoc.exists && adminDoc.data().fullName) {
        adminName = adminDoc.data().fullName;
      }
    }

    if (!isSuperAdmin) {
      throw new HttpsError(
        "permission-denied",
        "Acceso denegado: Se requieren privilegios canónicos de SuperAdmin para desbloquear un ciclo."
      );
    }

    const { cycleId, expectedClosureAttemptId, confirmation, reason } = request.data || {};
    if (!cycleId || typeof cycleId !== "string" || !cycleId.trim()) {
      throw new HttpsError("invalid-argument", "El parámetro 'cycleId' es obligatorio.");
    }
    if (!expectedClosureAttemptId || typeof expectedClosureAttemptId !== "string" || !expectedClosureAttemptId.trim()) {
      throw new HttpsError("invalid-argument", "El parámetro 'expectedClosureAttemptId' es obligatorio para verificar el lock.");
    }
    if (confirmation !== "DESBLOQUEAR CIERRE") {
      throw new HttpsError(
        "invalid-argument",
        "Confirmación inválida. Debes ingresar exactamente 'DESBLOQUEAR CIERRE' para autorizar el desbloqueo."
      );
    }
    if (!reason || typeof reason !== "string" || reason.trim().length < 5) {
      throw new HttpsError(
        "invalid-argument",
        "Debes ingresar un motivo justificado para el desbloqueo (mínimo 5 caracteres)."
      );
    }

    const targetCycleId = cycleId.trim();
    const targetAttemptId = expectedClosureAttemptId.trim();
    const cleanReason = reason.trim();
    const cycleRef = db.collection("monthlyCycles").doc(targetCycleId);
    const nowIso = new Date().toISOString();

    // Transacción atómica de verificación del lock y liberación
    await db.runTransaction(async (transaction) => {
      const cycleSnap = await transaction.get(cycleRef);
      if (!cycleSnap.exists) {
        throw new HttpsError("not-found", `El ciclo ${targetCycleId} no existe en Firestore.`);
      }

      const cycleData = cycleSnap.data() || {};
      if (cycleData.isClosing !== true) {
        throw new HttpsError(
          "failed-precondition",
          `El ciclo ${targetCycleId} no tiene un lock de cierre activo (isClosing no es true).`
        );
      }

      if (cycleData.closureAttemptId !== targetAttemptId) {
        throw new HttpsError(
          "failed-precondition",
          `El ID de intento de cierre ingresado (${targetAttemptId}) no coincide con el lock activo actual (${cycleData.closureAttemptId || "NULO"}). No se permite desbloquear un lock perteneciente a otra ejecución.`
        );
      }

      // 1. Liberar lock en monthlyCycles
      transaction.update(cycleRef, {
        isClosing: false,
        closingStartedAt: null,
        closingByUid: null,
        closingByName: null,
        closureAttemptId: null,
        unlockedAt: nowIso,
        unlockedBy: adminName,
        unlockedByUid: authUid,
        unlockReason: cleanReason,
      });

      // 2. Registro de Auditoría ATÓMICO dentro de la misma transacción
      const auditRef = db.collection("auditLogs").doc();
      transaction.set(auditRef, {
        action: "CYCLE_CLOSURE_LOCK_CLEARED",
        performedBy: authUid,
        performedByName: adminName,
        cycleId: targetCycleId,
        targetEntity: targetCycleId,
        closureAttemptId: targetAttemptId,
        unlockedByUid: authUid,
        unlockReason: cleanReason,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return {
      success: true,
      cycleId: targetCycleId,
      closureAttemptId: targetAttemptId,
      message: `El lock de cierre del ciclo ${targetCycleId} (intento: ${targetAttemptId}) fue liberado exitosamente por SuperAdmin.`,
    };
  }
);

/**
 * Cloud Function HTTPS Callable: Reapertura Administrativa Autoritativa de Ciclo (Exclusivo SuperAdmin)
 * Permite a SuperAdmin reabrir un ciclo cerrado (CLOSED -> REOPENED) para ajustes excepcionales.
 * Operación transaccional autoritativa con registro atómico en auditLogs.
 */
exports.adminReopenCycleCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Usuario no autenticado.");
    }

    const authUid = request.auth.uid;
    const authEmail = (request.auth.token && request.auth.token.email) ? request.auth.token.email.toLowerCase() : "";
    const adminDoc = await db.collection("users").doc(authUid).get();

    // Verificación canónica exclusiva de SuperAdmin (Se rechaza Admin secundario)
    let isSuperAdmin = false;
    let adminName = "SuperAdmin";

    if (
      authUid === "lpx4NLEEMkeh9EJFcG68oPMVdXF2" ||
      authEmail === "juanes9802@gmail.com" ||
      authEmail === "elcocalombiano1828@gmail.com" ||
      (request.auth.token && (request.auth.token.superadmin === true || request.auth.token.role === "superadmin"))
    ) {
      isSuperAdmin = true;
      if (adminDoc.exists && adminDoc.data().fullName) {
        adminName = adminDoc.data().fullName;
      }
    }

    if (!isSuperAdmin) {
      throw new HttpsError(
        "permission-denied",
        "Acceso denegado: Se requieren privilegios canónicos de SuperAdmin para reabrir un ciclo."
      );
    }

    const { cycleId, reason } = request.data || {};
    if (!cycleId || typeof cycleId !== "string" || !cycleId.trim()) {
      throw new HttpsError("invalid-argument", "El parámetro 'cycleId' es obligatorio.");
    }
    if (!reason || typeof reason !== "string" || reason.trim().length < 5) {
      throw new HttpsError(
        "invalid-argument",
        "Debes ingresar un motivo justificado para la reapertura (mínimo 5 caracteres)."
      );
    }

    const targetCycleId = cycleId.trim();
    const cleanReason = reason.trim();
    const cycleRef = db.collection("monthlyCycles").doc(targetCycleId);
    const nowIso = new Date().toISOString();

    // Transacción atómica de reapertura y auditoría
    await db.runTransaction(async (transaction) => {
      const cycleSnap = await transaction.get(cycleRef);
      if (!cycleSnap.exists) {
        throw new HttpsError("not-found", `El ciclo ${targetCycleId} no existe en Firestore.`);
      }

      const cycleData = cycleSnap.data() || {};
      if (cycleData.isClosing === true) {
        throw new HttpsError(
          "failed-precondition",
          "No se puede reabrir un ciclo que tiene un lock de cierre activo. Primero debe liberarse el lock."
        );
      }
      if (cycleData.status !== "CLOSED") {
        throw new HttpsError(
          "failed-precondition",
          `Solo ciclos en estado CLOSED admiten reapertura (estado actual: ${cycleData.status || "DESCONOCIDO"}).`
        );
      }

      const existingAudit = Array.isArray(cycleData.reopenAudit) ? [...cycleData.reopenAudit] : [];
      existingAudit.push({
        reopenedAt: nowIso,
        reopenedBy: adminName,
        reopenedByUid: authUid,
        reason: cleanReason,
      });

      // 1. Mutar estado a REOPENED en monthlyCycles
      transaction.update(cycleRef, {
        status: "REOPENED",
        reopenedAt: nowIso,
        reopenedBy: adminName,
        reopenedByUid: authUid,
        reopenReason: cleanReason,
        reopenAudit: existingAudit,
      });

      // Si existe B enlazado y sigue PREPARING, marcar B.preparationNeedsReview = true
      if (cycleData.nextCycleId) {
        const succRef = db.collection("monthlyCycles").doc(cycleData.nextCycleId.trim());
        const succSnap = await transaction.get(succRef);
        if (succSnap.exists) {
          const succData = succSnap.data() || {};
          if (succData.operationalStatus === "PREPARING") {
            transaction.update(succRef, {
              preparationNeedsReview: true,
              updatedAt: nowIso,
            });
          }
        }
      }

      // Reabrir resumen financiero de A
      const summaryRef = db.collection("cycleFinancialSummaries").doc(targetCycleId);
      transaction.set(
        summaryRef,
        {
          cycleId: targetCycleId,
          isCycleClosed: false,
          closedAt: null,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      // 2. Registro de Auditoría ATÓMICO en auditLogs
      const auditRef = db.collection("auditLogs").doc();
      transaction.set(auditRef, {
        action: "CYCLE_REOPENED",
        cycleId: targetCycleId,
        targetEntity: targetCycleId,
        previousStatus: "CLOSED",
        newStatus: "REOPENED",
        performedBy: authUid,
        performedByName: adminName,
        reopenedByUid: authUid,
        reason: cleanReason,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    // 3. Superar versión activa del informe oficial de cierre
    try {
      await supersedeCurrentCycleReport(db, admin, targetCycleId, authUid, adminName, cleanReason);
    } catch (repErr) {
      console.error("[adminReopenCycleCallable] Error marcando snapshot como superseded:", repErr);
    }

    return {
      success: true,
      cycleId: targetCycleId,
      status: "REOPENED",
      message: `El ciclo ${targetCycleId} fue reabierto exitosamente para ajustes autorizados. El informe previo fue marcado como SUPERSEDED.`,
    };
  }
);

/**
 * Cloud Function HTTPS Callable: Reintento Administrativo de Generación de Informe Oficial
 * Exclusivo SuperAdmin. Re-ejecuta de forma aislada e idempotente la generación del snapshot
 * del informe oficial para un ciclo ya CERRADO (CLOSED), sin alterar el estado financiero ni incrementos.
 */
exports.adminRetryCycleReportGenerationCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Usuario no autenticado.");
    }

    const authUid = request.auth.uid;
    const authEmail = (request.auth.token && request.auth.token.email) ? request.auth.token.email.toLowerCase() : "";
    const adminDoc = await db.collection("users").doc(authUid).get();

    let isSuperAdmin = false;
    let adminName = "SuperAdmin";

    if (
      authUid === "lpx4NLEEMkeh9EJFcG68oPMVdXF2" ||
      authEmail === "juanes9802@gmail.com" ||
      authEmail === "elcocalombiano1828@gmail.com" ||
      (request.auth.token && (request.auth.token.superadmin === true || request.auth.token.role === "superadmin"))
    ) {
      isSuperAdmin = true;
      if (adminDoc.exists && adminDoc.data().fullName) {
        adminName = adminDoc.data().fullName;
      }
    }

    if (!isSuperAdmin) {
      throw new HttpsError(
        "permission-denied",
        "Acceso denegado: Se requieren privilegios canónicos de SuperAdmin para reintentar la generación del informe."
      );
    }

    const { cycleId } = request.data || {};
    if (!cycleId || typeof cycleId !== "string" || !cycleId.trim()) {
      throw new HttpsError("invalid-argument", "El parámetro 'cycleId' es obligatorio.");
    }

    const targetCycleId = cycleId.trim();
    const cycleRef = db.collection("monthlyCycles").doc(targetCycleId);
    const cycleSnap = await cycleRef.get();

    if (!cycleSnap.exists) {
      throw new HttpsError("not-found", `El ciclo '${targetCycleId}' no existe en Firestore.`);
    }

    const cycleData = cycleSnap.data() || {};
    if (cycleData.status !== "CLOSED") {
      throw new HttpsError(
        "failed-precondition",
        `Solo ciclos en estado CLOSED admiten reintento de informe (estado actual: ${cycleData.status || "DESCONOCIDO"}).`
      );
    }

    const closureAttemptId = cycleData.lastClosureAttemptId || cycleData.closureAttemptId || `closure_${targetCycleId}_v${cycleData.closureVersion || 1}`;

    let reportResult;
    try {
      reportResult = await createCycleReportSnapshot(
        db,
        admin,
        targetCycleId,
        closureAttemptId,
        authUid,
        adminName,
        cycleData.closureNotes || "Reintento administrativo de informe",
        false
      );
    } catch (err) {
      console.error("[adminRetryCycleReportGenerationCallable] Error regenerando informe:", err);
      throw new HttpsError("internal", `Error regenerando el informe del ciclo ${targetCycleId}: ${err.message}`);
    }

    return {
      success: true,
      cycleId: targetCycleId,
      reportVersionId: reportResult ? reportResult.versionId : null,
      isIdempotent: Boolean(reportResult && reportResult.isIdempotent),
      message: `Informe para el ciclo ${targetCycleId} regenerado exitosamente (${reportResult ? reportResult.versionId : "v1"}).`,
    };
  }
);

/**
 * Cloud Function HTTPS Callable: Confirmación Administrativa de Aporte Externo en Efectivo
 * Exclusivo SuperAdmin. Valida recepción bancaria exacta del aporte externo en la etapa de preparación (PREPARING).
 * IMPORTANTE: No modifica users.currentCapital en esta etapa. El capital se activa formalmente en adminStartCycleCallable.
 */
exports.adminConfirmExternalContributionCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Usuario no autenticado.");
    }

    const authUid = request.auth.uid;
    const authEmail = (request.auth.token && request.auth.token.email) ? request.auth.token.email.toLowerCase() : "";
    const adminDoc = await db.collection("users").doc(authUid).get();

    // Verificación canónica exclusiva de SuperAdmin
    let isSuperAdmin = false;
    let adminName = "SuperAdmin";

    if (
      authUid === "lpx4NLEEMkeh9EJFcG68oPMVdXF2" ||
      authEmail === "juanes9802@gmail.com" ||
      authEmail === "elcocalombiano1828@gmail.com" ||
      (request.auth.token && (request.auth.token.superadmin === true || request.auth.token.role === "superadmin")) ||
      (adminDoc.exists && (adminDoc.data().role === "SUPERADMIN" || adminDoc.data().isSuperAdmin === true))
    ) {
      isSuperAdmin = true;
      if (adminDoc.exists && adminDoc.data().fullName) {
        adminName = adminDoc.data().fullName;
      }
    }

    if (!isSuperAdmin) {
      throw new HttpsError(
        "permission-denied",
        "Acceso denegado: Se requieren privilegios canónicos de SuperAdmin para confirmar aportes externos."
      );
    }

    const { cycleId, reinvestmentId, confirmedAmountCop, bankReference, notes } = request.data || {};

    if (!cycleId || typeof cycleId !== "string" || !cycleId.trim()) {
      throw new HttpsError("invalid-argument", "El parámetro 'cycleId' es obligatorio.");
    }
    if (!reinvestmentId || typeof reinvestmentId !== "string" || !reinvestmentId.trim()) {
      throw new HttpsError("invalid-argument", "El parámetro 'reinvestmentId' es obligatorio.");
    }

    const confirmedAmount = Math.round(Number(confirmedAmountCop));
    if (isNaN(confirmedAmount) || confirmedAmount <= 0) {
      throw new HttpsError("invalid-argument", "El monto confirmado debe ser un número entero positivo mayor a cero.");
    }

    const targetCycleId = cycleId.trim();
    const cleanReinvId = reinvestmentId.trim();
    const nowIso = new Date().toISOString();

    // 1. Transacción atómica sobre la solicitud canónica y ciclos A y B
    const reinvRef = db.collection("reinvestments").doc(cleanReinvId);
    let targetUid = "";
    let userCode = "";
    let userName = "";
    let requiredCashCop = 0;

    await db.runTransaction(async (transaction) => {
      const reinvSnap = await transaction.get(reinvRef);
      if (!reinvSnap.exists) {
        throw new HttpsError("not-found", `La solicitud de reinversión ${cleanReinvId} no existe.`);
      }

      const reinvData = reinvSnap.data() || {};
      targetUid = reinvData.userId || reinvData.userUid || "";
      userCode = reinvData.userCode || "";
      userName = reinvData.userName || "";

      // Guard targetCycleId
      if (reinvData.targetCycleId && reinvData.targetCycleId.trim() !== targetCycleId) {
        throw new HttpsError("failed-precondition", `CYCLE_LINK_MISMATCH: La solicitud está vinculada al ciclo objetivo ${reinvData.targetCycleId}, no a ${targetCycleId}.`);
      }

      // Validar B
      const cycleBRef = db.collection("monthlyCycles").doc(targetCycleId);
      const cycleBSnap = await transaction.get(cycleBRef);
      if (!cycleBSnap.exists) {
        throw new HttpsError("not-found", `El ciclo objetivo ${targetCycleId} no existe.`);
      }
      const cycleBData = cycleBSnap.data() || {};
      if (cycleBData.status !== "OPEN") {
        throw new HttpsError("failed-precondition", `TARGET_CYCLE_NOT_OPEN: El ciclo objetivo ${targetCycleId} debe estar OPEN.`);
      }
      if (cycleBData.operationalStatus !== "PREPARING") {
        throw new HttpsError("failed-precondition", `TARGET_CYCLE_NOT_PREPARING: El ciclo objetivo ${targetCycleId} debe estar en PREPARING.`);
      }
      if (!cycleBData.previousCycleId) {
        throw new HttpsError("failed-precondition", `TARGET_CYCLE_NO_PREVIOUS: El ciclo objetivo ${targetCycleId} no tiene ciclo previo.`);
      }

      // Validar A
      const sourceCycleId = cycleBData.previousCycleId;
      const cycleARef = db.collection("monthlyCycles").doc(sourceCycleId);
      const cycleASnap = await transaction.get(cycleARef);
      if (!cycleASnap.exists) {
        throw new HttpsError("not-found", `El ciclo previo ${sourceCycleId} no existe.`);
      }
      const cycleAData = cycleASnap.data() || {};
      if (cycleAData.status !== "CLOSED") {
        throw new HttpsError("failed-precondition", `PREDECESSOR_CYCLE_NOT_CLOSED: El ciclo previo ${sourceCycleId} debe estar CLOSED.`);
      }
      if (cycleAData.nextCycleId !== targetCycleId) {
        throw new HttpsError("failed-precondition", `CYCLE_LINK_MISMATCH: A.nextCycleId (${cycleAData.nextCycleId}) debe coincidir con B (${targetCycleId}).`);
      }

      if (reinvData.status !== "APPROVED" && reinvData.status !== "PREAPPROVED") {
        throw new HttpsError(
          "failed-precondition",
          `La solicitud debe estar en estado APPROVED para confirmar su aporte externo (estado actual: ${reinvData.status}).`
        );
      }

      requiredCashCop = Math.round(Number(reinvData.cashInjectionCop || 0));
      if (requiredCashCop <= 0) {
        throw new HttpsError(
          "failed-precondition",
          "Esta solicitud no requiere aporte externo de dinero nuevo (cashInjectionCop es 0)."
        );
      }

      const currentFundingStatus = reinvData.externalFundingStatus || "PENDING";
      if (currentFundingStatus !== "PENDING") {
        if (currentFundingStatus === "CONFIRMED" && Number(reinvData.confirmedAmountCop) === confirmedAmount) {
          return;
        }
        throw new HttpsError(
          "failed-precondition",
          `EXTERNAL_FUNDING_NOT_PENDING: El estado del aporte externo es '${currentFundingStatus}', se requiere PENDING.`
        );
      }

      // REGLA FINANCIERA ESTRICTA: NO SE ADMITEN APORTES PARCIALES
      if (confirmedAmount !== requiredCashCop) {
        throw new HttpsError(
          "invalid-argument",
          `INVALID_CONFIRMATION_AMOUNT: El aporte externo requerido es de exactamente $${requiredCashCop.toLocaleString("es-CO")} COP. No se permiten montos parciales ($${confirmedAmount.toLocaleString("es-CO")} COP). El aporte continúa en estado PENDING hasta recibir el valor exacto completo.`
        );
      }

      // Actualizar solicitud de reinversión con confirmación bancaria
      // IMPORTANTE: NO TOCAR users.currentCapital. El capital se activa en adminStartCycleCallable
      transaction.update(reinvRef, {
        externalFundingStatus: "CONFIRMED",
        confirmedAmountCop: confirmedAmount,
        confirmedAt: nowIso,
        confirmedByUid: authUid,
        confirmedByName: adminName,
        bankReference: (bankReference || "").trim(),
        notes: notes ? (reinvData.notes ? `${reinvData.notes} | ${notes.trim()}` : notes.trim()) : (reinvData.notes || ""),
        updatedAt: nowIso,
      });
    });

    // 3. Registrar auditoría autoritativa
    await db.collection("auditLogs").add({
      action: "EXTERNAL_CONTRIBUTION_CONFIRMED",
      performedBy: authUid,
      performedByName: adminName,
      cycleId: targetCycleId,
      targetEntity: cleanReinvId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      details: {
        reinvestmentId: cleanReinvId,
        userUid: targetUid,
        userCode,
        userName,
        confirmedAmountCop: confirmedAmount,
        requiredCashCop,
        bankReference: bankReference ? bankReference.trim() : null,
      },
    }).catch(() => {});

    // 4. Notificación determinística al inversionista
    if (targetUid) {
      const notifId = `notif_ext_cash_${cleanReinvId}_confirmed`;
      await db.collection("notifications").doc(notifId).set({
        id: notifId,
        userId: targetUid,
        userUid: targetUid,
        userCode,
        userName,
        cycleId: targetCycleId,
        type: "REINVESTMENT",
        title: "✅ Aporte Externo Confirmado",
        message: `Se ha verificado la recepción de tu aporte externo por $${confirmedAmount.toLocaleString("es-CO")} COP. Será activado al iniciar formalmente el ciclo operativo ${targetCycleId}.`,
        read: false,
        sentAt: nowIso,
        createdAt: nowIso,
        payload: {
          reinvestmentId: cleanReinvId,
          confirmedAmountCop: confirmedAmount,
        },
      }, { merge: true }).catch((err) => {
        console.warn("[adminConfirmExternalContributionCallable] Error enviando notificación:", err);
      });
    }

    return {
      success: true,
      cycleId: targetCycleId,
      reinvestmentId: cleanReinvId,
      externalFundingStatus: "CONFIRMED",
      confirmedAmountCop: confirmedAmount,
      message: `Aporte externo de $${confirmedAmount.toLocaleString("es-CO")} COP verificado exitosamente. Será activado al iniciar formalmente el ciclo operativo.`,
    };
  }
);

/**
 * Cloud Function HTTPS Callable: Resolver Conciliación de Aporte de Inyección
 * Exclusivo SuperAdmin. Permite resolver discrepancias entre confirmedAmountCop y cashInjectionCop.
 */
exports.adminResolveFundingReconciliationCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    // 1. Verificar SuperAdmin
    const { authUid, authEmail, createdByName } = await verifySuperAdminPrivileges(request);
    const adminName = createdByName || "SuperAdmin";

    const data = request.data || {};
    const { requestId, resolution, notes = "", clientRequestId } = data;

    if (!requestId || typeof requestId !== "string" || !requestId.trim()) {
      throw new HttpsError("invalid-argument", "El parámetro 'requestId' es obligatorio.");
    }
    if (!resolution || typeof resolution !== "string" || !resolution.trim()) {
      throw new HttpsError("invalid-argument", "El parámetro 'resolution' es obligatorio.");
    }
    if (!clientRequestId || typeof clientRequestId !== "string" || !clientRequestId.trim()) {
      throw new HttpsError("invalid-argument", "El parámetro 'clientRequestId' es obligatorio.");
    }

    const cleanRequestId = requestId.trim();
    const cleanResolution = resolution.trim();
    const cleanClientRequestId = clientRequestId.trim();

    // Idempotencia
    const idemRef = db.collection("idempotencyKeys").doc(`resolve_recon_${cleanClientRequestId}`);
    const reinvRef = db.collection("reinvestments").doc(cleanRequestId);

    let resultMsg = "";
    await db.runTransaction(async (transaction) => {
      const [idemSnap, reinvSnap] = await Promise.all([
        transaction.get(idemRef),
        transaction.get(reinvRef),
      ]);

      if (idemSnap.exists) {
        const idxData = idemSnap.data() || {};
        resultMsg = idxData.message || "Operación de conciliación resuelta con éxito (Idempotente).";
        return;
      }

      if (!reinvSnap.exists) {
        throw new HttpsError("not-found", `La solicitud ${cleanRequestId} no existe.`);
      }

      const reinvData = reinvSnap.data() || {};
      if (reinvData.fundingReconciliationStatus !== "NEEDS_REVIEW") {
        throw new HttpsError("failed-precondition", `La solicitud no está en estado NEEDS_REVIEW (estado actual: ${reinvData.fundingReconciliationStatus || 'OK'}).`);
      }

      // Reglas inmutables:
      // NO borrar/modificar: confirmedAmountCop, bankReference, confirmedAt, confirmedByUid, confirmedByName
      // NO convertir automáticamente una discrepancia en OK.
      // NO cambiar users.currentCapital durante la conciliación.
      
      const confirmedAmount = Number(reinvData.confirmedAmountCop || 0);
      const requiredCash = Number(reinvData.cashInjectionCop || 0);

      if (cleanResolution === "RESOLVE_MATCHING") {
        if (confirmedAmount === requiredCash) {
          // Coinciden, podemos pasar a OK!
          transaction.update(reinvRef, {
            fundingReconciliationStatus: "OK",
            fundingReconciliationReason: null,
            notes: notes ? (reinvData.notes ? `${reinvData.notes} | RESOLVED: ${notes.trim()}` : `RESOLVED: ${notes.trim()}`) : (reinvData.notes || ""),
            updatedAt: new Date().toISOString(),
          });
          resultMsg = "Conciliación resuelta exitosamente: El aporte verificado coincide matemáticamente con la inyección requerida.";
        } else {
          throw new HttpsError(
            "failed-precondition",
            `RECONCILIATION_AMOUNT_MISMATCH: El aporte verificado ($${confirmedAmount.toLocaleString("es-CO")} COP) no coincide con el capital requerido ($${requiredCash.toLocaleString("es-CO")} COP). Para resolver esta discrepancia se requiere reversión administrativa o ajuste manual futuro.`
          );
        }
      } else if (cleanResolution === "KEEP_REVIEW") {
        // Mantener en revisión
        transaction.update(reinvRef, {
          notes: notes ? (reinvData.notes ? `${reinvData.notes} | REVIEW_NOTE: ${notes.trim()}` : `REVIEW_NOTE: ${notes.trim()}`) : (reinvData.notes || ""),
          updatedAt: new Date().toISOString(),
        });
        resultMsg = "Nota de revisión agregada. La solicitud continúa en NEEDS_REVIEW.";
      } else {
        throw new HttpsError("invalid-argument", `Resolución '${cleanResolution}' no soportada en la Estrategia V1.`);
      }

      // Registrar idempotencia
      transaction.set(idemRef, {
        clientRequestId: cleanClientRequestId,
        requestId: cleanRequestId,
        resolution: cleanResolution,
        message: resultMsg,
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    // Auditoría
    await db.collection("auditLogs").add({
      action: "RECONCILIATION_RESOLVED",
      performedBy: authUid,
      performedByName: adminName,
      targetEntity: cleanRequestId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      details: {
        requestId: cleanRequestId,
        resolution: cleanResolution,
        message: resultMsg,
      },
    }).catch(() => {});

    return {
      success: true,
      message: resultMsg,
    };
  }
);

/**
 * Cloud Function HTTPS Callable: Radicar Solicitud de Desembolso (Exclusivo SuperAdmin)
 * Permite que la administración registre solicitudes de desembolso de forma autoritativa.
 */
exports.adminRequestDisbursementCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    // 1. Verificar SuperAdmin
    const { authUid, authEmail, createdByName } = await verifySuperAdminPrivileges(request);
    const adminName = createdByName || "SuperAdmin";

    const data = request.data || {};
    const {
      userId,
      sourceCycleId,
      amountCop,
      disbursementSource = "PROFIT",
      method,
      bankName = "",
      accountType = "",
      accountNumber = "",
      accountHolderName = "",
      idDocument = "",
      cashOffice = "",
      receiverId = "",
      receiverFullName = "",
      notes = "",
      clientRequestId,
    } = data;

    if (!clientRequestId || typeof clientRequestId !== "string" || !clientRequestId.trim()) {
      throw new HttpsError("invalid-argument", "El parámetro 'clientRequestId' es obligatorio para prevenir duplicados.");
    }
    if (!userId || typeof userId !== "string" || !userId.trim()) {
      throw new HttpsError("invalid-argument", "El parámetro 'userId' es obligatorio.");
    }
    if (!sourceCycleId || typeof sourceCycleId !== "string" || !sourceCycleId.trim()) {
      throw new HttpsError("invalid-argument", "El parámetro 'sourceCycleId' es obligatorio.");
    }
    
    const amt = Math.round(Number(amountCop));
    if (isNaN(amt) || amt <= 0) {
      throw new HttpsError("invalid-argument", "El monto de desembolso debe ser mayor a $0 COP.");
    }

    const cleanUserId = userId.trim();
    const cleanCycleId = sourceCycleId.trim();
    const cleanMethod = String(method || "TRANSFERENCIA").trim().toUpperCase();
    const cleanClientRequestId = clientRequestId.trim();

    // Idempotencia
    const idemRef = db.collection("idempotencyKeys").doc(`disb_req_${cleanClientRequestId}`);
    const id = `disb_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const disbRef = db.collection("disbursements").doc(id);

    let savedRequest = null;
    let messageResult = "";

    await db.runTransaction(async (transaction) => {
      const idemSnap = await transaction.get(idemRef);
      if (idemSnap.exists) {
        const idxData = idemSnap.data() || {};
        savedRequest = idxData.disbursement;
        messageResult = "Solicitud de desembolso recuperada exitosamente (Idempotente).";
        return;
      }

      // Validar usuario
      const userSnap = await db.collection("users").doc(cleanUserId).get();
      if (!userSnap.exists) {
        throw new HttpsError("not-found", "Inversionista no encontrado.");
      }
      const userData = userSnap.data() || {};

      const nowIso = new Date().toISOString();
      const newRequest = {
        id,
        userId: cleanUserId,
        userUid: cleanUserId,
        userCode: userData.userCode || "",
        userName: userData.fullName || "",
        sourceCycleId: cleanCycleId,
        amountCop: amt,
        disbursementSource,
        method: cleanMethod,
        bankName: cleanMethod === "TRANSFERENCIA" ? bankName.trim() : null,
        accountType: cleanMethod === "TRANSFERENCIA" ? accountType.trim() : null,
        accountNumber: cleanMethod === "TRANSFERENCIA" ? accountNumber.trim() : null,
        accountHolderName: cleanMethod === "TRANSFERENCIA" ? accountHolderName.trim() : null,
        idDocument: idDocument.trim(),
        cashOffice: cleanMethod === "EFECTIVO" ? (cashOffice.trim() || "Sede Principal de Tesorería") : null,
        receiverId: cleanMethod === "EFECTIVO" ? (receiverId.trim() || idDocument.trim()) : null,
        receiverFullName: cleanMethod === "EFECTIVO" ? (receiverFullName.trim() || userData.fullName) : null,
        status: "PENDING",
        createdAt: nowIso,
        resolvedAt: null,
        resolvedBy: null,
        notes: notes.trim(),
        clientRequestId: cleanClientRequestId,
      };

      // Guardar directamente en Firestore desde la transacción
      transaction.set(disbRef, newRequest);

      // Registrar llave de idempotencia
      transaction.set(idemRef, {
        clientRequestId: cleanClientRequestId,
        disbursement: newRequest,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      savedRequest = newRequest;
      messageResult = `Solicitud de desembolso radicada exitosamente con código ${id}.`;
    });

    if (messageResult.includes("(Idempotente)")) {
      return {
        success: true,
        disbursement: savedRequest,
        message: messageResult,
      };
    }

    // Acciones secundarias no transaccionales de cara a auditoría y notificaciones
    if (savedRequest) {
      const nowIso = new Date().toISOString();
      // Registro de Auditoría
      await db.collection("auditLogs").add({
        action: "DISBURSEMENT_REQUESTED",
        performedBy: authUid,
        performedByName: adminName,
        cycleId: cleanCycleId,
        targetEntity: id,
        newValue: amt,
        timestamp: nowIso,
        details: {
          method: cleanMethod,
          amountCop: amt,
          userCode: savedRequest.userCode,
          userName: savedRequest.userName,
          clientRequestId: cleanClientRequestId,
        },
      }).catch(() => {});

      // Notificación determinística al inversionista
      const notifId = `notif_disb_req_${id}`;
      await db.collection("notifications").doc(notifId).set({
        id: notifId,
        userId: cleanUserId,
        userUid: cleanUserId,
        userCode: savedRequest.userCode || "",
        userName: savedRequest.userName || "",
        cycleId: cleanCycleId,
        type: "DISBURSEMENT",
        title: "Solicitud de Desembolso Radicada",
        message: `Tu solicitud de desembolso por $${amt.toLocaleString("es-CO")} COP (${
          cleanMethod === "EFECTIVO" ? "Efectivo en Taquilla" : "Transferencia Bancaria"
        }) fue radicada con éxito por administración.`,
        payload: {
          cycleId: cleanCycleId,
          usdAmount: 0,
          copAmount: amt,
          userProfitCop: 0,
        },
        isRead: false,
        sentAt: nowIso,
        readAt: null,
      }).catch(() => {});
    }

    return {
      success: true,
      disbursement: savedRequest,
      message: messageResult,
    };
  }
);

/**
 * Cloud Function HTTPS Callable: Resolver Solicitud de Desembolso (Exclusivo SuperAdmin)
 * Permite que la administración apruebe, liquide (pague) o rechace un desembolso.
 */
exports.adminResolveDisbursementCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    // 1. Verificar SuperAdmin
    const { authUid, authEmail, createdByName } = await verifySuperAdminPrivileges(request);
    const adminName = createdByName || "SuperAdmin";

    const data = request.data || {};
    const { requestId, action, notes = "", voucher = "" } = data;

    if (!requestId || typeof requestId !== "string" || !requestId.trim()) {
      throw new HttpsError("invalid-argument", "El parámetro 'requestId' es obligatorio.");
    }
    if (!action || typeof action !== "string" || !action.trim()) {
      throw new HttpsError("invalid-argument", "El parámetro 'action' es obligatorio.");
    }

    const cleanRequestId = requestId.trim();
    const cleanAction = action.trim().toUpperCase(); // APPROVE, PAY, REJECT
    const nowIso = new Date().toISOString();

    const disbRef = db.collection("disbursements").doc(cleanRequestId);
    let updatedDisb = null;

    await db.runTransaction(async (transaction) => {
      const disbSnap = await transaction.get(disbRef);
      if (!disbSnap.exists) {
        throw new HttpsError("not-found", "La solicitud de desembolso no existe.");
      }

      const disbData = disbSnap.data() || {};
      
      if (cleanAction === "APPROVE") {
        if (disbData.status !== "PENDING") {
          throw new HttpsError("failed-precondition", `La solicitud ya no está PENDING (estado actual: ${disbData.status}).`);
        }
        updatedDisb = {
          ...disbData,
          status: "APPROVED",
          resolvedAt: nowIso,
          resolvedBy: adminName,
          updatedAt: nowIso,
        };
        transaction.set(disbRef, updatedDisb);
      } else if (cleanAction === "PAY") {
        if (disbData.status !== "APPROVED") {
          throw new HttpsError("failed-precondition", `Solo las solicitudes en estado APPROVED pueden ser liquidadas (PAID) (estado actual: ${disbData.status}).`);
        }
        updatedDisb = {
          ...disbData,
          status: "PAID",
          resolvedAt: nowIso,
          resolvedBy: adminName,
          paidAt: nowIso,
          paymentVoucher: voucher.trim() || null,
          notes: voucher.trim() ? `${disbData.notes ? disbData.notes + " | " : ""}Liquidado: ${voucher.trim()}` : disbData.notes,
          updatedAt: nowIso,
        };
        transaction.set(disbRef, updatedDisb);
      } else if (cleanAction === "REJECT") {
        if (disbData.status !== "PENDING") {
          throw new HttpsError("failed-precondition", `Solo las solicitudes en estado PENDING pueden ser rechazadas (estado actual: ${disbData.status}).`);
        }
        updatedDisb = {
          ...disbData,
          status: "REJECTED",
          resolvedAt: nowIso,
          resolvedBy: adminName,
          rejectionReason: notes.trim() || null,
          notes: notes.trim() ? `${disbData.notes ? disbData.notes + " | " : ""}Rechazo: ${notes.trim()}` : disbData.notes,
          updatedAt: nowIso,
        };
        transaction.set(disbRef, updatedDisb);
      } else {
        throw new HttpsError("invalid-argument", `Acción '${cleanAction}' no soportada.`);
      }
    });

    // Auditoría
    await db.collection("auditLogs").add({
      action: `DISBURSEMENT_${cleanAction}D`,
      performedBy: authUid,
      performedByName: adminName,
      targetEntity: cleanRequestId,
      timestamp: nowIso,
      details: {
        requestId: cleanRequestId,
        amountCop: updatedDisb.amountCop,
        userCode: updatedDisb.userCode,
      },
    }).catch(() => {});

    // Notificación
    let title = "";
    let message = "";
    if (cleanAction === "APPROVE") {
      title = "¡Desembolso Aprobado!";
      message = `Tu desembolso por $${updatedDisb.amountCop.toLocaleString("es-CO")} COP ha sido aprobado por Tesorería.`;
    } else if (cleanAction === "PAY") {
      title = "¡Desembolso Liquidado y Entregado!";
      message = `Tu desembolso por $${updatedDisb.amountCop.toLocaleString("es-CO")} COP ha sido procesado y entregado exitosamente.`;
    } else if (cleanAction === "REJECT") {
      title = "Solicitud de Desembolso Rechazada";
      message = `Tu solicitud de desembolso por $${updatedDisb.amountCop.toLocaleString("es-CO")} COP no pudo ser tramitada.`;
    }

    if (updatedDisb && updatedDisb.userId) {
      const notifId = `notif_disb_res_${cleanRequestId}_${cleanAction.toLowerCase()}`;
      await db.collection("notifications").doc(notifId).set({
        id: notifId,
        userId: updatedDisb.userId,
        userUid: updatedDisb.userId,
        userCode: updatedDisb.userCode || "",
        userName: updatedDisb.userName || "",
        cycleId: updatedDisb.sourceCycleId || "",
        type: "DISBURSEMENT",
        title,
        message,
        payload: {
          copAmount: updatedDisb.amountCop,
        },
        isRead: false,
        sentAt: nowIso,
        readAt: null,
      }).catch(() => {});
    }

    return {
      success: true,
      disbursement: updatedDisb,
      message: `Desembolso resuelto con éxito (${cleanAction}).`,
    };
  }
);

/**
 * Cloud Function HTTPS Callable: Inicio Operativo Atómico de Ciclo (Freeze de Capitales)
 * Exclusivo SuperAdmin. Transición autoritativa: PREPARING -> STARTED.
 * Realiza congelamiento atómico de capitales en cycleUserResults y activa aportes externos confirmados.
 * Si requiredStartWrites > 450, aborta estrictamente antes de modificar ningún documento.
 */

/**
 * Configura una cuenta ADMIN existente como participante financiero.
 *
 * IMPORTANTE:
 * - NO cambia el rol de seguridad.
 * - Solo permite ciclos PREPARING autoritativos.
 * - SELF_ADMIN siempre es 100% participante / 0% administración.
 * - No crea cycleUserResults: eso lo hace adminStartCycleCallable
 *   al congelar la cohorte del ciclo.
 */
exports.adminConfigureTradingParticipantCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const {
      authUid,
      createdByName,
    } = await verifySuperAdminPrivileges(request);


    // SELF_ADMIN: esta operacion es exclusiva del
    // SuperAdmin canonico. No basta con role === ADMIN.
    const callerUid = request.auth && request.auth.uid
      ? request.auth.uid
      : "";

    const callerEmail = (
      request.auth &&
      request.auth.token &&
      request.auth.token.email
        ? request.auth.token.email
        : ""
    )
      .toString()
      .trim()
      .toLowerCase();

    const isCanonicalSelfAdmin =
      callerUid === "lpx4NLEEMkeh9EJFcG68oPMVdXF2" ||
      callerEmail === "juanes9802@gmail.com";

    if (!isCanonicalSelfAdmin) {
      throw new HttpsError(
        "permission-denied",
        "SELF_ADMIN_CANONICAL_SUPERADMIN_ONLY"
      );
    }

    const {
      targetUid,
      currentCapital,
      targetCycleId,
    } = request.data || {};

    const cleanTargetUid =
      typeof targetUid === "string"
        ? targetUid.trim()
        : "";

    if (cleanTargetUid !== callerUid) {
      throw new HttpsError(
        "permission-denied",
        "SELF_ADMIN_TARGET_MUST_BE_CALLER"
      );
    }


    const cleanCycleId =
      typeof targetCycleId === "string"
        ? targetCycleId.trim()
        : "";

    const parsedCapital =
      Number(currentCapital);

    if (!cleanTargetUid) {
      throw new HttpsError(
        "invalid-argument",
        "TARGET_UID_REQUIRED"
      );
    }

    if (!cleanCycleId) {
      throw new HttpsError(
        "invalid-argument",
        "TARGET_CYCLE_REQUIRED"
      );
    }

    if (
      !Number.isFinite(parsedCapital) ||
      parsedCapital < 2000000 ||
      parsedCapital > Number.MAX_SAFE_INTEGER
    ) {
      throw new HttpsError(
        "invalid-argument",
        "INVALID_TRADING_CAPITAL: El capital debe ser igual o superior a $2.000.000 COP."
      );
    }

    const roundedCapital =
      Math.round(parsedCapital);

    // El target puede llegar como:
    // 1. ID documental canónico de /users
    // 2. Firebase Auth UID almacenado en el campo users.uid
    //
    // Caso real SuperAdmin:
    // documento: users/usr_admin
    // uid: Firebase Auth UID
    const directUserRef =
      db.collection("users").doc(cleanTargetUid);

    const userByUidQuery =
      db
        .collection("users")
        .where("uid", "==", cleanTargetUid)
        .limit(2);

    const cycleRef =
      db.collection("monthlyCycles").doc(cleanCycleId);

    const settingsRef =
      db.collection("settings").doc("global_config");

    const auditRef =
      db.collection("auditLogs").doc();

    const nowIso =
      new Date().toISOString();

    let responseParticipant = null;

    await db.runTransaction(
      async (transaction) => {
        // Todas las lecturas primero.
        // --------------------------------------------------
        // RESOLUCION CANONICA DE CUENTA ADMIN
        // --------------------------------------------------
        // Primero intentamos /users/{targetUid}.
        // Si no existe, resolvemos por el campo uid.
        //
        // Esto permite conservar IDs legacy como usr_admin
        // sin romper la identidad real de Firebase Auth.
        const directUserSnap =
          await transaction.get(directUserRef);

        const cycleSnap =
          await transaction.get(cycleRef);

        const settingsSnap =
          await transaction.get(settingsRef);

        let userSnap =
          directUserSnap;

        let userRef =
          directUserRef;

        let resolvedUserDocId =
          cleanTargetUid;

        if (!directUserSnap.exists) {
          const userByUidSnap =
            await transaction.get(userByUidQuery);

          if (userByUidSnap.empty) {
            throw new HttpsError(
              "not-found",
              "TARGET_USER_NOT_FOUND"
            );
          }

          if (userByUidSnap.size !== 1) {
            throw new HttpsError(
              "failed-precondition",
              "TARGET_USER_UID_AMBIGUOUS"
            );
          }

          userSnap =
            userByUidSnap.docs[0];

          userRef =
            userSnap.ref;

          resolvedUserDocId =
            userSnap.id;
        }

        const frozenResultRef =
          db
            .collection("cycleUserResults")
            .doc(
              `${cleanCycleId}_${resolvedUserDocId}`
            );

        const frozenResultSnap =
          await transaction.get(frozenResultRef);

        if (!cycleSnap.exists) {
          throw new HttpsError(
            "not-found",
            "TARGET_CYCLE_NOT_FOUND"
          );
        }

        if (!settingsSnap.exists) {
          throw new HttpsError(
            "failed-precondition",
            "GLOBAL_CONFIG_NOT_FOUND"
          );
        }

        const user =
          userSnap.data() || {};

        const cycle =
          cycleSnap.data() || {};

        const settings =
          settingsSnap.data() || {};

        // --------------------------------------------------
        // El rol administrativo se conserva.
        // --------------------------------------------------

        if (
          user.role !== "ADMIN" &&
          user.role !== "SUPERADMIN"
        ) {
          throw new HttpsError(
            "failed-precondition",
            "SELF_ADMIN_REQUIRES_ADMIN_ROLE"
          );
        }

        if (user.status !== "ACTIVE") {
          throw new HttpsError(
            "failed-precondition",
            "TARGET_ADMIN_MUST_BE_ACTIVE"
          );
        }

        // --------------------------------------------------
        // Solo se puede ingresar a la cohorte PREPARING.
        // Nunca a un ciclo STARTED.
        // --------------------------------------------------

        if (
          cycle.operationalStatus !== "PREPARING"
        ) {
          throw new HttpsError(
            "failed-precondition",
            "TARGET_CYCLE_NOT_PREPARING"
          );
        }

        if (cycle.status !== "OPEN") {
          throw new HttpsError(
            "failed-precondition",
            "TARGET_CYCLE_NOT_OPEN"
          );
        }

        if (
          settings.preparingCycleId !== cleanCycleId
        ) {
          throw new HttpsError(
            "failed-precondition",
            "TARGET_CYCLE_NOT_AUTHORITATIVE_PREPARING"
          );
        }

        if (cycle.isStarting === true) {
          throw new HttpsError(
            "failed-precondition",
            "TARGET_CYCLE_IS_STARTING"
          );
        }

        // Si ya existe snapshot congelado, no se toca.
        if (frozenResultSnap.exists) {
          throw new HttpsError(
            "failed-precondition",
            "TARGET_USER_ALREADY_FROZEN_IN_CYCLE"
          );
        }

        const category =
          getCanonicalCategoryForCapital(
            roundedCapital
          );

        const existingBaseCapital =
          Number(user.baseCapital || 0);

        const nextBaseCapital =
          (
            user.participatesInTrading === true &&
            existingBaseCapital > 0
          )
            ? existingBaseCapital
            : roundedCapital;

        // --------------------------------------------------
        // Perfil financiero autoritativo.
        // --------------------------------------------------

        transaction.update(
          userRef,
          {
            participatesInTrading: true,

            commissionMode:
              "SELF_ADMIN",

            currentCapital:
              roundedCapital,

            baseCapital:
              nextBaseCapital,

            currency:
              "COP",

            category,

            userPercentage:
              100,

            adminPercentage:
              0,

            entryCycleId:
              cleanCycleId,

            tradingConfiguredAt:
              nowIso,

            tradingConfiguredByUid:
              authUid,

            tradingConfiguredByName:
              createdByName,

            updatedAt:
              admin.firestore
                .FieldValue
                .serverTimestamp(),
          }
        );

        // Cambiar la cohorte invalida cualquier preflight
        // de START que estuviera utilizando una versión vieja.
        transaction.update(
          cycleRef,
          {
            cohortVersion:
              admin.firestore
                .FieldValue
                .increment(1),

            updatedAt:
              nowIso,
          }
        );

        transaction.set(
          auditRef,
          {
            action:
              "ADMIN_TRADING_PARTICIPATION_CONFIGURED",

            performedBy:
              authUid,

            performedByName:
              createdByName,

            targetEntity:
              cleanTargetUid,

            cycleId:
              cleanCycleId,

            timestamp:
              admin.firestore
                .FieldValue
                .serverTimestamp(),

            details: {
              targetUid:
                cleanTargetUid,

              resolvedUserDocId:
                resolvedUserDocId,

              email:
                user.email || "",

              fullName:
                user.fullName || "",

              securityRole:
                user.role || "ADMIN",

              roleChanged:
                false,

              participatesInTrading:
                true,

              commissionMode:
                "SELF_ADMIN",

              currentCapital:
                roundedCapital,

              baseCapital:
                nextBaseCapital,

              category,

              userPercentage:
                100,

              adminPercentage:
                0,

              entryCycleId:
                cleanCycleId,
            },
          }
        );

        responseParticipant = {
          uid:
            user.uid || cleanTargetUid,

          fullName:
            user.fullName || "",

          email:
            user.email || "",

          role:
            user.role || "ADMIN",

          status:
            user.status || "ACTIVE",

          participatesInTrading:
            true,

          commissionMode:
            "SELF_ADMIN",

          currentCapital:
            roundedCapital,

          baseCapital:
            nextBaseCapital,

          category,

          userPercentage:
            100,

          adminPercentage:
            0,

          entryCycleId:
            cleanCycleId,
        };
      }
    );

    return {
      success: true,

      participant:
        responseParticipant,

      message:
        `Participación financiera configurada correctamente. Capital: $${roundedCapital.toLocaleString("es-CO")} COP. Split: 100% / 0%.`,
    };
  }
);



/**
 * Permite al SuperAdmin corregir el capital operativo de un inversionista
 * antes del inicio del ciclo.
 *
 * SEGURIDAD:
 * - Solo SuperAdmin.
 * - Solo cuando existe un ciclo PREPARING autoritativo.
 * - Bloqueado si existe un ciclo operativo STARTED.
 * - No modifica snapshots congelados ni resultados del ciclo.
 * - Firestore Rules siguen bloqueando cambios financieros client-side.
 */
exports.adminUpdateInvestorCapitalCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const {
      authUid,
      createdByName,
    } = await verifySuperAdminPrivileges(request);

    const {
      targetUid,
      currentCapital,
      userPercentage,
      adminPercentage,
    } = request.data || {};

    const cleanTargetUid =
      typeof targetUid === "string"
        ? targetUid.trim()
        : "";

    const parsedCapital =
      Number(currentCapital);

    const splitWasProvided =
      userPercentage !== undefined ||
      adminPercentage !== undefined;

    const parsedUserPercentage =
      Number(userPercentage);

    const parsedAdminPercentage =
      Number(adminPercentage);

    if (!cleanTargetUid) {
      throw new HttpsError(
        "invalid-argument",
        "TARGET_UID_REQUIRED"
      );
    }

    if (
      !Number.isFinite(parsedCapital) ||
      parsedCapital < 2000000 ||
      parsedCapital > Number.MAX_SAFE_INTEGER
    ) {
      throw new HttpsError(
        "invalid-argument",
        "INVALID_TRADING_CAPITAL: El capital debe ser igual o superior a $2.000.000 COP."
      );
    }

    const roundedCapital =
      Math.round(parsedCapital);

    const settingsRef =
      db.collection("settings").doc("global_config");

    const settingsSnap =
      await settingsRef.get();

    if (!settingsSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "GLOBAL_CONFIG_NOT_FOUND"
      );
    }

    const settings =
      settingsSnap.data() || {};

    const preparingCycleId =
      typeof settings.preparingCycleId === "string"
        ? settings.preparingCycleId.trim()
        : "";

    const operationalCycleId =
      typeof settings.operationalCycleId === "string"
        ? settings.operationalCycleId.trim()
        : "";

    if (operationalCycleId) {
      throw new HttpsError(
        "failed-precondition",
        "CAPITAL_EDIT_BLOCKED_DURING_OPERATIONAL_CYCLE"
      );
    }

    if (!preparingCycleId) {
      throw new HttpsError(
        "failed-precondition",
        "NO_PREPARING_CYCLE_AVAILABLE"
      );
    }

    const directRef =
      db.collection("users").doc(cleanTargetUid);

    const directSnap =
      await directRef.get();

    let userRef = null;
    let userSnap = null;

    if (directSnap.exists) {
      userRef = directRef;
      userSnap = directSnap;
    } else {
      const uidQuery =
        await db
          .collection("users")
          .where("uid", "==", cleanTargetUid)
          .limit(2)
          .get();

      if (uidQuery.empty) {
        throw new HttpsError(
          "not-found",
          "TARGET_USER_NOT_FOUND"
        );
      }

      if (uidQuery.size > 1) {
        throw new HttpsError(
          "failed-precondition",
          "TARGET_USER_UID_AMBIGUOUS"
        );
      }

      userSnap =
        uidQuery.docs[0];

      userRef =
        userSnap.ref;
    }

    const resolvedUserDocId =
      userRef.id;

    const cycleRef =
      db.collection("monthlyCycles").doc(preparingCycleId);

    const frozenResultRef =
      db
        .collection("cycleUserResults")
        .doc(`${preparingCycleId}_${resolvedUserDocId}`);

    const [
      cycleSnap,
      frozenResultSnap,
    ] = await Promise.all([
      cycleRef.get(),
      frozenResultRef.get(),
    ]);

    if (!cycleSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "PREPARING_CYCLE_NOT_FOUND"
      );
    }

    const cycle =
      cycleSnap.data() || {};

    if (cycle.operationalStatus !== "PREPARING") {
      throw new HttpsError(
        "failed-precondition",
        "CAPITAL_EDIT_REQUIRES_PREPARING_CYCLE"
      );
    }

    if (frozenResultSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "TARGET_USER_ALREADY_FROZEN_IN_CYCLE"
      );
    }

    const user =
      userSnap.data() || {};

    const isSelfAdmin =
      user.commissionMode === "SELF_ADMIN";

    const previousUserPercentage =
      Number(user.userPercentage);

    const previousAdminPercentage =
      Number(user.adminPercentage);

    let effectiveUserPercentage;
    let effectiveAdminPercentage;

    if (isSelfAdmin) {
      effectiveUserPercentage = 100;
      effectiveAdminPercentage = 0;
    } else if (!splitWasProvided) {
      effectiveUserPercentage =
        Number.isFinite(previousUserPercentage)
          ? previousUserPercentage
          : 75;

      effectiveAdminPercentage =
        Number.isFinite(previousAdminPercentage)
          ? previousAdminPercentage
          : 25;
    } else {
      if (
        !Number.isFinite(parsedUserPercentage) ||
        !Number.isFinite(parsedAdminPercentage)
      ) {
        throw new HttpsError(
          "invalid-argument",
          "INVALID_PERCENTAGE_SPLIT"
        );
      }

      effectiveUserPercentage =
        Math.round(parsedUserPercentage * 100) / 100;

      effectiveAdminPercentage =
        Math.round(parsedAdminPercentage * 100) / 100;

      if (
        effectiveUserPercentage <= 0 ||
        effectiveUserPercentage > 100 ||
        effectiveAdminPercentage < 0 ||
        effectiveAdminPercentage >= 100
      ) {
        throw new HttpsError(
          "invalid-argument",
          "INVALID_PERCENTAGE_RANGE"
        );
      }

      const percentageTotal =
        Math.round(
          (
            effectiveUserPercentage +
            effectiveAdminPercentage
          ) * 100
        ) / 100;

      if (Math.abs(percentageTotal - 100) > 0.01) {
        throw new HttpsError(
          "invalid-argument",
          "INVALID_PERCENTAGE_TOTAL: Los porcentajes deben sumar exactamente 100%."
        );
      }
    }

    const previousCapital =
      Number(user.currentCapital || 0);

    const previousCategory =
      user.category || null;

    const category =
      getCanonicalCategoryForCapital(
        roundedCapital
      );

    const nowIso =
      new Date().toISOString();

    await db.runTransaction(
      async (transaction) => {
        const [
          freshSettingsSnap,
          freshCycleSnap,
          freshUserSnap,
          freshFrozenSnap,
        ] = await Promise.all([
          transaction.get(settingsRef),
          transaction.get(cycleRef),
          transaction.get(userRef),
          transaction.get(frozenResultRef),
        ]);

        if (
          !freshSettingsSnap.exists ||
          !freshCycleSnap.exists ||
          !freshUserSnap.exists
        ) {
          throw new HttpsError(
            "failed-precondition",
            "CAPITAL_EDIT_CONTEXT_CHANGED"
          );
        }

        const freshSettings =
          freshSettingsSnap.data() || {};

        const freshCycle =
          freshCycleSnap.data() || {};

        if (
          freshSettings.preparingCycleId !== preparingCycleId ||
          freshSettings.operationalCycleId
        ) {
          throw new HttpsError(
            "failed-precondition",
            "CAPITAL_EDIT_CONTEXT_CHANGED"
          );
        }

        if (
          freshCycle.operationalStatus !== "PREPARING"
        ) {
          throw new HttpsError(
            "failed-precondition",
            "CAPITAL_EDIT_REQUIRES_PREPARING_CYCLE"
          );
        }

        if (freshFrozenSnap.exists) {
          throw new HttpsError(
            "failed-precondition",
            "TARGET_USER_ALREADY_FROZEN_IN_CYCLE"
          );
        }

        transaction.update(
          userRef,
          {
            currentCapital:
              roundedCapital,

            category,

            userPercentage:
              effectiveUserPercentage,

            adminPercentage:
              effectiveAdminPercentage,

            updatedAt:
              nowIso,

            updatedBy:
              authUid,
          }
        );
      }
    );

    await db.collection("auditLogs").add({
      action:
        "ADMIN_INVESTOR_CAPITAL_UPDATED",

      performedBy:
        authUid,

      performedByName:
        createdByName,

      cycleId:
        preparingCycleId,

      targetEntity:
        resolvedUserDocId,

      timestamp:
        admin.firestore.FieldValue.serverTimestamp(),

      previousValue:
        previousCapital,

      newValue:
        roundedCapital,

      details: {
        targetUserDocId:
          resolvedUserDocId,

        targetUserUid:
          user.uid || cleanTargetUid,

        previousCapital,
        newCapital:
          roundedCapital,

        previousCategory,
        newCategory:
          category,

        previousUserPercentage:
          Number.isFinite(previousUserPercentage)
            ? previousUserPercentage
            : null,

        newUserPercentage:
          effectiveUserPercentage,

        previousAdminPercentage:
          Number.isFinite(previousAdminPercentage)
            ? previousAdminPercentage
            : null,

        newAdminPercentage:
          effectiveAdminPercentage,

        preparingCycleId,
      },
    }).catch(() => {});

    return {
      success: true,

      targetUserDocId:
        resolvedUserDocId,

      currentCapital:
        roundedCapital,

      category,

      userPercentage:
        effectiveUserPercentage,

      adminPercentage:
        effectiveAdminPercentage,

      preparingCycleId,

      message:
        `Condiciones financieras actualizadas correctamente: $${roundedCapital.toLocaleString("es-CO")} COP, ${effectiveUserPercentage}% inversionista / ${effectiveAdminPercentage}% administracion.`,
    };
  }
);


exports.adminStartCycleCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Usuario no autenticado.");
    }

    const authUid = request.auth.uid;
    const authEmail = (request.auth.token && request.auth.token.email) ? request.auth.token.email.toLowerCase() : "";
    const adminDoc = await db.collection("users").doc(authUid).get();

    // Verificación canónica exclusiva de SuperAdmin
    let isSuperAdmin = false;
    let adminName = "SuperAdmin";

    if (
      authUid === "lpx4NLEEMkeh9EJFcG68oPMVdXF2" ||
      authEmail === "juanes9802@gmail.com" ||
      authEmail === "elcocalombiano1828@gmail.com" ||
      (request.auth.token && (request.auth.token.superadmin === true || request.auth.token.role === "superadmin")) ||
      (adminDoc.exists && (adminDoc.data().role === "SUPERADMIN" || adminDoc.data().isSuperAdmin === true))
    ) {
      isSuperAdmin = true;
      if (adminDoc.exists && adminDoc.data().fullName) {
        adminName = adminDoc.data().fullName;
      }
    }

    if (!isSuperAdmin) {
      throw new HttpsError(
        "permission-denied",
        "Acceso denegado: Se requieren privilegios canónicos de SuperAdmin para iniciar operativamente un ciclo."
      );
    }

    const { cycleId, clientRequestId } = request.data || {};
    if (!cycleId || typeof cycleId !== "string" || !cycleId.trim()) {
      throw new HttpsError("invalid-argument", "El parámetro 'cycleId' es obligatorio.");
    }

    const targetCycleId = cycleId.trim();
    const cycleRef = db.collection("monthlyCycles").doc(targetCycleId);
    const nowIso = new Date().toISOString();
    const startAttemptId = crypto.randomUUID();

    // 1. Verificación preliminar y adquisición de Lock de Inicio (isStarting)
    const initialCycleSnap = await cycleRef.get();
    if (!initialCycleSnap.exists) {
      throw new HttpsError("not-found", `El ciclo ${targetCycleId} no existe.`);
    }

    const initialCycleData = initialCycleSnap.data() || {};

    if (initialCycleData.status !== "OPEN" && initialCycleData.status !== "REOPENED") {
      throw new HttpsError(
        "failed-precondition",
        `El ciclo ${targetCycleId} está en estado '${initialCycleData.status}' (solo ciclos OPEN o REOPENED pueden iniciarse).`
      );
    }

    if (initialCycleData.operationalStatus === "STARTED") {
      // Idempotencia: si ya está STARTED con el mismo clientRequestId, retornar éxito
      if (clientRequestId && initialCycleData.lastStartRequestId === clientRequestId) {
        return {
          success: true,
          cycleId: targetCycleId,
          alreadyStarted: true,
          operationalStatus: "STARTED",
          startedAt: initialCycleData.startedAt,
          initialManagedCapitalCop: initialCycleData.initialManagedCapitalCop || 0,
          initialActiveUsersCount: initialCycleData.initialActiveUsersCount || 0,
          message: `El ciclo ${targetCycleId} ya fue iniciado operativamente previamente (idempotente).`,
        };
      }
      throw new HttpsError(
        "failed-precondition",
        `CYCLE_ALREADY_STARTED: El ciclo ${targetCycleId} ya fue iniciado operativamente en ${initialCycleData.startedAt || "fecha previa"}.`
      );
    }

    // Adquisición del Lock de Inicio con protección contra procesos concurrentes
    await db.runTransaction(async (transaction) => {
      const cSnap = await transaction.get(cycleRef);
      if (!cSnap.exists) {
        throw new HttpsError("not-found", `El ciclo ${targetCycleId} no existe.`);
      }
      const cData = cSnap.data() || {};
      if (cData.operationalStatus === "STARTED") {
        if (clientRequestId && cData.lastStartRequestId === clientRequestId) return;
        throw new HttpsError("failed-precondition", "El ciclo ya fue iniciado por otro administrador.");
      }
      if (cData.isStarting === true) {
        const lockAgeMs = cData.startingStartedAt ? Date.now() - new Date(cData.startingStartedAt).getTime() : 0;
        if (lockAgeMs < 120000) {
          throw new HttpsError(
            "failed-precondition",
            "START_LOCK_ACTIVE: El ciclo ya tiene una inicialización en progreso. Por favor espera a que finalice."
          );
        }
      }

      transaction.update(cycleRef, {
        isStarting: true,
        startingStartedAt: nowIso,
        startingByUid: authUid,
        startingByName: adminName,
        startAttemptId,
      });
    });

    const safelyReleaseStartLock = async () => {
      try {
        await cycleRef.update({
          isStarting: false,
          startingStartedAt: null,
          startingByUid: null,
          startingByName: null,
          startAttemptId: null,
        });
      } catch (err) {
        console.error("[adminStartCycleCallable] Error liberando start lock:", err);
      }
    };

    try {
      // 1. Validar ciclo B
      const cycleBData = initialCycleData;
      if (cycleBData.operationalStatus !== "PREPARING") {
        await safelyReleaseStartLock();
        throw new HttpsError("failed-precondition", `TARGET_CYCLE_NOT_PREPARING: El ciclo ${targetCycleId} debe estar en estado PREPARING.`);
      }

      const expectedCohortVersion = Number(cycleBData.cohortVersion || 1);
      let sourceCycleId = null;
      let prevUserResultsMap = new Map();

      if (!cycleBData.previousCycleId) {
        // === RAMA GÉNESIS: GUARD NO-HISTORY ESTRICTO (FAIL-CLOSED) ===
        if (cycleBData.isGenesis !== true) {
          await safelyReleaseStartLock();
          throw new HttpsError("failed-precondition", `CYCLE_LINK_MISMATCH: El ciclo ${targetCycleId} no especifica un ciclo previo ni es un ciclo génesis válido.`);
        }

        const globalConfigSnap = await db.collection("settings").doc("global_config").get();
        const globalConfig = globalConfigSnap.exists ? globalConfigSnap.data() || {} : {};

        if (globalConfig.operationalCycleId !== null && globalConfig.operationalCycleId !== undefined) {
          await safelyReleaseStartLock();
          throw new HttpsError("failed-precondition", "NO_HISTORY_VIOLATION: Ya existe un ciclo operativo activo en settings/global_config.");
        }
        if (globalConfig.activeCycleId !== null && globalConfig.activeCycleId !== undefined) {
          await safelyReleaseStartLock();
          throw new HttpsError("failed-precondition", "NO_HISTORY_VIOLATION: Ya existe un ciclo activo configurado en settings/global_config.");
        }
        if (globalConfig.preparingCycleId !== targetCycleId) {
          await safelyReleaseStartLock();
          throw new HttpsError("failed-precondition", "NO_HISTORY_VIOLATION: settings/global_config.preparingCycleId no coincide con el ciclo génesis.");
        }
        if (globalConfig.lastClosedCycleId !== null && globalConfig.lastClosedCycleId !== undefined) {
          await safelyReleaseStartLock();
          throw new HttpsError("failed-precondition", "NO_HISTORY_VIOLATION: settings/global_config registra un ciclo previo cerrado.");
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

          if (
            cyclesSnap.size !== 1 ||
            !opsSnap.empty ||
            !summariesSnap.empty ||
            !resSnap.empty ||
            !groupsSnap.empty ||
            !reinvAllSnap.empty ||
            !disbAllSnap.empty ||
            !invAllSnap.empty
          ) {
            await safelyReleaseStartLock();
            throw new HttpsError(
              "failed-precondition",
              "NO_HISTORY_VIOLATION: Se detectaron registros operativos o ciclos previos incompatibles con el inicio del ciclo génesis."
            );
          }
        } catch (readErr) {
          if (readErr instanceof HttpsError) throw readErr;
          await safelyReleaseStartLock();
          throw new HttpsError("failed-precondition", `[FAIL_CLOSED] Error al verificar colecciones para inicio génesis: ${readErr.message}`);
        }
      } else {
        // === RAMA SUCESOR NORMAL: Validar ciclo A (predecesor) ===
        sourceCycleId = cycleBData.previousCycleId;
        const cycleARef = db.collection("monthlyCycles").doc(sourceCycleId);
        const cycleASnap = await cycleARef.get();
        if (!cycleASnap.exists) {
          await safelyReleaseStartLock();
          throw new HttpsError("not-found", `CYCLE_LINK_MISMATCH: El ciclo previo ${sourceCycleId} no existe.`);
        }
        const cycleAData = cycleASnap.data() || {};
        if (cycleAData.status !== "CLOSED") {
          await safelyReleaseStartLock();
          throw new HttpsError("failed-precondition", `PREVIOUS_CYCLE_NOT_CLOSED: El ciclo previo ${sourceCycleId} debe estar CLOSED.`);
        }
        if (cycleAData.nextCycleId !== targetCycleId) {
          await safelyReleaseStartLock();
          throw new HttpsError("failed-precondition", `CYCLE_LINK_MISMATCH: A.nextCycleId (${cycleAData.nextCycleId}) debe coincidir con B (${targetCycleId}).`);
        }

        if (Number(cycleBData.sourceClosureVersion) !== Number(cycleAData.closureVersion)) {
          await safelyReleaseStartLock();
          throw new HttpsError("failed-precondition", `STALE_PREPARATION_STATE: Versión de cierre (${cycleAData.closureVersion}) difiere de B (${cycleBData.sourceClosureVersion}).`);
        }

        if (cycleBData.preparationNeedsReview === true) {
          await safelyReleaseStartLock();
          throw new HttpsError("failed-precondition", `PREPARATION_NEEDS_REVIEW: El ciclo B requiere revisión por reapertura del ciclo A.`);
        }

        // Cohort A: cycleUserResults from cycle A
        const prevResultsSnap = await db.collection("cycleUserResults").where("cycleId", "==", sourceCycleId).get();
        prevResultsSnap.forEach((dSnap) => {
          const d = dSnap.data() || {};
          const uid = d.userId || d.userUid;
          if (uid) prevUserResultsMap.set(uid, d);
        });
      }

      // GUARD 1: dailyOperations
      const existingOpsSnap = await db.collection("dailyOperations")
        .where("cycleId", "==", targetCycleId)
        .limit(1)
        .get();

      if (!existingOpsSnap.empty) {
        await safelyReleaseStartLock();
        throw new HttpsError("failed-precondition", "CYCLE_HAS_EXISTING_OPERATIONS: El ciclo ya contiene operaciones.");
      }

      // GUARD 2: cycleUserResults
      const existingResultsSnap = await db.collection("cycleUserResults")
        .where("cycleId", "==", targetCycleId)
        .get();

      if (!existingResultsSnap.empty) {
        await safelyReleaseStartLock();
        throw new HttpsError("failed-precondition", `CYCLE_RESULTS_ALREADY_INITIALIZED: Se detectaron resultados previos para el ciclo ${targetCycleId}.`);
      }

      // GUARD 3: cycleFinancialSummaries
      const existingSummarySnap = await db.collection("cycleFinancialSummaries").doc(targetCycleId).get();
      if (existingSummarySnap.exists && existingSummarySnap.data().isCycleClosed === false && existingSummarySnap.data().startedAt) {
        await safelyReleaseStartLock();
        throw new HttpsError("failed-precondition", `CYCLE_FINANCIAL_SUMMARY_ALREADY_INITIALIZED: El resumen financiero ya existe para ${targetCycleId}.`);
      }

      // GUARD 4: Funding Reconciliation Guard
      const reinvSnap = await db.collection("reinvestments").where("targetCycleId", "==", targetCycleId).get();
      const reinvDocsMap = new Map();
      let hasUnresolvedRecon = false;

      reinvSnap.forEach((doc) => {
        const d = doc.data() || {};
        reinvDocsMap.set(doc.id, { id: doc.id, ref: doc.ref, ...d });
        if (d.fundingReconciliationStatus === "NEEDS_REVIEW") {
          hasUnresolvedRecon = true;
        }
      });

      if (hasUnresolvedRecon) {
        await safelyReleaseStartLock();
        throw new HttpsError("failed-precondition", `UNRESOLVED_FUNDING_RECONCILIATION: Existen solicitudes con conciliación pendiente (NEEDS_REVIEW).`);
      }

      // GUARD 5: Pending or Needs Review requests
      const blockingRequests = [];
      reinvDocsMap.forEach((req) => {
        if (req.status === "PENDING" || req.status === "NEEDS_REVIEW") {
          blockingRequests.push(req.id);
        }
      });
      if (blockingRequests.length > 0) {
        await safelyReleaseStartLock();
        throw new HttpsError("failed-precondition", `PENDING_REQUESTS_BLOCK_START: Existen ${blockingRequests.length} solicitudes en estado PENDING o NEEDS_REVIEW.`);
      }

      // GUARD 6: Participantes pendientes en /users (PENDING_ACTIVATION o PENDING_CLAIM)
      const allEntriesSnap = await db.collection("users").where("entryCycleId", "==", targetCycleId).get();
      const pendingParticipants = [];
      const newEntriesMap = new Map();

      allEntriesSnap.forEach((uSnap) => {
        const u = uSnap.data() || {};
        if (u.status === "PENDING_ACTIVATION" || u.status === "PENDING_CLAIM") {
          pendingParticipants.push(uSnap.id);
        } else {
          newEntriesMap.set(uSnap.id, { id: uSnap.id, ref: uSnap.ref, ...u });
        }
      });

      if (pendingParticipants.length > 0) {
        await safelyReleaseStartLock();
        throw new HttpsError(
          "failed-precondition",
          `PENDING_PARTICIPANTS_REQUIRE_ACTIVATION: Existen ${pendingParticipants.length} inversionistas con activación o claim pendiente para este ciclo. Todos los participantes registrados deben completar su activación antes del inicio operativo.`
        );
      }

      // Union of unique user UIDs
      const participantUids = new Set([...prevUserResultsMap.keys(), ...newEntriesMap.keys()]);

      if (participantUids.size === 0) {
        await safelyReleaseStartLock();
        throw new HttpsError("failed-precondition", "ZERO_PARTICIPANTS_DETECTED: No se detectaron participantes elegibles.");
      }

      // Fetch profiles
      const userProfilesMap = new Map();
      for (const uid of participantUids) {
        if (newEntriesMap.has(uid)) {
          userProfilesMap.set(uid, newEntriesMap.get(uid));
        } else {
          const uSnap = await db.collection("users").doc(uid).get();
          if (uSnap.exists) {
            userProfilesMap.set(uid, { id: uSnap.id, ref: uSnap.ref, ...uSnap.data() });
          }
        }
      }

      const cycleUserResultsToSet = [];
      const userUpdates = [];
      const reinvUpdates = [];
      let totalInitialCapitalCop = 0;

      const reinvByUserUid = {};
      reinvDocsMap.forEach((req) => {
        const uUid = req.userId || req.userUid;
        if (uUid && req.status === "APPROVED") {
          reinvByUserUid[uUid] = req;
        }
      });

      for (const uid of participantUids) {
        const uProfile = userProfilesMap.get(uid);
        if (!uProfile) continue;
        if (uProfile.status && uProfile.status !== "ACTIVE") continue;
        if (!isTradingParticipantProfile(uProfile)) continue;

        const req = reinvByUserUid[uid];
        const prevRes = prevUserResultsMap.get(uid);

        let finalCapitalCop = 0;
        let finalIncreaseAppliedCop = 0;
        let excludedCashAmountCop = 0;
        let finalFundingStatus = "NOT_REQUIRED";

        if (req) {
          const cashInjectionCop = Math.round(Number(req.cashInjectionCop || 0));
          const isCashConfirmed = req.externalFundingStatus === "CONFIRMED" && req.fundingReconciliationStatus !== "NEEDS_REVIEW";

          let cashToAdd = 0;
          if (cashInjectionCop > 0) {
            if (isCashConfirmed) {
              cashToAdd = cashInjectionCop;
              finalFundingStatus = "CONFIRMED";
              excludedCashAmountCop = 0;
            } else {
              cashToAdd = 0;
              finalFundingStatus = "NOT_RECEIVED";
              excludedCashAmountCop = cashInjectionCop;
            }
          }

          const securedNextCapitalCop = Math.round(Number(req.securedNextCapitalCop || (prevRes ? prevRes.cycleCapitalCop : uProfile.currentCapital) || 0));
          finalCapitalCop = securedNextCapitalCop + cashToAdd;
          const profitAppliedCop = Math.round(Number(req.profitAppliedCop || 0));
          finalIncreaseAppliedCop = profitAppliedCop + cashToAdd;

          reinvUpdates.push({
            ref: req.ref,
            data: {
              status: "APPLIED",
              appliedAtCycleStart: true,
              appliedAt: nowIso,
              appliedInCycleId: targetCycleId,
              finalCapitalCop,
              finalIncreaseAppliedCop,
              externalFundingStatus: finalFundingStatus,
              excludedCashAmountCop,
              appliedByUid: authUid,
              appliedByName: adminName,
              updatedAt: nowIso,
            },
          });
        } else if (prevRes) {
          finalCapitalCop = Number(prevRes.cycleCapitalCop || 0);
        } else {
          finalCapitalCop = Number(uProfile.currentCapital || 0);
        }

        if (finalCapitalCop < 2000000) {
          await safelyReleaseStartLock();
          throw new HttpsError(
            "failed-precondition",
            `INVALID_TRADING_CAPITAL: El usuario ${uProfile.userCode || uid} resultó con capital $${finalCapitalCop} COP.`
          );
        }

        const finalCategory = getCategoryForCapitalLocal(finalCapitalCop);
        const participantSplit = getTradingSplitForProfile(uProfile);
        totalInitialCapitalCop += finalCapitalCop;

        const cycleResRef = db.collection("cycleUserResults").doc(`${targetCycleId}_${uid}`);
        cycleUserResultsToSet.push({
          ref: cycleResRef,
          data: {
            id: `${targetCycleId}_${uid}`,
            cycleId: targetCycleId,
            userId: uid,
            userUid: uid,
            userCode: uProfile.userCode || "",
            userName: uProfile.fullName || "",
            email: uProfile.email || "",
            cycleCapitalCop: finalCapitalCop,
            cycleCategory: finalCategory,
            groupCapitalCop: finalCapitalCop,
            totalUsdOperated: 0,
            trmUsed: null,
            totalGrossCop: 0,
            participantRole: uProfile.role || "USER",
            participatesInTrading: true,
            commissionMode:
              uProfile.commissionMode === "SELF_ADMIN"
                ? "SELF_ADMIN"
                : "STANDARD",

            userPercentage: participantSplit.userPercentage,
            adminPercentage: participantSplit.adminPercentage,
            userProfitCop: 0,
            adminCommissionCop: 0,
            userProfitUsd: 0,
            adminCommissionUsd: 0,
            notificationStatus: "PENDING",
            notificationSentAt: null,
            calculatedAt: nowIso,
            calculatedBy: adminName,
            isCycleClosed: false,
            isFrozen: true,
            updatedAt: nowIso,
          },
        });

        if (Number(uProfile.currentCapital) !== finalCapitalCop || uProfile.category !== finalCategory) {
          userUpdates.push({
            ref: uProfile.ref,
            data: {
              currentCapital: finalCapitalCop,
              category: finalCategory,
              updatedAt: nowIso,
              updatedBy: adminName,
            },
          });
        }
      }

      // requiredStartWrites = 3 + P + U + R
      const requiredStartWrites = 3 + cycleUserResultsToSet.length + userUpdates.length + reinvUpdates.length;
      const MAX_START_WRITES = 450;

      if (requiredStartWrites > MAX_START_WRITES) {
        await safelyReleaseStartLock();
        throw new HttpsError(
          "resource-exhausted",
          `START_TOO_LARGE_FOR_ATOMIC_COMMIT: Se requieren ${requiredStartWrites} escrituras atómicas, superando el límite de ${MAX_START_WRITES}.`
        );
      }

      // 6. Transacción Atómica de Inicialización Operativa
      await db.runTransaction(async (transaction) => {
        const cSnap = await transaction.get(cycleRef);
        if (!cSnap.exists) throw new Error("Ciclo no encontrado durante commit.");
        const cData = cSnap.data() || {};
        if (cData.startAttemptId !== startAttemptId) {
          throw new Error("Concurrencia: el intento de inicio ya no es válido.");
        }
        if (Number(cData.cohortVersion || 1) !== expectedCohortVersion) {
          throw new Error("COHORT_CHANGED_RETRY_START");
        }

        // ESCRITURA 1: Actualizar ciclo a STARTED
        transaction.update(cycleRef, {
          operationalStatus: "STARTED",
          startedAt: nowIso,
          startedByUid: authUid,
          startedByName: adminName,
          isStarting: false,
          startingStartedAt: null,
          startingByUid: null,
          startingByName: null,
          startAttemptId: null,
          lastStartRequestId: clientRequestId || null,
          initialManagedCapitalCop: totalInitialCapitalCop,
          initialActiveUsersCount: cycleUserResultsToSet.length,
          updatedAt: nowIso,
        });

        // ESCRITURA 2: Punteros globales en settings/global_config
        const globalConfigRef = db.collection("settings").doc("global_config");
        transaction.set(
          globalConfigRef,
          {
            operationalCycleId: targetCycleId,
            preparingCycleId: null,
            activeCycleId: targetCycleId,
            updatedAt: nowIso,
          },
          { merge: true }
        );

        // ESCRITURA 3: Crear resumen financiero inicial
        const summaryRef = db.collection("cycleFinancialSummaries").doc(targetCycleId);
        transaction.set(summaryRef, {
          cycleId: targetCycleId,
          initialManagedCapitalCop: totalInitialCapitalCop,
          initialActiveUsersCount: cycleUserResultsToSet.length,
          totalGroupsCount: 0,
          calculatedGroupsCount: 0,
          totalGrossCop: 0,
          totalUsersProfitCop: 0,
          totalAdminCommissionCop: 0,
          isCycleClosed: false,
          startedAt: nowIso,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        // ESCRITURAS 4: cycleUserResults congelados
        for (const cur of cycleUserResultsToSet) {
          transaction.set(cur.ref, cur.data);
        }

        // ESCRITURAS 5: usuarios actualizados
        for (const uu of userUpdates) {
          transaction.update(uu.ref, uu.data);
        }

        // ESCRITURAS 6: solicitudes de reinversión marcadas como APPLIED
        for (const ru of reinvUpdates) {
          transaction.update(ru.ref, ru.data);
        }
      });

      // 7. Auditoría autoritativa
      await db.collection("auditLogs").add({
        action: "CYCLE_OPERATIONALLY_STARTED",
        performedBy: authUid,
        performedByName: adminName,
        cycleId: targetCycleId,
        targetEntity: targetCycleId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        details: {
          operationalStatus: "STARTED",
          initialManagedCapitalCop: totalInitialCapitalCop,
          initialActiveUsersCount: cycleUserResultsToSet.length,
          reinvestmentsAppliedCount: reinvUpdates.length,
          usersCapitalUpdatedCount: userUpdates.length,
          requiredStartWrites,
        },
      }).catch(() => {});

      // 8. Notificaciones determinísticas a usuarios
      for (const cur of cycleUserResultsToSet) {
        const uid = cur.data.userId;
        const notifId = `notif_cycle_start_${targetCycleId}_${uid}`;
        const cap = Number(cur.data.cycleCapitalCop || 0);
        const cat = cur.data.cycleCategory || "AZUL";

        await db.collection("notifications").doc(notifId).set({
          id: notifId,
          userId: uid,
          userUid: uid,
          userCode: cur.data.userCode || "",
          userName: cur.data.userName || "",
          cycleId: targetCycleId,
          type: "CYCLE_CLOSED",
          title: `🚀 ¡${cycleBData.name || targetCycleId} iniciado!`,
          message: `El ciclo ha iniciado formalmente operaciones. Tu capital operativo congelado para este ciclo es de $${cap.toLocaleString("es-CO")} COP (Categoría ${cat}).`,
          read: false,
          sentAt: nowIso,
          createdAt: nowIso,
          payload: {
            cycleId: targetCycleId,
            cycleCapitalCop: cap,
            cycleCategory: cat,
          },
        }, { merge: true }).catch(() => {});
      }

      return {
        success: true,
        cycleId: targetCycleId,
        operationalStatus: "STARTED",
        startedAt: nowIso,
        initialManagedCapitalCop: totalInitialCapitalCop,
        initialActiveUsersCount: cycleUserResultsToSet.length,
        reinvestmentsAppliedCount: reinvUpdates.length,
        usersCapitalUpdatedCount: userUpdates.length,
        requiredStartWrites,
        message: `${cycleBData.name || targetCycleId} iniciado operativamente con éxito. Se congelaron los capitales de ${cycleUserResultsToSet.length} inversionistas ($${totalInitialCapitalCop.toLocaleString("es-CO")} COP) y se habilitaron las operaciones de trading.`,
      };
    } catch (err) {
      await safelyReleaseStartLock();
      console.error("[adminStartCycleCallable] Error iniciando ciclo operativamente:", err);
      if (err instanceof HttpsError) throw err;
      if (err.message === "COHORT_CHANGED_RETRY_START") {
        throw new HttpsError(
          "aborted",
          "COHORT_CHANGED_RETRY_START: La cohorte de participantes fue modificada concurrentemente durante el proceso de inicio. Por favor reintenta la operación."
        );
      }
      throw new HttpsError("internal", `Fallo atómico al iniciar ciclo: ${err.message || String(err)}`);
    }
  }
);

/**
 * Helper interno: Validación exhaustiva de fechas y timestamps Firestore.
 * Soporta Firestore Timestamps (toDate, seconds/nanoseconds), objetos Date, strings ISO y números epoch.
 */
function isValidFirestoreDate(value) {
  if (value === null || value === undefined) return false;
  if (value instanceof Date) return !isNaN(value.getTime());
  if (typeof value === "object") {
    if (typeof value.toDate === "function") {
      try {
        const d = value.toDate();
        return d instanceof Date && !isNaN(d.getTime());
      } catch {
        return false;
      }
    }
    const sec = value._seconds !== undefined ? value._seconds : value.seconds;
    if (typeof sec === "number" && !isNaN(sec) && sec > 0) return true;
  }
  if (typeof value === "number") {
    return !isNaN(value) && value > 0;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const d = new Date(value);
    return !isNaN(d.getTime());
  }
  return false;
}

/**
 * Helper interno: Evaluación estricta de documentos huérfanos/legacy en reinvestments.
 * POLÍTICA ULTRA-CONSERVADORA:
 * - Protege cualquier documento con cifras financieras > $0
 * - Protege cualquier solicitud en ciclos cerrados (CLOSED) o ya aplicadas (APPLIED)
 * - Protege solicitudes de usuarios activos con ciclos existentes
 */
function evaluateReinvestmentOrphanStatus(docId, data, usersMap, cyclesMap) {
  const currentCapitalSnapshotCop = Number(data.currentCapitalSnapshotCop || 0);
  const cycleProfitSnapshotCop = Number(data.cycleProfitSnapshotCop || 0);
  const profitAppliedCop = Number(data.profitAppliedCop || 0);
  const cashInjectionCop = Number(data.cashInjectionCop || 0);
  const totalIncreaseCop = Number(data.totalIncreaseCop || data.reinvestAmountCop || 0);
  const projectedCapitalCop = Number(data.projectedCapitalCop || data.newCapitalTargetCop || 0);

  const hasFinancialValues =
    currentCapitalSnapshotCop > 0 ||
    cycleProfitSnapshotCop !== 0 ||
    profitAppliedCop > 0 ||
    cashInjectionCop > 0 ||
    totalIncreaseCop > 0 ||
    projectedCapitalCop > 0;

  const targetCycleId = data.sourceCycleId || "";
  const cycleData = cyclesMap.get(targetCycleId);
  const inClosedCycle = cycleData && cycleData.status === "CLOSED";
  const isApplied = data.status === "APPLIED" || data.appliedAtCycleClosure === true;

  if (isApplied) {
    return {
      docId,
      isProtected: true,
      isCandidate: false,
      reason: "Solicitud formalmente aplicada al capital (Protegida contablemente)",
      data,
    };
  }

  if (inClosedCycle) {
    return {
      docId,
      isProtected: true,
      isCandidate: false,
      reason: "Asociada a un ciclo histórico cerrado (Protegida por integridad histórica)",
      data,
    };
  }

  if (hasFinancialValues) {
    return {
      docId,
      isProtected: true,
      isCandidate: false,
      reason: `Contiene valores financieros activos (Aumento: $${totalIncreaseCop.toLocaleString("es-CO")}, Proyectado: $${projectedCapitalCop.toLocaleString("es-CO")}) - Requiere resolución administrativa, NO eliminación`,
      data,
    };
  }

  // Si no tiene valores financieros, evaluar si es huérfano técnico/legacy/fixture
  const targetUid = data.userUid || data.userId || "";
  const userExists = Boolean(targetUid && usersMap.has(targetUid));
  const cycleExists = Boolean(targetCycleId && cyclesMap.has(targetCycleId));
  const hasValidDate = isValidFirestoreDate(data.createdAt);
  const isFixtureDoc =
    docId.startsWith("reinv_user_") ||
    docId === "reinv_direct_user" ||
    docId.includes("fixture") ||
    docId.includes("mock") ||
    docId.includes("test");

  const orphanReasons = [];
  if (!targetUid) orphanReasons.push("Sin identificador de usuario (userUid vacío)");
  else if (!userExists) orphanReasons.push(`Usuario ${targetUid} inexistente en base de datos`);
  if (!targetCycleId) orphanReasons.push("Sin ciclo de origen asociado");
  else if (!cycleExists) orphanReasons.push(`Ciclo ${targetCycleId} inexistente`);
  if (!hasValidDate) orphanReasons.push("Fecha de creación inválida o nula (Invalid Date)");
  if (isFixtureDoc) orphanReasons.push("Identificador de documento coincide con fixture/mock de pruebas");

  if (orphanReasons.length > 0) {
    return {
      docId,
      isProtected: false,
      isCandidate: true,
      reason: `Huérfana técnica ($0 financieros): ${orphanReasons.join(", ")}`,
      orphanReasons,
      data,
    };
  }

  return {
    docId,
    isProtected: true,
    isCandidate: false,
    reason: "Documento regular con usuario y ciclo válidos",
    data,
  };
}

/**
 * Cloud Function HTTPS Callable: Dry Run / Vista Previa de Solicitudes Huérfanas (Exclusivo SuperAdmin)
 */
exports.adminPreviewOrphanReinvestmentsCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Usuario no autenticado.");
    }

    const authUid = request.auth.uid;
    const authEmail = (request.auth.token && request.auth.token.email) ? request.auth.token.email.toLowerCase() : "";
    const adminDoc = await db.collection("users").doc(authUid).get();

    // Verificación canónica exclusiva de SuperAdmin (Se rechaza Admin secundario)
    let isSuperAdmin = false;
    if (
      authUid === "lpx4NLEEMkeh9EJFcG68oPMVdXF2" ||
      authEmail === "juanes9802@gmail.com" ||
      authEmail === "elcocalombiano1828@gmail.com" ||
      (request.auth.token && (request.auth.token.superadmin === true || request.auth.token.role === "superadmin")) ||
      (adminDoc.exists && adminDoc.data().role === "SUPERADMIN")
    ) {
      isSuperAdmin = true;
    }

    if (!isSuperAdmin) {
      throw new HttpsError("permission-denied", "Acceso estrictamente exclusivo para SuperAdministrador.");
    }

    // 1. Obtener todos los usuarios y ciclos para validación en memoria
    const [usersSnap, cyclesSnap, reinvSnap] = await Promise.all([
      db.collection("users").get(),
      db.collection("monthlyCycles").get(),
      db.collection("reinvestments").get(),
    ]);

    const usersMap = new Map();
    usersSnap.docs.forEach((d) => usersMap.set(d.id, d.data()));

    const cyclesMap = new Map();
    cyclesSnap.docs.forEach((d) => cyclesMap.set(d.id, d.data()));

    const candidates = [];
    const protectedItems = [];

    reinvSnap.docs.forEach((d) => {
      const evaluation = evaluateReinvestmentOrphanStatus(d.id, d.data() || {}, usersMap, cyclesMap);
      if (evaluation.isCandidate) {
        candidates.push({
          id: d.id,
          sourceCycleId: d.data().sourceCycleId || "N/A",
          userCode: d.data().userCode || "N/A",
          userName: d.data().userName || "Sin nombre",
          userUid: d.data().userUid || d.data().userId || "N/A",
          status: d.data().status || "UNKNOWN",
          modality: d.data().modality || "N/A",
          createdAt: d.data().createdAt || null,
          totalIncreaseCop: Number(d.data().totalIncreaseCop || d.data().reinvestAmountCop || 0),
          reason: evaluation.reason,
          orphanReasons: evaluation.orphanReasons,
        });
      } else {
        protectedItems.push({
          id: d.id,
          userCode: d.data().userCode || "N/A",
          sourceCycleId: d.data().sourceCycleId || "N/A",
          reason: evaluation.reason,
        });
      }
    });

    return {
      success: true,
      totalScanned: reinvSnap.docs.length,
      orphanCount: candidates.length,
      protectedCount: protectedItems.length,
      candidates,
      protectedItems,
    };
  }
);

/**
 * Cloud Function HTTPS Callable: Purga Definitiva de Solicitudes Huérfanas (Exclusivo SuperAdmin)
 * Requiere frase de confirmación explícita y valida atómicamente cada documento antes de su eliminación.
 */
exports.adminPurgeOrphanReinvestmentsCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Usuario no autenticado.");
    }

    const authUid = request.auth.uid;
    const authEmail = (request.auth.token && request.auth.token.email) ? request.auth.token.email.toLowerCase() : "";
    const adminDoc = await db.collection("users").doc(authUid).get();

    let isSuperAdmin = false;
    let adminName = "SuperAdmin";
    if (
      authUid === "lpx4NLEEMkeh9EJFcG68oPMVdXF2" ||
      authEmail === "juanes9802@gmail.com" ||
      authEmail === "elcocalombiano1828@gmail.com" ||
      (request.auth.token && (request.auth.token.superadmin === true || request.auth.token.role === "superadmin")) ||
      (adminDoc.exists && adminDoc.data().role === "SUPERADMIN")
    ) {
      isSuperAdmin = true;
      if (adminDoc.exists && adminDoc.data().fullName) {
        adminName = adminDoc.data().fullName;
      }
    }

    if (!isSuperAdmin) {
      throw new HttpsError("permission-denied", "Acceso estrictamente exclusivo para SuperAdministrador.");
    }

    const { documentIds, confirmationPhrase } = request.data || {};

    if (confirmationPhrase !== "ELIMINAR SOLICITUDES HUÉRFANAS") {
      throw new HttpsError(
        "invalid-argument",
        "Frase de confirmación incorrecta. Debes escribir exactamente 'ELIMINAR SOLICITUDES HUÉRFANAS'."
      );
    }

    if (!Array.isArray(documentIds) || documentIds.length === 0) {
      throw new HttpsError("invalid-argument", "documentIds debe ser un arreglo no vacío.");
    }

    const MAX_ORPHAN_PURGE_BATCH = 100;
    if (documentIds.length > MAX_ORPHAN_PURGE_BATCH) {
      throw new HttpsError(
        "invalid-argument",
        `El lote máximo por ejecución es de ${MAX_ORPHAN_PURGE_BATCH} documentos para garantizar atomicidad transaccional completa. Enviaste ${documentIds.length}.`
      );
    }

    // 1. Obtener contexto de usuarios y ciclos
    const [usersSnap, cyclesSnap] = await Promise.all([
      db.collection("users").get(),
      db.collection("monthlyCycles").get(),
    ]);

    const usersMap = new Map();
    usersSnap.docs.forEach((d) => usersMap.set(d.id, d.data()));

    const cyclesMap = new Map();
    cyclesSnap.docs.forEach((d) => cyclesMap.set(d.id, d.data()));

    const validDocIds = [...new Set(documentIds.filter((id) => typeof id === "string" && id.trim().length > 0))];

    // 2. Ejecución 100% atómica dentro de la MISMA transacción (Lectura -> Revalidación -> Deletes + AuditLog)
    const purgeResult = await db.runTransaction(async (transaction) => {
      // a. Lectura de todos los documentos seleccionados
      const docRefs = validDocIds.map((id) => db.collection("reinvestments").doc(id));
      const snaps = await Promise.all(docRefs.map((ref) => transaction.get(ref)));

      const purgedIds = [];
      const skipped = [];

      for (let i = 0; i < docRefs.length; i++) {
        const docId = validDocIds[i];
        const snap = snaps[i];
        const docRef = docRefs[i];

        if (!snap.exists) {
          skipped.push({ docId, reason: "El documento ya no existe en Firestore" });
          continue;
        }

        const evaluation = evaluateReinvestmentOrphanStatus(docId, snap.data() || {}, usersMap, cyclesMap);
        if (!evaluation.isCandidate) {
          skipped.push({ docId, reason: `PROTEGIDO: ${evaluation.reason}` });
          continue;
        }

        // Revalidación exitosa: programar delete dentro de la transacción
        transaction.delete(docRef);
        purgedIds.push(docId);
      }

      // b. Creación atómica del auditLog dentro de la MISMA transacción
      const auditRef = db.collection("auditLogs").doc();
      transaction.set(auditRef, {
        id: auditRef.id,
        action: "ORPHAN_REINVESTMENTS_PURGED",
        performedBy: authUid,
        performedByName: adminName,
        details: {
          requestedCount: documentIds.length,
          purgedCount: purgedIds.length,
          skippedCount: skipped.length,
          purgedIds,
          skipped,
        },
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        purgedIds,
        skipped,
        auditLogId: auditRef.id,
      };
    });

    return {
      success: true,
      purgedCount: purgeResult.purgedIds.length,
      skippedCount: purgeResult.skipped.length,
      purgedIds: purgeResult.purgedIds,
      skipped: purgeResult.skipped,
      auditLogId: purgeResult.auditLogId,
      message: `Se depuraron exitosamente ${purgeResult.purgedIds.length} solicitudes huérfanas (${purgeResult.skipped.length} omitidas por protección). Auditoría registrada: ${purgeResult.auditLogId}.`,
    };
  }
);

/**
 * Callable administrativa para el envío masivo seguro, idempotente y reanudable de notificaciones globales.
 * Solo accesible para ADMIN/SUPERADMIN.
 */
exports.adminSendBroadcastNotificationCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    // 1. Autorización Administrativa Canónica
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "El usuario debe estar autenticado para enviar notificaciones masivas."
      );
    }

    const authUid = request.auth.uid;
    const authEmail = (request.auth.token && request.auth.token.email) ? request.auth.token.email.toLowerCase() : "";

    const userDocSnap = await db.collection("users").doc(authUid).get();
    let isSuperAdmin = false;

    if (
      authUid === "lpx4NLEEMkeh9EJFcG68oPMVdXF2" ||
      authEmail === "juanes9802@gmail.com" ||
      authEmail === "elcocalombiano1828@gmail.com" ||
      (request.auth.token && (request.auth.token.role === "admin" || request.auth.token.superadmin === true))
    ) {
      isSuperAdmin = true;
    } else if (userDocSnap.exists && userDocSnap.data().role === "ADMIN") {
      isSuperAdmin = true;
    }

    if (!isSuperAdmin) {
      throw new HttpsError(
        "permission-denied",
        "Acceso denegado: Se requieren privilegios administrativos para enviar notificaciones masivas."
      );
    }

    // 2. Validación de Argumentos
    const data = request.data || {};
    const { title, message, personalizeGreeting, clientRequestId } = data;

    if (!title || typeof title !== "string" || !title.trim() || title.trim().length < 3 || title.trim().length > 80) {
      throw new HttpsError(
        "invalid-argument",
        "El título es obligatorio y debe tener entre 3 y 80 caracteres."
      );
    }
    if (!message || typeof message !== "string" || !message.trim() || message.trim().length < 5 || message.trim().length > 500) {
      throw new HttpsError(
        "invalid-argument",
        "El mensaje es obligatorio y debe tener entre 5 y 500 caracteres."
      );
    }
    if (!clientRequestId || typeof clientRequestId !== "string" || !clientRequestId.trim()) {
      throw new HttpsError(
        "invalid-argument",
        "Falta el identificador único de solicitud del cliente (clientRequestId)."
      );
    }

    const logRef = db.collection("broadcastLogs").doc(clientRequestId);
    const currentAttemptId = `attempt_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    const now = admin.firestore.FieldValue.serverTimestamp();

    // 3. Adquisición Transaccional Segura del Lease
    const leaseResult = await db.runTransaction(async (transaction) => {
      const docSnap = await transaction.get(logRef);
      const timeLimit = 5 * 60 * 1000; // Timeout de 5 minutos

      if (docSnap.exists) {
        const logData = docSnap.data();

        if (logData.status === "COMPLETED" || logData.status === "COMPLETED_WITH_SKIPS") {
          return { action: "RETURN_COMPLETED", data: logData };
        }

        if (logData.status === "PROCESSING") {
          const startedAt = logData.processingStartedAt ? logData.processingStartedAt.toDate() : new Date();
          const heartbeat = logData.lastHeartbeatAt ? logData.lastHeartbeatAt.toDate() : startedAt;
          const elapsed = Date.now() - heartbeat.getTime();

          if (elapsed < timeLimit) {
            return { action: "REJECT_CONCURRENT", data: logData };
          }
        }

        // Reanudar lease huérfano o parcial fallido
        transaction.update(logRef, {
          status: "PROCESSING",
          processingStartedAt: now,
          lastHeartbeatAt: now,
          attemptId: currentAttemptId,
        });
        return { action: "ACQUIRE_LEASE", data: logData };
      } else {
        // Primera ejecución: Capturar snapshot congelado de destinatarios activos
        const usersSnap = await db.collection("users")
          .where("role", "==", "USER")
          .where("status", "==", "ACTIVE")
          .get();

        const targetUids = [];
        usersSnap.forEach((uDoc) => {
          targetUids.push(uDoc.id);
        });

        const broadcastId = `broadcast_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
        const adminName = (userDocSnap.exists ? userDocSnap.data().fullName : "Administrador") || "Administrador";

        const initialData = {
          clientRequestId,
          broadcastId,
          status: "PROCESSING",
          targetUids,
          targetUsersCount: targetUids.length,
          createdNotificationsCount: 0,
          notificationsAlreadyExistedCount: 0,
          targetsUnavailableCount: 0,
          createdByUid: authUid,
          createdByName: adminName,
          personalizeGreeting: !!personalizeGreeting,
          createdAt: now,
          processingStartedAt: now,
          lastHeartbeatAt: now,
          attemptId: currentAttemptId,
        };

        transaction.set(logRef, initialData);
        return { action: "INITIAL_LEASE", data: initialData };
      }
    });

    if (leaseResult.action === "RETURN_COMPLETED") {
      return {
        success: true,
        status: leaseResult.data.status,
        broadcastId: leaseResult.data.broadcastId,
        targetUsersCount: leaseResult.data.targetUsersCount,
        createdNotificationsCount: leaseResult.data.createdNotificationsCount || 0,
        notificationsAlreadyExistedCount: leaseResult.data.notificationsAlreadyExistedCount || 0,
        targetsUnavailableCount: leaseResult.data.targetsUnavailableCount || 0,
        message: "Este envío de notificación global ya fue completado previamente de forma exitosa.",
      };
    }

    if (leaseResult.action === "REJECT_CONCURRENT") {
      throw new HttpsError(
        "aborted",
        "Operación en curso: Ya existe un worker activo procesando esta notificación masiva actualmente."
      );
    }

    // 4. Procesar el Fan-out en Chunks
    const targetUids = leaseResult.data.targetUids || [];
    const broadcastId = leaseResult.data.broadcastId;
    const isPersonalized = !!leaseResult.data.personalizeGreeting;

    let createdNotificationsCount = leaseResult.data.createdNotificationsCount || 0;
    let notificationsAlreadyExistedCount = leaseResult.data.notificationsAlreadyExistedCount || 0;
    let targetsUnavailableCount = leaseResult.data.targetsUnavailableCount || 0;

    const chunkSize = 100;

    for (let i = 0; i < targetUids.length; i += chunkSize) {
      const chunkUids = targetUids.slice(i, i + chunkSize);

      // Obtener perfiles de usuario en paralelo para el saludo
      const userSnaps = await Promise.all(
        chunkUids.map((uid) => db.collection("users").doc(uid).get())
      );

      // Crear documentos usando create() para evitar sobre-escritura
      await Promise.all(
        chunkUids.map(async (uid, index) => {
          const uSnap = userSnaps[index];
          if (!uSnap || !uSnap.exists) {
            targetsUnavailableCount++;
            return;
          }

          const uData = uSnap.data() || {};
          const notifId = `notif_broadcast_${broadcastId}_${uid}`;
          const finalMessage = isPersonalized
            ? `Hola ${uData.fullName || "Inversionista"}, ${message.trim()}`
            : message.trim();

          const canonicalNotif = {
            id: notifId,
            userId: uid,
            userUid: uid,
            userName: uData.fullName || "",
            userEmail: uData.email || "",
            type: "ADMIN_BROADCAST",
            title: title.trim(),
            message: finalMessage,
            isRead: false,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            readAt: null,
            payload: {
              broadcastId,
              clientRequestId,
              personalized: isPersonalized,
            },
          };

          try {
            await db.collection("notifications").doc(notifId).create(canonicalNotif);
            createdNotificationsCount++;
          } catch (err) {
            if (err.code === 6 || err.message.includes("ALREADY_EXISTS") || err.message.includes("already exists")) {
              notificationsAlreadyExistedCount++;
            } else {
              console.error(`Error de creación para notificación ${notifId}:`, err);
              throw err;
            }
          }
        })
      );

      // 5. Heartbeat periódico del Lease al finalizar cada chunk
      const hbResult = await db.runTransaction(async (hbTx) => {
        const freshSnap = await hbTx.get(logRef);
        if (
          freshSnap.exists &&
          freshSnap.data().attemptId === currentAttemptId &&
          freshSnap.data().status === "PROCESSING"
        ) {
          hbTx.update(logRef, {
            lastHeartbeatAt: admin.firestore.FieldValue.serverTimestamp(),
            createdNotificationsCount,
            notificationsAlreadyExistedCount,
            targetsUnavailableCount,
          });
          return true;
        }
        return false;
      });

      if (!hbResult) {
        throw new HttpsError(
          "aborted",
          "Conflicto de concurrencia: El lease de procesamiento fue adquirido por otro attemptID."
        );
      }
    }

    // 6. Finalización y Registro del AuditLog Determinístico
    const finalStatus = targetsUnavailableCount > 0 ? "COMPLETED_WITH_SKIPS" : "COMPLETED";

    await logRef.update({
      status: finalStatus,
      createdNotificationsCount,
      notificationsAlreadyExistedCount,
      targetsUnavailableCount,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const auditId = `broadcast_${broadcastId}`;
    const auditRef = db.collection("auditLogs").doc(auditId);
    const adminName = (userDocSnap.exists ? userDocSnap.data().fullName : "Administrador") || "Administrador";

    try {
      await auditRef.create({
        id: auditId,
        action: "ADMIN_BROADCAST_NOTIFICATION_SENT",
        performedBy: authUid,
        performedByName: adminName,
        targetEntity: broadcastId,
        details: {
          broadcastId,
          clientRequestId,
          title: title.trim(),
          message: message.trim(),
          personalizeGreeting: isPersonalized,
          targetUsersCount: targetUids.length,
          createdNotificationsCount,
          notificationsAlreadyExistedCount,
          targetsUnavailableCount,
          finalStatus,
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (auditErr) {
      if (auditErr.code !== 6 && !auditErr.message.includes("ALREADY_EXISTS") && !auditErr.message.includes("already exists")) {
        console.error("Error al registrar audit log determinístico:", auditErr);
      }
    }

    return {
      success: true,
      status: finalStatus,
      broadcastId,
      targetUsersCount: targetUids.length,
      createdNotificationsCount,
      notificationsAlreadyExistedCount,
      targetsUnavailableCount,
      message: "Envío masivo global procesado y guardado exitosamente.",
    };
  }
);

/**
 * Cloud Function HTTPS Callable: adminUpdateCycleTrmCallable
 * AUTORIDAD EXCLUSIVA DE SERVIDOR (SUPERADMIN).
 * Actualiza la TRM oficial de liquidación de un ciclo OPEN / REOPENED y recalcula
 * de forma atómica y consistente todos los registros financieros dependientes:
 * - monthlyCycles.trmApplied
 * - cycleUserResults (usando snapshots contractuales userPercentage / adminPercentage)
 * - cycleGroupCalculations
 * - cycleFinancialSummaries
 * - Solicitudes de reinversión activas (PENDING, APPROVED, PREAPPROVED, NEEDS_REVIEW)
 * - Regla APPLIED: Si existe alguna solicitud APPLIED para el ciclo -> ABORTAR (TRM_CHANGE_AFTER_APPLIED_REINVESTMENT)
 * - Control de Lock en 2 fases con release seguro
 * - Idempotencia estricta por clientRequestId
 * - Límite atómico máximo de 450 escrituras
 */
exports.adminUpdateCycleTrmCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    // 1. AUTENTICACIÓN Y PRIVILEGIOS ESTRICTOS DE SUPERADMIN
    const { authUid, authEmail, createdByName } = await verifySuperAdminPrivileges(request);

    // 2. VALIDACIÓN DE ENTRADA
    const {
      cycleId,
      clientRequestId,
      reason,
    } = request.data || {};

    if (
      !cycleId ||
      typeof cycleId !== "string" ||
      !cycleId.trim()
    ) {
      throw new HttpsError(
        "invalid-argument",
        "El parámetro 'cycleId' es obligatorio."
      );
    }

    const targetCycleId =
      cycleId.trim();

    if (
      !clientRequestId ||
      typeof clientRequestId !== "string" ||
      !clientRequestId.trim()
    ) {
      throw new HttpsError(
        "invalid-argument",
        "El parámetro 'clientRequestId' es obligatorio para garantizar idempotencia."
      );
    }

    const cleanRequestId =
      clientRequestId.trim();

    const auditDocId =
      `audit_trm_${targetCycleId}_${cleanRequestId}`;

    const auditRef =
      db.collection("auditLogs").doc(
        auditDocId
      );

    // ------------------------------------------------------
    // IDEMPOTENCIA
    // ------------------------------------------------------

    const existingAuditSnap =
      await auditRef.get();

    if (existingAuditSnap.exists) {
      const existingAudit =
        existingAuditSnap.data() || {};

      const auditDetails =
        existingAudit.details || {};

      const replayTrm =
        Number(
          auditDetails.newTrm
        );

      if (
        !Number.isFinite(replayTrm) ||
        replayTrm <= 0
      ) {
        throw new HttpsError(
          "data-loss",
          "TRM_IDEMPOTENCY_AUDIT_INVALID"
        );
      }

      return {
        success: true,
        idempotentReplay: true,
        cycleId: targetCycleId,

        previousTrm:
          auditDetails.previousTrm ?? null,

        newTrm:
          replayTrm,

        trmSource:
          auditDetails.trmSource || null,

        trmSourceUrl:
          auditDetails.trmSourceUrl || null,

        trmEffectiveDate:
          auditDetails.trmEffectiveDate || null,

        trmCapturedAt:
          auditDetails.trmCapturedAt || null,

        trmRateCents:
          auditDetails.trmRateCents ||
          Math.round(
            replayTrm * 100
          ),

        affectedUsersCount:
          auditDetails.affectedUsersCount || 0,

        affectedGroupsCount:
          auditDetails.affectedGroupsCount || 0,

        affectedReinvestmentsCount:
          auditDetails.affectedReinvestmentsCount || 0,

        needsReviewCount:
          auditDetails.needsReviewCount || 0,

        message:
          "Operación idempotente: la TRM ya fue aplicada.",
      };
    }

    // ------------------------------------------------------
    // TRM_UPDATE_SERVER_AUTHORITY
    // ------------------------------------------------------

    let authoritativeTrm;

    try {
      authoritativeTrm =
        await fetchDolarColombiaTrm();
    } catch (err) {
      console.error(
        "[adminUpdateCycleTrmCallable] Dolar-Colombia no disponible:",
        err
      );

      throw new HttpsError(
        "unavailable",
        "TRM_SOURCE_UNAVAILABLE: No se pudo obtener y validar la TRM vigente desde Dolar-Colombia.com."
      );
    }

    const parsedTrm =
      authoritativeTrm.rate;

    const cycleRef = db.collection("monthlyCycles").doc(targetCycleId);
    const closureAttemptId = `trm_recalc_${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();

    // 4. FASE A: ADQUISICIÓN ATÓMICA Y CONFIRMADA DEL LOCK (COMMIT ANTES DEL RECÁLCULO)
    await db.runTransaction(async (transaction) => {
      const cycleSnap = await transaction.get(cycleRef);
      if (!cycleSnap.exists) {
        throw new HttpsError("not-found", `El ciclo '${targetCycleId}' no existe en la base de datos.`);
      }

      const cycleData = cycleSnap.data() || {};
      if (cycleData.status === "CLOSED") {
        throw new HttpsError("failed-precondition", "No se puede modificar la TRM de un ciclo que ya está CERRADO.");
      }
      if (cycleData.operationalStatus === "STARTED") {
        throw new HttpsError(
          "failed-precondition",
          "TRM_FROZEN_AFTER_CYCLE_START: La TRM ya no puede ser modificada porque el ciclo operativo se encuentra en estado STARTED."
        );
      }
      if (cycleData.status !== "OPEN" && cycleData.status !== "REOPENED") {
        throw new HttpsError(
          "failed-precondition",
          `El ciclo se encuentra en estado '${cycleData.status}'. Solo ciclos OPEN o REOPENED admiten ajuste de TRM.`
        );
      }

      if (cycleData.isClosing === true) {
        throw new HttpsError(
          "failed-precondition",
          "El ciclo tiene actualmente un proceso de cierre o recálculo en ejecución (isClosing = true). Espera a que finalice."
        );
      }

      transaction.update(cycleRef, {
        isClosing: true,
        closingStartedAt: nowIso,
        closingByUid: authUid,
        closingByName: createdByName,
        closureAttemptId: closureAttemptId,
      });
    });

    // Helper para liberación segura del lock en caso de error o aborto
    const safelyReleaseLock = async () => {
      try {
        await db.runTransaction(async (tx) => {
          const cSnap = await tx.get(cycleRef);
          if (cSnap.exists && cSnap.data().closureAttemptId === closureAttemptId) {
            tx.update(cycleRef, {
              isClosing: false,
              closingStartedAt: null,
              closingByUid: null,
              closingByName: null,
              closureAttemptId: null,
            });
          }
        });
      } catch (err) {
        console.warn("[adminUpdateCycleTrmCallable] Error al liberar lock de cierre:", err);
      }
    };

    try {
      // 5. FASE B: LECTURA COMPLETA Y PRE-FLIGHT DE TODAS LAS ENTIDADES
      const cycleDoc = (await cycleRef.get()).data() || {};
      const previousTrmRaw =
        Number(
          cycleDoc.trmApplied
        );

      const previousTrm =
        Number.isFinite(
          previousTrmRaw
        ) &&
        previousTrmRaw > 0
          ? previousTrmRaw
          : null;

      // A. Validar regla estricta de reinversiones APPLIED
      const allReinvestmentsSnap = await db
        .collection("reinvestments")
        .where("sourceCycleId", "==", targetCycleId)
        .get();

      const appliedRequests = allReinvestmentsSnap.docs.filter((d) => {
        const data = d.data() || {};
        return data.status === "APPLIED" || data.appliedAtCycleClosure === true;
      });

      if (appliedRequests.length > 0) {
        await safelyReleaseLock();
        throw new HttpsError(
          "failed-precondition",
          `TRM_CHANGE_AFTER_APPLIED_REINVESTMENT: Existen ${appliedRequests.length} solicitud(es) de reinversión ya APLICADAS en este ciclo. No se puede modificar la TRM porque los efectos contables y de capital ya fueron consumados.`
        );
      }

      // B. Leer cycleUserResults del ciclo
      const userResultsSnap = await db
        .collection("cycleUserResults")
        .where("cycleId", "==", targetCycleId)
        .get();

      // C. Leer cycleGroupCalculations del ciclo
      const groupCalculationsSnap = await db
        .collection("cycleGroupCalculations")
        .where("cycleId", "==", targetCycleId)
        .get();

      // D. Leer cycleFinancialSummaries del ciclo
      const summaryRef = db.collection("cycleFinancialSummaries").doc(targetCycleId);
      const summarySnap = await summaryRef.get();

      // 6. RECÁLCULO CONTABLE DE USUARIOS (cycleUserResults)
      const userResultUpdates = [];
      const userProfitMap = new Map(); // userUid -> newUserProfitCop

      let totalGrossUsd = 0;
      let totalGrossCop = 0;
      let totalUsersProfitCop = 0;
      let totalAdminCommissionCop = 0;

      for (const urDoc of userResultsSnap.docs) {
        const ur = urDoc.data() || {};
        const uUid = ur.userUid || ur.userId;

        // Fórmulas canónicas y validación de splits estrictos
        const calc = calculateUserFinancialResult({
          totalUsdOperated: ur.totalUsdOperated,
          trm: parsedTrm,
          userPercentage: ur.userPercentage,
          adminPercentage: ur.adminPercentage,
        });

        userProfitMap.set(uUid, calc.userProfitCop);

        totalGrossUsd += Number(ur.totalUsdOperated || 0);
        totalGrossCop += calc.totalGrossCop;
        totalUsersProfitCop += calc.userProfitCop;
        totalAdminCommissionCop += calc.adminCommissionCop;

        userResultUpdates.push({
          ref: urDoc.ref,
          data: {
            trmUsed: parsedTrm,
            trmSource: authoritativeTrm.source,
            trmSourceUrl: authoritativeTrm.sourceUrl,
            trmEffectiveDate: authoritativeTrm.effectiveDate,
            trmCapturedAt: authoritativeTrm.capturedAt,
            trmRateCents: authoritativeTrm.rateCents,
            totalGrossCop: calc.totalGrossCop,
            userProfitCop: calc.userProfitCop,
            adminCommissionCop: calc.adminCommissionCop,
            userProfitUsd: calc.userProfitUsd,
            adminCommissionUsd: calc.adminCommissionUsd,
            updatedAt: nowIso,
            updatedBy: createdByName,
          },
        });
      }

      // 7. RECÁLCULO DE GRUPOS (cycleGroupCalculations)
      const groupCalculationUpdates = [];
      for (const gcDoc of groupCalculationsSnap.docs) {
        const gc = gcDoc.data() || {};
        const usdApplied = Number(gc.accumulatedUsd !== undefined ? gc.accumulatedUsd : gc.totalUsdApplied) || 0;
        const usersCount = Number(gc.usersCount) || 1;
        const newCopPerUser = usdApplied * parsedTrm;
        const newGroupGrossCop = newCopPerUser * usersCount;

        groupCalculationUpdates.push({
          ref: gcDoc.ref,
          data: {
            trmUsed: parsedTrm,
            trmSource: authoritativeTrm.source,
            trmSourceUrl: authoritativeTrm.sourceUrl,
            trmEffectiveDate: authoritativeTrm.effectiveDate,
            trmCapturedAt: authoritativeTrm.capturedAt,
            trmRateCents: authoritativeTrm.rateCents,
            totalCopPerUser: newCopPerUser,
            totalGroupCop: newGroupGrossCop,
            accumulatedGrossCop: newGroupGrossCop,
            updatedAt: nowIso,
            updatedBy: createdByName,
          },
        });
      }

      // 8. RECÁLCULO DE SOLICITUDES DE REINVERSIÓN ACTIVAS
      const reinvestmentUpdates = [];
      let needsReviewCount = 0;

      for (const rDoc of allReinvestmentsSnap.docs) {
        const rData = rDoc.data() || {};
        const status = rData.status;

        // Excluir REJECTED o APPLIED
        if (status === "REJECTED" || status === "APPLIED") {
          continue;
        }

        const uUid = rData.userUid || rData.userId;
        const newProfitCop = userProfitMap.get(uUid) !== undefined ? userProfitMap.get(uUid) : Number(rData.cycleProfitSnapshotCop || 0);
        const positiveProfitCop = Math.max(newProfitCop, 0);
        const newReinvestableProfitCop = Math.floor(positiveProfitCop / 1_000_000) * 1_000_000;
        const currentCapital = Number(rData.currentCapitalSnapshotCop || 0);
        const requestType = rData.type; // "PROFIT_REINVESTMENT" o "CAPITAL_INJECTION"

        if (requestType === "PROFIT_REINVESTMENT") {
          const selectedReinv = Number(rData.selectedReinvestmentCop !== undefined ? rData.selectedReinvestmentCop : rData.profitAppliedCop);

          if (status === "PENDING") {
            if (selectedReinv >= 1_000_000 && selectedReinv <= newReinvestableProfitCop) {
              // Sigue siendo válida
              const profitToDisburse = Math.max(newProfitCop - selectedReinv, 0);
              reinvestmentUpdates.push({
                ref: rDoc.ref,
                data: {
                  cycleProfitSnapshotCop: newProfitCop,
                  availableProfitCop: newProfitCop,
                  reinvestableProfitCop: newReinvestableProfitCop,
                  profitAppliedCop: selectedReinv,
                  profitToDisburseCop: profitToDisburse,
                  updatedAt: nowIso,
                },
              });
            } else {
              // Deja de ser válida
              needsReviewCount++;
              const profitToDisburse = Math.max(newProfitCop - selectedReinv, 0);
              reinvestmentUpdates.push({
                ref: rDoc.ref,
                data: {
                  status: "NEEDS_REVIEW",
                  reviewReason: `TRM de liquidación modificada a $${parsedTrm.toLocaleString("es-CO")} COP. El monto seleccionado ($${selectedReinv.toLocaleString("es-CO")}) excede la nueva ganancia elegible ($${newReinvestableProfitCop.toLocaleString("es-CO")}).`,
                  cycleProfitSnapshotCop: newProfitCop,
                  availableProfitCop: newProfitCop,
                  reinvestableProfitCop: newReinvestableProfitCop,
                  profitToDisburseCop: profitToDisburse,
                  updatedAt: nowIso,
                },
              });
            }
          } else if (status === "APPROVED") {
            if (selectedReinv >= 1_000_000 && selectedReinv <= newReinvestableProfitCop) {
              // Conserva APPROVED y actualiza snapshots
              const profitToDisburse = Math.max(newProfitCop - selectedReinv, 0);
              reinvestmentUpdates.push({
                ref: rDoc.ref,
                data: {
                  cycleProfitSnapshotCop: newProfitCop,
                  availableProfitCop: newProfitCop,
                  reinvestableProfitCop: newReinvestableProfitCop,
                  profitToDisburseCop: profitToDisburse,
                  updatedAt: nowIso,
                },
              });
            } else {
              // Monto ya no es válido -> NEEDS_REVIEW
              needsReviewCount++;
              reinvestmentUpdates.push({
                ref: rDoc.ref,
                data: {
                  status: "NEEDS_REVIEW",
                  reviewReason: `TRM de liquidación modificada a $${parsedTrm.toLocaleString("es-CO")} COP. La ganancia elegible se redujo a $${newReinvestableProfitCop.toLocaleString("es-CO")} y no cubre el monto aprobado ($${selectedReinv.toLocaleString("es-CO")}). Requiere revalidación administrativa.`,
                  cycleProfitSnapshotCop: newProfitCop,
                  availableProfitCop: newProfitCop,
                  reinvestableProfitCop: newReinvestableProfitCop,
                  profitToDisburseCop: Math.max(newProfitCop - selectedReinv, 0),
                  updatedAt: nowIso,
                },
              });
            }
          } else if (status === "NEEDS_REVIEW" || status === "PREAPPROVED") {
            needsReviewCount++;
            reinvestmentUpdates.push({
              ref: rDoc.ref,
              data: {
                cycleProfitSnapshotCop: newProfitCop,
                availableProfitCop: newProfitCop,
                reinvestableProfitCop: newReinvestableProfitCop,
                profitToDisburseCop: Math.max(newProfitCop - selectedReinv, 0),
                updatedAt: nowIso,
              },
            });
          }
        } else if (requestType === "CAPITAL_INJECTION") {
          const desired = Number(rData.desiredCapitalIncreaseCop !== undefined ? rData.desiredCapitalIncreaseCop : rData.totalIncreaseCop);
          const oldProfitApplied = Number(rData.profitAppliedCop || 0);
          const oldCashInjection = Number(rData.cashInjectionCop || 0);

          // Cascada financiera canónica
          const newProfitApplied = Math.min(newReinvestableProfitCop, desired);
          const newCashInjection = Math.max(desired - newProfitApplied, 0);
          const newProfitToDisburse = Math.max(newProfitCop - newProfitApplied, 0);

          if (status === "PENDING") {
            reinvestmentUpdates.push({
              ref: rDoc.ref,
              data: {
                cycleProfitSnapshotCop: newProfitCop,
                availableProfitCop: newProfitCop,
                reinvestableProfitCop: newReinvestableProfitCop,
                profitAppliedCop: newProfitApplied,
                cashInjectionCop: newCashInjection,
                profitToDisburseCop: newProfitToDisburse,
                totalIncreaseCop: desired,
                projectedCapitalCop: currentCapital + desired,
                updatedAt: nowIso,
              },
            });
          } else if (status === "PREAPPROVED") {
            const cashChanged = oldCashInjection !== newCashInjection;
            if (cashChanged) {
              needsReviewCount++;
              reinvestmentUpdates.push({
                ref: rDoc.ref,
                data: {
                  status: "NEEDS_REVIEW",
                  reviewReason: `TRM de liquidación modificada a $${parsedTrm.toLocaleString("es-CO")} COP. El valor bancario a consignar en efectivo cambió de $${oldCashInjection.toLocaleString("es-CO")} a $${newCashInjection.toLocaleString("es-CO")}. Requiere nueva confirmación.`,
                  cycleProfitSnapshotCop: newProfitCop,
                  availableProfitCop: newProfitCop,
                  reinvestableProfitCop: newReinvestableProfitCop,
                  profitAppliedCop: newProfitApplied,
                  cashInjectionCop: newCashInjection,
                  profitToDisburseCop: newProfitToDisburse,
                  updatedAt: nowIso,
                },
              });
            } else {
              reinvestmentUpdates.push({
                ref: rDoc.ref,
                data: {
                  cycleProfitSnapshotCop: newProfitCop,
                  availableProfitCop: newProfitCop,
                  reinvestableProfitCop: newReinvestableProfitCop,
                  profitToDisburseCop: newProfitToDisburse,
                  updatedAt: nowIso,
                },
              });
            }
          } else if (status === "APPROVED") {
            const compositionChanged = (oldProfitApplied !== newProfitApplied) || (oldCashInjection !== newCashInjection);
            if (compositionChanged) {
              needsReviewCount++;
              reinvestmentUpdates.push({
                ref: rDoc.ref,
                data: {
                  status: "NEEDS_REVIEW",
                  reviewReason: `TRM de liquidación modificada a $${parsedTrm.toLocaleString("es-CO")} COP. La composición entre ganancias ($${newProfitApplied.toLocaleString("es-CO")}) y efectivo ($${newCashInjection.toLocaleString("es-CO")}) varió. Una inyección aprobada no debe mutar silenciosamente. Requiere revalidación administrativa.`,
                  cycleProfitSnapshotCop: newProfitCop,
                  availableProfitCop: newProfitCop,
                  reinvestableProfitCop: newReinvestableProfitCop,
                  profitAppliedCop: newProfitApplied,
                  cashInjectionCop: newCashInjection,
                  profitToDisburseCop: newProfitToDisburse,
                  updatedAt: nowIso,
                },
              });
            } else {
              reinvestmentUpdates.push({
                ref: rDoc.ref,
                data: {
                  cycleProfitSnapshotCop: newProfitCop,
                  availableProfitCop: newProfitCop,
                  reinvestableProfitCop: newReinvestableProfitCop,
                  profitToDisburseCop: newProfitToDisburse,
                  updatedAt: nowIso,
                },
              });
            }
          } else if (status === "NEEDS_REVIEW") {
            needsReviewCount++;
            reinvestmentUpdates.push({
              ref: rDoc.ref,
              data: {
                cycleProfitSnapshotCop: newProfitCop,
                availableProfitCop: newProfitCop,
                reinvestableProfitCop: newReinvestableProfitCop,
                profitAppliedCop: newProfitApplied,
                cashInjectionCop: newCashInjection,
                profitToDisburseCop: newProfitToDisburse,
                totalIncreaseCop: desired,
                projectedCapitalCop: currentCapital + desired,
                updatedAt: nowIso,
              },
            });
          }
        }
      }

      // 9. CONTEO PRE-FLIGHT REAL DE ESCRITURAS ATÓMICAS
      const requiredWrites =
        1 + // monthlyCycles (trmApplied, totales, release lock)
        userResultUpdates.length +
        groupCalculationUpdates.length +
        1 + // cycleFinancialSummaries
        reinvestmentUpdates.length +
        1; // auditLog

      const MAX_ATOMIC_WRITES = 450;
      if (requiredWrites > MAX_ATOMIC_WRITES) {
        await safelyReleaseLock();
        throw new HttpsError(
          "resource-exhausted",
          `TRM_RECALC_TOO_LARGE: La operación requiere ${requiredWrites} escrituras atómicas, lo cual excede el límite seguro de ${MAX_ATOMIC_WRITES}. Se liberó el lock para proteger la integridad del ciclo.`
        );
      }

      // 10. FASE C: COMMIT FINANCIERO ATÓMICO + LIBERACIÓN DEL LOCK (BATCH ATÓMICO)
      const batch = db.batch();

      // A. monthlyCycles
      batch.update(cycleRef, {
        trmApplied: parsedTrm,
        trmSource: authoritativeTrm.source,
        trmSourceUrl: authoritativeTrm.sourceUrl,
        trmEffectiveDate: authoritativeTrm.effectiveDate,
        trmCapturedAt: authoritativeTrm.capturedAt,
        trmRateCents: authoritativeTrm.rateCents,
        totalGrossCop,
        totalUsersProfitCop,
        totalAdminCommissionCop,
        // Liberar lock en el mismo commit atómico de éxito
        isClosing: false,
        closingStartedAt: null,
        closingByUid: null,
        closingByName: null,
        closureAttemptId: null,
        updatedAt: nowIso,
      });

      // B. cycleUserResults
      userResultUpdates.forEach((item) => {
        batch.update(item.ref, item.data);
      });

      // C. cycleGroupCalculations
      groupCalculationUpdates.forEach((item) => {
        batch.update(item.ref, item.data);
      });

      // D. cycleFinancialSummaries
      batch.set(
        summaryRef,
        {
          cycleId: targetCycleId,
          trmApplied: parsedTrm,
          trmSource: authoritativeTrm.source,
          trmSourceUrl: authoritativeTrm.sourceUrl,
          trmEffectiveDate: authoritativeTrm.effectiveDate,
          trmCapturedAt: authoritativeTrm.capturedAt,
          trmRateCents: authoritativeTrm.rateCents,
          totalGrossUsd,
          totalGrossCop,
          totalUsersProfitCop,
          totalAdminCommissionCop,
          calculatedUsersCount: userResultUpdates.length,
          calculatedGroupsCount: groupCalculationUpdates.length,
          updatedAt: nowIso,
          updatedBy: createdByName,
        },
        { merge: true }
      );

      // E. Reinvestments
      reinvestmentUpdates.forEach((item) => {
        batch.update(item.ref, item.data);
      });

      // F. Deterministic Audit Log
      batch.set(auditRef, {
        id: auditDocId,
        action: "CYCLE_TRM_UPDATED",
        type: "CYCLE_TRM_UPDATED",
        cycleId: targetCycleId,
        targetEntity: `monthlyCycles/${targetCycleId}`,
        performedBy: authUid,
        performedByName: createdByName,
        changedByUid: authUid,
        changedByName: createdByName,
        changedAt: nowIso,
        clientRequestId: cleanRequestId,
        reason: (reason || "").trim() || "Sincronización automática TRM desde Dolar-Colombia.com",
        details: {
          previousTrm,
          newTrm: parsedTrm,

          trmSource:
            authoritativeTrm.source,

          trmSourceUrl:
            authoritativeTrm.sourceUrl,

          trmEffectiveDate:
            authoritativeTrm.effectiveDate,

          trmCapturedAt:
            authoritativeTrm.capturedAt,

          trmRateCents:
            authoritativeTrm.rateCents,
          affectedUsersCount: userResultUpdates.length,
          affectedGroupsCount: groupCalculationUpdates.length,
          affectedReinvestmentsCount: reinvestmentUpdates.length,
          needsReviewCount,
          totalGrossCop,
          totalUsersProfitCop,
          totalAdminCommissionCop,
          requiredWrites,
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Ejecutar commit atómico de todas las mutaciones
      await batch.commit();

      return {
        success: true,
        cycleId: targetCycleId,
        previousTrm,
        newTrm: parsedTrm,

        trmSource:
          authoritativeTrm.source,

        trmSourceUrl:
          authoritativeTrm.sourceUrl,

        trmEffectiveDate:
          authoritativeTrm.effectiveDate,

        trmCapturedAt:
          authoritativeTrm.capturedAt,

        trmRateCents:
          authoritativeTrm.rateCents,
        affectedUsersCount: userResultUpdates.length,
        affectedGroupsCount: groupCalculationUpdates.length,
        affectedReinvestmentsCount: reinvestmentUpdates.length,
        needsReviewCount,
        message: `TRM de liquidación actualizada exitosamente a $${parsedTrm.toLocaleString("es-CO")} COP. Se recalcularon ${userResultUpdates.length} inversionistas y ${groupCalculationUpdates.length} grupos.`,
      };
    } catch (recalcErr) {
      console.error("[adminUpdateCycleTrmCallable] Error en el proceso de recálculo:", recalcErr);
      await safelyReleaseLock();
      if (recalcErr instanceof HttpsError) {
        throw recalcErr;
      }
      throw new HttpsError("internal", `Error interno durante el recálculo de TRM: ${recalcErr.message}`);
    }
  }
);

/**
 * ============================================================================
 * CALLABLES DE INFORMES OFICIALES DE CIERRE (EXCLUSIVO SUPERADMIN)
 * ============================================================================
 */

/**
 * Cloud Function HTTPS Callable: Generar PDF Oficial de Cierre bajo demanda.
 * No guarda archivos permanentemente en el servidor ni en Storage público.
 * Consume estrictamente el snapshot inmutable congelado en Firestore.
 */
exports.adminGenerateCycleReportPdfCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    // 1. Verificación estricta de SuperAdmin
    const { authUid, adminName } = await verifySuperAdminPrivileges(request);

    // 2. Parámetros
    const { cycleId, versionId } = request.data || {};
    if (!cycleId || typeof cycleId !== "string" || !cycleId.trim()) {
      throw new HttpsError("invalid-argument", "El parámetro 'cycleId' es obligatorio.");
    }
    if (!versionId || typeof versionId !== "string" || !versionId.trim()) {
      throw new HttpsError("invalid-argument", "El parámetro 'versionId' es obligatorio.");
    }

    const cleanCycleId = cycleId.trim();
    const cleanVersionId = versionId.trim();

    try {
      const { pdfBuffer, filename, metadata } = await generateCycleReportPdfBuffer(db, cleanCycleId, cleanVersionId);

      // Guardrail de Seguridad: Límite máximo de tamaño para transmisión directa Base64
      const MAX_PDF_BYTES = 7 * 1024 * 1024; // 7 MB
      if (pdfBuffer.length > MAX_PDF_BYTES) {
        throw new HttpsError(
          "resource-exhausted",
          `REPORT_PDF_TOO_LARGE: El documento PDF (${Math.round(pdfBuffer.length / 1024)} KB) excede el límite seguro permitido (${Math.round(MAX_PDF_BYTES / 1024)} KB).`
        );
      }

      // Registrar auditoría de generación de PDF
      await db.collection("auditLogs").add({
        action: "CYCLE_REPORT_PDF_GENERATED",
        cycleId: cleanCycleId,
        versionId: cleanVersionId,
        performedBy: authUid,
        performedByName: adminName,
        details: {
          filename,
          isCurrent: metadata.isCurrent,
          trmApplied: metadata.trmApplied,
          totalUsers: metadata.totalUsers,
          totalManagedCapital: metadata.totalManagedCapital,
        },
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});

      return {
        success: true,
        pdfBase64: pdfBuffer.toString("base64"),
        filename,
        metadata,
      };
    } catch (err) {
      console.error("[adminGenerateCycleReportPdfCallable] Error generando PDF:", err);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", `Error generando PDF oficial: ${err.message}`);
    }
  }
);

/**
 * Cloud Function HTTPS Callable: Generar Snapshot Retrospectivo para ciclos ya cerrados.
 * Permite documentar ciclos históricos previos a la implementación de snapshots inmutables.
 */
exports.adminGenerateRetrospectiveReportCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const { authUid, adminName } = await verifySuperAdminPrivileges(request);

    const { cycleId } = request.data || {};
    if (!cycleId || typeof cycleId !== "string" || !cycleId.trim()) {
      throw new HttpsError("invalid-argument", "El parámetro 'cycleId' es obligatorio.");
    }
    const cleanCycleId = cycleId.trim();

    // Validar que el ciclo exista y esté cerrado
    const cycleSnap = await db.collection("monthlyCycles").doc(cleanCycleId).get();
    if (!cycleSnap.exists) {
      throw new Error(`El ciclo '${cleanCycleId}' no existe.`);
    }
    const cData = cycleSnap.data() || {};
    if (cData.status !== "CLOSED") {
      throw new HttpsError("failed-precondition", `Solo se pueden generar informes de cierre para ciclos en estado CLOSED (estado actual: ${cData.status}).`);
    }

    try {
      const result = await createCycleReportSnapshot(
        db,
        admin,
        cleanCycleId,
        `retrospective_${Date.now()}`,
        authUid,
        adminName,
        "Generación retrospectiva autorizada por SuperAdmin",
        true
      );

      return {
        success: true,
        versionId: result.versionId,
        metadata: result.metadata,
        message: `Informe retrospectivo generado exitosamente para el ciclo ${cleanCycleId} (${result.versionId}).`,
      };
    } catch (err) {
      console.error("[adminGenerateRetrospectiveReportCallable] Error:", err);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", `Error generando informe retrospectivo: ${err.message}`);
    }
  }
);

/**
 * Cloud Function HTTPS Callable: Obtener Versiones de Informe de un Ciclo.
 */
exports.adminGetCycleReportVersionsCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    await verifySuperAdminPrivileges(request);

    const { cycleId } = request.data || {};
    if (!cycleId || typeof cycleId !== "string" || !cycleId.trim()) {
      throw new HttpsError("invalid-argument", "El parámetro 'cycleId' es obligatorio.");
    }
    const cleanCycleId = cycleId.trim();

    try {
      const versionsSnap = await db.collection("cycleReports")
        .doc(cleanCycleId)
        .collection("versions")
        .orderBy("versionNumber", "desc")
        .get();

      const versions = [];
      versionsSnap.forEach((doc) => {
        versions.push(doc.data());
      });

      return {
        success: true,
        cycleId: cleanCycleId,
        versions,
      };
    } catch (err) {
      console.error("[adminGetCycleReportVersionsCallable] Error:", err);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", `Error obteniendo versiones de informe: ${err.message}`);
    }
  }
);

/**
 * Cloud Function HTTPS Callable: Obtener Detalles Completos de una Versión de Informe.
 */
exports.adminGetCycleReportDetailsCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    await verifySuperAdminPrivileges(request);

    const { cycleId, versionId } = request.data || {};
    if (!cycleId || !versionId) {
      throw new HttpsError("invalid-argument", "cycleId y versionId son obligatorios.");
    }
    const cleanCycleId = String(cycleId).trim();
    const cleanVersionId = String(versionId).trim();

    try {
      const versionDocRef = db.collection("cycleReports").doc(cleanCycleId).collection("versions").doc(cleanVersionId);
      const versionSnap = await versionDocRef.get();
      if (!versionSnap.exists) {
        throw new HttpsError("not-found", `No se encontró la versión ${cleanVersionId} para el ciclo ${cleanCycleId}.`);
      }

      const metadata = versionSnap.data();
      const usersSnap = await versionDocRef.collection("users").get();
      const users = [];
      usersSnap.forEach((d) => users.push(d.data()));

      users.sort((a, b) => (a.userCode || "").localeCompare(b.userCode || ""));

      return {
        success: true,
        metadata,
        users,
      };
    } catch (err) {
      console.error("[adminGetCycleReportDetailsCallable] Error:", err);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", `Error obteniendo detalles del informe: ${err.message}`);
    }
  }
);

/**
 * Helper Puro: Generación de identificador canónico para ciclos arbitrarios.
 * Totalmente desacoplado de fechas, meses o lógica de calendario.
 * Utiliza crypto.randomUUID() nativo de Node.js.
 */
function generateCanonicalCycleId() {
  return `cyc_${crypto.randomUUID()}`;
}

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Cloud Function HTTPS Callable: adminCreateGenesisCycleCallable
 * Autoridad única y estricta para crear el primer ciclo del sistema (Ciclo Génesis en PREPARING)
 * a partir de una instalación limpia post-reset / sin historial operativo.
 *
 * Exclusivo para SuperAdmin.
 * Idempotencia estricta intra-transaccional (idempotencyKeys).
 * Genera candidateCycleId una sola vez fuera de la transacción.
 * Verifica FAIL-CLOSED ausencia total de historial operativo previo (Guard NO-HISTORY).
 */
exports.adminCreateGenesisCycleCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const { authUid, authEmail, createdByName } = await verifySuperAdminPrivileges(request);
    const { name, trmApplied, clientRequestId } = request.data || {};

    try {
      return await createGenesisCycleCore({
        db,
        authUid,
        createdByName,
        name,
        trmApplied,
        clientRequestId,
        isSuperAdmin: true,
      });
    } catch (err) {
      if (err.code === "permission-denied") {
        throw new HttpsError("permission-denied", err.message);
      }
      if (err.code === "invalid-argument") {
        throw new HttpsError("invalid-argument", err.message);
      }
      if (err.code === "already-exists") {
        throw new HttpsError("already-exists", err.message);
      }
      if (err.code === "failed-precondition") {
        throw new HttpsError("failed-precondition", err.message);
      }
      throw new HttpsError("internal", `Error transaccional al crear ciclo génesis: ${err.message || String(err)}`);
    }
  }
);

/**
 * Cloud Function HTTPS Callable: adminCreateNextCycleCallable
 * Autoridad única y estricta para crear y enlazar un ciclo sucesor (PREPARING)
 * a partir de un ciclo operativo activo (STARTED).
 *
 * Exclusivo para SuperAdmin.
 * Idempotencia estricta intra-transaccional (idempotencyKeys).
 * Genera candidateCycleId una sola vez fuera de la transacción para mantener el mismo ID durante transaction retries.
 * NO escribe en appConfig/global (0 lectores operativos; settings/global_config es la única autoridad canónica).
 */
exports.adminCreateNextCycleCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const { authUid, authEmail, createdByName } = await verifySuperAdminPrivileges(request);

    const { sourceCycleId, name, clientRequestId } = request.data || {};

    // 1. Validaciones de entrada estrictas
    if (!sourceCycleId || typeof sourceCycleId !== "string" || !sourceCycleId.trim()) {
      throw new HttpsError("invalid-argument", "INVALID_SOURCE_CYCLE_ID: sourceCycleId es obligatorio y debe ser un string no vacío.");
    }
    const cleanSourceCycleId = sourceCycleId.trim();

    if (!name || typeof name !== "string") {
      throw new HttpsError("invalid-argument", "INVALID_NAME: El nombre del ciclo es obligatorio.");
    }
    const cleanName = name.trim();
    if (cleanName.length < 3 || cleanName.length > 60) {
      throw new HttpsError("invalid-argument", "INVALID_NAME: El nombre del ciclo debe tener entre 3 y 60 caracteres.");
    }

    if (!clientRequestId || typeof clientRequestId !== "string") {
      throw new HttpsError("invalid-argument", "INVALID_CLIENT_REQUEST_ID: clientRequestId es obligatorio.");
    }
    const cleanClientRequestId = clientRequestId.trim();
    if (!UUID_V4_REGEX.test(cleanClientRequestId)) {
      throw new HttpsError(
        "invalid-argument",
        "INVALID_CLIENT_REQUEST_ID: clientRequestId debe ser un UUID v4 válido conforme a RFC 4122."
      );
    }

    // 2. Generar candidateCycleId UNA SOLA VEZ fuera de la transacción
    // (Mantiene el mismo candidateCycleId ante retries internos automáticos de Firestore)
    const candidateCycleId = generateCanonicalCycleId();

    const idemRef = db.collection("idempotencyKeys").doc(`create_next_${cleanClientRequestId}`);
    const sourceRef = db.collection("monthlyCycles").doc(cleanSourceCycleId);
    const candidateRef = db.collection("monthlyCycles").doc(candidateCycleId);
    const configRef = db.collection("settings").doc("global_config");
    const auditRef = db.collection("auditLogs").doc(`audit_create_next_${candidateCycleId}`);

    try {
      const result = await db.runTransaction(async (transaction) => {
        // === FASE DE LECTURAS (READ PHASE) ===
        // Todas las lecturas antes de cualquier escritura
        const [idemSnap, sourceSnap, candidateSnap, configSnap] = await Promise.all([
          transaction.get(idemRef),
          transaction.get(sourceRef),
          transaction.get(candidateRef),
          transaction.get(configRef),
        ]);

        // Guard contra colisión de ID generado
        if (candidateSnap.exists) {
          throw new HttpsError("already-exists", "CYCLE_ID_COLLISION: Colisión detectada al generar candidateCycleId.");
        }

        // A. Idempotencia estricta dentro de la transacción
        if (idemSnap.exists) {
          const idemData = idemSnap.data() || {};
          // Verificar payload semántico: action, sourceCycleId, normalizedName
          if (
            idemData.action !== "CREATE_NEXT_CYCLE" ||
            idemData.sourceCycleId !== cleanSourceCycleId ||
            idemData.normalizedName !== cleanName
          ) {
            throw new HttpsError(
              "already-exists",
              "IDEMPOTENCY_KEY_CONFLICT: El clientRequestId suministrado ya fue utilizado con parámetros diferentes."
            );
          }

          const existingCreatedCycleId = idemData.createdCycleId;

          // Validar coherencia del estado persistido
          const sourceData = sourceSnap.data() || {};
          if (sourceData.nextCycleId !== existingCreatedCycleId) {
            throw new HttpsError(
              "failed-precondition",
              `IDEMPOTENCY_STATE_CONFLICT: Incoherencia en el ciclo origen (${cleanSourceCycleId}). Su nextCycleId no coincide con ${existingCreatedCycleId}.`
            );
          }

          return {
            success: true,
            cycleId: existingCreatedCycleId,
            idempotentReplay: true,
          };
        }

        // B. Validaciones sobre el Ciclo Origen (Source Cycle)
        if (!sourceSnap.exists) {
          throw new HttpsError("not-found", `SOURCE_NOT_FOUND: El ciclo origen '${cleanSourceCycleId}' no existe.`);
        }

        const sourceData = sourceSnap.data() || {};

        const sourceIsStarted =
          (sourceData.status === "OPEN" || sourceData.status === "REOPENED") &&
          sourceData.operationalStatus === "STARTED";

        const sourceIsClosed = sourceData.status === "CLOSED";

        if (!sourceIsStarted && !sourceIsClosed) {
          throw new HttpsError(
            "failed-precondition",
            `SOURCE_NOT_ELIGIBLE: El ciclo origen '${cleanSourceCycleId}' debe estar STARTED o CLOSED para crear su sucesor. Estado actual: ${sourceData.status || "UNDEFINED"} / ${sourceData.operationalStatus || "UNDEFINED"}.`
          );
        }

        if (sourceData.nextCycleId) {
          throw new HttpsError(
            "already-exists",
            `NEXT_CYCLE_ALREADY_EXISTS: El ciclo origen '${cleanSourceCycleId}' ya cuenta con un sucesor enlazado (${sourceData.nextCycleId}).`
          );
        }

        // D. Verificación de configuración canónica (settings/global_config)
        const configData = configSnap.exists ? configSnap.data() || {} : {};

        const hasOperationalCycle =
          configData.operationalCycleId !== null &&
          configData.operationalCycleId !== undefined &&
          configData.operationalCycleId !== "";

        const hasPreparingCycle =
          configData.preparingCycleId !== null &&
          configData.preparingCycleId !== undefined &&
          configData.preparingCycleId !== "";

        if (hasPreparingCycle) {
          throw new HttpsError(
            "failed-precondition",
            `PREPARING_CYCLE_ALREADY_EXISTS: Ya existe un ciclo en preparacion (${configData.preparingCycleId}).`
          );
        }

        if (sourceIsStarted) {
          if (
            !hasOperationalCycle ||
            configData.operationalCycleId !== cleanSourceCycleId
          ) {
            throw new HttpsError(
              "failed-precondition",
              `CONFIG_CYCLE_MISMATCH: operationalCycleId (${configData.operationalCycleId || "null"}) no coincide con el ciclo origen (${cleanSourceCycleId}).`
            );
          }
        }

        if (sourceIsClosed && hasOperationalCycle) {
          throw new HttpsError(
            "failed-precondition",
            `POST_CLOSE_OPERATIONAL_CYCLE_EXISTS: Existe otro ciclo operativo (${configData.operationalCycleId}).`
          );
        }

        // === FASE DE ESCRITURAS (WRITE PHASE) ===
        const nowIso = new Date().toISOString();

        // 1. Creación del nuevo ciclo sucesor B en PREPARING (Desacoplado de TRM estática previa)
        const newCyclePayload = {
          id: candidateCycleId,
          cycleId: candidateCycleId,
          name: cleanName,
          status: "OPEN",
          operationalStatus: "PREPARING",
          previousCycleId: cleanSourceCycleId,
          nextCycleId: null,
          cohortVersion: 1,
          sourceClosureVersion: sourceIsClosed
            ? Number(sourceData.closureVersion || 1)
            : null,
          preparationNeedsReview: false,
          trmApplied: null,
          closingTrm: null,
          closingTrmSetAt: null,
          closingTrmSetByUid: null,
          closingTrmSetByName: null,
          observedMarketTrmAtClose: null,
          createdAt: nowIso,
          openedAt: nowIso, // retrocompatibilidad documental legacy
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

        // 2. Enlazar A -> B en el ciclo origen
        transaction.update(sourceRef, {
          nextCycleId: candidateCycleId,
          updatedAt: nowIso,
        });

        // 3. Actualizar configuracion canonica
        const configUpdate = {
          preparingCycleId: candidateCycleId,
          updatedAt: nowIso,
        };

        // Si A ya estaba CLOSED, B se convierte en el ciclo activo visible,
        // pero sigue PREPARING hasta que el SuperAdmin haga START.
        if (sourceIsClosed) {
          configUpdate.operationalCycleId = null;
          configUpdate.activeCycleId = candidateCycleId;
        }

        transaction.set(
          configRef,
          configUpdate,
          { merge: true }
        );

        // 4. Persistir registro atómico de idempotencia
        transaction.set(idemRef, {
          action: "CREATE_NEXT_CYCLE",
          sourceCycleId: cleanSourceCycleId,
          normalizedName: cleanName,
          createdCycleId: candidateCycleId,
          clientRequestId: cleanClientRequestId,
          createdByUid: authUid,
          createdByName: createdByName,
          createdAt: nowIso,
        });

        // 5. Auditoría administrativa
        transaction.set(auditRef, {
          action: "ADMIN_CREATE_NEXT_CYCLE",
          sourceCycleId: cleanSourceCycleId,
          createdCycleId: candidateCycleId,
          name: cleanName,
          performedBy: authUid,
          performedByName: createdByName,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          clientRequestId: cleanClientRequestId,
        });

        return {
          success: true,
          cycleId: candidateCycleId,
          idempotentReplay: false,
        };
      });

      return result;
    } catch (err) {
      console.error("[adminCreateNextCycleCallable] Error:", err);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", `Error al crear el ciclo sucesor: ${err.message}`);
    }
  }
);

const {
  getProtectedAccounts,
  computeResetPlanHash,
  buildTestEnvironmentResetPlan,
  auditUserActiveFinancialDependencies,
  executeTestEnvironmentResetCore,
  deleteIndividualUserCore,
} = require("./testEnvironmentResetCore");

/**
 * =========================================================================
 * FASE 1: RESET TOTAL DE ENTORNO DE PRUEBA Y BORRADO INDIVIDUAL SEGURO
 * =========================================================================
 */

/**
 * Helper: Serialización segura para JSON / HTTPS Callable.
 * Elimina recursivamente referencias circulares (Firestore DocumentReference en 'ref')
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

exports.serializeResetPlanForCallable = serializeResetPlanForCallable;

/**
 * OBJETIVO A: PREVIEW DEL RESET TOTAL DE ENTORNO DE PRUEBA
 * READ-ONLY: Cero escrituras, cero borrados, no muta Auth ni Firestore.
 * Construye el plan detallado y el hash criptográfico SHA-256 determinístico.
 */
exports.adminPreviewTestEnvironmentResetCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    // 1. Verificación estricta de SuperAdmin
    const { authUid, authEmail, createdByName } = await verifySuperAdminPrivileges(request);

    // 2. Construir plan único determinístico - FAIL CLOSED
    try {
      const { plan, previewHash } = await buildTestEnvironmentResetPlan(authUid, authEmail, db, admin.auth());

      // Serialización segura sin mutar ni recalcular el previewHash autoritativo
      const serializablePlan = serializeResetPlanForCallable(plan);

      return {
        success: true,
        dryRun: true,
        mode: "READ_ONLY_PLAN",
        executedAt: new Date().toISOString(),
        requestedBy: { uid: authUid, email: authEmail, name: createdByName },
        previewHash,
        plan: serializablePlan,
        summary: {
          totalAuthUsersToDelete: plan.authUsersToDelete.length,
          totalFirestoreUsersToDelete: plan.firestoreUsersToDelete.length,
          totalCyclesToDelete: plan.monthlyCyclesToDelete.length,
          idempotencyKeysToDeleteCount: plan.idempotencyKeysToDelete.length,
          unclassifiedIdempotencyKeysPreservedCount: plan.unclassifiedIdempotencyKeys.length,
          notificationsToDeleteCount: plan.notificationsToDelete.length,
          preservedNotificationsCount: plan.preservedNotifications.length,
          investorApplicationsToDeleteCount: plan.investorApplicationsToDelete.length,
          preservedApplicationsCount: plan.preservedApplications.length,
          claimOperationsToDeleteCount: plan.claimOperationsToDelete.length,
          preservedClaimOperationsCount: plan.preservedClaimOperations.length,
          bitacorasToDeleteCount: plan.bitacorasToDelete.length,
          preservedBitacorasCount: plan.preservedBitacoras.length,
          requiredConfirmationPhrase: "REINICIAR ENTORNO DE PRUEBA",
        },
      };
    } catch (err) {
      console.error("[adminPreviewTestEnvironmentResetCallable] Error:", err);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", err.message);
    }
  }
);

/**
 * OBJETIVO B: RESET TOTAL DE ENTORNO DE PRUEBA (EJECUCIÓN ATÓMICA POR LOTES)
 * Nombre canónico obligatorio: adminResetTestEnvironmentCallable.
 * Exige frase exacta: REINICIAR ENTORNO DE PRUEBA.
 * Exige expectedPreviewHash y valida que no haya cambiado (RESET_PREVIEW_STALE). CERO mutaciones antes.
 */
exports.adminResetTestEnvironmentCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    // 1. Verificación estricta de SuperAdmin
    const { authUid, authEmail, createdByName } = await verifySuperAdminPrivileges(request);

    const data = request.data || {};

    try {
      return await executeTestEnvironmentResetCore({
        authUid,
        authEmail,
        createdByName,
        confirmation: data.confirmation,
        expectedPreviewHash: data.expectedPreviewHash,
        db,
        auth: admin.auth(),
        FieldValue: admin.firestore.FieldValue,
      });
    } catch (err) {
      console.error("[adminResetTestEnvironmentCallable] Error:", err);
      if (err.code === "invalid-argument") throw new HttpsError("invalid-argument", err.message);
      if (err.code === "failed-precondition") throw new HttpsError("failed-precondition", err.message);
      if (err.code === "permission-denied") throw new HttpsError("permission-denied", err.message);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", err.message);
    }
  }
);

/**
 * OBJETIVO C: BORRADO INDIVIDUAL SEGURO DE USUARIO
 * Nombre canónico: adminDeleteUserCallable.
 * Exige confirmación exacta: "ELIMINAR {userCode}" o "ELIMINAR {email}".
 * Bloquea con failed-precondition USER_HAS_ACTIVE_FINANCIAL_DEPENDENCIES si el usuario tiene flujos activos.
 * Si el usuario solo tiene histórico CLOSED, PRESERVA cycleUserResults, reinvestments, disbursements, investments y dailyOperations.
 * Si falla auth.deleteUser(), ABORTA antes de tocar Firestore.
 * Acción de auditoría: ADMIN_USER_DELETED.
 */
exports.adminDeleteUserCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    // 1. Verificación estricta de SuperAdmin
    const { authUid, authEmail, createdByName } = await verifySuperAdminPrivileges(request);

    const data = request.data || {};
    const targetInput = data.userId || data.uid || data.targetUserId || data.id;

    try {
      return await deleteIndividualUserCore({
        authUid,
        authEmail,
        createdByName,
        targetId: targetInput,
        confirmation: data.confirmation,
        db,
        auth: admin.auth(),
        FieldValue: admin.firestore.FieldValue,
      });
    } catch (err) {
      console.error("[adminDeleteUserCallable] Error:", err);
      if (err.code === "invalid-argument") throw new HttpsError("invalid-argument", err.message);
      if (err.code === "failed-precondition") throw new HttpsError("failed-precondition", err.message);
      if (err.code === "permission-denied") throw new HttpsError("permission-denied", err.message);
      if (err.code === "not-found") throw new HttpsError("not-found", err.message);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", err.message);
    }
  }
);

// =========================================================================
// MÓDULO DE SOPORTE TÉCNICO Y PERMISOS GRANULARES (FASES S1, S2, S3)
// =========================================================================
const {
  getAuthoritativeActorContext,
  verifySupportPrivileges,
  updateSupportPermissionsCore,
  createSupportTicketCore,
  replySupportTicketCore,
  addInternalNoteCore,
  assignSupportTicketCore,
  updateSupportTicketStatusCore,
  getSupportUserContextCore,
} = require("./supportCore");

/**
 * Cloud Function Callable: Conceder o revocar permisos de soporte.
 * EXCLUSIVAMENTE SUPERADMIN.
 */
exports.adminUpdateSupportPermissionsCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const { authUid, authEmail, createdByName } = await verifySuperAdminPrivileges(request);
    const data = request.data || {};

    try {
      return await updateSupportPermissionsCore({
        db,
        admin,
        authUid,
        authEmail,
        callerName: createdByName,
        targetUid: data.targetUid,
        permissions: data.permissions,
        clientRequestId: data.clientRequestId,
      });
    } catch (err) {
      console.error("[adminUpdateSupportPermissionsCallable] Error:", err);
      if (err.code === "invalid-argument") throw new HttpsError("invalid-argument", err.message);
      if (err.code === "failed-precondition") throw new HttpsError("failed-precondition", err.message);
      if (err.code === "permission-denied") throw new HttpsError("permission-denied", err.message);
      if (err.code === "not-found") throw new HttpsError("not-found", err.message);
      if (err.code === "already-exists") throw new HttpsError("already-exists", err.message);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", err.message);
    }
  }
);

/**
 * Cloud Function Callable: Crear ticket de soporte con correlativo SUP-XXXXXX transaccional.
 */
exports.supportCreateTicketCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión para crear un ticket de soporte.");
    }
    const data = request.data || {};

    try {
      return await createSupportTicketCore({
        db,
        admin,
        authUid: request.auth.uid,
        subject: data.subject,
        category: data.category,
        description: data.description,
        clientRequestId: data.clientRequestId,
      });
    } catch (err) {
      console.error("[supportCreateTicketCallable] Error:", err);
      if (err.code === "invalid-argument") throw new HttpsError("invalid-argument", err.message);
      if (err.code === "failed-precondition") throw new HttpsError("failed-precondition", err.message);
      if (err.code === "not-found") throw new HttpsError("not-found", err.message);
      if (err.code === "already-exists") throw new HttpsError("already-exists", err.message);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", err.message);
    }
  }
);

/**
 * Cloud Function Callable: Responder a un ticket de soporte.
 */
exports.supportReplyTicketCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión para responder al ticket.");
    }
    const data = request.data || {};

    try {
      const actorContext = await getAuthoritativeActorContext({ request, db });
      return await replySupportTicketCore({
        db,
        admin,
        authUid: request.auth.uid,
        ticketId: data.ticketId,
        text: data.text,
        clientRequestId: data.clientRequestId,
        actorContext,
      });
    } catch (err) {
      console.error("[supportReplyTicketCallable] Error:", err);
      if (err.code === "invalid-argument") throw new HttpsError("invalid-argument", err.message);
      if (err.code === "failed-precondition") throw new HttpsError("failed-precondition", err.message);
      if (err.code === "permission-denied") throw new HttpsError("permission-denied", err.message);
      if (err.code === "not-found") throw new HttpsError("not-found", err.message);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", err.message);
    }
  }
);

/**
 * Cloud Function Callable: Agregar nota interna en ticket (Soporte / SuperAdmin).
 */
exports.supportAddInternalNoteCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const authResult = await verifySupportPrivileges({ request, db, admin });
    const data = request.data || {};

    try {
      return await addInternalNoteCore({
        db,
        admin,
        authUid: authResult.authUid,
        ticketId: data.ticketId,
        noteText: data.noteText,
        clientRequestId: data.clientRequestId,
      });
    } catch (err) {
      console.error("[supportAddInternalNoteCallable] Error:", err);
      if (err.code === "invalid-argument") throw new HttpsError("invalid-argument", err.message);
      if (err.code === "not-found") throw new HttpsError("not-found", err.message);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", err.message);
    }
  }
);

/**
 * Cloud Function Callable: Asignar o tomar ticket de soporte.
 */
exports.supportAssignTicketCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const authResult = await verifySupportPrivileges({ request, db, admin });
    const data = request.data || {};

    try {
      return await assignSupportTicketCore({
        db,
        admin,
        authUid: authResult.authUid,
        callerName: authResult.callerName,
        isSuperAdmin: authResult.isSuperAdmin,
        ticketId: data.ticketId,
        assignedToUid: data.assignedToUid,
        clientRequestId: data.clientRequestId,
      });
    } catch (err) {
      console.error("[supportAssignTicketCallable] Error:", err);
      if (err.code === "invalid-argument") throw new HttpsError("invalid-argument", err.message);
      if (err.code === "failed-precondition") throw new HttpsError("failed-precondition", err.message);
      if (err.code === "permission-denied") throw new HttpsError("permission-denied", err.message);
      if (err.code === "not-found") throw new HttpsError("not-found", err.message);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", err.message);
    }
  }
);

/**
 * Cloud Function Callable: Actualizar estado de ticket de soporte.
 */
exports.supportUpdateTicketStatusCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const authResult = await verifySupportPrivileges({ request, db, admin });
    const data = request.data || {};

    try {
      return await updateSupportTicketStatusCore({
        db,
        admin,
        authUid: authResult.authUid,
        callerName: authResult.callerName,
        isSuperAdmin: authResult.isSuperAdmin,
        ticketId: data.ticketId,
        status: data.status,
        reason: data.reason,
        clientRequestId: data.clientRequestId,
      });
    } catch (err) {
      console.error("[supportUpdateTicketStatusCallable] Error:", err);
      if (err.code === "invalid-argument") throw new HttpsError("invalid-argument", err.message);
      if (err.code === "failed-precondition") throw new HttpsError("failed-precondition", err.message);
      if (err.code === "not-found") throw new HttpsError("not-found", err.message);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", err.message);
    }
  }
);

/**
 * Cloud Function Callable: Obtener contexto de diagnóstico del usuario (Solo Lectura).
 */
exports.supportGetUserContextCallable = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const authResult = await verifySupportPrivileges({ request, db, admin });
    const data = request.data || {};

    try {
      return await getSupportUserContextCore({
        db,
        admin,
        authUid: authResult.authUid,
        callerName: authResult.callerName,
        permissions: authResult.permissions,
        isSuperAdmin: authResult.isSuperAdmin,
        ticketId: data.ticketId,
      });
    } catch (err) {
      console.error("[supportGetUserContextCallable] Error:", err);
      if (err.code === "invalid-argument") throw new HttpsError("invalid-argument", err.message);
      if (err.code === "failed-precondition") throw new HttpsError("failed-precondition", err.message);
      if (err.code === "not-found") throw new HttpsError("not-found", err.message);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", err.message);
    }
  }
);
