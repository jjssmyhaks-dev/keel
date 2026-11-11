"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { OAuthButtons } from "../oauth-buttons";
import type { Provider } from "@/lib/oauth";
import { signUpAction, type FormState } from "../actions";

export function SignUpForm({
  plan,
  next,
  providers,
}: {
  plan?: string;
  next?: string;
  providers: Provider[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(signUpAction, {});

  return (
    <div>
      <div className="mb-8">
        <div className="mono-label text-muted-foreground mb-3">Start free</div>
        <h1 className="text-4xl font-display tracking-tight leading-none">Create your workspace</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Development mode is free forever. No credit card required.
        </p>
      </div>

      {plan && plan !== "free" && (
        <div className="mb-6 border border-[#eca8d6]/40 bg-[#eca8d6]/[0.06] px-4 py-3 text-[12px]">
          <span className="font-medium capitalize">{plan} plan</span>{" "}
          <span className="text-muted-foreground">
            requested. Your workspace starts on Free; paid plans are activated after a sales confirmation.
          </span>
        </div>
      )}

      {providers.length > 0 && (
        <>
          <OAuthButtons providers={providers} />

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-foreground/10" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">or with email</span>
            <span className="h-px flex-1 bg-foreground/10" />
          </div>
        </>
      )}

      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value={next || ""} />
        <div className="space-y-2">
          <Label htmlFor="name" className="text-xs">Full name</Label>
          <Input id="name" name="name" autoComplete="name" required placeholder="Maya Raman" className="h-11 rounded-none" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email" className="text-xs">Work email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" className="h-11 rounded-none" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="orgName" className="text-xs">Workspace name <span className="text-muted-foreground">(optional)</span></Label>
          <Input id="orgName" name="orgName" autoComplete="organization" placeholder="Northwind Labs" className="h-11 rounded-none" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password" className="text-xs">Password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" required placeholder="At least 10 characters" className="h-11 rounded-none" />
          <p className="text-[10px] text-muted-foreground font-mono">10+ characters, one letter, one number</p>
        </div>

        {state.error && (
          <p className="text-[12px] text-red-600 border border-red-600/20 bg-red-600/[0.04] px-3 py-2">{state.error}</p>
        )}

        <Button type="submit" disabled={pending} className="w-full h-11 rounded-none bg-foreground text-background gap-2">
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Create workspace
          {!pending && <ArrowRight className="w-4 h-4" />}
        </Button>

        <p className="text-[10px] text-muted-foreground leading-relaxed text-center">
          By creating an account you agree to the{" "}
          <Link href="/legal/terms" className="underline underline-offset-2 hover:text-foreground">Terms</Link> and{" "}
          <Link href="/legal/privacy" className="underline underline-offset-2 hover:text-foreground">Privacy Policy</Link>.
        </p>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground">
          Sign in
        </Link>
      </p>
    </div>
  );
}
