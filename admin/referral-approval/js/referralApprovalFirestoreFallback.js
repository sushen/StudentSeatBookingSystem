import { initializeFirebaseClient } from "./firebaseClient.js";
import { REFERRAL_APPROVAL_STATUS } from "./referralApprovalApi.js";

const SUPER_ADMIN_FALLBACK_EMAILS = [
  "sushen.biswas.aga@gmail.com",
  "sushen.biswas.aga@googlemail.com"
];
const ADMIN_REFERRAL_ALIAS = "ADMIN";

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

function isAdminReferralAlias(referralCode) {
  return normalizeReferralCode(referralCode) === normalizeReferralCode(ADMIN_REFERRAL_ALIAS);
}

function normalizeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value?.toMillis === "function") {
    return value.toMillis();
  }
  if (typeof value === "object" && value && typeof value.seconds === "number") {
    return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000);
  }
  return null;
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

function normalizeName(value) {
  return normalizeString(value);
}

function getPrimaryUserName(data = {}, fallback = "") {
  const profile = (typeof data.profile === "object" && data.profile) ? data.profile : {};
  const contact = (typeof data.contact === "object" && data.contact) ? data.contact : {};
  const auth = (typeof data.auth === "object" && data.auth) ? data.auth : {};
  return normalizeName(
    data.name ||
    data.requesterName ||
    data.referrerName ||
    data.displayName ||
    data.display_name ||
    data.fullName ||
    data.full_name ||
    data.userName ||
    data.username ||
    data.user_name ||
    profile.name ||
    profile.displayName ||
    contact.name ||
    auth.displayName
  ) || fallback;
}

function getPrimaryUserEmail(data = {}) {
  const profile = (typeof data.profile === "object" && data.profile) ? data.profile : {};
  const contact = (typeof data.contact === "object" && data.contact) ? data.contact : {};
  const auth = (typeof data.auth === "object" && data.auth) ? data.auth : {};
  return normalizeEmail(
    data.email ||
    data.userEmail ||
    data.mail ||
    data.requesterEmail ||
    data.referrerEmail ||
    data.authEmail ||
    profile.email ||
    contact.email ||
    auth.email
  );
}

function isUnknownName(value) {
  const normalized = normalizeName(value).toLowerCase();
  return !normalized || normalized === "unknown user" || normalized === "unknown referrer";
}

function isSyntheticReferrerId(value) {
  const normalized = normalizeString(value).toLowerCase();
  return !normalized || normalized === "super-admin" || normalized.startsWith("manual-");
}

function toRequestModel(userDocId, data = {}) {
  const pendingStatus = normalizeStatus(data.pendingReferralStatus);
  const pendingCode = normalizeReferralCode(data.pendingReferralCode || data.pendingReferralLastCode);
  const referrerId = normalizeString(data.pendingReferralReferrerId || data.pendingReferralLastReferrerId);
  const referrerName = normalizeName(
    data.pendingReferralReferrerName ||
    data.pendingReferralLastReferrerName ||
    data.referredByName
  );
  const referrerEmail = normalizeEmail(
    data.pendingReferralReferrerEmail ||
    data.pendingReferralLastReferrerEmail ||
    data.referredByEmail
  );
  return {
    requestId: userDocId,
    requesterId: userDocId,
    requesterName: getPrimaryUserName(data, "Unknown User"),
    requesterEmail: getPrimaryUserEmail(data),
    requesterPhone: normalizeString(data.phoneNumber || data.phone),
    requesterWhatsApp: normalizeString(data.whatsappNumber || data.whatsapp),
    referralCode: pendingCode,
    resolvedReferralCode: pendingCode,
    referrerId,
    referrerName,
    referrerEmail,
    status: pendingStatus,
    source: "firestore-fallback",
    sessionId: "",
    reviewedBy: "",
    reviewedByEmail: "",
    reviewReason: normalizeString(data.pendingReferralReviewReason),
    createdAtMs: normalizeNumber(data.pendingReferralRequestedAtMs) ?? normalizeNumber(data.pendingReferralRequestedAt),
    updatedAtMs: normalizeNumber(data.updatedAtMs) ?? normalizeNumber(data.updatedAt),
    reviewedAtMs: normalizeNumber(data.pendingReferralReviewedAtMs) ?? normalizeNumber(data.pendingReferralReviewedAt)
  };
}

