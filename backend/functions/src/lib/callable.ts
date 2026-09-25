import { logger } from "firebase-functions";
import { HttpsError, onCall, type CallableFunction } from "firebase-functions/v2/https";
import { APP_CHECK, REGION } from "../config.js";
import { contextFromRequest, type CallContext } from "./context.js";

export type Handler<Res> = (ctx: CallContext, data: unknown) => Promise<Res>;

interface CallableOptions {
  timeoutSeconds?: number;
  memory?: "256MiB" | "512MiB";
  maxInstances?: number;
  /** Accepts location, artifact codes or answers: App Check is enforced in production (see config APP_CHECK). */
  sensitive?: boolean;
}

if (!APP_CHECK.sensitive) {
  logger.warn("App Check is not enforced for sensitive callables (emulator or ENFORCE_APP_CHECK=false).");
}

/**
 * Wraps a handler as a v2 callable: authentication is required, App Check is
 * enforced per the APP_CHECK policy, and any non-HttpsError is logged server-side and
 * surfaced as a generic INTERNAL error so stack traces and data never leak.
 */
export function callable<Res>(name: string, handler: Handler<Res>, opts: CallableOptions = {}): CallableFunction<unknown, Promise<Res>> {
  return onCall(
    {
      region: REGION,
      enforceAppCheck: opts.sensitive ? APP_CHECK.sensitive : APP_CHECK.standard,
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
