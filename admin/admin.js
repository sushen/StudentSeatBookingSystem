import { renderAlerts } from "./components/alertsPanel.js";
import { createStudentDrawer } from "./components/deepDiveDrawer.js";
import { renderKpiCards } from "./components/kpiCards.js";
import { renderPhaseGrid } from "./components/phaseGrid.js";
import { renderStudentTable } from "./components/studentTable.js";
import { renderBookingFunnelChart } from "./charts/bookingCharts.js";
import { ChartRegistryManager } from "./charts/chartRegistry.js";
import { renderLearningCharts } from "./charts/learningCharts.js";
import { renderReferralCharts } from "./charts/referralCharts.js";
import { buildOperationalAnalytics, computeBookingFunnel } from "./services/analyticsService.js";
import { RealtimeDataService } from "./services/dataService.js";
import {
  initializeFirebase,
  isAdminUser,
  onAuthStateChange,
  processRedirectResult,
  signInWithGoogle,
  signOutCurrentUser
} from "./services/firebaseService.js";
import { formatDateTime, formatInteger, formatPercent } from "./utils/formatters.js";

const state = {
  firebase: null,
  authListenerUnsubscribe: null,
  dataService: null,
  dataSnapshot: null,
  analytics: null,
  previousSignals: {},
  renderQueued: false,
  authSessionId: 0,
  selectedStudentId: null,
  kpiValueMemory: new Map(),
  bookingFilters: {
    phaseId: "all",
    days: 0
  },
  studentFilters: {
    search: "",
    risk: "all",
    phaseId: "all",
    bookingStatus: "all"
  },
  studentSort: {
    key: "riskScore",
    direction: "desc"
  }
};

const elements = {
  body: document.body,
  loginBtn: document.getElementById("adminLoginBtn"),
  logoutBtn: document.getElementById("adminLogoutBtn"),
  authStateText: document.getElementById("authStateText"),
  adminIdentityText: document.getElementById("adminIdentityText"),
  statusText: document.getElementById("opsStatusText"),
  statusDot: document.getElementById("opsStatusDot"),
  authGate: document.getElementById("authGate"),
  accessDenied: document.getElementById("accessDenied"),
  workspace: document.getElementById("adminWorkspace"),
  kpiGrid: document.getElementById("kpiGrid"),
  learningTrendCanvas: document.getElementById("learningTrendChart"),
  activeByPhaseCanvas: document.getElementById("activeByPhaseChart"),
  learningDistributionCanvas: document.getElementById("learningDistributionChart"),
  metricActiveToday: document.getElementById("metricActiveToday"),
  metricInactive: document.getElementById("metricInactive"),
  metricAvgCompletion: document.getElementById("metricAvgCompletion"),
  metricVelocity: document.getElementById("metricVelocity"),
  metricMostCompleted: document.getElementById("metricMostCompleted"),
  metricLeastActive: document.getElementById("metricLeastActive"),
  studentSearch: document.getElementById("studentSearchInput"),
  studentRiskFilter: document.getElementById("studentRiskFilter"),
  studentPhaseFilter: document.getElementById("studentPhaseFilter"),
  studentBookingFilter: document.getElementById("studentBookingFilter"),
  studentCountLabel: document.getElementById("studentCountLabel"),
  studentTableBody: document.getElementById("studentTableBody"),
  studentSortHeaders: Array.from(document.querySelectorAll("[data-student-sort]")),
  bookingPhaseFilter: document.getElementById("bookingPhaseFilter"),
  bookingWindowFilter: document.getElementById("bookingWindowFilter"),
  bookingFunnelCanvas: document.getElementById("bookingFunnelChart"),
  bookingFunnelMeta: document.getElementById("bookingFunnelMeta"),
  phaseAnalyticsGrid: document.getElementById("phaseAnalyticsGrid"),
  referralGrowthCanvas: document.getElementById("referralGrowthChart"),
  referralConversionCanvas: document.getElementById("referralConversionChart"),
  referralLeaderboardBody: document.getElementById("referralLeaderboardBody"),
  referralSummaryText: document.getElementById("referralSummaryText"),
  alertsList: document.getElementById("alertsList"),
  drawerBackdrop: document.getElementById("studentDrawerBackdrop"),
  drawer: document.getElementById("studentDrawer"),
  drawerCloseBtn: document.getElementById("drawerCloseBtn"),
  drawerActionBar: document.getElementById("drawerActionBar"),
  drawerProfile: document.getElementById("drawerProfile"),
  drawerActions: document.getElementById("drawerActions"),
  drawerPhases: document.getElementById("drawerPhases"),
  drawerBookings: document.getElementById("drawerBookingsBody"),
  drawerTimeline: document.getElementById("drawerTimeline"),
  drawerFeatures: document.getElementById("drawerFeatures")
};

