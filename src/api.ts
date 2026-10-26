import type { Config } from "./config.ts";

export type ApiScope = "client" | "application";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Query = Record<string, unknown>;

export interface RequestOptions {
  query?: Query;
  /** JSON-serialised unless it is already a string, Blob or FormData. */
  body?: unknown;
  /** Return the raw response text instead of parsing JSON. */
  text?: boolean;
  headers?: Record<string, string>;
}

/** An error returned by the panel, with every validation message flattened into one readable string. */
export class PelicanApiError extends Error {
  override name = "PelicanApiError";

  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly details: string[],
  ) {
    super(`${method} ${path} failed with HTTP ${status}: ${details.join("; ")}`);
  }
}

export class MissingKeyError extends Error {
  override name = "MissingKeyError";

  constructor(scope: ApiScope) {
    const env = scope === "client" ? "PELICAN_CLIENT_API_KEY (pacc_…)" : "PELICAN_APPLICATION_API_KEY (papp_…)";
    super(`This tool needs the ${scope} API. Set ${env} in the MCP server environment.`);
  }
}

const HINTS: Record<number, string> = {
  401: "The API key was rejected. Check that it is valid and not expired.",
  403: "The API key is not allowed to do this. Check its permissions (or the subuser's permissions on this server).",
  404: "Not found. Double-check the ID/identifier.",
  409: "Conflict: the server is probably busy (installing, transferring or restoring a backup). Try again later.",
  429: "Rate limited by the panel. Wait a moment and retry.",
};

function errorDetails(status: number, statusText: string, body: unknown): string[] {
  const errors = (body as { errors?: Array<{ detail?: string; code?: string; meta?: { source_field?: string } }> })
    ?.errors;
  const details =
    errors
      ?.map((e) => {
        const field = e.meta?.source_field;
        const msg = e.detail ?? e.code ?? "";
        return field && !msg.includes(field) ? `${field}: ${msg}` : msg;
      })
      .filter(Boolean) ?? [];

  if (details.length === 0) {
    const message = (body as { message?: string })?.message;
    details.push(message || statusText || "Unknown error");
  }
  const hint = HINTS[status];
  if (hint) details.push(hint);
  return details;
}

/**
 * Serialises nested objects the way Laravel expects them:
 * `{ filter: { name: "x" }, include: ["a", "b"] }` → `filter[name]=x&include=a,b`.
 */
export function buildQuery(query: Query = {}): string {
  const params = new URLSearchParams();
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) {
      if (value.length) params.append(key, value.join(","));
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) add(`${key}[${k}]`, v);
    } else {
      params.append(key, String(value));
    }
  };
  for (const [key, value] of Object.entries(query)) add(key, value);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Strips the Fractal envelope (`{ object, attributes, relationships }`) recursively so tools hand
 * plain, compact objects to the model.
 */
export function unwrap(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unwrap);
  if (!value || typeof value !== "object") return value;

  const obj = value as Record<string, unknown>;
  if (obj["object"] === "null_resource") return null;
  if (obj["object"] === "list" && Array.isArray(obj["data"])) return (obj["data"] as unknown[]).map(unwrap);
  if (typeof obj["object"] === "string" && obj["attributes"] && typeof obj["attributes"] === "object") {
    const { relationships, ...attributes } = obj["attributes"] as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(attributes)) out[k] = unwrap(v);
    if (relationships && typeof relationships === "object") {
      for (const [k, v] of Object.entries(relationships)) out[k] = unwrap(v);
    }
    return out;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = unwrap(v);
  return out;
}

export interface Page<T = unknown> {
  items: T[];
  pagination?: { total: number; count: number; per_page: number; current_page: number; total_pages: number };
}

export class PelicanApi {
  constructor(private readonly config: Config) {}

  get baseUrl(): string {
    return this.config.url;
  }

  has(scope: ApiScope): boolean {
    return Boolean(scope === "client" ? this.config.clientKey : this.config.applicationKey);
  }

  private key(scope: ApiScope): string {
    const key = scope === "client" ? this.config.clientKey : this.config.applicationKey;
    if (!key) throw new MissingKeyError(scope);
    return key;
  }

  async request<T = unknown>(
    scope: ApiScope,
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = `${this.config.url}/api/${scope}${path}${buildQuery(options.query)}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.key(scope)}`,
      Accept: options.text ? "text/plain, application/json" : "application/json",
      ...options.headers,
    };

    let body: RequestInit["body"];
    if (options.body !== undefined) {
      if (typeof options.body === "string" || options.body instanceof Blob || options.body instanceof FormData) {
        body = options.body;
      } else {
        body = JSON.stringify(options.body);
        headers["Content-Type"] = "application/json";
      }
    }

    let res: Response;
    try {
      res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(this.config.timeoutMs) });
    } catch (err) {
      const reason = err instanceof Error && err.name === "TimeoutError" ? `timed out after ${this.config.timeoutMs} ms` : String(err);
      throw new Error(`${method} ${path}: could not reach ${this.config.url} (${reason})`);
    }

    const raw = await res.text();
    let parsed: unknown = raw;
    if (!options.text || !res.ok) {
      try {
        parsed = raw ? JSON.parse(raw) : undefined;
      } catch {
        parsed = raw;
      }
    }

    if (!res.ok) throw new PelicanApiError(res.status, method, path, errorDetails(res.status, res.statusText, parsed));
    return parsed as T;
  }

  client<T = unknown>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("client", method, path, options);
  }

  application<T = unknown>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("application", method, path, options);
  }

  /** Fetches one page of a list endpoint and unwraps it. */
  async page(scope: ApiScope, path: string, query: Query = {}): Promise<Page> {
    const res = await this.request<{ data?: unknown[]; meta?: { pagination?: Page["pagination"] } }>(scope, "GET", path, {
      query,
    });
    return { items: (unwrap(res?.data ?? []) as unknown[]) ?? [], pagination: res?.meta?.pagination };
  }

  /** Walks every page of a list endpoint (capped at `max` items). */
  async all(scope: ApiScope, path: string, query: Query = {}, max = 1000): Promise<unknown[]> {
    const items: unknown[] = [];
    for (let page = 1; ; page++) {
      const res = await this.page(scope, path, { ...query, page, per_page: 100 });
      items.push(...res.items);
      const p = res.pagination;
      if (!p || page >= p.total_pages || items.length >= max || res.items.length === 0) break;
    }
    return items.slice(0, max);
  }
}
