import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = mkdtempSync(path.join(tmpdir(), "pi-scholar-pack-"));
const requiredFiles = [
  "package.json",
  "src/index.ts",
  "src/ai4scholar/index.ts",
  "src/ai4scholar/client.ts",
  "src/ai4scholar/rest-tools.ts",
  "src/ai4scholar/advanced-tools.ts",
  "src/ai4scholar/mcp.ts",
  "src/media/tools.ts",
  "src/media/router.ts",
  "src/media/adapters/google.ts",
  "src/media/adapters/openai.ts",
  "skills/pi-scholar/SKILL.md",
  "skills/scholar-search/SKILL.md",
  "skills/zotero-research/SKILL.md",
  "skills/paper-reading/SKILL.md",
  "skills/academic-citation/SKILL.md",
  "skills/scientific-figure/SKILL.md",
  "bin/pi-scholar.mjs",
  "README.md",
  "README.en.md",
  "CHANGELOG.md",
  "docs/CONFIGURATION.md",
  "docs/CONFIGURATION.en.md",
  "docs/IMAGE_PROVIDERS.md",
  "docs/IMAGE_PROVIDERS.en.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "pi-scholar.config.example.json",
];

try {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("check-pack must be run through npm run pack:check");
  const output = execFileSync(process.execPath, [npmCli, "pack", "--json", "--pack-destination", directory], { encoding: "utf8" });
  const info = JSON.parse(output)[0];
  const files = new Set(info.files.map((entry) => entry.path));
  for (const required of requiredFiles) {
    if (!files.has(required)) throw new Error(`packed artifact missing ${required}`);
  }
  console.log(`verified ${info.filename}: ${files.size} files`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
