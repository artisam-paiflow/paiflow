import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? routeFiles(full) : entry.name === "route.ts" ? [full] : [];
  });
}
describe("deployment service admission coverage", () => {
  const root = path.join(process.cwd(), "app/api/deployments/[id]");
  for (const file of routeFiles(root)) {
    const relative = path.relative(root, file);
    if (relative === "retirement/route.ts") continue;
    it(`guards ${relative}`, () => {
      const source = readFileSync(file, "utf8");
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const exports = ast.statements.filter(
        (statement) =>
          ts.canHaveModifiers(statement) &&
          ts
            .getModifiers(statement)
            ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
      );
      let guarded = 0;
      for (const statement of exports) {
        if (
          ts.isFunctionDeclaration(statement) &&
          statement.name &&
          /^(GET|POST|PATCH|PUT|DELETE)$/.test(statement.name.text)
        ) {
          // The owner detail read exposes only retirement progress while draining.
          expect(relative === "route.ts" && statement.name.text === "GET").toBe(true);
          expect(source).toContain('serviceState: { not: "RETIRED" }');
        }
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (
            !ts.isIdentifier(declaration.name) ||
            !/^(GET|POST|PATCH|PUT|DELETE)$/.test(declaration.name.text)
          )
            continue;
          expect(
            declaration.initializer &&
              ts.isCallExpression(declaration.initializer) &&
              declaration.initializer.expression.getText(ast) === "deploymentServiceRoute",
          ).toBe(true);
          guarded++;
        }
      }
      expect(guarded).toBeGreaterThan(0);
    });
  }
});
