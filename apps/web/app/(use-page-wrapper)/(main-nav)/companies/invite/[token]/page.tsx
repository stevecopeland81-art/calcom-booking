import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import AcceptInvitation from "~/rythms/AcceptInvitation";

export const metadata = {
  title: "Company invitation | Rythms Cal",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) notFound();
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id)
    redirect(`/auth/login?callbackUrl=${encodeURIComponent(`/companies/invite/${token}`)}`);
  return <AcceptInvitation token={token} />;
}
