import {
  buildAndroidOpenInBrowserUrl,
  detectInAppBrowserEnvironment,
  getInAppBrowserInstructions
} from "./inAppBrowserDetection.js";
import {
  clearSoundAnnouncementHistory,
  initializeSoundEngine,
  registerSoundEngineUserInteraction,
  setSoundEngineAdminMode,
  speakNotification,
  speakNotificationOnce
} from "./sound-engine/soundEngine.js";
import { findNewPendingBookingEvents } from "./sound-engine/bookingNotificationUtils.js";

// TODO: Replace with your Firebase web app config if needed.
// Firebase Console -> Project Settings -> General -> Your apps -> SDK setup and configuration
const firebaseConfig = {
  apiKey: "AIzaSyAjeXX12GP2CJJk-vuwG_otllf_rbDbbWs",
  authDomain: "shaplachottor-5295e.firebaseapp.com",
  projectId: "shaplachottor-5295e",
  storageBucket: "shaplachottor-5295e.firebasestorage.app",
  messagingSenderId: "68593164378"
  // appId: "1:68593164378:web:YOUR_WEB_APP_ID"
};

const ADMIN_EMAIL = "sushen.biswas.aga@gmail.com";
const ADMIN_EMAIL_ALIASES = new Set([
  "sushen.biswas.aga@gmail.com",
  "sushen.biswas.aga@googlemail.com"
]);
const BOOKING_EXPIRY_MS = 15 * 60 * 1000;

const BOOKING_STATUS_PENDING = "pending";
const BOOKING_STATUS_APPROVED = "approved";
const BOOKING_STATUS_REJECTED = "rejected";
const BOOKING_STATUS_CANCELLED = "cancelled";
const BOOKING_STATUS_EXPIRED = "expired";

const PHASE_STATE_LOCKED = "LOCKED";
const PHASE_STATE_PENDING = "PENDING";
const PHASE_STATE_UNLOCKED = "UNLOCKED";

const PHASE_TRACK_BEGINNER = "beginner";
const PHASE_TRACK_INTERMEDIATE = "intermediate";
const PHASE_TRACK_ADVANCED = "advanced";

const DEFAULT_TOTAL_SEATS = 100;

const CANONICAL_PHASES = [
  {
    phaseId: "phase1",
    title: "Foundations",
    description: "Learn core programming fundamentals required for all future phases.",
    level: "Beginner",
    order: 1,
    totalSeats: DEFAULT_TOTAL_SEATS,
    bookedSeats: 0
  },
  {
    phaseId: "phase2",
    title: "Data Analysis",
    description: "Master practical data analysis techniques for AI and trading workflows.",
    level: "Beginner",
    order: 2,
    totalSeats: DEFAULT_TOTAL_SEATS,
    bookedSeats: 0
  },
  {
    phaseId: "phase3",
    title: "Object-Oriented Programming",
    description: "Build reusable systems and strong architecture using OOP principles.",
    level: "Intermediate",
    order: 3,
    totalSeats: DEFAULT_TOTAL_SEATS,
    bookedSeats: 0
  },
  {
    phaseId: "phase4",
    title: "System Design",
    description: "Design scalable services and robust backend flows for production systems.",
    level: "Intermediate",
    order: 4,
    totalSeats: DEFAULT_TOTAL_SEATS,
    bookedSeats: 0
  },
  {
    phaseId: "phase5",
    title: "Simulation & Data Systems",
    description: "Build simulation pipelines and data systems for model-backed decisions.",
    level: "Advanced",
    order: 5,
    totalSeats: DEFAULT_TOTAL_SEATS,
    bookedSeats: 0
  },
  {
    phaseId: "phase6",
    title: "Production Engineering",
    description: "Ship production-grade AI workflows with reliability and monitoring.",
    level: "Advanced",
    order: 6,
    totalSeats: DEFAULT_TOTAL_SEATS,
    bookedSeats: 0
  }
];

const CANONICAL_PHASE_BY_ID = new Map(CANONICAL_PHASES.map((phase) => [phase.phaseId, phase]));

const LEGACY_PHASE_ID_MAP = new Map([
  ["phase_1", "phase1"],
  ["phase_2", "phase2"],
  ["phase_3", "phase3"],
  ["phase_4", "phase4"],
  ["phase_5", "phase5"],
  ["phase_6", "phase6"]
]);

const CANONICAL_TO_LEGACY_PHASE_ID_MAP = new Map(
  Array.from(LEGACY_PHASE_ID_MAP.entries()).map(([legacyPhaseId, canonicalPhaseId]) => [canonicalPhaseId, legacyPhaseId])
);

let auth = null;
let db = null;
let provider = null;

let onAuthStateChangedFn = null;
let signInWithPopupFn = null;
let signInWithRedirectFn = null;
let getRedirectResultFn = null;
let signOutFn = null;

let collectionFn = null;
let queryFn = null;
let whereFn = null;
let onSnapshotFn = null;
let runTransactionFn = null;
let docFn = null;
let setDocFn = null;
let serverTimestampFn = null;
let arrayUnionFn = null;
let arrayRemoveFn = null;
let timestampClass = null;

const elements = {
  phaseFilterButtons: Array.from(document.querySelectorAll("[data-phase-filter]")),
  phaseList: document.getElementById("phaseList"),
  messageBox: document.getElementById("messageBox"),
  loginBtn: document.getElementById("loginBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  profileCard: document.getElementById("profileCard"),
  profileName: document.getElementById("profileName"),
  profileEmail: document.getElementById("profileEmail"),
  profilePhoneNumber: document.getElementById("profilePhoneNumber"),
  profileWhatsapp: document.getElementById("profileWhatsapp"),
  adminChip: document.getElementById("adminChip"),
  loginModal: document.getElementById("loginModal"),
  loginModalBtn: document.getElementById("loginModalBtn"),
  loginModalCloseBtn: document.getElementById("loginModalCloseBtn"),
  inAppModal: document.getElementById("inAppModal"),
  inAppDetected: document.getElementById("inAppDetected"),
  inAppAndroidSteps: document.getElementById("inAppAndroidSteps"),
  inAppIosSteps: document.getElementById("inAppIosSteps"),
  openBrowserBtn: document.getElementById("openBrowserBtn"),
  copyLinkBtn: document.getElementById("copyLinkBtn"),
  inAppCloseBtn: document.getElementById("inAppCloseBtn"),
  phoneModal: document.getElementById("phoneModal"),
  phoneTitle: document.getElementById("phoneTitle"),
  phoneForm: document.getElementById("phoneForm"),
  phoneNumberInput: document.getElementById("phoneNumberInput"),
  whatsappInput: document.getElementById("whatsappInput"),
  phoneSubmitBtn: document.getElementById("phoneSubmitBtn"),
  phoneCancelBtn: document.getElementById("phoneCancelBtn"),
  speechTestBtn: document.getElementById("speechTestBtn"),
  adminPanel: document.getElementById("adminPanel"),
  adminTabButtons: Array.from(document.querySelectorAll("[data-admin-tab]")),
  adminRows: document.getElementById("adminRows"),
  adminEmpty: document.getElementById("adminEmpty")
};

const state = {
  user: null,
  profile: null,
  userDocExists: false,
  pendingPhaseId: null,
  phases: buildFallbackPhaseList(),
  userBookingsByPhaseId: new Map(),
  selectedPhaseTrack: PHASE_TRACK_BEGINNER,
  adminPendingBookings: [],
  adminAllBookings: [],
  selectedAdminTab: "pending",
  firebaseReady: false,
  phasesUnsubscribe: null,
  userBookingsUnsubscribe: null,
  userDocUnsubscribe: null,
  adminBookingsUnsubscribe: null,
  isAdmin: false,
  hasLoadedPhases: false,
  hasLoadedAdminBookings: false,
  hasShownSoundUnlockHint: false,
  hasPromptedForContact: false,
  browserEnvironment: detectInAppBrowserEnvironment()
};

function showMessage(text, type = "info") {
  elements.messageBox.textContent = text;
  elements.messageBox.className = `message ${type}`;
}

function isGoogleLoginBlockedInCurrentBrowser() {
  return Boolean(state.browserEnvironment?.shouldBlockGoogleAuth);
}

function showInAppModal() {
  elements.inAppModal.classList.remove("hidden");
}

function hideInAppModal() {
  elements.inAppModal.classList.add("hidden");
}

function populateInstructionList(listElement, items) {
  listElement.innerHTML = "";
  items.forEach((item) => {
    const listItem = document.createElement("li");
    listItem.textContent = item;
    listElement.appendChild(listItem);
  });
}

function renderInAppBrowserGuidance() {
  const browserContext = state.browserEnvironment || detectInAppBrowserEnvironment();
  const instructions = getInAppBrowserInstructions();

  populateInstructionList(elements.inAppAndroidSteps, instructions.android);
  populateInstructionList(elements.inAppIosSteps, instructions.ios);

  if (browserContext.classification === "blocked") {
    elements.inAppDetected.textContent = `Detected: ${browserContext.detectedApp}. Google sign-in is disabled here.`;
  } else if (browserContext.classification === "uncertain") {
    elements.inAppDetected.textContent = "This may be an embedded browser. If login fails, open this page in Chrome or Safari.";
  } else {
    elements.inAppDetected.textContent = "Use a full browser like Chrome, Safari, Firefox, or Edge for sign-in.";
  }

  const isAndroid = browserContext.platform === "android";
  elements.openBrowserBtn.classList.toggle("hidden", !isAndroid);
}

function fallbackCopyText(value) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  try {
    textarea.select();
    return document.execCommand("copy");
  } catch (error) {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

async function copyCurrentPageLink() {
  const url = window.location.href;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(url);
      showMessage("Link copied. Open it in Chrome or Safari.", "success");
      return;
    }

    if (fallbackCopyText(url)) {
      showMessage("Link copied. Open it in Chrome or Safari.", "success");
      return;
    }

    showMessage("Unable to copy automatically. Please copy the URL manually.", "info");
  } catch (error) {
    if (fallbackCopyText(url)) {
      showMessage("Link copied. Open it in Chrome or Safari.", "success");
    } else {
      showMessage("Unable to copy automatically. Please copy the URL manually.", "info");
    }
  }
}

