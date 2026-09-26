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
  type GetMissionStateRequest,
  type GetMissionStateResponse,
  type StopTrackingResponse,
  type UpdateTelemetryRequest,
  type UpdateTelemetryResponse,
  type UploadLocationBatchRequest,
  type UploadLocationBatchResponse,
} from "./contract";
import { useFirebaseEmulators } from "./config";
import {
  directClaimArtifact,
  directCreateOrSyncProfile,
  directDeleteRemoteLocationHistory,
  directGetMissionState,
  directStopRemoteTracking,
  directSubmitPuzzleAnswer,
  directUpdateTelemetry,
  directUploadLocationBatch,
} from "./directFirestore";
import {
  convexClaimArtifact,
  convexCreateOrSyncProfile,
  convexDeleteRemoteLocationHistory,
  convexGetMissionState,
  getConvexReason,
  convexStopRemoteTracking,
  convexSubmitPuzzleAnswer,
  convexUpdateTelemetry,
  convexUploadLocationBatch,
} from "../convex/api";
import { convexConfigured } from "../convex/client";

const useConvexBackend = convexConfigured() && !useFirebaseEmulators;

const functions = () => getFunctions(undefined, FUNCTIONS_REGION);

async function call<Req, Res>(name: string, data: Req): Promise<Res> {
  const result = await httpsCallable<Req, Res>(functions(), name)(data);
  return result.data;
}

export async function createOrSyncProfile(
  data: CreateOrSyncProfileRequest = {},
): Promise<CreateOrSyncProfileResponse> {
  if (useConvexBackend) {
    return convexCreateOrSyncProfile(data);
  }
  if (!useFirebaseEmulators) {
    return directCreateOrSyncProfile(data);
  }
  try {
    const response = await call<CreateOrSyncProfileRequest, CreateOrSyncProfileResponse>(
      CALLABLES.createOrSyncProfile,
      data,
    );
    if (response.claimsUpdated) await getAuth().currentUser?.getIdToken(true);
    return response;
  } catch (err) {
    console.warn("Callable createOrSyncProfile failed, falling back to direct Firestore", err);
    return directCreateOrSyncProfile(data);
  }
}

export const claimArtifact = async (payload: string): Promise<ClaimArtifactResponse> => {
  if (useConvexBackend) {
    try {
      return await convexClaimArtifact(payload);
    } catch {
      return directClaimArtifact(payload);
    }
  }
  if (!useFirebaseEmulators) {
    return directClaimArtifact(payload);
  }
  try {
    return await call<ClaimArtifactRequest, ClaimArtifactResponse>(CALLABLES.claimArtifact, {
      payload,
    });
  } catch (err) {
    console.warn("Callable claimArtifact failed, falling back to direct Firestore", err);
    return directClaimArtifact(payload);
  }
};

export const submitPuzzleAnswer = async (
  puzzleId: string,
  answer: string,
): Promise<SubmitPuzzleAnswerResponse> => {
  if (useConvexBackend) {
    try {
      return await convexSubmitPuzzleAnswer(puzzleId, answer);
    } catch {
      return directSubmitPuzzleAnswer(puzzleId, answer);
    }
  }
  if (!useFirebaseEmulators) {
    return directSubmitPuzzleAnswer(puzzleId, answer);
  }
  try {
    return await call<SubmitPuzzleAnswerRequest, SubmitPuzzleAnswerResponse>(
      CALLABLES.submitPuzzleAnswer,
      { puzzleId, answer },
    );
  } catch (err) {
    console.warn("Callable submitPuzzleAnswer failed, falling back to direct Firestore", err);
    return directSubmitPuzzleAnswer(puzzleId, answer);
  }
};

export const updateTelemetry = async (
  data: UpdateTelemetryRequest,
): Promise<UpdateTelemetryResponse> => {
  if (useConvexBackend) {
    return convexUpdateTelemetry(data);
  }
  if (!useFirebaseEmulators) {
    return directUpdateTelemetry(data);
  }
  try {
    return await call<UpdateTelemetryRequest, UpdateTelemetryResponse>(
      CALLABLES.updateTelemetry,
      data,
    );
  } catch (err) {
    console.warn("Callable updateTelemetry failed, falling back to direct Firestore", err);
    return directUpdateTelemetry(data);
  }
};

export const uploadLocationBatch = async (
  data: UploadLocationBatchRequest,
): Promise<UploadLocationBatchResponse> => {
  if (useConvexBackend) {
    return convexUploadLocationBatch(data);
  }
  if (!useFirebaseEmulators) {
    return directUploadLocationBatch(data);
  }
  try {
    return await call<UploadLocationBatchRequest, UploadLocationBatchResponse>(
      CALLABLES.uploadLocationBatch,
      data,
    );
  } catch (err) {
    console.warn("Callable uploadLocationBatch failed, falling back to direct Firestore", err);
    return directUploadLocationBatch(data);
  }
};

export const getMissionState = async (): Promise<GetMissionStateResponse> => {
  if (useConvexBackend) {
    return convexGetMissionState();
  }
  if (!useFirebaseEmulators) {
    return directGetMissionState();
  }
  try {
    return await call<GetMissionStateRequest, GetMissionStateResponse>(
      CALLABLES.getMissionState,
      {},
    );
  } catch (err) {
    console.warn("Callable getMissionState failed, falling back to direct Firestore", err);
    return directGetMissionState();
  }
};

export const stopRemoteTracking = async (): Promise<StopTrackingResponse> => {
  if (useConvexBackend) {
    return convexStopRemoteTracking();
  }
  if (!useFirebaseEmulators) {
    return directStopRemoteTracking();
  }
  try {
    return await call<Record<string, never>, StopTrackingResponse>(CALLABLES.stopTracking, {});
  } catch (err) {
    console.warn("Callable stopRemoteTracking failed, falling back to direct Firestore", err);
    return directStopRemoteTracking();
  }
};

export const deleteRemoteLocationHistory = async (): Promise<DeleteLocationHistoryResponse> => {
  if (useConvexBackend) {
    return convexDeleteRemoteLocationHistory();
  }
  if (!useFirebaseEmulators) {
    return directDeleteRemoteLocationHistory();
  }
  try {
    return await call<Record<string, never>, DeleteLocationHistoryResponse>(
      CALLABLES.deleteLocationHistory,
      {},
    );
  } catch (err) {
    console.warn("Callable deleteRemoteLocationHistory failed, falling back to direct Firestore", err);
    return directDeleteRemoteLocationHistory();
  }
};

export function getCallableReason(error: unknown): string | null {
  const convexReason = convexGetReason(error);
  if (convexReason) return convexReason;
  if (!error || typeof error !== "object") return null;
  const details = "details" in error ? (error as { details?: unknown }).details : undefined;
  if (!details || typeof details !== "object" || !("reason" in details)) return null;
  return typeof (details as { reason?: unknown }).reason === "string"
    ? (details as { reason: string }).reason
    : null;
}
