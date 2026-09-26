import { api } from "../../../../convex/_generated/api";
import type { GameSnapshot, ProfileSnapshot } from "../session/trackingPolicy";
import { getConvexClient } from "./client";

export function subscribeToProfile(
  firebaseUid: string,
  onUpdate: (profile: ProfileSnapshot | null) => void,
  onError?: (error: unknown) => void,
): () => void {
  const client = getConvexClient();
  return client.watchQuery(api.users.getProfileByFirebaseUid, { firebaseUid }).onUpdate(
    (result) => {
      if (!result) {
        onUpdate(null);
        return;
      }
      onUpdate({
        role: result.role,
        status: result.status,
        teamId: result.teamId,
      });
    },
    (error) => onError?.(error),
  );
}

export function subscribeToGameState(
  onUpdate: (game: GameSnapshot | null) => void,
  onError?: (error: unknown) => void,
): () => void {
  const client = getConvexClient();
  return client.watchQuery(api.game.getGameState, {}).onUpdate(
    (result) => {
      onUpdate({
        status: result.status,
        eventId: result.eventId,
      });
    },
    (error) => onError?.(error),
  );
}

export async function fetchProfileAndGame(firebaseUid: string): Promise<{
  profile: ProfileSnapshot | null;
  game: GameSnapshot | null;
}> {
  const client = getConvexClient();
  const [profileResult, gameResult] = await Promise.all([
    client.query(api.users.getProfileByFirebaseUid, { firebaseUid }),
    client.query(api.game.getGameState, {}),
  ]);
  return {
    profile: profileResult
      ? { role: profileResult.role, status: profileResult.status, teamId: profileResult.teamId }
      : null,
    game: gameResult ? { status: gameResult.status, eventId: gameResult.eventId } : null,
  };
}
