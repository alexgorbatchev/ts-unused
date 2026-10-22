import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { analyzeProject } from "../analyzeProject";
import type { IUnusedConfig } from "../config";
import { fixProject } from "../fixProject";
import { formatResults } from "../formatResults";
import type { IAnalysisResults } from "../types";
import { commitFixProject } from "./helpers";

const BUTTON_SOURCE = [
  "export interface IButtonProps { label: string; storyOnlyProp?: string; }",
  "export function Button(props: IButtonProps): string { return props.label; }",
  'export function storyOnlyHelper(): string { return "story"; }',
  'export function testAndStoryHelper(): string { return "both"; }',
  'export function testOnlyHelper(): string { return "test"; }',
  'export function unusedHelper(): string { return "unused"; }',
  "",
].join("\n");

const STORY_SOURCE = [
  'import { Button, type IButtonProps, storyOnlyHelper, testAndStoryHelper } from "./button";',
  'import { storyFixture } from "./story-fixture";',
  "",
  "interface IStoryState { isOpen: boolean; }",
  "const initialState: IStoryState = { isOpen: true };",
  "",
  'const meta = { title: "Button", component: Button, excludeStories: /.*Data$/ };',
  "export default meta;",
  "",
  'export const baseArgsData = { label: "base" };',
  "export const mockData = { label: storyFixture };",
  'export const unusedData = { label: "unused" };',
  "export type StoryArgs = { title: string };",
  "",
  "export const Primary = { args: { ...baseArgsData, storyOnlyProp: storyOnlyHelper() } satisfies IButtonProps };",
  'export const Secondary = { render: () => Button({ label: initialState.isOpen ? testAndStoryHelper() : "closed" }) };',
  "",
].join("\n");

const TEST_SOURCE = [
  'import { testAndStoryHelper, testOnlyHelper } from "./button";',
  'import { mockData } from "./button.stories";',
  "console.log(testAndStoryHelper(), testOnlyHelper(), mockData.label);",
  "",
].join("\n");

let projectDir: string;
let tsConfigPath: string;

interface IStorySummary {
  unusedFiles: string[];
  unusedExports: string[];
  unusedProperties: string[];
}

function summarize(results: IAnalysisResults): IStorySummary {
  return {
    unusedFiles: results.unusedFiles.toSorted(),
    unusedExports: results.unusedExports
      .map(
        (item) =>
          `${item.filePath}:${item.exportName} ${item.severity} stories=${item.onlyUsedInStories} tests=${item.onlyUsedInTests}`,
      )
      .toSorted(),
    unusedProperties: results.unusedProperties
      .map(
        (item) =>
          `${item.filePath}:${item.typeName}.${item.propertyName} ${item.severity} stories=${item.onlyUsedInStories} tests=${item.onlyUsedInTests}`,
      )
      .toSorted(),
  };
}

async function analyze(config: IUnusedConfig = {}): Promise<IStorySummary> {
  return summarize(await analyzeProject(tsConfigPath, undefined, undefined, { config }));
}

