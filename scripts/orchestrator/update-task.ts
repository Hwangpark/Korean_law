import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const tasksPath = path.join(repoRoot, "ops", "tasks.json");

const allowedStatuses = new Set(["pending", "in_progress", "completed", "blocked"]);

type TaskRecord = {
  id: string;
  title: string;
  status: string;
  owner_role: string;
  files: string[];
  validation?: string[];
  notes?: string;
  claimed_by?: string;
  claimed_at?: string;
  updated_at?: string;
  completed_at?: string;
  blocked_reason?: string;
};

type TasksFile = {
  schema_version: number;
  tasks: TaskRecord[];
};

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJsonFile(filePath: string, data: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function getArg(name: string): string | null {
  const prefixed = `--${name}`;
  const found = process.argv.find((arg) => arg.startsWith(`${prefixed}=`));
  if (found) {
    return found.slice(prefixed.length + 1);
  }
  const index = process.argv.indexOf(prefixed);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function main() {
  const tasksFile = readJsonFile<TasksFile>(tasksPath);
  const taskId = getArg("task");
  const nextStatus = getArg("status");
  const actor = getArg("by") ?? "orchestrator";
  const note = getArg("note");
  const dryRun = hasFlag("dry-run");

  if (!taskId || !nextStatus) {
    console.error("Missing required --task <id> and/or --status <pending|in_progress|completed|blocked>");
    process.exit(1);
  }

  if (!allowedStatuses.has(nextStatus)) {
    console.error(`Unsupported status: ${nextStatus}`);
    process.exit(1);
  }

  const task = tasksFile.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    console.error(`Task not found: ${taskId}`);
    process.exit(1);
  }

  const now = new Date().toISOString();
  const updatedTask: TaskRecord = {
    ...task,
    status: nextStatus,
    updated_at: now,
    ...(note ? { notes: note } : {}),
    ...(nextStatus === "completed" ? { completed_at: now } : {}),
    ...(nextStatus === "blocked" ? { blocked_reason: note ?? "blocked" } : {}),
    ...(nextStatus === "pending"
      ? { claimed_by: undefined, claimed_at: undefined, completed_at: undefined, blocked_reason: undefined }
      : {}),
    claimed_by: task.claimed_by ?? actor
  };

  const nextFile: TasksFile = {
    ...tasksFile,
    tasks: tasksFile.tasks.map((entry) => (entry.id === taskId ? updatedTask : entry))
  };

  if (!dryRun) {
    writeJsonFile(tasksPath, nextFile);
  }

  console.log(JSON.stringify({ ok: true, dry_run: dryRun, task: updatedTask }, null, 2));
}

main();
