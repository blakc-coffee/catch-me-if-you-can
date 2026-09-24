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
├── openverse-web/          # Web surveillance & operational interface
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

### Web Command Portal (`openverse-web`)

```bash
cd openverse-web
npm install
npm run dev
```

---

## 📖 Detailed Documentation

For in-depth system architecture, Firestore data models, tactical coordinates, and technical specifications, refer to [project.md](project.md).
