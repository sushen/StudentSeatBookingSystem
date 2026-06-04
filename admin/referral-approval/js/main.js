import {
  initializeFirebaseClient,
  onAuthStateChange,
  processRedirectResult,
  signInWithGoogle,
  signOutCurrentUser
} from "./firebaseClient.js";
import {
  REFERRAL_APPROVAL_STATUS,
  approveReferralRequest,
  listReferralRequests,
  rejectReferralRequest
} from "./referralApprovalApi.js";
import {
  applyReferralCodeFromRequestInUsers,
  approveReferralRequestInUsers,
  listReferralRequestsFromUsers,
  rejectReferralRequestInUsers,
  rejectToAdminReferralInUsers
} from "./referralApprovalFirestoreFallback.js";
import { filterRequestsByQuery, renderRequestRows } from "./referralApprovalUi.js";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "admin.referral.queue.sidebar.collapsed.v1";

const state = {
  user: null,
  requests: [],
  statusFilter: REFERRAL_APPROVAL_STATUS.all,
  searchQuery: "",
  activeRequestId: "",
  loading: false,
  fallbackMode: false,
  sidebarCollapsed: false
};

const elements = {
  loginBtn: document.getElementById("loginBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  authStateText: document.getElementById("authStateText"),
  identityText: document.getElementById("identityText"),
  statusText: document.getElementById("statusText"),
  statusDot: document.getElementById("statusDot"),
  authGate: document.getElementById("authGate"),
  accessDenied: document.getElementById("accessDenied"),
  workspace: document.getElementById("workspace"),
  summaryText: document.getElementById("summaryText"),
  toggleSidebarBtn: document.getElementById("toggleSidebarBtn"),
  statusFilter: document.getElementById("statusFilter"),
  searchInput: document.getElementById("searchInput"),
  refreshBtn: document.getElementById("refreshBtn"),
  requestRows: document.getElementById("requestRows"),
  emptyText: document.getElementById("emptyText")
};

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value) {
  return normalizeString(value).toLowerCase();
}

function refreshIcons() {
  try {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  } catch (error) {
    void error;
  }
}

function setStatus(message, tone = "info") {
  if (!elements.statusText || !elements.statusDot) {
    return;
  }
  elements.statusText.textContent = message;
  elements.statusDot.className = `status-dot ${tone}`;
}

function setMode(mode) {
  elements.authGate.classList.toggle("hidden", mode !== "auth");
  elements.accessDenied.classList.toggle("hidden", mode !== "denied");
  elements.workspace.classList.toggle("hidden", mode !== "ready");
  elements.loginBtn.classList.toggle("hidden", mode === "ready");
  elements.logoutBtn.classList.toggle("hidden", mode !== "ready" && mode !== "denied");
}

function getFriendlyError(error) {
  const code = normalizeString(error?.code).toLowerCase();
  const message = normalizeString(error?.message);

  if (code.includes("permission-denied")) {
    return "Admin permission denied.";
  }
  if (code.includes("unauthenticated")) {
    return "Sign in required.";
  }
  if (code.includes("unavailable") || code.includes("internal")) {
    return "Functions backend unavailable. Deploy functions, or run emulator with ?functionsEmulator=1.";
  }
  if (code.includes("not-found")) {
    return "Function not found. Deploy Cloud Functions first.";
  }
  if (message.toLowerCase().includes("404")) {
    return "Function endpoint not found. Deploy Cloud Functions first.";
  }
  if (message) {
    return message;
  }
  return "Unknown error.";
}

function isPermissionDenied(error) {
  return normalizeString(error?.code).toLowerCase().includes("permission-denied");
}

function isUnauthenticated(error) {
  return normalizeString(error?.code).toLowerCase().includes("unauthenticated");
}

function isFunctionsFailure(error) {
  const code = normalizeString(error?.code).toLowerCase();
  const message = normalizeString(error?.message).toLowerCase();
  return (
    code.includes("internal") ||
    code.includes("unavailable") ||
    code.includes("not-found") ||
    message.includes("404") ||
    message.includes("function not found")
  );
}

function loadSidebarCollapsedPreference() {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  } catch (error) {
    void error;
    return false;
  }
}

function saveSidebarCollapsedPreference(isCollapsed) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, isCollapsed ? "1" : "0");
  } catch (error) {
    void error;
  }
}

function updateSidebarToggleButton() {
  if (!elements.toggleSidebarBtn) {
    return;
  }
  const isCollapsed = Boolean(state.sidebarCollapsed);
  const nextIcon = isCollapsed ? "panel-left-open" : "panel-left-close";
  const label = isCollapsed ? "Show left sidebar" : "Hide left sidebar";
  elements.toggleSidebarBtn.setAttribute("title", label);
  elements.toggleSidebarBtn.setAttribute("aria-label", label);
  elements.toggleSidebarBtn.innerHTML = `<i data-lucide="${nextIcon}"></i>`;
  refreshIcons();
}

