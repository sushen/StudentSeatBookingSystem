import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import admin from "firebase-admin";

admin.initializeApp();

setGlobalOptions({
  region: "asia-south1",
  maxInstances: 20
});

const db = admin.firestore();
const auth = admin.auth();
const { FieldValue } = admin.firestore;

const ADMIN_EMAILS = new Set([
  "sushen.biswas.aga@gmail.com",
  "sushen.biswas.aga@googlemail.com"
]);

const BOOKING_EXPIRY_MS = 15 * 60 * 1000;

const BOOKING_STATUS_PENDING = "pending";
const BOOKING_STATUS_REVIEWING = "reviewing";
const BOOKING_STATUS_APPROVED = "approved";
const BOOKING_STATUS_REJECTED = "rejected";
const BOOKING_STATUS_CANCELLED = "cancelled";
const BOOKING_STATUS_EXPIRED = "expired";

const ACTIVE_REVIEWABLE_BOOKING_STATUSES = new Set([
  BOOKING_STATUS_PENDING,
  BOOKING_STATUS_REVIEWING
]);

const LEGACY_PHASE_ID_MAP = new Map([
  ["phase_1", "phase1"],
  ["phase_2", "phase2"],
  ["phase_3", "phase3"],
  ["phase_4", "phase4"],
  ["phase_5", "phase5"],
  ["phase_6", "phase6"]
]);

const CANONICAL_TO_LEGACY_PHASE_ID_MAP = new Map(
  Array.from(LEGACY_PHASE_ID_MAP.entries()).map(([legacy, canonical]) => [canonical, legacy])
);

const CANONICAL_PHASES = [
  { phaseId: "phase1", title: "Foundations", description: "AI prompting and logic thinking", level: "Beginner", order: 1, totalSeats: 100, bookedSeats: 0 },
  { phaseId: "phase2", title: "Data Analysis", description: "Data analysis workflows and practical reasoning", level: "Beginner", order: 2, totalSeats: 100, bookedSeats: 0 },
  { phaseId: "phase3", title: "Software Engineering", description: "Engineering practice and implementation discipline", level: "Intermediate", order: 3, totalSeats: 100, bookedSeats: 0 },
  { phaseId: "phase4", title: "System Architecture", description: "Architecture-level design and tradeoff decisions", level: "Intermediate", order: 4, totalSeats: 100, bookedSeats: 0 },
  { phaseId: "phase5", title: "Reliability and Consistency", description: "Consistency, reliability, and correctness patterns", level: "Advanced", order: 5, totalSeats: 100, bookedSeats: 0 },
  { phaseId: "phase6", title: "Production Engineering", description: "Production operations and continuous improvement", level: "Advanced", order: 6, totalSeats: 100, bookedSeats: 0 }
];

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value) {
  return normalizeString(value).toLowerCase();
}

function canonicalizePhaseId(phaseId) {
  const normalized = normalizeString(phaseId).toLowerCase();
  if (!normalized) {
    return "";
  }
  return LEGACY_PHASE_ID_MAP.get(normalized) || normalized;
}

function getLegacyPhaseIdForCanonical(canonicalPhaseId) {
  return CANONICAL_TO_LEGACY_PHASE_ID_MAP.get(canonicalizePhaseId(canonicalPhaseId)) || null;
}

function normalizePhone(value) {
  const normalized = normalizeString(value).replace(/[\s\-()]/g, "");
  if (!/^\+?[0-9]{8,15}$/.test(normalized)) {
    throw new HttpsError("invalid-argument", "Invalid phone or WhatsApp number.");
  }
  return normalized;
}

function normalizeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeStatus(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (
    normalized === BOOKING_STATUS_PENDING ||
    normalized === BOOKING_STATUS_REVIEWING ||
    normalized === BOOKING_STATUS_APPROVED ||
    normalized === BOOKING_STATUS_REJECTED ||
    normalized === BOOKING_STATUS_CANCELLED ||
    normalized === BOOKING_STATUS_EXPIRED
  ) {
    return normalized;
  }
  return BOOKING_STATUS_PENDING;
}

function toMillis(value) {
  if (!value) {
    return null;
  }
  if (typeof value?.toMillis === "function") {
    return value.toMillis();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value.seconds === "number") {
    return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000);
  }
  return null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const unique = new Set(
    value.map((item) => normalizeString(item)).filter(Boolean)
  );
  return Array.from(unique);
}

