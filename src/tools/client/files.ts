import { z } from "zod";
import { buildQuery, unwrap } from "../../api.ts";
import { bytes, serverRef, srv } from "../../schemas.ts";
import { tool, type ToolGroup } from "../../tool.ts";

interface FileEntry {
  name: string;
  mode: string;
  size: number;
  is_file: boolean;
  is_symlink: boolean;
  mimetype: string;
  modified_at: string;
}

const root = z.string().default("/").describe("Directory the files are in, relative to the server root (default '/')");
const names = z.array(z.string().min(1)).min(1).describe("File/directory names relative to root");

const signedUrl = (res: unknown) => (unwrap(res) as { url: string }).url;

export const fileTools: ToolGroup = {
  name: "files",
  tools: [
    tool({
      name: "list_files",
      title: "List directory",
      description: "List files and folders in a server directory (name, type, size, permissions, modified time).",
      scope: "client",
      kind: "read",
      input: { server: serverRef, directory: z.string().default("/").describe("Directory to list (default '/')") },
      async run({ server, directory }, { api }) {
        const res = await api.client("GET", `${srv(server)}/files/list`, { query: { directory } });
        const entries = (unwrap(res) as FileEntry[]).sort(
          (a, b) => Number(a.is_file) - Number(b.is_file) || a.name.localeCompare(b.name),
        );
        if (entries.length === 0) return `${directory} is empty.`;
        return entries
          .map((f) => {
            const type = f.is_symlink ? "link" : f.is_file ? "file" : "dir ";
            const size = f.is_file ? bytes(f.size).padStart(10) : "".padStart(10);
            return `${type} ${f.mode} ${size}  ${f.modified_at}  ${f.name}${f.is_file ? "" : "/"}`;
          })
          .join("\n");
      },
    }),

    tool({
      name: "read_file",
      title: "Read file",
      description: "Read a text file from the server (configs, logs, properties…). Large files are truncated to max_bytes.",
      scope: "client",
      kind: "read",
      input: {
        server: serverRef,
        file: z.string().min(1).describe("Path relative to the server root, e.g. '/server.properties'"),
        max_bytes: z.number().int().min(1).max(5_000_000).default(200_000),
        tail: z.boolean().default(false).describe("When truncating, keep the end of the file instead of the beginning (useful for logs)"),
      },
      async run({ server, file, max_bytes, tail }, { api }) {
        const text = await api.client<string>("GET", `${srv(server)}/files/contents`, { query: { file }, text: true });
        if (text.length <= max_bytes) return text;
        const cut = tail ? text.slice(-max_bytes) : text.slice(0, max_bytes);
        return `[truncated: showing ${tail ? "last" : "first"} ${max_bytes} of ${text.length} characters]\n${cut}`;
      },
    }),

    tool({
      name: "write_file",
      title: "Write file",
      description: "Create or overwrite a text file on the server with the given content.",
      scope: "client",
      kind: "write",
      idempotent: true,
      input: {
        server: serverRef,
        file: z.string().min(1).describe("Path relative to the server root"),
        content: z.string().describe("Complete new file content"),
      },
      async run({ server, file, content }, { api }) {
        await api.client("POST", `${srv(server)}/files/write`, {
          query: { file },
          body: content,
          headers: { "Content-Type": "text/plain" },
        });
        return `Wrote ${bytes(new TextEncoder().encode(content).length)} to ${file}.`;
      },
    }),

    tool({
      name: "upload_file",
      title: "Upload file",
      description:
        "Upload a file (text or base64-encoded binary) into a server directory via the panel's upload endpoint. Use pull_file to download from a URL instead.",
      scope: "client",
      kind: "write",
      input: {
        server: serverRef,
        directory: z.string().default("/").describe("Target directory"),
        filename: z.string().min(1).describe("File name to create"),
        content: z.string().describe("File content"),
        encoding: z.enum(["utf8", "base64"]).default("utf8"),
      },
      async run({ server, directory, filename, content, encoding }, { api }) {
        const url = signedUrl(await api.client("GET", `${srv(server)}/files/upload`));
        const data = encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(content, "utf8");
        const form = new FormData();
        form.append("files", new Blob([data]), filename);
        const sep = url.includes("?") ? "&" : "?";
        const res = await fetch(`${url}${sep}${buildQuery({ directory }).slice(1)}`, { method: "POST", body: form });
        if (!res.ok) throw new Error(`Upload failed with HTTP ${res.status}: ${await res.text()}`);
        return `Uploaded ${filename} (${bytes(data.length)}) to ${directory}.`;
      },
    }),

    tool({
      name: "pull_file",
      title: "Download URL to server",
      description: "Have the server download a file from a public URL (e.g. a plugin .jar or modpack) into a directory.",
      scope: "client",
      kind: "write",
      input: {
        server: serverRef,
        url: z.string().url(),
        directory: z.string().default("/").describe("Target directory"),
        filename: z.string().optional().describe("Save as (defaults to the name from the URL)"),
        use_header: z.boolean().default(false).describe("Take the file name from the Content-Disposition header"),
        foreground: z.boolean().default(true).describe("Wait for the download to finish before returning"),
      },
      async run({ server, ...body }, { api }) {
        await api.client("POST", `${srv(server)}/files/pull`, { body });
        return body.foreground ? `Downloaded ${body.url} into ${body.directory}.` : `Download of ${body.url} started in the background.`;
      },
    }),

    tool({
      name: "get_file_download_url",
      title: "Get file download link",
      description: "Create a one-time signed URL to download a file (including binary files) directly from the node.",
      scope: "client",
      kind: "read",
      input: { server: serverRef, file: z.string().min(1) },
      async run({ server, file }, { api }) {
        return signedUrl(await api.client("GET", `${srv(server)}/files/download`, { query: { file } }));
      },
    }),

    tool({
      name: "create_folder",
      title: "Create folder",
      description: "Create a new directory.",
      scope: "client",
      kind: "write",
      idempotent: true,
      input: { server: serverRef, root, name: z.string().min(1).describe("Folder name (may contain sub-paths)") },
      async run({ server, root, name }, { api }) {
        await api.client("POST", `${srv(server)}/files/create-folder`, { body: { root, name } });
        return `Created ${root.replace(/\/$/, "")}/${name}.`;
      },
    }),

    tool({
      name: "rename_files",
      title: "Rename / move files",
      description: "Rename or move one or more files/folders. Paths in 'to' may include directories to move items.",
      scope: "client",
      kind: "write",
      input: {
        server: serverRef,
        root,
        files: z
          .array(z.object({ from: z.string().min(1), to: z.string().min(1) }))
          .min(1)
          .describe("Renames relative to root, e.g. [{from:'old.txt', to:'archive/new.txt'}]"),
      },
      async run({ server, root, files }, { api }) {
        await api.client("PUT", `${srv(server)}/files/rename`, { body: { root, files } });
        return files.map((f) => `${f.from} → ${f.to}`).join("\n");
      },
    }),

    tool({
      name: "copy_file",
      title: "Copy file",
      description: "Duplicate a file in place (the panel creates '<name> copy.<ext>' next to it).",
      scope: "client",
      kind: "write",
      input: { server: serverRef, location: z.string().min(1).describe("Path of the file to copy") },
      async run({ server, location }, { api }) {
        await api.client("POST", `${srv(server)}/files/copy`, { body: { location } });
        return `Copied ${location}.`;
      },
    }),

    tool({
      name: "delete_files",
      title: "Delete files",
      description: "Permanently delete files and/or folders (folders are deleted recursively).",
      scope: "client",
      kind: "destructive",
      input: { server: serverRef, root, files: names },
      async run({ server, root, files }, { api }) {
        await api.client("POST", `${srv(server)}/files/delete`, { body: { root, files } });
        return `Deleted ${files.length} item(s) in ${root}: ${files.join(", ")}`;
      },
    }),

    tool({
      name: "compress_files",
      title: "Create archive",
      description: "Compress files/folders into an archive inside the same directory.",
      scope: "client",
      kind: "write",
      input: {
        server: serverRef,
        root,
        files: names,
        name: z.string().optional().describe("Archive name without extension (default: timestamped)"),
        extension: z.enum(["zip", "tgz", "tar.gz", "txz", "tar.xz", "tbz2", "tar.bz2"]).default("tar.gz"),
      },
      async run({ server, ...body }, { api }) {
        return unwrap(await api.client("POST", `${srv(server)}/files/compress`, { body }));
      },
    }),

    tool({
      name: "decompress_file",
      title: "Extract archive",
      description: "Extract an archive (zip, tar.gz, …) into the directory it is in.",
      scope: "client",
      kind: "write",
      input: { server: serverRef, root, file: z.string().min(1).describe("Archive name relative to root") },
      async run({ server, root, file }, { api }) {
        await api.client("POST", `${srv(server)}/files/decompress`, { body: { root, file } });
        return `Extracted ${file} in ${root}.`;
      },
    }),

    tool({
      name: "chmod_files",
      title: "Change permissions",
      description: "Change Unix permissions of files/folders (octal mode like 644 or 755).",
      scope: "client",
      kind: "write",
      idempotent: true,
      input: {
        server: serverRef,
        root,
        files: z
          .array(z.object({ file: z.string().min(1), mode: z.string().regex(/^[0-7]{3,4}$/).describe("Octal, e.g. '755'") }))
          .min(1),
      },
      async run({ server, root, files }, { api }) {
        await api.client("POST", `${srv(server)}/files/chmod`, {
          body: { root, files: files.map((f) => ({ file: f.file, mode: Number(f.mode) })) },
        });
        return files.map((f) => `${f.mode} ${f.file}`).join("\n");
      },
    }),
  ],
};
