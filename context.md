# Project Overview

- `Shapla Chottor Lab` / `TradingAI` is a single-module Android app for AI-assisted coding education, mentor-reviewed classroom access, and progress-gated advanced tools.
- Target users are students and self-learners who want a structured AI/coding journey, plus one hardcoded lead teacher/admin who reviews requests and unlocks classrooms.
- The intended funnel is a free foundation phase followed by paid mentored cohorts, but the current codebase actually routes classroom access through the same booking/unlock flow unless `users/{userId}.unlockedPhases` is already populated.
- The core product goal is to move learners through a fixed 6-phase journey, convert them into premium cohorts, and use referrals plus feature unlocks as growth loops.

# Architecture

- Android stack: Kotlin 2.1.0, Android Views/XML, ViewBinding, Material 3, Navigation Component with Safe Args, LiveData, Coroutines, RecyclerView, and Glide.
- Build/runtime: single `app/` module, `applicationId com.shaplachottor.lab`, `minSdk 24`, `compileSdk/targetSdk 35`, Java 17, `versionCode 11`, `versionName 1.1.1`, release minification enabled, and login-screen branch/version labels generated from Git metadata.
- App startup: `TradingAIApplication` initializes Firebase, configures Firestore persistent cache, initializes `AppGraph`, and defers Meta SDK setup to a background thread; `SplashActivity` logs a debug Meta test event and routes to `LoginActivity` or `MainActivity`.
- App architecture is MVVM plus Repository pattern with a lightweight service locator (`AppGraph`) instead of Hilt/Dagger.
- Persistence is abstracted behind `AppStore`; `FirestoreAppStore` is the only implementation and provides phase reads/writes, user reads/streams, booking reads/writes, lesson-progress persistence, referral stats/history, and client-side account-deletion cleanup.
- `PhaseRepository` is the main business-logic layer. It handles phase catalog seeding/fallback, phase progression snapshots, sequential lesson validation/repair, equal-weight overall progress, booking creation, expiry/cancellation/review/approval/rejection, and access checks.
- `UserRepository` handles current-user reads, user creation/merge, referral code assignment, referral attribution, and account deletion.
- Main UI shell: `MainActivity` hosts bottom navigation for Home, Phases, My Learning, Advanced, and Profile. Secondary destinations are Classroom, Lesson Detail, Affiliate, Admin Panel, Education, Install, and Invest.
- Content architecture: phase metadata can come from Firestore or local `PhaseCatalog`, but lesson content is fully local Kotlin data in `Phase1LessonProvider` through `Phase6LessonProvider`.
- Connectivity handling: `NetworkMonitor` exposes online/offline state; `PhaseViewModel` and `ClassroomViewModel` refresh on reconnect.
- Non-runtime folders: `docs/` and `Ai_to_Ai_Development/` are reference/planning material, not app runtime code.

# Key Features

- Authentication: Google sign-in is the only implemented login path; email/password registration and password reset are implemented, but not email/password sign-in.
- Referral capture at signup: both Google sign-in and email registration accept an optional referral code.
- 6-phase learning catalog: Phase 1 is still modeled as `free`; Phases 2-6 are premium mentored cohorts with pricing, seat counts, and optional start dates.
- Current access control: every classroom effectively depends on `unlockedPhases` or an approved booking, so Phase 1 is not automatically open to new users even though product copy still describes it as the free entry phase.
- Static structured curriculum: lessons are built from concept, example, exercise, and reflection blocks. Phase 1 has 4 lessons; Phases 2-6 have 3 lessons each.
- Sequential lesson gating: learners must complete lessons in order, and later phases require contiguous completion of earlier phases.
- Self-healing progress model: raw lesson-completion documents are canonicalized into a contiguous prefix, and invalid/out-of-order completion states are repaired.
- Equal-weight journey progress: each phase contributes the same share of overall completion, regardless of lesson count.
- Feature gating: `tradingBot` unlocks at `>=30%`, `investment` at `>=60%`, and `affiliate` at `100%`.
- Seat request flow: requesting a phase creates `bookings/{userId}_{phaseId}`, reserves a seat immediately, and starts a 15-minute pending window with countdown UI on phase cards.
- Manual teacher review flow: admins can move requests to `reviewing`, approve access, reject requests, or revoke previously approved access. Premium approvals prompt for manual payment confirmation.
- Live progress surfaces: Home and My Learning observe the user profile stream and render active/current progress when a phase is unlocked.
- Affiliate views: Profile always shows the referral code plus top-line invite/conversion stats; the gated Affiliate screen adds copy/share actions and referral history.
- Local notifications: admin devices get notifications for new pending requests; learners get notifications when bookings move to `reviewing`, `approved`, or `rejected`.
- Account management: Profile supports logout, privacy-policy viewing, referral sharing, and permanent account deletion.

