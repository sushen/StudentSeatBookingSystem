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
import { findNewPendingSeatEvents } from "./sound-engine/seatNotificationUtils.js";

// TODO: Replace with your Firebase web app config if needed.
// Firebase Console -> Project Settings -> General -> Your apps -> SDK setup and configuration
const firebaseConfig = {
  apiKey: "AIzaSyBOIx-J4Pr4lzfpZrawlFy7PzFZ-t2S_jQ",
  authDomain: "tradingaimobileapps.firebaseapp.com",
  projectId: "tradingaimobileapps",
  storageBucket: "tradingaimobileapps.firebasestorage.app",
  messagingSenderId: "627431937414",
  appId: "1:627431937414:web:94e7a984e29575fefe8807",
  measurementId: "G-RFWGJMGSL2"
};

const HOLD_DURATION_MS = 15 * 60 * 1000;
const ADMIN_EMAIL = "sushen.biswas.aga@gmail.com";
const SEAT_DOC_IDS = Array.from({ length: 10 }, (_, index) =>
  `seat_${String(index + 1).padStart(3, "0")}`
);
const ALLOWED_SEAT_STATUS = new Set(["available", "pending", "confirmed"]);

let auth = null;
let db = null;
let provider = null;

let onAuthStateChangedFn = null;
let signInWithPopupFn = null;
let signOutFn = null;

let collectionFn = null;
let queryFn = null;
let whereFn = null;
let documentIdFn = null;
let onSnapshotFn = null;
let runTransactionFn = null;
let docFn = null;
let getDocFn = null;
let setDocFn = null;
let serverTimestampFn = null;

