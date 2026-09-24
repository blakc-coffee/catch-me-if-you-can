import { FlowStack, type FlowScreen } from "./mobile";
import { MissionScreen } from "./screens/MissionScreen";
import { ProgrammerScreen } from "./screens/ProgrammerScreen";
import { ScannerScreen } from "./screens/ScannerScreen";

const missionScreen: FlowScreen = { id: "mission", render: (flow) => <MissionScreen flow={flow} onScanner={() => flow.push(scannerScreen)} onIntel={() => flow.push(programmerScreen)} /> };
const scannerScreen: FlowScreen = { id: "scanner", render: (flow) => <ScannerScreen flow={flow} onIntel={() => flow.push(programmerScreen)} onProgrammer={() => flow.push(programmerScreen)} /> };
const programmerScreen: FlowScreen = { id: "programmer", render: (flow) => <ProgrammerScreen flow={flow} onMission={() => flow.replace(missionScreen)} /> };

export default function Prototype() {
  return <FlowStack initial={missionScreen} />;
}
