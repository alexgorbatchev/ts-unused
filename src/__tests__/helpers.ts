import { expect } from "bun:test";
import path from "node:path";

export function runGit(projectDir: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: projectDir, stderr: "pipe" });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  return result.stdout.toString();
}

export function commitFixProject(projectDir: string): void {
  runGit(projectDir, ["init", "--quiet"]);
  runGit(projectDir, ["add", "."]);
  runGit(projectDir, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
}

export async function createFixProject(projectDir: string, files: Record<string, string>): Promise<string> {
  await Bun.write(
    path.join(projectDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { target: "ES2020", module: "ESNext", moduleResolution: "bundler" },
      include: ["**/*.ts", "**/*.tsx"],
      exclude: ["*.config.ts"],
    }),
  );
  for (const [fileName, content] of Object.entries(files)) {
    await Bun.write(path.join(projectDir, fileName), content);
  }
  commitFixProject(projectDir);
  return path.join(projectDir, "tsconfig.json");
}
