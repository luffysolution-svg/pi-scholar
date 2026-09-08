# 科研绘图供应商兼容性

[English](./IMAGE_PROVIDERS.en.md)

本文汇总了各科研绘图模型供应商官方支持的候选模型、核心参数与平台特性。具体可用模型取决于你的服务商账号权限与套餐计划。

## 官方文档速查

| 供应商 | 官方接入文档 |
|---|---|
| Gemini API | https://ai.google.dev/gemini-api/docs/image-generation |
| Vertex AI | https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images |
| OpenAI | https://developers.openai.com/api/docs/guides/image-generation |
| xAI | https://docs.x.ai/developers/model-capabilities/images/generation |
| fal.ai | https://fal.ai/models/fal-ai/nano-banana-2/api |
| Qwen / Model Studio | https://www.alibabacloud.com/help/en/model-studio/qwen-image-api |
| Atlas / Aixoras | https://doc.aixoras.com/jieruwendang/1-jiekouwendang.html |

> 注：Atlas 在本扩展中特指 Aixoras 提供的 API 转发服务（配置变量为 `ATLAS_API_KEY`），用于快速接入 GPT 生图能力。

## 能力对比矩阵

| 供应商 | 默认推荐模型 | 文生图 | 图生图 / 编辑 / 多参考图 | 分辨率规格 | 批量张数 | 透明背景 | 画面质量 |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Gemini API** | `gemini-3.1-flash-image` | 支持 | 支持；Gemini 3 最多 14 张参考图 | 1K / 2K / 4K | 顺序提交 | 暂无 | 暂无 |
| **Vertex AI** | `gemini-3.1-flash-image` | 支持 | 依模型而定 | Gemini：1K / 2K / 4K；Imagen 4：1K / 2K | Imagen：1–4 | 暂无 | 暂无 |
| **OpenAI** | `gpt-image-2` | 支持 | 支持；最多 16 张参考图 | 明确像素尺寸 | 1–10 | PNG / WebP | `auto`、`low`、`medium`、`high` |
| **xAI** | `grok-imagine-image-2.0` | 支持 | 支持；最多 5 张源图 | 1K / 2K | 1–10 | 暂无 | `auto`、`low`、`medium` |
| **fal.ai** | `fal-ai/nano-banana-2` | 支持 | 专用 `/edit` 模型；1–14 张源图 | 0.5K / 1K / 2K / 4K | 支持连续张数 | 模型专用 | 模型专用 |
| **Qwen** | `qwen-image-3.0-pro` | 支持 | Qwen 3 支持 1–3 张参考图 | 1K / 2K 或限定像素尺寸 | 1–6 | 暂无 | 暂无 |
| **Atlas** | `gpt-image-2-1k` | 支持 | 1 张参考图 | 明确像素尺寸，默认 `1024x1024` | 依服务而定 | 依模型而定 | 依模型而定 |
| **自定义 OpenAI 兼容服务** | 按配置顺序匹配 | 依声明能力 | 依声明能力 | 依端点而定 | 依端点而定 | 依端点而定 | 依端点而定 |

## 各供应商使用细则

### Gemini API 与 Vertex AI

- Gemini 原生生图接口基于 `generateContent`，支持纯文本生成、单图修改与多张参考图联合指导。
- Gemini 3 规格支持 1K、2K、4K；Gemini 2.5 默认输出原生 1K 图像。
- 多图生成任务按序分批提交。若参考图较多或需要持续多轮精细编辑，推荐优先使用 Flash 或 Pro 级别模型。
- Imagen 4 候选模型包括 `imagen-4.0-generate-001`、`imagen-4.0-fast-generate-001` 与 `imagen-4.0-ultra-generate-001`，通常支持单次输出 1–4 张 1K/2K 图像。
- Vertex AI 优先使用环境中的 Application Default Credentials（ADC），或通过配置指定服务账号 JSON。

### OpenAI

- GPT Image 候选模型包括 `gpt-image-2`、`gpt-image-1.5`、`gpt-image-1` 与 `gpt-image-1-mini`；DALL-E 仅在显式指定时使用。
- 支持单次生成 1–10 张图片，并支持传入最多 16 张参考图片联合编辑。
- 质量档位可选：`auto`、`low`、`medium`、`high`。
- 透明背景支持导出为 PNG 或 WebP；如果需要 0–100 的画质压缩比，建议选择 JPEG 或 WebP 输出格式。
- `gpt-image-2` 对像素尺寸有明确约束：宽高必须为 16 的倍数，最长边不超过 3840 像素，宽高比介于 1:3 到 3:1 之间。

### xAI

- `grok-imagine-image-2.0` 支持文生图、单图编辑与多参考图生成。
- 单次最多传入 5 张参考图并生成最多 10 张图片，生成时会自动保持参考图的传入顺序。
- 分辨率档位支持 1K 与 2K，画质选项可选 `auto`、`low`、`medium`。

### fal.ai

- 文生图默认推荐 `fal-ai/nano-banana-2`，图像编辑与图生图推荐 `fal-ai/nano-banana-2/edit`。
- 支持 0.5K、1K、2K、4K 尺寸，可自定义宽高比、生成张数、随机种子（seed）及图片格式（PNG/JPEG/WebP）。
- 本地参考图会在提交任务前自动上传至临时安全存储。

### Qwen / DashScope / QwenCloud

- 推荐模型为 `qwen-image-3.0-pro`、`qwen-image-3.0`、`qwen-image-2.0-pro` 与 `qwen-image-2.0`。
- Qwen 3 支持传入 1–3 张参考图，单次可生成 1–6 张 PNG 图像。
- 图像像素面积建议在 512² 到 2048² 之间，宽高比在 1:8 到 8:1 范围内。
- 若账号绑定了特定的百炼空间（Workspace），可在配置中的 `workspace` 填入空间 ID。

### Atlas / Aixoras

- 常用模型包括用于文生图的 `gpt-image-2-1k` 与用于图生图编辑的 `gpt-image-2-2k`。
- 默认像素尺寸为 `1024x1024`，支持在请求中指定 `2048x2048` 等上游支持的分辨率。
- 支持常见的学术配图比例：1:1、16:9、9:16、4:3、3:4、3:2、2:3、21:9。

## 连通性测试与配额

- **连接测试**：可通过 `/pi-scholar status` 快速核对当前配置的绘图供应商连通性。该测试仅读取模型列表进行握手确认，不发起任何实际付费生图请求。
- **余额查询**：由于各平台缺少统一的余额查询端点，建议直接登录各服务商控制台查看实时调用量与账单。

## 调用安全与文件处理

- **文件大小限制**：单张参考图体积建议控制在 50 MiB 以内，生成图片的默认大小限制为 50 MiB（可通过 `maxArtifactBytes` 调整），防止占用过多磁盘。
- **避免重复扣费**：遇到生图网络超时或服务异常时，扩展不会自动进行重试。建议先在服务商控制台核对任务状态后再手动重新发起。
- **原子写入**：生成后的科研图片以流式方式写入临时文件，下载完成后再原子重命名至目标目录，确保不会产生损坏或残缺的半成品文件。
