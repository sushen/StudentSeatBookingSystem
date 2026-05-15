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

function normalizeReferralCode(value) {
  const normalized = normalizeString(value).replace(/[^a-z0-9]/gi, "").toUpperCase();
  return normalized.slice(0, 6);
}

function buildReferralCodeFromUid(uid) {
  const normalizedUid = normalizeString(uid).replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (!normalizedUid) {
    return "";
  }
  return normalizedUid.slice(-6).padStart(6, "X");
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
  const outcome = await db.runTransaction(async (transaction) => {
    const bookingRef = db.doc(`bookings/${bookingId}`);
    const bookingSnap = await transaction.get(bookingRef);
    if (!bookingSnap.exists) {
      return { ok: false, code: "not-found", message: "Booking not found." };
    }

    const booking = normalizeBookingDoc(bookingSnap.id, bookingSnap.data() || {});
    if (!ACTIVE_REVIEWABLE_BOOKING_STATUSES.has(booking.status)) {
      return {
        ok: false,
        code: "failed-precondition",
        message: "Only pending/reviewing bookings can be rejected."
      };
    }
    if (isBookingExpired(booking, nowMs)) {
      await markExpiredIfNeededInTransaction(transaction, bookingRef, booking, nowMs);
      return { ok: false, code: "failed-precondition", message: "Booking already expired." };
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

    return { ok: true };
  });

  if (!outcome?.ok) {
    throw new HttpsError(outcome.code || "internal", outcome.message || "Reject booking failed.");
  }

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

export const applyReferralCode = onCall(async (request) => {
  const uid = assertAuthenticated(request);
  const referralCode = normalizeReferralCode(request.data?.referralCode);
  if (!referralCode) {
    throw new HttpsError("invalid-argument", "Valid referralCode is required.");
  }

  const selfReferralCode = buildReferralCodeFromUid(uid);
  if (referralCode === selfReferralCode) {
    throw new HttpsError("invalid-argument", "You cannot use your own referral code.");
  }

  const referrerSnapshot = await db.collection("users")
    .where("referralCode", "==", referralCode)
    .limit(1)
    .get();

  if (referrerSnapshot.empty) {
    throw new HttpsError("not-found", "Referral code not found.");
  }

  const referrerDoc = referrerSnapshot.docs[0];
  const referrerId = referrerDoc.id;
  if (referrerId === uid) {
    throw new HttpsError("invalid-argument", "You cannot use your own referral code.");
  }

  const now = admin.firestore.Timestamp.now();
  const userRef = db.doc(`users/${uid}`);
  const referralEventRef = db.doc(`referralEvents/${referrerId}_${uid}`);
  const affiliateStatsRef = db.doc(`affiliateStats/${referrerId}`);

  await db.runTransaction(async (transaction) => {
    const [userSnap, referralEventSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(referralEventRef)
    ]);

    const userData = userSnap.data() || {};
    const existingReferredBy = normalizeString(userData.referredBy);
    if (existingReferredBy && existingReferredBy !== referrerId) {
      throw new HttpsError("failed-precondition", "Referral code is already assigned.");
    }

    const userPatch = {
      referralCode: normalizeReferralCode(userData.referralCode) || selfReferralCode,
      updatedAt: now
    };
    if (!existingReferredBy) {
      userPatch.referredBy = referrerId;
    }
    transaction.set(userRef, userPatch, { merge: true });

    if (!referralEventSnap.exists) {
      transaction.set(referralEventRef, {
        eventId: `${referrerId}_${uid}`,
        referrerId,
        userId: uid,
        referredUserName: normalizeString(request.auth?.token?.name),
        referredUserEmail: normalizeEmail(request.auth?.token?.email),
        status: "joined",
        isConverted: false,
        joinedAt: now,
        updatedAt: now,
        source: "web"
      }, { merge: true });

      transaction.set(affiliateStatsRef, {
        userId: referrerId,
        totalInvites: FieldValue.increment(1),
        updatedAt: now
      }, { merge: true });
    }
  });

  return {
    ok: true,
    referredBy: referrerId,
    referralCode: selfReferralCode
  };
});

export const markReferralConversion = onCall(async (request) => {
  const uid = assertAuthenticated(request);
  const phaseId = canonicalizePhaseId(request.data?.phaseId || "phase1");
  if (phaseId !== "phase1") {
    throw new HttpsError("invalid-argument", "Only phase1 conversion is supported.");
  }

  const now = admin.firestore.Timestamp.now();
  const userRef = db.doc(`users/${uid}`);
  const phaseProgressRef = db.doc(`users/${uid}/progress/phase1`);

  const result = await db.runTransaction(async (transaction) => {
    const [userSnap, phaseProgressSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(phaseProgressRef)
    ]);

    if (!userSnap.exists) {
      return { converted: false, reason: "user-not-found" };
    }

    const userData = userSnap.data() || {};
    const referredBy = normalizeString(userData.referredBy);
    if (!referredBy) {
      return { converted: false, reason: "not-referred" };
    }

    const completedPhases = new Set(
      normalizeStringArray(userData.completedPhases).map((item) => canonicalizePhaseId(item)).filter(Boolean)
    );
    const progressPercent = normalizeNumber(phaseProgressSnap.data()?.progressPercent) ?? 0;
    const isPhase1Completed = completedPhases.has("phase1") || progressPercent >= 100;
    if (!isPhase1Completed) {
      throw new HttpsError("failed-precondition", "Complete phase1 before conversion.");
    }

    const referralEventRef = db.doc(`referralEvents/${referredBy}_${uid}`);
    const affiliateStatsRef = db.doc(`affiliateStats/${referredBy}`);
    const referralEventSnap = await transaction.get(referralEventRef);
    const referralEventData = referralEventSnap.data() || {};
    const alreadyConverted = Boolean(referralEventData.convertedAt) || referralEventData.isConverted === true;
    if (alreadyConverted) {
      return { converted: false, reason: "already-converted" };
    }

    transaction.set(referralEventRef, {
      eventId: `${referredBy}_${uid}`,
      referrerId: referredBy,
      userId: uid,
      referredUserName: normalizeString(userData.name),
      referredUserEmail: normalizeEmail(userData.email),
      status: "converted",
      isConverted: true,
      joinedAt: referralEventData.joinedAt || now,
      convertedAt: now,
      updatedAt: now,
      source: referralEventData.source || "web"
    }, { merge: true });

    transaction.set(affiliateStatsRef, {
      userId: referredBy,
      conversions: FieldValue.increment(1),
      updatedAt: now
    }, { merge: true });

    return { converted: true, reason: "ok" };
  });

  return {
    ok: true,
    ...result
  };
});