# User Flow

- Install and launch: `TradingAIApplication` initializes Firebase, Firestore cache, `AppGraph`, and Meta; `SplashActivity` waits briefly, logs a debug Meta test event in debug builds, and routes by Firebase auth state.
- Authenticate: the user signs in with Google or opens `RegisterActivity` for email/password registration; `ForgotPasswordActivity` handles reset emails.
- Create or merge profile: `UserRepository` saves the user doc, generates a 6-character referral code from the Firebase UID, and records a referral event if the account was referred.
- Initial app state: new user documents are created with empty `unlockedPhases`, so the app does not currently auto-bootstrap direct access to Phase 1.
- Explore the app: after login, the user lands in the bottom-nav shell and can browse Home, Phases, My Learning, Advanced, and Profile.
- Request classroom access: in the current code path, the learner opens `PhasesFragment`, chooses a requestable phase, and submits a WhatsApp number; this includes Phase 1 unless it was already unlocked elsewhere.
- Teacher review: the admin gets a local notification, opens the Admin Panel, marks the request as reviewing, and then approves or rejects it. Premium approvals include a payment-confirmation prompt.
- Enter the classroom: once approved, the learner opens the classroom, completes lessons sequentially, and sees phase and journey progress recomputed in real time.
- Continue progression: completing a phase does not auto-unlock the next one; it only makes the next phase requestable. Completing Phase 1 also marks a referral conversion if the user was referred.
- Unlock advanced surfaces: overall progress unlocks Install Bot, Invest/Community, and Affiliate screens.
- Retention and exit: Home/My Learning help the learner resume; Profile lets the user share a referral code, view top-line affiliate stats, open the privacy policy, log out, or delete the account.

# Data & State

- Active Firestore collections are `users`, `phases`, `bookings`, `referralEvents`, and `affiliateStats`.
- `users/{userId}` maps to `User`: `id`, `email`, `name`, `photoUrl`, `progress`, `phaseProgress`, `unlockedPhases`, `completedPhases`, `unlockedFeatures`, `referralCode`, and `referredBy`.
- New users are saved with empty `phaseProgress`, empty `unlockedPhases`, and empty `completedPhases`; there is no current write path that auto-adds `phase1` to `unlockedPhases`.
- Lesson completion lives at `users/{userId}/progress/{phaseId}/lessons/{lessonId}` with an `isCompleted` boolean.
- Lesson completion docs are not treated as ground truth. `PhaseRepository` resolves them into a contiguous completed prefix, blocks invalid future-lesson completion, and writes repaired values back when needed.
- Denormalized user fields like `phaseProgress`, `completedPhases`, `progress`, and `unlockedFeatures` are recomputed from canonical lesson state.
- Overall progress is phase-weighted, not lesson-total weighted. Completing a full phase contributes about `16%` of the total journey.
- `phases/{phaseId}` stores catalog metadata such as title, description, level, type, price, currency, start date, visibility, order, and seat counts. If Firestore is empty, the app falls back to local `PhaseCatalog`, and the first booking can bootstrap a missing phase doc.
- `bookings/{userId}_{phaseId}` stores `completedPhaseId`, `whatsappNumber`, `createdAt`, `expiresAt`, `reviewedAt`, `approvedAt`, `lastUpdatedAt`, `reviewedByEmail`, and `status`.
- Booking statuses in active use are `pending`, `reviewing`, `approved`, `rejected`, `cancelled`, and `expired`. Legacy `booked` is normalized to `approved` on read.
- `referralEvents/{referrerId}_{referredUserId}` store joined vs converted state plus timestamp.
- `affiliateStats/{userId}` stores `totalInvites` and `conversions`.
- `ClassroomFragment` and `LessonDetailFragment` share a classroom-scoped `ClassroomViewModel` using the classroom navigation back stack entry.
- Data flow is mostly client-driven: fragments -> viewmodels -> repositories/app store -> Firestore transactions or snapshot listeners -> LiveData/Flow updates back to the UI.
- Account deletion is implemented client-side: the app deletes the user doc, affiliate stats, bookings, referral events where the user is either referrer or referred user, lesson-progress subcollections, and then deletes the Firebase Auth account.

