import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import process from "node:process";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import prisma from "@calcom/prisma";
import { createTransport, type SendMailOptions } from "nodemailer";
import { z } from "zod";

export const MAIL_SCOPE = "User.Read Mail.Send offline_access";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const TYPE = "rythms_microsoft_mail";
const fail = () =>
  new ErrorWithCode(
    ErrorCode.InternalServerError,
    "Microsoft booking email is unavailable. Reconnect the configured sender."
  );
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  scope: z.string(),
  expires_at: z.number(),
  email: z.string().email(),
});
type MailToken = z.infer<typeof tokenSchema>;

export function mailConfig() {
  const ownerId = Number(process.env.RYTHMS_MICROSOFT_MAIL_OWNER_ID);
  const parsed = z.string().email().safeParse(process.env.EMAIL_FROM);
  if (!Number.isSafeInteger(ownerId) || ownerId < 1 || !parsed.success) throw fail();
  return { ownerId, email: parsed.data.toLowerCase() };
}

function encryptionKey() {
  const key = process.env.CALENDSO_ENCRYPTION_KEY;
  if (!key || key.length < 32) throw fail();
  return createHash("sha256").update(key).digest();
}
export function encryptMailToken(token: MailToken) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(token), "utf8"), cipher.final()]);
  return [
    "rythms-mail-v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}
export function decryptMailToken(value: string): MailToken {
  try {
    const [version, iv, tag, ciphertext] = value.split(":");
    if (version !== "rythms-mail-v1") throw fail();
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const token = tokenSchema.parse(
      JSON.parse(
        Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8")
      )
    );
    if (
      token.email.toLowerCase() !== mailConfig().email ||
      !token.scope.split(" ").some((s) => /^(https:\/\/graph.microsoft.com\/)?Mail.Send$/i.test(s))
    )
      throw fail();
    return token;
  } catch {
    throw fail();
  }
}

async function credential() {
  return prisma.credential.findFirst({
    where: { userId: mailConfig().ownerId, type: TYPE, teamId: null },
    select: { id: true, encryptedKey: true },
    orderBy: { id: "desc" },
  });
}
export async function microsoftMailStatus() {
  const config = mailConfig();
  const row = await credential();
  let connected = false;
  try {
    connected = Boolean(row?.encryptedKey && decryptMailToken(row.encryptedKey));
  } catch {
    /* A revoked or unreadable connection must not look ready. */
  }
  return { email: config.email, connected };
}
export async function microsoftMailAppKeys() {
  const app = await prisma.app.findUnique({ where: { slug: "office365-calendar" }, select: { keys: true } });
  const keys = z
    .object({ client_id: z.string().min(1), client_secret: z.string().min(1) })
    .safeParse(app?.keys);
  if (!keys.success) throw fail();
  return keys.data;
}
async function exchange(params: Record<string, string>) {
  const keys = await microsoftMailAppKeys();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, ...keys }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw fail();
  return response.json();
}
export async function connectMicrosoftMail(code: string, verifier: string, redirectUri: string) {
  const config = mailConfig();
  const result = await exchange({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    scope: MAIL_SCOPE,
  });
  const parsed = z
    .object({
      access_token: z.string().min(1),
      refresh_token: z.string().min(1),
      expires_in: z.number().positive(),
      scope: z.string(),
    })
    .safeParse(result);
  if (!parsed.success) throw fail();
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${parsed.data.access_token}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw fail();
  const identity = z
    .object({ mail: z.string().nullable(), userPrincipalName: z.string() })
    .parse(await response.json());
  const email = (identity.mail || identity.userPrincipalName).toLowerCase();
  if (email !== config.email) throw fail();
  const encryptedKey = encryptMailToken({
    ...parsed.data,
    email,
    expires_at: Date.now() + parsed.data.expires_in * 1000,
  });
  decryptMailToken(encryptedKey);
  const row = await credential();
  if (row)
    await prisma.credential.update({
      where: { id: row.id },
      data: { encryptedKey, invalid: false },
      select: { id: true },
    });
  else
    await prisma.credential.create({
      data: { userId: config.ownerId, type: TYPE, key: {}, encryptedKey },
      select: { id: true },
    });
}

let refreshInFlight: Promise<string> | undefined;
async function accessToken() {
  const row = await credential();
  if (!row?.encryptedKey) throw fail();
  const current = decryptMailToken(row.encryptedKey);
  if (current.expires_at > Date.now() + 120000) return current.access_token;
  const result = await exchange({
    grant_type: "refresh_token",
    refresh_token: current.refresh_token,
    scope: MAIL_SCOPE,
  });
  const parsed = z
    .object({
      access_token: z.string().min(1),
      refresh_token: z.string().min(1).optional(),
      expires_in: z.number().positive(),
      scope: z.string().optional(),
    })
    .safeParse(result);
  if (!parsed.success) throw fail();
  const updated = {
    ...current,
    ...parsed.data,
    refresh_token: parsed.data.refresh_token || current.refresh_token,
    scope: parsed.data.scope || current.scope,
    expires_at: Date.now() + parsed.data.expires_in * 1000,
  };
  const encryptedKey = encryptMailToken(updated);
  decryptMailToken(encryptedKey);
  // A concurrent reconnect or refresh must never be overwritten with an older token.
  const saved = await prisma.credential.updateMany({
    where: { id: row.id, encryptedKey: row.encryptedKey },
    data: { encryptedKey },
  });
  if (saved.count) return updated.access_token;
  const latest = await credential();
  if (!latest?.encryptedKey) throw fail();
  return decryptMailToken(latest.encryptedKey).access_token;
}
async function getAccessToken() {
  if (!refreshInFlight)
    refreshInFlight = accessToken().finally(() => {
      refreshInFlight = undefined;
    });
  return refreshInFlight;
}
export async function buildMicrosoftMime(payload: SendMailOptions) {
  const transport = createTransport({
    streamTransport: true,
    buffer: true,
    newline: "windows",
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const message = await transport.sendMail({
    ...payload,
    from: { name: process.env.EMAIL_FROM_NAME || "Rythms Cal", address: mailConfig().email },
    sender: undefined,
    raw: undefined,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  if (!Buffer.isBuffer(message.message)) throw fail();
  const encoded = message.message.toString("base64");
  if (encoded.length > 4 * 1024 * 1024) throw fail();
  return encoded;
}
export async function sendMicrosoftMail(payload: SendMailOptions) {
  try {
    const mime = await buildMicrosoftMime(payload);
    const token = await getAccessToken();
    const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
      body: mime,
      signal: AbortSignal.timeout(30000),
    });
    // Do not automatically retry a send: a lost response can follow a successful delivery.
    if (response.status !== 202) throw fail();
    return { accepted: true };
  } catch {
    throw fail();
  }
}
