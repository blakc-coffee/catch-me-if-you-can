import { callable } from "../lib/callable.js";
import { joinTeam as joinTeamHandler } from "./joinTeam.js";

export const joinTeam = callable("joinTeam", joinTeamHandler);
