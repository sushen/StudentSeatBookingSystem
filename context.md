# context.md

## Project Summary
This repository is a Firebase-backed web platform for **Shapla Chottor Lab**. It combines:
- Google-authenticated learner profiles,
- seat-gated phase booking with admin moderation,
- structured lesson progression,
- referral/affiliate attribution workflows,
- an in-app admin booking panel,
- a separate admin operations dashboard,
- and a separate referral-approval admin queue.

Primary workflow implemented in code:
1. User signs in with Google.
2. User saves WhatsApp/phone.
3. User requests phase seat access (booking).
4. Admin reviews booking (`pending -> reviewing -> approved/rejected`; approved can later be `cancelled`; pending/reviewing can become `expired`).
5. Approved learner completes phase lessons sequentially.
6. Completed prior phase enables next-phase booking request.
7. Referral requests are submitted, reviewed by admin, and later can convert on phase1 completion.

## Tech Stack
- Frontend: Vanilla HTML/CSS/JavaScript (ES modules), no framework.
- Firebase Web SDK `10.12.5` via CDN (`firebase-app`, `firebase-auth`, `firebase-firestore`, `firebase-functions`).
- Backend: Firebase Cloud Functions v2 (Node 20, ESM) with `firebase-admin` + `firebase-functions`.
- Database/Auth: Firestore + Firebase Authentication.
- Admin analytics UI: Chart.js `4.4.3` + `chartjs-chart-funnel`.
- Icons: Lucide.
- Browser API integrations: Web Speech API (admin voice alerts), Clipboard API.
- Tracking integration: Facebook Pixel in `index.html`.
- Hosting: Firebase Hosting with rewrite `** -> /index.html`, and no-cache headers for `index.html` and `*.js`.

## Architecture
- `app.js` is a monolithic SPA controller with centralized in-memory state and DOM-render functions.
- Firebase listeners in main app:
  - `phases`
  - `users/{uid}`
  - `users/{uid}/progress`
  - `bookings` filtered by `userId`
  - `referralEvents` filtered by `referrerId`
  - `affiliateStats/{uid}`
  - fallback referral listeners:
    - `users` filtered by `referredByCode` / `referredBy` (legacy),
    - `referralPublic/{code}/events`.
- Backend-authoritative lifecycle operations are callable functions (booking transitions, referral moderation, reconciliation, deletion cascade).
- Learning/referral/support modules are split into local JS modules:
  - `learning/*`, `js/referral*`, `sound-engine/*`, `inAppBrowserDetection.js`.
- Admin surfaces:
  - `admin/admin.html` + modular services/components for analytics.
  - `admin/referral-approval/index.html` + callable-first API client + Firestore fallback mode.
- Runtime timers:
  - client booking countdown refresh every 1s,
  - super-admin profile refresh every 60s,
  - backend scheduled tasks every 5m and 30m.

## Features Implemented
- Authentication and browser-compatibility flow:
  - Google sign-in (popup + redirect fallback).
  - In-app browser detection and blocking guidance for OAuth-hostile embedded browsers.
- Profile flow:
  - save/update WhatsApp/phone,
  - referral code display and invite link copy,
  - delete-account modal with typed confirmation token.
- Booking lifecycle:
  - phase catalogs merged from Firestore + canonical fallback phases,
  - seat availability checks,
  - callable `createBooking`,
  - admin callable actions: `markBookingReviewing`, `approveBooking`, `rejectBooking`, `cancelBooking`,
  - pending/reviewing expiry handling.
- Learning flow:
  - per-phase lesson catalog with reflection requirement,
  - sequential lesson lock/unlock,
  - per-phase progress documents under `users/{uid}/progress/{phaseId}`,
  - aggregate progress + completed phase updates.
- Feature gates by overall progress:
  - `tradingBot` at 30%,
  - `investment` at 60%,
  - `affiliate` at 100%.
- Referral/affiliate:
  - click/session capture (`trackAffiliateClick`),
  - referral request submission (`requestReferralApproval`),
  - admin review (`reviewReferralApprovalRequest`),
  - conversion marking (`markReferralConversion`, phase1-only),
  - user-triggered aggregate sync (`syncMyAffiliateStats`),
  - profile referral activity rendering with legacy/public fallback datasets.