function openCurrentPageInBrowser() {
  const currentUrl = window.location.href;
  const androidIntentUrl = buildAndroidOpenInBrowserUrl(currentUrl);

  // Best-effort Android handoff. Some in-app browsers ignore this intent URL.
  if (androidIntentUrl) {
    window.location.href = androidIntentUrl;
    window.setTimeout(() => {
      showMessage("If this did not open Chrome, tap Copy Link and open it manually.", "info");
    }, 700);
    return;
  }

  const popupWindow = window.open(currentUrl, "_blank", "noopener,noreferrer");
  if (!popupWindow) {
    showMessage("Unable to open an external browser automatically. Tap Copy Link.", "info");
  }
}

function openLoginFlow() {
  if (isGoogleLoginBlockedInCurrentBrowser()) {
    hideLoginModal();
    showInAppModal();
    showMessage("Google sign-in is not supported in this in-app browser. Open this page in Chrome or Safari.", "error");
    return;
  }

  showLoginModal();
}

function applyBrowserEnvironmentGuard() {
  // Google OAuth must not run in blocked embedded browsers.
  state.browserEnvironment = detectInAppBrowserEnvironment();
  renderInAppBrowserGuidance();

  if (state.browserEnvironment.shouldBlockGoogleAuth) {
    showInAppModal();
    showMessage("Google sign-in is disabled in this embedded browser. Open this page in a full browser.", "error");
    return;
  }

  if (state.browserEnvironment.isUncertain) {
    showMessage("This might be an embedded browser. If login fails, open this page in Chrome or Safari.", "info");
  }
}

function isPermissionDeniedError(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "permission-denied" || message.includes("missing or insufficient permissions");
}

function getLoginErrorMessage(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  const loweredMessage = message.toLowerCase();

  if (code === "auth/unauthorized-domain") {
    const host = window.location.hostname || "your domain";
    return `Login blocked: ${host} is not authorized in Firebase Auth. Add "${host}" in Firebase Console -> Authentication -> Settings -> Authorized domains.`;
  }
  if (code === "auth/popup-closed-by-user") {
    return "Login cancelled: the Google popup was closed before sign-in completed.";
  }
  if (code === "auth/popup-blocked") {
    return "Login blocked by the browser. Allow popups for this site and try again.";
  }
  if (code === "auth/operation-not-allowed") {
    return "Google sign-in is disabled in Firebase Authentication. Enable Google provider and try again.";
  }
  if (code === "auth/operation-not-supported-in-this-environment" || code === "auth/web-storage-unsupported") {
    return "This browser environment does not support Google login storage. Open this page in a full browser.";
  }
  if (code === "auth/network-request-failed") {
    return "Network error during login. Check internet connection and try again.";
  }
  if (loweredMessage.includes("disallowed_useragent")) {
    return "Google sign-in is blocked inside this in-app browser. Open this page in Chrome or Safari.";
  }
  if (loweredMessage.includes("third-party") && loweredMessage.includes("cookie")) {
    return "Google login failed because third-party cookies/storage are blocked. Allow cookies or use a standard browser profile.";
  }
  if (message) {
    return `Login failed: ${message}`;
  }
  return "Login failed. Please try again.";
}

function makeAppError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function timestampToMillis(value) {
  if (!value) {
    return null;
  }
  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value.seconds === "number") {
    return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000);
  }
  return null;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value) {
  return normalizeString(value).toLowerCase();
}

function isAdminEmail(value) {
  const normalizedEmail = normalizeEmail(value);
  if (!normalizedEmail) {
    return false;
  }

  if (ADMIN_EMAIL_ALIASES.has(normalizedEmail)) {
    return true;
  }

  return normalizedEmail === normalizeEmail(ADMIN_EMAIL);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const uniqueValues = new Set(
    value
      .map((item) => normalizeString(item))
      .filter((item) => Boolean(item))
  );
  return Array.from(uniqueValues);
}

function canonicalizePhaseId(rawPhaseId) {
  const normalized = normalizeString(rawPhaseId).toLowerCase();
  if (!normalized) {
    return "";
  }

  const legacyMappedPhaseId = LEGACY_PHASE_ID_MAP.get(normalized);
  if (legacyMappedPhaseId) {
    return legacyMappedPhaseId;
  }

  if (CANONICAL_PHASE_BY_ID.has(normalized)) {
    return normalized;
  }

  return normalized;
}

function getLegacyPhaseIdForCanonical(canonicalPhaseId) {
  return CANONICAL_TO_LEGACY_PHASE_ID_MAP.get(canonicalizePhaseId(canonicalPhaseId)) || null;
}

function toTrackName(rawLevel) {
  const lowered = normalizeString(rawLevel).toLowerCase();
  if (lowered === PHASE_TRACK_BEGINNER || lowered === PHASE_TRACK_INTERMEDIATE || lowered === PHASE_TRACK_ADVANCED) {
    return lowered;
  }
  return PHASE_TRACK_BEGINNER;
}

function getCanonicalPhaseById(phaseId) {
  const canonicalPhaseId = canonicalizePhaseId(phaseId);
  const canonical = CANONICAL_PHASE_BY_ID.get(canonicalPhaseId) || null;
  if (!canonical) {
    return null;
  }
  return { ...canonical };
}

function buildFallbackPhaseList() {
  return CANONICAL_PHASES.map((phase) => ({ ...phase }));
}

function mergeWithCanonicalPhases(phasesFromFirestore) {
  const mergedById = new Map(buildFallbackPhaseList().map((phase) => [phase.phaseId, phase]));

  phasesFromFirestore.forEach((phase) => {
    const canonicalPhaseId = canonicalizePhaseId(phase.phaseId);
    const existing = mergedById.get(canonicalPhaseId);
    if (!existing) {
      mergedById.set(canonicalPhaseId, { ...phase, phaseId: canonicalPhaseId });
      return;
    }

    mergedById.set(canonicalPhaseId, {
      ...existing,
      ...phase,
      phaseId: canonicalPhaseId,
      title: phase.title || existing.title,
      description: phase.description || existing.description,
      level: phase.level || existing.level,
      order: Number.isFinite(phase.order) ? phase.order : existing.order,
      totalSeats: Number.isFinite(phase.totalSeats) ? phase.totalSeats : existing.totalSeats,
      bookedSeats: Number.isFinite(phase.bookedSeats) ? phase.bookedSeats : existing.bookedSeats
    });
  });

  return sortPhaseList(Array.from(mergedById.values()));
}

function normalizeUserProfile(authUser, data = {}) {
  const phoneFromDoc = normalizeString(data.phone);
  const phoneNumber = normalizeString(data.phoneNumber) || phoneFromDoc;
  const whatsappNumber = normalizeString(data.whatsappNumber) || phoneFromDoc;
  const unlockedPhases = Array.from(
    new Set(normalizeStringArray(data.unlockedPhases).map(canonicalizePhaseId).filter(Boolean))
  );
  const completedPhases = Array.from(
    new Set(normalizeStringArray(data.completedPhases).map(canonicalizePhaseId).filter(Boolean))
  );

  return {
    name: normalizeString(data.name) || authUser?.displayName || "Unknown User",
    email: normalizeString(data.email) || authUser?.email || "",
    phone: phoneFromDoc || whatsappNumber || "",
    phoneNumber,
    whatsappNumber,
    progress: typeof data.progress === "number" ? data.progress : 0,
    unlockedPhases,
    completedPhases
  };
}

