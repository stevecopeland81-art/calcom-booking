import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { WEBAPP_URL } from "@calcom/lib/constants";
import prisma from "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { WorkspaceError } from "~/rythms/access";
import { mutationSchema } from "~/rythms/schema";
import { getWorkspace, mutateWorkspace } from "~/rythms/service";

export const dynamic = "force-dynamic";

async function userId() {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  return session?.user?.id;
}

export async function GET() {
  const id = await userId();
  if (!id) return NextResponse.json({ error: "rythms_sign_in" }, { status: 401 });
  return NextResponse.json(await getWorkspace(prisma, id), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(WEBAPP_URL).origin) {
    return NextResponse.json({ error: "rythms_invalid_origin" }, { status: 403 });
  }
  const id = await userId();
  if (!id) return NextResponse.json({ error: "rythms_sign_in" }, { status: 401 });
  try {
    const body = await request.text();
    if (body.length > 16000) return NextResponse.json({ error: "rythms_invalid_input" }, { status: 413 });
    const parsed = mutationSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return NextResponse.json({ error: "rythms_invalid_input" }, { status: 400 });
    const result = await mutateWorkspace(prisma, id, parsed.data);
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.key }, { status: error.status });
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "rythms_invalid_input" }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "rythms_slug_taken" }, { status: 409 });
    }
    return NextResponse.json({ error: "rythms_save_failed" }, { status: 500 });
  }
}
