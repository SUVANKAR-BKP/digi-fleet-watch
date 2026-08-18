import { notFound } from "next/navigation";
import { HostDetail } from "@/components/dashboard/host-detail";
import { getHostDetail } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function HostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const num = Number(id);
  if (!Number.isInteger(num) || num <= 0) notFound();

  const data = await getHostDetail(num);
  if (!data) notFound();

  return <HostDetail data={data} />;
}