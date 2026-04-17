import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const tasksPath = path.join(repoRoot, "ops", "tasks.json");
const rolesPath = path.join(repoRoot, "ops", "agent-roles.json");

type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";

type TaskRecord = {
  id: string;
  title: string;
  status: TaskStatus;
  owner_role: string;
  files: string[];
  validation?: string[];
  notes?: string;
};

type TasksFile = {
  schema_version: number;
  wip_limit?: number;
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
  wip_limit?: number;
  roles: RoleRecord[];
  validation_profiles?: Record<string, string[]>;
};

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function normalizeStatus(value: string | undefined): TaskStatus {
  if (value === "in_progress" || value === "completed" || value === "blocked") {
    return value;
  }
  return "pending";
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

function matchesRole(task: TaskRecord, role: string | null): boolean {
  return !role || task.owner_role === role;
}

function toBrief(task: TaskRecord, role: RoleRecord | undefined, wip: number, limit: number | undefined) {
  return {
    id: task.id,
    title: task.title,
    status: normalizeStatus(task.status),
    owner_role: task.owner_role,
    notes: task.notes ?? null,
    files: task.files,
    validation: task.validation ?? [],
    role: role
      ? {
          purpose: role.purpose,
          write_scopes: role.write_scopes ?? [],
          must_not_touch: role.must_not_touch ?? []
        }
      : null,
    orchestration: {
      current_wip: wip,
      wip_limit: limit ?? null,
      can_claim: typeof limit === "number" ? wip < limit : true
    }
  };
}

function main() {
  const tasksFile = readJsonFile<TasksFile>(tasksPath);
  const rolesFile = readJsonFile<RolesFile>(rolesPath);
  const roleName = getArg("role");
  const taskId = getArg("task");
  const json = hasFlag("json");

  const tasks = tasksFile.tasks ?? [];
  const inProgressCount = tasks.filter((task) => normalizeStatus(task.status) === "in_progress").length;
  const limit = tasksFile.wip_limit ?? rolesFile.wip_limit;

  let selected: TaskRecord | undefined;
  if (taskId) {
    selected = tasks.find((task) => task.id === taskId);
  } else {
    selected = tasks.find((task) => normalizeStatus(task.status) === "pending" && matchesRole(task, roleName));
  }

  if (!selected) {
    const payload = {
      ok: false,
      reason: taskId ? "task_not_found" : "no_pending_task",
      role: roleName,
      task: taskId
    };
    if (json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log("No matching task found.");
    return;
  }

  const role = rolesFile.roles.find((entry) => entry.name === selected?.owner_role);
  const payload = {
    ok: true,
    task: toBrief(selected, role, inProgressCount, limit)
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`# ${selected.title}`);
  console.log(`- id: ${selected.id}`);
  console.log(`- status: ${selected.status}`);
  console.log(`- owner_role: ${selected.owner_role}`);
  console.log(`- files: ${selected.files.join(", ")}`);
  console.log(`- validation: ${(selected.validation ?? []).join(", ") || "none"}`);
  if (selected.notes) {
    console.log(`- notes: ${selected.notes}`);
  }
  if (role) {
    console.log(`- role purpose: ${role.purpose}`);
  }
  if (typeof limit === "number") {
    console.log(`- WIP: ${inProgressCount}/${limit}`);
  }
}

main();
