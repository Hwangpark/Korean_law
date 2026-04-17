import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const tasksPath = path.join(repoRoot, "ops", "tasks.json");
const rolesPath = path.join(repoRoot, "ops", "agent-roles.json");
const reviewNotesPath = path.join(repoRoot, "docs", "review-notes.md");

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
  must_not_touch?: string[];
};

type RolesFile = {
  schema_version: number;
  global_rules?: string[];
  roles: RoleRecord[];
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

function defaultTask(tasks: TaskRecord[]): TaskRecord | undefined {
  return tasks.find((task) => task.status === "in_progress") ?? tasks.find((task) => task.status === "pending");
}

function main() {
  const tasksFile = readJsonFile<TasksFile>(tasksPath);
  const rolesFile = readJsonFile<RolesFile>(rolesPath);
  const taskId = getArg("task");
  const writeFile = hasFlag("write");
  const task = taskId
    ? tasksFile.tasks.find((entry) => entry.id === taskId)
    : defaultTask(tasksFile.tasks ?? []);

  if (!task) {
    console.error("No task available for review checklist generation.");
    process.exit(1);
  }

  const reviewer = rolesFile.roles.find((entry) => entry.name === "reviewer");
  const timestamp = new Date().toISOString();
  const content = [
    `# Review Checklist · ${task.id}`,
    "",
    `- Generated at: ${timestamp}`,
    `- Task: ${task.title}`,
    `- Status: ${task.status}`,
    `- Owner role: ${task.owner_role}`,
    "",
    "## Files in scope",
    ...task.files.map((file) => `- ${file}`),
    "",
    "## Review focus",
    "- 법률 정확성 표현이 과도하지 않은지 확인",
    "- privacy / disclaimer / guest quota 규칙이 유지되는지 확인",
    "- retrieval evidence 부족 상태에서 강한 결론을 내리지 않는지 확인",
    "- 파일 경계 위반이나 스파게티 결합이 생기지 않았는지 확인",
    "",
    "## Validation commands",
    ...((task.validation ?? []).length > 0 ? (task.validation ?? []).map((command) => `- ${command}`) : ["- No task-specific validation declared"]),
    "",
    "## Reviewer guardrails",
    ...((reviewer?.must_not_touch ?? []).map((entry) => `- Do not touch ${entry}`)),
    ...((rolesFile.global_rules ?? []).map((rule) => `- ${rule}`)),
    "",
    "## Findings",
    "- Result: pending review",
    "- Notes:",
    "  - "
  ].join("\n");

  if (writeFile) {
    fs.writeFileSync(reviewNotesPath, `${content}\n`, "utf8");
  }

  console.log(content);
}

main();
