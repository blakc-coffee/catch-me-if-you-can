import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Platform, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { getAuth, onAuthStateChanged, type User } from "@react-native-firebase/auth";
import { doc, getFirestore, onSnapshot } from "@react-native-firebase/firestore";
import { Card, PrimaryButton } from "./src/components/Primitives";
import { CaseScreen } from "./src/screens/CaseScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MissionScreen } from "./src/screens/MissionScreen";
import { ScannerScreen } from "./src/screens/ScannerScreen";
import { TrackingScreen } from "./src/screens/TrackingScreen";
import { isTracking } from "./src/services/locationService";
import { localStore } from "./src/services/storage";
import { applyClaim, initialGameState, listPuzzles, markSolved, mergeMissionPuzzles, selectPuzzle } from "./src/services/session/gameState";
import { summarizeMission, type MissionLoad } from "./src/services/session/missionView";
import { sameScope } from "./src/services/session/scope";
import { enforceAuthorization, handleAuthChange, scopeForCurrentUser, signOutSafely } from "./src/services/session/sessionRuntime";
import { profileSyncFailure, scopeKeyOf, startupPhase, type ProfileSync } from "./src/services/session/startup";
import { SessionChangedError, SessionGuard } from "./src/services/session/sessionGuard";
import { evaluateTracking, eventIdOf, type GameSnapshot, type ProfileSnapshot } from "./src/services/session/trackingPolicy";
import { colors } from "./src/theme";
import type { AppRoute, GameState } from "./src/types";
import { claimArtifact, createOrSyncProfile, getCallableReason, getMissionState, submitPuzzleAnswer } from "./src/services/firebase/callables";
import type { ClaimArtifactResponse, SubmitPuzzleAnswerResponse } from "./src/services/firebase/contract";
import { configureFirebase } from "./src/services/firebase/config";

configureFirebase();

