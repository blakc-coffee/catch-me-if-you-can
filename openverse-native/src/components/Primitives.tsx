import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme";

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function PrimaryButton({ children, onPress, disabled, loading }: { children: ReactNode; onPress: () => void; disabled?: boolean; loading?: boolean }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [styles.button, (disabled || loading) && styles.disabled, pressed && styles.pressed]}>
      {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{children}</Text>}
    </Pressable>
  );
}

export function Eyebrow({ children, color = colors.blue }: { children: ReactNode; color?: string }) {
  return <Text style={[styles.eyebrow, { color }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.card,
    borderRadius: spacing.radius,
    backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.edge
  },
  button: {
    minHeight: 50,
    paddingHorizontal: 18,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.violet,
    marginTop: 14
  },
  buttonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.8 },
  eyebrow: { fontSize: 10, letterSpacing: 1.2, fontWeight: "600" }
});
