import { z } from "zod";
import { unwrap } from "../../api.ts";
import { page, perPage, seg, serverRef, srv } from "../../schemas.ts";
import { tool, type ToolGroup } from "../../tool.ts";

const backup = z.string().uuid().describe("Backup UUID (from list_backups)");
const path = (server: string, uuid?: string) => `${srv(server)}/backups${uuid ? `/${seg(uuid)}` : ""}`;

export const backupTools: ToolGroup = {
  name: "backups",
  tools: [
    tool({
      name: "list_backups",
      title: "List backups",
      description: "List a server's backups with size, status, lock state and checksum. meta shows the backup limit.",
      scope: "client",
      kind: "read",
      input: { server: serverRef, page, per_page: perPage },
      async run({ server, page, per_page }, { api }) {
        const res = await api.client<{ meta?: unknown }>("GET", path(server), { query: { page, per_page } });
        return { items: unwrap(res), meta: res.meta };
      },
    }),

    tool({
      name: "get_backup",
      title: "Get backup",
      description: "Get one backup's details (useful to poll whether a new backup has completed).",
      scope: "client",
      kind: "read",
      input: { server: serverRef, backup },
      async run({ server, backup }, { api }) {
        return unwrap(await api.client("GET", path(server, backup)));
      },
    }),

    tool({
      name: "create_backup",
      title: "Create backup",
      description:
        "Start a new backup. It runs in the background; poll get_backup until completed_at is set. If the backup limit is reached, the oldest unlocked backup may be rotated out.",
      scope: "client",
      kind: "write",
      input: {
        server: serverRef,
        name: z.string().max(255).optional().describe("Backup name (default: timestamp)"),
        ignored: z.string().optional().describe("Newline-separated paths to exclude (.gitignore syntax)"),
        is_locked: z.boolean().optional().describe("Lock the backup so it cannot be deleted/rotated"),
      },
      async run({ server, ...body }, { api }) {
        return unwrap(await api.client("POST", path(server), { body }));
      },
    }),

    tool({
      name: "rename_backup",
      title: "Rename backup",
      description: "Rename a backup.",
      scope: "client",
      kind: "write",
      idempotent: true,
      input: { server: serverRef, backup, name: z.string().min(1).max(255) },
      async run({ server, backup, name }, { api }) {
        return unwrap(await api.client("PUT", `${path(server, backup)}/rename`, { body: { name } }));
      },
    }),

    tool({
      name: "set_backup_lock",
      title: "Lock / unlock backup",
      description: "Lock (protect from deletion and rotation) or unlock a backup.",
      scope: "client",
      kind: "write",
      idempotent: true,
      input: { server: serverRef, backup, locked: z.boolean() },
      async run({ server, backup, locked }, { api }) {
        const current = unwrap(await api.client("GET", path(server, backup))) as { is_locked: boolean };
        if (current.is_locked === locked) return `Backup is already ${locked ? "locked" : "unlocked"}.`;
        return unwrap(await api.client("POST", `${path(server, backup)}/lock`));
      },
    }),

    tool({
      name: "restore_backup",
      title: "Restore backup",
      description:
        "Restore a backup onto the server. The server is stopped. With truncate=true ALL current files are deleted first; otherwise the backup is extracted over existing files.",
      scope: "client",
      kind: "destructive",
      input: {
        server: serverRef,
        backup,
        truncate: z.boolean().default(false).describe("Delete all existing files before restoring"),
      },
      async run({ server, backup, truncate }, { api }) {
        await api.client("POST", `${path(server, backup)}/restore`, { body: { truncate } });
        return `Restore of backup ${backup} started${truncate ? " (existing files are being deleted first)" : ""}.`;
      },
    }),

    tool({
      name: "get_backup_download_url",
      title: "Get backup download link",
      description: "Create a signed, temporary URL to download a backup archive.",
      scope: "client",
      kind: "read",
      input: { server: serverRef, backup },
      async run({ server, backup }, { api }) {
        return (unwrap(await api.client("GET", `${path(server, backup)}/download`)) as { url: string }).url;
      },
    }),

    tool({
      name: "delete_backup",
      title: "Delete backup",
      description: "Permanently delete a backup (locked backups must be unlocked first).",
      scope: "client",
      kind: "destructive",
      input: { server: serverRef, backup },
      async run({ server, backup }, { api }) {
        await api.client("DELETE", path(server, backup));
        return `Backup ${backup} deleted.`;
      },
    }),
  ],
};
