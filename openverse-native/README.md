# Openverse Native

The native seeker client is built with Expo SDK 57 and React Native 0.86 and talks to the Firebase backend in `../backend` (Auth, Firestore, callable Cloud Functions, App Check).

## Included

- Google sign-in (plus a development-only emulator account button) and a sign-out action on the location screen
- Native QR scanning through `expo-camera`; claims are validated by the `claimArtifact` callable
- Server-backed mission screen (`getMissionState`): team, artifacts claimed / total, score, tokens and case files — nothing is shown until the server answers
- Case files for every puzzle the team unlocked, reopenable at any time; puzzle text comes only from the server
- Foreground and background GPS through `expo-location` and `expo-task-manager`, with an offline queue that syncs to Firebase
- Persistent Android foreground-service notification while a mission is tracked

## Run and validate

```bash
npm install
npm run typecheck
npm test                 # session, storage, mission and case logic
npm run verify:bundle    # production Android export + scan for puzzle answers/clues
npm start
```

Use a development build or release APK for background location. Expo Go cannot run Android background location services. See `../backend/README.md` for running against the Firebase emulators.

## Build an APK

Sign in to Expo once, then run:

```bash
npx eas-cli login
npm run build:apk
```

The `preview` profile in `eas.json` produces an installable APK. The `production` profile produces an AAB for Google Play.

## Privacy and security behavior

- No puzzle answers or answer clues are bundled; `npm test` and `npm run verify:bundle` fail if one reappears.
- Progress and queued location samples are stored per Firebase account and game event. Sign-out or an account change stops tracking and deletes the previous account's local data.
- Tracking runs only while the signed-in user is an active seeker on a team in a live game, and stops automatically on pause, game end, elimination, suspension or role/team loss.
- The location screen lets the player stop collection, delete saved route history (on the phone and in Firebase), and sign out.
