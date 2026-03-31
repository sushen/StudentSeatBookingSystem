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

const TOTAL_SEATS = 100;
const HOLD_DURATION_MS = 15 * 60 * 1000;
let auth = null;
let db = null;
let provider = null;
let onAuthStateChangedFn = null;
let signInWithPopupFn = null;
let signOutFn = null;
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
  phoneModal: document.getElementById("phoneModal"),
  phoneForm: document.getElementById("phoneForm"),
  phoneInput: document.getElementById("phoneInput"),
  phoneCancelBtn: document.getElementById("phoneCancelBtn")
};

const state = {
  user: null,
  profile: null,
  pendingSeatNumber: null,
  seats: [],
  firebaseReady: false,
  timerIntervalId: null
};

function showMessage(text, type = "info") {
  elements.messageBox.textContent = text;
  elements.messageBox.className = `message ${type}`;
}

function isPermissionDeniedError(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "permission-denied" || message.includes("missing or insufficient permissions");
}

function createSeats() {
  const seats = [];
  for (let seatNumber = 1; seatNumber <= TOTAL_SEATS; seatNumber += 1) {
    seats.push({
      seatNumber,
      status: "available", // available | held
      heldBy: null,
      holdStartTime: null
    });
  }
  return seats;
}

function getUserHeldSeat() {
  if (!state.user) {
    return null;
  }
  return state.seats.find(
    (seat) => seat.status === "held" && seat.heldBy === state.user.uid
  ) || null;
}

