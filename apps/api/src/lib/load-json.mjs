import { readFile } from "node:fs/promises";

import { fromRepo } from "./paths.mjs";

export async function loadJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function loadRepoJson(relativePath) {
  return loadJson(fromRepo(relativePath));
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
