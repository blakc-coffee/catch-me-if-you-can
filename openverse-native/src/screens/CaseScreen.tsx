import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { AppShell } from "../components/AppShell";
import { Card, Eyebrow, PrimaryButton } from "../components/Primitives";
import { colors } from "../theme";
import type { AppRoute, UnlockedPuzzle } from "../types";
import type { SubmitPuzzleAnswerResponse } from "../services/firebase/contract";
import { caseHeader } from "../services/session/caseView";

export function CaseScreen({ puzzles, activePuzzleId, onSelect, onSolved, onNavigate }: {
  puzzles: UnlockedPuzzle[];
  activePuzzleId: string | null;
  onSelect: (puzzleId: string | null) => void;
  onSolved: (puzzleId: string, answer: string) => Promise<SubmitPuzzleAnswerResponse>;
  onNavigate: (route: AppRoute) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [wrong, setWrong] = useState(false);
  const [lockedOut, setLockedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const puzzle = puzzles.find((p) => p.puzzleId === activePuzzleId) ?? null;
  const header = caseHeader(puzzles, activePuzzleId);

  useEffect(() => {
    setAnswer("");
    setWrong(false);
    setLockedOut(false);
    setError(null);
  }, [activePuzzleId]);

  const submit = async () => {
    if (!puzzle) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onSolved(puzzle.puzzleId, answer);
      setWrong(result.status === "INCORRECT");
      setLockedOut(result.status === "ALREADY_CLAIMED" && !result.solvedByYourTeam);
    } catch {
      setError("Could not submit the answer. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (puzzles.length === 0) {
    body = (
      <Card style={styles.locked}>
        <Text style={styles.lock}>⌁</Text>
        <Text style={styles.title}>No case files yet</Text>
        <Text style={styles.body}>Scan a valid artifact QR code to unlock a case file.</Text>
        <PrimaryButton onPress={() => onNavigate("scanner")}>Open scanner</PrimaryButton>
      </Card>
    );
  } else if (!puzzle) {
    body = (
      <>
        <Text style={styles.title}>Case files</Text>
        {puzzles.map((p) => (
          <Pressable key={p.puzzleId} accessibilityRole="button" onPress={() => onSelect(p.puzzleId)}>
            <Card style={styles.listItem}>
              <Eyebrow color={p.solvedByYourTeam ? colors.success : p.solved ? colors.muted : colors.blue}>
                {p.puzzleId.toUpperCase()}  /  {p.solvedByYourTeam ? "SOLVED BY YOUR TEAM" : p.solved ? "SOLVED BY ANOTHER TEAM" : "OPEN"}
              </Eyebrow>
              <Text style={styles.listTitle}>{p.title}</Text>
            </Card>
          </Pressable>
        ))}
      </>
    );
  } else if (puzzle.solvedByYourTeam) {
    body = (
      <View style={styles.successPanel}>
        <Text style={styles.successIcon}>✓</Text>
        <Eyebrow color={colors.success}>CASE VERIFIED</Eyebrow>
        <Text style={styles.successTitle}>{puzzle.title}</Text>
        <Text style={styles.body}>The puzzle has been credited to your team.</Text>
        <PrimaryButton onPress={() => onSelect(null)}>All case files  →</PrimaryButton>
      </View>
    );
  } else {
    body = (
      <>
        <Pressable accessibilityRole="button" onPress={() => onSelect(null)}><Text style={styles.back}>‹  All case files</Text></Pressable>
        <Eyebrow>{header.position}</Eyebrow>
        <Text style={styles.title}>{puzzle.title}</Text>
        <Card>
          <Eyebrow>CASE FILE / {puzzle.puzzleId.toUpperCase()}</Eyebrow>
          <Text style={styles.question}>{puzzle.question}</Text>
        </Card>

        {puzzle.solved || lockedOut ? (
          <Text style={styles.error}>Another team solved this case first.</Text>
        ) : (
          <>
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
      </>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <AppShell active="case" title={header.title} onNavigate={onNavigate}>
        {body}
      </AppShell>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.canvas },
  title: { color: colors.text, fontSize: 31, fontWeight: "700", letterSpacing: -1, marginTop: 11, marginBottom: 18 },
  body: { color: colors.body, fontSize: 12, lineHeight: 19, marginTop: 14 },
  question: { color: colors.text, fontSize: 12, lineHeight: 19, fontWeight: "700", marginTop: 14 },
  inputLabel: { color: colors.body, fontSize: 9, letterSpacing: 1, marginTop: 19, marginBottom: 8 },
  input: { height: 52, borderRadius: 10, paddingHorizontal: 15, color: colors.text, backgroundColor: colors.panelSoft, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.edge, fontSize: 16, textTransform: "uppercase" },
  error: { color: colors.error, fontSize: 11, marginTop: 9 },
  locked: { marginTop: 45, alignItems: "center", padding: 24 },
  lock: { color: colors.muted, fontSize: 42 },
  listItem: { marginBottom: 12 },
  listTitle: { color: colors.text, fontSize: 17, fontWeight: "700", marginTop: 8 },
  back: { color: colors.body, fontSize: 12, marginBottom: 6 },
  successPanel: { paddingTop: 50, alignItems: "center" },
  successIcon: { color: colors.success, fontSize: 46, marginBottom: 14 },
  successTitle: { color: colors.text, fontSize: 27, fontWeight: "700", marginTop: 9 }
});
