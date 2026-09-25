# OpenVerse handover

Last updated: 25 September 2026

## Current status

The Android client is a real Expo/React Native application in `openverse-native/`. The Firebase backend is in `backend/` and uses Firebase Authentication, Cloud Firestore, Cloud Functions v2, and the Firebase Emulator Suite.

Development is currently on `wip/firebase-backend`. Do not deploy or merge it into `main` until the Android flow has been tested on an emulator or physical phone. The branch has been pushed to GitHub and is clean.

Recent integration commits:

- `faa9a6e` — Firebase emulator configuration, typed client contract, institutional email enforcement, and security-rule hardening.
- `06ce3b1` — QR claims, puzzle submissions, and queued GPS synchronization connected to Firebase.

`main` has not been changed by this backend work.

## Architecture

```text
React Native Android app
  ├─ Firebase Authentication
  ├─ Callable Cloud Functions
  │    ├─ profile and team management
  │    ├─ artifact claims
  │    ├─ puzzle answers
  │    ├─ game administration
  │    └─ telemetry and location batches
  └─ Cloud Firestore
       ├─ users and teams
       ├─ game content
       ├─ claims and puzzle unlocks
       └─ live and historical location data
```

Firebase project: `seekerdb-9e679`

Android package: `com.openverse.seeker`

Functions region: `asia-south1`

The local emulator project ID is `demo-openverse`. It cannot access or modify production Firebase data.

## Implemented functionality

- Google OAuth login for production builds.
- Development-only email/password login for the Firebase Auth emulator.
- Only verified `@iiitkottayam.ac.in` accounts are accepted by callables and Firestore rules.
- User profile creation and synchronization after authentication.
- Server-authoritative roles and team membership.
- QR scanning through the Android camera.
- Server-side artifact validation and one-claim-per-team enforcement.
- Server-side puzzle-answer validation and scoring.
- Foreground and background Android location collection.
- Offline location queue with idempotent batch uploads.
- Live telemetry updates and remote history deletion.
- Firestore rules that protect puzzle answers, QR identifiers, roles, scores, telemetry, and join codes.
- Typed backend/client callable contract synchronized by `npm run sync:contract`.

The old browser prototypes `openverse-mobile/` and `openverse-web/` are intentionally not tracked. They may remain locally only as visual references.

## Important files

- `openverse-native/App.tsx` — authentication gate and game-flow integration.
- `openverse-native/src/services/firebase/config.ts` — production/emulator switching.
- `openverse-native/src/services/firebase/callables.ts` — typed callable-function client.
- `openverse-native/src/services/firebase/telemetrySync.ts` — offline GPS batch synchronization.
- `openverse-native/src/services/firebase/contract.ts` — generated client contract; do not edit directly.
- `backend/functions/src/shared/contract.ts` — source of truth for callable types.
- `backend/functions/src/index.ts` — exported Cloud Functions.
- `backend/firestore.rules` — Firestore authorization rules.
- `backend/functions/scripts/seed.ts` — emulator accounts and game-data seeding.
- `backend/README.md` — detailed backend model, commands, and deployment checklist.

`openverse-native/google-services.json` is required locally but deliberately ignored by Git. Download it from Firebase Console for the Android app registered as `com.openverse.seeker`.

## Local setup on Windows

Requirements:

- Node.js 22 is preferred. Node 24 currently builds but the Functions emulator reports a version warning.
- Java 21 or newer.
- Android Studio and an Android virtual device, or a USB-connected Android phone.

The machine currently has a working JDK at `C:\Program Files\Java\jdk-21`, but the first `java.exe` on `PATH` is a broken Oracle shim. In each backend terminal, use:

```powershell
$env:Path = 'C:\Program Files\Java\jdk-21\bin;' + $env:Path
```

Install dependencies if needed:

```powershell
cd backend
npm ci

cd ..\openverse-native
npm ci
```

Copy `openverse-native/.env.example` to `openverse-native/.env`. The existing local development copy uses:

