# StudentSeat Booking System (Auth + Profile Flow)

This version adds real Firebase Authentication and user profile flow on top of the seat grid.

## What This Version Does

- Shows a 100-seat grid (1 to 100)
- Uses Firebase Google Sign-In
- Shows logged-in user profile:
  - Name
  - Email
  - WhatsApp number
- On seat click:
  1. If logged out -> asks user to log in
  2. If logged in but phone missing -> asks for WhatsApp number
  3. Saves profile in Firestore `users/{uid}`
  4. Continues seat action
- Loads profile from Firestore on next login so phone prompt is skipped

## Project Files

- `index.html`
- `style.css`
- `app.js`
- `README.md`

## Firebase Services Required

1. Firebase Authentication
2. Cloud Firestore

## Enable Google Sign-In

1. Open Firebase Console.
2. Go to `Authentication` -> `Sign-in method`.
3. Enable `Google`.
4. Add a support email and save.
5. In `Authentication` -> `Settings` -> `Authorized domains`, add:
   - `localhost` (for local testing)
   - `yourusername.github.io` (for GitHub Pages)

## Firestore Profile Structure

Collection:
- `users`

Document:
- `users/{uid}`

Fields saved:
- `name` (string)
- `email` (string)
- `phone` (string)
- `createdAt` (timestamp)

## Required Firestore Rules For Profile Save

If you see `Missing or insufficient permissions`, add rules for `users/{uid}`:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, create, update: if request.auth != null && request.auth.uid == uid;
      allow delete: if false;
    }
  }
}
```

If you already have other rules, merge this block into your existing rules file.

## Seat Click Flow

1. User clicks a seat.
2. If not logged in, login modal opens.
3. After login, profile is loaded from Firestore.
4. If phone is missing, phone modal opens.
5. After phone submit, profile is saved and seat action continues.

## Local Run

Use a local static server (recommended):

```bash
python -m http.server 8000
```

Then open:

```txt
http://localhost:8000
```

## Deploy to GitHub Pages

1. Push files to GitHub repository.
2. Go to repository `Settings` -> `Pages`.
3. Select:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/ (root)`
4. Save and wait for deployment.

## Security Notes

- This app uses Firebase Web SDK only.
- Do NOT use Firebase Admin SDK in frontend code.
- Do NOT expose any service account JSON in this project.