function normalizePhaseDoc(docId, data = {}) {
  const rawPhaseId = normalizeString(data.phaseId) || docId;
  const phaseId = canonicalizePhaseId(rawPhaseId);
  const canonical = getCanonicalPhaseById(phaseId);

  const title = normalizeString(data.title);
  const description = normalizeString(data.description);
  const level = normalizeString(data.level);
  const order = Number(data.order);
  const totalSeats = Number(data.totalSeats);
  const bookedSeats = Number(data.bookedSeats);

  return {
    phaseId,
    title: title || canonical?.title || phaseId,
    description: description || canonical?.description || "",
    level: level || canonical?.level || "Beginner",
    order: Number.isFinite(order) ? order : (canonical?.order || Number.MAX_SAFE_INTEGER),
    totalSeats: Number.isFinite(totalSeats) && totalSeats >= 0
      ? totalSeats
      : (canonical?.totalSeats || DEFAULT_TOTAL_SEATS),
    bookedSeats: Number.isFinite(bookedSeats) && bookedSeats >= 0 ? bookedSeats : 0
  };
}

function normalizeBookingStatus(value) {
  if (
    value === BOOKING_STATUS_PENDING ||
    value === BOOKING_STATUS_APPROVED ||
    value === BOOKING_STATUS_REJECTED ||
    value === BOOKING_STATUS_CANCELLED ||
    value === BOOKING_STATUS_EXPIRED
  ) {
    return value;
  }
  return BOOKING_STATUS_PENDING;
}

function normalizeBookingDoc(docId, data = {}) {
  const rawPhaseId = normalizeString(data.phaseId) || normalizeString(data.phase) || normalizeString(data.phaseKey);
  const rawCanonicalPhaseId = normalizeString(data.phaseCanonicalId);
  const rawLegacyPhaseId = normalizeString(data.phaseLegacyId);
  const canonicalPhaseId = canonicalizePhaseId(rawCanonicalPhaseId || rawPhaseId || rawLegacyPhaseId);
  const normalizedStatus = normalizeBookingStatus(data.status || data.requestStatus || data.bookingStatus);

  return {
    bookingId: normalizeString(data.bookingId) || docId,
    userId: normalizeString(data.userId) || normalizeString(data.uid),
    uid: normalizeString(data.uid) || normalizeString(data.userId),
    phaseId: canonicalPhaseId,
    phaseIdRaw: rawPhaseId,
    phaseCanonicalId: canonicalPhaseId,
    phaseLegacyId: rawLegacyPhaseId,
    phase: rawPhaseId || canonicalPhaseId,
    phoneNumber: normalizeString(data.phoneNumber),
    whatsappNumber: normalizeString(data.whatsappNumber),
    phone: normalizeString(data.phone),
    whatsapp: normalizeString(data.whatsapp),
    userName: normalizeString(data.userName) || normalizeString(data.name),
    userEmail: normalizeString(data.userEmail) || normalizeString(data.email),
    status: normalizedStatus,
    requestStatus: normalizeBookingStatus(data.requestStatus || normalizedStatus),
    bookingStatus: normalizeBookingStatus(data.bookingStatus || normalizedStatus),
    createdAtMs: timestampToMillis(data.createdAt),
    expiresAtMs: timestampToMillis(data.expiresAt)
  };
}

function sortPhaseList(phases) {
  return phases.slice().sort((a, b) => {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.title.localeCompare(b.title);
  });
}

function formatAdminValue(value) {
  return value ? String(value) : "-";
}

function formatDateTime(ms) {
  if (!ms || !Number.isFinite(ms)) {
    return "";
  }
  return new Date(ms).toLocaleString();
}

function getPhaseById(phaseId) {
  const canonicalPhaseId = canonicalizePhaseId(phaseId);
  return state.phases.find((phase) => phase.phaseId === canonicalPhaseId) || null;
}

function isPhaseFull(phase) {
  if (!phase) {
    return false;
  }
  return phase.totalSeats > 0 && phase.bookedSeats >= phase.totalSeats;
}

function getPreviousPhase(phaseId) {
  const sortedPhases = sortPhaseList(state.phases);
  const currentIndex = sortedPhases.findIndex((phase) => phase.phaseId === canonicalizePhaseId(phaseId));
  if (currentIndex <= 0) {
    return null;
  }
  return sortedPhases[currentIndex - 1];
}

function getMissingPrerequisitePhase(phaseId, unlockedPhaseSet) {
  const previousPhase = getPreviousPhase(phaseId);
  if (!previousPhase) {
    return null;
  }
  if (unlockedPhaseSet.has(previousPhase.phaseId)) {
    return null;
  }
  return previousPhase;
}

function getBookingStatusLabel(status) {
  if (status === BOOKING_STATUS_APPROVED) {
    return "approved";
  }
  if (status === BOOKING_STATUS_REJECTED) {
    return "rejected";
  }
  if (status === BOOKING_STATUS_CANCELLED) {
    return "cancelled";
  }
  if (status === BOOKING_STATUS_EXPIRED) {
    return "expired";
  }
  return "pending";
}

function getEffectiveBookingStatus(booking) {
  if (!booking) {
    return BOOKING_STATUS_PENDING;
  }

  if (
    booking.status === BOOKING_STATUS_PENDING &&
    booking.expiresAtMs &&
    booking.expiresAtMs <= Date.now()
  ) {
    return BOOKING_STATUS_EXPIRED;
  }

  return booking.status;
}

function getUnlockedPhaseSet() {
  const unlockedSet = new Set((state.profile?.unlockedPhases || []).map(canonicalizePhaseId));

  state.userBookingsByPhaseId.forEach((booking) => {
    if (booking.status === BOOKING_STATUS_APPROVED && booking.phaseId) {
      unlockedSet.add(booking.phaseId);
    }
  });

  return unlockedSet;
}

function resolvePhaseState(phaseId, unlockedPhaseSet) {
  const booking = state.userBookingsByPhaseId.get(phaseId) || null;
  const effectiveStatus = getEffectiveBookingStatus(booking);

  if (unlockedPhaseSet.has(phaseId) || booking?.status === BOOKING_STATUS_APPROVED) {
    return { phaseState: PHASE_STATE_UNLOCKED, booking };
  }
  if (effectiveStatus === BOOKING_STATUS_PENDING) {
    return { phaseState: PHASE_STATE_PENDING, booking };
  }
  if (effectiveStatus === BOOKING_STATUS_EXPIRED) {
    return { phaseState: PHASE_STATE_LOCKED, booking: { ...booking, status: BOOKING_STATUS_EXPIRED } };
  }
  return { phaseState: PHASE_STATE_LOCKED, booking };
}

function buildPhaseStatusText(phase, phaseState, booking, missingPrerequisitePhase) {
  if (phaseState === PHASE_STATE_UNLOCKED) {
    return "Approved and unlocked.";
  }
  if (phaseState === PHASE_STATE_PENDING) {
    if (booking?.expiresAtMs) {
      return `Waiting for approval. Expires: ${formatDateTime(booking.expiresAtMs)}.`;
    }
    return "Waiting for admin approval.";
  }
  if (missingPrerequisitePhase) {
    return `Complete ${missingPrerequisitePhase.title} before requesting this phase.`;
  }
  if (isPhaseFull(phase)) {
    return "No seats available for this phase right now.";
  }
  if (booking?.status === BOOKING_STATUS_REJECTED) {
    return "Your previous request was rejected. You can submit again.";
  }
  if (booking?.status === BOOKING_STATUS_CANCELLED) {
    return "Your seat access was cancelled by admin. Request again to continue.";
  }
  if (booking?.status === BOOKING_STATUS_EXPIRED) {
    return "Previous request expired. You can submit again.";
  }
  return "Request access to unlock this phase.";
}

