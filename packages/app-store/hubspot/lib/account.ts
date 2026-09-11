import { z } from "zod";

const accountSchema = z.object({
  hubId: z.number().int().positive().optional(),
  hubDomain: z.string().optional(),
});

export function getHubspotAccount(key: unknown) {
  const result = accountSchema.safeParse(key);
  return result.success ? result.data : {};
}

export function isSelectedHubspotCredential(
  credential: { id: number; invalid?: boolean | null },
  app: { enabled?: boolean; credentialId?: number } | undefined
) {
  // A missing or disconnected account must never fall back to another company's portal.
  return !credential.invalid && app?.enabled === true && app.credentialId === credential.id;
}
