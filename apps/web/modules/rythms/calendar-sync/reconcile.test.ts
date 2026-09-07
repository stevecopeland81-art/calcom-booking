import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { BusyBody, CalendarClient, MicrosoftEvent } from "./microsoft";
import { busyBody, type Mirror, type MirrorStore, markerOf, reconcile } from "./reconcile";
import { type CalendarRef, calendarKey, MARKER } from "./types";

const now = new Date("2026-09-08T00:00:00Z");
const a = { credentialId: 1, calendarId: "company-a" };
const b = { credentialId: 2, calendarId: "company-b" };
const c = { credentialId: 3, calendarId: "personal" };
function event(id = "original", extra: Partial<MicrosoftEvent> = {}): MicrosoftEvent {
  return {
    id,
    iCalUId: id,
    subject: "Private client acquisition",
    showAs: "busy",
    start: { dateTime: "2026-09-10T10:00:00", timeZone: "UTC" },
    end: { dateTime: "2026-09-10T11:00:00", timeZone: "UTC" },
    attendees: [],
    isOrganizer: true,
    ...extra,
  };
}
function harness(calendars: CalendarRef[] = [a, b]) {
  const records: Mirror[] = [];
  const data = new Map(calendars.map((ref) => [calendarKey(ref), [] as MicrosoftEvent[]]));
  const writes: { method: string; body?: BusyBody }[] = [];
  let failRead = false;
  let loseAcknowledgement = false;
  let validLease = true;
  const store: MirrorStore = {
    list: async () => records.map((row) => ({ ...row })),
    reserve: async (sourceKey, target) => {
      let row = records.find((row) => row.sourceKey === sourceKey && row.targetKey === calendarKey(target));
      if (!row) {
        row = {
          id: randomUUID(),
          syncId: "sync",
          sourceKey,
          targetKey: calendarKey(target),
          ...target,
          eventId: null,
          transactionId: randomUUID(),
        };
        records.push(row);
      }
      return { ...row };
    },
    attach: async (id, eventId) => {
      if (loseAcknowledgement) {
        loseAcknowledgement = false;
        throw new Error("database unavailable");
      }
      const row = records.find((row) => row.id === id);
      if (row) row.eventId = eventId;
    },
    renewTransaction: async (id) => {
      const row = records.find((row) => row.id === id);
      if (!row) throw new Error("Missing row");
      row.transactionId = randomUUID();
      row.eventId = null;
      return row.transactionId;
    },
    remove: async (id) => {
      const index = records.findIndex((row) => row.id === id);
      if (index >= 0) records.splice(index, 1);
    },
  };
  const items = (credentialId: number, calendarId: string) => {
    const key = calendarKey({ credentialId, calendarId });
    const value = data.get(key) ?? [];
    data.set(key, value);
    return value;
  };
  const client = async (credentialId: number): Promise<CalendarClient> => ({
    events: async (calendarId) => {
      if (failRead && credentialId === 2) throw new Error("Microsoft unavailable");
      return items(credentialId, calendarId);
    },
    find: async (calendarId, marker) => items(credentialId, calendarId).filter((e) => markerOf(e) === marker),
    get: async (calendarId, id) => items(credentialId, calendarId).find((e) => e.id === id) ?? null,
    create: async (calendarId, body, marker) => {
      writes.push({ method: "create", body });
      const id = randomUUID();
      items(credentialId, calendarId).push({
        ...event(id),
        ...body,
        "@odata.etag": 'W/"1"',
        singleValueExtendedProperties: [{ id: MARKER, value: marker }],
      });
      return id;
    },
    update: async (calendarId, original, body) => {
      writes.push({ method: "update", body });
      const target = items(credentialId, calendarId).find((e) => e.id === original.id);
      if (target) Object.assign(target, body);
    },
    remove: async (calendarId, original) => {
      writes.push({ method: "delete" });
      const value = items(credentialId, calendarId);
      const index = value.findIndex((e) => e.id === original.id);
      if (index >= 0) value.splice(index, 1);
    },
  });
  return {
    records,
    data,
    writes,
    items,
    setFailRead: () => {
      failRead = true;
    },
    loseAcknowledgement: () => {
      loseAcknowledgement = true;
    },
    expireLease: () => {
      validLease = false;
    },
    run: (selected = calendars) =>
      reconcile({
        syncId: "sync",
        calendars: selected,
        store,
        client,
        now,
        guard: async () => {
          if (!validLease) throw new Error("Lease lost");
        },
      }),
  };
}

