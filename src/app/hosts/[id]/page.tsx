import { AlertTriangle } from "lucide-react";
import { notFound } from "next/navigation";
import { HostDetail } from "@/components/dashboard/host-detail";
import { getCurrentUser } from "@/lib/auth-server";
import { getHostDetail } from "@/lib/data";
import { resolveBaseUrl } from "@/lib/install-context";
import { can } from "@/lib/rbac";
import type { HostDetailData } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const num = Number(id);
  if (!Number.isInteger(num) || num <= 0) notFound();

  let data: HostDetailData | null;
  try {
    data = await getHostDetail(num);
  } catch (err) {
    // Show what actually broke. Previously any failure here was rendered as
    // "not found", so a schema problem looked like a missing host.
    return <HostLoadError message={err instanceof Error ? err.message : String(err)} />;
  }

  if (!data) notFound();

  const user = await getCurrentUser();

  return (
    <HostDetail
      data={data}
      baseUrl={await resolveBaseUrl()}
      canDelete={can(user?.role, "hosts:delete")}
    />
  );
}

function HostLoadError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-down/40 bg-down/10 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-down">
        <AlertTriangle className="h-4 w-4" />
        Could not load this host
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        The host exists, but building its detail view failed. This usually means
        the database schema is behind the application — check the server logs
        and confirm the migrations in <code>drizzle/</code> have been applied.
      </p>
      <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-5 text-foreground">
        {message}
      </pre>
    </div>
  );
}
