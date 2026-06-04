import {
  ACTIVE_REVIEWABLE_STATUSES,
  BOOKING_STATUS,
  CANONICAL_PHASES,
  DEFAULT_TOTAL_SEATS,
  KNOWN_BOOKING_STATUSES,
  LEGACY_PHASE_ID_MAP
} from "./constants.js";
import { clamp } from "./formatters.js";
import { getLessonCountForPhase } from "../../learning/lessonCatalog.js";

const CANONICAL_PHASE_BY_ID = new Map(CANONICAL_PHASES.map((phase) => [phase.phaseId, phase]));

export function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeEmail(value) {
  return normalizeString(value).toLowerCase();
}

export function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const unique = new Set(
    value.map((item) => normalizeString(item)).filter(Boolean)
  );
  return Array.from(unique);
}

export function timestampToMillis(value) {
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

export function canonicalizePhaseId(rawPhaseId) {
  const normalized = normalizeString(rawPhaseId).toLowerCase();
  if (!normalized) {
    return "";
  }

  const matchedPhaseNumber = normalized.match(/phase[\s_-]*([1-9]\d*)/i);
  if (matchedPhaseNumber?.[1]) {
    return `phase${matchedPhaseNumber[1]}`;
  }

  if (LEGACY_PHASE_ID_MAP.has(normalized)) {
    return LEGACY_PHASE_ID_MAP.get(normalized);
  }

  return normalized;
}

export function sortPhases(phases) {
  return phases.slice().sort((a, b) => {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.title.localeCompare(b.title);
  });
}

export function mergeWithCanonicalPhases(phasesFromFirestore = []) {
  const mergedById = new Map(CANONICAL_PHASES.map((phase) => [phase.phaseId, { ...phase }]));

  phasesFromFirestore.forEach((phase) => {
    const canonicalPhaseId = canonicalizePhaseId(phase.phaseId);
    const existing = mergedById.get(canonicalPhaseId) || {};
    mergedById.set(canonicalPhaseId, {
      ...existing,
      ...phase,
      phaseId: canonicalPhaseId
    });
  });

  return sortPhases(Array.from(mergedById.values()));
}

export function normalizeBookingStatus(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (KNOWN_BOOKING_STATUSES.has(normalized)) {
    return normalized;
  }
  return BOOKING_STATUS.pending;
}

export function getEffectiveBookingStatus(booking, nowMs = Date.now()) {
  if (!booking) {
    return BOOKING_STATUS.pending;
  }
  if (
    ACTIVE_REVIEWABLE_STATUSES.has(booking.status) &&
    Number.isFinite(booking.expiresAtMs) &&
    booking.expiresAtMs <= nowMs
  ) {
    return BOOKING_STATUS.expired;
  }
  return booking.status;
}

export function normalizeUserDoc(userId, data = {}) {
  const normalizedPhoneNumber =
    normalizeString(data.phoneNumber) ||
    normalizeString(data.whatsappNumber) ||
    normalizeString(data.phone) ||
    normalizeString(data.whatsapp);
  const normalizedWhatsappNumber =
    normalizeString(data.whatsappNumber) ||
    normalizeString(data.whatsapp) ||
    normalizeString(data.phoneNumber) ||
    normalizeString(data.phone);
  const progressRaw = Number(data.progress);
  return {
    userId,
    name: normalizeString(data.name) || "Unknown User",
    email: normalizeEmail(data.email),
    phoneNumber: normalizedPhoneNumber,
    whatsappNumber: normalizedWhatsappNumber,
    referralCode: normalizeString(data.referralCode).toUpperCase(),
    referredBy: normalizeString(data.referredBy),
    referredByCode: normalizeString(data.referredByCode).toUpperCase(),
    progress: Number.isFinite(progressRaw) ? clamp(progressRaw, 0, 100) : null,
    unlockedPhases: normalizeStringArray(data.unlockedPhases).map(canonicalizePhaseId).filter(Boolean),
    completedPhases: normalizeStringArray(data.completedPhases).map(canonicalizePhaseId).filter(Boolean),
    createdAtMs: timestampToMillis(data.createdAt) ?? timestampToMillis(data.createdAtMs),
    updatedAtMs: timestampToMillis(data.updatedAt) ?? timestampToMillis(data.updatedAtMs)
  };
}

export function normalizePhaseDoc(docId, data = {}) {
  const phaseId = canonicalizePhaseId(data.phaseId || docId);
  const canonical = CANONICAL_PHASE_BY_ID.get(phaseId);
  const orderRaw = Number(data.order);
  const totalSeatsRaw = Number(data.totalSeats);
  const bookedSeatsRaw = Number(data.bookedSeats);

  return {
    phaseId,
    title: normalizeString(data.title) || canonical?.title || phaseId,
    description: normalizeString(data.description) || canonical?.description || "",
    level: normalizeString(data.level) || canonical?.level || "Beginner",
    order: Number.isFinite(orderRaw) ? orderRaw : (canonical?.order || Number.MAX_SAFE_INTEGER),
    totalSeats: Number.isFinite(totalSeatsRaw) && totalSeatsRaw >= 0
      ? totalSeatsRaw
      : (canonical?.totalSeats || DEFAULT_TOTAL_SEATS),
    bookedSeats: Number.isFinite(bookedSeatsRaw) && bookedSeatsRaw >= 0 ? bookedSeatsRaw : 0
  };
}

export function normalizeBookingDoc(docId, data = {}) {
  const rawPhaseId = normalizeString(data.phaseId) || normalizeString(data.phase) || normalizeString(data.phaseKey);
  const rawCanonicalPhaseId = normalizeString(data.phaseCanonicalId);
  const rawLegacyPhaseId = normalizeString(data.phaseLegacyId);
  const canonicalPhaseId = canonicalizePhaseId(rawCanonicalPhaseId || rawPhaseId || rawLegacyPhaseId);
  const status = normalizeBookingStatus(data.status || data.requestStatus || data.bookingStatus);

  const revenueRaw = Number(
    data.revenue ??
      data.price ??
      data.amount ??
      data.fee ??
      data.tuition ??
      data.phaseFee ??
      0
  );

  return {
    bookingId: normalizeString(data.bookingId) || docId,
    userId: normalizeString(data.userId) || normalizeString(data.uid),
    phaseId: canonicalPhaseId,
    userName: normalizeString(data.userName) || normalizeString(data.name),
    userEmail: normalizeEmail(data.userEmail) || normalizeEmail(data.email),
    phoneNumber:
      normalizeString(data.phoneNumber) ||
      normalizeString(data.whatsappNumber) ||
      normalizeString(data.phone) ||
      normalizeString(data.whatsapp),
    whatsappNumber:
      normalizeString(data.whatsappNumber) ||
      normalizeString(data.whatsapp) ||
      normalizeString(data.phoneNumber) ||
      normalizeString(data.phone),
    status,
    requestStatus: normalizeBookingStatus(data.requestStatus || status),
    bookingStatus: normalizeBookingStatus(data.bookingStatus || status),
    createdAtMs: timestampToMillis(data.createdAt) ?? timestampToMillis(data.createdAtMs),
    updatedAtMs: timestampToMillis(data.updatedAt) ?? timestampToMillis(data.updatedAtMs),
    expiresAtMs: timestampToMillis(data.expiresAt) ?? timestampToMillis(data.expiresAtMs),
    approvedAtMs: timestampToMillis(data.approvedAt) ?? timestampToMillis(data.approvedAtMs),
    rejectedAtMs: timestampToMillis(data.rejectedAt) ?? timestampToMillis(data.rejectedAtMs),
    cancelledAtMs: timestampToMillis(data.cancelledAt) ?? timestampToMillis(data.cancelledAtMs),
    source: normalizeString(data.source),
    revenue: Number.isFinite(revenueRaw) ? Math.max(0, revenueRaw) : 0
  };
}

export function normalizeProgressDoc(docId, userId, data = {}) {
  const phaseId = canonicalizePhaseId(data.phaseId || data.phase || data.phaseKey || docId);
  const completedLessonMap = (typeof data.completedLessons === "object" && !Array.isArray(data.completedLessons) && data.completedLessons !== null)
    ? data.completedLessons
    : ((typeof data.lessons === "object" && !Array.isArray(data.lessons) && data.lessons !== null) ? data.lessons : null);
  const completedLessonIds = normalizeStringArray(
    Array.isArray(data.completedLessonIds)
      ? data.completedLessonIds
      : (Array.isArray(data.completedLessons) ? data.completedLessons : [])
  );
  const reflections = (typeof data.reflections === "object" && data.reflections !== null && !Array.isArray(data.reflections))
    ? data.reflections
    : null;
  const reflectionCount = reflections
    ? Object.keys(reflections).map((key) => normalizeString(key)).filter(Boolean).length
    : 0;
  const completedFromObject = completedLessonMap
    ? Object.entries(completedLessonMap).reduce((count, [key, value]) => {
      const normalizedKey = normalizeString(key);
      if (!normalizedKey) {
        return count;
      }
      if (value === true || value === 1 || normalizeString(value).toLowerCase() === "completed") {
        return count + 1;
      }
      if (typeof value === "object" && value !== null) {
        if (value.completed === true || value.isCompleted === true || normalizeString(value.status).toLowerCase() === "completed") {
          return count + 1;
        }
      }
      return count;
    }, 0)
    : 0;
  const completedCountRaw = Number(data.completedCount);
  const completedCount = completedLessonIds.length > 0
    ? completedLessonIds.length
    : Math.max(
      Number.isFinite(completedCountRaw) && completedCountRaw > 0 ? Math.floor(completedCountRaw) : 0,
      completedFromObject,
      reflectionCount
    );
  const lessonCountFromCatalog = getLessonCountForPhase(phaseId);
  const lessonCountFromDoc = Number(data.totalLessons);
  const lessonCount = Math.max(
    Number.isFinite(lessonCountFromCatalog) ? lessonCountFromCatalog : 0,
    Number.isFinite(lessonCountFromDoc) ? Math.floor(lessonCountFromDoc) : 0
  );
  const progressPercentRaw = Number(data.progressPercent);
  const computedProgressPercent = lessonCount > 0
    ? Math.round((completedCount / lessonCount) * 100)
    : 0;
  const progressPercent = Number.isFinite(progressPercentRaw)
    ? clamp(progressPercentRaw, 0, 100)
    : clamp(computedProgressPercent, 0, 100);

  return {
    progressId: `${userId}_${phaseId}`,
    userId,
    phaseId,
    completedLessonIds,
    completedCount,
    lessonCount,
    progressPercent,
    updatedAtMs:
      timestampToMillis(data.updatedAt) ??
      timestampToMillis(data.updatedAtMs) ??
      timestampToMillis(data.lastCompletedAt)
  };
}

export function normalizeAffiliateStats(docId, data = {}) {
  const invitesRaw = Number(data.totalInvites ?? data.invites ?? 0);
  const conversionsRaw = Number(data.conversions ?? data.totalConversions ?? data.converted ?? 0);

  return {
    referrerId: normalizeString(data.userId) || docId,
    totalInvites: Number.isFinite(invitesRaw) ? Math.max(0, Math.floor(invitesRaw)) : 0,
    conversions: Number.isFinite(conversionsRaw) ? Math.max(0, Math.floor(conversionsRaw)) : 0,
    updatedAtMs: timestampToMillis(data.updatedAt) ?? timestampToMillis(data.updatedAtMs)
  };
}

export function normalizeAffiliateCommission(docId, data = {}) {
  const amountMicrosRaw = Number(data.amountMicros ?? 0);
  const amountRaw = Number(data.amount ?? data.value ?? 0);
  const amountMicros = Number.isFinite(amountMicrosRaw) ? Math.max(0, Math.floor(amountMicrosRaw)) : 0;
  const amount = Number.isFinite(amountRaw) && amountRaw > 0
    ? amountRaw
    : (amountMicros / 1000000);

  return {
    commissionId: normalizeString(data.commissionId) || docId,
    referrerId: normalizeString(data.referrerId),
    referredUserId: normalizeString(data.referredUserId),
    phaseId: canonicalizePhaseId(data.phaseId),
    status: normalizeString(data.status).toLowerCase() || "pending",
    currency: normalizeString(data.currency).toUpperCase() || "USD",
    amountMicros,
    amount,
    rateBps: Number.isFinite(Number(data.rateBps)) ? Math.max(0, Math.floor(Number(data.rateBps))) : 0,
    createdAtMs: timestampToMillis(data.createdAt) ?? timestampToMillis(data.createdAtMs),
    updatedAtMs: timestampToMillis(data.updatedAt) ?? timestampToMillis(data.updatedAtMs)
  };
}

export function normalizeReferralEvent(docId, data = {}) {
  const status = normalizeString(data.status).toLowerCase();
  return {
    eventId: normalizeString(data.eventId) || docId,
    referrerId: normalizeString(data.referrerId),
    userId: normalizeString(data.userId) || normalizeString(data.referredUserId),
    referredUserName: normalizeString(data.referredUserName),
    referredUserEmail: normalizeEmail(data.referredUserEmail),
    status,
    isConverted: Boolean(data.isConverted) || status === "converted" || Boolean(data.convertedAt),
    source: normalizeString(data.source) || "unknown",
    joinedAtMs: timestampToMillis(data.joinedAt),
    convertedAtMs: timestampToMillis(data.convertedAt),
    updatedAtMs: timestampToMillis(data.updatedAt)
  };
}

export function extractUserIdFromProgressPath(path) {
  if (!path) {
    return "";
  }
  const segments = String(path).split("/");
  const usersIndex = segments.indexOf("users");
  if (usersIndex < 0 || usersIndex + 1 >= segments.length) {
    return "";
  }
  return normalizeString(segments[usersIndex + 1]);
}

export function extractUserAndPhaseFromLessonPath(path) {
  if (!path) {
    return { userId: "", phaseId: "" };
  }
  const segments = String(path).split("/");
  const usersIndex = segments.indexOf("users");
  const progressIndex = segments.indexOf("progress");
  if (usersIndex < 0 || progressIndex < 0 || usersIndex + 1 >= segments.length || progressIndex + 1 >= segments.length) {
    return { userId: "", phaseId: "" };
  }
  const userId = normalizeString(segments[usersIndex + 1]);
  const phaseId = canonicalizePhaseId(segments[progressIndex + 1]);
  return { userId, phaseId };
}

export function normalizeLessonProgressDoc(docId, path, data = {}) {
  const extracted = extractUserAndPhaseFromLessonPath(path);
  const completed = typeof data.completed === "boolean"
    ? data.completed
    : (typeof data.isCompleted === "boolean" ? data.isCompleted : true);
  return {
    lessonKey: `${path}`,
    lessonId: normalizeString(data.lessonId) || docId,
    userId: extracted.userId,
    phaseId: extracted.phaseId,
    completed,
    updatedAtMs:
      timestampToMillis(data.updatedAt) ??
      timestampToMillis(data.completedAt) ??
      timestampToMillis(data.lastActivityAt) ??
      timestampToMillis(data.lastOpenedAt)
  };
}