const chartRegistry = new ChartRegistryManager();
const drawerController = createStudentDrawer({
  drawer: elements.drawer,
  closeButton: elements.drawerCloseBtn,
  backdrop: elements.drawerBackdrop,
  actionBarRoot: elements.drawerActionBar,
  actionsRoot: elements.drawerActions,
  profileRoot: elements.drawerProfile,
  phaseRoot: elements.drawerPhases,
  bookingsRoot: elements.drawerBookings,
  timelineRoot: elements.drawerTimeline,
  featuresRoot: elements.drawerFeatures
});

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

function ensurePhaseSelectOptions(selectEl, phases, selected) {
  if (!selectEl) {
    return selected;
  }
  const options = [`<option value="all">All Phases</option>`].concat(
    phases.map((phase) => `<option value="${phase.phaseId}">P${phase.order} - ${phase.title}</option>`)
  );
  selectEl.innerHTML = options.join("");
  const isValid = selected === "all" || phases.some((phase) => phase.phaseId === selected);
  const resolved = isValid ? selected : "all";
  selectEl.value = resolved;
  return resolved;
}

function compareStudents(a, b, sort) {
  const factor = sort.direction === "asc" ? 1 : -1;
  const key = sort.key;
  const aValue = a[key];
  const bValue = b[key];

  if (typeof aValue === "string" || typeof bValue === "string") {
    return String(aValue || "").localeCompare(String(bValue || "")) * factor;
  }
  return ((Number(aValue || 0) - Number(bValue || 0)) * factor);
}

function filteredStudents() {
  const model = state.analytics;
  if (!model) {
    return [];
  }

  const query = state.studentFilters.search.trim().toLowerCase();
  const filtered = model.students.filter((student) => {
    if (query) {
      const haystack = `${student.name} ${student.email} ${student.userId}`.toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }
    if (state.studentFilters.risk !== "all" && student.riskLevel !== state.studentFilters.risk) {
      return false;
    }
    if (state.studentFilters.phaseId !== "all" && student.currentPhaseId !== state.studentFilters.phaseId) {
      return false;
    }
    if (state.studentFilters.bookingStatus !== "all" && student.latestBookingStatus !== state.studentFilters.bookingStatus) {
      return false;
    }
    return true;
  });

  return filtered.sort((a, b) => compareStudents(a, b, state.studentSort));
}

function renderLearningInsights() {
  const model = state.analytics;
  if (!model) {
    return;
  }
  elements.metricActiveToday.textContent = formatInteger(model.learning.activeToday);
  elements.metricInactive.textContent = formatInteger(model.learning.inactive7Plus);
  elements.metricAvgCompletion.textContent = formatPercent(model.learning.averageCompletionPercent, 1);
  elements.metricVelocity.textContent = `${model.learning.averageVelocityPerDay.toFixed(2)}%/day`;
  elements.metricMostCompleted.textContent = model.learning.mostCompletedPhase
    ? model.learning.mostCompletedPhase.title
    : "No phase data";
  elements.metricLeastActive.textContent = model.learning.leastActivePhase
    ? model.learning.leastActivePhase.title
    : "No phase data";
}