- Account deletion:
  - backend cascade callable `deleteAccountCascade`,
  - client-side fallback deletion path when callable is unavailable.
- Admin Operations Center:
  - realtime KPI dashboard, student risk table, booking funnel, phase analytics, referral analytics, alert panel, student deep-dive drawer.
- Referral Approval Queue:
  - pending/approved/rejected queue, approve/reject/apply actions, fallback direct Firestore path when callables are unavailable.

## Data Model
- `users/{uid}`
  - Identity/contact: `name`, `email`, `phone`, `phoneNumber`, `whatsapp`, `whatsappNumber`
  - Learning: `progress`, `unlockedPhases[]`, `completedPhases[]`
  - Referral: `referralCode`, `referredBy`, `referredByCode`, `referredByName`, `referredByEmail`
  - Pending referral request fields: `pendingReferral*`, `pendingReferralStatus`
  - Aggregates: `totalInvites`/`invites`, `conversions`
  - Timestamps: `createdAt`, `updatedAt`, optional `*AtMs`
- `users/{uid}/progress/{phaseId}`
  - `phaseId`, `completedLessonIds`, `completedLessons` (alias), `reflections`, `completedCount`, `totalLessons`, `progressPercent`, `lastCompletedLessonId`, `updatedAt`
- `phases/{phaseId}`
  - `phaseId`, `title`, `description`, `level`, `order`, `totalSeats`, `bookedSeats`
- `bookings/{bookingId}` where `bookingId = "${uid}_${phaseId}"`
  - Canonical + compatibility fields:
  - `bookingId`, `id`, `userId`, `uid`
  - `phaseId`, `phase`, `phaseKey`, `phaseCanonicalId`, `phaseLegacyId`, `phaseIdAliases`
  - status aliases: `status`, `requestStatus`, `bookingStatus`
  - contact/user fields, `createdAt*`, `updatedAt*`, `expiresAt*`, moderation timestamps, `source`
- `referralEvents/{referrerId}_{userId}`
  - `eventId`, `referrerId`, `userId`, referred user identity fields, `status`, `isConverted`, `joinedAt`, optional `convertedAt`, `updatedAt`, `source`
- `affiliateStats/{referrerId}`
  - `userId`, `totalInvites`/`invites`, `conversions`, sync timestamps
- `referralApprovals/{requestId}`
  - requester/referrer identity fields, requested/resolved referral codes, `status`, review metadata, `source`, optional `sessionId`
- `referralPublic/{referralCode}/events/{userId}` (client-published fallback event channel)
- Additional backend-owned collections:
  - `affiliateClicks`, `affiliateSessions`, `affiliateCommissions`, `affiliatePayouts`, `affiliateCampaigns`, `fraudSignals`, `auditLogs`

### Cross-Platform Contract Checks
- README claims Android/web shared contracts, but **no Android source exists in this repo**; parity cannot be fully validated here.
- Canonical contract implemented across web/admin/functions:
  - Canonical phase ID: `phaseId` (`phase1..phase6`)
  - Legacy phase aliases accepted: `phase`, `phaseKey`, `phase_1..phase_6`
  - Canonical booking status set: `pending`, `reviewing`, `approved`, `rejected`, `cancelled`, `expired`
  - Status aliases written/read: `status`, `requestStatus`, `bookingStatus`
- Query assumptions that affect compatibility:
  - Main app user booking listener queries `where("userId","==",uid)` only.
  - Backend reconciler filters approved bookings by canonical `phaseId`.
  - Legacy docs missing canonical `userId` or `phaseId` can be partially invisible without migration.

## Core Logic
- **Booking creation (`createBooking`)**: transaction validates auth, phase prerequisite via `users.completedPhases`, existing booking lifecycle, seat capacity, and writes pending booking payload with compatibility aliases.
- **Admin booking transitions** (`markBookingReviewing`, `approveBooking`, `rejectBooking`, `cancelBooking`): transactional state changes, seat counter mutation, user `unlockedPhases` mutation, audit logging.
- **Expiry and consistency jobs**:
  - `expireStaleBookingsScheduled` every 5 minutes,
  - `reconcileSeatsAndUnlocksScheduled` every 30 minutes,
  - manual callable variants for admin.