function normalizeBookingDoc(docId, data = {}) {
  const rawPhaseId = normalizeString(data.phaseId) || normalizeString(data.phase) || normalizeString(data.phaseKey);
  const rawCanonicalPhaseId = normalizeString(data.phaseCanonicalId);
  const rawLegacyPhaseId = normalizeString(data.phaseLegacyId);
  const canonicalPhaseId = canonicalizePhaseId(rawCanonicalPhaseId || rawPhaseId || rawLegacyPhaseId);
  const status = normalizeStatus(data.status || data.requestStatus || data.bookingStatus);

  return {
    bookingId: normalizeString(data.bookingId) || docId,
    userId: normalizeString(data.userId) || normalizeString(data.uid),
    phaseId: canonicalPhaseId,
    status,
    createdAtMs: toMillis(data.createdAt),
    expiresAtMs: toMillis(data.expiresAt)
  };
}

function isBookingExpired(booking, nowMs = Date.now()) {
  if (!booking) {
    return false;
  }
  if (!ACTIVE_REVIEWABLE_BOOKING_STATUSES.has(booking.status)) {
    return false;
  }
  if (!booking.expiresAtMs || !Number.isFinite(booking.expiresAtMs)) {
    return false;
  }
  return booking.expiresAtMs <= nowMs;
}

function assertAuthenticated(request) {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  return uid;
}

async function assertAdmin(request) {
  const uid = assertAuthenticated(request);
  if (request.auth?.token?.admin === true) {
    return { uid, email: normalizeEmail(request.auth?.token?.email || "") };
  }

  const record = await auth.getUser(uid);
  const email = normalizeEmail(record.email);
  if (!ADMIN_EMAILS.has(email)) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
  return { uid, email };
}

function getCanonicalPhaseSequence() {
  return CANONICAL_PHASES.slice().sort((a, b) => a.order - b.order);
}

function getPreviousPhaseId(phaseId) {
  const canonical = canonicalizePhaseId(phaseId);
  const phases = getCanonicalPhaseSequence();
  const index = phases.findIndex((phase) => phase.phaseId === canonical);
  if (index <= 0) {
    return null;
  }
  return phases[index - 1].phaseId;
}

function buildCanonicalPhasePayload(phaseId) {
  const canonicalPhaseId = canonicalizePhaseId(phaseId);
  const canonical = CANONICAL_PHASES.find((phase) => phase.phaseId === canonicalPhaseId);
  if (canonical) {
    return { ...canonical, phaseId: canonicalPhaseId };
  }
  return {
    phaseId: canonicalPhaseId,
    title: canonicalPhaseId,
    description: "",
    level: "Beginner",
    order: Number.MAX_SAFE_INTEGER,
    totalSeats: 100,
    bookedSeats: 0
  };
}

async function readPhaseDocumentInTransaction(transaction, phaseId) {
  const canonicalPhaseId = canonicalizePhaseId(phaseId);
  const canonicalRef = db.doc(`phases/${canonicalPhaseId}`);
  const canonicalSnap = await transaction.get(canonicalRef);
  if (canonicalSnap.exists) {
    return { ref: canonicalRef, data: canonicalSnap.data() || {}, phaseId: canonicalPhaseId };
  }

  const legacyPhaseId = getLegacyPhaseIdForCanonical(canonicalPhaseId);
  if (!legacyPhaseId) {
    return { ref: canonicalRef, data: {}, phaseId: canonicalPhaseId };
  }

  const legacyRef = db.doc(`phases/${legacyPhaseId}`);
  const legacySnap = await transaction.get(legacyRef);
  if (legacySnap.exists) {
    return { ref: legacyRef, data: legacySnap.data() || {}, phaseId: canonicalPhaseId };
  }

  return { ref: canonicalRef, data: {}, phaseId: canonicalPhaseId };
}

