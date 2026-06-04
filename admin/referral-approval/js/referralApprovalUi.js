import { REFERRAL_APPROVAL_STATUS } from "./referralApprovalApi.js";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(ms) {
  if (!ms || !Number.isFinite(ms)) {
    return "-";
  }
  return new Date(ms).toLocaleString();
}

function isUnknownLabel(value) {
  const normalized = normalizeString(value).toLowerCase();
  return !normalized || normalized === "unknown user" || normalized === "unknown referrer";
}

function displayRequesterName(request = {}) {
  const name = normalizeString(request.requesterName);
  if (name && !isUnknownLabel(name)) {
    return name;
  }
  return normalizeString(request.requesterEmail || request.requesterId || "Unknown User");
}

function displayReferrerName(request = {}) {
  const name = normalizeString(request.referrerName);
  if (name && !isUnknownLabel(name)) {
    return name;
  }
  return normalizeString(
    request.referrerEmail ||
    request.referrerId ||
    request.resolvedReferralCode ||
    request.referralCode ||
    "Unknown Referrer"
  );
}

export function filterRequestsByQuery(requests, query) {
  const normalizedQuery = normalizeString(query).toLowerCase();
  if (!normalizedQuery) {
    return requests.slice();
  }

  return requests.filter((request) => {
    const haystack = [
      request.requestId,
      request.requesterName,
      request.requesterEmail,
      request.requesterPhone,
      request.requesterWhatsApp,
      request.requesterId,
      request.referralCode,
      request.resolvedReferralCode,
      request.referrerName,
      request.referrerEmail,
      request.referrerId,
      request.status,
      request.source,
      request.sessionId,
      request.reviewedBy,
      request.reviewedByEmail,
      request.reviewReason
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function renderRequestRows({
  tbody,
  emptyTextEl,
  requests,
  activeRequestId = "",
  onApprove,
  onReject,
  onApplyCode,
  onRejectToAdmin
}) {
  if (!tbody) {
    return;
  }

  tbody.innerHTML = "";
  if (!Array.isArray(requests) || requests.length === 0) {
    if (emptyTextEl) {
      emptyTextEl.classList.remove("hidden");
    }
    return;
  }

  if (emptyTextEl) {
    emptyTextEl.classList.add("hidden");
  }

  const rows = requests.map((request) => {
    const tr = document.createElement("tr");
    const requestedAt = formatDateTime(request.createdAtMs || request.updatedAtMs);
    const reviewedAt = formatDateTime(request.reviewedAtMs);
    const isPending = request.status === REFERRAL_APPROVAL_STATUS.pending;
    const isBusy = activeRequestId && activeRequestId === request.requestId;

    tr.innerHTML = `
      <td>
        <p class="mono">${escapeHtml(request.requestId || "-")}</p>
        <p class="meta-line">Requested: ${escapeHtml(requestedAt)}</p>
        <p class="meta-line">Updated: ${escapeHtml(formatDateTime(request.updatedAtMs || request.createdAtMs))}</p>
      </td>
      <td>
        <p>${escapeHtml(displayRequesterName(request))}</p>
        <p class="meta-line">${escapeHtml(request.requesterEmail || "-")}</p>
        <p class="meta-line mono">${escapeHtml(request.requesterId || "-")}</p>
        ${request.requesterPhone ? `<p class="meta-line">Phone: ${escapeHtml(request.requesterPhone)}</p>` : ""}
        ${request.requesterWhatsApp ? `<p class="meta-line">WhatsApp: ${escapeHtml(request.requesterWhatsApp)}</p>` : ""}
      </td>
      <td>
        <p class="meta-line">Requested Code</p>
        <p class="mono">${escapeHtml(request.referralCode || "-")}</p>
        <p class="meta-line">Resolved Code</p>
        <p class="mono">${escapeHtml(request.resolvedReferralCode || "-")}</p>
      </td>
      <td>
        <p>${escapeHtml(displayReferrerName(request))}</p>
        <p class="meta-line">${escapeHtml(request.referrerEmail || "-")}</p>
        <p class="meta-line mono">${escapeHtml(request.referrerId || "-")}</p>
      </td>
      <td>
        <span class="status-pill ${escapeHtml(request.status)}">${escapeHtml(request.status.toUpperCase())}</span>
        ${request.reviewReason ? `<p class="meta-line">${escapeHtml(request.reviewReason)}</p>` : ""}
        ${request.reviewedByEmail ? `<p class="meta-line">By: ${escapeHtml(request.reviewedByEmail)}</p>` : ""}
        ${request.reviewedBy ? `<p class="meta-line mono">${escapeHtml(request.reviewedBy)}</p>` : ""}
        ${request.reviewedAtMs ? `<p class="meta-line">At: ${escapeHtml(reviewedAt)}</p>` : ""}
      </td>
      <td>
        <p class="meta-line">Source: ${escapeHtml(request.source || "web")}</p>
        ${request.sessionId ? `<p class="meta-line">Session</p><p class="meta-line mono">${escapeHtml(request.sessionId)}</p>` : `<p class="meta-line">Session: -</p>`}
      </td>
      <td>
        <div class="row-actions"></div>
      </td>
    `;

    const actionCell = tr.querySelector(".row-actions");
    if (actionCell && isPending) {
      const approveBtn = document.createElement("button");
      approveBtn.type = "button";
      approveBtn.className = "approve-btn";
      approveBtn.textContent = isBusy ? "Approving..." : "Approve";
      approveBtn.disabled = Boolean(isBusy);
      approveBtn.addEventListener("click", () => {
        if (typeof onApprove === "function") {
          onApprove(request);
        }
      });

      const rejectBtn = document.createElement("button");
      rejectBtn.type = "button";
      rejectBtn.className = "reject-btn";
      rejectBtn.textContent = isBusy ? "Rejecting..." : "Reject";
      rejectBtn.disabled = Boolean(isBusy);
      rejectBtn.addEventListener("click", () => {
        if (typeof onReject === "function") {
          onReject(request);
        }
      });

      actionCell.appendChild(approveBtn);
      actionCell.appendChild(rejectBtn);
    } else if (actionCell) {
      const applyCodeBtn = document.createElement("button");
      applyCodeBtn.type = "button";
      applyCodeBtn.className = "approve-btn";
      applyCodeBtn.textContent = isBusy ? "Applying..." : "Apply Code";
      applyCodeBtn.disabled = Boolean(isBusy);
      applyCodeBtn.addEventListener("click", () => {
        if (typeof onApplyCode === "function") {
          onApplyCode(request);
        }
      });
      actionCell.appendChild(applyCodeBtn);
      if (
        request.status !== REFERRAL_APPROVAL_STATUS.rejected &&
        typeof onRejectToAdmin === "function"
      ) {
        const rejectToAdminBtn = document.createElement("button");
        rejectToAdminBtn.type = "button";
        rejectToAdminBtn.className = "reject-btn";
        rejectToAdminBtn.textContent = isBusy ? "Rejecting..." : "Reject";
        rejectToAdminBtn.disabled = Boolean(isBusy);
        rejectToAdminBtn.addEventListener("click", () => {
          onRejectToAdmin(request);
        });
        actionCell.appendChild(rejectToAdminBtn);
      }
    }

    return tr;
  });

  rows.forEach((row) => {
    tbody.appendChild(row);
  });
}
