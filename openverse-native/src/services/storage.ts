import AsyncStorage from "@react-native-async-storage/async-storage";
import type { GameState, StoredPosition } from "../types";

const GAME_KEY = "openverse.game.v1";
export const LOCATION_KEY = "openverse.locations.v1";
const MAX_LOCATION_SAMPLES = 500;

const initialGameState: GameState = {
  claimedArtifactIds: [],
  solvedPuzzleIds: [],
  lastScannedPayload: null,
  activePuzzle: null,
  teamArtifactsClaimed: null
};

export async function loadGameState(): Promise<GameState> {
  const raw = await AsyncStorage.getItem(GAME_KEY);
  if (!raw) return initialGameState;

  try {
    return { ...initialGameState, ...JSON.parse(raw) } as GameState;
  } catch {
    return initialGameState;
  }
}

export async function saveGameState(state: GameState): Promise<void> {
  await AsyncStorage.setItem(GAME_KEY, JSON.stringify(state));
}

export async function appendLocations(incoming: StoredPosition[]): Promise<void> {
  const raw = await AsyncStorage.getItem(LOCATION_KEY);
  let current: StoredPosition[] = [];

  if (raw) {
    try {
      current = JSON.parse(raw) as StoredPosition[];
    } catch {
      current = [];
    }
  }

  const next = [...current, ...incoming].slice(-MAX_LOCATION_SAMPLES);
  await AsyncStorage.setItem(LOCATION_KEY, JSON.stringify(next));
}

export async function loadLocations(): Promise<StoredPosition[]> {
  const raw = await AsyncStorage.getItem(LOCATION_KEY);
  if (!raw) return [];

  try {
    return JSON.parse(raw) as StoredPosition[];
  } catch {
    return [];
  }
}

export async function clearLocations(): Promise<void> {
  await AsyncStorage.removeItem(LOCATION_KEY);
}

const sampleKey = (sample: StoredPosition) =>
  `${sample.timestamp}:${sample.latitude}:${sample.longitude}`;

export async function removeUploadedLocations(uploaded: StoredPosition[]): Promise<void> {
  const pending = await loadLocations();
  const uploadedKeys = new Set(uploaded.map(sampleKey));
  const remaining = pending.filter((sample) => !uploadedKeys.has(sampleKey(sample)));
  await AsyncStorage.setItem(LOCATION_KEY, JSON.stringify(remaining));
}
