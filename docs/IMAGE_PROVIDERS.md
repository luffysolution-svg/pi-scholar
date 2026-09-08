# 科研绘图供应商兼容性

本文依据各供应商官方文档核对，最后更新于 **2026-09-06**。[English](./IMAGE_PROVIDERS.en.md)

API、模型可见性和计费规则可能因账号、项目、地区及套餐而变化。文档列出的模型是受支持候选，不代表任意凭据都拥有调用权限。

## 官方文档

| 供应商 | 官方文档 |
|---|---|
| Gemini API | https://ai.google.dev/gemini-api/docs/image-generation |
| Vertex AI | https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images |
| OpenAI | https://developers.openai.com/api/docs/guides/image-generation |
| xAI | https://docs.x.ai/developers/model-capabilities/images/generation |
| fal.ai | https://fal.ai/models/fal-ai/nano-banana-2/api |
| Qwen / Model Studio | https://www.alibabacloud.com/help/en/model-studio/qwen-image-api |
| Atlas / Aixoras | https://doc.aixoras.com/jieruwendang/1-jiekouwendang.html |

Atlas 在本项目中指由 `ATLAS_API_KEY` 配置的 Aixoras API。它是第三方中转服务，不是 OpenAI Platform 或 MongoDB Atlas；提交的提示词和源图片会由该服务及其上游处理。

## 能力矩阵

| 供应商 | 默认候选模型 | 文生图 | 编辑 / 参考图 | 分辨率 | 张数 | 透明背景 | 质量 |
|---|---|---:|---:|---|---|---:|---|
| Gemini API | `gemini-3.1-flash-image` | 支持 | 支持；Gemini 3 最多 14 张参考图 | 1K / 2K / 4K | 顺序提交 | 不支持 | 不支持 |
| Vertex AI | `gemini-3.1-flash-image` | 支持 | 取决于模型 | Gemini：1K / 2K / 4K；Imagen 4：1K / 2K | Imagen：1–4 | 不支持 | 不支持 |
| OpenAI | `gpt-image-2` | 支持 | 支持；最多 16 张源图 | 明确像素尺寸 | 1–10 | PNG/WebP | `auto`、`low`、`medium`、`high` |
| xAI | `grok-imagine-image-2.0` | 支持 | 支持；最多 5 张源图 | 1K / 2K | 1–10 | 不支持 | `auto`、`low`、`medium` |
| fal.ai | `fal-ai/nano-banana-2` | 支持 | 独立 `/edit` 模型；1–14 张源图 | 0.5K / 1K / 2K / 4K | 正整数；受服务限制 | 无通用控制 | 无通用控制 |
| Qwen | `qwen-image-3.0-pro` | 支持 | Qwen 3 支持 1–3 张源图 | 1K / 2K 或受限像素尺寸 | 1–6 | 不支持 | 不支持 |
| Atlas | `gpt-image-2-1k` | 支持 | 1 张源图 | 明确像素尺寸，默认 `1024x1024` | 正整数；受服务限制 | 取决于模型 | 取决于模型 |
| 自定义 OpenAI 兼容服务 | 按配置顺序 | 按声明能力 | 按声明能力 | 取决于端点 | 取决于端点 | 取决于端点 | 取决于端点 |

- 统一参数按所选模型提交，尺寸直接使用供应商接受的格式。

## 供应商说明

### Gemini API 与 Vertex AI

- Gemini 原生图片模型通过 `generateContent` 返回图片，支持文本、源图片和多参考图。
- Gemini 3 支持 1K、2K、4K；Gemini 2.5 使用其原生 1K 输出。
- 每次 Gemini 原生调用请求一张图片。多图任务会顺序提交，首次失败后停止，不自动重试可能计费的请求。
- Gemini 3 最多接受 14 张输入/参考图。参考图较多或需要连续编辑时优先使用 Flash 或 Pro，而不是 Flash Lite。
- Imagen 4 候选包括 `imagen-4.0-generate-001`、`imagen-4.0-fast-generate-001` 和 `imagen-4.0-ultra-generate-001`。标准 Imagen 生图仅支持文本，通常可输出 1–4 张 1K/2K 图片。
- Vertex 使用 ADC 或服务账号 JSON。`location` 必须为 `global` 或合法 Google Cloud 地区，例如 `us-central1`。
- Google 图片模型不开放统一的透明背景、输出格式、压缩和质量参数。

