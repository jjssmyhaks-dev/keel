"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { verifyEmailAction, type FormState } from "../actions";

export function VerifyEmailForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(verifyEmailAction, {});

  if (state.notice) {
    return (
      <div>
        <div className="w-12 h-12 border border-emerald-600/30 bg-emerald-600/[0.06] flex items-center justify-center mb-6">
          <Check className="w-5 h-5 text-emerald-700" />
        </div>
        <h1 className="text-4xl font-display tracking-tight mb-3">Email verified</h1>
        <p className="text-sm text-muted-foreground mb-8">{state.notice}</p>
        <Link href="/app" className="inline-flex h-11 items-center px-6 bg-foreground text-background text-sm">
          Go to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-4xl font-display tracking-tight mb-3">Verify your email</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Confirm the address on your account to unlock production mode.
      </p>
      <form action={action}>
        <input type="hidden" name="token" value={token} />
        {state.error && (
          <p className="mb-4 text-[12px] text-red-600 border border-red-600/20 bg-red-600/[0.04] px-3 py-2">
            {state.error}
          </p>
        )}
        <Button type="submit" disabled={pending} className="w-full h-11 rounded-none bg-foreground text-background">
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Confirm email
        </Button>
      </form>
    </div>
  );
}
