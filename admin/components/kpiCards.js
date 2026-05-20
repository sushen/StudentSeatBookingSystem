import { formatCompact, formatCurrency, formatInteger, formatPercent } from "../utils/formatters.js";

const animationHandles = new Map();

function formatMetricValue(value, type) {
  if (type === "percent") {
    return formatPercent(value, 1);
  }
  if (type === "currency") {
    return formatCurrency(value);
  }
  if (type === "compact") {
    return formatCompact(value);
  }
  return formatInteger(value);
}

function animateValue(element, fromValue, toValue, type, durationMs = 450) {
  if (!element) {
    return;
  }

  const existing = animationHandles.get(element);
  if (existing) {
    cancelAnimationFrame(existing);
  }

  if (!Number.isFinite(fromValue) || !Number.isFinite(toValue)) {
    element.textContent = formatMetricValue(toValue, type);
    return;
  }

  const startedAt = performance.now();
  const step = (now) => {
    const elapsed = now - startedAt;
    const progress = Math.min(1, elapsed / durationMs);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = fromValue + ((toValue - fromValue) * eased);
    element.textContent = formatMetricValue(current, type);
    if (progress < 1) {
      const frame = requestAnimationFrame(step);
      animationHandles.set(element, frame);
    } else {
      animationHandles.delete(element);
    }
  };

  const frame = requestAnimationFrame(step);
  animationHandles.set(element, frame);
}

export function renderKpiCards(container, cards, previousValues = new Map()) {
  if (!container) {
    return new Map();
  }

  const nextValues = new Map();
  const cardMarkup = cards.map((card) => `
    <article class="kpi-card" data-kpi-key="${card.key}">
      <div class="kpi-card-head">
        <h3>${card.label}</h3>
      </div>
      <p class="kpi-value" data-kpi-value="${card.key}">0</p>
      <p class="kpi-caption">${card.caption || ""}</p>
    </article>
  `).join("");
  container.innerHTML = cardMarkup;

  cards.forEach((card) => {
    const element = container.querySelector(`[data-kpi-value="${card.key}"]`);
    const previous = Number(previousValues.get(card.key) ?? 0);
    const next = Number(card.value ?? 0);
    animateValue(element, previous, next, card.type || "number");
    nextValues.set(card.key, next);
  });

  return nextValues;
}
