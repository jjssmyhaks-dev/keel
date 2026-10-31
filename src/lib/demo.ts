export function demoLoginEnabled() {
  return process.env.ALLOW_DEMO_LOGIN === "1" || process.env.NODE_ENV !== "production";
}
