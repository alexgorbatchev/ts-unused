import { describe, expect, test } from "bun:test";
import { Project, SyntaxKind } from "ts-morph";
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