export default function App() {
  const [route, setRoute] = useState<AppRoute>("mission");
  const [authResolved, setAuthResolved] = useState(Platform.OS === "web");
  const [user, setUser] = useState<User | null>(null);
  const [profileSync, setProfileSync] = useState<ProfileSync>("pending");
  const [listenerFailures, setListenerFailures] = useState({ profile: false, game: false });
  const [listenerAttempt, setListenerAttempt] = useState(0);
  // undefined = not loaded yet; null = document does not exist.
  const [profile, setProfile] = useState<ProfileSnapshot | null | undefined>(undefined);
  const [gameDoc, setGameDoc] = useState<GameSnapshot | null | undefined>(undefined);
  const [game, setGame] = useState<GameState>(initialGameState);
  const [localStateKey, setLocalStateKey] = useState<string | null>(null);
  const [mission, setMission] = useState<MissionLoad>({ status: "loading" });
  const [tracking, setTracking] = useState(false);
  const authChain = useRef<Promise<void>>(Promise.resolve());
  const authEpoch = useRef(0);
  const sessionGuard = useRef(new SessionGuard());
  const missionRequest = useRef(0);

  const uid = user?.uid ?? null;

  const restoreOfflineSession = useCallback(async (nextUser: User, epoch: number) => {
    const cached = await localStore.loadSessionForUid(nextUser.uid);
    if (!cached || epoch !== authEpoch.current || getAuth().currentUser?.uid !== nextUser.uid) return false;
    setProfile(cached.value.profile);
    setGameDoc(cached.value.game);
    setMission({ status: "ready", data: cached.value.mission });
    setProfileSync("offline");
    return true;
  }, []);

  const syncProfile = useCallback(async (nextUser: User, epoch = authEpoch.current) => {
    setProfileSync("pending");
    try {
      await createOrSyncProfile({ name: nextUser.displayName ?? undefined });
      if (epoch !== authEpoch.current || getAuth().currentUser?.uid !== nextUser.uid) return;
      setProfileSync("ok");
    } catch (error) {
      if (epoch !== authEpoch.current || getAuth().currentUser?.uid !== nextUser.uid) return;
      console.warn("Unable to sync Firebase profile", error);
      if (profileSyncFailure(getCallableReason(error)) === "sign-out") {
        await signOutSafely().catch((signOutError) => console.warn("Sign-out failed", signOutError));
      } else if (!(await restoreOfflineSession(nextUser, epoch))) {
        setProfileSync("error");
      }
    }
  }, [restoreOfflineSession]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const unsubscribe = onAuthStateChanged(getAuth(), (nextUser) => {
      const epoch = ++authEpoch.current;
      sessionGuard.current.invalidate();
      missionRequest.current += 1;
      setAuthResolved(false);
      // Serialized: the previous account is cleaned up and every piece of
      // account state reset before the next account is shown.
      authChain.current = authChain.current.then(async () => {
        await handleAuthChange(nextUser?.uid ?? null).catch((error) => console.warn("Session cleanup failed", error));
        if (epoch !== authEpoch.current) return;
        setProfile(undefined);
        setGameDoc(undefined);
        setListenerFailures({ profile: false, game: false });
        setGame(initialGameState);
        setLocalStateKey(null);
        setMission({ status: "loading" });
        setTracking(false);
        setRoute("mission");
        setProfileSync("pending");
        setUser(nextUser);
        setAuthResolved(true);
        if (nextUser) await syncProfile(nextUser, epoch);
      });
    });
    return unsubscribe;
  }, [syncProfile]);

  // Live authorization inputs: the users doc is the server's authority for
  // role, team and status; game/state for the game lifecycle and event id.
  useEffect(() => {
    if (!uid || Platform.OS === "web") return;
    setListenerFailures({ profile: false, game: false });
    const db = getFirestore();
    const stopProfile = onSnapshot(
      doc(db, "users", uid),
      (snap) => {
        setProfile(snap.exists() ? (snap.data() as ProfileSnapshot) : null);
        setListenerFailures((current) => ({ ...current, profile: false }));
      },
      (error) => {
        console.warn("Profile listener failed", error);
        setListenerFailures((current) => ({ ...current, profile: true }));
      },
    );
    const stopGame = onSnapshot(
      doc(db, "game", "state"),
      (snap) => {
        setGameDoc(snap.exists() ? (snap.data() as GameSnapshot) : null);
        setListenerFailures((current) => ({ ...current, game: false }));
      },
      (error) => {
        console.warn("Game listener failed", error);
        setListenerFailures((current) => ({ ...current, game: true }));
      },
    );
    return () => {
      stopProfile();
      stopGame();
    };
  }, [listenerAttempt, uid]);

  const eventId = gameDoc === undefined ? null : eventIdOf(gameDoc);
  const scope = useMemo(() => (uid && eventId ? scopeForCurrentUser({ eventId }) : null), [uid, eventId]);
  const scopeKey = scopeKeyOf(scope);
  sessionGuard.current.enter(scopeKey);
  useEffect(() => {
    missionRequest.current += 1;
    setMission((current) => current.status === "ready" && current.data.eventId === scope?.eventId ? current : { status: "loading" });
  }, [scope?.eventId, scopeKey]);
  const decision = useMemo(() => evaluateTracking({ uid, profile, game: gameDoc }), [uid, profile, gameDoc]);
  const decisionKey = decision.allowed === false ? decision.reason : String(decision.allowed);

  // This account's local progress for this event.
  useEffect(() => {
    let cancelled = false;
    if (!scope) return;
    void Promise.all([localStore.loadGameState(scope), localStore.getActiveScope(), isTracking()]).then(([stored, active, running]) => {
      if (cancelled) return;
      setGame(stored);
      setTracking(Boolean(active?.collecting && sameScope(active, scope) && running));
      setLocalStateKey(scopeKeyOf(scope));
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

  const updateGame = useCallback((next: (current: GameState) => GameState) => {
    setGame((current) => {
      const value = next(current);
      if (scope) void localStore.saveGameState(scope, value);
      return value;
    });
  }, [scope]);

  const phase = startupPhase({
    authResolved,
    uid,
    profileSync,
    profileLoaded: profile !== undefined,
    gameLoaded: gameDoc !== undefined,
    scopeKey,
    localStateKey,
    listenerFailed: listenerFailures.profile || listenerFailures.game,
  });
  const ready = phase === "ready";
  const onlineAuthorized = profileSync === "ok" && !listenerFailures.profile && !listenerFailures.game;

  // Server-backed mission state: team progress, totals and unlocked puzzles.
  const refreshMission = useCallback(async () => {
    if (!ready || !onlineAuthorized) return;
    const request = ++missionRequest.current;
    const token = sessionGuard.current.capture();
    try {
      const data = await getMissionState();
      if (request !== missionRequest.current || !sessionGuard.current.isCurrent(token)) return;
      setMission({ status: "ready", data });
      updateGame((current) => mergeMissionPuzzles(current, data.puzzles));
    } catch (error) {
      if (request !== missionRequest.current || !sessionGuard.current.isCurrent(token)) return;
      setMission(getCallableReason(error) === "NO_TEAM" ? { status: "no-team" } : { status: "error" });
    }
  }, [onlineAuthorized, ready, updateGame]);

  useEffect(() => {
    if (!scope || !profile || !gameDoc || mission.status !== "ready" || profileSync !== "ok") return;
    if (mission.data.eventId !== scope.eventId) return;
    void localStore.saveSession(scope, { profile, game: gameDoc, mission: mission.data, cachedAtMs: Date.now() });
  }, [gameDoc, mission, profile, profileSync, scope]);

  const teamId = typeof profile?.teamId === "string" ? profile.teamId : null;
  const role = typeof profile?.role === "string" ? profile.role : null;
  const gameStatus = typeof gameDoc?.status === "string" ? gameDoc.status : null;
  useEffect(() => {
    void refreshMission();
  }, [refreshMission, scopeKey, teamId, role, gameStatus]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (route === "mission") return false;
      setRoute("mission");
      return true;
    });
    return () => subscription.remove();
  }, [route]);

  const onScanned = useCallback(async (payload: string): Promise<ClaimArtifactResponse> => {
    if (!onlineAuthorized) throw new Error("Online authorization is unavailable.");
    const token = sessionGuard.current.capture();
    const result = await claimArtifact(payload);
    if (!sessionGuard.current.isCurrent(token)) throw new SessionChangedError();
    if (result.status === "DECOY") return result;
    updateGame((current) => applyClaim(current, { artifactId: result.artifactId, payload, puzzle: result.puzzle }, Date.now()));
    void refreshMission();
    return result;
  }, [onlineAuthorized, refreshMission, updateGame]);

  const onSolved = useCallback(async (puzzleId: string, answer: string): Promise<SubmitPuzzleAnswerResponse> => {
    if (!onlineAuthorized) throw new Error("Online authorization is unavailable.");
    const token = sessionGuard.current.capture();
    const result = await submitPuzzleAnswer(puzzleId, answer);
    if (!sessionGuard.current.isCurrent(token)) throw new SessionChangedError();
    if (result.status === "SOLVED" || result.status === "ALREADY_CLAIMED") {
      updateGame((current) => markSolved(current, puzzleId, result.status === "SOLVED" || result.solvedByYourTeam));
      void refreshMission();
    }
    return result;
  }, [onlineAuthorized, refreshMission, updateGame]);

  const openCase = useCallback((puzzleId: string | null) => {
    updateGame((current) => selectPuzzle(current, puzzleId));
    setRoute("case");
  }, [updateGame]);

  const onSignOut = useCallback(() => signOutSafely(), []);

  const retryOnline = useCallback(() => {
    if (!user) return;
    setListenerFailures({ profile: false, game: false });
    setProfile(undefined);
    setGameDoc(undefined);
    setListenerAttempt((attempt) => attempt + 1);
    void syncProfile(user, authEpoch.current);
  }, [syncProfile, user]);

  const summary = useMemo(() => summarizeMission(mission, game), [game, mission]);
  const puzzles = useMemo(() => listPuzzles(game), [game]);

  const screen = useMemo(() => {
    const screenKey = scopeKey ?? uid ?? "signed-out";
    if (route === "scanner") return <ScannerScreen key={screenKey} online={onlineAuthorized} onNavigate={setRoute} onScanned={onScanned} />;
    if (route === "case") return <CaseScreen key={screenKey} online={onlineAuthorized} puzzles={puzzles} activePuzzleId={game.activePuzzleId} onSelect={openCase} onSolved={onSolved} onNavigate={setRoute} />;
    if (route === "tracking") return <TrackingScreen key={screenKey} online={onlineAuthorized} active={tracking} scope={scope} decision={decision} onTrackingChange={setTracking} onSignOut={onSignOut} onNavigate={setRoute} />;
    return <MissionScreen key={screenKey} online={onlineAuthorized} summary={summary} tracking={tracking} onRetry={onlineAuthorized ? () => void refreshMission() : retryOnline} onOpenCase={openCase} onNavigate={setRoute} />;
  }, [decision, game.activePuzzleId, onScanned, onSignOut, onSolved, onlineAuthorized, openCase, puzzles, refreshMission, retryOnline, route, scope, scopeKey, summary, tracking, uid]);

  let content;
  if (phase === "signed-out") content = <LoginScreen />;
  else if (phase === "ready") content = screen;
  else if (phase === "profile-error" || phase === "listener-error") {
    content = (
      <View style={styles.centered}>
        <Card style={styles.errorCard}>
          <Text style={styles.errorTitle}>{phase === "listener-error" ? "Could not load your mission" : "Could not load your profile"}</Text>
          <Text style={styles.errorBody}>Check your connection and try again. Your correctly scoped cached data stays on this phone.</Text>
          <PrimaryButton onPress={retryOnline}>Try again</PrimaryButton>
          <Text accessibilityRole="button" onPress={() => void onSignOut()} style={styles.errorLink}>Sign out</Text>
        </Card>
      </View>
    );
  } else {
    content = (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.blue} />
        <Text style={styles.loadingText}>{phase === "resolving-auth" ? "Starting…" : phase === "syncing-profile" ? "Signing you in…" : "Loading your mission…"}</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {content}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.canvas },
  loadingText: { color: colors.muted, fontSize: 12, marginTop: 14 },
  errorCard: { width: "100%" },
  errorTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  errorBody: { color: colors.body, fontSize: 12, lineHeight: 18, marginTop: 8, marginBottom: 18 },
  errorLink: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 16 },
});
