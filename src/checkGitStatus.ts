import { execSync } from "node:child_process";
import path from "node:path";

/**
 * Check which files have local git changes (modified, staged, or untracked)
 * Note: Checks the entire git repository, not just the working directory
 * @param workingDir - The directory to check git status in (used to find git root)
 * @returns Set of absolute file paths that have local changes
 */
export function checkGitStatus(workingDir: string): Set<string> {
  const changedFiles = new Set<string>();

  try {
    // Get the git root directory first
    // git status --porcelain returns paths relative to git root, not cwd
    const gitRoot = execSync("git rev-parse --show-toplevel", {
      cwd: workingDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();

    // Run git status --porcelain to get list of changed files
    // --porcelain gives machine-readable output
    const output = execSync("git status --porcelain", {
      cwd: workingDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"], // Ignore stderr to avoid errors when not in git repo
    });

    // Parse the output
    // Format: "XY filename" where X is staged status, Y is unstaged status
    const lines = output.trim().split("\n");

    for (const line of lines) {
      if (!line) continue;

      // Extract filename (skip first 3 characters which are status codes and space)
      const filename = line.slice(3).trim();

      // Handle renamed files (format: "old -> new")
      const actualFilename = filename.includes(" -> ") ? filename.split(" -> ")[1] : filename;

      if (actualFilename) {
        // Git status returns paths relative to git root, not cwd
        const absolutePath = path.resolve(gitRoot, actualFilename);
        changedFiles.add(absolutePath);
      }
    }
  } catch {
    // If git command fails (e.g., not in a git repo), return empty set
    // This allows the tool to work in non-git directories
    return changedFiles;
  }

  return changedFiles;
}
