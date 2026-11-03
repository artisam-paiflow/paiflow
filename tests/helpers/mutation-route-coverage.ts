import ts from "typescript";

/** These exact owner exports delegate authentication, an owner/action rate bucket
 * and durable service admission to lib/mutations/http. Sibling paths, aliases and
 * arbitrary wrapper names do not qualify. Runtime delegation is tested separately. */
const MUTATION_ROUTES: Record<string, { method: string; action: string }> = {
  "app/api/deployments/[id]/configuration/route.ts": { method: "GET", action: "state" },
  "app/api/deployments/[id]/configuration/history/route.ts": { method: "GET", action: "history" },
  "app/api/deployments/[id]/configuration/prepare/route.ts": { method: "POST", action: "prepare" },
  "app/api/deployments/[id]/configuration/submit/route.ts": { method: "POST", action: "submit" },
  "app/api/deployments/[id]/configuration/reconcile/route.ts": {
    method: "POST",
    action: "reconcile",
  },
};

export function isGuardedMutationRoute(
  source: string,
  relativePath: string,
  method: string,
): boolean {
  const expected = MUTATION_ROUTES[relativePath.replaceAll("\\", "/")];
  if (!expected || expected.method !== method) return false;
  const ast = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true);
  const imported = ast.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "@/lib/mutations/http" &&
      !statement.importClause?.isTypeOnly &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some(
        (element) =>
          !element.isTypeOnly &&
          !element.propertyName &&
          element.name.text === "ownerMutationRoute",
      ),
  );
  if (!imported) return false;
  return ast.statements.some(
    (statement) =>
      ts.isVariableStatement(statement) &&
      !!(statement.declarationList.flags & ts.NodeFlags.Const) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
      statement.declarationList.declarations.some((declaration) => {
        if (
          !ts.isIdentifier(declaration.name) ||
          declaration.name.text !== method ||
          !declaration.initializer
        )
          return false;
        const value = declaration.initializer;
        return (
          ts.isCallExpression(value) &&
          ts.isIdentifier(value.expression) &&
          value.expression.text === "ownerMutationRoute" &&
          !value.typeArguments?.length &&
          value.arguments.length === 1 &&
          ts.isStringLiteral(value.arguments[0]!) &&
          value.arguments[0]!.text === expected.action
        );
      }),
  );
}
