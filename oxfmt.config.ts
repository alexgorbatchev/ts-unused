import createOxfmtConfig from "@alexgorbatchev/typescript-ai-policy/oxfmt-config";

export default createOxfmtConfig(() => ({
  ignorePatterns: ["dist/**", "coverage/**", "test-project/**", "node_modules/**"],
}));
