# OpenVerse Firebase backend

Firebase Auth + Cloud Firestore + Cloud Functions (v2, TypeScript) for the OpenVerse seeker app (`openverse-native`) and command portal (`openverse-web`). It is built on the **existing seekerdb schema** (`users`, `teams`, `artifacts`, `puzzles`, `areas`) in project **`seekerdb-9e679`**.

```
Android app ──► Firebase Auth ──► Callable Cloud Functions ──► Cloud Firestore
Web portal  ──► Firebase Auth ──────── realtime listeners ───► Cloud Firestore
Admins      ──► Firebase console / client SDK ──► content: teams, artifacts, puzzles, areas
```

All game state changes go through callable functions: roles, teams, scores, tokens, claims, solves, telemetry and broadcasts. Each function authenticates the caller, validates input, re-checks role/team from Firestore, rate-limits, and uses server timestamps. Security rules keep the existing content model: admins still edit teams, artifacts, puzzles and areas from the client. Everything else is server-owned.

## Layout

```
backend/
├── firebase.json              emulator ports, functions source, rules/indexes paths
├── .firebaserc                project binding (git-ignored); .firebaserc.example is the template
├── firestore.rules            rules for the existing collections + server-owned ones
├── firestore.indexes.json     composite indexes, TTL policies, index exemptions
├── package.json               firebase-tools + emulator/test/deploy/seed/migrate scripts
├── scripts/sync-contract.mjs  copies the client contract into openverse-native
└── functions/
    ├── src/
    │   ├── index.ts           exports every function
    │   ├── config.ts          region, defaults, limits, rate limits, App Check switch
    │   ├── models.ts          Firestore document types (existing vs added fields)
    │   ├── shared/contract.ts request/response types + error reasons (copied to clients)
    │   ├── lib/               auth context, validation, errors, rate limiting, hashing, campus geo
    │   ├── auth/              createOrSyncProfile, assignUser
    │   ├── teams/             joinTeam
    │   ├── game/              setGameStatus, eliminatePlayer
    │   ├── telemetry/         updateTelemetry, stopTracking, uploadLocationBatch, deleteLocationHistory
    │   ├── artifacts/         claimArtifact
    │   ├── puzzles/           submitPuzzleAnswer, onPuzzleWritten (answer-free mirror)
    │   └── broadcasts/        createBroadcast
    ├── scripts/               seed.ts, seedGame.ts, migrate.ts, grant-admin.ts, adminApp.ts, seed-data.example.json
    └── test/
        ├── unit/              validation, normalization, rate limits, geo, contract sync
        └── emulator/          security rules, handlers, end-to-end callables + trigger
```

## Data model

### Existing collections (unchanged field names)

| Collection | Existing fields | Added by functions | Client access |
|---|---|---|---|
| `users/{uid}` | `name`, `email`, `role`, `teamId`, `createdAt`, `updatedAt` | `playerId`, `status`, `score`, `eliminationTokens`, `lastSeenAt` | read: owner, surveillance, admin · update: owner/admin may change **only `name`** |
| `teams/{teamId}` | `name`, `type` (`seeker`\|`hider`), `createdAt` | `score`, `tokens`, `artifactsClaimed`, `puzzlesSolved` | read: signed-in · write: admin (**not** the counters) |
| `artifacts/{qrCode}` | `qrCode`, `qrType` (`correct`\|`wrong`), `name`, `description`, `areaId`, `puzzleId`, `redirectUrl`, `isActive`, `createdAt` | optional `points` (default 25) | read: admin, surveillance · write: admin |
| `puzzles/{id}` | `title`, `question`, `answer`, `createdAt` | optional `points` (100), `tokensAwarded` (1), `hints`, `audience` (default `["seeker"]`) | **admin only** (it holds answers) |
| `areas/{id}` | `name`, `description`, `createdAt` | — | read: signed-in · write: admin |

Roles are lower-case: `seeker`, `hider`, `surveillance`, `admin`. An `answer` may list alternatives separated by `|`. Submissions are matched after normalization: Unicode NFKC, lower-case, and trimmed/collapsed whitespace.

