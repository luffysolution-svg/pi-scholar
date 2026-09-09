import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

const root = path.resolve("skills");
const allowedFields = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools", "disable-model-invocation"]);
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const problems = [];

function problem(file, message) {
  problems.push(`${path.relative(process.cwd(), file)}: ${message}`);
}

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const skillRoot = path.join(root, entry.name);
  const file = path.join(skillRoot, "SKILL.md");
  let source;
  try {
    source = await readFile(file, "utf8");
  } catch {
    problem(file, "missing SKILL.md");
    continue;
  }

  const match = source.replaceAll("\r\n", "\n").match(/^---\n([\s\S]*?)\n---\n([\s\S]+)$/);
  if (!match) {
    problem(file, "expected YAML frontmatter followed by a non-empty Markdown body");
    continue;
  }

  let frontmatter;
  try {
    frontmatter = YAML.parse(match[1]);
  } catch (error) {
    problem(file, `invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    problem(file, "frontmatter must be a mapping");
    continue;
  }

  for (const field of Object.keys(frontmatter)) {
    if (!allowedFields.has(field)) problem(file, `unknown frontmatter field ${field}`);
  }

  const name = frontmatter.name;
  if (typeof name !== "string" || !namePattern.test(name) || name.length > 64) {
    problem(file, "name must be 1-64 lowercase letters, numbers, or single hyphens");
  } else if (name !== entry.name) {
    problem(file, `name ${name} must match parent directory ${entry.name}`);
  }

  const description = frontmatter.description;
  if (typeof description !== "string" || description.trim().length === 0 || description.length > 1024) {
    problem(file, "description must contain 1-1024 characters");
  } else if (!/\buse\b|\bwhen\b/i.test(description)) {
    problem(file, "description should state when to use the skill");
  }

  if (frontmatter.license !== undefined && (typeof frontmatter.license !== "string" || !frontmatter.license.trim())) {
    problem(file, "license must be a non-empty string");
  }
  if (frontmatter.compatibility !== undefined && (typeof frontmatter.compatibility !== "string" || frontmatter.compatibility.length < 1 || frontmatter.compatibility.length > 500)) {
    problem(file, "compatibility must contain 1-500 characters");
  }
  if (frontmatter["allowed-tools"] !== undefined && typeof frontmatter["allowed-tools"] !== "string") {
    problem(file, "allowed-tools must be a space-delimited string");
  }
  if (frontmatter.metadata !== undefined) {
    const metadata = frontmatter.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || Object.values(metadata).some((value) => typeof value !== "string")) {
      problem(file, "metadata must map string keys to string values");
    }
  }

  const lineCount = source.split(/\r?\n/).length;
  if (lineCount > 500) problem(file, `SKILL.md has ${lineCount} lines; keep it under 500`);

  for (const link of match[2].matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = link[1].split("#", 1)[0];
    if (!target || /^(?:https?:|mailto:|file:)/i.test(target)) continue;
    if (path.isAbsolute(target)) {
      problem(file, `local reference must be relative: ${target}`);
      continue;
    }
    const normalized = target.replaceAll("\\", "/");
    if (normalized.split("/").filter(Boolean).length > 2) {
      problem(file, `keep references one level deep from SKILL.md: ${target}`);
    }
    const resolved = path.resolve(skillRoot, target);
    if (!resolved.startsWith(`${skillRoot}${path.sep}`)) {
      problem(file, `reference leaves the skill directory: ${target}`);
      continue;
    }
    try {
      await access(resolved);
      if (!(await stat(resolved)).isFile()) problem(file, `reference is not a file: ${target}`);
    } catch {
      problem(file, `missing reference: ${target}`);
    }
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Agent Skills validation passed");
}
