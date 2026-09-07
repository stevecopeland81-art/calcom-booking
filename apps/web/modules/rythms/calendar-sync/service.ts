import { randomUUID } from "node:crypto";
import process from "node:process";
import prisma from "@calcom/prisma";
import { type MicrosoftClient, microsoftClient } from "./microsoft";
import { type MirrorStore, reconcile } from "./reconcile";
import {
  type CalendarOption,
  type CalendarRef,
  calendarKey,
  calendarRefSchema,
  SYNC_INTERVAL_MS,
  SyncError,
  type SyncInput,
} from "./types";

const mirrorSelect = {
  id: true,
  syncId: true,
  sourceKey: true,
  targetKey: true,
  credentialId: true,
  calendarId: true,
  eventId: true,
  transactionId: true,
} as const;
const configSelect = {
  id: true,
  userId: true,
  enabled: true,
  calendars: true,
  revision: true,
  cleanup: true,
  nextRunAt: true,
  lastAttemptAt: true,
  lastSuccessAt: true,
  lastError: true,
  leaseUntil: true,
  leaseToken: true,
} as const;
export const workerAvailable = () =>
  process.env.RYTHMS_CALENDAR_SYNC_WORKER !== "0" &&
  (process.env.RYTHMS_CALENDAR_SYNC_WORKER === "1" || Boolean(process.env.RAILWAY_SERVICE_ID));
const unlocked = () => ({ OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] });

