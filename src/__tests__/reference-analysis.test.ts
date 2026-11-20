import { expect, spyOn, test } from "bun:test";
import { Project } from "ts-morph";
import { checkExportUsage } from "../checkExportUsage";
import { findReferenceNodes } from "../findReferenceNodes";
import { isPropertyUnused } from "../isPropertyUnused";
import { isTestFile } from "../isTestFile";
import { createClassifyUsageSource } from "../usageSourceUtils";

test("locates uses of generic values without expanding their inferred types for display", () => {
  const project = new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true });
  const keys = Array.from({ length: 160 }, (_, index) => JSON.stringify(`key${index}`)).join(" | ");
  const file = project.createSourceFile(
    "/reference.ts",
    `
      declare function create<T extends string>(): { [P in T]: { [Q in T]: { [R in T]: P | Q | R } } };
      export const value = create<${keys}>();
      value;
    `,
  );
  const declaration = file.getVariableDeclarationOrThrow("value");

  expect(
    checkExportUsage("value", [declaration], file, "/", createClassifyUsageSource(isTestFile, [], "/")),
  ).toBeNull();
  expect(project.getLanguageService().compilerObject.getProgram()?.getInstantiationCount()).toBe(0);
});

test("does not expand unrelated mapped types when tracing a property's value flows", () => {
  const project = new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true });
  const keys = Array.from({ length: 160 }, (_, index) => JSON.stringify(`key${index}`)).join(" | ");
  const file = project.createSourceFile(
    "/reference.ts",
    `
      interface Unused { untouched: string; }
      type Keys = ${keys};
      type Expanded = { [P in Keys]: { [Q in Keys]: P | Q } };
      const unrelated: Expanded = {};
      unrelated;
    `,
  );
  const property = file.getInterfaceOrThrow("Unused").getPropertyOrThrow("untouched");
  project.getTypeChecker();
  const program = project.getProgram().compilerObject;
  const initialSymbols = program.getSymbolCount();

  expect(isPropertyUnused(property, createClassifyUsageSource(isTestFile, [], "/"), project)).toEqual({
    isUnusedOrTestOnly: true,
    onlyUsedInTests: false,
    onlyUsedInStories: false,
  });
  expect(program.getSymbolCount() - initialSymbols).toBeLessThan(160);
});

test("reuses contextual value flows when tracing different property names", () => {
  const project = new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true });
  const file = project.createSourceFile(
    "/flow.ts",
    `interface Source { first: string; second: string; }
     interface Destination { first: string; second: string; }
     function pass(value: Source): Destination { return value; }
     function read(value: Destination) { return value.second; }`,
  );
  const source = file.getInterfaceOrThrow("Source");
  const classify = createClassifyUsageSource(isTestFile, [], "/");
  const contextual = spyOn(project.getTypeChecker().compilerObject, "getContextualType");
  try {
    expect(isPropertyUnused(source.getPropertyOrThrow("first"), classify, project).isUnusedOrTestOnly).toBe(true);
    const calls = contextual.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(isPropertyUnused(source.getPropertyOrThrow("second"), classify, project).isUnusedOrTestOnly).toBe(false);
    expect(contextual.mock.calls.length).toBe(calls);
  } finally {
    contextual.mockRestore();
  }
});

test("checks contextual property writes without instantiating a second semantic program", () => {
  const project = new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true });
  const file = project.createSourceFile(
    "/reference.ts",
    `
      interface Props { value: string; }
      declare function Component(props: Props): void;
      type Args<F> = F extends (props: infer P) => void ? P : never;
      type Meta<F> = { args: Args<F> };
      const story: Meta<typeof Component> = { args: { value: "used" } };
    `,
  );

  expect(
    isPropertyUnused(
      file.getInterfaceOrThrow("Props").getPropertyOrThrow("value"),
      createClassifyUsageSource(isTestFile, [], "/"),
      project,
    ).isUnusedOrTestOnly,
  ).toBe(false);
  expect(project.getLanguageService().compilerObject.getProgram()?.getInstantiationCount()).toBe(0);
});

test("finds imports of an anonymous default function", () => {
  const project = new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true });
  const source = project.createSourceFile("/source.ts", "export default function () {}");
  const consumer = project.createSourceFile("/consumer.ts", 'import run from "./source"; run();');
  const references = findReferenceNodes(source.getFunctions()[0]!);
  expect(references.some((node) => node.getSourceFile() === consumer)).toBe(true);
});
