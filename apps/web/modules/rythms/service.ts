import type { PrismaClient } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { ownedEventWhere, WorkspaceError } from "./access";
import { acceptInvitation, accessibleCompanyWhere, inviteMember, removeMember } from "./memberships";
import type { WorkspaceMutation } from "./schema";

const eventSelect = {
  id: true,
  title: true,
  slug: true,
  length: true,
  hidden: true,
  useEventLevelSelectedCalendars: true,
} satisfies Prisma.EventTypeSelect;

const companySelect = {
  id: true,
  ownerId: true,
  name: true,
  description: true,
  contactEmail: true,
  brandColor: true,
  published: true,
  meetings: { select: { eventType: { select: eventSelect } } },
  members: { select: { userId: true, user: { select: { name: true, username: true } } } },
} satisfies Prisma.RythmsCompanySelect;

const linkSelect = {
  id: true,
  slug: true,
  companyId: true,
  eventTypeId: true,
  enabled: true,
} satisfies Prisma.RythmsBookingLinkSelect;

export async function getWorkspace(db: PrismaClient, ownerId: number) {
  const [companies, links, events, user] = await Promise.all([
    db.rythmsCompany.findMany({
      where: accessibleCompanyWhere(ownerId),
      select: companySelect,
      orderBy: { createdAt: "asc" },
    }),
    db.rythmsBookingLink.findMany({ where: { ownerId }, select: linkSelect, orderBy: { createdAt: "asc" } }),
    db.eventType.findMany({
      where: ownedEventWhere(ownerId),
      select: eventSelect,
      orderBy: { position: "asc" },
    }),
    db.user.findUnique({
      where: { id: ownerId },
      select: { id: true, name: true, username: true, email: true },
    }),
  ]);
  const invitations = await db.rythmsCompanyInvitation.findMany({
    where: { company: { ownerId } },
    select: { id: true, companyId: true, email: true, expiresAt: true },
  });
  return {
    companies: companies.map(({ meetings, ...company }) => ({
      ...company,
      eventTypes: meetings.map((meeting) => meeting.eventType),
    })),
    links,
    events,
    user,
    invitations,
  };
}

export type WorkspaceData = Awaited<ReturnType<typeof getWorkspace>>;

async function setCompanyMeetings(
  tx: Prisma.TransactionClient,
  userId: number,
  companyId: string,
  ids: number[],
  sharedConflictChecks: boolean
) {
  const events = await tx.eventType.findMany({
    where: { ...ownedEventWhere(userId), id: { in: ids } },
    select: { id: true },
  });
  if (events.length !== ids.length) throw new WorkspaceError(403, "rythms_event_not_owned");
  await tx.rythmsCompanyMeeting.deleteMany({
    where: { companyId, eventType: ownedEventWhere(userId), eventTypeId: { notIn: ids } },
  });
  await tx.rythmsCompanyMeeting.createMany({
    data: events.map((event) => ({ companyId, eventTypeId: event.id })),
    skipDuplicates: true,
  });
  if (sharedConflictChecks)
    await tx.eventType.updateMany({
      where: { ...ownedEventWhere(userId), id: { in: ids } },
      data: { useEventLevelSelectedCalendars: false },
    });
}

