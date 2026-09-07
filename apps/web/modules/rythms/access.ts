import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { Prisma } from "@calcom/prisma/client";

export class WorkspaceError extends ErrorWithCode {
  constructor(
    public readonly status: number,
    public readonly key: string
  ) {
    super(
      status === 404 ? ErrorCode.NotFound : status === 403 ? ErrorCode.Forbidden : ErrorCode.BadRequest,
      key
    );
  }
}

// Co-hosting a meeting does not grant permission to publish or manage its owner's links.
export const ownedEventWhere = (ownerId: number): Prisma.EventTypeWhereInput => ({
  teamId: null,
  OR: [{ userId: ownerId }, { userId: null, users: { some: { id: ownerId }, every: { id: ownerId } } }],
});
