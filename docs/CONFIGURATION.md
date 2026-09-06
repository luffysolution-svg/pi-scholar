# ⚙️ Pi Scholar 配置说明

[English](./CONFIGURATION.en.md)

建议项目配置只保存非敏感设置。Ai4Scholar 密钥通过 `/pi-scholar setup` 或环境变量提供；绘图服务既支持在统一的 `media.providerOptions` 中填写 `apiKey`，也支持更安全的 `apiKeyEnv` 环境变量名。不要提交包含密钥的配置文件。

## 配置文件位置

按以下顺序查找，首个命中项生效：

1. `PI_SCHOLAR_CONFIG` 指定的文件；路径不存在时直接报错。
2. 从当前工作目录向上查找 `pi-scholar.config.json`；仅可信 Pi 项目可用。
3. `~/.config/pi-scholar/config.json`；Windows 对应 `%USERPROFILE%\.config\pi-scholar\config.json`。
4. `~/.pi-scholar.json`。
5. 内置默认值。

JSON 中的相对 `output.directory`、`zotero.dataDir`、`media.outputDir` 和 Vertex `credentialsFile` 相对于配置文件目录解析。环境变量中的相对路径相对于运行时工作目录解析。原有 Zotero/MinerU 环境变量覆盖 JSON；绘图服务则以统一配置中显式填写的凭据和端点为准，仅在未填写时回退到环境变量。

> `pi-scholar.config.json` 已被 `.gitignore` 忽略。不要把包含本地路径的个人配置提交到公开仓库。

## 完整示例

```json
{
  "output": {
    "directory": "F:/个人知识库",
    "literaturesDirectory": "Literatures",
    "filenameSeparator": "-",
    "assetFilePrefix": "figure",
    "tagSpaceReplacement": "-"
  },
  "zotero": {
    "baseUrl": "http://127.0.0.1:23119/api",
    "timeoutMs": 15000,
    "maxItems": 5000
  },
  "media": {
    "outputDir": "./pi-scholar-output/images",
    "providerOptions": {
      "gemini": { "apiKeyEnv": "GEMINI_API_KEY" },
      "vertex": { "credentialsFile": "./vertex-service-account.json", "location": "global" },
      "openai": { "apiKeyEnv": "OPENAI_API_KEY" },
      "xai": { "apiKeyEnv": "XAI_API_KEY" },
      "fal": { "apiKeyEnv": "FAL_KEY" },
      "dashscope": { "apiKeyEnv": "DASHSCOPE_API_KEY" },
      "qwencloud": { "apiKeyEnv": "QWENCLOUD_API_KEY" },
      "atlas": { "apiKeyEnv": "ATLAS_API_KEY" }
    }
  },
  "mineru": {
    "tokenEnv": "MINERU_API_TOKEN",
    "timeoutMs": 600000,
    "pollInitialMs": 3000,
    "pollMaxMs": 15000,
    "maxAttempts": 120,
    "language": "en",
    "enableFormula": true,
    "enableTable": true,
    "isOcr": false,
    "modelVersion": "vlm"
  }
}
```

## `output`：输出结构与命名

| JSON 字段 | 环境变量 | 默认值 |
|---|---|---|
| `directory` | `PI_SCHOLAR_OUTPUT_DIR` | `~/pi-scholar` |
| `literaturesDirectory` | `PI_SCHOLAR_LITERATURES_DIR` | `Literatures` |
| `filenameSeparator` | `PI_SCHOLAR_FILENAME_SEPARATOR` | `-` |
| `assetFilePrefix` | `PI_SCHOLAR_ASSET_FILE_PREFIX` | `figure` |
| `tagSpaceReplacement` | `PI_SCHOLAR_TAG_SPACE_REPLACEMENT` | `-` |

默认结构：

```text
<directory>/
└── <literaturesDirectory>/
    └── <Author-Year-Title>/
        ├── <Author-Year-Title>.md
        ├── metadata.json
        └── assets/
            └── <assetFilePrefix>-01.png
```

<details>
<summary>字段约束</summary>

- `directory`：Vault 或普通输出根目录；不存在时自动创建。
- `literaturesDirectory`：根目录下的单级文献目录名。不能包含路径分隔符、Windows 保留设备名、结尾点或空格；最长 64 UTF-8 字节。
- `filenameSeparator`：连接作者、年份和标题，允许 1–3 个字符，字符范围为 `[+._ -]`。
- `assetFilePrefix`：图片文件名前缀，如 `figure-01.png`；必须是安全单级文件名。