function buildBookingPayload({
  bookingId,
  userId,
  userEmail,
  userName,
  phaseId,
  phoneNumber,
  whatsappNumber
}) {
  const canonicalPhaseId = canonicalizePhaseId(phaseId);
  const legacyPhaseId = getLegacyPhaseIdForCanonical(canonicalPhaseId);
  const phaseAlias = legacyPhaseId || canonicalPhaseId;
  const createdAtMs = Date.now();
  const expiresAtMs = createdAtMs + BOOKING_EXPIRY_MS;

  return {
    bookingId,
    id: bookingId,
    userId,
    uid: userId,
    phaseId: canonicalPhaseId,
    phase: phaseAlias,
    phaseKey: phaseAlias,
    phaseCanonicalId: canonicalPhaseId,
    phaseLegacyId: legacyPhaseId || null,
    phaseIdAliases: Array.from(new Set([canonicalPhaseId, legacyPhaseId].filter(Boolean))),
    userName: userName || "",
    name: userName || "",
    userEmail: userEmail || "",
    email: userEmail || "",
    phone: phoneNumber,
    whatsapp: whatsappNumber,
    phoneNumber,
    whatsappNumber,
    status: BOOKING_STATUS_PENDING,
    requestStatus: BOOKING_STATUS_PENDING,
    bookingStatus: BOOKING_STATUS_PENDING,
    createdAtMs,
    createdAt: createdAtMs,
    updatedAtMs: createdAtMs,
    updatedAt: createdAtMs,
    source: "web",
    expiresAtMs,
    expiresAt: expiresAtMs
  };
}

async function markExpiredIfNeededInTransaction(transaction, bookingRef, bookingData, nowMs = Date.now()) {
  if (!isBookingExpired(bookingData, nowMs)) {
    return false;
  }
  transaction.update(bookingRef, {
    status: BOOKING_STATUS_EXPIRED,
    requestStatus: BOOKING_STATUS_EXPIRED,
    bookingStatus: BOOKING_STATUS_EXPIRED,
    expiredAtMs: nowMs,
    expiredAt: nowMs,
    updatedAtMs: nowMs,
    updatedAt: nowMs
  });
  return true;
}

export const createBooking = onCall(async (request) => {
  const uid = assertAuthenticated(request);
  const phaseId = canonicalizePhaseId(request.data?.phaseId);
  const phoneNumber = normalizePhone(request.data?.phoneNumber);
  const whatsappNumber = normalizePhone(request.data?.whatsappNumber);

  if (!phaseId) {
    throw new HttpsError("invalid-argument", "phaseId is required.");
  }

  const bookingId = `${uid}_${phaseId}`;
  const bookingRef = db.doc(`bookings/${bookingId}`);
  const userRef = db.doc(`users/${uid}`);

  const authUser = await auth.getUser(uid);
  const userEmail = normalizeEmail(authUser.email);
  const userName = normalizeString(authUser.displayName) || "Unknown User";

  await db.runTransaction(async (transaction) => {
    const [userSnap, bookingSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(bookingRef)
    ]);

    const userData = userSnap.data() || {};
    const completedPhases = new Set(
      normalizeStringArray(userData.completedPhases).map((item) => canonicalizePhaseId(item)).filter(Boolean)
    );

    const previousPhaseId = getPreviousPhaseId(phaseId);
    if (previousPhaseId && !completedPhases.has(previousPhaseId)) {
      throw new HttpsError(
        "failed-precondition",
        `Complete ${previousPhaseId} lessons before requesting ${phaseId}.`
      );
    }

    if (bookingSnap.exists) {
      const existingBooking = normalizeBookingDoc(bookingSnap.id, bookingSnap.data() || {});
      const didExpire = await markExpiredIfNeededInTransaction(transaction, bookingRef, existingBooking);
      if (!didExpire) {
        if (existingBooking.status === BOOKING_STATUS_APPROVED) {
          throw new HttpsError("failed-precondition", "Phase already approved for this user.");
        }
        if (ACTIVE_REVIEWABLE_BOOKING_STATUSES.has(existingBooking.status)) {
          throw new HttpsError("failed-precondition", "Active booking already exists.");
        }
      }
    }

    const phaseDocument = await readPhaseDocumentInTransaction(transaction, phaseId);
    const mergedPhase = {
      ...buildCanonicalPhasePayload(phaseDocument.phaseId),
      ...phaseDocument.data
    };

    const totalSeats = normalizeNumber(mergedPhase.totalSeats) ?? 100;
    const bookedSeats = normalizeNumber(mergedPhase.bookedSeats) ?? 0;
    if (totalSeats > 0 && bookedSeats >= totalSeats) {
      throw new HttpsError("resource-exhausted", "Phase has no available seats.");
    }

    transaction.set(bookingRef, buildBookingPayload({
      bookingId,
      userId: uid,
      userEmail,
      userName,
      phaseId,
      phoneNumber,
      whatsappNumber
    }));
  });

  return {
    ok: true,
    bookingId
  };
});

