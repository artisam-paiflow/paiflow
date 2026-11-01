import assert from "node:assert/strict";
import { test } from "node:test";
import { Paiflow, PaiflowMalformedResponseError, PaiflowApiError } from "../dist/index.js";
const templateId = "11111111-1111-4111-8111-111111111111",
  versionId = "22222222-2222-4222-8222-222222222222",
  deploymentId = "33333333-3333-4333-8333-333333333333";
const wallet = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  contract = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const txHash = "a".repeat(64),
  passphrase = "Test SDF Network ; September 2015";
const request = {
  sourceAccount: wallet,
  bindings: {
    version: 1,
    templateVersionId: versionId,
    values: [{ inputId: "amount", value: { type: "stroops", value: "9007199254740993" } }],
  },
  idempotencyKey: "persistent-original-instance-key",
};
const state = {
  deploymentId,
  templateId,
  templateVersionId: versionId,
  network: "testnet",
  sourceAccount: wallet,
  status: "PENDING_SIGNATURE",
  serviceState: "ACTIVE",
  txHash,
  contractAddress: contract,
  pipeline: [{ nodeId: "pay", contractAddress: contract, templateKind: "PAYER" }],
  prepared: {
    xdr: "unsigned-instance-envelope",
    networkPassphrase: passphrase,
    txHash,
    expiresAt: "2099-01-01T00:00:00Z",
    feeStroops: "1000",
  },
};
const response = (data) =>
  new Response(JSON.stringify({ data }), { headers: { "x-history-request-id": templateId } });
const setup = (fetch) =>
  new Paiflow({
    baseUrl: "https://example.com",
    token: "pfd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    fetch,
  }).flowTemplate(templateId);
test("private instance prepare/sign/submit uses explicit template path, key and original developer source", async () => {
  const calls = [];
  const t = setup(async (url, init) => {
    calls.push({ url, init });
    return response(calls.length === 1 ? state : { ...state, status: "SUBMITTED", prepared: null });
  });
  const prepared = await t.instances.prepare(versionId, request);
  assert.equal(prepared.data.prepared.txHash, txHash);
  const signed = await t.instances.sign(
    prepared,
    async (wire) => {
      assert.equal(wire.walletAddress, wallet);
      assert.equal(wire.xdr, state.prepared.xdr);
      assert.equal(wire.networkPassphrase, passphrase);
      return { signedXdr: "signed-instance-envelope" };
    },
    { walletAddress: wallet, expectedNetwork: "testnet" },
  );
  assert.equal(signed.preparation, prepared);
  const submitted = await t.instances.submit(
    deploymentId,
    signed.submission,
    signed.submissionOptions,
  );
  assert.equal(submitted.data.status, "SUBMITTED");
  assert.equal(calls.length, 2);
  assert.equal(
    calls[0].url.pathname,
    `/api/v1/flow-templates/${templateId}/versions/${versionId}/instances/prepare`,
  );
  assert.deepEqual(JSON.parse(calls[0].init.body), request);
  assert.equal(
    calls[0].init.headers.get("authorization"),
    "Bearer pfd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assert.equal(calls[1].init.headers.get("x-preparation-request-id"), templateId);
});
test("uncertain submission never prepares, signs or submits another transaction automatically", async () => {
  let count = 0;
  const t = setup(async () => {
    count++;
    throw new Error("signed private payload");
  });
  await assert.rejects(t.instances.submit(deploymentId, { signedXdr: "signed-instance-envelope" }));
  assert.equal(count, 1);
});
test("typed creation input rejects hidden authority, duplicate values and wrong version before HTTP", async () => {
  let calls = 0;
  const t = setup(async () => {
    calls++;
    return response(state);
  });
  for (const body of [
    { ...request, graph: {} },
    { ...request, sourceAccount: contract },
    { ...request, idempotencyKey: "short" },
    {
      ...request,
      bindings: {
        ...request.bindings,
        values: [...request.bindings.values, ...request.bindings.values],
      },
    },
    {
      ...request,
      bindings: {
        ...request.bindings,
        values: [{ inputId: "amount", value: { type: "stroops", value: "01" } }],
      },
    },
    { ...request, bindings: { ...request.bindings, templateVersionId: templateId } },
  ])
    assert.throws(() => t.instances.prepare(versionId, body), TypeError);
  assert.equal(calls, 0);
});
test("response scope, source, network and receipt identities are validated", async () => {
  for (const value of [
    { ...state, templateId: deploymentId },
    { ...state, templateVersionId: templateId },
    { ...state, sourceAccount: contract },
    {
      ...state,
      prepared: {
        ...state.prepared,
        networkPassphrase: "Public Global Stellar Network ; September 2015",
      },
    },
    { ...state, prepared: { ...state.prepared, txHash: "b".repeat(64) } },
  ])
    await assert.rejects(
      setup(async () => response(value)).instances.prepare(versionId, request),
      PaiflowMalformedResponseError,
    );
});
test("retired, unknown and expired preparations never invite automatic signing", async () => {
  let signs = 0;
  const signer = async () => {
    signs++;
    return { signedXdr: "signed-instance-envelope" };
  };
  const t = setup(async () => response(state));
  for (const data of [
    { ...state, serviceState: "RETIRING" },
    { ...state, status: "SUBMITTED", prepared: null },
    { ...state, prepared: { ...state.prepared, expiresAt: "2000-01-01T00:00:00Z" } },
  ])
    await assert.rejects(
      t.instances.sign({ data, metadata: { status: 200 } }, signer, { walletAddress: wallet }),
    );
  assert.equal(signs, 0);
});
test("instance listing, event history and reconciliation stay within the selected template", async () => {
  const calls = [];
  const t = setup(async (url, init) => {
    calls.push({ url, init });
    if (url.pathname.endsWith("/instances")) return response({ items: [state], nextCursor: null });
    if (url.pathname.endsWith("/events"))
      return response({ items: [], nextCursor: null, hasMore: false });
    return response({ ...state, status: "SUBMITTED", prepared: null });
  });
  assert.equal((await t.instances.list({ limit: 2 })).data.items[0].deploymentId, deploymentId);
  assert.equal((await t.instances.events(deploymentId, { limit: 2 })).data.hasMore, false);
  assert.equal((await t.instances.reconcile(deploymentId)).data.status, "SUBMITTED");
  assert.equal(JSON.parse(calls[2].init.body).constructor, Object);
});
test("permission refusals stay API errors without hidden retries", async () => {
  let calls = 0;
  const t = setup(async () => {
    calls++;
    return new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "read only" } }), {
      status: 403,
    });
  });
  await assert.rejects(t.instances.prepare(versionId, request), PaiflowApiError);
  assert.equal(calls, 1);
});

