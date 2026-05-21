# context.md

## Project Summary
This repository is a Firebase-hosted web system for **Shapla Chottor Lab** that combines:
1. learner onboarding and Google-authenticated profiles,
2. phase-based seat booking and moderation,
3. structured lesson progression with gated phase advancement,
4. referral/affiliate tracking, and
5. two admin surfaces (in-app moderation + a separate analytics dashboard).

Core workflow implemented in code:
1. user signs in with Google,
2. user saves WhatsApp/phone,
3. user requests phase access (booking),
4. admin reviews/approves/rejects/cancels,
5. approved learners complete lessons sequentially,
6. learning completion unlocks next-phase booking eligibility.

Important implementation truth: Phase 1 is **not auto-open**; classroom access is tied to `unlockedPhases` / approved booking state.

## Tech Stack
- Frontend:
  - Plain HTML/CSS/JavaScript (ES modules), no framework.
  - Firebase Web SDK `10.12.5` loaded from CDN (Auth, Firestore, Functions).
  - Lucide icons.
  - Browser SpeechSynthesis API for admin voice alerts.
  - Facebook Pixel in `index.html`.
- Admin Operations Center (`/admin/admin.html`):
  - Modular ES modules.
  - Chart.js `4.4.3` + `chartjs-chart-funnel`.
- Backend:
  - Firebase Cloud Functions v2 (Node 20, ESM).
  - Firestore + Firebase Auth (Admin SDK).
  - Scheduled function every 5 minutes for stale booking expiry.
- Hosting/config:
  - Firebase Hosting serves repo root, rewrites `** -> /index.html`.
  - Firestore rules in `firestore.rules`.

## Architecture
- Main app (`app.js`) is a monolithic SPA controller with:
  - a centralized in-memory `state` object,
  - DOM-driven rendering functions,
  - Firebase realtime listeners (`onSnapshot`) for phases/profile/bookings/progress/affiliate stats,
  - callable-function integration with client-transaction fallbacks.
- Learning modules:
  - `learning/lessonCatalog.js` (phase lessons and blocks),
  - `learning/progression.js` (progress math and feature gates).
- Booking lifecycle authority:
  - Primary path: Cloud Functions (`createBooking`, `approveBooking`, etc.).
  - Fallback path: client-side Firestore transactions in `app.js` for key mutations when callables fail/unavailable.
- Separate admin analytics app:
  - `admin/services/dataService.js` streams all operational collections.
  - `admin/services/analyticsService.js` builds KPI/alert/student risk models.
  - Rendering split across `admin/components/*` and `admin/charts/*`.
- Security boundary:
  - Firestore rules enforce auth/admin checks, but still permit several owner-side direct writes (see limitations).

## Features Implemented
- Authentication and access:
  - Google sign-in (popup with redirect fallback).
  - In-app browser detection/guidance; blocks Google auth in known embedded browsers.
- Profile and user data:
  - Save/edit WhatsApp/phone in profile modal.
  - Referral code input capture before login and deferred apply after login.
- Phases and booking:
  - 6 canonical phases with legacy ID normalization (`phase_1` -> `phase1`, etc.).
  - Seat availability checks.
  - Booking request with 15-minute pending expiry window.
  - Booking status model: `pending`, `reviewing`, `approved`, `rejected`, `cancelled`, `expired`.
  - Status countdown UI and lifecycle badges.
- Learning:
  - Classroom with sequential lesson unlocking.
  - Lesson blocks: Concept / Example / Exercise / Reflection.
  - Reflection required before marking lesson complete.
  - Progress persisted under `users/{uid}/progress/{phaseId}`.
  - `completedPhases` and aggregate `progress` updates on user doc.
  - Feature gates from overall progress: tradingBot (30%), investment (60%), affiliate (100%).
- Referral/affiliate:
  - Callable `applyReferralCode`.
  - Callable `markReferralConversion` after phase1 completion.
  - Profile invite/copy UX and affiliate stat display.
- In-app admin moderation panel:
  - Pending/reviewing queue and all/approved views.
  - Actions: move to reviewing, approve, reject, cancel seat.
  - Voice alerts for new pending bookings.
- Separate Admin Operations Center:
  - Realtime KPIs, learning charts, booking funnel, phase analytics, referral analytics, alert list.
  - Student table with filters/sort and deep-dive drawer.
  - Follow-up state stored in browser `localStorage` (not Firestore).
- Account deletion:
  - Callable `deleteAccountCascade` with confirmation token `DELETE`.
  - Client-side deletion fallback if backend unavailable.

## Data Model
- `users/{uid}`
  - Key fields seen in code: `name`, `email`, `phone`, `phoneNumber`, `whatsapp`, `whatsappNumber`, `referralCode`, `referredBy`, `progress`, `unlockedPhases[]`, `completedPhases[]`, `createdAt`, `updatedAt`.
- `users/{uid}/progress/{phaseId}`
  - Fields: `phaseId`, `completedLessonIds`, `completedLessons` (alias), `reflections`, `completedCount`, `totalLessons`, `progressPercent`, `lastCompletedLessonId`, `updatedAt`.
- `phases/{phaseId}`
  - Fields: `phaseId`, `title`, `description`, `level`, `order`, `totalSeats`, `bookedSeats`, optional `updatedAt`.
