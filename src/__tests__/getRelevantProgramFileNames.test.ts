import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { API } from "typescript/async";
import { getRelevantProgramFileNames } from "../getRelevantProgramFileNames";
import { loadProject, resolveConfigPath } from "../loadProject";

type ProjectSetupFn = (root: string) => Promise<void>;

interface IProjectFilesResult {
  relevant: string[];
  all: string[];
  root: string;
}

const noOpSetup: ProjectSetupFn = async () => {};

async function withProject(
  compilerOptions: Record<string, unknown>,
  files: Record<string, string>,
  setup: ProjectSetupFn = noOpSetup,
): Promise<IProjectFilesResult> {
  const root = await mkdtemp(path.join(tmpdir(), "ts-unused-relevant-"));
  try {
    const configPath = path.join(root, "tsconfig.json");
    await writeFile(
      configPath,
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          ...compilerOptions,
        },
        include: ["src/**/*.ts"],
      }),
    );
    for (const [relativePath, content] of Object.entries(files)) {
      const fullPath = path.join(root, relativePath);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content);
    }
    await setup(root);
    const resolvedConfig = resolveConfigPath(configPath);
    await using api = new API();
    await using loaded = await loadProject(api, resolvedConfig);
    const all = await loaded.project.program.getSourceFileNames();
    const relevant = await getRelevantProgramFileNames(loaded.project);
    const cached = await getRelevantProgramFileNames(loaded.project);
    expect(cached).toBe(relevant);
    return {
      all: all.map((file) => path.relative(root, file)),
      relevant: relevant.map((file) => path.relative(root, file)),
      root,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("skips hermetically sealed node_modules declarations", async () => {
  const { all, relevant } = await withProject(
    {},
    {
      "node_modules/sealed/package.json": JSON.stringify({ name: "sealed", types: "index.d.ts" }),
      "node_modules/sealed/index.d.ts": "export interface External { label: string; }\n",
      "src/index.ts": 'import type { External } from "sealed";\nexport const value: External = { label: "ok" };\n',
    },
  );
  expect(all).toContain("node_modules/sealed/index.d.ts");
  expect(relevant).toEqual(["src/index.ts"]);
});

test("includes node_modules declarations that escape into project files and their importers", async () => {
  const { relevant } = await withProject(
    {},
    {
      "src/types.ts": "export interface Props { value: string; }\n",
      "node_modules/leaf/package.json": JSON.stringify({ name: "leaf", types: "index.d.ts" }),
      "node_modules/leaf/index.d.ts":
        'import type { Props } from "../../src/types";\nexport type Value = Props["value"];\n',
      "node_modules/wrapper/package.json": JSON.stringify({ name: "wrapper", types: "index.d.ts" }),
      "node_modules/wrapper/index.d.ts": 'export type { Value } from "leaf";\n',
      "node_modules/unrelated/package.json": JSON.stringify({ name: "unrelated", types: "index.d.ts" }),
      "node_modules/unrelated/index.d.ts": "export interface Other { count: number; }\n",
      "src/index.ts":
        'import type { Value } from "wrapper";\nimport type { Other } from "unrelated";\nexport declare const x: Value;\nexport declare const y: Other;\n',
    },
  );
  expect(relevant).toContain("src/index.ts");
  expect(relevant).toContain("src/types.ts");
  expect(relevant).toContain("node_modules/leaf/index.d.ts");
  expect(relevant).toContain("node_modules/wrapper/index.d.ts");
  expect(relevant).not.toContain("node_modules/unrelated/index.d.ts");
});

test("includes node_modules declarations that import through non-node_modules tsconfig paths", async () => {
  const { relevant } = await withProject(
    { paths: { "@app/*": ["./src/*"] } },
    {
      "src/types.ts": "export interface Props { value: string; }\n",
      "node_modules/plugin/package.json": JSON.stringify({ name: "plugin", types: "index.d.ts" }),
      "node_modules/plugin/index.d.ts":
        'import type { Props } from "@app/types";\nexport type Value = Props["value"];\n',
      "src/index.ts": 'import type { Value } from "plugin";\nexport declare const x: Value;\n',
    },
  );
  expect(relevant).toContain("node_modules/plugin/index.d.ts");
});

test("includes workspace packages symlinked outside node_modules", async () => {
  const { relevant } = await withProject(
    {},
    {
      "packages/shared/package.json": JSON.stringify({ name: "shared-local", types: "index.d.ts" }),
      "packages/shared/index.d.ts": "export interface Shared { id: string; }\n",
      "src/index.ts": 'import type { Shared } from "shared-local";\nexport const item: Shared = { id: "1" };\n',
    },
    async (root) => {
      await mkdir(path.join(root, "node_modules"), { recursive: true });
      await symlink(path.join(root, "packages/shared"), path.join(root, "node_modules/shared-local"), "dir");
    },
  );
  expect(relevant.some((file) => file.endsWith("shared/index.d.ts") || file.endsWith("shared-local/index.d.ts"))).toBe(
    true,
  );
});