function renderPhases() {
  elements.phaseList.innerHTML = "";
  elements.phaseFilterButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.phaseFilter === state.selectedPhaseTrack);
  });

  const sortedPhases = sortPhaseList(state.phases);
  if (sortedPhases.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "phase-empty";
    emptyState.textContent = "No phases available.";
    elements.phaseList.appendChild(emptyState);
    return;
  }

  const unlockedPhaseSet = getUnlockedPhaseSet();
  const selectedTrack = state.selectedPhaseTrack || PHASE_TRACK_BEGINNER;
  const visiblePhases = sortedPhases.filter((phase) => toTrackName(phase.level) === selectedTrack);

  if (visiblePhases.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "phase-empty";
    emptyState.textContent = "No phases available in this track.";
    elements.phaseList.appendChild(emptyState);
    return;
  }

  visiblePhases.forEach((phase) => {
    const { phaseState, booking } = resolvePhaseState(phase.phaseId, unlockedPhaseSet);
    const missingPrerequisitePhase = getMissingPrerequisitePhase(phase.phaseId, unlockedPhaseSet);
    const phaseIsFull = isPhaseFull(phase);

    const card = document.createElement("article");
    card.className = "phase-card";
    card.classList.toggle("phase-card-full", phaseIsFull);

    const header = document.createElement("div");
    header.className = "phase-card-header";

    const titleWrap = document.createElement("div");

    const title = document.createElement("h3");
    title.className = "phase-title";
    title.textContent = phase.title;

    const subtitle = document.createElement("p");
    subtitle.className = "phase-subtitle";
    subtitle.textContent = `Level: ${phase.level}`;

    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);

    const stateBadge = document.createElement("span");
    stateBadge.className = `phase-state ${phaseState.toLowerCase()}`;
    stateBadge.textContent = phaseState;

    header.appendChild(titleWrap);
    header.appendChild(stateBadge);

    const meta = document.createElement("p");
    meta.className = "phase-meta";
    const availableSeats = Math.max(phase.totalSeats - phase.bookedSeats, 0);
    meta.textContent = `Seats available: ${availableSeats} / ${phase.totalSeats}`;

    const description = document.createElement("p");
    description.className = "phase-description";
    description.textContent = phase.description || "No description.";

    const statusText = document.createElement("p");
    statusText.className = "phase-status-text";
    statusText.textContent = buildPhaseStatusText(phase, phaseState, booking, missingPrerequisitePhase);

    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.className = "phase-action-btn";

    if (phaseState === PHASE_STATE_LOCKED) {
      if (missingPrerequisitePhase) {
        actionButton.disabled = true;
        actionButton.textContent = "Locked by Progress";
      } else if (phaseIsFull) {
        actionButton.disabled = true;
        actionButton.textContent = "No Seats Available";
      } else {
        actionButton.disabled = false;
        if (!state.user) {
          actionButton.textContent = "Login to Book Seat";
        } else if (
          booking?.status === BOOKING_STATUS_EXPIRED ||
          booking?.status === BOOKING_STATUS_REJECTED ||
          booking?.status === BOOKING_STATUS_CANCELLED
        ) {
          actionButton.textContent = "Request Again";
        } else {
          actionButton.textContent = "Book Seat";
        }
        actionButton.addEventListener("click", () => {
          void handlePhaseClick(phase.phaseId);
        });
      }
    } else if (phaseState === PHASE_STATE_PENDING) {
      actionButton.disabled = true;
      actionButton.textContent = "Waiting Approval";
    } else {
      actionButton.disabled = true;
      actionButton.textContent = "Unlocked";
    }

    card.appendChild(header);
    card.appendChild(meta);
    card.appendChild(description);
    card.appendChild(statusText);
    card.appendChild(actionButton);
    elements.phaseList.appendChild(card);
  });
}

function renderAdminPanel() {
  if (!elements.adminPanel || !elements.adminRows || !elements.adminEmpty) {
    return;
  }

  elements.adminTabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.adminTab === state.selectedAdminTab);
  });

  if (!state.isAdmin) {
    elements.adminPanel.classList.add("hidden");
    elements.adminRows.innerHTML = "";
    elements.adminEmpty.classList.add("hidden");
    return;
  }

  elements.adminPanel.classList.remove("hidden");
  elements.adminRows.innerHTML = "";

  const sourceBookings = state.selectedAdminTab === "all"
    ? state.adminAllBookings
    : state.adminPendingBookings;

  const bookings = sourceBookings.slice().sort((a, b) => {
    const aCreated = a.createdAtMs || 0;
    const bCreated = b.createdAtMs || 0;
    return bCreated - aCreated;
  });

  if (bookings.length === 0) {
    elements.adminEmpty.textContent = state.selectedAdminTab === "all"
      ? "No bookings yet."
      : "No pending bookings right now.";
    elements.adminEmpty.classList.remove("hidden");
    return;
  }

  elements.adminEmpty.classList.add("hidden");

  bookings.forEach((booking) => {
    const effectiveStatus = getEffectiveBookingStatus(booking);
    const statusText = getBookingStatusLabel(effectiveStatus);

    const row = document.createElement("tr");
    const phoneValue = booking.phoneNumber || booking.phone || "-";
    const whatsappValue = booking.whatsappNumber || booking.whatsapp || "-";

    row.innerHTML = `
      <td>${formatAdminValue(booking.userId)}</td>
      <td>${formatAdminValue(booking.phaseId)}</td>
      <td>${formatAdminValue(phoneValue)}</td>
      <td>${formatAdminValue(whatsappValue)}</td>
      <td>${formatDateTime(booking.createdAtMs) || "-"}</td>
      <td>${formatDateTime(booking.expiresAtMs) || "-"}</td>
      <td><span class="admin-status ${statusText}">${statusText}</span></td>
      <td class="admin-actions-cell"></td>
    `;

    const actionsCell = row.querySelector(".admin-actions-cell");

    if (effectiveStatus === BOOKING_STATUS_PENDING) {
      const approveBtn = document.createElement("button");
      approveBtn.type = "button";
      approveBtn.className = "admin-action-btn approve";
      approveBtn.textContent = "Approve";
      approveBtn.addEventListener("click", () => {
        void approveBookingByAdmin(booking);
      });

      const rejectBtn = document.createElement("button");
      rejectBtn.type = "button";
      rejectBtn.className = "admin-action-btn reject";
      rejectBtn.textContent = "Reject";
      rejectBtn.addEventListener("click", () => {
        void rejectBookingByAdmin(booking);
      });

      actionsCell.appendChild(approveBtn);
      actionsCell.appendChild(rejectBtn);
    } else if (state.selectedAdminTab === "all" && effectiveStatus === BOOKING_STATUS_APPROVED) {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "admin-action-btn cancel";
      cancelBtn.textContent = "Cancel Seat";
      cancelBtn.addEventListener("click", () => {
        void cancelApprovedBookingByAdmin(booking);
      });
      actionsCell.appendChild(cancelBtn);
    } else {
      actionsCell.textContent = "-";
    }

    elements.adminRows.appendChild(row);
  });
}

function updateAuthButtons() {
  const loginBlocked = isGoogleLoginBlockedInCurrentBrowser();
  const blockTitle = "Google sign-in is disabled in embedded in-app browsers. Open this page in Chrome or Safari.";
  const isSignedIn = Boolean(state.user);

  elements.loginBtn.classList.toggle("hidden", isSignedIn);
  elements.logoutBtn.classList.toggle("hidden", !isSignedIn);

  elements.loginBtn.disabled = loginBlocked || !state.firebaseReady || isSignedIn;
  elements.loginModalBtn.disabled = loginBlocked || !state.firebaseReady || isSignedIn;
  elements.logoutBtn.disabled = !state.firebaseReady || !isSignedIn;

  elements.loginBtn.title = loginBlocked ? blockTitle : "";
  elements.loginModalBtn.title = loginBlocked ? blockTitle : "";
}

function updateProfileUI() {
  if (!state.user || !state.profile) {
    elements.profileCard.classList.add("hidden");
    if (elements.adminChip) {
      elements.adminChip.classList.add("hidden");
    }
    return;
  }

  elements.profileCard.classList.remove("hidden");
  elements.profileName.textContent = state.profile.name || "-";
  elements.profileEmail.textContent = state.profile.email || "-";
  elements.profilePhoneNumber.textContent = state.profile.phoneNumber || "-";
  elements.profileWhatsapp.textContent = state.profile.whatsappNumber || "-";

  if (elements.adminChip) {
    elements.adminChip.classList.toggle("hidden", !state.isAdmin);
  }
}

function showLoginModal() {
  elements.loginModal.classList.remove("hidden");
}

function hideLoginModal() {
  elements.loginModal.classList.add("hidden");
}

function showPhoneModal(phaseId = null) {
  if (phaseId !== null) {
    state.pendingPhaseId = phaseId;
  }

  const isBookingFlow = Boolean(state.pendingPhaseId);
  elements.phoneTitle.textContent = isBookingFlow
    ? "Enter booking contact details"
    : "Update contact details";
  elements.phoneSubmitBtn.textContent = isBookingFlow
    ? "Submit Booking"
    : "Save Profile";

  elements.phoneNumberInput.value = state.profile?.phoneNumber || "";
  elements.whatsappInput.value = state.profile?.whatsappNumber || state.profile?.phone || "";

  elements.phoneModal.classList.remove("hidden");
  elements.phoneNumberInput.focus();
}

function hidePhoneModal() {
  elements.phoneModal.classList.add("hidden");
}

