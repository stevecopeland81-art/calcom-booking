// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  user: vi.fn(),
  connect: vi.fn(),
  send: vi.fn(),
  cookies: new Map<string, { value: string }>(),
}));
vi.mock("@calcom/features/auth/lib/getServerSession", () => ({ getServerSession: mocks.session }));
vi.mock("@calcom/lib/constants", () => ({ WEBAPP_URL: "https://app.example.test" }));
vi.mock("@lib/buildLegacyCtx", () => ({ buildLegacyRequest: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => mocks.cookies }));
vi.mock("@calcom/prisma", () => ({ default: { user: { findUnique: mocks.user } } }));
vi.mock("@calcom/emails/lib/microsoftMail", () => ({
  MAIL_SCOPE: "User.Read Mail.Send offline_access",
  mailConfig: () => ({ ownerId: 1, email: "sender@example.test" }),
  microsoftMailAppKeys: async () => ({ client_id: "synthetic-client", client_secret: "never-expose-this" }),
  microsoftMailStatus: async () => ({ email: "sender@example.test", connected: true }),
  connectMicrosoftMail: mocks.connect,
  sendMicrosoftMail: mocks.send,
}));

import { GET, POST } from "./route";

const request = (action: string, origin = "https://app.example.test") =>
  new Request("https://app.example.test/api/rythms/mail", {
    method: "POST",
    headers: { origin },
    body: JSON.stringify({ action }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.clear();
  mocks.session.mockResolvedValue({ user: { id: 1 } });
  mocks.user.mockResolvedValue({ role: "ADMIN" });
  mocks.send.mockResolvedValue({ accepted: true });
});
it("rejects cross-origin actions before authentication or sending", async () => {
  expect((await POST(request("test", "https://attacker.example.test"))).status).toBe(403);
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
it("requires both the configured owner and a current admin role", async () => {
  mocks.session.mockResolvedValue({ user: { id: 2 } });
  expect((await POST(request("connect"))).status).toBe(403);
  mocks.session.mockResolvedValue({ user: { id: 1 } });
  mocks.user.mockResolvedValue({ role: "USER" });
  const forbidden = await GET(new Request("https://app.example.test/api/rythms/mail"));
  expect(forbidden.status).toBe(403);
});
it("uses PKCE and a short-lived secure host cookie without exposing a secret", async () => {
  const result = await POST(request("connect"));
  const body = await result.text();
  const url = new URL(JSON.parse(body).url);
  expect(url.origin).toBe("https://login.microsoftonline.com");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("scope")).toBe("User.Read Mail.Send offline_access");
  expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.test/api/rythms/mail");
  expect(body).not.toContain("never-expose-this");
  for (const flag of ["__Host-rythms-mail=", "HttpOnly", "Secure", "SameSite=lax", "Max-Age=600"])
    expect(result.headers.get("set-cookie")).toContain(flag);
});
it("rejects missing, expired and mismatched callback state", async () => {
  await GET(new Request("https://app.example.test/api/rythms/mail?code=synthetic&state=bad"));
  mocks.cookies.set("__Host-rythms-mail", {
    value: Buffer.from(
      JSON.stringify({ state: "x".repeat(43), verifier: "y".repeat(43), expires: 0, userId: 1 })
    ).toString("base64url"),
  });
  await GET(new Request(`https://app.example.test/api/rythms/mail?code=synthetic&state=${"x".repeat(43)}`));
  expect(mocks.connect).not.toHaveBeenCalled();
});
it("only permits a test to the configured sender, never a supplied recipient", async () => {
  const result = await POST(
    new Request("https://app.example.test/api/rythms/mail", {
      method: "POST",
      headers: { origin: "https://app.example.test" },
      body: JSON.stringify({ action: "test", to: "outsider@example.test" }),
    })
  );
  expect(result.status).toBe(200);
  expect(mocks.send.mock.calls[0][0].to).toBe("sender@example.test");
});
