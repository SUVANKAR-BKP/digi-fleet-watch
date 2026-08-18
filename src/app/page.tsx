import { Overview } from "@/components/dashboard/overview";
import { getOverview } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const data = await getOverview();
  return <Overview data={data} />;
}