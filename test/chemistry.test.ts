import assert from "node:assert/strict";
import test from "node:test";
import { CASCommonChemistryClient } from "../src/chemistry/index.js";

test("CAS Common Chemistry remains an independent blocked data source until API access is granted", async () => {
  const client = new CASCommonChemistryClient({ enabled: true, apiKeyEnv: "CAS_TEST_API_KEY" });
  assert.equal(client.status.id, "cas-common-chemistry");
  assert.equal(client.status.implementationStatus, "contract_blocked");
  assert.equal(client.status.accessStatus, "permission_required");
  await assert.rejects(() => client.search({ query: "caffeine" }), /API access\/contract/);
  await assert.rejects(() => client.get("58-08-2"), /API access\/contract/);
});
