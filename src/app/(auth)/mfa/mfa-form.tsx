"use client";

import { useActionState, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { verifyMfaChallengeAction, type MfaState } from "./actions";

export function MfaChallengeForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<MfaState, FormData>(verifyMfaChallengeAction, {});
  const [recovery, setRecovery] = useState(false);

  return (
    <div>
      <div className="mb-8">
        <div className="mono-label text-muted-foreground mb-3">Second factor</div>
        <h1 className="text-4xl font-display tracking-tight leading-none">Confirm it&apos;s you.</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Enter the 6-digit code from your authenticator app{recovery ? " or one of your recovery codes" : ""}.
        </p>
      </div>

      <form action={action} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <div className="space-y-2">
          <Label htmlFor="code" className="text-xs">
            {recovery ? "Recovery code" : "Authentication code"}
          </Label>
          <Input
            id="code"
            name="code"
            inputMode={recovery ? "text" : "numeric"}
            autoComplete="one-time-code"
            autoFocus
            required
            placeholder={recovery ? "abcde-12345" : "123456"}
            className="h-11 rounded-none font-mono tracking-[0.3em]"
          />
        </div>
        {state.error && (
          <p className="text-[12px] text-red-600 border border-red-600/20 bg-red-600/[0.04] px-3 py-2">
            {state.error}
          </p>
        )}
        <Button type="submit" disabled={pending} className="w-full h-11 rounded-none bg-foreground text-background gap-2">
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Verify and continue
          {!pending && <ArrowRight className="w-4 h-4" />}
        </Button>
      </form>

      <button
        type="button"
        onClick={() => setRecovery((value) => !value)}
        className="mt-5 w-full text-center text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        {recovery ? "Use an authenticator code instead" : "Lost your authenticator? Use a recovery code"}
      </button>
    </div>
  );
}
