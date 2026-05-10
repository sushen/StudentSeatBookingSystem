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
import {
  getLessonById,
  getLessonCatalogPhaseIds,
  getLessonCountForPhase,
  getLessonsForPhase
} from "./learning/lessonCatalog.js";
import {
  computeFeatureUnlocks,
  isLessonUnlocked,
  normalizeLessonIdArray,
  toProgressPercent
} from "./learning/progression.js";

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
const FUNCTIONS_REGION = "asia-south1";
const DELETE_ACCOUNT_CONFIRM_TOKEN = "DELETE";

const BOOKING_STATUS_PENDING = "pending";
const BOOKING_STATUS_REVIEWING = "reviewing";
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
let functionsService = null;

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
let httpsCallableFn = null;
let bookingUiTicker = null;

const elements = {
  authLanding: document.getElementById("authLanding"),
  appShell: document.getElementById("appShell"),
  workspaceNav: document.getElementById("workspaceNav"),
  workspaceNavButtons: Array.from(document.querySelectorAll("[data-nav-section]")),
  topbarSectionLabel: document.getElementById("topbarSectionLabel"),
  topbarProgressLabel: document.getElementById("topbarProgressLabel"),
  topbarBookingLabel: document.getElementById("topbarBookingLabel"),
  homePanel: document.getElementById("homePanel"),
  homeWelcomeName: document.getElementById("homeWelcomeName"),
  homeUnlockedPhasesCount: document.getElementById("homeUnlockedPhasesCount"),
  homeCompletedPhasesCount: document.getElementById("homeCompletedPhasesCount"),
  homePendingRequestsCount: document.getElementById("homePendingRequestsCount"),
  homeProgressPercent: document.getElementById("homeProgressPercent"),
  homeProgressBarFill: document.getElementById("homeProgressBarFill"),
  homeContinueTitle: document.getElementById("homeContinueTitle"),
  homeContinueSubtitle: document.getElementById("homeContinueSubtitle"),
  homeStartLearningBtn: document.getElementById("homeStartLearningBtn"),
  homeContinueBtn: document.getElementById("homeContinueBtn"),
  overviewPanel: document.getElementById("overviewPanel"),
  learningSummaryTrack: document.getElementById("learningSummaryTrack"),
  learningSummaryPhase: document.getElementById("learningSummaryPhase"),
  learningSummaryOverall: document.getElementById("learningSummaryOverall"),
  phaseFilterButtons: Array.from(document.querySelectorAll("[data-phase-filter]")),
  phaseList: document.getElementById("phaseList"),
  messageBox: document.getElementById("messageBox"),
  loginBtn: document.getElementById("loginBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  profilePanel: document.getElementById("profilePanel"),
  profileCard: document.getElementById("profileCard"),
  profileName: document.getElementById("profileName"),
  profileEmail: document.getElementById("profileEmail"),
  profilePhoneNumber: document.getElementById("profilePhoneNumber"),
  profileWhatsapp: document.getElementById("profileWhatsapp"),
  profileReferralCode: document.getElementById("profileReferralCode"),
  profileInviteCount: document.getElementById("profileInviteCount"),
  profileConversionCount: document.getElementById("profileConversionCount"),
  profileInviteBtn: document.getElementById("profileInviteBtn"),
  profileSignOutBtn: document.getElementById("profileSignOutBtn"),
  editProfileBtn: document.getElementById("editProfileBtn"),
  deleteAccountBtn: document.getElementById("deleteAccountBtn"),
  adminChip: document.getElementById("adminChip"),
  learningPanel: document.getElementById("learningPanel"),
  learningProgressText: document.getElementById("learningProgressText"),
  learningProgressBarFill: document.getElementById("learningProgressBarFill"),
  learningCurrentPhaseTitle: document.getElementById("learningCurrentPhaseTitle"),
  learningCurrentPhaseDescription: document.getElementById("learningCurrentPhaseDescription"),
  learningCurrentPhaseProgressValue: document.getElementById("learningCurrentPhaseProgressValue"),
  learningCurrentPhaseProgressFill: document.getElementById("learningCurrentPhaseProgressFill"),
  learningCurrentPhaseLessonCount: document.getElementById("learningCurrentPhaseLessonCount"),
  learningContinueBtn: document.getElementById("learningContinueBtn"),
  classroomPanel: document.getElementById("classroomPanel"),
  classroomBackBtn: document.getElementById("classroomBackBtn"),
  classroomPhaseTitle: document.getElementById("classroomPhaseTitle"),
  classroomProgressBarFill: document.getElementById("classroomProgressBarFill"),
  classroomProgressText: document.getElementById("classroomProgressText"),
  classroomLessonCountText: document.getElementById("classroomLessonCountText"),
  learningPhaseTabs: document.getElementById("learningPhaseTabs"),
  lessonList: document.getElementById("lessonList"),
  lessonDetail: document.getElementById("lessonDetail"),
  lessonTitle: document.getElementById("lessonTitle"),
  lessonConcept: document.getElementById("lessonConcept"),
  lessonExample: document.getElementById("lessonExample"),
  lessonExercise: document.getElementById("lessonExercise"),
  lessonReflectionPrompt: document.getElementById("lessonReflectionPrompt"),
  lessonReflectionInput: document.getElementById("lessonReflectionInput"),
  completeLessonBtn: document.getElementById("completeLessonBtn"),
  lessonEmpty: document.getElementById("lessonEmpty"),
  featureGatePanel: document.getElementById("featureGatePanel"),
  featureGateList: document.getElementById("featureGateList"),
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
  whatsappInput: document.getElementById("whatsappInput"),
  phoneSubmitBtn: document.getElementById("phoneSubmitBtn"),
  phoneCancelBtn: document.getElementById("phoneCancelBtn"),
  speechTestBtn: document.getElementById("speechTestBtn"),
  adminPanel: document.getElementById("adminPanel"),
  adminTabButtons: Array.from(document.querySelectorAll("[data-admin-tab]")),
  adminRows: document.getElementById("adminRows"),
  adminEmpty: document.getElementById("adminEmpty"),
  deleteAccountModal: document.getElementById("deleteAccountModal"),
  deleteAccountForm: document.getElementById("deleteAccountForm"),
  deleteAccountConfirmInput: document.getElementById("deleteAccountConfirmInput"),
  deleteAccountConfirmBtn: document.getElementById("deleteAccountConfirmBtn"),
  deleteAccountCancelBtn: document.getElementById("deleteAccountCancelBtn")
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
  selectedNavSection: "home",
  classroomReturnSection: "overview",
  selectedLearningPhaseId: "phase1",
  selectedLessonId: "",
  learningProgressByPhaseId: new Map(),
  learningProgressUnsubscribe: null,
  callablesReady: false,
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

let messageHideTimer = null;

function showMessage(text, type = "info") {
  if (!elements.messageBox) {
    return;
  }
  if (messageHideTimer) {
    clearTimeout(messageHideTimer);
    messageHideTimer = null;
  }
  elements.messageBox.textContent = text;
  elements.messageBox.className = `message ${type}`;
  if (!text) {
    elements.messageBox.classList.add("hidden");
    return;
  }
  elements.messageBox.classList.remove("hidden");
  if (type !== "error") {
    messageHideTimer = window.setTimeout(() => {
      elements.messageBox.classList.add("hidden");
    }, 3500);
  }
}

function refreshLucideIcons() {
  try {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  } catch (error) {
    void error;
  }
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

async function callBackendFunction(name, data = {}) {
  if (!state.callablesReady || !httpsCallableFn || !functionsService) {
    throw makeAppError("functions-unavailable", "Cloud Functions are not initialized.");
  }

  const fn = httpsCallableFn(functionsService, name);
  const response = await fn(data);
  return response?.data || null;
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

function toTitleCase(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return "";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
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
    value === BOOKING_STATUS_REVIEWING ||
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

function normalizeLearningProgressDoc(docId, data = {}) {
  const phaseId = canonicalizePhaseId(data.phaseId || docId);
  const completedLessonIds = normalizeLessonIdArray(
    Array.isArray(data.completedLessonIds) ? data.completedLessonIds : data.completedLessons
  );
  const reflections = typeof data.reflections === "object" && data.reflections !== null
    ? { ...data.reflections }
    : {};
  const lessonCount = getLessonCountForPhase(phaseId);
  const progressPercent = typeof data.progressPercent === "number"
    ? Math.max(0, Math.min(100, data.progressPercent))
    : toProgressPercent(completedLessonIds.length, lessonCount);

  return {
    phaseId,
    completedLessonIds,
    completedLessonSet: new Set(completedLessonIds),
    reflections,
    progressPercent,
    updatedAtMs: timestampToMillis(data.updatedAt)
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

function formatRemainingWindow(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "0m";
  }

  const totalMinutes = Math.ceil(durationMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `${minutes}m`;
  }
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

function buildPhaseLifecycleElement(phase, phaseState, booking) {
  const lifecycle = document.createElement("div");
  lifecycle.className = "phase-lifecycle";

  const effectiveStatus = getEffectiveBookingStatus(booking);
  const isTerminalStatus =
    effectiveStatus === BOOKING_STATUS_REJECTED ||
    effectiveStatus === BOOKING_STATUS_CANCELLED ||
    effectiveStatus === BOOKING_STATUS_EXPIRED;

  let activeIndex = -1;
  if (phaseState === PHASE_STATE_UNLOCKED || effectiveStatus === BOOKING_STATUS_APPROVED || phase.phaseId === "phase1") {
    activeIndex = 2;
  } else if (effectiveStatus === BOOKING_STATUS_REVIEWING) {
    activeIndex = 1;
  } else if (effectiveStatus === BOOKING_STATUS_PENDING) {
    activeIndex = 0;
  }

  const steps = [
    "Requested",
    "Reviewing",
    "Approved"
  ];

  steps.forEach((label, index) => {
    const step = document.createElement("span");
    step.className = "phase-lifecycle-step";
    step.textContent = label;
    if (index <= activeIndex) {
      step.classList.add("done");
    }
    if (index === activeIndex) {
      step.classList.add("current");
    }
    if (isTerminalStatus) {
      step.classList.add("muted");
    }
    lifecycle.appendChild(step);
  });

  return lifecycle;
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
  if (status === BOOKING_STATUS_REVIEWING) {
    return "reviewing";
  }
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
    (booking.status === BOOKING_STATUS_PENDING || booking.status === BOOKING_STATUS_REVIEWING) &&
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

function getCompletedPhaseSet() {
  const completedSet = new Set((state.profile?.completedPhases || []).map(canonicalizePhaseId));
  state.learningProgressByPhaseId.forEach((progress, phaseId) => {
    if (progress.progressPercent >= 100) {
      completedSet.add(canonicalizePhaseId(phaseId));
    }
  });
  return completedSet;
}

function getMissingCompletionPrerequisitePhase(phaseId, completedPhaseSet) {
  const previousPhase = getPreviousPhase(phaseId);
  if (!previousPhase) {
    return null;
  }
  if (completedPhaseSet.has(previousPhase.phaseId)) {
    return null;
  }
  return previousPhase;
}

function isPhaseClassroomAccessible(phaseId, unlockedPhaseSet) {
  const canonicalPhaseId = canonicalizePhaseId(phaseId);
  if (canonicalPhaseId === "phase1") {
    return true;
  }
  return unlockedPhaseSet.has(canonicalPhaseId);
}

function resolvePhaseState(phaseId, unlockedPhaseSet) {
  const canonicalPhaseId = canonicalizePhaseId(phaseId);
  if (canonicalPhaseId === "phase1") {
    return { phaseState: PHASE_STATE_UNLOCKED, booking: null };
  }

  const booking = state.userBookingsByPhaseId.get(phaseId) || null;
  const effectiveStatus = getEffectiveBookingStatus(booking);

  if (unlockedPhaseSet.has(phaseId) || booking?.status === BOOKING_STATUS_APPROVED) {
    return { phaseState: PHASE_STATE_UNLOCKED, booking };
  }
  if (effectiveStatus === BOOKING_STATUS_PENDING || effectiveStatus === BOOKING_STATUS_REVIEWING) {
    return { phaseState: PHASE_STATE_PENDING, booking };
  }
  if (effectiveStatus === BOOKING_STATUS_EXPIRED) {
    return { phaseState: PHASE_STATE_LOCKED, booking: { ...booking, status: BOOKING_STATUS_EXPIRED } };
  }
  return { phaseState: PHASE_STATE_LOCKED, booking };
}

function buildPhaseStatusText(phase, phaseState, booking, missingPrerequisitePhase) {
  if (phase.phaseId === "phase1") {
    return state.user
      ? "Teacher approved this classroom. You can enter now."
      : "Login to open the classroom.";
  }
  if (phaseState === PHASE_STATE_UNLOCKED) {
    return "Approved and unlocked.";
  }
  if (phaseState === PHASE_STATE_PENDING) {
    const remainingMs = Number(booking?.expiresAtMs || 0) - Date.now();
    const remainingText = formatRemainingWindow(remainingMs);

    if (booking?.status === BOOKING_STATUS_REVIEWING) {
      if (booking?.expiresAtMs && remainingMs > 0) {
        return `Under teacher review. Approval window: ${remainingText} remaining.`;
      }
      return "Your request is under teacher review.";
    }
    if (booking?.expiresAtMs && remainingMs > 0) {
      return `Waiting for approval. Booking window: ${remainingText} remaining.`;
    }
    return "Waiting for admin approval.";
  }
  if (missingPrerequisitePhase) {
    return `Complete ${missingPrerequisitePhase.title} lessons before requesting this phase.`;
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
  if (!elements.phaseList) {
    return;
  }

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
  const completedPhaseSet = getCompletedPhaseSet();
  const selectedTrack = state.selectedPhaseTrack || PHASE_TRACK_BEGINNER;
  const visiblePhases = sortedPhases.filter((phase) => toTrackName(phase.level) === selectedTrack);
  const summaryPhase = visiblePhases[0] || sortedPhases[0];
  const summaryProgress = summaryPhase ? getPhaseLearningProgress(summaryPhase.phaseId).progressPercent : 0;
  const completedCount = Array.from(completedPhaseSet.values()).filter(Boolean).length;
  const overallProgress = computeOverallProgressFromMap();

  if (elements.learningSummaryTrack) {
    elements.learningSummaryTrack.textContent = `Current Track: ${toTitleCase(selectedTrack)}`;
  }
  if (elements.learningSummaryPhase) {
    elements.learningSummaryPhase.textContent = summaryPhase
      ? `Active Phase: ${summaryPhase.title} (${summaryProgress}%)`
      : "Active Phase: -";
  }
  if (elements.learningSummaryOverall) {
    elements.learningSummaryOverall.textContent = `Overall Learning: ${overallProgress}% - ${completedCount}/${CANONICAL_PHASES.length} phases complete`;
  }

  if (visiblePhases.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "phase-empty";
    emptyState.textContent = "No phases available in this track.";
    elements.phaseList.appendChild(emptyState);
    return;
  }

  visiblePhases.forEach((phase) => {
    const { phaseState, booking } = resolvePhaseState(phase.phaseId, unlockedPhaseSet);
    const missingPrerequisitePhase = getMissingCompletionPrerequisitePhase(phase.phaseId, completedPhaseSet);
    const phaseIsFull = phase.phaseId === "phase1" ? false : isPhaseFull(phase);

    const card = document.createElement("article");
    card.className = "phase-card";
    card.classList.toggle("phase-card-full", phaseIsFull);

    const header = document.createElement("div");
    header.className = "phase-card-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "phase-title-wrap";

    const phaseIndex = document.createElement("p");
    phaseIndex.className = "phase-index";
    phaseIndex.textContent = `Phase ${phase.order}`;

    const title = document.createElement("h3");
    title.className = "phase-title";
    title.textContent = phase.title;

    const subtitle = document.createElement("p");
    subtitle.className = "phase-subtitle";
    subtitle.textContent = `Level: ${phase.level}`;

    titleWrap.appendChild(phaseIndex);
    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);

    const stateBadge = document.createElement("span");
    stateBadge.className = "phase-state";
    if (phaseState === PHASE_STATE_UNLOCKED) {
      stateBadge.classList.add("unlocked");
      stateBadge.textContent = "APPROVED";
    } else if (phaseState === PHASE_STATE_PENDING) {
      if (booking?.status === BOOKING_STATUS_REVIEWING) {
        stateBadge.classList.add("reviewing");
        stateBadge.textContent = "REVIEWING";
      } else {
        stateBadge.classList.add("pending");
        stateBadge.textContent = "PENDING";
      }
    } else {
      stateBadge.classList.add("locked");
      stateBadge.textContent = "LOCKED";
    }

    header.appendChild(titleWrap);
    header.appendChild(stateBadge);

    const description = document.createElement("p");
    description.className = "phase-description";
    description.textContent = phase.description || "No description.";

    const meta = document.createElement("p");
    meta.className = "phase-meta";
    if (phase.phaseId === "phase1") {
      meta.textContent = "Open classroom access";
    } else {
      const availableSeats = Math.max(phase.totalSeats - phase.bookedSeats, 0);
      meta.textContent = `Seats available: ${availableSeats} / ${phase.totalSeats}`;
    }

    const statusText = document.createElement("p");
    statusText.className = "phase-status-text";
    statusText.textContent = buildPhaseStatusText(phase, phaseState, booking, missingPrerequisitePhase);

    const lifecycle = buildPhaseLifecycleElement(phase, phaseState, booking);

    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.className = "phase-action-btn";

    if (phaseState === PHASE_STATE_LOCKED) {
      if (missingPrerequisitePhase || phaseIsFull) {
        actionButton.disabled = true;
        actionButton.textContent = phaseIsFull ? "No Seats Available" : "Locked";
      } else {
        actionButton.disabled = false;
        actionButton.textContent = !state.user
          ? "Login to Book Seat"
          : booking?.status === BOOKING_STATUS_EXPIRED ||
              booking?.status === BOOKING_STATUS_REJECTED ||
              booking?.status === BOOKING_STATUS_CANCELLED
            ? "Request Again"
            : "Book Seat";
        actionButton.addEventListener("click", () => {
          void handlePhaseClick(phase.phaseId);
        });
      }
    } else if (phaseState === PHASE_STATE_PENDING) {
      actionButton.disabled = true;
      actionButton.textContent = booking?.status === BOOKING_STATUS_REVIEWING ? "Under Review" : "Waiting Approval";
    } else {
      actionButton.disabled = false;
      actionButton.textContent = "Enter Classroom";
      actionButton.addEventListener("click", () => {
        navigateToClassroom(phase.phaseId, "overview");
      });
    }

    card.appendChild(header);
    card.appendChild(description);
    card.appendChild(meta);
    card.appendChild(statusText);
    card.appendChild(lifecycle);
    card.appendChild(actionButton);
    elements.phaseList.appendChild(card);
  });
}

function getPhaseLearningProgress(phaseId) {
  const canonicalPhaseId = canonicalizePhaseId(phaseId);
  const existing = state.learningProgressByPhaseId.get(canonicalPhaseId);
  if (existing) {
    return existing;
  }
  return normalizeLearningProgressDoc(canonicalPhaseId, { phaseId: canonicalPhaseId });
}

function computeOverallProgressFromMap(progressByPhaseId = state.learningProgressByPhaseId) {
  const phaseIds = getLessonCatalogPhaseIds();
  let totalLessons = 0;
  let completedLessons = 0;

  phaseIds.forEach((phaseId) => {
    const lessonCount = getLessonCountForPhase(phaseId);
    totalLessons += lessonCount;

    const progress = progressByPhaseId.get(phaseId) || getPhaseLearningProgress(phaseId);
    completedLessons += progress.completedLessonIds.length;
  });

  return toProgressPercent(completedLessons, totalLessons);
}

function getLearningAccessInfo(phaseId, unlockedPhaseSet, completedPhaseSet) {
  const canonicalPhaseId = canonicalizePhaseId(phaseId);
  if (!state.user) {
    return { accessible: false, reason: "Login required." };
  }
  if (canonicalPhaseId === "phase1") {
    return { accessible: true, reason: "" };
  }

  const missingPrerequisitePhase = getMissingCompletionPrerequisitePhase(canonicalPhaseId, completedPhaseSet);
  if (missingPrerequisitePhase) {
    return { accessible: false, reason: `Complete ${missingPrerequisitePhase.title} first.` };
  }

  if (!isPhaseClassroomAccessible(canonicalPhaseId, unlockedPhaseSet)) {
    return { accessible: false, reason: "Wait for teacher approval for this phase." };
  }

  return { accessible: true, reason: "" };
}

function getNextOpenLessonId(phaseId, lessons, completedLessonSet) {
  for (const lesson of lessons) {
    if (!completedLessonSet.has(lesson.lessonId)) {
      return lesson.lessonId;
    }
  }
  return lessons[lessons.length - 1]?.lessonId || "";
}

function ensureSelectedLearningPhase(unlockedPhaseSet, completedPhaseSet) {
  const catalogPhaseIds = getLessonCatalogPhaseIds();
  const selectedPhaseId = canonicalizePhaseId(state.selectedLearningPhaseId || "phase1");
  if (catalogPhaseIds.includes(selectedPhaseId)) {
    return selectedPhaseId;
  }

  const firstAccessiblePhase = catalogPhaseIds.find((phaseId) => {
    const access = getLearningAccessInfo(phaseId, unlockedPhaseSet, completedPhaseSet);
    return access.accessible;
  });

  state.selectedLearningPhaseId = firstAccessiblePhase || "phase1";
  return state.selectedLearningPhaseId;
}

function renderLearningPhaseTabs(unlockedPhaseSet, completedPhaseSet) {
  if (!elements.learningPhaseTabs) {
    return;
  }

  elements.learningPhaseTabs.innerHTML = "";
  const catalogPhaseIds = getLessonCatalogPhaseIds();

  catalogPhaseIds.forEach((phaseId) => {
    const phase = getPhaseById(phaseId) || { title: phaseId };
    const access = getLearningAccessInfo(phaseId, unlockedPhaseSet, completedPhaseSet);
    const progress = getPhaseLearningProgress(phaseId);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "learning-phase-tab";
    button.classList.toggle("active", canonicalizePhaseId(state.selectedLearningPhaseId) === phaseId);
    button.classList.toggle("locked", !access.accessible);
    button.disabled = !access.accessible;
    button.textContent = `${phase.title} (${progress.progressPercent}%)`;
    button.addEventListener("click", () => {
      selectLearningPhase(phaseId, false);
    });
    elements.learningPhaseTabs.appendChild(button);
  });
}

function renderLessonListForPhase(phaseId, accessInfo) {
  if (!elements.lessonList) {
    return;
  }

  elements.lessonList.innerHTML = "";
  const lessons = getLessonsForPhase(phaseId);
  const progress = getPhaseLearningProgress(phaseId);
  const completedSet = progress.completedLessonSet;
  const completedCount = progress.completedLessonIds.length;

  if (!accessInfo.accessible) {
    const p = document.createElement("p");
    p.className = "learning-empty";
    p.textContent = accessInfo.reason;
    elements.lessonList.appendChild(p);
    return;
  }

  lessons.forEach((lesson, lessonIndex) => {
    const row = document.createElement("article");
    row.className = "lesson-item";

    const isCompleted = completedSet.has(lesson.lessonId);
    const unlockedForAttempt = isLessonUnlocked(lessonIndex, completedCount);
    const canOpen = isCompleted || unlockedForAttempt;
    row.classList.toggle("completed", isCompleted);
    row.classList.toggle("current", !isCompleted && unlockedForAttempt);
    row.classList.toggle("locked", !canOpen);

    const icon = document.createElement("span");
    icon.className = "lesson-item-icon";
    icon.textContent = isCompleted ? "v" : unlockedForAttempt ? ">" : "x";

    const left = document.createElement("div");
    const title = document.createElement("p");
    title.className = "lesson-item-title";
    title.textContent = lesson.title;
    const subtitle = document.createElement("p");
    subtitle.className = "lesson-item-subtitle";
    subtitle.textContent = "Blocks: Concept - Example - Exercise - Reflection";
    left.appendChild(title);
    left.appendChild(subtitle);
    subtitle.textContent = `Step ${lessonIndex + 1} of ${lessons.length}`;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "lesson-item-btn";
    button.disabled = !canOpen;
    button.textContent = isCompleted ? "v" : "";
    button.addEventListener("click", () => {
      if (!canOpen) {
        return;
      }
      state.selectedLessonId = lesson.lessonId;
      renderClassroomPanel();
    });

    row.appendChild(icon);
    row.appendChild(left);
    row.appendChild(button);
    if (canOpen) {
      row.addEventListener("click", () => {
        state.selectedLessonId = lesson.lessonId;
        renderClassroomPanel();
      });
    }
    elements.lessonList.appendChild(row);
  });
}

function renderLessonDetailForPhase(phaseId, accessInfo) {
  if (!elements.lessonDetail || !elements.lessonEmpty) {
    return;
  }

  if (!accessInfo.accessible) {
    elements.lessonDetail.classList.add("hidden");
    elements.lessonEmpty.classList.remove("hidden");
    elements.lessonEmpty.textContent = accessInfo.reason;
    return;
  }

  const lessons = getLessonsForPhase(phaseId);
  if (lessons.length === 0) {
    elements.lessonDetail.classList.add("hidden");
    elements.lessonEmpty.classList.remove("hidden");
    elements.lessonEmpty.textContent = "No lessons configured for this phase.";
    return;
  }

  const progress = getPhaseLearningProgress(phaseId);
  const completedSet = progress.completedLessonSet;
  const completedCount = progress.completedLessonIds.length;

  if (!state.selectedLessonId) {
    elements.lessonDetail.classList.add("hidden");
    elements.lessonEmpty.classList.remove("hidden");
    elements.lessonEmpty.textContent = "Select a lesson to open details.";
    return;
  }

  const selectedLesson = getLessonById(phaseId, state.selectedLessonId) || lessons[0];
  state.selectedLessonId = selectedLesson.lessonId;

  const selectedIndex = lessons.findIndex((lesson) => lesson.lessonId === selectedLesson.lessonId);
  const canOpen = completedSet.has(selectedLesson.lessonId) || isLessonUnlocked(selectedIndex, completedCount);

  if (!canOpen) {
    elements.lessonDetail.classList.add("hidden");
    elements.lessonEmpty.classList.remove("hidden");
    elements.lessonEmpty.textContent = "Finish previous lessons to unlock this one.";
    return;
  }

  elements.lessonTitle.textContent = selectedLesson.title;
  elements.lessonConcept.textContent = selectedLesson.blocks.concept;
  elements.lessonExample.textContent = selectedLesson.blocks.example;
  elements.lessonExercise.textContent = selectedLesson.blocks.exercise;
  elements.lessonReflectionPrompt.textContent = selectedLesson.blocks.reflection;
  elements.lessonReflectionInput.value = progress.reflections?.[selectedLesson.lessonId] || "";

  elements.completeLessonBtn.disabled = completedSet.has(selectedLesson.lessonId);
  elements.completeLessonBtn.textContent = completedSet.has(selectedLesson.lessonId)
    ? "Lesson Completed"
    : "Complete Lesson";

  elements.lessonDetail.classList.remove("hidden");
  elements.lessonEmpty.classList.add("hidden");
}

function renderHomePanel() {
  if (!elements.homePanel || !state.user) {
    return;
  }

  const unlockedPhaseSet = getUnlockedPhaseSet();
  const completedPhaseSet = getCompletedPhaseSet();
  const selectedPhaseId = ensureSelectedLearningPhase(unlockedPhaseSet, completedPhaseSet);
  const selectedPhase = getPhaseById(selectedPhaseId) || { title: "Foundations", order: 1 };
  const phaseProgress = getPhaseLearningProgress(selectedPhaseId);
  const completedLessons = phaseProgress.completedLessonIds.length;
  const totalLessons = getLessonCountForPhase(selectedPhaseId);
  const overallProgress = computeOverallProgressFromMap();
  const pendingRequests = Array.from(state.userBookingsByPhaseId.values()).filter((booking) => {
    const status = getEffectiveBookingStatus(booking);
    return status === BOOKING_STATUS_PENDING || status === BOOKING_STATUS_REVIEWING;
  }).length;
  const unlockedCount = unlockedPhaseSet.size;
  const completedCount = completedPhaseSet.size;
  const shortName = normalizeString(state.profile?.name || state.user?.displayName || "Researcher").split(" ")[0] || "Researcher";

  if (elements.homeWelcomeName) {
    elements.homeWelcomeName.textContent = shortName;
  }
  if (elements.homeUnlockedPhasesCount) {
    elements.homeUnlockedPhasesCount.textContent = String(unlockedCount);
  }
  if (elements.homeCompletedPhasesCount) {
    elements.homeCompletedPhasesCount.textContent = String(completedCount);
  }
  if (elements.homePendingRequestsCount) {
    elements.homePendingRequestsCount.textContent = String(pendingRequests);
  }
  if (elements.homeProgressPercent) {
    elements.homeProgressPercent.textContent = `${overallProgress}%`;
  }
  if (elements.homeProgressBarFill) {
    elements.homeProgressBarFill.style.width = `${overallProgress}%`;
  }
  if (elements.homeContinueTitle) {
    elements.homeContinueTitle.textContent = `${completedLessons} of ${totalLessons} lessons complete`;
  }
  if (elements.homeContinueSubtitle) {
    elements.homeContinueSubtitle.textContent = `Phase ${selectedPhase.order || 1}: ${selectedPhase.title}`;
  }
}

function renderFeatureGatePanel(overallProgress = 0) {
  if (!elements.featureGateList) {
    return;
  }

  const unlocks = computeFeatureUnlocks(overallProgress);
  const featurePresentationById = {
    tradingBot: {
      title: "Install AI Bot",
      note: "Deploy your first neural agent",
      icon: "H"
    },
    investment: {
      title: "Become Part of the Lab",
      note: "Join our core research community",
      icon: "U"
    },
    affiliate: {
      title: "Spread Partnership",
      note: "Share the vision with the world",
      icon: "G"
    }
  };

  elements.featureGateList.innerHTML = "";
  unlocks.forEach((unlock) => {
    const preset = featurePresentationById[unlock.featureId] || {
      title: unlock.title,
      note: unlock.unlocked ? "Unlocked now" : "Complete more phases to unlock",
      icon: ">"
    };

    const card = document.createElement("article");
    card.className = "feature-gate-card";
    card.style.opacity = unlock.unlocked ? "1" : "0.66";

    const icon = document.createElement("span");
    icon.className = "feature-gate-icon";
    icon.textContent = preset.icon;

    const copy = document.createElement("div");
    copy.className = "feature-gate-copy";

    const title = document.createElement("p");
    title.className = "feature-gate-title";
    title.textContent = preset.title;

    const note = document.createElement("p");
    note.className = "feature-gate-note";
    note.textContent = preset.note;

    copy.appendChild(title);
    copy.appendChild(note);

    const action = document.createElement("div");
    action.className = "feature-gate-action";

    const lock = document.createElement("span");
    lock.className = "feature-gate-lock";
    lock.textContent = unlock.unlocked ? "" : "x";

    const arrow = document.createElement("span");
    arrow.className = "feature-gate-arrow";
    arrow.textContent = ">";

    action.appendChild(lock);
    action.appendChild(arrow);

    card.appendChild(icon);
    card.appendChild(copy);
    card.appendChild(action);
    elements.featureGateList.appendChild(card);
  });
}

function renderClassroomPanel() {
  if (!elements.classroomPanel || !state.user) {
    return;
  }

  const unlockedPhaseSet = getUnlockedPhaseSet();
  const completedPhaseSet = getCompletedPhaseSet();
  const selectedPhaseId = ensureSelectedLearningPhase(unlockedPhaseSet, completedPhaseSet);
  const selectedPhase = getPhaseById(selectedPhaseId) || { title: "Foundations", order: 1 };
  const phaseProgress = getPhaseLearningProgress(selectedPhaseId);
  const accessInfo = getLearningAccessInfo(selectedPhaseId, unlockedPhaseSet, completedPhaseSet);
  const totalLessons = getLessonCountForPhase(selectedPhaseId);
  const completedLessons = phaseProgress.completedLessonIds.length;

  if (elements.classroomPhaseTitle) {
    elements.classroomPhaseTitle.textContent = selectedPhase.title;
  }
  if (elements.classroomProgressBarFill) {
    elements.classroomProgressBarFill.style.width = `${phaseProgress.progressPercent}%`;
  }
  if (elements.classroomProgressText) {
    elements.classroomProgressText.textContent = `${phaseProgress.progressPercent}%`;
  }
  if (elements.classroomLessonCountText) {
    elements.classroomLessonCountText.textContent = `${completedLessons} of ${totalLessons} lessons complete`;
  }

  renderLessonListForPhase(selectedPhaseId, accessInfo);
  renderLessonDetailForPhase(selectedPhaseId, accessInfo);
}

function renderLearningPanel() {
  if (!elements.learningPanel || !state.user) {
    return;
  }

  const unlockedPhaseSet = getUnlockedPhaseSet();
  const completedPhaseSet = getCompletedPhaseSet();
  const selectedPhaseId = ensureSelectedLearningPhase(unlockedPhaseSet, completedPhaseSet);
  const selectedPhase = getPhaseById(selectedPhaseId) || { title: "Foundations", description: "" };
  const phaseProgress = getPhaseLearningProgress(selectedPhaseId);
  const overallProgress = computeOverallProgressFromMap();
  const lessonTotal = getLessonCountForPhase(selectedPhaseId);
  const lessonCompleted = phaseProgress.completedLessonIds.length;

  if (elements.learningProgressText) {
    elements.learningProgressText.textContent = `${overallProgress}%`;
  }
  if (elements.learningProgressBarFill) {
    elements.learningProgressBarFill.style.width = `${overallProgress}%`;
  }
  if (elements.learningCurrentPhaseTitle) {
    elements.learningCurrentPhaseTitle.textContent = `Phase ${selectedPhase.order || 1}: ${selectedPhase.title}`;
  }
  if (elements.learningCurrentPhaseDescription) {
    elements.learningCurrentPhaseDescription.textContent = selectedPhase.description || "";
  }
  if (elements.learningCurrentPhaseProgressValue) {
    elements.learningCurrentPhaseProgressValue.textContent = `${phaseProgress.progressPercent}%`;
  }
  if (elements.learningCurrentPhaseProgressFill) {
    elements.learningCurrentPhaseProgressFill.style.width = `${phaseProgress.progressPercent}%`;
  }
  if (elements.learningCurrentPhaseLessonCount) {
    elements.learningCurrentPhaseLessonCount.textContent = `${lessonCompleted} of ${lessonTotal} lessons complete`;
  }

  renderFeatureGatePanel(overallProgress);
  renderClassroomPanel();
  renderHomePanel();

  if (state.profile) {
    state.profile.progress = overallProgress;
    const currentPhaseIsCompleted = phaseProgress.progressPercent >= 100;
    if (currentPhaseIsCompleted && !state.profile.completedPhases.includes(selectedPhaseId)) {
      state.profile.completedPhases = Array.from(new Set([...(state.profile.completedPhases || []), selectedPhaseId]));
    }
  }
}

function selectLearningPhase(phaseId, shouldScroll = false) {
  state.selectedLearningPhaseId = canonicalizePhaseId(phaseId);
  state.selectedLessonId = "";
  renderClassroomPanel();
  if (shouldScroll) {
    navigateToClassroom(phaseId, "overview");
  }
}

async function completeSelectedLesson() {
  if (!state.user || !db || !docFn || !setDocFn || !serverTimestampFn || !arrayUnionFn) {
    showMessage("Login is required to complete lessons.", "error");
    return;
  }

  const phaseId = canonicalizePhaseId(state.selectedLearningPhaseId);
  const lessons = getLessonsForPhase(phaseId);
  if (lessons.length === 0) {
    showMessage("No lessons available for this phase.", "error");
    return;
  }

  const lessonId = state.selectedLessonId;
  const lesson = getLessonById(phaseId, lessonId);
  if (!lesson) {
    showMessage("Select a lesson first.", "error");
    return;
  }

  const reflection = elements.lessonReflectionInput.value.trim();
  if (!reflection) {
    showMessage("Write your reflection before completing this lesson.", "info");
    return;
  }

  const unlockedPhaseSet = getUnlockedPhaseSet();
  const completedPhaseSet = getCompletedPhaseSet();
  const accessInfo = getLearningAccessInfo(phaseId, unlockedPhaseSet, completedPhaseSet);
  if (!accessInfo.accessible) {
    showMessage(accessInfo.reason, "error");
    return;
  }

  const progress = getPhaseLearningProgress(phaseId);
  const completedSet = new Set(progress.completedLessonIds);
  const lessonIndex = lessons.findIndex((item) => item.lessonId === lessonId);

  if (!completedSet.has(lessonId) && !isLessonUnlocked(lessonIndex, progress.completedLessonIds.length)) {
    showMessage("Complete lessons sequentially.", "error");
    return;
  }

  completedSet.add(lessonId);
  const orderedCompletedIds = lessons
    .map((item) => item.lessonId)
    .filter((id) => completedSet.has(id));
  const phaseProgressPercent = toProgressPercent(orderedCompletedIds.length, lessons.length);
  const nextProgress = {
    phaseId,
    completedLessonIds: orderedCompletedIds,
    completedLessonSet: new Set(orderedCompletedIds),
    reflections: {
      ...(progress.reflections || {}),
      [lessonId]: reflection
    },
    progressPercent: phaseProgressPercent,
    updatedAtMs: Date.now()
  };

  const nextMap = new Map(state.learningProgressByPhaseId);
  nextMap.set(phaseId, nextProgress);
  const overallProgress = computeOverallProgressFromMap(nextMap);

  try {
    const progressRef = docFn(db, "users", state.user.uid, "progress", phaseId);
    await setDocFn(progressRef, {
      phaseId,
      completedLessonIds: orderedCompletedIds,
      completedLessons: orderedCompletedIds,
      reflections: nextProgress.reflections,
      completedCount: orderedCompletedIds.length,
      totalLessons: lessons.length,
      progressPercent: phaseProgressPercent,
      lastCompletedLessonId: lessonId,
      updatedAt: serverTimestampFn()
    }, { merge: true });

    const userRef = docFn(db, "users", state.user.uid);
    const userPatch = {
      progress: overallProgress,
      updatedAt: serverTimestampFn()
    };
    if (phaseProgressPercent >= 100) {
      userPatch.completedPhases = arrayUnionFn(phaseId);
    }
    await setDocFn(userRef, userPatch, { merge: true });

    state.learningProgressByPhaseId = nextMap;
    state.profile = {
      ...(state.profile || {}),
      progress: overallProgress,
      completedPhases: phaseProgressPercent >= 100
        ? Array.from(new Set([...(state.profile?.completedPhases || []), phaseId]))
        : (state.profile?.completedPhases || [])
    };

    showMessage(`Lesson completed: ${lesson.title}`, "success");
    renderLearningPanel();
    renderPhases();
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      showMessage("Lesson progress write blocked by Firestore rules.", "error");
    } else {
      showMessage(`Failed to save lesson progress: ${error.message}`, "error");
    }
  }
}

function showDeleteAccountModal() {
  elements.deleteAccountConfirmInput.value = "";
  elements.deleteAccountModal.classList.remove("hidden");
  elements.deleteAccountConfirmInput.focus();
}

function hideDeleteAccountModal() {
  elements.deleteAccountModal.classList.add("hidden");
}

async function handleDeleteAccount(event) {
  event.preventDefault();

  if (!state.user) {
    showMessage("Please login first.", "error");
    return;
  }

  const confirmation = elements.deleteAccountConfirmInput.value.trim();
  if (confirmation !== DELETE_ACCOUNT_CONFIRM_TOKEN) {
    showMessage("Type DELETE to confirm permanent account deletion.", "error");
    return;
  }

  try {
    await callBackendFunction("deleteAccountCascade", {
      confirmation: DELETE_ACCOUNT_CONFIRM_TOKEN
    });

    hideDeleteAccountModal();
    showMessage("Account deleted permanently.", "success");
    await handleLogout();
  } catch (error) {
    if (error?.code === "functions-unavailable") {
      showMessage("Account deletion service is not available. Deploy Cloud Functions first.", "error");
    } else {
      showMessage(`Account deletion failed: ${error.message}`, "error");
    }
  }
}

function getNavTargetElement(sectionKey) {
  if (sectionKey === "home") {
    return elements.homePanel;
  }
  if (sectionKey === "profile") {
    return elements.profilePanel;
  }
  if (sectionKey === "learning") {
    return elements.learningPanel;
  }
  if (sectionKey === "features") {
    return elements.featureGatePanel;
  }
  if (sectionKey === "classroom") {
    return elements.classroomPanel;
  }
  if (sectionKey === "admin") {
    return elements.adminPanel;
  }
  return elements.overviewPanel;
}

function getSectionDisplayName(sectionKey) {
  if (sectionKey === "home") {
    return "Home";
  }
  if (sectionKey === "overview") {
    return "Courses";
  }
  if (sectionKey === "learning") {
    return "My Learning";
  }
  if (sectionKey === "features") {
    return "Advanced";
  }
  if (sectionKey === "profile") {
    return "Profile";
  }
  if (sectionKey === "classroom") {
    return "Classroom";
  }
  if (sectionKey === "admin") {
    return "Admin";
  }
  return "Workspace";
}

function updateTopbarContext() {
  if (!elements.topbarSectionLabel || !elements.topbarProgressLabel || !elements.topbarBookingLabel) {
    return;
  }

  elements.topbarSectionLabel.textContent = getSectionDisplayName(state.selectedNavSection);

  if (!state.user) {
    elements.topbarProgressLabel.textContent = "Progress 0%";
    elements.topbarBookingLabel.textContent = "Sign in to continue";
    return;
  }

  const overallProgress = computeOverallProgressFromMap();
  const pendingCount = Array.from(state.userBookingsByPhaseId.values()).filter((booking) => {
    const status = getEffectiveBookingStatus(booking);
    return status === BOOKING_STATUS_PENDING || status === BOOKING_STATUS_REVIEWING;
  }).length;

  elements.topbarProgressLabel.textContent = `Progress ${overallProgress}%`;
  if (state.isAdmin) {
    elements.topbarBookingLabel.textContent = "Admin moderation enabled";
  } else if (pendingCount > 0) {
    elements.topbarBookingLabel.textContent = `${pendingCount} booking request${pendingCount > 1 ? "s" : ""} in queue`;
  } else {
    elements.topbarBookingLabel.textContent = "No active bookings";
  }
}

function isNavSectionAvailable(sectionKey) {
  if (sectionKey === "admin") {
    return Boolean(state.user && state.isAdmin);
  }
  return Boolean(
    state.user &&
      (sectionKey === "home" ||
        sectionKey === "overview" ||
        sectionKey === "learning" ||
        sectionKey === "features" ||
        sectionKey === "profile" ||
        sectionKey === "classroom")
  );
}

function ensureValidNavSection() {
  if (isNavSectionAvailable(state.selectedNavSection)) {
    return;
  }
  state.selectedNavSection = state.user ? "home" : "home";
}

function renderSectionVisibility() {
  const shouldShowAppShell = Boolean(state.user);
  if (elements.authLanding) {
    elements.authLanding.classList.toggle("hidden", shouldShowAppShell);
  }
  if (elements.appShell) {
    elements.appShell.classList.toggle("hidden", !shouldShowAppShell);
  }
  if (elements.workspaceNav) {
    elements.workspaceNav.classList.toggle("hidden", !shouldShowAppShell);
  }
  if (!shouldShowAppShell) {
    return;
  }

  const panelsByKey = new Map([
    ["home", elements.homePanel],
    ["overview", elements.overviewPanel],
    ["learning", elements.learningPanel],
    ["features", elements.featureGatePanel],
    ["profile", elements.profilePanel],
    ["classroom", elements.classroomPanel],
    ["admin", elements.adminPanel]
  ]);

  panelsByKey.forEach((panel, key) => {
    if (!panel) {
      return;
    }
    panel.classList.toggle("hidden", state.selectedNavSection !== key);
  });
}

function renderWorkspaceNavigation() {
  if (!elements.workspaceNav) {
    return;
  }

  ensureValidNavSection();

  elements.workspaceNavButtons.forEach((button) => {
    const sectionKey = button.dataset.navSection || "overview";
    const adminOnly = button.dataset.navAdminOnly === "true";
    if (adminOnly) {
      button.classList.add("hidden");
    }

    button.disabled = !isNavSectionAvailable(sectionKey);
    button.classList.toggle("active", state.selectedNavSection === sectionKey);
  });

  renderSectionVisibility();
  updateTopbarContext();
  refreshLucideIcons();
}

function navigateToSection(sectionKey, { smooth = true } = {}) {
  void smooth;
  if (!isNavSectionAvailable(sectionKey)) {
    if (!state.user) {
      showMessage("Please log in to access this section.", "info");
      openLoginFlow();
      return;
    }
    showMessage("Admin access required for this section.", "error");
    return;
  }

  state.selectedNavSection = sectionKey;
  renderWorkspaceNavigation();
}

function navigateToClassroom(phaseId, fromSection = state.selectedNavSection) {
  state.selectedLearningPhaseId = canonicalizePhaseId(phaseId);
  state.selectedLessonId = "";
  if (fromSection !== "classroom") {
    state.classroomReturnSection = fromSection;
  }
  state.selectedNavSection = "classroom";
  renderClassroomPanel();
  renderWorkspaceNavigation();
}

function renderAdminPanel() {
  if (!elements.adminPanel || !elements.adminRows || !elements.adminEmpty) {
    return;
  }

  elements.adminTabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.adminTab === state.selectedAdminTab);
  });

  if (!state.isAdmin) {
    elements.adminRows.innerHTML = "";
    elements.adminEmpty.classList.add("hidden");
    renderWorkspaceNavigation();
    return;
  }

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
      : "No pending or reviewing bookings right now.";
    elements.adminEmpty.classList.remove("hidden");
    renderWorkspaceNavigation();
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

    if (effectiveStatus === BOOKING_STATUS_PENDING || effectiveStatus === BOOKING_STATUS_REVIEWING) {
      if (effectiveStatus === BOOKING_STATUS_PENDING) {
        const reviewingBtn = document.createElement("button");
        reviewingBtn.type = "button";
        reviewingBtn.className = "admin-action-btn cancel";
        reviewingBtn.textContent = "Reviewing";
        reviewingBtn.addEventListener("click", () => {
          void moveBookingToReviewingByAdmin(booking);
        });
        actionsCell.appendChild(reviewingBtn);
      }

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

  renderWorkspaceNavigation();
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
  if (elements.profileSignOutBtn) {
    elements.profileSignOutBtn.disabled = !state.firebaseReady || !isSignedIn;
  }

  elements.loginBtn.title = loginBlocked ? blockTitle : "";
  elements.loginModalBtn.title = loginBlocked ? blockTitle : "";
  renderSectionVisibility();
}

function updateProfileUI() {
  if (!state.user || !state.profile) {
    elements.profileCard.classList.add("hidden");
    if (elements.adminChip) {
      elements.adminChip.classList.add("hidden");
    }
    if (elements.profileReferralCode) {
      elements.profileReferralCode.textContent = "------";
    }
    if (elements.profileInviteCount) {
      elements.profileInviteCount.textContent = "0";
    }
    if (elements.profileConversionCount) {
      elements.profileConversionCount.textContent = "0";
    }
    renderWorkspaceNavigation();
    return;
  }

  elements.profileCard.classList.remove("hidden");
  elements.profileName.textContent = state.profile.name || "-";
  elements.profileEmail.textContent = state.profile.email || "-";
  elements.profilePhoneNumber.textContent = state.profile.phoneNumber || "-";
  elements.profileWhatsapp.textContent = state.profile.whatsappNumber || "-";
  if (elements.profileReferralCode) {
    const referralSeed = normalizeString(
      state.profile.referralCode || state.profile.referral || state.user.uid || ""
    ).replace(/[^a-z0-9]/gi, "").toUpperCase();
    elements.profileReferralCode.textContent = referralSeed ? referralSeed.slice(0, 6).padEnd(6, "X") : "------";
  }
  if (elements.profileInviteCount) {
    elements.profileInviteCount.textContent = String(Math.max(0, Number(state.profile.invites || state.profile.inviteCount || 0)));
  }
  if (elements.profileConversionCount) {
    elements.profileConversionCount.textContent = String(Math.max(0, Number(state.profile.conversions || state.profile.conversionCount || 0)));
  }

  if (elements.adminChip) {
    elements.adminChip.classList.toggle("hidden", !state.isAdmin);
  }

  renderHomePanel();
  renderLearningPanel();
  renderWorkspaceNavigation();
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
    ? "Enter booking WhatsApp number"
    : "Update WhatsApp number";
  elements.phoneSubmitBtn.textContent = isBookingFlow
    ? "Submit Booking"
    : "Save Profile";

  elements.whatsappInput.value = state.profile?.whatsappNumber || state.profile?.phone || "";

  elements.phoneModal.classList.remove("hidden");
  elements.whatsappInput.focus();
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

async function saveUserProfile(whatsappNumber) {
  if (!state.user) {
    throw new Error("User not authenticated.");
  }
  if (!db || !docFn || !setDocFn || !serverTimestampFn) {
    throw new Error("Firestore is not initialized.");
  }

  const phoneNumber = whatsappNumber;

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
  renderLearningPanel();
}

function buildBookingPayload(bookingId, userId, canonicalPhaseId, whatsappNumber) {
  const phoneNumber = whatsappNumber;
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

async function requestBookingForPhase(phaseId, whatsappNumber) {
  if (!state.firebaseReady || !db) {
    showMessage("Firestore is not ready.", "error");
    return false;
  }
  if (!state.user) {
    showMessage("Please log in first.", "error");
    return false;
  }

  const canonicalPhaseId = canonicalizePhaseId(phaseId);
  if (canonicalPhaseId === "phase1") {
    selectLearningPhase("phase1", true);
    return true;
  }

  const selectedPhase = getPhaseById(canonicalPhaseId);
  if (!selectedPhase) {
    showMessage("Phase not found.", "error");
    return false;
  }

  const completedPhaseSet = getCompletedPhaseSet();
  const missingPrerequisitePhase = getMissingCompletionPrerequisitePhase(canonicalPhaseId, completedPhaseSet);
  if (missingPrerequisitePhase) {
    showMessage(`Complete ${missingPrerequisitePhase.title} lessons first.`, "info");
    return false;
  }

  if (isPhaseFull(selectedPhase)) {
    showMessage("No seats available for this phase.", "error");
    return false;
  }

  const userId = state.user.uid;

  if (state.callablesReady) {
    try {
      await callBackendFunction("createBooking", {
        phaseId: canonicalPhaseId,
        phoneNumber: whatsappNumber,
        whatsappNumber
      });
      showMessage("Booking request submitted and waiting for admin approval.", "success");
      return true;
    } catch (error) {
      const normalizedCode = String(error?.code || "").toLowerCase();
      const normalizedMessage = String(error?.message || "").toLowerCase();
      if (normalizedCode.includes("failed-precondition") || normalizedMessage.includes("already")) {
        showMessage(error.message || "Booking cannot be created due to progression/lifecycle preconditions.", "info");
      } else if (normalizedCode.includes("resource-exhausted")) {
        showMessage("No seats available for this phase.", "error");
      } else if (normalizedCode.includes("permission-denied")) {
        showMessage("Booking blocked by backend authorization.", "error");
      } else if (normalizedCode.includes("unavailable")) {
        showMessage("Booking service unavailable. Retrying with legacy client transaction.", "info");
      } else {
        showMessage(`Booking failed: ${error.message}`, "error");
        return false;
      }
    }
  }

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

async function performAdminBookingCallableAction(functionName, booking, successMessage) {
  if (!state.callablesReady) {
    return false;
  }

  await callBackendFunction(functionName, {
    bookingId: booking.bookingId
  });
  showMessage(successMessage, "success");
  return true;
}

async function moveBookingToReviewingByAdmin(booking) {
  if (!state.isAdmin || !state.firebaseReady || !booking?.bookingId) {
    return;
  }

  try {
    const handledByCallable = await performAdminBookingCallableAction(
      "markBookingReviewing",
      booking,
      `Booking ${booking.bookingId} moved to reviewing.`
    );
    if (handledByCallable) {
      return;
    }
    showMessage("Reviewing action requires Cloud Functions deployment.", "error");
  } catch (error) {
    showMessage(`Failed to set reviewing: ${error.message}`, "error");
  }
}

async function rejectBookingByAdmin(booking) {
  if (!state.isAdmin || !state.firebaseReady || !db || !runTransactionFn || !docFn || !serverTimestampFn) {
    return;
  }

  try {
    if (state.callablesReady) {
      const handledByCallable = await performAdminBookingCallableAction(
        "rejectBooking",
        booking,
        `Booking ${booking.bookingId} rejected.`
      );
      if (handledByCallable) {
        return;
      }
    }

    await runTransactionFn(db, async (transaction) => {
      const bookingRef = docFn(db, "bookings", booking.bookingId);
      const liveSnapshot = await transaction.get(bookingRef);

      if (!liveSnapshot.exists()) {
        throw makeAppError("booking-not-found", "Booking document not found.");
      }

      const liveBooking = normalizeBookingDoc(liveSnapshot.id, liveSnapshot.data());
      if (liveBooking.status !== BOOKING_STATUS_PENDING && liveBooking.status !== BOOKING_STATUS_REVIEWING) {
        throw makeAppError("booking-not-pending", "Only pending/reviewing bookings can be rejected.");
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
      showMessage("Only pending or reviewing bookings can be rejected.", "error");
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
    if (state.callablesReady) {
      const handledByCallable = await performAdminBookingCallableAction(
        "approveBooking",
        booking,
        `Booking ${booking.bookingId} approved.`
      );
      if (handledByCallable) {
        return;
      }
    }

    await runTransactionFn(db, async (transaction) => {
      const bookingRef = docFn(db, "bookings", booking.bookingId);
      const liveBookingSnapshot = await transaction.get(bookingRef);

      if (!liveBookingSnapshot.exists()) {
        throw makeAppError("booking-not-found", "Booking document not found.");
      }

      const liveBooking = normalizeBookingDoc(liveBookingSnapshot.id, liveBookingSnapshot.data());
      if (liveBooking.status !== BOOKING_STATUS_PENDING && liveBooking.status !== BOOKING_STATUS_REVIEWING) {
        throw makeAppError("booking-not-pending", "Only pending/reviewing bookings can be approved.");
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
      showMessage("Only pending or reviewing bookings can be approved.", "error");
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
    if (state.callablesReady) {
      const handledByCallable = await performAdminBookingCallableAction(
        "cancelBooking",
        booking,
        `Booking ${booking.bookingId} cancelled and seat released.`
      );
      if (handledByCallable) {
        return;
      }
    }

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

  const needsContact = !state.profile.whatsappNumber;
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
  showMessage("Enter your WhatsApp number to continue.", "info");
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
      renderLearningPanel();

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
        if (state.user) {
          showMessage("Unable to load phases due to Firestore access rules.", "error");
        }
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
      renderLearningPanel();
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

function subscribeToLearningProgress(userId) {
  if (!state.firebaseReady || !db || !collectionFn || !onSnapshotFn) {
    return;
  }

  if (state.learningProgressUnsubscribe) {
    state.learningProgressUnsubscribe();
    state.learningProgressUnsubscribe = null;
  }

  const progressCollection = collectionFn(db, "users", userId, "progress");
  state.learningProgressUnsubscribe = onSnapshotFn(
    progressCollection,
    (snapshot) => {
      const nextProgressByPhaseId = new Map();
      snapshot.forEach((progressDoc) => {
        const normalized = normalizeLearningProgressDoc(progressDoc.id, progressDoc.data());
        if (normalized.phaseId) {
          nextProgressByPhaseId.set(normalized.phaseId, normalized);
        }
      });

      state.learningProgressByPhaseId = nextProgressByPhaseId;
      renderLearningPanel();
      renderPhases();
    },
    (error) => {
      if (isPermissionDeniedError(error)) {
        showMessage("Learning progress read blocked by Firestore rules.", "error");
      } else {
        showMessage(`Failed to load learning progress: ${error.message}`, "error");
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
      renderLearningPanel();
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
      const previousPendingVoiceBookingsById = new Map(
        state.adminPendingBookings
          .filter((booking) => booking.status === BOOKING_STATUS_PENDING)
          .map((booking) => [booking.bookingId, booking])
      );

      const nextAllBookings = [];
      const nextPendingBookings = [];
      snapshot.forEach((bookingDoc) => {
        const bookingData = bookingDoc.data();
        const normalized = normalizeBookingDoc(bookingDoc.id, bookingData);
        const rawStatus = normalizeString(bookingData?.status).toLowerCase();
        nextAllBookings.push(normalized);
        if (
          (rawStatus === BOOKING_STATUS_PENDING || rawStatus === BOOKING_STATUS_REVIEWING) &&
          (getEffectiveBookingStatus(normalized) === BOOKING_STATUS_PENDING ||
            getEffectiveBookingStatus(normalized) === BOOKING_STATUS_REVIEWING)
        ) {
          nextPendingBookings.push(normalized);
        }
      });

      announceNewPendingBookingEvents(
        previousPendingVoiceBookingsById,
        nextPendingBookings.filter((booking) => booking.status === BOOKING_STATUS_PENDING)
      );

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

  if (state.learningProgressUnsubscribe) {
    state.learningProgressUnsubscribe();
    state.learningProgressUnsubscribe = null;
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
  state.learningProgressByPhaseId = new Map();
  state.userDocExists = false;
  state.hasPromptedForContact = false;
  state.selectedLessonId = "";

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
  hideDeleteAccountModal();

  if (!user) {
    state.selectedNavSection = "home";
    state.profile = null;
    updateProfileUI();
    renderPhases();
    renderLearningPanel();
    renderHomePanel();
    renderClassroomPanel();
    renderFeatureGatePanel(0);
    renderAdminPanel();
    return;
  }

  subscribeToUserProfile(user);
  subscribeToUserBookings(user.uid);
  subscribeToLearningProgress(user.uid);

  if (state.isAdmin) {
    showMessage(`Admin access enabled for ${normalizeEmail(user.email)}.`, "success");
    renderAdminPanel();
    subscribeToAdminPendingBookings();
  } else {
    showMessage(`Logged in as ${normalizeEmail(user.email)}.`, "success");
    renderAdminPanel();
  }

  renderPhases();
  renderLearningPanel();
  renderHomePanel();
  renderClassroomPanel();
}

async function handlePhaseClick(phaseId) {
  if (!state.firebaseReady) {
    showMessage("Firebase is not ready.", "error");
    return;
  }

  const canonicalPhaseId = canonicalizePhaseId(phaseId);
  if (canonicalPhaseId === "phase1") {
    if (!state.user) {
      showMessage("Please log in first.", "error");
      openLoginFlow();
      return;
    }
    selectLearningPhase("phase1", true);
    return;
  }

  const phase = getPhaseById(canonicalPhaseId);
  if (!phase) {
    showMessage("Phase not found.", "error");
    return;
  }

  const completedPhaseSet = getCompletedPhaseSet();
  const missingPrerequisitePhase = getMissingCompletionPrerequisitePhase(canonicalPhaseId, completedPhaseSet);
  if (missingPrerequisitePhase) {
    showMessage(`Complete ${missingPrerequisitePhase.title} lessons first.`, "info");
    return;
  }

  if (isPhaseFull(phase)) {
    showMessage("No seats available for this phase.", "error");
    return;
  }

  const unlockedPhaseSet = getUnlockedPhaseSet();
  const { phaseState } = resolvePhaseState(canonicalPhaseId, unlockedPhaseSet);
  if (phaseState !== PHASE_STATE_LOCKED) {
    if (phaseState === PHASE_STATE_PENDING) {
      showMessage("This phase is already pending approval.", "info");
    } else {
      selectLearningPhase(canonicalPhaseId, true);
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

  const whatsappNumber = elements.whatsappInput.value.trim();

  if (!whatsappNumber) {
    showMessage("WhatsApp number is required.", "error");
    return;
  }

  if (!isValidPhone(whatsappNumber)) {
    showMessage("Please enter a valid WhatsApp number.", "error");
    return;
  }

  const requestedPhaseId = state.pendingPhaseId;
  state.pendingPhaseId = null;

  try {
    await saveUserProfile(whatsappNumber);
    hidePhoneModal();

    if (requestedPhaseId) {
      await requestBookingForPhase(requestedPhaseId, whatsappNumber);
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
    void handleLogin();
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
  if (elements.homeStartLearningBtn) {
    elements.homeStartLearningBtn.addEventListener("click", () => {
      registerSoundEngineUserInteraction();
      navigateToSection("overview");
    });
  }
  if (elements.homeContinueBtn) {
    elements.homeContinueBtn.addEventListener("click", () => {
      registerSoundEngineUserInteraction();
      navigateToClassroom(state.selectedLearningPhaseId || "phase1", "home");
    });
  }
  if (elements.learningContinueBtn) {
    elements.learningContinueBtn.addEventListener("click", () => {
      registerSoundEngineUserInteraction();
      navigateToClassroom(state.selectedLearningPhaseId || "phase1", "learning");
    });
  }
  if (elements.classroomBackBtn) {
    elements.classroomBackBtn.addEventListener("click", () => {
      registerSoundEngineUserInteraction();
      navigateToSection(state.classroomReturnSection || "overview");
    });
  }
  if (elements.profileSignOutBtn) {
    elements.profileSignOutBtn.addEventListener("click", () => {
      registerSoundEngineUserInteraction();
      void handleLogout();
    });
  }
  if (elements.profileInviteBtn) {
    elements.profileInviteBtn.addEventListener("click", () => {
      registerSoundEngineUserInteraction();
      const code = elements.profileReferralCode?.textContent || "------";
      showMessage(`Referral code ready: ${code}`, "info");
    });
  }
  if (elements.editProfileBtn) {
    elements.editProfileBtn.addEventListener("click", () => {
      registerSoundEngineUserInteraction();
      if (!state.user) {
        showMessage("Please log in first.", "error");
        return;
      }
      state.pendingPhaseId = null;
      showPhoneModal();
    });
  }
  if (elements.completeLessonBtn) {
    elements.completeLessonBtn.addEventListener("click", () => {
      registerSoundEngineUserInteraction();
      void completeSelectedLesson();
    });
  }
  if (elements.deleteAccountBtn) {
    elements.deleteAccountBtn.addEventListener("click", () => {
      registerSoundEngineUserInteraction();
      if (!state.user) {
        showMessage("Please log in first.", "error");
        return;
      }
      showDeleteAccountModal();
    });
  }
  if (elements.deleteAccountCancelBtn) {
    elements.deleteAccountCancelBtn.addEventListener("click", () => {
      registerSoundEngineUserInteraction();
      hideDeleteAccountModal();
    });
  }
  if (elements.deleteAccountForm) {
    elements.deleteAccountForm.addEventListener("submit", (event) => {
      registerSoundEngineUserInteraction();
      void handleDeleteAccount(event);
    });
  }
  elements.workspaceNavButtons.forEach((button) => {
    button.addEventListener("click", () => {
      registerSoundEngineUserInteraction();
      const sectionKey = button.dataset.navSection;
      if (!sectionKey) {
        return;
      }
      navigateToSection(sectionKey);
    });
  });
  if (elements.adminChip) {
    elements.adminChip.addEventListener("click", () => {
      registerSoundEngineUserInteraction();
      if (!state.isAdmin) {
        return;
      }
      navigateToSection("admin");
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
    const [appSdk, authSdk, firestoreSdk, functionsSdk] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js"),
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js")
    ]);

    const firebaseApp = appSdk.initializeApp(firebaseConfig);
    auth = authSdk.getAuth(firebaseApp);
    db = firestoreSdk.getFirestore(firebaseApp);
    functionsService = functionsSdk.getFunctions(firebaseApp, FUNCTIONS_REGION);
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
    httpsCallableFn = functionsSdk.httpsCallable;
    state.callablesReady = Boolean(functionsService && httpsCallableFn);

    state.firebaseReady = true;
    return true;
  } catch (error) {
    state.firebaseReady = false;
    state.callablesReady = false;
    showMessage(`Firebase init failed: ${error.message}`, "error");
    return false;
  }
}

function cleanup() {
  if (bookingUiTicker) {
    clearInterval(bookingUiTicker);
    bookingUiTicker = null;
  }

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
  renderLearningPanel();
  renderAdminPanel();
  renderWorkspaceNavigation();
  bindEvents();
  refreshLucideIcons();
  bookingUiTicker = window.setInterval(() => {
    if (!state.user) {
      return;
    }
    renderPhases();
    if (state.isAdmin && state.selectedNavSection === "admin") {
      renderAdminPanel();
    }
  }, 30000);
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
