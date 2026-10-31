"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#faf9f6", color: "#0b0b0b", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ maxWidth: 560 }}>
            <p style={{ fontFamily: "monospace", fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: "#777" }}>
              500 · Keel failed to render
            </p>
            <h1 style={{ fontSize: 44, lineHeight: 1, margin: "18px 0 0", letterSpacing: -1 }}>Something broke before the page loaded.</h1>
            <p style={{ color: "#555", lineHeight: 1.6, marginTop: 18 }}>
              The operation was stopped and logged. Retry, or check the status page if this keeps happening.
            </p>
            {error.digest ? <p style={{ fontFamily: "monospace", fontSize: 11, color: "#888" }}>Digest: {error.digest}</p> : null}
            <button
              onClick={reset}
              style={{ marginTop: 24, height: 46, padding: "0 22px", background: "#0b0b0b", color: "#fff", border: 0, cursor: "pointer", fontSize: 14 }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
