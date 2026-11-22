import {
  isArrayLiteralExpression,
  isAsExpression,
  isAssertionExpression,
  isArrowFunction,
  isAwaitExpression,
  isBinaryExpression,
  isBindingElement,
  isCallExpression,
  isComputedPropertyName,
  isConditionalExpression,
  isExpression,
  isInterfaceDeclaration,
  isJsxExpression,
  isJsxSpreadAttribute,
  isNewExpression,
  isNonNullExpression,
  isObjectLiteralExpression,
  isParameterDeclaration,
  isParenthesizedExpression,
  isPropertyAssignment,
  isPropertyDeclaration,
  isPropertySignatureDeclaration,
  isReturnStatement,
  isSatisfiesExpression,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isSpreadElement,
  isTypeNode,
  isVariableDeclaration,
  isYieldExpression,
  SyntaxKind,
  type Expression,
  type Node,
  type ObjectLiteralExpression,
} from "typescript/ast";
import { type Project, type Symbol, SymbolFlags, type Type, TypeFlags } from "typescript/async";
import { declarationLocation } from "./findNativeUsedImports.js";
import { getKeySymbols, handleLocation } from "./findNativePropertyAccesses.js";
import { getRelevantProgramFileNames } from "./getRelevantProgramFileNames.js";
import { toComparablePath } from "./mapBuildOutputsToSources.js";

const OBJECT_LIKE_FLAGS = TypeFlags.Object | TypeFlags.Intersection | TypeFlags.Union | TypeFlags.Instantiable;
const RPC_BATCH_SIZE = 64;

interface IContextualFlow {
  expression: Expression;
  file: string;
}

interface ISpreadFlow {
  object: ObjectLiteralExpression;
  file: string;
}

interface IHeritageFlow {
  derived: Type;
  base: Type;
  file: string;
}

interface IRelationIndex {
  contextual: Map<Type, IContextualFlow[]>;
  spreads: ISpreadFlow[];
  heritage: IHeritageFlow[];
  relevantPaths: Set<string>;
}

export interface IPropertyRelation {
  property: string;
  file: string;
}

type NativeRelations = Map<string, IPropertyRelation[]>;
type TypeAtNode = (node: Node) => Promise<Type>;
type ContextualTypeAt = (expression: Expression) => Promise<Type | undefined>;
type PropertyAtType = (type: Type, name: string) => Promise<Symbol | undefined>;
type PropertyLocations = (type: Type, name: string) => Promise<string[]>;
type RelationsByName = (name: string) => Promise<NativeRelations>;

interface IRelationQueries {
  typeAt: TypeAtNode;
  getProperty: PropertyAtType;
  getProperties: PropertyLocations;
  getContextualType: ContextualTypeAt;
}

function canProduceObject(node: Expression): boolean {
  switch (node.kind) {
    case SyntaxKind.NumericLiteral:
    case SyntaxKind.BigIntLiteral:
    case SyntaxKind.StringLiteral:
    case SyntaxKind.RegularExpressionLiteral:
    case SyntaxKind.NoSubstitutionTemplateLiteral:
    case SyntaxKind.TemplateExpression:
    case SyntaxKind.TrueKeyword:
    case SyntaxKind.FalseKeyword:
    case SyntaxKind.NullKeyword:
    case SyntaxKind.ArrowFunction:
    case SyntaxKind.FunctionExpression:
    case SyntaxKind.ClassExpression:
    case SyntaxKind.ArrayLiteralExpression:
    case SyntaxKind.JsxElement:
    case SyntaxKind.JsxSelfClosingElement:
    case SyntaxKind.JsxFragment:
    case SyntaxKind.PrefixUnaryExpression:
    case SyntaxKind.PostfixUnaryExpression:
    case SyntaxKind.TypeOfExpression:
    case SyntaxKind.VoidExpression:
    case SyntaxKind.DeleteExpression:
      return false;
    case SyntaxKind.BinaryExpression: {
      if (!isBinaryExpression(node)) return false;
      const operator = node.operatorToken.kind;
      return (
        operator === SyntaxKind.EqualsToken ||
        operator === SyntaxKind.AmpersandAmpersandToken ||
        operator === SyntaxKind.BarBarToken ||
        operator === SyntaxKind.QuestionQuestionToken ||
        operator === SyntaxKind.AmpersandAmpersandEqualsToken ||
        operator === SyntaxKind.BarBarEqualsToken ||
        operator === SyntaxKind.QuestionQuestionEqualsToken ||
        operator === SyntaxKind.CommaToken
      );
    }
    default:
      return true;
  }
}

