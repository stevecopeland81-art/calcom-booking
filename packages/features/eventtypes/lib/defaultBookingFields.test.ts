import { excludeOrRequireEmailSchema } from "@calcom/prisma/zod-utils";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXCLUDED_EMAILS,
  getDefaultBookingFieldsForNewEventType,
  PERSONAL_EMAIL_DOMAINS,
} from "./defaultBookingFields";

describe("getDefaultBookingFieldsForNewEventType", () => {
  it("blocks personal email domains on the email question", () => {
    const fields = getDefaultBookingFieldsForNewEventType({ disableGuests: false });
    const email = fields.find((field) => field.name === "email");

    expect(email?.excludeEmails).toBe(DEFAULT_EXCLUDED_EMAILS);
    expect(email?.excludeEmails).toContain("@gmail.com");
    expect(email?.required).toBe(true);
  });

  it("leaves the requireEmails list empty so business domains are not restricted", () => {
    const fields = getDefaultBookingFieldsForNewEventType({ disableGuests: false });
    expect(fields.find((field) => field.name === "email")?.requireEmails).toBeUndefined();
  });

  it("keeps every other system field, in the usual order, without an exclude list", () => {
    const fields = getDefaultBookingFieldsForNewEventType({ disableGuests: false });
    const names = fields.map((field) => field.name);

    expect(names.slice(0, 2)).toEqual(["name", "email"]);
    expect(names).toEqual(
      expect.arrayContaining(["location", "title", "notes", "guests", "rescheduleReason"])
    );
    expect(fields.filter((field) => field.excludeEmails)).toHaveLength(1);
  });

  it("carries disableGuests through to the guests question", () => {
    const fields = getDefaultBookingFieldsForNewEventType({ disableGuests: true });
    expect(fields.find((field) => field.name === "guests")?.hidden).toBe(true);
  });

  it("produces a list the email booking question accepts when the owner saves it", () => {
    expect(excludeOrRequireEmailSchema.safeParse(DEFAULT_EXCLUDED_EMAILS).success).toBe(true);
  });

  it("lists each domain once", () => {
    expect(new Set(PERSONAL_EMAIL_DOMAINS).size).toBe(PERSONAL_EMAIL_DOMAINS.length);
  });
});
