import {
  extractUserIdFromProgressPath,
  normalizeLessonProgressDoc,
  mergeWithCanonicalPhases,
  normalizeAffiliateStats,
  normalizeBookingDoc,
  normalizePhaseDoc,
  normalizeProgressDoc,
  normalizeReferralEvent,
  normalizeUserDoc
} from "../utils/normalizers.js";

export class RealtimeDataService {
  constructor(firebaseContext) {
    this.firebase = firebaseContext;
    this.unsubscribeFns = [];
    this.updateCallbacks = new Set();
    this.errorCallbacks = new Set();
    this.isStarted = false;
    this.emitQueued = false;
    this.progressCollectionGroupUnsubscribe = null;
    this.progressFallbackEnabled = false;
    this.progressUserUnsubscribeByUserId = new Map();

    this.cache = {
      users: new Map(),
      phases: new Map(),
      bookings: new Map(),
      progress: new Map(),
      lessonDocs: new Map(),
      referralEvents: new Map(),
      affiliateStats: new Map()
    };

    this.loaded = {
      users: false,
      phases: false,
      bookings: false,
      progress: false,
      lessonDocs: false,
      referralEvents: false,
      affiliateStats: false
    };
  }

  onUpdate(callback) {
    this.updateCallbacks.add(callback);
    return () => this.updateCallbacks.delete(callback);
  }

  onError(callback) {
    this.errorCallbacks.add(callback);
    return () => this.errorCallbacks.delete(callback);
  }

  start() {
    if (this.isStarted) {
      this.queueEmit();
      return;
    }
    this.isStarted = true;

    const { db, firestoreSdk } = this.firebase;
    const { collection, collectionGroup, onSnapshot } = firestoreSdk;

    this.subscribe(
      "users",
      onSnapshot(collection(db, "users"), (snapshot) => {
        this.applyDocChanges("users", this.cache.users, snapshot, (docSnap) => normalizeUserDoc(docSnap.id, docSnap.data()));
        this.reconcileProgressByUserListeners();
      }, (error) => this.publishError("users", error))
    );

    this.subscribe(
      "phases",
      onSnapshot(collection(db, "phases"), (snapshot) => {
        this.applyDocChanges("phases", this.cache.phases, snapshot, (docSnap) => normalizePhaseDoc(docSnap.id, docSnap.data()));
      }, (error) => this.publishError("phases", error))
    );

    this.subscribe(
      "bookings",
      onSnapshot(collection(db, "bookings"), (snapshot) => {
        this.applyDocChanges("bookings", this.cache.bookings, snapshot, (docSnap) => normalizeBookingDoc(docSnap.id, docSnap.data()));
      }, (error) => this.publishError("bookings", error))
    );

    this.loaded.progress = false;
    this.progressCollectionGroupUnsubscribe = onSnapshot(
      collectionGroup(db, "progress"),
      (snapshot) => {
        if (this.progressFallbackEnabled) {
          return;
        }
        this.applyDocChanges("progress", this.cache.progress, snapshot, (docSnap) => {
          const userId = extractUserIdFromProgressPath(docSnap.ref.path);
          return normalizeProgressDoc(docSnap.id, userId, docSnap.data());
        });
      },
      (error) => {
        this.publishError("progress", error);
        if (this.shouldEnableProgressFallback(error)) {
          this.enableProgressFallback();
        }
      }
    );
    this.unsubscribeFns.push(() => {
      if (this.progressCollectionGroupUnsubscribe) {
        this.progressCollectionGroupUnsubscribe();
        this.progressCollectionGroupUnsubscribe = null;
      }
    });

    this.subscribe(
      "lessonDocs",
      onSnapshot(collectionGroup(db, "lessons"), (snapshot) => {
        this.applyDocChanges("lessonDocs", this.cache.lessonDocs, snapshot, (docSnap) =>
          normalizeLessonProgressDoc(docSnap.id, docSnap.ref.path, docSnap.data())
        );
      }, (error) => this.publishError("lessonDocs", error))
    );

    this.subscribe(
      "referralEvents",
      onSnapshot(collection(db, "referralEvents"), (snapshot) => {
        this.applyDocChanges("referralEvents", this.cache.referralEvents, snapshot, (docSnap) =>
          normalizeReferralEvent(docSnap.id, docSnap.data())
        );
      }, (error) => this.publishError("referralEvents", error))
    );

    this.subscribe(
      "affiliateStats",
      onSnapshot(collection(db, "affiliateStats"), (snapshot) => {
        this.applyDocChanges("affiliateStats", this.cache.affiliateStats, snapshot, (docSnap) =>
          normalizeAffiliateStats(docSnap.id, docSnap.data())
        );
      }, (error) => this.publishError("affiliateStats", error))
    );
  }

