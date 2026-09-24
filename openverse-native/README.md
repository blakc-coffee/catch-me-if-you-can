# Openverse Native

The native seeker client is built with Expo SDK 57 and React Native 0.86. It runs offline and stores mission progress and up to 500 recent location samples on the device.

## Included

- Native QR scanning through `expo-camera`
- Foreground and background GPS through `expo-location` and `expo-task-manager`
- Persistent Android foreground-service notification while a mission is tracked
- Offline mission state and location history in AsyncStorage
- Mission, scanner, case-file, and location-control screens

## Run and validate

```bash
npm install
npm run typecheck
npm start
```

Use a development build or release APK for background location. Expo Go cannot run Android background location services.

## Build an APK

Sign in to Expo once, then run:

```bash
npx eas-cli login
npm run build:apk
```

The `preview` profile in `eas.json` produces an installable APK. The `production` profile produces an AAB for Google Play.

## Privacy behavior

The app contains no API endpoint or Firebase configuration. Scanned payloads, solved-case state, and location samples stay on the phone. The tracking screen lets the player stop collection and delete saved route history.