function renderKpis() {
  const model = state.analytics;
  if (!model) {
    return;
  }

  const cards = [
    {
      key: "totalStudents",
      label: "Total Students",
      value: model.kpis.totalStudents,
      type: "number",
      caption: "Registered learners"
    },
    {
      key: "activeStudents",
      label: "Active Students",
      value: model.kpis.activeStudents,
      type: "number",
      caption: "Studied today"
    },
    {
      key: "pendingBookings",
      label: "Pending Bookings",
      value: model.kpis.pendingBookings,
      type: "number",
      caption: "Awaiting review"
    },
    {
      key: "reviewingBookings",
      label: "Reviewing Bookings",
      value: model.kpis.reviewingBookings,
      type: "number",
      caption: "In moderation"
    },
    {
      key: "approvedStudents",
      label: "Approved Students",
      value: model.kpis.approvedStudents,
      type: "number",
      caption: "At least one approved phase"
    },
    {
      key: "completionRate",
      label: "Completion Rate",
      value: model.kpis.completionRate,
      type: "percent",
      caption: "Learners at 100%"
    },
    {
      key: "totalReferrals",
      label: "Total Referrals",
      value: model.kpis.totalReferrals,
      type: "number",
      caption: "Referral joins"
    },
    {
      key: "conversionRate",
      label: "Conversion Rate",
      value: model.kpis.conversionRate,
      type: "percent",
      caption: "Referral to conversion"
    },
    {
      key: "estimatedRevenue",
      label: "Estimated Revenue",
      value: model.kpis.estimatedRevenue,
      type: "currency",
      caption: "From approved bookings pricing fields"
    },
    {
      key: "activeCohorts",
      label: "Active Cohorts",
      value: model.kpis.activeCohorts,
      type: "number",
      caption: "Healthy phase cohorts"
    }
  ];

  state.kpiValueMemory = renderKpiCards(elements.kpiGrid, cards, state.kpiValueMemory);
}

function renderStudentMonitor() {
  const model = state.analytics;
  if (!model) {
    return;
  }

  state.studentFilters.phaseId = ensurePhaseSelectOptions(
    elements.studentPhaseFilter,
    model.phases,
    state.studentFilters.phaseId
  );
  const rows = filteredStudents();
  const renderedCount = renderStudentTable({
    tbody: elements.studentTableBody,
    rows,
    selectedStudentId: state.selectedStudentId,
    nowMs: model.generatedAtMs,
    onRowClick: (userId) => {
      state.selectedStudentId = userId;
      const selected = model.students.find((student) => student.userId === userId);
      if (selected) {
        drawerController.open(selected, model.generatedAtMs);
      }
      renderStudentMonitor();
    }
  });

  elements.studentCountLabel.textContent = `${formatInteger(renderedCount)} students`;
}

function renderBookingSection() {
  const model = state.analytics;
  if (!model) {
    return;
  }

  state.bookingFilters.phaseId = ensurePhaseSelectOptions(
    elements.bookingPhaseFilter,
    model.phases,
    state.bookingFilters.phaseId
  );
  const funnel = computeBookingFunnel(model.bookings, state.bookingFilters, model.generatedAtMs);
  renderBookingFunnelChart(chartRegistry, elements.bookingFunnelCanvas, funnel);

  elements.bookingFunnelMeta.innerHTML = `
    <div class="booking-meta-rows">
      ${funnel.steps.map((step) => `
        <div>
          <p>${step.label}</p>
          <strong>${formatInteger(step.count)}</strong>
          <span>${formatPercent(step.percentOfTotal, 1)}</span>
        </div>
      `).join("")}
    </div>
    <div class="booking-conversions">
      <p>Pending -> Reviewing: <strong>${formatPercent(funnel.conversionRates.pendingToReviewing, 1)}</strong></p>
      <p>Reviewing -> Approved: <strong>${formatPercent(funnel.conversionRates.reviewingToApproved, 1)}</strong></p>
      <p>Pending -> Approved: <strong>${formatPercent(funnel.conversionRates.pendingToApproved, 1)}</strong></p>
      <p>Total in scope: <strong>${formatInteger(funnel.total)}</strong></p>
    </div>
  `;
}

