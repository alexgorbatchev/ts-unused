import { expect, test } from "bun:test";
import { Project, ts } from "ts-morph";
import { isPropertyUnused } from "../isPropertyUnused";
import { isTestFile } from "../isTestFile";
import { createClassifyUsageSource } from "../usageSourceUtils";

test.each([
  {
    name: "shorthand destructuring",
    body: "declare const source: Props; const { value } = source;",
  },
  {
    name: "assignment destructuring",
    body: "declare const source: Props; let local: string; ({ value: local } = source);",
  },
  {
    name: "computed contextual writes",
    body: 'const KEY = "value"; const object: Props = { [KEY]: "used" };',
  },
  {
    name: "contextual accessors",
    body: 'const object: Props = { get value() { return "used"; } };',
  },
  {
    name: "renamed mapped keys",
    body: "type Renamed<T> = { [K in keyof T as `read_${K & string}`]: T[K] }; declare const object: Renamed<Props>; object.read_value;",
  },
  {
    name: "JSX component attributes",
    body: 'namespace JSX { export interface Element {} } declare function Component(props: Props): JSX.Element; const element = <Component value="used" />;',
  },
  {
    name: "JSX intrinsic attributes",
    body: 'namespace JSX { export interface Element {} export interface IntrinsicElements { widget: Props; } } const element = <widget value="used" />;',
  },
  {
    name: "interface overrides",
    body: "interface Child extends Props { value: string; } declare const child: Child; child.value;",
  },
  {
    name: "class implementation and overridden inheritance",
    body: 'class Base implements Props { value = "base"; } class Child extends Base { override value = "child"; read() { return this.value; } }',
  },
])("counts $name as property usage", ({ body }) => {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipLoadingLibFiles: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve },
  });
  const file = project.createSourceFile("/reference.tsx", `interface Props { value: string; } ${body}`);

  expect(
    isPropertyUnused(
      file.getInterfaceOrThrow("Props").getPropertyOrThrow("value"),
      createClassifyUsageSource(isTestFile, [], "/"),
      project,
    ).isUnusedOrTestOnly,
  ).toBe(false);
});

test("counts property references in imported external declarations", () => {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipLoadingLibFiles: true,
    compilerOptions: { moduleResolution: ts.ModuleResolutionKind.Node10 },
  });
  const file = project.createSourceFile("/types.ts", "export interface Props { value: string; }");
  project
    .getFileSystem()
    .writeFileSync(
      "/node_modules/client/index.d.ts",
      'import type { Props } from "../../types"; export type Value = Props["value"];',
    );
  project.createSourceFile("/main.ts", 'import type { Value } from "client"; export declare const value: Value;');
  project.resolveSourceFileDependencies();

  expect(
    isPropertyUnused(
      file.getInterfaceOrThrow("Props").getPropertyOrThrow("value"),
      createClassifyUsageSource(isTestFile, [], "/"),
      project,
    ).isUnusedOrTestOnly,
  ).toBe(false);
});

test("counts union return writes only for branches compatible with the returned literal", () => {
  const project = new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true });
  const file = project.createSourceFile(
    "/union.ts",
    `
      interface Success { kind: "success"; data: string; shared: string; }
      interface Failure { kind: "failure"; error: string; shared: string; }
      function result(): Success | Failure {
        return { kind: "success", data: "written", shared: "selected" };
      }
    `,
  );
  const classify = createClassifyUsageSource(isTestFile, [], "/");

  expect(
    isPropertyUnused(file.getInterfaceOrThrow("Success").getPropertyOrThrow("data"), classify, project)
      .isUnusedOrTestOnly,
  ).toBe(false);
  expect(
    isPropertyUnused(file.getInterfaceOrThrow("Success").getPropertyOrThrow("shared"), classify, project)
      .isUnusedOrTestOnly,
  ).toBe(false);
  expect(
    isPropertyUnused(file.getInterfaceOrThrow("Failure").getPropertyOrThrow("shared"), classify, project)
      .isUnusedOrTestOnly,
  ).toBe(true);
  expect(
    isPropertyUnused(file.getInterfaceOrThrow("Failure").getPropertyOrThrow("error"), classify, project)
      .isUnusedOrTestOnly,
  ).toBe(true);
});

test("uses compiler source nodes when duplicate dependency packages redirect to one declaration", () => {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipLoadingLibFiles: true,
    compilerOptions: { moduleResolution: ts.ModuleResolutionKind.Node10 },
  });
  const file = project.createSourceFile("/types.ts", "export interface Props { value: string; }");
  const packageJson = JSON.stringify({ name: "shared-types", version: "1.0.0", types: "index.d.ts" });
  const declaration = `
    import type { Props } from "../../../../types";
    export declare namespace Types { interface Value { label: string; } }
    export interface Forward<T extends Types.Value> { item: T; }
    export declare const holder: { nested: Types.Value };
    export type Value = Props["value"];
  `;
  project.getFileSystem().writeFileSync("/node_modules/first/index.d.ts", 'export type { Value } from "shared-types";');
  project
    .getFileSystem()
    .writeFileSync("/node_modules/second/index.d.ts", 'export type { Value } from "shared-types";');
  project.getFileSystem().writeFileSync("/node_modules/first/node_modules/shared-types/package.json", packageJson);
  project.getFileSystem().writeFileSync("/node_modules/first/node_modules/shared-types/index.d.ts", declaration);
  project.getFileSystem().writeFileSync("/node_modules/second/node_modules/shared-types/package.json", packageJson);
  project.getFileSystem().writeFileSync("/node_modules/second/node_modules/shared-types/index.d.ts", declaration);
  project.createSourceFile(
    "/main.ts",
    'import type { Value as First } from "first"; import type { Value as Second } from "second"; export type Both = First | Second;',
  );
  project.resolveSourceFileDependencies();

  expect(
    project
      .getProgram()
      .compilerObject.getSourceFiles()
      .some((source) => source !== project.getSourceFileOrThrow(source.fileName).compilerNode),
  ).toBe(true);

  expect(
    isPropertyUnused(
      file.getInterfaceOrThrow("Props").getPropertyOrThrow("value"),
      createClassifyUsageSource(isTestFile, [], "/"),
      project,
    ).isUnusedOrTestOnly,
  ).toBe(false);
});
