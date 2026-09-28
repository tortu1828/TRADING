const crypto = require("crypto");

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SUPERADMIN_UIDS = new Set([
  "lpx4NLEEMkeh9EJFcG68oPMVdXF2",
]);

const SUPERADMIN_EMAILS = new Set([
  "juanes9802@gmail.com",
  "elcocalombiano1828@gmail.com",
]);

const VALID_TICKET_CATEGORIES = new Set([
  "ACCOUNT_ACCESS",
  "CAPITAL",
  "CYCLE",
  "OPERATIONS",
  "PROFITS",
  "REINVESTMENT",
  "WITHDRAWAL",
  "NOTIFICATIONS",
  "TECHNICAL",
  "OTHER",
]);

const VALID_TICKET_STATUSES = new Set([
  "OPEN",
  "IN_PROGRESS",
  "WAITING_USER",
  "RESOLVED",
  "CLOSED",
]);

function validateClientRequestId(clientRequestId, required = true) {
  if (!clientRequestId || typeof clientRequestId !== "string") {
    if (required) {
      const err = new Error("clientRequestId es obligatorio y debe ser un UUID v4 válido.");
      err.code = "invalid-argument";
      throw err;
    }
    return null;
  }
  const clean = clientRequestId.trim();
  if (!UUID_V4_REGEX.test(clean)) {
    const err = new Error("clientRequestId inválido: debe ser un UUID v4.");
    err.code = "invalid-argument";
    throw err;
  }
  return clean;
}

/**
 * Resuelve el contexto autoritativo del llamador.
 * NUNCA deriva privilegios de SuperAdmin desde userData.email (campo mutable en Firestore).
 * ÚNICAMENTE desde request.auth.uid, request.auth.token.email, token claims o userData.role === 'ADMIN'.
 */
async function getAuthoritativeActorContext({ request, db }) {
  if (!request.auth || !request.auth.uid) {
    const err = new Error("El usuario debe estar autenticado en Firebase Auth.");
    err.code = "unauthenticated";
    throw err;
  }

  const authUid = request.auth.uid;
  const tokenEmail = (request.auth.token && request.auth.token.email) ? request.auth.token.email.toLowerCase() : "";
  const tokenRole = request.auth.token ? (request.auth.token.role || (request.auth.token.superadmin ? "admin" : null)) : null;

  const userDocSnap = await db.collection("users").doc(authUid).get();
  const userData = userDocSnap.exists ? ((typeof userDocSnap.data === "function" ? userDocSnap.data() : userDocSnap.data) || {}) : {};

  let isSuperAdmin = false;
  if (
    SUPERADMIN_UIDS.has(authUid) ||
    SUPERADMIN_EMAILS.has(tokenEmail) ||
    tokenRole === "admin" ||
    userData.role === "ADMIN"
  ) {
    isSuperAdmin = true;
  }

  const permissions = userData.permissions || {};
  const isSupportAgent = isSuperAdmin || (permissions.supportAgent === true && userData.status === "ACTIVE");

  const callerName = userData.fullName || userData.displayName || tokenEmail || "Usuario";
  const callerUserCode = userData.userCode || "";

  return {
    authUid,
    authEmail: tokenEmail,
    isSuperAdmin,
    isSupportAgent,
    callerName,
    callerUserCode,
    permissions,
    userData,
  };
}

/**
 * Verifica privilegios de Agente de Soporte o SuperAdmin.
 * NO otorga privilegios de administración financiera.
 */
async function verifySupportPrivileges({ request, db, admin }) {
  const actor = await getAuthoritativeActorContext({ request, db });

  if (!actor.isSupportAgent) {
    const err = new Error("Acceso denegado: Se requieren permisos de Agente de Soporte o SuperAdmin.");
    err.code = "permission-denied";
    throw err;
  }

  return actor;
}

/**
 * Concede o revoca permisos de soporte a un usuario canónico.
 * EXCLUSIVAMENTE SUPERADMIN.
 * Namespace Idempotencia: supp_perm_
 */
