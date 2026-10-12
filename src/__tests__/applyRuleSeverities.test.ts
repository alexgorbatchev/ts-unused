import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { analyzeProject } from "../analyzeProject";
import type { IUnusedConfig, RuleName, RuleSeverity } from "../config";
import { fixProject } from "../fixProject";
import { formatResults } from "../formatResults";
import { COMMENT_KIND, RULE_NAME, RULE_SEVERITY, SEVERITY } from "../index";
import type { CommentKind } from "../types";
import { createFixProject } from "./helpers";

let projectDir: string;
beforeEach(async () => {
  await mkdir(path.join(process.cwd(), ".tmp"), { recursive: true });
  projectDir = await mkdtemp(path.join(process.cwd(), ".tmp/rules-"));
});
afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

interface IRuleCase {
  rule: Exclude<RuleName, typeof RULE_NAME.TODO_COMMENTS | typeof RULE_NAME.IGNORE_COMMENTS>;
  source: string;
}
const cases: IRuleCase[] = [
  { rule: RULE_NAME.UNUSED_EXPORTS, source: "export const unused = 1; export const used = 2; console.log(used);\n" },
  {
    rule: RULE_NAME.UNUSED_PROPERTIES,
    source:
      "interface Options { used: string; unused: number; }\nfunction read(value: Options) { return value.used; }\n",
  },
  { rule: RULE_NAME.UNUSED_FILES, source: "export const unused = 1;\n" },
  {
    rule: RULE_NAME.NEVER_RETURNED_TYPES,
    source: "export function result(): string | number { return 'x'; } console.log(result());\n",
  },
  { rule: RULE_NAME.DUPLICATE_TYPES, source: "type First = string; type Second = string;\n" },
];
interface ISeverityCase {
  severity: RuleSeverity;
  exitCode: number;
  markers: string[];
  count: number;
}
const levels: ISeverityCase[] = [
  { severity: SEVERITY.ERROR, exitCode: 1, markers: ["ERROR"], count: 1 },
  { severity: SEVERITY.WARNING, exitCode: 0, markers: ["WARNING"], count: 1 },
  { severity: SEVERITY.INFO, exitCode: 0, markers: ["INFO"], count: 1 },
  { severity: RULE_SEVERITY.OFF, exitCode: 0, markers: [], count: 0 },
];
const disabledRules: Required<NonNullable<IUnusedConfig["rules"]>> = {
  unusedExports: RULE_SEVERITY.OFF,
  unusedProperties: RULE_SEVERITY.OFF,
  unusedFiles: RULE_SEVERITY.OFF,
  neverReturnedTypes: RULE_SEVERITY.OFF,
  duplicateTypes: RULE_SEVERITY.OFF,
  todoComments: RULE_SEVERITY.OFF,
  ignoreComments: RULE_SEVERITY.OFF,
};

