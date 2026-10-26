import { z } from "zod";
import { unwrap } from "../../api.ts";
import { defined, filter, include, merge, numericId, page, perPage, seg, sort } from "../../schemas.ts";
import { tool, type ToolGroup } from "../../tool.ts";

// ─── Eggs ──────────────────────────────────────────────────────────────────────

export const adminEggTools: ToolGroup = {
  name: "admin-eggs",
  tools: [
    tool({
      name: "admin_list_eggs",
      title: "Admin: list eggs",
      description: "List all eggs (server types) with their docker images, startup commands and features.",
      scope: "application",
      kind: "read",
      input: { include: include(["servers", "variables"]), page, per_page: perPage },
      async run(q, { api }) {
        return api.page("application", "/eggs", q);
      },
    }),

    tool({
      name: "admin_get_egg",
      title: "Admin: get egg",
      description: "Get an egg including its variables (needed to know which environment values admin_create_server requires).",
      scope: "application",
      kind: "read",
      input: { id: numericId("egg"), include: include(["servers", "variables"]).default(["variables"]) },
      async run({ id, include }, { api }) {
        return unwrap(await api.application("GET", `/eggs/${seg(id)}`, { query: { include } }));
      },
    }),

    tool({
      name: "admin_export_egg",
      title: "Admin: export egg",
      description: "Export an egg as JSON or YAML (the same file the panel's export button produces).",
      scope: "application",
      kind: "read",
      input: { id: numericId("egg"), format: z.enum(["json", "yaml"]).default("json") },
      async run({ id, format }, { api }) {
        return api.application<string>("GET", `/eggs/${seg(id)}/export`, { query: { format }, text: true });
      },
    }),

    tool({
      name: "admin_import_egg",
      title: "Admin: import egg",
      description:
        "Import an egg from its JSON/YAML content (PLCN_v3 or legacy PTDL_v2), or from a URL (e.g. a raw GitHub link from pelican-eggs). Importing an egg with an existing UUID updates it.",
      scope: "application",
      kind: "write",
      input: {
        content: z.string().optional().describe("Egg file content (JSON or YAML)"),
        url: z.string().url().optional().describe("URL to download the egg file from"),
      },
      async run({ content, url }, { api }) {
        let body = content;
        if (!body && url) {
          const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
          if (!res.ok) throw new Error(`Downloading ${url} failed with HTTP ${res.status}.`);
          body = await res.text();
        }
        if (!body) throw new Error("Provide content or url.");
        const isJson = body.trimStart().startsWith("{");
        return unwrap(
          await api.application("POST", "/eggs/import", {
            body,
            headers: { "Content-Type": isJson ? "application/json" : "application/yaml" },
          }),
        );
      },
    }),

    tool({
      name: "admin_delete_egg",
      title: "Admin: delete egg",
      description: "Delete an egg (must not be used by any server).",
      scope: "application",
      kind: "destructive",
      input: { id: numericId("egg") },
      async run({ id }, { api }) {
        await api.application("DELETE", `/eggs/${seg(id)}`);
        return `Egg ${id} deleted.`;
      },
    }),
  ],
};

// ─── Database hosts ────────────────────────────────────────────────────────────

const dbHostFields = {
  name: z.string().min(1).max(255),
  host: z.string().min(1).describe("Hostname/IP of the MySQL/MariaDB server"),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1).max(32).describe("User with grant privileges"),
  password: z.string().nullable(),
  node_ids: z.array(z.number().int().positive()).nullable().describe("Nodes allowed to use this host"),
};

