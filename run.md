# How to Get the Backend Running

This guide explains how to set up, start, seed, and test the **OpenVerse Firebase Backend** (`catch-me-if-you-can/backend`).

---

## 📋 Prerequisites

1. **Node.js**: Node 22 (recommended, minimum Node 18+)
2. **Java JDK**: **Java 21 or newer** (required by the Firebase Firestore emulator).
   > **Windows Tip**: On Windows, the default `java.exe` on `PATH` may be an Oracle shim that fails with the Firestore emulator. If installed at `C:\Program Files\Java\jdk-21`, prepend it to your `PATH` in each terminal (see commands below).
3. **Firebase Tools**: Bundled inside `backend/devDependencies`, so global installation is optional.

---

## 🚀 Quick Start (Local Emulator Suite)

### Step 1: Open Terminal and Navigate to Backend

Open PowerShell and navigate to the backend folder:

```powershell
cd catch-me-if-you-can/backend
```
*(If you are already inside `catch-me-if-you-can`, simply run `cd backend`)*

---

### Step 2: Set Java Path (Windows PowerShell)

Ensure Java 21 is prioritized in your current PowerShell session:

```powershell
$env:Path = 'C:\Program Files\Java\jdk-21\bin;' + $env:Path
```

Verify that Java runs properly:
```powershell
java -version
```

---

### Step 3: Install Dependencies

Run `npm install` (this will automatically install dependencies in `backend/` and `backend/functions/`):

```powershell
npm install
```

---

### Step 4: Start the Firebase Emulators

Start the emulators (this compiles TypeScript Cloud Functions and launches Auth, Firestore, Functions, and the Emulator UI):

```powershell
npm run emulators
```

> **Optional (Persistent Data)**: If you want emulator data to be saved between restarts:
> ```powershell
> npm run emulators:persist
> ```

Once started, the services will be running at:
- **Emulator UI**: [http://127.0.0.1:4000](http://127.0.0.1:4000)
- **Auth Emulator**: `127.0.0.1:9099`
- **Firestore Emulator**: `127.0.0.1:8080`
- **Functions Emulator**: `127.0.0.1:5001`

---

### Step 5: Seed the Emulator Database

Leave the emulator terminal running. Open a **second terminal window** and run:

```powershell
cd catch-me-if-you-can/backend
npm run seed
```

This will seed the emulator with:
- **Development Accounts** (Password: `openverse-dev`):
  - `admin@iiitkottayam.ac.in` (Role: `admin`)
  - `surveillance@iiitkottayam.ac.in` (Role: `surveillance`)
  - `hider1@iiitkottayam.ac.in` (Role: `hider`, Team: `ghost`)
  - `seeker1@iiitkottayam.ac.in` (Role: `seeker`, Team: `alpha`)
  - `seeker2@iiitkottayam.ac.in` (Role: `seeker`, Team: `bravo`)
- **Team Join Codes**:
  - `ALPHA-DEV-2026`
  - `BRAVO-DEV-2026`
  - `GHOST-DEV-2026`
  - `SHADE-DEV-2026`
- **Game Content**:
  - Initial `game/state` (status: `active`)
  - Campus areas & puzzles
  - 15 artifacts + 2 decoys
  - Generated QR codes are saved to: `functions/seed-output/demo-openverse-qr-codes.csv`

---

## 📱 Connecting Clients to the Backend

### Connecting Android Emulator
In the mobile app config (`openverse-native/.env`):
```dotenv
EXPO_PUBLIC_USE_FIREBASE_EMULATORS=true
EXPO_PUBLIC_FIREBASE_EMULATOR_HOST=10.0.2.2
EXPO_PUBLIC_EMULATOR_EMAIL=seeker1@iiitkottayam.ac.in
EXPO_PUBLIC_EMULATOR_PASSWORD=openverse-dev
```
*(Note: `10.0.2.2` is Android emulator's alias to the host machine's `127.0.0.1`)*

### Connecting Physical Android Phone via USB
Run port forwarding using ADB:
```powershell
adb reverse tcp:9099 tcp:9099
adb reverse tcp:8080 tcp:8080
adb reverse tcp:5001 tcp:5001
```
Then set `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST=127.0.0.1` in the app's `.env`.

### Connecting Web / Frontends
Configure Firebase client SDK to point to emulator hosts:
- Auth: `connectAuthEmulator(auth, "http://127.0.0.1:9099")`
- Firestore: `connectFirestoreEmulator(db, "127.0.0.1", 8080)`
- Functions: `connectFunctionsEmulator(functions, "127.0.0.1", 5001)`

---

## 🧪 Running Backend Tests

Make sure the Java path is set, then run:

```powershell
# Run full test suite (typecheck + unit + emulator integration tests)
npm test

# Run unit tests only
npm run test:unit

# Run emulator tests only (starts isolated emulators and runs rule & callable tests)
npm run test:emulator
```

---

## ☁️ Deploying to Production (Firebase `seekerdb-9e679`)

When deploying to the actual production project:

1. Login to Firebase CLI:
   ```powershell
   npx firebase login
   ```
2. Preview migration (dry run):
   ```powershell
   npm run migrate -- --project seekerdb-9e679 --production --dry-run
   ```
3. Deploy Firestore rules, indexes, and Cloud Functions:
   ```powershell
   npm run deploy
   ```
4. Run live migration:
   ```powershell
   npm run migrate -- --project seekerdb-9e679 --production
   ```
