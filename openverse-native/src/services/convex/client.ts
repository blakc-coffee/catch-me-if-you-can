import { ConvexReactClient } from "convex/react";
import { getAuth } from "@react-native-firebase/auth";

const convexUrl =
  process.env.EXPO_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3210";

let client: ConvexReactClient | null = null;

export function getConvexClient(): ConvexReactClient {
  if (!client) {
    client = new ConvexReactClient(convexUrl, { unsavedChangesWarning: false });
    client.setAuth(async () => {
      const user = getAuth().currentUser;
      if (!user) return null;
      return user.getIdToken();
    });
  }
  return client;
}

export function convexConfigured(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_CONVEX_URL || __DEV__);
}