function toUserIdentity(userId, data = {}) {
  const normalizedUserId = normalizeString(userId);
  if (!normalizedUserId) {
    return null;
  }
  return {
    userId: normalizedUserId,
    name: getPrimaryUserName(data, ""),
    email: getPrimaryUserEmail(data),
    referralCode: normalizeReferralCode(data.referralCode)
  };
}

function mergeIdentity(baseIdentity, nextIdentity) {
  if (!baseIdentity) {
    return nextIdentity || null;
  }
  if (!nextIdentity) {
    return baseIdentity;
  }
  return {
    userId: normalizeString(baseIdentity.userId || nextIdentity.userId),
    name: normalizeName(baseIdentity.name || nextIdentity.name),
    email: normalizeEmail(baseIdentity.email || nextIdentity.email),
    referralCode: normalizeReferralCode(baseIdentity.referralCode || nextIdentity.referralCode)
  };
}

function hasUsefulIdentity(identity) {
  if (!identity) {
    return false;
  }
  return Boolean(normalizeName(identity.name) || normalizeEmail(identity.email));
}

async function resolveUserIdentityById(db, firestoreSdk, userId) {
  const { doc, getDoc, collection, query, where, limit, getDocs } = firestoreSdk;
  const normalizedUserId = normalizeString(userId);
  if (!normalizedUserId) {
    return null;
  }
  const docSnap = await getDoc(doc(db, "users", normalizedUserId));
  if (!docSnap.exists()) {
    const candidateFields = ["uid", "userId", "authUid", "firebaseUid"];
    for (const field of candidateFields) {
      try {
        const snapshot = await getDocs(
          query(collection(db, "users"), where(field, "==", normalizedUserId), limit(1))
        );
        if (!snapshot.empty) {
          const matched = snapshot.docs[0];
          return toUserIdentity(matched.id, matched.data() || {});
        }
      } catch (error) {
        void error;
      }
    }
    return null;
  }
  return toUserIdentity(normalizedUserId, docSnap.data() || {});
}

async function resolveUserIdentityFromSignals(db, firestoreSdk, userId) {
  const { collection, query, where, limit, getDocs } = firestoreSdk;
  const normalizedUserId = normalizeString(userId);
  if (!normalizedUserId) {
    return null;
  }

  let name = "";
  let email = "";
  const captureIdentity = (data = {}, role = "user") => {
    if (role === "referrer") {
      if (!name) {
        name = normalizeName(data.referrerName || data.name || data.displayName);
      }
      if (!email) {
        email = normalizeEmail(data.referrerEmail || data.email || data.userEmail);
      }
      return;
    }
    if (!name) {
      name = getPrimaryUserName(data, "");
    }
    if (!email) {
      email = getPrimaryUserEmail(data);
    }
  };

  const querySpecs = [
    { collectionName: "bookings", field: "userId", role: "user" },
    { collectionName: "bookings", field: "uid", role: "user" },
    { collectionName: "referralEvents", field: "userId", role: "user" },
    { collectionName: "referralEvents", field: "referredUserId", role: "user" },
    { collectionName: "referralEvents", field: "referrerId", role: "referrer" }
  ];

  for (const spec of querySpecs) {
    if (name && email) {
      break;
    }
    try {
      const snapshot = await getDocs(
        query(collection(db, spec.collectionName), where(spec.field, "==", normalizedUserId), limit(5))
      );
      snapshot.docs.forEach((docSnap) => {
        captureIdentity(docSnap.data() || {}, spec.role);
      });
    } catch (error) {
      void error;
    }
  }

  if (!name || !email) {
    try {
      const usersSnapshot = await getDocs(query(collection(db, "users"), limit(1000)));
      const linked = usersSnapshot.docs.find((docSnap) => {
        const data = docSnap.data() || {};
        const aliases = [
          normalizeString(data.uid),
          normalizeString(data.userId),
          normalizeString(data.authUid),
          normalizeString(data.firebaseUid)
        ].filter(Boolean);
        return aliases.includes(normalizedUserId);
      });
      if (linked) {
        const data = linked.data() || {};
        if (!name) {
          name = getPrimaryUserName(data, "");
        }
        if (!email) {
          email = getPrimaryUserEmail(data);
        }
      }
    } catch (error) {
      void error;
    }
  }

  if (!name && !email) {
    return null;
  }
  return {
    userId: normalizedUserId,
    name,
    email,
    referralCode: ""
  };
}

