import { readFile, writeFile } from "node:fs/promises";
import { getMaterialsCapabilities, renderMaterialsCapabilitiesMarkdown } from "../src/materials-project/capabilities.js";

const markdownPath = new URL("../docs/materials-capabilities.md", import.meta.url);
const jsonPath = new URL("../docs/materials-capabilities.json", import.meta.url);
const markdown = renderMaterialsCapabilitiesMarkdown();
const json = `${JSON.stringify({ schemaVersion: 1, source: "src/materials-project/capabilities.ts", capabilities: getMaterialsCapabilities() }, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const [currentMarkdown, currentJson] = await Promise.all([readFile(markdownPath, "utf8"), readFile(jsonPath, "utf8")]);
  if (currentMarkdown !== markdown || currentJson !== json) throw new Error("Materials capability docs are stale; run npm run docs:materials");
} else {
  await Promise.all([writeFile(markdownPath, markdown, "utf8"), writeFile(jsonPath, json, "utf8")]);
}