```dotenv
EXPO_PUBLIC_USE_FIREBASE_EMULATORS=true
EXPO_PUBLIC_FIREBASE_EMULATOR_HOST=10.0.2.2
EXPO_PUBLIC_EMULATOR_EMAIL=seeker1@iiitkottayam.ac.in
EXPO_PUBLIC_EMULATOR_PASSWORD=openverse-dev
```

`10.0.2.2` is the Android emulator's route to the host computer. Do not use it for a production build.

## Starting the local stack

Terminal 1:

```powershell
cd backend
$env:Path = 'C:\Program Files\Java\jdk-21\bin;' + $env:Path
npm run emulators
```

Terminal 2, after the emulators report ready:

```powershell
cd backend
npm run seed
```

Terminal 3:

```powershell
cd openverse-native
npm run android
```

The emulator UI is at `http://127.0.0.1:4000`. Auth, Firestore, and Functions use ports `9099`, `8080`, and `5001`.

For a USB phone, set `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST=127.0.0.1` and run:

```powershell
adb reverse tcp:9099 tcp:9099
adb reverse tcp:8080 tcp:8080
adb reverse tcp:5001 tcp:5001
```

An EAS cloud-built APK cannot connect to Firebase emulators running only on a developer laptop. Use a local development build for emulator testing.

## Emulator accounts

All accounts use password `openverse-dev`:

| Account | Role/team |
|---|---|
| `seeker1@iiitkottayam.ac.in` | seeker / alpha |
| `seeker2@iiitkottayam.ac.in` | seeker / bravo |
| `hider1@iiitkottayam.ac.in` | hider / ghost |
| `surveillance@iiitkottayam.ac.in` | surveillance |
| `admin@iiitkottayam.ac.in` | admin |

The app's development-only **Use local emulator account** button signs in as `seeker1` by default.

## Verification completed

- React Native TypeScript check: passed.
- Expo Android production bundle: passed.
- Backend build and TypeScript check: passed.
- Backend unit tests: 44/44 passed.
- Firebase emulator tests: 65/65 passed.
- End-to-end emulator flow passed: authentication → profile → team → telemetry → artifact → puzzle.

The Android camera, Google OAuth, and real background-GPS behavior still require an Android device or Android emulator. No device was available at handover time.

## Device test checklist

Before merging, verify:

1. Local emulator login opens the mission screen.
2. Camera permission appears and a seeded QR artifact can be claimed.
3. A decoy QR displays as a decoy without opening a case.
4. The unlocked puzzle shows server-provided text.
5. Incorrect and correct puzzle submissions display correctly.
6. Location permission requests foreground and background access.
7. Android displays the persistent foreground-service notification.
8. Samples collected offline upload after reopening the tracking screen.
9. Stopping tracking hides the live position.
10. Deleting history removes both local and Firestore history.

## Remaining backend work before production

The current implementation is suitable for emulator integration, but these concurrency-hardening items should be completed before a real event:

- Recheck game state inside the telemetry transaction.
- Move all puzzle eligibility and answer checks into the award transaction.
- Read join-code state inside the team-join transaction.
- Recheck administrator and surveillance privileges inside administrative transactions.
- Reconcile removed artifacts and deleted optional fields when reseeding.

After those fixes, rerun all unit and emulator tests and perform a security review of the final branch diff.

## Production rollout plan

1. Complete Android device testing and backend concurrency hardening.
2. Review and merge `wip/firebase-backend` into `main`.
3. Enable the Blaze plan, required for Cloud Functions deployment.
4. Confirm Google Auth, SHA-1, and SHA-256 configuration in Firebase Console.
5. Preview and run the database migration described in `backend/README.md`.
6. Deploy Firestore rules, indexes, and Cloud Functions.
7. Add production teams, puzzles, artifacts, and private join codes.
8. Configure Play Integrity/App Check.
9. Build the APK with emulator mode disabled.
10. Run a small production smoke test before distributing the APK.

Never commit `.env`, `google-services.json`, service-account keys, production puzzle answers, join codes, or generated QR-code exports.
