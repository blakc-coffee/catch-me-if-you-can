import { callable } from "../lib/callable.js";
import * as admin from "./admin.js";

export const setGameStatus = callable("setGameStatus", admin.setGameStatus, { maxInstances: 2, timeoutSeconds: 120 });
export const eliminatePlayer = callable("eliminatePlayer", admin.eliminatePlayer, { maxInstances: 5 });
