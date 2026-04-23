# context.md

## Project Summary
This project is a static single-page phase booking system for **Shapla Chottor AI Research Lab**. Learners request access to phases, admins approve/reject requests, and approved phases unlock progression.

The system is intentionally aligned with the Android app data contract so web-created bookings can be read in the Android admin pending tab without Android-side changes.

## Tech Stack
- **Frontend:** Vanilla JavaScript (ES modules), HTML, CSS
- **Backend services used:** Firebase Authentication (Google) and Cloud Firestore
- **SDK loading:** Firebase Web SDK v10.12.5 imported dynamically from Google CDN at runtime
- **Browser APIs:** SpeechSynthesis, Clipboard API, popup auth flow
- **External integration:** Meta Pixel script in `index.html`
- **Deployment model:** Static hosting (no backend code in this repo)

## Architecture
- `index.html`: Main UI shell (auth controls, profile, phase cards, admin table, modals)
- `app.js`: Core app controller (state, auth, Firestore subscriptions/writes, transactions, rendering, admin actions)
- `inAppBrowserDetection.js`: In-app browser detection and guidance/intent URL generation
- `sound-engine/soundEngine.js`: Voice notification engine
- `sound-engine/bookingNotificationUtils.js`: Detects new pending bookings for voice alerts

Architecture is client-heavy: business rules and privileged transitions are executed in browser code with Firestore transactions for consistency.

## Features Implemented
- Google sign-in/sign-out with popup auth.
- In-app browser guard for OAuth-blocked environments (Messenger/Instagram/WebView patterns).
- User profile capture and update (`phoneNumber`, `whatsappNumber`).
- Fixed 6-phase catalog with Firestore override support (`phases` collection), including legacy phase ID normalization (`phase_1` -> `phase1`).
- Progressive phase unlock rules (must complete previous phase path).
- Booking request transaction:
  - checks phase capacity,
  - blocks duplicate active pending/approved request,
  - writes booking to `bookings/{userId}_{phaseId}`.
- Booking expiry window of 15 minutes (`createdAt` + 15 minutes), treated as effective `expired` in UI/admin logic.
- Admin panel with tabs:
  - `Pending`: actionable pending-only rows
  - `All Bookings`: historical/all statuses
- Admin actions:
  - approve pending booking (`approved`) and increment `phases.bookedSeats`
  - reject pending booking (`rejected`)
  - cancel approved booking (`cancelled`) and decrement `phases.bookedSeats`
  - update `users.unlockedPhases` on approve/cancel
- Voice alert for newly pending bookings (admin-only mode).

## Data Model
### Firestore Collections
- `users/{uid}`
  - `name`, `email`
  - `phone`, `phoneNumber`, `whatsappNumber`
  - `progress` (number)
  - `unlockedPhases` (string[])
  - `completedPhases` (string[])
  - `createdAt`, `updatedAt` (timestamps)

- `phases/{phaseId}`
  - `phaseId`, `title`, `description`, `level`, `order`
  - `totalSeats`, `bookedSeats`

- `bookings/{bookingId}` where `bookingId = "${userId}_${phaseId}"`
  - **Primary Android-compatible fields:** `bookingId`, `userId`, `phaseId`, `phoneNumber`, `whatsappNumber`, `createdAt`, `expiresAt`, `status`
  - **Status enum:** `pending | approved | rejected | cancelled | expired`
  - **Alias/backward-compat fields:** `id`, `uid`, `phase`, `phaseKey`, `requestStatus`, `bookingStatus`, etc.
  - **Time fields for compatibility:** `createdAtMs`, `expiresAtMs`, `updatedAtMs` plus mirrored `createdAt`, `expiresAt`, `updatedAt` numeric epoch-ms values

### State Transitions
- `pending` -> `approved` (admin approve)
- `pending` -> `rejected` (admin reject)
- `approved` -> `cancelled` (admin cancel)
- `pending` -> effective `expired` when current time exceeds `expiresAt`

## Core Logic
- `canonicalizePhaseId()` maps legacy IDs to canonical IDs.
- `normalizeBookingDoc()` reads both canonical and alias fields.
- `requestBookingForPhase()` performs transaction-safe creation and writes Android-compatible booking payload.
- `subscribeToUserBookings()` uses `where("userId", "==", uid)`.
- `subscribeToAdminPendingBookings()` listens to `bookings` and only includes rows where raw `status === "pending"` and not effectively expired.
- Admin approve/cancel flows update both booking document status and phase/user aggregate counters.

## Limitations
- Admin authorization is client-side email matching (no server-enforced role in repo).
- Critical booking transitions are executed from frontend code.
- Firestore rules are not versioned in this repository.
- Firebase config and admin email are hardcoded in client source.
- Admin subscription currently listens to entire `bookings` collection, then filters client-side.
- Expiry is computed in client/UI logic, not guaranteed by backend mutation.
- No automated tests or CI.

## Missing / TODO
- Move privileged transitions to trusted backend (Cloud Functions/Run).
- Enforce role-based access with Firebase custom claims and strict Firestore rules.
- Add query/index strategy for scalable admin pending retrieval.
- Add migration tooling for legacy booking docs created before schema alignment.
- Add automated tests for race conditions and cross-platform schema compatibility.
- Externalize environment-specific Firebase configuration.

## Recommended Next Steps
1. Build backend endpoints/functions for booking create/approve/reject/cancel with authoritative validation.
2. Lock down Firestore rules so clients cannot perform unauthorized state transitions.
3. Add a one-time migration to backfill old web booking docs missing canonical Android fields (`status`, `phaseId`, `bookingId`, numeric `createdAt`/`expiresAt`).
4. Replace full-collection admin listeners with indexed server-side query strategy where possible.
5. Add integration tests that validate web-created bookings are visible in Android pending query (`status == "pending"`).
