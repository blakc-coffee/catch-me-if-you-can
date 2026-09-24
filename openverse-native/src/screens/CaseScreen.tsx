import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { AppShell } from "../components/AppShell";
import { Card, Eyebrow, PrimaryButton } from "../components/Primitives";
import { mission } from "../data/mission";
import { colors } from "../theme";
import type { AppRoute } from "../types";

export function CaseScreen({ solved, unlocked, onSolved, onNavigate }: { solved: boolean; unlocked: boolean; onSolved: () => void; onNavigate: (route: AppRoute) => void }) {
  const [answer, setAnswer] = useState("");
  const [wrong, setWrong] = useState(false);

  const submit = () => {
    if (answer.trim().toUpperCase() === mission.caseFile.acceptedAnswer) {
      setWrong(false);
      onSolved();
    } else {
      setWrong(true);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <AppShell active="case" title="SEEKER / CASE 01" onNavigate={onNavigate}>
        {!unlocked ? (
          <Card style={styles.locked}>
            <Text style={styles.lock}>⌁</Text>
            <Text style={styles.title}>Case locked</Text>
            <Text style={styles.body}>Scan a valid artifact QR code to unlock this case file.</Text>
            <PrimaryButton onPress={() => onNavigate("scanner")}>Open scanner</PrimaryButton>
          </Card>
        ) : solved ? (
          <View style={styles.successPanel}>
            <Text style={styles.successIcon}>✓</Text>
            <Eyebrow color={colors.success}>CASE VERIFIED</Eyebrow>
            <Text style={styles.successTitle}>DHH accepted.</Text>
            <Text style={styles.body}>Artifact 05 has been added to your recovered set.</Text>
            <PrimaryButton onPress={() => onNavigate("mission")}>Return to mission  →</PrimaryButton>
          </View>
        ) : (
          <>
            <Eyebrow>CASE 01 / 03</Eyebrow>
            <Text style={styles.title}>{mission.caseFile.title}</Text>
            <Card>
              <Eyebrow>CASE FILE 01 / IDENTITY</Eyebrow>
              <Text style={styles.body}>Sherlock found a programmer, but his name was removed. Find him using these clues:</Text>
              {mission.caseFile.clues.map((clue, index) => <Text key={clue} style={styles.clue}>{index + 1}.  {clue}</Text>)}
              <Text style={styles.question}>Who is he? Enter three initials, not the full name.</Text>
            </Card>

            <Text style={styles.inputLabel}>YOUR ANSWER  /  THREE INITIALS</Text>
            <TextInput
              accessibilityLabel="Case answer"
              value={answer}
              maxLength={3}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="Enter answer"
              placeholderTextColor={colors.muted}
              onChangeText={(value) => { setAnswer(value); setWrong(false); }}
              style={styles.input}
            />
            {wrong ? <Text style={styles.error}>Answer rejected. Recheck the clues.</Text> : null}
            <PrimaryButton disabled={answer.trim().length !== 3} onPress={submit}>Submit answer  →</PrimaryButton>
          </>
        )}
      </AppShell>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.canvas },
  title: { color: colors.text, fontSize: 31, fontWeight: "700", letterSpacing: -1, marginTop: 11, marginBottom: 18 },
  body: { color: colors.body, fontSize: 12, lineHeight: 19, marginTop: 14 },
  clue: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 10 },
  question: { color: colors.text, fontSize: 12, lineHeight: 19, fontWeight: "700", marginTop: 14 },
  inputLabel: { color: colors.body, fontSize: 9, letterSpacing: 1, marginTop: 19, marginBottom: 8 },
  input: { height: 52, borderRadius: 10, paddingHorizontal: 15, color: colors.text, backgroundColor: colors.panelSoft, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.edge, fontSize: 16, textTransform: "uppercase" },
  error: { color: colors.error, fontSize: 11, marginTop: 9 },
  locked: { marginTop: 45, alignItems: "center", padding: 24 },
  lock: { color: colors.muted, fontSize: 42 },
  successPanel: { paddingTop: 50, alignItems: "center" },
  successIcon: { color: colors.success, fontSize: 46, marginBottom: 14 },
  successTitle: { color: colors.text, fontSize: 27, fontWeight: "700", marginTop: 9 }
});