describe.each(cases)("$rule severity", ({ rule, source }) => {
  test.each(levels)(
    "$severity controls analysis, output, and CLI exit",
    async ({ severity, exitCode, markers, count }) => {
      const tsconfig = await createFixProject(projectDir, { "source.ts": source });
      const config: IUnusedConfig = { rules: { ...disabledRules, [rule]: severity } };
      await Bun.write(path.join(projectDir, "unused.config.ts"), `export default ${JSON.stringify(config)};\n`);
      const results = await analyzeProject(tsconfig, undefined, undefined, { config });
      expect(results[rule]?.length).toBe(count);
      const output = formatResults(results, projectDir);
      expect(Array.from(output.matchAll(/\[(ERROR|WARNING|INFO)\]/g), (match) => match[1])).toEqual(markers);
      const processResult = Bun.spawnSync(["bun", "run", path.join(process.cwd(), "src/cli.ts"), "check", tsconfig], {
        env: { ...process.env, AGENT: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(processResult.stderr.toString()).toBe("");
      expect(processResult.exitCode).toBe(exitCode);
      expect(
        Array.from(processResult.stdout.toString().matchAll(/\[(ERROR|WARNING|INFO)\]/g), (match) => match[1]),
      ).toEqual(markers);
    },
  );

  test.each(levels.filter((level) => level.severity !== SEVERITY.ERROR))(
    "$severity findings are preserved by fix",
    async ({ severity }) => {
      const tsconfig = await createFixProject(projectDir, { "source.ts": source });
      const config: IUnusedConfig = { rules: { ...disabledRules, [rule]: severity } };
      const result = await fixProject(tsconfig, undefined, { config });
      expect(result).toEqual({
        fixedExports: 0,
        fixedProperties: 0,
        fixedNeverReturnedTypes: 0,
        deletedFiles: 0,
        skippedFiles: [],
        errors: [],
      });
      expect(await Bun.file(path.join(projectDir, "source.ts")).text()).toBe(source);
    },
  );
});

test("unused severity leaves TODO severity independent and still controls test-only findings", async () => {
  const source = "// TODO implement later\nexport function planned() {}\nexport const helper = 2;\n";
  const tsconfig = await createFixProject(projectDir, {
    "source.ts": source,
    "source.test.ts": "import { helper } from './source'; console.log(helper);\n",
  });
  const config: IUnusedConfig = { rules: { unusedExports: SEVERITY.ERROR, unusedFiles: RULE_SEVERITY.OFF } };
  const results = await analyzeProject(tsconfig, undefined, undefined, { config });
  expect(results.unusedExports.map((item) => [item.exportName, item.severity])).toEqual([
    ["planned", SEVERITY.WARNING],
    ["helper", SEVERITY.ERROR],
  ]);
  const fixes = await fixProject(tsconfig, undefined, { config });
  expect(fixes.fixedExports).toBe(0);
  expect(await Bun.file(path.join(projectDir, "source.ts")).text()).toBe(source);
});

test("a warning file does not suppress error exports or prevent fixing them", async () => {
  const tsconfig = await createFixProject(projectDir, { "source.ts": "export const unused = 1;\n" });
  const config: IUnusedConfig = {
    rules: { ...disabledRules, unusedFiles: SEVERITY.WARNING, unusedExports: SEVERITY.ERROR },
  };
  const results = await analyzeProject(tsconfig, undefined, undefined, { config });
  expect(
    Array.from(formatResults(results, projectDir).matchAll(/\[(ERROR|WARNING|INFO)\]/g), (match) => match[1]),
  ).toEqual(["WARNING", "ERROR"]);
  const fixes = await fixProject(tsconfig, undefined, { config });
  expect(fixes.deletedFiles).toBe(0);
  expect(fixes.fixedExports).toBe(1);
  expect(await Bun.file(path.join(projectDir, "source.ts")).exists()).toBe(true);
});

test("partial settings retain default severities and safety of TODO files", async () => {
  const tsconfig = await createFixProject(projectDir, {
    "planned.ts": "// TODO implement later\nexport function planned() {}\n",
    "types.ts": "type First = string; type Second = string;\n",
  });
  const results = await analyzeProject(tsconfig, undefined, undefined, {
    config: { rules: { duplicateTypes: SEVERITY.ERROR } },
  });
  expect(results.unusedExports.map((item) => item.severity)).toEqual([SEVERITY.WARNING]);
  expect(results.duplicateTypes?.map((item) => item.severity)).toEqual([SEVERITY.ERROR]);
  expect(results.unusedFiles).toEqual([]);
});

test("promoted TODO, ignore, and test-only properties remain safe to fix", async () => {
  const source =
    "export interface Options {\n// TODO implement later\nplanned: string;\n// @ts-unused-ignore dynamic access\ndynamic: string;\ntestOnly: string;\n}\n";
  const tsconfig = await createFixProject(projectDir, {
    "source.ts": source,
    "source.test.ts":
      "import type { Options } from './source'; function read(value: Options) { return value.testOnly; }\n",
  });
  const config: IUnusedConfig = {
    rules: {
      ...disabledRules,
      unusedProperties: SEVERITY.ERROR,
      todoComments: SEVERITY.ERROR,
      ignoreComments: SEVERITY.ERROR,
    },
  };
  const results = await analyzeProject(tsconfig, undefined, undefined, { config });
  expect(results.unusedProperties.map((item) => [item.propertyName, item.severity])).toEqual([
    ["planned", SEVERITY.ERROR],
    ["dynamic", SEVERITY.ERROR],
    ["testOnly", SEVERITY.ERROR],
  ]);
  const fixes = await fixProject(tsconfig, undefined, { config });
  expect(fixes.fixedProperties).toBe(0);
  expect(await Bun.file(path.join(projectDir, "source.ts")).text()).toBe(source);
});

test("a warning parent export does not hide error properties", async () => {
  const tsconfig = await createFixProject(projectDir, {
    "source.ts": "export interface Options { unused: string; }\n",
  });
  const config: IUnusedConfig = {
    rules: { ...disabledRules, unusedExports: SEVERITY.WARNING, unusedProperties: SEVERITY.ERROR },
  };
  const results = await analyzeProject(tsconfig, undefined, undefined, { config });
  expect(
    Array.from(formatResults(results, projectDir).matchAll(/\[(ERROR|WARNING|INFO)\]/g), (match) => match[1]),
  ).toEqual(["WARNING", "ERROR"]);
  const fixes = await fixProject(tsconfig, undefined, { config });
  expect(fixes.fixedExports).toBe(0);
  expect(fixes.fixedProperties).toBe(1);
});

test("duplicate types remain report-only when configured as errors", async () => {
  const source = "type First = string; type Second = string;\n";
  const tsconfig = await createFixProject(projectDir, { "source.ts": source });
  const fixes = await fixProject(tsconfig, undefined, { config: { rules: { duplicateTypes: SEVERITY.ERROR } } });
  expect(fixes.errors).toEqual([]);
  expect(await Bun.file(path.join(projectDir, "source.ts")).text()).toBe(source);
});

test("invalid rule severity aborts analysis", async () => {
  const tsconfig = await createFixProject(projectDir, { "source.ts": "export const unused = 1;\n" });
  await Bun.write(path.join(projectDir, "unused.config.ts"), 'export default { rules: { unusedExports: "warn" } };\n');
  const result = Bun.spawnSync(["bun", "run", path.join(process.cwd(), "src/cli.ts"), "check", tsconfig], {
    env: { ...process.env, AGENT: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).toBe(1);
  expect(result.stdout.toString()).toBe("");
  expect(
    result.stderr
      .toString()
      .split("\n")
      .filter((line) => line.startsWith("error:")),
  ).toEqual([
    `error: Failed to load config from ${path.join(projectDir, "unused.config.ts")}: Invalid severity for rule 'unusedExports': warn. Expected off, info, warning, or error.`,
  ]);
});

interface ICommentCase {
  rule: typeof RULE_NAME.TODO_COMMENTS | typeof RULE_NAME.IGNORE_COMMENTS;
  kind: CommentKind;
  declaration: string;
  source: string;
}
const commentCases: ICommentCase[] = [
  {
    rule: RULE_NAME.TODO_COMMENTS,
    kind: COMMENT_KIND.TODO,
    declaration: "export",
    source: "// TODO implement later\nexport function planned() {}\n",
  },
  {
    rule: RULE_NAME.IGNORE_COMMENTS,
    kind: COMMENT_KIND.IGNORE,
    declaration: "export",
    source: "// @ts-unused-ignore dynamic use\nexport function dynamic() {}\n",
  },
  {
    rule: RULE_NAME.TODO_COMMENTS,
    kind: COMMENT_KIND.TODO,
    declaration: "interface",
    source: "interface Options {\n// TODO implement later\nplanned: string;\n}\n",
  },
  {
    rule: RULE_NAME.IGNORE_COMMENTS,
    kind: COMMENT_KIND.IGNORE,
    declaration: "interface",
    source: "interface Options {\n// @ts-unused-ignore dynamic use\ndynamic: string;\n}\n",
  },
  {
    rule: RULE_NAME.TODO_COMMENTS,
    kind: COMMENT_KIND.TODO,
    declaration: "alias",
    source: "type Options = {\n// TODO implement later\nplanned: string;\n};\n",
  },
  {
    rule: RULE_NAME.IGNORE_COMMENTS,
    kind: COMMENT_KIND.IGNORE,
    declaration: "alias",
    source: "type Options = {\n// @ts-unused-ignore dynamic use\ndynamic: string;\n};\n",
  },
];

describe.each(commentCases)("$rule on $declaration", ({ rule, source, kind }) => {
  test.each(levels)("$severity operates with unused rules off", async ({ severity, markers, count, exitCode }) => {
    const tsconfig = await createFixProject(projectDir, { "source.ts": source });
    const config: IUnusedConfig = { rules: { ...disabledRules, [rule]: severity } };
    const results = await analyzeProject(tsconfig, undefined, undefined, { config });
    expect([...results.unusedExports, ...results.unusedProperties].length).toBe(count);
    expect([...results.unusedExports, ...results.unusedProperties].map((item) => item.commentKind)).toEqual(
      Array(count).fill(kind),
    );
    expect(
      Array.from(formatResults(results, projectDir).matchAll(/\[(ERROR|WARNING|INFO)\]/g), (match) => match[1]),
    ).toEqual(markers);
    await Bun.write(path.join(projectDir, "unused.config.ts"), `export default ${JSON.stringify(config)};\n`);
    const cli = Bun.spawnSync(["bun", "run", path.join(process.cwd(), "src/cli.ts"), "check", tsconfig], {
      env: { ...process.env, AGENT: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(cli.stderr.toString()).toBe("");
    expect(cli.exitCode).toBe(exitCode);
    expect(Array.from(cli.stdout.toString().matchAll(/\[(ERROR|WARNING|INFO)\]/g), (match) => match[1])).toEqual(
      markers,
    );
    const fixes = await fixProject(tsconfig, undefined, { config });
    expect(fixes.fixedExports).toBe(0);
    expect(fixes.fixedProperties).toBe(0);
    expect(fixes.deletedFiles).toBe(0);
    expect(fixes.errors).toEqual([]);
    expect(await Bun.file(path.join(projectDir, "source.ts")).text()).toBe(source);
  });
});

test("TODO and ignore severities can differ while normal unused findings are errors", async () => {
  const tsconfig = await createFixProject(projectDir, {
    "source.ts":
      "// TODO implement later\nexport function planned() {}\n// @ts-unused-ignore dynamic use\nexport function dynamic() {}\nexport function unused() {}\n",
  });
  const results = await analyzeProject(tsconfig, undefined, undefined, {
    config: {
      rules: {
        unusedExports: SEVERITY.ERROR,
        unusedFiles: RULE_SEVERITY.OFF,
        todoComments: SEVERITY.INFO,
        ignoreComments: RULE_SEVERITY.OFF,
      },
    },
  });
  expect(results.unusedExports.map((item) => [item.exportName, item.severity])).toEqual([
    ["planned", SEVERITY.INFO],
    ["unused", SEVERITY.ERROR],
  ]);
});
