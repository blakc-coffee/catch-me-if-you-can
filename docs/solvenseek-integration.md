# Solvenseek Web ↔ OpenVerse Native Integration

The production web command portal lives at **[https://solvenseek.vercel.app](https://solvenseek.vercel.app)** (source: [tovi-govi/solvenseek](https://github.com/tovi-govi/solvenseek)). It is vendored in this monorepo as a **git submodule** at `solvenseek/`.

The user's local Windows copy (`C:\Users\samjo\OneDrive\Documents\ProjectFiles\solvenseek`) is **not available on the cloud VM**; use the submodule or clone from GitHub.

## Shared Firebase project

| Component | Firebase project | Region |
|-----------|------------------|--------|
| Solvenseek (Vercel) | `cmiyc-d170c` | default |
| openverse-native (APK) | `cmiyc-d170c` | Functions: `asia-south1` |
| backend/ (rules, functions) | `cmiyc-d170c` (prod) / `demo-openverse` (emulator) | `asia-south1` |

## Environment setup

### Web (solvenseek)

```bash
cd solvenseek
cp .env.example .env.local
npm install
npm run dev   # http://localhost:5173
```

Production values are pre-wired in `solvenseek/src/lib/firebase.ts` with `VITE_*` overrides. Deployed site: https://solvenseek.vercel.app

### Mobile (openverse-native)

```bash
cd openverse-native
cp .env.example .env.local
cp google-services.json.example google-services.json   # fill from Firebase Console
npm install
```

| Profile | `EXPO_PUBLIC_USE_FIREBASE_EMULATORS` | Host |
|---------|--------------------------------------|------|
| Production APK | `false` | Firebase `cmiyc-d170c` |
| Android emulator + local web | `true` | `10.0.2.2` (maps to host localhost) |
| USB device + local emulators | `true` | `127.0.0.1` after `adb reverse` |

Start backend emulators from repo root:

```bash
cd backend && npm run emulators
cd backend && npm run seed
```

### One APK for dev + production

Use **EAS preview** profile (`eas.json` sets `EXPO_PUBLIC_USE_FIREBASE_EMULATORS=false`). Switch to emulators only in local `.env.local` dev builds (`expo run:android`), not in the preview APK.

## Data shape compatibility

| Collection | Mobile (seeker) | Solvenseek (surveillance/hider) |
|------------|-----------------|----------------------------------|
| `seekers/{uid}` | Writes lat, lon, x, y, lastPing (epoch ms), zoneId, active | Real-time map listener |
| `game/state` | Reads status, eventId | Game lifecycle |
| `artifacts/{qrCode}` | QR scan → claim | Admin content |
| `broadcasts` | — | Surveillance creates/listens (timestamp + serverEpochMs) |
| `challenges` | — | Hider puzzle pool (solvenseek-specific) |
| `puzzles` / `puzzlePublic` | Seeker case files via mission | Backend canonical puzzle store |

Production mobile currently uses **direct Firestore** paths in `directFirestore.ts` (not callables) when emulators are off. Callable functions remain the hardened path for emulator testing and future production hardening.

## Artifact QR codes

Generate printable codes (offline, no Firestore):

```bash
cd backend/functions && npm run generate:qr
```

Output: `backend/functions/seed-output/artifacts/` (CSV, JSON, PNG per artifact).

Register codes in Firestore:

```bash
cd backend && npm run seed -- --production --project cmiyc-d170c --data ./functions/scripts/seed-data.example.json
```

## Submodule updates

```bash
git submodule update --init --remote solvenseek
```