async function collectDocsForUserIds(collectionName, fieldNames, userId) {
  const fields = Array.isArray(fieldNames) ? fieldNames : [fieldNames];
  const docsByPath = new Map();

  for (const fieldName of fields) {
    const normalizedField = normalizeString(fieldName);
    if (!normalizedField) {
      continue;
    }
    const querySnapshot = await db.collection(collectionName).where(normalizedField, "==", userId).get();
    querySnapshot.docs.forEach((docSnap) => {
      docsByPath.set(docSnap.ref.path, docSnap);
    });
  }

  return Array.from(docsByPath.values());
}

async function deleteCollectionTree(collectionRef, queueDelete) {
  const snapshot = await collectionRef.get();
  for (const docSnap of snapshot.docs) {
    await deleteDocumentTree(docSnap.ref, queueDelete);
  }
}

async function deleteDocumentTree(docRef, queueDelete) {
  const subcollections = await docRef.listCollections();
  for (const subcollection of subcollections) {
    await deleteCollectionTree(subcollection, queueDelete);
  }
  queueDelete(docRef);
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

  try {
    const [
      bookingDocs,
      referralByUserDocs,
      referralByReferredUserDocs,
      referralByReferrerDocs,
      affiliateByUserDocs
    ] = await Promise.all([
      collectDocsForUserIds("bookings", ["userId", "uid"], uid),
      collectDocsForUserIds("referralEvents", "userId", uid),
      collectDocsForUserIds("referralEvents", "referredUserId", uid),
      collectDocsForUserIds("referralEvents", "referrerId", uid),
      collectDocsForUserIds("affiliateStats", "userId", uid)
    ]);

    bookingDocs.forEach((docSnap) => queueDelete(docSnap.ref));
    referralByUserDocs.forEach((docSnap) => queueDelete(docSnap.ref));
    referralByReferredUserDocs.forEach((docSnap) => queueDelete(docSnap.ref));
    referralByReferrerDocs.forEach((docSnap) => queueDelete(docSnap.ref));
    affiliateByUserDocs.forEach((docSnap) => queueDelete(docSnap.ref));

    const affiliateDocById = db.doc(`affiliateStats/${uid}`);
    const [affiliateByIdSnap, userSnap] = await Promise.all([
      affiliateDocById.get(),
      userRef.get()
    ]);

    if (affiliateByIdSnap.exists) {
      queueDelete(affiliateDocById);
    }

    if (userSnap.exists) {
      await deleteDocumentTree(userRef, queueDelete);
    } else {
      const userSubcollections = await userRef.listCollections();
      for (const subcollection of userSubcollections) {
        await deleteCollectionTree(subcollection, queueDelete);
      }
      queueDelete(userRef);
    }

    await writer.close();

    try {
      await auth.deleteUser(uid);
    } catch (error) {
      if (error?.code !== "auth/user-not-found") {
        throw error;
      }
    }

    return {
      ok: true,
      deletedCount: deletedPaths.length,
      deletedPaths
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Account deletion failed.";
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", message);
  }
});
