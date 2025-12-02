import { Project, SyntaxKind } from "ts-morph";

const project = new Project({
  tsConfigFilePath: "/Users/agorbatchev/Development/github/ts-unused/.tmp/worktrees/enum-return-types/test-project/tsconfig.json",
});

const sourceFiles = project.getSourceFiles();
const sourceFile = sourceFiles.find((f) => f.getFilePath().includes("enum-return-types.ts"));

if (!sourceFile) {
  console.log("File not found");
  process.exit(1);
}

const func = sourceFile.getFunction("getStatus");
if (!func) {
  console.log("Function not found");
  process.exit(1);
}

const returnTypeNode = func.getReturnTypeNode();
const returnType = returnTypeNode?.getType();

console.log("=== getStatus return type analysis ===");
console.log("Return type text:", returnType?.getText());
console.log("Is union?", returnType?.isUnion());
console.log("Is enum?", returnType?.isEnum());
console.log("Is enum literal?", returnType?.isEnumLiteral());

const symbol = returnType?.getSymbol();
console.log("\nSymbol:", symbol?.getName());
console.log("Symbol flags:", symbol?.getFlags());

if (returnType?.isUnion()) {
  const unionTypes = returnType.getUnionTypes();
  console.log("\n=== Union branches ===");
  console.log("Count:", unionTypes.length);
  
  for (const branch of unionTypes) {
    console.log("\nBranch:", branch.getText());
    console.log("  Is enum?", branch.isEnum());
    console.log("  Is enum literal?", branch.isEnumLiteral());
    
    const branchSymbol = branch.getSymbol();
    console.log("  Symbol:", branchSymbol?.getName());
    console.log("  Symbol flags:", branchSymbol?.getFlags());
    
    // Check parent symbol
    const aliasedSymbol = branch.getAliasSymbol();
    console.log("  Aliased symbol:", aliasedSymbol?.getName());
  }
}

// Check enum declaration
const statusEnum = sourceFile.getEnum("Status");
if (statusEnum) {
  console.log("\n=== Status enum ===");
  console.log("Members:", statusEnum.getMembers().map(m => m.getName()));
  const enumType = statusEnum.getType();
  console.log("Enum type text:", enumType.getText());
  console.log("Is enum?", enumType.isEnum());
}
