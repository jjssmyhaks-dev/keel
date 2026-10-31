"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { OAuthButtons } from "../oauth-buttons";
import {
  signInAction,
  signInDemoAction,
  requestMagicLinkAction,
  type FormState,
} from "../actions";

export function SignInForm({ next, demoEnabled = false }: { next?: string; demoEnabled?: boolean }) {
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [passwordState, passwordAction, passwordPending] = useActionState<FormState, FormData>(
    signInAction,
    {}
  );
  const [magicState, magicAction, magicPending] = useActionState<FormState, FormData>(
    requestMagicLinkAction,
    {}
  );

  return (
    <div>
      <div className="mb-8">
        <div className="mono-label text-muted-foreground mb-3">Welcome back</div>
        <h1 className="text-4xl font-display tracking-tight leading-none">Sign in to Keel</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Continue to your agents, vault and approval queue.
        </p>
      </div>

      <OAuthButtons mode="sign-in" />

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-foreground/10" />
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-foreground/10" />
      </div>

      <div className="mb-5 inline-flex border border-foreground/15 font-mono text-[10px]">
        <button
          type="button"
          onClick={() => setMode("password")}
          className={`px-3 py-1.5 uppercase tracking-widest transition-colors ${
            mode === "password" ? "bg-foreground text-background" : "text-muted-foreground"
          }`}
        >
          Password
        </button>
        <button
          type="button"
          onClick={() => setMode("magic")}
          className={`px-3 py-1.5 uppercase tracking-widest transition-colors ${
            mode === "magic" ? "bg-foreground text-background" : "text-muted-foreground"
          }`}
        >
          Magic link
        </button>
      </div>

      {mode === "password" ? (
        <form action={passwordAction} className="space-y-4">
          <input type="hidden" name="next" value={next || ""} />
          <div className="space-y-2">
            <Label htmlFor="email" className="text-xs">Work email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" className="h-11 rounded-none" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="text-xs">Password</Label>
              <Link href="/forgot-password" className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2">
                Forgot?
              </Link>
            </div>
            <Input id="password" name="password" type="password" autoComplete="current-password" required placeholder="••••••••••" className="h-11 rounded-none" />
          </div>
          {passwordState.error && (
            <p className="text-[12px] text-red-600 border border-red-600/20 bg-red-600/[0.04] px-3 py-2">
              {passwordState.error}
            </p>
          )}
          <Button type="submit" disabled={passwordPending} className="w-full h-11 rounded-none bg-foreground text-background gap-2">
            {passwordPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Sign in
            {!passwordPending && <ArrowRight className="w-4 h-4" />}
          </Button>
        </form>
      ) : (
        <form action={magicAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="magic-email" className="text-xs">Work email</Label>
            <Input id="magic-email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" className="h-11 rounded-none" />
          </div>
          {magicState.error && (
            <p className="text-[12px] text-red-600 border border-red-600/20 bg-red-600/[0.04] px-3 py-2">{magicState.error}</p>
          )}
          {magicState.notice && (
            <p className="text-[12px] text-emerald-700 border border-emerald-600/20 bg-emerald-600/[0.05] px-3 py-2">{magicState.notice}</p>
          )}
          <Button type="submit" disabled={magicPending} className="w-full h-11 rounded-none bg-foreground text-background gap-2">
            {magicPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Email me a link
          </Button>
        </form>
      )}

      {demoEnabled ? (
        <>
          <form action={signInDemoAction} className="mt-5">
            <button
              type="submit"
              className="w-full h-11 border border-dashed border-foreground/25 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-colors"
            >
              Explore the demo workspace
            </button>
          </form>
          <p className="mt-2 text-center font-mono text-[10px] text-muted-foreground/70">
            demo@keel.dev · KeelDemo!2026 · Northwind Labs
          </p>
        </>
      ) : null}

      <p className="mt-8 text-center text-sm text-muted-foreground">
        New to Keel?{" "}
        <Link href="/sign-up" className="text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground">
          Create an account
        </Link>
      </p>
    </div>
  );
}
