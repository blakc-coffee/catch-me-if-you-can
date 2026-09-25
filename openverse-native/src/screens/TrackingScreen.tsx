import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../components/AppShell";
import { Card, Eyebrow, PrimaryButton } from "../components/Primitives";
import { isTracking } from "../services/locationService";
import { localStore } from "../services/storage";
import { deleteRemoteLocationHistory } from "../services/firebase/callables";
import { sameScope, type StorageScope } from "../services/session/scope";
import { enforceAuthorization, startTracking, stopTrackingByUser, syncLocationQueue } from "../services/session/sessionRuntime";
import type { TrackingDecision } from "../services/session/trackingPolicy";
import { colors } from "../theme";
import type { AppRoute, StoredPosition } from "../types";

const DENIAL_MESSAGES: Record<string, string> = {
  "game-paused": "The mission is paused. Tracking resumes when you re-enable it after the mission restarts.",
  "game-ended": "The mission has ended. Tracking is off.",
  "game-not-active": "The mission is not live yet.",
  "game-missing": "The mission is not live yet.",
  eliminated: "You have been eliminated. Tracking is off.",
  suspended: "Your account is suspended. Tracking is off.",
  "not-seeker": "Only seekers share their location.",
  "no-team": "Join a seeker team before enabling tracking.",
  "profile-missing": "Your profile is still being set up.",
};

export function TrackingScreen({ active, scope, decision, onTrackingChange, onNavigate }: { active: boolean; scope: StorageScope | null; decision: TrackingDecision; onTrackingChange: (active: boolean) => void; onNavigate: (route: AppRoute) => void }) {
  const [busy, setBusy] = useState(false);
  const [samples, setSamples] = useState<StoredPosition[]>([]);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!scope) {
      setSamples([]);
      onTrackingChange(false);
      return;
    }
    const activeScope = await localStore.getActiveScope();
    onTrackingChange(Boolean(activeScope?.collecting && sameScope(activeScope, scope) && (await isTracking())));
    const queued = await localStore.loadLocations(scope);
    setSamples(queued);
    if (queued.length === 0) return;
    try {
      const result = await syncLocationQueue(scope, decision);
      setSamples(await localStore.loadLocations(scope));
      if (result.status === "denied") {
        await enforceAuthorization(scope, { allowed: false, reason: result.denial });
        onTrackingChange(false);
        setSyncMessage(DENIAL_MESSAGES[result.denial] ?? "Tracking is off.");
      } else if (result.status === "skipped") {
        setSyncMessage("Locations stay on this phone until you are an active seeker in a live mission.");
      } else {
        setSyncMessage(result.uploaded > 0 ? `${result.uploaded} location samples synced.` : null);
      }
    } catch {
      setSyncMessage("Locations are safely queued for the next sync.");
    }
  }, [decision, onTrackingChange, scope]);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggleTracking = async () => {
    if (!scope) return;
    setBusy(true);
    try {
      if (active) {
        await syncLocationQueue(scope, decision).catch(() => undefined);
        await stopTrackingByUser();
        onTrackingChange(false);
      } else {
        const result = await startTracking(scope, decision);
        if (result.ok) {
          onTrackingChange(true);
        } else if (result.reason === "background-denied") {
          Alert.alert("Background location required", "Choose Allow all the time in Android settings to record a mission while the app is not open.", [
            { text: "Cancel", style: "cancel" },
            { text: "Open settings", onPress: () => void Linking.openSettings() }
          ]);
        } else if (result.reason === "unavailable") {
          Alert.alert("Location unavailable", "Install a development or release build to test background tracking. It is not available in Expo Go.");
        } else if (result.reason === "foreground-denied") {
          Alert.alert("Location unavailable", "Foreground location permission was not granted.");
        } else {
          Alert.alert("Tracking unavailable", DENIAL_MESSAGES[result.reason] ?? "Tracking is only available to active seekers during a live mission.");
        }
      }
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const clearHistory = () => {
    if (!scope) return;
    Alert.alert("Clear location history?", "This permanently removes the route stored on this phone and in Firebase.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: async () => {
        setBusy(true);
        try {
          await deleteRemoteLocationHistory();
          await localStore.clearLocations(scope);
          setSamples([]);
          setSyncMessage("Location history deleted.");
        } catch {
          Alert.alert("Could not delete history", "Check your connection and try again.");
        } finally {
          setBusy(false);
        }
      } }
    ]);
  };

  const latest = samples.at(-1);

  return (
    <AppShell active="tracking" title="LOCATION CONTROL" onNavigate={onNavigate}>
      <Eyebrow color={active ? colors.success : colors.muted}>{active ? "●  TRACKING ACTIVE" : "○  TRACKING OFF"}</Eyebrow>
      <Text style={styles.title}>Mission location</Text>
      <Text style={styles.body}>Your route is queued safely on this device and synced to Firebase when a connection is available.</Text>

      <Card style={styles.card}>
        <View style={styles.row}><Text style={styles.label}>STORED SAMPLES</Text><Text style={styles.value}>{samples.length}</Text></View>
        <View style={styles.divider} />
        <View style={styles.row}><Text style={styles.label}>LAST UPDATE</Text><Text style={styles.value}>{latest ? new Date(latest.timestamp).toLocaleTimeString() : "None"}</Text></View>
        {latest ? <Text style={styles.coordinates}>{latest.latitude.toFixed(6)}, {latest.longitude.toFixed(6)}</Text> : null}
      </Card>

      {syncMessage ? <Text style={styles.syncMessage}>{syncMessage}</Text> : null}
      {!active && decision.allowed === false ? <Text style={styles.syncMessage}>{DENIAL_MESSAGES[decision.reason] ?? "Tracking is only available to active seekers during a live mission."}</Text> : null}

      <PrimaryButton loading={busy} disabled={!active && decision.allowed !== true} onPress={toggleTracking}>{active ? "Stop background tracking" : "Enable background tracking"}</PrimaryButton>

      <Card style={styles.notice}>
        <Text style={styles.noticeTitle}>Android permission flow</Text>
        <Text style={styles.body}>First allow precise location, then choose “Allow all the time.” Android displays a persistent mission notification while tracking.</Text>
      </Card>

      {samples.length > 0 ? <Pressable onPress={clearHistory}><Text style={styles.clear}>Clear stored location history</Text></Pressable> : null}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 30, fontWeight: "700", letterSpacing: -1, marginTop: 12 },
  body: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 8 },
  card: { marginTop: 24 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { color: colors.muted, fontSize: 9, letterSpacing: 1 },
  value: { color: colors.text, fontWeight: "700", fontSize: 13 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.edge, marginVertical: 15 },
  coordinates: { color: colors.body, fontSize: 11, textAlign: "right", marginTop: 8 },
  notice: { marginTop: 18 },
  noticeTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  clear: { color: colors.error, textAlign: "center", fontSize: 11, marginTop: 22 },
  syncMessage: { color: colors.body, fontSize: 11, textAlign: "center", marginTop: 12 }
});
