import {
  BOOKING_STATUS,
  FEATURE_UNLOCK_GATES,
  INACTIVITY_DAYS_HIGH_RISK,
  INACTIVITY_DAYS_WARNING,
  MS_IN_DAY,
  OCCUPANCY_ALERT_THRESHOLD,
  STALLED_PHASE_DAYS
} from "../utils/constants.js";
import { clamp, formatPhaseLabel } from "../utils/formatters.js";
import { getEffectiveBookingStatus } from "../utils/normalizers.js";
import { getLessonCatalogPhaseIds, getLessonCountForPhase } from "../../learning/lessonCatalog.js";

const SUPER_ADMIN_DEFAULT_REFERRAL_CODE = "JXC6G2";
const SUPER_ADMIN_EMAIL_ALIASES = new Set([
  "sushen.biswas.aga@gmail.com",
  "sushen.biswas.aga@googlemail.com"
]);

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

function buildReferrerIdByReferralCode(users) {
  const referrerIdByReferralCode = new Map();
  users.forEach((user) => {
    const userId = normalizeString(user?.userId);
    const referralCode = normalizeReferralCode(user?.referralCode);
    if (!userId || !referralCode || referrerIdByReferralCode.has(referralCode)) {
      return;
    }
    referrerIdByReferralCode.set(referralCode, userId);
  });
  return referrerIdByReferralCode;
}

function resolveDefaultSuperAdminUser(users) {
  const defaultReferralCode = normalizeReferralCode(SUPER_ADMIN_DEFAULT_REFERRAL_CODE);
  const byReferralCode = users.find(
    (user) => normalizeReferralCode(user?.referralCode) === defaultReferralCode
  );
  if (byReferralCode) {
    return byReferralCode;
  }
  return users.find((user) => SUPER_ADMIN_EMAIL_ALIASES.has(normalizeEmail(user?.email))) || null;
}

function resolveFallbackReferrerIdForUser(user, {
  defaultSuperAdminReferrerId = "",
  referrerIdByReferralCode = new Map()
} = {}) {
  const explicitReferrerId = normalizeString(user?.referredBy);
  if (explicitReferrerId) {
    return explicitReferrerId;
  }

  const referredByCode = normalizeReferralCode(user?.referredByCode);
  if (referredByCode) {
    const mappedReferrerId = normalizeString(referrerIdByReferralCode.get(referredByCode));
    if (mappedReferrerId) {
      return mappedReferrerId;
    }
    if (
      defaultSuperAdminReferrerId &&
      referredByCode === normalizeReferralCode(SUPER_ADMIN_DEFAULT_REFERRAL_CODE)
    ) {
      return defaultSuperAdminReferrerId;
    }
    return "";
  }

  const userId = normalizeString(user?.userId);
  if (defaultSuperAdminReferrerId && userId && userId !== defaultSuperAdminReferrerId) {
    return defaultSuperAdminReferrerId;
  }
  return "";
}

function buildReferralEventsWithFallback(users, referralEvents = []) {
  const referrerIdByReferralCode = buildReferrerIdByReferralCode(users);
  const defaultSuperAdminUser = resolveDefaultSuperAdminUser(users);
  const defaultSuperAdminReferrerId = normalizeString(defaultSuperAdminUser?.userId);
  const existingEventByUserId = new Set(
    referralEvents
      .map((event) => normalizeString(event?.userId))
      .filter(Boolean)
  );

  const derivedEvents = [];
  users.forEach((user) => {
    const userId = normalizeString(user?.userId);
    if (!userId || existingEventByUserId.has(userId)) {
      return;
    }

    const resolvedReferrerId = resolveFallbackReferrerIdForUser(user, {
      defaultSuperAdminReferrerId,
      referrerIdByReferralCode
    });
    if (!resolvedReferrerId || resolvedReferrerId === userId) {
      return;
    }

    const completedPhaseIds = Array.isArray(user?.completedPhases) ? user.completedPhases : [];
    const isConverted = completedPhaseIds.includes("phase1");
    const joinedAtMs = Number(user?.createdAtMs || user?.updatedAtMs || 0) || null;
    const convertedAtMs = isConverted ? Number(user?.updatedAtMs || user?.createdAtMs || 0) || null : null;

    derivedEvents.push({
      eventId: `derived_${resolvedReferrerId}_${userId}`,
      referrerId: resolvedReferrerId,
      userId,
      referredUserName: normalizeString(user?.name),
      referredUserEmail: normalizeEmail(user?.email),
      status: isConverted ? "converted" : "joined",
      isConverted,
      source: "derived-default-referral",
      joinedAtMs,
      convertedAtMs,
      updatedAtMs: Number(user?.updatedAtMs || user?.createdAtMs || 0) || null
    });
  });

  return {
    referralEvents: referralEvents.concat(derivedEvents),
    referrerIdByReferralCode,
    defaultSuperAdminReferrerId
  };
}

