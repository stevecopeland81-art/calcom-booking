import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@calcom/prisma/client";
import { ownedEventWhere, WorkspaceError } from "./access";

export const accessibleCompanyWhere = (userId: number): Prisma.RythmsCompanyWhereInput => ({
  OR: [{ ownerId: userId }, { members: { some: { userId } } }],
});

export async function inviteMember(
  tx: Prisma.TransactionClient,
  ownerId: number,
  companyId: string,
  email: string
) {
  const company = await tx.rythmsCompany.findFirst({
    where: { id: companyId, ownerId },
    select: { id: true },
  });
  if (!company) throw new WorkspaceError(404, "rythms_not_found");
  if ((await tx.rythmsCompanyInvitation.count({ where: { companyId } })) >= 100)
    throw new WorkspaceError(400, "rythms_member_limit");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await tx.rythmsCompanyInvitation.upsert({
    where: { companyId_email: { companyId, email } },
    create: { companyId, email, tokenHash, expiresAt: new Date(Date.now() + 7 * 86400000) },
    update: { tokenHash, expiresAt: new Date(Date.now() + 7 * 86400000) },
    select: { id: true },
  });
  return { invitationPath: `/companies/invite/${token}` };
}

export async function acceptInvitation(tx: Prisma.TransactionClient, userId: number, token: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const invitation = await tx.rythmsCompanyInvitation.findUnique({
    where: { tokenHash },
    select: { id: true, companyId: true, email: true, expiresAt: true },
  });
  if (!invitation || invitation.expiresAt <= new Date())
    throw new WorkspaceError(404, "rythms_invite_expired");
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });
  if (!user?.emailVerified || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    throw new WorkspaceError(403, "rythms_invite_wrong_account");
  }
  if ((await tx.rythmsCompanyMember.count({ where: { companyId: invitation.companyId } })) >= 100) {
    throw new WorkspaceError(400, "rythms_member_limit");
  }
  // Consuming the invitation in the transaction prevents replay and concurrent acceptance.
  const consumed = await tx.rythmsCompanyInvitation.deleteMany({ where: { id: invitation.id, tokenHash } });
  if (!consumed.count) throw new WorkspaceError(404, "rythms_invite_expired");
  await tx.rythmsCompanyMember.upsert({
    where: { companyId_userId: { companyId: invitation.companyId, userId } },
    create: { companyId: invitation.companyId, userId },
    update: {},
    select: { userId: true },
  });
}

export async function removeMember(
  tx: Prisma.TransactionClient,
  ownerId: number,
  companyId: string,
  userId: number
) {
  const company = await tx.rythmsCompany.findFirst({
    where: { id: companyId, ownerId },
    select: { id: true },
  });
  if (!company || ownerId === userId) throw new WorkspaceError(404, "rythms_not_found");
  await tx.rythmsCompanyMeeting.deleteMany({ where: { companyId, eventType: ownedEventWhere(userId) } });
  await tx.rythmsCompanyMember.deleteMany({ where: { companyId, userId } });
}