### Added collections (server-owned; clients never write)

| Collection | Contents | Client read access |
|---|---|---|
| `game/state` | `status` (`draft`/`active`/`paused`/`ended`), telemetry interval, broadcast cooldown, retention | signed-in |
| `seekers/{uid}` | **latest** live telemetry only | owner; admin; surveillance when `active == true` |
| `seekers/{uid}/locationBatches/{batchId}` | route history in batches (TTL) | owner; admin |
| `artifactClaims/{teamId_hash(qrCode)}` | one claim per team per artifact | own team; staff |
| `puzzleUnlocks/{teamId_puzzleId}` | created when a team claims an artifact with a `puzzleId` | own team; staff |
| `puzzlePublic/{puzzleId}` | answer-free copy of `puzzles/{id}` + solve state, kept in sync by `onPuzzleWritten` | seekers after their team's unlock; hiders if `hider` ∈ audience; staff |
| `puzzleClaims/{puzzleId}` | the single winning solve (first-solve lockout across teams) | own team; staff |
| `broadcasts/{id}` | seeker-position snapshots | hider, surveillance, admin |
| `teamJoinCodes/{sha256}` · `rateLimits/{key}` | hashed team codes, throttle state | **nobody** |

### Roles, teams and claims

- **`users/{uid}` is the authority for `role` and `teamId`.** Functions and security rules read this document, so revoked privileges take effect without waiting for an ID-token refresh. Claims are retained as a client convenience only.
- Every account must have a verified `@iiitkottayam.ac.in` email. The callable boundary and Firestore rules enforce the same policy.
- **Functions re-read the users doc on every call.** A change takes effect immediately, not when the client's token refreshes.
- **`createOrSyncProfile` keeps claims in sync.** It re-mirrors the claims at sign-in and returns `claimsUpdated`. The app also refreshes its token whenever it sees the users doc change.
- **New sign-ups are `seeker` with no team.** A player gets a team in one of two ways:
  - `joinTeam` with an organiser-issued code. Codes are stored hashed and limited to 10 tries per 15 minutes, and the player's role becomes the team's `type`.
  - an admin calls **`assignUser`** (role and/or team; the role must match the team type).
  - Clients can't change `role` or `teamId` directly, not even admins.
- **Unknown role strings in old data are treated as `seeker`**, never anything higher.

### Callables (region `asia-south1`)

| Callable | Who | Notes / throttle |
|---|---|---|
| `createOrSyncProfile` | any signed-in, non-anonymous | create or backfill profile; mirror claims · 20/min |
| `assignUser` | admin | set role/team (not own role) · 60/min |
| `joinTeam` | seeker/hider (not staff) | hashed code; role := team type · 10/15 min |
| `setGameStatus` | admin | creates `game/state` if missing; `ended` deactivates all live telemetry |
| `eliminatePlayer` | surveillance, admin | idempotent |
| `updateTelemetry` | active seeker on a team, game active | server derives zone/x/y; **1 per `telemetryMinIntervalSec`** (10 s) |
| `stopTracking` | any | hides own live position · 30/min |
| `uploadLocationBatch` | seeker (also after elimination/end) | ≤500 samples, ≤128 KiB; idempotent `batchId` (`DUPLICATE` / `BATCH_ID_CONFLICT`) · 30/min |
| `deleteLocationHistory` | owner | erases all own batches · 5/hour |
| `claimArtifact` | active seeker on a team, game active | looks up `artifacts/{payload}`; `wrong` → `DECOY` + `redirectUrl`; `correct` → one claim per team, unlocks `puzzleId` · 30/min |
| `submitPuzzleAnswer` | seeker (team unlock required) or hider (`hider` ∈ audience) | server compares with `puzzles/{id}.answer`; transaction on `puzzleClaims/{id}` gives exactly one winning team · 10/min per puzzle, 60/min overall |
| `createBroadcast` | surveillance, admin | reads live `seekers/*` in the same transaction as the cooldown (600 s) |
| `onPuzzleWritten` (trigger) | — | mirrors `puzzles/{id}` → `puzzlePublic/{id}` without `answer` |