export const markBookingReviewing = onCall(async (request) => {
  const adminUser = await assertAdmin(request);
  const bookingId = normalizeString(request.data?.bookingId);
  if (!bookingId) {
    throw new HttpsError("invalid-argument", "bookingId is required.");
  }

  const nowMs = Date.now();
  await db.runTransaction(async (transaction) => {
    const bookingRef = db.doc(`bookings/${bookingId}`);
    const bookingSnap = await transaction.get(bookingRef);
    if (!bookingSnap.exists) {
      throw new HttpsError("not-found", "Booking not found.");
    }

    const booking = normalizeBookingDoc(bookingSnap.id, bookingSnap.data() || {});
    if (!ACTIVE_REVIEWABLE_BOOKING_STATUSES.has(booking.status)) {
      throw new HttpsError("failed-precondition", "Only pending/reviewing bookings can enter reviewing.");
    }
    if (isBookingExpired(booking, nowMs)) {
      await markExpiredIfNeededInTransaction(transaction, bookingRef, booking, nowMs);
      throw new HttpsError("failed-precondition", "Booking already expired.");
    }

    transaction.update(bookingRef, {
      status: BOOKING_STATUS_REVIEWING,
      requestStatus: BOOKING_STATUS_REVIEWING,
      bookingStatus: BOOKING_STATUS_REVIEWING,
      reviewingAtMs: nowMs,
      reviewingAt: nowMs,
      reviewedBy: adminUser.uid,
      reviewedByEmail: adminUser.email,
      updatedAtMs: nowMs,
      updatedAt: nowMs
    });
  });

  return { ok: true };
});

export const approveBooking = onCall(async (request) => {
  const adminUser = await assertAdmin(request);
  const bookingId = normalizeString(request.data?.bookingId);
  if (!bookingId) {
    throw new HttpsError("invalid-argument", "bookingId is required.");
  }

  const nowMs = Date.now();
  await db.runTransaction(async (transaction) => {
    const bookingRef = db.doc(`bookings/${bookingId}`);
    const bookingSnap = await transaction.get(bookingRef);
    if (!bookingSnap.exists) {
      throw new HttpsError("not-found", "Booking not found.");
    }

    const booking = normalizeBookingDoc(bookingSnap.id, bookingSnap.data() || {});
    if (!ACTIVE_REVIEWABLE_BOOKING_STATUSES.has(booking.status)) {
      throw new HttpsError("failed-precondition", "Only pending/reviewing bookings can be approved.");
    }
    if (!booking.phaseId || !booking.userId) {
      throw new HttpsError("failed-precondition", "Booking missing userId or phaseId.");
    }
    if (isBookingExpired(booking, nowMs)) {
      await markExpiredIfNeededInTransaction(transaction, bookingRef, booking, nowMs);
      throw new HttpsError("failed-precondition", "Booking already expired.");
    }

    const phaseDocument = await readPhaseDocumentInTransaction(transaction, booking.phaseId);
    const mergedPhase = {
      ...buildCanonicalPhasePayload(phaseDocument.phaseId),
      ...phaseDocument.data
    };
    const totalSeats = normalizeNumber(mergedPhase.totalSeats) ?? 100;
    const bookedSeats = normalizeNumber(mergedPhase.bookedSeats) ?? 0;
    if (totalSeats > 0 && bookedSeats >= totalSeats) {
      throw new HttpsError("resource-exhausted", "Phase has no available seats.");
    }

    const userRef = db.doc(`users/${booking.userId}`);
    transaction.update(bookingRef, {
      status: BOOKING_STATUS_APPROVED,
      requestStatus: BOOKING_STATUS_APPROVED,
      bookingStatus: BOOKING_STATUS_APPROVED,
      approvedAtMs: nowMs,
      approvedAt: nowMs,
      approvedBy: adminUser.uid,
      approvedByEmail: adminUser.email,
      updatedAtMs: nowMs,
      updatedAt: nowMs
    });
    transaction.set(phaseDocument.ref, {
      ...mergedPhase,
      phaseId: phaseDocument.phaseId,
      bookedSeats: Math.max(bookedSeats + 1, 0)
    }, { merge: true });
    transaction.set(userRef, {
      unlockedPhases: FieldValue.arrayUnion(booking.phaseId),
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true });
  });

  return { ok: true };
});

