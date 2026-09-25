import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, BackHandler, Platform, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { getAuth, onAuthStateChanged, type User } from "@react-native-firebase/auth";
import { mission } from "./src/data/mission";
import { CaseScreen } from "./src/screens/CaseScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MissionScreen } from "./src/screens/MissionScreen";
import { ScannerScreen } from "./src/screens/ScannerScreen";
import { TrackingScreen } from "./src/screens/TrackingScreen";
import { isTracking } from "./src/services/locationService";
import { loadGameState, saveGameState } from "./src/services/storage";
import { colors } from "./src/theme";
import type { AppRoute, GameState } from "./src/types";
import { claimArtifact, createOrSyncProfile, submitPuzzleAnswer } from "./src/services/firebase/callables";
import type { ClaimArtifactResponse, SubmitPuzzleAnswerResponse } from "./src/services/firebase/contract";
import { configureFirebase } from "./src/services/firebase/config";

const initialState: GameState = {
  claimedArtifactIds: [],
  solvedPuzzleIds: [],
  lastScannedPayload: null,
  activePuzzle: null,
  teamArtifactsClaimed: null,
};

configureFirebase();

export default function App() {
  const [route, setRoute] = useState<AppRoute>("mission");
  const [game, setGame] = useState<GameState>(initialState);
  const [tracking, setTracking] = useState(false);
  const [ready, setReady] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") {
      setAuthReady(true);
      return;
    }

    const unsubscribe = onAuthStateChanged(getAuth(), async (nextUser) => {
      setUser(nextUser);
      if (nextUser) {
        try {
          await createOrSyncProfile({ name: nextUser.displayName ?? undefined });
        } catch (error) {
          console.error("Unable to sync Firebase profile", error);
          await getAuth().signOut();
          setUser(null);
        }
      }
      setAuthReady(true);
    });

    return unsubscribe;
  }, []);

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

  const onScanned = useCallback(async (payload: string): Promise<ClaimArtifactResponse> => {
    const result = await claimArtifact(payload);
    if (result.status === "DECOY") return result;
    updateGame({
      ...game,
      claimedArtifactIds: game.claimedArtifactIds.includes(result.artifactId)
        ? game.claimedArtifactIds
        : [...game.claimedArtifactIds, result.artifactId],
      lastScannedPayload: payload,
      activePuzzle: result.puzzle ?? game.activePuzzle,
      teamArtifactsClaimed: result.teamArtifactsClaimed,
    });
    return result;
  }, [game, updateGame]);

  const onSolved = useCallback(async (answer: string): Promise<SubmitPuzzleAnswerResponse> => {
    if (!game.activePuzzle) throw new Error("No puzzle is unlocked.");
    const result = await submitPuzzleAnswer(game.activePuzzle.puzzleId, answer);
    if (result.status === "SOLVED" || (result.status === "ALREADY_CLAIMED" && result.solvedByYourTeam)) {
      updateGame({
        ...game,
        solvedPuzzleIds: game.solvedPuzzleIds.includes(game.activePuzzle.puzzleId)
          ? game.solvedPuzzleIds
          : [...game.solvedPuzzleIds, game.activePuzzle.puzzleId],
      });
    }
    return result;
  }, [game, updateGame]);

  const screen = useMemo(() => {
    const claims = game.teamArtifactsClaimed ?? mission.startingClaims + game.claimedArtifactIds.length;
    if (route === "scanner") return <ScannerScreen onNavigate={setRoute} onScanned={onScanned} />;
    if (route === "case") return <CaseScreen puzzle={game.activePuzzle} solved={Boolean(game.activePuzzle && game.solvedPuzzleIds.includes(game.activePuzzle.puzzleId))} onSolved={onSolved} onNavigate={setRoute} />;
    if (route === "tracking") return <TrackingScreen active={tracking} onTrackingChange={setTracking} onNavigate={setRoute} />;
    return <MissionScreen claims={claims} tracking={tracking} onNavigate={setRoute} />;
  }, [game, onScanned, onSolved, route, tracking]);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {!ready || !authReady ? (
        <View style={styles.loading}><ActivityIndicator color={colors.blue} /></View>
      ) : user ? screen : <LoginScreen />}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas }
});
