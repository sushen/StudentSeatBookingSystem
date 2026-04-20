# Shapla Chottor AI Research Lab (Web)

This web app now follows the same phase + booking model as the mobile app.

## Canonical Phase Catalog

The app always shows a fixed 6-phase journey (with Firestore override support):

1. `phase1` - Foundations (Beginner)
2. `phase2` - Data Analysis (Beginner)
3. `phase3` - Object-Oriented Programming (Intermediate)
4. `phase4` - System Design (Intermediate)
5. `phase5` - Simulation & Data Systems (Advanced)
6. `phase6` - Production Engineering (Advanced)

If Firestore `phases` is empty or missing items, the web app uses this default catalog automatically.

## Firestore Collections

- `users`
- `phases`
- `bookings`

### `bookings/{userId}_{phaseId}`

```json
{
  "bookingId": "uid_phase1",
  "id": "uid_phase1",
  "userId": "uid",
  "uid": "uid",
  "phaseId": "phase1",
  "phase": "phase1",
  "phaseKey": "phase1",
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
  "createdAt": "timestamp",
  "updatedAtMs": 1713600000000,
  "updatedAt": "timestamp",
  "source": "web",
  "expiresAt": "timestamp"
}
```

Supported booking statuses:

- `pending`
- `approved`
- `rejected`
- `cancelled`
- `expired`

Compatibility note:

- The web app writes both canonical and legacy-compatible fields (`status/requestStatus/bookingStatus`, `userId/uid`, `phaseId/phase`) so older mobile parsers can still read pending bookings.

## User Booking Behavior

- Google login is required for booking.
- A phase can be booked only when:
  - previous phase is unlocked (progressive path lock),
  - seats are available,
  - there is no active pending/approved booking for that phase.
- If a pending booking expires, the user can request again.
- UI uses Beginner / Intermediate / Advanced tabs, like the mobile view.

## Admin Behavior

Admin email: `sushen.biswas.aga@gmail.com`

Admin panel has two tabs:

- `Pending`: approve or reject new requests.
- `All Bookings`: view all statuses and cancel approved seats.

Actions:

- **Approve**
  - booking -> `approved`
  - phase `bookedSeats` +1
  - user `unlockedPhases` `arrayUnion(phaseId)`
- **Reject**
  - booking -> `rejected`
- **Cancel Seat**
  - booking -> `cancelled`
  - phase `bookedSeats` -1 (never below 0)
  - user `unlockedPhases` `arrayRemove(phaseId)`