function isValidPhone(value) {
  const normalized = value.replace(/[\s\-()]/g, "");
  return /^\+?[0-9]{8,15}$/.test(normalized);
}

function announceNewPendingBookingEvents(previousBookingsById, nextBookings) {
  if (!state.isAdmin || !state.hasLoadedAdminBookings) {
    return;
  }

  const newPendingEvents = findNewPendingBookingEvents(previousBookingsById, nextBookings);
  newPendingEvents.forEach((eventInfo) => {
    const speakResult = speakNotificationOnce(eventInfo.eventId, eventInfo.text);

    if (
      !speakResult.ok &&
      speakResult.reason === "interaction-required" &&
      !state.hasShownSoundUnlockHint
    ) {
      state.hasShownSoundUnlockHint = true;
      showMessage("Voice alerts are ready. Tap anywhere once to enable audio notifications.", "info");
    }
  });
}

async function handleLogin() {
  if (isGoogleLoginBlockedInCurrentBrowser()) {
    hideLoginModal();
    showInAppModal();
    showMessage("Google sign-in is blocked inside this in-app browser. Open this page in Chrome or Safari.", "error");
    return;
  }

  const canPopupLogin = Boolean(signInWithPopupFn);
  const canRedirectLogin = Boolean(signInWithRedirectFn);

  if (!state.firebaseReady || !auth || !provider || (!canPopupLogin && !canRedirectLogin)) {
    showMessage("Firebase is not ready. Check config and reload.", "error");
    return;
  }

  try {
    if (!canPopupLogin && canRedirectLogin) {
      hideLoginModal();
      showMessage("Redirecting to Google sign-in...", "info");
      await signInWithRedirectFn(auth, provider);
      return;
    }

    await signInWithPopupFn(auth, provider);
    hideLoginModal();
    showMessage("Login successful.", "success");
  } catch (error) {
    const code = String(error?.code || "");
    if (code === "auth/popup-blocked" && canRedirectLogin) {
      try {
        hideLoginModal();
        showMessage("Popup blocked. Redirecting to Google sign-in...", "info");
        await signInWithRedirectFn(auth, provider);
        return;
      } catch (redirectError) {
        showMessage(getLoginErrorMessage(redirectError), "error");
        return;
      }
    }

    showMessage(getLoginErrorMessage(error), "error");
  }
}

async function processRedirectLoginResult() {
  if (!state.firebaseReady || !auth || !getRedirectResultFn) {
    return;
  }

  try {
    await getRedirectResultFn(auth);
  } catch (error) {
    showMessage(getLoginErrorMessage(error), "error");
  }
}

async function handleLogout() {
  if (!state.firebaseReady || !auth || !signOutFn) {
    showMessage("Firebase is not ready.", "error");
    return;
  }

  try {
    await signOutFn(auth);
    showMessage("Logged out.", "info");
  } catch (error) {
    showMessage(`Logout failed: ${error.message}`, "error");
  }
}

async function saveUserProfile(phoneNumber, whatsappNumber) {
  if (!state.user) {
    throw new Error("User not authenticated.");
  }
  if (!db || !docFn || !setDocFn || !serverTimestampFn) {
    throw new Error("Firestore is not initialized.");
  }

  const userRef = docFn(db, "users", state.user.uid);
  const payload = {
    name: state.user.displayName || "Unknown User",
    email: state.user.email || "",
    phone: whatsappNumber,
    phoneNumber,
    whatsappNumber,
    updatedAt: serverTimestampFn()
  };

  if (!state.userDocExists) {
    payload.createdAt = serverTimestampFn();
    payload.progress = 0;
    payload.unlockedPhases = [];
    payload.completedPhases = [];
  }

  await setDocFn(userRef, payload, { merge: true });

  state.profile = {
    ...normalizeUserProfile(state.user, {}),
    ...state.profile,
    name: state.user.displayName || "Unknown User",
    email: state.user.email || "",
    phone: whatsappNumber,
    phoneNumber,
    whatsappNumber
  };
  updateProfileUI();
  renderPhases();
}

