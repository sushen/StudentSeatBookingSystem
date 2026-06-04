import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import admin from "firebase-admin";
import { createHash, randomUUID } from "node:crypto";

admin.initializeApp();

setGlobalOptions({
  region: "asia-south1",
  maxInstances: 20
});

const db = admin.firestore();
const auth = admin.auth();
const { FieldValue } = admin.firestore;

const FALLBACK_SUPER_ADMIN_EMAILS = new Set([
  "sushen.biswas.aga@gmail.com",
  "sushen.biswas.aga@googlemail.com"
]);
const SUPER_ADMIN_CONFIG_PATH = "appConfig/system";
const ADMIN_REFERRAL_ALIAS = "ADMIN";
const SUPER_ADMIN_DEFAULT_REFERRAL_CODE = "JXC6G2";

const BOOKING_EXPIRY_MS = 15 * 60 * 1000;
const AFFILIATE_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COMMISSION_DEFAULT_AMOUNT_MICROS = 1000000;
const COMMISSION_DEFAULT_CURRENCY = "USD";
const COMMISSION_DEFAULT_RATE_BPS = 1000;
const COMMISSION_STATUS_PENDING = "pending";
const REFERRAL_EVENT_STATUS_JOINED = "joined";
const REFERRAL_EVENT_STATUS_CONVERTED = "converted";
const REFERRAL_APPROVAL_STATUS_PENDING = "pending";
const REFERRAL_APPROVAL_STATUS_APPROVED = "approved";
const REFERRAL_APPROVAL_STATUS_REJECTED = "rejected";
const REFERRAL_APPROVAL_COLLECTION = "referralApprovals";

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

function normalizeEmailList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueEmails = new Set(
    value
      .map((entry) => normalizeEmail(entry))
      .filter(Boolean)
  );
  return Array.from(uniqueEmails);
}

function normalizeReferralCode(value) {
  const normalized = normalizeString(value).replace(/[^a-z0-9]/gi, "").toUpperCase();
  return normalized.slice(0, 6);
}

function normalizeSessionId(value) {
  const normalized = normalizeString(value).replace(/[^a-z0-9_-]/gi, "");
  if (normalized.length < 8 || normalized.length > 128) {
    return "";
  }
  return normalized;
}

function normalizeCampaignId(value) {
  const normalized = normalizeString(value).replace(/[^a-z0-9_-]/gi, "").toLowerCase();
  return normalized.slice(0, 64);
}

function buildReferralCodeFromUid(uid) {
  const normalizedUid = normalizeString(uid).replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (!normalizedUid) {
    return "";
  }
  return normalizedUid.slice(-6).padStart(6, "X");
}

function isAdminReferralAlias(referralCode) {
  return normalizeReferralCode(referralCode) === normalizeReferralCode(ADMIN_REFERRAL_ALIAS);
}

function getFallbackSuperAdminEmails() {
  return Array.from(FALLBACK_SUPER_ADMIN_EMAILS)
    .map((email) => normalizeEmail(email))
    .filter(Boolean);
}

async function loadConfiguredSuperAdminEmails() {
  try {
    const configSnapshot = await db.doc(SUPER_ADMIN_CONFIG_PATH).get();
    if (!configSnapshot.exists) {
      return [];
    }

    const configData = configSnapshot.data() || {};
    const configuredEmails = new Set(normalizeEmailList(configData.superAdminEmails));
    const primaryEmail = normalizeEmail(configData.superAdminEmail);
    if (primaryEmail) {
      configuredEmails.add(primaryEmail);
    }
    return Array.from(configuredEmails);
  } catch (error) {
    void error;
    return [];
  }
}

async function getActiveSuperAdminEmails() {
  const configuredEmails = await loadConfiguredSuperAdminEmails();
  if (configuredEmails.length) {
    return configuredEmails;
  }
  return getFallbackSuperAdminEmails();
}

async function findSuperAdminReferrerDoc(superAdminEmails = null) {
  const emails = Array.isArray(superAdminEmails) && superAdminEmails.length
    ? normalizeEmailList(superAdminEmails)
    : await getActiveSuperAdminEmails();

  for (const adminEmail of emails) {
    const normalizedAdminEmail = normalizeEmail(adminEmail);
    if (!normalizedAdminEmail) {
      continue;
    }
    const adminSnapshot = await db.collection("users")
      .where("email", "==", normalizedAdminEmail)
      .limit(1)
      .get();
    if (!adminSnapshot.empty) {
      return adminSnapshot.docs[0];
    }

    try {
      const adminAuthUser = await auth.getUserByEmail(normalizedAdminEmail);
      const userDocSnapshot = await db.doc(`users/${adminAuthUser.uid}`).get();
      if (userDocSnapshot.exists) {
        return userDocSnapshot;
      }
    } catch (error) {
      const code = normalizeString(error?.code);
      if (code === "auth/user-not-found") {
        continue;
      }
      throw error;
    }
  }
  return null;
}

async function resolveAdminReferralCode() {
  const activeSuperAdminEmails = await getActiveSuperAdminEmails();
  const adminReferrerDoc = await findSuperAdminReferrerDoc(activeSuperAdminEmails);
  const defaultReferralCode = normalizeReferralCode(SUPER_ADMIN_DEFAULT_REFERRAL_CODE);
  if (adminReferrerDoc) {
    const adminData = adminReferrerDoc.data() || {};
    const referralCode =
      normalizeReferralCode(adminData.referralCode) ||
      defaultReferralCode ||
      buildReferralCodeFromUid(adminReferrerDoc.id);
    if (referralCode) {
      return {
        referralCode,
        adminEmail: normalizeEmail(adminData.email)
      };
    }
  }

  for (const adminEmail of activeSuperAdminEmails) {
    const normalizedAdminEmail = normalizeEmail(adminEmail);
    if (!normalizedAdminEmail) {
      continue;
    }
    try {
      const adminAuthUser = await auth.getUserByEmail(normalizedAdminEmail);
      const fallbackCode = defaultReferralCode || buildReferralCodeFromUid(adminAuthUser.uid);
      if (fallbackCode) {
        return {
          referralCode: fallbackCode,
          adminEmail: normalizedAdminEmail
        };
      }
    } catch (error) {
      const code = normalizeString(error?.code);
      if (code === "auth/user-not-found") {
        continue;
      }
      throw error;
    }
  }

  return null;
}

async function buildSuperAdminProfileResponse() {
  const superAdminEmails = await getActiveSuperAdminEmails();
  const resolvedReferral = await resolveAdminReferralCode();
  const superAdminEmail = normalizeEmail(
    resolvedReferral?.adminEmail ||
    superAdminEmails[0] ||
    ""
  );

  return {
    superAdminEmail,
    superAdminEmails,
    referralCode: normalizeReferralCode(resolvedReferral?.referralCode),
    adminEmail: superAdminEmail
  };
}

async function resolveReferrerByReferralCode(referralCodeInput) {
  const requestedReferralCode = normalizeReferralCode(referralCodeInput);
  if (!requestedReferralCode) {
    return null;
  }

  const defaultSuperAdminReferralCode = normalizeReferralCode(SUPER_ADMIN_DEFAULT_REFERRAL_CODE);
  if (
    isAdminReferralAlias(requestedReferralCode) ||
    (defaultSuperAdminReferralCode && requestedReferralCode === defaultSuperAdminReferralCode)
  ) {
    const adminReferrerDoc = await findSuperAdminReferrerDoc();
    if (!adminReferrerDoc && isAdminReferralAlias(requestedReferralCode)) {
      return null;
    }
    if (adminReferrerDoc) {
      const adminData = adminReferrerDoc.data() || {};
      const resolvedReferralCode =
        defaultSuperAdminReferralCode ||
        normalizeReferralCode(adminData.referralCode) ||
        buildReferralCodeFromUid(adminReferrerDoc.id);

      return {
        referrerDoc: adminReferrerDoc,
        requestedReferralCode,
        resolvedReferralCode
      };
    }
  }

  const referrerSnapshot = await db.collection("users")
    .where("referralCode", "==", requestedReferralCode)
    .limit(1)
    .get();

  if (referrerSnapshot.empty) {
    return null;
  }

  return {
    referrerDoc: referrerSnapshot.docs[0],
    requestedReferralCode,
    resolvedReferralCode: requestedReferralCode
  };
}

function normalizeReferralApprovalStatus(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (
    normalized === REFERRAL_APPROVAL_STATUS_PENDING ||
    normalized === REFERRAL_APPROVAL_STATUS_APPROVED ||
    normalized === REFERRAL_APPROVAL_STATUS_REJECTED
  ) {
    return normalized;
  }
  return REFERRAL_APPROVAL_STATUS_PENDING;
}