describe("Microsoft busy-time reconciliation", () => {
  it("copies only private busy time and does not copy the blocks back", async () => {
    const h = harness();
    h.items(1, a.calendarId).push(event());
    expect(await h.run()).toEqual({ created: 1, updated: 0, removed: 0 });
    expect(h.writes[0].body).toMatchObject({
      subject: "Busy",
      sensitivity: "private",
      isReminderOn: false,
      body: { content: "" },
      location: { displayName: "" },
    });
    expect(JSON.stringify(h.writes)).not.toContain("acquisition");
    expect(await h.run()).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(h.items(1, a.calendarId)).toHaveLength(1);
  });
  it("updates a moved meeting without creating a second block", async () => {
    const h = harness();
    const original = event();
    h.items(1, a.calendarId).push(original);
    await h.run();
    original.start.dateTime = "2026-09-11T10:00:00";
    original.end.dateTime = "2026-09-11T11:00:00";
    expect(await h.run()).toEqual({ created: 0, updated: 1, removed: 0 });
    expect(h.items(2, b.calendarId)).toHaveLength(1);
  });
  it.each([
    "cancelled",
    "deleted",
    "free",
    "declined",
  ])("removes a block when its source is %s", async (kind) => {
    const h = harness();
    const original = event();
    h.items(1, a.calendarId).push(original);
    await h.run();
    if (kind === "cancelled") original.isCancelled = true;
    if (kind === "deleted") h.items(1, a.calendarId).splice(0);
    if (kind === "free") original.showAs = "free";
    if (kind === "declined") original.responseStatus = { response: "declined" };
    expect((await h.run()).removed).toBe(1);
    expect(h.records).toHaveLength(0);
  });
  it("preserves existing blocks when any source read fails", async () => {
    const h = harness();
    h.items(1, a.calendarId).push(event());
    await h.run();
    h.items(1, a.calendarId).splice(0);
    h.setFailRead();
    const before = h.writes.length;
    await expect(h.run()).rejects.toThrow();
    expect(h.writes).toHaveLength(before);
    expect(h.records).toHaveLength(1);
  });
  it("recovers a remote create whose database acknowledgement was lost", async () => {
    const h = harness();
    h.items(1, a.calendarId).push(event());
    h.loseAcknowledgement();
    await expect(h.run()).rejects.toThrow();
    expect(h.records[0].eventId).toBeNull();
    await h.run();
    expect(h.writes.filter((w) => w.method === "create")).toHaveLength(1);
    expect(h.records[0].eventId).toBeTruthy();
  });
  it("recreates a manually deleted block with a new transaction", async () => {
    const h = harness();
    h.items(1, a.calendarId).push(event());
    await h.run();
    const transaction = h.records[0].transactionId;
    h.items(2, b.calendarId).splice(0);
    expect((await h.run()).created).toBe(1);
    expect(h.records[0].transactionId).not.toBe(transaction);
  });
  it("cleans up removed calendars and stopping removes only managed blocks", async () => {
    const h = harness([a, b, c]);
    h.items(1, a.calendarId).push(event());
    h.items(2, b.calendarId).push(event("original-b"));
    await h.run();
    await h.run([a, c]);
    expect(h.items(2, b.calendarId)).toHaveLength(1);
    await h.run([]);
    expect(h.items(1, a.calendarId)[0].subject).toContain("acquisition");
    expect(h.items(2, b.calendarId)[0].subject).toContain("acquisition");
    expect(h.records).toHaveLength(0);
  });
  it("does not duplicate a meeting already on multiple selected calendars", async () => {
    const h = harness([a, b, c]);
    h.items(1, a.calendarId).push(event("same-invitation"));
    h.items(2, b.calendarId).push(event("same-invitation"));
    expect((await h.run()).created).toBe(1);
    expect(h.items(3, c.calendarId)).toHaveLength(1);
  });
  it("mirrors recurring occurrences separately and ignores another user's sync blocks", async () => {
    const h = harness();
    h.items(1, a.calendarId).push(
      event("occurrence-1"),
      event("occurrence-2"),
      event("other-sync", { singleValueExtendedProperties: [{ id: MARKER, value: "other-user:block" }] })
    );
    expect((await h.run()).created).toBe(2);
  });
  it.each(["marker", "attendees", "organizer"])("never changes a block with altered %s", async (field) => {
    const h = harness();
    h.items(1, a.calendarId).push(event());
    await h.run();
    const block = h.items(2, b.calendarId)[0];
    if (field === "marker") block.singleValueExtendedProperties = [];
    if (field === "attendees") block.attendees = [{ emailAddress: { address: "someone@example.test" } }];
    if (field === "organizer") block.isOrganizer = false;
    const before = h.writes.length;
    await expect(h.run([])).rejects.toThrow("rythms_sync_block_changed");
    expect(h.writes).toHaveLength(before);
  });
  it("stops writes when the worker loses its lease", async () => {
    const h = harness();
    h.items(1, a.calendarId).push(event());
    h.expireLease();
    await expect(h.run()).rejects.toThrow("Lease lost");
    expect(h.writes).toHaveLength(0);
  });
  it("preserves UTC instants through daylight saving and all-day boundaries", () => {
    const body = busyBody(
      event("all-day", {
        start: { dateTime: "2026-11-01T07:00:00", timeZone: "UTC" },
        end: { dateTime: "2026-11-02T08:00:00", timeZone: "UTC" },
      })
    );
    expect(Date.parse(body.end.dateTime) - Date.parse(body.start.dateTime)).toBe(25 * 3600_000);
  });
  it("rejects malformed dates before performing any writes", async () => {
    const h = harness();
    h.items(1, a.calendarId).push(event("bad", { start: { dateTime: "bad", timeZone: "UTC" } }));
    await expect(h.run()).rejects.toThrow("rythms_sync_invalid_response");
    expect(h.writes).toHaveLength(0);
  });
});