export const adminDatabaseHostTools: ToolGroup = {
  name: "admin-database-hosts",
  tools: [
    tool({
      name: "admin_list_database_hosts",
      title: "Admin: list database hosts",
      description: "List database hosts that server databases can be created on.",
      scope: "application",
      kind: "read",
      input: { filter: filter(["name", "host"]), sort: sort(["id", "name", "host"]), include: include(["databases", "nodes"]), page, per_page: perPage },
      async run(q, { api }) {
        return api.page("application", "/database-hosts", q);
      },
    }),

    tool({
      name: "admin_get_database_host",
      title: "Admin: get database host",
      description: "Get a database host.",
      scope: "application",
      kind: "read",
      input: { id: numericId("database host"), include: include(["databases", "nodes"]) },
      async run({ id, include }, { api }) {
        return unwrap(await api.application("GET", `/database-hosts/${seg(id)}`, { query: { include } }));
      },
    }),

    tool({
      name: "admin_create_database_host",
      title: "Admin: create database host",
      description: "Add a MySQL/MariaDB host the panel can create server databases on.",
      scope: "application",
      kind: "write",
      input: { ...dbHostFields, port: dbHostFields.port.default(3306), node_ids: dbHostFields.node_ids.optional() },
      async run(body, { api }) {
        return unwrap(await api.application("POST", "/database-hosts", { body: defined(body) }));
      },
    }),

    tool({
      name: "admin_update_database_host",
      title: "Admin: update database host",
      description: "Update a database host. Unspecified fields keep their current value (password is only changed if given).",
      scope: "application",
      kind: "write",
      idempotent: true,
      input: {
        id: numericId("database host"),
        name: dbHostFields.name.optional(),
        host: dbHostFields.host.optional(),
        port: dbHostFields.port.optional(),
        username: dbHostFields.username.optional(),
        password: dbHostFields.password.optional(),
        node_ids: dbHostFields.node_ids.optional(),
      },
      async run({ id, ...changes }, { api }) {
        const cur = unwrap(await api.application("GET", `/database-hosts/${seg(id)}`)) as Record<string, unknown>;
        const body = merge(cur, ["name", "host", "port", "username"], changes);
        return unwrap(await api.application("PATCH", `/database-hosts/${seg(id)}`, { body }));
      },
    }),

    tool({
      name: "admin_delete_database_host",
      title: "Admin: delete database host",
      description: "Delete a database host (must not have databases).",
      scope: "application",
      kind: "destructive",
      input: { id: numericId("database host") },
      async run({ id }, { api }) {
        await api.application("DELETE", `/database-hosts/${seg(id)}`);
        return `Database host ${id} deleted.`;
      },
    }),
  ],
};

// ─── Mounts ────────────────────────────────────────────────────────────────────

const mountFields = {
  name: z.string().min(2).max(64),
  description: z.string().max(255).nullable(),
  source: z.string().min(1).describe("Path on the node"),
  target: z.string().min(1).describe("Path inside the container"),
  read_only: z.boolean(),
  user_mountable: z.boolean().describe("Users may mount it themselves"),
};
const mountRelation = z.enum(["eggs", "nodes", "servers"]);

export const adminMountTools: ToolGroup = {
  name: "admin-mounts",
  tools: [
    tool({
      name: "admin_list_mounts",
      title: "Admin: list mounts",
      description: "List mounts (host directories that can be mounted into server containers).",
      scope: "application",
      kind: "read",
      input: { filter: filter(["uuid", "name"]), sort: sort(["id", "uuid"]), include: include(["eggs", "nodes", "servers"]), page, per_page: perPage },
      async run(q, { api }) {
        return api.page("application", "/mounts", q);
      },
    }),

    tool({
      name: "admin_get_mount",
      title: "Admin: get mount",
      description: "Get a mount and the eggs, nodes and servers it is attached to.",
      scope: "application",
      kind: "read",
      input: { id: numericId("mount") },
      async run({ id }, { api }) {
        return unwrap(await api.application("GET", `/mounts/${seg(id)}`, { query: { include: ["eggs", "nodes", "servers"] } }));
      },
    }),

    tool({
      name: "admin_create_mount",
      title: "Admin: create mount",
      description: "Create a mount. Attach it afterwards with admin_attach_mount.",
      scope: "application",
      kind: "write",
      input: {
        ...mountFields,
        description: mountFields.description.optional(),
        read_only: mountFields.read_only.default(false),
        user_mountable: mountFields.user_mountable.default(false),
      },
      async run(body, { api }) {
        return unwrap(await api.application("POST", "/mounts", { body: defined(body) }));
      },
    }),

    tool({
      name: "admin_update_mount",
      title: "Admin: update mount",
      description: "Update a mount. Unspecified fields keep their current value.",
      scope: "application",
      kind: "write",
      idempotent: true,
      input: {
        id: numericId("mount"),
        name: mountFields.name.optional(),
        description: mountFields.description.optional(),
        source: mountFields.source.optional(),
        target: mountFields.target.optional(),
        read_only: mountFields.read_only.optional(),
        user_mountable: mountFields.user_mountable.optional(),
      },
      async run({ id, ...changes }, { api }) {
        const cur = unwrap(await api.application("GET", `/mounts/${seg(id)}`)) as Record<string, unknown>;
        return unwrap(await api.application("PATCH", `/mounts/${seg(id)}`, { body: merge(cur, Object.keys(mountFields), changes) }));
      },
    }),

    tool({
      name: "admin_attach_mount",
      title: "Admin: attach mount",
      description: "Attach a mount to eggs, nodes or servers.",
      scope: "application",
      kind: "write",
      idempotent: true,
      input: { id: numericId("mount"), to: mountRelation, ids: z.array(z.number().int().positive()).min(1) },
      async run({ id, to, ids }, { api }) {
        await api.application("POST", `/mounts/${seg(id)}/${to}`, { body: { [to]: ids } });
        return unwrap(await api.application("GET", `/mounts/${seg(id)}`, { query: { include: [to] } }));
      },
    }),

    tool({
      name: "admin_detach_mount",
      title: "Admin: detach mount",
      description: "Detach a mount from an egg, node or server.",
      scope: "application",
      kind: "write",
      idempotent: true,
      input: { id: numericId("mount"), from: mountRelation, target_id: z.number().int().positive() },
      async run({ id, from, target_id }, { api }) {
        await api.application("DELETE", `/mounts/${seg(id)}/${from}/${seg(target_id)}`);
        return `Mount ${id} detached from ${from.slice(0, -1)} ${target_id}.`;
      },
    }),

    tool({
      name: "admin_delete_mount",
      title: "Admin: delete mount",
      description: "Delete a mount.",
      scope: "application",
      kind: "destructive",
      input: { id: numericId("mount") },
      async run({ id }, { api }) {
        await api.application("DELETE", `/mounts/${seg(id)}`);
        return `Mount ${id} deleted.`;
      },
    }),
  ],
};

