# Catch Me If You Can (OpenVerse: Solve & Seek)

Campus-scale alternate reality gaming (ARG) / Capture The Flag (CTF) tactical operations platform built for real-world hide-and-seek operations at **IIIT Kottayam**.

---

## 🎯 Overview

**Catch Me If You Can** bridges mobile field operatives (**Seekers**) and tactical surveillance & desk operatives (**Hiders & Command Control**) via real-time telemetry, geographic zone tracking, and an anomaly challenge matrix.

### Key Capabilities

- 🛰️ **Tactical Surveillance Radar**: Real-time Leaflet GIS tracking of field seekers across physical campus zones with normalized coordinates and telemetry feeds.
- 📡 **Periodic Intel Transmission**: Synchronized tactical broadcast windows pushing seeker location snapshots to field hiders.
- 🧩 **Competitive Anomaly Challenge Matrix**: Cryptography, Network, Linux, Logic, OSINT, and Campus intelligence puzzles featuring **atomic first-solve lockout** backed by Cloud Firestore transactions.
- ⚡ **Cyber-Tactical Aesthetic**: WebGL shaders, CRT monitor effects, and neon dark interface.

---

## 📁 Repository Structure

```
catch-me-if-you-can/
├── openverse-mobile/       # Mobile client application (React, Vite, Motion, Touch Gestures)
├── solvenseek/             # Web surveillance portal (submodule → github.com/tovi-govi/solvenseek, deployed at solvenseek.vercel.app)
├── backend/                # Firebase: Firestore rules/indexes, Cloud Functions, emulators (see backend/README.md)
├── project.md              # Detailed architecture, Firestore schemas & specifications
├── .gitignore              # Monorepo ignore rules
└── README.md               # Repository documentation
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18.0.0 or higher recommended)
- `npm` or `pnpm`

### Mobile Client (`openverse-mobile`)

```bash
cd openverse-mobile
npm install
npm run dev
```

The current prototype includes the seeker mission dashboard, QR scanner, Programmer case flow, and a team console with Surveillance and Hider Matrix modes.

### Native Mobile Client (`openverse-native`)

The installable app is a real Expo/React Native client with native QR camera access, Android/iOS background location support, and offline on-device storage. It does not use Firebase, localhost, or another backend.

```bash
cd openverse-native
npm install
npm run typecheck
npm run build:apk
```

Background tracking must be tested in a development or release build; Android background services are unavailable in Expo Go.

### Web Command Portal (`solvenseek`)

Production: **https://solvenseek.vercel.app**

```bash
git submodule update --init solvenseek
cd solvenseek
npm install
cp .env.example .env.local
npm run dev
```

See [docs/solvenseek-integration.md](docs/solvenseek-integration.md) for Firebase env alignment with `openverse-native`.

---

## 📖 Detailed Documentation

For in-depth system architecture, Firestore data models, tactical coordinates, and technical specifications, refer to [project.md](project.md).