async function backfillUserIdentityIfMissing(db, firestoreSdk, userId, fromUsersIdentity, resolvedIdentity) {
  const { doc, setDoc } = firestoreSdk;
  const normalizedUserId = normalizeString(userId);
  if (!normalizedUserId || !resolvedIdentity) {
    return;
  }
  if (!fromUsersIdentity) {
    return;
  }

  const patch = {};
  if (!normalizeName(fromUsersIdentity.name) && normalizeName(resolvedIdentity.name)) {
    patch.name = normalizeName(resolvedIdentity.name);
  }
  if (!normalizeEmail(fromUsersIdentity.email) && normalizeEmail(resolvedIdentity.email)) {
    patch.email = normalizeEmail(resolvedIdentity.email);
  }

  if (!Object.keys(patch).length) {
    return;
  }

  try {
    await setDoc(doc(db, "users", normalizedUserId), patch, { merge: true });
  } catch (error) {
    void error;
  }
}

async function resolveUserIdentityByReferralCode(db, firestoreSdk, referralCode) {
  const { collection, query, where, limit, getDocs } = firestoreSdk;
  const code = normalizeReferralCode(referralCode);
  if (!code) {
    return null;
  }
  const userQuery = query(collection(db, "users"), where("referralCode", "==", code), limit(1));
  const snapshot = await getDocs(userQuery);
  if (snapshot.empty) {
    return null;
  }
  const docSnap = snapshot.docs[0];
  return toUserIdentity(docSnap.id, docSnap.data() || {});
}

async function resolveUserIdentityByReferralCodeScan(db, firestoreSdk, referralCode) {
  const { collection, query, limit, getDocs } = firestoreSdk;
  const code = normalizeReferralCode(referralCode);
  if (!code) {
    return null;
  }
  try {
    const snapshot = await getDocs(query(collection(db, "users"), limit(1000)));
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() || {};
      const candidateCode = normalizeReferralCode(
        data.referralCode ||
        data.referral_code ||
        data.refCode
      );
      if (candidateCode === code) {
        return toUserIdentity(docSnap.id, data);
      }
    }
  } catch (error) {
    void error;
  }
  return null;
}

function toApprovalIdentity(data = {}, role = "requester") {
  const normalizedRole = normalizeString(role).toLowerCase();
  if (normalizedRole === "referrer") {
    return {
      userId: normalizeString(data.referrerId),
      name: normalizeName(data.referrerName),
      email: normalizeEmail(data.referrerEmail),
      referralCode: normalizeReferralCode(data.resolvedReferralCode || data.referralCode)
    };
  }
  return {
    userId: normalizeString(data.requesterId || data.requestId),
    name: normalizeName(data.requesterName),
    email: normalizeEmail(data.requesterEmail),
    referralCode: normalizeReferralCode(data.resolvedReferralCode || data.referralCode)
  };
}

