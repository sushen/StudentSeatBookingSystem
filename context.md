# context.md

## Project Summary
This project is a Firebase-backed web learning and seat-booking system for Shapla Chottor Lab, designed to stay data-compatible with a mobile app that reads/writes the same Firestore collections.

Primary workflow:
1. User signs in with Google.
2. User completes phase lessons (with reflections) in sequence.
3. User requests seat access for next phases.
4. Admin reviews/approves/rejects/cancels bookings.
5. Booking lifecycle and seat counts are reconciled by Cloud Functions and scheduled expiry jobs.

The system solves synchronized progression + moderation across web/mobile with shared booking contracts.

## Tech Stack
- Frontend: Vanilla JavaScript (ES modules), HTML, CSS (`index.html`, `app.js`, `style.css`)
- Backend: Firebase Cloud Functions v2 (Node 20, ESM) in `functions/index.js`
- Data/Auth: Firestore + Firebase Auth (Google sign-in)
- Hosting: Firebase Hosting SPA rewrite (`firebase.json`)
- Rules: Firestore Security Rules in `firestore.rules`
- Browser APIs: `SpeechSynthesis`, Clipboard API, dynamic module imports
- External script: Meta Pixel in `index.html`

## Architecture
- `app.js`: single runtime controller with:
  - global state object
  - render functions per panel
  - Firestore listeners
  - booking/admin actions
  - learning progression persistence
- `learning/lessonCatalog.js`: static phase->lesson content and blocks
- `learning/progression.js`: shared progression math and feature gate thresholds
- `inAppBrowserDetection.js`: OAuth-hostile in-app browser detection + handoff guidance
- `sound-engine/*`: admin voice alerts for newly pending bookings
- `functions/index.js`: authoritative lifecycle mutations, expiry sweep, reconciliation, delete cascade

State management is client-local (no framework store): `state` + explicit `render*()` calls after each mutation/listener update.

## Features Implemented
- Google login/logout with popup first, redirect fallback.
- In-app browser guard (Facebook/Messenger/Instagram/WebView heuristics) with "open in browser" guidance.
- Auth landing + signed-in app shell with section navigation (home, overview, learning, classroom, features, profile, admin).
- 6 canonical phases with Firestore override and legacy phase ID normalization (`phase_1` -> `phase1`).
- Learning classroom:
  - phase tabs
  - sequential lesson unlock
  - required reflection before completion
  - per-phase progress at `users/{uid}/progress/{phaseId}`
- Progress-based feature gates:
  - `tradingBot` at 30%
  - `investment` at 60%
  - `affiliate` at 100%
- Booking request flow:
  - validates previous phase completion
  - checks capacity
  - creates `bookings/{uid_phaseId}` payload with canonical + alias fields
- Admin moderation UI:
  - Pending/All tabs
  - move to reviewing, approve, reject, cancel seat
- Account deletion UI using callable `deleteAccountCascade`.
- Admin voice notifications for new pending bookings.

## Data Model
- `users/{uid}`
  - profile: `name`, `email`, `phone`, `phoneNumber`, `whatsappNumber`
  - progression summary: `progress`, `completedPhases[]`, `unlockedPhases[]`
  - optional referral/invite display fields (read only in UI if present)
- `users/{uid}/progress/{phaseId}`
  - `phaseId`, `completedLessonIds` (and alias `completedLessons`)
  - `reflections` map by `lessonId`
  - `completedCount`, `totalLessons`, `progressPercent`, `lastCompletedLessonId`, `updatedAt`
- `phases/{phaseId}`
  - `phaseId`, `title`, `description`, `level`, `order`, `totalSeats`, `bookedSeats`
- `bookings/{bookingId}` where `bookingId = ${userId}_${canonicalPhaseId}`
  - canonical fields: `bookingId`, `userId`, `phaseId`, `phoneNumber`, `whatsappNumber`, `status`, `createdAt`, `expiresAt`
  - compatibility aliases: `id`, `uid`, `phase`, `phaseKey`, `requestStatus`, `bookingStatus`, `phone`, `whatsapp`, `phaseCanonicalId`, `phaseLegacyId`, `phaseIdAliases`
  - audit fields for moderation state changes (`approvedBy`, `rejectedBy`, etc.)
