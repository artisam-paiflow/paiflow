/**
 * Print the `/api/v1` OpenAPI document. `pnpm api:openapi` writes it to `docs/api/openapi.json`;
 * `tests/unit/api/v1/openapi.test.ts` fails when the committed copy falls behind the object.
 */
import { openApiDocument } from "../lib/api/v1/openapi";

process.stdout.write(`${JSON.stringify(openApiDocument, null, 2)}\n`);
