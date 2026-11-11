import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Authab } from "@authab/sdk";
import { UsageError, flagString, type ParsedArgs } from "./args";

export interface Profile {
  apiKey: string;
  baseUrl?: string;
}

interface ConfigFile {
  defaultProfile?: string;
  profiles: Record<string, Profile>;
}

export const CONFIG_PATH = process.env.AUTHAB_CONFIG ?? join(homedir(), ".authab", "config.json");

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
      throw new UsageError(`${CONFIG_PATH} is not valid JSON. Fix or remove it, then run authab login again.`);
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

export async function resolveClient(args: ParsedArgs): Promise<{ authab: Authab; profileName: string; baseUrl: string }> {
  const envKey = process.env.AUTHAB_API_KEY;
  const requested = flagString(args, "env") ?? process.env.AUTHAB_ENV;
  const baseUrlFlag = flagString(args, "base-url");
  const baseUrlEnv = process.env.AUTHAB_BASE_URL;

  if (envKey) {
    const baseUrl = baseUrlFlag ?? baseUrlEnv ?? "https://api.authab.dev/v1";
    return {
      authab: new Authab({ apiKey: envKey, baseUrl }),
      profileName: requested ?? "env",
      baseUrl,
    };
  }

  const config = await loadConfig();
  const name = requested ?? config.defaultProfile;
  if (!name || !config.profiles[name]) {
    if (!requested && config.defaultProfile === undefined) {
      throw new UsageError(
        "No Authab credentials found. Run `authab login --api-key sk_...` or set AUTHAB_API_KEY.",
      );
    }
    throw new UsageError(
      `No stored key for profile “${name ?? "default"}”. Run \`authab login --env ${name ?? "production"} --api-key sk_...\`.`,
    );
  }
  const profile = config.profiles[name];
  const baseUrl = baseUrlFlag ?? profile.baseUrl ?? baseUrlEnv ?? "https://api.authab.dev/v1";
  return {
    authab: new Authab({ apiKey: profile.apiKey, baseUrl }),
    profileName: name,
    baseUrl,
  };
}
