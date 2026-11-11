"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  confirmMfaEnrollmentAction,
  disableMfaAction,
  regenerateRecoveryCodesAction,
  type EnrollState,
} from "./actions";

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="w-4 h-4" />
        <p className="font-mono text-[10px] uppercase tracking-[0.16em]">Recovery codes — shown once</p>
      </div>
      <p className="mb-3 text-[12px] text-muted-foreground">
        Store these somewhere safe. Each code signs you in once if you lose your authenticator.
      </p>
      <div className="grid grid-cols-2 gap-2 border border-foreground/15 bg-foreground/[0.03] p-3 font-mono text-[12px]">
        {codes.map((code) => (
          <span key={code}>{code}</span>
        ))}
      </div>
      <Link
        href="/app"
        className="mt-4 inline-block border border-foreground px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:bg-foreground hover:text-background"
      >
        I saved my codes — continue
      </Link>
    </div>
  );
}

export function EnrollForm({
  qrSvg,
  secret,
  required,
}: {
  qrSvg: string;
  secret: string;
  required: boolean;
}) {
  const [state, action, pending] = useActionState<EnrollState, FormData>(confirmMfaEnrollmentAction, {});

  if (state.codes) return <RecoveryCodes codes={state.codes} />;

  return (
    <div>
      <div className="mono-label text-muted-foreground mb-3">Two-factor authentication</div>
      <h1 className="text-4xl font-display tracking-tight leading-none">Add a second key.</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Scan the QR code with any TOTP authenticator, then confirm the six-digit code.
        {required ? " Your organization requires MFA, so this step is mandatory." : ""}
      </p>

      <div className="mt-6 border border-foreground/15 bg-white p-4 w-fit" dangerouslySetInnerHTML={{ __html: qrSvg }} />

      <div className="mt-4">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Manual entry</p>
        <p className="mt-1 break-all font-mono text-[12px]">{secret}</p>
      </div>

      <form action={action} className="mt-6 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="code" className="text-xs">Six-digit code</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            placeholder="123456"
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
          Enable two-factor
        </Button>
      </form>
    </div>
  );
}

export function ManageMfa({
  enabledAt,
  recoveryRemaining,
  enforced,
}: {
  enabledAt: string;
  recoveryRemaining: number;
  enforced: boolean;
}) {
  const [regenState, regenAction, regenPending] = useActionState<EnrollState, FormData>(
    regenerateRecoveryCodesAction,
    {},
  );
  const [disableState, disableAction, disablePending] = useActionState<EnrollState, FormData>(
    disableMfaAction,
    {},
  );

  return (
    <div>
      <div className="mono-label text-muted-foreground mb-3">Two-factor authentication</div>
      <h1 className="text-4xl font-display tracking-tight leading-none">Second factor is on.</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Enabled {new Date(enabledAt).toLocaleDateString()} · {recoveryRemaining} recovery code
        {recoveryRemaining === 1 ? "" : "s"} remaining.
        {enforced ? " Your organization requires MFA, so it cannot be disabled here." : ""}
      </p>

      {regenState.codes ? (
        <div className="mt-6">
          <RecoveryCodes codes={regenState.codes} />
        </div>
      ) : (
        <form action={regenAction} className="mt-6 space-y-3 border border-foreground/15 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em]">Regenerate recovery codes</p>
          <p className="text-[12px] text-muted-foreground">
            Old codes stop working immediately. Confirm with a current authenticator code.
          </p>
          <Input name="code" inputMode="numeric" required placeholder="123456" className="h-10 rounded-none font-mono tracking-[0.3em]" />
          {regenState.error && <p className="text-[12px] text-red-600">{regenState.error}</p>}
          <Button type="submit" disabled={regenPending} variant="outline" className="rounded-none">
            {regenPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Generate new codes
          </Button>
        </form>
      )}

      {!enforced ? (
        <form action={disableAction} className="mt-4 space-y-3 border border-red-600/25 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-red-700">Disable two-factor</p>
          <p className="text-[12px] text-muted-foreground">
            Your sessions stay valid, but future sign-ins will only need your password.
          </p>
          <Input name="code" required placeholder="Code or recovery code" className="h-10 rounded-none font-mono" />
          {disableState.error && <p className="text-[12px] text-red-600">{disableState.error}</p>}
          <Button type="submit" disabled={disablePending} variant="outline" className="rounded-none border-red-600/40 text-red-700">
            {disablePending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Disable two-factor
          </Button>
        </form>
      ) : null}

      <Link href="/app/settings" className="mt-6 inline-block font-mono text-[10px] uppercase tracking-[0.14em] underline underline-offset-2">
        Back to settings
      </Link>
    </div>
  );
}
