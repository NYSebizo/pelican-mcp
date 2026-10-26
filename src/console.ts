import WebSocket from "ws";
import type { PelicanApi } from "./api.ts";
import { srv } from "./schemas.ts";

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-_]/g;

export const stripAnsi = (s: string) => s.replace(ANSI, "").replace(/\r/g, "");

interface WingsMessage {
  event: string;
  args?: unknown[];
}

export interface CaptureOptions {
  /** Console command to run once authenticated. Without it, the recent log history is requested instead. */
  command?: string;
  /** Hard upper bound for the whole capture. */
  timeoutMs: number;
  /** Stop once no new line arrived for this long (after at least one line). */
  idleMs: number;
  /** Stop as soon as a line matches this pattern. */
  until?: RegExp;
}

export interface CaptureResult {
  lines: string[];
  /** Last power state reported by Wings during the capture, if any. */
  state?: string;
  /** Why the capture ended. */
  ended: "idle" | "pattern" | "timeout" | "closed";
}

/**
 * Opens the server's Wings websocket (exactly like the panel console does), optionally sends a command,
 * and collects console output until it goes quiet, a pattern matches, or the timeout hits.
 */
export async function captureConsole(api: PelicanApi, serverId: string, opts: CaptureOptions): Promise<CaptureResult> {
  const { data } = await api.client<{ data: { token: string; socket: string } }>("GET", `${srv(serverId)}/websocket`);

  return new Promise<CaptureResult>((resolve, reject) => {
    const lines: string[] = [];
    let state: string | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const ws = new WebSocket(data.socket, { headers: { Origin: api.baseUrl } });

    const finish = (ended: CaptureResult["ended"], error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      clearTimeout(idleTimer);
      ws.removeAllListeners();
      ws.on("error", () => {});
      ws.close();
      if (error) reject(error);
      else resolve({ lines, state, ended });
    };

    const hardTimer = setTimeout(() => finish("timeout"), opts.timeoutMs);
    const send = (event: string, args: unknown[]) => ws.send(JSON.stringify({ event, args }));

    const armIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish("idle"), opts.idleMs);
    };

    ws.on("open", () => send("auth", [data.token]));
    ws.on("error", (err) => finish("closed", new Error(`Console websocket error: ${err.message}`)));
    ws.on("close", () => finish("closed"));

    ws.on("message", (raw) => {
      let msg: WingsMessage;
      try {
        msg = JSON.parse(raw.toString()) as WingsMessage;
      } catch {
        return;
      }
      const arg = msg.args?.[0];

      switch (msg.event) {
        case "auth success":
          if (opts.command !== undefined) send("send command", [opts.command]);
          else send("send logs", [null]);
          armIdle();
          break;
        case "console output":
        case "install output":
        case "daemon message":
          for (const line of stripAnsi(String(arg ?? "")).split("\n")) {
            lines.push(msg.event === "daemon message" ? `[daemon] ${line}` : line);
            if (opts.until?.test(line)) return finish("pattern");
          }
          armIdle();
          break;
        case "status":
          state = String(arg);
          break;
        case "daemon error":
        case "jwt error":
          finish("closed", new Error(`Wings rejected the console session: ${String(arg ?? msg.event)}`));
          break;
        case "token expired":
          finish("closed");
          break;
      }
    });
  });
}