export async function mutateWorkspace(db: PrismaClient, ownerId: number, input: WorkspaceMutation) {
  return db.$transaction(async (tx) => {
    if (input.action === "inviteMember") return inviteMember(tx, ownerId, input.companyId, input.email);
    if (input.action === "acceptInvitation") return acceptInvitation(tx, ownerId, input.token);
    if (input.action === "removeMember") return removeMember(tx, ownerId, input.companyId, input.userId);
    if (input.action === "revokeInvitation") {
      const removed = await tx.rythmsCompanyInvitation.deleteMany({
        where: { id: input.id, companyId: input.companyId, company: { ownerId } },
      });
      if (!removed.count) throw new WorkspaceError(404, "rythms_not_found");
      return;
    }
    if (input.action === "setCompanyMeetings") {
      const company = await tx.rythmsCompany.findFirst({
        where: { id: input.companyId, ...accessibleCompanyWhere(ownerId) },
        select: { id: true },
      });
      if (!company) throw new WorkspaceError(404, "rythms_not_found");
      await setCompanyMeetings(tx, ownerId, input.companyId, input.eventTypeIds, input.sharedConflictChecks);
      return;
    }
    if (input.action === "saveCompany") {
      if (
        input.id &&
        !(await tx.rythmsCompany.findFirst({ where: { id: input.id, ownerId }, select: { id: true } }))
      ) {
        throw new WorkspaceError(404, "rythms_not_found");
      }
      const events = await tx.eventType.findMany({
        where: { ...ownedEventWhere(ownerId), id: { in: input.eventTypeIds } },
        select: { id: true },
      });
      if (events.length !== input.eventTypeIds.length)
        throw new WorkspaceError(403, "rythms_event_not_owned");
      if (!input.id && (await tx.rythmsCompany.count({ where: { ownerId } })) >= 50) {
        throw new WorkspaceError(400, "rythms_company_limit");
      }
      const data = {
        name: input.name,
        description: input.description,
        contactEmail: input.contactEmail || null,
        brandColor: input.brandColor,
        published: input.published,
      };
      if (input.id) {
        await tx.rythmsCompany.update({ where: { id: input.id, ownerId }, data, select: { id: true } });
        await setCompanyMeetings(tx, ownerId, input.id, input.eventTypeIds, input.sharedConflictChecks);
      } else {
        await tx.rythmsCompany.create({
          data: { ...data, ownerId, meetings: { create: events.map(({ id }) => ({ eventTypeId: id })) } },
          select: { id: true },
        });
      }
      if (input.sharedConflictChecks) {
        await tx.eventType.updateMany({
          where: { ...ownedEventWhere(ownerId), id: { in: input.eventTypeIds } },
          data: { useEventLevelSelectedCalendars: false },
        });
      }
      return;
    }
    if (input.action === "createLink") {
      const { target } = input;
      if (
        target.kind === "company" &&
        !(await tx.rythmsCompany.findFirst({
          where: { id: target.companyId, ...accessibleCompanyWhere(ownerId) },
          select: { id: true },
        }))
      )
        throw new WorkspaceError(404, "rythms_not_found");
      if (
        target.kind === "event" &&
        !(await tx.eventType.findFirst({
          where: { ...ownedEventWhere(ownerId), id: target.eventTypeId, hidden: false },
          select: { id: true },
        }))
      )
        throw new WorkspaceError(403, "rythms_event_not_owned");
      if ((await tx.rythmsBookingLink.count({ where: { ownerId } })) >= 100) {
        throw new WorkspaceError(400, "rythms_link_limit");
      }
      await tx.rythmsBookingLink.create({
        data: {
          ownerId,
          slug: input.slug,
          companyId: target.kind === "company" ? target.companyId : null,
          eventTypeId: target.kind === "event" ? target.eventTypeId : null,
        },
        select: { id: true },
      });
      return;
    }
    const result =
      input.action === "deleteCompany"
        ? await tx.rythmsCompany.deleteMany({ where: { id: input.id, ownerId } })
        : input.action === "deleteLink"
          ? await tx.rythmsBookingLink.deleteMany({ where: { id: input.id, ownerId } })
          : await tx.rythmsBookingLink.updateMany({
              where: { id: input.id, ownerId },
              data: { enabled: input.enabled },
            });
    if (!result.count) throw new WorkspaceError(404, "rythms_not_found");
  });
}

export async function getPublicBookingPage(db: PrismaClient, slug: string) {
  const link = await db.rythmsBookingLink.findUnique({
    where: { slug },
    select: { ownerId: true, companyId: true, eventTypeId: true, enabled: true },
  });
  if (!link?.enabled) return null;
  const owner = await db.user.findUnique({
    where: { id: link.ownerId },
    select: { name: true, username: true },
  });
  if (!owner?.username) return null;
  const publicEventWhere = { ...ownedEventWhere(link.ownerId), hidden: false };
  if (link.eventTypeId) {
    const event = await db.eventType.findFirst({
      where: { ...publicEventWhere, id: link.eventTypeId },
      select: { slug: true },
    });
    return event
      ? {
          kind: "event" as const,
          href: `/${encodeURIComponent(owner.username)}/${encodeURIComponent(event.slug)}`,
        }
      : null;
  }
  const companies = await db.rythmsCompany.findMany({
    where: {
      ...accessibleCompanyWhere(link.ownerId),
      published: true,
      ...(link.companyId ? { id: link.companyId } : {}),
    },
    select: {
      id: true,
      name: true,
      description: true,
      brandColor: true,
      ownerId: true,
      members: { select: { userId: true } },
      meetings: {
        where: { eventType: { hidden: false, teamId: null } },
        select: {
          eventType: {
            select: {
              id: true,
              title: true,
              slug: true,
              length: true,
              userId: true,
              owner: { select: { id: true, name: true, username: true } },
              users: { select: { id: true, name: true, username: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  if (link.companyId && !companies.length) return null;
  // Contact identities stay in the signed-in workspace; only explicitly published booking details leave it.
  const publishedCompanies = companies.map((company) => {
    const allowedHosts = new Set([company.ownerId, ...company.members.map((member) => member.userId)]);
    return {
      id: company.id,
      name: company.name,
      description: company.description,
      brandColor: company.brandColor,
      eventTypes: company.meetings.flatMap(({ eventType: event }) => {
        const host = event.owner || (event.users.length === 1 ? event.users[0] : null);
        if (!host?.username || !allowedHosts.has(host.id)) return [];
        return [
          {
            id: event.id,
            title: event.title,
            length: event.length,
            slug: event.slug,
            hostName: host.name,
            href: `/${encodeURIComponent(host.username)}/${encodeURIComponent(event.slug)}`,
          },
        ];
      }),
    };
  });
  return {
    kind: "page" as const,
    owner,
    companies: publishedCompanies,
    companyOnly: Boolean(link.companyId),
  };
}
