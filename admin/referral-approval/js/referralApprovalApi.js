import { callBackendFunction } from "./firebaseClient.js";

export const REFERRAL_APPROVAL_STATUS = {
  all: "all",
  pending: "pending",
  approved: "approved",
  rejected: "rejected"
};

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

function normalizeStatus(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (
    normalized === REFERRAL_APPROVAL_STATUS.all ||
    normalized === REFERRAL_APPROVAL_STATUS.pending ||
    normalized === REFERRAL_APPROVAL_STATUS.approved ||
    normalized === REFERRAL_APPROVAL_STATUS.rejected
  ) {
    return normalized;
  }
  return REFERRAL_APPROVAL_STATUS.all;
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

export function normalizeReferralRequest(raw = {}) {
  return {
    requestId: normalizeString(raw.requestId),
    requesterId: normalizeString(raw.requesterId),
    requesterName: normalizeString(raw.requesterName),
    requesterEmail: normalizeEmail(raw.requesterEmail),
    requesterPhone: normalizeString(raw.requesterPhone || raw.phone || raw.phoneNumber),
    requesterWhatsApp: normalizeString(raw.requesterWhatsApp || raw.whatsapp || raw.whatsappNumber),
    referralCode: normalizeReferralCode(raw.referralCode),
    resolvedReferralCode: normalizeReferralCode(raw.resolvedReferralCode),
    referrerId: normalizeString(raw.referrerId),
    referrerName: normalizeString(raw.referrerName),
    referrerEmail: normalizeEmail(raw.referrerEmail),
    status: normalizeStatus(raw.status),
    source: normalizeString(raw.source) || "web",
    sessionId: normalizeString(raw.sessionId),
    reviewedBy: normalizeString(raw.reviewedBy),
    reviewedByEmail: normalizeEmail(raw.reviewedByEmail),
    reviewReason: normalizeString(raw.reviewReason),
    createdAtMs: normalizeNumber(raw.createdAtMs),
    updatedAtMs: normalizeNumber(raw.updatedAtMs),
    reviewedAtMs: normalizeNumber(raw.reviewedAtMs)
  };
}

function dedupeAndSortRequests(requests = []) {
  const byRequestId = new Map();
  requests.forEach((request) => {
    if (!request?.requestId) {
      return;
    }
    const previous = byRequestId.get(request.requestId);
    if (!previous) {
      byRequestId.set(request.requestId, request);
      return;
    }
    const previousTime = previous.updatedAtMs ?? previous.createdAtMs ?? 0;
    const nextTime = request.updatedAtMs ?? request.createdAtMs ?? 0;
    if (nextTime >= previousTime) {
      byRequestId.set(request.requestId, request);
    }
  });

  return Array.from(byRequestId.values()).sort((left, right) => {
    const leftTime = left.updatedAtMs ?? left.createdAtMs ?? 0;
    const rightTime = right.updatedAtMs ?? right.createdAtMs ?? 0;
    return rightTime - leftTime;
  });
}

export async function listReferralRequests(status = REFERRAL_APPROVAL_STATUS.all) {
  const normalizedStatus = normalizeStatus(status);
  if (normalizedStatus === REFERRAL_APPROVAL_STATUS.all) {
    const statuses = [
      REFERRAL_APPROVAL_STATUS.pending,
      REFERRAL_APPROVAL_STATUS.approved,
      REFERRAL_APPROVAL_STATUS.rejected
    ];
    const responses = await Promise.all(
      statuses.map((itemStatus) => callBackendFunction("listReferralApprovalRequests", { status: itemStatus }))
    );
    const merged = responses.flatMap((response) => (
      Array.isArray(response?.requests) ? response.requests : []
    ));
    return dedupeAndSortRequests(merged.map((item) => normalizeReferralRequest(item)));
  }

  const response = await callBackendFunction("listReferralApprovalRequests", { status: normalizedStatus });
  const requests = Array.isArray(response?.requests) ? response.requests : [];
  return dedupeAndSortRequests(requests.map((item) => normalizeReferralRequest(item)));
}

export async function approveReferralRequest(requestId) {
  return callBackendFunction("reviewReferralApprovalRequest", {
    requestId: normalizeString(requestId),
    decision: REFERRAL_APPROVAL_STATUS.approved
  });
}

export async function rejectReferralRequest(requestId, reason = "") {
  return callBackendFunction("reviewReferralApprovalRequest", {
    requestId: normalizeString(requestId),
    decision: REFERRAL_APPROVAL_STATUS.rejected,
    reason: normalizeString(reason)
  });
}
