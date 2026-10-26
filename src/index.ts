#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../package.json" with { type: "json" };
import { PelicanApi } from "./api.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { registerGroups } from "./tool.ts";
import { groups } from "./tools/index.ts";

const INSTRUCTIONS = `Tools for managing a Pelican game server panel.
- Tools without the admin_ prefix use the client API and identify servers by their short identifier (e.g. 'a1b2c3d4') or UUID; get them from list_servers.
- admin_* tools use the application API and identify servers, users, nodes etc. by numeric ID; get them from the admin_list_* tools.
- Prefer run_command over send_command when you need to see the result of a console command.
- Destructive tools (delete, kill, reinstall, restore) cannot be undone: confirm with the user first and suggest a backup where it makes sense.`;

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`pelican-mcp: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const api = new PelicanApi(config);
  const server = new McpServer({ name: "pelican-mcp", version: pkg.version }, { instructions: INSTRUCTIONS });

  const toolsets = process.env["PELICAN_TOOLSETS"]
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const known = new Set(groups.map((g) => g.name));
  for (const name of toolsets ?? []) {
    if (!known.has(name)) console.error(`pelican-mcp: unknown toolset "${name}" (known: ${[...known].join(", ")})`);
  }

  const registered = registerGroups(server, { api, config }, groups, { toolsets });
  const apis = [config.clientKey && "client", config.applicationKey && "application"].filter(Boolean).join(" + ");

  return server.connect(new StdioServerTransport()).then(() => {
    console.error(
      `pelican-mcp ${pkg.version} connected to ${config.url} (${apis} API${config.readOnly ? ", read-only" : ""}) with ${registered.length} tools`,
    );
  });
}

await main();