async function updateSupportPermissionsCore({
  db,
  admin,
  authUid,
  authEmail,
  callerName,
  targetUid,
  permissions,
  clientRequestId,
}) {
  if (!targetUid || typeof targetUid !== "string" || !targetUid.trim()) {
    const err = new Error("targetUid es obligatorio.");
    err.code = "invalid-argument";
    throw err;
  }

  const cleanTargetUid = targetUid.trim();
  const cleanClientRequestId = validateClientRequestId(clientRequestId, true);
  const idemRef = db.collection("idempotencyKeys").doc(`supp_perm_${cleanClientRequestId}`);

  const targetUserRef = db.collection("users").doc(cleanTargetUid);
  const targetSnap = await targetUserRef.get();
  const targetExists = typeof targetSnap.exists === "function" ? targetSnap.exists() : targetSnap.exists;
  if (!targetExists) {
    const err = new Error(`El usuario objetivo (${cleanTargetUid}) no existe.`);
    err.code = "not-found";
    throw err;
  }

  const targetData = typeof targetSnap.data === "function" ? targetSnap.data() : targetSnap.data;

  // Validación: Solo usuarios en estado ACTIVE pueden recibir permisos de soporte
  if (targetData.status !== "ACTIVE") {
    const err = new Error(`CANONICAL_USER_NOT_ACTIVE: Solo usuarios con estado ACTIVE pueden ser agentes de soporte (estado actual: ${targetData.status || "DESCONOCIDO"}).`);
    err.code = "failed-precondition";
    throw err;
  }

  // Validación: No permitir si está pendiente de activación/reclamo
  if (targetData.isClaimed === false || targetData.status === "PENDING_CLAIM" || targetData.status === "PENDING") {
    const err = new Error("PENDING_CLAIM_DENIED: Un usuario no reclamado no puede recibir permisos de soporte.");
    err.code = "failed-precondition";
    throw err;
  }

  const incomingPerms = permissions || {};
  const isAgent = Boolean(incomingPerms.supportAgent);

  // Normalización estricta: si supportAgent es false, los demás permisos de soporte se anulan
  const normalizedPermissions = {
    supportAgent: isAgent,
    supportReadUserContext: isAgent ? Boolean(incomingPerms.supportReadUserContext) : false,
    supportReadOperationalContext: isAgent ? Boolean(incomingPerms.supportReadOperationalContext) : false,
    updatedAt: new Date().toISOString(),
    updatedByUid: authUid,
    updatedByName: callerName || "SuperAdmin",
  };

  const payloadFingerprint = `${cleanTargetUid}_${JSON.stringify(normalizedPermissions)}`;
  const previousPermissions = targetData.permissions || null;

  let isReplay = false;
  let finalPermissions = normalizedPermissions;

  await db.runTransaction(async (transaction) => {
    // 1. TODAS LAS LECTURAS PRIMERO
    const idemSnap = await transaction.get(idemRef);
    const idemExists = typeof idemSnap.exists === "function" ? idemSnap.exists() : idemSnap.exists;
    if (idemExists) {
      const existing = typeof idemSnap.data === "function" ? idemSnap.data() : idemSnap.data;
      if (existing && existing.fingerprint === payloadFingerprint) {
        isReplay = true;
        finalPermissions = existing.permissions;
        return;
      }
      const conflictErr = new Error(`IDEMPOTENCY_KEY_CONFLICT: La llave '${cleanClientRequestId}' ya fue utilizada con otro objetivo o payload.`);
      conflictErr.code = "already-exists";
      throw conflictErr;
    }

    // 2. ESCRITURAS
    transaction.update(targetUserRef, {
      permissions: normalizedPermissions,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    transaction.set(idemRef, {
      action: "UPDATE_SUPPORT_PERMISSIONS",
      targetUid: cleanTargetUid,
      permissions: normalizedPermissions,
      fingerprint: payloadFingerprint,
      clientRequestId: cleanClientRequestId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const auditRef = db.collection("auditLogs").doc();
    transaction.set(auditRef, {
      action: "SUPPORT_PERMISSIONS_UPDATED",
      targetUid: cleanTargetUid,
      targetUserCode: targetData.userCode || "",
      previousPermissions,
      newPermissions: normalizedPermissions,
      changedByUid: authUid,
      changedByName: callerName || "SuperAdmin",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return {
    success: true,
    targetUid: cleanTargetUid,
    permissions: finalPermissions,
    idempotentReplay: isReplay,
  };
}

/**
 * Creación de Ticket de Soporte con asignación de número transaccional SUP-XXXXXX
 * Idempotencia transaccional real: todas las lecturas (idemRef, counterRef) dentro de la transacción.
 * Namespace Idempotencia: supp_ticket_create_
 */
async function createSupportTicketCore({
  db,
  admin,
  authUid,
  subject,
  category,
  description,
  clientRequestId = null,
}) {
  if (!authUid) {
    const err = new Error("Usuario no autenticado.");
    err.code = "unauthenticated";
    throw err;
  }

  const cleanSubject = typeof subject === "string" ? subject.trim() : "";
  if (cleanSubject.length < 5 || cleanSubject.length > 120) {
    const err = new Error("El asunto del ticket debe tener entre 5 y 120 caracteres.");
    err.code = "invalid-argument";
    throw err;
  }

  const cleanDesc = typeof description === "string" ? description.trim() : "";
  if (cleanDesc.length < 10 || cleanDesc.length > 2000) {
    const err = new Error("La descripción del ticket debe tener entre 10 y 2000 caracteres.");
    err.code = "invalid-argument";
    throw err;
  }

  const cleanCat = typeof category === "string" ? category.trim() : "";
  if (!VALID_TICKET_CATEGORIES.has(cleanCat)) {
    const err = new Error(`Categoría '${cleanCat}' no válida.`);
    err.code = "invalid-argument";
    throw err;
  }

  const cleanReqId = validateClientRequestId(clientRequestId, false) || `temp_${crypto.randomUUID()}`;
  const payloadFingerprint = `${authUid}_${cleanCat}_${cleanSubject}_${cleanDesc}`;

  const userDocSnap = await db.collection("users").doc(authUid).get();
  if (!userDocSnap.exists) {
    const err = new Error("Perfil de usuario no encontrado.");
    err.code = "not-found";
    throw err;
  }
  const userData = typeof userDocSnap.data === "function" ? userDocSnap.data() : userDocSnap.data;
  if (userData.status !== "ACTIVE") {
    const err = new Error("Tu cuenta debe estar activa para crear tickets de soporte.");
    err.code = "failed-precondition";
    throw err;
  }

  const idemRef = db.collection("idempotencyKeys").doc(`supp_ticket_create_${cleanReqId}`);
  const counterRef = db.collection("counters").doc("supportTickets");

  let isReplay = false;
  let finalTicketId = "";
  let finalTicketNumber = "";

  await db.runTransaction(async (transaction) => {
    // 1. TODAS LAS LECTURAS PRIMERO (REGLA FIRESTORE TRANSACCIÓN)
    const idemSnap = await transaction.get(idemRef);
    const idemExists = typeof idemSnap.exists === "function" ? idemSnap.exists() : idemSnap.exists;
    if (idemExists) {
      const data = typeof idemSnap.data === "function" ? idemSnap.data() : idemSnap.data;
      if (data && data.fingerprint === payloadFingerprint) {
        isReplay = true;
        finalTicketId = data.ticketId;
        finalTicketNumber = data.ticketNumber;
        return;
      }
      const conflictErr = new Error(`IDEMPOTENCY_KEY_CONFLICT: clientRequestId '${cleanReqId}' ya fue utilizado con payload diferente.`);
      conflictErr.code = "already-exists";
      throw conflictErr;
    }

    const counterSnap = await transaction.get(counterRef);
    let nextNum = 1;
    if (counterSnap.exists) {
      const cData = (typeof counterSnap.data === "function" ? counterSnap.data() : counterSnap.data) || {};
      nextNum = Number(cData.nextTicketNumber) || 1;
      transaction.update(counterRef, {
        nextTicketNumber: nextNum + 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      transaction.set(counterRef, {
        nextTicketNumber: nextNum + 1,
        initializedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    finalTicketNumber = `SUP-${String(nextNum).padStart(6, "0")}`;
    finalTicketId = `tick_${crypto.randomUUID()}`;
    const ticketRef = db.collection("supportTickets").doc(finalTicketId);
    const messageId = `msg_${crypto.randomUUID()}`;
    const messageRef = ticketRef.collection("messages").doc(messageId);

    const nowIso = new Date().toISOString();

    const newTicket = {
      ticketId: finalTicketId,
      ticketNumber: finalTicketNumber,
      createdByUid: authUid,
      createdByUserId: authUid,
      createdByUserCode: userData.userCode || "",
      createdByName: userData.fullName || "Usuario",
      createdByEmail: userData.email || "",
      subject: cleanSubject,
      category: cleanCat,
      description: cleanDesc,
      status: "OPEN",
      priority: "NORMAL",
      assignedToUid: null,
      assignedToName: null,
      assignedAt: null,
      lastMessagePreview: cleanDesc.slice(0, 120),
      lastMessageByUid: authUid,
      lastMessageByName: userData.fullName || "Usuario",
      lastMessageSenderType: "USER",
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      messageCount: 1,
      unreadByUser: false,
      unreadBySupport: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      resolvedAt: null,
      resolvedByUid: null,
      resolvedByName: null,
      closedAt: null,
      closedByUid: null,
      closedByName: null,
      closedReason: null,
    };

    const firstMessage = {
      messageId,
      ticketId: finalTicketId,
      senderUid: authUid,
      senderName: userData.fullName || "Usuario",
      senderUserCode: userData.userCode || "",
      senderType: "USER",
      text: cleanDesc,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    transaction.set(ticketRef, newTicket);
    transaction.set(messageRef, firstMessage);

    transaction.set(idemRef, {
      action: "CREATE_SUPPORT_TICKET",
      ticketId: finalTicketId,
      ticketNumber: finalTicketNumber,
      fingerprint: payloadFingerprint,
      clientRequestId: cleanReqId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  if (isReplay) {
    return {
      success: true,
      ticketId: finalTicketId,
      ticketNumber: finalTicketNumber,
      idempotentReplay: true,
    };
  }

  // Fanout exactamente una vez (ligado al clientRequestId / eventId)
  try {
    const agentsSnap = await db.collection("users")
      .where("permissions.supportAgent", "==", true)
      .where("status", "==", "ACTIVE")
      .get();

    const targetAgentUids = new Set();
    agentsSnap.forEach((doc) => {
      if (doc.id !== authUid) targetAgentUids.add(doc.id);
    });

    SUPERADMIN_UIDS.forEach((suid) => {
      if (suid !== authUid) targetAgentUids.add(suid);
    });

    const notifBatch = db.batch();
    for (const agentUid of targetAgentUids) {
      const notifId = `notif_sup_create_${cleanReqId}_${agentUid}`;
      const notifRef = db.collection("notifications").doc(notifId);
      notifBatch.set(notifRef, {
        id: notifId,
        userId: agentUid,
        userUid: agentUid,
        type: "SUPPORT_TICKET",
        title: `Nuevo Ticket: ${finalTicketNumber}`,
        message: `${userData.fullName || "Un usuario"} reportó ticket en ${cleanCat}: "${cleanSubject.slice(0, 60)}"`,
        actionUrl: "/support",
        payload: { ticketId: finalTicketId, ticketNumber: finalTicketNumber, category: cleanCat },
        isRead: false,
        sentAt: new Date().toISOString(),
      });
    }
    await notifBatch.commit().catch(() => {});
  } catch (notifErr) {
    console.warn("[createSupportTicketCore] Error enviando notificaciones fanout a soporte:", notifErr);
  }

  return {
    success: true,
    ticketId: finalTicketId,
    ticketNumber: finalTicketNumber,
    idempotentReplay: false,
  };
}

/**
 * Responder a un Ticket de Soporte
 * SEGURIDAD: SuperAdmin se verifica EXCLUSIVAMENTE mediante actorContext autoritativo (token/UID).
 * NUNCA se utiliza userData.email.
 * Namespace Idempotencia: supp_reply_
 */
async function replySupportTicketCore({
  db,
  admin,
  authUid,
  ticketId,
  text,
  clientRequestId = null,
  actorContext = null,
}) {
  if (!authUid) {
    const err = new Error("Usuario no autenticado.");
    err.code = "unauthenticated";
    throw err;
  }

  const cleanText = typeof text === "string" ? text.trim() : "";
  if (cleanText.length < 1 || cleanText.length > 3000) {
    const err = new Error("El mensaje debe contener entre 1 y 3000 caracteres.");
    err.code = "invalid-argument";
    throw err;
  }

  const cleanReqId = validateClientRequestId(clientRequestId, false) || `temp_${crypto.randomUUID()}`;
  const payloadFingerprint = `${ticketId}_${authUid}_${cleanText}`;
  const idemRef = db.collection("idempotencyKeys").doc(`supp_reply_${cleanReqId}`);

  const ticketRef = db.collection("supportTickets").doc(ticketId);
  const ticketSnap = await ticketRef.get();
  if (!ticketSnap.exists) {
    const err = new Error(`El ticket ${ticketId} no existe.`);
    err.code = "not-found";
    throw err;
  }

  const ticketData = typeof ticketSnap.data === "function" ? ticketSnap.data() : ticketSnap.data;
  if (ticketData.status === "CLOSED") {
    const err = new Error("TICKET_CLOSED: No se pueden agregar respuestas a un ticket cerrado.");
    err.code = "failed-precondition";
    throw err;
  }

  const userDocSnap = await db.collection("users").doc(authUid).get();
  const userData = userDocSnap.exists ? ((typeof userDocSnap.data === "function" ? userDocSnap.data() : userDocSnap.data) || {}) : {};

  // Autoridad autoritativa:
  const isOwner = ticketData.createdByUid === authUid;
  let isSuperAdmin = false;
  let isAgent = false;

  if (actorContext) {
    isSuperAdmin = Boolean(actorContext.isSuperAdmin);
    isAgent = Boolean(actorContext.isSupportAgent || isSuperAdmin);
  } else {
    // Si no viene contexto previo, determinar autoridad estrictamente sin userData.email:
    if (
      SUPERADMIN_UIDS.has(authUid) ||
      (actorContext && actorContext.authEmail && SUPERADMIN_EMAILS.has(actorContext.authEmail.toLowerCase())) ||
      userData.role === "ADMIN"
    ) {
      isSuperAdmin = true;
    }
    isAgent = isSuperAdmin || (userData.permissions && userData.permissions.supportAgent === true && userData.status === "ACTIVE");
  }

  if (!isOwner && !isAgent) {
    const err = new Error("Acceso denegado: No tienes autorización para responder este ticket.");
    err.code = "permission-denied";
    throw err;
  }

  let senderType = "USER";
  if (isSuperAdmin) {
    senderType = "SUPERADMIN";
  } else if (isAgent && !isOwner) {
    senderType = "SUPPORT";
  }

  let nextStatus = ticketData.status;
  let unreadByUser = ticketData.unreadByUser;
  let unreadBySupport = ticketData.unreadBySupport;

  if (senderType === "USER") {
    unreadBySupport = true;
    unreadByUser = false;
    if (ticketData.status === "WAITING_USER") {
      nextStatus = "IN_PROGRESS";
    }
  } else {
    unreadByUser = true;
    unreadBySupport = false;
  }

  const messageId = `msg_${crypto.randomUUID()}`;
  const messageRef = ticketRef.collection("messages").doc(messageId);

  let isReplay = false;
  let finalMessageId = messageId;
  let finalStatus = nextStatus;

  await db.runTransaction(async (transaction) => {
    // 1. TODAS LAS LECTURAS PRIMERO
    const idemSnap = await transaction.get(idemRef);
    const idemExists = typeof idemSnap.exists === "function" ? idemSnap.exists() : idemSnap.exists;
    if (idemExists) {
      const data = typeof idemSnap.data === "function" ? idemSnap.data() : idemSnap.data;
      if (data && data.fingerprint === payloadFingerprint) {
        isReplay = true;
        finalMessageId = data.messageId;
        finalStatus = data.status;
        return;
      }
      const conflictErr = new Error(`IDEMPOTENCY_KEY_CONFLICT: clientRequestId '${cleanReqId}' ya fue utilizado con payload diferente.`);
      conflictErr.code = "already-exists";
      throw conflictErr;
    }

    // 2. ESCRITURAS
    const newMessage = {
      messageId,
      ticketId,
      senderUid: authUid,
      senderName: userData.fullName || (senderType === "USER" ? "Usuario" : "Soporte"),
      senderUserCode: userData.userCode || "",
      senderType,
      text: cleanText,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    transaction.set(messageRef, newMessage);
    transaction.update(ticketRef, {
      status: nextStatus,
      lastMessagePreview: cleanText.slice(0, 120),
      lastMessageByUid: authUid,
      lastMessageByName: userData.fullName || "Soporte",
      lastMessageSenderType: senderType,
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      messageCount: admin.firestore.FieldValue.increment(1),
      unreadByUser,
      unreadBySupport,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    transaction.set(idemRef, {
      action: "REPLY_SUPPORT_TICKET",
      ticketId,
      messageId,
      status: nextStatus,
      fingerprint: payloadFingerprint,
      clientRequestId: cleanReqId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  if (isReplay) {
    return {
      success: true,
      messageId: finalMessageId,
      status: finalStatus,
      idempotentReplay: true,
    };
  }

  // Notificación exactly-once ligada a cleanReqId
  try {
    if (senderType === "USER") {
      const assignedUid = ticketData.assignedToUid;
      if (assignedUid && assignedUid !== authUid) {
        const notifId = `notif_sup_reply_${cleanReqId}_${assignedUid}`;
        await db.collection("notifications").doc(notifId).set({
          id: notifId,
          userId: assignedUid,
          userUid: assignedUid,
          type: "SUPPORT_TICKET",
          title: `Respuesta en ${ticketData.ticketNumber}`,
          message: `${userData.fullName || "El usuario"} respondió en el ticket "${ticketData.subject.slice(0, 50)}"`,
          actionUrl: "/support",
          payload: { ticketId, ticketNumber: ticketData.ticketNumber },
          isRead: false,
          sentAt: new Date().toISOString(),
        });
      } else {
        // F. USER REPLY SIN AGENTE ASIGNADO: Fanout a agentes ACTIVE y SuperAdmins (deduplicados)
        const agentsSnap = await db.collection("users")
          .where("permissions.supportAgent", "==", true)
          .where("status", "==", "ACTIVE")
          .get();

        const targetAgentUids = new Set();
        agentsSnap.forEach((doc) => {
          if (doc.id !== authUid) targetAgentUids.add(doc.id);
        });

        SUPERADMIN_UIDS.forEach((suid) => {
          if (suid !== authUid) targetAgentUids.add(suid);
        });

        const notifBatch = db.batch();
        for (const agentUid of targetAgentUids) {
          const notifId = `notif_sup_reply_${cleanReqId}_${agentUid}`;
          const notifRef = db.collection("notifications").doc(notifId);
          notifBatch.set(notifRef, {
            id: notifId,
            userId: agentUid,
            userUid: agentUid,
            type: "SUPPORT_TICKET",
            title: `Respuesta de usuario en ${ticketData.ticketNumber}`,
            message: `${userData.fullName || "El usuario"} respondió en el ticket sin asignar "${ticketData.subject.slice(0, 50)}"`,
            actionUrl: "/support",
            payload: { ticketId, ticketNumber: ticketData.ticketNumber },
            isRead: false,
            sentAt: new Date().toISOString(),
          });
        }
        await notifBatch.commit().catch(() => {});
      }
    } else {
      const recipientUid = ticketData.createdByUid;
      if (recipientUid && recipientUid !== authUid) {
        const notifId = `notif_sup_reply_${cleanReqId}_${recipientUid}`;
        await db.collection("notifications").doc(notifId).set({
          id: notifId,
          userId: recipientUid,
          userUid: recipientUid,
          type: "SUPPORT_TICKET",
          title: `Respuesta de Soporte en ${ticketData.ticketNumber}`,
          message: `El equipo de soporte ha respondido a tu solicitud "${ticketData.subject.slice(0, 50)}"`,
          actionUrl: "/support",
          payload: { ticketId, ticketNumber: ticketData.ticketNumber },
          isRead: false,
          sentAt: new Date().toISOString(),
        });
      }
    }
  } catch (e) {
    console.warn("[replySupportTicketCore] Error notificando respuesta:", e);
  }

  return {
    success: true,
    messageId,
    status: nextStatus,
    idempotentReplay: false,
  };
}

/**
 * Agregar Nota Interna en un Ticket (Exclusivo Soporte / SuperAdmin)
 * Namespace Idempotencia: supp_note_
 */
async function addInternalNoteCore({
  db,
  admin,
  authUid,
  ticketId,
  noteText,
  clientRequestId = null,
}) {
  const cleanNote = typeof noteText === "string" ? noteText.trim() : "";
  if (cleanNote.length < 1 || cleanNote.length > 3000) {
    const err = new Error("La nota interna debe tener entre 1 y 3000 caracteres.");
    err.code = "invalid-argument";
    throw err;
  }

  const cleanReqId = validateClientRequestId(clientRequestId, false) || `temp_${crypto.randomUUID()}`;
  const payloadFingerprint = `${ticketId}_${authUid}_${cleanNote}`;
  const idemRef = db.collection("idempotencyKeys").doc(`supp_note_${cleanReqId}`);

  const ticketRef = db.collection("supportTickets").doc(ticketId);
  const ticketSnap = await ticketRef.get();
  if (!ticketSnap.exists) {
    const err = new Error(`El ticket ${ticketId} no existe.`);
    err.code = "not-found";
    throw err;
  }

  const userDocSnap = await db.collection("users").doc(authUid).get();
  const userData = userDocSnap.exists ? ((typeof userDocSnap.data === "function" ? userDocSnap.data() : userDocSnap.data) || {}) : {};

  const noteId = `note_${crypto.randomUUID()}`;
  const noteRef = ticketRef.collection("internalNotes").doc(noteId);

  let isReplay = false;
  let finalNoteId = noteId;

  await db.runTransaction(async (transaction) => {
    // 1. TODAS LAS LECTURAS PRIMERO
    const idemSnap = await transaction.get(idemRef);
    const idemExists = typeof idemSnap.exists === "function" ? idemSnap.exists() : idemSnap.exists;
    if (idemExists) {
      const data = typeof idemSnap.data === "function" ? idemSnap.data() : idemSnap.data;
      if (data && data.fingerprint === payloadFingerprint) {
        isReplay = true;
        finalNoteId = data.noteId;
        return;
      }
      const conflictErr = new Error(`IDEMPOTENCY_KEY_CONFLICT: clientRequestId '${cleanReqId}' ya fue utilizado con payload diferente.`);
      conflictErr.code = "already-exists";
      throw conflictErr;
    }

    // 2. ESCRITURAS
    const noteDoc = {
      noteId,
      ticketId,
      authorUid: authUid,
      authorName: userData.fullName || "Agente de Soporte",
      noteText: cleanNote,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    transaction.set(noteRef, noteDoc);
    transaction.set(idemRef, {
      action: "ADD_INTERNAL_NOTE",
      ticketId,
      noteId,
      fingerprint: payloadFingerprint,
      clientRequestId: cleanReqId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return {
    success: true,
    noteId: finalNoteId,
    idempotentReplay: isReplay,
  };
}

/**
 * Asignar o Tomar un Ticket de Soporte
 * Namespace Idempotencia: supp_assign_
 */
async function assignSupportTicketCore({
  db,
  admin,
  authUid,
  callerName,
  isSuperAdmin,
  ticketId,
  assignedToUid = null,
  clientRequestId = null,
}) {
  const cleanReqId = validateClientRequestId(clientRequestId, false) || `temp_${crypto.randomUUID()}`;
  const ticketRef = db.collection("supportTickets").doc(ticketId);
  const ticketSnap = await ticketRef.get();
  if (!ticketSnap.exists) {
    const err = new Error(`El ticket ${ticketId} no existe.`);
    err.code = "not-found";
    throw err;
  }

  const ticketData = typeof ticketSnap.data === "function" ? ticketSnap.data() : ticketSnap.data;
  let targetAssigneeUid = authUid;
  let targetAssigneeName = callerName || "Agente de Soporte";

  if (assignedToUid && assignedToUid.trim() && assignedToUid.trim() !== authUid) {
    if (!isSuperAdmin) {
      const err = new Error("SELF_ASSIGN_ONLY: Los agentes de soporte solo pueden auto-asignarse tickets a sí mismos.");
      err.code = "permission-denied";
      throw err;
    }
    const cleanTargetUid = assignedToUid.trim();
    const targetUserSnap = await db.collection("users").doc(cleanTargetUid).get();
    if (!targetUserSnap.exists) {
      const err = new Error(`El agente destino ${cleanTargetUid} no existe.`);
      err.code = "not-found";
      throw err;
    }
    const targetData = typeof targetUserSnap.data === "function" ? targetUserSnap.data() : targetUserSnap.data;
    if (targetData.permissions?.supportAgent !== true && targetData.role !== "ADMIN") {
      const err = new Error("TARGET_NOT_SUPPORT_AGENT: El usuario destino no cuenta con permisos de agente de soporte.");
      err.code = "failed-precondition";
      throw err;
    }
    targetAssigneeUid = cleanTargetUid;
    targetAssigneeName = targetData.fullName || "Agente de Soporte";
  }

  const payloadFingerprint = `${ticketId}_${targetAssigneeUid}`;
  const idemRef = db.collection("idempotencyKeys").doc(`supp_assign_${cleanReqId}`);

  let nextStatus = ticketData.status;
  if (ticketData.status === "OPEN") {
    nextStatus = "IN_PROGRESS";
  }

  let isReplay = false;
  let finalStatus = nextStatus;

  await db.runTransaction(async (transaction) => {
    // 1. LECTURAS
    const idemSnap = await transaction.get(idemRef);
    const idemExists = typeof idemSnap.exists === "function" ? idemSnap.exists() : idemSnap.exists;
    if (idemExists) {
      const data = typeof idemSnap.data === "function" ? idemSnap.data() : idemSnap.data;
      if (data && data.fingerprint === payloadFingerprint) {
        isReplay = true;
        finalStatus = data.status;
        return;
      }
      const conflictErr = new Error(`IDEMPOTENCY_KEY_CONFLICT: clientRequestId '${cleanReqId}' ya fue utilizado con payload diferente.`);
      conflictErr.code = "already-exists";
      throw conflictErr;
    }

    // 2. ESCRITURAS
    transaction.update(ticketRef, {
      assignedToUid: targetAssigneeUid,
      assignedToName: targetAssigneeName,
      assignedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: nextStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const auditRef = db.collection("auditLogs").doc();
    transaction.set(auditRef, {
      action: ticketData.assignedToUid ? "SUPPORT_TICKET_REASSIGNED" : "SUPPORT_TICKET_ASSIGNED",
      ticketId,
      ticketNumber: ticketData.ticketNumber,
      previousAssignedToUid: ticketData.assignedToUid || null,
      assignedToUid: targetAssigneeUid,
      assignedToName: targetAssigneeName,
      performedByUid: authUid,
      performedByName: callerName || "Soporte",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    transaction.set(idemRef, {
      action: "ASSIGN_SUPPORT_TICKET",
      ticketId,
      assignedToUid: targetAssigneeUid,
      status: nextStatus,
      fingerprint: payloadFingerprint,
      clientRequestId: cleanReqId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return {
    success: true,
    ticketId,
    assignedToUid: targetAssigneeUid,
    assignedToName: targetAssigneeName,
    status: finalStatus,
    idempotentReplay: isReplay,
  };
}

/**
 * Actualizar Estado de un Ticket
 * Namespace Idempotencia: supp_status_
 */
async function updateSupportTicketStatusCore({
  db,
  admin,
  authUid,
  callerName,
  isSuperAdmin,
  ticketId,
  status,
  reason = null,
  clientRequestId = null,
}) {
  const cleanStatus = typeof status === "string" ? status.trim() : "";
  if (!VALID_TICKET_STATUSES.has(cleanStatus)) {
    const err = new Error(`Estado '${cleanStatus}' no válido.`);
    err.code = "invalid-argument";
    throw err;
  }

  const cleanReqId = validateClientRequestId(clientRequestId, false) || `temp_${crypto.randomUUID()}`;
  const payloadFingerprint = `${ticketId}_${cleanStatus}_${reason || ""}`;
  const idemRef = db.collection("idempotencyKeys").doc(`supp_status_${cleanReqId}`);

  const ticketRef = db.collection("supportTickets").doc(ticketId);
  const ticketSnap = await ticketRef.get();
  if (!ticketSnap.exists) {
    const err = new Error(`El ticket ${ticketId} no existe.`);
    err.code = "not-found";
    throw err;
  }

  const ticketData = typeof ticketSnap.data === "function" ? ticketSnap.data() : ticketSnap.data;
  const currentStatus = ticketData.status;

  const validTransitions = {
    OPEN: ["IN_PROGRESS"],
    IN_PROGRESS: ["WAITING_USER", "RESOLVED"],
    WAITING_USER: ["IN_PROGRESS", "RESOLVED"],
    RESOLVED: ["IN_PROGRESS", "CLOSED"],
    CLOSED: [],
  };

  const isTransitionAllowed = validTransitions[currentStatus] && validTransitions[currentStatus].includes(cleanStatus);

  if (!isTransitionAllowed && !isSuperAdmin) {
    const err = new Error(`INVALID_TRANSITION: No se permite cambiar de '${currentStatus}' a '${cleanStatus}'.`);
    err.code = "failed-precondition";
    throw err;
  }

  const updatePayload = {
    status: cleanStatus,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (cleanStatus === "RESOLVED") {
    updatePayload.resolvedAt = admin.firestore.FieldValue.serverTimestamp();
    updatePayload.resolvedByUid = authUid;
    updatePayload.resolvedByName = callerName || "Soporte";
  } else if (cleanStatus === "CLOSED") {
    updatePayload.closedAt = admin.firestore.FieldValue.serverTimestamp();
    updatePayload.closedByUid = authUid;
    updatePayload.closedByName = callerName || "Soporte";
    updatePayload.closedReason = typeof reason === "string" ? reason.trim() : null;
  }

  let isReplay = false;
  let finalStatus = cleanStatus;

  await db.runTransaction(async (transaction) => {
    // 1. LECTURAS
    const idemSnap = await transaction.get(idemRef);
    const idemExists = typeof idemSnap.exists === "function" ? idemSnap.exists() : idemSnap.exists;
    if (idemExists) {
      const data = typeof idemSnap.data === "function" ? idemSnap.data() : idemSnap.data;
      if (data && data.fingerprint === payloadFingerprint) {
        isReplay = true;
        finalStatus = data.newStatus;
        return;
      }
      const conflictErr = new Error(`IDEMPOTENCY_KEY_CONFLICT: clientRequestId '${cleanReqId}' ya fue utilizado con payload diferente.`);
      conflictErr.code = "already-exists";
      throw conflictErr;
    }

    // 2. ESCRITURAS
    transaction.update(ticketRef, updatePayload);

    const auditRef = db.collection("auditLogs").doc();
    transaction.set(auditRef, {
      action: "SUPPORT_TICKET_STATUS_CHANGED",
      ticketId,
      ticketNumber: ticketData.ticketNumber,
      previousStatus: currentStatus,
      newStatus: cleanStatus,
      reason: reason || null,
      isSuperAdminOverride: !isTransitionAllowed && isSuperAdmin,
      performedByUid: authUid,
      performedByName: callerName || "Soporte",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    transaction.set(idemRef, {
      action: "UPDATE_SUPPORT_STATUS",
      ticketId,
      previousStatus: currentStatus,
      newStatus: cleanStatus,
      fingerprint: payloadFingerprint,
      clientRequestId: cleanReqId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  if (isReplay) {
    return {
      success: true,
      ticketId,
      previousStatus: currentStatus,
      newStatus: finalStatus,
      idempotentReplay: true,
    };
  }

  // Notificar al cliente si se marcó WAITING_USER o RESOLVED con notificationId determinístico
  try {
    if (cleanStatus === "WAITING_USER" || cleanStatus === "RESOLVED") {
      const recipientUid = ticketData.createdByUid;
      const title = cleanStatus === "RESOLVED"
        ? `Ticket Resuelto: ${ticketData.ticketNumber}`
        : `Información Requerida: ${ticketData.ticketNumber}`;
      const msg = cleanStatus === "RESOLVED"
        ? `Tu solicitud ha sido marcada como resuelta por soporte.`
        : `El soporte necesita información adicional para continuar con tu solicitud.`;

      const notifId = `notif_sup_status_${cleanReqId}_${recipientUid}`;
      await db.collection("notifications").doc(notifId).set({
        id: notifId,
        userId: recipientUid,
        userUid: recipientUid,
        type: "SUPPORT_TICKET",
        title,
        message: msg,
        actionUrl: "/support",
        payload: { ticketId, ticketNumber: ticketData.ticketNumber, newStatus: cleanStatus },
        isRead: false,
        sentAt: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.warn("[updateSupportTicketStatusCore] Error enviando notificación de estado:", e);
  }

  return {
    success: true,
    ticketId,
    previousStatus: currentStatus,
    newStatus: cleanStatus,
    idempotentReplay: false,
  };
}

/**
 * Consulta autoritativa de contexto de cliente para diagnóstico técnico (Solo Lectura)
 * SEGURIDAD: Auditoría FAIL-CLOSED (si falla escribir el log de auditoría, se aborta y no se retorna la información).
 * NO incluye payload financiero completo en auditoría.
 */
async function getSupportUserContextCore({
  db,
  admin,
  authUid,
  callerName,
  permissions,
  isSuperAdmin,
  ticketId,
}) {
  if (!ticketId || typeof ticketId !== "string" || !ticketId.trim()) {
    const err = new Error("ticketId es obligatorio.");
    err.code = "invalid-argument";
    throw err;
  }

  const ticketRef = db.collection("supportTickets").doc(ticketId.trim());
  const ticketSnap = await ticketRef.get();
  if (!ticketSnap.exists) {
    const err = new Error(`El ticket ${ticketId} no existe.`);
    err.code = "not-found";
    throw err;
  }

  const ticketData = typeof ticketSnap.data === "function" ? ticketSnap.data() : ticketSnap.data;
  const targetUid = ticketData.createdByUid;

  if (!targetUid) {
    const err = new Error("El ticket carece de createdByUid.");
    err.code = "failed-precondition";
    throw err;
  }

  const userSnap = await db.collection("users").doc(targetUid).get();
  if (!userSnap.exists) {
    const err = new Error("El usuario dueño del ticket ya no existe.");
    err.code = "not-found";
    throw err;
  }

  const uData = typeof userSnap.data === "function" ? userSnap.data() : userSnap.data;

  // Filtrar si tiene permiso de contexto personal
  const canReadUserContext = isSuperAdmin || permissions.supportReadUserContext === true;
  if (!canReadUserContext) {
    return {
      success: true,
      hasUserContext: false,
      hasOperationalContext: false,
      message: "El agente no cuenta con el permiso supportReadUserContext asignado.",
    };
  }

  // Sanitización estricta: NO contraseñas, hashes, push tokens ni secretos
  const sanitizedUser = {
    uid: targetUid,
    fullName: uData.fullName || "",
    userCode: uData.userCode || "",
    status: uData.status || "",
    category: uData.category || "AZUL",
    currentCapital: Number(uData.currentCapital || 0),
    entryCycleId: uData.entryCycleId || null,
    createdAt: uData.createdAt || null,
  };

  let operationalContext = null;
  const canReadOperational = isSuperAdmin || permissions.supportReadOperationalContext === true;

  if (canReadOperational) {
    // 1. Ciclo Activo
    const configSnap = await db.collection("settings").doc("global_config").get();
    const cData = configSnap.exists ? ((typeof configSnap.data === "function" ? configSnap.data() : configSnap.data) || {}) : {};
    const activeCycleId = cData.activeCycleId || cData.operationalCycleId || null;

    // 2. CycleUserResult
    let currentResult = null;
    if (activeCycleId) {
      const resSnap = await db.collection("cycleUserResults").doc(`${activeCycleId}_${targetUid}`).get();
      if (resSnap.exists) {
        const rData = typeof resSnap.data === "function" ? resSnap.data() : resSnap.data;
        currentResult = {
          totalUsdOperated: rData.totalUsdOperated || 0,
          totalGrossCop: rData.totalGrossCop || 0,
          userProfitCop: rData.userProfitCop || 0,
          trmUsed: rData.trmUsed || 0,
        };
      }
    }

    // 3. Operaciones Diarias limitadas a 10
    const opsSnap = await db.collection("dailyOperations")
      .where("authorizedUids", "array-contains", targetUid)
      .limit(10)
      .get();
    const recentOperations = [];
    opsSnap.forEach((d) => {
      const op = typeof d.data === "function" ? d.data() : d.data;
      recentOperations.push({
        id: d.id,
        date: op.date,
        amountUsd: op.amountUsd,
        trmUsed: op.trmUsed,
        grossCop: op.grossCop,
      });
    });

    // 4. Solicitud de reinversión
    let reinvestment = null;
    if (activeCycleId) {
      const reinvSnap = await db.collection("reinvestments").doc(`${activeCycleId}_${targetUid}`).get();
      if (reinvSnap.exists) {
        const reinvData = typeof reinvSnap.data === "function" ? reinvSnap.data() : reinvSnap.data;
        reinvestment = {
          status: reinvData.status,
          modality: reinvData.modality,
          totalIncreaseCop: reinvData.totalIncreaseCop || 0,
        };
      }
    }

    operationalContext = {
      activeCycleId,
      currentResult,
      recentOperations,
      reinvestment,
    };
  }

  // G. AUDITORÍA DE CONTEXTO: FAIL-CLOSED. No hay .catch(() => {}). Si falla, aborta y no entrega contexto.
  // NO incluye payload financiero completo en audit.
  await db.collection("auditLogs").add({
    action: "SUPPORT_USER_CONTEXT_ACCESSED",
    ticketId: ticketData.ticketId,
    ticketNumber: ticketData.ticketNumber,
    targetUid,
    supportUid: authUid,
    supportName: callerName || "Soporte",
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    success: true,
    hasUserContext: true,
    hasOperationalContext: canReadOperational,
    user: sanitizedUser,
    operationalContext,
  };
}

module.exports = {
  getAuthoritativeActorContext,
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
};