function getReferralAssignmentFlagsForReferrer(referredUserData = {}, {
  referrerId = "",
  referralCode = ""
} = {}) {
  const normalizedReferrerId = normalizeString(referrerId);
  const normalizedReferralCode = normalizeReferralCode(referralCode);
  const referredByValue = normalizeString(referredUserData.referredBy);
  const referredByCode = normalizeReferralCode(referredUserData.referredByCode);
  const pendingReferralCode = normalizeReferralCode(
    referredUserData.pendingReferralCode || referredUserData.pendingReferralLastCode
  );
  const pendingReferrerId = normalizeString(
    referredUserData.pendingReferralReferrerId || referredUserData.pendingReferralLastReferrerId
  );

  const assignedById = Boolean(normalizedReferrerId) && referredByValue === normalizedReferrerId;
  const assignedByCode = Boolean(normalizedReferralCode) && referredByCode === normalizedReferralCode;
  const assignedByLegacyReferredByCode = (
    Boolean(normalizedReferralCode) &&
    normalizeReferralCode(referredByValue) === normalizedReferralCode
  );
  const pendingById = Boolean(normalizedReferrerId) && pendingReferrerId === normalizedReferrerId;
  const pendingByCode = Boolean(normalizedReferralCode) && pendingReferralCode === normalizedReferralCode;

  return {
    assignedById,
    assignedByCode,
    assignedByLegacyReferredByCode,
    pendingById,
    pendingByCode
  };
}

function isReferralAssignmentMatch(assignmentFlags = {}) {
  return Boolean(
    assignmentFlags.assignedById ||
    assignmentFlags.assignedByCode ||
    assignmentFlags.assignedByLegacyReferredByCode ||
    assignmentFlags.pendingById ||
    assignmentFlags.pendingByCode
  );
}

function isReferralConvertedForSync(referredUserData = {}, assignmentFlags = {}) {
  const referralStatus = normalizeReferralApprovalStatus(referredUserData.pendingReferralStatus);
  if (
    referralStatus === REFERRAL_APPROVAL_STATUS_APPROVED ||
    referralStatus === REFERRAL_APPROVAL_STATUS_REJECTED
  ) {
    return true;
  }
  return Boolean(
    assignmentFlags.assignedById ||
    assignmentFlags.assignedByCode ||
    assignmentFlags.assignedByLegacyReferredByCode
  );
}

function normalizeReferralApprovalRequestDoc(docId, data = {}) {
  const status = normalizeReferralApprovalStatus(data.status);
  return {
    requestId: normalizeString(data.requestId) || docId,
    requesterId: normalizeString(data.requesterId),
    requesterName: normalizeString(data.requesterName),
    requesterEmail: normalizeEmail(data.requesterEmail),
    requesterPhone: normalizeString(data.requesterPhone || data.phone || data.phoneNumber),
    requesterWhatsApp: normalizeString(data.requesterWhatsApp || data.whatsapp || data.whatsappNumber),
    referralCode: normalizeReferralCode(data.referralCode),
    resolvedReferralCode: normalizeReferralCode(data.resolvedReferralCode),
    referrerId: normalizeString(data.referrerId),
    referrerName: normalizeString(data.referrerName),
    referrerEmail: normalizeEmail(data.referrerEmail),
    status,
    source: normalizeString(data.source) || "web",
    sessionId: normalizeSessionId(data.sessionId),
    reviewedBy: normalizeString(data.reviewedBy),
    reviewedByEmail: normalizeEmail(data.reviewedByEmail),
    reviewReason: normalizeString(data.reviewReason),
    createdAtMs: toMillis(data.createdAt) ?? normalizeNumber(data.createdAtMs) ?? null,
    updatedAtMs: toMillis(data.updatedAt) ?? normalizeNumber(data.updatedAtMs) ?? null,
    reviewedAtMs: toMillis(data.reviewedAt) ?? normalizeNumber(data.reviewedAtMs) ?? null
  };
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

function hashValue(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  return createHash("sha256").update(normalized).digest("hex");
}

function normalizeIpFromRequest(request) {
  const rawForwarded = normalizeString(request?.rawRequest?.headers?.["x-forwarded-for"]);
  if (rawForwarded) {
    return normalizeString(rawForwarded.split(",")[0]);
  }
  return normalizeString(request?.rawRequest?.ip);
}

function getActorFromRequest(request, fallbackActorType = "system") {
  const uid = normalizeString(request?.auth?.uid);
  const email = normalizeEmail(request?.auth?.token?.email || "");
  if (uid) {
    const actorType = request?.auth?.token?.admin === true ? "admin" : fallbackActorType;
    return { actorType, actorId: uid, actorEmail: email };
  }
  return { actorType: "anonymous", actorId: "anonymous", actorEmail: "" };
}

async function writeAuditLog({
  action,
  actorType = "system",
  actorId = "system",
  actorEmail = "",
  targetPath = "",
  payload = {},
  result = {}
}) {
  const now = admin.firestore.Timestamp.now();
  const normalizedAction = normalizeString(action) || "unknown.action";
  const sanitizedPayload = (payload && typeof payload === "object") ? payload : {};
  const sanitizedResult = (result && typeof result === "object") ? result : {};

  await db.collection("auditLogs").add({
    action: normalizedAction,
    actorType: normalizeString(actorType) || "system",
    actorId: normalizeString(actorId) || "system",
    actorEmail: normalizeEmail(actorEmail),
    targetPath: normalizeString(targetPath),
    payload: sanitizedPayload,
    payloadHash: createHash("sha256").update(JSON.stringify(sanitizedPayload)).digest("hex"),
    result: sanitizedResult,
    resultHash: createHash("sha256").update(JSON.stringify(sanitizedResult)).digest("hex"),
    createdAt: now,
    createdAtMs: now.toMillis()
  });
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
  const activeSuperAdminEmails = await getActiveSuperAdminEmails();
  if (!activeSuperAdminEmails.includes(email)) {
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

function areStringSetsEqual(left, right) {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

async function emitFraudSignal({
  entityType,
  entityId,
  signalType,
  severity = "medium",
  score = 50,
  evidence = {}
}) {
  const now = admin.firestore.Timestamp.now();
  await db.collection("fraudSignals").add({
    entityType: normalizeString(entityType),
    entityId: normalizeString(entityId),
    signalType: normalizeString(signalType),
    severity: normalizeString(severity) || "medium",
    score: Math.max(0, Number(score) || 0),
    evidence: (evidence && typeof evidence === "object") ? evidence : {},
    status: "open",
    createdAt: now,
    createdAtMs: now.toMillis()
  });
}

async function runBookingConsistencyAndUnlockSync() {
  const canonicalPhases = getCanonicalPhaseSequence().map((phase) => phase.phaseId);
  const approvedPhasesByUserId = new Map();
  const phaseReconciliation = [];
  const now = admin.firestore.Timestamp.now();

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
        updatedAt: now
      }, { merge: true });
    }

    approvedSnapshot.forEach((bookingDoc) => {
      const booking = normalizeBookingDoc(bookingDoc.id, bookingDoc.data() || {});
      if (!booking.userId) {
        return;
      }
      if (!approvedPhasesByUserId.has(booking.userId)) {
        approvedPhasesByUserId.set(booking.userId, new Set());
      }
      approvedPhasesByUserId.get(booking.userId).add(phaseId);
    });

    phaseReconciliation.push({
      phaseId,
      approvedCount,
      bookedSeatsBefore: existingBookedSeats,
      bookedSeatsAfter: approvedCount
    });
  }

  const canonicalPhaseSet = new Set(canonicalPhases);
  const phaseOrderById = new Map(canonicalPhases.map((phaseId, index) => [phaseId, index]));
  const usersSnapshot = await db.collection("users").get();
  const writer = db.bulkWriter();
  let unlockedUsersUpdated = 0;

  usersSnapshot.forEach((userDoc) => {
    const userData = userDoc.data() || {};
    const existingUnlocked = new Set(
      normalizeStringArray(userData.unlockedPhases)
        .map((phaseId) => canonicalizePhaseId(phaseId))
        .filter((phaseId) => canonicalPhaseSet.has(phaseId))
    );
    const authoritativeUnlocked = new Set(approvedPhasesByUserId.get(userDoc.id) || []);

    if (areStringSetsEqual(existingUnlocked, authoritativeUnlocked)) {
      return;
    }

    const orderedUnlocked = Array.from(authoritativeUnlocked)
      .sort((left, right) => (phaseOrderById.get(left) ?? Number.MAX_SAFE_INTEGER) - (phaseOrderById.get(right) ?? Number.MAX_SAFE_INTEGER));

    writer.set(userDoc.ref, {
      unlockedPhases: orderedUnlocked,
      updatedAt: now
    }, { merge: true });
    unlockedUsersUpdated += 1;
  });
  await writer.close();

  return {
    phaseReconciliation,
    usersScanned: usersSnapshot.size,
    unlockedUsersUpdated
  };
}

