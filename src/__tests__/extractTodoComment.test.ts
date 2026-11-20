import { describe, expect, test } from "bun:test";
import assert from "node:assert";
import {
  isFunctionDeclaration,
  isInterfaceDeclaration,
  isPropertySignatureDeclaration,
  isTypeAliasDeclaration,
  isTypeLiteralNode,
} from "typescript/ast";
import { API } from "typescript/async";
import { extractTodoComment, extractIgnoreComment } from "../extractTodoComment";

describe("extractTodoComment", () => {
  test("extracts single-line TODO comment", async () => {
    await using api = new API();
    await using parsed = await api.createSourceFile(
      "/test.ts",
      `export interface TestInterface {
  // TODO implement this feature
  prop: string;
}`,
    );

    const iface = parsed.sourceFile.statements.filter(isInterfaceDeclaration)[0];
    const prop = iface?.members[0];
    expect(prop).toBeDefined();

    const result: string | undefined = extractTodoComment(prop!);

    expect(result).toBe("implement this feature");
  });

  test("extracts TODO comment with extra spaces", async () => {
    await using api = new API();
    await using parsed = await api.createSourceFile(
      "/test.ts",
      `export interface TestInterface {
  //   TODO   this has extra spaces
  prop: string;
}`,
    );

    const iface = parsed.sourceFile.statements.filter(isInterfaceDeclaration)[0];
    const prop = iface?.members[0];

    const result: string | undefined = extractTodoComment(prop!);

    expect(result).toBe("this has extra spaces");
  });

  test("extracts multi-line TODO comment", async () => {
    await using api = new API();
    await using parsed = await api.createSourceFile(
      "/test.ts",
      `export interface TestInterface {
  /* TODO this is a
     multi-line comment */
  prop: string;
}`,
    );

    const iface = parsed.sourceFile.statements.filter(isInterfaceDeclaration)[0];
    const prop = iface?.members[0];

    const result: string | undefined = extractTodoComment(prop!);

    expect(result).toBe("this is a multi-line comment");
  });

  test("extracts JSDoc-style TODO comment", async () => {
    await using api = new API();
    await using parsed = await api.createSourceFile(
      "/test.ts",
      `export interface TestInterface {
  /** TODO document this property */
  prop: string;
}`,
    );

    const iface = parsed.sourceFile.statements.filter(isInterfaceDeclaration)[0];
    const prop = iface?.members[0];

    const result: string | undefined = extractTodoComment(prop!);

    expect(result).toBe("document this property");
  });

  test("returns undefined when no TODO comment exists", async () => {
    await using api = new API();
    await using parsed = await api.createSourceFile(
      "/test.ts",
      `export interface TestInterface {
  // Regular comment
  prop: string;
}`,
    );

    const iface = parsed.sourceFile.statements.filter(isInterfaceDeclaration)[0];
    const prop = iface?.members[0];

    const result: string | undefined = extractTodoComment(prop!);

    expect(result).toBeUndefined();
  });

  test("returns undefined when property has no comments", async () => {
    await using api = new API();
    await using parsed = await api.createSourceFile(
      "/test.ts",
      `export interface TestInterface {
  prop: string;
}`,
    );

    const iface = parsed.sourceFile.statements.filter(isInterfaceDeclaration)[0];
    const prop = iface?.members[0];

    const result: string | undefined = extractTodoComment(prop!);

    expect(result).toBeUndefined();
  });

  test("handles TODO in lowercase", async () => {
    await using api = new API();
    await using parsed = await api.createSourceFile(
      "/test.ts",
      `export interface TestInterface {
  // todo implement this
  prop: string;
}`,
    );

    const iface = parsed.sourceFile.statements.filter(isInterfaceDeclaration)[0];
    const prop = iface?.members[0];

    const result: string | undefined = extractTodoComment(prop!);

    expect(result).toBe("implement this");
  });

  test("handles TODO with mixed case", async () => {
    await using api = new API();
    await using parsed = await api.createSourceFile(
      "/test.ts",
      `export interface TestInterface {
  // Todo implement this
  prop: string;
}`,
    );

    const iface = parsed.sourceFile.statements.filter(isInterfaceDeclaration)[0];
    const prop = iface?.members[0];

    const result: string | undefined = extractTodoComment(prop!);

    expect(result).toBe("implement this");
  });

  test("extracts TODO from first comment when multiple comments exist", async () => {
    await using api = new API();
    await using parsed = await api.createSourceFile(
      "/test.ts",
      `export interface TestInterface {
  // TODO first todo
  // Another comment
  prop: string;
}`,
    );

    const iface = parsed.sourceFile.statements.filter(isInterfaceDeclaration)[0];
    const prop = iface?.members[0];

    const result: string | undefined = extractTodoComment(prop!);

    expect(result).toBe("first todo");
  });

  test("works with type aliases", async () => {
    await using api = new API();
    await using parsed = await api.createSourceFile(
      "/test.ts",
      `export type TestType = {
  // TODO implement this property
  prop: string;
};`,
    );

    const typeAlias = parsed.sourceFile.statements.filter(isTypeAliasDeclaration)[0];
    const typeNode = typeAlias?.type;

    // Get the type literal and its members
    assert(typeNode && isTypeLiteralNode(typeNode), "Expected type literal");
    const members = typeNode.members;
    const prop = members?.[0];

    expect(prop).toBeDefined();
    expect(isPropertySignatureDeclaration(prop!)).toBe(true);

    assert(isPropertySignatureDeclaration(prop!));
    const result: string | undefined = extractTodoComment(prop);

    expect(result).toBe("implement this property");
  });

  test("extracts real-world TODO comment", async () => {
    await using api = new API();
    await using parsed = await api.createSourceFile(
      "/test.ts",
      `export interface UpdateCommandSpecificOptions {
  // TODO --yes is not yet implemented
  yes: boolean;
  shimMode: boolean;
}`,
    );

    const iface = parsed.sourceFile.statements.filter(isInterfaceDeclaration)[0];
    const yesProp = iface?.members[0];

    const result: string | undefined = extractTodoComment(yesProp!);

    expect(result).toBe("--yes is not yet implemented");
  });

  test("extracts TODO comment from a function", async () => {
    await using api = new API();
    await using parsed = await api.createSourceFile(
      "/test.ts",
      `// TODO implement this helper function
export function myHelper() {}`,
    );

    const func = parsed.sourceFile.statements.filter(isFunctionDeclaration)[0];
    expect(func).toBeDefined();

    const result: string | undefined = extractTodoComment(func!);
    expect(result).toBe("implement this helper function");
  });
});

