import { z } from "zod";
import { unwrap } from "../../api.ts";
import { defined, filter, include, merge, numericId, page, perPage, seg, sort } from "../../schemas.ts";
import { tool, type ToolGroup } from "../../tool.ts";

const node = numericId("node");
const port = z.number().int().min(1).max(65535);
const overallocate = z.number().int().min(-1).describe("Over-allocation in % (-1 disables the check)");

const fields = {
  name: z.string().min(1).max(100),
  description: z.string().nullable(),
  public: z.boolean().describe("Allow automatic deployment to this node"),
  fqdn: z.string().min(1).describe("Domain name or IP Wings is reachable at"),
  scheme: z.enum(["http", "https"]),
  behind_proxy: z.boolean(),
  maintenance_mode: z.boolean(),
  memory: z.number().int().min(0).describe("Total memory in MiB"),
  memory_overallocate: overallocate,
  disk: z.number().int().min(0).describe("Total disk in MiB"),
  disk_overallocate: overallocate,
  cpu: z.number().int().min(0).describe("Total CPU, 100 = one core"),
  cpu_overallocate: overallocate,
  upload_size: z.number().int().min(1).describe("Max upload size in MiB"),
  daemon_listen: port.describe("Wings API port"),
  daemon_connect: port.describe("Port the panel connects to (differs from daemon_listen behind a proxy)"),
  daemon_sftp: port.describe("SFTP port"),
  daemon_sftp_alias: z.string().nullable().describe("Hostname shown for SFTP"),
  daemon_base: z.string().describe("Directory server data is stored in, e.g. /var/lib/pelican/volumes"),
  tags: z.array(z.string()),
};
const updatable = Object.keys(fields);