function setSidebarCollapsed(isCollapsed) {
  state.sidebarCollapsed = Boolean(isCollapsed);
  document.body.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  updateSidebarToggleButton();
}

function render() {
  const filtered = filterRequestsByQuery(state.requests, state.searchQuery);
  const total = filtered.length;
  const pendingCount = filtered.filter((item) => item.status === REFERRAL_APPROVAL_STATUS.pending).length;
  const approvedCount = filtered.filter((item) => item.status === REFERRAL_APPROVAL_STATUS.approved).length;
  const rejectedCount = filtered.filter((item) => item.status === REFERRAL_APPROVAL_STATUS.rejected).length;

  if (elements.summaryText) {
    elements.summaryText.textContent = `${total} request${total === 1 ? "" : "s"} | Pending ${pendingCount} | Approved ${approvedCount} | Rejected ${rejectedCount}`;
  }

  renderRequestRows({
    tbody: elements.requestRows,
    emptyTextEl: elements.emptyText,
    requests: filtered,
    activeRequestId: state.activeRequestId,
    onApprove: (request) => {
      void handleApprove(request);
    },
    onReject: (request) => {
      void handleReject(request);
    },
    onApplyCode: (request) => {
      void handleApplyCode(request);
    },
    onRejectToAdmin: (request) => {
      void handleRejectToAdmin(request);
    }
  });
}

async function handleRejectToAdmin(request) {
  if (!request?.requestId || state.activeRequestId) {
    return;
  }

  const confirmed = window.confirm(
    `Reject this referral and fallback to admin referral code for ${request.requesterEmail || request.requesterId}?`
  );
  if (!confirmed) {
    return;
  }

  state.activeRequestId = request.requestId;
  render();
  setStatus("Rejecting and applying admin fallback...", "warn");

  try {
    await rejectToAdminReferralInUsers(
      request,
      "Rejected by admin; fallback to admin referral code."
    );
    state.fallbackMode = true;
    setStatus("Rejected with admin referral fallback.", "ok");
    await refreshQueue();
  } catch (error) {
    setStatus(`Reject fallback failed: ${getFriendlyError(error)}`, "error");
  } finally {
    state.activeRequestId = "";
    render();
  }
}

async function refreshQueue() {
  if (!state.user || state.loading) {
    return;
  }

  state.loading = true;
  setStatus("Loading referral requests...", "warn");
  try {
    let requests = [];
    try {
      requests = await listReferralRequests(state.statusFilter);
      state.fallbackMode = false;
    } catch (callableError) {
      if (!isFunctionsFailure(callableError)) {
        throw callableError;
      }
      requests = await listReferralRequestsFromUsers(state.statusFilter);
      state.fallbackMode = true;
    }
    state.requests = requests;
    render();
    if (state.fallbackMode) {
      setStatus(`Queue synced from Firestore fallback (${requests.length}).`, "warn");
    } else {
      setStatus(`Queue synced (${requests.length}).`, "ok");
    }
  } finally {
    state.loading = false;
  }
}

async function handleApprove(request) {
  if (!request?.requestId || state.activeRequestId) {
    return;
  }

  const confirmed = window.confirm(`Approve referral request for ${request.requesterEmail || request.requesterId}?`);
  if (!confirmed) {
    return;
  }

  state.activeRequestId = request.requestId;
  render();
  setStatus("Approving request...", "warn");

  try {
    if (state.fallbackMode) {
      await approveReferralRequestInUsers(request);
    } else {
      await approveReferralRequest(request.requestId);
    }
    setStatus("Referral request approved.", "ok");
    await refreshQueue();
  } catch (error) {
    if (!state.fallbackMode && isFunctionsFailure(error)) {
      try {
        await approveReferralRequestInUsers(request);
        state.fallbackMode = true;
        setStatus("Approved via Firestore fallback.", "warn");
        await refreshQueue();
        return;
      } catch (fallbackError) {
        setStatus(`Approve failed: ${getFriendlyError(fallbackError)}`, "error");
        return;
      }
    }
    setStatus(`Approve failed: ${getFriendlyError(error)}`, "error");
  } finally {
    state.activeRequestId = "";
    render();
  }
}

async function handleReject(request) {
  if (!request?.requestId || state.activeRequestId) {
    return;
  }

  const reason = window.prompt("Optional rejection reason", "") || "";
  const confirmed = window.confirm(`Reject referral request for ${request.requesterEmail || request.requesterId}?`);
  if (!confirmed) {
    return;
  }

  state.activeRequestId = request.requestId;
  render();
  setStatus("Rejecting request...", "warn");

  try {
    if (state.fallbackMode) {
      await rejectReferralRequestInUsers(request, reason);
    } else {
      await rejectReferralRequest(request.requestId, reason);
    }
    setStatus("Referral request rejected.", "ok");
    await refreshQueue();
  } catch (error) {
    if (!state.fallbackMode && isFunctionsFailure(error)) {
      try {
        await rejectReferralRequestInUsers(request, reason);
        state.fallbackMode = true;
        setStatus("Rejected via Firestore fallback.", "warn");
        await refreshQueue();
        return;
      } catch (fallbackError) {
        setStatus(`Reject failed: ${getFriendlyError(fallbackError)}`, "error");
        return;
      }
    }
    setStatus(`Reject failed: ${getFriendlyError(error)}`, "error");
  } finally {
    state.activeRequestId = "";
    render();
  }
}