function formatTimeLeft(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function renderSeats() {
  elements.seatGrid.innerHTML = "";

  state.seats.forEach((seat) => {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("seat");
    const seatNumberLabel = document.createElement("span");
    seatNumberLabel.className = "seat-num";
    seatNumberLabel.textContent = String(seat.seatNumber);
    const seatTimeLabel = document.createElement("span");
    seatTimeLabel.className = "seat-time";

    const isMine = Boolean(state.user && seat.heldBy === state.user.uid);

    if (seat.status === "held") {
      const msLeft = HOLD_DURATION_MS - (Date.now() - seat.holdStartTime);
      seatTimeLabel.textContent = formatTimeLeft(msLeft);
      button.disabled = true;
      button.title = `Seat ${seat.seatNumber} - Held`;
      if (isMine) {
        button.classList.add("selected");
        button.title = `Seat ${seat.seatNumber} - Your seat (${formatTimeLeft(msLeft)})`;
      } else {
        button.classList.add("held");
      }
    } else {
      seatTimeLabel.textContent = "Available";
      button.title = `Seat ${seat.seatNumber} - Available`;
    }

    if (isMine) {
      button.classList.add("selected");
    }

    button.addEventListener("click", () => {
      handleSeatClick(seat.seatNumber);
    });

    button.appendChild(seatNumberLabel);
    button.appendChild(seatTimeLabel);
    elements.seatGrid.appendChild(button);
  });
}

function updateAuthButtons() {
  elements.loginBtn.disabled = !state.firebaseReady || Boolean(state.user);
  elements.logoutBtn.disabled = !state.firebaseReady || !state.user;
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
  // Very simple phone validation for demo flow
  const normalized = value.replace(/[\s\-()]/g, "");
  return /^\+?[0-9]{8,15}$/.test(normalized);
}

async function handleLogin() {
  if (!state.firebaseReady || !auth || !provider || !signInWithPopupFn) {
    showMessage("Firebase is not ready. Check config and reload.", "error");
    return;
  }

  try {
    await signInWithPopupFn(auth, provider);
    hideLoginModal();
    showMessage("Login successful.", "success");
  } catch (error) {
    showMessage(`Login failed: ${error.message}`, "error");
  }
}

async function handleLogout() {
  if (!state.firebaseReady || !auth || !signOutFn) {
    showMessage("Firebase is not ready.", "error");
    return;
  }

  try {
    await signOutFn(auth);
    state.pendingSeatNumber = null;
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

function continuePendingSeatFlow() {
  if (state.pendingSeatNumber === null) {
    return;
  }

  const seatNumber = state.pendingSeatNumber;
  state.pendingSeatNumber = null;
  holdSeat(seatNumber);
}

function holdSeat(seatNumber) {
  const seat = state.seats.find((item) => item.seatNumber === seatNumber);
  if (!seat || seat.status !== "available" || !state.user) {
    return;
  }

  const existingSeat = getUserHeldSeat();
  if (existingSeat && existingSeat.seatNumber !== seatNumber) {
    showMessage("You already have a seat reserved.", "error");
    return;
  }

  seat.status = "held";
  seat.heldBy = state.user.uid;
  seat.holdStartTime = Date.now();

  startSeatTimer();
  renderSeats();
  showMessage(`Seat ${seatNumber} held for ${formatTimeLeft(HOLD_DURATION_MS)}.`, "success");
}

function checkSeatExpiry() {
  const now = Date.now();
  let changed = false;
  let mineExpired = false;

  state.seats.forEach((seat) => {
    if (seat.status !== "held" || !seat.holdStartTime) {
      return;
    }

    if (now - seat.holdStartTime >= HOLD_DURATION_MS) {
      if (state.user && seat.heldBy === state.user.uid) {
        mineExpired = true;
      }
      seat.status = "available";
      seat.heldBy = null;
      seat.holdStartTime = null;
      changed = true;
    }
  });

  const anyHeldSeats = state.seats.some((seat) => seat.status === "held");

  if (changed || anyHeldSeats) {
    renderSeats();
  }

  if (changed && mineExpired) {
    showMessage("Your 15-minute hold expired. Seat is available again.", "info");
  }

  if (!anyHeldSeats && state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }
}

function startSeatTimer() {
  if (state.timerIntervalId) {
    return;
  }
  state.timerIntervalId = setInterval(checkSeatExpiry, 1000);
}

async function onAuthStateChangedHandler(user) {
  state.user = user;
  updateAuthButtons();

  if (!user) {
    state.profile = null;
    updateProfileUI();
    hidePhoneModal();
    return;
  }

  try {
    await loadUserProfile(user);

    if (!state.profile.phone) {
      showMessage("Enter your phone number to continue.", "info");
      showPhoneModal();
      return;
    }

    continuePendingSeatFlow();
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      showMessage("Profile read blocked by Firestore rules. Allow users/{uid} read for that uid.", "error");
    } else {
      showMessage(`Failed to load profile: ${error.message}`, "error");
    }
  }
}

function handleSeatClick(seatNumber) {
  if (!state.firebaseReady) {
    showMessage("Firebase is not ready. Seats are shown in UI only.", "error");
    return;
  }

  const seat = state.seats.find((item) => item.seatNumber === seatNumber);
  if (!seat) {
    return;
  }

  if (seat.status === "held") {
    if (state.user && seat.heldBy === state.user.uid) {
      showMessage("This is your held seat.", "info");
    }
    return;
  }

  state.pendingSeatNumber = seatNumber;

  if (!state.user) {
    showMessage("Please log in first.", "error");
    showLoginModal();
    return;
  }

  if (!state.profile || !state.profile.phone) {
    showMessage("Enter your phone number.", "info");
    showPhoneModal();
    return;
  }

  continuePendingSeatFlow();
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
    continuePendingSeatFlow();
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      showMessage("Profile save blocked by Firestore rules. Allow users/{uid} write for that uid.", "error");
    } else {
      showMessage(`Failed to save profile: ${error.message}`, "error");
    }
  }
}

function bindEvents() {
  elements.loginBtn.addEventListener("click", showLoginModal);
  elements.logoutBtn.addEventListener("click", handleLogout);
  elements.loginModalBtn.addEventListener("click", handleLogin);
  elements.loginModalCloseBtn.addEventListener("click", hideLoginModal);
  elements.phoneForm.addEventListener("submit", handlePhoneSubmit);
  elements.phoneCancelBtn.addEventListener("click", hidePhoneModal);
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

async function initializeApp() {
  state.seats = createSeats();
  renderSeats();
  bindEvents();
  await setupFirebase();
  updateAuthButtons();
  updateProfileUI();
  if (state.firebaseReady) {
    showMessage("Click any seat to begin.", "info");
  }

  if (state.firebaseReady && auth && onAuthStateChangedFn) {
    onAuthStateChangedFn(auth, onAuthStateChangedHandler);
  }
}

initializeApp();
