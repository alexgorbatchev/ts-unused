import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Check which files have local git changes (modified, staged, or untracked)
 * Note: Checks the entire git repository, not just the working directory
 * @param workingDir - The directory to check git status in (used to find git root)
 * @returns Set of absolute file paths that have local changes
 */
export function checkGitStatus(workingDir: string): Set<string> {
  const changedFiles = new Set<string>();
  let gitRoot: string;

  try {
    gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: workingDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).replace(/\r?\n$/, "");
  } catch {
    // Allow projects outside Git. Once a repository is found, status errors
    // must propagate so the fixer cannot treat dirty files as clean.
    return changedFiles;
  }

  // NUL-delimited porcelain preserves whitespace and special characters in paths.
  // List individual untracked files so new directories are protected too.
  const output = execFileSync(
    "git",
    ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
    {
      cwd: workingDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  const entries = output.split("\0");
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry) continue;

    // Porcelain paths are relative to the repository root, even from a subdirectory.
    changedFiles.add(path.resolve(gitRoot, entry.slice(3)));

    // Renames and copies contain a second NUL-delimited path (the original).
    // The destination is the first path and is the file that must be protected.
    const status = entry.slice(0, 2);
    if (status.includes("R") || status.includes("C")) {
      index++;
    }
  }

  return changedFiles;
}