async function handleApplyCode(request) {
  if (!request?.requestId || state.activeRequestId) {
    return;
  }

  const code = normalizeString(request?.resolvedReferralCode || request?.referralCode);
  if (!code) {
    setStatus("No referral code found on this row.", "error");
    return;
  }

  const confirmed = window.confirm(`Apply referral code ${code} to ${request.requesterEmail || request.requesterId}?`);
  if (!confirmed) {
    return;
  }

  state.activeRequestId = request.requestId;
  render();
  setStatus("Applying referral code...", "warn");

  try {
    await applyReferralCodeFromRequestInUsers(request);
    state.fallbackMode = true;
    setStatus(`Applied referral code ${code}.`, "ok");
    await refreshQueue();
  } catch (error) {
    setStatus(`Apply code failed: ${getFriendlyError(error)}`, "error");
  } finally {
    state.activeRequestId = "";
    render();
  }
}

async function handleAuthedUser(user) {
  state.user = user;
  elements.identityText.textContent = normalizeEmail(user?.email) || "Signed in";
  elements.authStateText.textContent = "Checking admin permissions...";

  try {
    await refreshQueue();
    setMode("ready");
    elements.authStateText.textContent = "Admin access verified";
  } catch (error) {
    if (isPermissionDenied(error)) {
      setMode("denied");
      setStatus("Permission denied.", "error");
      elements.authStateText.textContent = "This account is not authorized";
      return;
    }
    if (isUnauthenticated(error)) {
      setMode("auth");
      setStatus("Authentication required.", "warn");
      elements.authStateText.textContent = "Sign in again";
      return;
    }
    setMode("ready");
    state.requests = [];
    render();
    setStatus(`Load failed: ${getFriendlyError(error)}`, "error");
    elements.authStateText.textContent = "Admin access verified, but queue load failed";
  }
}

function bindEvents() {
  elements.loginBtn?.addEventListener("click", async () => {
    setStatus("Starting sign-in...", "warn");
    try {
      await signInWithGoogle();
    } catch (error) {
      setStatus(`Sign-in failed: ${getFriendlyError(error)}`, "error");
    }
  });

  elements.logoutBtn?.addEventListener("click", async () => {
    try {
      await signOutCurrentUser();
      setStatus("Signed out.", "warn");
    } catch (error) {
      setStatus(`Sign-out failed: ${getFriendlyError(error)}`, "error");
    }
  });

  elements.statusFilter?.addEventListener("change", async (event) => {
    const nextStatus = normalizeString(event?.target?.value).toLowerCase();
    if (
      nextStatus !== REFERRAL_APPROVAL_STATUS.all &&
      nextStatus !== REFERRAL_APPROVAL_STATUS.pending &&
      nextStatus !== REFERRAL_APPROVAL_STATUS.approved &&
      nextStatus !== REFERRAL_APPROVAL_STATUS.rejected
    ) {
      return;
    }
    state.statusFilter = nextStatus;
    if (state.user) {
      try {
        await refreshQueue();
      } catch (error) {
        setStatus(`Load failed: ${getFriendlyError(error)}`, "error");
      }
    }
  });

  elements.searchInput?.addEventListener("input", (event) => {
    state.searchQuery = normalizeString(event?.target?.value);
    render();
  });

  elements.refreshBtn?.addEventListener("click", async () => {
    if (!state.user) {
      return;
    }
    try {
      await refreshQueue();
    } catch (error) {
      setStatus(`Refresh failed: ${getFriendlyError(error)}`, "error");
    }
  });

  elements.toggleSidebarBtn?.addEventListener("click", () => {
    const nextCollapsed = !state.sidebarCollapsed;
    setSidebarCollapsed(nextCollapsed);
    saveSidebarCollapsedPreference(nextCollapsed);
  });
}

async function initialize() {
  bindEvents();
  setSidebarCollapsed(loadSidebarCollapsedPreference());
  refreshIcons();
  setMode("auth");
  setStatus("Initializing...", "warn");

  try {
    await initializeFirebaseClient();
    await processRedirectResult();
  } catch (error) {
    setStatus(`Initialization failed: ${getFriendlyError(error)}`, "error");
  }

  await onAuthStateChange(async (user) => {
    if (!user) {
      state.user = null;
      state.requests = [];
      state.activeRequestId = "";
      elements.identityText.textContent = "Not signed in";
      elements.authStateText.textContent = "Sign in with your super admin account";
      setMode("auth");
      render();
      setStatus("Sign in required.", "warn");
      return;
    }

    await handleAuthedUser(user);
  });
}

void initialize();
