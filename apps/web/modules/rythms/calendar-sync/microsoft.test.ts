import { describe, expect, it, vi } from "vitest";

vi.mock("@calcom/prisma", () => ({ default: { credential: { findFirst: vi.fn() } } }));
vi.mock("@calcom/features/credentials/repositories/CredentialRepository", () => ({
  CredentialRepository: { findCredentialForCalendarServiceById: vi.fn() },
}));
vi.mock("@calcom/app-store/_utils/oauth/OAuthManager", () => ({ OAuthManager: vi.fn() }));
vi.mock("@calcom/app-store/_utils/oauth/getTokenObjectFromCredential", () => ({
  getTokenObjectFromCredential: vi.fn(),
}));
vi.mock("@calcom/app-store/_utils/oauth/oAuthManagerHelper", () => ({ oAuthManagerHelper: {} }));
vi.mock("@calcom/app-store/office365calendar/lib/getOfficeAppKeys", () => ({ getOfficeAppKeys: vi.fn() }));

import { CredentialRepository } from "@calcom/features/credentials/repositories/CredentialRepository";
import prisma from "@calcom/prisma";
import { graphUrl, MicrosoftClient, microsoftClient } from "./microsoft";
import { busyBody } from "./reconcile";
import { MARKER } from "./types";

const sample = {
  id: "event",
  start: { dateTime: "2026-09-10T10:00:00", timeZone: "UTC" },
  end: { dateTime: "2026-09-10T11:00:00", timeZone: "UTC" },
  showAs: "busy",
  isOrganizer: true,
  attendees: [],
};
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers });

describe("Microsoft transport", () => {
  it("loads every page before returning a source snapshot", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          value: [sample],
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendars/a/calendarView?$skiptoken=next",
        })
      )
      .mockResolvedValueOnce(json({ value: [{ ...sample, id: "second" }] }));
    const client = new MicrosoftClient(request);
    expect(await client.events("a", "from", "to")).toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("rejects a failed later page instead of returning a partial snapshot", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          value: [sample],
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendars/a/calendarView?$skiptoken=next",
        })
      )
      .mockResolvedValueOnce(json({}, 503));
    await expect(new MicrosoftClient(request).events("a", "from", "to")).rejects.toThrow(
      "rythms_sync_request_failed"
    );
  });
  it("rejects missing event arrays and malformed dates", async () => {
    const client = new MicrosoftClient(vi.fn().mockResolvedValue(json({ unexpected: [] })));
    await expect(client.events("a", "from", "to")).rejects.toThrow("rythms_sync_invalid_response");
  });
  it("rejects pagination loops and external next-page URLs", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(json({ value: [], "@odata.nextLink": "https://example.test/token" }));
    await expect(new MicrosoftClient(request).events("a", "from", "to")).rejects.toThrow(
      "rythms_sync_invalid_response"
    );
    expect(request).toHaveBeenCalledTimes(1);
    request.mockImplementation(async () =>
      json({ value: [], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/events" })
    );
    await expect(new MicrosoftClient(request).events("a", "from", "to")).rejects.toThrow(
      "rythms_sync_too_large"
    );
  });
  it.each([
    "https://graph.microsoft.com.evil.test/v1.0/me/events",
    "https://graph.microsoft.com/v1.0/users/victim/events",
    "https://user:secret@graph.microsoft.com/v1.0/me/events",
    "/me/../../users/victim/events",
  ])("restricts authenticated requests: %s", (path) => {
    expect(() => graphUrl(path)).toThrow();
  });
  it("checks ownership before loading a credential's secret", async () => {
    vi.mocked(prisma.credential.findFirst).mockResolvedValue(null);
    await expect(microsoftClient(1, 77)).rejects.toThrow("rythms_sync_reconnect");
    expect(CredentialRepository.findCredentialForCalendarServiceById).not.toHaveBeenCalled();
    expect(prisma.credential.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 77, userId: 1, teamId: null, delegationCredentialId: null }),
        select: { id: true },
      })
    );
  });
  it("offers only owned and writable calendars", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(json({ mail: "owner@example.test", userPrincipalName: "owner@example.test" }))
      .mockResolvedValueOnce(
        json({
          value: [
            { id: "own", name: "Work", canEdit: true, owner: { address: "owner@example.test" } },
            { id: "readonly", name: "Read only", canEdit: false, owner: { address: "owner@example.test" } },
            { id: "shared", name: "Someone else", canEdit: true, owner: { address: "other@example.test" } },
          ],
        })
      );
    expect(await new MicrosoftClient(request).calendars()).toEqual([
      { calendarId: "own", name: "Work", account: "owner@example.test" },
    ]);
  });
  it("sends no invitations, reminders, meeting notes or meeting links", async () => {
    const request = vi.fn().mockResolvedValue(json({ id: "new" }));
    await new MicrosoftClient(request).create("a", busyBody(sample), "sync:mirror", "transaction");
    const body = JSON.parse(request.mock.calls[0][1].body);
    expect(body).toMatchObject({
      attendees: [],
      isReminderOn: false,
      isOnlineMeeting: false,
      subject: "Busy",
      sensitivity: "private",
      transactionId: "transaction",
      responseRequested: false,
      singleValueExtendedProperties: [{ id: MARKER, value: "sync:mirror" }],
    });
    expect(body.body.content).toBe("");
  });
  it("uses the last-read version when deleting a block", async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await new MicrosoftClient(request).remove("a", { ...sample, "@odata.etag": 'W/"v1"' });
    expect(request).toHaveBeenCalledWith(expect.any(String), {
      method: "DELETE",
      headers: { "If-Match": 'W/"v1"' },
    });
  });
  it("honors Microsoft's retry-after instead of immediately retrying", async () => {
    const request = vi.fn().mockResolvedValue(json({}, 429, { "retry-after": "600" }));
    await expect(new MicrosoftClient(request).events("a", "from", "to")).rejects.toMatchObject({
      key: "rythms_sync_throttled",
      retryAt: expect.any(Number),
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