### OpenAI

- GPT Image 候选包括 `gpt-image-2`、`gpt-image-1.5`、`gpt-image-1` 和 `gpt-image-1-mini`。DALL-E 仅在显式指定时使用。
- GPT Image 支持 1–10 张输出及最多 16 张编辑/参考源图。
- 质量可设为 `auto`、`low`、`medium`、`high`。
- 透明背景要求 PNG 或 WebP；0–100 压缩参数要求显式选择 JPEG 或 WebP。
- GPT Image 2 的宽高必须为 16 的倍数，最长边不超过 3840 像素，宽高比在 1:3–3:1 之间，总面积为 655,360–8,294,400 像素。
- 较早 GPT Image 模型使用 `1024x1024`、`1536x1024`、`1024x1536` 或 `auto`，不接受含义不明确的 1K/2K/4K 别名。

### xAI

- `grok-imagine-image-2.0` 支持生成、单图编辑和多图编辑。
- 最多接受 5 张源图和 10 张输出，源图顺序会保留。
- 分辨率为 1K 或 2K；未记录任意像素尺寸和 4K 支持。
- 质量为 `auto`、`low` 或 `medium`。
- 不开放蒙版、透明背景、输出格式和压缩控制。

### fal.ai

- `fal-ai/nano-banana-2` 用于文生图，`fal-ai/nano-banana-2/edit` 用于编辑和参考图。
- 支持 0.5K、1K、2K、4K、宽高比、张数、seed 及 PNG/JPEG/WebP。
- 本地源图会先上传到 fal 存储，再提交队列。高分辨率和模型原生高级选项可能增加费用。
- fal 参数与具体端点绑定，只启用已经核实的图片端点。

### Qwen / DashScope / QwenCloud

- 当前候选为 `qwen-image-3.0-pro`、`qwen-image-3.0`、`qwen-image-2.0-pro`、`qwen-image-2.0`；其他模型仅在显式指定时使用。
- Qwen 3 支持 1–3 张源图和 1–6 张 PNG 输出。
- 图片面积须在 512²–2048² 像素之间，宽高比为 1:8–8:1。支持方形 1K/2K 别名，不支持 4K。
- 不开放蒙版、透明背景、质量和压缩控制。
- Qwen 3 账号可能使用包含 Workspace ID 的地区域名。请在 `providerOptions.<id>.baseUrl` 配置账号实际 origin，并按需设置 `workspace`。

### Atlas / Aixoras

- 文档示例包括用于生成的 `gpt-image-2-1k` 和用于编辑的 `gpt-image-2-2k`，应以账号实际可见模型为准。
- GPT Image 2 请求使用明确像素尺寸；未指定时使用 `1024x1024`。需要更大尺寸时直接填写 `2048x2048` 等上游接受的像素尺寸。
- 支持 1:1、16:9、9:16、4:3、3:4、3:2、2:3、21:9。
- 编辑接受一张源图，不开放多参考图和蒙版。

## 模型、连接测试与余额

- Gemini、Vertex AI Model Garden、OpenAI、xAI、Atlas（目录可用时）及自定义 OpenAI 兼容服务支持只读模型发现。fal 和 Qwen 使用已核实的内置候选。
- 自定义目录不会根据陌生模型名称猜测能力，只有 `customProviders` 中明确声明的模型才会被识别为图片模型。
- Gemini、Vertex、OpenAI、xAI 和自定义 `/models` 端点支持非生成式连接测试。目录访问成功只表示该目录认证成功，不代表拥有图片推理权限或剩余额度。
- 当前未启用稳定的官方余额接口。`balance` 返回 `unsupported` 并引导到供应商账单控制台；连接测试不会通过付费生图完成。

## 数据、费用与安全

- 提示词和参考图片会发送给所选外部供应商。
- 本地及远程参考输入单个限制为 50 MiB；供应商 JSON 响应限制为 128 MiB；生成文件默认限制为 50 MiB，可通过 `maxArtifactBytes` 调整。
- 生成文件以流式方式写入输出目录，先写临时文件再原子重命名；失败时清理不完整文件。
- 带认证的下载请求绑定原始域名；重定向会重新校验；私有及保留地址会被拒绝。
- 对失败或结果不明确的计费请求不会自动重试。手动重试前应先查看供应商任务和账单记录。
