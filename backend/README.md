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
| `game/state` | `status` (`draft`/`active`/`paused`/`ended`), `eventId` (scopes on-device state), telemetry interval, broadcast cooldown, retention | signed-in |
| `seekers/{uid}` | **latest** live telemetry only | owner; admin; surveillance when `active == true` |
| `seekers/{uid}/locationBatches/{batchId}` | route history in batches (TTL) | owner; admin |
| `artifactClaims/{teamId_hash(qrCode)}` | one claim per team per artifact | own team; staff |
| `puzzleUnlocks/{teamId_puzzleId}` | created when a team claims an artifact with a `puzzleId` | own team; staff |
| `puzzlePublic/{puzzleId}` | answer-free copy of `puzzles/{id}` + solve state, kept in sync by `onPuzzleWritten` | seekers after their team's unlock; hiders if `hider` ∈ audience; staff |
| `puzzleClaims/{puzzleId}` | the single winning solve (first-solve lockout across teams) | own team; staff |
| `broadcasts/{id}` | seeker-position snapshots | hider, surveillance, admin |
| `artifactCodes/{sha256}` | per-team artifact QR codes, stored as hashes: `artifactId`, `teamId`, `isActive` | **nobody** |
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
| `updateTelemetry` | active seeker on a team, game active | plausibility checks (see *Location trust*); server derives zone/x/y; **1 per `telemetryMinIntervalSec`** (10 s) |
| `stopTracking` | any | hides own live position · 30/min |
| `uploadLocationBatch` | seeker (also after elimination/end) | ≤500 samples, ≤128 KiB; idempotent `batchId` (`DUPLICATE` / `BATCH_ID_CONFLICT`) · 30/min |
| `deleteLocationHistory` | owner | erases all own batches · 5/hour |
| `claimArtifact` | active seeker on a team, game active | payload must be a per-team code issued to the caller's team (`artifactCodes`); `wrong` → `DECOY` + `redirectUrl`; `correct` → one claim per team, unlocks `puzzleId` · 30/min |
| `submitPuzzleAnswer` | seeker (team unlock required) or hider (`hider` ∈ audience) | server compares with `puzzles/{id}.answer`; transaction on `puzzleClaims/{id}` gives exactly one winning team · 10/min per puzzle, 60/min overall |
| `getMissionState` | seeker/hider on a team (also when eliminated) | read-only: game status + `eventId`, team progress, total active artifacts, and the team's case files (answer-free) · 60/min |
| `createBroadcast` | surveillance, admin | reads live `seekers/*` in the same transaction as the cooldown (600 s) |
| `onPuzzleWritten` (trigger) | — | mirrors `puzzles/{id}` → `puzzlePublic/{id}` without `answer` |

Every callable also:
- requires App Check in production when it is sensitive (see *App Check*);
- caps the request at 4 KiB, except `uploadLocationBatch` (128 KiB);
- rejects unknown fields;
- returns a typed `details.reason` on errors;
- replaces unexpected errors with a generic `INTERNAL`.

### Artifact QR codes: one code per team

Artifacts are deployed as **per-team printed codes**. Every artifact, real or decoy, gets one QR code per seeker team: `OVT-` plus 32 random base64url characters (192 bits). Firestore stores only a SHA-256 hash in `artifactCodes`, which no client can read. `claimArtifact` accepts a code only from the team it was issued to, inside the claim transaction.

- **Replay across teams does not work.** A photographed or shared code is rejected for any other team with `INVALID_ARTIFACT_CODE`, exactly like an unknown code, so it also reveals nothing about decoys. The server logs the attempt.
- **Artifact document ids (the old static QR values, e.g. `QR-KEY-001`) are no longer redeemable.** Existing printed static codes must be replaced.
- **Residual risk.** A team can still hand its *own* code to a teammate who is not at the artifact. Per-team codes stop cross-team replay, not remote redemption within a team.
- **Issuing codes:** `npm run seed` issues codes for seeded artifacts. `npm run artifact-codes` issues them for existing artifacts. Codes already issued are kept on re-runs; `--rotate` (or `seed --rotate-artifact-codes`) revokes every code and issues new ones. New codes are written to `functions/seed-output/<project>-artifact-codes-<time>.csv` (git-ignored, owner-only). Because Firestore keeps only hashes, that file is the only copy.
- **Revoking one code:** set `isActive: false` on its `artifactCodes` doc (Admin SDK or console).

### Location trust

`updateTelemetry` rejects, with a stable `details.reason` and without clamping or rewriting anything:

