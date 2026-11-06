import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { executeCli } from "../executeCli";
import { createFixProject } from "./helpers";

let projectDir: string;
let originalDirectory: string;
let originalExitCode: typeof process.exitCode;
let log: Mock<typeof console.log>;
let error: Mock<typeof console.error>;

beforeEach(async () => {
  originalDirectory = process.cwd();
  originalExitCode = process.exitCode;
  await mkdir(path.join(import.meta.dir, "../../.tmp"), { recursive: true });
  projectDir = await mkdtemp(path.join(import.meta.dir, "../../.tmp/cli-execution-"));
  process.chdir(projectDir);
  process.exitCode = 43;
  log = spyOn(console, "log").mockImplementation(() => {});
  error = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  log.mockRestore();
  error.mockRestore();
  process.exitCode = originalExitCode ?? 0;
  process.chdir(originalDirectory);
  await rm(projectDir, { recursive: true, force: true });
});

describe("callable CLI parsing", () => {
  test.each([
    { args: [], status: 1 },
    { args: ["--help"], status: 0 },
    { args: ["check", "--help"], status: 0 },
    { args: ["fix", "--config=", "--help"], status: 0 },
  ])("returns usage without loading a project or changing the host status: $args", async ({ args, status }) => {
    const config = 'throw new Error("configuration must not run");\n';
    await Bun.write("unused.config.ts", config);
    const standalone = Bun.spawnSync([process.execPath, path.join(import.meta.dir, "../cli.ts"), "--", ...args], {
      cwd: projectDir,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    });

    expect(await executeCli(args)).toBe(status);
    expect(standalone.exitCode).toBe(status);
    expect(standalone.stderr.toString()).toBe("");
    expect(log.mock.calls.map(([message]) => `${message}\n`).join("")).toBe(standalone.stdout.toString());
    expect(error.mock.calls).toEqual([]);
    expect(process.exitCode).toBe(43);
    expect(await Bun.file("unused.config.ts").text()).toBe(config);
  });

  test.each([
    { args: ["fix", "--unknown"], diagnostic: "Unknown argument: unknown" },
    { args: ["check", "--config="], diagnostic: "--config requires a nonempty path" },
    {
      args: ["check", "--", "project"],
      diagnostic: "Operands after -- are not supported; use ./ before paths beginning with -",
    },
  ])("returns parser failures without terminating its host: $args", async ({ args, diagnostic }) => {
    expect(await executeCli(args)).toBe(1);
    expect(log.mock.calls).toEqual([]);
    expect(error.mock.calls).toEqual([[`${diagnostic}\n\nRun ts-unused --help for usage.`]]);
    expect(process.exitCode).toBe(43);
  });

  test.each(["check", "fix"])("waits for %s errors and preserves their diagnostic", async (command) => {
    await createFixProject(projectDir, {
      "model.ts": "export const keep = 1;\n",
      "unused.config.ts": 'throw new Error("configuration failed");\n',
    });
    expect(await executeCli([command, "."])).toBe(1);
    expect(log.mock.calls).toEqual([]);
    expect(error.mock.calls).toEqual([
      [
        `Failed to load config from ${path.join(projectDir, "unused.config.ts")}: configuration failed\n\nRun ts-unused --help for usage.`,
      ],
    ]);
    expect(await Bun.file("model.ts").text()).toBe("export const keep = 1;\n");
    expect(process.exitCode).toBe(43);
  });

  test("awaits a real fix and starts the next invocation with a fresh parser and status", async () => {
    await createFixProject(projectDir, { "unused.ts": "export const unused = 1;\n" });
    expect(await executeCli(["--unknown"])).toBe(1);
    error.mockClear();
    expect(await executeCli(["fix", "."])).toBe(0);
    expect(await Bun.file("unused.ts").exists()).toBe(false);
    expect(log.mock.calls).toEqual([
      [`Fixing TypeScript project: ${path.join(projectDir, "tsconfig.json")}`],
      [""],
      ["Deleting: unused.ts (all exports unused)"],
      [""],
      ["Summary:"],
      ["  Fixed exports: 0"],
      ["  Fixed properties: 0"],
      ["  Deleted files: 1"],
      ["  Skipped files: 0"],
    ]);
    expect(error.mock.calls).toEqual([]);
    expect(process.exitCode).toBe(43);
  });
});
