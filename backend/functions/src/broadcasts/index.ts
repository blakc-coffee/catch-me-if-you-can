import { callable } from "../lib/callable.js";
import { createBroadcast as createBroadcastHandler } from "./createBroadcast.js";

export const createBroadcast = callable("createBroadcast", createBroadcastHandler, { maxInstances: 5 });
