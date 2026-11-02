import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { Logo } from "@/components/logo";
import { completeOnboardingAction } from "@/app/(auth)/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata: Metadata = { title: "Set up your workspace" };

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.user.onboardedAt) redirect("/app");

  const membership = await db.membership.findFirst({
    where: { userId: session.user.id },
    include: { org: { include: { projects: { include: { environments: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const project = membership?.org.projects[0];
  const dev = project?.environments.find((e) => e.type === "development");

  return (
    <div className="min-h-screen bg-background grid lg:grid-cols-12">
      <aside className="lg:col-span-4 border-r border-foreground/10 bg-black text-white p-10 lg:p-12 flex flex-col justify-between min-h-[220px]">
        <Link href="/">
          <Logo tone="light" className="text-2xl" />
        </Link>
        <div className="hidden lg:block">
          <div className="mono-label text-white/30 mb-6">Setup · 01 of 02</div>
          <h2 className="font-display text-4xl leading-[1.05]">
            A home for
            <br />
            <span className="text-white/35">your agents.</span>
          </h2>
          <p className="mt-6 text-sm text-white/45 leading-relaxed">
            Two environments are created automatically: development for building, production
            for the calls your customers see.
          </p>
        </div>
        <div className="font-mono text-[10px] text-white/25">
          signed in as {session.user.email}
        </div>
      </aside>

      <main className="lg:col-span-8 flex items-center px-6 py-16 lg:px-20">
        <div className="w-full max-w-lg">
          <div className="mono-label text-muted-foreground mb-4">Workspace</div>
          <h1 className="text-5xl font-display tracking-tight leading-[0.95] mb-3">
            Name the places
            <br />
            <span className="text-muted-foreground">your agents live.</span>
          </h1>
          <p className="text-sm text-muted-foreground mb-10">
            You can rename either of these at any time.
          </p>

          <form action={completeOnboardingAction} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="workspace" className="text-xs">Organization</Label>
              <Input
                id="workspace"
                name="workspace"
                defaultValue={membership?.org.name ?? ""}
                className="h-12 rounded-none"
                required
              />
              <p className="text-[10px] text-muted-foreground font-mono">
                members, roles, billing and audit retention live here
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project" className="text-xs">Project</Label>
              <Input
                id="project"
                name="project"
                defaultValue={project?.name ?? "Default project"}
                className="h-12 rounded-none"
                required
              />
              <p className="text-[10px] text-muted-foreground font-mono">
                agents, connections and permissions live here
              </p>
            </div>

            <div className="border border-foreground/10 divide-y divide-foreground/10">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">Development environment</span>
                <span className="font-mono text-[10px] text-muted-foreground">created · {dev?.id.slice(0, 12)}…</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">Production environment</span>
                <span className="font-mono text-[10px] text-muted-foreground">created · locked until Pro</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">API keys</span>
                <span className="font-mono text-[10px] text-muted-foreground">create in Developers · shown once</span>
              </div>
            </div>

            <button
              type="submit"
              className="w-full h-12 bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
            >
              Enter the dashboard
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