async function resolveIdentityFromApprovalByRequestId(db, firestoreSdk, requestId, role = "requester") {
  const { doc, getDoc } = firestoreSdk;
  const normalizedRequestId = normalizeString(requestId);
  if (!normalizedRequestId) {
    return null;
  }
  try {
    const approvalSnap = await getDoc(doc(db, "referralApprovals", normalizedRequestId));
    if (!approvalSnap.exists()) {
      return null;
    }
    return toApprovalIdentity(approvalSnap.data() || {}, role);
  } catch (error) {
    void error;
    return null;
  }
}

async function resolveReferrerByCode(db, firestoreSdk, referralCode) {
  const { collection, query, where, limit, getDocs } = firestoreSdk;
  const code = normalizeReferralCode(referralCode);
  if (!code) {
    return null;
  }
  const referrerQuery = query(
    collection(db, "users"),
    where("referralCode", "==", code),
    limit(1)
  );
  const snapshot = await getDocs(referrerQuery);
  if (snapshot.empty) {
    return null;
  }
  const docSnap = snapshot.docs[0];
  const data = docSnap.data() || {};
  return {
    referrerId: docSnap.id,
    referrerName: getPrimaryUserName(data, "Unknown Referrer"),
    referrerEmail: getPrimaryUserEmail(data),
    referredByCode: code
  };
}

async function resolveReferrerByUserId(db, firestoreSdk, userId, fallbackCode = "") {
  const { doc, getDoc } = firestoreSdk;
  const referrerId = normalizeString(userId);
  if (!referrerId) {
    return null;
  }

  const docSnap = await getDoc(doc(db, "users", referrerId));
  if (!docSnap.exists()) {
    return null;
  }
  const data = docSnap.data() || {};
  return {
    referrerId,
    referrerName: getPrimaryUserName(data, "Unknown Referrer"),
    referrerEmail: getPrimaryUserEmail(data),
    referredByCode: normalizeReferralCode(data.referralCode || fallbackCode)
  };
}

async function resolveReferrerByEmail(db, firestoreSdk, email, fallbackCode = "") {
  const { collection, query, where, limit, getDocs } = firestoreSdk;
  const referrerEmail = normalizeEmail(email);
  if (!referrerEmail) {
    return null;
  }

  const referrerQuery = query(
    collection(db, "users"),
    where("email", "==", referrerEmail),
    limit(1)
  );
  const snapshot = await getDocs(referrerQuery);
  if (snapshot.empty) {
    return null;
  }

  const docSnap = snapshot.docs[0];
  const data = docSnap.data() || {};
  return {
    referrerId: docSnap.id,
    referrerName: getPrimaryUserName(data, "Unknown Referrer"),
    referrerEmail: getPrimaryUserEmail(data),
    referredByCode: normalizeReferralCode(data.referralCode || fallbackCode)
  };
}

