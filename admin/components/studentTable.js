import { formatDate, formatInteger, formatPercent, formatRelativeDays } from "../utils/formatters.js";

function buildRiskBadge(riskLevel) {
  const label = riskLevel === "high" ? "High" : riskLevel === "medium" ? "Medium" : "Low";
  return `<span class="risk-badge ${riskLevel}">${label}</span>`;
}

function buildBookingBadge(status) {
  const normalized = status || "none";
  const title = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return `<span class="booking-badge ${normalized}">${title}</span>`;
}

export function renderStudentTable({ tbody, rows, selectedStudentId, onRowClick, nowMs }) {
  if (!tbody) {
    return 0;
  }

  const fragment = document.createDocumentFragment();
  rows.forEach((student) => {
    const row = document.createElement("tr");
    row.dataset.studentId = student.userId;
    row.classList.toggle("active", selectedStudentId === student.userId);

    row.innerHTML = `
      <td>
        <div class="student-cell-name">
          <p class="student-name">${student.name || "-"}</p>
          <span class="student-id">${student.userId}</span>
        </div>
      </td>
      <td>${student.email || "-"}</td>
      <td>${student.whatsappNumber || "-"}</td>
      <td>${student.currentPhaseLabel}</td>
      <td>${formatPercent(student.overallProgressPercent, 0)}</td>
      <td>${formatInteger(student.completedLessons)}</td>
      <td>${formatRelativeDays(student.lastLearningActivityMs, nowMs)}</td>
      <td>${formatDate(student.tableDateMs)}</td>
      <td>${buildBookingBadge(student.latestBookingStatus)}</td>
      <td>${student.referralSource || "Direct"}</td>
      <td>${buildRiskBadge(student.riskLevel)}</td>
    `;

    row.addEventListener("click", () => {
      onRowClick(student.userId);
    });

    fragment.appendChild(row);
  });

  tbody.innerHTML = "";
  tbody.appendChild(fragment);
  return rows.length;
}
