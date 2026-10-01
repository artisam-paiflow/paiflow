import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type Module = { client: boolean; server: boolean; imports: string[] };

function parseModule(file: string, source: string): Module {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const first = ast.statements[0];
  const imports: string[] = [];
  for (const statement of ast.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      // Type-only edges are erased before bundling and cannot pull server
      // code into a client bundle. Mixed imports still follow their values.
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.isTypeOnly) continue;
        if (
          !clause?.name &&
          clause?.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.length > 0 &&
          clause.namedBindings.elements.every((element) => element.isTypeOnly)
        )
          continue;
      } else if (statement.isTypeOnly) {
        continue;
      }
      imports.push(statement.moduleSpecifier.text);
    }
  }
  return {
    client:
      !!first &&
      ts.isExpressionStatement(first) &&
      ts.isStringLiteral(first.expression) &&
      first.expression.text === "use client",
    server: imports.includes("server-only"),
    imports: imports.filter((specifier) => specifier.startsWith(".") || specifier.startsWith("@/")),
  };
}

function serverImportChains(
  modules: Map<string, Module>,
  resolve: (specifier: string, importer: string) => string | undefined,
): string[] {
  const failures: string[] = [];
  for (const [entry, module] of modules) {
    if (!module.client) continue;
    const seen = new Set<string>();
    const visit = (file: string, chain: string[]) => {
      if (seen.has(file)) return;
      seen.add(file);
      const current = modules.get(file);
      if (!current) throw new Error(`Missing source module: ${chain.join(" -> ")}`);
      if (current.server) {
        failures.push([...chain, 'import "server-only"'].join(" -> "));
        return;
      }
      for (const specifier of current.imports) {
        const dependency = resolve(specifier, file);
        // CSS, images and JSON cannot import server-only. Unresolved source
        // imports fail closed so an alias/resolution change cannot hide a chain.
        if (/\.(css|scss|sass|svg|png|jpg|jpeg|webp|gif|ico|json)$/.test(specifier)) continue;
        if (!dependency) throw new Error(`Cannot resolve ${specifier}: ${chain.join(" -> ")}`);
        visit(dependency, [...chain, dependency]);
      }
    };
    visit(entry, [entry]);
  }
  return failures;
}

function fixtureChains(sources: Record<string, string>): string[] {
  const modules = new Map(
    Object.entries(sources).map(([file, source]) => [file, parseModule(file, source)]),
  );
  return serverImportChains(modules, (specifier, importer) => {
    const target = specifier.startsWith("@/")
      ? specifier.slice(2)
      : path.posix.join(path.posix.dirname(importer), specifier);
    return [target, `${target}.ts`, `${target}/index.ts`].find((file) => modules.has(file));
  });
}

describe("client import boundary", () => {
  it("reports the full transitive chain through aliases, relative imports and re-exports", () => {
    expect(
      fixtureChains({
        "client.ts": '// a comment\n"use client"; import { value } from "@/shared";',
        "shared.ts": 'export { value } from "./barrel";',
        "barrel/index.ts": 'import "../server";',
        "server.ts": 'const value = 1; import "server-only";',
      }),
    ).toEqual(['client.ts -> shared.ts -> barrel/index.ts -> server.ts -> import "server-only"']);
  });

  it("handles cycles and ignores comments and non-directive strings", () => {
    expect(
      fixtureChains({
        "client.ts": '"use client"; import "./shared";',
        "shared.ts": '// import "server-only";\nimport "./client";',
        "server.ts": 'const directive = "use client"; import "server-only";',
      }),
    ).toEqual([]);
  });

  it("ignores erased type-only imports and exports but follows mixed value imports", () => {
    expect(
      fixtureChains({
        "client.ts":
          '"use client"; import type { A } from "./server"; import { type B } from "./server"; export type { C } from "./server";',
        "server.ts": 'import "server-only";',
      }),
    ).toEqual([]);
    expect(
      fixtureChains({
        "client.ts": '"use client"; import { type A, value } from "./server";',
        "server.ts": 'import "server-only";',
      }),
    ).toEqual(['client.ts -> server.ts -> import "server-only"']);
  });

  it("keeps every use-client entry point and every flow module free of server-only dependencies", () => {
    const root = process.cwd();
    const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
    const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
    const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
    const files = ts.sys.readDirectory(root, extensions, [
      "**/node_modules/**",
      "**/.*/**",
      "contracts/**",
    ]);
    const modules = new Map(
      files.map((file) => [
        path.relative(root, file),
        parseModule(file, readFileSync(file, "utf8")),
      ]),
    );
    const clients = [...modules.values()].filter((module) => module.client);
    expect(clients.length).toBeGreaterThan(0);
    // Flow helpers are shared with the builder even if no client imports a
    // particular helper yet; server workflows belong outside lib/flows.
    for (const [file, module] of modules) {
      if (file.startsWith("lib/flows/")) module.client = true;
    }
    const cache = ts.createModuleResolutionCache(root, (file) => file, options);
    const failures = serverImportChains(modules, (specifier, importer) => {
      const resolved = ts.resolveModuleName(
        specifier,
        path.join(root, importer),
        options,
        ts.sys,
        cache,
      ).resolvedModule;
      return resolved ? path.relative(root, resolved.resolvedFileName) : undefined;
    });
    expect(
      failures,
      `Server-only imports reachable from client code:\n${failures.join("\n")}`,
    ).toEqual([]);
  });
});