| Reason | Rule |
|---|---|
| `TELEMETRY_STALE_FIX` / `TELEMETRY_FUTURE_FIX` | fix older than 60 s, or more than 30 s ahead of server time |
| `TELEMETRY_LOW_ACCURACY` | reported accuracy worse than 50 m |
| `TELEMETRY_OUT_OF_BOUNDS` | outside the campus bounding box |
| `TELEMETRY_NON_MONOTONIC` | not newer than the last accepted fix |
| `TELEMETRY_IMPLAUSIBLE_MOVEMENT` | distance from the last accepted fix exceeds 10 m/s × elapsed time plus a jitter allowance (combined accuracy, capped at 40 m) |

These rejections are not terminal: the app keeps tracking and sends a newer fix later. Limits are in `TELEMETRY_LIMITS` (`functions/src/config.ts`).

- **Checks against state run in the transaction.** Game state, role, team, elimination and suspension are read inside the write transaction, together with the last accepted fix (`seekers/{uid}.fixServerMs`).
- **Elapsed time uses the server clock.** It is the smaller of the device-reported interval and the server-observed interval plus 5 s. Backdating the previous fix or post-dating the new one therefore buys no extra distance.
- **First fix:** a seeker with no accepted fix yet has no baseline, so only the stateless checks apply. The baseline survives `stopTracking`, so turning tracking off and on does not reset it. After a long gap, the allowed distance grows with the elapsed time.
- **What this does not do.** These checks, App Check and rate limiting make spoofing harder and catch impossible sequences. They cannot prove that coordinates come from real GPS hardware. On a rooted or otherwise fully controlled device, a player can feed a mock location that moves at a plausible speed, and it will be accepted. Treat live positions as strong hints, not proof, and keep a human in the loop for eliminations. Route history (`uploadLocationBatch`) gets only range checks.

### App Check

The sensitive callables (`updateTelemetry`, `uploadLocationBatch`, `claimArtifact`, `submitPuzzleAnswer`, `joinTeam`) **require a valid App Check token in every deployed project by default**. The Functions emulator never enforces it. `ENFORCE_APP_CHECK` in `functions/.env.<projectId>` changes this:
- unset: sensitive callables are enforced (the default);
- `true`: every callable is enforced;
- `false`: nothing is enforced. This is a temporary rollout escape hatch only, and it is logged at cold start.

The Android app uses Play Integrity in release builds and the debug provider in development and emulator builds (`openverse-native/src/services/firebase/config.ts`).

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
- **Per-team artifact codes** in `functions/seed-output/demo-openverse-artifact-codes-<time>.csv` (git-ignored), with one row per artifact and seeker team. Artifact `a11` unlocks the puzzle "The Programmer" (answer `dhh`). A re-seed keeps existing codes and exports only new ones; reset the emulator, or pass `--rotate-artifact-codes`, to get a fresh set.

**Pointing the Android app at the emulator.** Copy `openverse-native/.env.example` to `openverse-native/.env`. The Android emulator uses `10.0.2.2` to reach the computer. The login screen then shows a development-only **Use local emulator account** button; production builds continue to show Google login only. For a USB phone, run `adb reverse tcp:9099 tcp:9099`, `adb reverse tcp:8080 tcp:8080`, and `adb reverse tcp:5001 tcp:5001`, then set the host to `127.0.0.1`.

### Tests

```bash
npm test                    # typecheck + unit + emulator tests
npm run test:unit
npm run test:emulator       # rules, handlers against Firestore/Auth, e2e through the Functions emulator
```

**Compatibility:** the emulator tests load documents shaped exactly like the current seekerdb data:
- admin-provisioned users without server fields;
- `artifacts/QR-KEY-001` and `artifacts/QR-DECOY-001`, whose static codes must be rejected until per-team codes are issued;
- a puzzle with a plaintext answer.

**They also cover:**
- unauthenticated rejection on every callable;
- per-role reads, and denial of every client write to roles, teams, scores, tokens and solve state;
- that answers are unreadable except by admins;
- that hiders can't broadcast;
- duplicate and concurrent team claims, and cross-team replay of per-team artifact codes (including concurrent redemption of a shared code);
- telemetry plausibility: first fix, ordinary movement, impossible jumps, stale, future and non-monotonic timestamps, accuracy, campus bounds, backdated-timestamp sequences, and game, role, suspension and elimination transitions;
- concurrent correct answers from two teams producing exactly one winner;
- batch idempotency;
- the telemetry, join and answer rate limits;
- game end and elimination;
- the puzzle-mirror trigger.

The app's session logic has its own tests (`cd openverse-native && npm test`). They cover scoped storage, sign-out and account-switch cleanup, stopping tracking on game end, pause, elimination and role loss, the background-task gate, and scoped uploads.

After changing `functions/src/shared/contract.ts`, run `npm run sync:contract`. A unit test fails if the app's copy drifts.

## Activation checklist for `seekerdb-9e679`

