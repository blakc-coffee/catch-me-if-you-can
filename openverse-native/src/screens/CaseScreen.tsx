import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { AppShell } from "../components/AppShell";
import { Card, Eyebrow, PrimaryButton } from "../components/Primitives";
import { colors } from "../theme";
import type { AppRoute } from "../types";
import type { PuzzleDTO, SubmitPuzzleAnswerResponse } from "../services/firebase/contract";

export function CaseScreen({ solved, puzzle, onSolved, onNavigate }: { solved: boolean; puzzle: PuzzleDTO | null; onSolved: (answer: string) => Promise<SubmitPuzzleAnswerResponse>; onNavigate: (route: AppRoute) => void }) {
  const [answer, setAnswer] = useState("");
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await onSolved(answer);
      setWrong(result.status === "INCORRECT" || (result.status === "ALREADY_CLAIMED" && !result.solvedByYourTeam));
    } catch {
      setError("Could not submit the answer. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <AppShell active="case" title="SEEKER / CASE 01" onNavigate={onNavigate}>
        {!puzzle ? (
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
            <Text style={styles.successTitle}>Answer accepted.</Text>
            <Text style={styles.body}>The puzzle has been credited to your team.</Text>
            <PrimaryButton onPress={() => onNavigate("mission")}>Return to mission  →</PrimaryButton>
          </View>
        ) : (
          <>
            <Eyebrow>CASE 01 / 03</Eyebrow>
            <Text style={styles.title}>{puzzle.title}</Text>
            <Card>
              <Eyebrow>CASE FILE 01 / IDENTITY</Eyebrow>
              <Text style={styles.question}>{puzzle.question}</Text>
            </Card>

            <Text style={styles.inputLabel}>YOUR ANSWER</Text>
            <TextInput
              accessibilityLabel="Case answer"
              value={answer}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="Enter answer"
              placeholderTextColor={colors.muted}
              onChangeText={(value) => { setAnswer(value); setWrong(false); }}
              style={styles.input}
            />
            {wrong ? <Text style={styles.error}>Answer rejected. Recheck the clues.</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <PrimaryButton loading={busy} disabled={!answer.trim()} onPress={() => void submit()}>Submit answer  →</PrimaryButton>
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
