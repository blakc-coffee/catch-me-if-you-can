import { useState } from "react";
import {
  ArrowRightIcon,
  CameraIcon,
  CheckCircledIcon,
  ChevronLeftIcon,
  ClockIcon,
  DashboardIcon,
  LightningBoltIcon,
  LockClosedIcon,
  PersonIcon,
  QuestionMarkCircledIcon,
  UpdateIcon,
} from "@radix-ui/react-icons";
import { FlowStack, KeyboardInput, MobileScroll, type FlowControls, type FlowScreen } from "./mobile";

type MissionStatProps = {
  value: string;
  label: string;
};

function BrandHeader({ flow, caseLabel }: { flow?: FlowControls; caseLabel?: string }) {
  return (
    <div className="app-header">
      {flow?.canGoBack ? (
        <button className="icon-button" type="button" onClick={flow.pop} aria-label="Go back">
          <ChevronLeftIcon />
        </button>
      ) : (
        <div className="signal-mark" aria-hidden="true"><span /><span /><span /></div>
      )}
      <div className="brand-lockup">
        <span>OPENVERSE</span>
        <small>{caseLabel ?? "SEEKER NETWORK"}</small>
      </div>
      <button className="icon-button" type="button" aria-label="Mission status">
        <UpdateIcon />
      </button>
    </div>
  );
}

function MissionStat({ value, label }: MissionStatProps) {
  return (
    <div className="mission-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function NavBar({ active }: { active: "mission" | "scan" | "cases" }) {
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      <button className={active === "mission" ? "active" : ""} type="button">
        <DashboardIcon /><span>Mission</span>
      </button>
      <button className={active === "scan" ? "active" : ""} type="button">
        <CameraIcon /><span>Scan</span>
      </button>
      <button className={active === "cases" ? "active" : ""} type="button">
        <QuestionMarkCircledIcon /><span>Intel</span>
      </button>
    </nav>
  );
}

function MissionScreen({ flow }: { flow: FlowControls }) {
  return (
    <div className="screen-shell">
      <BrandHeader />
      <MobileScroll className="app-screen">
        <main className="screen-content mission-content">
          <section className="hero-copy">
            <div className="eyebrow"><span /> LIVE MISSION <span /></div>
            <h1>Good hunting,<br />Seeker 07.</h1>
            <p>Recover the campus artifacts before the opposing team closes the grid.</p>
          </section>

          <section className="glass-card progress-card" aria-label="Artifact progress">
            <div className="card-heading">
              <div>
                <span className="card-kicker">ARTIFACT PROGRESS</span>
                <strong>4 of 15 scanned</strong>
              </div>
              <span className="progress-percent">27%</span>
            </div>
            <div className="progress-track"><span style={{ width: "27%" }} /></div>
            <div className="stat-row">
              <MissionStat value="04" label="VALID" />
              <MissionStat value="01" label="DECOY" />
              <MissionStat value="10" label="REMAIN" />
            </div>
          </section>

          <section className="broadcast-card">
            <div className="broadcast-icon"><ClockIcon /></div>
            <div>
              <span>NEXT POSITION BROADCAST</span>
              <strong>08:42</strong>
            </div>
            <div className="live-chip"><i /> LIVE</div>
          </section>

          <button className="primary-action" type="button" onClick={() => flow.push(scannerScreen)}>
            <CameraIcon /> Scan artifact <ArrowRightIcon />
          </button>

          <section className="roster-section">
            <div className="section-title"><span>FIELD ROSTER</span><small>3 ACTIVE</small></div>
            <div className="roster-list">
              <div className="roster-row"><PersonIcon /><div><strong>Echo Agent</strong><span>Academic Block 1</span></div><small>ONLINE</small></div>
              <div className="roster-row"><PersonIcon /><div><strong>Nova</strong><span>Open Area Theatre</span></div><small>ONLINE</small></div>
              <div className="roster-row muted"><PersonIcon /><div><strong>Ghost</strong><span>Last seen 2m ago</span></div><small>MOVING</small></div>
            </div>
          </section>
        </main>
      </MobileScroll>
      <NavBar active="mission" />
    </div>
  );
}

