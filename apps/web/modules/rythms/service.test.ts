import "@calcom/testing/lib/__mocks__/prisma";
import db from "@calcom/prisma";
import { beforeEach, describe, expect, it } from "vitest";
import { companySchema, mutationSchema, shortSlugSchema } from "./schema";
import { getPublicBookingPage, getWorkspace, mutateWorkspace } from "./service";

beforeEach(async () => {
  await db.user.create({ data: { id: 1, email: "owner@example.test", name: "Owner", username: "owner" } });
  await db.user.create({ data: { id: 2, email: "other@example.test", name: "Other", username: "other" } });
  await db.eventType.create({
    data: {
      id: 10,
      userId: 1,
      title: "Consultation",
      slug: "consult",
      length: 30,
      useEventLevelSelectedCalendars: true,
    },
  });
  await db.eventType.create({
    data: {
      id: 20,
      userId: 2,
      title: "Other meeting",
      slug: "other",
      length: 30,
      users: { connect: { id: 1 } },
    },
  });
});

const companyInput = (overrides: object = {}) =>
  companySchema.parse({
    action: "saveCompany",
    name: "First company",
    description: "Consulting",
    contactEmail: "business@example.test",
    brandColor: "#2563eb",
    published: false,
    eventTypeIds: [10],
    sharedConflictChecks: true,
    ...overrides,
  });

async function createCompany(published = false) {
  await mutateWorkspace(db, 1, companyInput({ published }));
  return (await getWorkspace(db, 1)).companies[0];
}

describe("company ownership and shared availability", () => {
  it("persists companies with selected meetings and switches those meetings to shared conflict checks", async () => {
    const company = await createCompany();
    expect(company.name).toBe("First company");
    expect(company.eventTypes.map((event) => event.id)).toEqual([10]);
    expect(await db.eventType.findUnique({ where: { id: 10 } })).toMatchObject({
      useEventLevelSelectedCalendars: false,
    });
    expect((await getWorkspace(db, 2)).companies).toEqual([]);
  });

  it("rejects another owner's event even when the caller is a co-host", async () => {
    await expect(mutateWorkspace(db, 1, companyInput({ eventTypeIds: [20] }))).rejects.toMatchObject({
      status: 403,
    });
    expect((await getWorkspace(db, 1)).companies).toHaveLength(0);
  });

  it("rejects editing and deleting another owner's company", async () => {
    const company = await createCompany();
    await expect(mutateWorkspace(db, 2, { ...companyInput(), id: company.id })).rejects.toMatchObject({
      status: 404,
    });
    await expect(mutateWorkspace(db, 2, { action: "deleteCompany", id: company.id })).rejects.toMatchObject({
      status: 404,
    });
    expect((await getWorkspace(db, 1)).companies).toHaveLength(1);
  });

  it("preserves event-specific calendars when shared checks are not selected", async () => {
    await mutateWorkspace(db, 1, companyInput({ sharedConflictChecks: false }));
    expect(await db.eventType.findUnique({ where: { id: 10 } })).toMatchObject({
      useEventLevelSelectedCalendars: true,
    });
  });
});

describe("short booking links", () => {
  it("normalizes short names and rejects emails, paths, and scripts", () => {
    expect(shortSlugSchema.parse("  Meet-Steve ")).toBe("meet-steve");
    for (const slug of ["a@b.com", "../admin", "https://host", "a--b", "<script>", "-first", "x"]) {
      expect(shortSlugSchema.safeParse(slug).success).toBe(false);
    }
    expect(
      mutationSchema.safeParse({ action: "createLink", slug: "first", target: { kind: "company" } }).success
    ).toBe(false);
  });

  it("does not publish drafts through company links or portfolio links", async () => {
    const company = await createCompany();
    await mutateWorkspace(db, 1, {
      action: "createLink",
      slug: "company",
      target: { kind: "company", companyId: company.id },
    });
    await mutateWorkspace(db, 1, { action: "createLink", slug: "portfolio", target: { kind: "portfolio" } });
    expect(await getPublicBookingPage(db, "company")).toBeNull();
    expect(await getPublicBookingPage(db, "portfolio")).toMatchObject({ kind: "page", companies: [] });
  });

  it("shows only the company's visible meetings and never returns private contact email", async () => {
    const company = await createCompany(true);
    await mutateWorkspace(db, 1, {
      action: "createLink",
      slug: "company",
      target: { kind: "company", companyId: company.id },
    });
    const publicPage = await getPublicBookingPage(db, "company");
    expect(publicPage).toMatchObject({ companies: [{ name: "First company", eventTypes: [{ id: 10 }] }] });
    expect(JSON.stringify(publicPage)).not.toContain("example.test");
    await db.eventType.update({ where: { id: 10 }, data: { hidden: true } });
    expect(await getPublicBookingPage(db, "company")).toMatchObject({ companies: [{ eventTypes: [] }] });
  });

  it("supports multiple aliases for one destination and revokes disabled links", async () => {
    await mutateWorkspace(db, 1, {
      action: "createLink",
      slug: "hello",
      target: { kind: "event", eventTypeId: 10 },
    });
    await mutateWorkspace(db, 1, {
      action: "createLink",
      slug: "consultation",
      target: { kind: "event", eventTypeId: 10 },
    });
    expect(await getPublicBookingPage(db, "hello")).toEqual({ kind: "event", href: "/owner/consult" });
    expect(await getPublicBookingPage(db, "consultation")).toEqual({ kind: "event", href: "/owner/consult" });
    const link = (await getWorkspace(db, 1)).links[0];
    await expect(
      mutateWorkspace(db, 2, { action: "toggleLink", id: link.id, enabled: false })
    ).rejects.toMatchObject({ status: 404 });
    await mutateWorkspace(db, 1, { action: "toggleLink", id: link.id, enabled: false });
    expect(await getPublicBookingPage(db, "hello")).toBeNull();
  });

  it("rejects aliases to another account's company and meetings", async () => {
    const company = await createCompany(true);
    await expect(
      mutateWorkspace(db, 2, {
        action: "createLink",
        slug: "hijack",
        target: { kind: "company", companyId: company.id },
      })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      mutateWorkspace(db, 1, {
        action: "createLink",
        slug: "hijack",
        target: { kind: "event", eventTypeId: 20 },
      })
    ).rejects.toMatchObject({ status: 403 });
  });
});