function isInContextualPosition(node: Expression): boolean {
  let current: Node = node;
  while (true) {
    const parent = current.parent;
    if (!parent) return false;
    if (
      isVariableDeclaration(parent) ||
      isParameterDeclaration(parent) ||
      isPropertyDeclaration(parent) ||
      isPropertySignatureDeclaration(parent) ||
      isBindingElement(parent)
    ) {
      return parent.initializer === current;
    }
    if (isReturnStatement(parent) || isYieldExpression(parent) || isSatisfiesExpression(parent)) {
      return parent.expression === current;
    }
    if (isSpreadElement(parent) || isJsxSpreadAttribute(parent) || isJsxExpression(parent)) {
      return parent.expression === current;
    }
    if (isArrowFunction(parent)) {
      return parent.body === current;
    }
    if (isPropertyAssignment(parent)) {
      return parent.initializer === current;
    }
    if (isShorthandPropertyAssignment(parent)) {
      return parent.name === current || parent.objectAssignmentInitializer === current;
    }
    if (isArrayLiteralExpression(parent)) {
      return true;
    }
    if (isCallExpression(parent) || isNewExpression(parent)) {
      return isExpression(current) && Boolean(parent.arguments?.includes(current));
    }
    if (isBinaryExpression(parent)) {
      const operator = parent.operatorToken.kind;
      if (
        operator === SyntaxKind.EqualsToken ||
        operator === SyntaxKind.AmpersandAmpersandEqualsToken ||
        operator === SyntaxKind.BarBarEqualsToken ||
        operator === SyntaxKind.QuestionQuestionEqualsToken
      ) {
        return parent.right === current;
      }
      if (
        operator === SyntaxKind.AmpersandAmpersandToken ||
        operator === SyntaxKind.BarBarToken ||
        operator === SyntaxKind.QuestionQuestionToken
      ) {
        current = parent;
        continue;
      }
      if (operator === SyntaxKind.CommaToken) {
        if (parent.right !== current) return false;
        current = parent;
        continue;
      }
      return false;
    }
    if (isConditionalExpression(parent)) {
      if (parent.whenTrue === current || parent.whenFalse === current) {
        current = parent;
        continue;
      }
      return false;
    }
    if (isParenthesizedExpression(parent) || isAwaitExpression(parent) || isNonNullExpression(parent)) {
      current = parent;
      continue;
    }
    if (isAsExpression(parent) || isAssertionExpression(parent)) {
      return parent.expression === current;
    }
    return false;
  }
}

async function getDeclarationLocations(property: Symbol, relevantPaths: ReadonlySet<string>): Promise<string[]> {
  const handles = property.declarations.filter(
    (handle) => handle.kind === SyntaxKind.PropertySignature || handle.kind === SyntaxKind.PropertyDeclaration,
  );
  if (!handles.length) return [];
  const locations: string[] = [];
  for (const handle of handles) {
    if (!relevantPaths.has(toComparablePath(handle.path))) {
      locations.push(handleLocation(handle));
      continue;
    }
    const node = await handle.resolve();
    if (node && (isPropertySignatureDeclaration(node) || isPropertyDeclaration(node))) {
      locations.push(declarationLocation(node.getSourceFile().fileName, node.getStart()));
    }
  }
  return locations;
}

function connect(originals: string[], destinations: string[], file: string, relations: NativeRelations): void {
  for (const original of originals) {
    for (const destination of destinations) {
      if (original === destination) continue;
      const edges = relations.get(original) ?? [];
      edges.push({ property: destination, file });
      relations.set(original, edges);
    }
  }
}

async function connectSpreads(
  project: Project,
  { object, file }: ISpreadFlow,
  name: string,
  relations: NativeRelations,
  { typeAt, getProperty, getProperties, getContextualType }: IRelationQueries,
): Promise<void> {
  const properties = object.properties;
  for (const [index, member] of properties.entries()) {
    if (!isSpreadAssignment(member)) continue;
    const source = await typeAt(member.expression);
    const originals = await getProperties(source, name);
    if (!originals.length) continue;
    let overwritten = false;
    for (const later of properties.slice(index + 1)) {
      if (isSpreadAssignment(later)) {
        const property = await getProperty(await typeAt(later.expression), name);
        overwritten = property !== undefined && !(property.flags & SymbolFlags.Optional);
      } else if (later.name) {
        if (isComputedPropertyName(later.name)) {
          const type = await typeAt(later.name.expression);
          overwritten =
            !type.isUnionType() &&
            (await getKeySymbols(project, source, later.name, true)).some((property) => property.name === name);
        } else {
          overwritten = later.name.text === name;
        }
      }
      if (overwritten) break;
    }
    if (!overwritten) {
      const target = (await getContextualType(object)) ?? (await typeAt(object));
      connect(originals, await getProperties(target, name), file, relations);
    }
  }
}

