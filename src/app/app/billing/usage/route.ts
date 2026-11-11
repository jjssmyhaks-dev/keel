import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { effectivePlan } from "@/lib/limits";
import { usageStatementCsv } from "@/lib/billing-rules";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getContext();
  const plan = effectivePlan(ctx.org.plan, ctx.org.planStatus);
  const records = await db.usageRecord.findMany({
    where: { orgId: ctx.org.id, metric: "proxy_calls" },
    orderBy: { period: "desc" },
    take: 12,
  });

  const csv = usageStatementCsv({
    organization: ctx.org.name,
    plan: plan.name,
    allowance: plan.limits.callsPerMonth,
    generatedAt: new Date(),
    rows: records.map((record) => ({ period: record.period, calls: record.quantity })),
  });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="authab-usage-${ctx.org.slug}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
