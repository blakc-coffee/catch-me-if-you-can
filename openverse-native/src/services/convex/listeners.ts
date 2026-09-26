import { api } from "../../../../convex/_generated/api";
import type { GameSnapshot, ProfileSnapshot } from "../session/trackingPolicy";
import { getConvexClient } from "./client";

function emitProfileUpdate(
  watch: ReturnType<ReturnType<typeof getConvexClient>["watchQuery"]>,
  onUpdate: (profile: ProfileSnapshot | null) => void,
  onError?: (error: unknown) => void,
): void {
  try {
    const result = watch.localQueryResult();
    if (!result) {
      onUpdate(null);
      return;
    }
    onUpdate({
      role: result.role,
      status: result.status,
      teamId: result.teamId,
    });
  } catch (error) {
    onError?.(error);
  }
}

export function subscribeToProfile(
  firebaseUid: string,
  onUpdate: (profile: ProfileSnapshot | null) => void,
  onError?: (error: unknown) => void,
): () => void {
  const client = getConvexClient();
  const watch = client.watchQuery(api.users.getProfileByFirebaseUid, { firebaseUid });
  return watch.onUpdate(() => emitProfileUpdate(watch, onUpdate, onError));
}

export function subscribeToGameState(
  onUpdate: (game: GameSnapshot | null) => void,
  onError?: (error: unknown) => void,
): () => void {
  const client = getConvexClient();
  const watch = client.watchQuery(api.game.getGameState, {});
  return watch.onUpdate(() => {
    try {
      const result = watch.localQueryResult();
      if (!result) {
        onUpdate(null);
        return;
      }
      onUpdate({
        status: result.status,
        eventId: result.eventId,
      });
    } catch (error) {
      onError?.(error);
    }
  });
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
