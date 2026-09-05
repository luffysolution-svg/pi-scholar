# ⚙️ 配置说明（中文）

[English version](./CONFIGURATION.en.md)

`pi-scholar` 使用**一个 JSON 文件**统一配置 Zotero 连接、MinerU 解析行为、输出位置、资源命名与标签格式。所有字段在加载时都会做类型/范围/安全校验，配置错误会直接抛出清晰的错误，而不是静默使用默认值。

## 📁 配置文件在哪里

复制项目根目录下的 [`pi-scholar.config.example.json`](../pi-scholar.config.example.json) 为 `pi-scholar.config.json`（或放到下面的用户级路径），然后按需修改。

> ⚠️ **不要提交 `pi-scholar.config.json` 到仓库**——它已经被 `.gitignore` 忽略，因为其中通常包含你本地的输出路径等私有信息。

### 🔍 查找顺序

按以下顺序依次查找，命中即停止：

1. **`PI_SCHOLAR_CONFIG` 环境变量** —— 显式指定一个文件路径；该路径必须存在，否则工具会拒绝启动。
2. **就近的 `pi-scholar.config.json`** —— 从当前工作目录开始向上查找。仅当项目目录被 Pi 判定为可信（`ctx.isProjectTrusted()`）时才会生效，防止一个不可信项目悄悄劫持你的输出目录或 Zotero 地址。
3. **`~/.config/pi-scholar/config.json`** —— 所有平台通用，包括 Windows（对应 `%USERPROFILE%\.config\pi-scholar\config.json`）。
4. **`~/.pi-scholar.json`** —— 最后的兜底位置。
5. 以上都不存在时，使用内置默认值。

### 📌 路径解析规则

- JSON 文件里的 `output.directory`、`zotero.dataDir` 若写成**相对路径**，会相对于**配置文件所在目录**解析（而不是当前工作目录）。
- 通过**环境变量**覆盖的路径，则相对于**运行时的 `cwd`** 解析。
- 环境变量在每次工具调用时都会重新读取，并且**始终优先于 JSON 文件**，适合做一次性覆盖（例如 CI、临时输出目录）而不用改配置文件。

## 📝 完整示例

```json
{
  "output": {
    "directory": "F:/个人知识库",
    "filenameSeparator": "-",
    "assetsSuffix": "scholar-assets",
    "assetFilePrefix": "figure",
    "metadataFileName": "metadata.json",
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

---

## 📤 `output` — 输出位置与命名

| 字段 | 环境变量 | 默认值 |
|---|---|---|
| `directory` | `PI_SCHOLAR_OUTPUT_DIR` | `~/pi-scholar` |
| `filenameSeparator` | `PI_SCHOLAR_FILENAME_SEPARATOR` | `-` |
| `assetsSuffix` | `PI_SCHOLAR_ASSETS_SUFFIX` | `scholar-assets` |
| `assetFilePrefix` | `PI_SCHOLAR_ASSET_FILE_PREFIX` | `figure` |
| `metadataFileName` | `PI_SCHOLAR_METADATA_FILE` | `metadata.json` |
| `tagSpaceReplacement` | `PI_SCHOLAR_TAG_SPACE_REPLACEMENT` | `-` |

<details>
<summary>字段详细说明</summary>

- **`directory`**：生成的 `.md` 文件与同级资源目录的发布位置。可以指向一个 Obsidian Vault 文件夹，但从不依赖 Obsidian 本身。JSON 中的相对路径相对配置文件目录解析；环境变量中的相对路径相对 `cwd` 解析。
- **`filenameSeparator`**：拼接 `Author`、`Year`、`Title` 生成文件名时使用的分隔符，仅允许 1–3 个字符，取自 `[+._ -]`。
- **`assetsSuffix`**：与 Markdown 同级的资源目录后缀。默认生成 `Author-Year-Title-scholar-assets/`；字母/数字开头的值会自动用 `filenameSeparator` 与文档名连接，自带标点前缀的值（如 `.assets`、`_media`）则直接拼接。必须是安全的文件名片段（不含路径分隔符，UTF-8 字节数不超过 64）。
- **`assetFilePrefix`**：提取出的图片文件名前缀，例如 `figure-01.png`。
- **`metadataFileName`**：资源目录内的元数据旁车文件名，必须以 `.json` 结尾。
- **`tagSpaceReplacement`**：`-` 或 `_`，仅用于替换 Obsidian 侧标签中的空白/不受支持标点；元数据旁车文件始终保留 Zotero 原始标签文本。

</details>

## 🗂️ `zotero` — 本地 Zotero 连接

| 字段 | 环境变量 | 默认值 |
|---|---|---|
| `baseUrl` | `ZOTERO_BASE_URL` | `http://127.0.0.1:23119/api` |
| `dataDir` | `ZOTERO_DATA_DIR` | 无 |
| `timeoutMs` | `ZOTERO_TIMEOUT_MS` | `15000` |
| `maxItems` | `ZOTERO_MAX_ITEMS` | `5000` |

