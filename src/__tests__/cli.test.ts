import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { createFixProject } from "./helpers";

const cliPath = path.join(import.meta.dir, "../cli.ts");
let projectDir: string;

beforeEach(async () => {
  const tempDir = path.join(import.meta.dir, "../../.tmp");
  await mkdir(tempDir, { recursive: true });
  projectDir = await mkdtemp(path.join(tempDir, "cli-validation-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

function runCli(args: readonly string[]) {
  return Bun.spawnSync([process.execPath, cliPath, "--", ...args], {
    cwd: projectDir,
    env: { ...process.env, AGENT: "1", LC_ALL: "C", LANG: "C" },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
  });
}

async function snapshotProject() {
  const files = [...new Bun.Glob("**/*").scanSync({ cwd: projectDir, dot: true, onlyFiles: true })].sort();
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file,
        new Bun.CryptoHasher("sha256").update(await Bun.file(path.join(projectDir, file)).bytes()).digest("hex"),
      ]),
    ),
  );
}

function expectRootHelp(output: string) {
  expect(output).toMatchInlineSnapshot(`
    "Usage: ts-unused [command] [project] [file] [options]

    Commands:
      ts-unused check [project] [file]  Report unused code without modifying files
                                                                           [default]
      ts-unused fix [project]           Remove unused code and delete unused files;
                                        respects Git safety checks

    Positionals:
      project  tsconfig.json or project directory (default: current directory)
                                                                            [string]
      file     Limit check results to this file                             [string]

    Options:
      -c, --config  Configuration file (default: unused.config.ts in project
                    directory)                                              [string]
      -h, --help    Show help                                              [boolean]

    Examples:
      ts-unused check tsconfig.json             Check an explicit project
      ts-unused ./project-dir                   Check a directory containing
                                                tsconfig.json
      ts-unused check tsconfig.json             Report findings only for one file
      src/file.ts
      ts-unused fix tsconfig.json               Remove unused code
      ts-unused check tsconfig.json --config    Use custom configuration
      ./custom.config.ts
    "
  `);
}

function expectCheckHelp(output: string) {
  expect(output).toMatchInlineSnapshot(`
    "ts-unused check [project] [file]

    Report unused code without modifying files

    Positionals:
      project  tsconfig.json or project directory (default: current directory)
                                                                            [string]
      file     Limit check results to this file                             [string]

    Options:
      -c, --config  Configuration file (default: unused.config.ts in project
                    directory)                                              [string]
      -h, --help    Show help                                              [boolean]
    "
  `);
}

function expectFixHelp(output: string) {
  expect(output).toMatchInlineSnapshot(`
    "ts-unused fix [project]

    Remove unused code and delete unused files; respects Git safety checks

    Positionals:
      project  tsconfig.json or project directory (default: current directory)
                                                                            [string]

    Options:
      -c, --config  Configuration file (default: unused.config.ts in project
                    directory)                                              [string]
      -h, --help    Show help                                              [boolean]
    "
  `);
}

test("bootstrap awaits a real check, sets its exit status and preserves the project", async () => {
  await createFixProject(projectDir, { "entry.ts": 'console.log("entry");\n' });
  const before = await snapshotProject();
  const originalArguments = process.argv;
  const originalExitCode = process.exitCode;
  const originalEnvironment = { ...process.env };
  const log = spyOn(console, "log").mockImplementation(() => {});
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    process.argv = [process.execPath, cliPath, "check", projectDir];
    process.env.AGENT = "1";
    process.exitCode = 43;
    await import("../cli");

    expect(process.exitCode).toBe(0);
    expect(log.mock.calls).toEqual([
      [`Analyzing TypeScript project: ${path.join(projectDir, "tsconfig.json")}`],
      [""],
      ["No unused exports or properties found!"],
    ]);
    expect(error.mock.calls).toEqual([]);
    expect(await snapshotProject()).toEqual(before);
  } finally {
    log.mockRestore();
    error.mockRestore();
    process.argv = originalArguments;
    process.exitCode = originalExitCode ?? 0;
    process.env = originalEnvironment;
  }
});