Every callable also:
- caps the request at 4 KiB, except `uploadLocationBatch` (128 KiB);
- rejects unknown fields;
- returns a typed `details.reason` on errors;
- replaces unexpected errors with a generic `INTERNAL`.

**Note on QR codes:** in this schema the printed QR value *is* the artifact document ID. Rules hide artifact documents from seekers, and `claimArtifact` allows 30 attempts a minute. Guessable codes like `QR-KEY-001` are still weak, so for the real event print long random codes: the seed script generates `OV-` plus 16 random characters.

## Local development (Emulator Suite)

**Prerequisites:** Node 22+ and **Java 21+**, which the Firestore emulator requires.

```bash
cd backend
npm install                 # also installs functions/
npm run emulators           # auth:9099 firestore:8080 functions:5001 ui:4000
npm run seed                # in another terminal: teams, areas, puzzles, 15 artifacts + 2 decoys, dev accounts
```

`npm run seed` prints the following, all for the emulator:
- **Dev accounts**, password `openverse-dev`: `admin@`, `surveillance@`, `hider1@` (team ghost), `seeker1@` (team alpha) and `seeker2@iiitkottayam.ac.in` (team bravo).
- **Team codes:** `ALPHA-DEV-2026`, `BRAVO-DEV-2026`, `GHOST-DEV-2026`, `SHADE-DEV-2026`.
- **QR codes** in `functions/seed-output/demo-openverse-qr-codes.csv` (git-ignored). Artifact `a11` unlocks the puzzle "The Programmer" (answer `dhh`).

**Pointing the Android app at the emulator.** Copy `openverse-native/.env.example` to `openverse-native/.env`. The Android emulator uses `10.0.2.2` to reach the computer. The login screen then shows a development-only **Use local emulator account** button; production builds continue to show Google login only. For a USB phone, run `adb reverse tcp:9099 tcp:9099`, `adb reverse tcp:8080 tcp:8080`, and `adb reverse tcp:5001 tcp:5001`, then set the host to `127.0.0.1`.

### Tests

```bash
npm test                    # typecheck + unit + emulator tests
npm run test:unit
npm run test:emulator       # rules, handlers against Firestore/Auth, e2e through the Functions emulator
```

**Compatibility:** the emulator tests load documents shaped exactly like the current seekerdb data:
- admin-provisioned users without server fields;
- `artifacts/QR-KEY-001` and `artifacts/QR-DECOY-001`;
- a puzzle with a plaintext answer.

**They also cover:**
- unauthenticated rejection on every callable;
- per-role reads, and denial of every client write to roles, teams, scores, tokens and solve state;
- that answers are unreadable except by admins;
- that hiders can't broadcast;
- duplicate and concurrent team claims;
- concurrent correct answers from two teams producing exactly one winner;
- batch idempotency;
- the telemetry, join and answer rate limits;
- game end and elimination;
- the puzzle-mirror trigger.

The native client is checked with `cd openverse-native && npm run typecheck`; an Android production bundle can be verified with `npx expo export --platform android`.

After changing `functions/src/shared/contract.ts`, run `npm run sync:contract`. A unit test fails if the app's copy drifts.

## Activation checklist for `seekerdb-9e679`

Already in place: the Android app `com.openverse.seeker` is registered, `google-services.json` is in `openverse-native/` (git-ignored), `.firebaserc` points at the project, Firestore (default) is in `asia-south1`, and Email/Password sign-in is enabled.

1. **Enable billing (Blaze plan)** under Firebase console → Usage and billing. Cloud Functions can't deploy without it.
2. **Preview the migration:** `npm run migrate -- --project seekerdb-9e679 --production --dry-run`. It is additive only:
   - creates `game/state` if it's missing;
   - backfills `playerId`, `status`, `score` and `eliminationTokens` on users;
   - mirrors puzzles into `puzzlePublic`;
   - syncs `{role, teamId}` claims.
