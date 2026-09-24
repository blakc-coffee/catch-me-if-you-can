import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "../theme";
import type { AppRoute } from "../types";

type Props = {
  children: ReactNode;
  active: AppRoute;
  title?: string;
  onNavigate: (route: AppRoute) => void;
  scroll?: boolean;
};

export function AppShell({ children, active, title = "SEEKER NETWORK", onNavigate, scroll = true }: Props) {
  const content = scroll ? (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View style={styles.fixedContent}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <View style={styles.signal}>
          <View style={styles.signalDot} />
          <View style={[styles.signalDot, styles.signalWide]} />
          <View style={[styles.signalDot, styles.signalFaint]} />
        </View>
        <View style={styles.brand}>
          <Text style={styles.brandName}>OPENVERSE</Text>
          <Text style={styles.brandSubtitle}>{title}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Tracking settings" onPress={() => onNavigate("tracking")} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>◎</Text>
        </Pressable>
      </View>

      <View style={styles.body}>{content}</View>

      <View style={styles.navigation}>
        <NavItem icon="◫" label="Mission" selected={active === "mission"} onPress={() => onNavigate("mission")} />
        <NavItem icon="▣" label="Scan" selected={active === "scanner"} onPress={() => onNavigate("scanner")} />
        <NavItem icon="?" label="Intel" selected={active === "case"} onPress={() => onNavigate("case")} />
      </View>
    </SafeAreaView>
  );
}

function NavItem({ icon, label, selected, onPress }: { icon: string; label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.navItem}>
      <Text style={[styles.navIcon, selected && styles.navSelected]}>{icon}</Text>
      <Text style={[styles.navLabel, selected && styles.navSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.page, paddingTop: 24, paddingBottom: 112 },
  fixedContent: { flex: 1 },
  header: {
    height: 64,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.edge,
    backgroundColor: colors.canvas
  },
  signal: { width: 42, flexDirection: "row", alignItems: "center", gap: 3 },
  signalDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.body },
  signalWide: { width: 11, opacity: 0.75 },
  signalFaint: { width: 7, opacity: 0.45 },
  brand: { flex: 1, alignItems: "center" },
  brandName: { color: colors.text, fontSize: 15, fontWeight: "700", letterSpacing: 2.3 },
  brandSubtitle: { color: colors.muted, fontSize: 8, marginTop: 5, letterSpacing: 1.3 },
  headerButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.panelSoft },
  headerButtonText: { color: colors.body, fontSize: 21 },
  navigation: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 10,
    height: 68,
    borderRadius: 18,
    flexDirection: "row",
    backgroundColor: "#0C111E",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.edge
  },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  navIcon: { color: "#6E7B91", fontSize: 20 },
  navLabel: { color: "#6E7B91", fontSize: 10 },
  navSelected: { color: colors.text }
});