function toStartOfDay(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function buildDayBuckets(days, nowMs) {
  const todayStart = toStartOfDay(nowMs);
  const buckets = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const start = todayStart - (i * MS_IN_DAY);
    const key = new Date(start).toISOString().slice(0, 10);
    buckets.push({
      key,
      startMs: start,
      endMs: start + MS_IN_DAY,
      label: new Date(start).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      userSet: new Set(),
      updates: 0,
      joined: 0,
      converted: 0
    });
  }
  return buckets;
}

function getBucketForTime(buckets, ms) {
  if (!Number.isFinite(ms)) {
    return null;
  }
  return buckets.find((bucket) => ms >= bucket.startMs && ms < bucket.endMs) || null;
}

function groupByUser(items, userIdSelector) {
  const grouped = new Map();
  items.forEach((item) => {
    const userId = userIdSelector(item);
    if (!userId) {
      return;
    }
    if (!grouped.has(userId)) {
      grouped.set(userId, []);
    }
    grouped.get(userId).push(item);
  });
  return grouped;
}

function computeOverallProgress(phaseProgressByPhaseId) {
  const phaseIds = getLessonCatalogPhaseIds();
  if (!phaseIds.length) {
    return 0;
  }
  const sum = phaseIds.reduce((acc, phaseId) => acc + Number(phaseProgressByPhaseId.get(phaseId)?.progressPercent || 0), 0);
  return clamp(Math.round(sum / phaseIds.length), 0, 100);
}

function buildLessonEvidenceByUserPhase(lessonDocs) {
  const byUserPhase = new Map();
  lessonDocs.forEach((lessonDoc) => {
    if (!lessonDoc?.completed || !lessonDoc.userId || !lessonDoc.phaseId) {
      return;
    }
    const key = `${lessonDoc.userId}__${lessonDoc.phaseId}`;
    const current = byUserPhase.get(key) || {
      userId: lessonDoc.userId,
      phaseId: lessonDoc.phaseId,
      lessonIds: new Set(),
      completedCount: 0,
      updatedAtMs: 0
    };
    current.lessonIds.add(lessonDoc.lessonId || lessonDoc.lessonKey);
    current.completedCount = current.lessonIds.size;
    current.updatedAtMs = Math.max(current.updatedAtMs, Number(lessonDoc.updatedAtMs || 0));
    byUserPhase.set(key, current);
  });
  return byUserPhase;
}

function buildMergedPhaseProgressList({ phases, phasesById, userId, phaseProgressByPhaseId, lessonEvidenceByUserPhase }) {
  const merged = phases.map((phase) => {
    const phaseProgress = phaseProgressByPhaseId.get(phase.phaseId);
    const lessonEvidence = lessonEvidenceByUserPhase.get(`${userId}__${phase.phaseId}`);
    const completedFromDoc = Number(phaseProgress?.completedCount || 0);
    const completedFromLessons = Number(lessonEvidence?.completedCount || 0);
    const completedLessons = Math.max(completedFromDoc, completedFromLessons);

    const totalFromDoc = Number(phaseProgress?.lessonCount || 0);
    const totalFromCatalog = Number(getLessonCountForPhase(phase.phaseId) || 0);
    const totalLessons = Math.max(totalFromDoc, totalFromCatalog);

    const docProgressPercent = Number(phaseProgress?.progressPercent || 0);
    const inferredProgressPercent = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;
    const progressPercent = clamp(Math.max(docProgressPercent, inferredProgressPercent), 0, 100);

    const updatedAtMs = Math.max(
      Number(phaseProgress?.updatedAtMs || 0),
      Number(lessonEvidence?.updatedAtMs || 0)
    );

    return {
      phaseId: phase.phaseId,
      phaseLabel: formatPhaseLabel(phase.phaseId, phasesById),
      progressPercent,
      completedLessons,
      totalLessons,
      updatedAtMs: updatedAtMs > 0 ? updatedAtMs : null
    };
  });
  return merged;
}

function applyOverallProgressFallback(phaseProgressList, overallProgressPercent, anchorUpdatedAtMs = null) {
  const hasAnyExplicitSignal = phaseProgressList.some((phase) =>
    Number(phase.progressPercent || 0) > 0 ||
    Number(phase.completedLessons || 0) > 0 ||
    Number(phase.updatedAtMs || 0) > 0
  );
  if (hasAnyExplicitSignal) {
    return phaseProgressList;
  }

  const overall = Number(overallProgressPercent || 0);
  if (!Number.isFinite(overall) || overall <= 0) {
    return phaseProgressList;
  }

  let remaining = clamp(overall, 0, 100) * phaseProgressList.length;
  return phaseProgressList.map((phase) => {
    const rawPhasePercent = clamp(remaining, 0, 100);
    remaining -= 100;
    const totalLessons = Number(phase.totalLessons || 0);
    const completedLessons = totalLessons > 0
      ? Math.round((rawPhasePercent / 100) * totalLessons)
      : Number(phase.completedLessons || 0);
    const phasePercent = totalLessons > 0
      ? clamp(Math.round((completedLessons / totalLessons) * 100), 0, 100)
      : rawPhasePercent;
    return {
      ...phase,
      progressPercent: phasePercent,
      completedLessons,
      updatedAtMs: phasePercent > 0 ? (anchorUpdatedAtMs || phase.updatedAtMs || null) : phase.updatedAtMs
    };
  });
}

