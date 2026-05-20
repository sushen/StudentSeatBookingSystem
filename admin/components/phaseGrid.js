import { formatInteger, formatPercent } from "../utils/formatters.js";

function phaseHealthClass(phase) {
  if (phase.dropOffPercent >= 60 || phase.stalledLearners >= 4) {
    return "critical";
  }
  if (phase.dropOffPercent >= 35 || phase.pendingRequests >= 4) {
    return "warning";
  }
  return "healthy";
}

export function renderPhaseGrid(container, phaseAnalytics) {
  if (!container) {
    return;
  }

  container.innerHTML = phaseAnalytics.map((phase) => {
    const health = phaseHealthClass(phase);
    return `
      <article class="phase-analytics-card ${health}">
        <header>
          <h3>${phase.title}</h3>
          <span class="phase-chip">P${phase.order}</span>
        </header>
        <dl>
          <div><dt>Total Enrolled</dt><dd>${formatInteger(phase.enrolled)}</dd></div>
          <div><dt>Active Learners</dt><dd>${formatInteger(phase.activeLearners)}</dd></div>
          <div><dt>Completion</dt><dd>${formatPercent(phase.completionPercent, 1)}</dd></div>
          <div><dt>Avg Progress</dt><dd>${formatPercent(phase.averageProgress, 1)}</dd></div>
          <div><dt>Drop-off</dt><dd>${formatPercent(phase.dropOffPercent, 1)}</dd></div>
          <div><dt>Pending Requests</dt><dd>${formatInteger(phase.pendingRequests)}</dd></div>
          <div><dt>Seat Occupancy</dt><dd>${formatInteger(phase.bookedSeats)} / ${formatInteger(phase.totalSeats)} (${formatPercent(phase.occupancyPercent, 0)})</dd></div>
        </dl>
      </article>
    `;
  }).join("");
}
