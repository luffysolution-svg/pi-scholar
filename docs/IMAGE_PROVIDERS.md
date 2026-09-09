# 科研绘图供应商

[English](./IMAGE_PROVIDERS.en.md)

下表列出各供应商在 Pi Scholar 中可用的模型和参数。账号权限、地区和套餐可能影响实际可用范围。

## 供应商文档

| 供应商 | 文档 |
|---|---|
| Gemini API | https://ai.google.dev/gemini-api/docs/image-generation |
| Vertex AI | https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images |
| OpenAI | https://developers.openai.com/api/docs/guides/image-generation |
| xAI | https://docs.x.ai/developers/model-capabilities/images/generation |
| fal.ai | https://fal.ai/models/fal-ai/nano-banana-2/api |
| Qwen / Model Studio | https://www.alibabacloud.com/help/en/model-studio/qwen-image-api |
| Atlas / Aixoras | https://doc.aixoras.com/jieruwendang/1-jiekouwendang.html |

> 本文中的 Atlas 指 Aixoras API 转发服务，配置变量为 `ATLAS_API_KEY`。

## 功能对照

| 供应商 | 默认模型 | 文生图 | 编辑与参考图 | 分辨率 | 返回数量 | 透明背景 | 质量参数 |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Gemini API | `gemini-3.1-flash-image` | 支持 | 支持；Gemini 3 最多 14 张参考图 | 1K / 2K / 4K | 顺序提交 | 暂无 | 暂无 |
| Vertex AI | `gemini-3.1-flash-image` | 支持 | 依模型而定 | Gemini：1K / 2K / 4K；Imagen 4：1K / 2K | Imagen：1 至 4 | 暂无 | 暂无 |
| OpenAI | `gpt-image-2` | 支持 | 最多 16 张参考图 | 像素尺寸 | 1 至 10 | PNG / WebP | `auto`、`low`、`medium`、`high` |
| xAI | `grok-imagine-image-2.0` | 支持 | 最多 5 张源图 | 1K / 2K | 1 至 10 | 暂无 | `auto`、`low`、`medium` |
| fal.ai | `fal-ai/nano-banana-2` | 支持 | `/edit` 模型；1 至 14 张源图 | 0.5K / 1K / 2K / 4K | 依模型而定 | 依模型而定 | 依模型而定 |
| Qwen | `qwen-image-3.0-pro` | 支持 | Qwen 3 支持 1 至 3 张参考图 | 1K / 2K 或限定像素尺寸 | 1 至 6 | 暂无 | 暂无 |
| Atlas | `gpt-image-2-1k` | 支持 | 1 张参考图 | 明确像素尺寸，默认 `1024x1024` | 依服务而定 | 依模型而定 | 依模型而定 |
| 自定义 OpenAI 兼容服务 | 按配置顺序匹配 | 依声明能力 | 依声明能力 | 依端点而定 | 依端点而定 | 依端点而定 | 依端点而定 |

## 供应商参数

### Gemini API 与 Vertex AI

- Gemini 通过 `generateContent` 处理文生图、单图修改和多参考图生成。
- Gemini 3 支持 1K、2K 和 4K；Gemini 2.5 默认输出 1K 图像。
- 多图任务按顺序提交。Flash 和 Pro 模型可处理多参考图编辑，具体数量受模型限制。
- Imagen 4 候选模型包括 `imagen-4.0-generate-001`、`imagen-4.0-fast-generate-001` 和 `imagen-4.0-ultra-generate-001`，单次可输出 1 至 4 张 1K 或 2K 图像。
- Vertex AI 优先使用环境中的 Application Default Credentials（ADC），或通过配置指定服务账号 JSON。

### OpenAI

- GPT Image 候选模型包括 `gpt-image-2`、`gpt-image-1.5`、`gpt-image-1` 和 `gpt-image-1-mini`。只有用户指定 DALL-E 时才会调用它。
- 单次可生成 1 至 10 张图片，并传入最多 16 张参考图。
- 质量参数可取 `auto`、`low`、`medium`、`high`。
- 透明背景可导出为 PNG 或 WebP。JPEG 和 WebP 的压缩参数范围为 0 至 100。
- `gpt-image-2` 对像素尺寸有明确约束：宽高必须为 16 的倍数，最长边不超过 3840 像素，宽高比介于 1:3 到 3:1 之间。

### xAI

- `grok-imagine-image-2.0` 支持文生图、单图编辑与多参考图生成。
- 单次最多传入 5 张参考图、生成 10 张图片。参考图顺序不变。
- 分辨率可取 1K 或 2K，质量参数可取 `auto`、`low`、`medium`。

### fal.ai

- 默认文生图模型是 `fal-ai/nano-banana-2`，编辑模型是 `fal-ai/nano-banana-2/edit`。
- 支持 0.5K、1K、2K、4K 尺寸，可自定义宽高比、生成张数、随机种子（seed）及图片格式（PNG/JPEG/WebP）。
- 本地参考图在请求前上传到临时文件存储。

### Qwen / DashScope / QwenCloud

- 候选模型包括 `qwen-image-3.0-pro`、`qwen-image-3.0`、`qwen-image-2.0-pro` 和 `qwen-image-2.0`。
- Qwen 3 支持 1 至 3 张参考图，单次可生成 1 至 6 张 PNG 图像。
- 图像像素面积范围为 512² 到 2048²，宽高比范围为 1:8 到 8:1。
- 若账号绑定了特定的百炼空间（Workspace），可在配置中的 `workspace` 填入空间 ID。

### Atlas / Aixoras

- 常用模型包括用于文生图的 `gpt-image-2-1k` 与用于图生图编辑的 `gpt-image-2-2k`。
- 默认像素尺寸为 `1024x1024`，支持在请求中指定 `2048x2048` 等上游支持的分辨率。
- 支持常见的学术配图比例：1:1、16:9、9:16、4:3、3:4、3:2、2:3、21:9。

## 状态与配额

`/pi-scholar status` 显示本地配置中可识别的绘图供应商，不连接远端，也不验证生图权限。`pi_scholar_image_models` 可以读取支持目录查询的供应商模型列表。余额和账单需在供应商控制台查看。

## 文件处理

参考图和生成文件的默认上限为 50 MiB，可用 `maxArtifactBytes` 调整。下载先写入 `.part` 文件，完成后再改为最终文件名。

生图请求提交后可能计费。网络超时不会触发自动重试；再次提交前可先查看供应商任务记录。
