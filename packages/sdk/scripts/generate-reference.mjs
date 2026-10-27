import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Application, ReflectionFlag, ReflectionKind } from "typedoc";

// Render into scratch even in check mode. Never rewrite checked-in documentation
// while checking CI drift, and detect stale files left after export removal.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(packageRoot, "../../docs/sdk/reference");
const check = process.argv.includes("--check");
if (process.argv.slice(2).some((argument) => argument !== "--check")) {
  throw new Error("Usage: node generate-reference.mjs [--check]");
}
const scratch = await mkdtemp(join(tmpdir(), "paiflow-sdk-reference-"));
async function files(directory, prefix = "") {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const path = join(prefix, entry.name);
        return entry.isDirectory() ? files(join(directory, entry.name), path) : [path];
      }),
    );
    return nested.flat().sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
try {
  const app = await Application.bootstrapWithPlugins({
    options: resolve(packageRoot, "typedoc.json"),
    out: scratch,
  });
  const project = await app.convert();
  if (!project) throw new Error("SDK reference conversion failed");
  // Inferred object properties can carry implementation expressions such as `net`
  // as defaults. They are not public defaults; omit these generator artefacts.
  // Parameter defaults also convey optionality in TypeDoc; retain those.
  for (const reflection of Object.values(project.reflections)) {
    if (reflection.kindOf(ReflectionKind.Property)) delete reflection.defaultValue;
    // The Markdown plugin's inline function signatures only inspect this flag,
    // whereas parameter sections also inspect defaults. Keep both views aligned.
    if (reflection.kindOf(ReflectionKind.Parameter) && reflection.defaultValue !== undefined) {
      const parameters = reflection.parent.parameters;
      const following = parameters.slice(parameters.indexOf(reflection) + 1);
      if (
        following.every(
          (parameter) =>
            parameter.flags.isOptional ||
            parameter.flags.isRest ||
            parameter.defaultValue !== undefined,
        )
      ) {
        reflection.flags.setFlag(ReflectionFlag.Optional, true);
      }
    }
  }
  await app.generateOutputs(project);
  if (app.logger.hasErrors() || app.logger.hasWarnings()) {
    throw new Error("Resolve SDK reference generator warnings/errors before publishing");
  }
  const generated = await files(scratch);
  if (check) {
    const existing = await files(destination);
    const differences = [...new Set([...generated, ...existing])].filter(
      (path) => !generated.includes(path) || !existing.includes(path),
    );
    for (const path of generated.filter((path) => existing.includes(path))) {
      if (!(await readFile(join(scratch, path))).equals(await readFile(join(destination, path)))) {
        differences.push(path);
      }
    }
    if (differences.length) {
      throw new Error(`SDK reference is stale. Run pnpm sdk:docs.\n${differences.join("\n")}`);
    }
    process.stdout.write(`SDK reference is current (${generated.length} files).\n`);
  } else {
    await rm(destination, { recursive: true, force: true });
    await cp(scratch, destination, { recursive: true });
    process.stdout.write(`Generated SDK reference (${generated.length} files).\n`);
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