// ─── Plugins ───────────────────────────────────────────────────────────────────

const plugin = z.string().min(1).describe("Plugin ID (from admin_list_plugins)");

export const adminPluginTools: ToolGroup = {
  name: "admin-plugins",
  tools: [
    tool({
      name: "admin_list_plugins",
      title: "Admin: list plugins",
      description: "List panel plugins with version, status and update availability.",
      scope: "application",
      kind: "read",
      input: { filter: filter(["id", "name", "author", "category"]), sort: sort(["id", "name", "author", "category"]), page, per_page: perPage },
      async run(q, { api }) {
        return api.page("application", "/plugins", { ...q, per_page: q.per_page ?? 100 });
      },
    }),

    tool({
      name: "admin_get_plugin",
      title: "Admin: get plugin",
      description: "Get details of a plugin.",
      scope: "application",
      kind: "read",
      input: { id: plugin },
      async run({ id }, { api }) {
        return unwrap(await api.application("GET", `/plugins/${seg(id)}`));
      },
    }),

    tool({
      name: "admin_import_plugin",
      title: "Admin: import plugin",
      description: "Download a plugin archive (.zip) from a URL into the panel. Install it afterwards with admin_manage_plugin.",
      scope: "application",
      kind: "write",
      input: { url: z.string().url() },
      async run({ url }, { api }) {
        await api.application("POST", "/plugins/import/url", { body: { url } });
        return `Plugin imported from ${url}.`;
      },
    }),

    tool({
      name: "admin_manage_plugin",
      title: "Admin: install / update / enable / disable / uninstall plugin",
      description:
        "Run a lifecycle action on a plugin. uninstall with delete_files=true also removes the plugin's files from disk.",
      scope: "application",
      kind: "destructive",
      input: {
        id: plugin,
        action: z.enum(["install", "update", "enable", "disable", "uninstall"]),
        delete_files: z.boolean().default(false).describe("Only for uninstall"),
      },
      async run({ id, action, delete_files }, { api }) {
        const res = await api.application("POST", `/plugins/${seg(id)}/${action}`, {
          body: action === "uninstall" ? { delete: delete_files } : undefined,
        });
        return res ? unwrap(res) : `Plugin ${id}: ${action} done.`;
      },
    }),

    tool({
      name: "admin_set_plugin_hub",
      title: "Admin: set Pelican Hub credentials",
      description: "Connect the panel to the Pelican Hub for plugin downloads and update checks.",
      scope: "application",
      kind: "write",
      idempotent: true,
      input: {
        hub_url: z.string().url().describe("https:// base URL of the hub"),
        api_key: z.string().regex(/^pnl_[A-Za-z0-9]+$/).describe("Hub-issued key starting with pnl_"),
      },
      async run(body, { api }) {
        await api.application("PUT", "/plugins/hub", { body });
        return "Hub credentials saved.";
      },
    }),
  ],
};

// ─── Webhooks ──────────────────────────────────────────────────────────────────

