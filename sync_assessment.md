# Web-Android Synchronization Assessment

## Baseline Gaps Found

1. Critical lifecycle transitions were client-trusted (`request/approve/reject/cancel`) and not backend-authoritative.
2. Web did not support `reviewing` booking lifecycle state.
3. Web phase booking prerequisite used unlock-only logic, not lesson completion pacing.
4. No classroom lesson flow existed (`Concept/Example/Exercise/Reflection`).
5. No sequential lesson gating or reflection persistence existed.
6. No production-safe account deletion orchestration existed on web.
7. `bookedSeats` consistency depended on client transactions only.
8. Expiry relied on client effective-status logic; stale records could remain `pending`.

## Synchronization Changes Applied

1. Added Firebase Functions authority for critical transitions:
   - `createBooking`, `markBookingReviewing`, `approveBooking`, `rejectBooking`, `cancelBooking`
   - `expireStaleBookingsScheduled`, `expireStaleBookingsNow`
   - `reconcileBookingConsistency`
   - `deleteAccountCascade`
2. Preserved canonical booking document identity and field aliases:
   - `bookings/{userId}_{phaseId}`
   - `bookingId/userId/phaseId/phoneNumber/whatsappNumber/createdAt/expiresAt/status`
3. Added `reviewing` lifecycle handling on web admin queue without renaming existing statuses.
4. Added modular lesson system (`learning/lessonCatalog.js`) with required block structure.
5. Added sequential lesson completion flow and reflection capture on web.
6. Added progression synchronization to Firestore:
   - `users/{uid}/progress/{phaseId}`
   - user aggregate updates (`progress`, `completedPhases`)
7. Enforced next-phase booking prerequisite from lesson completion status.
8. Added web account deletion UI wired to backend cascade deletion and auth account removal.
9. Added feature gating UI aligned with progression thresholds (`30/60/100`).

## Remaining Parity Verification Items

1. Confirm Android lesson progress field names exactly match web `users/{uid}/progress/{phaseId}` fields.
2. Confirm Android referral/affiliate query keys used by `deleteAccountCascade` (`userId`, `referrerId`) cover all app variants.
3. Deploy Firestore rules that block direct client writes for booking lifecycle mutation paths.
4. Validate Android admin pending/reviewing query behavior against new `reviewing` state.
