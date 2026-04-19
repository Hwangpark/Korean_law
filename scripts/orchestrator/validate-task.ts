import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const tasksPath = path.join(repoRoot, "ops", "tasks.json");
const rolesPath = path.join(repoRoot, "ops", "agent-roles.json");

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
  wip_limit?: number;
  tasks: TaskRecord[];
};

type RoleRecord = {
  name: string;
  write_scopes?: string[];
};

type RolesFile = {
  schema_version: number;
  roles: RoleRecord[];
  validation_profiles?: Record<string, string[]>;
};

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLE_STAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLE_STAR::/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesAny(file: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => patternToRegExp(pattern).test(file));
}

function main() {
  const tasksFile = readJsonFile<TasksFile>(tasksPath);
  const rolesFile = readJsonFile<RolesFile>(rolesPath);
  const roleNames = new Set(rolesFile.roles.map((role) => role.name));
  const taskIds = new Set<string>();
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const task of tasksFile.tasks ?? []) {
    if (!task.id) {
      errors.push("Task missing id");
      continue;
    }
    if (taskIds.has(task.id)) {
      errors.push(`Duplicate task id: ${task.id}`);
    }
    taskIds.add(task.id);

    if (!roleNames.has(task.owner_role)) {
      errors.push(`Task ${task.id} references unknown role: ${task.owner_role}`);
    }

    if (!Array.isArray(task.files) || task.files.length === 0) {
      errors.push(`Task ${task.id} must declare at least one file`);
    }

    const role = rolesFile.roles.find((entry) => entry.name === task.owner_role);
    if (role?.write_scopes?.length) {
      const outOfScope = task.files.filter((file) => !matchesAny(file, role.write_scopes));
      if (outOfScope.length > 0) {
        warnings.push(`Task ${task.id} has files outside ${task.owner_role} write scopes: ${outOfScope.join(", ")}`);
      }
    }
  }

  const payload = {
    ok: errors.length === 0,
    errors,
    warnings,
    task_count: tasksFile.tasks?.length ?? 0,
    role_count: rolesFile.roles?.length ?? 0
  };

  console.log(JSON.stringify(payload, null, 2));

  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

main();
