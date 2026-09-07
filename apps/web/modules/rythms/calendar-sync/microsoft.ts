import { getTokenObjectFromCredential } from "@calcom/app-store/_utils/oauth/getTokenObjectFromCredential";
import { OAuthManager } from "@calcom/app-store/_utils/oauth/OAuthManager";
import { oAuthManagerHelper } from "@calcom/app-store/_utils/oauth/oAuthManagerHelper";
import { getOfficeAppKeys } from "@calcom/app-store/office365calendar/lib/getOfficeAppKeys";
import { CredentialRepository } from "@calcom/features/credentials/repositories/CredentialRepository";
import prisma from "@calcom/prisma";
import { z } from "zod";
import { MARKER, SyncError } from "./types";

const GRAPH = "https://graph.microsoft.com/v1.0";
const dateTimeSchema = z.object({ dateTime: z.string(), timeZone: z.string() });
export const eventSchema = z.object({
  id: z.string(),
  iCalUId: z.string().optional(),
  subject: z.string().optional(),
  start: dateTimeSchema,
  end: dateTimeSchema,
  showAs: z.string(),
  isCancelled: z.boolean().optional(),
  isOrganizer: z.boolean().optional(),
  isReminderOn: z.boolean().optional(),
  sensitivity: z.string().optional(),
  responseStatus: z.object({ response: z.string() }).optional(),
  attendees: z.array(z.unknown()).optional(),
  singleValueExtendedProperties: z.array(z.object({ id: z.string(), value: z.string() })).optional(),
  "@odata.etag": z.string().optional(),
});
export type MicrosoftEvent = z.infer<typeof eventSchema>;
export type BusyBody = {
  subject: "Busy";
  showAs: "busy";
  sensitivity: "private";
  isReminderOn: false;
  start: { dateTime: string; timeZone: "UTC" };
  end: { dateTime: string; timeZone: "UTC" };
  body: { contentType: "text"; content: "" };
  location: { displayName: "" };
};
export interface CalendarClient {
  events(calendarId: string, from: string, to: string): Promise<MicrosoftEvent[]>;
  find(calendarId: string, marker: string): Promise<MicrosoftEvent[]>;
  get(calendarId: string, eventId: string): Promise<MicrosoftEvent | null>;
  create(calendarId: string, body: BusyBody, marker: string, transactionId: string): Promise<string>;
  update(calendarId: string, event: MicrosoftEvent, body: BusyBody): Promise<void>;
  remove(calendarId: string, event: MicrosoftEvent): Promise<void>;
}
const select =
  "id,iCalUId,subject,start,end,showAs,isCancelled,isOrganizer,isReminderOn,sensitivity,responseStatus,attendees";
const expand = `singleValueExtendedProperties($filter=id eq '${MARKER}')`;
const eventQuery = () => new URLSearchParams({ $select: select, $expand: expand });
const calendarPath = (id: string) => `/me/calendars/${encodeURIComponent(id)}`;

export function graphUrl(path: string) {
  const url = new URL(path.startsWith("/") ? `${GRAPH}${path}` : path);
  if (
    url.origin !== "https://graph.microsoft.com" ||
    !(url.pathname.startsWith("/v1.0/me/") || url.pathname === "/v1.0/me") ||
    url.username ||
    url.password
  )
    throw new SyncError("rythms_sync_invalid_response");
  return url.href;
}

export async function microsoftClient(
  userId: number,
  credentialId: number,
  guard: () => Promise<void> = async () => {}
) {
  const owned = await prisma.credential.findFirst({
    where: {
      id: credentialId,
      userId,
      type: "office365_calendar",
      teamId: null,
      delegationCredentialId: null,
      NOT: { invalid: true },
    },
    select: { id: true },
  });
  if (!owned) throw new SyncError("rythms_sync_reconnect", 403);
  const credential = await CredentialRepository.findCredentialForCalendarServiceById({ id: owned.id });
  if (!credential || credential.userId !== userId) throw new SyncError("rythms_sync_reconnect", 403);
  const auth = new OAuthManager({
    credentialSyncVariables: oAuthManagerHelper.credentialSyncVariables,
    resourceOwner: { type: "user", id: userId },
    appSlug: "office365-calendar",
    currentTokenObject: getTokenObjectFromCredential(credential),
    fetchNewTokenObject: async ({ refreshToken }) => {
      if (!refreshToken) return null;
      const { client_id, client_secret } = await getOfficeAppKeys();
      return fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(30_000),
        body: new URLSearchParams({
          client_id,
          client_secret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          scope: "User.Read Calendars.Read Calendars.ReadWrite",
        }),
      });
    },
    isTokenObjectUnusable: async () => null,
    isAccessTokenUnusable: async () => null,
    invalidateTokenObject: () => oAuthManagerHelper.invalidateCredential(credential.id),
    expireAccessToken: () => oAuthManagerHelper.markTokenAsExpired(credential),
    updateTokenObject: (tokenObject) => oAuthManagerHelper.updateTokenObject({ tokenObject, credentialId }),
  });
  return new MicrosoftClient(async (path, init) => {
    await guard();
    const response = await auth.requestRaw({
      url: graphUrl(path),
      options: {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          Prefer: 'outlook.timezone="UTC", IdType="ImmutableId"',
          ...init?.headers,
        },
      },
    });
    await guard();
    return response;
  });
}

