import createOxlintConfig, { FilenameStyle } from "@alexgorbatchev/typescript-ai-policy/oxlint-config";

export default createOxlintConfig({
  filenameStyle: FilenameStyle.PascalCase,
  ignorePatterns: ["dist/**", "coverage/**", "test-project/**", "node_modules/**"],
});
