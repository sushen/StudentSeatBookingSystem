import { formatDateTime, formatInteger, formatPercent, formatRelativeDays } from "../utils/formatters.js";

function toStatusLabel(status) {
  if (!status || status === "none") {
    return "None";
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function renderPhaseProgressRows(student) {
  return student.phaseProgressList.map((phaseProgress) => `
    <li class="drawer-phase-row">
      <div class="drawer-phase-head">
        <p>${phaseProgress.phaseLabel}</p>
        <span>${formatPercent(phaseProgress.progressPercent, 0)}</span>
      </div>
      <div class="drawer-progress-track">
        <div class="drawer-progress-fill" style="width:${phaseProgress.progressPercent}%"></div>
      </div>
      <small>${formatInteger(phaseProgress.completedLessons)} / ${formatInteger(phaseProgress.totalLessons)} lessons</small>
    </li>
  `).join("");
}

function renderBookingHistoryRows(student) {
  if (!student.bookings.length) {
    return `<tr><td colspan="4">No booking history</td></tr>`;
  }
  return student.bookings.map((booking) => `
    <tr>
      <td>${booking.phaseLabel}</td>
      <td><span class="booking-badge ${booking.effectiveStatus}">${toStatusLabel(booking.effectiveStatus)}</span></td>
      <td>${formatDateTime(booking.createdAtMs)}</td>
      <td>${formatDateTime(booking.updatedAtMs || booking.approvedAtMs || booking.rejectedAtMs || booking.cancelledAtMs)}</td>
    </tr>
  `).join("");
}

function renderTimelineRows(student, nowMs) {
  if (!student.timeline.length) {
    return `<li class="timeline-item"><p>No timeline events found.</p></li>`;
  }
  return student.timeline.map((event) => `
    <li class="timeline-item">
      <p>${event.text}</p>
      <time>${formatDateTime(event.timestampMs)} (${formatRelativeDays(event.timestampMs, nowMs)})</time>
    </li>
  `).join("");
}

function renderFeatureRows(student) {
  return student.featureUnlocks.map((feature) => `
    <li class="feature-chip ${feature.unlocked ? "unlocked" : "locked"}">${feature.title}</li>
  `).join("");
}

export function createStudentDrawer(drawerElements) {
  const {
    drawer,
    closeButton,
    backdrop,
    profileRoot,
    phaseRoot,
    bookingsRoot,
    timelineRoot,
    featuresRoot
  } = drawerElements;

  function close() {
    drawer.classList.remove("open");
    backdrop.classList.remove("open");
  }

  function open(student, nowMs = Date.now()) {
    profileRoot.innerHTML = `
      <header class="drawer-profile-header">
        <h3>${student.name}</h3>
        <p>${student.email || "-"}</p>
      </header>
      <dl class="drawer-profile-grid">
        <div><dt>User ID</dt><dd>${student.userId}</dd></div>
        <div><dt>WhatsApp</dt><dd>${student.whatsappNumber || "-"}</dd></div>
        <div><dt>Current Phase</dt><dd>${student.currentPhaseLabel}</dd></div>
        <div><dt>Progress</dt><dd>${formatPercent(student.overallProgressPercent, 0)}</dd></div>
        <div><dt>Completed Lessons</dt><dd>${formatInteger(student.completedLessons)}</dd></div>
        <div><dt>Last Learning Activity</dt><dd>${formatRelativeDays(student.lastLearningActivityMs, nowMs)}</dd></div>
        <div><dt>Booking Status</dt><dd>${toStatusLabel(student.latestBookingStatus)}</dd></div>
        <div><dt>Referral Source</dt><dd>${student.referralSource || "Direct"}</dd></div>
        <div><dt>Risk</dt><dd class="risk-${student.riskLevel}">${student.riskLevel.toUpperCase()}</dd></div>
      </dl>
      <p class="drawer-risk-notes">${student.riskReasons.length ? student.riskReasons.join(" | ") : "No active risk flag."}</p>
    `;

    phaseRoot.innerHTML = renderPhaseProgressRows(student);
    bookingsRoot.innerHTML = renderBookingHistoryRows(student);
    timelineRoot.innerHTML = renderTimelineRows(student, nowMs);
    featuresRoot.innerHTML = renderFeatureRows(student);

    drawer.classList.add("open");
    backdrop.classList.add("open");
  }

  closeButton.addEventListener("click", close);
  backdrop.addEventListener("click", close);

  return { open, close };
}
