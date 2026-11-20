import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { analyzeProject } from "../analyzeProject";

async function analyzeProperties(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), "ts-unused-properties-"));
  const config = path.join(root, "tsconfig.json");
  try {
    await Bun.write(config, JSON.stringify({ compilerOptions: { jsx: "preserve", moduleResolution: "node" } }));
    for (const [name, content] of Object.entries(files)) {
      await Bun.write(path.join(root, name), content);
    }
    const results = await analyzeProject(config, undefined, undefined, {
      config: { analyzeExports: false, analyzeDuplicateTypes: false, analyzeNeverReturnedTypes: false },
    });
    return results.unusedProperties.map(({ typeName, propertyName }) => `${typeName}.${propertyName}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

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
    name: "nested object and tuple assignment destructuring",
    body: "declare const source: { nested: [Props] }; let local: string; ({ nested: [{ value: local }] } = source);",
  },
  {
    name: "array iteration assignment destructuring",
    body: "declare const source: Props[]; let local: string; for ({ value: local } of source) {}",
  },
  {
    name: "custom iterator assignment destructuring",
    body: "declare const source: Iterable<Props>; let local: string; for ({ value: local } of source) {}",
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
])("counts $name as property usage", async ({ body }) => {
  expect(await analyzeProperties({ "reference.tsx": `interface Props { value: string; } ${body}` })).not.toContain(
    "Props.value",
  );
});

test("counts property references in imported external declarations", async () => {
  expect(
    await analyzeProperties({
      "types.ts": "export interface Props { value: string; }",
      "node_modules/client/index.d.ts": 'import type { Props } from "../../types"; export type Value = Props["value"];',
      "main.ts": 'import type { Value } from "client"; export declare const value: Value;',
    }),
  ).not.toContain("Props.value");
});

test("counts union return writes only for branches compatible with the returned literal", async () => {
  expect(
    await analyzeProperties({
      "union.ts": `
        interface Success { kind: "success"; data: string; shared: string; }
        interface Failure { kind: "failure"; error: string; shared: string; }
        function result(): Success | Failure {
          return { kind: "success", data: "written", shared: "selected" };
        }
      `,
    }),
  ).toEqual(["Failure.kind", "Failure.error", "Failure.shared"]);
});

test("uses compiler source nodes when duplicate dependency packages redirect to one declaration", async () => {
  const packageJson = JSON.stringify({ name: "shared-types", version: "1.0.0", types: "index.d.ts" });
  const declaration = `
    import type { Props } from "../../../../types";
    export declare namespace Types { interface Value { label: string; } }
    export interface Forward<T extends Types.Value> { item: T; }
    export declare const holder: { nested: Types.Value };
    export type Value = Props["value"];
  `;
  expect(
    await analyzeProperties({
      "types.ts": "export interface Props { value: string; }",
      "node_modules/first/index.d.ts": 'export type { Value } from "shared-types";',
      "node_modules/second/index.d.ts": 'export type { Value } from "shared-types";',
      "node_modules/first/node_modules/shared-types/package.json": packageJson,
      "node_modules/first/node_modules/shared-types/index.d.ts": declaration,
      "node_modules/second/node_modules/shared-types/package.json": packageJson,
      "node_modules/second/node_modules/shared-types/index.d.ts": declaration,
      "main.ts":
        'import type { Value as First } from "first"; import type { Value as Second } from "second"; export type Both = First | Second;',
    }),
  ).not.toContain("Props.value");
});

test("tracks unique-symbol reads and unused computed property declarations", async () => {
  const results = await analyzeProperties({
    "computed.ts": `
      declare const used: unique symbol;
      declare const unused: unique symbol;
      interface Computed { [used]: string; [unused]: string; }
      declare const keys: Computed;
      keys[used];
    `,
  });
  expect(results).toEqual(["Computed.[unused]"]);
});
