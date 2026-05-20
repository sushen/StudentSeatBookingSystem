import { formatDateTime } from "../utils/formatters.js";

export function renderAlerts(container, alerts) {
  if (!container) {
    return;
  }

  container.innerHTML = alerts.map((alert) => `
    <li class="alert-item ${alert.priority}">
      <div class="alert-priority">${alert.priority.toUpperCase()}</div>
      <div class="alert-content">
        <h4>${alert.title}</h4>
        <p>${alert.detail}</p>
        <time>${formatDateTime(alert.timestampMs)}</time>
      </div>
    </li>
  `).join("");
}
