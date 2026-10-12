import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { analyzeProject } from "../analyzeProject";
import { formatResults } from "../formatResults";

const projectDir = path.resolve(".tmp/duplicate-types-tests");
const configPath = path.join(projectDir, "tsconfig.json");

beforeEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
  await mkdir(projectDir, { recursive: true });
  await Bun.write(configPath, JSON.stringify({ compilerOptions: { strict: true }, include: ["*.ts"] }));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("duplicate types", () => {
  test("reports differently named interfaces and aliases across files regardless of member order", async () => {
    await Bun.write(path.join(projectDir, "a.ts"), "export interface First { id: string; count: number; }");
    await Bun.write(path.join(projectDir, "b.ts"), "export type Second = { count: number; id: string; };");
    await Bun.write(path.join(projectDir, "c.ts"), "export interface Third { id: string; count: number; }");

    const results = await analyzeProject(configPath);
    expect(results.duplicateTypes).toEqual([
      {
        filePath: "b.ts",
        typeName: "Second",
        line: 1,
        character: 13,
        endCharacter: 19,
        duplicateOf: { filePath: "a.ts", typeName: "First", line: 1, character: 18, endCharacter: 23 },
        severity: "warning",
      },
      {
        filePath: "c.ts",
        typeName: "Third",
        line: 1,
        character: 18,
        endCharacter: 23,
        duplicateOf: { filePath: "a.ts", typeName: "First", line: 1, character: 18, endCharacter: 23 },
        severity: "warning",
      },
    ]);
  });

  test("includes primitive aliases and unions with reordered branches", async () => {
    await Bun.write(
      path.join(projectDir, "types.ts"),
      `
      type UserId = string;
      type OrderId = string;
      type FirstResult = { ok: true; value: string } | { ok: false; error: string };
      type SecondResult = { error: string; ok: false } | { value: string; ok: true };
    `,
    );

    const results = await analyzeProject(configPath);
    expect(results.duplicateTypes?.map((item) => [item.typeName, item.duplicateOf.typeName])).toEqual([
      ["OrderId", "UserId"],
      ["SecondResult", "FirstResult"],
    ]);
  });

  test("compares nested structures and recursive types without depending on identifiers", async () => {
    await Bun.write(
      path.join(projectDir, "types.ts"),
      `
      interface First { child?: First; data: { id: string }; }
      type Second = { data: { id: string }; child?: Second };
      interface Different { child?: Different; data: { id: number }; }
    `,
    );

    const results = await analyzeProject(configPath);
    expect(results.duplicateTypes?.map((item) => [item.typeName, item.duplicateOf.typeName])).toEqual([
      ["Second", "First"],
    ]);
  });

  test("distinguishes readonly, optional, extra members, literals, signatures, and index signatures", async () => {
    await Bun.write(
      path.join(projectDir, "types.ts"),
      `
      type Plain = { value: string };
      type ReadonlyValue = { readonly value: string };
      type OptionalValue = { value?: string };
      type ExtraValue = { value: string; extra?: number };
      type LiteralValue = { value: "literal" };
      type Callback = (value: string) => number;
      type OtherCallback = (value: number) => number;
      type Dictionary = { [key: string]: number };
      type ReadonlyDictionary = { readonly [key: string]: number };
    `,
    );

    const results = await analyzeProject(configPath);
    expect(results.duplicateTypes).toEqual([]);
  });

  test("compares generic type parameters by position and preserves constraints and defaults", async () => {
    await Bun.write(
      path.join(projectDir, "types.ts"),
      `
      type First<T extends string = "a"> = { value: T };
      interface Second<U extends string = "a"> { value: U; }
      type DifferentDefault<V extends string = "b"> = { value: V };
      type DifferentConstraint<V extends number = 1> = { value: V };
    `,
    );

    const results = await analyzeProject(configPath);
    expect(results.duplicateTypes?.map((item) => [item.typeName, item.duplicateOf.typeName])).toEqual([
      ["Second", "First"],
    ]);
  });

  test("matches function aliases and distinguishes optional, rest, this parameters, and predicates", async () => {
    await Bun.write(
      path.join(projectDir, "types.ts"),
      `
      type First = <T extends string>(value: T) => T;
      type Second = <U extends string>(input: U) => U;
      type Required = (value: string) => number;
      type Optional = (value?: string) => number;
      type Rest = (...values: string[]) => number;
      type ArrayArgument = (values: string[]) => number;
      type StringThis = <T>(this: { id: string }, value: T) => T;
      type NumberThis = <U>(this: { id: number }, value: U) => U;
      type Guard<T> = (value: unknown) => value is T;
      type BooleanReturn<T> = (value: unknown) => boolean;
    `,
    );

    const results = await analyzeProject(configPath);
    expect(results.duplicateTypes?.map((item) => [item.typeName, item.duplicateOf.typeName])).toEqual([
      ["Second", "First"],
    ]);
  });

  test("distinguishes mapped readonly properties and tuple modifiers", async () => {
    await Bun.write(
      path.join(projectDir, "types.ts"),
      `
      interface Plain { value: string; }
      type MappedReadonly = Readonly<Plain>;
      interface ExplicitReadonly { readonly value: string; }
      type MutableTuple = [string, number?];
      type ReadonlyTuple = readonly [string, number?];
      type RequiredTuple = [string, number | undefined];
    `,
    );

    const results = await analyzeProject(configPath);
    expect(results.duplicateTypes?.map((item) => [item.typeName, item.duplicateOf.typeName])).toEqual([
      ["ExplicitReadonly", "MappedReadonly"],
    ]);
  });

  test("distinguishes symbol index values and their nested readonly modifiers", async () => {
    await Bun.write(
      path.join(projectDir, "types.ts"),
      `
      type First = { [key: symbol]: { value: string } };
      type Second = { [key: symbol]: { value: number } };
      type Third = { [key: symbol]: { readonly value: string } };
    `,
    );

    const results = await analyzeProject(configPath);
    expect(results.duplicateTypes).toEqual([]);
  });

  test("resolves aliases, inheritance, intersections, and mapped modifier removal", async () => {
    await Bun.write(
      path.join(projectDir, "types.ts"),
      `
      interface Original { readonly value: string; }
      type Mutable = { -readonly [K in keyof Original]: Original[K] };
      type ExplicitMutable = { value: string };
      interface Derived extends Original { extra: number; }
      type Combined = { readonly value: string } & { extra: number };
      type Alias = Original;
    `,
    );

    const results = await analyzeProject(configPath);
    expect(results.duplicateTypes?.map((item) => [item.typeName, item.duplicateOf.typeName])).toEqual([
      ["Alias", "Original"],
      ["ExplicitMutable", "Mutable"],
      ["Combined", "Derived"],
    ]);
  });

  test("distinguishes any, unknown, never, brands, and unresolved references", async () => {
    await Bun.write(
      path.join(projectDir, "types.ts"),
      `
      type Anything = any;
      type UnknownValue = unknown;
      type NoValue = never;
      type FirstBrand = string & { readonly brand: "first" };
      type SecondBrand = string & { readonly brand: "second" };
      type MissingFirst = Missing;
      type MissingSecond = Missing;
    `,
    );

    const results = await analyzeProject(configPath);
    expect(results.duplicateTypes).toEqual([]);
  });

  test("compares generic arrays and distinguishes swapped type parameters", async () => {
    await Bun.write(
      path.join(projectDir, "types.ts"),
      `
      type First<T> = { values: T[] };
      type Second<U> = { values: U[] };
      type Pair<A, B> = { left: A; right: B };
      type Swapped<A, B> = { left: B; right: A };
    `,
    );

    const results = await analyzeProject(configPath);
    expect(results.duplicateTypes?.map((item) => [item.typeName, item.duplicateOf.typeName])).toEqual([
      ["Second", "First"],
    ]);
  });

  test("compares generic mapped types and preserves their modifiers", async () => {
    await Bun.write(
      path.join(projectDir, "types.ts"),
      `
      type First<T> = { [K in keyof T]: T[K] };
      type Second<U> = { [P in keyof U]: U[P] };
      type ReadonlyMap<T> = { readonly [K in keyof T]: T[K] };
      type OptionalMap<T> = { [K in keyof T]?: T[K] };
      type DifferentValue<T> = { [K in keyof T]: number };
    `,
    );

    const results = await analyzeProject(configPath);
    expect(results.duplicateTypes?.map((item) => [item.typeName, item.duplicateOf.typeName])).toEqual([
      ["Second", "First"],
    ]);
  });

  test("preserves nominal identity of private class members in generic aliases", async () => {
    await Bun.write(
      path.join(projectDir, "types.ts"),
      `
      class FirstBox<T> { private value!: T; }
      class SecondBox<T> { private value!: T; }
      type First<T> = FirstBox<T>;
      type Second<U> = SecondBox<U>;
    `,
    );

    const results = await analyzeProject(configPath);
    expect(results.duplicateTypes).toEqual([]);
  });

  test("compares conditional types and template literals with renamed generic parameters", async () => {
    await Bun.write(
      path.join(projectDir, "types.ts"),
      `
      type First<T> = T extends string ? T[] : number;
      type Second<U> = U extends string ? U[] : number;
      type Different<T> = T extends string ? T[] : boolean;
      type FirstKey<T extends string> = \`prefix-\${T}\`;
      type SecondKey<U extends string> = \`prefix-\${U}\`;
      type DifferentKey<T extends string> = \`other-\${T}\`;
    `,
    );

    const results = await analyzeProject(configPath);
    expect(results.duplicateTypes?.map((item) => [item.typeName, item.duplicateOf.typeName])).toEqual([
      ["Second", "First"],
      ["SecondKey", "FirstKey"],
    ]);
  });

  test("duplicate warnings do not make the CLI fail", async () => {
    await Bun.write(path.join(projectDir, "types.ts"), "type First = string; type Second = string;");
    const process = Bun.spawn(["bun", "run", "src/cli.ts", "check", configPath], {
      env: { ...Bun.env, AGENT: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(process.stdout).text();
    const errors = await new Response(process.stderr).text();

    expect(await process.exited).toBe(0);
    expect(errors).toBe("");
    expect(output).toBe(
      [
        `Analyzing TypeScript project: ${configPath}`,
        "",
        "Duplicate Types:",
        "",
        path.relative(globalThis.process.cwd(), path.join(projectDir, "types.ts")),
        `  Second:1:27-33 [WARNING] (Duplicate of First at ${path.relative(globalThis.process.cwd(), path.join(projectDir, "types.ts"))}:1:6)`,
        "",
        "Summary:",
        "  Completely unused files: 0",
        "  Unused exports: 0",
        "  Unused properties: 0",
        "  Never-returned types: 0",
        "  Duplicate types: 1",
        "",
      ].join("\n"),
    );
  });

  test("respects ignored types, ignored files, test files, and ts-nocheck", async () => {
    await Bun.write(path.join(projectDir, "a.ts"), "type First = { value: string };");
    await Bun.write(path.join(projectDir, "b.ts"), "type Ignored = { value: string };");
    await Bun.write(path.join(projectDir, "ignored.ts"), "type IgnoredFile = { value: string };");
    await Bun.write(path.join(projectDir, "types.test.ts"), "type TestType = { value: string };");
    await Bun.write(path.join(projectDir, "nocheck.ts"), "// @ts-nocheck\ntype Skipped = { value: string };");

    const results = await analyzeProject(configPath, undefined, undefined, {
      config: { ignoreTypes: ["Ignored*"], ignoreFilePatterns: ["**/ignored.ts"] },
    });
    expect(results.duplicateTypes).toEqual([]);
  });

  test("can disable duplicate detection independently", async () => {
    await Bun.write(path.join(projectDir, "types.ts"), "type First = string; type Second = string;");

    const results = await analyzeProject(configPath, undefined, undefined, {
      config: { analyzeDuplicateTypes: false },
    });
    expect(results.duplicateTypes).toEqual([]);
  });

  test("compares a targeted file against the rest of the project", async () => {
    await Bun.write(path.join(projectDir, "a.ts"), "type First = { value: string };");
    await Bun.write(path.join(projectDir, "b.ts"), "type Second = { value: string };");

    const results = await analyzeProject(configPath, undefined, path.join(projectDir, "a.ts"));
    expect(results.duplicateTypes?.map((item) => [item.filePath, item.typeName, item.duplicateOf.typeName])).toEqual([
      ["a.ts", "First", "Second"],
    ]);
  });

  test("formats duplicate warnings even when they are the only findings", async () => {
    await Bun.write(path.join(projectDir, "a.ts"), "type First = string; type Second = string;");
    const results = await analyzeProject(configPath, undefined, undefined, {
      config: { analyzeExports: false, analyzeProperties: false, analyzeNeverReturnedTypes: false },
    });

    expect(formatResults(results, projectDir)).toBe(
      [
        "Duplicate Types:",
        "",
        path.relative(process.cwd(), path.join(projectDir, "a.ts")),
        `  Second:1:27-33 [WARNING] (Duplicate of First at ${path.relative(process.cwd(), path.join(projectDir, "a.ts"))}:1:6)`,
        "",
        "Summary:",
        "  Completely unused files: 0",
        "  Unused exports: 0",
        "  Unused properties: 0",
        "  Never-returned types: 0",
        "  Duplicate types: 1",
      ].join("\n"),
    );
  });
});