function renderReferralSection() {
  const model = state.analytics;
  if (!model) {
    return;
  }
  renderReferralCharts(chartRegistry, elements, model.referrals);

  elements.referralSummaryText.textContent =
    `${formatInteger(model.referrals.totalInvites)} invites | ${formatInteger(model.referrals.totalConversions)} conversions | ${formatPercent(model.referrals.conversionRate, 1)} conversion rate`;

  const rows = model.referrals.leaderboard.slice(0, 10).map((entry, index) => `
    <tr>
      <td>#${index + 1}</td>
      <td>
        <div class="leaderboard-user">
          <p>${entry.name}</p>
          <span>${entry.email}</span>
        </div>
      </td>
      <td>${formatInteger(entry.invites)}</td>
      <td>${formatInteger(entry.conversions)}</td>
      <td>${entry.invites > 0 ? formatPercent((entry.conversions / entry.invites) * 100, 1) : "0.0%"}</td>
    </tr>
  `).join("");
  elements.referralLeaderboardBody.innerHTML = rows || `<tr><td colspan="5">No referral stats yet.</td></tr>`;
}

function renderAllSections() {
  const model = state.analytics;
  if (!model) {
    return;
  }

  renderKpis();
  renderLearningInsights();
  renderLearningCharts(chartRegistry, elements, model);
  renderStudentMonitor();
  renderBookingSection();
  renderPhaseGrid(elements.phaseAnalyticsGrid, model.phaseAnalytics);
  renderReferralSection();
  renderAlerts(elements.alertsList, model.alerts);
}

function scheduleRender() {
  if (state.renderQueued) {
    return;
  }
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    if (!state.dataSnapshot) {
      return;
    }
    state.analytics = buildOperationalAnalytics(state.dataSnapshot, {
      nowMs: Date.now(),
      previousSignals: state.previousSignals,
      bookingFilters: state.bookingFilters
    });
    state.previousSignals = state.analytics.runtimeSignals;
    renderAllSections();
  });
}

function stopDataService() {
  if (!state.dataService) {
    return;
  }
  state.dataService.stop();
  state.dataService = null;
  state.dataSnapshot = null;
  state.analytics = null;
  chartRegistry.destroyAll();
}

function startDataService() {
  stopDataService();
  state.dataService = new RealtimeDataService(state.firebase);
  state.dataService.onUpdate((snapshot) => {
    state.dataSnapshot = snapshot;
    const loadedCount = Object.values(snapshot.loaded).filter(Boolean).length;
    const totalSources = Object.keys(snapshot.loaded).length;
    const progressCount = snapshot.progressDocs.length;
    const lessonDocCount = snapshot.lessonDocs.length;
    setStatus(
      `Realtime sync: ${loadedCount}/${totalSources} sources ready | progress docs: ${progressCount} | lesson docs: ${lessonDocCount}`,
      loadedCount === totalSources ? "ok" : "warn"
    );
    scheduleRender();
  });
  state.dataService.onError(({ source, error }) => {
    setStatus(`Firestore listener error (${source}): ${error.message}`, "error");
  });
  state.dataService.start();
}

