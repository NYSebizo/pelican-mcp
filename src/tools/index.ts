import type { ToolGroup } from "../tool.ts";
import { accountTools } from "./client/account.ts";
import { backupTools } from "./client/backups.ts";
import { databaseTools } from "./client/databases.ts";
import { fileTools } from "./client/files.ts";
import { networkTools } from "./client/network.ts";
import { scheduleTools } from "./client/schedules.ts";
import { serverTools } from "./client/servers.ts";
import { subuserTools } from "./client/subusers.ts";
import { adminNodeTools } from "./application/nodes.ts";
import {
  adminDatabaseHostTools,
  adminEggTools,
  adminMountTools,
  adminPluginTools,
  adminWebhookTools,
} from "./application/panel.ts";
import { adminServerTools } from "./application/servers.ts";
import { adminUserTools } from "./application/users.ts";

export const groups: ToolGroup[] = [
  // Client API — everything a panel user can do on the server pages.
  serverTools,
  fileTools,
  backupTools,
  databaseTools,
  scheduleTools,
  networkTools,
  subuserTools,
  accountTools,
  // Application API — the admin area.
  adminServerTools,
  adminUserTools,
  adminNodeTools,
  adminEggTools,
  adminDatabaseHostTools,
  adminMountTools,
  adminPluginTools,
  adminWebhookTools,
];
