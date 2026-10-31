"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { resetPasswordAction, type FormState } from "../actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(resetPasswordAction, {});
  return (
    <div>
      <Link href="/sign-in" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground mb-8">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
      </Link>
      <h1 className="text-4xl font-display tracking-tight leading-none mb-3">Choose a new password</h1>
      <p className="text-sm text-muted-foreground mb-8">
        This signs out every other session on your account.
      </p>
      <form action={action} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <div className="space-y-2">
          <Label htmlFor="password" className="text-xs">New password</Label>
          <Input id="password" name="password" type="password" required autoComplete="new-password" placeholder="At least 10 characters" className="h-11 rounded-none" />
        </div>
        {state.error && (
          <p className="text-[12px] text-red-600 border border-red-600/20 bg-red-600/[0.04] px-3 py-2">{state.error}</p>
        )}
        <Button type="submit" disabled={pending} className="w-full h-11 rounded-none bg-foreground text-background">
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Update password
        </Button>
      </form>
    </div>
  );
}
