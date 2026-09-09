import { readFile, writeFile } from "node:fs/promises";
import { renderMaterialsCapabilitiesMarkdown } from "../src/materials-project/capabilities.js";

const documents = [
  {
    path: new URL("../docs/materials-capabilities.md", import.meta.url),
    content: renderMaterialsCapabilitiesMarkdown("zh"),
  },
  {
    path: new URL("../docs/materials-capabilities.en.md", import.meta.url),
    content: renderMaterialsCapabilitiesMarkdown("en"),
  },
];

if (process.argv.includes("--check")) {
  for (const document of documents) {
    const current = await readFile(document.path, "utf8");
    if (current !== document.content) {
      throw new Error("Materials capability docs are stale; run npm run docs:materials");
    }
  }
} else {
  await Promise.all(documents.map((document) => writeFile(document.path, document.content, "utf8")));
}
