import { createHash } from "node:crypto";
import type { BusyBody, CalendarClient, MicrosoftEvent } from "./microsoft";
import { type CalendarRef, calendarKey, MARKER, SYNC_DAYS, SyncError } from "./types";

export type Mirror = CalendarRef & {
  id: string;
  syncId: string;
  sourceKey: string;
  targetKey: string;
  eventId: string | null;
  transactionId: string;
};
export interface MirrorStore {
  list(): Promise<Mirror[]>;
  reserve(sourceKey: string, target: CalendarRef): Promise<Mirror>;
  attach(id: string, eventId: string): Promise<void>;
  renewTransaction(id: string): Promise<string>;
  remove(id: string): Promise<void>;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const markerOf = (event: MicrosoftEvent) =>
  event.singleValueExtendedProperties?.find((p) => p.id === MARKER)?.value;

function utc(value: MicrosoftEvent["start"]) {
  if (value.timeZone !== "UTC") throw new SyncError("rythms_sync_invalid_response");
  const time = Date.parse(
    /(?:Z|[+-]\d\d:\d\d)$/.test(value.dateTime) ? value.dateTime : `${value.dateTime}Z`
  );
  if (!Number.isFinite(time)) throw new SyncError("rythms_sync_invalid_response");
  return new Date(time).toISOString();
}
export function busyBody(event: MicrosoftEvent): BusyBody {
  const start = utc(event.start);
  const end = utc(event.end);
  if (end <= start) throw new SyncError("rythms_sync_invalid_response");
  return {
    subject: "Busy",
    showAs: "busy",
    sensitivity: "private",
    isReminderOn: false,
    start: { dateTime: start, timeZone: "UTC" },
    end: { dateTime: end, timeZone: "UTC" },
    body: { contentType: "text", content: "" },
    location: { displayName: "" },
  };
}
function assertOwned(event: MicrosoftEvent, marker: string) {
  if (
    markerOf(event) !== marker ||
    event.isOrganizer !== true ||
    !event.attendees ||
    event.attendees.length
  ) {
    throw new SyncError("rythms_sync_block_changed");
  }
}
function isCurrent(event: MicrosoftEvent, body: BusyBody) {
  return (
    event.subject === "Busy" &&
    event.sensitivity === "private" &&
    event.showAs === "busy" &&
    event.isReminderOn === false &&
    utc(event.start) === body.start.dateTime &&
    utc(event.end) === body.end.dateTime
  );
}

export async function reconcile({
  syncId,
  calendars,
  store,
  client,
  guard,
  now = new Date(),
}: {
  syncId: string;
  calendars: CalendarRef[];
  store: MirrorStore;
  client: (credentialId: number) => Promise<CalendarClient>;
  guard: () => Promise<void>;
  now?: Date;
}) {
  const snapshots = new Map<string, MicrosoftEvent[]>();
  const prior = await store.list();
  const recordedBlocks = new Set(
    prior.filter((row) => row.eventId).map((row) => `${calendarKey(row)}:${row.eventId}`)
  );
  const from = new Date(now.getTime() - 86_400_000).toISOString();
  const to = new Date(now.getTime() + SYNC_DAYS * 86_400_000).toISOString();
  // A complete read is required before absence can mean cancellation.
  for (const calendar of calendars) {
    await guard();
    snapshots.set(
      calendarKey(calendar),
      await (await client(calendar.credentialId)).events(calendar.calendarId, from, to)
    );
  }
  const origins = new Map<string, { body: BusyBody; calendars: Set<string> }>();
  for (const [key, events] of Array.from(snapshots)) {
    for (const event of events) {
      if (
        markerOf(event) ||
        recordedBlocks.has(`${key}:${event.id}`) ||
        event.isCancelled ||
        event.responseStatus?.response === "declined" ||
        !["busy", "oof", "tentative"].includes(event.showAs)
      )
        continue;
      const body = busyBody(event);
      if (body.end.dateTime <= now.toISOString()) continue;
      const sourceKey = hash(event.iCalUId || `${key}:${event.id}`);
      const existing = origins.get(sourceKey);
      if (existing) existing.calendars.add(key);
      else origins.set(sourceKey, { body, calendars: new Set([key]) });
    }
  }
  const desired = new Map<string, { sourceKey: string; target: CalendarRef; body: BusyBody }>();
  for (const [sourceKey, source] of Array.from(origins)) {
    for (const target of calendars) {
      if (source.calendars.has(calendarKey(target))) continue;
      desired.set(`${sourceKey}:${calendarKey(target)}`, { sourceKey, target, body: source.body });
    }
  }
  if (desired.size > 10000) throw new SyncError("rythms_sync_too_large");
  const touched = new Set<string>();
  let created = 0;
  let updated = 0;
  let removed = 0;

  async function locate(row: Mirror) {
    const remote = await client(row.credentialId);
    const marker = `${syncId}:${row.id}`;
    const found = row.eventId ? await remote.get(row.calendarId, row.eventId) : null;
    if (found) {
      assertOwned(found, marker);
      return { remote, marker, found };
    }
    // Recover a successful POST whose response or database acknowledgement was lost.
    const matches = await remote.find(row.calendarId, marker);
    for (const match of matches) assertOwned(match, marker);
    if (matches.length > 1) throw new SyncError("rythms_sync_block_changed");
    return { remote, marker, found: matches[0] ?? null };
  }
  for (const item of Array.from(desired.values())) {
    await guard();
    const row = await store.reserve(item.sourceKey, item.target);
    touched.add(row.id);
    const { remote, marker, found } = await locate(row);
    if (found) {
      if (!isCurrent(found, item.body)) {
        await guard();
        await remote.update(row.calendarId, found, item.body);
        updated++;
      }
      await guard();
      await store.attach(row.id, found.id);
    } else {
      const transactionId = row.eventId ? await store.renewTransaction(row.id) : row.transactionId;
      await guard();
      const eventId = await remote.create(row.calendarId, item.body, marker, transactionId);
      await guard();
      await store.attach(row.id, eventId);
      created++;
    }
  }
  // Only this installation's recorded, marked, attendee-free blocks can be removed.
  for (const row of prior) {
    if (touched.has(row.id)) continue;
    await guard();
    const { remote, found } = await locate(row);
    if (found) {
      await guard();
      await remote.remove(row.calendarId, found);
      removed++;
    }
    await guard();
    await store.remove(row.id);
  }
  return { created, updated, removed };
}
