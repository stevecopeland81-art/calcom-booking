import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  connectMicrosoftMail,
  MAIL_SCOPE,
  mailConfig,
  microsoftMailAppKeys,
  microsoftMailStatus,
  sendMicrosoftMail,
} from "@calcom/emails/lib/microsoftMail";
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { WEBAPP_URL } from "@calcom/lib/constants";
import prisma from "@calcom/prisma";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const COOKIE = "__Host-rythms-mail";
const callback = () => `${new URL(WEBAPP_URL).origin}/api/rythms/mail`;
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
const stateSchema = z.object({
  state: z.string().length(43),
  verifier: z.string().length(43),
  userId: z.number(),
  expires: z.number(),
});
async function owner() {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (session?.user?.id !== mailConfig().ownerId) return false;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  return user?.role === "ADMIN";
}
function finish(result: string) {
  const response = NextResponse.redirect(`${new URL(WEBAPP_URL).origin}/companies?mail=${result}`, 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set(COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    if (!(await owner())) return reply({ error: "rythms_mail_forbidden" }, 403);
    if (params.has("code") || params.has("error")) {
      const encoded = (await cookies()).get(COOKIE)?.value;
      if (!encoded || encoded.length > 4096) return finish("failed");
      const state = stateSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
      const returned = params.get("state") || "";
      if (
        returned.length !== state.state.length ||
        !timingSafeEqual(Buffer.from(returned), Buffer.from(state.state)) ||
        state.expires < Date.now() ||
        state.userId !== mailConfig().ownerId ||
        params.has("error")
      )
        return finish("failed");
      const code = params.get("code");
      if (!code || code.length > 12000) return finish("failed");
      await connectMicrosoftMail(code, state.verifier, callback());
      return finish("connected");
    }
    return reply(await microsoftMailStatus());
  } catch {
    return params.has("code") || params.has("error")
      ? finish("failed")
      : reply({ error: "rythms_mail_unavailable" }, 503);
  }
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(WEBAPP_URL).origin)
    return reply({ error: "rythms_invalid_origin" }, 403);
  try {
    if (!(await owner())) return reply({ error: "rythms_mail_forbidden" }, 403);
    const body = await request.text();
    if (body.length > 100) return reply({ error: "rythms_invalid_input" }, 400);
    const action = z.object({ action: z.enum(["connect", "test"]) }).parse(JSON.parse(body)).action;
    if (action === "test")
      return reply(
        await sendMicrosoftMail({
          to: mailConfig().email,
          subject: "Rythms Cal email connection test",
          text: "Your Rythms Cal Microsoft 365 email connection submitted this test message successfully. Booking confirmations can use this sender.",
        })
      );
    const keys = await microsoftMailAppKeys();
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const query = new URLSearchParams({
      response_type: "code",
      client_id: keys.client_id,
      redirect_uri: callback(),
      scope: MAIL_SCOPE,
      state,
      prompt: "select_account",
      login_hint: mailConfig().email,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    });
    const response = reply({
      url: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${query}`,
    });
    response.cookies.set(
      COOKIE,
      Buffer.from(
        JSON.stringify({ state, verifier, userId: mailConfig().ownerId, expires: Date.now() + 600000 })
      ).toString("base64url"),
      { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 }
    );
    return response;
  } catch {
    return reply({ error: "rythms_mail_unavailable" }, 503);
  }
}