Already in place: the Android app `com.openverse.seeker` is registered, `google-services.json` is in `openverse-native/` (git-ignored), `.firebaserc` points at the project, Firestore (default) is in `asia-south1`, and Email/Password sign-in is enabled.

1. **Enable billing (Blaze plan)** under Firebase console → Usage and billing. Cloud Functions can't deploy without it.
2. **Preview the migration:** `npm run migrate -- --project seekerdb-9e679 --production --dry-run`. It is additive only:
   - creates `game/state` if it's missing, or adds an `eventId` to it;
   - backfills `playerId`, `status`, `score` and `eliminationTokens` on users;
   - mirrors puzzles into `puzzlePublic`;
   - syncs `{role, teamId}` claims.
3. **Deploy:** `npm run deploy`. This deploys rules, indexes, TTL policies and functions. Then, in the console under Firestore → Indexes, confirm the composite indexes are built and TTL is on for `locationBatches.expireAt` and `rateLimits.expireAt`.
4. **Migrate:** `npm run migrate -- --project seekerdb-9e679 --production`. Scripts use your `firebase login`, or Application Default Credentials if `GOOGLE_APPLICATION_CREDENTIALS` is set. No service-account keys are needed.
5. **Add real content:** admins can add teams, artifacts, puzzles and areas in the console as before, or seed them from a **private** file:
   ```bash
   npm run seed -- --production --project seekerdb-9e679 --data /secure/path/game.json
   ```
   Print the per-team codes from `functions/seed-output/seekerdb-9e679-artifact-codes-<time>.csv`, then store that CSV offline or delete it securely.

   For artifacts that already exist (static codes such as `QR-KEY-001` are no longer redeemable), preview and then issue per-team codes:
   ```bash
   npm run artifact-codes -- --production --project seekerdb-9e679 --dry-run
   npm run artifact-codes -- --production --project seekerdb-9e679
   ```
6. **Place players:** send them team codes (`joinTeam`), or have an admin call `assignUser`. To make someone admin from the CLI, run `npm run grant-admin -- --email you@example.com --project seekerdb-9e679 --production`.
7. **Set up App Check before the first functions deploy.** Sensitive callables enforce it by default.
   - Register the Android app with **Play Integrity**; it needs the app's **SHA-256** from `npx eas-cli credentials -p android`.
   - For dev builds, register a debug token and set `EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN` (development only).
   - Optionally set `ENFORCE_APP_CHECK=true` in `functions/.env.seekerdb-9e679` to enforce every callable.
8. **Build the APK.** For EAS cloud builds, first upload the config file:
   ```bash
   cd openverse-native
   npx eas-cli env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment preview
   npm run build:apk
   ```

## Environment and secrets

- **The backend has no runtime secrets.** Join codes exist only as hashes. Puzzle answers live in the admin-only `puzzles` collection, as in the original schema, and are never sent to players.
- **Functions config** is `.env.<projectId>` (git-ignored), holding `ENFORCE_APP_CHECK`.
- **Per-team artifact codes** exist in plaintext only in the git-ignored `seed-output/` CSVs. Treat those files like passwords.
- **CLI scripts** derive a short-lived Application Default Credentials file from `firebase login`. It's created with owner-only permissions in the OS temp folder and deleted when the script exits. Never commit service-account keys; `.gitignore` blocks common names.
- **App `EXPO_PUBLIC_*` variables** are inlined into the bundle and hold no secrets.

## Location data: retention and deletion

- **`seekers/{uid}`** is a single, overwritten "latest position" document. `stopTracking`, elimination, a role/team change or game end sets `active: false`, which hides it from surveillance.
- **Route history** batches expire through a Firestore **TTL policy** after `game.locationRetentionDays` (default **30**). Players can erase their history at any time from the Tracking screen (`deleteLocationHistory`).
- **`rateLimits`** documents expire through TTL.
- **On the device**, game progress and queued samples are namespaced by Firebase UID and `game/state.eventId`. The scope comes from the signed-in Firebase user, never from a caller-supplied value. Samples are removed only after the server confirms them. Uploads run only while the signed-in account owns the scope and is authorized to track.
- **Sign-out or an account change** stops the background task, hides the live position (if still signed in as the owner), and deletes the previous account's queue and progress. Old installation-global keys, whose owner cannot be proven, are deleted rather than migrated.
- **Tracking only runs** while the signed-in user is an active seeker on a team in an **active** game. It stops on *Stop*, sign-out, account change, pause, game end, elimination, suspension, removal from the team or role loss. The background task records only into a persisted active scope owned by the signed-in user, and re-checks profile and game state about once a minute. Queued samples from a stopped session stay in their own scope and are not uploaded unless that account is authorized again.

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