function buildBookingPayload(
  bookingId,
  userId,
  canonicalPhaseId,
  phoneNumber,
  whatsappNumber
) {
  const resolvedCanonicalPhaseId = canonicalizePhaseId(canonicalPhaseId);
  const legacyPhaseId = getLegacyPhaseIdForCanonical(resolvedCanonicalPhaseId);
  const legacyPhaseAlias = legacyPhaseId || resolvedCanonicalPhaseId;
  const createdAtMs = Date.now();
  const expiresAtMs = createdAtMs + BOOKING_EXPIRY_MS;

  // Must stay schema-compatible with the mobile app and Cloud Function trigger expectations.
  return {
    bookingId,
    id: bookingId,
    userId,
    uid: userId,
    phaseId: resolvedCanonicalPhaseId,
    phase: legacyPhaseAlias,
    phaseKey: legacyPhaseAlias,
    phaseCanonicalId: resolvedCanonicalPhaseId,
    phaseLegacyId: legacyPhaseId || null,
    phaseIdAliases: Array.from(new Set([resolvedCanonicalPhaseId, legacyPhaseId].filter(Boolean))),
    userName: state.user?.displayName || "",
    name: state.user?.displayName || "",
    userEmail: state.user?.email || "",
    email: state.user?.email || "",
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

function buildCanonicalPhasePayload(phaseId) {
  const canonicalPhaseId = canonicalizePhaseId(phaseId);
  const canonical = getCanonicalPhaseById(canonicalPhaseId);

  if (canonical) {
    return { ...canonical, phaseId: canonicalPhaseId };
  }

  return {
    phaseId: canonicalPhaseId,
    title: canonicalPhaseId,
    description: "",
    level: "Beginner",
    order: Number.MAX_SAFE_INTEGER,
    totalSeats: DEFAULT_TOTAL_SEATS,
    bookedSeats: 0
  };
}

async function requestBookingForPhase(phaseId, phoneNumber, whatsappNumber) {
  if (!state.firebaseReady || !db || !runTransactionFn || !docFn || !serverTimestampFn) {
    showMessage("Firestore is not ready.", "error");
    return false;
  }
  if (!state.user) {
    showMessage("Please log in first.", "error");
    return false;
  }

  const canonicalPhaseId = canonicalizePhaseId(phaseId);
  const selectedPhase = getPhaseById(canonicalPhaseId);
  if (!selectedPhase) {
    showMessage("Phase not found.", "error");
    return false;
  }

  const unlockedPhaseSet = getUnlockedPhaseSet();
  const missingPrerequisitePhase = getMissingPrerequisitePhase(canonicalPhaseId, unlockedPhaseSet);
  if (missingPrerequisitePhase) {
    showMessage(`Complete ${missingPrerequisitePhase.title} first.`, "info");
    return false;
  }

  if (isPhaseFull(selectedPhase)) {
    showMessage("No seats available for this phase.", "error");
    return false;
  }

  const userId = state.user.uid;
  const bookingId = `${userId}_${canonicalPhaseId}`;
  const bookingRef = docFn(db, "bookings", bookingId);
  const canonicalPhaseRef = docFn(db, "phases", canonicalPhaseId);
  const legacyPhaseId = getLegacyPhaseIdForCanonical(canonicalPhaseId);
  const legacyPhaseRef = legacyPhaseId ? docFn(db, "phases", legacyPhaseId) : null;

  try {
    await runTransactionFn(db, async (transaction) => {
      const canonicalPhaseSnapshot = await transaction.get(canonicalPhaseRef);
      let checkedPhaseSnapshot = canonicalPhaseSnapshot;

      if (!canonicalPhaseSnapshot.exists() && legacyPhaseRef) {
        const legacyPhaseSnapshot = await transaction.get(legacyPhaseRef);
        if (legacyPhaseSnapshot.exists()) {
          checkedPhaseSnapshot = legacyPhaseSnapshot;
        }
      }

      if (checkedPhaseSnapshot.exists()) {
        const livePhase = normalizePhaseDoc(checkedPhaseSnapshot.id, checkedPhaseSnapshot.data());
        if (isPhaseFull(livePhase)) {
          throw makeAppError("phase-full", "Phase has reached totalSeats.");
        }
      }

      const bookingSnapshot = await transaction.get(bookingRef);
      if (bookingSnapshot.exists()) {
        const existingBooking = normalizeBookingDoc(bookingSnapshot.id, bookingSnapshot.data());
        const hasExpiredPendingWindow = getEffectiveBookingStatus(existingBooking) === BOOKING_STATUS_EXPIRED;

        if (existingBooking.status === BOOKING_STATUS_PENDING && !hasExpiredPendingWindow) {
          throw makeAppError("booking-pending", "Booking is already pending.");
        }
        if (existingBooking.status === BOOKING_STATUS_APPROVED) {
          throw makeAppError("booking-approved", "Phase is already approved for this user.");
        }
      }

      transaction.set(
        bookingRef,
        buildBookingPayload(
          bookingId,
          userId,
          canonicalPhaseId,
          phoneNumber,
          whatsappNumber
        )
      );
    });

    showMessage("Booking request submitted and waiting for admin approval.", "success");
    return true;
  } catch (error) {
    if (error?.code === "phase-full") {
      showMessage("No seats available for this phase.", "error");
    } else if (error?.code === "booking-pending") {
      showMessage("You already have a pending booking for this phase.", "info");
    } else if (error?.code === "booking-approved") {
      showMessage("This phase is already approved for your account.", "info");
    } else if (isPermissionDeniedError(error)) {
      showMessage("Booking blocked by Firestore rules.", "error");
    } else {
      showMessage(`Failed to submit booking: ${error.message}`, "error");
    }
    return false;
  }
}

async function rejectBookingByAdmin(booking) {
  if (!state.isAdmin || !state.firebaseReady || !db || !runTransactionFn || !docFn || !serverTimestampFn) {
    return;
  }

  try {
    await runTransactionFn(db, async (transaction) => {
      const bookingRef = docFn(db, "bookings", booking.bookingId);
      const liveSnapshot = await transaction.get(bookingRef);

      if (!liveSnapshot.exists()) {
        throw makeAppError("booking-not-found", "Booking document not found.");
      }

      const liveBooking = normalizeBookingDoc(liveSnapshot.id, liveSnapshot.data());
      if (liveBooking.status !== BOOKING_STATUS_PENDING) {
        throw makeAppError("booking-not-pending", "Only pending bookings can be rejected.");
      }
      if (getEffectiveBookingStatus(liveBooking) === BOOKING_STATUS_EXPIRED) {
        throw makeAppError("booking-expired", "This pending booking has expired.");
      }

      transaction.update(bookingRef, {
        status: BOOKING_STATUS_REJECTED,
        requestStatus: BOOKING_STATUS_REJECTED,
        bookingStatus: BOOKING_STATUS_REJECTED,
        updatedAt: serverTimestampFn(),
        updatedAtMs: Date.now(),
        rejectedAt: serverTimestampFn()
      });
    });

    showMessage(`Booking ${booking.bookingId} rejected.`, "success");
  } catch (error) {
    if (error?.code === "booking-not-pending") {
      showMessage("Only pending bookings can be rejected.", "error");
    } else if (error?.code === "booking-expired") {
      showMessage("This booking already expired. No action needed.", "info");
    } else if (isPermissionDeniedError(error)) {
      showMessage("Reject action blocked by Firestore rules.", "error");
    } else {
      showMessage(`Failed to reject booking: ${error.message}`, "error");
    }
  }
}

async function approveBookingByAdmin(booking) {
  if (
    !state.isAdmin ||
    !state.firebaseReady ||
    !db ||
    !runTransactionFn ||
    !docFn ||
    !arrayUnionFn ||
    !serverTimestampFn
  ) {
    return;
  }

  try {
    await runTransactionFn(db, async (transaction) => {
      const bookingRef = docFn(db, "bookings", booking.bookingId);
      const liveBookingSnapshot = await transaction.get(bookingRef);

      if (!liveBookingSnapshot.exists()) {
        throw makeAppError("booking-not-found", "Booking document not found.");
      }

      const liveBooking = normalizeBookingDoc(liveBookingSnapshot.id, liveBookingSnapshot.data());
      if (liveBooking.status !== BOOKING_STATUS_PENDING) {
        throw makeAppError("booking-not-pending", "Only pending bookings can be approved.");
      }
      if (getEffectiveBookingStatus(liveBooking) === BOOKING_STATUS_EXPIRED) {
        throw makeAppError("booking-expired", "This pending booking has expired.");
      }
      if (!liveBooking.phaseId || !liveBooking.userId) {
        throw makeAppError("invalid-booking", "Booking is missing userId or phaseId.");
      }

      const canonicalPhaseRef = docFn(db, "phases", liveBooking.phaseId);
      const legacyPhaseId = getLegacyPhaseIdForCanonical(liveBooking.phaseId);
      const legacyPhaseRef = legacyPhaseId ? docFn(db, "phases", legacyPhaseId) : null;

      const canonicalPhaseSnapshot = await transaction.get(canonicalPhaseRef);
      let targetPhaseRef = canonicalPhaseRef;
      let targetPhaseSnapshot = canonicalPhaseSnapshot;

      if (!canonicalPhaseSnapshot.exists() && legacyPhaseRef) {
        const legacyPhaseSnapshot = await transaction.get(legacyPhaseRef);
        if (legacyPhaseSnapshot.exists()) {
          targetPhaseRef = legacyPhaseRef;
          targetPhaseSnapshot = legacyPhaseSnapshot;
        }
      }

      const livePhase = targetPhaseSnapshot.exists()
        ? normalizePhaseDoc(targetPhaseSnapshot.id, targetPhaseSnapshot.data())
        : normalizePhaseDoc(liveBooking.phaseId, buildCanonicalPhasePayload(liveBooking.phaseId));
      if (livePhase.totalSeats > 0 && livePhase.bookedSeats >= livePhase.totalSeats) {
        throw makeAppError("phase-full", "Phase has reached totalSeats.");
      }

      const userRef = docFn(db, "users", liveBooking.userId);
      const nextBookedSeats = Math.max(livePhase.bookedSeats + 1, 0);
      const phasePayload = {
        ...buildCanonicalPhasePayload(liveBooking.phaseId),
        ...targetPhaseSnapshot.data(),
        phaseId: livePhase.phaseId,
        bookedSeats: nextBookedSeats
      };

      // Keep approval transaction aligned with mobile app behavior.
      transaction.update(bookingRef, {
        status: BOOKING_STATUS_APPROVED,
        requestStatus: BOOKING_STATUS_APPROVED,
        bookingStatus: BOOKING_STATUS_APPROVED,
        updatedAt: serverTimestampFn(),
        updatedAtMs: Date.now(),
        approvedAt: serverTimestampFn(),
        approvedBy: state.user?.uid || null
      });
      transaction.set(targetPhaseRef, phasePayload, { merge: true });
      transaction.set(userRef, { unlockedPhases: arrayUnionFn(liveBooking.phaseId) }, { merge: true });
    });

    showMessage(`Booking ${booking.bookingId} approved.`, "success");
  } catch (error) {
    if (error?.code === "booking-not-pending") {
      showMessage("Only pending bookings can be approved.", "error");
    } else if (error?.code === "booking-expired") {
      showMessage("Cannot approve: booking has expired.", "error");
    } else if (error?.code === "phase-full") {
      showMessage("Cannot approve: phase has no available seats.", "error");
    } else if (isPermissionDeniedError(error)) {
      showMessage("Approve action blocked by Firestore rules.", "error");
    } else {
      showMessage(`Failed to approve booking: ${error.message}`, "error");
    }
  }
}

async function cancelApprovedBookingByAdmin(booking) {
  if (
    !state.isAdmin ||
    !state.firebaseReady ||
    !db ||
    !runTransactionFn ||
    !docFn ||
    !arrayRemoveFn ||
    !serverTimestampFn
  ) {
    return;
  }

  try {
    await runTransactionFn(db, async (transaction) => {
      const bookingRef = docFn(db, "bookings", booking.bookingId);
      const liveBookingSnapshot = await transaction.get(bookingRef);

      if (!liveBookingSnapshot.exists()) {
        throw makeAppError("booking-not-found", "Booking document not found.");
      }

      const liveBooking = normalizeBookingDoc(liveBookingSnapshot.id, liveBookingSnapshot.data());
      if (liveBooking.status !== BOOKING_STATUS_APPROVED) {
        throw makeAppError("booking-not-approved", "Only approved bookings can be cancelled.");
      }
      if (!liveBooking.phaseId || !liveBooking.userId) {
        throw makeAppError("invalid-booking", "Booking is missing userId or phaseId.");
      }

      const canonicalPhaseRef = docFn(db, "phases", liveBooking.phaseId);
      const legacyPhaseId = getLegacyPhaseIdForCanonical(liveBooking.phaseId);
      const legacyPhaseRef = legacyPhaseId ? docFn(db, "phases", legacyPhaseId) : null;

      const canonicalPhaseSnapshot = await transaction.get(canonicalPhaseRef);
      let targetPhaseRef = canonicalPhaseRef;
      let targetPhaseSnapshot = canonicalPhaseSnapshot;

      if (!canonicalPhaseSnapshot.exists() && legacyPhaseRef) {
        const legacyPhaseSnapshot = await transaction.get(legacyPhaseRef);
        if (legacyPhaseSnapshot.exists()) {
          targetPhaseRef = legacyPhaseRef;
          targetPhaseSnapshot = legacyPhaseSnapshot;
        }
      }

      const livePhase = targetPhaseSnapshot.exists()
        ? normalizePhaseDoc(targetPhaseSnapshot.id, targetPhaseSnapshot.data())
        : normalizePhaseDoc(liveBooking.phaseId, buildCanonicalPhasePayload(liveBooking.phaseId));

      const nextBookedSeats = Math.max((livePhase.bookedSeats || 0) - 1, 0);
      const phasePayload = {
        ...buildCanonicalPhasePayload(liveBooking.phaseId),
        ...targetPhaseSnapshot.data(),
        phaseId: liveBooking.phaseId,
        bookedSeats: nextBookedSeats
      };

      const userRef = docFn(db, "users", liveBooking.userId);

      transaction.update(bookingRef, {
        status: BOOKING_STATUS_CANCELLED,
        requestStatus: BOOKING_STATUS_CANCELLED,
        bookingStatus: BOOKING_STATUS_CANCELLED,
        updatedAt: serverTimestampFn(),
        updatedAtMs: Date.now(),
        cancelledAt: serverTimestampFn(),
        cancelledBy: state.user?.uid || null
      });
      transaction.set(targetPhaseRef, phasePayload, { merge: true });
      transaction.set(userRef, { unlockedPhases: arrayRemoveFn(liveBooking.phaseId) }, { merge: true });
    });

    showMessage(`Booking ${booking.bookingId} cancelled and seat released.`, "success");
  } catch (error) {
    if (error?.code === "booking-not-approved") {
      showMessage("Only approved bookings can be cancelled.", "error");
    } else if (isPermissionDeniedError(error)) {
      showMessage("Cancel action blocked by Firestore rules.", "error");
    } else {
      showMessage(`Failed to cancel booking: ${error.message}`, "error");
    }
  }
}

function maybePromptForContactDetails() {
  if (!state.user || !state.profile) {
    return;
  }

  const needsContact = !state.profile.phoneNumber || !state.profile.whatsappNumber;
  if (!needsContact) {
    state.hasPromptedForContact = false;
    return;
  }

  if (!elements.phoneModal.classList.contains("hidden")) {
    return;
  }

  if (state.pendingPhaseId !== null) {
    showPhoneModal(state.pendingPhaseId);
    return;
  }

  if (state.hasPromptedForContact) {
    return;
  }

  state.hasPromptedForContact = true;
  showMessage("Enter your phone and WhatsApp numbers to continue.", "info");
  showPhoneModal();
}

function subscribeToPhases() {
  if (!state.firebaseReady || !db || !collectionFn || !onSnapshotFn) {
    return;
  }

  if (state.phasesUnsubscribe) {
    state.phasesUnsubscribe();
    state.phasesUnsubscribe = null;
  }

  const phasesCollection = collectionFn(db, "phases");
  state.phasesUnsubscribe = onSnapshotFn(
    phasesCollection,
    (snapshot) => {
      const nextPhases = [];
      snapshot.forEach((phaseDoc) => {
        nextPhases.push(normalizePhaseDoc(phaseDoc.id, phaseDoc.data()));
      });

      state.phases = mergeWithCanonicalPhases(nextPhases);
      renderPhases();

      if (!state.hasLoadedPhases) {
        state.hasLoadedPhases = true;
        if (snapshot.size === 0) {
          showMessage('No Firestore phase docs found. Showing default 6-phase catalog.', "info");
        } else if (snapshot.size < CANONICAL_PHASES.length) {
          showMessage("Phase docs synced. Missing phases are filled from the default catalog.", "info");
        } else {
          showMessage("Phases loaded from Firestore.", "success");
        }
      }
    },
    (error) => {
      if (isPermissionDeniedError(error)) {
        showMessage("Phase read blocked by Firestore rules.", "error");
      } else {
        showMessage(`Failed to load phases: ${error.message}`, "error");
      }
    }
  );
}

function subscribeToUserBookings(userId) {
  if (!state.firebaseReady || !db || !collectionFn || !queryFn || !whereFn || !onSnapshotFn) {
    return;
  }

  if (state.userBookingsUnsubscribe) {
    state.userBookingsUnsubscribe();
    state.userBookingsUnsubscribe = null;
  }

  const bookingsQuery = queryFn(
    collectionFn(db, "bookings"),
    whereFn("userId", "==", userId)
  );

  state.userBookingsUnsubscribe = onSnapshotFn(
    bookingsQuery,
    (snapshot) => {
      const nextBookingsByPhaseId = new Map();

      snapshot.forEach((bookingDoc) => {
        const normalized = normalizeBookingDoc(bookingDoc.id, bookingDoc.data());
        if (normalized.phaseId) {
          nextBookingsByPhaseId.set(normalized.phaseId, normalized);
        }
      });

      state.userBookingsByPhaseId = nextBookingsByPhaseId;
      renderPhases();
    },
    (error) => {
      if (isPermissionDeniedError(error)) {
        showMessage("Booking read blocked by Firestore rules.", "error");
      } else {
        showMessage(`Failed to load your bookings: ${error.message}`, "error");
      }
    }
  );
}

function subscribeToUserProfile(user) {
  if (!state.firebaseReady || !db || !docFn || !onSnapshotFn) {
    return;
  }

  if (state.userDocUnsubscribe) {
    state.userDocUnsubscribe();
    state.userDocUnsubscribe = null;
  }

  const userRef = docFn(db, "users", user.uid);
  state.userDocUnsubscribe = onSnapshotFn(
    userRef,
    (snapshot) => {
      state.userDocExists = snapshot.exists();
      state.profile = snapshot.exists()
        ? normalizeUserProfile(user, snapshot.data())
        : normalizeUserProfile(user, {});

      updateProfileUI();
      renderPhases();
      maybePromptForContactDetails();
    },
    (error) => {
      if (isPermissionDeniedError(error)) {
        showMessage("Profile read blocked by Firestore rules. Allow users/{uid} read for that uid.", "error");
      } else {
        showMessage(`Failed to load profile: ${error.message}`, "error");
      }
    }
  );
}

function subscribeToAdminPendingBookings() {
  if (!state.isAdmin || !state.firebaseReady || !db || !collectionFn || !onSnapshotFn) {
    return;
  }

  if (state.adminBookingsUnsubscribe) {
    state.adminBookingsUnsubscribe();
    state.adminBookingsUnsubscribe = null;
  }

  const bookingCollection = collectionFn(db, "bookings");
  state.adminBookingsUnsubscribe = onSnapshotFn(
    bookingCollection,
    (snapshot) => {
      const previousBookingsById = new Map(
        state.adminPendingBookings.map((booking) => [booking.bookingId, booking])
      );

      const nextAllBookings = [];
      const nextPendingBookings = [];
      snapshot.forEach((bookingDoc) => {
        const bookingData = bookingDoc.data();
        const normalized = normalizeBookingDoc(bookingDoc.id, bookingData);
        const rawStatus = normalizeString(bookingData?.status).toLowerCase();
        nextAllBookings.push(normalized);
        if (rawStatus === BOOKING_STATUS_PENDING && getEffectiveBookingStatus(normalized) === BOOKING_STATUS_PENDING) {
          nextPendingBookings.push(normalized);
        }
      });

      announceNewPendingBookingEvents(previousBookingsById, nextPendingBookings);

      state.adminPendingBookings = nextPendingBookings;
      state.adminAllBookings = nextAllBookings;
      renderAdminPanel();

      if (!state.hasLoadedAdminBookings) {
        state.hasLoadedAdminBookings = true;
        showMessage("Admin bookings synced.", "success");
      }
    },
    (error) => {
      if (isPermissionDeniedError(error)) {
        showMessage("Admin booking read blocked by Firestore rules.", "error");
      } else {
        showMessage(`Failed to load admin bookings: ${error.message}`, "error");
      }
    }
  );
}

function clearUserScopedListeners() {
  if (state.userBookingsUnsubscribe) {
    state.userBookingsUnsubscribe();
    state.userBookingsUnsubscribe = null;
  }

  if (state.userDocUnsubscribe) {
    state.userDocUnsubscribe();
    state.userDocUnsubscribe = null;
  }
}

function clearAdminListener() {
  if (state.adminBookingsUnsubscribe) {
    state.adminBookingsUnsubscribe();
    state.adminBookingsUnsubscribe = null;
  }
}

async function onAuthStateChangedHandler(user) {
  clearUserScopedListeners();
  clearAdminListener();

  state.user = user;
  state.isAdmin = isAdminEmail(user?.email);
  state.pendingPhaseId = null;
  state.userBookingsByPhaseId = new Map();
  state.userDocExists = false;
  state.hasPromptedForContact = false;

  setSoundEngineAdminMode(state.isAdmin);
  if (!state.isAdmin) {
    state.adminPendingBookings = [];
    state.adminAllBookings = [];
    state.hasLoadedAdminBookings = false;
    state.selectedAdminTab = "pending";
    state.hasShownSoundUnlockHint = false;
    clearSoundAnnouncementHistory();
  }

  updateAuthButtons();
  hidePhoneModal();

  if (!user) {
    state.profile = null;
    updateProfileUI();
    renderPhases();
    renderAdminPanel();
    return;
  }

  subscribeToUserProfile(user);
  subscribeToUserBookings(user.uid);

  if (state.isAdmin) {
    showMessage(`Admin access enabled for ${normalizeEmail(user.email)}.`, "success");
    renderAdminPanel();
    subscribeToAdminPendingBookings();
  } else {
    showMessage(`Logged in as ${normalizeEmail(user.email)}.`, "success");
    renderAdminPanel();
  }

  renderPhases();
}

async function handlePhaseClick(phaseId) {
  if (!state.firebaseReady) {
    showMessage("Firebase is not ready.", "error");
    return;
  }

  const canonicalPhaseId = canonicalizePhaseId(phaseId);
  const phase = getPhaseById(canonicalPhaseId);
  if (!phase) {
    showMessage("Phase not found.", "error");
    return;
  }

  const unlockedPhaseSet = getUnlockedPhaseSet();
  const missingPrerequisitePhase = getMissingPrerequisitePhase(canonicalPhaseId, unlockedPhaseSet);
  if (missingPrerequisitePhase) {
    showMessage(`Complete ${missingPrerequisitePhase.title} first.`, "info");
    return;
  }

  if (isPhaseFull(phase)) {
    showMessage("No seats available for this phase.", "error");
    return;
  }

  const { phaseState } = resolvePhaseState(canonicalPhaseId, unlockedPhaseSet);
  if (phaseState !== PHASE_STATE_LOCKED) {
    if (phaseState === PHASE_STATE_PENDING) {
      showMessage("This phase is already pending approval.", "info");
    } else {
      showMessage("This phase is already unlocked.", "info");
    }
    return;
  }

  if (!state.user) {
    showMessage("Please log in first.", "error");
    openLoginFlow();
    return;
  }

  showPhoneModal(canonicalPhaseId);
}

async function handlePhoneSubmit(event) {
  event.preventDefault();

  const phoneNumber = elements.phoneNumberInput.value.trim();
  const whatsappNumber = elements.whatsappInput.value.trim();

  if (!phoneNumber || !whatsappNumber) {
    showMessage("Phone and WhatsApp numbers are required.", "error");
    return;
  }

  if (!isValidPhone(phoneNumber) || !isValidPhone(whatsappNumber)) {
    showMessage("Please enter valid phone numbers.", "error");
    return;
  }

  const requestedPhaseId = state.pendingPhaseId;
  state.pendingPhaseId = null;

  try {
    await saveUserProfile(phoneNumber, whatsappNumber);
    hidePhoneModal();

    if (requestedPhaseId) {
      await requestBookingForPhase(requestedPhaseId, phoneNumber, whatsappNumber);
      return;
    }

    showMessage("Profile saved.", "success");
  } catch (error) {
    if (requestedPhaseId) {
      state.pendingPhaseId = requestedPhaseId;
    }

    if (isPermissionDeniedError(error)) {
      showMessage("Profile save blocked by Firestore rules. Allow users/{uid} write for that uid.", "error");
    } else {
      showMessage(`Failed to save profile: ${error.message}`, "error");
    }
  }
}

function bindEvents() {
  elements.loginBtn.addEventListener("click", () => {
    registerSoundEngineUserInteraction();
    openLoginFlow();
  });
  elements.logoutBtn.addEventListener("click", () => {
    registerSoundEngineUserInteraction();
    void handleLogout();
  });
  elements.loginModalBtn.addEventListener("click", () => {
    registerSoundEngineUserInteraction();
    void handleLogin();
  });
  elements.loginModalCloseBtn.addEventListener("click", () => {
    registerSoundEngineUserInteraction();
    hideLoginModal();
  });
  elements.openBrowserBtn.addEventListener("click", () => {
    registerSoundEngineUserInteraction();
    openCurrentPageInBrowser();
  });
  elements.copyLinkBtn.addEventListener("click", () => {
    registerSoundEngineUserInteraction();
    void copyCurrentPageLink();
  });
  elements.inAppCloseBtn.addEventListener("click", () => {
    registerSoundEngineUserInteraction();
    hideInAppModal();
  });
  elements.phoneForm.addEventListener("submit", (event) => {
    registerSoundEngineUserInteraction();
    void handlePhoneSubmit(event);
  });
  elements.phoneCancelBtn.addEventListener("click", () => {
    registerSoundEngineUserInteraction();
    state.pendingPhaseId = null;
    hidePhoneModal();
  });
  if (elements.adminChip) {
    elements.adminChip.addEventListener("click", () => {
      registerSoundEngineUserInteraction();
      if (!state.isAdmin) {
        return;
      }
      elements.adminPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  elements.phaseFilterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      registerSoundEngineUserInteraction();
      const nextTrack = button.dataset.phaseFilter;
      if (!nextTrack || nextTrack === state.selectedPhaseTrack) {
        return;
      }
      state.selectedPhaseTrack = nextTrack;
      renderPhases();
    });
  });

  elements.adminTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      registerSoundEngineUserInteraction();
      const nextTab = button.dataset.adminTab;
      if (!nextTab || nextTab === state.selectedAdminTab) {
        return;
      }
      state.selectedAdminTab = nextTab;
      renderAdminPanel();
    });
  });

  if (elements.speechTestBtn) {
    elements.speechTestBtn.onclick = () => {
      registerSoundEngineUserInteraction();
      const speakResult = speakNotification("Test sound working");
      if (!speakResult.ok && speakResult.reason === "speech-not-supported") {
        showMessage("SpeechSynthesis is not supported in this browser.", "error");
        return;
      }
      if (!speakResult.ok) {
        showMessage(`Voice test blocked: ${speakResult.reason}.`, "info");
        return;
      }
      showMessage("Voice test triggered. You should hear: Test sound working.", "success");
    };
  }
}