const webhookFields = {
  name: z.string().min(1).max(191),
  description: z.string().max(191).nullable(),
  endpoint: z.string().url().max(191),
  type: z.string().describe("Webhook type, e.g. 'regular' or 'discord' (see admin_list_webhook_types)"),
  scope: z.enum(["global", "server"]).describe("server-scoped webhooks need server_id"),
  server_id: z.number().int().positive().nullable(),
  events: z.array(z.string()).min(1).describe("Event names (see admin_list_webhook_events)"),
  headers: z.record(z.string(), z.string()).nullable().describe("Extra HTTP headers"),
  payload: z.record(z.string(), z.unknown()).nullable().describe("Type-specific payload settings (e.g. Discord embed)"),
};

export const adminWebhookTools: ToolGroup = {
  name: "admin-webhooks",
  tools: [
    tool({
      name: "admin_list_webhooks",
      title: "Admin: list webhooks",
      description: "List configured webhooks.",
      scope: "application",
      kind: "read",
      input: {
        filter: filter(["name", "description", "endpoint", "type", "scope", "server_id"]),
        sort: sort(["id", "name", "type", "created_at"]),
        page,
        per_page: perPage,
      },
      async run(q, { api }) {
        return api.page("application", "/webhooks", q);
      },
    }),

    tool({
      name: "admin_get_webhook",
      title: "Admin: get webhook",
      description: "Get a webhook, optionally with its recent deliveries.",
      scope: "application",
      kind: "read",
      input: { id: numericId("webhook"), include: include(["server", "deliveries"]) },
      async run({ id, include }, { api }) {
        return unwrap(await api.application("GET", `/webhooks/${seg(id)}`, { query: { include } }));
      },
    }),

    tool({
      name: "admin_list_webhook_types",
      title: "Admin: list webhook types",
      description: "List available webhook types (e.g. regular, discord) registered by the panel and plugins.",
      scope: "application",
      kind: "read",
      input: {},
      async run(_a, { api }) {
        return unwrap(await api.application("GET", "/webhooks/types"));
      },
    }),

    tool({
      name: "admin_list_webhook_events",
      title: "Admin: list webhook events",
      description: "List the events a webhook can subscribe to.",
      scope: "application",
      kind: "read",
      input: { scope: z.enum(["global", "server"]).optional() },
      async run({ scope }, { api }) {
        return unwrap(await api.application("GET", "/webhooks/events", { query: { scope } }));
      },
    }),

    tool({
      name: "admin_create_webhook",
      title: "Admin: create webhook",
      description: "Create a webhook that fires on panel events.",
      scope: "application",
      kind: "write",
      input: {
        name: webhookFields.name,
        endpoint: webhookFields.endpoint,
        events: webhookFields.events,
        description: webhookFields.description.optional(),
        type: webhookFields.type.optional(),
        scope: webhookFields.scope.optional(),
        server_id: webhookFields.server_id.optional(),
        headers: webhookFields.headers.optional(),
        payload: webhookFields.payload.optional(),
      },
      async run(body, { api }) {
        return unwrap(await api.application("POST", "/webhooks", { body: defined(body) }));
      },
    }),

    tool({
      name: "admin_update_webhook",
      title: "Admin: update webhook",
      description: "Update a webhook. Only the fields you pass are changed.",
      scope: "application",
      kind: "write",
      idempotent: true,
      input: {
        id: numericId("webhook"),
        name: webhookFields.name.optional(),
        endpoint: webhookFields.endpoint.optional(),
        events: webhookFields.events.optional(),
        description: webhookFields.description.optional(),
        type: webhookFields.type.optional(),
        scope: webhookFields.scope.optional(),
        server_id: webhookFields.server_id.optional(),
        headers: webhookFields.headers.optional(),
        payload: webhookFields.payload.optional(),
      },
      async run({ id, ...changes }, { api }) {
        return unwrap(await api.application("PATCH", `/webhooks/${seg(id)}`, { body: defined(changes) }));
      },
    }),

    tool({
      name: "admin_test_webhook",
      title: "Admin: test webhook",
      description: "Send a test delivery to a webhook's endpoint.",
      scope: "application",
      kind: "write",
      input: {
        id: numericId("webhook"),
        event: z.string().optional().describe("Event name to simulate"),
        data: z.record(z.string(), z.unknown()).optional().describe("Sample event data"),
      },
      async run({ id, ...body }, { api }) {
        return api.application("POST", `/webhooks/${seg(id)}/test`, { body: defined(body) });
      },
    }),

    tool({
      name: "admin_delete_webhook",
      title: "Admin: delete webhook",
      description: "Delete a webhook.",
      scope: "application",
      kind: "destructive",
      input: { id: numericId("webhook") },
      async run({ id }, { api }) {
        await api.application("DELETE", `/webhooks/${seg(id)}`);
        return `Webhook ${id} deleted.`;
      },
    }),
  ],
};
