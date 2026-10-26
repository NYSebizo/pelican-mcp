export interface Config {
  /** Panel base URL without trailing slash. */
  url: string;
  /** Client API key (`pacc_…`), used for everything a panel user can do. */
  clientKey?: string;
  /** Application API key (`papp_…`), used for admin operations. */
  applicationKey?: string;
  /** Only register tools that never change anything. */
  readOnly: boolean;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

function flag(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const url = env["PELICAN_URL"]?.trim().replace(/\/+$/, "");
  if (!url) throw new ConfigError("PELICAN_URL is not set.");
  if (!/^https?:\/\//.test(url)) {
    throw new ConfigError(`PELICAN_URL must start with http:// or https:// (got "${url}").`);
  }

  let clientKey = env["PELICAN_CLIENT_API_KEY"]?.trim() || undefined;
  let applicationKey = env["PELICAN_APPLICATION_API_KEY"]?.trim() || undefined;

  // Legacy single-key setup: route the key to the right API by its prefix.
  const legacy = env["PELICAN_API_KEY"]?.trim();
  if (legacy) {
    if (legacy.startsWith("papp_")) applicationKey ??= legacy;
    else clientKey ??= legacy;
  }

  if (!clientKey && !applicationKey) {
    throw new ConfigError(
      "No API key configured. Set PELICAN_CLIENT_API_KEY (pacc_…) and/or PELICAN_APPLICATION_API_KEY (papp_…).",
    );
  }

  const timeout = Number(env["PELICAN_TIMEOUT_MS"] ?? 30_000);

  return {
    url,
    clientKey,
    applicationKey,
    readOnly: flag(env["PELICAN_READ_ONLY"]),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 30_000,
  };
}
