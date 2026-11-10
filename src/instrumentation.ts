export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ assertRuntimeConfig }, { getSecrets }] = await Promise.all([
    import("./lib/runtime-config"),
    import("./lib/secrets"),
  ]);
  try {
    assertRuntimeConfig();
    getSecrets();
  } catch (error) {
    // Next catches instrumentation errors and keeps serving 500s, so exit explicitly.
    console.error(error instanceof Error ? error.message : error);
    (globalThis as { process?: { exit(code: number): void } }).process?.exit(1);
  }
}
