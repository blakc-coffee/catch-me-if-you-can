import { useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { GoogleAuthProvider, getAuth, signInWithCredential, signInWithEmailAndPassword } from "@react-native-firebase/auth";
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

          <Text style={styles.helper}>Use @iiitkottayam.ac.in mail ID</Text>
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
    minHeight: 330,
    alignItems: "center",
    justifyContent: "center"
  },
  logo: { width: 258, height: 258 },
  form: { minHeight: 238, paddingTop: 122, paddingBottom: 22 },
  error: {
    marginBottom: 8,
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
  helper: {
    marginTop: 27,
    color: "#787F91",
    fontSize: 12,
    textAlign: "center"
  },
  localButton: { marginTop: 12, paddingVertical: 10, alignItems: "center" },
  localButtonText: { color: "#8E95A7", fontSize: 12, fontWeight: "600" },
  buttonDisabled: { opacity: 0.65 },
  buttonPressed: { opacity: 0.82 }
});
