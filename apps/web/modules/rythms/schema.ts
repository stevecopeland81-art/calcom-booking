import { z } from "zod";

export const shortSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "rythms_invalid_slug");

export const companySchema = z.object({
  action: z.literal("saveCompany"),
  id: z.string().cuid().optional(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(600),
  contactEmail: z.union([z.string().trim().email().max(254), z.literal("")]),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  published: z.boolean(),
  eventTypeIds: z
    .array(z.number().int().positive())
    .max(50)
    .transform((ids) => Array.from(new Set(ids))),
  sharedConflictChecks: z.boolean(),
});

export const linkSchema = z.object({
  action: z.literal("createLink"),
  slug: shortSlugSchema,
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("portfolio") }),
    z.object({ kind: z.literal("company"), companyId: z.string().cuid() }),
    z.object({ kind: z.literal("event"), eventTypeId: z.number().int().positive() }),
  ]),
});

export const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("inviteMember"),
    companyId: z.string().cuid(),
    email: z.string().trim().toLowerCase().email().max(254),
  }),
  z.object({ action: z.literal("acceptInvitation"), token: z.string().regex(/^[a-zA-Z0-9_-]{43}$/) }),
  z.object({
    action: z.literal("removeMember"),
    companyId: z.string().cuid(),
    userId: z.number().int().positive(),
  }),
  z.object({ action: z.literal("revokeInvitation"), companyId: z.string().cuid(), id: z.string().cuid() }),
  z.object({
    action: z.literal("setCompanyMeetings"),
    companyId: z.string().cuid(),
    eventTypeIds: z
      .array(z.number().int().positive())
      .max(50)
      .transform((ids) => Array.from(new Set(ids))),
    sharedConflictChecks: z.boolean(),
  }),
  companySchema,
  linkSchema,
  z.object({ action: z.literal("toggleLink"), id: z.string().cuid(), enabled: z.boolean() }),
  z.object({ action: z.literal("deleteLink"), id: z.string().cuid() }),
  z.object({ action: z.literal("deleteCompany"), id: z.string().cuid() }),
]);

export type WorkspaceMutation = z.infer<typeof mutationSchema>;
export type CompanyInput = z.infer<typeof companySchema>;
