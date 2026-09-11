import { describe, expect, it } from "vitest";
import { getHubspotAccount, isSelectedHubspotCredential } from "./account";

describe("HubSpot account isolation", () => {
  const accounts = [{ id: 10 }, { id: 20 }];

  it("sends RYTHMz and SCOUTz to their shared account and AEGITz to its own", () => {
    for (const credentialId of [10, 10, 20]) {
      const selected = accounts.filter((account) =>
        isSelectedHubspotCredential(account, { enabled: true, credentialId })
      );
      expect(selected).toEqual([{ id: credentialId }]);
    }
  });

  it.each([
    undefined,
    { enabled: false, credentialId: 10 },
    { enabled: true },
    { enabled: true, credentialId: 99 },
  ])("does not fall back to any account when selection is unavailable: %j", (app) => {
    expect(accounts.filter((account) => isSelectedHubspotCredential(account, app))).toEqual([]);
  });

  it("does not use invalid credentials", () => {
    expect(isSelectedHubspotCredential({ id: 10, invalid: true }, { enabled: true, credentialId: 10 })).toBe(
      false
    );
  });

  it("exposes only account identity, never tokens", () => {
    expect(
      getHubspotAccount({
        hubId: 123,
        hubDomain: "example.test",
        accessToken: "test-only",
        refreshToken: "test-only",
        nested: { secret: "test-only" },
      })
    ).toEqual({ hubId: 123, hubDomain: "example.test" });
  });

  it("handles connections created before account labels were supported", () => {
    expect(getHubspotAccount({ accessToken: "test-only" })).toEqual({});
    expect(getHubspotAccount(null)).toEqual({});
  });
});