async function resolveSuperAdminReferrer(db, firestoreSdk, fallbackCode = "") {
  for (const email of SUPER_ADMIN_FALLBACK_EMAILS) {
    const resolved = await resolveReferrerByEmail(db, firestoreSdk, email, fallbackCode);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

async function resolveReferrerForApproval(db, firestoreSdk, request, referralCode) {
  const candidates = [];
  const normalizedApprovalCode = normalizeReferralCode(referralCode);
  const allowSuperAdminFallback = isAdminReferralAlias(normalizedApprovalCode);

  const fromUserId = await resolveReferrerByUserId(
    db,
    firestoreSdk,
    request?.referrerId,
    referralCode
  );
  if (fromUserId) {
    candidates.push(fromUserId);
  }

  const fromEmail = await resolveReferrerByEmail(
    db,
    firestoreSdk,
    request?.referrerEmail,
    referralCode
  );
  if (fromEmail) {
    candidates.push(fromEmail);
  }

  const fromCode = await resolveReferrerByCode(db, firestoreSdk, referralCode);
  if (fromCode) {
    candidates.push(fromCode);
  }

  if (allowSuperAdminFallback) {
    const fromSuperAdmin = await resolveSuperAdminReferrer(db, firestoreSdk, referralCode);
    if (fromSuperAdmin) {
      candidates.push(fromSuperAdmin);
    }
  }

  const selected = candidates.find(Boolean) || null;
  if (selected && !selected.referredByCode) {
    selected.referredByCode = referralCode;
  }
  return selected;
}

export async function listReferralRequestsFromUsers(status = REFERRAL_APPROVAL_STATUS.pending) {
  const { db, firestoreSdk } = await initializeFirebaseClient();
  const { collection, query, where, limit, getDocs } = firestoreSdk;
  const statusFilter = normalizeStatus(status);

  let snapshot = null;
  if (statusFilter === REFERRAL_APPROVAL_STATUS.all) {
    try {
      const usersQuery = query(
        collection(db, "users"),
        where("pendingReferralStatus", "in", [
          REFERRAL_APPROVAL_STATUS.pending,
          REFERRAL_APPROVAL_STATUS.approved,
          REFERRAL_APPROVAL_STATUS.rejected
        ]),
        limit(350)
      );
      snapshot = await getDocs(usersQuery);
    } catch (error) {
      void error;
      const usersQuery = query(collection(db, "users"), limit(350));
      snapshot = await getDocs(usersQuery);
    }
  } else {
    const usersQuery = query(
      collection(db, "users"),
      where("pendingReferralStatus", "==", statusFilter),
      limit(250)
    );
    snapshot = await getDocs(usersQuery);
  }

  const requests = snapshot.docs
    .map((docSnap) => toRequestModel(docSnap.id, docSnap.data() || {}))
    .filter((request) => {
      if (statusFilter === REFERRAL_APPROVAL_STATUS.all) {
        return (
          request.status === REFERRAL_APPROVAL_STATUS.pending ||
          request.status === REFERRAL_APPROVAL_STATUS.approved ||
          request.status === REFERRAL_APPROVAL_STATUS.rejected
        );
      }
      return request.status === statusFilter;
    });

  const userIdentityById = new Map();
  const userIdentityByReferralCode = new Map();

  async function loadUserIdentityById(userId) {
    const normalizedUserId = normalizeString(userId);
    if (!normalizedUserId) {
      return null;
    }
    if (userIdentityById.has(normalizedUserId)) {
      return userIdentityById.get(normalizedUserId);
    }
    const fromUsers = await resolveUserIdentityById(db, firestoreSdk, normalizedUserId);
    const fromSignals = await resolveUserIdentityFromSignals(db, firestoreSdk, normalizedUserId);
    const fromApproval = await resolveIdentityFromApprovalByRequestId(
      db,
      firestoreSdk,
      normalizedUserId,
      "requester"
    );
    let identity = mergeIdentity(fromUsers, fromSignals);
    identity = mergeIdentity(identity, fromApproval);
    if (!hasUsefulIdentity(identity)) {
      identity = null;
    } else {
      await backfillUserIdentityIfMissing(db, firestoreSdk, normalizedUserId, fromUsers, identity);
    }
    userIdentityById.set(normalizedUserId, identity || null);
    return identity;
  }

  async function loadUserIdentityByReferralCode(referralCode) {
    const normalizedCode = normalizeReferralCode(referralCode);
    if (!normalizedCode) {
      return null;
    }
    if (userIdentityByReferralCode.has(normalizedCode)) {
      return userIdentityByReferralCode.get(normalizedCode);
    }
    let identity = await resolveUserIdentityByReferralCode(db, firestoreSdk, normalizedCode);
    if (!hasUsefulIdentity(identity)) {
      const fromScan = await resolveUserIdentityByReferralCodeScan(db, firestoreSdk, normalizedCode);
      identity = mergeIdentity(identity, fromScan);
    }
    userIdentityByReferralCode.set(normalizedCode, identity);
    return identity;
  }

  await Promise.all(
    requests.map(async (request, index) => {
      const nextRequest = { ...request };
      const requesterId = normalizeString(nextRequest.requesterId || nextRequest.requestId);
      if ((isUnknownName(nextRequest.requesterName) || !nextRequest.requesterEmail) && requesterId) {
        const requesterIdentity = await loadUserIdentityById(requesterId);
        if (requesterIdentity) {
          if (isUnknownName(nextRequest.requesterName) && requesterIdentity.name) {
            nextRequest.requesterName = requesterIdentity.name;
          }
          if (!nextRequest.requesterEmail && requesterIdentity.email) {
            nextRequest.requesterEmail = requesterIdentity.email;
          }
        }
      }

      if (isUnknownName(nextRequest.referrerName) || !nextRequest.referrerEmail) {
        let referrerIdentity = null;
        if (!isSyntheticReferrerId(nextRequest.referrerId)) {
          referrerIdentity = await loadUserIdentityById(nextRequest.referrerId);
        }
        if (!referrerIdentity) {
          const fromApproval = await resolveIdentityFromApprovalByRequestId(
            db,
            firestoreSdk,
            nextRequest.requestId,
            "referrer"
          );
          referrerIdentity = mergeIdentity(referrerIdentity, fromApproval);
        }
        if (!referrerIdentity) {
          const referrerCode = normalizeReferralCode(nextRequest.resolvedReferralCode || nextRequest.referralCode);
          if (referrerCode) {
            referrerIdentity = await loadUserIdentityByReferralCode(referrerCode);
          }
        }
        if (referrerIdentity) {
          if (isUnknownName(nextRequest.referrerName) && referrerIdentity.name) {
            nextRequest.referrerName = referrerIdentity.name;
          }
          if (!nextRequest.referrerEmail && referrerIdentity.email) {
            nextRequest.referrerEmail = referrerIdentity.email;
          }
          if (isSyntheticReferrerId(nextRequest.referrerId) && referrerIdentity.userId) {
            nextRequest.referrerId = referrerIdentity.userId;
          }
        }
      }

      requests[index] = nextRequest;
    })
  );

  return requests.sort((left, right) => {
    const leftTime = left.updatedAtMs ?? left.createdAtMs ?? 0;
    const rightTime = right.updatedAtMs ?? right.createdAtMs ?? 0;
    return rightTime - leftTime;
  });
}

export async function approveReferralRequestInUsers(request) {
  const { db, firestoreSdk } = await initializeFirebaseClient();
  const { doc, setDoc, serverTimestamp, deleteField, collection, query, where, getDocs } = firestoreSdk;
  const requestId = normalizeString(request?.requestId || request?.requesterId);
  const referralCode = normalizeReferralCode(request?.resolvedReferralCode || request?.referralCode);
  const isAdminAlias = isAdminReferralAlias(referralCode);
  if (!requestId || !referralCode) {
    throw new Error("Invalid pending referral request.");
  }

  const resolvedReferrer = await resolveReferrerForApproval(db, firestoreSdk, request, referralCode);
  if (!resolvedReferrer && isAdminAlias) {
    throw new Error(`Referrer not found for code ${referralCode}. Add/create that referrer account first.`);
  }
  if (resolvedReferrer && resolvedReferrer.referrerId === requestId) {
    throw new Error("User cannot use own referral code.");
  }

  const finalReferrerId = normalizeString(resolvedReferrer?.referrerId || request?.referrerId);
  const finalReferrerName = normalizeString(resolvedReferrer?.referrerName || request?.referrerName || "");
  const finalReferrerEmail = normalizeEmail(resolvedReferrer?.referrerEmail || request?.referrerEmail);
  const finalReferredByCode = referralCode;
  const finalLastReferrerId = finalReferrerId || (isAdminAlias ? "super-admin" : `manual-${finalReferredByCode}`);

  const userRef = doc(db, "users", requestId);
  await setDoc(userRef, {
    referredBy: finalReferrerId || finalLastReferrerId,
    referredByName: finalReferrerName,
    referredByEmail: finalReferrerEmail,
    referredByCode: finalReferredByCode,
    pendingReferralStatus: REFERRAL_APPROVAL_STATUS.approved,
    pendingReferralLastCode: finalReferredByCode,
    pendingReferralLastReferrerId: finalLastReferrerId,
    pendingReferralLastReferrerName: finalReferrerName,
    pendingReferralLastReferrerEmail: finalReferrerEmail,
    pendingReferralCode: deleteField(),
    pendingReferralReferrerId: deleteField(),
    pendingReferralReferrerName: deleteField(),
    pendingReferralReferrerEmail: deleteField(),
    pendingReferralRequestId: deleteField(),
    pendingReferralRequestedAt: deleteField(),
    pendingReferralRequestedAtMs: deleteField(),
    pendingReferralReviewedAt: serverTimestamp(),
    pendingReferralReviewedAtMs: Date.now(),
    pendingReferralReviewReason: deleteField(),
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now()
  }, { merge: true });

  // Fallback mode cannot reliably write backend-authoritative affiliate collections in strict rules.
  // Keep profile counters usable by updating aggregate fields on the referrer user document.
  if (finalReferrerId && !isSyntheticReferrerId(finalReferrerId) && finalReferredByCode) {
    try {
      const [referredUsersSnapshot, legacyReferredUsersSnapshot] = await Promise.all([
        getDocs(query(collection(db, "users"), where("referredByCode", "==", finalReferredByCode))),
        getDocs(query(collection(db, "users"), where("referredBy", "==", finalReferredByCode)))
      ]);

      const matchedUsersById = new Map();
      referredUsersSnapshot.forEach((docSnap) => {
        matchedUsersById.set(docSnap.id, docSnap);
      });
      legacyReferredUsersSnapshot.forEach((docSnap) => {
        matchedUsersById.set(docSnap.id, docSnap);
      });

      const nowMs = Date.now();
      let totalInvites = 0;
      let conversions = 0;
      const legacyNormalizationWrites = [];
      matchedUsersById.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const referredBy = normalizeString(data.referredBy);
        const referredByCode = normalizeReferralCode(data.referredByCode);
        const legacyReferredByCode = normalizeReferralCode(referredBy);
        const hasReferral = Boolean(
          referredBy ||
          referredByCode ||
          legacyReferredByCode
        );
        if (!hasReferral) {
          return;
        }

        const matchedByCode = (
          referredByCode === finalReferredByCode ||
          legacyReferredByCode === finalReferredByCode
        );
        if (!matchedByCode) {
          return;
        }

        totalInvites += 1;
        const pendingStatus = normalizeStatus(data.pendingReferralStatus);
        if (pendingStatus !== REFERRAL_APPROVAL_STATUS.pending) {
          conversions += 1;
        }

        if (legacyReferredByCode === finalReferredByCode && referredBy !== finalReferrerId) {
          legacyNormalizationWrites.push(
            setDoc(doc(db, "users", docSnap.id), {
              referredBy: finalReferrerId,
              referredByCode: finalReferredByCode,
              updatedAt: serverTimestamp(),
              updatedAtMs: nowMs
            }, { merge: true })
          );
        }
      });

      if (legacyNormalizationWrites.length) {
        await Promise.all(legacyNormalizationWrites);
      }

      await setDoc(doc(db, "users", finalReferrerId), {
        totalInvites,
        invites: totalInvites,
        conversions,
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now()
      }, { merge: true });
    } catch (error) {
      void error;
    }
  }

  return {
    ok: true,
    status: REFERRAL_APPROVAL_STATUS.approved,
    requestId,
    referredBy: finalReferrerId || finalLastReferrerId,
    referredByCode: finalReferredByCode
  };
}

