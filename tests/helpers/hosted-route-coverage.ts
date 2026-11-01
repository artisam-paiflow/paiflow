import ts from "typescript";

/** Only these exact exports delegate to the hosted guard. An arbitrary wrapper
 * name or sibling route is not a rate-limit/admission exemption. Runtime guard
 * behavior is exercised in hosted-execution/routes and database-lifecycle tests. */
const HOSTED_ROUTES: Record<string, { method: string; action: string | null }> = {
  "app/api/deployments/[id]/hosted-execution/route.ts": { method: "PATCH", action: null },
  "app/api/deployments/[id]/hosted-execution/state/route.ts": { method: "GET", action: "state" },
  "app/api/deployments/[id]/hosted-execution/ownership/route.ts": {
    method: "POST",
    action: "ownership",
  },
  "app/api/deployments/[id]/hosted-execution/prepare/route.ts": {
    method: "POST",
    action: "prepare",
  },
  "app/api/deployments/[id]/hosted-execution/submit/route.ts": { method: "POST", action: "submit" },
  "app/api/deployments/[id]/hosted-execution/receipt/route.ts": {
    method: "POST",
    action: "receipt",
  },
};

export function isGuardedHostedRoute(
  source: string,
  relativePath: string,
  method: string,
): boolean {
  const expected = HOSTED_ROUTES[relativePath.replaceAll("\\", "/")];
  if (!expected || expected.method !== method) return false;
  const guard = expected.action === null ? "updateHostedVisibility" : "hostedPublicRoute";
  const ast = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true);
  const imported = ast.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "@/lib/hosted-execution/routes" &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some(
        (element) => !element.propertyName && element.name.text === guard,
      ),
  );
  if (!imported) return false;
  return ast.statements.some(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
      statement.declarationList.declarations.some((declaration) => {
        if (
          !ts.isIdentifier(declaration.name) ||
          declaration.name.text !== method ||
          !declaration.initializer
        )
          return false;
        const value = declaration.initializer;
        if (expected.action === null) return ts.isIdentifier(value) && value.text === guard;
        return (
          ts.isCallExpression(value) &&
          ts.isIdentifier(value.expression) &&
          value.expression.text === guard &&
          value.arguments.length === 1 &&
          ts.isStringLiteral(value.arguments[0]!) &&
          value.arguments[0]!.text === expected.action
        );
      }),
  );
}