<details>
<summary>字段详细说明</summary>

- **`baseUrl`**：只允许精确等于 `http://localhost:23119/api` 或 `http://127.0.0.1:23119/api`——不接受其他主机、端口、路径、凭据、查询串或片段。这是代码层面强制校验的，而不仅仅是文档约定。
- **`dataDir`**：Zotero 数据目录（内含 `storage/`），仅在 Zotero 自身的 `file/view/url` 接口无法解析某个受管附件路径时作为兜底使用。
- **`timeoutMs`**：单次请求超时时间，允许范围 1,000–120,000 毫秒。
- **`maxItems`**：单次调用分页结果数量上限，允许范围 1–50,000。

</details>

> 需要在 Zotero 设置中开启 **允许其他应用程序与 Zotero 通信**。所有 Zotero 请求都是无认证的本地回环 GET 请求，且禁用重定向；切勿将 23119 端口暴露到外网。

## 🧬 `mineru` — PDF 解析行为

| 字段 | 环境变量 | 默认值 |
|---|---|---|
| `tokenEnv` | — | `MINERU_API_TOKEN` |
| （实际密钥） | `MINERU_API_TOKEN` 或 `tokenEnv` 指定的变量名 | 无 |
| `timeoutMs` | `MINERU_TIMEOUT_MS` | `600000` |
| `pollInitialMs` / `pollMaxMs` | `MINERU_POLL_INITIAL_MS` / `MINERU_POLL_MAX_MS` | `3000` / `15000` |
| `maxAttempts` | `MINERU_MAX_ATTEMPTS` | `120` |
| `language` | `MINERU_LANGUAGE` | `en` |
| `enableFormula` / `enableTable` | `MINERU_ENABLE_FORMULA` / `MINERU_ENABLE_TABLE` | `true` / `true` |
| `isOcr` | `MINERU_IS_OCR` | `false` |
| `modelVersion` | `MINERU_MODEL_VERSION` | `vlm` |

<details>
<summary>字段详细说明</summary>

- **`tokenEnv`**：指定*哪个*环境变量存放 MinerU 密钥。配置文件本身从不存储密钥内容，只存变量名（必须是大写、匹配 `[A-Z_][A-Z0-9_]*`）。
- **实际的 MinerU API 令牌**：只有调用 `pi_scholar_parse` 时才需要，其他工具均无需此令牌。
- **`timeoutMs`**：整体解析截止时间；单次 HTTP 请求另有独立的 60 秒上限。
- **`pollInitialMs` / `pollMaxMs`**：等待 MinerU 完成解析时的退避轮询区间。
- **`maxAttempts`**：最大轮询次数，允许范围 1–1000。
- **`language`**：MinerU OCR / 版面识别的语言提示。
- **`enableFormula` / `enableTable`**：环境变量支持 `1/0`、`true/false`、`yes/no`（大小写不敏感）。
- **`isOcr`**：即使 PDF 已有文本层，也强制走 OCR。
- **`modelVersion`**：MinerU 模型版本标识。

</details>

---

## 🌱 环境变量速查

完整的环境变量清单见仓库根目录的 [`.env.example`](../.env.example)（仅作文档用途）。**本项目不会自行读取 `.env` 文件**，请通过 Shell、操作系统或 Pi 自身的环境变量机制导出这些变量。

## 🔗 Ai4Scholar 配置

Ai4Scholar 功能已直接集成到 `pi-scholar`，但出于密钥隔离与向后兼容考虑，仍使用原有的独立配置入口：

- `/ai4scholar setup`
- `AI4SCHOLAR_API_KEY`（旧版兼容 `AI4S_API_KEY`）
- `AI4SCHOLAR_BASE_URL`
- `AI4SCHOLAR_TIMEOUT_MS`
- 及其代理相关设置