export async function applyReferralCodeFromRequestInUsers(request) {
  // Reuse approval logic to force-correct a reviewed row to its stored referral code.
  return approveReferralRequestInUsers(request);
}

export async function rejectToAdminReferralInUsers(request, reason = "") {
  const { db, firestoreSdk } = await initializeFirebaseClient();
  const { doc, setDoc, serverTimestamp, deleteField } = firestoreSdk;
  const requestId = normalizeString(request?.requestId || request?.requesterId);
  if (!requestId) {
    throw new Error("Invalid pending referral request.");
  }

  const resolvedAdminReferrer = await resolveSuperAdminReferrer(
    db,
    firestoreSdk,
    ADMIN_REFERRAL_ALIAS
  );

  const fallbackCode = normalizeReferralCode(
    resolvedAdminReferrer?.referredByCode || ADMIN_REFERRAL_ALIAS
  );
  const fallbackReferrerId = normalizeString(resolvedAdminReferrer?.referrerId || "super-admin");
  const fallbackReferrerName = normalizeString(resolvedAdminReferrer?.referrerName || "Super Admin");
  const fallbackReferrerEmail = normalizeEmail(resolvedAdminReferrer?.referrerEmail);
  const reviewReason = normalizeString(reason).slice(0, 300) || "Rejected; fallback to admin referral code.";

  await setDoc(doc(db, "users", requestId), {
    referredBy: fallbackReferrerId,
    referredByName: fallbackReferrerName,
    referredByEmail: fallbackReferrerEmail,
    referredByCode: fallbackCode,
    pendingReferralStatus: REFERRAL_APPROVAL_STATUS.rejected,
    pendingReferralLastCode: fallbackCode,
    pendingReferralLastReferrerId: fallbackReferrerId,
    pendingReferralLastReferrerName: fallbackReferrerName,
    pendingReferralLastReferrerEmail: fallbackReferrerEmail,
    pendingReferralCode: deleteField(),
    pendingReferralReferrerId: deleteField(),
    pendingReferralReferrerName: deleteField(),
    pendingReferralReferrerEmail: deleteField(),
    pendingReferralRequestId: deleteField(),
    pendingReferralRequestedAt: deleteField(),
    pendingReferralRequestedAtMs: deleteField(),
    pendingReferralReviewedAt: serverTimestamp(),
    pendingReferralReviewedAtMs: Date.now(),
    pendingReferralReviewReason: reviewReason,
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now()
  }, { merge: true });

  return {
    ok: true,
    status: REFERRAL_APPROVAL_STATUS.rejected,
    requestId,
    referredByCode: fallbackCode,
    referredBy: fallbackReferrerId
  };
}

