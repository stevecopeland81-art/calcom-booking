import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { WEBAPP_URL } from "@calcom/lib/constants";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { calendarOptions, saveSync, syncStatus } from "~/rythms/calendar-sync/service";
import { SyncError, syncInputSchema } from "~/rythms/calendar-sync/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
async function userId() {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  return session?.user?.id;
}
function failure(error: unknown) {
  return reply(
    { error: error instanceof SyncError ? error.key : "rythms_sync_request_failed" },
    error instanceof SyncError ? error.status : 500
  );
}
export async function GET(request: Request) {
  const id = await userId();
  if (!id) return reply({ error: "rythms_sign_in" }, 401);
  try {
    const status = await syncStatus(id);
    if (new URL(request.url).searchParams.get("options") !== "1") return reply({ status });
    try {
      return reply({ status, options: await calendarOptions(id) });
    } catch {
      return reply({ status, options: [], optionsError: "rythms_sync_reconnect" });
    }
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(WEBAPP_URL).origin)
    return reply({ error: "rythms_invalid_origin" }, 403);
  const id = await userId();
  if (!id) return reply({ error: "rythms_sign_in" }, 401);
  try {
    const body = await request.text();
    if (body.length > 32000) return reply({ error: "rythms_invalid_input" }, 413);
    const parsed = syncInputSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return reply({ error: "rythms_invalid_input" }, 400);
    await saveSync(id, parsed.data);
    return reply({ status: await syncStatus(id) });
  } catch (error) {
    if (error instanceof SyntaxError) return reply({ error: "rythms_invalid_input" }, 400);
    return failure(error);
  }
}
