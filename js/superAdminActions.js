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

function normalizeEmailList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const uniqueEmails = new Set(
    values
      .map((value) => normalizeEmail(value))
      .filter(Boolean)
  );
  return Array.from(uniqueEmails);
}

export function normalizeSuperAdminProfileResponse(rawProfile = {}, fallbackEmails = []) {
  const fallbackList = normalizeEmailList(fallbackEmails);
  const configuredList = normalizeEmailList(rawProfile.superAdminEmails);
  const primaryEmail = normalizeEmail(rawProfile.superAdminEmail || rawProfile.adminEmail);

  const merged = new Set(configuredList.length ? configuredList : fallbackList);
  if (primaryEmail) {
    merged.add(primaryEmail);
  }
  const superAdminEmails = Array.from(merged);

  return {
    superAdminEmail: primaryEmail || superAdminEmails[0] || "",
    superAdminEmails,
    referralCode: normalizeReferralCode(rawProfile.referralCode)
  };
}

export function isSuperAdminUser(email, superAdminEmails = []) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return false;
  }
  const list = normalizeEmailList(superAdminEmails);
  return list.includes(normalizedEmail);
}

