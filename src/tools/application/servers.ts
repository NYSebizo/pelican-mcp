import { z } from "zod";
import { unwrap, type PelicanApi } from "../../api.ts";
import { defined, filter, include, numericId, page, perPage, seg, sort } from "../../schemas.ts";
import { tool, type ToolGroup } from "../../tool.ts";

interface AdminServer {
  id: number;
  external_id: string | null;
  name: string;
  description: string | null;
  user: number;
  egg: number;
  allocation: number;
  limits: { memory: number; swap: number; disk: number; io: number; cpu: number; threads: string | null; oom_killer: boolean };
  feature_limits: { databases: number | null; allocations: number | null; backups: number | null };
  container: { startup_command: string; image: string };
}

const server = numericId("server").describe("Numeric server ID (from admin_list_servers — not the short identifier)");
const includes = include(["allocations", "user", "subusers", "egg", "variables", "node", "databases"]);
const path = (id?: number) => `/servers${id ? `/${seg(id)}` : ""}`;

const get = async (api: PelicanApi, id: number) =>
  unwrap(await api.application("GET", path(id))) as AdminServer;

const limits = {
  memory: z.number().int().min(0).describe("Memory in MiB (0 = unlimited)"),
  swap: z.number().int().min(-1).describe("Swap in MiB (0 = none, -1 = unlimited)"),
  disk: z.number().int().min(0).describe("Disk in MiB (0 = unlimited)"),
  io: z.number().int().min(10).max(1000).describe("Block IO weight 10-1000"),
  cpu: z.number().int().min(0).describe("CPU limit, 100 = one core (0 = unlimited)"),
  threads: z.string().regex(/^[0-9,-]+$/).nullable().describe("Pin to CPU threads, e.g. '0-1' or '0,2' (null = any)"),
};
const featureLimits = {
  databases: z.number().int().min(0).describe("Max databases"),
  allocations: z.number().int().min(0).describe("Max additional allocations"),
  backups: z.number().int().min(0).describe("Max backups"),
};

