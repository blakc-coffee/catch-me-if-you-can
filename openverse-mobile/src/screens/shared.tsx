import { CameraIcon, ChevronLeftIcon, DashboardIcon, QuestionMarkCircledIcon, UpdateIcon } from "@radix-ui/react-icons";
import type { FlowControls } from "../mobile";

export function BrandHeader({ flow, caseLabel, onStatusClick }: { flow?: FlowControls; caseLabel?: string; onStatusClick?: () => void }) {
  return <div className="app-header">{flow?.canGoBack ? <button className="icon-button" type="button" onClick={flow.pop} aria-label="Go back"><ChevronLeftIcon /></button> : <div className="signal-mark" aria-hidden="true"><span /><span /><span /></div>}<div className="brand-lockup"><span>OPENVERSE</span><small>{caseLabel ?? "SEEKER NETWORK"}</small></div><button className="icon-button" type="button" aria-label="Mission status" onClick={onStatusClick}><UpdateIcon /></button></div>;
}
export function NavBar({ active, onIntel }: { active: "mission" | "scan" | "cases"; onIntel?: () => void }) {
  return <nav className="bottom-nav" aria-label="Primary navigation"><button className={active === "mission" ? "active" : ""} type="button"><DashboardIcon /><span>Mission</span></button><button className={active === "scan" ? "active" : ""} type="button"><CameraIcon /><span>Scan</span></button><button className={active === "cases" ? "active" : ""} type="button" onClick={onIntel}><QuestionMarkCircledIcon /><span>Intel</span></button></nav>;
}
export function MissionStat({ value, label }: { value: string; label: string }) { return <div className="mission-stat"><strong>{value}</strong><span>{label}</span></div>; }
