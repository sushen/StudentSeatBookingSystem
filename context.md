# context.md

## Project Summary
This repository is a Firebase-backed web platform for Shapla Chottor Lab with three shipped surfaces:
- learner web app (`index.html` + `app.js`),
- admin operations dashboard (`admin/admin.html`),
- referral-approval queue (`admin/referral-approval/index.html`).

It solves seat-gated phase access with moderation, structured lesson progression, and referral/affiliate attribution.  
Critical state transitions (booking lifecycle, referral approvals, conversion/commission, reconciliations, deletion cascade) are backend-authoritative through Cloud Functions.

## Tech Stack
- Frontend: Vanilla HTML/CSS/ES module JavaScript.
- Firebase Web SDK `10.12.5` (Auth, Firestore, Functions) via CDN.
- Backend: Firebase Cloud Functions v2 (`functions/index.js`), Node 20, ESM, `firebase-admin`, `firebase-functions`.
- Database/Auth: Firestore + Firebase Authentication.
- Admin analytics visuals: Chart.js `4.4.3` + `chartjs-chart-funnel`.
- Icons: Lucide.
- Other integrations: Web Speech API (admin voice alerts), Facebook Pixel.
- Hosting: Firebase Hosting rewrite-all to `/index.html`, no-cache headers for HTML/JS.

## Architecture
- Main learner app is a centralized stateful SPA controller in [app.js](/C:/Users/user/PycharmProjects/StudentSeatBookingSystemVersionFour/app.js).
- Cloud Functions in [functions/index.js](/C:/Users/user/PycharmProjects/StudentSeatBookingSystemVersionFour/functions/index.js) enforce lifecycle mutations and run scheduled cleanup/reconciliation.
- Firestore rules in [firestore.rules](/C:/Users/user/PycharmProjects/StudentSeatBookingSystemVersionFour/firestore.rules) block direct client writes for backend-owned domains (`bookings`, `referralEvents`, `affiliateStats`, `referralApprovals`, etc.).
- Admin Operations Center is read-heavy analytics:
  - `RealtimeDataService` subscribes to users/phases/bookings/progress/referral/affiliate collections.
  - `buildOperationalAnalytics` derives KPIs, risk, funnels, alerts, charts.
- Referral Approval Queue is callable-first, with a Firestore fallback mode that mutates `users` docs when callables are unavailable.

State/listener boundaries:
- Learner listeners: `phases`, `users/{uid}`, `users/{uid}/progress`, `bookings(where userId==uid)`, `affiliateStats/{uid}`, `referralEvents(where referrerId==uid)`, plus fallback referral streams (`referralPublic`, legacy `users` queries).
- Admin analytics listeners: collection-level and collectionGroup-level subscriptions; progress has fallback from `collectionGroup(progress)` to per-user `users/{uid}/progress`.
- Transactions: all booking moderation callables, referral review callables, conversion+commission writes, and deletion cascade planning.

## Features Implemented
- Google login/logout (popup + redirect fallback), with in-app browser detection and "open in browser" guidance.
- Profile/contact flow with WhatsApp capture, referral code display/share link copy, and account deletion confirmation flow.
- Booking state machine:
  - `pending -> reviewing -> approved/rejected`,
  - `approved -> cancelled`,
  - `pending/reviewing -> expired` (time-based).
- Seat governance with `phases.totalSeats/bookedSeats`.
- Learning/classroom flow:
  - fixed per-phase lesson catalog,
  - strict sequential lesson unlock,
  - reflection required before lesson completion,
  - progress persisted in `users/{uid}/progress/{phaseId}`.
- Progress-based feature gates (`tradingBot`, `investment`, `affiliate`).
- Referral/affiliate:
  - click/session tracking (`trackAffiliateClick`),
  - direct referral assignment callable exists (`applyReferralCode`) and can bind tracked session attribution,
  - referral request workflow (`requestReferralApproval` + admin review),
  - conversion marking on phase1 completion (`markReferralConversion`),
  - user-triggered + periodic stats reconciliation (`syncMyAffiliateStats`, scheduled reconciliation),
  - public/legacy fallback referral event rendering in learner UI.
