# Openverse Architecture & Technical Overview

## 1. System Architecture

Openverse Seeker ("Catch Me If You Can") is a multi-part Alternate Reality Game (ARG) platform designed for live campus scavenger operations:

```text
                    OPENVERSE SYSTEM

        ┌───────────────────────────────┐
        │       Android Mobile App      │
        │      (openverse-native)       │
        │                               │
        │  • Google Auth (@iiitkottayam)│
        │  • Mission HUD                │
        │  • QR Scanner                 │
        │  • Decryption / Puzzles       │
        │  • Background GPS Collection  │
        │  • Scoped Offline Queue       │
        └───────────────┬───────────────┘
                        │ Authenticated Callables &
                        │ Firestore Telemetry Batches
                        ▼
        ┌───────────────────────────────┐
        │       FIREBASE BACKEND        │
        │           (backend/)          │
        │                               │
        │  • Cloud Functions (asia-south1)
        │  • Cloud Firestore            │
        │  • Role & Claim Authority     │
        │  • Puzzle Validation & Lockout│
        │  • Rate Limiting & Geo Bounds │
        └───────────────┬───────────────┘
                        │ Live Queries & Indexes
                        ▼
        ┌───────────────────────────────┐
        │      EXISTING WEBSITE         │
        │                               │
        │  • Location Visualization     │
        │  • Live Seeker Radar          │
        │  • Admin / Surveillance HUD   │
        └───────────────────────────────┘
```

---

## 2. Component Breakdown

### A. Android Mobile App (`openverse-native`)
- **Framework:** React Native `0.86.3` with Expo SDK `~57.0.0` and React `19.2.3` using Expo Development Client (`expo-dev-client`).
- **Authentication:** `@react-native-firebase/auth` and `@react-native-google-signin/google-signin` enforcing `@iiitkottayam.ac.in` verified domain accounts.
- **Hardware Integration:**
  - `expo-camera`: `CameraView` with debounce scan locks, torch toggle, and QR validation.
  - `expo-location` & `expo-task-manager`: Android foreground service running task `openverse-background-location`.
- **Session & Offline Queue:**
  - `localStore.ts`: Namespaces game progress and queued coordinates by Firebase UID and `eventId` (`openverse.scoped.<uid>.<eventId>`).
  - `telemetrySyncCore.ts`: FIFO batch upload (up to 200 samples/batch) to `uploadLocationBatch` and live position sync via `updateTelemetry`. Samples are purged only upon server confirmation.

### B. Firebase Backend (`backend/`)
- **Project ID:** `seekerdb-9e679` (Functions Region: `asia-south1`).
- **Callable Cloud Functions:**
  - `createOrSyncProfile`: Verifies `@iiitkottayam.ac.in` domain and mirrors claims.
  - `getMissionState`: Provides team progress, total active artifacts, and unlocked puzzles (without answers).
  - `claimArtifact`: Enforces one claim per team per artifact, handles decoys, and unlocks puzzle IDs.
  - `submitPuzzleAnswer`: Validates answers server-side within transactions to ensure first-solve lockouts.
  - `updateTelemetry`: Updates `seekers/{uid}` live coordinates with plausibility checks and speed/jump rate limiting.
  - `uploadLocationBatch`: Stores compressed route histories under `locationBatches` with automatic TTL expiration.
  - `stopTracking` & `deleteLocationHistory`: Hides live radar position and permanently erases player history.

### C. Website / Admin Radar Integration
- The administrative website reads directly from Firestore:
  - `seekers/{uid}`: Live radar tracking for active seekers (indexed by `active, lastPing desc`).
  - `locationBatches`: Route history for surveillance and playback.
  - `teams/{teamId}`: Scores, token balances, and claim progress.
  - `broadcasts`: Global ping snapshots visible to surveillance.

---

## 3. Directory Layout

```
catch-me-if-you-can/
├── backend/
│   ├── firebase.json               # Emulators & deployment config
│   ├── firestore.rules             # Security rules restricting client writes
│   ├── firestore.indexes.json      # Composite indexes for live radar
│   ├── scripts/                    # Sync contract & deployment scripts
│   └── functions/
│       ├── src/
│       │   ├── artifacts/          # claimArtifact
│       │   ├── auth/               # createOrSyncProfile, assignUser
│       │   ├── game/               # getMissionState, setGameStatus
│       │   ├── puzzles/            # submitPuzzleAnswer, puzzlePublic mirror
│       │   ├── teams/              # joinTeam
│       │   └── telemetry/          # updateTelemetry, uploadLocationBatch
│       └── test/                   # Unit & emulator test suites
└── openverse-native/
    ├── App.tsx                     # Main state machine, auth gate, startup phases
    ├── index.ts                    # Root entrypoint registering background task
    ├── firebase.json               # USB Android emulator bypass
    ├── src/
    │   ├── components/             # AppShell, Primitives (pixel-preserved)
    │   ├── screens/                # Login, Mission, Scanner, Case, Tracking
    │   ├── services/
    │   │   ├── firebase/           # Typed callables, contract, emulator config
    │   │   └── session/            # Scoped store, session guard, telemetry sync
    │   ├── theme.ts                # UI design tokens
    │   └── types.ts                # TypeScript interfaces
    └── scripts/
        └── verify-bundle.mjs       # Static scan preventing secret leakage
```

---

## 4. Verification & Testing

### Mobile App (`openverse-native`)
```bash
# Typecheck
npm run typecheck

# Run unit & session tests (84 tests across 9 suites)
npm test

# Verify production Android bundle (ensures no bundled answers/secrets)
npm run verify:bundle
```

### Backend (`backend`)
```bash
# Typecheck functions
npm run typecheck

# Run backend unit tests (63 tests across 7 suites)
npm run test:unit

# Synchronize client-server contract
npm run sync:contract
```
