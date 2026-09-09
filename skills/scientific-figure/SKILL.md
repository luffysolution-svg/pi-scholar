---
name: scientific-figure
description: Generate, edit, compose, critique, restyle, iterate, or vectorize scientific figures with Pi Scholar. Use for mechanism diagrams, graphical abstracts, publication illustrations, figure revision, reference-guided generation, transparent assets, or raster-to-vector workflows.
license: MIT
compatibility: Requires Pi 0.84.4 or newer with the @luffysolution/pi-scholar package. Generation requires network access and credentials for a configured image provider.
---

# Scientific figure workflow

Create publication-oriented scientific illustrations while preserving scientific integrity. Generated content is a draft illustration, never experimental evidence.

## 1. Define the figure contract

Before generation, establish or infer only what is safe to infer:

- scientific message and intended audience;
- figure type: mechanism diagram, graphical abstract, workflow, apparatus, conceptual model, cover art, or supporting illustration;
- required labels, language, units, symbols, molecular structures, and causal directions;
- target aspect ratio or dimensions, background, output format, and approximate resolution;
- whether source/reference images may be sent to an external provider;
- whether the task is exploratory or publication-ready.

Ask a concise clarification only when a wrong assumption would materially change scientific meaning, cost, privacy, or layout.

## 2. Select a provider and model

If the user specifies a provider, honor it when the requested controls are supported. Otherwise call `pi_scholar_image_models` and select a configured provider based on the task:

- transparent PNG/WebP or precise pixel dimensions: prefer OpenAI;
- 4K resolution tiers or many visual references: prefer Gemini or fal.ai;
- Vertex governance, project, or regional requirements: use Vertex AI;
- 1K/2K generation or up to five ordered references: xAI is suitable;
- Qwen-native infographic or Chinese-language workflows: use DashScope/QwenCloud;
- Atlas: use only when explicitly configured and accept aspect-ratio-only sizing;
- custom OpenAI-compatible provider: use only declared models and capabilities.

Omit `model` to use the newest compatible catalog candidate or configured default. A successful catalog listing confirms visibility, not generation entitlement, balance, or regional availability.

## 3. Choose the operation

- Call `pi_scholar_image_generate` for text-to-image, image-to-image, or reference-guided generation.
- Call `pi_scholar_image_edit` when the user expects an existing image to remain the base composition or supplies a mask.
- Use `ai4scholar_figure` for `smart`, `style`, `compose`, `iterate`, `critic`, or `vectorize` operations. Inspect the returned inline image and report its saved path.
- Call `pi_scholar_image_service` with `test_connection` only for setup diagnosis. It must not submit a paid generation.
- If `balance` returns `unsupported`, direct the user to the provider billing console. Never invent quota or credit values.

Inputs may be local paths, `file://` URIs, HTTP(S) URLs, or data URIs when supported by the selected provider. Reference images are transmitted to that provider and may affect billing.

## 4. Build a scientific prompt

Use a structured prompt in this order:

1. **Subject and claim** — the exact process, structure, or relationship to depict.
2. **Composition** — panel count, reading direction, hierarchy, focal element, and reserved label space.
3. **Scientific constraints** — required entities, phases, interfaces, arrows, units, colors with semantic meaning, and forbidden inaccuracies.
4. **Visual language** — journal-ready vector illustration, clean line work, restrained palette, consistent perspective, and legible negative space.
5. **Output constraints** — aspect ratio, background, language, and whether text should be omitted for later typesetting.
6. **Exclusions** — no invented data points, fake axes, unreadable labels, decorative molecular structures, watermarks, or unsupported claims.

Prefer generating geometry and visual structure without dense text, then add exact labels in a deterministic graphics editor when spelling or notation must be publication-grade.

## 5. Control cost and resolution

- Start at 1K or the provider's economical quality for composition exploration.
- Use 2K/4K only after composition and scientific content are approved.
- Request multiple images only when alternatives are genuinely useful.
- Do not map one provider's fields onto another. OpenAI uses explicit pixel dimensions; Gemini/fal use resolution tiers; xAI uses 1K/2K; Qwen accepts bounded dimensions; Atlas guarantees aspect ratio rather than exact pixels.
- Use transparent background only when the selected model documents it. Unsupported normalized fields must produce an explicit adjustment or error, never silent omission.

## 6. Validate the result

After generation or editing, inspect and report:

- spelling, symbols, subscripts/superscripts, units, and nomenclature;
- molecular structures, crystal motifs, apparatus geometry, and material interfaces;
- arrow direction, causal sequence, legends, scale bars, and panel order;
- consistency with supplied references and requested colors;
- any hallucinated element or item requiring domain-expert confirmation;
- whether the result is suitable only as a concept draft or ready for deterministic finishing.

Never describe a generated plot, microscopy image, spectrum, diffraction pattern, or measurement trace as observed data. For quantitative figures, generate them from source data with plotting code instead of an image model.

## 7. Handle failures safely

- Do not automatically retry a failed or ambiguous billable submission.
- Authentication and permission failures require configuration correction, not retry loops.
- If a Gemini multi-image batch partially succeeds, report saved files and the stopping point.
- Preserve successful local artifacts when a later batch item fails.
- Report provider-specific unsupported controls and offer a compatible alternative without changing scientific intent.