function computeRiskProfile(student, nowMs) {
  const riskReasons = [];
  let riskScore = 0;

  const lastLearningActivityMs = Number(student.lastLearningActivityMs || 0);
  const inactiveDays = lastLearningActivityMs > 0
    ? Math.floor((nowMs - lastLearningActivityMs) / MS_IN_DAY)
    : Number.POSITIVE_INFINITY;

  if (lastLearningActivityMs <= 0) {
    riskReasons.push("No learning activity yet");
    riskScore += 2;
  } else if (inactiveDays >= INACTIVITY_DAYS_WARNING) {
    riskReasons.push(`Inactive for ${inactiveDays} days`);
    riskScore += inactiveDays >= INACTIVITY_DAYS_HIGH_RISK ? 3 : 2;
  }

  const accountAnchor = Number(student.createdAtMs || student.updatedAtMs || nowMs);
  const accountAgeDays = Math.max(1, Math.floor((nowMs - accountAnchor) / MS_IN_DAY));
  if (student.overallProgressPercent < 20 && accountAgeDays >= 7) {
    riskReasons.push("Low progress");
    riskScore += 1;
  }

  if (student.hasAbandonedBooking) {
    riskReasons.push("Abandoned booking lifecycle");
    riskScore += 1;
  }

  if (student.isStalledInPhase) {
    riskReasons.push("Stalled in current phase");
    riskScore += 2;
  }

  let riskLevel = "low";
  if (riskScore >= 4) {
    riskLevel = "high";
  } else if (riskScore >= 2) {
    riskLevel = "medium";
  }

  return { riskLevel, riskScore, riskReasons, inactiveDays };
}

function toFeatureUnlocks(progressPercent) {
  const bounded = clamp(Number(progressPercent) || 0, 0, 100);
  return FEATURE_UNLOCK_GATES.map((gate) => ({
    ...gate,
    unlocked: bounded >= gate.minProgress
  }));
}

function buildTimeline(student, referralEventsByUser, userById) {
  const events = [];

  if (student.createdAtMs) {
    events.push({
      type: "account",
      timestampMs: student.createdAtMs,
      text: "Account created"
    });
  }

  student.bookings.forEach((booking) => {
    if (booking.createdAtMs) {
      events.push({
        type: "booking",
        timestampMs: booking.createdAtMs,
        text: `Booking requested (${booking.phaseLabel})`
      });
    }
    if (booking.approvedAtMs) {
      events.push({
        type: "booking",
        timestampMs: booking.approvedAtMs,
        text: `Booking approved (${booking.phaseLabel})`
      });
    }
    if (booking.rejectedAtMs) {
      events.push({
        type: "booking",
        timestampMs: booking.rejectedAtMs,
        text: `Booking rejected (${booking.phaseLabel})`
      });
    }
    if (booking.cancelledAtMs) {
      events.push({
        type: "booking",
        timestampMs: booking.cancelledAtMs,
        text: `Seat cancelled (${booking.phaseLabel})`
      });
    }
  });

  student.phaseProgressList.forEach((phaseProgress) => {
    if (!phaseProgress.updatedAtMs) {
      return;
    }
    events.push({
      type: "learning",
      timestampMs: phaseProgress.updatedAtMs,
      text: `${phaseProgress.phaseLabel} updated to ${phaseProgress.progressPercent}%`
    });
  });

  const joinedEvent = referralEventsByUser.get(student.userId)?.find((event) => event.joinedAtMs);
  if (joinedEvent?.joinedAtMs) {
    const referrerName = userById.get(joinedEvent.referrerId)?.name || joinedEvent.referrerId;
    events.push({
      type: "referral",
      timestampMs: joinedEvent.joinedAtMs,
      text: `Joined via referral (${referrerName})`
    });
  }
  const convertedEvent = referralEventsByUser.get(student.userId)?.find((event) => event.convertedAtMs);
  if (convertedEvent?.convertedAtMs) {
    events.push({
      type: "referral",
      timestampMs: convertedEvent.convertedAtMs,
      text: "Referral converted"
    });
  }

  return events
    .filter((event) => Number.isFinite(event.timestampMs))
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .slice(0, 20);
}

function resolveBestWhatsapp(user, bookings) {
  const fromUser = String(user?.whatsappNumber || user?.phoneNumber || "").trim();
  if (fromUser) {
    return fromUser;
  }
  for (const booking of bookings) {
    const fromBooking = String(booking?.whatsappNumber || booking?.phoneNumber || "").trim();
    if (fromBooking) {
      return fromBooking;
    }
  }
  return "";
}

