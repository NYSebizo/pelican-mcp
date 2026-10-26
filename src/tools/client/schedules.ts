import { z } from "zod";
import { unwrap } from "../../api.ts";
import { seg, serverRef, srv } from "../../schemas.ts";
import { tool, type ToolGroup } from "../../tool.ts";

interface Schedule {
  name: string;
  cron: { minute: string; hour: string; day_of_month: string; month: string; day_of_week: string };
  is_active: boolean;
  only_when_online: boolean;
  tasks?: Task[];
}

interface Task {
  id: number;
  sequence_id: number;
  action: string;
  payload: string;
  time_offset: number;
  continue_on_failure: boolean;
}

const schedule = z.coerce.number().int().positive().describe("Schedule ID");
const task = z.coerce.number().int().positive().describe("Task ID");
const path = (server: string, id?: number) => `${srv(server)}/schedules${id ? `/${seg(id)}` : ""}`;

const cronField = (what: string, example: string) => z.string().min(1).describe(`Cron ${what} field, e.g. '${example}'`);

const scheduleFields = {
  name: z.string().min(1).max(255),
  minute: cronField("minute", "*/30"),
  hour: cronField("hour", "4"),
  day_of_month: cronField("day-of-month", "*"),
  month: cronField("month", "*"),
  day_of_week: cronField("day-of-week (0 = Sunday)", "1-5"),
  is_active: z.boolean().describe("Inactive schedules never fire"),
  only_when_online: z.boolean().describe("Skip runs while the server is offline"),
};

const taskFields = {
  action: z
    .enum(["command", "power", "backup", "delete_files"])
    .describe("command = console command, power = power signal, backup = create backup, delete_files = delete paths"),
  payload: z
    .string()
    .optional()
    .describe("command: the console command; power: start|stop|restart|kill; backup: newline-separated ignored paths (optional); delete_files: newline-separated paths"),
  time_offset: z.number().int().min(0).max(900).describe("Seconds to wait after the previous task"),
  continue_on_failure: z.boolean().describe("Run the remaining tasks even if this one fails"),
  sequence_id: z.number().int().min(1).describe("Position in the schedule (tasks run in ascending order)"),
};

