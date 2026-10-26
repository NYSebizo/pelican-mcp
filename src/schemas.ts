import { z } from "zod";

/** Short identifier (`a1b2c3d4`) or full UUID of a server, as used by the client API. */
export const serverRef = z
  .string()
  .min(1)
  .describe("Server identifier: the 8-character short ID (e.g. 'a1b2c3d4') or full UUID. Use list_servers to find it.");

/** Numeric database ID of a resource, as used by the application API. */
export const numericId = (what: string) => z.coerce.number().int().positive().describe(`Numeric ${what} ID`);

export const page = z.coerce.number().int().min(1).optional().describe("Page number (default 1)");
export const perPage = z.coerce.number().int().min(1).max(100).optional().describe("Results per page (max 100, default 50)");

export const filter = (fields: string[]) =>
  z
    .record(z.string(), z.string())
    .optional()
    .describe(`Filter results by field (partial match). Allowed keys: ${fields.join(", ")}`);

export const sort = (fields: string[]) =>
  z
    .string()
    .optional()
    .describe(`Sort field (${fields.join(", ")}); prefix with '-' for descending`);

export const include = (relations: string[]) =>
  z
    .array(z.enum(relations as [string, ...string[]]))
    .optional()
    .describe("Related resources to embed in the response");

/** Encodes one path segment (IDs, UUIDs, fingerprints). */
export const seg = (value: string | number) => encodeURIComponent(String(value));

export const srv = (id: string) => `/servers/${seg(id)}`;

/** Copies only keys whose value is not undefined, so PATCH bodies don't clobber fields with null. */
export function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Picks `keys` from `source`, then overlays the defined values from `changes`. */
export function merge(source: Record<string, unknown>, keys: string[], changes: Record<string, unknown>) {
  const base: Record<string, unknown> = {};
  for (const key of keys) if (source[key] !== undefined) base[key] = source[key];
  return { ...base, ...defined(changes) };
}

export const bytes = (n: number | undefined | null): string => {
  if (n == null) return "n/a";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};
