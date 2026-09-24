import { StyleSheet, Text, View } from "react-native";
import { AppShell } from "../components/AppShell";
import { Card, Eyebrow, PrimaryButton } from "../components/Primitives";
import { mission } from "../data/mission";
import { colors } from "../theme";
import type { AppRoute } from "../types";

export function MissionScreen({ claims, tracking, onNavigate }: { claims: number; tracking: boolean; onNavigate: (route: AppRoute) => void }) {
  return (
    <AppShell active="mission" onNavigate={onNavigate}>
      <Text style={styles.title}>Good evening, Seeker.</Text>
      <Text style={styles.subtitle}>Explore the campus. Find the artifacts.</Text>

      <Card style={styles.statusCard}>
        <View style={styles.liveRow}><View style={styles.liveDot} /><Eyebrow>LIVE MISSION</Eyebrow></View>
        <Text style={styles.claims}>{claims} / {mission.totalArtifacts}</Text>
        <Text style={styles.muted}>artifacts claimed</Text>
        <View style={styles.divider} />
        <View style={styles.metaRow}>
          <Text style={styles.meta}>FIELD STATUS</Text>
          <Text style={[styles.meta, { color: tracking ? colors.success : colors.muted }]}>{tracking ? "TRACKING ACTIVE" : "TRACKING OFF"}</Text>
        </View>
      </Card>

      <Text style={styles.sectionLabel}>NEXT OBJECTIVE</Text>
      <Card>
        <Eyebrow>{mission.objective.id}  /  {mission.objective.category}</Eyebrow>
        <Text style={styles.objective}>{mission.objective.title}</Text>
        <Text style={styles.muted}>{mission.objective.description}</Text>
      </Card>

      <PrimaryButton onPress={() => onNavigate("scanner")}>Open scanner  →</PrimaryButton>

      <View style={styles.sharing}>
        <Text style={styles.sectionLabel}>POSITION SHARING</Text>
        <Text style={styles.sharingCopy}>{tracking ? "Location is being recorded on this device." : "Enable mission tracking to record your route."}</Text>
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 29, fontWeight: "700", letterSpacing: -1 },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 7 },
  statusCard: { marginTop: 24 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.blue },
  claims: { color: colors.text, fontSize: 34, fontWeight: "700", marginTop: 15 },
  muted: { color: colors.muted, fontSize: 12, marginTop: 5, lineHeight: 18 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.edge, marginVertical: 13 },
  metaRow: { flexDirection: "row", justifyContent: "space-between" },
  meta: { color: colors.muted, fontSize: 9, letterSpacing: 0.7 },
  sectionLabel: { color: "#A7B3C7", fontSize: 10, marginTop: 34, marginBottom: 10, letterSpacing: 0.7 },
  objective: { color: colors.text, fontSize: 20, fontWeight: "700", marginTop: 13 },
  sharing: { marginTop: 2 },
  sharingCopy: { color: colors.body, fontSize: 12 }
});