export const rejectBooking = onCall(async (request) => {
  const adminUser = await assertAdmin(request);
  const bookingId = normalizeString(request.data?.bookingId);
  if (!bookingId) {
    throw new HttpsError("invalid-argument", "bookingId is required.");
  }

  const nowMs = Date.now();
  await db.runTransaction(async (transaction) => {
    const bookingRef = db.doc(`bookings/${bookingId}`);
    const bookingSnap = await transaction.get(bookingRef);
    if (!bookingSnap.exists) {
      throw new HttpsError("not-found", "Booking not found.");
    }

    const booking = normalizeBookingDoc(bookingSnap.id, bookingSnap.data() || {});
    if (!ACTIVE_REVIEWABLE_BOOKING_STATUSES.has(booking.status)) {
      throw new HttpsError("failed-precondition", "Only pending/reviewing bookings can be rejected.");
    }
    if (isBookingExpired(booking, nowMs)) {
      await markExpiredIfNeededInTransaction(transaction, bookingRef, booking, nowMs);
      throw new HttpsError("failed-precondition", "Booking already expired.");
    }

    transaction.update(bookingRef, {
      status: BOOKING_STATUS_REJECTED,
      requestStatus: BOOKING_STATUS_REJECTED,
      bookingStatus: BOOKING_STATUS_REJECTED,
      rejectedAtMs: nowMs,
      rejectedAt: nowMs,
      rejectedBy: adminUser.uid,
      rejectedByEmail: adminUser.email,
      updatedAtMs: nowMs,
      updatedAt: nowMs
    });
  });

  return { ok: true };
});

export const cancelBooking = onCall(async (request) => {
  const adminUser = await assertAdmin(request);
  const bookingId = normalizeString(request.data?.bookingId);
  if (!bookingId) {
    throw new HttpsError("invalid-argument", "bookingId is required.");
  }

  const nowMs = Date.now();
  await db.runTransaction(async (transaction) => {
    const bookingRef = db.doc(`bookings/${bookingId}`);
    const bookingSnap = await transaction.get(bookingRef);
    if (!bookingSnap.exists) {
      throw new HttpsError("not-found", "Booking not found.");
    }

    const booking = normalizeBookingDoc(bookingSnap.id, bookingSnap.data() || {});
    if (booking.status !== BOOKING_STATUS_APPROVED) {
      throw new HttpsError("failed-precondition", "Only approved bookings can be cancelled.");
    }
    if (!booking.phaseId || !booking.userId) {
      throw new HttpsError("failed-precondition", "Booking missing userId or phaseId.");
    }

    const phaseDocument = await readPhaseDocumentInTransaction(transaction, booking.phaseId);
    const mergedPhase = {
      ...buildCanonicalPhasePayload(phaseDocument.phaseId),
      ...phaseDocument.data
    };
    const bookedSeats = normalizeNumber(mergedPhase.bookedSeats) ?? 0;

    const userRef = db.doc(`users/${booking.userId}`);
    transaction.update(bookingRef, {
      status: BOOKING_STATUS_CANCELLED,
      requestStatus: BOOKING_STATUS_CANCELLED,
      bookingStatus: BOOKING_STATUS_CANCELLED,
      cancelledAtMs: nowMs,
      cancelledAt: nowMs,
      cancelledBy: adminUser.uid,
      cancelledByEmail: adminUser.email,
      updatedAtMs: nowMs,
      updatedAt: nowMs
    });
    transaction.set(phaseDocument.ref, {
      ...mergedPhase,
      phaseId: phaseDocument.phaseId,
      bookedSeats: Math.max(bookedSeats - 1, 0)
    }, { merge: true });
    transaction.set(userRef, {
      unlockedPhases: FieldValue.arrayRemove(booking.phaseId),
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true });
  });

  return { ok: true };
});

async function runExpirySweep() {
  const nowMs = Date.now();
  const pendingSnapshot = await db.collection("bookings")
    .where("status", "==", BOOKING_STATUS_PENDING)
    .where("expiresAt", "<=", nowMs)
    .get();

  const reviewingSnapshot = await db.collection("bookings")
    .where("status", "==", BOOKING_STATUS_REVIEWING)
    .where("expiresAt", "<=", nowMs)
    .get();

  const writer = db.bulkWriter();
  let updatedCount = 0;

  const updateExpiredBooking = (docSnap) => {
    const data = docSnap.data() || {};
    const normalized = normalizeBookingDoc(docSnap.id, data);
    if (!isBookingExpired(normalized, nowMs)) {
      return;
    }
    updatedCount += 1;
    writer.update(docSnap.ref, {
      status: BOOKING_STATUS_EXPIRED,
      requestStatus: BOOKING_STATUS_EXPIRED,
      bookingStatus: BOOKING_STATUS_EXPIRED,
      expiredAtMs: nowMs,
      expiredAt: nowMs,
      updatedAtMs: nowMs,
      updatedAt: nowMs
    });
  };

  pendingSnapshot.forEach(updateExpiredBooking);
  reviewingSnapshot.forEach(updateExpiredBooking);
  await writer.close();

  return {
    scanned: pendingSnapshot.size + reviewingSnapshot.size,
    expired: updatedCount
  };
}

