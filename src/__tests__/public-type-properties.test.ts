import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { analyzeProject } from "../analyzeProject";
import { createFixProject } from "./helpers";

let projectDir: string;

beforeEach(async () => {
  const tempDir = path.join(import.meta.dir, "../../.tmp");
  await mkdir(tempDir, { recursive: true });
  projectDir = await mkdtemp(path.join(tempDir, "public-type-properties-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

async function findUnusedProperties(tsConfigPath: string, packageMode: boolean): Promise<string[]> {
  const results = await analyzeProject(tsConfigPath, undefined, undefined, { config: { packageMode } });
  return results.unusedProperties.map((item) => `${item.typeName}.${item.propertyName}`).toSorted();
}

const LIBRARY_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "fixture", type: "module", main: "./src/index.ts" }),
  "src/index.ts": 'export * from "./barrel";\nexport { createWidget, Widget, settings, load } from "./widget";\n',
  "src/barrel.ts": 'export * from "./props";\n',
  "src/props.ts": [
    "export interface Props { 'aria-label'?: string; unusedPublic?: number; }",
    "export type AliasProps = { unusedAlias?: string };",
    "interface Hidden { unusedHidden?: string; }",
    "export function readHidden(hidden: Hidden): Hidden { return hidden; }",
    "",
  ].join("\n"),
  "src/widget.ts": [
    'import { type Internal } from "./internal";',
    "interface Options { unusedOption?: boolean; nested?: Nested; }",
    "interface Nested { unusedNested?: string; }",
    "interface Result { unusedResult?: string; }",
    "interface BodyOnly { unusedBodyOnly?: string; }",
    "interface Config { unusedConfig?: string; }",
    "interface Secret { unusedSecret?: string; }",
    "interface Theme { unusedTheme?: string; }",
    "interface Loaded { unusedLoaded?: string; }",
    "function makeResult(): Result { return {}; }",
    "export function createWidget(options: Options) {",
    "  const local: BodyOnly = {};",
    "  const internal: Internal = {};",
    "  console.log(options, local, internal);",
    "  return makeResult();",
    "}",
    "export class Widget {",
    "  constructor(private readonly secret: Secret) {}",
    "  configure(config: Config): void { console.log(config, this.secret); }",
    "}",
    "const theme: Theme = {};",
    "export const settings = { theme };",
    "export async function load() { const loaded: Loaded = {}; return loaded; }",
    "",
  ].join("\n"),
  "src/internal.ts": "export interface Internal { unusedInternal?: string; }\n",
};

describe("package mode property analysis", () => {
  test("treats properties of types visible through the public API as used", async () => {
    const tsConfigPath = await createFixProject(projectDir, LIBRARY_FILES);

    expect(await findUnusedProperties(tsConfigPath, true)).toEqual([
      "BodyOnly.unusedBodyOnly",
      "Internal.unusedInternal",
      "Secret.unusedSecret",
    ]);
  });

  test("analyzes the same properties outside package mode", async () => {
    const tsConfigPath = await createFixProject(projectDir, LIBRARY_FILES);

    expect(await findUnusedProperties(tsConfigPath, false)).toEqual([
      "AliasProps.unusedAlias",
      "BodyOnly.unusedBodyOnly",
      "Config.unusedConfig",
      "Hidden.unusedHidden",
      "Internal.unusedInternal",
      "Loaded.unusedLoaded",
      "Nested.unusedNested",
      "Options.nested",
      "Options.unusedOption",
      "Props.'aria-label'",
      "Props.unusedPublic",
      "Result.unusedResult",
      "Secret.unusedSecret",
      "Theme.unusedTheme",
    ]);
  });
});
