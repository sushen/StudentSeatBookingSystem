export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function formatInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  return Math.round(numeric).toLocaleString();
}

export function formatCompact(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(numeric);
}

export function formatPercent(value, digits = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0%";
  }
  return `${numeric.toFixed(digits)}%`;
}

export function formatCurrency(value, currency = "USD") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "$0";
  }
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(numeric);
}

export function formatDateTime(ms) {
  const numeric = Number(ms);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "-";
  }
  return new Date(numeric).toLocaleString();
}

export function formatDate(ms) {
  const numeric = Number(ms);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "-";
  }
  return new Date(numeric).toLocaleDateString();
}

export function formatRelativeDays(lastMs, nowMs = Date.now()) {
  const numeric = Number(lastMs);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "No activity";
  }
  const diffMs = Math.max(0, nowMs - numeric);
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function formatPhaseLabel(phaseId, phasesById) {
  const phase = phasesById.get(phaseId);
  if (!phase) {
    return phaseId || "Unknown";
  }
  return `P${phase.order}: ${phase.title}`;
}
