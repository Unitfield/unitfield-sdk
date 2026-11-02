import assert from "node:assert/strict";
import test from "node:test";
import { PACKAGES, plan } from "./release-plan.mjs";
import { registryState } from "./registry.mjs";

const manifests = {
  "packages/sdk/package.json": { name: "@unitfield/sdk", version: "0.1.4" },
  "packages/react/package.json": { name: "@unitfield/react", version: "0.1.0" },
  "packages/create-unitfield-site/package.json": { name: "create-unitfield-site", version: "0.1.0" },
};
const read = async (file) => JSON.stringify(Object.entries(manifests).find(([path]) => file.endsWith(path))[1]);

test("publishes a new version of a package that exists, and skips the rest", async () => {
  const known = { "@unitfield/sdk": { exists: true, hasVersion: false }, "@unitfield/react": { exists: false, hasVersion: false }, "create-unitfield-site": { exists: true, hasVersion: true } };
  const result = await plan(PACKAGES, { read, state: async (name) => known[name] });
  assert.deepEqual(
    result.map(({ output, publish }) => [output, publish]),
    [["sdk", true], ["react", false], ["create", false]],
  );
  assert.match(result[1].reason, /first publish is manual/);
  assert.match(result[2].reason, /already on npm/);
});

test("never plans a private package", async () => {
  const result = await plan([{ output: "x", directory: "packages/sdk" }], { read: async () => JSON.stringify({ name: "x", version: "1.0.0", private: true }), state: async () => assert.fail("private packages are not looked up") });
  assert.deepEqual(result, []);
});

test("the registry: a 404 is an absent package, a version list decides the rest", async () => {
  const answer = (status, body) => async () => new Response(JSON.stringify(body ?? {}), { status });
  assert.deepEqual(await registryState("@unitfield/react", "0.1.0", answer(404)), { exists: false, hasVersion: false });
  assert.deepEqual(await registryState("@unitfield/sdk", "0.1.3", answer(200, { versions: { "0.1.3": {} } })), { exists: true, hasVersion: true });
  assert.deepEqual(await registryState("@unitfield/sdk", "0.1.4", answer(200, { versions: { "0.1.3": {} } })), { exists: true, hasVersion: false });
});

test("the registry: anything else than 200 or 404 is an error, never 'absent'", async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    await assert.rejects(registryState("@unitfield/sdk", "0.1.3", async () => new Response("", { status })), /cannot tell/);
  }
  await assert.rejects(registryState("@unitfield/sdk", "0.1.3", async () => {
    throw new TypeError("fetch failed");
  }), /fetch failed/);
});

test("scoped names are encoded for the registry URL", async () => {
  let requested;
  await registryState("@unitfield/react", "0.1.0", async (url) => {
    requested = String(url);
    return new Response("{}", { status: 404 });
  });
  assert.equal(requested, "https://registry.npmjs.org/@unitfield%2freact");
});
