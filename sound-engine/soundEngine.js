const DEFAULT_ENGINE_CONFIG = {
  language: "en-US",
  rate: 1,
  pitch: 1,
  volume: 1,
  onlyWhenTabActive: true,
  adminOnly: true,
  dedupeTtlMs: 15 * 60 * 1000,
  maxTrackedEvents: 500
};

const engineState = {
  initialized: false,
  isAdmin: false,
  hasUserInteraction: false,
  config: { ...DEFAULT_ENGINE_CONFIG },
  announcedEventMap: new Map(),
  hasUnlockListeners: false
};

function isSpeechSupported() {
  return typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window;
}

function pruneOldAnnouncements() {
  const now = Date.now();
  const ttlMs = Math.max(0, Number(engineState.config.dedupeTtlMs) || 0);

  if (ttlMs > 0) {
    engineState.announcedEventMap.forEach((timestamp, eventId) => {
      if (now - timestamp > ttlMs) {
        engineState.announcedEventMap.delete(eventId);
      }
    });
  }

  const maxItems = Math.max(1, Number(engineState.config.maxTrackedEvents) || 1);
  if (engineState.announcedEventMap.size <= maxItems) {
    return;
  }

  const sortedEntries = Array.from(engineState.announcedEventMap.entries())
    .sort((left, right) => left[1] - right[1]);
  const extraCount = engineState.announcedEventMap.size - maxItems;
  for (let index = 0; index < extraCount; index += 1) {
    engineState.announcedEventMap.delete(sortedEntries[index][0]);
  }
}

function markUserInteractionUnlocked() {
  engineState.hasUserInteraction = true;
  if (!isSpeechSupported()) {
    removeUnlockListeners();
    return;
  }

  try {
    window.speechSynthesis.resume();
    window.speechSynthesis.getVoices();
  } catch (error) {
    // Ignore unlock errors and keep graceful behavior.
  } finally {
    removeUnlockListeners();
  }
}

function removeUnlockListeners() {
  if (!engineState.hasUnlockListeners) {
    return;
  }
  engineState.hasUnlockListeners = false;
  const options = { capture: true };
  document.removeEventListener("click", markUserInteractionUnlocked, options);
  document.removeEventListener("pointerdown", markUserInteractionUnlocked, options);
  document.removeEventListener("touchstart", markUserInteractionUnlocked, options);
  document.removeEventListener("keydown", markUserInteractionUnlocked, options);
}

function bindUnlockListeners() {
  if (engineState.hasUnlockListeners || typeof document === "undefined") {
    return;
  }

  engineState.hasUnlockListeners = true;
  const options = { capture: true, passive: true, once: true };
  document.addEventListener("click", markUserInteractionUnlocked, options);
  document.addEventListener("pointerdown", markUserInteractionUnlocked, options);
  document.addEventListener("touchstart", markUserInteractionUnlocked, options);
  document.addEventListener("keydown", markUserInteractionUnlocked, options);
}

function canSpeakNow(text) {
  const trimmedText = String(text || "").trim();
  if (!trimmedText) {
    return { ok: false, reason: "empty-text" };
  }

  if (!isSpeechSupported()) {
    return { ok: false, reason: "speech-not-supported" };
  }

  if (engineState.config.adminOnly && !engineState.isAdmin) {
    return { ok: false, reason: "admin-only" };
  }

  if (!engineState.hasUserInteraction) {
    return { ok: false, reason: "interaction-required" };
  }

  if (engineState.config.onlyWhenTabActive && typeof document !== "undefined" && document.visibilityState !== "visible") {
    return { ok: false, reason: "tab-not-active" };
  }

  return { ok: true, text: trimmedText };
}

function rememberAnnouncement(eventId) {
  if (!eventId) {
    return;
  }
  pruneOldAnnouncements();
  engineState.announcedEventMap.set(eventId, Date.now());
}

function hasAnnouncement(eventId) {
  if (!eventId) {
    return false;
  }
  pruneOldAnnouncements();
  return engineState.announcedEventMap.has(eventId);
}

function speakWithSpeechSynthesis(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = engineState.config.language;
  utterance.rate = engineState.config.rate;
  utterance.pitch = engineState.config.pitch;
  utterance.volume = engineState.config.volume;
  window.speechSynthesis.speak(utterance);
}

export function initializeSoundEngine(overrides = {}) {
  engineState.config = {
    ...engineState.config,
    ...overrides
  };
  engineState.initialized = true;
  bindUnlockListeners();
  return getSoundEngineStatus();
}

export function getSoundEngineStatus() {
  return {
    initialized: engineState.initialized,
    supported: isSpeechSupported(),
    adminMode: engineState.isAdmin,
    userInteractionReady: engineState.hasUserInteraction
  };
}

export function setSoundEngineAdminMode(isAdmin) {
  engineState.isAdmin = Boolean(isAdmin);
}

export function registerSoundEngineUserInteraction() {
  markUserInteractionUnlocked();
  removeUnlockListeners();
}

export function clearSoundAnnouncementHistory() {
  engineState.announcedEventMap.clear();
}

export function speakNotification(text) {
  const allowed = canSpeakNow(text);
  if (!allowed.ok) {
    return allowed;
  }

  try {
    speakWithSpeechSynthesis(allowed.text);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: "speak-failed", error };
  }
}

export function speakNotificationOnce(eventId, text) {
  if (!eventId) {
    return speakNotification(text);
  }

  if (hasAnnouncement(eventId)) {
    return { ok: false, reason: "duplicate-event" };
  }

  const result = speakNotification(text);
  if (result.ok) {
    rememberAnnouncement(eventId);
  }
  return result;
}
