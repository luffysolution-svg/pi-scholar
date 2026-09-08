import { loadConfig } from "../src/config.js";
import { CASCommonChemistryClient } from "../src/chemistry/index.js";
import { createMaterialsLiveTestPlan, MaterialsProjectClient, validateMaterialsConfig } from "../src/materials-project/index.js";
import { disabledResearchConfig, liveDoiLookupCheck, liveJournalMetricsCheck, liveResearchCheck, previewResearchRequest } from "../src/research/index.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const positional = process.argv.slice(2).filter(value => !value.startsWith("--"));
const provider = argument("--provider") ?? positional[0];
if (!provider) throw new Error("Usage: npm run test:live -- <source> [query] [execute]");

const execute = process.argv.includes("--execute") || positional.includes("execute");
const enabled = process.env.PI_SCHOLAR_LIVE_TEST === "1";
const query = argument("--query") ?? positional.find((value, index) => index > 0 && value !== "execute") ?? "pi scholar";
const config = loadConfig(process.env, process.cwd(), false);

if (provider === "materials-project") {
  const raw = config.data?.providers?.["materials-project"];
  const validated = validateMaterialsConfig(raw);
  const preview = createMaterialsLiveTestPlan({ apiKeyEnv: validated.config.apiKeyEnv, maxRequests: 1 });
  console.log(JSON.stringify({ preview, configured: Boolean(validated.config.apiKey), permissions: "account entitlement unknown", willExecute: enabled && execute }, null, 2));
  if (!enabled || !execute) process.exit(0);
  const result = await new MaterialsProjectClient(validated.config).search({ formula: query, maxResults: 1, maxPages: 1 });
  console.log(JSON.stringify({ provider, records: result.records.length, requestsMade: result.requestsMade, truncated: result.truncated }, null, 2));
} else if (provider === "cas-common-chemistry") {
  const status = new CASCommonChemistryClient(config.data?.providers?.["cas-common-chemistry"]).status;
  console.log(JSON.stringify({ preview: status, willExecute: false }, null, 2));
  if (execute) {
    console.error("CAS Common Chemistry live test is blocked until provider-issued API access material is configured and implemented");
    process.exitCode = 2;
  }
} else {
  const research = config.research ?? disabledResearchConfig();
  const preview = previewResearchRequest(research, provider);
  console.log(JSON.stringify({ preview, permissions: "provider/account entitlement unknown", willExecute: enabled && execute }, null, 2));
  if (!enabled || !execute) process.exit(0);
  if (provider === "unpaywall") {
    const item = await liveDoiLookupCheck(research, provider, query);
    console.log(JSON.stringify({ provider, id: item.id, found: true, openAccessUrl: Boolean(item.openAccessUrl), license: item.source.license ?? null }, null, 2));
  } else if (provider === "easyscholar") {
    const metrics = await liveJournalMetricsCheck(research, provider, query);
    const value = metrics as { data?: { officialRank?: { all?: object; select?: object }; customRank?: { rankInfo?: unknown[]; rank?: unknown[] } } };
    console.log(JSON.stringify({
      provider,
      found: true,
      officialMetrics: Object.keys(value.data?.officialRank?.all ?? {}).length,
      selectedMetrics: Object.keys(value.data?.officialRank?.select ?? {}).length,
      customDatasets: value.data?.customRank?.rankInfo?.length ?? 0,
      customRanks: value.data?.customRank?.rank?.length ?? 0,
    }, null, 2));
  } else {
    const result = await liveResearchCheck(research, provider, query);
    console.log(JSON.stringify({ provider: result.provider, items: result.items.length, total: result.total, usage: result.usage, warnings: result.warnings }, null, 2));
  }
}
