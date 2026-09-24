import { logger } from "firebase-functions";
import { HttpsError, onCall, type CallableFunction } from "firebase-functions/v2/https";
import { ENFORCE_APP_CHECK, REGION } from "../config.js";
import { contextFromRequest, type CallContext } from "./context.js";

export type Handler<Res> = (ctx: CallContext, data: unknown) => Promise<Res>;

interface CallableOptions {
  timeoutSeconds?: number;
  memory?: "256MiB" | "512MiB";
  maxInstances?: number;
}

/**
 * Wraps a handler as a v2 callable: authentication is required, App Check is
 * enforced when configured, and any non-HttpsError is logged server-side and
 * surfaced as a generic INTERNAL error so stack traces and data never leak.
 */
export function callable<Res>(name: string, handler: Handler<Res>, opts: CallableOptions = {}): CallableFunction<unknown, Promise<Res>> {
  return onCall(
    {
      region: REGION,
      enforceAppCheck: ENFORCE_APP_CHECK,
      timeoutSeconds: opts.timeoutSeconds ?? 30,
      memory: opts.memory ?? "256MiB",
      maxInstances: opts.maxInstances ?? 20,
      concurrency: 40,
    },
    async (request) => {
      const ctx = contextFromRequest(request);
      try {
        return await handler(ctx, request.data);
      } catch (err) {
        if (err instanceof HttpsError) throw err;
        logger.error(`${name} failed`, { uid: ctx.uid, error: err instanceof Error ? err.message : String(err) });
        throw new HttpsError("internal", "Internal error.", { reason: "INTERNAL" });
      }
    },
  );
}
