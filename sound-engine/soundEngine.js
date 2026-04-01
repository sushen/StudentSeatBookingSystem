const DEFAULT_ENGINE_CONFIG = {
  language: "en-US",
  rate: 1,
  pitch: 1,
  volume: 1,
  onlyWhenTabActive: true,
  adminOnly: true,
  dedupeTtlMs: 15 * 60 * 1000,
  maxTrackedEvents: 500,
  maxDeferredNotifications: 50,
  preferredVoiceName: "",
  debug: true
};

const engineState = {
  initialized: false,
  isAdmin: false,
  hasUserInteraction: false,
  config: { ...DEFAULT_ENGINE_CONFIG },
  announcedEventMap: new Map(),
  hasUnlockListeners: false,
  hasVisibilityListener: false,
  voicesInitialized: false,
  voices: [],
  selectedVoice: null,
  voicesReady: false,
  deferredNotifications: []
};

function isSpeechSupported() {
  return typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window;
}

function debugLog(message, details) {
  if (!engineState.config.debug || typeof console === "undefined") {
    return;
  }

  if (details === undefined) {
    console.debug(`[SoundEngine] ${message}`);
    return;
  }

  console.debug(`[SoundEngine] ${message}`, details);
}

function normalizeLanguageTag(language) {
  return String(language || "")
    .trim()
    .toLowerCase()
    .replace("_", "-");
}

function getLanguageRoot(language) {
  const normalized = normalizeLanguageTag(language);
  return normalized.split("-")[0] || normalized;
}

function selectBestVoice(voices) {
  if (!Array.isArray(voices) || voices.length === 0) {
    return null;
  }

  const requestedVoiceName = String(engineState.config.preferredVoiceName || "").trim().toLowerCase();
  const requestedLanguage = normalizeLanguageTag(engineState.config.language);
  const requestedLanguageRoot = getLanguageRoot(engineState.config.language);

  if (requestedVoiceName) {
    const byName = voices.find((voice) =>
      String(voice?.name || "").trim().toLowerCase() === requestedVoiceName
    );
    if (byName) {
      return byName;
    }
  }

  const exactLanguageVoice = voices.find((voice) =>
    normalizeLanguageTag(voice?.lang) === requestedLanguage
  );
  if (exactLanguageVoice) {
    return exactLanguageVoice;
  }

  const matchingRootVoice = voices.find((voice) =>
    getLanguageRoot(voice?.lang) === requestedLanguageRoot
  );
  if (matchingRootVoice) {
    return matchingRootVoice;
  }

  const defaultVoice = voices.find((voice) => Boolean(voice?.default));
  if (defaultVoice) {
    return defaultVoice;
  }

  return voices[0];
}

function refreshVoiceCache(trigger = "unknown") {
  if (!isSpeechSupported()) {
    engineState.voices = [];
    engineState.selectedVoice = null;
    engineState.voicesReady = false;
    return [];
  }

  try {
    const voices = window.speechSynthesis.getVoices() || [];
    engineState.voices = voices;
    engineState.selectedVoice = selectBestVoice(voices);
    engineState.voicesReady = voices.length > 0 && Boolean(engineState.selectedVoice);

    debugLog("Voice cache refreshed.", {
      trigger,
      voiceCount: voices.length,
      selectedVoice: engineState.selectedVoice?.name || null,
      selectedVoiceLang: engineState.selectedVoice?.lang || null
    });

    return voices;
  } catch (error) {
    engineState.voices = [];
    engineState.selectedVoice = null;
    engineState.voicesReady = false;
    debugLog("Voice cache refresh failed.", { trigger, error });
    return [];
  }
}