- `tagSpaceReplacement`：只能是 `-` 或 `_`；仅用于 Markdown frontmatter 标签，`metadata.json` 保留 Zotero 原始标签。

论文名缺失部分分别使用 `UnknownAuthor`、`UnknownYear`、`Untitled`。非法跨平台字符会替换为空格，保留设备名会加前缀。名称首先限制为 220 UTF-8 字节，再根据实际 `directory` 路径动态截短，使最终 Markdown 和图片路径不超过 240 个字符；完整标题仍写入 frontmatter 和 `metadata.json`。同名不同条目使用 ` (2)`、` (3)` 等后缀。资源目录固定为 `assets`，已有同条目的过长目录会在重新解析时事务化迁移。

</details>

## `zotero`：本地 Zotero

| JSON 字段 | 环境变量 | 默认值 |
|---|---|---|
| `baseUrl` | `ZOTERO_BASE_URL` | `http://127.0.0.1:23119/api` |
| `dataDir` | `ZOTERO_DATA_DIR` | 无 |
| `timeoutMs` | `ZOTERO_TIMEOUT_MS` | `15000` |
| `maxItems` | `ZOTERO_MAX_ITEMS` | `5000` |

- `baseUrl` 只允许 `http://localhost:23119/api` 或 `http://127.0.0.1:23119/api`，不接受其他主机、端口、凭据、查询或重定向。
- `dataDir` 是包含 `storage/` 的 Zotero 数据目录，仅在 Local API 无法解析受管附件路径时作为兜底。
- `timeoutMs` 范围为 1,000–120,000 毫秒。
- `maxItems` 范围为 1–50,000。

请在 Zotero 设置中开启“允许其他应用程序与 Zotero 通信”，不要把端口 23119 暴露到外网。

## `mineru`：PDF 解析

| JSON 字段 | 环境变量 | 默认值 |
|---|---|---|
| `tokenEnv` | — | `MINERU_API_TOKEN` |
| 实际密钥 | `MINERU_API_TOKEN` 或 `tokenEnv` 指定名称 | 无 |
| `timeoutMs` | `MINERU_TIMEOUT_MS` | `600000` |
| `pollInitialMs` | `MINERU_POLL_INITIAL_MS` | `3000` |
| `pollMaxMs` | `MINERU_POLL_MAX_MS` | `15000` |
| `maxAttempts` | `MINERU_MAX_ATTEMPTS` | `120` |
| `language` | `MINERU_LANGUAGE` | `en` |
| `enableFormula` | `MINERU_ENABLE_FORMULA` | `true` |
| `enableTable` | `MINERU_ENABLE_TABLE` | `true` |
| `isOcr` | `MINERU_IS_OCR` | `false` |
| `modelVersion` | `MINERU_MODEL_VERSION` | `vlm` |

- `tokenEnv` 只保存环境变量名称，不保存令牌；名称必须匹配 `[A-Z_][A-Z0-9_]*`。
- `timeoutMs` 是整体解析期限，范围 10,000–3,600,000 毫秒；单次 HTTP 尝试另有 60 秒上限。
- 轮询间隔分别限制在 100–60,000 和 100–120,000 毫秒；`maxAttempts` 范围 1–1000。
- 布尔环境变量接受 `1/0`、`true/false`、`yes/no`，不区分大小写。
- `isOcr=true` 会对已有文本层的 PDF 仍然强制 OCR。

MinerU 会通过网络接收所选 PDF，并可能消耗配额。只有需要结构化正文、公式、表格或图片时才应解析。

## `media`：多平台科研绘图

内置供应商 ID：`gemini`、`vertex`、`openai`、`xai`、`fal`、`dashscope`、`qwencloud`、`atlas`。统一工具支持文生图、图生图/编辑、多参考图、宽高比、尺寸/分辨率、张数、质量、透明背景和输出格式；但参数会按模型能力严格校验，不支持的字段会报错，不会静默忽略。

