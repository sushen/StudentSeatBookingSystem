import { formatDateTime, formatInteger, formatPercent, formatRelativeDays } from "../utils/formatters.js";

const FOLLOW_UP_STORAGE_KEY = "admin.studentFollowUps.v1";
const FOLLOW_UP_STATUSES = [
  { value: "not_contacted", label: "Not Contacted" },
  { value: "contacted", label: "Contacted" },
  { value: "waiting_reply", label: "Waiting Reply" },
  { value: "follow_up_due", label: "Follow-Up Due" },
  { value: "closed", label: "Closed" }
];
const FOLLOW_UP_PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" }
];
const DEFAULT_FOLLOW_UP = {
  status: "not_contacted",
  priority: "medium",
  lastContactedDate: "",
  notes: ""
};

function toStatusLabel(status) {
  if (!status || status === "none") {
    return "None";
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function splitName(fullName) {
  const tokens = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) {
    return { givenName: "", familyName: "" };
  }
  if (tokens.length === 1) {
    return { givenName: tokens[0], familyName: "" };
  }
  return {
    givenName: tokens[0],
    familyName: tokens.slice(1).join(" ")
  };
}

function sanitizeWhatsappNumber(number) {
  const digits = String(number || "").replace(/[^\d]/g, "");
  if (!digits) {
    return "";
  }
  if (digits.startsWith("00")) {
    return digits.slice(2);
  }
  return digits;
}

function resolvePrimaryPhone(student) {
  return String(student.whatsappNumber || student.phoneNumber || student.phone || "").trim();
}

function buildDefaultFollowUp() {
  return {
    status: DEFAULT_FOLLOW_UP.status,
    priority: DEFAULT_FOLLOW_UP.priority,
    lastContactedDate: DEFAULT_FOLLOW_UP.lastContactedDate,
    notes: DEFAULT_FOLLOW_UP.notes
  };
}

function normalizeFollowUp(record) {
  const next = buildDefaultFollowUp();
  if (!record || typeof record !== "object") {
    return next;
  }

  const status = String(record.status || "");
  const priority = String(record.priority || "");
  if (FOLLOW_UP_STATUSES.some((option) => option.value === status)) {
    next.status = status;
  }
  if (FOLLOW_UP_PRIORITIES.some((option) => option.value === priority)) {
    next.priority = priority;
  }

  const lastContactedDate = String(record.lastContactedDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(lastContactedDate)) {
    next.lastContactedDate = lastContactedDate;
  }
  next.notes = String(record.notes || "").trim();
  return next;
}

function loadFollowUpStore() {
  try {
    const raw = window.localStorage.getItem(FOLLOW_UP_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const normalized = {};
    Object.entries(parsed).forEach(([studentId, value]) => {
      if (!studentId) {
        return;
      }
      normalized[studentId] = normalizeFollowUp(value);
    });
    return normalized;
  } catch (error) {
    void error;
    return {};
  }
}

function saveFollowUpStore(store) {
  try {
    window.localStorage.setItem(FOLLOW_UP_STORAGE_KEY, JSON.stringify(store));
  } catch (error) {
    void error;
  }
}

function buildFollowUpOptions(options, selectedValue) {
  return options.map((option) => {
    const selected = option.value === selectedValue ? " selected" : "";
    return `<option value="${option.value}"${selected}>${option.label}</option>`;
  }).join("");
}

function buildContactNotes(student) {
  const riskNotes = student.riskReasons.length ? student.riskReasons.join(" | ") : "No active risk flag.";
  return [
    `Current Phase: ${student.currentPhaseLabel}`,
    `Progress: ${formatPercent(student.overallProgressPercent, 0)}`,
    `Booking Status: ${toStatusLabel(student.latestBookingStatus)}`,
    `Risk Level: ${student.riskLevel.toUpperCase()}`,
    `Risk Notes: ${riskNotes}`
  ].join("\n");
}

function buildGoogleContactsUrl(student) {
  const params = new URLSearchParams();
  const fullName = String(student.name || "").trim();
  const { givenName, familyName } = splitName(fullName);
  const email = String(student.email || "").trim();
  const phone = resolvePrimaryPhone(student);
  const notes = buildContactNotes(student);

  if (fullName) {
    params.set("name", fullName);
  }
  if (givenName) {
    params.set("givenname", givenName);
  }
  if (familyName) {
    params.set("familyname", familyName);
  }
  if (email) {
    params.set("email", email);
  }
  if (phone) {
    params.set("phone", phone);
  }
  if (notes) {
    params.set("notes", notes);
  }

  const query = params.toString();
  const baseUrl = "https://contacts.google.com/u/0/new?hl=en";
  return query ? `${baseUrl}&${query}` : baseUrl;
}

function buildWhatsappUrl(student) {
  const phone = sanitizeWhatsappNumber(resolvePrimaryPhone(student));
  if (!phone) {
    return "";
  }
  const name = String(student.name || "Student").trim();
  const message = `Hello ${name}, this is from Shapla Chottor Lab regarding your learning progress.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function buildMailtoUrl(student) {
  const email = String(student.email || "").trim();
  if (!email) {
    return "";
  }
  const subject = `Learning Progress Follow-Up - ${student.name || "Student"}`;
  const body = [
    `Hello ${student.name || "Student"},`,
    "",
    "This is from Shapla Chottor Lab regarding your learning progress.",
    "",
    "Best regards,"
  ].join("\n");
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function openInNewTab(url) {
  if (!url) {
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

async function copyText(text) {
  const value = String(text || "").trim();
  if (!value) {
    return false;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  const fallbackInput = document.createElement("textarea");
  fallbackInput.value = value;
  fallbackInput.setAttribute("readonly", "readonly");
  fallbackInput.style.position = "fixed";
  fallbackInput.style.opacity = "0";
  document.body.appendChild(fallbackInput);
  fallbackInput.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(fallbackInput);
  return copied;
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

function buildActionBarMarkup(student) {
  const whatsappUrl = buildWhatsappUrl(student);
  const emailUrl = buildMailtoUrl(student);
  const googleContactsUrl = buildGoogleContactsUrl(student);
  const safeStudentName = escapeHtml(student.name || "Unknown Student");
  const safeCurrentPhaseLabel = escapeHtml(student.currentPhaseLabel || "-");
  const safeWhatsappUrl = escapeHtml(whatsappUrl);
  const safeGoogleContactsUrl = escapeHtml(googleContactsUrl);
  const safeEmailUrl = escapeHtml(emailUrl);
  const isContactActionAvailable = Boolean(
    String(student.name || "").trim() ||
    String(student.email || "").trim() ||
    resolvePrimaryPhone(student)
  );

  return `
    <div class="drawer-action-bar-meta">
      <p class="drawer-action-bar-name">${safeStudentName}</p>
      <span>${safeCurrentPhaseLabel}</span>
    </div>
    <div class="drawer-action-bar-buttons">
      <button type="button" class="drawer-action-btn compact" data-action="open-whatsapp" data-url="${safeWhatsappUrl}" ${whatsappUrl ? "" : "disabled"}>
        <i data-lucide="message-circle"></i>
        <span>WhatsApp</span>
      </button>
      <button type="button" class="drawer-action-btn compact" data-action="add-contact" data-url="${safeGoogleContactsUrl}" ${isContactActionAvailable ? "" : "disabled"}>
        <i data-lucide="user-plus"></i>
        <span>Add Contact</span>
      </button>
      <button type="button" class="drawer-action-btn compact" data-action="send-email" data-url="${safeEmailUrl}" ${emailUrl ? "" : "disabled"}>
        <i data-lucide="mail"></i>
        <span>Email</span>
      </button>
    </div>
  `;
}

function buildActionSectionMarkup(student, followUp) {
  const phone = resolvePrimaryPhone(student);
  const whatsappUrl = buildWhatsappUrl(student);
  const emailUrl = buildMailtoUrl(student);
  const googleContactsUrl = buildGoogleContactsUrl(student);
  const safePhone = escapeHtml(phone);
  const safeWhatsappUrl = escapeHtml(whatsappUrl);
  const safeEmailUrl = escapeHtml(emailUrl);
  const safeGoogleContactsUrl = escapeHtml(googleContactsUrl);
  const safeLastContactLabel = escapeHtml(followUp.lastContactedDate || "Not set");
  const safeLastContactDate = escapeHtml(followUp.lastContactedDate || "");
  const safeNotes = escapeHtml(followUp.notes || "");
  const isContactActionAvailable = Boolean(
    String(student.name || "").trim() ||
    String(student.email || "").trim() ||
    phone
  );

  return `
    <div class="drawer-actions-grid">
      <button type="button" class="drawer-action-btn" data-action="add-contact" data-url="${safeGoogleContactsUrl}" ${isContactActionAvailable ? "" : "disabled"}>
        <i data-lucide="user-plus"></i>
        <span>Add to Google Contacts</span>
      </button>
      <button type="button" class="drawer-action-btn" data-action="open-whatsapp" data-url="${safeWhatsappUrl}" ${whatsappUrl ? "" : "disabled"}>
        <i data-lucide="message-circle"></i>
        <span>Open WhatsApp Chat</span>
      </button>
      <button type="button" class="drawer-action-btn" data-action="copy-phone" data-phone="${safePhone}" ${phone ? "" : "disabled"}>
        <i data-lucide="copy"></i>
        <span>Copy Phone Number</span>
      </button>
      <button type="button" class="drawer-action-btn" data-action="send-email" data-url="${safeEmailUrl}" ${emailUrl ? "" : "disabled"}>
        <i data-lucide="mail"></i>
        <span>Send Email</span>
      </button>
      <button type="button" class="drawer-action-btn wide" data-action="create-followup-note">
        <i data-lucide="notebook-pen"></i>
        <span>Create Follow-Up Note</span>
      </button>
    </div>

    <div class="drawer-followup-panel">
      <div class="drawer-followup-heading">
        <h4>Follow-Up</h4>
        <span>Last contacted: ${safeLastContactLabel}</span>
      </div>

      <div class="drawer-followup-grid">
        <label>
          <span>Status</span>
          <select data-followup-field="status">
            ${buildFollowUpOptions(FOLLOW_UP_STATUSES, followUp.status)}
          </select>
        </label>

        <label>
          <span>Priority</span>
          <select data-followup-field="priority">
            ${buildFollowUpOptions(FOLLOW_UP_PRIORITIES, followUp.priority)}
          </select>
        </label>

        <label>
          <span>Last Contacted</span>
          <input type="date" data-followup-field="lastContactedDate" value="${safeLastContactDate}" />
        </label>

        <label class="drawer-followup-notes">
          <span>Notes</span>
          <textarea rows="4" data-followup-field="notes" placeholder="Add follow-up notes">${safeNotes}</textarea>
        </label>
      </div>
    </div>
  `;
}

export function createStudentDrawer(drawerElements) {
  const {
    drawer,
    closeButton,
    backdrop,
    actionBarRoot,
    actionsRoot,
    profileRoot,
    phaseRoot,
    bookingsRoot,
    timelineRoot,
    featuresRoot
  } = drawerElements;
  const followUpStore = loadFollowUpStore();
  let activeStudent = null;

  function setFollowUpForStudent(studentId, patch) {
    if (!studentId) {
      return buildDefaultFollowUp();
    }
    const current = normalizeFollowUp(followUpStore[studentId]);
    const next = normalizeFollowUp({ ...current, ...patch });
    followUpStore[studentId] = next;
    saveFollowUpStore(followUpStore);
    return next;
  }

  function getFollowUpForStudent(studentId) {
    if (!studentId) {
      return buildDefaultFollowUp();
    }
    if (!followUpStore[studentId]) {
      followUpStore[studentId] = buildDefaultFollowUp();
      saveFollowUpStore(followUpStore);
    }
    return normalizeFollowUp(followUpStore[studentId]);
  }

  function bindActionButtons() {
    if (!activeStudent) {
      return;
    }

    const allActionButtons = drawer.querySelectorAll("[data-action]");
    allActionButtons.forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.dataset.action;
        if (!action) {
          return;
        }

        if (action === "open-whatsapp" || action === "add-contact" || action === "send-email") {
          openInNewTab(button.dataset.url || "");
          return;
        }

        if (action === "copy-phone") {
          try {
            await copyText(button.dataset.phone || "");
            button.classList.add("copied");
            const labelNode = button.querySelector("span");
            if (labelNode) {
              labelNode.textContent = "Phone Copied";
            }
            window.setTimeout(() => {
              button.classList.remove("copied");
              const resetLabel = button.querySelector("span");
              if (resetLabel) {
                resetLabel.textContent = "Copy Phone Number";
              }
            }, 1400);
          } catch (error) {
            void error;
          }
          return;
        }

        if (action === "create-followup-note" && activeStudent?.userId) {
          const dateInput = actionsRoot.querySelector("[data-followup-field='lastContactedDate']");
          const notesInput = actionsRoot.querySelector("[data-followup-field='notes']");
          const nowDate = new Date().toISOString().slice(0, 10);
          const noteLine = `[${nowDate}] Follow-up note created for ${activeStudent.name || "student"}.`;
          const existing = String(notesInput?.value || "").trim();
          const nextNotes = existing ? `${existing}\n${noteLine}` : noteLine;
          const nextFollowUp = setFollowUpForStudent(activeStudent.userId, {
            notes: nextNotes,
            lastContactedDate: String(dateInput?.value || "").trim() || nowDate
          });

          if (dateInput) {
            dateInput.value = nextFollowUp.lastContactedDate;
          }
          if (notesInput) {
            notesInput.value = nextFollowUp.notes;
            notesInput.focus();
            notesInput.setSelectionRange(nextFollowUp.notes.length, nextFollowUp.notes.length);
          }
          const lastContactLabel = actionsRoot.querySelector(".drawer-followup-heading span");
          if (lastContactLabel) {
            lastContactLabel.textContent = `Last contacted: ${nextFollowUp.lastContactedDate || "Not set"}`;
          }
        }
      });
    });
  }

  function bindFollowUpInputs(student) {
    const controls = actionsRoot.querySelectorAll("[data-followup-field]");
    controls.forEach((control) => {
      const eventName = control.tagName === "TEXTAREA" ? "input" : "change";
      control.addEventListener(eventName, () => {
        const field = control.dataset.followupField;
        if (!field) {
          return;
        }
        const value = String(control.value || "").trim();
        const nextFollowUp = setFollowUpForStudent(student.userId, {
          [field]: value
        });
        const lastContactLabel = actionsRoot.querySelector(".drawer-followup-heading span");
        if (lastContactLabel) {
          lastContactLabel.textContent = `Last contacted: ${nextFollowUp.lastContactedDate || "Not set"}`;
        }
      });
    });
  }

  function close() {
    drawer.classList.remove("open");
    backdrop.classList.remove("open");
  }

  function open(student, nowMs = Date.now()) {
    activeStudent = student;
    const followUp = getFollowUpForStudent(student.userId);

    actionBarRoot.innerHTML = buildActionBarMarkup(student);
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
    actionsRoot.innerHTML = buildActionSectionMarkup(student, followUp);

    phaseRoot.innerHTML = renderPhaseProgressRows(student);
    bookingsRoot.innerHTML = renderBookingHistoryRows(student);
    timelineRoot.innerHTML = renderTimelineRows(student, nowMs);
    featuresRoot.innerHTML = renderFeatureRows(student);

    bindActionButtons();
    bindFollowUpInputs(student);
    refreshIcons();

    drawer.classList.add("open");
    backdrop.classList.add("open");
  }

  closeButton.addEventListener("click", close);
  backdrop.addEventListener("click", close);

  return { open, close };
}
