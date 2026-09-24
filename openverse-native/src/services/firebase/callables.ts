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