export class MicrosoftClient implements CalendarClient {
  constructor(private readonly request: (path: string, init?: RequestInit) => Promise<Response>) {}

  private async json(path: string, init?: RequestInit, allowMissing = false): Promise<unknown> {
    const response = await this.request(path, init);
    if (response.status === 404 && allowMissing) return null;
    if (!response.ok) {
      const key = [401, 403].includes(response.status)
        ? "rythms_sync_reconnect"
        : response.status === 429
          ? "rythms_sync_throttled"
          : "rythms_sync_request_failed";
      const error = new SyncError(key);
      const retry = response.headers.get("retry-after");
      if (retry) error.retryAt = /^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry);
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }

  private async pages<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
    const result: T[] = [];
    const seen = new Set<string>();
    let next: string | undefined = path;
    while (next) {
      if (seen.has(next) || seen.size >= 100) throw new SyncError("rythms_sync_too_large");
      seen.add(next);
      graphUrl(next);
      const parsed = z
        .object({ value: z.array(schema), "@odata.nextLink": z.string().optional() })
        .safeParse(await this.json(next));
      if (!parsed.success) throw new SyncError("rythms_sync_invalid_response");
      result.push(...parsed.data.value);
      if (result.length > 10000) throw new SyncError("rythms_sync_too_large");
      next = parsed.data["@odata.nextLink"];
    }
    return result;
  }

  async calendars() {
    const me = z
      .object({ mail: z.string().nullable().optional(), userPrincipalName: z.string() })
      .parse(await this.json("/me?$select=mail,userPrincipalName"));
    const account = (me.mail || me.userPrincipalName).toLowerCase();
    const calendars = await this.pages(
      "/me/calendars?$select=id,name,canEdit,owner",
      z.object({
        id: z.string(),
        name: z.string(),
        canEdit: z.boolean(),
        owner: z.object({ address: z.string() }).optional(),
      })
    );
    return calendars
      .filter((c) => c.canEdit && c.owner?.address.toLowerCase() === account)
      .map((c) => ({ calendarId: c.id, name: c.name, account }));
  }

  events(calendarId: string, from: string, to: string) {
    const query = eventQuery();
    query.set("startDateTime", from);
    query.set("endDateTime", to);
    query.set("$top", "250");
    return this.pages(`${calendarPath(calendarId)}/calendarView?${query}`, eventSchema);
  }
  find(calendarId: string, marker: string) {
    const query = eventQuery();
    query.set(
      "$filter",
      `singleValueExtendedProperties/Any(ep: ep/id eq '${MARKER}' and ep/value eq '${marker.replaceAll("'", "''")}')`
    );
    return this.pages(`${calendarPath(calendarId)}/events?${query}`, eventSchema);
  }
  async get(calendarId: string, eventId: string) {
    const result = await this.json(
      `${calendarPath(calendarId)}/events/${encodeURIComponent(eventId)}?${eventQuery()}`,
      undefined,
      true
    );
    if (result === null) return null;
    return eventSchema.parse(result);
  }
  async create(calendarId: string, body: BusyBody, marker: string, transactionId: string) {
    const result = await this.json(`${calendarPath(calendarId)}/events`, {
      method: "POST",
      body: JSON.stringify({
        ...body,
        transactionId,
        attendees: [],
        responseRequested: false,
        isOnlineMeeting: false,
        singleValueExtendedProperties: [{ id: MARKER, value: marker }],
      }),
    });
    return z.object({ id: z.string().min(1) }).parse(result).id;
  }
  private etag(event: MicrosoftEvent) {
    if (!event["@odata.etag"]) throw new SyncError("rythms_sync_invalid_response");
    return { "If-Match": event["@odata.etag"] };
  }
  async update(calendarId: string, event: MicrosoftEvent, body: BusyBody) {
    await this.json(`${calendarPath(calendarId)}/events/${encodeURIComponent(event.id)}`, {
      method: "PATCH",
      headers: this.etag(event),
      body: JSON.stringify(body),
    });
  }
  async remove(calendarId: string, event: MicrosoftEvent) {
    await this.json(
      `${calendarPath(calendarId)}/events/${encodeURIComponent(event.id)}`,
      {
        method: "DELETE",
        headers: this.etag(event),
      },
      true
    );
  }
}
