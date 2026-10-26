import { z } from "zod";
import { unwrap } from "../../api.ts";
import { seg, serverRef, srv } from "../../schemas.ts";
import { tool, type ToolGroup } from "../../tool.ts";

const user = z.string().uuid().describe("Subuser's user UUID (from list_subusers)");
const permissions = z
  .array(z.string())
  .min(1)
  .describe("Permission keys like 'control.console', 'control.start', 'file.read', 'backup.create'. See list_permissions.");
const path = (server: string, uuid?: string) => `${srv(server)}/users${uuid ? `/${seg(uuid)}` : ""}`;

export const subuserTools: ToolGroup = {
  name: "subusers",
  tools: [
    tool({
      name: "list_permissions",
      title: "List permission keys",
      description: "List every subuser permission key the panel knows, grouped with descriptions.",
      scope: "client",
      kind: "read",
      input: {},
      async run(_args, { api }) {
        return unwrap(await api.client("GET", "/permissions"));
      },
    }),

    tool({
      name: "list_subusers",
      title: "List subusers",
      description: "List users who have access to this server and their permissions.",
      scope: "client",
      kind: "read",
      input: { server: serverRef },
      async run({ server }, { api }) {
        return unwrap(await api.client("GET", path(server)));
      },
    }),

    tool({
      name: "get_subuser",
      title: "Get subuser",
      description: "Get one subuser and their permissions.",
      scope: "client",
      kind: "read",
      input: { server: serverRef, user },
      async run({ server, user }, { api }) {
        return unwrap(await api.client("GET", path(server, user)));
      },
    }),

    tool({
      name: "add_subuser",
      title: "Add subuser",
      description: "Invite a user by email to the server with the given permissions (an account is created if needed).",
      scope: "client",
      kind: "write",
      input: { server: serverRef, email: z.string().email(), permissions },
      async run({ server, email, permissions }, { api }) {
        return unwrap(await api.client("POST", path(server), { body: { email, permissions } }));
      },
    }),

    tool({
      name: "update_subuser",
      title: "Update subuser permissions",
      description: "Replace a subuser's permissions (permissions not listed are revoked).",
      scope: "client",
      kind: "write",
      idempotent: true,
      input: { server: serverRef, user, permissions },
      async run({ server, user, permissions }, { api }) {
        return unwrap(await api.client("POST", path(server, user), { body: { permissions } }));
      },
    }),

    tool({
      name: "remove_subuser",
      title: "Remove subuser",
      description: "Revoke a subuser's access to the server.",
      scope: "client",
      kind: "destructive",
      input: { server: serverRef, user },
      async run({ server, user }, { api }) {
        await api.client("DELETE", path(server, user));
        return `Subuser ${user} removed.`;
      },
    }),
  ],
};
