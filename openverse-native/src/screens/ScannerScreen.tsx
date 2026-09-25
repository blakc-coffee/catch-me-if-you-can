import { useCallback, useState } from "react";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppShell } from "../components/AppShell";
import { Card, Eyebrow, PrimaryButton } from "../components/Primitives";
import { colors } from "../theme";
import type { AppRoute } from "../types";
import type { ClaimArtifactResponse } from "../services/firebase/contract";
import { getCallableReason } from "../services/firebase/callables";

export function ScannerScreen({ onNavigate, onScanned }: { onNavigate: (route: AppRoute) => void; onScanned: (payload: string) => Promise<ClaimArtifactResponse> }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [payload, setPayload] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [result, setResult] = useState<ClaimArtifactResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const handleBarcode = useCallback((result: BarcodeScanningResult) => {
    if (payload) return;
    setPayload(result.data);
    setVerifying(true);
    setError(null);
    void onScanned(result.data)
      .then(setResult)
      .catch((scanError) => {
        const reason = getCallableReason(scanError);
        setError(reason === "INVALID_ARTIFACT_CODE" ? "This QR code is not a valid artifact for your team." : "Artifact verification failed. Check your connection and try again.");
      })
      .finally(() => setVerifying(false));
  }, [onScanned, payload]);

  return (
    <AppShell active="scanner" title="ARTIFACT SCANNER" onNavigate={onNavigate} scroll={false}>
      <View style={styles.container}>
        <View style={styles.copy}>
          <Eyebrow>—  QR LINK ACTIVE  —</Eyebrow>
          <Text style={styles.title}>Align the artifact{`\n`}inside the frame.</Text>
          <Text style={styles.subtitle}>Valid QR artifacts unlock their case file automatically.</Text>
        </View>

        {!permission ? (
          <View style={styles.permissionPanel}><Text style={styles.subtitle}>Checking camera permission…</Text></View>
        ) : !permission.granted ? (
          <Card style={styles.permissionPanel}>
            <Text style={styles.permissionTitle}>Camera access required</Text>
            <Text style={styles.subtitle}>Openverse only uses the camera while this scanner is visible.</Text>
            <PrimaryButton onPress={requestPermission}>Allow camera</PrimaryButton>
          </Card>
        ) : (
          <View style={styles.cameraFrame}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={payload ? undefined : handleBarcode}
            />
            <View pointerEvents="none" style={styles.target}>
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
              <View style={styles.scanLine} />
            </View>
            <Pressable accessibilityRole="button" onPress={() => setTorch((value) => !value)} style={styles.torchButton}>
              <Text style={styles.torchText}>{torch ? "Torch on" : "Torch off"}</Text>
            </Pressable>
            <Text style={styles.cameraStatus}>{verifying ? "VERIFYING ARTIFACT" : result ? "ARTIFACT VERIFIED" : payload ? "VERIFICATION FAILED" : "SEARCHING FOR CODE"}</Text>
          </View>
        )}

        {result ? (
          <Card style={styles.result}>
            <Text style={styles.success}>{result.status === "DECOY" ? "○  DECOY ARTIFACT" : "✓  ARTIFACT CLAIMED"}</Text>
            <Text numberOfLines={1} style={styles.resultText}>{result.name}</Text>
            {result.status === "CLAIMED" && result.puzzle ? <PrimaryButton onPress={() => onNavigate("case")}>Open case file  →</PrimaryButton> : null}
            <Pressable onPress={() => { setPayload(null); setResult(null); setError(null); }}><Text style={styles.scanAgain}>Scan another code</Text></Pressable>
          </Card>
        ) : null}
        {error ? (
          <Card style={styles.result}>
            <Text style={styles.error}>{error}</Text>
            <Pressable onPress={() => { setPayload(null); setError(null); }}><Text style={styles.scanAgain}>Try another code</Text></Pressable>
          </Card>
        ) : null}
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 22, paddingTop: 22, paddingBottom: 88 },
  copy: { marginBottom: 18 },
  title: { color: colors.text, fontSize: 29, fontWeight: "700", letterSpacing: -1, lineHeight: 34, marginTop: 12 },
  subtitle: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 7 },
  permissionPanel: { minHeight: 250, justifyContent: "center", padding: 22 },
  permissionTitle: { color: colors.text, fontWeight: "700", fontSize: 19 },
  cameraFrame: { flex: 1, minHeight: 310, maxHeight: 430, borderRadius: 24, overflow: "hidden", backgroundColor: "#090D18" },
  target: { position: "absolute", top: 28, left: 28, right: 28, bottom: 60 },
  corner: { position: "absolute", width: 50, height: 50, borderColor: "#B6D9FC" },
  topLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  topRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  scanLine: { position: "absolute", left: 20, right: 20, top: "50%", height: 1, backgroundColor: colors.blue },
  cameraStatus: { position: "absolute", bottom: 22, left: 0, right: 0, textAlign: "center", color: colors.text, fontSize: 9, letterSpacing: 1.3 },
  torchButton: { position: "absolute", right: 16, top: 16, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18, backgroundColor: "rgba(5,6,15,0.75)" },
  torchText: { color: colors.text, fontSize: 10 },
  result: { marginTop: 12 },
  success: { color: colors.success, fontSize: 10, letterSpacing: 1.1, fontWeight: "700" },
  resultText: { color: colors.text, fontSize: 12, marginTop: 7 },
  error: { color: colors.error, fontSize: 12, lineHeight: 18 },
  scanAgain: { color: colors.body, textAlign: "center", fontSize: 11, marginTop: 14 }
});