async function backfillMissingUserReferralsToSuperAdminDefault() {
  const defaultSuperAdminReferralCode = normalizeReferralCode(SUPER_ADMIN_DEFAULT_REFERRAL_CODE);
  if (!defaultSuperAdminReferralCode) {
    return {
      reason: "default-referral-code-unavailable",
      usersScanned: 0,
      usersUpdated: 0,
      referralEventsCreated: 0,
      skippedSelf: 0,
      skippedHasReferral: 0,
      skippedPendingApproval: 0
    };
  }

  const superAdminReferrerDoc = await findSuperAdminReferrerDoc();
  if (!superAdminReferrerDoc) {
    return {
      reason: "super-admin-not-found",
      usersScanned: 0,
      usersUpdated: 0,
      referralEventsCreated: 0,
      skippedSelf: 0,
      skippedHasReferral: 0,
      skippedPendingApproval: 0
    };
  }

  const superAdminData = superAdminReferrerDoc.data() || {};
  const superAdminReferrerId = normalizeString(superAdminReferrerDoc.id);
  if (!superAdminReferrerId) {
    return {
      reason: "super-admin-id-unavailable",
      usersScanned: 0,
      usersUpdated: 0,
      referralEventsCreated: 0,
      skippedSelf: 0,
      skippedHasReferral: 0,
      skippedPendingApproval: 0
    };
  }

  const now = admin.firestore.Timestamp.now();
  const nowMs = now.toMillis();
  const superAdminName = normalizeString(superAdminData.name) || "Super Admin";
  const superAdminEmail = normalizeEmail(superAdminData.email);

  const [usersSnapshot, existingSuperAdminEventsSnapshot] = await Promise.all([
    db.collection("users").get(),
    db.collection("referralEvents")
      .where("referrerId", "==", superAdminReferrerId)
      .get()
  ]);

  const existingSuperAdminEventUserIds = new Set();
  existingSuperAdminEventsSnapshot.forEach((eventDoc) => {
    const eventData = eventDoc.data() || {};
    const userIdFromData = normalizeString(eventData.userId || eventData.referredUserId);
    if (userIdFromData) {
      existingSuperAdminEventUserIds.add(userIdFromData);
      return;
    }
    const eventId = normalizeString(eventDoc.id);
    const expectedPrefix = `${superAdminReferrerId}_`;
    if (!eventId.startsWith(expectedPrefix)) {
      return;
    }
    const userIdFromEventId = normalizeString(eventId.slice(expectedPrefix.length));
    if (userIdFromEventId) {
      existingSuperAdminEventUserIds.add(userIdFromEventId);
    }
  });

  const writer = db.bulkWriter();
  let usersUpdated = 0;
  let referralEventsCreated = 0;
  let skippedSelf = 0;
  let skippedHasReferral = 0;
  let skippedPendingApproval = 0;
  let normalizedSuperAdminReferralCode = false;

  if (normalizeReferralCode(superAdminData.referralCode) !== defaultSuperAdminReferralCode) {
    writer.set(superAdminReferrerDoc.ref, {
      referralCode: defaultSuperAdminReferralCode,
      updatedAt: now,
      updatedAtMs: nowMs
    }, { merge: true });
    normalizedSuperAdminReferralCode = true;
  }

  usersSnapshot.forEach((userDoc) => {
    const userId = normalizeString(userDoc.id);
    if (!userId) {
      return;
    }
    if (userId === superAdminReferrerId) {
      skippedSelf += 1;
      return;
    }

    const userData = userDoc.data() || {};
    const existingReferredBy = normalizeString(userData.referredBy);
    const existingReferredByCode = normalizeReferralCode(userData.referredByCode);
    if (existingReferredBy || existingReferredByCode) {
      skippedHasReferral += 1;
      return;
    }

    const pendingStatus = normalizeReferralApprovalStatus(userData.pendingReferralStatus);
    const pendingReferralCode = normalizeReferralCode(
      userData.pendingReferralCode || userData.pendingReferralLastCode
    );
    const hasConflictingPendingReferral = (
      pendingStatus === REFERRAL_APPROVAL_STATUS_PENDING &&
      pendingReferralCode &&
      pendingReferralCode !== defaultSuperAdminReferralCode
    );
    if (hasConflictingPendingReferral) {
      skippedPendingApproval += 1;
      return;
    }

    const selfReferralCode = normalizeReferralCode(userData.referralCode) || buildReferralCodeFromUid(userId);
    writer.set(userDoc.ref, {
      referralCode: selfReferralCode,
      referredBy: superAdminReferrerId,
      referredByName: superAdminName,
      referredByEmail: superAdminEmail,
      referredByCode: defaultSuperAdminReferralCode,
      pendingReferralStatus: REFERRAL_APPROVAL_STATUS_APPROVED,
      pendingReferralLastCode: defaultSuperAdminReferralCode,
      pendingReferralLastReferrerId: superAdminReferrerId,
      pendingReferralLastReferrerName: superAdminName,
      pendingReferralLastReferrerEmail: superAdminEmail,
      pendingReferralCode: FieldValue.delete(),
      pendingReferralReferrerId: FieldValue.delete(),
      pendingReferralReferrerName: FieldValue.delete(),
      pendingReferralReferrerEmail: FieldValue.delete(),
      pendingReferralRequestId: FieldValue.delete(),
      pendingReferralRequestedAt: FieldValue.delete(),
      pendingReferralRequestedAtMs: FieldValue.delete(),
      updatedAt: now,
      updatedAtMs: nowMs
    }, { merge: true });
    usersUpdated += 1;

    if (!existingSuperAdminEventUserIds.has(userId)) {
      writer.set(db.doc(`referralEvents/${superAdminReferrerId}_${userId}`), {
        eventId: `${superAdminReferrerId}_${userId}`,
        referrerId: superAdminReferrerId,
        userId,
        referredUserName: normalizeString(userData.name),
        referredUserEmail: normalizeEmail(userData.email),
        status: REFERRAL_EVENT_STATUS_JOINED,
        isConverted: false,
        joinedAt: now,
        updatedAt: now,
        source: "default-super-admin-backfill"
      }, { merge: true });
      existingSuperAdminEventUserIds.add(userId);
      referralEventsCreated += 1;
    }
  });

  await writer.close();

  return {
    reason: "ok",
    superAdminReferrerId,
    superAdminReferralCode: defaultSuperAdminReferralCode,
    normalizedSuperAdminReferralCode,
    usersScanned: usersSnapshot.size,
    usersUpdated,
    referralEventsCreated,
    skippedSelf,
    skippedHasReferral,
    skippedPendingApproval
  };
}

async function runReferralStatsReconciliation() {
  const defaultReferralBackfill = await backfillMissingUserReferralsToSuperAdminDefault();
  const now = admin.firestore.Timestamp.now();
  const referralSnapshot = await db.collection("referralEvents").get();
  const aggregateByReferrer = new Map();

  referralSnapshot.forEach((eventDoc) => {
    const eventData = eventDoc.data() || {};
    const referrerId = normalizeString(eventData.referrerId);
    if (!referrerId) {
      return;
    }
    const status = normalizeString(eventData.status).toLowerCase();
    const isConverted = eventData.isConverted === true || status === REFERRAL_EVENT_STATUS_CONVERTED || Boolean(eventData.convertedAt);
    const current = aggregateByReferrer.get(referrerId) || { totalInvites: 0, conversions: 0 };
    current.totalInvites += 1;
    if (isConverted) {
      current.conversions += 1;
    }
    aggregateByReferrer.set(referrerId, current);
  });

  const existingStatsSnapshot = await db.collection("affiliateStats").get();
  const allReferrerIds = new Set(aggregateByReferrer.keys());
  existingStatsSnapshot.forEach((statsDoc) => {
    const statsData = statsDoc.data() || {};
    allReferrerIds.add(normalizeString(statsData.userId) || statsDoc.id);
  });

  const writer = db.bulkWriter();
  let updatedStatsDocs = 0;
  allReferrerIds.forEach((referrerId) => {
    if (!referrerId) {
      return;
    }
    const aggregate = aggregateByReferrer.get(referrerId) || { totalInvites: 0, conversions: 0 };
    writer.set(db.doc(`affiliateStats/${referrerId}`), {
      userId: referrerId,
      totalInvites: Math.max(0, Number(aggregate.totalInvites) || 0),
      conversions: Math.max(0, Number(aggregate.conversions) || 0),
      updatedAt: now,
      updatedAtMs: now.toMillis()
    }, { merge: true });
    updatedStatsDocs += 1;
  });
  await writer.close();

  return {
    defaultReferralBackfill,
    referralEventsScanned: referralSnapshot.size,
    updatedStatsDocs
  };
}

