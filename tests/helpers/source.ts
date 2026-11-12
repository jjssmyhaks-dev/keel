import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".authab"]);

export function repoPath(relative: string) {
  return path.join(process.cwd(), relative);
}

export function readSource(relative: string) {
  return fs.readFileSync(repoPath(relative), "utf8");
}

export function walkSourceFiles(root: string): string[] {
  const files: string[] = [];
  const stack = [repoPath(root)];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") || entry.name.endsWith(".mts")) {
        files.push(full);
      }
    }
  }
  return files;
}

/** Repository-relative, forward-slash paths of source files containing a string. */
export function filesContaining(root: string, needle: string): string[] {
  return walkSourceFiles(root)
    .filter((file) => fs.readFileSync(file, "utf8").includes(needle))
    .map((file) => path.relative(process.cwd(), file).replaceAll("\\", "/"))
    .sort();
}