export async function calendarOptions(userId: number): Promise<CalendarOption[]> {
  const credentials = await prisma.credential.findMany({
    where: {
      userId,
      type: "office365_calendar",
      teamId: null,
      delegationCredentialId: null,
      NOT: { invalid: true },
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const result: CalendarOption[] = [];
  const seen = new Set<string>();
  for (const credential of credentials) {
    for (const calendar of await (await microsoftClient(userId, credential.id)).calendars()) {
      const key = JSON.stringify([calendar.account, calendar.calendarId]);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ ...calendar, key, credentialId: credential.id });
    }
  }
  return result;
}
export async function syncStatus(userId: number) {
  const config = await prisma.rythmsCalendarSync.findUnique({ where: { userId }, select: configSelect });
  return {
    enabled: config?.enabled ?? false,
    cleanup: config?.cleanup ?? false,
    revision: config?.revision ?? 0,
    calendars: calendarRefSchema.array().parse(config?.calendars ?? []),
    lastAttemptAt: config?.lastAttemptAt?.toISOString() ?? null,
    lastSuccessAt: config?.lastSuccessAt?.toISOString() ?? null,
    lastError: config?.lastError ?? null,
    running: Boolean(config?.leaseUntil && config.leaseUntil > new Date()),
    workerAvailable: workerAvailable(),
    mirrorCount: config ? await prisma.rythmsCalendarMirror.count({ where: { syncId: config.id } }) : 0,
  };
}
export async function saveSync(userId: number, input: SyncInput) {
  if (!workerAvailable()) throw new SyncError("rythms_sync_worker_unavailable", 503);
  let calendars: CalendarRef[] | undefined;
  if (input.action === "save") {
    const available = await calendarOptions(userId);
    const keys = new Set(input.calendars.map(calendarKey));
    if (
      keys.size !== input.calendars.length ||
      !input.calendars.every((ref) => available.some((option) => calendarKey(option) === calendarKey(ref)))
    ) {
      throw new SyncError("rythms_sync_invalid_selection", 400);
    }
    calendars = input.calendars;
  }
  const config = await prisma.rythmsCalendarSync.upsert({
    where: { userId },
    create: { userId },
    update: {},
    select: { id: true },
  });
  const changed = await prisma.rythmsCalendarSync.updateMany({
    where: { id: config.id, userId, revision: input.revision, ...unlocked() },
    data: {
      revision: { increment: 1 },
      nextRunAt: new Date(),
      lastError: null,
      ...(input.action === "save"
        ? { calendars, enabled: true, cleanup: false }
        : input.action === "stop"
          ? { enabled: false, cleanup: true }
          : {}),
    },
  });
  if (changed.count !== 1) throw new SyncError("rythms_sync_changed", 409);
}

export async function runSync(userId: number) {
  const config = await prisma.rythmsCalendarSync.findUnique({ where: { userId }, select: configSelect });
  if (!config || (!config.enabled && !config.cleanup)) return;
  const token = randomUUID();
  const started = Date.now();
  const acquired = await prisma.rythmsCalendarSync.updateMany({
    where: {
      id: config.id,
      revision: config.revision,
      ...unlocked(),
    },
    data: {
      leaseToken: token,
      leaseUntil: new Date(Date.now() + 120_000),
      lastAttemptAt: new Date(),
    },
  });
  if (!acquired.count) return;
  const guard = async () => {
    if (Date.now() - started > 10 * 60_000) throw new SyncError("rythms_sync_too_large");
    const renewed = await prisma.rythmsCalendarSync.updateMany({
      where: {
        id: config.id,
        leaseToken: token,
        leaseUntil: { gt: new Date() },
      },
      data: { leaseUntil: new Date(Date.now() + 120_000) },
    });
    if (!renewed.count) throw new SyncError("rythms_sync_changed");
  };
  const clients = new Map<number, MicrosoftClient>();
  const client = async (credentialId: number) => {
    let value = clients.get(credentialId);
    if (!value) {
      value = await microsoftClient(userId, credentialId, guard);
      clients.set(credentialId, value);
    }
    return value;
  };
  const store: MirrorStore = {
    list: () => prisma.rythmsCalendarMirror.findMany({ where: { syncId: config.id }, select: mirrorSelect }),
    reserve: (sourceKey, target) =>
      prisma.rythmsCalendarMirror.upsert({
        where: {
          syncId_sourceKey_targetKey: { syncId: config.id, sourceKey, targetKey: calendarKey(target) },
        },
        create: { syncId: config.id, sourceKey, targetKey: calendarKey(target), ...target },
        update: {},
        select: mirrorSelect,
      }),
    attach: async (id, eventId) => {
      await prisma.rythmsCalendarMirror.updateMany({
        where: { id, syncId: config.id },
        data: { eventId },
      });
    },
    renewTransaction: async (id) => {
      const transactionId = randomUUID();
      await prisma.rythmsCalendarMirror.updateMany({
        where: { id, syncId: config.id },
        data: { eventId: null, transactionId },
      });
      return transactionId;
    },
    remove: async (id) => {
      await prisma.rythmsCalendarMirror.deleteMany({ where: { id, syncId: config.id } });
    },
  };
  try {
    const calendars = config.enabled ? calendarRefSchema.array().min(2).max(20).parse(config.calendars) : [];
    for (const ref of calendars) {
      const available = await (await client(ref.credentialId)).calendars();
      if (!available.some((c) => c.calendarId === ref.calendarId))
        throw new SyncError("rythms_sync_reconnect");
    }
    await reconcile({ syncId: config.id, calendars, store, client, guard });
    await guard();
    await prisma.rythmsCalendarSync.updateMany({
      where: { id: config.id, leaseToken: token },
      data: {
        lastSuccessAt: new Date(),
        lastError: null,
        cleanup: false,
        nextRunAt: new Date(Date.now() + SYNC_INTERVAL_MS),
        leaseUntil: null,
        leaseToken: null,
      },
    });
  } catch (error) {
    await prisma.rythmsCalendarSync.updateMany({
      where: { id: config.id, leaseToken: token },
      data: {
        lastError: error instanceof SyncError ? error.key : "rythms_sync_request_failed",
        nextRunAt: new Date(
          Math.max(
            Date.now() + SYNC_INTERVAL_MS,
            error instanceof SyncError && Number.isFinite(error.retryAt) ? (error.retryAt ?? 0) : 0
          )
        ),
        leaseUntil: null,
        leaseToken: null,
      },
    });
  }
}

export async function runDueSyncs() {
  const due = await prisma.rythmsCalendarSync.findMany({
    where: {
      nextRunAt: { lte: new Date() },
      AND: [{ OR: [{ enabled: true }, { cleanup: true }] }, unlocked()],
    },
    select: { userId: true },
    orderBy: { nextRunAt: "asc" },
    take: 10,
  });
  for (const config of due) await runSync(config.userId);
}
