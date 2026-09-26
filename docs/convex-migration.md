# Firebase → Convex Migration

## Architecture

| Layer | Before | After |
|-------|--------|-------|
| Sign-in | Firebase Auth (Google / email) | **Unchanged** — Firebase Auth issues JWT |
| Game data | Firestore + Cloud Functions | **Convex** queries/mutations |
| Realtime | Firestore `onSnapshot` | Convex `watchQuery` |

Convex validates Firebase ID tokens via `convex/auth.config.ts` (project `cmiyc-d170c`).

## Environment variables

### Root (Convex CLI)

```bash
# .env.local
CONVEX_AGENT_MODE=anonymous   # cloud agents only
CONVEX_DEPLOYMENT=...         # set by `npx convex dev`
CONVEX_URL=...                # dev or prod deployment URL
```

Link to your account:

```bash
npx convex login   # samchalissery24bcs41@iiitkottayam.ac.in
npx convex dev     # development deployment
```

### openverse-native

```bash
EXPO_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud
EXPO_PUBLIC_USE_FIREBASE_EMULATORS=false
# Firebase config unchanged (auth only)
```

### solvenseek

```bash
VITE_CONVEX_URL=https://<deployment>.convex.cloud
# Firebase config unchanged (auth only)
```

## Migrated (this PR)

- Convex schema mirroring Firestore collections
- `createOrSyncProfile`, `getMissionState`, `updateTelemetry`, `stopTracking`
- `uploadLocationBatch`, `deleteLocationHistory`
- Realtime profile/game listeners (mobile)
- Realtime seeker telemetry (solvenseek surveillance map)

## Remaining (follow-up PRs)

- `claimArtifact`, `submitPuzzleAnswer` (mobile still falls back to Firestore direct writes)
- `joinTeam`, `assignUser`, admin (`setGameStatus`, `eliminatePlayer`)
- `createBroadcast` + solvenseek broadcast history
- Hider challenges pool (solvenseek `challenges` collection)
- Data migration script: Firestore export → Convex seed
- Remove `@react-native-firebase/firestore` and direct Firestore writes after full cutover
- Deprecate `backend/functions` once parity verified

## Emulator mode

When `EXPO_PUBLIC_USE_FIREBASE_EMULATORS=true`, the mobile app uses the legacy Firebase emulator path (Firestore + callables). Convex is bypassed.