export const adminServerTools: ToolGroup = {
  name: "admin-servers",
  tools: [
    tool({
      name: "admin_list_servers",
      title: "Admin: list servers",
      description: "List every server on the panel (numeric id, identifier, owner, node, egg, limits, status).",
      scope: "application",
      kind: "read",
      input: {
        search: z.string().max(100).optional().describe("Search name, description, UUID, external ID"),
        filter: filter(["uuid", "uuid_short", "name", "description", "image", "external_id"]),
        sort: sort(["id", "uuid"]),
        include: includes,
        page,
        per_page: perPage,
      },
      async run({ search, filter, sort, include, page, per_page }, { api }) {
        return api.page("application", path(), { search, filter, sort, include, page, per_page });
      },
    }),

    tool({
      name: "admin_get_server",
      title: "Admin: get server",
      description: "Get a server by numeric ID or external ID, optionally with related resources.",
      scope: "application",
      kind: "read",
      input: {
        id: server.optional(),
        external_id: z.string().optional().describe("Look up by external ID instead"),
        include: includes,
      },
      async run({ id, external_id, include }, { api }) {
        if (!id && !external_id) throw new Error("Provide id or external_id.");
        const p = id ? path(id) : `/servers/external/${seg(external_id!)}`;
        return unwrap(await api.application("GET", p, { query: { include } }));
      },
    }),

    tool({
      name: "admin_create_server",
      title: "Admin: create server",
      description:
        "Create a server. Either pass allocation_id (a free allocation, see admin_list_allocations with unassigned_only) or deploy to let the panel pick a node/port. docker_image and startup default to the egg's. Look up required egg variables with admin_get_egg (include variables).",
      scope: "application",
      kind: "write",
      input: {
        name: z.string().min(1).max(255),
        user: z.number().int().positive().describe("Owner user ID"),
        egg: z.number().int().positive().describe("Egg ID"),
        description: z.string().optional(),
        external_id: z.string().optional(),
        docker_image: z.string().optional().describe("Defaults to the egg's first image"),
        startup: z.string().optional().describe("Defaults to the egg's startup command"),
        environment: z.record(z.string(), z.string()).default({}).describe("Egg variable values keyed by env name"),
        memory: limits.memory,
        swap: limits.swap.default(0),
        disk: limits.disk,
        io: limits.io.default(500),
        cpu: limits.cpu.default(0),
        threads: limits.threads.optional(),
        oom_killer: z.boolean().optional().describe("Allow the OOM killer to stop the server"),
        databases: featureLimits.databases.default(0),
        allocations: featureLimits.allocations.default(0),
        backups: featureLimits.backups.default(0),
        allocation_id: z.number().int().positive().optional().describe("Primary allocation ID"),
        additional_allocations: z.array(z.number().int().positive()).optional(),
        deploy: z
          .object({
            tags: z.array(z.string()).default([]).describe("Only nodes with all of these tags"),
            dedicated_ip: z.boolean().default(false),
            port_range: z.array(z.string()).default([]).describe("Ports/ranges, e.g. ['25565', '27000-27010']"),
          })
          .optional()
          .describe("Auto-deploy instead of passing allocation_id"),
        skip_scripts: z.boolean().default(false).describe("Skip the egg install script"),
        start_on_completion: z.boolean().default(false).describe("Start once installation finishes"),
      },
      async run(a, { api }) {
        if (!a.allocation_id && !a.deploy) throw new Error("Provide allocation_id or deploy.");
        const body = defined({
          name: a.name,
          user: a.user,
          egg: a.egg,
          description: a.description,
          external_id: a.external_id,
          docker_image: a.docker_image,
          startup: a.startup,
          environment: a.environment,
          limits: defined({ memory: a.memory, swap: a.swap, disk: a.disk, io: a.io, cpu: a.cpu, threads: a.threads }),
          feature_limits: { databases: a.databases, allocations: a.allocations, backups: a.backups },
          allocation: a.allocation_id ? defined({ default: a.allocation_id, additional: a.additional_allocations }) : undefined,
          deploy: a.deploy,
          oom_killer: a.oom_killer,
          skip_scripts: a.skip_scripts,
          start_on_completion: a.start_on_completion,
        });
        return unwrap(await api.application("POST", path(), { body }));
      },
    }),

    tool({
      name: "admin_update_server_details",
      title: "Admin: update server details",
      description: "Change name, owner, description or external ID. Unspecified fields keep their current value.",
      scope: "application",
      kind: "write",
      idempotent: true,
      input: {
        id: server,
        name: z.string().min(1).max(255).optional(),
        user: z.number().int().positive().optional().describe("New owner user ID (transfers ownership)"),
        description: z.string().nullable().optional(),
        external_id: z.string().nullable().optional(),
      },
      async run({ id, ...changes }, { api }) {
        const cur = await get(api, id);
        const body = {
          name: changes.name ?? cur.name,
          user: changes.user ?? cur.user,
          description: changes.description !== undefined ? changes.description : cur.description,
          external_id: changes.external_id !== undefined ? changes.external_id : cur.external_id,
        };
        return unwrap(await api.application("PATCH", `${path(id)}/details`, { body }));
      },
    }),

    tool({
      name: "admin_update_server_build",
      title: "Admin: update server build/limits",
      description:
        "Change resource limits, feature limits, primary allocation, add/remove allocations or OOM killer. Unspecified fields keep their current value.",
      scope: "application",
      kind: "write",
      idempotent: true,
      input: {
        id: server,
        memory: limits.memory.optional(),
        swap: limits.swap.optional(),
        disk: limits.disk.optional(),
        io: limits.io.optional(),
        cpu: limits.cpu.optional(),
        threads: limits.threads.optional(),
        oom_killer: z.boolean().optional(),
        databases: featureLimits.databases.optional(),
        allocations: featureLimits.allocations.optional(),
        backups: featureLimits.backups.optional(),
        allocation: z.number().int().positive().optional().describe("New primary allocation ID"),
        add_allocations: z.array(z.number().int().positive()).optional(),
        remove_allocations: z.array(z.number().int().positive()).optional(),
      },
      async run({ id, ...c }, { api }) {
        const cur = await get(api, id);
        const l = cur.limits;
        const f = cur.feature_limits;
        const body = defined({
          allocation: c.allocation ?? cur.allocation,
          oom_killer: c.oom_killer ?? l.oom_killer,
          limits: {
            memory: c.memory ?? l.memory,
            swap: c.swap ?? l.swap,
            disk: c.disk ?? l.disk,
            io: c.io ?? l.io,
            cpu: c.cpu ?? l.cpu,
            threads: c.threads !== undefined ? c.threads : l.threads,
          },
          feature_limits: {
            databases: c.databases ?? f.databases,
            allocations: c.allocations ?? f.allocations,
            backups: c.backups ?? f.backups,
          },
          add_allocations: c.add_allocations,
          remove_allocations: c.remove_allocations,
        });
        return unwrap(await api.application("PATCH", `${path(id)}/build`, { body }));
      },
    }),

    tool({
      name: "admin_update_server_startup",
      title: "Admin: update server startup",
      description:
        "Change startup command, egg, docker image or variable values (admins can edit non-user-editable variables). Changing the egg reinstalls unless skip_scripts.",
      scope: "application",
      kind: "write",
      idempotent: true,
      input: {
        id: server,
        startup: z.string().optional(),
        egg: z.number().int().positive().optional(),
        image: z.string().optional().describe("Docker image"),
        environment: z.record(z.string(), z.string()).default({}).describe("Variables to change, keyed by env name"),
        skip_scripts: z.boolean().default(false),
      },
      async run({ id, ...c }, { api }) {
        const cur = await get(api, id);
        const body = {
          startup: c.startup ?? cur.container.startup_command,
          egg: c.egg ?? cur.egg,
          image: c.image ?? cur.container.image,
          environment: c.environment,
          skip_scripts: c.skip_scripts,
        };
        return unwrap(await api.application("PATCH", `${path(id)}/startup`, { body }));
      },
    }),

    tool({
      name: "admin_set_server_suspended",
      title: "Admin: suspend / unsuspend",
      description: "Suspend (stops it and blocks access) or unsuspend a server.",
      scope: "application",
      kind: "write",
      idempotent: true,
      input: { id: server, suspended: z.boolean() },
      async run({ id, suspended }, { api }) {
        await api.application("POST", `${path(id)}/${suspended ? "suspend" : "unsuspend"}`);
        return `Server ${id} ${suspended ? "suspended" : "unsuspended"}.`;
      },
    }),

    tool({
      name: "admin_reinstall_server",
      title: "Admin: reinstall server",
      description: "Re-run the install script for a server.",
      scope: "application",
      kind: "destructive",
      input: { id: server },
      async run({ id }, { api }) {
        await api.application("POST", `${path(id)}/reinstall`);
        return `Server ${id} queued for reinstall.`;
      },
    }),

    tool({
      name: "admin_transfer_server",
      title: "Admin: transfer server",
      description: "Move a server to another node. Needs a free allocation on the target node.",
      scope: "application",
      kind: "write",
      input: {
        id: server,
        node_id: z.number().int().positive(),
        allocation_id: z.number().int().positive().describe("Free allocation on the target node"),
        allocation_additional: z.array(z.number().int().positive()).optional(),
      },
      async run({ id, ...body }, { api }) {
        await api.application("POST", `${path(id)}/transfer`, { body: defined(body) });
        return `Transfer of server ${id} to node ${body.node_id} started.`;
      },
    }),

    tool({
      name: "admin_cancel_transfer",
      title: "Admin: cancel transfer",
      description: "Cancel a running server transfer.",
      scope: "application",
      kind: "write",
      input: { id: server },
      async run({ id }, { api }) {
        await api.application("POST", `${path(id)}/transfer/cancel`);
        return `Transfer of server ${id} cancelled.`;
      },
    }),

    tool({
      name: "admin_delete_server",
      title: "Admin: delete server",
      description: "Permanently delete a server and its files. force=true deletes from the panel even if the node is unreachable.",
      scope: "application",
      kind: "destructive",
      input: { id: server, force: z.boolean().default(false) },
      async run({ id, force }, { api }) {
        await api.application("DELETE", `${path(id)}${force ? "/force" : ""}`);
        return `Server ${id} deleted.`;
      },
    }),

    // ─── Server databases ────────────────────────────────────────────────────

    tool({
      name: "admin_list_server_databases",
      title: "Admin: list server databases",
      description: "List databases of a server, optionally with passwords and host details.",
      scope: "application",
      kind: "read",
      input: { id: server, include: include(["password", "host"]) },
      async run({ id, include }, { api }) {
        return unwrap(await api.application("GET", `${path(id)}/databases`, { query: { include } }));
      },
    }),

    tool({
      name: "admin_create_server_database",
      title: "Admin: create server database",
      description: "Create a database for a server on a specific database host.",
      scope: "application",
      kind: "write",
      input: {
        id: server,
        database: z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),
        remote: z.string().default("%").describe("Allowed connection source ('%' = anywhere)"),
        host: z.number().int().positive().describe("Database host ID (admin_list_database_hosts)"),
      },
      async run({ id, ...body }, { api }) {
        return unwrap(await api.application("POST", `${path(id)}/databases`, { body, query: { include: ["password"] } }));
      },
    }),

    tool({
      name: "admin_reset_server_database_password",
      title: "Admin: reset database password",
      description: "Generate a new password for a server database.",
      scope: "application",
      kind: "write",
      input: { id: server, database: numericId("database") },
      async run({ id, database }, { api }) {
        await api.application("POST", `${path(id)}/databases/${seg(database)}/reset-password`);
        return unwrap(await api.application("GET", `${path(id)}/databases/${seg(database)}`, { query: { include: ["password"] } }));
      },
    }),

    tool({
      name: "admin_delete_server_database",
      title: "Admin: delete server database",
      description: "Permanently delete a server database.",
      scope: "application",
      kind: "destructive",
      input: { id: server, database: numericId("database") },
      async run({ id, database }, { api }) {
        await api.application("DELETE", `${path(id)}/databases/${seg(database)}`);
        return `Database ${database} deleted.`;
      },
    }),
  ],
};