- `referralEvents/{eventId}`, `affiliateStats/{affiliateId}` (rules + delete cascade support exist; no full web workflow implemented)

Cross-platform contract assumptions in code:
- Status values are lowercase: `pending`, `reviewing`, `approved`, `rejected`, `cancelled`, `expired`
- Pending window is 15 minutes (`expiresAt = createdAt + 15m`)
- Canonical phase IDs are `phase1..phase6`; legacy aliases are still read/written.

## Core Logic
- Security boundary:
  - Firestore rules deny all direct writes to `bookings` and `phases`.
  - Booking lifecycle authority is in callable/scheduled functions.
- Callable functions:
  - `createBooking`, `markBookingReviewing`, `approveBooking`, `rejectBooking`, `cancelBooking`
  - `expireStaleBookingsScheduled` (every 5 min), `expireStaleBookingsNow`
  - `reconcileBookingConsistency`
  - `deleteAccountCascade`
- Transactional boundaries:
  - approve/cancel mutate booking + phase seats + user unlocked phases atomically.
  - createBooking enforces prerequisite + active lifecycle checks atomically.
- Listener boundaries in web:
  - global phases subscription after Firebase init
  - user-scoped profile/bookings/progress subscriptions on auth
  - admin full-bookings subscription on admin auth
- Expiry behavior:
  - backend sweep persists `expired` status for stale pending/reviewing docs.
  - frontend also computes effective expiry from `expiresAt` for UI safety.

## Limitations
- `users/{uid}` writes are owner-allowed with no field-level validation; client can self-edit `completedPhases`/`unlockedPhases`, and backend `createBooking` currently trusts `completedPhases`.
- Web fallback client transactions for booking/admin actions remain in `app.js` but are effectively blocked by current Firestore rules (`bookings/phases` write=false).
- Admin read path subscribes to entire `bookings` collection then filters client-side (scalability risk).
- Frontend admin detection is email-based only; users with only custom claim admin (different email) may pass backend checks but not get admin UI.
- Legacy doc compatibility is partial:
  - user booking query uses `where("userId","==",uid)`; docs with only `uid` are missed.
  - security rule for booking reads checks `resource.data.userId`; uid-only legacy docs are inaccessible to owners.
  - account delete cascade queries bookings by `userId`; uid-only docs can be orphaned.
- Canonical phase metadata differs between frontend and Cloud Functions for phases 3-5 titles/descriptions.
- No automated tests/CI, no migration scripts, no explicit index definitions in repo.

## Missing / TODO
- No complete web referral/affiliate product flow (UI shows placeholders; no end-to-end creation/reporting logic).
- Notifications setting row in profile has no implemented behavior.
- No role management UI or admin claim provisioning flow.
- No observability dashboard/alerts for callable failures, expiry sweep health, or reconciliation drift.
- No explicit anti-abuse/rate limiting for high-frequency callable invocation.
- No formal schema versioning/migration pipeline for legacy bookings.

## Recommended Next Steps
1. Enforce progression server-side from authoritative progress docs:
   - derive prerequisites from `users/{uid}/progress/*` instead of trusting `users.completedPhases`.
2. Harden user profile writes in Firestore rules:
   - restrict owner-writable fields; block direct owner edits to privileged aggregates (`unlockedPhases`, potentially `completedPhases`).
3. Unify shared schema constants across web + functions:
   - phase catalog metadata, status constants, canonical field names in one shared source or generated contract.
4. Add legacy-data migration + cleanup:
   - backfill `userId` from `uid`, canonical `phaseId`, normalized status/timestamps, and alias parity.
5. Replace admin full-collection listen with indexed server queries/pagination:
   - pending/reviewing feed + historical feed with bounded windows.
6. Add automated tests:
   - callable lifecycle tests, rules tests, contract-parity tests for web/mobile booking payloads.
7. Add operational controls:
   - callable telemetry, sweep/reconciliation monitoring, and runbooks for drift and orphan cleanup.
