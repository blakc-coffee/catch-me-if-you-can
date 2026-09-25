import { getAuth } from "@react-native-firebase/auth";
import { getFunctions, httpsCallable } from "@react-native-firebase/functions";
import {
  CALLABLES,
  FUNCTIONS_REGION,
  type ClaimArtifactRequest,
  type ClaimArtifactResponse,
  type CreateOrSyncProfileRequest,
  type CreateOrSyncProfileResponse,
  type SubmitPuzzleAnswerRequest,
  type SubmitPuzzleAnswerResponse,
  type DeleteLocationHistoryResponse,
  type StopTrackingResponse,
  type UpdateTelemetryRequest,
  type UpdateTelemetryResponse,
  type UploadLocationBatchRequest,
  type UploadLocationBatchResponse,
} from "./contract";

const functions = () => getFunctions(undefined, FUNCTIONS_REGION);

async function call<Req, Res>(name: string, data: Req): Promise<Res> {
  const result = await httpsCallable<Req, Res>(functions(), name)(data);
  return result.data;
}

export async function createOrSyncProfile(
  data: CreateOrSyncProfileRequest = {},
): Promise<CreateOrSyncProfileResponse> {
  const response = await call<CreateOrSyncProfileRequest, CreateOrSyncProfileResponse>(
    CALLABLES.createOrSyncProfile,
    data,
  );
  if (response.claimsUpdated) await getAuth().currentUser?.getIdToken(true);
  return response;
}

export const claimArtifact = (payload: string) =>
  call<ClaimArtifactRequest, ClaimArtifactResponse>(CALLABLES.claimArtifact, { payload });

export const submitPuzzleAnswer = (puzzleId: string, answer: string) =>
  call<SubmitPuzzleAnswerRequest, SubmitPuzzleAnswerResponse>(CALLABLES.submitPuzzleAnswer, {
    puzzleId,
    answer,
  });

export const updateTelemetry = (data: UpdateTelemetryRequest) =>
  call<UpdateTelemetryRequest, UpdateTelemetryResponse>(CALLABLES.updateTelemetry, data);

export const uploadLocationBatch = (data: UploadLocationBatchRequest) =>
  call<UploadLocationBatchRequest, UploadLocationBatchResponse>(CALLABLES.uploadLocationBatch, data);

export const stopRemoteTracking = () =>
  call<Record<string, never>, StopTrackingResponse>(CALLABLES.stopTracking, {});

export const deleteRemoteLocationHistory = () =>
  call<Record<string, never>, DeleteLocationHistoryResponse>(CALLABLES.deleteLocationHistory, {});

export function getCallableReason(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const details = "details" in error ? (error as { details?: unknown }).details : undefined;
  if (!details || typeof details !== "object" || !("reason" in details)) return null;
  return typeof (details as { reason?: unknown }).reason === "string"
    ? (details as { reason: string }).reason
    : null;
}