| 字段 | 说明 |
|---|---|
| `outputDir` | 图片下载目录；默认 `<output.directory>/images` |
| `maxArtifactBytes` | 单个下载文件上限；默认 52,428,800（50 MiB），范围 1–1,073,741,824 字节 |
| `artifactTimeoutMs` | 下载超时；默认 120,000，范围 1,000–3,600,000 毫秒 |
| `providerOptions.<id>.apiKey` | 直接配置密钥；显式配置优先于环境变量，不建议提交到仓库 |
| `providerOptions.<id>.apiKeyEnv` | 指定承载密钥的环境变量名 |
| `providerOptions.vertex.credentialsFile` | Vertex 服务账号 JSON；相对配置文件目录解析，也支持标准 ADC |
| `providerOptions.vertex.location` / `project` | Vertex 地区与可选项目 ID；地区须为 `global` 或合法 GCP region（如 `us-central1`），项目可从 JSON/ADC 推断 |
| `defaultModels.<id>.<capability>` | 可选固定模型；省略时选择官方目录或内置候选中的最新可用模型 |
| `customProviders` | 声明自定义 OpenAI 兼容服务的模型、能力及 generation/edit 端点 |

默认环境变量为 `GEMINI_API_KEY`（亦回退 `GOOGLE_API_KEY`）、`OPENAI_API_KEY`、`XAI_API_KEY`、`FAL_KEY`/`FAL_API_KEY`、`DASHSCOPE_API_KEY`、`QWENCLOUD_API_KEY` 和 `ATLAS_API_KEY`。Vertex 支持 `GOOGLE_APPLICATION_CREDENTIALS`、`VERTEX_CREDENTIALS_FILE`、`GOOGLE_CLOUD_PROJECT` 和 `GOOGLE_CLOUD_LOCATION`。

Qwen 3 官方服务常使用带 Workspace ID 的地区域名，应把实际账号对应的 origin 配为 `baseUrl`。配置字段按供应商严格限制：Vertex 使用 `credentialsFile/project/location`，Qwen 可额外使用 `workspace`，fal 仅接受密钥设置，自定义供应商的服务地址写在 `customProviders[].baseUrl`。调用级 `providerOptions` 只能放模型原生高级字段，不能覆盖密钥、端点或统一参数。

尺寸能力不是完全统一的：OpenAI 使用明确像素尺寸；Gemini/fal 使用 1K/2K/4K 档位；xAI 使用 1K/2K；Qwen 支持 1K/2K 或合法的明确尺寸；Atlas 的 GPT Image 2 代理只保证宽高比。透明背景与质量等参数也只在官方明确支持的平台开放。完整核对结果及官方链接见 [`IMAGE_PROVIDERS.md`](./IMAGE_PROVIDERS.md)。

`pi_scholar_image_models` 可读取支持的平台模型目录（不提交生图）；`pi_scholar_image_service` 可对 OpenAI、Gemini、xAI、Vertex 和声明了 `/models` 的自定义 OpenAI 兼容服务执行只读连接测试。fal、Qwen 与 Atlas 未核实到稳定的无生成探测接口时会返回 `unsupported`。当前也没有核实到这些平台可通用且稳定的余额 API，因此 `balance` 会明确返回 `unsupported`，请在平台账单控制台查询。

自定义 OpenAI 兼容配置示例见仓库根目录的 [`pi-scholar.config.example.json`](../pi-scholar.config.example.json)。模型必须显式声明 `image.text_to_image`、`image.image_to_image`、`image.edit` 或 `image.multi_reference` 能力和对应端点。

## 在线学术服务

在线检索、引用、期刊、绘图和 MCP 功能使用以下环境变量：

| 环境变量 | 默认值 / 说明 |
|---|---|
| `AI4SCHOLAR_API_KEY` | 在线服务 API Key；也可运行 `/pi-scholar setup` |
| `AI4SCHOLAR_BASE_URL` | `https://ai4scholar.net` |
| `AI4SCHOLAR_TIMEOUT_MS` | `30000` 毫秒 |
| `AI4SCHOLAR_PROXY` | HTTP(S) 代理；设为 `direct` 强制直连 |
| `AI4SCHOLAR_MCP_URL` | `https://mcp.ai4scholar.net/sse` |
| `HTTPS_PROXY` / `HTTP_PROXY` | 未设置专用代理时的通用代理兜底 |

`/pi-scholar setup` 把密钥保存到 `~/.pi/agent/pi-scholar.credentials.json`，目录和文件权限会尽可能限制为当前用户。环境变量优先于本机凭据文件。未显式配置代理时，Windows 系统代理检测只有在注册表 `ProxyEnable` 已开启时才会采用 `ProxyServer`，不会使用关闭代理后残留的旧地址。

相关管理命令：

```text
/pi-scholar setup
/pi-scholar status
/pi-scholar credits
/pi-scholar clear-key
```

## 配置校验

所有字段在加载时检查类型、范围和路径安全。未知字段、错误类型、危险文件名、越界数字或非法 URL 都会明确报错，不会静默忽略或自动退回默认值。
