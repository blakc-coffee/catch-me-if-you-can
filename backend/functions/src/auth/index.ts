import { callable } from "../lib/callable.js";
import { assignUser as assignUserHandler } from "./assignUser.js";
import { createOrSyncProfile as createOrSyncProfileHandler } from "./profile.js";

export const createOrSyncProfile = callable("createOrSyncProfile", createOrSyncProfileHandler);
export const assignUser = callable("assignUser", assignUserHandler, { maxInstances: 2 });
