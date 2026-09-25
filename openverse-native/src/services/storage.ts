import AsyncStorage from "@react-native-async-storage/async-storage";
import { ScopedStore } from "./session/localStore";

/**
 * Sensitive on-device state (game progress, queued GPS samples), namespaced by
 * Firebase UID and game event. See session/localStore and session/scope.
 */
export const localStore = new ScopedStore(AsyncStorage);
