import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../components/AppShell";
import { Card, Eyebrow, PrimaryButton } from "../components/Primitives";
import { isTracking, startTracking, stopTracking } from "../services/locationService";
import { clearLocations, loadLocations } from "../services/storage";
import { deleteRemoteLocationHistory, getCallableReason, stopRemoteTracking } from "../services/firebase/callables";
import { syncLocationQueue } from "../services/firebase/telemetrySync";
import { colors } from "../theme";
import type { AppRoute, StoredPosition } from "../types";

export function TrackingScreen({ active, onTrackingChange, onNavigate }: { active: boolean; onTrackingChange: (active: boolean) => void; onNavigate: (route: AppRoute) => void }) {
  const [busy, setBusy] = useState(false);
  const [samples, setSamples] = useState<StoredPosition[]>([]);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    onTrackingChange(await isTracking());
    const queued = await loadLocations();
    setSamples(queued);
    if (queued.length > 0) {
      try {
        const result = await syncLocationQueue();
        setSamples(await loadLocations());
        setSyncMessage(result.uploaded > 0 ? `${result.uploaded} location samples synced.` : null);
      } catch (error) {
        const reason = getCallableReason(error);
        setSyncMessage(reason === "GAME_NOT_ACTIVE" ? "Locations are queued until the mission starts." : "Locations are safely queued for the next sync.");
      }
    }
  }, [onTrackingChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggleTracking = async () => {
    setBusy(true);
    try {
      if (active) {
        await stopTracking();
        await syncLocationQueue().catch(() => undefined);
        await stopRemoteTracking().catch(() => undefined);
        onTrackingChange(false);
      } else {
        const result = await startTracking();
        if (result.ok) {
          onTrackingChange(true);
        } else if (result.reason === "background-denied") {
          Alert.alert("Background location required", "Choose Allow all the time in Android settings to record a mission while the app is not open.", [
            { text: "Cancel", style: "cancel" },
            { text: "Open settings", onPress: () => void Linking.openSettings() }
          ]);
        } else {
          Alert.alert("Location unavailable", result.reason === "unavailable" ? "Install a development or release build to test background tracking. It is not available in Expo Go." : "Foreground location permission was not granted.");
        }
      }
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const clearHistory = () => {
    Alert.alert("Clear location history?", "This permanently removes the route stored on this phone and in Firebase.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: async () => {
        setBusy(true);
        try {
          await deleteRemoteLocationHistory();
          await clearLocations();
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

      <PrimaryButton loading={busy} onPress={toggleTracking}>{active ? "Stop background tracking" : "Enable background tracking"}</PrimaryButton>

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
