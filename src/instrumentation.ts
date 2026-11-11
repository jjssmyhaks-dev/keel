import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ assertRuntimeConfig }, { getSecrets }, { startTelemetry }] = await Promise.all([
    import("./lib/runtime-config"),
    import("./lib/secrets"),
    import("./lib/tracing"),
  ]);
  try {
    assertRuntimeConfig();
    getSecrets();
  } catch (error) {
    // Next catches instrumentation errors and keeps serving 500s, so exit explicitly.
    console.error(error instanceof Error ? error.message : error);
    (globalThis as { process?: { exit(code: number): void } }).process?.exit(1);
  }
  await startTelemetry();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordRequestError } = await import("./lib/error-tracking");
  await recordRequestError(error, request, context);
};