3. **Deploy:** `npm run deploy`. This deploys rules, indexes, TTL policies and functions. Then, in the console under Firestore → Indexes, confirm the composite indexes are built and TTL is on for `locationBatches.expireAt` and `rateLimits.expireAt`.
4. **Migrate:** `npm run migrate -- --project seekerdb-9e679 --production`. Scripts use your `firebase login`, or Application Default Credentials if `GOOGLE_APPLICATION_CREDENTIALS` is set. No service-account keys are needed.
5. **Add real content:** admins can add teams, artifacts, puzzles and areas in the console as before, or seed them from a **private** file:
   ```bash
   npm run seed -- --production --project seekerdb-9e679 --data /secure/path/game.json
   ```
   Print the QR codes from `functions/seed-output/seekerdb-9e679-qr-codes.csv`, then store or delete that CSV securely.
6. **Place players:** send them team codes (`joinTeam`), or have an admin call `assignUser`. To make someone admin from the CLI, run `npm run grant-admin -- --email you@example.com --project seekerdb-9e679 --production`.
7. **Set up App Check:**
   - Register the Android app with **Play Integrity**; it needs the app's **SHA-256** from `npx eas-cli credentials -p android`.
   - For dev builds, register a debug token and set `EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN`.
   - Then set `ENFORCE_APP_CHECK=true` in `functions/.env.seekerdb-9e679` and redeploy functions.
8. **Build the APK.** For EAS cloud builds, first upload the config file:
   ```bash
   cd openverse-native
   npx eas-cli env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment preview
   npm run build:apk
   ```

## Environment and secrets

- **The backend has no runtime secrets.** Join codes exist only as hashes. Puzzle answers live in the admin-only `puzzles` collection, as in the original schema, and are never sent to players.
- **Functions config** is `.env.<projectId>` (git-ignored), holding `ENFORCE_APP_CHECK`.
- **CLI scripts** derive a short-lived Application Default Credentials file from `firebase login`. It's created with owner-only permissions in the OS temp folder and deleted when the script exits. Never commit service-account keys; `.gitignore` blocks common names.
- **App `EXPO_PUBLIC_*` variables** are inlined into the bundle and hold no secrets.

## Location data: retention and deletion

- **`seekers/{uid}`** is a single, overwritten "latest position" document. `stopTracking`, elimination, a role/team change or game end sets `active: false`, which hides it from surveillance.
- **Route history** batches expire through a Firestore **TTL policy** after `game.locationRetentionDays` (default **30**). Players can erase their history at any time from the Tracking screen (`deleteLocationHistory`).
- **`rateLimits`** documents expire through TTL.
- **On the device**, samples wait in an upload queue (up to 5,000) and are removed only after the server confirms them (`STORED`/`DUPLICATE`). Samples older than 7 days are dropped, because the server would reject them. Sign-out clears the queue.
- **Tracking only runs** after the player enables it and grants "Allow all the time". Android shows a persistent notification while it runs. It stops on *Stop*, sign-out, elimination, leaving the seeker side, or `game.status == ended`.

## Indexes and expected write volume

**Composite indexes:**
- `seekers (active, lastPing desc)` and `seekers (teamId, active, lastPing desc)` for the live radar;
- `artifactClaims (teamId, claimedAt desc)`;
- `puzzleUnlocks (teamId, unlockedAt desc)`.

The `locationBatches.samples` and `broadcasts.seekerPositions` arrays are exempt from indexing.

**Per tracking seeker:**
- `updateTelemetry` runs at most once per 10 s; in practice about once per 15–30 s. Each call costs about 4 reads and 2 writes.
- `uploadLocationBatch` runs about once or twice an hour (200 samples per batch).

**Example:** 50 seekers over a 3-hour game at one update per 15 s comes to:
- ~36k calls;
- ~72k writes and ~150k reads;
- a few dollars at most on Blaze, and Functions invocations stay inside the free 2M per month.

Raise `telemetryMinIntervalSec` in `game/state` to reduce that.
