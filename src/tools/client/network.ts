import { z } from "zod";
import { unwrap } from "../../api.ts";
import { seg, serverRef, srv } from "../../schemas.ts";
import { tool, type ToolGroup } from "../../tool.ts";

const allocation = z.coerce.number().int().positive().describe("Allocation ID (from list_allocations)");
const path = (server: string, id?: number) => `${srv(server)}/network/allocations${id ? `/${seg(id)}` : ""}`;

export const networkTools: ToolGroup = {
  name: "network",
  tools: [
    tool({
      name: "list_allocations",
      title: "List allocations",
      description: "List the server's IP:port allocations, their notes and which one is primary.",
      scope: "client",
      kind: "read",
      input: { server: serverRef },
      async run({ server }, { api }) {
        return unwrap(await api.client("GET", path(server)));
      },
    }),

    tool({
      name: "add_allocation",
      title: "Add allocation",
      description: "Automatically assign an additional free port to the server (requires allocation limit and auto-assign enabled on the panel).",
      scope: "client",
      kind: "write",
      input: { server: serverRef },
      async run({ server }, { api }) {
        return unwrap(await api.client("POST", path(server)));
      },
    }),

    tool({
      name: "set_allocation_notes",
      title: "Set allocation notes",
      description: "Set or clear the note on an allocation (e.g. 'Query port').",
      scope: "client",
      kind: "write",
      idempotent: true,
      input: { server: serverRef, allocation, notes: z.string().max(255).nullable() },
      async run({ server, allocation, notes }, { api }) {
        return unwrap(await api.client("POST", path(server, allocation), { body: { notes } }));
      },
    }),

    tool({
      name: "set_primary_allocation",
      title: "Set primary allocation",
      description: "Make an allocation the server's primary (default) IP:port.",
      scope: "client",
      kind: "write",
      idempotent: true,
      input: { server: serverRef, allocation },
      async run({ server, allocation }, { api }) {
        return unwrap(await api.client("POST", `${path(server, allocation)}/primary`));
      },
    }),

    tool({
      name: "remove_allocation",
      title: "Remove allocation",
      description: "Unassign a (non-primary) allocation from the server.",
      scope: "client",
      kind: "destructive",
      input: { server: serverRef, allocation },
      async run({ server, allocation }, { api }) {
        await api.client("DELETE", path(server, allocation));
        return `Allocation ${allocation} removed.`;
      },
    }),
  ],
};
