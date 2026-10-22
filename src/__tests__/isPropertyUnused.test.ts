import { describe, expect, test } from "bun:test";
import { Project, SyntaxKind, ts } from "ts-morph";
import { isPropertyUnused } from "../isPropertyUnused";
import { isTestFile } from "../isTestFile";

describe("property usage relationships", () => {
  test("does not borrow usage from an unrelated interface with an identical shape", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const file = project.createSourceFile(
      "/types.ts",
      `
      interface Unused { value: string; }
      interface Used { value: string; }
      function read(item: Used) { return item.value; }
    `,
    );

    const property = file.getInterfaceOrThrow("Unused").getPropertyOrThrow("value");
    expect(isPropertyUnused(property, isTestFile, project)).toEqual({
      isUnusedOrTestOnly: true,
      onlyUsedInTests: false,
    });
  });

  test("does not borrow usage from an unrelated object type alias", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const file = project.createSourceFile(
      "/types.ts",
      `
      type Unused = { value: string };
      type Used = { value: string };
      function read(item: Used) { return item.value; }
    `,
    );

    const signature = file.getTypeAliasOrThrow("Unused").getTypeNodeOrThrow().asKindOrThrow(SyntaxKind.TypeLiteral);
    expect(isPropertyUnused(signature.getPropertyOrThrow("value"), isTestFile, project)).toEqual({
      isUnusedOrTestOnly: true,
      onlyUsedInTests: false,
    });
  });

  test("does not borrow Reflect access from an unrelated receiver", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const file = project.createSourceFile(
      "/types.ts",
      `
      interface Unused { value: string; }
      interface Used { value: string; }
      function read(item: Used) { return Reflect.get(item, "value"); }
    `,
    );

    const property = file.getInterfaceOrThrow("Unused").getPropertyOrThrow("value");
    expect(isPropertyUnused(property, isTestFile, project).isUnusedOrTestOnly).toBe(true);
  });

  test("preserves usage through interface inheritance and redeclaration", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const file = project.createSourceFile(
      "/types.ts",
      `
      interface Base { value: string; }
      interface Child extends Base { value: string; }
      function read(item: Child) { return item.value; }
    `,
    );

    const property = file.getInterfaceOrThrow("Base").getPropertyOrThrow("value");
    expect(isPropertyUnused(property, isTestFile, project).isUnusedOrTestOnly).toBe(false);
  });

  test("does not count a related property redeclaration as a read", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const file = project.createSourceFile(
      "/types.ts",
      `
      interface Base { value: string; }
      interface Child extends Base { value: string; }
    `,
    );

    const property = file.getInterfaceOrThrow("Base").getPropertyOrThrow("value");
    expect(isPropertyUnused(property, isTestFile, project)).toEqual({
      isUnusedOrTestOnly: true,
      onlyUsedInTests: false,
    });
  });

  test("preserves usage through an implementing class", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const file = project.createSourceFile(
      "/types.ts",
      `
      interface Options { value: string; }
      class Implementation implements Options {
        value = "used";
        read() { return this.value; }
      }
    `,
    );

    const property = file.getInterfaceOrThrow("Options").getPropertyOrThrow("value");
    expect(isPropertyUnused(property, isTestFile, project).isUnusedOrTestOnly).toBe(false);
  });

  test("preserves usage through object spreads", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const file = project.createSourceFile(
      "/types.ts",
      `
      interface Source { value: string; unused: number; }
      interface Target { value: string; }
      function read(source: Source) {
        const target: Target = { ...source };
        return target.value;
      }
    `,
    );

    const source = file.getInterfaceOrThrow("Source");
    expect(isPropertyUnused(source.getPropertyOrThrow("value"), isTestFile, project).isUnusedOrTestOnly).toBe(false);
    expect(isPropertyUnused(source.getPropertyOrThrow("unused"), isTestFile, project).isUnusedOrTestOnly).toBe(true);
  });

  test("does not propagate usage for an overwritten spread property", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const file = project.createSourceFile(
      "/types.ts",
      `
      interface Source { value: string; }
      interface Target { value: string; }
      function read(source: Source) {
        const target: Target = { ...source, value: "replacement" };
        return target.value;
      }
    `,
    );

    const property = file.getInterfaceOrThrow("Source").getPropertyOrThrow("value");
    expect(isPropertyUnused(property, isTestFile, project).isUnusedOrTestOnly).toBe(true);
  });

  test("preserves usage through assignment and function arguments", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const file = project.createSourceFile(
      "/types.ts",
      `
      interface Source { value: string; }
      interface Target { value: string; }
      function read(target: Target) { return target.value; }
      function pass(source: Source) {
        const target: Target = source;
        return read(target);
      }
    `,
    );

    const property = file.getInterfaceOrThrow("Source").getPropertyOrThrow("value");
    expect(isPropertyUnused(property, isTestFile, project).isUnusedOrTestOnly).toBe(false);
  });

  test("tracks usage through spreads that occur only in tests as test-only", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const file = project.createSourceFile(
      "/types.ts",
      `
      export interface Source { value: string; }
      export interface Target { value: string; }
      export function read(target: Target) { return target.value; }
    `,
    );
    project.createSourceFile(
      "/usage.test.ts",
      `
      import { read, type Source, type Target } from "./types";
      function check(source: Source) {
        const target: Target = { ...source };
        return read(target);
      }
    `,
    );

    const property = file.getInterfaceOrThrow("Source").getPropertyOrThrow("value");
    expect(isPropertyUnused(property, isTestFile, project)).toEqual({
      isUnusedOrTestOnly: true,
      onlyUsedInTests: true,
    });
  });
});