- Admin inline panel inside learner app supports booking moderation callables.
- Separate admin operations dashboard with KPI cards, student risk table, phase analytics, booking funnel, referral analytics, and deep-dive drawer.
- Separate referral queue UI with approve/reject/apply-code actions and fallback mode.

## Data Model
- `users/{uid}`: identity/contact, learning aggregates (`progress`, `completedPhases`, `unlockedPhases`), referral attribution (`referralCode`, `referredBy*`), pending referral fields (`pendingReferral*`), invite/conversion counters.
- `users/{uid}/progress/{phaseId}`: `completedLessonIds`, `reflections`, `completedCount`, `totalLessons`, `progressPercent`, timestamps.
- `phases/{phaseId}`: canonical phase metadata + seat counters.
- `bookings/{uid_phaseId}`:
  - canonical fields: `bookingId`, `userId`, `phaseId`, `status`, `createdAt`, `expiresAt`,
  - compatibility aliases: `id`, `uid`, `phase`, `phaseKey`, `requestStatus`, `bookingStatus`, `phaseCanonicalId`, `phaseLegacyId`.
- `referralEvents/{referrerId_userId}`: join/conversion status and timestamps.
- `affiliateStats/{referrerId}`: invite/conversion aggregates.
- `referralApprovals/{requestId}`: pending/approved/rejected referral requests with reviewer metadata.
- `referralPublic/{referralCode}/events/{userId}`: client-published fallback event stream.
- Affiliate attribution/ledger collections:
  - `affiliateClicks/{clickId}`: click-level records with `sessionId`, `referrerId`, `referralCode`, campaign/source, hashed UA/IP, timestamps.
  - `affiliateSessions/{sessionId}`: session-level attribution state (`open/bound`), click counters, TTL (`expiresAtMs`), optional bound `userId`.
  - `affiliateCommissions/{referrer_user_phase}`: idempotent conversion ledger (`status`, `amountMicros`, `currency`, `rateBps`, `idempotencyKey`).
  - `affiliatePayouts`, `affiliateCampaigns`: schema/rules present; no active payout or campaign workflow in this repo.
  - `fraudSignals`, `auditLogs`: backend-only operational/security traces for affiliate/referral events.

Cross-platform contract checks from code:
- No mobile client code exists in this repository; contract parity concerns are between learner web, admin web, and Cloud Functions.
- Canonical phase IDs are `phase1..phase6`; legacy `phase_1..phase_6` mapping exists in learner app, admin normalizers, and functions.
- Canonical booking statuses are lowercase: `pending`, `reviewing`, `approved`, `rejected`, `cancelled`, `expired`.
- Canonical booking identity is `bookingId = "${uid}_${phaseId}"`.
- Compatibility risk still present:
  - learner app queries bookings by `userId` only,
  - backend reconciliation queries approved bookings by canonical `phaseId` only.
  Legacy docs missing canonical fields can be partially invisible until migrated.

## Core Logic
- `createBooking` callable:
  - auth required,
  - validates prior-phase completion (from `users.completedPhases`),
  - checks existing booking for same `uid_phaseId`,
  - expires stale active booking in transaction if needed,
  - checks phase seat capacity,
  - writes booking payload with canonical+legacy alias fields.
- Admin booking callables (`markBookingReviewing`, `approveBooking`, `rejectBooking`, `cancelBooking`) mutate booking status and, where applicable, seat count + `users.unlockedPhases`.
- Scheduled operations:
  - `expireStaleBookingsScheduled` every 5 minutes,
  - `reconcileSeatsAndUnlocksScheduled` every 30 minutes,
  - `reconcileReferralStatsScheduled` every 30 minutes.