describe("CLI validation before project access", () => {
  test.each([
    { args: ["fix", "tsconfig.json", "--help"], assertHelp: expectFixHelp },
    { args: ["fix", "tsconfig.json", "-h"], assertHelp: expectFixHelp },
    { args: ["fix", "--config", "--help"], assertHelp: expectFixHelp },
    { args: ["check", "--config", "--help"], assertHelp: expectCheckHelp },
    { args: ["--config", "--help"], assertHelp: expectRootHelp },
    { args: ["fix", "--config=", "--help"], assertHelp: expectFixHelp },
    { args: ["--config=", "--help"], assertHelp: expectRootHelp },
    { args: ["fix", "tsconfig.json", "--config", "unused.config.ts", "--help"], assertHelp: expectFixHelp },
    { args: ["fix", "tsconfig.json", "--unknown", "--help"], assertHelp: expectFixHelp },
    { args: ["--help"], assertHelp: expectRootHelp },
    { args: ["-h"], assertHelp: expectRootHelp },
    { args: ["check", "--help"], assertHelp: expectCheckHelp },
    { args: ["check", "tsconfig.json", "-h"], assertHelp: expectCheckHelp },
    { args: ["--help", "fix", "missing.json", "--config", "missing.config.ts"], assertHelp: expectFixHelp },
    { args: ["fix", "missing.json", "--config", "missing.config.ts", "--help"], assertHelp: expectFixHelp },
  ])("prints help without executing configuration or modifying files: $args", async ({ args, assertHelp }) => {
    await createFixProject(projectDir, {
      "unused.ts": "export const unused = 1;\n",
      "unused.config.ts":
        'import { writeFileSync } from "node:fs";\nwriteFileSync("config-executed", "yes");\nexport default {};\n',
    });
    const before = await snapshotProject();
    const result = runCli(args);
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    assertHelp(result.stdout.toString());
    expect(await snapshotProject()).toEqual(before);
  });

  test.each([
    { args: ["--help"], assertHelp: expectRootHelp },
    { args: ["-h"], assertHelp: expectRootHelp },
    { args: ["check", "--help"], assertHelp: expectCheckHelp },
    { args: ["check", "-h"], assertHelp: expectCheckHelp },
    { args: ["fix", "--help"], assertHelp: expectFixHelp },
    { args: ["fix", "-h"], assertHelp: expectFixHelp },
  ])("prints help without a project: $args", ({ args, assertHelp }) => {
    const result = runCli(args);
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    assertHelp(result.stdout.toString());
  });

  test.each([
    { args: ["fix", "tsconfig.json", "--unknown"], diagnostic: "Unknown argument: unknown" },
    { args: ["fix", "tsconfig.json", "-z"], diagnostic: "Unknown argument: z" },
    { args: ["fix", "--config"], diagnostic: "Not enough arguments following: config" },
    { args: ["fix", "-c"], diagnostic: "Not enough arguments following: c" },
    { args: ["fix", "--config="], diagnostic: "--config requires a nonempty path" },
    { args: ["fix", "--no-config"], diagnostic: "Unknown argument: no-config" },
    { args: ["fix", "tsconfig.json", "unused.ts"], diagnostic: "Unknown argument: unused.ts" },
    { args: ["check", "tsconfig.json", "unused.ts", "extra.ts"], diagnostic: "Unknown argument: extra.ts" },
    { args: ["tsconfig.json", "unused.ts", "extra.ts"], diagnostic: "Unknown argument: extra.ts" },
    {
      args: ["fix", "--", "--help"],
      diagnostic: "Operands after -- are not supported; use ./ before paths beginning with -",
    },
    {
      args: ["fix", "tsconfig.json", "--", "extra.ts"],
      diagnostic: "Operands after -- are not supported; use ./ before paths beginning with -",
    },
    {
      args: ["--", "tsconfig.json"],
      diagnostic: "Operands after -- are not supported; use ./ before paths beginning with -",
    },
  ])("rejects invalid arguments before executing configuration: $args", async ({ args, diagnostic }) => {
    await createFixProject(projectDir, {
      "unused.ts": "export const unused = 1;\n",
      "unused.config.ts":
        'import { writeFileSync } from "node:fs";\nwriteFileSync("config-executed", "yes");\nexport default {};\n',
    });
    const before = await snapshotProject();
    const result = runCli(args);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toBe(`${diagnostic}\n\nRun ts-unused --help for usage.\n`);
    expect(await snapshotProject()).toEqual(before);
  });

  test("bare invocation displays usage without loading the default configuration", async () => {
    await Bun.write(path.join(projectDir, "unused.config.ts"), 'throw new Error("configuration executed");\n');
    const before = await snapshotProject();
    const result = runCli([]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toBe("");
    expectRootHelp(result.stdout.toString());
    expect(await snapshotProject()).toEqual(before);
  });
});

describe("CLI commands and paths", () => {
  test.each(["check", "fix"])("%s preserves the error context of an existing config", async (command) => {
    await createFixProject(projectDir, {
      "unused.ts": "export const unused = 1;\n",
      "unused.config.ts": 'throw new Error("config evaluation failed");\nexport default {};\n',
    });
    const before = await snapshotProject();
    const result = runCli([command, "--config", "unused.config.ts"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toBe(
      `Failed to load config from ${path.join(projectDir, "unused.config.ts")}: config evaluation failed\n\nRun ts-unused --help for usage.\n`,
    );
    expect(await snapshotProject()).toEqual(before);
  });

  test.each(["check", "fix"])(
    "rejects a missing explicit config before %s without falling back to the default file",
    async (command) => {
      const nestedDir = path.join(projectDir, "project");
      await createFixProject(nestedDir, {
        "unused.ts": "export const unused = 1;\n",
        "unused.config.ts":
          'import { writeFileSync } from "node:fs";\nwriteFileSync("config-executed", "yes");\nexport default {};\n',
      });
      const before = await snapshotProject();
      const result = runCli([command, "project", "--config", "missing #100%.config.ts"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout.toString()).toBe("");
      expect(result.stderr.toString()).toBe(
        `Configuration file not found: ${path.join(projectDir, "missing #100%.config.ts")}\n\nRun ts-unused --help for usage.\n`,
      );
      expect(await snapshotProject()).toEqual(before);
    },
  );

  test("requires the default filename when it is explicitly requested", async () => {
    await createFixProject(projectDir, { "unused.ts": "export const unused = 1;\n" });
    const before = await snapshotProject();
    const result = runCli(["fix", "--config", "unused.config.ts"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toBe(
      `Configuration file not found: ${path.join(projectDir, "unused.config.ts")}\n\nRun ts-unused --help for usage.\n`,
    );
    expect(await snapshotProject()).toEqual(before);
  });

  test.each(
    [["tsconfig.json"], ["check", "tsconfig.json"], ["check", "."], ["."], ["check"]].map((args) => ({ args })),
  )("checks a project without modifying files: $args", async ({ args }) => {
    await createFixProject(projectDir, { "unused.ts": "export const unused = 1;\n" });
    const before = await snapshotProject();
    const result = runCli(args);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toBe("");
    expect(result.stdout.toString()).toBe(
      `Analyzing TypeScript project: ${path.join(projectDir, "tsconfig.json")}\n\n` +
        "Completely Unused Files:\n\nunused.ts\n  file:1:1-1 [ERROR] (All exports unused - file can be deleted)\n\n" +
        "Summary:\n  Completely unused files: 1\n  Unused exports: 0\n  Unused properties: 0\n  Never-returned types: 0\n",
    );
    expect(await snapshotProject()).toEqual(before);
  });

  test.each([["fix", "tsconfig.json"], ["fix", "."], ["fix"]].map((args) => ({ args })))(
    "fixes the selected project: $args",
    async ({ args }) => {
      await createFixProject(projectDir, { "unused.ts": "export const unused = 1;\n" });
      const result = runCli(args);
      expect(result.exitCode).toBe(0);
      expect(result.stderr.toString()).toBe("");
      expect(await Bun.file(path.join(projectDir, "unused.ts")).exists()).toBe(false);
    },
  );

  test.each(["project #100% with spaces", "123", "--help"])(
    "resolves literal project directory %s",
    async (directory) => {
      const nestedDir = path.join(projectDir, directory);
      await createFixProject(nestedDir, { "unused.ts": "export const unused = 1;\n" });
      const result = runCli(["fix", `./${directory}`]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr.toString()).toBe("");
      expect(await Bun.file(path.join(nestedDir, "unused.ts")).exists()).toBe(false);
    },
  );

  test.each(
    [
      ["check", "tsconfig.json", "--config", "custom.config.ts"],
      ["--config", "custom.config.ts", "check", "tsconfig.json"],
      ["check", "--config", "custom.config.ts", "tsconfig.json"],
      ["tsconfig.json", "-c", "custom.config.ts"],
      ["--config=custom.config.ts"],
      ["-c", "custom.config.ts"],
      ["check", "tsconfig.json", "--config", "bad.config.ts", "-c", "custom.config.ts"],
    ].map((args) => ({ args })),
  )("applies configuration to analysis: $args", async ({ args }) => {
    await createFixProject(projectDir, {
      "model.ts": "export const keep = 1;\n",
      "custom.config.ts": 'export default { ignoreExports: ["keep"] };\n',
      "bad.config.ts": 'throw new Error("wrong configuration loaded");\n',
    });
    const initial = runCli(["check", "tsconfig.json"]);
    expect(initial.exitCode).toBe(1);
    expect(initial.stderr.toString()).toBe("");
    const before = await snapshotProject();
    const configured = runCli(args);
    expect(configured.exitCode).toBe(0);
    expect(configured.stderr.toString()).toBe("");
    expect(await snapshotProject()).toEqual(before);
  });

  test("uses a literal --help configuration filename without printing help", async () => {
    await createFixProject(projectDir, {
      "model.ts": "export const keep = 1;\nexport const remove = 2;\n",
      "--help": 'module.exports = { ignoreExports: ["keep"] };\n',
    });
    const result = runCli(["fix", "tsconfig.json", "--config=--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    expect(await Bun.file(path.join(projectDir, "model.ts")).text()).toBe("export const keep = 1;\n");
  });

  test("resolves explicit configuration relative to the working directory", async () => {
    const nestedDir = path.join(projectDir, "project");
    await createFixProject(nestedDir, { "model.ts": "export const keep = 1;\nexport const remove = 2;\n" });
    await Bun.write(path.join(projectDir, "custom #100%.config.ts"), 'export default { ignoreExports: ["keep"] };\n');
    const result = runCli(["fix", "project", "--config", "custom #100%.config.ts"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    expect(await Bun.file(path.join(nestedDir, "model.ts")).text()).toBe("export const keep = 1;\n");
  });

  test("limits findings to the target file without modifying sources", async () => {
    await createFixProject(projectDir, {
      "unused.ts": "export const unused = 1;\n",
      "entry #100%.ts": 'console.log("entry");\n',
    });
    const before = await snapshotProject();
    const complete = runCli(["check", "tsconfig.json"]);
    expect(complete.exitCode).toBe(1);
    expect(complete.stderr.toString()).toBe("");
    const targeted = runCli(["check", "tsconfig.json", "entry #100%.ts"]);
    expect(targeted.exitCode).toBe(0);
    expect(targeted.stderr.toString()).toBe("");
    expect(await snapshotProject()).toEqual(before);
  });

  test.each(["run", "run-ai"])("forwards help through just %s", (recipe) => {
    const result = Bun.spawnSync(["just", recipe, "--help"], {
      cwd: path.join(import.meta.dir, "../.."),
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    });
    expect(result.exitCode).toBe(0);
    expectRootHelp(result.stdout.toString());
    expect(result.stderr.toString()).toBe(
      { run: 'bun src/cli.ts "$@"\n', "run-ai": 'AGENT=1 bun src/cli.ts "$@"\n' }[recipe],
    );
  });
});
