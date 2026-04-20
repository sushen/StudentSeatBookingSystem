# context.md

## Project Summary
This project is a static single-page seat reservation system for **Shapla Chottor Ai Research Lab**. It manages a fixed set of seats (currently 10) with Google sign-in, user profile capture (including WhatsApp number), real-time seat state updates from Firestore, and an admin approval workflow.

The core problem it solves is preventing seat double-booking in a small-capacity environment while giving admins a review/approve/reject flow before final confirmation.

## Tech Stack
- **Frontend:** Vanilla JavaScript (ES modules), HTML, CSS
- **Backend services used:** Firebase Authentication (Google provider), Cloud Firestore
- **SDK loading:** Firebase Web SDK v10.12.5 loaded dynamically from Google CDN at runtime
- **Browser APIs:** SpeechSynthesis (voice alerts), Clipboard API, popup auth, visibility/user-interaction listeners
- **Other external integration:** Meta Pixel script in `index.html`
- **Deployment model:** Static hosting (no server code in repo)

## Architecture
- `index.html`: Full UI shell (auth buttons, seat grid, profile card, login/in-app/phone modals, admin table, test voice button).
- `app.js`: Main application controller. Handles state, Firebase bootstrap, auth flow, Firestore reads/writes, seat rendering, timer expiry, admin actions, and modal orchestration.
- `inAppBrowserDetection.js`: User-agent based detection/classification for embedded browsers; generates platform-specific guidance and Android intent URL.
- `sound-engine/soundEngine.js`: Speech engine with deferred queueing, dedupe memory, unlock-by-user-interaction handling, and admin-only speaking mode.
- `sound-engine/seatNotificationUtils.js`: Detects new pending-seat events between snapshots and builds stable event/message payloads.

Architecture style is client-heavy: all business rules are executed in browser code, with Firestore transactions used as the primary consistency mechanism.

## Features Implemented
- Google login/logout with Firebase Auth popup flow.
- Embedded/in-app browser guard that blocks login in known unsupported user-agent contexts and shows "open in browser" guidance.
- User profile load/save in Firestore at `users/{uid}`.
- Phone requirement flow: seat booking pauses until WhatsApp number is saved.
- Real-time seat sync via Firestore `onSnapshot`.
- Seat rendering with statuses:
  - `available` (clickable)
  - `pending` (locked with countdown)
  - `confirmed` (locked)
  - visual "your seat" highlighting for signed-in holder
- Transactional hold logic (`available -> pending`) with checks:
  - target seat must still be available
  - same user cannot hold another pending/confirmed seat
- Admin panel (visible only for configured admin email) with:
  - pending-seat table
  - approve (`pending -> confirmed`)
  - reject (`pending -> available` and clear holder metadata)
- 15-minute hold countdown and auto-expiry back to available (frontend timer + Firestore transaction).
- Admin-only voice notifications for newly pending seats, plus manual "Test Voice Alert" button.

## Data Model
### Firestore Collections
- `users/{uid}`
  - `name` (string)
  - `email` (string)
  - `phone` (string)
  - `createdAt` (timestamp; written with merge on save)

- `seats/{seatId}` where seat IDs are hardcoded in code as:
  - `seat_001` ... `seat_010`
  - Fields normalized/used by app:
    - `seatId` (string)
    - `seatNumber` (number)
    - `status` (`available | pending | confirmed`)
    - `heldBy` (uid or null)
    - `heldByName` (string or null)
    - `heldByEmail` (string or null)
    - `heldByPhone` (string or null)
    - `holdStartTime` (timestamp or null)
    - `approvedBy` (uid or null)
    - `approvedAt` (timestamp or null)

### State Transitions
- `available -> pending`: user booking transaction succeeds.
- `pending -> confirmed`: admin approve transaction.
- `pending -> available`: admin reject or hold-expiry transaction.
- `confirmed`: terminal in current code (no UI path back to available).

## Core Logic
- **Booking transaction:** reads all configured seat docs and blocks booking if user already owns any `pending`/`confirmed` seat; then sets target seat to `pending` with holder metadata and `holdStartTime`.
- **Admin approve transaction:** validates seat still `pending`, sets `status=confirmed`, `approvedBy`, `approvedAt`, and clears `holdStartTime`.
- **Admin reject transaction:** resets seat payload to an "available" template and clears holder/approval fields.
- **Expiry loop:** local `setInterval` every second when pending seats exist; expired pending seats are reverted through transaction; concurrency guard via `expiringSeatIds`.
- **Real-time source of truth:** UI always rebuilt from snapshot-normalized seat data.
- **Notification logic:** compares previous and current snapshots to detect new `pending` events and speaks one-time admin alerts with dedupe event IDs.

## Limitations
- Security and trust boundaries are not production-safe:
  - admin role check is client-side email comparison
  - hold expiry is client-driven timer logic
  - critical transitions are initiated from frontend code
- Firestore security rules are not stored/enforced in this repository.
- Firebase config and admin email are hardcoded in frontend source.
- Seat query is hardcoded to fixed IDs and uses `where(documentId(), "in", SEAT_DOC_IDS)`; this is not a scalable seat-loading design.
- Booking transaction reads every configured seat document to enforce one-seat-per-user; this grows linearly and becomes costly as seat count increases.
- No backend audit/event log for approvals/rejections/expiries.
- No automated tests (unit/integration/e2e), no CI validation, and no typed contracts.
- README data setup is inconsistent with code (README references `SID001...SID010`, code expects `seat_001...seat_010`).

## Missing / TODO
- Replace placeholder Firebase config ownership/process with environment-specific configuration strategy.
- Move reservation lifecycle enforcement to trusted backend execution.
- Implement explicit role model (custom claims) rather than client-side email check.
- Add durable audit trail for admin actions and expiry events.
- Add user-initiated release/cancel flow for pending seats.
- Add robust seat provisioning/migration scripts and validation checks.
- Add tests for booking race conditions, role enforcement, expiry behavior, and in-app browser handling.
- Reconcile/clean README and operational docs so setup instructions match actual seat IDs and query behavior.

## Recommended Next Steps
1. Build a backend reservation service (Cloud Functions or equivalent) for `hold`, `approve`, `reject`, and `expire` actions; make frontend call these endpoints instead of directly performing critical Firestore transitions.
2. Define and deploy strict Firestore rules aligned with backend ownership, including admin custom claims and transition-level validation (who can move which status and when).
3. Redesign seat loading/modeling for scale: remove hardcoded `in` query dependency and fixed doc ID list; support dynamic inventory and partitioned reads.
4. Replace frontend-only expiry with scheduled backend expiry processing (plus idempotent rechecks), keeping UI timer as display-only.
5. Add reliability layer: structured logs, audit collection, test suite for transaction contention/edge cases, and CI checks before deploy.