async function indexRelations(project: Project, getContextualType: ContextualTypeAt): Promise<IRelationIndex> {
  const relevantFiles = await getRelevantProgramFileNames(project);
  const relevantPaths = new Set(relevantFiles.map(toComparablePath));
  const index: IRelationIndex = { contextual: new Map(), spreads: [], heritage: [], relevantPaths };
  const checker = project.checker;
  for (const file of relevantFiles) {
    const source = await project.program.getSourceFile(file);
    if (!source) continue;
    for (const statement of source.statements) {
      if (!isInterfaceDeclaration(statement) || !statement.heritageClauses) continue;
      const derived = await checker.getTypeAtLocation(statement);
      for (const base of (await derived.getBaseTypes()) ?? []) {
        index.heritage.push({ derived, base, file: source.fileName });
      }
    }
    if (source.isDeclarationFile) continue;
    const expressions: Expression[] = [];
    const visit = (node: Node): void => {
      if (isTypeNode(node)) return;
      node.forEachChild(visit);
      if (!isExpression(node)) return;
      if (isObjectLiteralExpression(node)) {
        if (!node.properties.some(isSpreadAssignment)) return;
        index.spreads.push({ object: node, file: source.fileName });
      }
      const parent = node.parent;
      if (
        isSpreadAssignment(parent) ||
        (!isShorthandPropertyAssignment(parent) && "name" in parent && parent.name === node)
      ) {
        return;
      }
      if (!canProduceObject(node) || !isInContextualPosition(node)) return;
      expressions.push(node);
    };
    source.forEachChild(visit);
    for (let offset = 0; offset < expressions.length; offset += RPC_BATCH_SIZE) {
      const batch = expressions.slice(offset, offset + RPC_BATCH_SIZE);
      const targets = await Promise.all(batch.map(getContextualType));
      for (const [position, expression] of batch.entries()) {
        const target = targets[position];
        if (!target || !(target.flags & OBJECT_LIKE_FLAGS)) continue;
        const flows = index.contextual.get(target) ?? [];
        flows.push({ expression, file: source.fileName });
        index.contextual.set(target, flows);
      }
    }
  }
  return index;
}

/** Indexes explicit inheritance and property value flows once and loads edges on demand. */
export function createNativePropertyRelations(project: Project): RelationsByName {
  let indexPromise: Promise<IRelationIndex> | undefined;
  const names = new Map<string, Promise<NativeRelations>>();
  const typeAtNode = new WeakMap<Node, Promise<Type>>();
  const contextualTypeAt = new WeakMap<Expression, Promise<Type | undefined>>();
  const propertyByNameOfType = new WeakMap<Type, Map<string, Promise<Symbol | undefined>>>();
  const allPropertiesOfType = new WeakMap<Type, Promise<Map<string, Symbol>>>();
  const locationsOfProperty = new WeakMap<Symbol, Promise<string[]>>();

  const typeAt = (node: Node): Promise<Type> => {
    const cached = typeAtNode.get(node);
    if (cached) return cached;
    const type = project.checker.getTypeAtLocation(node);
    typeAtNode.set(node, type);
    return type;
  };
  const getContextualType = (expression: Expression): Promise<Type | undefined> => {
    const cached = contextualTypeAt.get(expression);
    if (cached) return cached;
    const type = project.checker.getContextualType(expression);
    contextualTypeAt.set(expression, type);
    return type;
  };
  const getProperty = async (type: Type, name: string): Promise<Symbol | undefined> => {
    if (name.startsWith("__@")) {
      let properties = allPropertiesOfType.get(type);
      if (!properties) {
        properties = type.getProperties().then((symbols) => new Map(symbols.map((symbol) => [symbol.name, symbol])));
        allPropertiesOfType.set(type, properties);
      }
      return (await properties).get(name);
    }
    let byName = propertyByNameOfType.get(type);
    if (!byName) {
      byName = new Map();
      propertyByNameOfType.set(type, byName);
    }
    let property = byName.get(name);
    if (!property) {
      property = project.checker.getPropertyOfType(type, name);
      byName.set(name, property);
    }
    return property;
  };
  const build = async (name: string): Promise<NativeRelations> => {
    const index = await (indexPromise ??= indexRelations(project, getContextualType));
    const getProperties: PropertyLocations = async (type, propName) => {
      const property = await getProperty(type, propName);
      if (!property) return [];
      const cached = locationsOfProperty.get(property);
      if (cached) return cached;
      const locations = getDeclarationLocations(property, index.relevantPaths);
      locationsOfProperty.set(property, locations);
      return locations;
    };
    const relations: NativeRelations = new Map();
    for (const { derived, base, file } of index.heritage) {
      const [properties, inherited] = await Promise.all([getProperties(derived, name), getProperties(base, name)]);
      connect(inherited, properties, file, relations);
      connect(properties, inherited, file, relations);
    }
    for (const spread of index.spreads) {
      await connectSpreads(project, spread, name, relations, { typeAt, getProperty, getProperties, getContextualType });
    }
    const contextualEntries = [...index.contextual.entries()];
    for (let offset = 0; offset < contextualEntries.length; offset += RPC_BATCH_SIZE) {
      const batch = contextualEntries.slice(offset, offset + RPC_BATCH_SIZE);
      const destinationsBatch = await Promise.all(batch.map(([target]) => getProperties(target, name)));
      for (const [position, [, flows]] of batch.entries()) {
        const destinations = destinationsBatch[position]!;
        if (!destinations.length) continue;
        for (const flow of flows) {
          connect(await getProperties(await typeAt(flow.expression), name), destinations, flow.file, relations);
        }
      }
    }
    return relations;
  };
  return (name) => {
    const previous = names.get(name);
    if (previous) return previous;
    const result = build(name);
    names.set(name, result);
    return result;
  };
}
