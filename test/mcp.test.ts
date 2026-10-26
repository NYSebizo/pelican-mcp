import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Server } from "bun";
import { PelicanApi, buildQuery, unwrap } from "../src/api.ts";
import { loadConfig, type Config } from "../src/config.ts";
import { registerGroups } from "../src/tool.ts";
import { groups } from "../src/tools/index.ts";

interface Seen {
  method: string;
  path: string;
  query: string;
  body: unknown;
  auth: string | null;
}

let panel: Server<unknown>;
let seen: Seen[] = [];

const json = (data: unknown, status = 200) => Response.json(data, { status });

beforeAll(() => {
  panel = Bun.serve({
    port: 0,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") return srv.upgrade(req, { data: undefined }) ? undefined : new Response("no", { status: 400 });

      const text = await req.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {}
      seen.push({ method: req.method, path: url.pathname, query: decodeURIComponent(url.search), body, auth: req.headers.get("authorization") });

      const p = url.pathname;
      if (p === "/api/client/servers/abc/websocket") {
        return json({ data: { token: "jwt", socket: `ws://localhost:${panel.port}/ws` } });
      }
      if (p === "/api/client/servers/abc/resources") {
        return json({
          object: "stats",
          attributes: {
            current_state: "running",
            is_suspended: false,
            resources: { memory_bytes: 1048576 * 512, cpu_absolute: 12.345, disk_bytes: 1024, network_rx_bytes: 0, network_tx_bytes: 0, uptime: 3_723_000 },
          },
        });
      }
      if (p === "/api/client/servers/abc/files/contents") return new Response("motd=Hello\nmax-players=20\n");
      if (p === "/api/client/servers/abc/schedules/7" && req.method === "GET") {
        return json({
          object: "server_schedule",
          attributes: {
            id: 7,
            name: "Restart",
            cron: { minute: "0", hour: "4", day_of_month: "*", month: "*", day_of_week: "*" },
            is_active: true,
            only_when_online: false,
            relationships: { tasks: { object: "list", data: [] } },
          },
        });
      }
      if (p === "/api/application/servers/99") {
        return json({ errors: [{ code: "NotFoundHttpException", status: "404", detail: "The requested resource could not be found on the server." }] }, 404);
      }
      if (p === "/api/application/users/5" && req.method === "GET") {
        return json({ object: "user", attributes: { id: 5, username: "bob", email: "bob@example.com", language: "en", root_admin: false } });
      }
      if (p === "/api/application/users/5" && req.method === "PATCH") {
        return json({ errors: [{ code: "ValidationException", status: "422", detail: "The email has already been taken.", meta: { source_field: "email", rule: "unique" } }] }, 422);
      }
      if (p === "/api/client") {
        return json({
          object: "list",
          data: [{ object: "server", attributes: { identifier: "abc", name: "Survival", relationships: { allocations: { object: "list", data: [] } } } }],
          meta: { pagination: { total: 1, count: 1, per_page: 50, current_page: 1, total_pages: 1 } },
        });
      }
      return req.method === "GET" ? json({ object: "list", data: [] }) : new Response(null, { status: 204 });
    },
    websocket: {
      message(ws, raw) {
        const msg = JSON.parse(String(raw)) as { event: string; args: unknown[] };
        const send = (event: string, ...args: unknown[]) => {
          ws.send(JSON.stringify({ event, args }));
        };
        if (msg.event === "auth") {
          if (msg.args[0] !== "jwt") {
            send("jwt error", "bad token");
            return;
          }
          send("auth success");
          send("status", "running");
        } else if (msg.event === "send logs") {
          send("console output", "\u001b[33m[12:00:00 INFO]: Server started\u001b[0m");
          send("console output", "[12:00:05 INFO]: Player joined");
        } else if (msg.event === "send command" && msg.args[0] === "list") {
          send("console output", "There are 2 of a max of 20 players online: alice, bob");
        }
      },
    },
  });
});

afterAll(() => panel.stop(true));

async function connect(overrides: Partial<Config> = {}) {
  const config: Config = {
    url: `http://localhost:${panel.port}`,
    clientKey: "pacc_test",
    applicationKey: "papp_test",
    readOnly: false,
    timeoutMs: 5000,
    ...overrides,
  };
  const server = new McpServer({ name: "test", version: "0" });
  registerGroups(server, { api: new PelicanApi(config), config }, groups);
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  seen = [];
  const res = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
  return { text: res.content.map((c) => c.text).join("\n"), isError: Boolean(res.isError) };
}

describe("helpers", () => {
  test("buildQuery serialises filters and arrays like Laravel", () => {
    expect(decodeURIComponent(buildQuery({ filter: { name: "a b", x: undefined }, include: ["egg", "node"], page: 2, empty: "" }))).toBe(
      "?filter[name]=a+b&include=egg,node&page=2",
    );
    expect(buildQuery({})).toBe("");
  });

  test("unwrap strips fractal envelopes and flattens relationships", () => {
    expect(
      unwrap({
        object: "server",
        attributes: { id: 1, relationships: { allocations: { object: "list", data: [{ object: "allocation", attributes: { port: 25565 } }] } } },
      }),
    ).toEqual({ id: 1, allocations: [{ port: 25565 }] });
    expect(unwrap({ object: "null_resource", attributes: null })).toBeNull();
  });

  test("loadConfig routes a legacy key by prefix and validates the URL", () => {
    expect(loadConfig({ PELICAN_URL: "https://p.example/", PELICAN_API_KEY: "papp_x" })).toMatchObject({
      url: "https://p.example",
      applicationKey: "papp_x",
      clientKey: undefined,
    });
    expect(() => loadConfig({ PELICAN_URL: "p.example", PELICAN_API_KEY: "x" })).toThrow("http");
    expect(() => loadConfig({ PELICAN_URL: "https://p.example" })).toThrow("No API key");
  });
});

