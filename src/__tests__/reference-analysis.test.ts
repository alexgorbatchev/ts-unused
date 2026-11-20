import { expect, test } from "bun:test";
import path from "node:path";
import { isFunctionDeclaration, isInterfaceDeclaration, isPropertySignatureDeclaration } from "typescript/ast";
import { checkExportUsage } from "../checkExportUsage";
import { createNativePropertyUsage } from "../createNativePropertyUsage";
import { findNativeReferenceNodes } from "../findNativeReferenceNodes";
import { findNativeSpecialImports } from "../findNativeSpecialImports";
import { declarationLocation, findNativeUsedImports } from "../findNativeUsedImports";
import { getNativeExports } from "../getNativeExports";
import { isTestFile } from "../isTestFile";
import { createClassifyUsageSource } from "../usageSourceUtils";
import { withNativeProject } from "./helpers";

const keys = Array.from({ length: 160 }, (_, index) => JSON.stringify(`key${index}`)).join(" | ");

test("locates uses of generic values without formatting their inferred type", async () => {
  await withNativeProject(
    {
      "reference.ts": `
      declare function create<T extends string>(): { [P in T]: { [Q in T]: { [R in T]: P | Q | R } } };
      export const value = create<${keys}>();
      value;
    `,
    },
    async (project, root) => {
      const source = (await project.program.getSourceFile(path.join(root, "reference.ts")))!;
      const exports = await getNativeExports(project, source);
      const classify = createClassifyUsageSource(isTestFile, [], root);
      expect(
        await checkExportUsage("value", exports.get("value")!, source, root, classify, {
          findReferences: (node) => findNativeReferenceNodes(project, node),
        }),
      ).toBeNull();
    },
  );
});

test.each([
  {
    name: "ignores unrelated mapped types",
    code: `
      interface Props { untouched: string; }
      type Keys = ${keys};
      type Expanded = { [P in Keys]: { [Q in Keys]: P | Q } };
      const unrelated: Expanded = {};
      unrelated;
    `,
    findings: [["untouched", true]],
  },
  {
    name: "traces multiple property names through the same contextual flow",
    code: `
      interface Props { first: string; second: string; }
      interface Destination { first: string; second: string; }
      function pass(value: Props): Destination { return value; }
      function read(value: Destination) { return value.second; }
    `,
    findings: [
      ["first", true],
      ["second", false],
    ],
  },
  {
    name: "counts contextual writes through an inferred generic",
    code: `
      interface Props { value: string; }
      declare function Component(props: Props): void;
      type Args<F> = F extends (props: infer P) => void ? P : never;
      type Meta<F> = { args: Args<F> };
      const story: Meta<typeof Component> = { args: { value: "used" } };
    `,
    findings: [["value", false]],
  },
])("$name", async ({ code, findings }) => {
  await withNativeProject({ "reference.ts": code }, async (project, root) => {
    const source = (await project.program.getSourceFile(path.join(root, "reference.ts")))!;
    const props = source.statements.find(isInterfaceDeclaration)!;
    const usage = await createNativePropertyUsage(project, createClassifyUsageSource(isTestFile, [], root));
    const actual = await Promise.all(
      props.members
        .filter(isPropertySignatureDeclaration)
        .map(async (member) => [member.name.getText(source), (await usage(member)).isUnusedOrTestOnly]),
    );
    expect(actual).toEqual(findings.map((finding) => [...finding]));
  });
});

test("finds imports of an anonymous default function", async () => {
  await withNativeProject(
    {
      "source.ts": "export default function () {}",
      "consumer.ts": 'import run from "./source"; run();',
    },
    async (project, root) => {
      const source = (await project.program.getSourceFile(path.join(root, "source.ts")))!;
      const declaration = source.statements.find(isFunctionDeclaration)!;
      const references = await findNativeReferenceNodes(project, declaration);
      expect(references.some((node) => node.getSourceFile().fileName === path.join(root, "consumer.ts"))).toBe(true);
    },
  );
});

test("proves imported bindings live only from actual production references", async () => {
  await withNativeProject(
    {
      "lib.ts": `
      export default function run() {}
      export type Used = string;
      export const shadow = 0, member = 1, forwarded = 2, testOnly = 3, storyOnly = 4;
    `,
      "app.ts": `
      import execute, { type Used as T, shadow, member, forwarded } from "./lib";
      execute(); let x: T;
      function f(shadow: number) { return shadow + ({member: 7}).member; }
      export { forwarded };
    `,
      "app.test.ts": 'import { testOnly } from "./lib"; testOnly;',
      "app.stories.ts": 'import { storyOnly } from "./lib"; storyOnly;',
    },
    async (project, root) => {
      const file = (await project.program.getSourceFile(path.join(root, "lib.ts")))!;
      const used = await findNativeUsedImports(project, createClassifyUsageSource(isTestFile, ["*.stories.ts"], root));
      const exports = await getNativeExports(project, file);
      expect(
        [...exports]
          .filter(([, declarations]) =>
            declarations.some((node) => used.has(declarationLocation(node.getSourceFile().fileName, node.getStart()))),
          )
          .map(([name]) => name)
          .sort(),
      ).toEqual(["Used", "default"]);
    },
  );
});

test("only counts side-effect imports from a different source file", async () => {
  const files = { "setup.ts": 'import "./setup"; export const setup = 1;' };
  await withNativeProject(files, async (project, root) => {
    const target = path.join(root, "setup.ts");
    expect((await findNativeSpecialImports(project, new Set([target]))).sideEffects.has(target)).toBe(false);
  });
  await withNativeProject({ ...files, "app.ts": 'import "./setup";' }, async (project, root) => {
    const target = path.join(root, "setup.ts");
    expect((await findNativeSpecialImports(project, new Set([target]))).sideEffects.has(target)).toBe(true);
  });
});