beforeEach(async () => {
  const tempDir = path.join(import.meta.dir, "../../.tmp");
  await mkdir(tempDir, { recursive: true });
  projectDir = await mkdtemp(path.join(tempDir, "story-files-"));
  tsConfigPath = path.join(projectDir, "tsconfig.json");

  await Bun.write(
    tsConfigPath,
    JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "bundler" },
      include: ["src"],
    }),
  );
  await Bun.write(path.join(projectDir, "src/button.ts"), BUTTON_SOURCE);
  await Bun.write(path.join(projectDir, "src/story-fixture.ts"), 'export const storyFixture = "fixture";\n');
  await Bun.write(path.join(projectDir, "src/button.stories.ts"), STORY_SOURCE);
  await Bun.write(path.join(projectDir, "src/button.test.ts"), TEST_SOURCE);
  await Bun.write(
    path.join(projectDir, "src/main.ts"),
    'import { Button } from "./button";\nconsole.log(Button({ label: "main" }));\n',
  );
  commitFixProject(projectDir);
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("story files", () => {
  test("counts stories and the meta as used, analyses the rest, and reports story-only usage as info", async () => {
    expect(await analyze()).toEqual({
      unusedFiles: [],
      unusedExports: [
        "src/button.stories.ts:StoryArgs error stories=false tests=false",
        "src/button.stories.ts:mockData info stories=false tests=true",
        "src/button.stories.ts:unusedData error stories=false tests=false",
        "src/button.ts:storyOnlyHelper info stories=true tests=false",
        "src/button.ts:testAndStoryHelper info stories=true tests=false",
        "src/button.ts:testOnlyHelper info stories=false tests=true",
        "src/button.ts:unusedHelper error stories=false tests=false",
        "src/story-fixture.ts:storyFixture info stories=true tests=false",
      ],
      unusedProperties: [
        "src/button.stories.ts:StoryArgs.title error stories=false tests=false",
        "src/button.ts:IButtonProps.storyOnlyProp info stories=true tests=false",
      ],
    });
  });

  test("formats story-only findings as used only in stories", async () => {
    const results = await analyzeProject(tsConfigPath);

    expect(
      formatResults(results, projectDir)
        .split("\n")
        .filter((line) => line.includes("stories)")),
    ).toEqual([
      "  storyOnlyHelper:3:17-32 [INFO] (Used only in stories)",
      "  testAndStoryHelper:4:17-35 [INFO] (Used only in stories)",
      "  storyFixture:1:14-26 [INFO] (Used only in stories)",
      "  IButtonProps.storyOnlyProp:1:48-61 [INFO] (Used only in stories)",
    ]);
  });

  test("storyOnlyUsage sets the severity of story-only findings independently of the unused rules", async () => {
    expect(
      await analyze({ rules: { storyOnlyUsage: "error", unusedExports: "warning", unusedProperties: "off" } }),
    ).toEqual({
      unusedFiles: [],
      unusedExports: [
        "src/button.stories.ts:StoryArgs warning stories=false tests=false",
        "src/button.stories.ts:mockData warning stories=false tests=true",
        "src/button.stories.ts:unusedData warning stories=false tests=false",
        "src/button.ts:storyOnlyHelper error stories=true tests=false",
        "src/button.ts:testAndStoryHelper error stories=true tests=false",
        "src/button.ts:testOnlyHelper warning stories=false tests=true",
        "src/button.ts:unusedHelper warning stories=false tests=false",
        "src/story-fixture.ts:storyFixture error stories=true tests=false",
      ],
      unusedProperties: ["src/button.ts:IButtonProps.storyOnlyProp error stories=true tests=false"],
    });

    const silenced = await analyze({ rules: { storyOnlyUsage: "off" } });
    expect(silenced.unusedExports.filter((finding) => finding.includes("stories=true"))).toEqual([]);
    expect(silenced.unusedProperties.filter((finding) => finding.includes("stories=true"))).toEqual([]);
  });

  test("an empty storyFilePatterns turns story handling off", async () => {
    expect(await analyze({ storyFilePatterns: [] })).toEqual({
      unusedFiles: [],
      unusedExports: [
        "src/button.stories.ts:Primary error stories=false tests=false",
        "src/button.stories.ts:Secondary error stories=false tests=false",
        "src/button.stories.ts:StoryArgs error stories=false tests=false",
        "src/button.stories.ts:mockData info stories=false tests=true",
        "src/button.stories.ts:unusedData error stories=false tests=false",
        "src/button.ts:testOnlyHelper info stories=false tests=true",
        "src/button.ts:unusedHelper error stories=false tests=false",
      ],
      unusedProperties: ["src/button.stories.ts:StoryArgs.title error stories=false tests=false"],
    });
  });

  test("storyFilePatterns match the path relative to the tsconfig directory", async () => {
    const summary = await analyze({ storyFilePatterns: ["src/*.stories.ts"] });

    expect(summary.unusedExports.filter((finding) => finding.includes(":Primary "))).toEqual([]);
    expect(await analyze({ storyFilePatterns: [`${path.basename(projectDir)}/src/*.stories.ts`] })).toEqual(
      await analyze({ storyFilePatterns: [] }),
    );
  });

  test("test-file rules apply to a file that matches both test and story patterns", async () => {
    expect(await analyze({ testFilePatterns: ["**/*.test.ts", "**/*.stories.ts"] })).toEqual({
      unusedFiles: [],
      unusedExports: [
        "src/button.ts:storyOnlyHelper info stories=false tests=true",
        "src/button.ts:testAndStoryHelper info stories=false tests=true",
        "src/button.ts:testOnlyHelper info stories=false tests=true",
        "src/button.ts:unusedHelper error stories=false tests=false",
        "src/story-fixture.ts:storyFixture info stories=false tests=true",
      ],
      unusedProperties: ["src/button.ts:IButtonProps.storyOnlyProp info stories=false tests=true"],
    });
  });

  test("ignored story files produce no findings and their references still count as story usage", async () => {
    expect(await analyze({ ignoreFilePatterns: ["**/*.stories.ts"] })).toEqual({
      unusedFiles: [],
      unusedExports: [
        "src/button.ts:storyOnlyHelper info stories=true tests=false",
        "src/button.ts:testAndStoryHelper info stories=true tests=false",
        "src/button.ts:testOnlyHelper info stories=false tests=true",
        "src/button.ts:unusedHelper error stories=false tests=false",
        "src/story-fixture.ts:storyFixture info stories=true tests=false",
      ],
      unusedProperties: ["src/button.ts:IButtonProps.storyOnlyProp info stories=true tests=false"],
    });
  });

  test("fix keeps the meta, stories, and story-only code and removes other unused code in story files", async () => {
    const results = await fixProject(tsConfigPath);

    expect(results).toEqual({
      fixedExports: 3,
      fixedProperties: 0,
      fixedNeverReturnedTypes: 0,
      deletedFiles: 0,
      skippedFiles: [],
      errors: [],
    });
    expect(await Bun.file(path.join(projectDir, "src/button.stories.ts")).text()).toBe(
      STORY_SOURCE.replace(
        'export const unusedData = { label: "unused" };\nexport type StoryArgs = { title: string };\n\n',
        "",
      ),
    );
    expect(await Bun.file(path.join(projectDir, "src/button.ts")).text()).toBe(
      BUTTON_SOURCE.replace('export function unusedHelper(): string { return "unused"; }\n', ""),
    );
    expect(await Bun.file(path.join(projectDir, "src/story-fixture.ts")).exists()).toBe(true);
  });

  test("fix keeps story-only code even when storyOnlyUsage is an error", async () => {
    const results = await fixProject(tsConfigPath, undefined, {
      config: { rules: { storyOnlyUsage: "error", unusedExports: "off", unusedProperties: "off", unusedFiles: "off" } },
    });

    expect(results.fixedExports).toBe(0);
    expect(results.fixedProperties).toBe(0);
    expect(await Bun.file(path.join(projectDir, "src/button.ts")).text()).toBe(BUTTON_SOURCE);
    expect(await Bun.file(path.join(projectDir, "src/story-fixture.ts")).text()).toBe(
      'export const storyFixture = "fixture";\n',
    );
  });
});