describe("tool registration", () => {
  test("every tool name is unique and has a description", () => {
    const names = groups.flatMap((g) => g.tools.map((t) => t.name));
    expect(new Set(names).size).toBe(names.length);
    for (const g of groups) for (const t of g.tools) expect(t.description.length).toBeGreaterThan(10);
  });

  test("only tools for configured keys are exposed", async () => {
    const onlyClient = await connect({ applicationKey: undefined });
    const { tools } = await onlyClient.listTools();
    expect(tools.some((t) => t.name === "list_servers")).toBe(true);
    expect(tools.some((t) => t.name.startsWith("admin_"))).toBe(false);
  });

  test("read-only mode hides every mutating tool", async () => {
    const ro = await connect({ readOnly: true });
    const { tools } = await ro.listTools();
    expect(tools.length).toBeGreaterThan(20);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.some((t) => t.name === "delete_files")).toBe(false);
  });

  test("destructive tools are annotated as such", async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    const del = tools.find((t) => t.name === "admin_delete_server");
    expect(del?.annotations?.destructiveHint).toBe(true);
  });
});

describe("client tools", () => {
  test("list_servers unwraps the list and uses the client key", async () => {
    const c = await connect();
    const { text } = await call(c, "list_servers", { search: "surv" });
    expect(JSON.parse(text).items[0]).toEqual({ identifier: "abc", name: "Survival", allocations: [] });
    expect(seen[0]?.auth).toBe("Bearer pacc_test");
    expect(seen[0]?.query).toContain("filter[*]=surv");
  });

  test("get_server_resources formats usage", async () => {
    const c = await connect();
    const { text } = await call(c, "get_server_resources", { server: "abc" });
    const r = JSON.parse(text);
    expect(r).toMatchObject({ state: "running", cpu: "12.35%", memory: "512.0 MiB", uptime: "1h 2m 3s" });
  });

  test("read_file returns raw text", async () => {
    const c = await connect();
    expect((await call(c, "read_file", { server: "abc", file: "/server.properties" })).text).toContain("max-players=20");
  });

  test("write_file posts the raw content", async () => {
    const c = await connect();
    await call(c, "write_file", { server: "abc", file: "/a.txt", content: "hi" });
    expect(seen[0]).toMatchObject({ method: "POST", path: "/api/client/servers/abc/files/write", body: "hi" });
    expect(seen[0]?.query).toBe("?file=/a.txt");
  });

  test("run_command captures console output over the websocket", async () => {
    const c = await connect();
    const { text, isError } = await call(c, "run_command", { server: "abc", command: "list", idle_ms: 200 });
    expect(isError).toBe(false);
    expect(text).toContain("2 of a max of 20 players online");
  });

  test("get_console_logs strips ANSI codes and filters", async () => {
    const c = await connect();
    const { text } = await call(c, "get_console_logs", { server: "abc", grep: "started" });
    expect(text).toBe("[12:00:00 INFO]: Server started");
  });

  test("update_schedule merges with the current schedule", async () => {
    const c = await connect();
    await call(c, "update_schedule", { server: "abc", schedule: 7, hour: "5" });
    const post = seen.find((s) => s.method === "POST");
    expect(post?.body).toEqual({
      name: "Restart",
      minute: "0",
      hour: "5",
      day_of_month: "*",
      month: "*",
      day_of_week: "*",
      is_active: true,
      only_when_online: false,
    });
  });

  test("power_server sends the signal", async () => {
    const c = await connect();
    await call(c, "power_server", { server: "abc", signal: "restart" });
    expect(seen[0]).toMatchObject({ method: "POST", path: "/api/client/servers/abc/power", body: { signal: "restart" } });
  });
});

describe("application tools", () => {
  test("API errors come back as readable tool errors", async () => {
    const c = await connect();
    const { text, isError } = await call(c, "admin_get_server", { id: 99 });
    expect(isError).toBe(true);
    expect(text).toContain("HTTP 404");
    expect(text).toContain("could not be found");
  });

  test("validation errors include the field name", async () => {
    const c = await connect();
    const { text, isError } = await call(c, "admin_update_user", { id: 5, email: "taken@example.com" });
    expect(isError).toBe(true);
    expect(text).toContain("email has already been taken");
    const patch = seen.find((s) => s.method === "PATCH");
    expect(patch?.body).toEqual({ username: "bob", email: "taken@example.com", language: "en" });
    expect(patch?.auth).toBe("Bearer papp_test");
  });

  test("admin_list_allocations can find unassigned allocations", async () => {
    const c = await connect();
    await call(c, "admin_list_allocations", { node: 1, unassigned_only: true });
    expect(seen[0]?.query).toContain("filter[server_id]=none");
  });

  test("admin_delete_server supports force", async () => {
    const c = await connect();
    await call(c, "admin_delete_server", { id: 3, force: true });
    expect(seen[0]).toMatchObject({ method: "DELETE", path: "/api/application/servers/3/force" });
  });

  test("invalid input is rejected before hitting the API", async () => {
    const c = await connect();
    const res = await call(c, "power_server", { server: "abc", signal: "explode" });
    expect(res.isError).toBe(true);
    expect(seen.length).toBe(0);
  });
});
