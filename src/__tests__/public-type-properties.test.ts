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

  test("treats properties of types inside public conditional types as used", async () => {
    const tsConfigPath = await createFixProject(projectDir, {
      "package.json": JSON.stringify({ name: "fixture", type: "module", main: "./index.ts" }),
      "index.ts": [
        "interface CheckSide { unusedCheck?: string; }",
        "interface ExtendsSide { unusedExtends?: string; }",
        "interface TrueBranch { unusedTrue?: string; }",
        "interface FalseBranch { unusedFalse?: string; }",
        "interface InferredTrue { unusedInferredTrue?: string; }",
        "interface InferredFalse { unusedInferredFalse?: string; }",
        "interface Hidden { unusedHidden?: string; }",
        "export type Resolve<T> = T extends ExtendsSide ? TrueBranch : FalseBranch;",
        "export type Check = CheckSide extends { kind: string } ? true : false;",
        "declare function choose<T>(value: T): T extends string ? InferredTrue : InferredFalse;",
        "export function chooseLater<T>(value: T) { const hidden: Hidden = {}; console.log(hidden); return choose(value); }",
        "",
      ].join("\n"),
    });

    expect(await findUnusedProperties(tsConfigPath, true)).toEqual(["Hidden.unusedHidden"]);
  });

  test("treats properties of types inside public mapped types and utility types as used", async () => {
    const tsConfigPath = await createFixProject(projectDir, {
      "package.json": JSON.stringify({ name: "fixture", type: "module", main: "./index.ts" }),
      "index.ts": [
        "interface KeySource { unusedKey?: string; }",
        "interface Template { unusedTemplate?: string; }",
        "interface Renamed { unusedRenamed?: string; }",
        "interface PickSource { picked?: string; unusedPickSource?: string; }",
        "interface OmitSource { omitted?: string; unusedOmitSource?: string; }",
        "interface PartialSource { unusedPartial?: string; }",
        "interface InferredSource { inferredPicked?: string; unusedInferred?: string; }",
        "interface InferredTemplate { unusedInferredTemplate?: string; }",
        "interface Hidden { unusedHidden?: string; }",
        "export type Mapped = { [K in keyof KeySource]: Template };",
        "export type Remapped<T> = { [K in keyof T as `${string & K}Renamed`]: Renamed };",
        "export function pickProps(): Pick<PickSource, 'picked'> { return {}; }",
        "export function omitProps(): Omit<OmitSource, 'omitted'> { return {}; }",
        "export function partialProps(): Partial<PartialSource> { return {}; }",
        "declare function pickInferred(): Pick<InferredSource, 'inferredPicked'>;",
        "declare function mapInferred<T>(value: T): { [K in keyof T]: InferredTemplate };",
        "export const inferredPick = pickInferred();",
        "export function mapLater<T>(value: T) { const hidden: Hidden = {}; console.log(hidden); return mapInferred(value); }",
        "",
      ].join("\n"),
    });

    expect(await findUnusedProperties(tsConfigPath, true)).toEqual(["Hidden.unusedHidden"]);
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