async function handleAuthState(user, sessionId) {
  if (sessionId !== state.authSessionId) {
    return;
  }

  if (!user) {
    elements.adminIdentityText.textContent = "Not signed in";
    elements.authStateText.textContent = "Sign in with your admin account";
    setMode("auth");
    setStatus("Waiting for admin sign-in", "warn");
    stopDataService();
    return;
  }

  const adminGranted = await isAdminUser(user);
  if (sessionId !== state.authSessionId) {
    return;
  }

  elements.adminIdentityText.textContent = `${user.displayName || "Admin"} (${user.email || "-"})`;
  if (!adminGranted) {
    elements.authStateText.textContent = "This account does not have admin access";
    setMode("denied");
    setStatus("Access denied. Admin role required.", "error");
    stopDataService();
    return;
  }

  elements.authStateText.textContent = "Admin access granted";
  setMode("ready");
  setStatus("Connecting realtime analytics...", "warn");
  startDataService();
}

function bindEvents() {
  elements.loginBtn.addEventListener("click", async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      setStatus(`Sign-in failed: ${error.message}`, "error");
    }
  });

  elements.logoutBtn.addEventListener("click", async () => {
    try {
      await signOutCurrentUser();
    } catch (error) {
      setStatus(`Sign-out failed: ${error.message}`, "error");
    }
  });

  elements.studentSearch.addEventListener("input", (event) => {
    state.studentFilters.search = String(event.target.value || "");
    renderStudentMonitor();
  });
  elements.studentRiskFilter.addEventListener("change", (event) => {
    state.studentFilters.risk = String(event.target.value || "all");
    renderStudentMonitor();
  });
  elements.studentPhaseFilter.addEventListener("change", (event) => {
    state.studentFilters.phaseId = String(event.target.value || "all");
    renderStudentMonitor();
  });
  elements.studentBookingFilter.addEventListener("change", (event) => {
    state.studentFilters.bookingStatus = String(event.target.value || "all");
    renderStudentMonitor();
  });

  elements.studentSortHeaders.forEach((header) => {
    header.addEventListener("click", () => {
      const nextKey = header.dataset.studentSort;
      if (!nextKey) {
        return;
      }
      if (state.studentSort.key === nextKey) {
        state.studentSort.direction = state.studentSort.direction === "asc" ? "desc" : "asc";
      } else {
        state.studentSort.key = nextKey;
        state.studentSort.direction = nextKey === "name" ? "asc" : "desc";
      }
      elements.studentSortHeaders.forEach((el) => {
        const isActive = el.dataset.studentSort === state.studentSort.key;
        el.classList.toggle("active", isActive);
        el.dataset.direction = isActive ? state.studentSort.direction : "none";
      });
      renderStudentMonitor();
    });
  });

  elements.bookingPhaseFilter.addEventListener("change", (event) => {
    state.bookingFilters.phaseId = String(event.target.value || "all");
    renderBookingSection();
  });

  elements.bookingWindowFilter.addEventListener("change", (event) => {
    state.bookingFilters.days = Number(event.target.value || 0);
    renderBookingSection();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      drawerController.close();
    }
  });
}

async function initializeAdminApp() {
  bindEvents();
  refreshIcons();
  setMode("auth");
  setStatus("Initializing Firebase...", "warn");

  try {
    state.firebase = await initializeFirebase();
    try {
      await processRedirectResult();
    } catch (redirectError) {
      setStatus(`Redirect sign-in warning: ${redirectError.message}`, "warn");
    }
    state.authSessionId += 1;
    const currentSessionId = state.authSessionId;
    state.authListenerUnsubscribe = await onAuthStateChange((user) => {
      void handleAuthState(user, currentSessionId);
    });
    setStatus("Firebase ready", "ok");
  } catch (error) {
    setStatus(`Initialization failed: ${error.message}`, "error");
    elements.authStateText.textContent = "Unable to initialize admin dashboard";
  }
}

window.addEventListener("beforeunload", () => {
  if (state.authListenerUnsubscribe) {
    state.authListenerUnsubscribe();
  }
  stopDataService();
});

void initializeAdminApp();