function flushDeferredNotifications(trigger = "unknown") {
  if (engineState.deferredNotifications.length === 0) {
    return;
  }

  if (isSpeechSupported() && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
    debugLog("Deferred notifications waiting for active speech queue.", {
      trigger,
      queueState: {
        speaking: window.speechSynthesis.speaking,
        pending: window.speechSynthesis.pending
      }
    });
    return;
  }

  debugLog("Flushing deferred notifications.", {
    trigger,
    count: engineState.deferredNotifications.length
  });

  const queuedItem = engineState.deferredNotifications.shift();
  if (!queuedItem) {
    return;
  }

  if (queuedItem?.eventId && hasAnnouncement(queuedItem.eventId)) {
    flushDeferredNotifications("skip-duplicate-event");
    return;
  }

  const result = speakNotificationInternal(
    queuedItem?.text,
    { eventId: queuedItem?.eventId, source: "deferred-queue" },
    { allowDeferred: false }
  );

  if (result.ok) {
    if (queuedItem?.eventId) {
      rememberAnnouncement(queuedItem.eventId);
    }
    return;
  }

  if (shouldDeferForReason(result.reason)) {
    enqueueDeferredNotification({
      text: queuedItem?.text,
      eventId: queuedItem?.eventId,
      reason: result.reason
    });
  }

  if (engineState.deferredNotifications.length > 0) {
    window.setTimeout(() => {
      flushDeferredNotifications("continue-after-drop");
    }, 0);
  }
}

function bindVisibilityListener() {
  if (engineState.hasVisibilityListener || typeof document === "undefined") {
    return;
  }

  engineState.hasVisibilityListener = true;
  document.addEventListener("visibilitychange", () => {
    const visibilityState = document.visibilityState;
    debugLog("Visibility changed.", { visibilityState });

    if (visibilityState !== "visible") {
      return;
    }

    if (isSpeechSupported()) {
      try {
        window.speechSynthesis.resume();
      } catch (error) {
        debugLog("Failed to resume synthesis after visibility change.", { error });
      }
    }

    flushDeferredNotifications("visibilitychange");
  });
}