async function bindAffiliateSessionToUser({ sessionId, userId, referrerId }) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const normalizedUserId = normalizeString(userId);
  const normalizedReferrerId = normalizeString(referrerId);
  if (!normalizedSessionId || !normalizedUserId) {
    return { bound: false, reason: "missing-session-or-user" };
  }

  const sessionRef = db.doc(`affiliateSessions/${normalizedSessionId}`);
  const nowMs = Date.now();
  const now = admin.firestore.Timestamp.fromMillis(nowMs);
  let result = { bound: false, reason: "session-not-found" };

  await db.runTransaction(async (transaction) => {
    const sessionSnap = await transaction.get(sessionRef);
    if (!sessionSnap.exists) {
      result = { bound: false, reason: "session-not-found" };
      return;
    }

    const sessionData = sessionSnap.data() || {};
    const existingUserId = normalizeString(sessionData.userId);
    if (existingUserId && existingUserId !== normalizedUserId) {
      result = { bound: false, reason: "session-user-mismatch" };
      return;
    }

    transaction.set(sessionRef, {
      userId: normalizedUserId,
      attributedReferrerId: normalizedReferrerId || normalizeString(sessionData.attributedReferrerId) || normalizeString(sessionData.referrerId),
      state: "bound",
      boundAt: now,
      boundAtMs: nowMs,
      updatedAt: now,
      updatedAtMs: nowMs
    }, { merge: true });
    result = { bound: true, reason: "ok" };
  });

  if (result.reason === "session-user-mismatch") {
    await emitFraudSignal({
      entityType: "affiliateSession",
      entityId: normalizedSessionId,
      signalType: "session_user_mismatch",
      severity: "high",
      score: 90,
      evidence: {
        userId: normalizedUserId,
        referrerId: normalizedReferrerId
      }
    });
  }

  return result;
}

async function validateAndRecordReferralConversion({
  userId,
  phaseId,
  source = "web"
}) {
  const normalizedUserId = normalizeString(userId);
  const normalizedPhaseId = canonicalizePhaseId(phaseId || "phase1");
  if (!normalizedUserId) {
    throw new HttpsError("invalid-argument", "userId is required.");
  }
  if (normalizedPhaseId !== "phase1") {
    throw new HttpsError("invalid-argument", "Only phase1 conversion is supported.");
  }

  const now = admin.firestore.Timestamp.now();
  const nowMs = now.toMillis();
  const userRef = db.doc(`users/${normalizedUserId}`);
  const phaseProgressRef = db.doc(`users/${normalizedUserId}/progress/phase1`);

  return db.runTransaction(async (transaction) => {
    const [userSnap, phaseProgressSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(phaseProgressRef)
    ]);

    if (!userSnap.exists) {
      return { converted: false, reason: "user-not-found", commissionCreated: false };
    }

    const userData = userSnap.data() || {};
    const referredBy = normalizeString(userData.referredBy);
    if (!referredBy) {
      return { converted: false, reason: "not-referred", commissionCreated: false };
    }

    const completedPhases = new Set(
      normalizeStringArray(userData.completedPhases).map((item) => canonicalizePhaseId(item)).filter(Boolean)
    );
    const progressPercent = normalizeNumber(phaseProgressSnap.data()?.progressPercent) ?? 0;
    const isPhase1Completed = completedPhases.has("phase1") || progressPercent >= 100;
    if (!isPhase1Completed) {
      throw new HttpsError("failed-precondition", "Complete phase1 before conversion.");
    }

    const referralEventRef = db.doc(`referralEvents/${referredBy}_${normalizedUserId}`);
    const affiliateStatsRef = db.doc(`affiliateStats/${referredBy}`);
    const referralEventSnap = await transaction.get(referralEventRef);
    const referralEventData = referralEventSnap.data() || {};
    const alreadyConverted = Boolean(referralEventData.convertedAt) || referralEventData.isConverted === true;
    if (alreadyConverted) {
      return { converted: false, reason: "already-converted", commissionCreated: false, referrerId: referredBy };
    }

    transaction.set(referralEventRef, {
      eventId: `${referredBy}_${normalizedUserId}`,
      referrerId: referredBy,
      userId: normalizedUserId,
      referredUserName: normalizeString(userData.name),
      referredUserEmail: normalizeEmail(userData.email),
      status: REFERRAL_EVENT_STATUS_CONVERTED,
      isConverted: true,
      joinedAt: referralEventData.joinedAt || now,
      convertedAt: now,
      updatedAt: now,
      source: normalizeString(referralEventData.source) || normalizeString(source) || "web"
    }, { merge: true });

    transaction.set(affiliateStatsRef, {
      userId: referredBy,
      conversions: FieldValue.increment(1),
      updatedAt: now,
      updatedAtMs: nowMs
    }, { merge: true });

    const commissionId = `${referredBy}_${normalizedUserId}_${normalizedPhaseId}`;
    const commissionRef = db.doc(`affiliateCommissions/${commissionId}`);
    const commissionSnap = await transaction.get(commissionRef);
    let commissionCreated = false;
    if (!commissionSnap.exists) {
      commissionCreated = true;
      transaction.create(commissionRef, {
        commissionId,
        referrerId: referredBy,
        referredUserId: normalizedUserId,
        attributionEventId: `${referredBy}_${normalizedUserId}`,
        qualifiedEventId: `phase_completed:${normalizedUserId}:${normalizedPhaseId}`,
        phaseId: normalizedPhaseId,
        status: COMMISSION_STATUS_PENDING,
        amountMicros: COMMISSION_DEFAULT_AMOUNT_MICROS,
        currency: COMMISSION_DEFAULT_CURRENCY,
        rateBps: COMMISSION_DEFAULT_RATE_BPS,
        lockVersion: 1,
        idempotencyKey: `conversion:${referredBy}:${normalizedUserId}:${normalizedPhaseId}`,
        source: normalizeString(source) || "web",
        createdAt: now,
        createdAtMs: nowMs,
        updatedAt: now,
        updatedAtMs: nowMs
      });
    }

    return {
      converted: true,
      reason: "ok",
      referrerId: referredBy,
      commissionCreated,
      commissionId
    };
  });
}