export async function rejectReferralRequestInUsers(request, reason = "") {
  const { db, firestoreSdk } = await initializeFirebaseClient();
  const { doc, setDoc, serverTimestamp, deleteField } = firestoreSdk;
  const requestId = normalizeString(request?.requestId || request?.requesterId);
  if (!requestId) {
    throw new Error("Invalid pending referral request.");
  }

  await setDoc(doc(db, "users", requestId), {
    pendingReferralStatus: REFERRAL_APPROVAL_STATUS.rejected,
    pendingReferralLastCode: normalizeReferralCode(request?.resolvedReferralCode || request?.referralCode),
    pendingReferralLastReferrerId: normalizeString(request?.referrerId),
    pendingReferralLastReferrerName: normalizeString(request?.referrerName),
    pendingReferralLastReferrerEmail: normalizeEmail(request?.referrerEmail),
    pendingReferralCode: deleteField(),
    pendingReferralReferrerId: deleteField(),
    pendingReferralReferrerName: deleteField(),
    pendingReferralReferrerEmail: deleteField(),
    pendingReferralRequestId: deleteField(),
    pendingReferralRequestedAt: deleteField(),
    pendingReferralRequestedAtMs: deleteField(),
    pendingReferralReviewedAt: serverTimestamp(),
    pendingReferralReviewedAtMs: Date.now(),
    pendingReferralReviewReason: normalizeString(reason).slice(0, 300) || null,
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now()
  }, { merge: true });

  return {
    ok: true,
    status: REFERRAL_APPROVAL_STATUS.rejected,
    requestId
  };
}
