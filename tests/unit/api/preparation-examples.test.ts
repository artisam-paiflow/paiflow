import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, it } from "vitest";

function execute(code: string) {
  execFileSync(process.execPath, ["--input-type=module"], {
    input: `import assert from "node:assert/strict";\n${code}`,
    stdio: ["pipe", "pipe", "pipe"],
  });
}
function compile(code: string) {
  return transpileModule(code, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022, jsx: JsxEmit.React },
  }).outputText;
}

describe("documented preparation correlation", () => {
  it("Postman preserves execute correlation and retry data after failed preparations", () => {
    const collection = JSON.parse(
      readFileSync("docs/api/paiflow-api-v1.postman_collection.json", "utf8"),
    );
    execute(`
      const collection = ${JSON.stringify(collection)};
      const variables = new Map(), headers = new Map();
      const pm = {
        collectionVariables: {
          get: key => variables.get(key), set: (key, value) => variables.set(key, value),
          unset: key => variables.delete(key),
        },
        request: { headers: { remove: key => headers.delete(key), upsert: ({ key, value }) => headers.set(key, value) } },
        response: {
          code: 200, headers: { get: () => responseId },
          json: () => ({ data: { xdr: "new-unsigned" } }),
          to: { have: { status: code => assert.equal(pm.response.code, code) } },
        },
        expect: value => ({ to: { be: { a: type => assert.equal(typeof value, type) } } }),
        test: (_, callback) => {
          try { callback(); } catch (error) { if (pm.response.code === 200) throw error; }
        },
      };
      let responseId;
      // Execute the published collection scripts in a child process, with no HTTP requests.
      ${["Prepare execute", "Submit execute"]
        .map((name) => {
          const item = collection.item.find((i: { name: string }) => i.name === name);
          return (item.event ?? [])
            .map(
              (event: { listen: string; script: { exec: string[] } }, index: number) =>
                `function script_${name.replaceAll(" ", "_")}_${index}() { ${event.script.exec.join("\n")} }`,
            )
            .join("\n");
        })
        .join("\n")}
      const run = (name, listen) => {
        const item = collection.item.find(i => i.name === name);
        for (const [index, event] of (item.event ?? []).entries()) {
          if (event.listen !== listen) continue;
          const functions = {
            ${["Prepare execute", "Submit execute"]
              .map((name) => {
                const item = collection.item.find((i: { name: string }) => i.name === name);
                return (item.event ?? [])
                  .map(
                    (_: unknown, index: number) =>
                      `${JSON.stringify(name + index)}: script_${name.replaceAll(" ", "_")}_${index}`,
                  )
                  .join(",\n");
              })
              .join(",\n")}
          };
          functions[name + index]();
        }
      };
      responseId = "execute-id";
      run("Prepare execute", "prerequest"); run("Prepare execute", "test");
      for (let retry = 0; retry < 2; retry++) {
        run("Submit execute", "prerequest"); assert.equal(headers.get("x-preparation-request-id"), "execute-id");
      }
      const executeBody = collection.item.find(i => i.name === "Submit execute").request.body.raw;
      assert.equal(JSON.parse(executeBody).signedXdr, "{{executeSignedXdr}}");
      variables.set("executeUnsignedXdr", "old-execute"); variables.set("executeSignedXdr", "signed-execute");
      pm.response.code = 422;
      run("Prepare execute", "prerequest"); run("Prepare execute", "test");
      assert.equal(variables.get("executeUnsignedXdr"), "old-execute");
      assert.equal(variables.get("executeSignedXdr"), "signed-execute");
      run("Submit execute", "prerequest"); assert.equal(headers.get("x-preparation-request-id"), "execute-id");
      pm.response.code = 409;
      run("Prepare execute", "prerequest"); run("Prepare execute", "test");
      assert.equal(variables.get("executeUnsignedXdr"), "old-execute");
      assert.equal(variables.get("executeSignedXdr"), "signed-execute");
      run("Submit execute", "prerequest"); assert.equal(headers.get("x-preparation-request-id"), "execute-id");
      pm.response.code = 200; responseId = null;
      run("Prepare execute", "prerequest"); run("Prepare execute", "test");
      assert.equal(variables.get("executeUnsignedXdr"), "new-unsigned");
      assert.equal(variables.has("executeSignedXdr"), false);
      run("Submit execute", "prerequest"); assert.equal(headers.has("x-preparation-request-id"), false);
    `);
  });
  it.each(["docs/hackathon/web3-iloilo/llms.md"])(
    "%s keeps concurrent execute preparations and retries separate",
    (file) => {
      const source = readFileSync(file, "utf8");
      const helper = source.match(/```ts\n(import "server-only";[\s\S]*?)\n```/)![1]!;
      execute(`
        ${compile(helper.replace('import "server-only";', ""))}
        process.env.PAIFLOW_MODE = "team";
        process.env.PAIFLOW_BASE_URL = "https://beta.app.paiflow.xyz";
        process.env.PAIFLOW_DEPLOYMENT_ID = "test-deployment";
        process.env.PAIFLOW_API_TOKEN = "test-token";
        const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
        let preparedCount = 0, failedOnce = false;
        const submits = [];
        globalThis.fetch = async (url, options) => {
          if (url.pathname.endsWith("/submit")) {
            submits.push({ path: url.pathname, headers: options.headers, body: JSON.parse(options.body) });
            if (!failedOnce) {
              failedOnce = true;
              return Response.json({ error: { code: "UPSTREAM_RPC", message: "Uncertain" } }, { status: 502 });
            }
            return Response.json({ data: { status: "SUCCESS", txHash: "synthetic" } }, {
              headers: { "x-history-request-id": "33333333-3333-4333-8333-333333333333" },
            });
          }
          const id = ids[preparedCount++];
          return Response.json({ data: { xdr: "prepared-" + preparedCount } }, {
            headers: id ? { "x-history-request-id": id } : {},
          });
        };
        const first = await prepareExecute({ from: "source", amount: "1" });
        const second = await prepareExecute({ from: "source", amount: "2" });
        const firstSubmit = { signedXdr: "signed-first", preparationRequestId: first.preparationRequestId };
        await assert.rejects(submitExecute(firstSubmit), { message: "Uncertain" });
        await submitExecute(firstSubmit, false);
        await submitExecute({ signedXdr: "signed-second", preparationRequestId: second.preparationRequestId });
        assert.deepEqual(submits.map(s => s.headers["x-preparation-request-id"]), [ids[0], ids[0], ids[1]]);
        assert.deepEqual(submits.map(s => s.body), [{ signedXdr: "signed-first" }, { signedXdr: "signed-first" }, { signedXdr: "signed-second" }]);
        const legacy = await prepareExecute({ from: "source", amount: "1" });
        assert.equal(legacy.preparationRequestId, null);
        await submitExecute({ signedXdr: "legacy", preparationRequestId: legacy.preparationRequestId });
        assert.equal(submits.at(-1).headers["x-preparation-request-id"], undefined);
      `);
    },
  );

  it("the SDK context keeps concurrent preparation metadata and exact-envelope retries separate", () => {
    const source = readFileSync("docs/hackathon/llms.md", "utf8");
    const helper = source.match(/```ts\n(import "server-only";[\s\S]*?)\n```/)![1]!;
    execute(`
      ${compile(helper.replace('import "server-only";', ""))}
      const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
      let preparedCount = 0, failedOnce = false;
      const submits = [];
      const deployment = {
        capabilities: { get: async () => ({ data: { network: "testnet", inputAsset: { kind: "native" }, triggerType: "deposit", operations: { execute: { status: "supported" } } } }) },
        execute: {
          prepare: async body => {
            assert.deepEqual(body, { from: "customer", amount: "10000000" });
            return { data: { xdr: "unsigned-" + preparedCount }, metadata: { historyRequestId: ids[preparedCount++] } };
          },
          submit: async (body, options) => {
            submits.push({ body, options });
            if (!failedOnce) { failedOnce = true; throw new Error("Uncertain"); }
            return { data: { status: "PENDING" }, metadata: {} };
          },
        },
      };
      const first = await prepareExecute(deployment, "customer");
      const second = await prepareExecute(deployment, "customer");
      await assert.rejects(submitExecute(deployment, first, "signed-first"), { message: "Uncertain" });
      await submitExecute(deployment, first, "signed-first");
      await submitExecute(deployment, second, "signed-second");
      assert.deepEqual(submits.map(s => s.options.preparationRequestId), [ids[0], ids[0], ids[1]]);
      assert.deepEqual(submits.map(s => s.body), [{ signedXdr: "signed-first" }, { signedXdr: "signed-first" }, { signedXdr: "signed-second" }]);
      assert.ok(submits.every(s => s.options.wait === false));
      const uncorrelated = await prepareExecute(deployment, "customer");
      await submitExecute(deployment, uncorrelated, "same-original");
      assert.equal(submits.at(-1).options.preparationRequestId, undefined);
    `);
  });

  it("the HTTP README server example forwards only a validated ID and keeps bearer tokens server-side", () => {
    const source = readFileSync("docs/api/README.md", "utf8").split(
      "## Custom browser and server integration",
    )[1]!;
    const route = source.match(/```javascript\n([\s\S]*?)\n```/)![1]!;
    execute(`
      ${route.replace('import "server-only";', "")}
      const id = "11111111-1111-4111-8111-111111111111";
      process.env.PAIFLOW_BASE_URL = "https://beta.app.paiflow.xyz";
      process.env.PAIFLOW_DEPLOYMENT_ID = id;
      process.env.PAIFLOW_API_TOKEN = "pfk_" + "a".repeat(64);
      const calls = [];
      globalThis.fetch = async (url, options) => {
        calls.push({ url: String(url), options });
        return Response.json({ data: { xdr: "unsigned" } }, { headers: { "x-history-request-id": id } });
      };
      const request = body => new Request("https://checkout.test/api/payment", {
        method: "POST", body: JSON.stringify(body),
      });
      const prepared = await POST(request({ action: "prepare", from: "G" + "A".repeat(55) }));
      assert.equal(prepared.headers.get("x-history-request-id"), id);
      assert.equal(calls[0].options.headers["x-preparation-request-id"], undefined);
      for (let retry = 0; retry < 2; retry++) {
        const response = await POST(request({ action: "submit", signedXdr: "synthetic-envelope", preparationRequestId: id }));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("Authorization"), null);
        assert.equal(calls.at(-1).options.headers["x-preparation-request-id"], id);
        assert.deepEqual(JSON.parse(calls.at(-1).options.body), { signedXdr: "synthetic-envelope" });
      }
      process.env.PAIFLOW_API_TOKEN = "pfd_" + "b".repeat(64);
      assert.equal((await POST(request({ action: "prepare", from: "G" + "A".repeat(55) }))).status, 200);
      assert.equal(calls.at(-1).options.headers.Authorization, "Bearer " + process.env.PAIFLOW_API_TOKEN);
      const before = calls.length;
      for (const preparationRequestId of ["not-a-uuid", {}, 123]) {
        assert.equal((await POST(request({ action: "submit", signedXdr: "synthetic-envelope", preparationRequestId }))).status, 422);
      }
      assert.equal(calls.length, before);
      assert.equal((await POST(request({ action: "submit", signedXdr: "synthetic-envelope" }))).status, 200);
      assert.equal(calls.at(-1).options.headers["x-preparation-request-id"], undefined);
    `);
  });

  it("the HTTP README browser example retains the preparation ID after an uncertain submit and refreshes it for a new payment", () => {
    const source = readFileSync("docs/api/README.md", "utf8").split(
      "## Custom browser and server integration",
    )[1]!;
    const page = source
      .match(/```jsx\n([\s\S]*?)\n```/)![1]!
      .replace(/import \{ useRef, useState \} from "react";/, "")
      .replace(/import \{[\s\S]*?\} from "@stellar\/freighter-api";/, "");
    execute(`
      const refs = [];
      const useRef = value => { const ref = { current: value }; refs.push(ref); return ref; };
      const useState = value => [value, () => {}];
      const React = { createElement: (type, props, ...children) => ({ type, props, children }) };
      const from = "G" + "A".repeat(55);
      const requestAccess = async () => ({ address: from });
      const getAddress = async () => ({ address: from });
      const getNetworkDetails = async () => ({ networkPassphrase: "Test SDF Network ; September 2015" });
      const signTransaction = async xdr => ({ signedTxXdr: "signed-" + xdr, signerAddress: from });
      ${compile(page)}
      const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
      let prepareCount = 0;
      const submissions = [];
      globalThis.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        if (body.action === "prepare") {
          const id = ids[prepareCount++];
          return Response.json({ data: { xdr: id, network: "testnet", networkPassphrase: TESTNET, expiresAt: new Date(Date.now()+60000).toISOString() } }, { headers: { "x-history-request-id": id } });
        }
        submissions.push(body);
        if (submissions.length === 1) return Response.json({ error: { message: "Uncertain" } }, { status: 502 });
        return Response.json({ data: { status: "SUCCESS", txHash: "synthetic" } });
      };
      const tree = Checkout();
      const buttons = tree.children.filter(node => node?.type === "button");
      await buttons[0].props.onClick();
      assert.equal(refs[0].current.preparationRequestId, ids[0]);
      await buttons[1].props.onClick();
      assert.equal(refs[0].current, null);
      await buttons[0].props.onClick();
      assert.deepEqual(submissions.map(s => s.preparationRequestId), [ids[0], ids[0], ids[1]]);
      assert.equal(submissions[0].signedXdr, submissions[1].signedXdr);
      assert.notEqual(submissions[1].signedXdr, submissions[2].signedXdr);
    `);
  });
});
