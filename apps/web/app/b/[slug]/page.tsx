import { getTranslation } from "@calcom/i18n/server";
import prisma from "@calcom/prisma";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { shortSlugSchema } from "~/rythms/schema";
import { getPublicBookingPage } from "~/rythms/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Book a meeting | Rythms Cal", robots: { index: false, follow: false } };

export default async function ShortBookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const rawSlug = (await params).slug;
  const parsed = shortSlugSchema.safeParse(rawSlug);
  if (!parsed.success) notFound();
  if (parsed.data !== rawSlug) redirect(`/b/${parsed.data}`);
  const page = await getPublicBookingPage(prisma, parsed.data);
  if (!page) notFound();
  if (page.kind === "event") redirect(page.href);
  const t = await getTranslation("en", "common");
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 text-default sm:py-20">
      <div className="mb-10 flex items-center gap-3">
        <img src="/rythms-icon.svg" width={36} height={36} alt="" />
        <span className="text-lg font-semibold">Rythms Cal</span>
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">
        {page.companyOnly
          ? page.companies[0].name
          : t("rythms_public_title", { name: page.owner.name || t("rythms_your_host") })}
      </h1>
      <p className="mb-10 mt-3 text-base text-subtle">{t("rythms_public_description")}</p>
      {!page.companies.length && <p>{t("rythms_nothing_published")}</p>}
      <div className="space-y-8">
        {page.companies.map((company) => (
          <section key={company.id} className="overflow-hidden rounded-xl border border-subtle">
            <div className="border-l-4 p-6" style={{ borderLeftColor: company.brandColor }}>
              <h2 className="text-xl font-semibold">{company.name}</h2>
              {company.description && (
                <p className="mt-2 whitespace-pre-line text-base text-subtle">{company.description}</p>
              )}
            </div>
            <div className="px-6 pb-4">
              {company.eventTypes.map((event) => (
                <Link
                  key={event.id}
                  href={event.href}
                  className="flex items-center justify-between gap-4 border-t border-subtle py-5 hover:text-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
                  <span className="font-medium">
                    {event.title}
                    <span className="mt-1 block text-sm font-normal text-subtle">{event.hostName}</span>
                  </span>
                  <span className="shrink-0 text-sm">
                    {event.length} {t("minutes")} →
                  </span>
                </Link>
              ))}
              {!company.eventTypes.length && (
                <p className="pb-3 text-subtle">{t("rythms_nothing_published")}</p>
              )}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
