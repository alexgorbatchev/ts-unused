import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { createIsCsfExport } from "../createIsCsfExport";

function getCsfExports(source: string): string[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile("/button.stories.tsx", source);
  const isCsfExport = createIsCsfExport(sourceFile);
  return Array.from(sourceFile.getExportedDeclarations())
    .filter(([exportName, declarations]) => isCsfExport(exportName, declarations))
    .map(([exportName]) => exportName)
    .toSorted();
}

const STORY_EXPORTS = [
  "export const Primary = {};",
  "export function Secondary() { return null; }",
  "export const mockData = {};",
  "export const userData = {};",
].join("\n");

describe("createIsCsfExport", () => {
  test("treats the default export and every named variable or function export as CSF without a filter", () => {
    expect(getCsfExports(`export default { title: "Button" };\n${STORY_EXPORTS}`)).toEqual([
      "Primary",
      "Secondary",
      "default",
      "mockData",
      "userData",
    ]);
  });

  test("does not treat exported types, interfaces, classes, or enums as stories", () => {
    const source = [
      'export default { title: "Button" };',
      "export type StoryArgs = { label: string };",
      "export interface IStoryProps { label: string; }",
      "export class StoryHelper {}",
      "export enum StoryMode { Light }",
      "export const Primary = {};",
    ].join("\n");

    expect(getCsfExports(source)).toEqual(["Primary", "default"]);
  });

  test("treats __namedExportsOrder as CSF metadata even when includeStories leaves it out", () => {
    const source = [
      'export default { includeStories: ["Primary"] };',
      "export const Primary = {};",
      'export const __namedExportsOrder = ["Primary"];',
    ].join("\n");

    expect(getCsfExports(source)).toEqual(["Primary", "__namedExportsOrder", "default"]);
  });

  test.each([
    ["a regex literal excludeStories", "export default { excludeStories: /.*Data$/ };", ["Primary", "Secondary"]],
    [
      "a string excludeStories, which Storybook compiles to a regex",
      'export default { excludeStories: "Data$" };',
      ["Primary", "Secondary"],
    ],
    [
      "an array includeStories, which matches export names exactly",
      'export default { includeStories: ["Primary", "mockData", "Prim"] };',
      ["Primary", "mockData"],
    ],
    ["a regex literal includeStories with flags", "export default { includeStories: /^prim/i };", ["Primary"]],
    [
      "includeStories together with excludeStories, where exclusion wins",
      'export default { includeStories: ["Primary", "mockData", "userData"], excludeStories: /^mock/ };',
      ["Primary", "userData"],
    ],
    ["an empty includeStories array", "export default { includeStories: [] };", []],
  ])("honours %s", (_description, meta, stories) => {
    expect(getCsfExports(`${meta}\n${STORY_EXPORTS}`)).toEqual([...stories, "default"].toSorted());
  });

  test.each([
    ["a variable bound to the meta object", "const meta = { excludeStories: /Data$/ };\nexport default meta;"],
    [
      "a variable bound to a satisfies expression",
      "const meta = { excludeStories: /Data$/ } satisfies object;\nexport default meta;",
    ],
    ["an as expression", "export default { excludeStories: /Data$/ } as object;"],
    ["a satisfies expression", "export default { excludeStories: /Data$/ } satisfies object;"],
    [
      "a satisfies expression inside an as expression",
      "export default { excludeStories: /Data$/ } satisfies object as object;",
    ],
    ["a parenthesized object", "export default ({ excludeStories: /Data$/ });"],
    ["an export specifier", "const meta = { excludeStories: /Data$/ };\nexport { meta as default };"],
  ])("reads the meta from %s", (_description, meta) => {
    expect(getCsfExports(`${meta}\n${STORY_EXPORTS}`)).toEqual(["Primary", "Secondary", "default"]);
  });

  test.each([
    ["an identifier", "const EXCLUDED = /Data$/;\nexport default { excludeStories: EXCLUDED };"],
    ["an array containing a regex, which Storybook rejects", "export default { excludeStories: [/Data$/] };"],
    ["a template literal", "export default { excludeStories: `Data$` };"],
    ["an array with a spread element", 'const NAMES = ["mockData"];\nexport default { excludeStories: [...NAMES] };'],
    ["a shorthand property", "const excludeStories = /Data$/;\nexport default { excludeStories };"],
    ["an invalid regular expression string", 'export default { excludeStories: "(" };'],
    [
      "an unreadable filter next to a readable one",
      'const EXCLUDED = /Data$/;\nexport default { includeStories: ["Primary"], excludeStories: EXCLUDED };',
    ],
    [
      "a meta created by a call",
      "declare function defineMeta(meta: object): object;\nexport default defineMeta({ excludeStories: /Data$/ });",
    ],
    [
      "a CSF factory file without a default export",
      "declare const preview: { meta(meta: object): { story(story: object): object } };\nconst meta = preview.meta({ excludeStories: /Data$/ });",
    ],
  ])("treats every named export as a story when the filter is %s", (_description, meta) => {
    const csfExports = getCsfExports(`${meta}\n${STORY_EXPORTS}`).filter((exportName) => exportName !== "default");

    expect(csfExports).toEqual(["Primary", "Secondary", "mockData", "userData"]);
  });

  test("ignores filters behind quoted keys and spreads, like the Storybook indexer", () => {
    const source = [
      "const base = { excludeStories: /Data$/ };",
      'export default { ...base, "includeStories": ["Primary"] };',
      STORY_EXPORTS,
    ].join("\n");

    expect(getCsfExports(source)).toEqual(["Primary", "Secondary", "default", "mockData", "userData"]);
  });

  test("treats CSF factory stories as stories", () => {
    const source = [
      "declare const preview: { meta(meta: object): { story(story: object): object } };",
      'const meta = preview.meta({ title: "Button" });',
      "export const Primary = meta.story({});",
      "export default meta;",
    ].join("\n");

    expect(getCsfExports(source)).toEqual(["Primary", "default"]);
  });
});
