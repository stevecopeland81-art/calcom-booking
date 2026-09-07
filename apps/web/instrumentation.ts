// biome-ignore-all lint/correctness/noProcessGlobal: Next.js replaces global process.env runtime checks when separating Node and Edge bundles.
import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startCalendarSyncWorker } = await import("./modules/rythms/calendar-sync/worker");
    startCalendarSyncWorker();
  }
  if (process.env.NODE_ENV === "production") {
    if (process.env.NEXT_PUBLIC_SENTRY_DSN && process.env.NEXT_RUNTIME === "nodejs") {
      await import("./sentry.server.config");
    }
    if (process.env.NEXT_PUBLIC_SENTRY_DSN && process.env.NEXT_RUNTIME === "edge") {
      await import("./sentry.edge.config");
    }
  }
}

export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  if (process.env.NODE_ENV === "production") {
    Sentry.captureRequestError(err, request, context);
  }
};