- **Referral flow**:
  - `trackAffiliateClick` records click + session attribution data.
  - `requestReferralApproval` creates/updates pending approval request and pending fields on user profile.
  - `reviewReferralApprovalRequest` finalizes approve/reject; on approve it writes `referredBy*`, creates referral event (if missing), increments invite counts.
  - `markReferralConversion` validates phase1 completion and issues conversion + commission (idempotent by commission document id).
  - `syncMyAffiliateStats` recomputes invite/conversion aggregates and repairs legacy assignments.
- **Account deletion** (`deleteAccountCascade`): collects known user-related docs across many collections, recursively removes user subcollections/docs, deletes Auth user, writes audit log.
- **Security-sensitive gates**:
  - Firestore rules deny direct client create/update for `bookings`, `referralEvents`, `affiliateStats`, `referralApprovals`.
  - Admin authorization is claim/email-based in rules and backend.

## Limitations
- `users/{uid}` remains broadly owner-writable; sensitive fields (`completedPhases`, `progress`, `referredBy*`, referral pending metadata, counters) are not field-level protected.
- Backend prerequisite checks trust `users.completedPhases`; users can modify this field from client and bypass intended learning progression gates.
- Referral fallback datasets can overstate conversions:
  - `deriveLegacyReferralEvents` marks matched legacy referrals as converted,
  - `referralPublic` normalization can infer conversion from `convertedAt` presence.
- Profile counters ignore `affiliateStats` in `deriveReferralCounters` (currently event-derived only), so UI can diverge from backend aggregates in edge cases.
- Canonical phase metadata is not fully aligned across layers (`app.js`, `admin/utils/constants.js`, `functions/index.js` differ for phase3-5 titles/descriptions).
- Referral-approval Firestore fallback path is complex and partially heuristic (scans/identity recovery), with scalability and correctness risk on large datasets.
- Admin fallback queries use fixed limits (`250/350/1000`) and no pagination.
- No Android/mobile code in repo to validate real cross-client schema parity despite README claims.
- Test coverage is minimal:
  - only one Firestore rules test file exists,
  - function lifecycle logic has no dedicated automated tests here.
- Local test execution prerequisites are not fully documented/enforced (rules test requires emulator + JDK21 in current environment).
- Some UI controls are placeholders/non-functional (`Forgot Password`, register prompt text, notifications row).

## Missing / TODO
- Add field-level write constraints (or move sensitive profile fields to backend-only docs) so client cannot self-elevate progression/referral state.
- Move prerequisite truth for booking access to backend-validated progress source, not mutable `users.completedPhases` alone.
- Normalize referral metric semantics (clear separation of join vs conversion across primary, legacy, and public fallback sources).
- Consolidate canonical phase definitions into one shared source used by app, admin, and functions.
- Add migration/repair tooling for legacy booking and referral shapes (`uid` vs `userId`, legacy `phase` fields, referral ID/code ambiguity).
- Add pagination and stricter query strategy to referral fallback admin flows.
- Expand automated tests:
  - callable lifecycle transitions,
  - seat counter integrity,
  - referral approval/conversion idempotency,
  - deletion cascade coverage.
- Add CI checks for rules/functions tests and deployment contract validation.

## Recommended Next Steps
1. **Security hardening first**: lock down mutable user fields that drive backend decisions (`completedPhases`, referral attribution fields, aggregate counters).
2. **Progression integrity second**: make booking prerequisites derive from authoritative progress computation in backend transactions.
3. **Referral correctness third**: unify join/conversion event semantics and align UI counters with authoritative aggregate data.
4. **Contract unification**: centralize phase/status/schema constants and run a migration for legacy documents.
5. **Operational reliability**: add robust tests + CI + documented emulator prerequisites, then enforce pre-deploy checks.
6. **Scale readiness**: add pagination/index-aware query patterns in admin fallback paths and reduce heuristic scans.
7. **UX cleanup**: either implement placeholder account settings/auth actions or remove them from the UI.
