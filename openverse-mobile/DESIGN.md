# OpenVerse Mobile — Product and Design Foundation

## First release

The seeker app is an Android-first companion for a campus-scale artifact hunt. The first vertical slice covers three screens:

1. **Mission Dashboard** — shows hunt progress, the next 15-minute position broadcast, and the active field roster.
2. **QR Scanner** — scans one of 15 physical artifact codes and distinguishes valid artifacts from decoys.
3. **The Programmer** — presents Case File 01 and accepts the three-initial answer `DHH`.

This slice is intentionally frontend-first. Data is local and typed so the same models can later be wired to Firebase Authentication, Firestore seeker telemetry, and challenge documents without redesigning the screens.

## Product rules

- There are 15 artifact QR codes: 10 valid and 5 decoys.
- A valid artifact opens a case-file challenge.
- A decoy can redirect to a harmless rickroll-style failure state later; the initial prototype models a rejected scan without navigating away.
- Seeker positions are shared with hiders every **15 minutes**. The older 10-minute value in `project.md` is superseded.
- The first case answer is `DHH`, not the full name.

## Visual language

- Canvas: `#05060f`
- Raised glass: `rgba(17, 24, 43, 0.94)`
- Primary text: `#eef6ff`
- Secondary text: `#aebbd1`
- Frost edge: `rgba(186, 215, 247, 0.14)`
- Functional accent: `#663af3`
- Success: `#7be0bd`
- Cards use 18px radii, low-opacity inset edges, and soft cool halos.
- Buttons use a consistent pill geometry and are centered within their containers.
- Display typography is spacious and restrained; interface typography favors compact uppercase metadata.

## Interaction contract

- The primary dashboard action opens the scanner.
- A simulated scan reveals the artifact result before the user advances.
- The case-file answer is normalized for case and surrounding whitespace.
- Incorrect answers stay on the case with clear inline feedback.
- A correct answer shows a claimed state and a path back to the mission.

## Backend boundary

The next implementation step should introduce a small service layer with these operations:

- `watchMission(seekerId)`
- `recordLocationPing(seekerId, telemetry)`
- `resolveArtifact(qrPayload)`
- `submitCaseAnswer(seekerId, caseId, answer)`
- `watchBroadcastWindow()`

The UI must not import Firebase directly. A mock adapter should remain available for local development and tests.