export function computeBookingFunnel(bookings, filters, nowMs = Date.now()) {
  const days = Number(filters.days || 0);
  const phaseId = filters.phaseId || "all";
  const cutoffMs = days > 0 ? (nowMs - (days * MS_IN_DAY)) : null;

  const filtered = bookings.filter((booking) => {
    if (phaseId !== "all" && booking.phaseId !== phaseId) {
      return false;
    }
    if (!cutoffMs) {
      return true;
    }
    const anchor = Number(booking.createdAtMs || booking.updatedAtMs || 0);
    return anchor >= cutoffMs;
  });

  const counts = {
    [BOOKING_STATUS.pending]: 0,
    [BOOKING_STATUS.reviewing]: 0,
    [BOOKING_STATUS.approved]: 0,
    [BOOKING_STATUS.rejected]: 0,
    [BOOKING_STATUS.expired]: 0
  };

  filtered.forEach((booking) => {
    const effective = getEffectiveBookingStatus(booking, nowMs);
    if (counts[effective] === undefined) {
      return;
    }
    counts[effective] += 1;
  });

  const total = filtered.length;
  const steps = [
    { key: BOOKING_STATUS.pending, label: "Pending", count: counts.pending },
    { key: BOOKING_STATUS.reviewing, label: "Reviewing", count: counts.reviewing },
    { key: BOOKING_STATUS.approved, label: "Approved", count: counts.approved },
    { key: BOOKING_STATUS.rejected, label: "Rejected", count: counts.rejected },
    { key: BOOKING_STATUS.expired, label: "Expired", count: counts.expired }
  ].map((step) => ({
    ...step,
    percentOfTotal: total > 0 ? (step.count / total) * 100 : 0
  }));

  const conversionRates = {
    pendingToReviewing: counts.pending > 0 ? (counts.reviewing / counts.pending) * 100 : 0,
    reviewingToApproved: counts.reviewing > 0 ? (counts.approved / counts.reviewing) * 100 : 0,
    pendingToApproved: counts.pending > 0 ? (counts.approved / counts.pending) * 100 : 0
  };

  return { total, steps, conversionRates, filteredBookings: filtered };
}

function buildAlerts(model, previousSignals, nowMs) {
  const alerts = [];

  model.phaseAnalytics
    .filter((phase) => phase.occupancyPercent >= OCCUPANCY_ALERT_THRESHOLD)
    .forEach((phase) => {
      alerts.push({
        id: `phase_full_${phase.phaseId}`,
        priority: "high",
        title: `${phase.title} nearly full`,
        detail: `${phase.bookedSeats}/${phase.totalSeats} seats occupied`,
        timestampMs: nowMs
      });
    });

  model.students
    .filter((student) =>
      student.overallProgressPercent >= 60 &&
      student.riskReasons.some((reason) => reason.startsWith("Inactive") || reason.startsWith("No learning"))
    )
    .slice(0, 4)
    .forEach((student) => {
      alerts.push({
        id: `inactive_high_value_${student.userId}`,
        priority: "medium",
        title: "High-value learner inactive",
        detail: `${student.name} has ${student.overallProgressPercent}% progress but no recent study activity`,
        timestampMs: nowMs
      });
    });

  const previousPending = Number(previousSignals.pendingQueue || 0);
  if (previousPending > 0 && model.pendingQueue > Math.ceil(previousPending * 1.15) && model.pendingQueue - previousPending >= 3) {
    alerts.push({
      id: "pending_rising",
      priority: "high",
      title: "Pending bookings increasing",
      detail: `Queue moved from ${previousPending} to ${model.pendingQueue}`,
      timestampMs: nowMs
    });
  }

  const previousActiveToday = Number(previousSignals.activeToday || 0);
  if (previousActiveToday > 0 && model.learning.activeToday < Math.floor(previousActiveToday * 0.7)) {
    alerts.push({
      id: "activity_drop",
      priority: "high",
      title: "Drop in learning activity",
      detail: `Active learners today fell from ${previousActiveToday} to ${model.learning.activeToday}`,
      timestampMs: nowMs
    });
  }

  model.phaseAnalytics
    .filter((phase) => phase.stalledLearners >= 3)
    .forEach((phase) => {
      alerts.push({
        id: `stalled_${phase.phaseId}`,
        priority: "medium",
        title: `Students stalled in ${phase.title}`,
        detail: `${phase.stalledLearners} learners are stalled`,
        timestampMs: nowMs
      });
    });

  if (!alerts.length) {
    alerts.push({
      id: "healthy",
      priority: "low",
      title: "System healthy",
      detail: "No high-priority operational alert detected.",
      timestampMs: nowMs
    });
  }

  const priorityOrder = { high: 3, medium: 2, low: 1 };
  return alerts.sort((a, b) => {
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    }
    return b.timestampMs - a.timestampMs;
  });
}

