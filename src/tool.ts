import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { PelicanApiError, type ApiScope, type PelicanApi } from "./api.ts";
import type { Config } from "./config.ts";

/**
 * - `read`: never changes anything.
 * - `write`: changes state but can be undone / is not data-destroying.
 * - `destructive`: deletes data or interrupts service (delete, kill, reinstall, restore…).
 */
export type ToolKind = "read" | "write" | "destructive";

export interface ToolContext {
  api: PelicanApi;
  config: Config;
}

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  scope: ApiScope;
  kind: ToolKind;
  /** Calling twice with the same input has the same effect as calling once. */
  idempotent?: boolean;
  input: S;
  run: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown>;
}

/** Identity helper that keeps the `run` arguments typed from the `input` shape. */
export function tool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

export interface ToolGroup {
  /** Name used by PELICAN_TOOLSETS to enable/disable the group. */
  name: string;
  tools: ToolDef<any>[];
}

function format(result: unknown): string {
  if (result === undefined || result === null || result === "") return "Done.";
  if (typeof result === "string") return result;
  return JSON.stringify(result, null, 2);
}

function errorText(err: unknown): string {
  if (err instanceof PelicanApiError) return err.message;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

export interface RegisterOptions {
  /** Only register these groups (all when undefined). */
  toolsets?: string[];
}

/** Registers every tool the configured keys can actually use, honouring read-only mode and toolset filters. */
export function registerGroups(server: McpServer, ctx: ToolContext, groups: ToolGroup[], options: RegisterOptions = {}) {
  const registered: string[] = [];
  const wanted = options.toolsets?.length ? new Set(options.toolsets) : undefined;

  for (const group of groups) {
    if (wanted && !wanted.has(group.name)) continue;

    for (const def of group.tools) {
      if (!ctx.api.has(def.scope)) continue;
      if (ctx.config.readOnly && def.kind !== "read") continue;

      server.registerTool(
        def.name,
        {
          title: def.title,
          description: def.description,
          inputSchema: def.input,
          annotations: {
            title: def.title,
            readOnlyHint: def.kind === "read",
            destructiveHint: def.kind === "destructive",
            idempotentHint: def.kind === "read" || def.idempotent === true,
            openWorldHint: true,
          },
        },
        (async (args: unknown): Promise<CallToolResult> => {
          try {
            const result = await def.run(args as never, ctx);
            return { content: [{ type: "text", text: format(result) }] };
          } catch (err) {
            return { content: [{ type: "text", text: errorText(err) }], isError: true };
          }
        }) as never,
      );
      registered.push(def.name);
    }
  }
  return registered;
}