- `bookings/{bookingId}` where `bookingId = "${userId}_${phaseId}"`
  - Canonical + compatibility fields written: `bookingId`, `id`, `userId`, `uid`, `phaseId`, `phase`, `phaseKey`, `phaseCanonicalId`, `phaseLegacyId`, `phaseIdAliases`, contact fields, status aliases, timestamps (`createdAt`, `updatedAt`, `expiresAt`, `...AtMs`), `source`.
- `referralEvents/{referrerId}_{userId}`
  - Fields: `eventId`, `referrerId`, `userId`, `referredUserName`, `referredUserEmail`, `status`, `isConverted`, `joinedAt`, optional `convertedAt`, `updatedAt`, `source`.
- `affiliateStats/{referrerId}`
  - Fields: `userId`, `totalInvites`, `conversions`, `updatedAt`.

State machine implemented in backend/client logic:
1. `pending` -> `reviewing`
2. `pending|reviewing` -> `approved`
3. `pending|reviewing` -> `rejected`
4. `approved` -> `cancelled`
5. `pending|reviewing` -> `expired` (time-based)

Cross-platform compatibility handling in code:
- Canonical phase IDs + legacy aliases are normalized in app/admin/functions.
- Booking schema writes both canonical and legacy alias fields.
- Status values are lowercase canonical strings.

## Core Logic
- `createBooking` (callable, transaction):
  - requires auth,
  - validates phone formats,
  - canonicalizes phase IDs,
  - enforces prior-phase completion from `users.completedPhases`,
  - expires stale active booking if needed,
  - blocks duplicate active/approved booking,
  - checks seat capacity,
  - writes a pending booking document.
- Admin lifecycle callables (transactional):
  - `markBookingReviewing`, `approveBooking`, `rejectBooking`, `cancelBooking`.
  - `approve` increments phase `bookedSeats` and `arrayUnion`s user `unlockedPhases`.
  - `cancel` decrements `bookedSeats` and `arrayRemove`s `unlockedPhases`.
- Expiry and reconciliation:
  - `expireStaleBookingsScheduled` runs every 5 minutes (plus manual callable).
  - `reconcileBookingConsistency` recalculates `bookedSeats` from approved bookings and unions unlocked phases.
- Referral logic:
  - `applyReferralCode` validates against self-referral, creates referral event, increments invite stats.
  - `markReferralConversion` allows conversion for phase1 completion only.
- Deletion logic:
  - `deleteAccountCascade` recursively deletes user-owned docs across collections and Auth user.
- Client fallback behavior:
  - If callables fail/unavailable, app falls back to direct Firestore transactions for create/approve/reject/cancel and to client-side account deletion.
  - Some admin actions (move to reviewing) have no transaction fallback and require functions.

## Limitations
- Firestore rules do **not** fully enforce backend-only authority for critical lifecycle domains:
  - booking owners can create/update/delete their own booking docs directly,
  - normal users can write referral/affiliate docs affecting analytics integrity.
- Booking deletion by owner can desynchronize lifecycle/accounting:
  - approved booking can be deleted directly,
  - phase seat counters and `unlockedPhases` can drift,
  - reconciliation currently unions unlocks but does not remove stale unlocks.
- Client fallback paths can bypass backend consistency/audit guarantees when functions are down.
- Canonical phase metadata is inconsistent across layers:
  - `app.js` and `admin/utils/constants.js` define phase3-5 names differently from `functions/index.js` fallback catalog.
- Legacy data compatibility gaps remain:
  - user booking listener queries `where("userId","==",uid)`; legacy docs with only `uid` are not visible to learner UI.
  - reconciliation queries approved bookings by `phaseId`; legacy records missing canonical `phaseId` are skipped.
- No automated tests or CI checks in repo for lifecycle/state integrity.
- No Firestore index configuration file in repo (operational drift risk across environments).
- Referral code uniqueness is not enforced globally (collision risk from 6-char UID-derived codes).
- UI placeholders exist without implementation (`Forgot Password`, register flow text, notifications settings row).

## Missing / TODO
- Harden Firestore rules so booking/referral/affiliate critical writes are function-only.
- Remove/limit client mutation fallbacks for moderation-critical transitions.
- Add data migration tooling for legacy docs (`uid` vs `userId`, missing canonical `phaseId`, stale status aliases).
- Add unlock reconciliation that can both add and remove `unlockedPhases` based on authoritative booking state.
- Align and centralize phase catalog constants across app/admin/functions.
- Add scheduled/observable operational jobs for integrity checks (plus dashboards/alerts for failures).
- Implement actual auth recovery/onboarding flows (forgot password / registration) or remove dead UI.
- Add automated test coverage for status transitions, expiry, seat accounting, and deletion cascade.

## Recommended Next Steps
1. **Security first:** lock Firestore rules to backend-authoritative mutations for bookings/referrals/affiliate stats.
2. **Consistency second:** disable risky client fallbacks and route all lifecycle writes through callables.
3. **Data integrity:** run a one-time migration + improved reconciliation to canonicalize booking/user phase fields and repair unlock/seat drift.
4. **Contract unification:** create one shared canonical phase/status/schema contract source used by app, admin, and functions.
5. **Operational reliability:** add `firestore.indexes.json`, deployment checks, and callable-level audit/error telemetry.
6. **Testability:** add integration tests for booking lifecycle transactions and account deletion cascade.
7. **UX cleanup:** implement or remove non-functional profile/auth controls to reduce false affordances.

