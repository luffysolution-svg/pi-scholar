# ⚙️ Pi Scholar 配置说明

[English](./CONFIGURATION.en.md)

项目配置只保存非敏感设置。在线服务密钥通过 `/pi-scholar setup` 保存到本机凭据文件，或通过环境变量提供，不应写进 `pi-scholar.config.json`。

## 配置文件位置

按以下顺序查找，首个命中项生效：

1. `PI_SCHOLAR_CONFIG` 指定的文件；路径不存在时直接报错。
2. 从当前工作目录向上查找 `pi-scholar.config.json`；仅可信 Pi 项目可用。
3. `~/.config/pi-scholar/config.json`；Windows 对应 `%USERPROFILE%\.config\pi-scholar\config.json`。
4. `~/.pi-scholar.json`。
5. 内置默认值。

JSON 中的相对 `output.directory` 和 `zotero.dataDir` 相对于配置文件目录解析。环境变量中的相对路径相对于运行时工作目录解析。环境变量每次调用时重新读取，并始终覆盖 JSON。

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
        └── <Author-Year-Title>-assets/
            └── <assetFilePrefix>-01.png
```

<details>
<summary>字段约束</summary>

- `directory`：Vault 或普通输出根目录；不存在时自动创建。
- `literaturesDirectory`：根目录下的单级文献目录名。不能包含路径分隔符、Windows 保留设备名、结尾点或空格；最长 64 UTF-8 字节。
- `filenameSeparator`：连接作者、年份和标题，允许 1–3 个字符，字符范围为 `[+._ -]`。
- `assetFilePrefix`：图片文件名前缀，如 `figure-01.png`；必须是安全单级文件名。

- `tagSpaceReplacement`：只能是 `-` 或 `_`；仅用于 Markdown frontmatter 标签，`metadata.json` 保留 Zotero 原始标签。

论文名缺失部分分别使用 `UnknownAuthor`、`UnknownYear`、`Untitled`。非法跨平台字符会替换为空格，保留设备名会加前缀，名称限制为 220 UTF-8 字节。同名不同条目使用 ` (2)`、` (3)` 等后缀。

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

`/pi-scholar setup` 把密钥保存到 `~/.pi/agent/pi-scholar.credentials.json`，目录和文件权限会尽可能限制为当前用户。环境变量优先于本机凭据文件。

相关管理命令：

```text
/pi-scholar setup
/pi-scholar status
/pi-scholar credits
/pi-scholar clear-key
```

## 配置校验

所有字段在加载时检查类型、范围和路径安全。未知字段、错误类型、危险文件名、越界数字或非法 URL 都会明确报错，不会静默忽略或自动退回默认值。