# Integrations

- Firebase Auth: Google sign-in, email/password account creation, session state, password reset, and auth-account deletion.
- Google Sign-In (`play-services-auth`): obtains the ID token used for Firebase login.
- Cloud Firestore: stores user profiles, phase metadata, bookings, lesson progress, referral events, affiliate stats, and notification-driven booking snapshots.
- Firestore offline persistence: enabled in `TradingAIApplication` with a 100 MB persistent cache.
- Firestore Security Rules: enforce owner-only user access, booking status transitions, seat counter constraints, and hardcoded email-based admin access.
- Meta Android SDK: initialized in `TradingAIApplication`; debug builds log `fb_mobile_test_event`, and advertiser ID collection is enabled through manifest metadata and runtime SDK config.
- Local Android notifications: `AdminNotificationManager` and `LearnerNotificationManager` listen to Firestore changes and emit device-local notifications.
- Material 3: used for theming, cards, dialogs, tabs, progress indicators, and navigation presentation.
- Glide: used for avatar loading.
- Google Services plugin: applied conditionally in `app/build.gradle`; this checkout includes a tracked `app/google-services.json`.
- Declared but not meaningfully wired into product behavior: Firebase Functions, Firebase Storage, Firebase Analytics, and Firebase Messaging.

# Current Implementation Status

- Complete: app initialization, auth routing, bottom-navigation shell, user-profile persistence, phase catalog fallback/seeding, local curriculum loading, classroom lesson flow, sequential progress repair, equal-weight progress calculation, referral capture, and client-side account deletion are implemented in code.
- Complete: booking lifecycle states (`pending`, `reviewing`, `approved`, `rejected`, `cancelled`, `expired`), seat reservation/release logic, admin review actions, and local status notifications are implemented.
- Complete: Firestore rules and client transactions support the intended client-side contract for users, phases, bookings, progress, referrals, and affiliate stats.
- Complete: Profile supports logout, privacy-policy access, referral sharing, top-line affiliate stats, and account deletion.
- Partial: the product still positions Phase 1 as the free starting point, but current user creation and access logic do not auto-unlock it. Brand-new users may have no active phase until Phase 1 is manually unlocked or approved through the booking flow.
- Partial: email/password registration and password reset exist, but `LoginActivity` still has no email/password sign-in UI or implementation.
- Partial: advanced gating is real, but `InstallFragment` is only a static setup guide, `InvestFragment` is an empty RecyclerView placeholder, and `AffiliateFragment` is informational only.
- Partial: Profile contains visible `Personal Information` and `Notifications` rows, but no click handlers or destination flows for them.
- Partial: `EducationFragment` exists and can filter free vs premium phases, but it is not reachable from the main UI and should not be treated as a supported product path.
- Partial: unit tests exist for progress and repository logic, but build verification is blocked by the broken Windows wrapper, and some tests still encode older access-flow assumptions.
- Missing: server-side booking lifecycle automation, scheduled expiration cleanup, push notifications via FCM, payment gateway/webhook integration, and role/custom-claims based admin management.
- Missing: remote lesson/content management, a real trading-bot download/install flow, a real invest/community product, and any backend implementation for the web3 template docs.

# Known Issues / Gaps

