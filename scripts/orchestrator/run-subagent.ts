import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const tasksPath = path.join(repoRoot, "ops", "tasks.json");

const defaultDocs = [
  "docs/codex-orchestration.md",
  "project.md",
  "ARCHITECTURE.md",
  "docs/multi-agent-runtime.md",
  "docs/mcp-first-runtime.md"
];

type TaskRecord = {
  id: string;
  title: string;
  status: string;
  owner_role: string;
  files: string[];
  validation?: string[];
  notes?: string;
};

type TasksFile = {
  schema_version: number;
  tasks: TaskRecord[];
};

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
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
  const role = getArg("role");
  const json = hasFlag("json");
  const task = taskId
    ? tasksFile.tasks.find((entry) => entry.id === taskId)
    : tasksFile.tasks.find((entry) => entry.status === "pending");

  if (!task) {
    const payload = { ok: false, reason: taskId ? "task_not_found" : "no_pending_task" };
    console.log(json ? JSON.stringify(payload, null, 2) : "No task available.");
    process.exitCode = 1;
    return;
  }

  const effectiveRole = role ?? task.owner_role;
  const lines = [
    `Task: ${task.title} (${task.id})`,
    `Role: ${effectiveRole}`,
    "",
    "Follow the repository orchestration rules and stay within file ownership boundaries.",
    "Read these first:",
    ...defaultDocs.map((entry) => `- ${entry}`),
    "",
    "Files you may work on:",
    ...task.files.map((file) => `- ${file}`),
    "",
    "Task notes:",
    `- ${task.notes ?? "No additional notes."}`,
    "",
    "Validation to run before handoff:",
    ...((task.validation ?? []).length > 0 ? (task.validation ?? []).map((command) => `- ${command}`) : ["- No validation declared"]),
    "",
    "Reply with:",
    "- what you changed",
    "- validation results",
    "- remaining risks or blockers"
  ];

  const payload = {
    ok: true,
    task_id: task.id,
    role: effectiveRole,
    mode: "openclaw-subagent",
    recommended_spawn: {
      runtime: "subagent",
      task: lines.join("\n")
    }
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(lines.join("\n"));
}

main();
