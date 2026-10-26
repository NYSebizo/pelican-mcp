import { z } from "zod";
import { unwrap } from "../../api.ts";
import { seg, serverRef, srv } from "../../schemas.ts";
import { tool, type ToolGroup } from "../../tool.ts";

const database = z.string().min(1).describe("Database ID (the hashed 'id' from list_databases)");

export const databaseTools: ToolGroup = {
  name: "databases",
  tools: [
    tool({
      name: "list_databases",
      title: "List databases",
      description: "List the server's databases with host, username and connection info. Set show_passwords to include passwords.",
      scope: "client",
      kind: "read",
      input: { server: serverRef, show_passwords: z.boolean().default(false) },
      async run({ server, show_passwords }, { api }) {
        return unwrap(
          await api.client("GET", `${srv(server)}/databases`, { query: { include: show_passwords ? ["password"] : undefined } }),
        );
      },
    }),

    tool({
      name: "create_database",
      title: "Create database",
      description: "Create a new MySQL/MariaDB database for the server. The final name is prefixed with 's<serverId>_'. Returns credentials.",
      scope: "client",
      kind: "write",
      input: {
        server: serverRef,
        database: z.string().regex(/^[a-zA-Z0-9_-]{3,48}$/).describe("Name (3-48 chars, letters/digits/_/-)"),
        remote: z.string().default("%").describe("Allowed connection source: '%' for anywhere or an IP like '10.0.0.%'"),
      },
      async run({ server, database, remote }, { api }) {
        return unwrap(
          await api.client("POST", `${srv(server)}/databases`, { body: { database, remote }, query: { include: ["password"] } }),
        );
      },
    }),

    tool({
      name: "rotate_database_password",
      title: "Rotate database password",
      description: "Generate a new password for a database user. Returns the new credentials.",
      scope: "client",
      kind: "write",
      input: { server: serverRef, database },
      async run({ server, database }, { api }) {
        return unwrap(
          await api.client("POST", `${srv(server)}/databases/${seg(database)}/rotate-password`, { query: { include: ["password"] } }),
        );
      },
    }),

    tool({
      name: "delete_database",
      title: "Delete database",
      description: "Permanently delete a database and all its data.",
      scope: "client",
      kind: "destructive",
      input: { server: serverRef, database },
      async run({ server, database }, { api }) {
        await api.client("DELETE", `${srv(server)}/databases/${seg(database)}`);
        return `Database ${database} deleted.`;
      },
    }),
  ],
};
