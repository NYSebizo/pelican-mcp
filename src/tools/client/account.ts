import { z } from "zod";
import { unwrap } from "../../api.ts";
import { page, perPage, seg, sort } from "../../schemas.ts";
import { tool, type ToolGroup } from "../../tool.ts";

export const accountTools: ToolGroup = {
  name: "account",
  tools: [
    tool({
      name: "get_account",
      title: "Get my account",
      description: "Show the account the client API key belongs to (username, email, language, admin flag).",
      scope: "client",
      kind: "read",
      input: {},
      async run(_args, { api }) {
        return unwrap(await api.client("GET", "/account"));
      },
    }),

    tool({
      name: "update_account",
      title: "Update my account",
      description: "Change the account's username, email and/or password.",
      scope: "client",
      kind: "write",
      idempotent: true,
      input: {
        username: z.string().min(1).max(255).optional(),
        email: z.string().email().optional(),
        password: z.string().min(8).optional().describe("New password (min 8 chars)"),
      },
      async run({ username, email, password }, { api }) {
        const done: string[] = [];
        if (username) {
          await api.client("PUT", "/account/username", { body: { username } });
          done.push("username");
        }
        if (email) {
          await api.client("PUT", "/account/email", { body: { email } });
          done.push("email");
        }
        if (password) {
          await api.client("PUT", "/account/password", { body: { password, password_confirmation: password } });
          done.push("password");
        }
        if (!done.length) throw new Error("Provide username, email and/or password.");
        return `Updated ${done.join(", ")}.`;
      },
    }),

    tool({
      name: "list_account_activity",
      title: "My activity log",
      description: "List the account's activity log (logins, API key changes, …).",
      scope: "client",
      kind: "read",
      input: {
        event: z.string().optional().describe("Filter by event name (partial)"),
        sort: sort(["timestamp"]),
        page,
        per_page: perPage,
      },
      async run({ event, sort, page, per_page }, { api }) {
        return api.page("client", "/account/activity", { filter: { event }, sort: sort ?? "-timestamp", page, per_page });
      },
    }),

    tool({
      name: "list_api_keys",
      title: "List my API keys",
      description: "List the account's client API keys (identifier, description, allowed IPs, last used).",
      scope: "client",
      kind: "read",
      input: {},
      async run(_args, { api }) {
        return unwrap(await api.client("GET", "/account/api-keys"));
      },
    }),

    tool({
      name: "create_api_key",
      title: "Create API key",
      description: "Create a new client API key. The secret token is only shown once in the response.",
      scope: "client",
      kind: "write",
      input: {
        description: z.string().min(1).max(500),
        allowed_ips: z.array(z.string()).max(50).default([]).describe("Restrict to these IPs/CIDRs (empty = any)"),
      },
      async run(body, { api }) {
        const res = await api.client<{ meta?: { secret_token?: string } }>("POST", "/account/api-keys", { body });
        return { key: unwrap(res), secret_token: res.meta?.secret_token };
      },
    }),

    tool({
      name: "delete_api_key",
      title: "Delete API key",
      description: "Revoke a client API key by its identifier. Do not revoke the key this server itself uses.",
      scope: "client",
      kind: "destructive",
      input: { identifier: z.string().min(1).describe("Key identifier (from list_api_keys)") },
      async run({ identifier }, { api }) {
        await api.client("DELETE", `/account/api-keys/${seg(identifier)}`);
        return `API key ${identifier} deleted.`;
      },
    }),

    tool({
      name: "list_ssh_keys",
      title: "List my SSH keys",
      description: "List SSH public keys registered for SFTP login.",
      scope: "client",
      kind: "read",
      input: {},
      async run(_args, { api }) {
        return unwrap(await api.client("GET", "/account/ssh-keys"));
      },
    }),

    tool({
      name: "add_ssh_key",
      title: "Add SSH key",
      description: "Register an SSH public key (OpenSSH format) for SFTP login.",
      scope: "client",
      kind: "write",
      input: { name: z.string().min(1).max(191), public_key: z.string().min(1).describe("e.g. 'ssh-ed25519 AAAA… user@host'") },
      async run(body, { api }) {
        return unwrap(await api.client("POST", "/account/ssh-keys", { body }));
      },
    }),

    tool({
      name: "delete_ssh_key",
      title: "Delete SSH key",
      description: "Remove an SSH key by its fingerprint.",
      scope: "client",
      kind: "destructive",
      input: { fingerprint: z.string().min(1).describe("Fingerprint (from list_ssh_keys)") },
      async run({ fingerprint }, { api }) {
        await api.client("DELETE", `/account/ssh-keys/${seg(fingerprint)}`);
        return `SSH key ${fingerprint} deleted.`;
      },
    }),
  ],
};