describe("keyed property reads", () => {
  function getUnusedFlags(project: Project, interfaceName: string): Record<string, boolean> {
    const declaration = project.getSourceFileOrThrow("/types.ts").getInterfaceOrThrow(interfaceName);
    return Object.fromEntries(
      declaration
        .getProperties()
        .map((property) => [property.getName(), isPropertyUnused(property, isTestFile, project).isUnusedOrTestOnly]),
    );
  }

  test("counts destructuring with string, numeric, and computed keys as reads", () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    project.createSourceFile(
      "/types.ts",
      `
      export interface Props {
        'aria-required'?: boolean;
        'aria-describedby'?: string;
        'param-key'?: string;
        'nested-key'?: { 'inner-key'?: string };
        'computed-key'?: string;
        'template-key'?: string;
        0?: string;
        'never-read'?: string;
      }
      const COMPUTED_KEY = 'computed-key';
      export function Component(props: Props, { 'param-key': param }: Props) {
        const {
          'aria-required': ariaRequired,
          'aria-describedby': ariaDescribedBy,
          'nested-key': { 'inner-key': inner } = {},
          [COMPUTED_KEY]: computed,
          [\`template-key\`]: template,
          0: zero,
        } = props;
        return [ariaRequired, ariaDescribedBy, param, inner, computed, template, zero];
      }
    `,
    );

    expect(getUnusedFlags(project, "Props")).toEqual({
      "'aria-required'": false,
      "'aria-describedby'": false,
      "'param-key'": false,
      "'nested-key'": false,
      "'computed-key'": false,
      "'template-key'": false,
      "0": false,
      "'never-read'": true,
    });
  });

  test("counts assignment destructuring with literal and computed keys as reads", () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    project.createSourceFile(
      "/types.ts",
      `
      export interface Props {
        'assigned-key'?: string;
        'computed-key'?: string;
        'for-of-key'?: string;
        1?: string;
        'never-read'?: string;
      }
      const COMPUTED_KEY = 'computed-key';
      let assigned: string | undefined;
      let computed: string | undefined;
      let numeric: string | undefined;
      let iterated: string | undefined;
      export function read(props: Props, list: Props[]) {
        ({ 'assigned-key': assigned, [COMPUTED_KEY]: computed, 1: numeric } = props);
        for ({ 'for-of-key': iterated } of list) {}
        return [assigned, computed, numeric, iterated];
      }
    `,
    );

    expect(getUnusedFlags(project, "Props")).toEqual({
      "'assigned-key'": false,
      "'computed-key'": false,
      "'for-of-key'": false,
      "1": false,
      "'never-read'": true,
    });
  });

  test("counts element access with literal and literal-typed keys as reads", () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    project.createSourceFile(
      "/types.ts",
      `
      export interface Props {
        'literal-key'?: string;
        'constant-key'?: string;
        'union-a'?: string;
        'union-b'?: string;
        'never-read'?: string;
      }
      const CONSTANT_KEY = 'constant-key';
      export function read(props: Props, key: 'union-a' | 'union-b') {
        return [props['literal-key'], props[CONSTANT_KEY], props[key]];
      }
    `,
    );

    expect(getUnusedFlags(project, "Props")).toEqual({
      "'literal-key'": false,
      "'constant-key'": false,
      "'union-a'": false,
      "'union-b'": false,
      "'never-read'": true,
    });
  });

  test("counts destructuring and element access with unique symbol keys as reads", () => {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { strict: true, target: ts.ScriptTarget.ES2022 },
    });
    project.createSourceFile(
      "/types.ts",
      `
      const BINDING_KEY: unique symbol = Symbol("binding");
      const ASSIGNED_KEY = Symbol("assigned");
      const INDEXED_KEY = Symbol("indexed");
      const UNION_A = Symbol("a");
      const UNION_B = Symbol("b");
      const NEVER_KEY = Symbol("never");
      export interface Props {
        [BINDING_KEY]?: string;
        [ASSIGNED_KEY]?: string;
        [INDEXED_KEY]?: string;
        [UNION_A]?: string;
        [UNION_B]?: string;
        [NEVER_KEY]?: string;
      }
      let assigned: string | undefined;
      export function read(props: Props, key: typeof UNION_A | typeof UNION_B) {
        const { [BINDING_KEY]: binding } = props;
        ({ [ASSIGNED_KEY]: assigned } = props);
        return [binding, assigned, props[INDEXED_KEY], props[key]];
      }
    `,
    );

    expect(getUnusedFlags(project, "Props")).toEqual({
      "[BINDING_KEY]": false,
      "[ASSIGNED_KEY]": false,
      "[INDEXED_KEY]": false,
      "[UNION_A]": false,
      "[UNION_B]": false,
      "[NEVER_KEY]": true,
    });
  });

  test("attributes unique symbol reads to the symbol that keys the property", () => {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { strict: true, target: ts.ScriptTarget.ES2022 },
    });
    project.createSourceFile(
      "/types.ts",
      `
      const KEY = Symbol("key");
      const SAME_DESCRIPTION = Symbol("key");
      export interface Keyed { [KEY]?: string; [SAME_DESCRIPTION]?: string; }
      export function read(keyed: Keyed) {
        return keyed[KEY];
      }
    `,
    );

    expect(getUnusedFlags(project, "Keyed")).toEqual({ "[KEY]": false, "[SAME_DESCRIPTION]": true });
  });

  test("attributes keyed reads to the destructured type only", () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    project.createSourceFile(
      "/types.ts",
      `
      export interface Unused { 'shared-key'?: string; }
      export interface Used { 'shared-key'?: string; }
      export function read(used: Used) {
        const { 'shared-key': value } = used;
        return value;
      }
    `,
    );

    expect(getUnusedFlags(project, "Unused")).toEqual({ "'shared-key'": true });
    expect(getUnusedFlags(project, "Used")).toEqual({ "'shared-key'": false });
  });

  test("reports keyed reads that occur only in tests as test-only", () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const file = project.createSourceFile("/types.ts", `export interface Props { 'test-key'?: string; }`);
    project.createSourceFile(
      "/usage.test.ts",
      `
      import type { Props } from "./types";
      export function check(props: Props) {
        const { 'test-key': value } = props;
        return value;
      }
    `,
    );

    const property = file.getInterfaceOrThrow("Props").getPropertyOrThrow("'test-key'");
    expect(isPropertyUnused(property, isTestFile, project)).toEqual({
      isUnusedOrTestOnly: true,
      onlyUsedInTests: true,
    });
  });
});
