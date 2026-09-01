import { Overview } from "@/components/dashboard/overview";
import { checkSummary } from "@/lib/checks";
import { getOverview } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const data = await getOverview();

  // Demo mode has no database, so there is nothing to summarise. A failure
  // here must not take the whole dashboard down with it.
  let failingChecks = 0;
  let degradedChecks = 0;
  if (!data.demo) {
    try {
      const summary = await checkSummary();
      failingChecks = summary.failing;
      degradedChecks = summary.degraded;
    } catch {
      failingChecks = 0;
      degradedChecks = 0;
    }
  }

  return (
    <Overview
      data={data}
      failingChecks={failingChecks}
      degradedChecks={degradedChecks}
    />
  );
}
