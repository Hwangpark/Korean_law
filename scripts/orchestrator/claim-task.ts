import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const tasksPath = path.join(repoRoot, "ops", "tasks.json");

type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";

type TaskRecord = {
  id: string;
  title: string;
  status: TaskStatus;
  owner_role: string;
  files: string[];
  validation?: string[];
  notes?: string;
  claimed_by?: string;
  claimed_at?: string;
  updated_at?: string;
};

type TasksFile = {
  schema_version: number;
  wip_limit?: number;
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
  const roleName = getArg("role");
  const actor = getArg("by") ?? roleName ?? "orchestrator";
  const dryRun = hasFlag("dry-run");

  if (!taskId) {
    console.error("Missing required --task <id>");
    process.exit(1);
  }

  const task = tasksFile.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    console.error(`Task not found: ${taskId}`);
    process.exit(1);
  }

  if (roleName && task.owner_role !== roleName) {
    console.error(`Task ${taskId} belongs to ${task.owner_role}, not ${roleName}`);
    process.exit(1);
  }

  if (task.status !== "pending") {
    console.error(`Task ${taskId} is not pending (current: ${task.status})`);
    process.exit(1);
  }

  const inProgressCount = tasksFile.tasks.filter((entry) => entry.status === "in_progress").length;
  if (typeof tasksFile.wip_limit === "number" && inProgressCount >= tasksFile.wip_limit) {
    console.error(`WIP limit reached: ${inProgressCount}/${tasksFile.wip_limit}`);
    process.exit(1);
  }

  const now = new Date().toISOString();
  const nextTask = {
    ...task,
    status: "in_progress" as const,
    claimed_by: actor,
    claimed_at: now,
    updated_at: now
  };

  const nextFile: TasksFile = {
    ...tasksFile,
    tasks: tasksFile.tasks.map((entry) => (entry.id === taskId ? nextTask : entry))
  };

  if (!dryRun) {
    writeJsonFile(tasksPath, nextFile);
  }

  console.log(JSON.stringify({ ok: true, dry_run: dryRun, task: nextTask }, null, 2));
}

main();
