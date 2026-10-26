import { z } from "zod";
import { unwrap } from "../../api.ts";
import { captureConsole } from "../../console.ts";
import { bytes, filter, include, page, perPage, serverRef, sort, srv } from "../../schemas.ts";
import { tool, type ToolGroup } from "../../tool.ts";

interface Resources {
  current_state: string;
  is_suspended: boolean;
  resources: {
    memory_bytes: number;
    cpu_absolute: number;
    disk_bytes: number;
    network_rx_bytes: number;
    network_tx_bytes: number;
    uptime: number;
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`, `${s % 60}s`].filter(Boolean).join(" ");
}

export const serverTools: ToolGroup = {
  name: "servers",
  tools: [
    tool({
      name: "list_servers",
      title: "List servers",
      description:
        "List the servers this account can access (owned or as subuser). Admins can pass type='admin-all' to see every server on the panel.",
      scope: "client",
      kind: "read",
      input: {
        type: z
          .enum(["owner", "admin", "admin-all"])
          .optional()
          .describe("owner = only owned servers; admin = servers you don't own (admins only); admin-all = every server (admins only)"),
        search: z.string().optional().describe("Free-text search across name, description, UUID and external ID"),
        filter: filter(["uuid", "name", "description", "external_id"]),
        include: include(["egg", "subusers"]),
        page,
        per_page: perPage,
      },
      async run({ type, search, filter, include, page, per_page }, { api }) {
        return api.page("client", "", {
          type,
          filter: { ...filter, ...(search ? { "*": search } : {}) },
          include,
          page,
          per_page,
        });
      },
    }),

    tool({
      name: "get_server",
      title: "Get server",
      description:
        "Get full details of a server: limits, feature limits, SFTP details, docker image, egg features, allocations and startup variables.",
      scope: "client",
      kind: "read",
      input: { server: serverRef, include: include(["egg", "subusers"]) },
      async run({ server, include }, { api }) {
        const res = await api.client("GET", srv(server), { query: { include } });
        return { ...(unwrap(res) as object), meta: (res as { meta?: unknown }).meta };
      },
    }),

    tool({
      name: "get_server_resources",
      title: "Get resource usage",
      description: "Live power state plus CPU, memory, disk, network and uptime of a server (what the console page graphs show).",
      scope: "client",
      kind: "read",
      input: { server: serverRef },
      async run({ server }, { api }) {
        const r = unwrap(await api.client("GET", `${srv(server)}/resources`)) as Resources;
        const u = r.resources;
        return {
          state: r.current_state,
          suspended: r.is_suspended,
          cpu: `${u.cpu_absolute.toFixed(2)}%`,
          memory: bytes(u.memory_bytes),
          disk: bytes(u.disk_bytes),
          network_rx: bytes(u.network_rx_bytes),
          network_tx: bytes(u.network_tx_bytes),
          uptime: formatUptime(u.uptime),
          raw: u,
        };
      },
    }),

    tool({
      name: "power_server",
      title: "Send power signal",
      description:
        "Start, stop, restart or kill a server. 'kill' terminates the container immediately and may lose unsaved data. Set wait=true to block until the server reaches the expected state.",
      scope: "client",
      kind: "write",
      input: {
        server: serverRef,
        signal: z.enum(["start", "stop", "restart", "kill"]),
        wait: z.boolean().default(false).describe("Wait until the server is running (start/restart) or offline (stop/kill)"),
        timeout_seconds: z.number().int().min(5).max(600).default(120).describe("How long to wait when wait=true"),
      },
      async run({ server, signal, wait, timeout_seconds }, { api }) {
        await api.client("POST", `${srv(server)}/power`, { body: { signal } });
        if (!wait) return `Sent '${signal}' to ${server}.`;

        const target = signal === "start" || signal === "restart" ? "running" : "offline";
        const deadline = Date.now() + timeout_seconds * 1000;
        let state = "unknown";
        // A restart briefly passes through offline/starting, so give it a moment before polling.
        await sleep(signal === "restart" ? 3000 : 1000);
        while (Date.now() < deadline) {
          const r = unwrap(await api.client("GET", `${srv(server)}/resources`)) as Resources;
          state = r.current_state;
          if (state === target) return `Sent '${signal}' to ${server}; server is now ${state}.`;
          await sleep(2000);
        }
        return `Sent '${signal}' to ${server}, but it is still '${state}' after ${timeout_seconds}s (expected '${target}'). Check the console logs.`;
      },
    }),

    tool({
      name: "send_command",
      title: "Send console command",
      description:
        "Send a command to the server console without waiting for output. Use run_command to also capture what the server prints back.",
      scope: "client",
      kind: "write",
      input: { server: serverRef, command: z.string().min(1).describe("Command, e.g. 'say Hello' or 'list'") },
      async run({ server, command }, { api }) {
        await api.client("POST", `${srv(server)}/command`, { body: { command } });
        return `Sent to ${server}: ${command}`;
      },
    }),

    tool({
      name: "run_command",
      title: "Run console command and capture output",
      description:
        "Send a command through the live console websocket and return the console lines printed in response. Output is collected until it goes quiet for idle_ms, until a line matches until_regex, or until timeout_ms.",
      scope: "client",
      kind: "write",
      input: {
        server: serverRef,
        command: z.string().min(1),
        timeout_ms: z.number().int().min(500).max(120_000).default(10_000),
        idle_ms: z.number().int().min(100).max(30_000).default(1500).describe("Stop after this much silence"),
        until_regex: z.string().optional().describe("Stop as soon as a console line matches this regular expression"),
      },
      async run({ server, command, timeout_ms, idle_ms, until_regex }, { api }) {
        const res = await captureConsole(api, server, {
          command,
          timeoutMs: timeout_ms,
          idleMs: idle_ms,
          until: until_regex ? new RegExp(until_regex) : undefined,
        });
        const out = res.lines.join("\n").trim();
        return `$ ${command}\n${out || "(no output)"}\n\n[capture ended: ${res.ended}${res.state ? `, state: ${res.state}` : ""}]`;
      },
    }),

    tool({
      name: "get_console_logs",
      title: "Read console logs",
      description: "Fetch the recent console output of a server (the history the console page shows when opened).",
      scope: "client",
      kind: "read",
      input: {
        server: serverRef,
        lines: z.number().int().min(1).max(1000).default(100).describe("Return only the last N lines"),
        grep: z.string().optional().describe("Only return lines matching this regular expression (case-insensitive)"),
      },
      async run({ server, lines, grep }, { api }) {
        const res = await captureConsole(api, server, { timeoutMs: 8000, idleMs: 750 });
        let out = res.lines;
        if (grep) {
          const re = new RegExp(grep, "i");
          out = out.filter((l) => re.test(l));
        }
        out = out.slice(-lines);
        return out.length ? out.join("\n") : "(no console output — the server may be offline or the log is empty)";
      },
    }),

    tool({
      name: "list_server_activity",
      title: "Server activity log",
      description: "List the server's activity log (who did what: logins, file edits, power actions, backups…).",
      scope: "client",
      kind: "read",
      input: {
        server: serverRef,
        event: z.string().optional().describe("Filter by event name (partial), e.g. 'server:file' or 'power'"),
        sort: sort(["timestamp"]),
        page,
        per_page: perPage,
      },
      async run({ server, event, sort, page, per_page }, { api }) {
        return api.page("client", `${srv(server)}/activity`, {
          filter: { event },
          sort: sort ?? "-timestamp",
          include: ["actor"],
          page,
          per_page,
        });
      },
    }),

    tool({
      name: "update_server_settings",
      title: "Rename / describe server",
      description: "Change a server's name and/or description (Settings page).",
      scope: "client",
      kind: "write",
      idempotent: true,
      input: {
        server: serverRef,
        name: z.string().min(1).max(255).optional(),
        description: z.string().nullable().optional().describe("New description (null clears it)"),
      },
      async run({ server, name, description }, { api }) {
        if (name === undefined && description === undefined) throw new Error("Provide name and/or description.");
        if (name !== undefined) await api.client("POST", `${srv(server)}/settings/rename`, { body: { name } });
        if (description !== undefined) {
          await api.client("POST", `${srv(server)}/settings/description`, { body: { description } });
        }
        return "Server settings updated.";
      },
    }),

    tool({
      name: "reinstall_server",
      title: "Reinstall server",
      description:
        "Re-run the egg's install script. The server is stopped first; files may be overwritten depending on the egg. Consider creating a backup first.",
      scope: "client",
      kind: "destructive",
      input: { server: serverRef },
      async run({ server }, { api }) {
        await api.client("POST", `${srv(server)}/settings/reinstall`);
        return `Reinstall of ${server} started.`;
      },
    }),

    tool({
      name: "get_startup",
      title: "Get startup configuration",
      description:
        "Show the startup command, available docker images and all egg variables (with current values and whether they are editable).",
      scope: "client",
      kind: "read",
      input: { server: serverRef },
      async run({ server }, { api }) {
        const res = await api.client<{ meta?: unknown }>("GET", `${srv(server)}/startup`);
        return { variables: unwrap(res), meta: res.meta };
      },
    }),

    tool({
      name: "set_startup_variable",
      title: "Set startup variable",
      description: "Change the value of an editable egg/startup variable (e.g. SERVER_JARFILE, MAX_PLAYERS). Takes effect on next start.",
      scope: "client",
      kind: "write",
      idempotent: true,
      input: {
        server: serverRef,
        key: z.string().min(1).describe("Environment variable name, e.g. 'SERVER_JARFILE'"),
        value: z.union([z.string(), z.number(), z.boolean()]).nullable().describe("New value"),
      },
      async run({ server, key, value }, { api }) {
        return unwrap(
          await api.client("PUT", `${srv(server)}/startup/variable`, {
            body: { key, value: typeof value === "boolean" ? (value ? "1" : "0") : value === null ? null : String(value) },
          }),
        );
      },
    }),

    tool({
      name: "set_docker_image",
      title: "Change docker image",
      description: "Switch the server's docker image to another image offered by its egg (see get_startup → meta.docker_images).",
      scope: "client",
      kind: "write",
      idempotent: true,
      input: { server: serverRef, docker_image: z.string().min(1).describe("Image value from meta.docker_images") },
      async run({ server, docker_image }, { api }) {
        await api.client("PUT", `${srv(server)}/settings/docker-image`, { body: { docker_image } });
        return `Docker image set to ${docker_image}. Restart the server to apply.`;
      },
    }),
  ],
};
