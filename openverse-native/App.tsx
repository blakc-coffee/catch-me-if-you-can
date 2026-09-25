import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Platform, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { getAuth, onAuthStateChanged, type User } from "@react-native-firebase/auth";
import { doc, getFirestore, onSnapshot } from "@react-native-firebase/firestore";
import { mission } from "./src/data/mission";
import { CaseScreen } from "./src/screens/CaseScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MissionScreen } from "./src/screens/MissionScreen";
import { ScannerScreen } from "./src/screens/ScannerScreen";
import { TrackingScreen } from "./src/screens/TrackingScreen";
import { isTracking } from "./src/services/locationService";
import { localStore } from "./src/services/storage";
import { initialGameState } from "./src/services/session/localStore";
import { sameScope } from "./src/services/session/scope";
import { enforceAuthorization, handleAuthChange, scopeForCurrentUser, signOutSafely } from "./src/services/session/sessionRuntime";
import { evaluateTracking, eventIdOf, type GameSnapshot, type ProfileSnapshot } from "./src/services/session/trackingPolicy";
import { colors } from "./src/theme";
import type { AppRoute, GameState } from "./src/types";
import { claimArtifact, createOrSyncProfile, submitPuzzleAnswer } from "./src/services/firebase/callables";
import type { ClaimArtifactResponse, SubmitPuzzleAnswerResponse } from "./src/services/firebase/contract";
import { configureFirebase } from "./src/services/firebase/config";

configureFirebase();

export default function App() {
  const [route, setRoute] = useState<AppRoute>("mission");
  const [game, setGame] = useState<GameState>(initialGameState);
  const [tracking, setTracking] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  // undefined = not loaded yet; null = document does not exist.
  const [profile, setProfile] = useState<ProfileSnapshot | null | undefined>(undefined);
  const [gameDoc, setGameDoc] = useState<GameSnapshot | null | undefined>(undefined);
  const authChain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (Platform.OS === "web") {
      setAuthReady(true);
      return;
    }

    const unsubscribe = onAuthStateChanged(getAuth(), (nextUser) => {
      // Serialized: cleanup for the previous account finishes before the next one is shown.
      authChain.current = authChain.current.then(async () => {
        await handleAuthChange(nextUser?.uid ?? null).catch((error) => console.warn("Session cleanup failed", error));
        setProfile(undefined);
        setGameDoc(undefined);
        setUser(nextUser);
        if (nextUser) {
          try {
            await createOrSyncProfile({ name: nextUser.displayName ?? undefined });
          } catch (error) {
            console.error("Unable to sync Firebase profile", error);
            await signOutSafely().catch((signOutError) => console.warn("Sign-out failed", signOutError));
            setUser(null);
          }
        }
        setAuthReady(true);
      });
    });

    return unsubscribe;
  }, []);

  const uid = user?.uid ?? null;

  // Live authorization inputs: the users doc is the server's authority for
  // role, team and status; game/state for the game lifecycle and event id.
  useEffect(() => {
    if (!uid || Platform.OS === "web") return;
    const db = getFirestore();
    const stopProfile = onSnapshot(
      doc(db, "users", uid),
      (snap) => setProfile(snap.exists() ? (snap.data() as ProfileSnapshot) : null),
      (error) => console.warn("Profile listener failed", error),
    );
    const stopGame = onSnapshot(
      doc(db, "game", "state"),
      (snap) => setGameDoc(snap.exists() ? (snap.data() as GameSnapshot) : null),
      (error) => console.warn("Game listener failed", error),
    );
    return () => {
      stopProfile();
      stopGame();
    };
  }, [uid]);

  const eventId = gameDoc === undefined ? null : eventIdOf(gameDoc);
  const scope = useMemo(() => (uid && eventId ? scopeForCurrentUser({ eventId }) : null), [uid, eventId]);
  const decision = useMemo(() => evaluateTracking({ uid, profile, game: gameDoc }), [uid, profile, gameDoc]);
  const decisionKey = decision.allowed === false ? decision.reason : String(decision.allowed);

  useEffect(() => {
    let cancelled = false;
    if (!scope) {
      setGame(initialGameState);
      setTracking(false);
      return;
    }
    void Promise.all([localStore.loadGameState(scope), localStore.getActiveScope(), isTracking()]).then(([stored, active, running]) => {
      if (cancelled) return;
      setGame(stored);
      setTracking(Boolean(active?.collecting && sameScope(active, scope) && running));
    });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  // Stop tracking the moment the user is no longer an active seeker in an active game.
  useEffect(() => {
    if (!scope) return;
    void enforceAuthorization(scope, decision).then((report) => {
      if (report) setTracking(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- decisionKey captures decision
  }, [scope, decisionKey]);

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
    if (scope) void localStore.saveGameState(scope, next);
  }, [scope]);

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
    if (route === "tracking") return <TrackingScreen active={tracking} scope={scope} decision={decision} onTrackingChange={setTracking} onNavigate={setRoute} />;
    return <MissionScreen claims={claims} tracking={tracking} onNavigate={setRoute} />;
  }, [decision, game, onScanned, onSolved, route, scope, tracking]);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {!authReady ? (
        <View style={styles.loading}><ActivityIndicator color={colors.blue} /></View>
      ) : user ? screen : <LoginScreen />}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas }
});
