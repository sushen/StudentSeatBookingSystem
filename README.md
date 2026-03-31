# Shapla Chottor Ai Research Lab (Firestore 10-Seat Flow)

This version keeps your existing Firebase Auth + WhatsApp profile flow and moves seat state to Firestore for **10 real seats**.

## What This Version Includes

- Google login with Firebase Authentication
- User profile save/load in Firestore: `users/{uid}`
- Seat data loaded from Firestore in real-time using `onSnapshot`
- Transaction-based seat hold (`pending`) for safety
- 15-minute countdown timer for pending seats
- Auto-expire pending seats back to available (frontend-driven demo logic)
- Admin-ready seat fields for future approve/reject flow

## Firestore Paths Used

- `users/{uid}`
- `seats/{seatId}`

## 10-Seat Setup

Create these 10 documents in collection `seats`:

- `SID001`
- `SID002`
- `SID003`
- `SID004`
- `SID005`
- `SID006`
- `SID007`
- `SID008`
- `SID009`
- `SID010`

Each seat document should support:

- `seatId` (string)
- `seatNumber` (number)
- `status` (string): `available | pending | confirmed`
- `heldBy` (string or null)
- `heldByName` (string or null)
- `heldByEmail` (string or null)
- `heldByPhone` (string or null)
- `holdStartTime` (timestamp or null)
- `approvedBy` (string or null)
- `approvedAt` (timestamp or null)

Minimal starter value is valid too:

```json
{
  "status": "available"
}
```

The app safely fills missing fields in UI.

## How Booking Works

1. User clicks an available seat.
2. If logged out, login is required.
3. If WhatsApp number is missing, phone modal is shown and profile is saved to `users/{uid}`.
4. App runs a Firestore transaction:
   - checks target seat is still `available`
   - checks user does not already hold `pending` or `confirmed` seat
   - updates seat to `pending` with user info and `holdStartTime`
5. UI updates in real-time via `onSnapshot`.

## Timer Behavior (15 Minutes)

- Countdown is shown on seats with `status = pending`.
- After 15 minutes, pending seat is reset to `available`.
- Reset clears:
  - `heldBy`
  - `heldByName`
  - `heldByEmail`
  - `heldByPhone`
  - `holdStartTime`
  - `approvedBy`
  - `approvedAt`

Important:

- Expiry in this version is done from frontend JavaScript for testing UX.
- This is not fully secure for production. In production, expiry should be enforced by trusted backend logic.

## Scaling from 10 Seats to 100

In `app.js`, update:

```js
const SEAT_DOC_IDS = Array.from({ length: 10 }, (_, index) =>
  `SID${String(index + 1).padStart(3, "0")}`
);
```

To 100:

```js
const SEAT_DOC_IDS = Array.from({ length: 100 }, (_, index) =>
  `SID${String(index + 1).padStart(3, "0")}`
);
```

Then create matching documents `SID001` to `SID100` in Firestore.

## Firebase Setup

1. Open Firebase Console -> your project.
2. Enable Authentication -> Google provider.
3. Create Firestore database.
4. In `Authentication -> Settings -> Authorized domains`, add every domain where you host the app.
5. Paste your Firebase web config in `app.js`.

For GitHub Pages, add your GitHub host only (no protocol/path), for example:

```txt
sushen.github.io
```

## Starter Firestore Rules (Example)

Copy exactly from `rules_version` line:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, create, update: if request.auth != null && request.auth.uid == uid;
      allow delete: if false;
    }

    match /seats/{seatId} {
      allow read: if true;

      // Starter rule for demo flow (not production-hard).
      allow create, update: if request.auth != null && (
        // User can write pending seat for self
        (request.resource.data.status == "pending" &&
         request.resource.data.heldBy == request.auth.uid) ||
        // User can release their own seat back to available
        (request.resource.data.status == "available" &&
         resource.data.heldBy == request.auth.uid) ||
        // Admin override for review actions
        request.auth.token.email == "sushen.biswas.aga@gmail.com"
      );
    }
  }
}
```

Note:

- This is a practical starter rule set for testing.
- Tight production rules usually require stricter validation and/or server-side control.

## Run Locally

Use any static server:

```bash
python -m http.server 8000
```

Open:

```txt
http://localhost:8000
```

## Deploy to GitHub Pages

1. Push files to your GitHub repository.
2. Go to `Settings -> Pages`.
3. Select:
   - Source: `Deploy from a branch`
   - Branch: `main` (or your default branch)
   - Folder: `/ (root)`
4. Save.

## Security Notes

- Uses Firebase Web SDK only.
- No Firebase Admin SDK in frontend.
- No service account JSON in this project.