function ScannerScreen({ flow }: { flow: FlowControls }) {
  const [scanState, setScanState] = useState<"idle" | "found">("idle");

  return (
    <div className="screen-shell">
      <BrandHeader flow={flow} caseLabel="ARTIFACT SCANNER" />
      <MobileScroll className="app-screen">
        <main className="screen-content scanner-content">
          <section className="hero-copy compact">
            <div className="eyebrow"><span /> QR LINK ACTIVE <span /></div>
            <h1>Align the artifact<br />inside the frame.</h1>
            <p>Keep the code steady. Valid artifacts unlock their case file automatically.</p>
          </section>

          <section className={`scanner-frame ${scanState === "found" ? "is-found" : ""}`} aria-label="QR scanner preview">
            <span className="corner top-left" /><span className="corner top-right" />
            <span className="corner bottom-left" /><span className="corner bottom-right" />
            <div className="scan-orbit"><CameraIcon /></div>
            <div className="scan-line" />
            <small>{scanState === "found" ? "ARTIFACT 05 VERIFIED" : "SEARCHING FOR CODE"}</small>
          </section>

          {scanState === "found" ? (
            <section className="scan-result glass-card">
              <CheckCircledIcon />
              <div><span>VALID ARTIFACT</span><strong>Case File 01 discovered</strong></div>
            </section>
          ) : (
            <section className="scan-helper glass-card"><LightningBoltIcon /><span>Tip: move closer if the code looks soft or dim.</span></section>
          )}

          <button
            className="primary-action"
            type="button"
            onClick={() => scanState === "idle" ? setScanState("found") : flow.push(programmerScreen)}
          >
            {scanState === "idle" ? <><CameraIcon /> Simulate scan</> : <>Open case file <ArrowRightIcon /></>}
          </button>
        </main>
      </MobileScroll>
      <NavBar active="scan" />
    </div>
  );
}

function ProgrammerScreen({ flow }: { flow: FlowControls }) {
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<"idle" | "wrong" | "correct">("idle");

  const submit = () => {
    setStatus(answer.trim().toUpperCase() === "DHH" ? "correct" : "wrong");
  };

  return (
    <div className="screen-shell">
      <BrandHeader flow={flow} caseLabel="SEEKER / CASE 01" />
      <MobileScroll className="app-screen">
        <main className="screen-content case-content">
          <div className="case-index">CASE 01 / 03</div>
          <h1>The Programmer</h1>

          <section className="glass-card case-file">
            <span className="card-kicker">CASE FILE 01 / IDENTITY</span>
            <p>Sherlock has found a programmer, but his name has been removed. Find him using these clues:</p>
            <ol type="I">
              <li>He created a web framework whose philosophy includes optimizing for programmer happiness.</li>
              <li>His framework became known for Convention over Configuration.</li>
              <li>He later created an opinionated Linux distribution.</li>
              <li>He is commonly referred to by three initials.</li>
            </ol>
            <strong>Who is he? Enter three initials, not the full name.</strong>
          </section>

          {status === "correct" ? (
            <section className="success-panel">
              <CheckCircledIcon />
              <span>CASE VERIFIED</span>
              <h2>DHH accepted.</h2>
              <p>Artifact 05 has been added to your recovered set.</p>
              <button className="primary-action" type="button" onClick={() => flow.replace(missionScreen)}>
                Return to mission <ArrowRightIcon />
              </button>
            </section>
          ) : (
            <section className="answer-panel">
              <label htmlFor="case-answer">YOUR ANSWER <span>/ THREE INITIALS</span></label>
              <KeyboardInput
                id="case-answer"
                value={answer}
                maxLength={3}
                autoCapitalize="characters"
                placeholder="Enter answer"
                onChange={(event) => { setAnswer(event.target.value); setStatus("idle"); }}
              />
              {status === "wrong" ? <p className="error-message"><LockClosedIcon /> Answer rejected. Recheck the clues.</p> : null}
              <button className="primary-action" type="button" onClick={submit} disabled={answer.trim().length !== 3}>
                Submit answer <ArrowRightIcon />
              </button>
            </section>
          )}
        </main>
      </MobileScroll>
      <NavBar active="cases" />
    </div>
  );
}

const missionScreen: FlowScreen = { id: "mission", render: (flow) => <MissionScreen flow={flow} /> };
const scannerScreen: FlowScreen = { id: "scanner", render: (flow) => <ScannerScreen flow={flow} /> };
const programmerScreen: FlowScreen = { id: "programmer", render: (flow) => <ProgrammerScreen flow={flow} /> };

export default function Prototype() {
  return <FlowStack initial={missionScreen} />;
}
