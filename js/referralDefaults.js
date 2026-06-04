import { normalizeSuperAdminProfileResponse } from "./superAdminActions.js";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeReferralCode(value) {
  const normalized = normalizeString(value).replace(/[^a-z0-9]/gi, "").toUpperCase();
  return normalized.slice(0, 6);
}

export function resolveDynamicDefaultReferralCode({
  pendingReferralCode = "",
  inputReferralCode = "",
  urlReferralCode = "",
  adminReferralCode = "",
  fallbackReferralCode = ""
} = {}) {
  const candidates = [
    pendingReferralCode,
    inputReferralCode,
    urlReferralCode,
    adminReferralCode,
    fallbackReferralCode
  ];

  for (const candidate of candidates) {
    const normalized = normalizeReferralCode(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

export async function fetchDynamicReferralDefaults(callBackendFunction, fallbackEmails = []) {
  if (typeof callBackendFunction !== "function") {
    throw new Error("callBackendFunction is required.");
  }

  try {
    const profileResponse = await callBackendFunction("getSuperAdminProfile");
    return normalizeSuperAdminProfileResponse(profileResponse || {}, fallbackEmails);
  } catch (error) {
    void error;
  }

  const legacyResponse = await callBackendFunction("getAdminReferralCode");
  return normalizeSuperAdminProfileResponse(legacyResponse || {}, fallbackEmails);
}