export const adminNodeTools: ToolGroup = {
  name: "admin-nodes",
  tools: [
    tool({
      name: "admin_list_nodes",
      title: "Admin: list nodes",
      description: "List all nodes with capacity and allocated resources.",
      scope: "application",
      kind: "read",
      input: {
        filter: filter(["uuid", "name", "fqdn", "daemon_token_id"]),
        sort: sort(["id", "uuid", "memory", "disk", "cpu"]),
        include: include(["allocations", "servers"]),
        page,
        per_page: perPage,
      },
      async run(q, { api }) {
        return api.page("application", "/nodes", q);
      },
    }),

    tool({
      name: "admin_get_node",
      title: "Admin: get node",
      description: "Get one node's full configuration and allocated resources.",
      scope: "application",
      kind: "read",
      input: { id: node, include: include(["allocations", "servers"]) },
      async run({ id, include }, { api }) {
        return unwrap(await api.application("GET", `/nodes/${seg(id)}`, { query: { include } }));
      },
    }),

    tool({
      name: "admin_get_node_configuration",
      title: "Admin: get Wings config",
      description: "Get the Wings configuration (the contents of config.yml, as JSON) for a node. Contains secrets — handle with care.",
      scope: "application",
      kind: "read",
      input: { id: node },
      async run({ id }, { api }) {
        return api.application("GET", `/nodes/${seg(id)}/configuration`);
      },
    }),

    tool({
      name: "admin_list_deployable_nodes",
      title: "Admin: find deployable nodes",
      description: "Find nodes with enough free memory/disk/CPU to host a new server.",
      scope: "application",
      kind: "read",
      input: {
        memory: z.number().int().min(0).describe("MiB needed"),
        disk: z.number().int().min(0).describe("MiB needed"),
        cpu: z.number().int().min(0).optional().describe("CPU needed, 100 = one core"),
        tags: z.array(z.string()).optional(),
        page,
      },
      async run({ tags, ...q }, { api }) {
        // `tags` is a real array parameter here, so it is sent as tags[]=a&tags[]=b.
        const tagQuery = Object.fromEntries((tags ?? []).map((t, i) => [`tags[${i}]`, t]));
        return api.page("application", "/nodes/deployable", { ...q, ...tagQuery });
      },
    }),

    tool({
      name: "admin_create_node",
      title: "Admin: create node",
      description: "Register a new node. Afterwards fetch its Wings config with admin_get_node_configuration and create allocations.",
      scope: "application",
      kind: "write",
      input: {
        name: fields.name,
        description: fields.description.optional(),
        fqdn: fields.fqdn,
        scheme: fields.scheme.default("https"),
        behind_proxy: fields.behind_proxy.default(false),
        public: fields.public.default(true),
        maintenance_mode: fields.maintenance_mode.default(false),
        memory: fields.memory,
        memory_overallocate: fields.memory_overallocate.default(0),
        disk: fields.disk,
        disk_overallocate: fields.disk_overallocate.default(0),
        cpu: fields.cpu.default(0),
        cpu_overallocate: fields.cpu_overallocate.default(0),
        upload_size: fields.upload_size.default(256),
        daemon_listen: fields.daemon_listen.default(8080),
        daemon_connect: fields.daemon_connect.optional().describe("Defaults to daemon_listen"),
        daemon_sftp: fields.daemon_sftp.default(2022),
        daemon_sftp_alias: fields.daemon_sftp_alias.optional(),
        daemon_base: fields.daemon_base.optional(),
        tags: fields.tags.optional(),
      },
      async run(body, { api }) {
        return unwrap(
          await api.application("POST", "/nodes", { body: defined({ ...body, daemon_connect: body.daemon_connect ?? body.daemon_listen }) }),
        );
      },
    }),

    tool({
      name: "admin_update_node",
      title: "Admin: update node",
      description: "Update a node (e.g. toggle maintenance mode, change capacity). Unspecified fields keep their current value.",
      scope: "application",
      kind: "write",
      idempotent: true,
      input: { id: node, ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])) } as {
        id: typeof node;
      } & { [K in keyof typeof fields]: z.ZodOptional<(typeof fields)[K]> },
      async run({ id, ...changes }, { api }) {
        const cur = unwrap(await api.application("GET", `/nodes/${seg(id)}`)) as Record<string, unknown>;
        return unwrap(await api.application("PATCH", `/nodes/${seg(id)}`, { body: merge(cur, updatable, changes) }));
      },
    }),

    tool({
      name: "admin_delete_node",
      title: "Admin: delete node",
      description: "Delete a node. It must not have any servers.",
      scope: "application",
      kind: "destructive",
      input: { id: node },
      async run({ id }, { api }) {
        await api.application("DELETE", `/nodes/${seg(id)}`);
        return `Node ${id} deleted.`;
      },
    }),

    // ─── Allocations ─────────────────────────────────────────────────────────

    tool({
      name: "admin_list_allocations",
      title: "Admin: list node allocations",
      description: "List IP:port allocations on a node. Use unassigned_only to find free ones for new servers.",
      scope: "application",
      kind: "read",
      input: {
        node,
        ip: z.string().optional(),
        port: z.number().int().optional(),
        ip_alias: z.string().optional(),
        server_id: z.number().int().positive().optional().describe("Only allocations of this server"),
        unassigned_only: z.boolean().default(false),
        include: include(["node", "server"]),
        page,
        per_page: perPage,
      },
      async run({ node, ip, port, ip_alias, server_id, unassigned_only, include, page, per_page }, { api }) {
        const filter = defined({
          ip,
          port: port?.toString(),
          ip_alias,
          // Any non-numeric value makes the panel return unassigned allocations.
          server_id: server_id?.toString() ?? (unassigned_only ? "none" : undefined),
        });
        return api.page("application", `/nodes/${seg(node)}/allocations`, { filter, include, page, per_page });
      },
    }),

    tool({
      name: "admin_create_allocations",
      title: "Admin: create allocations",
      description: "Create allocations on a node for an IP and a list of ports or ranges (e.g. ['25565', '25570-25580']).",
      scope: "application",
      kind: "write",
      input: {
        node,
        ip: z.string().min(1).describe("IP address (or CIDR) on the node"),
        ports: z.array(z.string().regex(/^\d+(-\d+)?$/)).min(1),
        alias: z.string().max(255).optional().describe("Hostname shown instead of the IP"),
      },
      async run({ node, ...body }, { api }) {
        await api.application("POST", `/nodes/${seg(node)}/allocations`, { body: defined(body) });
        return `Allocations created on node ${node}: ${body.ip} ${body.ports.join(", ")}.`;
      },
    }),

    tool({
      name: "admin_delete_allocation",
      title: "Admin: delete allocation",
      description: "Delete an unassigned allocation from a node.",
      scope: "application",
      kind: "destructive",
      input: { node, allocation: numericId("allocation") },
      async run({ node, allocation }, { api }) {
        await api.application("DELETE", `/nodes/${seg(node)}/allocations/${seg(allocation)}`);
        return `Allocation ${allocation} deleted.`;
      },
    }),
  ],
};
