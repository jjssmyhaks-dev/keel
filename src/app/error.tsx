"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[keel] unhandled route error", error);
  }, [error]);

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-6 py-24">
      <div className="w-full max-w-xl">
        <p className="mono-label text-foreground/40 mb-6">500 · Something failed</p>
        <h1 className="font-display text-5xl leading-[0.95] tracking-tight lg:text-6xl">
          The request
          <br />
          <span className="text-foreground/35">stopped here.</span>
        </h1>
        <p className="mt-6 text-[15px] leading-relaxed text-foreground/60">
          Keel logged the failure and did not continue the operation. Retry, or check the status page before trying
          again.
        </p>
        {error.digest ? (
          <p className="mt-4 font-mono text-[11px] text-foreground/40">Digest: {error.digest}</p>
        ) : null}
        <div className="mt-8 flex flex-wrap gap-3">
          <button
            onClick={reset}
            className="inline-flex h-12 items-center bg-foreground px-6 text-sm font-medium text-background hover:bg-foreground/90"
          >
            Try again
          </button>
          <Link
            href="/status"
            className="inline-flex h-12 items-center border border-foreground/20 px-6 text-sm hover:bg-foreground/5"
          >
            System status
          </Link>
        </div>
      </div>
    </main>
  );
}