const elements = {
  seatGrid: document.getElementById("seatGrid"),
  messageBox: document.getElementById("messageBox"),
  loginBtn: document.getElementById("loginBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  profileCard: document.getElementById("profileCard"),
  profileName: document.getElementById("profileName"),
  profileEmail: document.getElementById("profileEmail"),
  profilePhone: document.getElementById("profilePhone"),
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
  phoneForm: document.getElementById("phoneForm"),
  phoneInput: document.getElementById("phoneInput"),
  phoneCancelBtn: document.getElementById("phoneCancelBtn"),
  speechTestBtn: document.getElementById("speechTestBtn"),
  adminPanel: document.getElementById("adminPanel"),
  adminRows: document.getElementById("adminRows"),
  adminEmpty: document.getElementById("adminEmpty")
};

const state = {
  user: null,
  profile: null,
  pendingSeatId: null,
  seats: [],
  firebaseReady: false,
  timerIntervalId: null,
  seatsUnsubscribe: null,
  isAdmin: false,
  hasLoadedSeats: false,
  expiringSeatIds: new Set(),
  browserEnvironment: detectInAppBrowserEnvironment(),
  hasShownSoundUnlockHint: false
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
  if (loweredMessage.includes("disallowed_useragent")) {
    return "Google sign-in is blocked inside this in-app browser. Open this page in Chrome or Safari.";
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

function parseSeatNumberFromId(seatId) {
  const parsed = Number.parseInt(String(seatId).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
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

function normalizeSeatStatus(value) {
  if (typeof value !== "string") {
    return "available";
  }
  return ALLOWED_SEAT_STATUS.has(value) ? value : "available";
}

function buildAvailableSeatPayload(seatId, seatNumber) {
  return {
    seatId,
    seatNumber,
    status: "available",
    heldBy: null,
    heldByName: null,
    heldByEmail: null,
    heldByPhone: null,
    holdStartTime: null,
    approvedBy: null,
    approvedAt: null
  };
}

function normalizeSeatDoc(docId, data = {}, defaultSeatNumber = null) {
  const parsedSeatNumber = Number(data.seatNumber);
  const fallbackSeatNumber = defaultSeatNumber || parseSeatNumberFromId(docId) || 0;

  return {
    seatId: typeof data.seatId === "string" && data.seatId ? data.seatId : docId,
    seatNumber: Number.isFinite(parsedSeatNumber) && parsedSeatNumber > 0 ? parsedSeatNumber : fallbackSeatNumber,
    status: normalizeSeatStatus(data.status),
    heldBy: typeof data.heldBy === "string" ? data.heldBy : null,
    heldByName: typeof data.heldByName === "string" ? data.heldByName : null,
    heldByEmail: typeof data.heldByEmail === "string" ? data.heldByEmail : null,
    heldByPhone: typeof data.heldByPhone === "string" ? data.heldByPhone : null,
    holdStartTimeMs: timestampToMillis(data.holdStartTime),
    approvedBy: typeof data.approvedBy === "string" ? data.approvedBy : null,
    approvedAtMs: timestampToMillis(data.approvedAt)
  };
}

function createFallbackSeats() {
  return SEAT_DOC_IDS.map((seatId, index) => normalizeSeatDoc(seatId, buildAvailableSeatPayload(seatId, index + 1), index + 1));
}

function getSeatById(seatId) {
  return state.seats.find((seat) => seat.seatId === seatId) || null;
}

function getSeatLabel(seat) {
  return seat?.seatNumber || parseSeatNumberFromId(seat?.seatId) || "-";
}

function formatTimeLeft(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatAdminValue(value) {
  return value ? String(value) : "-";
}

function announceNewPendingSeatEvents(previousSeatsById, nextSeats) {
  if (!state.isAdmin || !state.hasLoadedSeats) {
    return;
  }

  const newPendingEvents = findNewPendingSeatEvents(previousSeatsById, nextSeats);
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

function renderSeats() {
  elements.seatGrid.innerHTML = "";

  state.seats
    .slice()
    .sort((a, b) => a.seatNumber - b.seatNumber)
    .forEach((seat) => {
      const button = document.createElement("button");
      button.type = "button";
      button.classList.add("seat");

      const seatNumberLabel = document.createElement("span");
      seatNumberLabel.className = "seat-num";
      seatNumberLabel.textContent = String(getSeatLabel(seat));

      const seatTimeLabel = document.createElement("span");
      seatTimeLabel.className = "seat-time";

      const isMine = Boolean(state.user && seat.heldBy === state.user.uid);

      if (seat.status === "available") {
        seatTimeLabel.textContent = "Available";
        button.disabled = false;
        button.title = `Seat ${getSeatLabel(seat)} - Available`;
      } else if (seat.status === "pending") {
        const msLeft = seat.holdStartTimeMs ? HOLD_DURATION_MS - (Date.now() - seat.holdStartTimeMs) : null;
        seatTimeLabel.textContent = msLeft === null ? "Pending" : formatTimeLeft(msLeft);
        button.disabled = true;
        button.title = `Seat ${getSeatLabel(seat)} - Pending`;
        if (isMine) {
          button.classList.add("selected");
          button.title = `Seat ${getSeatLabel(seat)} - Your pending seat`;
        } else {
          button.classList.add("pending");
        }
      } else if (seat.status === "confirmed") {
        seatTimeLabel.textContent = "Confirmed";
        button.disabled = true;
        button.title = `Seat ${getSeatLabel(seat)} - Confirmed`;
        if (isMine) {
          button.classList.add("selected");
          button.title = `Seat ${getSeatLabel(seat)} - Your confirmed seat`;
        } else {
          button.classList.add("confirmed");
        }
      }

      if (isMine) {
        button.classList.add("selected");
      }

      button.addEventListener("click", () => {
        void handleSeatClick(seat.seatId);
      });

      button.appendChild(seatNumberLabel);
      button.appendChild(seatTimeLabel);
      elements.seatGrid.appendChild(button);
    });

  renderAdminPanel();
}

function renderAdminPanel() {
  if (!elements.adminPanel || !elements.adminRows || !elements.adminEmpty) {
    return;
  }

  if (!state.isAdmin) {
    elements.adminPanel.classList.add("hidden");
    elements.adminRows.innerHTML = "";
    elements.adminEmpty.classList.add("hidden");
    return;
  }

  elements.adminPanel.classList.remove("hidden");
  elements.adminRows.innerHTML = "";

  const heldSeats = state.seats
    .filter((seat) => seat.status === "pending")
    .sort((a, b) => a.seatNumber - b.seatNumber);

  if (heldSeats.length === 0) {
    elements.adminEmpty.classList.remove("hidden");
    return;
  }

  elements.adminEmpty.classList.add("hidden");

  heldSeats.forEach((seat) => {
    const row = document.createElement("tr");
    const msLeft = seat.holdStartTimeMs ? HOLD_DURATION_MS - (Date.now() - seat.holdStartTimeMs) : null;

    row.innerHTML = `
      <td>${getSeatLabel(seat)}</td>
      <td>${formatAdminValue(seat.heldByName)}</td>
      <td>${formatAdminValue(seat.heldByEmail)}</td>
      <td>${formatAdminValue(seat.heldByPhone)}</td>
      <td>${msLeft === null ? "--:--" : formatTimeLeft(msLeft)}</td>
      <td>Held</td>
      <td class="admin-actions-cell"></td>
    `;

    const actionsCell = row.querySelector(".admin-actions-cell");

    const approveBtn = document.createElement("button");
    approveBtn.type = "button";
    approveBtn.className = "admin-action-btn approve";
    approveBtn.textContent = "Approve";
    approveBtn.addEventListener("click", () => {
      void approveSeatByAdmin(seat);
    });

    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.className = "admin-action-btn reject";
    rejectBtn.textContent = "Reject";
    rejectBtn.addEventListener("click", () => {
      void rejectSeatByAdmin(seat);
    });

    actionsCell.appendChild(approveBtn);
    actionsCell.appendChild(rejectBtn);
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
    return;
  }

  elements.profileCard.classList.remove("hidden");
  elements.profileName.textContent = state.profile.name || "-";
  elements.profileEmail.textContent = state.profile.email || "-";
  elements.profilePhone.textContent = state.profile.phone || "-";
}

function showLoginModal() {
  elements.loginModal.classList.remove("hidden");
}

function hideLoginModal() {
  elements.loginModal.classList.add("hidden");
}

function showPhoneModal() {
  elements.phoneModal.classList.remove("hidden");
  elements.phoneInput.focus();
}

function hidePhoneModal() {
  elements.phoneModal.classList.add("hidden");
}

function isValidPhone(value) {
  const normalized = value.replace(/[\s\-()]/g, "");
  return /^\+?[0-9]{8,15}$/.test(normalized);
}

async function handleLogin() {
  if (isGoogleLoginBlockedInCurrentBrowser()) {
    hideLoginModal();
    showInAppModal();
    showMessage("Google sign-in is blocked inside this in-app browser. Open this page in Chrome or Safari.", "error");
    return;
  }

  if (!state.firebaseReady || !auth || !provider || !signInWithPopupFn) {
    showMessage("Firebase is not ready. Check config and reload.", "error");
    return;
  }

  try {
    await signInWithPopupFn(auth, provider);
    hideLoginModal();
    showMessage("Login successful.", "success");
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
    state.pendingSeatId = null;
    renderSeats();
    showMessage("Logged out.", "info");
  } catch (error) {
    showMessage(`Logout failed: ${error.message}`, "error");
  }
}

async function loadUserProfile(user) {
  if (!db || !docFn || !getDocFn) {
    throw new Error("Firestore is not initialized.");
  }

  const userRef = docFn(db, "users", user.uid);
  const snapshot = await getDocFn(userRef);

  if (!snapshot.exists()) {
    state.profile = {
      name: user.displayName || "Unknown User",
      email: user.email || "",
      phone: ""
    };
    updateProfileUI();
    return;
  }

  const data = snapshot.data();
  state.profile = {
    name: data.name || user.displayName || "Unknown User",
    email: data.email || user.email || "",
    phone: data.phone || ""
  };
  updateProfileUI();
  showMessage("Profile loaded.", "success");
}

async function saveUserProfile(phoneNumber) {
  if (!state.user) {
    throw new Error("User not authenticated.");
  }
  if (!db || !docFn || !setDocFn || !serverTimestampFn) {
    throw new Error("Firestore is not initialized.");
  }

  const userRef = docFn(db, "users", state.user.uid);
  await setDocFn(
    userRef,
    {
      name: state.user.displayName || "Unknown User",
      email: state.user.email || "",
      phone: phoneNumber,
      createdAt: serverTimestampFn()
    },
    { merge: true }
  );

  state.profile = {
    name: state.user.displayName || "Unknown User",
    email: state.user.email || "",
    phone: phoneNumber
  };
  updateProfileUI();
}

async function continuePendingSeatFlow() {
  if (state.pendingSeatId === null) {
    return;
  }

  const seatId = state.pendingSeatId;
  state.pendingSeatId = null;
  await holdSeatInFirestore(seatId);
}

async function holdSeatInFirestore(seatId) {
  if (!state.firebaseReady || !db || !runTransactionFn || !docFn || !serverTimestampFn) {
    showMessage("Firestore is not ready.", "error");
    return;
  }
  if (!state.user) {
    showMessage("Please log in first.", "error");
    return;
  }
  if (!state.profile || !state.profile.phone) {
    showMessage("Enter your phone number first.", "error");
    return;
  }

  const seatRefs = SEAT_DOC_IDS.map((id) => docFn(db, "seats", id));

  try {
    await runTransactionFn(db, async (transaction) => {
      const snapshots = await Promise.all(seatRefs.map((seatRef) => transaction.get(seatRef)));
      const targetSnapshot = snapshots.find((snapshot) => snapshot.id === seatId) || null;

      snapshots.forEach((snapshot, index) => {
        if (!snapshot.exists()) {
          return;
        }
        const normalized = normalizeSeatDoc(snapshot.id, snapshot.data(), index + 1);
        const reservedByCurrentUser =
          normalized.heldBy === state.user.uid &&
          (normalized.status === "pending" || normalized.status === "confirmed");

        if (reservedByCurrentUser) {
          throw makeAppError("already-has-seat", "You already have a seat reserved.");
        }
      });

      if (!targetSnapshot || !targetSnapshot.exists()) {
        throw makeAppError("seat-not-found", `Seat ${seatId} is missing in Firestore.`);
      }

      const targetSeat = normalizeSeatDoc(targetSnapshot.id, targetSnapshot.data(), parseSeatNumberFromId(seatId));
      if (targetSeat.status !== "available") {
        throw makeAppError("seat-unavailable", "Seat is no longer available.");
      }

      const seatRef = docFn(db, "seats", seatId);
      transaction.set(
        seatRef,
        {
          seatId,
          seatNumber: targetSeat.seatNumber,
          status: "pending",
          heldBy: state.user.uid,
          heldByName: state.profile.name || state.user.displayName || "Unknown User",
          heldByEmail: state.profile.email || state.user.email || "",
          heldByPhone: state.profile.phone || "",
          holdStartTime: serverTimestampFn(),
          approvedBy: null,
          approvedAt: null
        },
        { merge: true }
      );
    });

    const seat = getSeatById(seatId);
    const seatLabel = seat ? getSeatLabel(seat) : parseSeatNumberFromId(seatId);
    showMessage(`Seat ${seatLabel} set to pending for 15:00.`, "success");
  } catch (error) {
    if (error?.code === "already-has-seat") {
      showMessage("You already have a seat reserved.", "error");
    } else if (error?.code === "seat-unavailable") {
      showMessage("Seat is no longer available.", "error");
    } else if (error?.code === "seat-not-found") {
      showMessage("Seat document not found. Check seat_001 to seat_010 in Firestore.", "error");
    } else if (isPermissionDeniedError(error)) {
      showMessage("Booking blocked by Firestore rules. Allow authenticated seat updates.", "error");
    } else {
      showMessage(`Failed to reserve seat: ${error.message}`, "error");
    }
  }
}

async function rejectSeatByAdmin(seat) {
  if (!state.isAdmin || !state.firebaseReady || !db || !runTransactionFn || !docFn) {
    return;
  }

  try {
    await runTransactionFn(db, async (transaction) => {
      const seatRef = docFn(db, "seats", seat.seatId);
      const liveSnapshot = await transaction.get(seatRef);

      if (!liveSnapshot.exists()) {
        throw makeAppError("seat-not-found", "Seat document not found.");
      }

      const liveSeat = normalizeSeatDoc(liveSnapshot.id, liveSnapshot.data(), seat.seatNumber);
      transaction.set(seatRef, buildAvailableSeatPayload(liveSeat.seatId, liveSeat.seatNumber), { merge: true });
    });

    showMessage(`Seat ${getSeatLabel(seat)} was rejected and reset to available.`, "success");
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      showMessage("Reject action blocked by Firestore rules.", "error");
    } else {
      showMessage(`Failed to reject seat: ${error.message}`, "error");
    }
  }
}

async function approveSeatByAdmin(seat) {
  if (
    !state.isAdmin ||
    !state.user ||
    !state.firebaseReady ||
    !db ||
    !runTransactionFn ||
    !docFn ||
    !serverTimestampFn
  ) {
    return;
  }

  try {
    await runTransactionFn(db, async (transaction) => {
      const seatRef = docFn(db, "seats", seat.seatId);
      const liveSnapshot = await transaction.get(seatRef);

      if (!liveSnapshot.exists()) {
        throw makeAppError("seat-not-found", "Seat document not found.");
      }

      const liveSeat = normalizeSeatDoc(liveSnapshot.id, liveSnapshot.data(), seat.seatNumber);
      if (liveSeat.status !== "pending") {
        throw makeAppError("seat-not-pending", "Only pending seats can be approved.");
      }

      transaction.set(
        seatRef,
        {
          status: "confirmed",
          holdStartTime: null,
          approvedBy: state.user.uid,
          approvedAt: serverTimestampFn()
        },
        { merge: true }
      );
    });

    showMessage(`Seat ${getSeatLabel(seat)} approved and confirmed.`, "success");
  } catch (error) {
    if (error?.code === "seat-not-pending") {
      showMessage("Only pending seats can be approved.", "error");
    } else if (isPermissionDeniedError(error)) {
      showMessage("Approve action blocked by Firestore rules.", "error");
    } else {
      showMessage(`Failed to approve seat: ${error.message}`, "error");
    }
  }
}

function syncSeatTimer() {
  const hasPendingSeats = state.seats.some((seat) => seat.status === "pending");

  if (hasPendingSeats && !state.timerIntervalId) {
    state.timerIntervalId = setInterval(checkSeatExpiry, 1000);
    return;
  }

  if (!hasPendingSeats && state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }
}

async function expireSeatIfNeeded(seat) {
  if (
    !state.firebaseReady ||
    !db ||
    !runTransactionFn ||
    !docFn ||
    !seat ||
    seat.status !== "pending" ||
    !seat.holdStartTimeMs
  ) {
    return;
  }

  if (Date.now() - seat.holdStartTimeMs < HOLD_DURATION_MS) {
    return;
  }

  if (state.expiringSeatIds.has(seat.seatId)) {
    return;
  }
  state.expiringSeatIds.add(seat.seatId);

  // IMPORTANT:
  // This expiry logic runs in frontend code only for testing flow.
  // Production systems should enforce expiry with trusted backend logic.
  try {
    await runTransactionFn(db, async (transaction) => {
      const seatRef = docFn(db, "seats", seat.seatId);
      const liveSnapshot = await transaction.get(seatRef);
      if (!liveSnapshot.exists()) {
        return;
      }

      const liveSeat = normalizeSeatDoc(liveSnapshot.id, liveSnapshot.data(), seat.seatNumber);
      if (liveSeat.status !== "pending" || !liveSeat.holdStartTimeMs) {
        return;
      }

      const stillExpired = Date.now() - liveSeat.holdStartTimeMs >= HOLD_DURATION_MS;
      if (!stillExpired) {
        return;
      }

      transaction.set(
        seatRef,
        buildAvailableSeatPayload(liveSeat.seatId, liveSeat.seatNumber),
        { merge: true }
      );
    });

    if (state.user && seat.heldBy === state.user.uid) {
      showMessage("Your 15-minute hold expired. Seat is available again.", "info");
    }
  } catch (error) {
    // Keep silent for repeated timer checks to avoid UI spam.
    // Snapshot updates remain source of truth for seat status.
  } finally {
    state.expiringSeatIds.delete(seat.seatId);
  }
}

function checkSeatExpiry() {
  const now = Date.now();
  let hasPendingSeats = false;

  state.seats.forEach((seat) => {
    if (seat.status !== "pending") {
      return;
    }

    hasPendingSeats = true;
    if (!seat.holdStartTimeMs) {
      return;
    }

    if (now - seat.holdStartTimeMs >= HOLD_DURATION_MS) {
      void expireSeatIfNeeded(seat);
    }
  });

  if (hasPendingSeats) {
    renderSeats();
  } else {
    syncSeatTimer();
    renderAdminPanel();
  }
}

function subscribeToSeats() {
  if (!state.firebaseReady || !db || !collectionFn || !queryFn || !whereFn || !documentIdFn || !onSnapshotFn) {
    return;
  }

  if (state.seatsUnsubscribe) {
    state.seatsUnsubscribe();
    state.seatsUnsubscribe = null;
  }

  const seatsCollection = collectionFn(db, "seats");
  const seatsQuery = queryFn(
    seatsCollection,
    whereFn(documentIdFn(), "in", SEAT_DOC_IDS)
  );

  state.seatsUnsubscribe = onSnapshotFn(
    seatsQuery,
    (snapshot) => {
      const previousSeatsById = new Map(state.seats.map((seat) => [seat.seatId, seat]));
      const seatsById = new Map();
      snapshot.forEach((seatDoc) => {
        seatsById.set(
          seatDoc.id,
          normalizeSeatDoc(seatDoc.id, seatDoc.data(), parseSeatNumberFromId(seatDoc.id))
        );
      });

      state.seats = SEAT_DOC_IDS.map((seatId, index) =>
        seatsById.get(seatId) || normalizeSeatDoc(seatId, buildAvailableSeatPayload(seatId, index + 1), index + 1)
      );

      announceNewPendingSeatEvents(previousSeatsById, state.seats);
      renderSeats();
      syncSeatTimer();

      if (!state.hasLoadedSeats) {
        state.hasLoadedSeats = true;
        if (snapshot.size === 0) {
          showMessage("No seat docs found. Create seats/seat_001 ... seats/seat_010 in Firestore.", "error");
        } else if (snapshot.size < SEAT_DOC_IDS.length) {
          showMessage(`Loaded ${snapshot.size}/10 seat docs. Create missing seat_001 to seat_010 documents.`, "error");
        } else {
          showMessage("Seats loaded from Firestore.", "success");
        }
      }
    },
    (error) => {
      if (isPermissionDeniedError(error)) {
        showMessage("Seat read blocked by Firestore rules.", "error");
      } else {
        showMessage(`Failed to load seats: ${error.message}`, "error");
      }
    }
  );
}

async function onAuthStateChangedHandler(user) {
  state.user = user;
  state.isAdmin = Boolean(user && user.email && user.email.toLowerCase() === ADMIN_EMAIL);
  setSoundEngineAdminMode(state.isAdmin);
  if (!state.isAdmin) {
    state.hasShownSoundUnlockHint = false;
    clearSoundAnnouncementHistory();
  }
  updateAuthButtons();

  if (!user) {
    state.profile = null;
    updateProfileUI();
    hidePhoneModal();
    renderSeats();
    return;
  }

  try {
    await loadUserProfile(user);

    if (!state.profile.phone) {
      showMessage("Enter your phone number to continue.", "info");
      showPhoneModal();
      renderSeats();
      return;
    }

    await continuePendingSeatFlow();
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      showMessage("Profile read blocked by Firestore rules. Allow users/{uid} read for that uid.", "error");
    } else {
      showMessage(`Failed to load profile: ${error.message}`, "error");
    }
  } finally {
    renderSeats();
  }
}

async function handleSeatClick(seatId) {
  if (!state.firebaseReady) {
    showMessage("Firebase is not ready.", "error");
    return;
  }

  const seat = getSeatById(seatId);
  if (!seat) {
    showMessage("Seat not found.", "error");
    return;
  }

  if (seat.status !== "available") {
    const isMine = Boolean(state.user && seat.heldBy === state.user.uid);
    if (isMine && seat.status === "pending") {
      showMessage("This is your pending seat.", "info");
    } else if (isMine && seat.status === "confirmed") {
      showMessage("This is your confirmed seat.", "info");
    } else if (seat.status === "pending") {
      showMessage("Seat is currently pending.", "error");
    } else {
      showMessage("Seat is confirmed and unavailable.", "error");
    }
    return;
  }

  state.pendingSeatId = seatId;

  if (!state.user) {
    showMessage("Please log in first.", "error");
    openLoginFlow();
    return;
  }

  if (!state.profile || !state.profile.phone) {
    showMessage("Enter your phone number.", "info");
    showPhoneModal();
    return;
  }

  await continuePendingSeatFlow();
}

async function handlePhoneSubmit(event) {
  event.preventDefault();

  const phoneValue = elements.phoneInput.value.trim();
  if (!phoneValue) {
    showMessage("Phone number is required.", "error");
    return;
  }

  if (!isValidPhone(phoneValue)) {
    showMessage("Please enter a valid phone number.", "error");
    return;
  }

  try {
    await saveUserProfile(phoneValue);
    hidePhoneModal();
    showMessage("Profile saved.", "success");
    await continuePendingSeatFlow();
  } catch (error) {
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
    hidePhoneModal();
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

    onAuthStateChangedFn = authSdk.onAuthStateChanged;
    signInWithPopupFn = authSdk.signInWithPopup;
    signOutFn = authSdk.signOut;

    collectionFn = firestoreSdk.collection;
    queryFn = firestoreSdk.query;
    whereFn = firestoreSdk.where;
    documentIdFn = firestoreSdk.documentId;
    onSnapshotFn = firestoreSdk.onSnapshot;
    runTransactionFn = firestoreSdk.runTransaction;
    docFn = firestoreSdk.doc;
    getDocFn = firestoreSdk.getDoc;
    setDocFn = firestoreSdk.setDoc;
    serverTimestampFn = firestoreSdk.serverTimestamp;

    state.firebaseReady = true;
    return true;
  } catch (error) {
    state.firebaseReady = false;
    showMessage(`Firebase init failed: ${error.message}`, "error");
    return false;
  }
}

function cleanup() {
  if (state.seatsUnsubscribe) {
    state.seatsUnsubscribe();
    state.seatsUnsubscribe = null;
  }
  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }
}

async function initializeApp() {
  initializeSoundEngine({
    onlyWhenTabActive: true,
    adminOnly: true,
    language: "en-US"
  });

  state.seats = createFallbackSeats();
  renderSeats();
  bindEvents();
  showMessage("Loading seats from Firestore...", "info");
  applyBrowserEnvironmentGuard();
  updateAuthButtons();

  const firebaseOk = await setupFirebase();
  updateAuthButtons();
  updateProfileUI();

  if (!firebaseOk) {
    return;
  }

  subscribeToSeats();

  if (auth && onAuthStateChangedFn) {
    onAuthStateChangedFn(auth, (user) => {
      void onAuthStateChangedHandler(user);
    });
  }
}

window.addEventListener("beforeunload", cleanup);
initializeApp();
