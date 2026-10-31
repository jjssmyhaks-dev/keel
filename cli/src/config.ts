import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Keel } from "@keel/sdk";
import { UsageError, flagString, type ParsedArgs } from "./args";

export interface Profile {
  apiKey: string;
  baseUrl?: string;
}

interface ConfigFile {
  defaultProfile?: string;
  profiles: Record<string, Profile>;
}

export const CONFIG_PATH = process.env.KEEL_CONFIG ?? join(homedir(), ".keel", "config.json");

export async function loadConfig(): Promise<ConfigFile> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<ConfigFile>;
    return {
      defaultProfile: parsed.defaultProfile,
      profiles: parsed.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { profiles: {} };
    if (error instanceof SyntaxError) {
      throw new UsageError(`${CONFIG_PATH} is not valid JSON. Fix or remove it, then run keel login again.`);
    }
    throw error;
  }
}

export async function saveProfile(name: string, profile: Profile, makeDefault = true): Promise<void> {
  const config = await loadConfig();
  config.profiles[name] = profile;
  if (makeDefault || !config.defaultProfile) config.defaultProfile = name;
  await mkdir(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  const temp = `${CONFIG_PATH}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(temp, 0o600).catch(() => null);
  await rename(temp, CONFIG_PATH);
}

export async function resolveClient(args: ParsedArgs): Promise<{ keel: Keel; profileName: string; baseUrl: string }> {
  const envKey = process.env.KEEL_API_KEY;
  const requested = flagString(args, "env") ?? process.env.KEEL_ENV;
  const baseUrlFlag = flagString(args, "base-url");
  const baseUrlEnv = process.env.KEEL_BASE_URL;

  if (envKey) {
    const baseUrl = baseUrlFlag ?? baseUrlEnv ?? "https://api.keel.dev/v1";
    return {
      keel: new Keel({ apiKey: envKey, baseUrl }),
      profileName: requested ?? "env",
      baseUrl,
    };
  }

  const config = await loadConfig();
  const name = requested ?? config.defaultProfile;
  if (!name || !config.profiles[name]) {
    if (!requested && config.defaultProfile === undefined) {
      throw new UsageError(
        "No Keel credentials found. Run `keel login --api-key sk_...` or set KEEL_API_KEY.",
      );
    }
    throw new UsageError(
      `No stored key for profile “${name ?? "default"}”. Run \`keel login --env ${name ?? "production"} --api-key sk_...\`.`,
    );
  }
  const profile = config.profiles[name];
  const baseUrl = baseUrlFlag ?? profile.baseUrl ?? baseUrlEnv ?? "https://api.keel.dev/v1";
  return {
    keel: new Keel({ apiKey: profile.apiKey, baseUrl }),
    profileName: name,
    baseUrl,
  };
}
