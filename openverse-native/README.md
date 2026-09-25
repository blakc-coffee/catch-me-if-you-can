# Openverse Native

The native seeker client is built with Expo SDK 57 and React Native 0.86. It authenticates with Firebase, sends game actions through callable Cloud Functions, and queues location samples on-device while offline for later upload.

## Included

- Native QR scanning through `expo-camera`
- Foreground and background GPS through `expo-location` and `expo-task-manager`
- Persistent Android foreground-service notification while a mission is tracked
- Offline mission state and a bounded location upload queue in AsyncStorage
- Mission, scanner, case-file, and location-control screens
- Firebase emulator support for local integration testing

## Run and validate

```bash
npm install
npm run typecheck
npm start
```

Use a development build or release APK for background location. Expo Go cannot run Android background location services.

## Local Firebase integration

Copy `.env.example` to `.env`. For the Android emulator, use:

```dotenv
EXPO_PUBLIC_USE_FIREBASE_EMULATORS=true
EXPO_PUBLIC_FIREBASE_EMULATOR_HOST=10.0.2.2
EXPO_PUBLIC_EMULATOR_EMAIL=seeker1@iiitkottayam.ac.in
EXPO_PUBLIC_EMULATOR_PASSWORD=openverse-dev
```

`10.0.2.2` is the Android emulator's route to the host computer. Never enable emulator mode in a production build.

Start the backend emulators and seed data in separate terminals before running `npm run android`:

```powershell
cd backend
$env:Path = 'C:\Program Files\Java\jdk-21\bin;' + $env:Path
npm run emulators
```

```powershell
cd backend
npm run seed
```

The Emulator Suite UI is at `http://127.0.0.1:4000`. Auth, Firestore, and Functions use ports `9099`, `8080`, and `5001`.

For a USB phone, set `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST=127.0.0.1` and forward the ports:

```powershell
adb reverse tcp:9099 tcp:9099
adb reverse tcp:8080 tcp:8080
adb reverse tcp:5001 tcp:5001
```

An EAS cloud-built APK cannot reach emulators running only on a developer laptop. Use a local development build for emulator testing.

## Build an APK

Sign in to Expo once, then run:

```bash
npx eas-cli login
npm run build:apk
```

The `preview` profile in `eas.json` produces an installable APK. The `production` profile produces an AAB for Google Play.

## Privacy behavior

Scanned payloads and game actions are validated by the backend. Live telemetry and queued route-history batches are sent to Firestore through authenticated callable functions. The tracking screen lets the player stop collection and delete both local and server-side route history. Server history expires through the configured Firestore TTL policy.

## Verification status

- React Native TypeScript check: passed.
- Expo Android production bundle: passed.
- Backend build and TypeScript check: passed.
- Backend unit tests: 44 passed.
- Firebase emulator and end-to-end tests: 66 passed.

Camera behavior, Google OAuth, and real background GPS still require an Android device or Android emulator.

Never commit `.env`, `google-services.json`, service-account keys, production puzzle answers, join codes, or generated QR-code exports.