  stop() {
    this.unsubscribeFns.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (error) {
        void error;
      }
    });
    this.unsubscribeFns = [];
    this.isStarted = false;

    this.cache.users.clear();
    this.cache.phases.clear();
    this.cache.bookings.clear();
    this.cache.progress.clear();
    this.cache.lessonDocs.clear();
    this.cache.referralEvents.clear();
    this.cache.affiliateStats.clear();

    this.loaded = {
      users: false,
      phases: false,
      bookings: false,
      progress: false,
      lessonDocs: false,
      referralEvents: false,
      affiliateStats: false
    };

    this.progressFallbackEnabled = false;
    this.progressUserUnsubscribeByUserId.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (error) {
        void error;
      }
    });
    this.progressUserUnsubscribeByUserId.clear();
    this.progressCollectionGroupUnsubscribe = null;

    this.queueEmit();
  }

  subscribe(sourceKey, unsubscribeFn) {
    this.unsubscribeFns.push(unsubscribeFn);
    this.loaded[sourceKey] = false;
  }

  applyDocChanges(sourceKey, cacheMap, snapshot, normalizer) {
    const changes = snapshot.docChanges();
    if (changes.length === 0 && snapshot.empty) {
      cacheMap.clear();
    }

    changes.forEach((change) => {
      const docSnap = change.doc;
      const cacheKey = docSnap.ref.path;
      if (change.type === "removed") {
        cacheMap.delete(cacheKey);
        return;
      }
      const normalized = normalizer(docSnap);
      cacheMap.set(cacheKey, normalized);
    });

    // Full replace fallback for stale caches on first delivery.
    if (cacheMap.size === 0 && !snapshot.empty) {
      snapshot.forEach((docSnap) => {
        const normalized = normalizer(docSnap);
        cacheMap.set(docSnap.ref.path, normalized);
      });
    }

    this.markLoaded(sourceKey);
    this.queueEmit();
  }

  markLoaded(sourceKey) {
    if (this.loaded[sourceKey] === undefined) {
      return;
    }
    this.loaded[sourceKey] = true;
  }

  queueEmit() {
    if (this.emitQueued) {
      return;
    }
    this.emitQueued = true;
    queueMicrotask(() => {
      this.emitQueued = false;
      const snapshot = this.getSnapshot();
      this.updateCallbacks.forEach((callback) => {
        callback(snapshot);
      });
    });
  }

  publishError(source, error) {
    this.errorCallbacks.forEach((callback) => callback({ source, error }));
  }

  shouldEnableProgressFallback(error) {
    const code = String(error?.code || "").toLowerCase();
    const message = String(error?.message || "").toLowerCase();
    return (
      code.includes("permission-denied") ||
      code.includes("failed-precondition") ||
      message.includes("missing or insufficient permissions") ||
      message.includes("query requires")
    );
  }

  enableProgressFallback() {
    if (this.progressFallbackEnabled) {
      return;
    }
    this.progressFallbackEnabled = true;

    if (this.progressCollectionGroupUnsubscribe) {
      try {
        this.progressCollectionGroupUnsubscribe();
      } catch (error) {
        void error;
      }
      this.progressCollectionGroupUnsubscribe = null;
    }

    this.cache.progress.clear();
    this.loaded.progress = false;
    this.reconcileProgressByUserListeners();
    this.queueEmit();
  }

  reconcileProgressByUserListeners() {
    if (!this.progressFallbackEnabled || !this.isStarted) {
      return;
    }

    const { db, firestoreSdk } = this.firebase;
    const { collection, onSnapshot } = firestoreSdk;

    const desiredUserIds = new Set(
      Array.from(this.cache.users.values())
        .map((user) => user.userId)
        .filter(Boolean)
    );

    Array.from(this.progressUserUnsubscribeByUserId.keys()).forEach((userId) => {
      if (desiredUserIds.has(userId)) {
        return;
      }
      const unsubscribe = this.progressUserUnsubscribeByUserId.get(userId);
      try {
        unsubscribe();
      } catch (error) {
        void error;
      }
      this.progressUserUnsubscribeByUserId.delete(userId);

      const progressPathPrefix = `users/${userId}/progress/`;
      Array.from(this.cache.progress.keys()).forEach((cacheKey) => {
        if (cacheKey.startsWith(progressPathPrefix)) {
          this.cache.progress.delete(cacheKey);
        }
      });
    });

    desiredUserIds.forEach((userId) => {
      if (this.progressUserUnsubscribeByUserId.has(userId)) {
        return;
      }
      const unsubscribe = onSnapshot(
        collection(db, "users", userId, "progress"),
        (snapshot) => {
          this.applyDocChanges("progress", this.cache.progress, snapshot, (docSnap) =>
            normalizeProgressDoc(docSnap.id, userId, docSnap.data())
          );
        },
        (error) => {
          this.publishError("progress", error);
        }
      );
      this.progressUserUnsubscribeByUserId.set(userId, unsubscribe);
    });

    if (desiredUserIds.size === 0) {
      this.loaded.progress = true;
      this.queueEmit();
    }
  }

  getSnapshot() {
    const phaseList = mergeWithCanonicalPhases(Array.from(this.cache.phases.values()));
    const phasesById = new Map(phaseList.map((phase) => [phase.phaseId, phase]));
    return {
      generatedAtMs: Date.now(),
      loaded: { ...this.loaded },
      users: Array.from(this.cache.users.values()),
      phases: phaseList,
      phasesById,
      bookings: Array.from(this.cache.bookings.values()),
      progressDocs: Array.from(this.cache.progress.values()),
      lessonDocs: Array.from(this.cache.lessonDocs.values()),
      referralEvents: Array.from(this.cache.referralEvents.values()),
      affiliateStats: Array.from(this.cache.affiliateStats.values())
    };
  }
}
