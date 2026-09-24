export type AppRoute = "mission" | "scanner" | "case" | "tracking";

export type StoredPosition = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
};

export type GameState = {
  claimedArtifactIds: string[];
  lastScannedPayload: string | null;
};
