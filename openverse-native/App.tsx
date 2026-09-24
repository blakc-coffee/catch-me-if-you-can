import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, BackHandler, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { mission } from "./src/data/mission";
import { CaseScreen } from "./src/screens/CaseScreen";
import { MissionScreen } from "./src/screens/MissionScreen";
import { ScannerScreen } from "./src/screens/ScannerScreen";
import { TrackingScreen } from "./src/screens/TrackingScreen";
import { isTracking } from "./src/services/locationService";
import { loadGameState, saveGameState } from "./src/services/storage";
import { colors } from "./src/theme";
import type { AppRoute, GameState } from "./src/types";

const initialState: GameState = { claimedArtifactIds: [], lastScannedPayload: null };

export default function App() {
  const [route, setRoute] = useState<AppRoute>("mission");
  const [game, setGame] = useState<GameState>(initialState);
  const [tracking, setTracking] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([loadGameState(), isTracking()])
      .then(([storedGame, trackingActive]) => {
        setGame(storedGame);
        setTracking(trackingActive);
      })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (route === "mission") return false;
      setRoute("mission");
      return true;
    });

    return () => subscription.remove();
  }, [route]);

  const updateGame = useCallback((next: GameState) => {
    setGame(next);
    void saveGameState(next);
  }, []);

  const onScanned = useCallback((payload: string) => {
    updateGame({ ...game, lastScannedPayload: payload });
  }, [game, updateGame]);

  const onSolved = useCallback(() => {
    if (game.claimedArtifactIds.includes(mission.caseFile.id)) return;
    updateGame({ ...game, claimedArtifactIds: [...game.claimedArtifactIds, mission.caseFile.id] });
  }, [game, updateGame]);

  const screen = useMemo(() => {
    const claims = mission.startingClaims + game.claimedArtifactIds.length;
    if (route === "scanner") return <ScannerScreen onNavigate={setRoute} onScanned={onScanned} />;
    if (route === "case") return <CaseScreen unlocked={Boolean(game.lastScannedPayload)} solved={game.claimedArtifactIds.includes(mission.caseFile.id)} onSolved={onSolved} onNavigate={setRoute} />;
    if (route === "tracking") return <TrackingScreen active={tracking} onTrackingChange={setTracking} onNavigate={setRoute} />;
    return <MissionScreen claims={claims} tracking={tracking} onNavigate={setRoute} />;
  }, [game, onScanned, onSolved, route, tracking]);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {ready ? screen : <View style={styles.loading}><ActivityIndicator color={colors.blue} /></View>}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas }
});
