import { describe, expect, test } from "bun:test";
import assert from "node:assert";
import { Project } from "ts-morph";

describe("fix inline object types", () => {
  test("should preserve inline object type text when removing never-returned union branches", async () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "/test.ts",
      `
      export function processData():
        | { status: "success"; value: string }
        | { status: "error"; reason: string } {
        return { status: "success", value: "ok" };
      }
      `,
    );

    // Simulate what fixProject does
    const func = sourceFile.getFunctions()[0];
    assert(func, "Function not found");

    const returnTypeNode = func.getReturnTypeNode();
    assert(returnTypeNode, "Return type not found");

    const returnType = returnTypeNode.getType();
    const unionTypes = returnType.getUnionTypes();

    // Get the types as they would be collected
    const typesToKeep: string[] = unionTypes
      .map((ut) => {
        const symbol = ut.getSymbol();
        return symbol?.getName() || ut.getText();
      })
      .filter((typeName) => typeName !== '{ status: "error"; reason: string; }');

    // This test documents the bug: typeName for inline objects is __type
    expect(typesToKeep[0]).toBe("__type");

    // When we use setReturnType with __type, it creates invalid code
    func.setReturnType(typesToKeep[0] || "never");

    const fixedCode = sourceFile.getText();
    expect(fixedCode).toContain("__type");
  });

  test("should use getText() instead of symbol name for inline objects", async () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "/test.ts",
      `
      export function processData():
        | { status: "success"; value: string }
        | { status: "error"; reason: string } {
        return { status: "success", value: "ok" };
      }
      `,
    );

    const func = sourceFile.getFunctions()[0];
    assert(func, "Function not found");

    const returnTypeNode = func.getReturnTypeNode();
    assert(returnTypeNode, "Return type not found");

    const returnType = returnTypeNode.getType();
    const unionTypes = returnType.getUnionTypes();

    // Get the types using getText() - the correct approach
    const typesToKeep: string[] = unionTypes
      .map((ut) => ut.getText())
      .filter((typeText) => typeText !== '{ status: "error"; reason: string; }');

    // getText() gives us the actual type text
    expect(typesToKeep[0]).toBe('{ status: "success"; value: string; }');

    // When we use setReturnType with the correct text, it works
    func.setReturnType(typesToKeep[0] || "never");

    const fixedCode = sourceFile.getText();
    // Note: ts-morph may add semicolons in the type
    expect(fixedCode).toMatch(/status: "success"/);
    expect(fixedCode).not.toContain("__type");

    // Should compile without errors
    const diagnostics = project.getPreEmitDiagnostics();
    expect(diagnostics).toHaveLength(0);
  });
});
