import { describe, expect, test } from "bun:test";
import assert from "node:assert";
import { Node, Project } from "ts-morph";
import { extractTodoComment, hasUnusedIgnoreComment } from "../extractTodoComment";

describe("extractTodoComment", () => {
  test("extracts single-line TODO comment", () => {
    const project: Project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "test.ts",
      `export interface TestInterface {
  // TODO implement this feature
  prop: string;
}`,
    );

    const iface = sourceFile.getInterfaces()[0];
    const prop = iface?.getProperties()[0];
    expect(prop).toBeDefined();

    const result: string | undefined = extractTodoComment(prop!);

    expect(result).toBe("implement this feature");
  });

  test("extracts TODO comment with extra spaces", () => {
    const project: Project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "test.ts",
      `export interface TestInterface {
  //   TODO   this has extra spaces
  prop: string;
}`,
    );

    const iface = sourceFile.getInterfaces()[0];
    const prop = iface?.getProperties()[0];

    const result: string | undefined = extractTodoComment(prop!);

    expect(result).toBe("this has extra spaces");
  });

  test("extracts multi-line TODO comment", () => {
    const project: Project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "test.ts",
      `export interface TestInterface {
  /* TODO this is a
     multi-line comment */
  prop: string;
}`,
    );

    const iface = sourceFile.getInterfaces()[0];
    const prop = iface?.getProperties()[0];

    const result: string | undefined = extractTodoComment(prop!);

    expect(result).toBe("this is a multi-line comment");
  });

  test("extracts JSDoc-style TODO comment", () => {
    const project: Project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "test.ts",
      `export interface TestInterface {
  /** TODO document this property */
  prop: string;
}`,
    );

    const iface = sourceFile.getInterfaces()[0];
    const prop = iface?.getProperties()[0];

    const result: string | undefined = extractTodoComment(prop!);

    expect(result).toBe("document this property");
  });

  test("returns undefined when no TODO comment exists", () => {
    const project: Project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "test.ts",
      `export interface TestInterface {
  // Regular comment
  prop: string;
}`,
    );

    const iface = sourceFile.getInterfaces()[0];
    const prop = iface?.getProperties()[0];

    const result: string | undefined = extractTodoComment(prop!);

    expect(result).toBeUndefined();
  });

  test("returns undefined when property has no comments", () => {
    const project: Project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "test.ts",
      `export interface TestInterface {
  prop: string;
}`,
    );

    const iface = sourceFile.getInterfaces()[0];
    const prop = iface?.getProperties()[0];

    const result: string | undefined = extractTodoComment(prop!);

    expect(result).toBeUndefined();
  });

  test("handles TODO in lowercase", () => {
    const project: Project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "test.ts",
      `export interface TestInterface {
  // todo implement this
  prop: string;
}`,
    );

    const iface = sourceFile.getInterfaces()[0];
    const prop = iface?.getProperties()[0];

    const result: string | undefined = extractTodoComment(prop!);

    expect(result).toBe("implement this");
  });

  test("handles TODO with mixed case", () => {
    const project: Project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "test.ts",
      `export interface TestInterface {
  // Todo implement this
  prop: string;
}`,
    );

    const iface = sourceFile.getInterfaces()[0];
    const prop = iface?.getProperties()[0];

    const result: string | undefined = extractTodoComment(prop!);

    expect(result).toBe("implement this");
  });

  test("extracts TODO from first comment when multiple comments exist", () => {
    const project: Project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "test.ts",
      `export interface TestInterface {
  // TODO first todo
  // Another comment
  prop: string;
}`,
    );

    const iface = sourceFile.getInterfaces()[0];
    const prop = iface?.getProperties()[0];

    const result: string | undefined = extractTodoComment(prop!);

    expect(result).toBe("first todo");
  });

  test("works with type aliases", () => {
    const project: Project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "test.ts",
      `export type TestType = {
  // TODO implement this property
  prop: string;
};`,
    );

    const typeAlias = sourceFile.getTypeAliases()[0];
    const typeNode = typeAlias?.getTypeNode();

    // Get the type literal and its members
    assert(typeNode && Node.isTypeLiteral(typeNode), "Expected type literal");
    const members = typeNode.getMembers();
    const prop = members?.[0];

    expect(prop).toBeDefined();
    expect(Node.isPropertySignature(prop!)).toBe(true);

    assert(Node.isPropertySignature(prop!));
    const result: string | undefined = extractTodoComment(prop);

    expect(result).toBe("implement this property");
  });

  test("extracts real-world TODO comment", () => {
    const project: Project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "test.ts",
      `export interface UpdateCommandSpecificOptions {
  // TODO --yes is not yet implemented
  yes: boolean;
  shimMode: boolean;
}`,
    );

    const iface = sourceFile.getInterfaces()[0];
    const yesProp = iface?.getProperties()[0];

    const result: string | undefined = extractTodoComment(yesProp!);

    expect(result).toBe("--yes is not yet implemented");
  });

  test("extracts TODO comment from a function", () => {
    const project: Project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "test.ts",
      `// TODO implement this helper function
export function myHelper() {}`,
    );

    const func = sourceFile.getFunctions()[0];
    expect(func).toBeDefined();

    const result: string | undefined = extractTodoComment(func!);
    expect(result).toBe("implement this helper function");
  });
});

describe("hasUnusedIgnoreComment", () => {
  test("returns true for single-line @ts-unused-ignore with required comment", () => {
    const project: Project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "test.ts",
      `// @ts-unused-ignore expected dynamic usage
export function unusedFunc() {}`,
    );

    const func = sourceFile.getFunctions()[0];
    expect(func).toBeDefined();
    expect(hasUnusedIgnoreComment(func!)).toBe(true);
  });

  test("returns false for @ts-unused-ignore without a required comment", () => {
    const project: Project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "test.ts",
      `// @ts-unused-ignore
export function unusedFunc() {}`,
    );

    const func = sourceFile.getFunctions()[0];
    expect(func).toBeDefined();
    expect(hasUnusedIgnoreComment(func!)).toBe(false);
  });

  test("returns true for multi-line @ts-unused-ignore with required comment", () => {
    const project: Project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "test.ts",
      `export interface MyInterface {
  /* @ts-unused-ignore needed for dynamic reflection */
  prop: string;
}`,
    );

    const iface = sourceFile.getInterfaces()[0];
    const prop = iface?.getProperties()[0];
    expect(prop).toBeDefined();
    expect(hasUnusedIgnoreComment(prop!)).toBe(true);
  });
});