function initializeVoices() {
  if (!isSpeechSupported()) {
    return;
  }

  if (engineState.voicesInitialized) {
    refreshVoiceCache("already-initialized");
    return;
  }

  engineState.voicesInitialized = true;

  try {
    window.speechSynthesis.getVoices();
  } catch (error) {
    debugLog("Initial getVoices call failed.", { error });
  }

  window.speechSynthesis.onvoiceschanged = () => {
    refreshVoiceCache("onvoiceschanged");
    flushDeferredNotifications("onvoiceschanged");
  };

  refreshVoiceCache("initialize");

  if (!engineState.voicesReady) {
    window.setTimeout(() => {
      refreshVoiceCache("retry-250ms");
      flushDeferredNotifications("retry-250ms");
    }, 250);

    window.setTimeout(() => {
      refreshVoiceCache("retry-1000ms");
      flushDeferredNotifications("retry-1000ms");
    }, 1000);
  }
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

function markUserInteractionUnlocked(event) {
  engineState.hasUserInteraction = true;

  debugLog("User interaction registered for speech unlock.", {
    eventType: event?.type || "manual"
  });

  if (!isSpeechSupported()) {
    removeUnlockListeners();
    return;
  }

  try {
    window.speechSynthesis.resume();
    window.speechSynthesis.getVoices();
    refreshVoiceCache("user-interaction");
    flushDeferredNotifications("user-interaction");
  } catch (error) {
    debugLog("Speech unlock attempt failed.", { error });
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
  refreshVoiceCache("before-speak");

  const selectedVoice = engineState.selectedVoice;
  if (!selectedVoice) {
    return { ok: false, reason: "voices-unavailable" };
  }

  const synthesis = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = selectedVoice.lang || engineState.config.language;
  utterance.voice = selectedVoice;
  utterance.rate = engineState.config.rate;
  utterance.pitch = engineState.config.pitch;
  utterance.volume = engineState.config.volume;

  utterance.onstart = () => {
    debugLog("Speech started.", {
      text,
      voice: selectedVoice.name,
      lang: utterance.lang
    });
  };

  utterance.onend = () => {
    debugLog("Speech ended.", { text });
    flushDeferredNotifications("utterance-end");
  };

  utterance.onerror = (event) => {
    debugLog("Speech error event.", {
      text,
      error: event?.error || "unknown"
    });
  };

  debugLog("Speaking text.", {
    text,
    voice: selectedVoice.name,
    lang: utterance.lang,
    queueState: {
      speaking: synthesis.speaking,
      pending: synthesis.pending,
      paused: synthesis.paused
    }
  });

  synthesis.resume();
  synthesis.cancel();
  synthesis.resume();
  synthesis.speak(utterance);

  return { ok: true };
}

function shouldDeferForReason(reason) {
  return reason === "interaction-required" ||
    reason === "tab-not-active" ||
    reason === "voices-unavailable";
}

function enqueueDeferredNotification({ text, eventId = null, reason = "unknown" }) {
  const trimmedText = String(text || "").trim();
  if (!trimmedText) {
    return false;
  }

  if (eventId) {
    const alreadyQueued = engineState.deferredNotifications.some((item) => item.eventId === eventId);
    if (alreadyQueued) {
      return true;
    }
  }

  engineState.deferredNotifications.push({
    text: trimmedText,
    eventId,
    reason,
    queuedAt: Date.now()
  });

  const maxDeferred = Math.max(1, Number(engineState.config.maxDeferredNotifications) || 1);
  while (engineState.deferredNotifications.length > maxDeferred) {
    engineState.deferredNotifications.shift();
  }

  debugLog("Notification deferred.", {
    reason,
    eventId,
    queueSize: engineState.deferredNotifications.length,
    text: trimmedText
  });

  return true;
}

function speakNotificationInternal(text, metadata = {}, options = {}) {
  const allowDeferred = options.allowDeferred !== false;

  debugLog("speakNotification called.", {
    text,
    eventId: metadata?.eventId || null,
    source: metadata?.source || "direct-call"
  });

  initializeVoices();

  const allowed = canSpeakNow(text);
  if (!allowed.ok) {
    debugLog("Speech blocked.", {
      reason: allowed.reason,
      hasUserInteraction: engineState.hasUserInteraction,
      isAdmin: engineState.isAdmin,
      visibilityState: typeof document !== "undefined" ? document.visibilityState : "n/a"
    });

    if (allowDeferred && shouldDeferForReason(allowed.reason)) {
      enqueueDeferredNotification({
        text,
        eventId: metadata?.eventId || null,
        reason: allowed.reason
      });
      return { ...allowed, queued: true };
    }

    return allowed;
  }

  try {
    const result = speakWithSpeechSynthesis(allowed.text);
    if (!result.ok) {
      debugLog("Speech blocked.", { reason: result.reason, text: allowed.text });
      if (allowDeferred && shouldDeferForReason(result.reason)) {
        enqueueDeferredNotification({
          text: allowed.text,
          eventId: metadata?.eventId || null,
          reason: result.reason
        });
        return { ...result, queued: true };
      }
      return result;
    }
    return { ok: true };
  } catch (error) {
    debugLog("Speech failed during synthesis.", { error });
    return { ok: false, reason: "speak-failed", error };
  }
}

export function initializeSoundEngine(overrides = {}) {
  engineState.config = {
    ...DEFAULT_ENGINE_CONFIG,
    ...overrides
  };
  engineState.initialized = true;
  debugLog("Initializing sound engine.", { config: engineState.config });
  initializeVoices();
  bindUnlockListeners();
  bindVisibilityListener();
  return getSoundEngineStatus();
}

export function getSoundEngineStatus() {
  return {
    initialized: engineState.initialized,
    supported: isSpeechSupported(),
    adminMode: engineState.isAdmin,
    userInteractionReady: engineState.hasUserInteraction,
    voiceReady: engineState.voicesReady,
    selectedVoice: engineState.selectedVoice?.name || null,
    deferredQueueSize: engineState.deferredNotifications.length
  };
}

export function setSoundEngineAdminMode(isAdmin) {
  engineState.isAdmin = Boolean(isAdmin);
  debugLog("Admin mode updated.", { isAdmin: engineState.isAdmin });
  if (engineState.isAdmin) {
    flushDeferredNotifications("admin-mode-enabled");
  }
}

export function registerSoundEngineUserInteraction() {
  markUserInteractionUnlocked();
  removeUnlockListeners();
}

export function clearSoundAnnouncementHistory() {
  engineState.announcedEventMap.clear();
  engineState.deferredNotifications = [];
  debugLog("Cleared announcement history and deferred queue.");
}

export function speakNotification(text) {
  return speakNotificationInternal(text);
}

export function speakNotificationOnce(eventId, text) {
  if (!eventId) {
    return speakNotification(text);
  }

  if (hasAnnouncement(eventId)) {
    return { ok: false, reason: "duplicate-event" };
  }

  const result = speakNotificationInternal(
    text,
    { eventId, source: "once-call" }
  );
  if (result.ok) {
    rememberAnnouncement(eventId);
  }
  return result;
}
