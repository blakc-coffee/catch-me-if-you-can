import { api } from "../../../../convex/_generated/api";
import type {
  ClaimArtifactResponse,
  CreateOrSyncProfileRequest,
  CreateOrSyncProfileResponse,
  DeleteLocationHistoryResponse,
  GetMissionStateResponse,
  StopTrackingResponse,
  SubmitPuzzleAnswerResponse,
  UpdateTelemetryRequest,
  UpdateTelemetryResponse,
  UploadLocationBatchRequest,
  UploadLocationBatchResponse,
} from "../firebase/contract";
import { getConvexClient } from "./client";

function convexReason(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const message = "message" in error ? String((error as { message?: unknown }).message) : "";
  if (message.includes("Not authenticated")) return "UNAUTHENTICATED";
  if (message.includes("out of campus")) return "TELEMETRY_OUT_OF_BOUNDS";
  if (message.includes("accuracy")) return "TELEMETRY_LOW_ACCURACY";
  if (message.includes("not active")) return "PLAYER_ELIMINATED";
  if (message.includes("not on a team")) return "NO_TEAM";
  if (message.includes("Game has ended")) return "GAME_ENDED";
  if (message.includes("Game is not active")) return "GAME_NOT_ACTIVE";
  if (message.includes("Only seekers")) return "ROLE_NOT_ALLOWED";
  return "INTERNAL";
}

export { convexReason as getConvexReason };

export async function convexCreateOrSyncProfile(
  data: CreateOrSyncProfileRequest = {},
): Promise<CreateOrSyncProfileResponse> {
  const client = getConvexClient();
  return client.mutation(api.users.createOrSyncProfile, { name: data.name });
}

export async function convexUpdateTelemetry(
  data: UpdateTelemetryRequest,
): Promise<UpdateTelemetryResponse> {
  const client = getConvexClient();
  return client.mutation(api.telemetry.updateTelemetry, data);
}

export async function convexStopRemoteTracking(): Promise<StopTrackingResponse> {
  const client = getConvexClient();
  return client.mutation(api.telemetry.stopTracking, {});
}

export async function convexUploadLocationBatch(
  data: UploadLocationBatchRequest,
): Promise<UploadLocationBatchResponse> {
  const client = getConvexClient();
  return client.mutation(api.telemetry.uploadLocationBatch, data);
}

export async function convexDeleteRemoteLocationHistory(): Promise<DeleteLocationHistoryResponse> {
  const client = getConvexClient();
  return client.mutation(api.telemetry.deleteLocationHistory, {});
}

export async function convexGetMissionState(): Promise<GetMissionStateResponse> {
  const client = getConvexClient();
  return client.query(api.game.getMissionState, {});
}

export async function convexClaimArtifact(_payload: string): Promise<ClaimArtifactResponse> {
  throw new Error("claimArtifact not yet migrated to Convex — use Firebase path temporarily");
}

export async function convexSubmitPuzzleAnswer(
  _puzzleId: string,
  _answer: string,
): Promise<SubmitPuzzleAnswerResponse> {
  throw new Error("submitPuzzleAnswer not yet migrated to Convex — use Firebase path temporarily");
}