export const scheduleTools: ToolGroup = {
  name: "schedules",
  tools: [
    tool({
      name: "list_schedules",
      title: "List schedules",
      description: "List a server's schedules with their cron expression, state, next run and tasks.",
      scope: "client",
      kind: "read",
      input: { server: serverRef },
      async run({ server }, { api }) {
        return unwrap(await api.client("GET", path(server), { query: { include: ["tasks"] } }));
      },
    }),

    tool({
      name: "get_schedule",
      title: "Get schedule",
      description: "Get one schedule including its tasks.",
      scope: "client",
      kind: "read",
      input: { server: serverRef, schedule },
      async run({ server, schedule }, { api }) {
        return unwrap(await api.client("GET", path(server, schedule), { query: { include: ["tasks"] } }));
      },
    }),

    tool({
      name: "create_schedule",
      title: "Create schedule",
      description: "Create a cron schedule (e.g. daily restart at 04:00 → minute '0', hour '4', rest '*'). Add actions with create_schedule_task.",
      scope: "client",
      kind: "write",
      input: {
        server: serverRef,
        ...scheduleFields,
        is_active: scheduleFields.is_active.default(true),
        only_when_online: scheduleFields.only_when_online.default(false),
      },
      async run({ server, ...body }, { api }) {
        return unwrap(await api.client("POST", path(server), { body }));
      },
    }),

    tool({
      name: "update_schedule",
      title: "Update schedule",
      description: "Change a schedule. Only the fields you pass are changed; everything else keeps its current value.",
      scope: "client",
      kind: "write",
      idempotent: true,
      input: {
        server: serverRef,
        schedule,
        name: scheduleFields.name.optional(),
        minute: scheduleFields.minute.optional(),
        hour: scheduleFields.hour.optional(),
        day_of_month: scheduleFields.day_of_month.optional(),
        month: scheduleFields.month.optional(),
        day_of_week: scheduleFields.day_of_week.optional(),
        is_active: scheduleFields.is_active.optional(),
        only_when_online: scheduleFields.only_when_online.optional(),
      },
      async run({ server, schedule, ...changes }, { api }) {
        const cur = unwrap(await api.client("GET", path(server, schedule))) as Schedule;
        const body = {
          name: changes.name ?? cur.name,
          minute: changes.minute ?? cur.cron.minute,
          hour: changes.hour ?? cur.cron.hour,
          day_of_month: changes.day_of_month ?? cur.cron.day_of_month,
          month: changes.month ?? cur.cron.month,
          day_of_week: changes.day_of_week ?? cur.cron.day_of_week,
          is_active: changes.is_active ?? cur.is_active,
          only_when_online: changes.only_when_online ?? cur.only_when_online,
        };
        return unwrap(await api.client("POST", path(server, schedule), { body }));
      },
    }),

    tool({
      name: "run_schedule",
      title: "Run schedule now",
      description: "Execute a schedule immediately, regardless of its cron timing.",
      scope: "client",
      kind: "write",
      input: { server: serverRef, schedule },
      async run({ server, schedule }, { api }) {
        await api.client("POST", `${path(server, schedule)}/execute`);
        return `Schedule ${schedule} triggered.`;
      },
    }),

    tool({
      name: "delete_schedule",
      title: "Delete schedule",
      description: "Delete a schedule and all its tasks.",
      scope: "client",
      kind: "destructive",
      input: { server: serverRef, schedule },
      async run({ server, schedule }, { api }) {
        await api.client("DELETE", path(server, schedule));
        return `Schedule ${schedule} deleted.`;
      },
    }),

    tool({
      name: "create_schedule_task",
      title: "Add schedule task",
      description: "Add a task (console command, power action, backup or file deletion) to a schedule.",
      scope: "client",
      kind: "write",
      input: {
        server: serverRef,
        schedule,
        action: taskFields.action,
        payload: taskFields.payload,
        time_offset: taskFields.time_offset.default(0),
        continue_on_failure: taskFields.continue_on_failure.default(false),
        sequence_id: taskFields.sequence_id.optional().describe("Position (default: appended at the end)"),
      },
      async run({ server, schedule, payload, ...rest }, { api }) {
        if (rest.action !== "backup" && !payload) throw new Error(`A payload is required for '${rest.action}' tasks.`);
        return unwrap(
          await api.client("POST", `${path(server, schedule)}/tasks`, { body: { ...rest, payload: payload ?? "" } }),
        );
      },
    }),

    tool({
      name: "update_schedule_task",
      title: "Update schedule task",
      description: "Change a schedule task. Only the fields you pass are changed.",
      scope: "client",
      kind: "write",
      idempotent: true,
      input: {
        server: serverRef,
        schedule,
        task,
        action: taskFields.action.optional(),
        payload: taskFields.payload,
        time_offset: taskFields.time_offset.optional(),
        continue_on_failure: taskFields.continue_on_failure.optional(),
        sequence_id: taskFields.sequence_id.optional(),
      },
      async run({ server, schedule, task, ...changes }, { api }) {
        const cur = unwrap(await api.client("GET", path(server, schedule), { query: { include: ["tasks"] } })) as Schedule;
        const t = cur.tasks?.find((x) => x.id === task);
        if (!t) throw new Error(`Task ${task} not found in schedule ${schedule}.`);
        const body = {
          action: changes.action ?? t.action,
          payload: changes.payload ?? t.payload ?? "",
          time_offset: changes.time_offset ?? t.time_offset,
          continue_on_failure: changes.continue_on_failure ?? t.continue_on_failure,
          sequence_id: changes.sequence_id ?? t.sequence_id,
        };
        return unwrap(await api.client("POST", `${path(server, schedule)}/tasks/${seg(task)}`, { body }));
      },
    }),

    tool({
      name: "delete_schedule_task",
      title: "Delete schedule task",
      description: "Remove a task from a schedule.",
      scope: "client",
      kind: "destructive",
      input: { server: serverRef, schedule, task },
      async run({ server, schedule, task }, { api }) {
        await api.client("DELETE", `${path(server, schedule)}/tasks/${seg(task)}`);
        return `Task ${task} deleted.`;
      },
    }),
  ],
};