// Promoted from the independent review's SDK canonicalization/receipt probes.
const letterTemplate = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const letterVersion = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const letterInstance = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const foreignInstance = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const scopedState = {
  ...state,
  templateId: letterTemplate,
  templateVersionId: letterVersion,
  deploymentId: letterInstance,
};
const scopedClient = (fetch, id = letterTemplate) =>
  new Paiflow({
    baseUrl: "https://example.com",
    token: "pfd_" + "a".repeat(64),
    fetch,
  }).flowTemplate(id);
test("uppercase template/version/instance inputs retain canonical scope through prepare, get and sign", async () => {
  const calls = [];
  const t = scopedClient(async (url) => {
    calls.push(url.pathname);
    return response(scopedState);
  }, letterTemplate.toUpperCase());
  const prepared = await t.instances.prepare(letterVersion.toUpperCase(), {
    ...request,
    bindings: { ...request.bindings, templateVersionId: letterVersion.toUpperCase() },
  });
  assert.equal(
    (await t.instances.get(letterInstance.toUpperCase())).data.deploymentId,
    letterInstance,
  );
  let signs = 0;
  const signed = await t.instances.sign(
    prepared,
    async () => {
      signs++;
      return { signedXdr: "signed-instance-envelope" };
    },
    { walletAddress: wallet, expectedNetwork: "testnet" },
  );
  assert.equal(signs, 1);
  assert.equal(signed.preparation, prepared);
  assert.equal(signed.preparation.data.deploymentId, letterInstance);
  assert.equal(t.templateId, letterTemplate);
  assert.deepEqual(calls, [
    `/api/v1/flow-templates/${letterTemplate}/versions/${letterVersion}/instances/prepare`,
    `/api/v1/flow-templates/${letterTemplate}/instances/${letterInstance}`,
  ]);
});
test("get, submit and reconcile refuse another instance's receipt within the same template", async () => {
  const t = scopedClient(async () =>
    response({
      ...scopedState,
      deploymentId: foreignInstance,
      status: "SUBMITTED",
      prepared: null,
    }),
  );
  for (const id of [letterInstance, letterInstance.toUpperCase()]) {
    await assert.rejects(t.instances.get(id), PaiflowMalformedResponseError);
    await assert.rejects(
      t.instances.submit(id, { signedXdr: "signed-instance-envelope" }),
      PaiflowMalformedResponseError,
    );
    await assert.rejects(t.instances.reconcile(id), PaiflowMalformedResponseError);
  }
});
test("submit/reconcile canonicalize requested IDs and accept only their own receipt", async () => {
  const calls = [];
  const t = scopedClient(async (url) => {
    calls.push(url.pathname);
    return response({ ...scopedState, status: "SUBMITTED", prepared: null });
  });
  assert.equal(
    (
      await t.instances.submit(letterInstance.toUpperCase(), {
        signedXdr: "signed-instance-envelope",
      })
    ).data.deploymentId,
    letterInstance,
  );
  assert.equal(
    (await t.instances.reconcile(letterInstance.toUpperCase())).data.deploymentId,
    letterInstance,
  );
  assert.deepEqual(
    calls,
    ["submit", "reconcile"].map(
      (action) => `/api/v1/flow-templates/${letterTemplate}/instances/${letterInstance}/${action}`,
    ),
  );
});
test("sign refuses preparations from another template without invoking the signer", async () => {
  let signs = 0;
  await assert.rejects(
    scopedClient(async () => response(scopedState)).instances.sign(
      { data: { ...scopedState, templateId: foreignInstance }, metadata: { status: 200 } },
      async () => {
        signs++;
        return { signedXdr: "signed-instance-envelope" };
      },
      { walletAddress: wallet },
    ),
    TypeError,
  );
  assert.equal(signs, 0);
});
