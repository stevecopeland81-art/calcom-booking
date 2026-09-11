// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  create: vi.fn(),
  app: vi.fn(),
}));
vi.mock("@calcom/prisma", () => ({ default: { credential: db, app: { findUnique: db.app } } }));

import {
  buildMicrosoftMime,
  connectMicrosoftMail,
  decryptMailToken,
  encryptMailToken,
  mailConfig,
  microsoftMailStatus,
  sendMicrosoftMail,
} from "./microsoftMail";

const token = () => ({
  access_token: "synthetic-access",
  refresh_token: "synthetic-refresh",
  scope: "User.Read Mail.Send",
  expires_at: Date.now() + 3600000,
  email: "sender@example.test",
});
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("EMAIL_FROM", "sender@example.test");
  vi.stubEnv("EMAIL_FROM_NAME", "Rythms Cal");
  vi.stubEnv("RYTHMS_MICROSOFT_MAIL_OWNER_ID", "1");
  vi.stubEnv("CALENDSO_ENCRYPTION_KEY", "synthetic-key-for-tests-only-1234567890");
  db.app.mockResolvedValue({ keys: { client_id: "synthetic-client", client_secret: "synthetic-secret" } });
  db.findFirst.mockResolvedValue({ id: 99, encryptedKey: encryptMailToken(token()) });
  db.updateMany.mockResolvedValue({ count: 1 });
  vi.stubGlobal("fetch", vi.fn());
});
describe("Microsoft booking mail", () => {
  it("requires an explicit local owner and exact sender", () => {
    vi.stubEnv("RYTHMS_MICROSOFT_MAIL_OWNER_ID", "");
    expect(() => mailConfig()).toThrow();
  });
  it("authenticates encrypted tokens and rejects another sender or missing send consent", () => {
    const encrypted = encryptMailToken(token());
    expect(decryptMailToken(encrypted).email).toBe("sender@example.test");
    expect(encrypted).not.toContain("synthetic-access");
    expect(() => decryptMailToken(`${encrypted.slice(0, -8)}AAAAAAAA`)).toThrow();
    expect(() => decryptMailToken(encryptMailToken({ ...token(), email: "other@example.test" }))).toThrow();
    expect(() => decryptMailToken(encryptMailToken({ ...token(), scope: "Calendars.ReadWrite" }))).toThrow();
  });
  it("preserves MIME recipients, reply-to, HTML and calendar attachments while enforcing the sender", async () => {
    const mime = Buffer.from(
      await buildMicrosoftMime({
        from: "spoof@example.test",
        to: "guest@example.test",
        cc: "cc@example.test",
        bcc: "bcc@example.test",
        replyTo: "company@example.test",
        subject: "Booking confirmed",
        text: "Confirmed",
        html: "<b>Confirmed</b>",
        icalEvent: { method: "REQUEST", content: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR" },
      }),
      "base64"
    ).toString();
    for (const value of [
      "sender@example.test",
      "guest@example.test",
      "cc@example.test",
      "bcc@example.test",
      "company@example.test",
      "text/calendar",
      "text/html",
      "Booking confirmed",
    ])
      expect(mime).toContain(value);
    expect(mime).not.toContain("spoof@example.test");
  });
  it("blocks remote attachment reads", async () => {
    await expect(
      buildMicrosoftMime({
        to: "guest@example.test",
        attachments: [{ path: "https://example.test/private" }],
      })
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects oversized MIME before a Graph request", async () => {
    await expect(
      sendMicrosoftMail({ to: "guest@example.test", text: "x".repeat(4 * 1024 * 1024) })
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sends only once and reports acceptance rather than delivery", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 202 }));
    expect(await sendMicrosoftMail({ to: "guest@example.test", text: "Booking" })).toEqual({
      accepted: true,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
  });
  it("never retries an ambiguous send or exposes provider error bodies", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ error: "sensitive-provider-details" }, 503));
    await expect(sendMicrosoftMail({ to: "guest@example.test", text: "Booking" })).rejects.toThrow(
      "Reconnect"
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("refreshes expired mail tokens separately from calendar credentials", async () => {
    db.findFirst.mockResolvedValue({ id: 99, encryptedKey: encryptMailToken({ ...token(), expires_at: 0 }) });
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        response({
          access_token: "new-access",
          refresh_token: "new-refresh",
          scope: "User.Read Mail.Send",
          expires_in: 3600,
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    await sendMicrosoftMail({ to: "guest@example.test", text: "Booking" });
    const saved = db.updateMany.mock.calls[0][0];
    expect(decryptMailToken(saved.data.encryptedKey).refresh_token).toBe("new-refresh");
    expect(saved.where.encryptedKey).toBeTruthy();
    expect(db.findFirst.mock.calls[0][0].where.type).toBe("rythms_microsoft_mail");
  });
  it("does not replace a connection when consent is for a different account", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ ...token(), expires_in: 3600 }))
      .mockResolvedValueOnce(
        response({ mail: "wrong@example.test", userPrincipalName: "wrong@example.test" })
      );
    await expect(
      connectMicrosoftMail("code", "verifier", "https://app.example.test/api/rythms/mail")
    ).rejects.toThrow();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.create).not.toHaveBeenCalled();
  });
  it("stores only encrypted tokens for the approved sender", async () => {
    db.findFirst.mockResolvedValue(null);
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ ...token(), expires_in: 3600 }))
      .mockResolvedValueOnce(
        response({ mail: "sender@example.test", userPrincipalName: "sender@example.test" })
      );
    await connectMicrosoftMail("code", "verifier", "https://app.example.test/api/rythms/mail");
    expect(db.create.mock.calls[0][0].data.key).toEqual({});
    expect(decryptMailToken(db.create.mock.calls[0][0].data.encryptedKey).email).toBe("sender@example.test");
  });
  it("returns only sender and connection status", async () => {
    expect(await microsoftMailStatus()).toEqual({ email: "sender@example.test", connected: true });
  });
});