describe("extractIgnoreComment", () => {
  test("extracts reason for single-line @ts-unused-ignore with required comment", async () => {
    await using api = new API();
    await using parsed = await api.createSourceFile(
      "/test.ts",
      `// @ts-unused-ignore expected dynamic usage
export function unusedFunc() {}`,
    );

    const func = parsed.sourceFile.statements.filter(isFunctionDeclaration)[0];
    expect(func).toBeDefined();
    expect(extractIgnoreComment(func!)).toBe("expected dynamic usage");
  });

  test("returns undefined for @ts-unused-ignore without a required comment", async () => {
    await using api = new API();
    await using parsed = await api.createSourceFile(
      "/test.ts",
      `// @ts-unused-ignore
export function unusedFunc() {}`,
    );

    const func = parsed.sourceFile.statements.filter(isFunctionDeclaration)[0];
    expect(func).toBeDefined();
    expect(extractIgnoreComment(func!)).toBeUndefined();
  });

  test("extracts reason for multi-line @ts-unused-ignore with required comment", async () => {
    await using api = new API();
    await using parsed = await api.createSourceFile(
      "/test.ts",
      `export interface MyInterface {
  /* @ts-unused-ignore needed for dynamic reflection */
  prop: string;
}`,
    );

    const iface = parsed.sourceFile.statements.filter(isInterfaceDeclaration)[0];
    const prop = iface?.members[0];
    expect(prop).toBeDefined();
    expect(extractIgnoreComment(prop!)).toBe("needed for dynamic reflection");
  });
});