- Admin authorization is hardcoded to `sushen.biswas.aga@gmail.com` across app code, setup docs, and Firestore rules instead of using roles or custom claims.
- The strongest product/logic mismatch is Phase 1 onboarding: new users are created with empty `unlockedPhases`, the free phase card still says `Open classroom access`, and README/docs still describe Phase 1 as the direct entry point.
- Home and My Learning can show no active phase for a brand-new account because active-phase resolution depends on `unlockedPhases`.
- The booking dialog collects only a WhatsApp number, even though privacy text still references both phone-number and WhatsApp collection.
- Booking expiration is still client/lazy driven. Pending requests are expired when learners or admins reload them, but there is no trusted backend scheduler to free seats globally if nobody reopens the app.
- Cohort `startDate` is informational only. The UI can mention an upcoming start date, but booking and classroom access are not blocked by time.
- Local fallback phase data is not stable for Phase 2: `PhaseCatalog` computes `startDate` as `now + 7 days`, so if Firestore is empty or unseeded the displayed date drifts between app runs.
- Referral codes are just the last 6 characters of the Firebase UID uppercased. Uniqueness is assumed, not enforced.
- Affiliate gating is inconsistent: the full Affiliate screen requires `100%` progress, but Profile already exposes the referral code and headline affiliate stats.
- `ReferralEvent` has a `referredUserName` field for UI display, but current write paths do not populate it, so the history list falls back to generic labels like `Researcher ####`.
- `EducationFragment` is effectively dead code in the current product flow, and even if re-enabled its filtered phase list would need careful prerequisite validation review.
- `InstallFragment` exposes a visible `Download from GitHub` button with no click handler, `InvestFragment` defines a RecyclerView with no adapter or data source, and Profile exposes inert `Personal Information` and `Notifications` rows. The Profile footer also hardcodes `v1.4` while build config is `1.1.1`.
- Documentation is out of sync in several places: README and docs still present Phase 1 as automatically open, `docs/firestore_database_structure.md` still mentions fields like `role` and `createdAt`, setup docs still say `default_web_client_id` lives in `strings.xml`, and privacy text disagrees internally about Meta tracking and contact fields.
- Several Firebase dependencies are included but not wired into product behavior, which adds maintenance noise and can mislead future contributors.
- Learner-side cancellation is missing from the UI. The repository and rules understand `cancelled`, but only admin-side flows currently drive cancellation/revocation.
- Lesson content is hardcoded in Kotlin providers, so curriculum changes require shipping a new app version.
- Build reproducibility is poor in the current checkout: `gradlew`/`gradlew.bat` are tracked, `gradle/wrapper/*` currently exists in the workspace but remains untracked, and `gradlew.bat` sets an empty `CLASSPATH`, causing Windows wrapper builds to fail with `Error: -classpath requires class path specification`.
- Unit tests are behind production behavior: `PhaseRepositoryTest` and `PhaseProgressionResolverTest` still assume older onboarding/progression behavior, while wrapper failure currently blocks normal test execution.
- Meta App ID and client token are stored directly in `strings.xml`, and `app/google-services.json` is tracked in the repo. That is convenient for setup but weak for configuration hygiene.

# Growth & Monetization Opportunities

- The premium cohort model is already monetizable: Phases 2-6 have tiered pricing and built-in seat scarcity, which can support launch windows, waitlists, and urgency-based sales.
- Resolving the Phase 1 access ambiguity is itself a growth lever: either restore a true free funnel for acquisition, or explicitly position reviewed onboarding as an application/qualification step and monetize the higher-touch experience.
- Referral capture is already implemented at signup, so the next leverage point is adding real incentives such as discounts, commissions, bonus lessons, or mentorship perks.
- Manual WhatsApp follow-up can become a stronger conversion workflow if paired with reminders, review SLAs, and simple admin-side funnel reporting.
- Progress-based feature gates create natural upsell moments for bot setup support, private research groups, downloadable templates, or cohort add-ons.
- Profile exposes referral identity before the full affiliate gate, which could support an earlier ambassador program without waiting for 100% course completion.
- Hardcoded lesson content can later become premium downloadable assets, cohort handouts, or a managed CMS/content-ops layer.
- Meta attribution plus referral loops provide the foundation for paid-acquisition optimization, but the app still needs real analytics events around signup, booking, review, approval, lesson completion, and referral conversion.

# Next Best Actions (IMPORTANT)

- Decide and implement the intended Phase 1 onboarding model end-to-end: either auto-unlock Phase 1 for every new user, or intentionally keep it teacher-gated and update UI copy, docs, tests, and privacy text to match.
- Replace hardcoded admin authority and client-only lifecycle logic with backend ownership: add role/custom-claims based admin access, Cloud Functions for booking expiration and approval side effects, FCM for real push notifications, and payment-side integrations.
- Restore contributor reliability and product trust together: fix and track the Gradle wrapper, update stale tests to the current access model, and sync README/docs/privacy/data-contract guidance while finishing or removing placeholder screens and inert profile actions.
