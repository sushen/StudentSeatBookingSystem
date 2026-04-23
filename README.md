# Shapla Chottor AI Research Lab (Web)

This web app uses the same phase + booking contract as the Android app.

## Canonical Phase Catalog

The UI always supports this 6-phase flow (Firestore `phases` can override details):

1. `phase1` - Foundations (Beginner)
2. `phase2` - Data Analysis (Beginner)
3. `phase3` - Object-Oriented Programming (Intermediate)
4. `phase4` - System Design (Intermediate)
5. `phase5` - Simulation & Data Systems (Advanced)
6. `phase6` - Production Engineering (Advanced)

## Firestore Collections

- `users`
- `phases`
- `bookings`

## Android Compatibility Contract

Web-created booking docs are written to:

- collection: `bookings`
- document id: `bookingId = "${userId}_${phaseId}"`

Required primary fields (must exist and be correct):

- `bookingId`
- `userId`
- `phaseId`
- `phoneNumber`
- `whatsappNumber`
- `createdAt`
- `expiresAt`
- `status`

Status values are lowercase only:

- `pending`
- `approved`
- `rejected`
- `cancelled`
- `expired`

New web booking writes `status: "pending"`.

## Booking Document Shape (`bookings/{userId}_{phaseId}`)

```json
{
  "bookingId": "uid_phase1",
  "id": "uid_phase1",
  "userId": "uid",
  "uid": "uid",
  "phaseId": "phase1",
  "phase": "phase_1",
  "phaseKey": "phase_1",
  "phaseCanonicalId": "phase1",
  "phaseLegacyId": "phase_1",
  "phaseIdAliases": ["phase1", "phase_1"],
  "userName": "Display Name",
  "name": "Display Name",
  "userEmail": "user@example.com",
  "email": "user@example.com",
  "phone": "+880...",
  "whatsapp": "+880...",
  "phoneNumber": "+880...",
  "whatsappNumber": "+880...",
  "status": "pending",
  "requestStatus": "pending",
  "bookingStatus": "pending",
  "createdAtMs": 1713600000000,
  "createdAt": 1713600000000,
  "updatedAtMs": 1713600000000,
  "updatedAt": 1713600000000,
  "source": "web",
  "expiresAtMs": 1713600900000,
  "expiresAt": 1713600900000
}
```

Notes:

- `phaseId` is canonical (`phase1`, not `phase_1`).
- Alias fields are still written for backward compatibility (`id`, `uid`, `phase`, `phaseKey`, `requestStatus`, `bookingStatus`).
- Web admin pending view is intentionally aligned with Android behavior: pending means `status == "pending"` (and not expired by local effective-status check).

## User Booking Behavior

- Google login is required.
- User must provide `phoneNumber` and `whatsappNumber`.
- Booking is allowed only when:
  - previous phase prerequisite is satisfied,
  - phase has available seats,
  - no active pending/approved booking exists for that phase.
- Pending booking window is 15 minutes (`createdAt` + 15 min).

## Admin Behavior

Admin email in web app:

- `sushen.biswas.aga@gmail.com`

Admin tabs:

- `Pending`: approve/reject pending requests
- `All Bookings`: inspect all statuses and cancel approved bookings

Actions:

- **Approve**
  - booking `status` -> `approved`
  - phase `bookedSeats` +1
  - user `unlockedPhases` `arrayUnion(phaseId)`
- **Reject**
  - booking `status` -> `rejected`
- **Cancel Seat**
  - booking `status` -> `cancelled`
  - phase `bookedSeats` -1 (not below 0)
  - user `unlockedPhases` `arrayRemove(phaseId)`

## Privacy Policy

- [`PRIVACY_POLICY.md`](./PRIVACY_POLICY.md)