export const createBooking = onCall(async (request) => {
  const uid = assertAuthenticated(request);
  const actor = getActorFromRequest(request, "user");
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

  await writeAuditLog({
    action: "booking.created",
    actorType: actor.actorType,
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    targetPath: `bookings/${bookingId}`,
    payload: {
      phaseId,
      source: normalizeString(request.data?.source) || "web"
    },
    result: {
      ok: true,
      bookingId
    }
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

  await writeAuditLog({
    action: "booking.mark_reviewing",
    actorType: "admin",
    actorId: adminUser.uid,
    actorEmail: adminUser.email,
    targetPath: `bookings/${bookingId}`,
    payload: { bookingId },
    result: { ok: true }
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

  await writeAuditLog({
    action: "booking.approved",
    actorType: "admin",
    actorId: adminUser.uid,
    actorEmail: adminUser.email,
    targetPath: `bookings/${bookingId}`,
    payload: { bookingId },
    result: { ok: true }
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

  await writeAuditLog({
    action: "booking.rejected",
    actorType: "admin",
    actorId: adminUser.uid,
    actorEmail: adminUser.email,
    targetPath: `bookings/${bookingId}`,
    payload: { bookingId },
    result: { ok: true }
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

  await writeAuditLog({
    action: "booking.cancelled",
    actorType: "admin",
    actorId: adminUser.uid,
    actorEmail: adminUser.email,
    targetPath: `bookings/${bookingId}`,
    payload: { bookingId },
    result: { ok: true }
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
  const adminUser = await assertAdmin(request);
  const result = await runExpirySweep();
  await writeAuditLog({
    action: "booking.expiry_sweep.manual",
    actorType: "admin",
    actorId: adminUser.uid,
    actorEmail: adminUser.email,
    targetPath: "bookings",
    payload: {},
    result
  });
  return result;
});

export const reconcileBookingConsistency = onCall(async (request) => {
  const adminUser = await assertAdmin(request);
  const result = await runBookingConsistencyAndUnlockSync();
  await writeAuditLog({
    action: "booking.reconcile.manual",
    actorType: "admin",
    actorId: adminUser.uid,
    actorEmail: adminUser.email,
    targetPath: "bookings,users,phases",
    payload: {},
    result
  });
  return { ok: true, ...result };
});

export const reconcileSeatsAndUnlocksScheduled = onSchedule("every 30 minutes", async () => {
  return runBookingConsistencyAndUnlockSync();
});

export const reconcileReferralStatsNow = onCall(async (request) => {
  const adminUser = await assertAdmin(request);
  const result = await runReferralStatsReconciliation();
  await writeAuditLog({
    action: "referral_stats.reconcile.manual",
    actorType: "admin",
    actorId: adminUser.uid,
    actorEmail: adminUser.email,
    targetPath: "referralEvents,affiliateStats",
    payload: {},
    result
  });
  return { ok: true, ...result };
});

export const reconcileReferralStatsScheduled = onSchedule("every 30 minutes", async () => {
  return runReferralStatsReconciliation();
});

export const syncMyAffiliateStats = onCall(async (request) => {
  const uid = assertAuthenticated(request);
  const actor = getActorFromRequest(request, "user");
  const userRef = db.doc(`users/${uid}`);
  const now = admin.firestore.Timestamp.now();
  const nowMs = now.toMillis();

  const [userSnap, usersByReferrerSnap, existingEventsSnap] = await Promise.all([
    userRef.get(),
    db.collection("users").where("referredBy", "==", uid).get(),
    db.collection("referralEvents").where("referrerId", "==", uid).get()
  ]);

  const userData = userSnap.data() || {};
  const ownReferralCode = (
    normalizeReferralCode(userData.referralCode) ||
    normalizeReferralCode(request.data?.referralCode) ||
    buildReferralCodeFromUid(uid)
  );
  if (!ownReferralCode) {
    throw new HttpsError("failed-precondition", "Referral code is unavailable for this account.");
  }

  const [usersByCodeSnap, usersByLegacyReferredByCodeSnap] = await Promise.all([
    db.collection("users")
      .where("referredByCode", "==", ownReferralCode)
      .get(),
    db.collection("users")
      .where("referredBy", "==", ownReferralCode)
      .get()
  ]);

  const referredUsersById = new Map();
  const collectReferredUser = (docSnap) => {
    if (!docSnap?.exists || docSnap.id === uid) {
      return;
    }
    const data = docSnap.data() || {};
    const assignmentFlags = getReferralAssignmentFlagsForReferrer(data, {
      referrerId: uid,
      referralCode: ownReferralCode
    });
    if (!isReferralAssignmentMatch(assignmentFlags)) {
      return;
    }
    referredUsersById.set(docSnap.id, {
      data,
      assignmentFlags
    });
  };

  usersByReferrerSnap.forEach(collectReferredUser);
  usersByCodeSnap.forEach(collectReferredUser);
  usersByLegacyReferredByCodeSnap.forEach(collectReferredUser);

  const existingEventsByUserId = new Map();
  let existingInvites = 0;
  let existingConversions = 0;
  existingEventsSnap.forEach((eventDoc) => {
    const eventData = eventDoc.data() || {};
    const referredUserId =
      normalizeString(eventData.userId) ||
      normalizeString(eventData.referredUserId);
    if (referredUserId) {
      existingEventsByUserId.set(referredUserId, {
        eventId: eventDoc.id,
        data: eventData
      });
    }
    existingInvites += 1;
    const eventStatus = normalizeString(eventData.status).toLowerCase();
    const eventIsConverted = (
      eventData.isConverted === true ||
      eventStatus === REFERRAL_EVENT_STATUS_CONVERTED ||
      Boolean(eventData.convertedAt)
    );
    if (eventIsConverted) {
      existingConversions += 1;
    }
  });

  const writer = db.bulkWriter();
  let derivedInvites = 0;
  let derivedConversions = 0;
  let repairedEventWrites = 0;
  let normalizedLegacyWrites = 0;
  let legacyAssignmentsFound = 0;

  referredUsersById.forEach((entry, referredUserId) => {
    const referredData = entry?.data || {};
    const assignmentFlags = entry?.assignmentFlags || {};
    const normalizedUserId = normalizeString(referredUserId);
    if (!normalizedUserId || normalizedUserId === uid) {
      return;
    }

    const existingEvent = existingEventsByUserId.get(normalizedUserId) || null;
    const existingEventData = existingEvent?.data || {};
    const existingEventStatus = normalizeString(existingEventData.status).toLowerCase();
    const existingConvertedAtMs = toMillis(existingEventData.convertedAt);
    const existingJoinedAtMs = toMillis(existingEventData.joinedAt);
    const existingIsConverted = (
      existingEventData.isConverted === true ||
      existingEventStatus === REFERRAL_EVENT_STATUS_CONVERTED ||
      Boolean(existingConvertedAtMs)
    );

    if (assignmentFlags.assignedByLegacyReferredByCode && !assignmentFlags.assignedById) {
      legacyAssignmentsFound += 1;
      writer.set(db.doc(`users/${normalizedUserId}`), {
        referredBy: uid,
        referredByCode: ownReferralCode,
        updatedAt: now,
        updatedAtMs: nowMs
      }, { merge: true });
      normalizedLegacyWrites += 1;
    }

    const impliedConverted = isReferralConvertedForSync(referredData, assignmentFlags);
    const isConverted = existingIsConverted || impliedConverted;

    const joinedAtMs = (
      existingJoinedAtMs ??
      toMillis(referredData.pendingReferralReviewedAt) ??
      toMillis(referredData.createdAt) ??
      toMillis(referredData.updatedAt) ??
      nowMs
    );
    const joinedAt = admin.firestore.Timestamp.fromMillis(Math.max(0, Number(joinedAtMs) || nowMs));
    const convertedAt = existingConvertedAtMs
      ? admin.firestore.Timestamp.fromMillis(Math.max(0, Number(existingConvertedAtMs)))
      : now;

    derivedInvites += 1;
    if (isConverted) {
      derivedConversions += 1;
    }

    writer.set(db.doc(`referralEvents/${uid}_${normalizedUserId}`), {
      eventId: `${uid}_${normalizedUserId}`,
      referrerId: uid,
      userId: normalizedUserId,
      referredUserName: normalizeString(referredData.name) || normalizeString(existingEventData.referredUserName),
      referredUserEmail: normalizeEmail(referredData.email) || normalizeEmail(existingEventData.referredUserEmail),
      status: isConverted ? REFERRAL_EVENT_STATUS_CONVERTED : REFERRAL_EVENT_STATUS_JOINED,
      isConverted,
      joinedAt,
      convertedAt: isConverted ? convertedAt : FieldValue.delete(),
      source: normalizeString(existingEventData.source) || "sync",
      updatedAt: now
    }, { merge: true });
    repairedEventWrites += 1;
  });

  const totalInvites = Math.max(derivedInvites, existingInvites);
  const conversions = Math.max(derivedConversions, existingConversions);

  writer.set(db.doc(`affiliateStats/${uid}`), {
    userId: uid,
    totalInvites,
    invites: totalInvites,
    conversions,
    updatedAt: now,
    updatedAtMs: nowMs,
    lastSyncedAt: now,
    lastSyncedAtMs: nowMs
  }, { merge: true });

  writer.set(userRef, {
    referralCode: normalizeReferralCode(userData.referralCode) || ownReferralCode,
    totalInvites,
    invites: totalInvites,
    conversions,
    updatedAt: now,
    updatedAtMs: nowMs
  }, { merge: true });

  await writer.close();

  await writeAuditLog({
    action: "referral.stats_synced_by_user",
    actorType: actor.actorType,
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    targetPath: `affiliateStats/${uid}`,
    payload: {
      referralCode: ownReferralCode,
      referredUsersScanned: referredUsersById.size,
      existingInvites,
      existingConversions
    },
    result: {
      ok: true,
      totalInvites,
      conversions,
      repairedEventWrites,
      normalizedLegacyWrites
    }
  });

  return {
    ok: true,
    referralCode: ownReferralCode,
    totalInvites,
    conversions,
    repairedEventWrites,
    normalizedLegacyWrites,
    legacyAssignmentsFound,
    referredUsersScanned: referredUsersById.size
  };
});

export const getSuperAdminProfile = onCall(async () => {
  const profile = await buildSuperAdminProfileResponse();
  if (!profile.superAdminEmail && !profile.referralCode) {
    throw new HttpsError("not-found", "Super admin profile not found.");
  }

  return {
    ok: true,
    superAdminEmail: profile.superAdminEmail || null,
    superAdminEmails: profile.superAdminEmails,
    referralCode: profile.referralCode || null
  };
});

export const getAdminReferralCode = onCall(async () => {
  const profile = await buildSuperAdminProfileResponse();
  if (!profile.referralCode) {
    throw new HttpsError("not-found", "Admin referral code not found.");
  }

  return {
    ok: true,
    referralCode: profile.referralCode,
    adminEmail: profile.superAdminEmail || null,
    superAdminEmail: profile.superAdminEmail || null,
    superAdminEmails: profile.superAdminEmails
  };
});

export const trackAffiliateClick = onCall(async (request) => {
  const requestedReferralCode = normalizeReferralCode(request.data?.referralCode);
  if (!requestedReferralCode) {
    throw new HttpsError("invalid-argument", "Valid referralCode is required.");
  }

  const resolvedReferrer = await resolveReferrerByReferralCode(requestedReferralCode);
  if (!resolvedReferrer) {
    throw new HttpsError("not-found", "Referral code not found.");
  }

  const referrerId = resolvedReferrer.referrerDoc.id;
  const referralCode = resolvedReferrer.resolvedReferralCode;
  const sessionId = normalizeSessionId(request.data?.sessionId) || randomUUID().replace(/-/g, "");
  const campaignId = normalizeCampaignId(request.data?.campaignId);
  const landingPath = normalizeString(request.data?.landingPath) || "/";
  const source = normalizeString(request.data?.source) || "web";
  const rawUserAgent = normalizeString(request?.rawRequest?.headers?.["user-agent"]);
  const userAgentHash = hashValue(rawUserAgent);
  const ipHash = hashValue(normalizeIpFromRequest(request));
  const nowMs = Date.now();
  const now = admin.firestore.Timestamp.fromMillis(nowMs);
  const expiresAtMs = nowMs + AFFILIATE_SESSION_TTL_MS;

  const clickRef = db.collection("affiliateClicks").doc();
  const sessionRef = db.doc(`affiliateSessions/${sessionId}`);
  await db.runTransaction(async (transaction) => {
    const sessionSnap = await transaction.get(sessionRef);
    const sessionData = sessionSnap.data() || {};
    const existingClickCount = normalizeNumber(sessionData.clickCount) ?? 0;
    const firstSeenAtMs = toMillis(sessionData.firstSeenAt) ?? nowMs;
    const firstClickId = normalizeString(sessionData.firstClickId) || clickRef.id;

    transaction.set(clickRef, {
      clickId: clickRef.id,
      sessionId,
      referralCode,
      referrerId,
      campaignId: campaignId || null,
      source,
      landingPath,
      userAgentHash,
      ipHash,
      createdAt: now,
      createdAtMs: nowMs
    });

    transaction.set(sessionRef, {
      sessionId,
      referralCode,
      referrerId,
      campaignId: campaignId || null,
      source,
      state: normalizeString(sessionData.state) || "open",
      firstClickId,
      lastClickId: clickRef.id,
      clickCount: existingClickCount + 1,
      firstSeenAt: admin.firestore.Timestamp.fromMillis(firstSeenAtMs),
      firstSeenAtMs,
      lastSeenAt: now,
      lastSeenAtMs: nowMs,
      expiresAt: admin.firestore.Timestamp.fromMillis(expiresAtMs),
      expiresAtMs,
      userId: normalizeString(sessionData.userId) || null,
      attributedReferrerId: normalizeString(sessionData.attributedReferrerId) || referrerId,
      updatedAt: now,
      updatedAtMs: nowMs
    }, { merge: true });
  });

  await writeAuditLog({
    action: "affiliate.click_tracked",
    actorType: "anonymous",
    actorId: "anonymous",
    actorEmail: "",
    targetPath: `affiliateClicks/${clickRef.id}`,
    payload: {
      referralCode,
      requestedReferralCode,
      referrerId,
      sessionId,
      campaignId: campaignId || null,
      source
    },
    result: {
      ok: true,
      clickId: clickRef.id
    }
  });

  return {
    ok: true,
    clickId: clickRef.id,
    sessionId,
    referrerId
  };
});

export const applyReferralCode = onCall(async (request) => {
  const uid = assertAuthenticated(request);
  const actor = getActorFromRequest(request, "user");
  const requestedReferralCode = normalizeReferralCode(request.data?.referralCode);
  const sessionId = normalizeSessionId(request.data?.sessionId);
  if (!requestedReferralCode) {
    throw new HttpsError("invalid-argument", "Valid referralCode is required.");
  }

  const selfReferralCode = buildReferralCodeFromUid(uid);
  if (requestedReferralCode === selfReferralCode) {
    throw new HttpsError("invalid-argument", "You cannot use your own referral code.");
  }

  const resolvedReferrer = await resolveReferrerByReferralCode(requestedReferralCode);
  if (!resolvedReferrer) {
    throw new HttpsError("not-found", "Referral code not found.");
  }

  const referrerDoc = resolvedReferrer.referrerDoc;
  const referrerId = referrerDoc.id;
  const referrerData = referrerDoc.data() || {};
  const referrerName = normalizeString(referrerData.name) || "Unknown Referrer";
  const referrerEmail = normalizeEmail(referrerData.email);
  const referrerCode = resolvedReferrer.resolvedReferralCode;
  if (referrerId === uid) {
    throw new HttpsError("invalid-argument", "You cannot use your own referral code.");
  }

  const now = admin.firestore.Timestamp.now();
  const userRef = db.doc(`users/${uid}`);
  const referralEventRef = db.doc(`referralEvents/${referrerId}_${uid}`);
  const affiliateStatsRef = db.doc(`affiliateStats/${referrerId}`);
  const nowMs = now.toMillis();

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
      referredByName: referrerName,
      referredByEmail: referrerEmail,
      referredByCode: referrerCode,
      pendingReferralStatus: REFERRAL_APPROVAL_STATUS_APPROVED,
      pendingReferralLastCode: referrerCode,
      pendingReferralLastReferrerId: referrerId,
      pendingReferralLastReferrerName: referrerName,
      pendingReferralLastReferrerEmail: referrerEmail,
      pendingReferralCode: FieldValue.delete(),
      pendingReferralReferrerId: FieldValue.delete(),
      pendingReferralReferrerName: FieldValue.delete(),
      pendingReferralReferrerEmail: FieldValue.delete(),
      pendingReferralRequestId: FieldValue.delete(),
      pendingReferralRequestedAt: FieldValue.delete(),
      pendingReferralRequestedAtMs: FieldValue.delete(),
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
        status: REFERRAL_EVENT_STATUS_JOINED,
        isConverted: false,
        joinedAt: now,
        updatedAt: now,
        source: "web"
      }, { merge: true });

      transaction.set(affiliateStatsRef, {
        userId: referrerId,
        totalInvites: FieldValue.increment(1),
        updatedAt: now,
        updatedAtMs: nowMs
      }, { merge: true });
    }
  });

  let sessionBinding = { bound: false, reason: "not-requested" };
  if (sessionId) {
    sessionBinding = await bindAffiliateSessionToUser({
      sessionId,
      userId: uid,
      referrerId
    });
  }

  await writeAuditLog({
    action: "referral.code_applied",
    actorType: actor.actorType,
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    targetPath: `referralEvents/${referrerId}_${uid}`,
    payload: {
      referralCode: requestedReferralCode,
      resolvedReferralCode: referrerCode,
      referrerId,
      referrerCode,
      sessionId: sessionId || null,
      sessionBound: sessionBinding.bound,
      sessionBindingReason: sessionBinding.reason
    },
    result: {
      ok: true,
      referredBy: referrerId,
      referredByCode: referrerCode,
      sessionBound: sessionBinding.bound
    }
  });

  return {
    ok: true,
    referredBy: referrerId,
    referredByName: referrerName,
    referredByEmail: referrerEmail,
    referredByCode: referrerCode,
    referralCode: selfReferralCode,
    sessionId: sessionId || null,
    sessionBound: sessionBinding.bound,
    sessionBindingReason: sessionBinding.reason
  };
});

export const requestReferralApproval = onCall(async (request) => {
  const uid = assertAuthenticated(request);
  const actor = getActorFromRequest(request, "user");
  const requestedReferralCode = normalizeReferralCode(request.data?.referralCode);
  const sessionId = normalizeSessionId(request.data?.sessionId);
  const source = normalizeString(request.data?.source) || "web";
  if (!requestedReferralCode) {
    throw new HttpsError("invalid-argument", "Valid referralCode is required.");
  }

  const selfReferralCode = buildReferralCodeFromUid(uid);
  if (requestedReferralCode === selfReferralCode) {
    throw new HttpsError("invalid-argument", "You cannot use your own referral code.");
  }

  const resolvedReferrer = await resolveReferrerByReferralCode(requestedReferralCode);
  if (!resolvedReferrer) {
    throw new HttpsError("not-found", "Referral code not found.");
  }

  const referrerDoc = resolvedReferrer.referrerDoc;
  const referrerId = referrerDoc.id;
  const referrerData = referrerDoc.data() || {};
  const referrerName = normalizeString(referrerData.name) || "Unknown Referrer";
  const referrerEmail = normalizeEmail(referrerData.email);
  const referrerCode = resolvedReferrer.resolvedReferralCode;

  if (referrerId === uid) {
    throw new HttpsError("invalid-argument", "You cannot use your own referral code.");
  }

  const now = admin.firestore.Timestamp.now();
  const nowMs = now.toMillis();
  const userRef = db.doc(`users/${uid}`);
  const referralApprovalRef = db.doc(`${REFERRAL_APPROVAL_COLLECTION}/${uid}`);

  await db.runTransaction(async (transaction) => {
    const [userSnap, approvalSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(referralApprovalRef)
    ]);

    const userData = userSnap.data() || {};
    const existingReferredBy = normalizeString(userData.referredBy);
    if (existingReferredBy) {
      throw new HttpsError("failed-precondition", "Referral code is already assigned.");
    }

    const existingApproval = normalizeReferralApprovalRequestDoc(
      approvalSnap.id,
      approvalSnap.data() || {}
    );
    const createdAt = existingApproval.createdAtMs
      ? admin.firestore.Timestamp.fromMillis(existingApproval.createdAtMs)
      : now;
    const createdAtMs = existingApproval.createdAtMs ?? nowMs;

    transaction.set(userRef, {
      referralCode: normalizeReferralCode(userData.referralCode) || selfReferralCode,
      pendingReferralCode: referrerCode,
      pendingReferralStatus: REFERRAL_APPROVAL_STATUS_PENDING,
      pendingReferralReferrerId: referrerId,
      pendingReferralReferrerName: referrerName,
      pendingReferralReferrerEmail: referrerEmail,
      pendingReferralLastCode: referrerCode,
      pendingReferralLastReferrerId: referrerId,
      pendingReferralLastReferrerName: referrerName,
      pendingReferralLastReferrerEmail: referrerEmail,
      pendingReferralRequestId: uid,
      pendingReferralRequestedAt: now,
      pendingReferralRequestedAtMs: nowMs,
      updatedAt: now
    }, { merge: true });

    transaction.set(referralApprovalRef, {
      requestId: uid,
      requesterId: uid,
      requesterName: normalizeString(request.auth?.token?.name) || normalizeString(userData.name),
      requesterEmail: normalizeEmail(request.auth?.token?.email) || normalizeEmail(userData.email),
      requesterPhone: normalizeString(userData.phoneNumber || userData.phone),
      requesterWhatsApp: normalizeString(userData.whatsappNumber || userData.whatsapp),
      referralCode: requestedReferralCode,
      resolvedReferralCode: referrerCode,
      referrerId,
      referrerName,
      referrerEmail,
      status: REFERRAL_APPROVAL_STATUS_PENDING,
      source,
      sessionId: sessionId || null,
      createdAt,
      createdAtMs,
      reviewedAt: FieldValue.delete(),
      reviewedAtMs: FieldValue.delete(),
      reviewedBy: FieldValue.delete(),
      reviewedByEmail: FieldValue.delete(),
      reviewReason: FieldValue.delete(),
      updatedAt: now,
      updatedAtMs: nowMs
    }, { merge: true });
  });

  await writeAuditLog({
    action: "referral.approval_requested",
    actorType: actor.actorType,
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    targetPath: `${REFERRAL_APPROVAL_COLLECTION}/${uid}`,
    payload: {
      referralCode: requestedReferralCode,
      resolvedReferralCode: referrerCode,
      referrerId,
      sessionId: sessionId || null,
      source
    },
    result: {
      ok: true,
      status: REFERRAL_APPROVAL_STATUS_PENDING,
      requestId: uid
    }
  });

  return {
    ok: true,
    status: REFERRAL_APPROVAL_STATUS_PENDING,
    requestId: uid,
    referralCode: selfReferralCode,
    pendingReferralCode: referrerCode,
    referrerId,
    referrerName,
    referrerEmail
  };
});

export const listReferralApprovalRequests = onCall(async (request) => {
  await assertAdmin(request);

  const statusFilter = normalizeReferralApprovalStatus(request.data?.status || REFERRAL_APPROVAL_STATUS_PENDING);
  const snapshot = await db.collection(REFERRAL_APPROVAL_COLLECTION)
    .where("status", "==", statusFilter)
    .limit(250)
    .get();

  const requests = snapshot.docs
    .map((docSnap) => normalizeReferralApprovalRequestDoc(docSnap.id, docSnap.data() || {}))
    .sort((left, right) => {
      const leftTime = left.updatedAtMs ?? left.createdAtMs ?? 0;
      const rightTime = right.updatedAtMs ?? right.createdAtMs ?? 0;
      return rightTime - leftTime;
    });

  return {
    ok: true,
    status: statusFilter,
    requests
  };
});

export const reviewReferralApprovalRequest = onCall(async (request) => {
  const adminUser = await assertAdmin(request);
  const actor = getActorFromRequest(request, "admin");
  const requestId = normalizeString(request.data?.requestId || request.data?.userId);
  const decision = normalizeString(request.data?.decision).toLowerCase();
  const reviewReason = normalizeString(request.data?.reason || request.data?.reviewReason).slice(0, 300);

  if (!requestId) {
    throw new HttpsError("invalid-argument", "requestId is required.");
  }
  if (decision !== REFERRAL_APPROVAL_STATUS_APPROVED && decision !== REFERRAL_APPROVAL_STATUS_REJECTED) {
    throw new HttpsError("invalid-argument", "decision must be either 'approved' or 'rejected'.");
  }

  const referralApprovalRef = db.doc(`${REFERRAL_APPROVAL_COLLECTION}/${requestId}`);
  const now = admin.firestore.Timestamp.now();
  const nowMs = now.toMillis();

  let reviewResult = null;
  let sessionIdForBinding = "";
  let requesterIdForBinding = "";
  let referrerIdForBinding = "";

  await db.runTransaction(async (transaction) => {
    const approvalSnap = await transaction.get(referralApprovalRef);
    if (!approvalSnap.exists) {
      throw new HttpsError("not-found", "Referral approval request not found.");
    }

    const approval = normalizeReferralApprovalRequestDoc(approvalSnap.id, approvalSnap.data() || {});
    if (approval.status !== REFERRAL_APPROVAL_STATUS_PENDING) {
      throw new HttpsError("failed-precondition", "Referral approval request is already reviewed.");
    }

    const requesterId = normalizeString(approval.requesterId || approval.requestId);
    if (!requesterId) {
      throw new HttpsError("failed-precondition", "Requester account is missing.");
    }

    const requesterRef = db.doc(`users/${requesterId}`);
    const requesterSnap = await transaction.get(requesterRef);
    const requesterData = requesterSnap.data() || {};

    if (decision === REFERRAL_APPROVAL_STATUS_APPROVED) {
      const referrerId = normalizeString(approval.referrerId);
      const referrerCode = normalizeReferralCode(approval.resolvedReferralCode || approval.referralCode);
      if (!referrerId || !referrerCode) {
        throw new HttpsError("failed-precondition", "Referral request data is incomplete.");
      }
      if (requesterId === referrerId) {
        throw new HttpsError("failed-precondition", "User cannot refer themselves.");
      }

      const existingReferredBy = normalizeString(requesterData.referredBy);
      if (existingReferredBy && existingReferredBy !== referrerId) {
        throw new HttpsError("failed-precondition", "Referral code is already assigned.");
      }

      const referralEventRef = db.doc(`referralEvents/${referrerId}_${requesterId}`);
      const affiliateStatsRef = db.doc(`affiliateStats/${referrerId}`);
      const referralEventSnap = await transaction.get(referralEventRef);

      transaction.set(requesterRef, {
        referralCode: normalizeReferralCode(requesterData.referralCode) || buildReferralCodeFromUid(requesterId),
        referredBy: existingReferredBy || referrerId,
        referredByName: normalizeString(approval.referrerName),
        referredByEmail: normalizeEmail(approval.referrerEmail),
        referredByCode: referrerCode,
        pendingReferralStatus: REFERRAL_APPROVAL_STATUS_APPROVED,
        pendingReferralLastCode: referrerCode,
        pendingReferralLastReferrerId: referrerId,
        pendingReferralLastReferrerName: normalizeString(approval.referrerName),
        pendingReferralLastReferrerEmail: normalizeEmail(approval.referrerEmail),
        pendingReferralCode: FieldValue.delete(),
        pendingReferralReferrerId: FieldValue.delete(),
        pendingReferralReferrerName: FieldValue.delete(),
        pendingReferralReferrerEmail: FieldValue.delete(),
        pendingReferralRequestId: FieldValue.delete(),
        pendingReferralRequestedAt: FieldValue.delete(),
        pendingReferralRequestedAtMs: FieldValue.delete(),
        updatedAt: now
      }, { merge: true });

      if (!referralEventSnap.exists) {
        transaction.set(referralEventRef, {
          eventId: `${referrerId}_${requesterId}`,
          referrerId,
          userId: requesterId,
          referredUserName: normalizeString(requesterData.name) || normalizeString(approval.requesterName),
          referredUserEmail: normalizeEmail(requesterData.email) || normalizeEmail(approval.requesterEmail),
          status: REFERRAL_EVENT_STATUS_JOINED,
          isConverted: false,
          joinedAt: now,
          updatedAt: now,
          source: normalizeString(approval.source) || "web"
        }, { merge: true });

        transaction.set(affiliateStatsRef, {
          userId: referrerId,
          totalInvites: FieldValue.increment(1),
          updatedAt: now,
          updatedAtMs: nowMs
        }, { merge: true });
      }

      transaction.set(referralApprovalRef, {
        status: REFERRAL_APPROVAL_STATUS_APPROVED,
        reviewedAt: now,
        reviewedAtMs: nowMs,
        reviewedBy: adminUser.uid,
        reviewedByEmail: adminUser.email,
        reviewReason: reviewReason || null,
        updatedAt: now,
        updatedAtMs: nowMs
      }, { merge: true });

      sessionIdForBinding = approval.sessionId;
      requesterIdForBinding = requesterId;
      referrerIdForBinding = referrerId;

      reviewResult = {
        ok: true,
        status: REFERRAL_APPROVAL_STATUS_APPROVED,
        requestId: approval.requestId,
        requesterId,
        referredBy: referrerId,
        referredByCode: referrerCode
      };
      return;
    }

    transaction.set(requesterRef, {
      referralCode: normalizeReferralCode(requesterData.referralCode) || buildReferralCodeFromUid(requesterId),
      pendingReferralStatus: REFERRAL_APPROVAL_STATUS_REJECTED,
      pendingReferralLastCode: normalizeReferralCode(approval.resolvedReferralCode || approval.referralCode),
      pendingReferralLastReferrerId: normalizeString(approval.referrerId),
      pendingReferralLastReferrerName: normalizeString(approval.referrerName),
      pendingReferralLastReferrerEmail: normalizeEmail(approval.referrerEmail),
      pendingReferralCode: FieldValue.delete(),
      pendingReferralReferrerId: FieldValue.delete(),
      pendingReferralReferrerName: FieldValue.delete(),
      pendingReferralReferrerEmail: FieldValue.delete(),
      pendingReferralRequestId: FieldValue.delete(),
      pendingReferralRequestedAt: FieldValue.delete(),
      pendingReferralRequestedAtMs: FieldValue.delete(),
      updatedAt: now
    }, { merge: true });

    transaction.set(referralApprovalRef, {
      status: REFERRAL_APPROVAL_STATUS_REJECTED,
      reviewedAt: now,
      reviewedAtMs: nowMs,
      reviewedBy: adminUser.uid,
      reviewedByEmail: adminUser.email,
      reviewReason: reviewReason || null,
      updatedAt: now,
      updatedAtMs: nowMs
    }, { merge: true });

    reviewResult = {
      ok: true,
      status: REFERRAL_APPROVAL_STATUS_REJECTED,
      requestId: approval.requestId,
      requesterId
    };
  });

  let sessionBinding = { bound: false, reason: "not-requested" };
  if (
    decision === REFERRAL_APPROVAL_STATUS_APPROVED &&
    sessionIdForBinding &&
    requesterIdForBinding &&
    referrerIdForBinding
  ) {
    sessionBinding = await bindAffiliateSessionToUser({
      sessionId: sessionIdForBinding,
      userId: requesterIdForBinding,
      referrerId: referrerIdForBinding
    });
  }

  await writeAuditLog({
    action: "referral.approval_reviewed",
    actorType: actor.actorType,
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    targetPath: `${REFERRAL_APPROVAL_COLLECTION}/${requestId}`,
    payload: {
      requestId,
      decision,
      reviewReason: reviewReason || null,
      sessionId: sessionIdForBinding || null
    },
    result: {
      ...(reviewResult || { ok: false }),
      sessionBound: sessionBinding.bound,
      sessionBindingReason: sessionBinding.reason
    }
  });

  return {
    ...(reviewResult || { ok: false }),
    sessionBound: sessionBinding.bound,
    sessionBindingReason: sessionBinding.reason
  };
});

export const markReferralConversion = onCall(async (request) => {
  const uid = assertAuthenticated(request);
  const actor = getActorFromRequest(request, "user");
  const phaseId = canonicalizePhaseId(request.data?.phaseId || "phase1");
  const result = await validateAndRecordReferralConversion({
    userId: uid,
    phaseId,
    source: normalizeString(request.data?.source) || "web"
  });

  await writeAuditLog({
    action: "referral.conversion_marked",
    actorType: actor.actorType,
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    targetPath: `referralEvents/${normalizeString(result.referrerId)}_${uid}`,
    payload: { phaseId },
    result
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
  const actor = getActorFromRequest(request, "user");
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
      affiliateByUserDocs,
      affiliateSessionByUserDocs,
      affiliateSessionByReferrerDocs,
      affiliateClicksByReferrerDocs,
      commissionByReferredDocs,
      commissionByReferrerDocs,
      payoutByReferrerDocs,
      campaignByOwnerDocs
    ] = await Promise.all([
      collectDocsForUserIds("bookings", ["userId", "uid"], uid),
      collectDocsForUserIds("referralEvents", "userId", uid),
      collectDocsForUserIds("referralEvents", "referredUserId", uid),
      collectDocsForUserIds("referralEvents", "referrerId", uid),
      collectDocsForUserIds("affiliateStats", "userId", uid),
      collectDocsForUserIds("affiliateSessions", "userId", uid),
      collectDocsForUserIds("affiliateSessions", ["referrerId", "attributedReferrerId"], uid),
      collectDocsForUserIds("affiliateClicks", "referrerId", uid),
      collectDocsForUserIds("affiliateCommissions", "referredUserId", uid),
      collectDocsForUserIds("affiliateCommissions", "referrerId", uid),
      collectDocsForUserIds("affiliatePayouts", "referrerId", uid),
      collectDocsForUserIds("affiliateCampaigns", "ownerReferrerId", uid)
    ]);

    bookingDocs.forEach((docSnap) => queueDelete(docSnap.ref));
    referralByUserDocs.forEach((docSnap) => queueDelete(docSnap.ref));
    referralByReferredUserDocs.forEach((docSnap) => queueDelete(docSnap.ref));
    referralByReferrerDocs.forEach((docSnap) => queueDelete(docSnap.ref));
    affiliateByUserDocs.forEach((docSnap) => queueDelete(docSnap.ref));
    affiliateSessionByUserDocs.forEach((docSnap) => queueDelete(docSnap.ref));
    affiliateSessionByReferrerDocs.forEach((docSnap) => queueDelete(docSnap.ref));
    affiliateClicksByReferrerDocs.forEach((docSnap) => queueDelete(docSnap.ref));
    commissionByReferredDocs.forEach((docSnap) => queueDelete(docSnap.ref));
    commissionByReferrerDocs.forEach((docSnap) => queueDelete(docSnap.ref));
    payoutByReferrerDocs.forEach((docSnap) => queueDelete(docSnap.ref));
    campaignByOwnerDocs.forEach((docSnap) => queueDelete(docSnap.ref));

    const affiliateDocById = db.doc(`affiliateStats/${uid}`);
    const referralApprovalDocById = db.doc(`${REFERRAL_APPROVAL_COLLECTION}/${uid}`);
    const [affiliateByIdSnap, referralApprovalByIdSnap, userSnap] = await Promise.all([
      affiliateDocById.get(),
      referralApprovalDocById.get(),
      userRef.get()
    ]);

    if (affiliateByIdSnap.exists) {
      queueDelete(affiliateDocById);
    }
    if (referralApprovalByIdSnap.exists) {
      queueDelete(referralApprovalDocById);
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

    await writeAuditLog({
      action: "account.deleted_cascade",
      actorType: actor.actorType,
      actorId: actor.actorId,
      actorEmail: actor.actorEmail,
      targetPath: `users/${uid}`,
      payload: { requestedBy: uid },
      result: {
        ok: true,
        deletedCount: deletedPaths.length,
        deletedPathSample: deletedPaths.slice(0, 50)
      }
    });

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
