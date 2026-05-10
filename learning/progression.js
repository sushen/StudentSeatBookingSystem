export const FEATURE_GATES = [
  { featureId: "tradingBot", minProgress: 30, title: "Trading Bot" },
  { featureId: "investment", minProgress: 60, title: "Investment" },
  { featureId: "affiliate", minProgress: 100, title: "Affiliate" }
];

export function normalizeLessonIdArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const unique = new Set(
    value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
  );
  return Array.from(unique);
}

export function toProgressPercent(completedCount, totalCount) {
  if (!Number.isFinite(totalCount) || totalCount <= 0) {
    return 0;
  }
  if (!Number.isFinite(completedCount) || completedCount <= 0) {
    return 0;
  }
  const percent = Math.round((completedCount / totalCount) * 100);
  return Math.max(0, Math.min(100, percent));
}

export function computeFeatureUnlocks(progressPercent) {
  const bounded = Math.max(0, Math.min(100, Number(progressPercent) || 0));
  return FEATURE_GATES.map((gate) => ({
    ...gate,
    unlocked: bounded >= gate.minProgress
  }));
}

export function isLessonUnlocked(lessonIndex, completedLessonCount) {
  if (!Number.isFinite(lessonIndex) || lessonIndex < 0) {
    return false;
  }
  if (!Number.isFinite(completedLessonCount)) {
    return lessonIndex === 0;
  }
  return lessonIndex <= completedLessonCount;
}
