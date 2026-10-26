import { z } from "zod";
import { unwrap } from "../../api.ts";
import { defined, filter, include, merge, numericId, page, perPage, seg, sort } from "../../schemas.ts";
import { tool, type ToolGroup } from "../../tool.ts";

const user = numericId("user");
const includes = include(["servers", "roles"]);
const roles = z.array(z.number().int().positive()).min(1).describe("Role IDs (admin_list_roles)");

const fields = {
  username: z.string().min(1).max(255),
  email: z.string().email(),
  password: z.string().min(8).describe("Password (omit to let the user set one via reset email)"),
  language: z.string().describe("Language code, e.g. 'en' or 'de'"),
  timezone: z.string().describe("IANA timezone, e.g. 'Europe/Berlin'"),
  external_id: z.string().max(255).nullable(),
  is_managed_externally: z.boolean().describe("Managed by an external system (user cannot edit their profile)"),
};
const updatable = Object.keys(fields);

export const adminUserTools: ToolGroup = {
  name: "admin-users",
  tools: [
    tool({
      name: "admin_list_users",
      title: "Admin: list users",
      description: "List all panel users.",
      scope: "application",
      kind: "read",
      input: { filter: filter(["email", "uuid", "username", "external_id"]), sort: sort(["id", "uuid"]), include: includes, page, per_page: perPage },
      async run(q, { api }) {
        return api.page("application", "/users", q);
      },
    }),

    tool({
      name: "admin_get_user",
      title: "Admin: get user",
      description: "Get a user by numeric ID or external ID, optionally with their servers and roles.",
      scope: "application",
      kind: "read",
      input: { id: user.optional(), external_id: z.string().optional(), include: includes },
      async run({ id, external_id, include }, { api }) {
        if (!id && !external_id) throw new Error("Provide id or external_id.");
        const p = id ? `/users/${seg(id)}` : `/users/external/${seg(external_id!)}`;
        return unwrap(await api.application("GET", p, { query: { include } }));
      },
    }),

    tool({
      name: "admin_create_user",
      title: "Admin: create user",
      description: "Create a panel user. Assign admin rights afterwards with admin_set_user_roles.",
      scope: "application",
      kind: "write",
      input: {
        username: fields.username,
        email: fields.email,
        password: fields.password.optional(),
        language: fields.language.optional(),
        timezone: fields.timezone.optional(),
        external_id: fields.external_id.optional(),
        is_managed_externally: fields.is_managed_externally.optional(),
      },
      async run(body, { api }) {
        return unwrap(await api.application("POST", "/users", { body: defined(body) }));
      },
    }),

    tool({
      name: "admin_update_user",
      title: "Admin: update user",
      description: "Update a user. Unspecified fields keep their current value.",
      scope: "application",
      kind: "write",
      idempotent: true,
      input: {
        id: user,
        username: fields.username.optional(),
        email: fields.email.optional(),
        password: fields.password.optional().describe("New password"),
        language: fields.language.optional(),
        timezone: fields.timezone.optional(),
        external_id: fields.external_id.optional(),
        is_managed_externally: fields.is_managed_externally.optional(),
      },
      async run({ id, ...changes }, { api }) {
        const cur = unwrap(await api.application("GET", `/users/${seg(id)}`)) as Record<string, unknown>;
        const body = merge(cur, updatable.filter((k) => k !== "password"), changes);
        return unwrap(await api.application("PATCH", `/users/${seg(id)}`, { body }));
      },
    }),

    tool({
      name: "admin_set_user_roles",
      title: "Admin: assign / remove roles",
      description: "Assign roles to a user or remove roles from them (e.g. the root admin role).",
      scope: "application",
      kind: "write",
      idempotent: true,
      input: { id: user, action: z.enum(["assign", "remove"]), roles },
      async run({ id, action, roles }, { api }) {
        await api.application("PATCH", `/users/${seg(id)}/roles/${action}`, { body: { roles } });
        return unwrap(await api.application("GET", `/users/${seg(id)}`, { query: { include: ["roles"] } }));
      },
    }),

    tool({
      name: "admin_delete_user",
      title: "Admin: delete user",
      description: "Delete a user. Fails if the user still owns servers.",
      scope: "application",
      kind: "destructive",
      input: { id: user },
      async run({ id }, { api }) {
        await api.application("DELETE", `/users/${seg(id)}`);
        return `User ${id} deleted.`;
      },
    }),

    // ─── Roles ───────────────────────────────────────────────────────────────

    tool({
      name: "admin_list_roles",
      title: "Admin: list roles",
      description: "List admin roles and (optionally) their permissions.",
      scope: "application",
      kind: "read",
      input: { filter: filter(["id", "name"]), sort: sort(["id", "name"]), include: include(["permissions"]), page, per_page: perPage },
      async run(q, { api }) {
        return api.page("application", "/roles", q);
      },
    }),

    tool({
      name: "admin_get_role",
      title: "Admin: get role",
      description: "Get a role with its permissions.",
      scope: "application",
      kind: "read",
      input: { id: numericId("role") },
      async run({ id }, { api }) {
        return unwrap(await api.application("GET", `/roles/${seg(id)}`, { query: { include: ["permissions"] } }));
      },
    }),

    tool({
      name: "admin_create_role",
      title: "Admin: create role",
      description: "Create an admin role.",
      scope: "application",
      kind: "write",
      input: { name: z.string().min(1) },
      async run(body, { api }) {
        return unwrap(await api.application("POST", "/roles", { body }));
      },
    }),

    tool({
      name: "admin_rename_role",
      title: "Admin: rename role",
      description: "Rename a role (the root admin role cannot be changed).",
      scope: "application",
      kind: "write",
      idempotent: true,
      input: { id: numericId("role"), name: z.string().min(1) },
      async run({ id, name }, { api }) {
        return unwrap(await api.application("PATCH", `/roles/${seg(id)}`, { body: { name } }));
      },
    }),

    tool({
      name: "admin_delete_role",
      title: "Admin: delete role",
      description: "Delete a role.",
      scope: "application",
      kind: "destructive",
      input: { id: numericId("role") },
      async run({ id }, { api }) {
        await api.application("DELETE", `/roles/${seg(id)}`);
        return `Role ${id} deleted.`;
      },
    }),
  ],
};
