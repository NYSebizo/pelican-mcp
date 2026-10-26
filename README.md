# pelican-mcp

An [MCP](https://modelcontextprotocol.io) server for [Pelican Panel](https://pelican.dev) that covers **everything you can do in the panel UI** — for users *and* admins — through natural language.

- **133 tools** covering the full Pelican client API (servers, console, files, backups, databases, schedules, network, subusers, account) and application API (servers, users, roles, nodes, allocations, eggs, database hosts, mounts, plugins, webhooks).
- **Live console**: `run_command` sends a command over the Wings websocket and returns what the server prints back; `get_console_logs` reads the console history.
- **Safe by design**: every tool carries MCP annotations (read-only / destructive / idempotent), `PELICAN_READ_ONLY=true` hides everything that changes state, and API errors (incl. per-field validation errors) come back as readable messages instead of crashing the tool call.
- **Partial updates**: `update_*` tools fetch the current state and only change the fields you pass — no need to resend the whole object like the raw API requires.
- **Only what you can use**: client tools appear when a client key is set, `admin_*` tools when an application key is set. `PELICAN_TOOLSETS` narrows it down further.

## Setup

You need a Pelican Panel and at least one API key:

| Key | Where to create it | Unlocks |
|---|---|---|
| Client key (`pacc_…`) | *Profile → API Keys* | Everything on the server pages + your account (non-`admin_` tools) |
| Application key (`papp_…`) | *Admin → API Keys* (give it the permissions you need) | The admin area (`admin_*` tools) |

### Claude Desktop / Claude Code (via npx)

```json
{
  "mcpServers": {
    "pelican": {
      "command": "npx",
      "args": ["-y", "pelican-mcp"],
      "env": {
        "PELICAN_URL": "https://panel.example.com",
        "PELICAN_CLIENT_API_KEY": "pacc_...",
        "PELICAN_APPLICATION_API_KEY": "papp_..."
      }
    }
  }
}
```

Claude Code one-liner:

```bash
claude mcp add pelican -e PELICAN_URL=https://panel.example.com -e PELICAN_CLIENT_API_KEY=pacc_... -e PELICAN_APPLICATION_API_KEY=papp_... -- npx -y pelican-mcp
```

### From source (requires [Bun](https://bun.sh))

```bash
git clone https://github.com/NYSebizo/pelican-mcp
cd pelican-mcp
bun install
bun run build        # → dist/index.js, runs on Node ≥ 18
```

Then use `"command": "node", "args": ["/path/to/pelican-mcp/dist/index.js"]` (or `"command": "bun", "args": ["run", "/path/to/pelican-mcp/src/index.ts"]`).

## Configuration

| Variable | Required | Description |
|---|---|---|
| `PELICAN_URL` | yes | Base URL of the panel, e.g. `https://panel.example.com` |
| `PELICAN_CLIENT_API_KEY` | one of the keys | Client API key (`pacc_…`) |
| `PELICAN_APPLICATION_API_KEY` | one of the keys | Application API key (`papp_…`) |
| `PELICAN_API_KEY` | – | Legacy single key; routed to the right API by its prefix |
| `PELICAN_READ_ONLY` | – | `true` to only expose tools that never change anything |
| `PELICAN_TOOLSETS` | – | Comma-separated list of toolsets to enable, e.g. `servers,files,backups` (default: all) |
| `PELICAN_TIMEOUT_MS` | – | Per-request timeout (default `30000`) |

## Identifiers

- Tools **without** `admin_` use the client API and take a server **identifier** (`a1b2c3d4`) or UUID → see `list_servers`.
- `admin_*` tools use the application API and take **numeric IDs** → see `admin_list_servers`, `admin_list_users`, …

## Tools

✏️ = changes state, ⚠️ = destructive (deletes data / interrupts service). Toolset names (for `PELICAN_TOOLSETS`) are the headings.

#### `servers`

| Tool | | Description |
|---|---|---|
| `list_servers` |  | List the servers this account can access (owned or as subuser). |
| `get_server` |  | Get full details of a server: limits, feature limits, SFTP details, docker image, egg features, allocations and startup variables. |
| `get_server_resources` |  | Live power state plus CPU, memory, disk, network and uptime of a server (what the console page graphs show). |
| `power_server` | ✏️ | Start, stop, restart or kill a server. |
| `send_command` | ✏️ | Send a command to the server console without waiting for output. |
| `run_command` | ✏️ | Send a command through the live console websocket and return the console lines printed in response. |
| `get_console_logs` |  | Fetch the recent console output of a server (the history the console page shows when opened). |
| `list_server_activity` |  | List the server's activity log (who did what: logins, file edits, power actions, backups…). |
| `update_server_settings` | ✏️ | Change a server's name and/or description (Settings page). |
| `reinstall_server` | ⚠️ | Re-run the egg's install script. |
| `get_startup` |  | Show the startup command, available docker images and all egg variables (with current values and whether they are editable). |
| `set_startup_variable` | ✏️ | Change the value of an editable egg/startup variable (e.g. |
| `set_docker_image` | ✏️ | Switch the server's docker image to another image offered by its egg (see get_startup → meta.docker_images). |

#### `files`

| Tool | | Description |
|---|---|---|
| `list_files` |  | List files and folders in a server directory (name, type, size, permissions, modified time). |
| `read_file` |  | Read a text file from the server (configs, logs, properties…). |
| `write_file` | ✏️ | Create or overwrite a text file on the server with the given content. |
| `upload_file` | ✏️ | Upload a file (text or base64-encoded binary) into a server directory via the panel's upload endpoint. |
| `pull_file` | ✏️ | Have the server download a file from a public URL (e.g. |
| `get_file_download_url` |  | Create a one-time signed URL to download a file (including binary files) directly from the node. |
| `create_folder` | ✏️ | Create a new directory. |
| `rename_files` | ✏️ | Rename or move one or more files/folders. |
| `copy_file` | ✏️ | Duplicate a file in place (the panel creates '<name> copy.<ext>' next to it). |
| `delete_files` | ⚠️ | Permanently delete files and/or folders (folders are deleted recursively). |
| `compress_files` | ✏️ | Compress files/folders into an archive inside the same directory. |
| `decompress_file` | ✏️ | Extract an archive (zip, tar.gz, …) into the directory it is in. |
| `chmod_files` | ✏️ | Change Unix permissions of files/folders (octal mode like 644 or 755). |

#### `backups`

| Tool | | Description |
|---|---|---|
| `list_backups` |  | List a server's backups with size, status, lock state and checksum. |
| `get_backup` |  | Get one backup's details (useful to poll whether a new backup has completed). |
| `create_backup` | ✏️ | Start a new backup. |
| `rename_backup` | ✏️ | Rename a backup. |
| `set_backup_lock` | ✏️ | Lock (protect from deletion and rotation) or unlock a backup. |
| `restore_backup` | ⚠️ | Restore a backup onto the server. |
| `get_backup_download_url` |  | Create a signed, temporary URL to download a backup archive. |
| `delete_backup` | ⚠️ | Permanently delete a backup (locked backups must be unlocked first). |

#### `databases`

| Tool | | Description |
|---|---|---|
| `list_databases` |  | List the server's databases with host, username and connection info. |
| `create_database` | ✏️ | Create a new MySQL/MariaDB database for the server. |
| `rotate_database_password` | ✏️ | Generate a new password for a database user. |
| `delete_database` | ⚠️ | Permanently delete a database and all its data. |

#### `schedules`

| Tool | | Description |
|---|---|---|
| `list_schedules` |  | List a server's schedules with their cron expression, state, next run and tasks. |
| `get_schedule` |  | Get one schedule including its tasks. |
| `create_schedule` | ✏️ | Create a cron schedule (e.g. |
| `update_schedule` | ✏️ | Change a schedule. |
| `run_schedule` | ✏️ | Execute a schedule immediately, regardless of its cron timing. |
| `delete_schedule` | ⚠️ | Delete a schedule and all its tasks. |
| `create_schedule_task` | ✏️ | Add a task (console command, power action, backup or file deletion) to a schedule. |
| `update_schedule_task` | ✏️ | Change a schedule task. |
| `delete_schedule_task` | ⚠️ | Remove a task from a schedule. |

#### `network`

| Tool | | Description |
|---|---|---|
| `list_allocations` |  | List the server's IP:port allocations, their notes and which one is primary. |
| `add_allocation` | ✏️ | Automatically assign an additional free port to the server (requires allocation limit and auto-assign enabled on the panel). |
| `set_allocation_notes` | ✏️ | Set or clear the note on an allocation (e.g. |
| `set_primary_allocation` | ✏️ | Make an allocation the server's primary (default) IP:port. |
| `remove_allocation` | ⚠️ | Unassign a (non-primary) allocation from the server. |

#### `subusers`

| Tool | | Description |
|---|---|---|
| `list_permissions` |  | List every subuser permission key the panel knows, grouped with descriptions. |
| `list_subusers` |  | List users who have access to this server and their permissions. |
| `get_subuser` |  | Get one subuser and their permissions. |
| `add_subuser` | ✏️ | Invite a user by email to the server with the given permissions (an account is created if needed). |
| `update_subuser` | ✏️ | Replace a subuser's permissions (permissions not listed are revoked). |
| `remove_subuser` | ⚠️ | Revoke a subuser's access to the server. |

#### `account`

| Tool | | Description |
|---|---|---|
| `get_account` |  | Show the account the client API key belongs to (username, email, language, admin flag). |
| `update_account` | ✏️ | Change the account's username, email and/or password. |
| `list_account_activity` |  | List the account's activity log (logins, API key changes, …). |
| `list_api_keys` |  | List the account's client API keys (identifier, description, allowed IPs, last used). |
| `create_api_key` | ✏️ | Create a new client API key. |
| `delete_api_key` | ⚠️ | Revoke a client API key by its identifier. |
| `list_ssh_keys` |  | List SSH public keys registered for SFTP login. |
| `add_ssh_key` | ✏️ | Register an SSH public key (OpenSSH format) for SFTP login. |
| `delete_ssh_key` | ⚠️ | Remove an SSH key by its fingerprint. |

#### `admin-servers`

| Tool | | Description |
|---|---|---|
| `admin_list_servers` |  | List every server on the panel (numeric id, identifier, owner, node, egg, limits, status). |
| `admin_get_server` |  | Get a server by numeric ID or external ID, optionally with related resources. |
| `admin_create_server` | ✏️ | Create a server. |
| `admin_update_server_details` | ✏️ | Change name, owner, description or external ID. |
| `admin_update_server_build` | ✏️ | Change resource limits, feature limits, primary allocation, add/remove allocations or OOM killer. |
| `admin_update_server_startup` | ✏️ | Change startup command, egg, docker image or variable values (admins can edit non-user-editable variables). |
| `admin_set_server_suspended` | ✏️ | Suspend (stops it and blocks access) or unsuspend a server. |
| `admin_reinstall_server` | ⚠️ | Re-run the install script for a server. |
| `admin_transfer_server` | ✏️ | Move a server to another node. |
| `admin_cancel_transfer` | ✏️ | Cancel a running server transfer. |
| `admin_delete_server` | ⚠️ | Permanently delete a server and its files. |
| `admin_list_server_databases` |  | List databases of a server, optionally with passwords and host details. |
| `admin_create_server_database` | ✏️ | Create a database for a server on a specific database host. |
| `admin_reset_server_database_password` | ✏️ | Generate a new password for a server database. |
| `admin_delete_server_database` | ⚠️ | Permanently delete a server database. |

#### `admin-users`

| Tool | | Description |
|---|---|---|
| `admin_list_users` |  | List all panel users. |
| `admin_get_user` |  | Get a user by numeric ID or external ID, optionally with their servers and roles. |
| `admin_create_user` | ✏️ | Create a panel user. |
| `admin_update_user` | ✏️ | Update a user. |
| `admin_set_user_roles` | ✏️ | Assign roles to a user or remove roles from them (e.g. |
| `admin_delete_user` | ⚠️ | Delete a user. |
| `admin_list_roles` |  | List admin roles and (optionally) their permissions. |
| `admin_get_role` |  | Get a role with its permissions. |
| `admin_create_role` | ✏️ | Create an admin role. |
| `admin_rename_role` | ✏️ | Rename a role (the root admin role cannot be changed). |
| `admin_delete_role` | ⚠️ | Delete a role. |

#### `admin-nodes`

| Tool | | Description |
|---|---|---|
| `admin_list_nodes` |  | List all nodes with capacity and allocated resources. |
| `admin_get_node` |  | Get one node's full configuration and allocated resources. |
| `admin_get_node_configuration` |  | Get the Wings configuration (the contents of config.yml, as JSON) for a node. |
| `admin_list_deployable_nodes` |  | Find nodes with enough free memory/disk/CPU to host a new server. |
| `admin_create_node` | ✏️ | Register a new node. |
| `admin_update_node` | ✏️ | Update a node (e.g. |
| `admin_delete_node` | ⚠️ | Delete a node. |
| `admin_list_allocations` |  | List IP:port allocations on a node. |
| `admin_create_allocations` | ✏️ | Create allocations on a node for an IP and a list of ports or ranges (e.g. |
| `admin_delete_allocation` | ⚠️ | Delete an unassigned allocation from a node. |

#### `admin-eggs`

| Tool | | Description |
|---|---|---|
| `admin_list_eggs` |  | List all eggs (server types) with their docker images, startup commands and features. |
| `admin_get_egg` |  | Get an egg including its variables (needed to know which environment values admin_create_server requires). |
| `admin_export_egg` |  | Export an egg as JSON or YAML (the same file the panel's export button produces). |
| `admin_import_egg` | ✏️ | Import an egg from its JSON/YAML content (PLCN_v3 or legacy PTDL_v2), or from a URL (e.g. |
| `admin_delete_egg` | ⚠️ | Delete an egg (must not be used by any server). |

#### `admin-database-hosts`

| Tool | | Description |
|---|---|---|
| `admin_list_database_hosts` |  | List database hosts that server databases can be created on. |
| `admin_get_database_host` |  | Get a database host. |
| `admin_create_database_host` | ✏️ | Add a MySQL/MariaDB host the panel can create server databases on. |
| `admin_update_database_host` | ✏️ | Update a database host. |
| `admin_delete_database_host` | ⚠️ | Delete a database host (must not have databases). |

#### `admin-mounts`

| Tool | | Description |
|---|---|---|
| `admin_list_mounts` |  | List mounts (host directories that can be mounted into server containers). |
| `admin_get_mount` |  | Get a mount and the eggs, nodes and servers it is attached to. |
| `admin_create_mount` | ✏️ | Create a mount. |
| `admin_update_mount` | ✏️ | Update a mount. |
| `admin_attach_mount` | ✏️ | Attach a mount to eggs, nodes or servers. |
| `admin_detach_mount` | ✏️ | Detach a mount from an egg, node or server. |
| `admin_delete_mount` | ⚠️ | Delete a mount. |

#### `admin-plugins`

| Tool | | Description |
|---|---|---|
| `admin_list_plugins` |  | List panel plugins with version, status and update availability. |
| `admin_get_plugin` |  | Get details of a plugin. |
| `admin_import_plugin` | ✏️ | Download a plugin archive (.zip) from a URL into the panel. |
| `admin_manage_plugin` | ⚠️ | Run a lifecycle action on a plugin. |
| `admin_set_plugin_hub` | ✏️ | Connect the panel to the Pelican Hub for plugin downloads and update checks. |

#### `admin-webhooks`

| Tool | | Description |
|---|---|---|
| `admin_list_webhooks` |  | List configured webhooks. |
| `admin_get_webhook` |  | Get a webhook, optionally with its recent deliveries. |
| `admin_list_webhook_types` |  | List available webhook types (e.g. |
| `admin_list_webhook_events` |  | List the events a webhook can subscribe to. |
| `admin_create_webhook` | ✏️ | Create a webhook that fires on panel events. |
| `admin_update_webhook` | ✏️ | Update a webhook. |
| `admin_test_webhook` | ✏️ | Send a test delivery to a webhook's endpoint. |
| `admin_delete_webhook` | ⚠️ | Delete a webhook. |

## Development

```bash
bun install
bun run typecheck
bun test             # end-to-end tests against a mock panel + Wings websocket
bun run build
```

Adding a tool: pick the matching file in `src/tools/client` or `src/tools/application`, add a `tool({...})` entry with a zod `input` shape and a `run` function, and set `kind` (`read` / `write` / `destructive`). Registration, annotations, read-only filtering and error handling are handled by `src/tool.ts`.

```
src/
├── index.ts          entry point (stdio transport, server instructions)
├── config.ts         env parsing
├── api.ts            HTTP client: auth per API, errors, query building, Fractal unwrapping, pagination
├── console.ts        Wings websocket (console logs / command output)
├── tool.ts           tool definition + registration framework
├── schemas.ts        shared zod schemas and helpers
└── tools/
    ├── client/       client API (what a panel user can do)
    └── application/  application API (admin area)
```

## License

MIT
