import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(currentDir, "../../../../");

export function fromRepo(...parts) {
  return path.join(repoRoot, ...parts);
}
