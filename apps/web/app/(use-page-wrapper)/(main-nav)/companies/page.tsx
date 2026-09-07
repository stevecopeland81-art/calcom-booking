import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import Workspace from "~/rythms/Workspace";

export const metadata = { title: "Companies | Rythms Cal" };

export default async function CompaniesPage() {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/auth/login?callbackUrl=%2Fcompanies");
  return <Workspace />;
}
