import { getBookingFieldsWithSystemFields } from "@calcom/features/bookings/lib/getBookingFields";
import type { EventTypeMetaDataSchema } from "@calcom/prisma/zod-utils";
import type { z } from "zod";

// Bookings from personal mailboxes were mostly not real business prospects, so new event types start by
// refusing them. The owner can clear or edit the list on the email booking question at any time.
export const PERSONAL_EMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "zoho.com",
  "yandex.com",
] as const;

export const DEFAULT_EXCLUDED_EMAILS = PERSONAL_EMAIL_DOMAINS.map((domain) => `@${domain}`).join(",");

export const getDefaultBookingFieldsForNewEventType = ({
  disableGuests,
  metadata,
}: {
  disableGuests: boolean;
  metadata?: z.infer<typeof EventTypeMetaDataSchema>;
}) => {
  const fields = getBookingFieldsWithSystemFields({
    bookingFields: [],
    disableGuests,
    customInputs: [],
    metadata: metadata ?? {},
  });

  return fields.map((field) =>
    field.name === "email" ? { ...field, excludeEmails: DEFAULT_EXCLUDED_EMAILS } : field
  );
};
