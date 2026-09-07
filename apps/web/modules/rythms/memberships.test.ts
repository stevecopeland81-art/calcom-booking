import "@calcom/testing/lib/__mocks__/prisma";
import db from "@calcom/prisma";
import { beforeEach, describe, expect, it } from "vitest";
import { getPublicBookingPage, getWorkspace, mutateWorkspace } from "./service";

beforeEach(async () => {
  await db.user.create({
    data: { id: 1, username: "owner", name: "Owner", email: "owner@example.test", emailVerified: new Date() },
  });
  await db.user.create({ data: { id: 2, username: "member", name: "Member", email: "member@example.test" } });
  await db.eventType.create({
    data: { id: 10, userId: 1, title: "Owner meeting", slug: "owner-meeting", length: 30 },
  });
  await db.eventType.create({
    data: { id: 20, userId: 2, title: "Member meeting", slug: "member-meeting", length: 30 },
  });
  await mutateWorkspace(db, 1, {
    action: "saveCompany",
    name: "Shared company",
    description: "",
    contactEmail: "",
    brandColor: "#2563eb",
    published: true,
    eventTypeIds: [10],
    sharedConflictChecks: true,
  });
});

async function invite() {
  const company = (await getWorkspace(db, 1)).companies[0];
  const result = await mutateWorkspace(db, 1, {
    action: "inviteMember",
    companyId: company.id,
    email: "member@example.test",
  });
  if (!result?.invitationPath) throw new Error("Missing invitation");
  return { company, token: result.invitationPath.split("/").pop() || "" };
}

async function join() {
  const invitation = await invite();
  await db.user.update({ where: { id: 2 }, data: { emailVerified: new Date() } });
  await mutateWorkspace(db, 2, { action: "acceptInvitation", token: invitation.token });
  return invitation;
}

describe("company invitations and member boundaries", () => {
  it("requires the invited verified email and consumes invitations only once", async () => {
    const { token, company } = await invite();
    await expect(mutateWorkspace(db, 1, { action: "acceptInvitation", token })).rejects.toMatchObject({
      status: 403,
    });
    await expect(mutateWorkspace(db, 2, { action: "acceptInvitation", token })).rejects.toMatchObject({
      status: 403,
    });
    await db.user.update({ where: { id: 2 }, data: { emailVerified: new Date() } });
    await mutateWorkspace(db, 2, { action: "acceptInvitation", token });
    expect((await getWorkspace(db, 2)).companies[0].id).toBe(company.id);
    await expect(mutateWorkspace(db, 2, { action: "acceptInvitation", token })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("never stores the raw token or exposes a token hash in workspace responses", async () => {
    const { token } = await invite();
    const invitation = await db.rythmsCompanyInvitation.findFirst();
    expect(invitation?.tokenHash).toHaveLength(64);
    expect(JSON.stringify(invitation)).not.toContain(token);
    expect(JSON.stringify(await getWorkspace(db, 1))).not.toContain("tokenHash");
  });

  it("rejects expired and revoked invitations", async () => {
    const { token, company } = await invite();
    const invitation = (await getWorkspace(db, 1)).invitations[0];
    await db.rythmsCompanyInvitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(mutateWorkspace(db, 2, { action: "acceptInvitation", token })).rejects.toMatchObject({
      status: 404,
    });
    await mutateWorkspace(db, 1, { action: "revokeInvitation", companyId: company.id, id: invitation.id });
    expect((await getWorkspace(db, 1)).invitations).toHaveLength(0);
  });

  it("lets a member publish their own meetings without replacing the owner's meetings", async () => {
    const { company } = await join();
    await mutateWorkspace(db, 2, {
      action: "setCompanyMeetings",
      companyId: company.id,
      eventTypeIds: [20],
      sharedConflictChecks: true,
    });
    await mutateWorkspace(db, 1, {
      action: "createLink",
      slug: "shared-company",
      target: { kind: "company", companyId: company.id },
    });
    const page = await getPublicBookingPage(db, "shared-company");
    expect(page).toMatchObject({
      companies: [
        {
          eventTypes: expect.arrayContaining([
            expect.objectContaining({ id: 10, href: "/owner/owner-meeting" }),
            expect.objectContaining({ id: 20, href: "/member/member-meeting" }),
          ]),
        },
      ],
    });
    await expect(
      mutateWorkspace(db, 2, {
        action: "setCompanyMeetings",
        companyId: company.id,
        eventTypeIds: [10],
        sharedConflictChecks: true,
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("does not let a member invite others, remove people, or change company identity", async () => {
    const { company } = await join();
    await expect(
      mutateWorkspace(db, 2, { action: "inviteMember", companyId: company.id, email: "third@example.test" })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      mutateWorkspace(db, 2, { action: "removeMember", companyId: company.id, userId: 1 })
    ).rejects.toMatchObject({ status: 404 });
    await expect(mutateWorkspace(db, 2, { action: "deleteCompany", id: company.id })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("removes company access and public meetings without deleting a member's event types", async () => {
    const { company } = await join();
    await mutateWorkspace(db, 2, {
      action: "setCompanyMeetings",
      companyId: company.id,
      eventTypeIds: [20],
      sharedConflictChecks: true,
    });
    await mutateWorkspace(db, 2, {
      action: "createLink",
      slug: "member-company",
      target: { kind: "company", companyId: company.id },
    });
    await mutateWorkspace(db, 1, {
      action: "createLink",
      slug: "owner-company",
      target: { kind: "company", companyId: company.id },
    });
    await mutateWorkspace(db, 1, { action: "removeMember", companyId: company.id, userId: 2 });
    expect((await getWorkspace(db, 2)).companies).toHaveLength(0);
    expect(await getPublicBookingPage(db, "member-company")).toBeNull();
    expect(await getPublicBookingPage(db, "owner-company")).toMatchObject({
      companies: [{ eventTypes: [expect.objectContaining({ id: 10 })] }],
    });
    expect(await db.eventType.findUnique({ where: { id: 20 } })).not.toBeNull();
  });
});