async function setupFirebase() {
  try {
    const [appSdk, authSdk, firestoreSdk] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js")
    ]);

    const firebaseApp = appSdk.initializeApp(firebaseConfig);
    auth = authSdk.getAuth(firebaseApp);
    db = firestoreSdk.getFirestore(firebaseApp);
    provider = new authSdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    onAuthStateChangedFn = authSdk.onAuthStateChanged;
    signInWithPopupFn = authSdk.signInWithPopup;
    signInWithRedirectFn = authSdk.signInWithRedirect;
    getRedirectResultFn = authSdk.getRedirectResult;
    signOutFn = authSdk.signOut;

    collectionFn = firestoreSdk.collection;
    queryFn = firestoreSdk.query;
    whereFn = firestoreSdk.where;
    onSnapshotFn = firestoreSdk.onSnapshot;
    runTransactionFn = firestoreSdk.runTransaction;
    docFn = firestoreSdk.doc;
    setDocFn = firestoreSdk.setDoc;
    serverTimestampFn = firestoreSdk.serverTimestamp;
    arrayUnionFn = firestoreSdk.arrayUnion;
    arrayRemoveFn = firestoreSdk.arrayRemove;
    timestampClass = firestoreSdk.Timestamp;

    state.firebaseReady = true;
    return true;
  } catch (error) {
    state.firebaseReady = false;
    showMessage(`Firebase init failed: ${error.message}`, "error");
    return false;
  }
}

function cleanup() {
  clearUserScopedListeners();
  clearAdminListener();

  if (state.phasesUnsubscribe) {
    state.phasesUnsubscribe();
    state.phasesUnsubscribe = null;
  }
}

async function initializeApp() {
  initializeSoundEngine({
    onlyWhenTabActive: true,
    adminOnly: true,
    language: "en-US"
  });

  renderPhases();
  renderAdminPanel();
  bindEvents();
  showMessage("Loading phases from Firestore...", "info");
  applyBrowserEnvironmentGuard();
  updateAuthButtons();

  const firebaseOk = await setupFirebase();
  updateAuthButtons();
  updateProfileUI();

  if (!firebaseOk) {
    return;
  }

  subscribeToPhases();

  if (auth && onAuthStateChangedFn) {
    onAuthStateChangedFn(auth, (user) => {
      void onAuthStateChangedHandler(user);
    });
  }

  await processRedirectLoginResult();
}

window.addEventListener("beforeunload", cleanup);
initializeApp();
