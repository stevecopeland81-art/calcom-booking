import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  credential: { findMany: vi.fn() },
  config: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
  mirror: { findMany: vi.fn(), count: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  client: vi.fn(),
}));
vi.mock("@calcom/prisma", () => ({
  default: {
    credential: mocks.credential,
    rythmsCalendarSync: mocks.config,
    rythmsCalendarMirror: mocks.mirror,
  },
}));
vi.mock("./microsoft", () => ({ microsoftClient: mocks.client }));

import { runDueSyncs, runSync, saveSync, syncStatus } from "./service";

const calendars = [
  { credentialId: 1, calendarId: "a" },
  { credentialId: 2, calendarId: "b" },
];
const config = {
  id: "sync",
  userId: 12,
  enabled: true,
  cleanup: false,
  revision: 3,
  calendars,
  nextRunAt: new Date(0),
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  leaseToken: null,
  leaseUntil: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("RYTHMS_CALENDAR_SYNC_WORKER", "1");
  mocks.config.findUnique.mockResolvedValue(config);
  mocks.config.upsert.mockResolvedValue({ id: "sync" });
  mocks.config.updateMany.mockResolvedValue({ count: 1 });
  mocks.mirror.findMany.mockResolvedValue([]);
  mocks.mirror.count.mockResolvedValue(0);
  mocks.credential.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
  mocks.client.mockImplementation(async (_user: number, credentialId: number) => ({
    calendars: async () => [
      {
        calendarId: credentialId === 1 ? "a" : "b",
        name: "Calendar",
        account: `${credentialId}@example.test`,
      },
    ],
    events: async () => [],
  }));
});
describe("busy-sync ownership, configuration and scheduling", () => {
  it("rejects a calendar not owned by the current user", async () => {
    await expect(
      saveSync(12, {
        action: "save",
        revision: 3,
        calendars: [calendars[0], { credentialId: 999, calendarId: "private" }],
      })
    ).rejects.toThrow("rythms_sync_invalid_selection");
    expect(mocks.config.upsert).not.toHaveBeenCalled();
    expect(mocks.credential.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 12 }),
        select: { id: true },
      })
    );
  });
  it("rejects duplicate selections", async () => {
    await expect(
      saveSync(12, { action: "save", revision: 3, calendars: [calendars[0], calendars[0]] })
    ).rejects.toThrow("rythms_sync_invalid_selection");
  });
  it("uses both the user and revision when saving, and rejects a held lease", async () => {
    mocks.config.updateMany.mockResolvedValue({ count: 0 });
    await expect(saveSync(12, { action: "save", revision: 2, calendars })).rejects.toThrow(
      "rythms_sync_changed"
    );
    expect(mocks.config.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 12, revision: 2, OR: expect.any(Array) }),
      })
    );
  });
  it("turning off queues cleanup without touching any Microsoft events in the request", async () => {
    await saveSync(12, { action: "stop", revision: 3 });
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.config.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ enabled: false, cleanup: true }),
      })
    );
  });
  it("does not start an overlapping worker", async () => {
    mocks.config.updateMany.mockResolvedValue({ count: 0 });
    await runSync(12);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("records source failures without removing existing mirrors", async () => {
    mocks.client.mockResolvedValue({
      calendars: async () => [{ calendarId: "a" }, { calendarId: "b" }],
      events: async () => {
        throw new Error("Token detail must not appear in UI");
      },
    });
    await runSync(12);
    expect(mocks.mirror.deleteMany).not.toHaveBeenCalled();
    expect(mocks.config.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastError: "rythms_sync_request_failed",
          leaseToken: null,
          leaseUntil: null,
        }),
      })
    );
  });
  it("marks a successful complete pass and releases its lease", async () => {
    await runSync(12);
    expect(mocks.config.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastSuccessAt: expect.any(Date), lastError: null, leaseToken: null }),
      })
    );
  });
  it("keeps status responses free of tokens, user IDs and internal lease values", async () => {
    mocks.config.findUnique.mockResolvedValue({ ...config, leaseToken: "private-lock" });
    const result = await syncStatus(12);
    expect(result).not.toHaveProperty("leaseToken");
    expect(result).not.toHaveProperty("userId");
    expect(result).not.toHaveProperty("id");
  });
  it("requires a worker host before accepting enablement", async () => {
    vi.stubEnv("RYTHMS_CALENDAR_SYNC_WORKER", "0");
    await expect(saveSync(12, { action: "save", revision: 3, calendars })).rejects.toThrow(
      "rythms_sync_worker_unavailable"
    );
  });
  it("only queues due opted-in users or explicit cleanup jobs", async () => {
    mocks.config.findMany.mockResolvedValue([]);
    await runDueSyncs();
    expect(mocks.config.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          nextRunAt: { lte: expect.any(Date) },
          AND: expect.arrayContaining([{ OR: [{ enabled: true }, { cleanup: true }] }]),
        }),
        select: { userId: true },
        take: 10,
      })
    );
  });
});