export const expireStaleBookingsScheduled = onSchedule("every 5 minutes", async () => {
  return runExpirySweep();
});

export const expireStaleBookingsNow = onCall(async (request) => {
  await assertAdmin(request);
  return runExpirySweep();
});

export const reconcileBookingConsistency = onCall(async (request) => {
  await assertAdmin(request);

  const canonicalPhases = getCanonicalPhaseSequence().map((phase) => phase.phaseId);
  const reconciliation = [];

  for (const phaseId of canonicalPhases) {
    const approvedSnapshot = await db.collection("bookings")
      .where("phaseId", "==", phaseId)
      .where("status", "==", BOOKING_STATUS_APPROVED)
      .get();

    const approvedCount = approvedSnapshot.size;
    const phaseRef = db.doc(`phases/${phaseId}`);
    const phaseSnap = await phaseRef.get();
    const phaseData = phaseSnap.data() || {};
    const existingBookedSeats = normalizeNumber(phaseData.bookedSeats) ?? 0;

    if (existingBookedSeats !== approvedCount) {
      await phaseRef.set({
        ...buildCanonicalPhasePayload(phaseId),
        ...phaseData,
        phaseId,
        bookedSeats: approvedCount,
        updatedAt: admin.firestore.Timestamp.now()
      }, { merge: true });
    }

    const userWriter = db.bulkWriter();
    approvedSnapshot.forEach((bookingDoc) => {
      const booking = normalizeBookingDoc(bookingDoc.id, bookingDoc.data() || {});
      if (booking.userId) {
        userWriter.set(db.doc(`users/${booking.userId}`), {
          unlockedPhases: FieldValue.arrayUnion(phaseId),
          updatedAt: admin.firestore.Timestamp.now()
        }, { merge: true });
      }
    });
    await userWriter.close();

    reconciliation.push({
      phaseId,
      approvedCount,
      bookedSeatsBefore: existingBookedSeats,
      bookedSeatsAfter: approvedCount
    });
  }

  return {
    ok: true,
    reconciliation
  };
});

async function collectDocsForUserIds(collectionName, fieldName, userId) {
  const querySnapshot = await db.collection(collectionName).where(fieldName, "==", userId).get();
  return querySnapshot.docs;
}

export const deleteAccountCascade = onCall(async (request) => {
  const uid = assertAuthenticated(request);
  const confirmation = normalizeString(request.data?.confirmation);
  if (confirmation !== "DELETE") {
    throw new HttpsError("invalid-argument", "Confirmation token must be DELETE.");
  }

  const userRef = db.doc(`users/${uid}`);
  const deletedPaths = [];
  const deletedDocKeys = new Set();
  const writer = db.bulkWriter();

  const queueDelete = (docRef) => {
    const key = docRef.path;
    if (deletedDocKeys.has(key)) {
      return;
    }
    deletedDocKeys.add(key);
    deletedPaths.push(key);
    writer.delete(docRef);
  };

  const [bookingDocs, referralByUserDocs, referralByReferrerDocs, affiliateByUserDocs] = await Promise.all([
    collectDocsForUserIds("bookings", "userId", uid),
    collectDocsForUserIds("referralEvents", "userId", uid),
    collectDocsForUserIds("referralEvents", "referrerId", uid),
    collectDocsForUserIds("affiliateStats", "userId", uid)
  ]);

  bookingDocs.forEach((docSnap) => queueDelete(docSnap.ref));
  referralByUserDocs.forEach((docSnap) => queueDelete(docSnap.ref));
  referralByReferrerDocs.forEach((docSnap) => queueDelete(docSnap.ref));
  affiliateByUserDocs.forEach((docSnap) => queueDelete(docSnap.ref));

  const affiliateDocById = db.doc(`affiliateStats/${uid}`);
  const affiliateByIdSnap = await affiliateDocById.get();
  if (affiliateByIdSnap.exists) {
    queueDelete(affiliateDocById);
  }

  // Removes users/{uid} and all nested subcollections such as users/{uid}/progress/*.
  await db.recursiveDelete(userRef);
  deletedPaths.push(userRef.path);

  await writer.close();

  await auth.deleteUser(uid);

  return {
    ok: true,
    deletedCount: deletedPaths.length,
    deletedPaths
  };
});