export function buildOperationalAnalytics(snapshot, options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  const previousSignals = options.previousSignals || {};
  const phases = snapshot.phases || [];
  const phasesById = snapshot.phasesById || new Map();
  const users = snapshot.users || [];
  const bookings = snapshot.bookings || [];
  const progressDocs = snapshot.progressDocs || [];
  const lessonDocs = snapshot.lessonDocs || [];
  const referralEventsRaw = snapshot.referralEvents || [];
  const affiliateStats = snapshot.affiliateStats || [];
  const affiliateCommissions = snapshot.affiliateCommissions || [];
  const {
    referralEvents,
    referrerIdByReferralCode,
    defaultSuperAdminReferrerId
  } = buildReferralEventsWithFallback(users, referralEventsRaw);

  const userById = new Map(users.map((user) => [user.userId, user]));
  const bookingByUser = groupByUser(bookings, (booking) => booking.userId);
  const progressByUser = groupByUser(progressDocs, (progress) => progress.userId);
  const lessonEvidenceByUserPhase = buildLessonEvidenceByUserPhase(lessonDocs);
  const referralEventsByUser = groupByUser(referralEvents, (event) => event.userId);
  const referralEventsByReferrer = groupByUser(referralEvents, (event) => event.referrerId);
  const affiliateByReferrer = new Map(affiliateStats.map((stats) => [stats.referrerId, stats]));

  const todayStartMs = toStartOfDay(nowMs);
  const activeWindowStartMs = nowMs - (INACTIVITY_DAYS_WARNING * MS_IN_DAY);
  const learningBuckets = buildDayBuckets(14, nowMs);
  const referralBuckets = buildDayBuckets(30, nowMs);

  const phaseModelById = new Map(
    phases.map((phase) => [
      phase.phaseId,
      {
        phaseId: phase.phaseId,
        title: phase.title,
        order: phase.order,
        totalSeats: phase.totalSeats,
        bookedSeats: phase.bookedSeats,
        enrolledUserIds: new Set(),
        activeLearners: 0,
        completedLearners: 0,
        stalledLearners: 0,
        progressDocCount: 0,
        progressSum: 0,
        pendingRequests: 0
      }
    ])
  );

  bookings.forEach((booking) => {
    const phaseModel = phaseModelById.get(booking.phaseId);
    if (!phaseModel) {
      return;
    }
    const effective = getEffectiveBookingStatus(booking, nowMs);
    if (effective === BOOKING_STATUS.approved && booking.userId) {
      phaseModel.enrolledUserIds.add(booking.userId);
    }
    if (effective === BOOKING_STATUS.pending || effective === BOOKING_STATUS.reviewing) {
      phaseModel.pendingRequests += 1;
    }
  });

  progressDocs.forEach((progressDoc) => {
    const phaseModel = phaseModelById.get(progressDoc.phaseId);
    if (!phaseModel) {
      return;
    }
    phaseModel.progressDocCount += 1;
    phaseModel.progressSum += Number(progressDoc.progressPercent || 0);
    if (progressDoc.progressPercent >= 100) {
      phaseModel.completedLearners += 1;
    }
    if (progressDoc.updatedAtMs && progressDoc.updatedAtMs >= activeWindowStartMs) {
      phaseModel.activeLearners += 1;
    }

    const activityBucket = getBucketForTime(learningBuckets, progressDoc.updatedAtMs);
    if (activityBucket) {
      activityBucket.userSet.add(progressDoc.userId);
      activityBucket.updates += 1;
    }
  });

  lessonDocs.forEach((lessonDoc) => {
    if (!lessonDoc?.completed) {
      return;
    }
    const activityBucket = getBucketForTime(learningBuckets, lessonDoc.updatedAtMs);
    if (activityBucket) {
      activityBucket.userSet.add(lessonDoc.userId);
      activityBucket.updates += 1;
    }
  });

  referralEvents.forEach((event) => {
    const joinedBucket = getBucketForTime(referralBuckets, event.joinedAtMs);
    if (joinedBucket) {
      joinedBucket.joined += 1;
    }
    const convertedBucket = getBucketForTime(referralBuckets, event.convertedAtMs);
    if (convertedBucket) {
      convertedBucket.converted += 1;
    }
  });

  const students = [];
  let activeToday = 0;
  let inactive7Plus = 0;
  let progressSumAcrossUsers = 0;

  users.forEach((user) => {
    const userBookings = (bookingByUser.get(user.userId) || []).slice().sort((a, b) => {
      const aAnchor = Number(a.updatedAtMs || a.createdAtMs || 0);
      const bAnchor = Number(b.updatedAtMs || b.createdAtMs || 0);
      return bAnchor - aAnchor;
    });
    const userProgressDocs = progressByUser.get(user.userId) || [];
    const phaseProgressByPhaseId = new Map(userProgressDocs.map((doc) => [doc.phaseId, doc]));
    let phaseProgressList = buildMergedPhaseProgressList({
      phases,
      phasesById,
      userId: user.userId,
      phaseProgressByPhaseId,
      lessonEvidenceByUserPhase
    });
    const userOverallProgressRaw = Number(user.progress);
    phaseProgressList = applyOverallProgressFallback(
      phaseProgressList,
      Number.isFinite(userOverallProgressRaw) ? userOverallProgressRaw : 0,
      Number(user.updatedAtMs || user.createdAtMs || 0) || null
    );
    const mergedPhaseProgressByPhaseId = new Map(
      phaseProgressList.map((phaseProgress) => [phaseProgress.phaseId, phaseProgress])
    );
    const approvedPhaseSet = new Set(
      userBookings
        .filter((booking) => getEffectiveBookingStatus(booking, nowMs) === BOOKING_STATUS.approved)
        .map((booking) => booking.phaseId)
    );

    const computedOverallProgress = computeOverallProgress(mergedPhaseProgressByPhaseId);
    const storedOverallProgress = userOverallProgressRaw;
    const overallProgressPercent = Number.isFinite(storedOverallProgress)
      ? clamp(Math.max(storedOverallProgress, computedOverallProgress), 0, 100)
      : computedOverallProgress;
    const completedLessons = phaseProgressList.reduce(
      (sum, phaseProgress) => sum + Number(phaseProgress.completedLessons || 0),
      0
    );
    const lastLearningActivityMs = phaseProgressList.reduce(
      (maxMs, phaseProgress) => Math.max(maxMs, Number(phaseProgress.updatedAtMs || 0)),
      0
    );
    const lastBookingActivityMs = userBookings.reduce(
      (maxMs, booking) => Math.max(maxMs, Number(booking.updatedAtMs || booking.createdAtMs || 0)),
      0
    );
    const lastActivityMs = Math.max(
      lastLearningActivityMs,
      lastBookingActivityMs,
      Number(user.updatedAtMs || 0),
      Number(user.createdAtMs || 0)
    );

    let currentPhaseId = phases[0]?.phaseId || "";
    for (const phase of phases) {
      const progress = mergedPhaseProgressByPhaseId.get(phase.phaseId)?.progressPercent || 0;
      const hasApproval = approvedPhaseSet.has(phase.phaseId);
      if ((progress > 0 && progress < 100) || (hasApproval && progress < 100)) {
        currentPhaseId = phase.phaseId;
        break;
      }
      if (progress >= 100) {
        currentPhaseId = phase.phaseId;
      }
    }

    const currentPhase = phasesById.get(currentPhaseId) || phases[0] || null;
    const latestBooking = userBookings[0] || null;
    const latestBookingStatus = latestBooking ? getEffectiveBookingStatus(latestBooking, nowMs) : "none";
    const hasAbandonedBooking =
      latestBookingStatus === BOOKING_STATUS.rejected ||
      latestBookingStatus === BOOKING_STATUS.cancelled ||
      latestBookingStatus === BOOKING_STATUS.expired;

    const currentPhaseProgress = Number(mergedPhaseProgressByPhaseId.get(currentPhaseId)?.progressPercent || 0);
    const isStalledInPhase =
      currentPhaseProgress > 0 &&
      currentPhaseProgress < 100 &&
      lastLearningActivityMs > 0 &&
      (nowMs - lastLearningActivityMs) >= (STALLED_PHASE_DAYS * MS_IN_DAY);

    const resolvedReferrerId = resolveFallbackReferrerIdForUser(user, {
      defaultSuperAdminReferrerId,
      referrerIdByReferralCode
    });
    const referrerProfile = userById.get(resolvedReferrerId);
    const fallbackReferralCode = normalizeReferralCode(user.referredByCode);
    const referralSource = resolvedReferrerId
      ? (referrerProfile?.name || fallbackReferralCode || resolvedReferrerId)
      : "Direct";
    const whatsappNumber = resolveBestWhatsapp(user, userBookings);
    const dateAnchorRaw = latestBookingStatus === BOOKING_STATUS.expired
      ? Number(latestBooking?.expiresAtMs || latestBooking?.updatedAtMs || latestBooking?.createdAtMs || 0)
      : Number(
        user.createdAtMs ||
        user.updatedAtMs ||
        latestBooking?.createdAtMs ||
        latestBooking?.updatedAtMs ||
        latestBooking?.expiresAtMs ||
        lastLearningActivityMs ||
        0
      );
    const tableDateMs = Number.isFinite(dateAnchorRaw) && dateAnchorRaw > 0 ? dateAnchorRaw : null;

    const studentBase = {
      ...user,
      whatsappNumber,
      tableDateMs,
      overallProgressPercent,
      completedLessons,
      currentPhaseId,
      currentPhaseLabel: currentPhase ? formatPhaseLabel(currentPhase.phaseId, phasesById) : "Not started",
      currentPhaseTitle: currentPhase?.title || "Not started",
      phaseProgressList,
      bookings: userBookings.map((booking) => ({
        ...booking,
        effectiveStatus: getEffectiveBookingStatus(booking, nowMs),
        phaseLabel: formatPhaseLabel(booking.phaseId, phasesById)
      })),
      lastLearningActivityMs,
      lastActivityMs,
      latestBookingStatus,
      referralSource,
      hasAbandonedBooking,
      isStalledInPhase
    };

    const riskProfile = computeRiskProfile(studentBase, nowMs);
    const student = {
      ...studentBase,
      ...riskProfile,
      featureUnlocks: toFeatureUnlocks(overallProgressPercent)
    };
    student.timeline = buildTimeline(student, referralEventsByUser, userById);
    students.push(student);

    if (lastLearningActivityMs >= todayStartMs) {
      activeToday += 1;
    }
    if (riskProfile.inactiveDays >= INACTIVITY_DAYS_WARNING) {
      inactive7Plus += 1;
    }
    progressSumAcrossUsers += overallProgressPercent;

    if (student.isStalledInPhase) {
      const phaseModel = phaseModelById.get(student.currentPhaseId);
      if (phaseModel) {
        phaseModel.stalledLearners += 1;
      }
    }
  });

  const derivedPhaseSignals = new Map(
    phases.map((phase) => [phase.phaseId, {
      participantCount: 0,
      progressSum: 0,
      completedLearners: 0,
      activeLearners: 0
    }])
  );

  students.forEach((student) => {
    student.phaseProgressList.forEach((phaseProgress) => {
      const derived = derivedPhaseSignals.get(phaseProgress.phaseId);
      if (!derived) {
        return;
      }
      const hasSignal =
        Number(phaseProgress.totalLessons || 0) > 0 ||
        Number(phaseProgress.progressPercent || 0) > 0 ||
        Number(phaseProgress.updatedAtMs || 0) > 0;
      if (!hasSignal) {
        return;
      }
      derived.participantCount += 1;
      derived.progressSum += Number(phaseProgress.progressPercent || 0);
      if (Number(phaseProgress.progressPercent || 0) >= 100) {
        derived.completedLearners += 1;
      }
      if (Number(phaseProgress.updatedAtMs || 0) >= activeWindowStartMs) {
        derived.activeLearners += 1;
      }
    });
  });

  const phaseAnalytics = phases.map((phase) => {
    const model = phaseModelById.get(phase.phaseId);
    const derived = derivedPhaseSignals.get(phase.phaseId);
    const activeLearners = Math.max(model.activeLearners, Number(derived?.activeLearners || 0));
    const completedLearners = Math.max(model.completedLearners, Number(derived?.completedLearners || 0));
    const participantCount = Math.max(model.progressDocCount, Number(derived?.participantCount || 0));
    const progressSum = Math.max(model.progressSum, Number(derived?.progressSum || 0));
    const enrolled = model.enrolledUserIds.size;
    const avgProgress = participantCount > 0 ? progressSum / participantCount : 0;
    const completionBase = enrolled > 0 ? enrolled : participantCount;
    const completionPercent = completionBase > 0 ? (completedLearners / completionBase) * 100 : 0;
    const dropOffPercent = enrolled > 0 ? ((enrolled - activeLearners) / enrolled) * 100 : 0;
    const occupancyPercent = phase.totalSeats > 0 ? (phase.bookedSeats / phase.totalSeats) * 100 : 0;

    return {
      ...phase,
      enrolled,
      activeLearners,
      completedLearners,
      stalledLearners: model.stalledLearners,
      averageProgress: avgProgress,
      completionPercent,
      dropOffPercent: clamp(dropOffPercent, 0, 100),
      pendingRequests: model.pendingRequests,
      occupancyPercent: clamp(occupancyPercent, 0, 100)
    };
  });

  const mostCompletedPhase = phaseAnalytics.slice().sort((a, b) => b.completedLearners - a.completedLearners)[0] || null;
  const leastActivePhase = phaseAnalytics.slice().sort((a, b) => a.activeLearners - b.activeLearners)[0] || null;

  const averageCompletionPercent = users.length > 0 ? progressSumAcrossUsers / users.length : 0;
  const averageVelocityPerDay = students.length > 0
    ? students.reduce((sum, student) => {
      const anchor = Number(student.createdAtMs || student.updatedAtMs || nowMs);
      const elapsedDays = Math.max(1, (nowMs - anchor) / MS_IN_DAY);
      return sum + (student.overallProgressPercent / elapsedDays);
    }, 0) / students.length
    : 0;

  const uniqueApprovedUsers = new Set(
    bookings
      .filter((booking) => getEffectiveBookingStatus(booking, nowMs) === BOOKING_STATUS.approved)
      .map((booking) => booking.userId)
      .filter(Boolean)
  );

  const pendingQueue = bookings.filter((booking) => {
    const status = getEffectiveBookingStatus(booking, nowMs);
    return status === BOOKING_STATUS.pending || status === BOOKING_STATUS.reviewing;
  }).length;

  const reviewingCount = bookings.filter(
    (booking) => getEffectiveBookingStatus(booking, nowMs) === BOOKING_STATUS.reviewing
  ).length;
  const pendingCount = bookings.filter(
    (booking) => getEffectiveBookingStatus(booking, nowMs) === BOOKING_STATUS.pending
  ).length;

  const completionRate = users.length > 0
    ? (students.filter((student) => student.overallProgressPercent >= 100).length / users.length) * 100
    : 0;

  const referralStatsByReferrer = new Map();
  affiliateStats.forEach((stats) => {
    referralStatsByReferrer.set(stats.referrerId, {
      referrerId: stats.referrerId,
      invites: stats.totalInvites,
      conversions: stats.conversions
    });
  });
  referralEventsByReferrer.forEach((events, referrerId) => {
    const existing = referralStatsByReferrer.get(referrerId) || { referrerId, invites: 0, conversions: 0 };
    existing.invites = Math.max(existing.invites, events.length);
    existing.conversions = Math.max(existing.conversions, events.filter((event) => event.isConverted).length);
    referralStatsByReferrer.set(referrerId, existing);
  });

  const referralLeaderboard = Array.from(referralStatsByReferrer.values())
    .map((item) => {
      const referrer = userById.get(item.referrerId);
      return {
        ...item,
        name: referrer?.name || item.referrerId,
        email: referrer?.email || "-"
      };
    })
    .sort((a, b) => {
      if (b.conversions !== a.conversions) {
        return b.conversions - a.conversions;
      }
      return b.invites - a.invites;
    });

  const totalInvites = referralEvents.length;
  const totalConversions = referralEvents.filter((event) => event.isConverted).length;
  const referralConversionRate = totalInvites > 0 ? (totalConversions / totalInvites) * 100 : 0;

  const commissionTotals = affiliateCommissions.reduce((acc, commission) => {
    const amount = Number(commission.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return acc;
    }
    const status = String(commission.status || "pending").toLowerCase();
    if (status === "reversed" || status === "cancelled") {
      return acc;
    }
    acc.total += amount;
    if (status === "paid") {
      acc.paid += amount;
    } else if (status === "pending") {
      acc.pending += amount;
    } else {
      acc.other += amount;
    }
    return acc;
  }, { total: 0, paid: 0, pending: 0, other: 0 });
  const estimatedRevenue = commissionTotals.total;

  const cohorts = phaseAnalytics.map((phase) => ({
    phaseId: phase.phaseId,
    title: phase.title,
    health: phase.activeLearners >= Math.max(1, Math.ceil(phase.enrolled * 0.5)) ? "healthy" : "unhealthy"
  }));

  const learning = {
    activeToday,
    inactive7Plus,
    averageCompletionPercent,
    mostCompletedPhase,
    leastActivePhase,
    averageVelocityPerDay,
    activeByPhase: phaseAnalytics.map((phase) => ({
      phaseId: phase.phaseId,
      label: phase.title,
      activeLearners: phase.activeLearners
    })),
    trend: {
      labels: learningBuckets.map((bucket) => bucket.label),
      activeLearners: learningBuckets.map((bucket) => bucket.userSet.size),
      updates: learningBuckets.map((bucket) => bucket.updates)
    }
  };

  const model = {
    generatedAtMs: nowMs,
    phases,
    phaseAnalytics,
    students,
    pendingQueue,
    learning,
    bookings,
    commissions: {
      totalCount: affiliateCommissions.length,
      totalValue: commissionTotals.total,
      pendingValue: commissionTotals.pending,
      paidValue: commissionTotals.paid,
      otherValue: commissionTotals.other
    },
    referrals: {
      totalInvites,
      totalConversions,
      conversionRate: referralConversionRate,
      leaderboard: referralLeaderboard,
      growth: {
        labels: referralBuckets.map((bucket) => bucket.label),
        joined: referralBuckets.map((bucket) => bucket.joined),
        converted: referralBuckets.map((bucket) => bucket.converted)
      }
    },
    kpis: {
      totalStudents: users.length,
      activeStudents: activeToday,
      pendingBookings: pendingCount,
      reviewingBookings: reviewingCount,
      approvedStudents: uniqueApprovedUsers.size,
      completionRate,
      totalReferrals: totalInvites,
      conversionRate: referralConversionRate,
      estimatedRevenue,
      activeCohorts: cohorts.filter((cohort) => cohort.health === "healthy").length
    },
    cohorts
  };

  model.alerts = buildAlerts(model, previousSignals, nowMs);
  model.runtimeSignals = {
    pendingQueue: model.pendingQueue,
    activeToday: model.learning.activeToday
  };
  model.bookingFunnel = computeBookingFunnel(bookings, options.bookingFilters || { phaseId: "all", days: 0 }, nowMs);
  return model;
}
