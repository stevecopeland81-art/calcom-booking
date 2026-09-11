import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  keys: vi.fn(),
  createCredential: vi.fn(),
  state: vi.fn(),
  findCredentials: vi.fn(),
  deleteCredentials: vi.fn(),
  findUser: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("@calcom/prisma", () => ({
  default: {
    credential: { findMany: mocks.findCredentials, deleteMany: mocks.deleteCredentials },
    user: { findUniqueOrThrow: mocks.findUser, update: mocks.updateUser },
  },
}));
vi.mock("../../_utils/getAppKeysFromSlug", () => ({
  default: mocks.keys,
}));
vi.mock("../../_utils/oauth/createOAuthAppCredential", () => ({ default: mocks.createCredential }));
vi.mock("../../_utils/oauth/decodeOAuthState", () => ({ decodeOAuthState: mocks.state }));

import { OFFICE365_VIDEO_SCOPES } from "./add";
import handler from "./callback";

function request() {
  return { query: { code: "test-code" }, session: { user: { id: 41 } } } as unknown as NextApiRequest;
}

function response() {
  const res = { status: vi.fn(), json: vi.fn(), redirect: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe("Teams account connection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.keys.mockResolvedValue({ client_id: "test-client", client_secret: "test-secret" });
    mocks.state.mockReturnValue(undefined);
    mocks.findCredentials.mockResolvedValue([]);
    mocks.createCredential.mockResolvedValue({ id: 12 });
    mocks.findUser.mockResolvedValue({ metadata: { sessionTimeout: 60 } });
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "test-token", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ mail: "host@example.com" }) });
  });

  it("makes a successfully connected personal Teams account the host's default", async () => {
    const res = response();
    await handler(request(), res as unknown as NextApiResponse);
    expect(mocks.createCredential).toHaveBeenCalledWith(
      { appId: "msteams", type: "office365_video" },
      expect.objectContaining({ email: "host@example.com" }),
      expect.objectContaining({ session: { user: { id: 41 } } })
    );
    expect(mocks.updateUser).toHaveBeenCalledWith({
      where: { id: 41 },
      data: { metadata: { sessionTimeout: 60, defaultConferencingApp: { appSlug: "msteams" } } },
    });
    expect(res.redirect).toHaveBeenCalled();
  });

  it("does not change the installing admin's personal default for a team-owned connection", async () => {
    mocks.state.mockReturnValue({ teamId: 7 });
    const res = response();
    await handler(request(), res as unknown as NextApiResponse);
    expect(mocks.createCredential).toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("preserves the previous connection when Microsoft cannot verify the account", async () => {
    mocks.fetch
      .mockReset()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "test-token", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { code: "Forbidden" } }) });
    const res = response();
    await handler(request(), res as unknown as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(mocks.deleteCredentials).not.toHaveBeenCalled();
    expect(mocks.createCredential).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("requests the profile permission needed to identify a new host", () => {
    expect(OFFICE365_VIDEO_SCOPES).toContain("User.Read");
  });
});
