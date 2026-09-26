import { useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithCredential,
  signInWithEmailAndPassword
} from "@react-native-firebase/auth";
import {
  GoogleSignin,
  isErrorWithCode,
  statusCodes
} from "@react-native-google-signin/google-signin";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme";
import { useFirebaseEmulators } from "../services/firebase/config";

const logo = require("../../assets/ov.jpeg");
const googleIcon = require("../../assets/google-g.png");
const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

if (Platform.OS !== "web") {
  GoogleSignin.configure(googleWebClientId ? { webClientId: googleWebClientId } : {});
}

export function LoginScreen() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDemoTeam, setSelectedDemoTeam] = useState<"alpha" | "bravo">("alpha");
  const [showCustomLogin, setShowCustomLogin] = useState(false);
  const [customEmail, setCustomEmail] = useState("");
  const [customPassword, setCustomPassword] = useState("");

  const demoAccounts = {
    alpha: {
      email: process.env.EXPO_PUBLIC_DEMO_EMAIL ?? "demoseeker@openverse.net",
      password: process.env.EXPO_PUBLIC_DEMO_PASSWORD ?? "demoseeker123",
      label: "Alpha Team (Demo 1)",
    },
    bravo: {
      email: process.env.EXPO_PUBLIC_DEMO_EMAIL_BRAVO ?? "demoseeker2@openverse.net",
      password: process.env.EXPO_PUBLIC_DEMO_PASSWORD_BRAVO ?? "demoseeker123",
      label: "Bravo Team (Demo 2)",
    }
  };

  const signInWithGoogle = async () => {
    if (Platform.OS === "web") {
      setError("Google sign-in is available in the Android app.");
      return;
    }

    if (!googleWebClientId) {
      setError("Google sign-in is not configured yet.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const signInResult = await GoogleSignin.signIn();

      if (signInResult.type === "cancelled") return;

      const idToken = signInResult.data.idToken;
      if (!idToken) throw new Error("Google did not return an ID token.");
      if (!signInResult.data.user.email.toLowerCase().endsWith("@iiitkottayam.ac.in")) {
        await GoogleSignin.signOut();
        setError("Use your verified @iiitkottayam.ac.in account.");
        return;
      }

      const credential = GoogleAuthProvider.credential(idToken);
      await signInWithCredential(getAuth(), credential);
    } catch (signInError) {
      if (isErrorWithCode(signInError) && signInError.code === statusCodes.SIGN_IN_CANCELLED) {
        return;
      } else if (isErrorWithCode(signInError) && signInError.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        setError("Google Play Services is unavailable on this device.");
      } else {
        setError("Google sign-in failed. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const signInDemo = async (team: "alpha" | "bravo") => {
    const creds = demoAccounts[team];
    setSubmitting(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(getAuth(), creds.email, creds.password);
    } catch (err: unknown) {
      try {
        await createUserWithEmailAndPassword(getAuth(), creds.email, creds.password);
      } catch (createErr: unknown) {
        const message = (err as Error)?.message ?? (createErr as Error)?.message ?? "Demo sign-in failed.";
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const signInCustom = async () => {
    if (!customEmail.trim() || !customPassword.trim()) {
      setError("Please enter both email and password.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(getAuth(), customEmail.trim(), customPassword.trim());
    } catch (err: unknown) {
      try {
        await createUserWithEmailAndPassword(getAuth(), customEmail.trim(), customPassword.trim());
      } catch (createErr: unknown) {
        const message = (err as Error)?.message ?? (createErr as Error)?.message ?? "Sign-in failed.";
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const signInLocally = async () => {
    const email = process.env.EXPO_PUBLIC_EMULATOR_EMAIL ?? "seeker1@iiitkottayam.ac.in";
    const password = process.env.EXPO_PUBLIC_EMULATOR_PASSWORD ?? "openverse-dev";
    setSubmitting(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(getAuth(), email, password);
    } catch {
      setError("Local sign-in failed. Start and seed the Firebase emulators first.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View pointerEvents="none" style={styles.headerArc} />

        <View style={styles.brand}>
          <Text style={styles.brandName}>OPENVERSE</Text>
          <Text style={styles.brandSubtitle}>SEEKER ACCESS</Text>
        </View>

        <View style={styles.logoStage}>
          <Image accessibilityLabel="Openverse logo" source={logo} style={styles.logo} resizeMode="contain" />
        </View>

        <View style={styles.form}>
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Login with Google"
            disabled={submitting}
            onPress={() => void signInWithGoogle()}
            style={({ pressed }) => [
              styles.signInButton,
              submitting && styles.buttonDisabled,
              pressed && styles.buttonPressed
            ]}
          >
            <View style={styles.googleMark}>
              <Image source={googleIcon} style={styles.googleMarkImage} resizeMode="contain" />
            </View>
            <Text style={styles.signInText}>{submitting ? "Connecting…" : "Login with Google"}</Text>
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>TEST & DEMO ACCESS</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Demo Login Button */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Demo Login"
            disabled={submitting}
            onPress={() => void signInDemo(selectedDemoTeam)}
            style={({ pressed }) => [
              styles.demoButton,
              submitting && styles.buttonDisabled,
              pressed && styles.buttonPressed
            ]}
          >
            <View style={styles.demoBadge}>
              <Text style={styles.demoBadgeText}>⚡</Text>
            </View>
            <View style={styles.demoTextContainer}>
              <Text style={styles.demoButtonTitle}>
                {submitting ? "Authenticating…" : "Demo Login"}
              </Text>
              <Text style={styles.demoButtonSubtitle}>
                {demoAccounts[selectedDemoTeam].label} · {demoAccounts[selectedDemoTeam].email}
              </Text>
            </View>
          </Pressable>

          {/* Team Switcher Tabs for Demo */}
          <View style={styles.demoSwitcherRow}>
            <Pressable
              accessibilityRole="button"
              disabled={submitting}
              onPress={() => setSelectedDemoTeam("alpha")}
              style={[
                styles.demoSwitchPill,
                selectedDemoTeam === "alpha" && styles.demoSwitchPillActive
              ]}
            >
              <Text
                style={[
                  styles.demoSwitchPillText,
                  selectedDemoTeam === "alpha" && styles.demoSwitchPillTextActive
                ]}
              >
                Team Alpha (Demo 1)
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={submitting}
              onPress={() => setSelectedDemoTeam("bravo")}
              style={[
                styles.demoSwitchPill,
                selectedDemoTeam === "bravo" && styles.demoSwitchPillActive
              ]}
            >
              <Text
                style={[
                  styles.demoSwitchPillText,
                  selectedDemoTeam === "bravo" && styles.demoSwitchPillTextActive
                ]}
              >
                Team Bravo (Demo 2)
              </Text>
            </Pressable>
          </View>

          {/* Toggle for custom test credentials */}
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowCustomLogin((prev) => !prev)}
            style={styles.toggleCustomButton}
          >
            <Text style={styles.toggleCustomText}>
              {showCustomLogin ? "Hide custom tester login ▲" : "Custom tester credentials ▼"}
            </Text>
          </Pressable>

          {showCustomLogin ? (
            <View style={styles.customLoginBox}>
              <TextInput
                style={styles.input}
                placeholder="Tester email"
                placeholderTextColor="#687289"
                value={customEmail}
                onChangeText={setCustomEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <TextInput
                style={styles.input}
                placeholder="Tester password"
                placeholderTextColor="#687289"
                value={customPassword}
                onChangeText={setCustomPassword}
                secureTextEntry
              />
              <Pressable
                accessibilityRole="button"
                disabled={submitting}
                onPress={() => void signInCustom()}
                style={({ pressed }) => [
                  styles.customSubmitButton,
                  submitting && styles.buttonDisabled,
                  pressed && styles.buttonPressed
                ]}
              >
                <Text style={styles.customSubmitText}>Sign In with Test Account</Text>
              </Pressable>
            </View>
          ) : null}

          {useFirebaseEmulators ? (
            <Pressable
              accessibilityRole="button"
              disabled={submitting}
              onPress={() => void signInLocally()}
              style={({ pressed }) => [styles.localButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.localButtonText}>Use local emulator account</Text>
            </Pressable>
          ) : null}

          <Text style={styles.helper}>Production requires @iiitkottayam.ac.in account</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#000000" },
  content: {
    flexGrow: 1,
    minHeight: 720,
    paddingHorizontal: 24,
    paddingBottom: 34,
    backgroundColor: "#000000"
  },
  headerArc: {
    position: "absolute",
    top: -92,
    alignSelf: "center",
    width: 340,
    height: 198,
    borderRadius: 170,
    backgroundColor: "#141B36"
  },
  brand: { alignItems: "center", paddingTop: 18 },
  brandName: {
    color: colors.text,
    fontSize: 27,
    fontWeight: "500",
    letterSpacing: 0.4
  },
  brandSubtitle: {
    marginTop: 7,
    color: "#8E95A7",
    fontSize: 10,
    fontWeight: "500",
    letterSpacing: 0.3
  },
  logoStage: {
    flex: 1,
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center"
  },
  logo: { width: 220, height: 220 },
  form: { minHeight: 280, paddingTop: 30, paddingBottom: 22 },
  error: {
    marginBottom: 10,
    color: colors.error,
    fontSize: 12,
    textAlign: "center"
  },
  signInButton: {
    height: 50,
    borderRadius: 25,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#141B36"
  },
  googleMark: {
    width: 22,
    height: 22,
    marginRight: 10,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF"
  },
  googleMarkImage: { width: 15, height: 15 },
  signInText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 18
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "rgba(154, 201, 249, 0.15)"
  },
  dividerText: {
    marginHorizontal: 12,
    color: "#6D7895",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2
  },
  demoButton: {
    height: 54,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    backgroundColor: "#0F182E",
    borderWidth: 1,
    borderColor: "rgba(154, 201, 249, 0.35)"
  },
  demoBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(123, 224, 189, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(123, 224, 189, 0.4)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12
  },
  demoBadgeText: {
    fontSize: 16
  },
  demoTextContainer: {
    flex: 1,
    justifyContent: "center"
  },
  demoButtonTitle: {
    color: "#EEF6FF",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.2
  },
  demoButtonSubtitle: {
    color: "#8FA3C7",
    fontSize: 11,
    marginTop: 2
  },
  demoSwitcherRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10
  },
  demoSwitchPill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#0A0F1D",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center"
  },
  demoSwitchPillActive: {
    backgroundColor: "rgba(154, 201, 249, 0.12)",
    borderColor: "rgba(154, 201, 249, 0.5)"
  },
  demoSwitchPillText: {
    color: "#6D7895",
    fontSize: 11,
    fontWeight: "600"
  },
  demoSwitchPillTextActive: {
    color: "#9AC9F9"
  },
  toggleCustomButton: {
    marginTop: 14,
    alignItems: "center",
    paddingVertical: 6
  },
  toggleCustomText: {
    color: "#7E8AA6",
    fontSize: 11,
    fontWeight: "500"
  },
  customLoginBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#0A0F1D",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    gap: 8
  },
  input: {
    height: 42,
    borderRadius: 8,
    backgroundColor: "#11182B",
    paddingHorizontal: 12,
    color: "#EEF6FF",
    fontSize: 13,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)"
  },
  customSubmitButton: {
    height: 40,
    borderRadius: 8,
    backgroundColor: "#1B2A52",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4
  },
  customSubmitText: {
    color: "#EEF6FF",
    fontSize: 12,
    fontWeight: "600"
  },
  helper: {
    marginTop: 22,
    color: "#787F91",
    fontSize: 12,
    textAlign: "center"
  },
  localButton: { marginTop: 12, paddingVertical: 10, alignItems: "center" },
  localButtonText: { color: "#8E95A7", fontSize: 12, fontWeight: "600" },
  buttonDisabled: { opacity: 0.65 },
  buttonPressed: { opacity: 0.82 }
});
