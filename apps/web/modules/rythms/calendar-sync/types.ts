import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { z } from "zod";

export const calendarRefSchema = z.object({
  credentialId: z.number().int().positive(),
  calendarId: z.string().min(1).max(1024),
});
export const syncInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    revision: z.number().int().nonnegative(),
    calendars: z.array(calendarRefSchema).min(2).max(20),
  }),
  z.object({ action: z.literal("stop"), revision: z.number().int().nonnegative() }),
  z.object({ action: z.literal("run"), revision: z.number().int().nonnegative() }),
]);
export type CalendarRef = z.infer<typeof calendarRefSchema>;
export type SyncInput = z.infer<typeof syncInputSchema>;
export type CalendarOption = CalendarRef & { key: string; name: string; account: string };
export type SyncStatus = {
  enabled: boolean;
  cleanup: boolean;
  revision: number;
  calendars: CalendarRef[];
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  running: boolean;
  mirrorCount: number;
  workerAvailable: boolean;
};
export class SyncError extends ErrorWithCode {
  retryAt?: number;
  constructor(
    public readonly key: string,
    public readonly status = 502
  ) {
    super(ErrorCode.InternalServerError, key);
  }
}
export const SYNC_INTERVAL_MS = 5 * 60_000;
export const SYNC_DAYS = 90;
export const MARKER = "String {b23d4fa5-f151-4bc2-8181-6f431251a283} Name RythmsBusySync";
export function calendarKey(ref: CalendarRef) {
  return JSON.stringify([ref.credentialId, ref.calendarId]);
}
