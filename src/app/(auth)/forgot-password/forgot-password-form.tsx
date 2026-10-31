"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { requestPasswordResetAction, type FormState } from "../actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(requestPasswordResetAction, {});
  return (
    <div>
      <Link href="/sign-in" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground mb-8">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
      </Link>
      <h1 className="text-4xl font-display tracking-tight leading-none mb-3">Reset your password</h1>
      <p className="text-sm text-muted-foreground mb-8">
        We&apos;ll email a single-use link. It expires in one hour.
      </p>
      <form action={action} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email" className="text-xs">Email</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" placeholder="you@company.com" className="h-11 rounded-none" />
        </div>
        {state.error && (
          <p className="text-[12px] text-red-600 border border-red-600/20 bg-red-600/[0.04] px-3 py-2">{state.error}</p>
        )}
        {state.notice && (
          <p className="text-[12px] text-emerald-700 border border-emerald-600/20 bg-emerald-600/[0.05] px-3 py-2">{state.notice}</p>
        )}
        <Button type="submit" disabled={pending} className="w-full h-11 rounded-none bg-foreground text-background">
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Send reset link
        </Button>
      </form>
    </div>
  );
}
