import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const tasksPath = path.join(repoRoot, "ops", "tasks.json");
const rolesPath = path.join(repoRoot, "ops", "agent-roles.json");
const docsPath = path.join(repoRoot, "docs", "codex-orchestration.md");

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

type RoleRecord = {
  name: string;
  purpose: string;
  write_scopes?: string[];
  must_not_touch?: string[];
};

type RolesFile = {
  schema_version: number;
  roles: RoleRecord[];
  global_rules?: string[];
  validation_profiles?: Record<string, string[]>;
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

function pickTask(tasks: TaskRecord[], taskId: string | null, roleName: string | null): TaskRecord | undefined {
  if (taskId) {
    return tasks.find((task) => task.id === taskId);
  }

  return tasks.find((task) => task.status === "pending" && (!roleName || task.owner_role === roleName));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function main() {
  const tasksFile = readJsonFile<TasksFile>(tasksPath);
  const rolesFile = readJsonFile<RolesFile>(rolesPath);
  const taskId = getArg("task");
  const roleName = getArg("role");
  const json = hasFlag("json");
  const task = pickTask(tasksFile.tasks ?? [], taskId, roleName);

  if (!task) {
    const payload = {
      ok: false,
      reason: taskId ? "task_not_found" : "no_pending_task"
    };
    console.log(json ? JSON.stringify(payload, null, 2) : "No matching task found.");
    if (!json) {
      process.exitCode = 1;
    }
    return;
  }

  const role = rolesFile.roles.find((entry) => entry.name === task.owner_role);
  const suggestedValidation = unique([
    ...(task.validation ?? []),
    ...Object.entries(rolesFile.validation_profiles ?? {})
      .filter(([profile]) => profile.includes(task.owner_role.split("-")[0]))
      .flatMap(([, commands]) => commands)
  ]);

  const payload = {
    ok: true,
    task: {
      id: task.id,
      title: task.title,
      status: task.status,
      owner_role: task.owner_role,
      files: task.files,
      notes: task.notes ?? null,
      validation: suggestedValidation,
      role: role
        ? {
            purpose: role.purpose,
            write_scopes: role.write_scopes ?? [],
            must_not_touch: role.must_not_touch ?? []
          }
        : null,
      global_rules: rolesFile.global_rules ?? []
    }
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const docHint = fs.existsSync(docsPath)
    ? "docs/codex-orchestration.md"
    : "project.md, ARCHITECTURE.md, docs/multi-agent-runtime.md";

  const lines = [
    `Task: ${task.title} (${task.id})`,
    `Role: ${task.owner_role}`,
    "",
    "Mission:",
    `- ${task.title}`,
    ...(task.notes ? [`- Context: ${task.notes}`] : []),
    "",
    "Read first:",
    `- ${docHint}`,
    "- project.md",
    "- ARCHITECTURE.md",
    "- docs/multi-agent-runtime.md",
    "- docs/mcp-first-runtime.md",
    "",
    "File ownership:",
    ...task.files.map((file) => `- ${file}`),
    "",
    "Role guardrails:",
    ...(role?.must_not_touch?.map((entry) => `- Do not touch ${entry}`) ?? ["- Follow repository ownership rules"]),
    ...(rolesFile.global_rules ?? []).map((rule) => `- ${rule}`),
    "",
    "Validation:",
    ...(suggestedValidation.length > 0 ? suggestedValidation.map((command) => `- ${command}`) : ["- No validation command declared"]),
    "",
    "Done when:",
    "- Requested files are updated without crossing ownership boundaries",
    "- Validation commands relevant to the change pass or are reported with precise failure output",
    "- Residual risks or follow-up work are listed clearly"
  ];

  console.log(lines.join("\n"));
}

main();
