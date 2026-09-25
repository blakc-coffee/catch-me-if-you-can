import { callable } from "../lib/callable.js";
import { claimArtifact as claimArtifactHandler } from "./claimArtifact.js";

export const claimArtifact = callable("claimArtifact", claimArtifactHandler, { sensitive: true });