- Affiliate/referral update logic:
  - `trackAffiliateClick` resolves referral code to referrer, appends `affiliateClicks`, and upserts `affiliateSessions` with 30-day TTL.
  - `syncMyAffiliateStats` scans current assignments + legacy patterns, repairs/normalizes `referralEvents`, and rewrites `affiliateStats` + mirrored counters on `users/{uid}`.
  - approval and direct-apply paths both call session binding (`bindAffiliateSessionToUser`) when `sessionId` is present.
- Referral approval domain:
  - request stored in `referralApprovals/{uid}`,
  - approval sets `referredBy*`, creates join event if missing, increments invites,
  - rejection clears pending request fields and stamps review metadata.
- Conversion domain:
  - `markReferralConversion` requires phase1 completion,
  - marks referral event converted and creates idempotent `affiliateCommissions/{referrer_user_phase1}` if missing.
- `deleteAccountCascade` callable collects and deletes user-linked docs across multiple collections, recursively deletes user subtree, then deletes Firebase Auth user.

## Limitations
- Owner write scope on `users/{uid}` is broad. Sensitive fields that drive backend decisions (`completedPhases`, `referredBy*`, referral pending metadata, counters) are not field-restricted in rules.
- Backend prerequisite checks trust mutable user fields (`users.completedPhases`), so progression gating can be bypassed by direct profile edits.
- Owner write access to `users/{uid}/progress/{phaseId}` enables direct client mutation of completion markers that some backend decisions currently trust.
- Referral conversion logic trusts profile attribution (`referredBy`) + writable progress signals, enabling abuse if profile/progress fields are tampered.
- `applyReferralCode` is callable by any authenticated user and can assign referral immediately, which bypasses admin-review-first policy implied by the approval queue UX.
- Phase catalog definitions diverge across layers (`app.js`, `admin/utils/constants.js`, `functions/index.js` titles/descriptions are not identical).
- Referral fallback path in queue UI performs heuristic identity recovery and capped scans (`limit(250/350/1000)`), which is fragile and not scalable.
- Some reported affiliate/referral counters in learner UI derive from fallback event composition and can diverge from authoritative aggregates.
- Collections such as `affiliatePayouts` and `affiliateCampaigns` are defined/rules-protected but have no active write workflow in current code.
- Test coverage is minimal: one Firestore rules test file; no dedicated automated tests for callable lifecycle logic.
- UI placeholders exist without implemented behavior (`Forgot Password`, Register prompt text, Notifications row in profile settings).

## Missing / TODO
- Enforce field-level write constraints for user-owned docs, or move authoritative progression/referral fields to backend-only documents.
- Rework booking prerequisite validation to use authoritative progress evidence, not mutable profile aggregates alone.
- Decide a single referral assignment policy: either restrict/remove direct `applyReferralCode` or enforce explicit admin-controlled gates before assignment.
- Add migration for legacy booking/user docs to guaranteed canonical fields (`userId`, `phaseId`).
- Unify canonical phase metadata and contract constants into one shared source used by learner/admin/functions.
- Strengthen referral analytics contract (clear join vs conversion semantics across primary/legacy/public fallback data).
- Add pagination/index-aware admin fallback query paths and reduce full-scan heuristics.
- Add function-level automated tests for booking lifecycle, referral approval/rejection, conversion idempotency, reconciliation, and deletion cascade.
- Add operational controls for growth (retention/archival for `auditLogs`, `fraudSignals`, click/session data).

## Recommended Next Steps
1. Security hardening: lock down mutable `users/{uid}` fields that currently affect backend authority decisions.
2. Progression integrity: validate phase prerequisites from backend-owned progress truth.
3. Contract cleanup: migrate legacy docs and enforce canonical booking/user fields.
4. Referral correctness: consolidate event semantics and make UI counters consume authoritative aggregates first.
5. Test + release discipline: add callable/rules test suites and CI gates before deploy.
6. Scale readiness: replace fallback scan-heavy admin flows with paginated/query-safe designs.
