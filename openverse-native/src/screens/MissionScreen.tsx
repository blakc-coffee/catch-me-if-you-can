import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../components/AppShell";
import { Card, Eyebrow, PrimaryButton } from "../components/Primitives";
import type { MissionSummary, Objective } from "../services/session/missionView";
import { colors } from "../theme";
import type { AppRoute } from "../types";

function objectiveCopy(objective: Objective): { eyebrow: string; title: string; body: string } {
  switch (objective.kind) {
    case "solve":
      return { eyebrow: `OPEN CASE / ${objective.puzzleId.toUpperCase()}`, title: objective.title, body: "Your team unlocked this case file. Solve it before another team does." };
    case "scan":
      return { eyebrow: "FIELD OBJECTIVE", title: "Find the next artifact", body: "Scan an artifact QR code to claim it for your team and unlock its case file." };
    case "complete":
      return { eyebrow: "FIELD OBJECTIVE", title: "All artifacts claimed", body: "Your team has claimed every active artifact." };
    case "waiting":
      return {
        eyebrow: "MISSION STATUS",
        title: objective.gameStatus === "paused" ? "Mission paused" : objective.gameStatus === "ended" ? "Mission ended" : "Mission not live yet",
        body: "Scanning and case files open while the mission is live.",
      };
  }
}

export function MissionScreen({ online, summary, tracking, onRetry, onOpenCase, onNavigate }: {
  online: boolean;
  summary: MissionSummary;
  tracking: boolean;
  onRetry: () => void;
  onOpenCase: (puzzleId: string | null) => void;
  onNavigate: (route: AppRoute) => void;
}) {
  if (summary.status !== "ready") {
    return (
      <AppShell active="mission" onNavigate={onNavigate}>
        <Card style={styles.statusCard}>
          {summary.status === "loading" ? (
            <View style={styles.center}><ActivityIndicator color={colors.blue} /><Text style={styles.muted}>Loading mission status…</Text></View>
          ) : summary.status === "no-team" ? (
            <><Text style={styles.objective}>No team yet</Text><Text style={styles.muted}>Ask an organiser to add you to a team, then refresh.</Text><PrimaryButton onPress={onRetry}>Refresh</PrimaryButton></>
          ) : (
            <><Text style={styles.objective}>Mission status unavailable</Text><Text style={styles.muted}>Check your connection and try again.</Text><PrimaryButton onPress={onRetry}>Try again</PrimaryButton></>
          )}
        </Card>
      </AppShell>
    );
  }

  const objective = objectiveCopy(summary.objective);
  const openPuzzleId = summary.objective.kind === "solve" ? summary.objective.puzzleId : null;

  return (
    <AppShell active="mission" onNavigate={onNavigate}>
      <Text style={styles.title}>{summary.teamName}</Text>
      <Text style={styles.subtitle}>Explore the campus. Find the artifacts.</Text>
      {!online ? <Text style={styles.offline}>OFFLINE · Showing cached mission data. Scanning, submissions, and new tracking sessions are disabled.</Text> : null}

      <Card style={styles.statusCard}>
        <View style={styles.liveRow}><View style={styles.liveDot} /><Eyebrow>TEAM PROGRESS</Eyebrow></View>
        <Text style={styles.claims}>{summary.claimed} / {summary.total}</Text>
        <Text style={styles.muted}>artifacts claimed</Text>
        <View style={styles.divider} />
        <View style={styles.statsRow}>
          <Stat label="SCORE" value={summary.score} />
          <Stat label="TOKENS" value={summary.tokens} />
          <Stat label="CASES" value={`${summary.solved} / ${summary.unlocked}`} />
        </View>
        <View style={styles.divider} />
        <View style={styles.metaRow}>
          <Text style={styles.meta}>FIELD STATUS</Text>
          <Text style={[styles.meta, { color: tracking ? colors.success : colors.muted }]}>{tracking ? "TRACKING ACTIVE" : "TRACKING OFF"}</Text>
        </View>
      </Card>

      <Text style={styles.sectionLabel}>NEXT OBJECTIVE</Text>
      <Card>
        <Eyebrow>{objective.eyebrow}</Eyebrow>
        <Text style={styles.objective}>{objective.title}</Text>
        <Text style={styles.muted}>{objective.body}</Text>
      </Card>

      {openPuzzleId ? (
        <PrimaryButton onPress={() => onOpenCase(openPuzzleId)}>Open case file  →</PrimaryButton>
      ) : (
        <PrimaryButton disabled={!online} onPress={() => onNavigate("scanner")}>Open scanner  →</PrimaryButton>
      )}

      <View style={styles.sharing}>
        <Text style={styles.sectionLabel}>POSITION SHARING</Text>
        <Text style={styles.sharingCopy}>{tracking ? "Location is being recorded and synced securely." : "Enable mission tracking to record your route."}</Text>
      </View>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.meta}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 29, fontWeight: "700", letterSpacing: -1 },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 7 },
  statusCard: { marginTop: 24 },
  center: { alignItems: "center", gap: 10, paddingVertical: 12 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.blue },
  claims: { color: colors.text, fontSize: 34, fontWeight: "700", marginTop: 15 },
  muted: { color: colors.muted, fontSize: 12, marginTop: 5, lineHeight: 18 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.edge, marginVertical: 13 },
  statsRow: { flexDirection: "row", justifyContent: "space-between" },
  stat: { alignItems: "flex-start" },
  statValue: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 4 },
  metaRow: { flexDirection: "row", justifyContent: "space-between" },
  meta: { color: colors.muted, fontSize: 9, letterSpacing: 0.7 },
  sectionLabel: { color: "#A7B3C7", fontSize: 10, marginTop: 34, marginBottom: 10, letterSpacing: 0.7 },
  objective: { color: colors.text, fontSize: 20, fontWeight: "700", marginTop: 13 },
  sharing: { marginTop: 2 },
  sharingCopy: { color: colors.body, fontSize: 12 },
  offline: { color: colors.blue, fontSize: 11, lineHeight: 17, marginTop: 12 }
});
